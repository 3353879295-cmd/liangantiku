import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Definition = {
  data: Record<string, unknown>;
  onShow(): void;
  onClearLearningData(): Promise<void>;
  onLogout(): Promise<void>;
  onDeleteAccount(): Promise<void>;
};
const load = async (clear = true, deleted = true, logoutDecision = false) => {
  vi.resetModules();
  let page: Definition | undefined;
  const auth = {
    getState: vi.fn(() => ({ status: 'authenticated' })),
    retryBackground: vi.fn(() => Promise.resolve()),
    clearLearningData: vi.fn(() => Promise.resolve(clear)),
    logout: vi.fn(() => Promise.resolve({ needsDecision: logoutDecision })),
    deleteAccount: vi.fn(() => Promise.resolve(deleted)),
  };
  const cloudSync = {
    getState: vi.fn(() => ({ status: 'failed', pendingCount: 1, notice: null })),
  };
  vi.doMock('../miniprogram/services/app-services', () => ({ appServices: { auth, cloudSync } }));
  const showModal = vi.fn(() => Promise.resolve({ confirm: true, cancel: false }));
  const showToast = vi.fn();
  const reLaunch = vi.fn();
  vi.stubGlobal('wx', { showModal, showToast, reLaunch });
  vi.stubGlobal('Page', (value: Definition) => {
    page = value;
  });
  await import('../miniprogram/packages/auxiliary/pages/account-data/index');
  if (!page) throw new Error('account data page was not registered');
  const registered = page;
  const context = {
    data: structuredClone(registered.data),
    onShow() {
      registered.onShow.call(this);
    },
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    },
  };
  return { auth, context, page: registered, reLaunch, showModal, showToast };
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('account data page', () => {
  it('does not run account operations for a non-authenticated state', async () => {
    const loaded = await load();
    loaded.auth.getState.mockReturnValue({ status: 'guest' });
    loaded.page.onShow.call(loaded.context);
    await loaded.page.onClearLearningData.call(loaded.context);
    await loaded.page.onLogout.call(loaded.context);
    await loaded.page.onDeleteAccount.call(loaded.context);
    expect(loaded.auth.clearLearningData).not.toHaveBeenCalled();
    expect(loaded.auth.logout).not.toHaveBeenCalled();
    expect(loaded.auth.deleteAccount).not.toHaveBeenCalled();
  });

  it('only reports successful clearing after AuthService completes it', async () => {
    const { page, context, auth, showToast } = await load(false);
    page.onShow.call(context);
    await page.onClearLearningData.call(context);
    expect(auth.clearLearningData).toHaveBeenCalledOnce();
    expect(showToast).toHaveBeenCalledWith({ title: '清除未完成，请重试', icon: 'none' });

    const success = await load(true);
    success.page.onShow.call(success.context);
    await success.page.onClearLearningData.call(success.context);
    expect(success.showToast).toHaveBeenCalledWith({ title: '学习数据已清除', icon: 'none' });
  });
  it('keeps local state on failed deletion and returns home only after success', async () => {
    const failed = await load(true, false);
    failed.page.onShow.call(failed.context);
    await failed.page.onDeleteAccount.call(failed.context);
    expect(failed.reLaunch).not.toHaveBeenCalled();
    const success = await load(true, true);
    success.page.onShow.call(success.context);
    await success.page.onDeleteAccount.call(success.context);
    expect(success.reLaunch).toHaveBeenCalledWith({ url: '/pages/home/index' });
  });
  it('offers an explicit discard choice after failed logout', async () => {
    const { page, context, auth, reLaunch } = await load(true, true, true);
    auth.logout
      .mockResolvedValueOnce({ needsDecision: true })
      .mockResolvedValueOnce({ needsDecision: false });
    page.onShow.call(context);
    await page.onLogout.call(context);
    expect(auth.logout).toHaveBeenNthCalledWith(1);
    expect(auth.logout).toHaveBeenNthCalledWith(2, true);
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/home/index' });
  });

  it('actually retries synchronization when the user chooses to keep pending logout data', async () => {
    const { page, context, auth, reLaunch, showModal } = await load(true, true, true);
    auth.logout
      .mockResolvedValueOnce({ needsDecision: true })
      .mockResolvedValueOnce({ needsDecision: false });
    showModal.mockResolvedValueOnce({ confirm: false, cancel: true });
    page.onShow.call(context);

    await page.onLogout.call(context);

    expect(auth.retryBackground).toHaveBeenCalledOnce();
    expect(auth.logout).toHaveBeenNthCalledWith(2);
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/home/index' });
  });

  it('cancels destructive actions without clearing or deleting anything', async () => {
    const loaded = await load();
    loaded.showModal.mockResolvedValue({ confirm: false, cancel: true });
    loaded.page.onShow.call(loaded.context);

    await loaded.page.onClearLearningData.call(loaded.context);
    await loaded.page.onDeleteAccount.call(loaded.context);

    expect(loaded.auth.clearLearningData).not.toHaveBeenCalled();
    expect(loaded.auth.deleteAccount).not.toHaveBeenCalled();
    expect(loaded.showToast).not.toHaveBeenCalled();
  });

  it('contains the irreversible deletion warning and failed-sync retry branch', () => {
    const markup = readFileSync(
      resolve(
        import.meta.dirname,
        '../miniprogram/packages/auxiliary/pages/account-data/index.wxml',
      ),
      'utf8',
    );
    expect(markup).toContain('云端学习记录将永久删除且无法恢复。');
    expect(markup).toContain('wx:if="{{retryVisible}}"');
    expect(markup).toContain('重试同步');
  });
});
