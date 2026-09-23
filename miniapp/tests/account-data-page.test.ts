import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Definition = {
  data: Record<string, unknown>;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetrySync(): Promise<void>;
  onClearLearningData(): Promise<void>;
  onLogout(): Promise<void>;
  onDeleteAccount(): Promise<void>;
};
const load = async (clear = true, deleted = true, logoutDecision = false) => {
  vi.resetModules();
  let page: Definition | undefined;
  let notify: () => void = () => undefined;
  const subscribe = vi.fn((listener: () => void) => {
    notify = listener;
    return () => {
      if (notify === listener) notify = () => undefined;
    };
  });
  const auth = {
    getState: vi.fn(() => ({ status: 'authenticated' })),
    retryBackground: vi.fn(() => Promise.resolve()),
    clearLearningData: vi.fn(() => Promise.resolve(clear)),
    logout: vi.fn(() => Promise.resolve({ needsDecision: logoutDecision })),
    deleteAccount: vi.fn(() => Promise.resolve(deleted)),
    subscribe,
  };
  const cloudSync = {
    getState: vi.fn(() => ({ status: 'failed', pendingCount: 1, notice: null })),
  };
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: { auth, cloudSync },
  }));
  const showModal = vi.fn((options: { confirmText?: string }) => {
    if ([...(options.confirmText ?? '')].length > 4)
      return Promise.reject(
        new Error('showModal:fail confirmText length should not larger than 4 Chinese characters'),
      );
    return Promise.resolve({ confirm: true, cancel: false });
  });
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
  return {
    auth,
    cloudSync,
    context,
    page: registered,
    reLaunch,
    showModal,
    showToast,
    notify: () => notify(),
    subscribe,
  };
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('account data page', () => {
  it('shows automatic saving for a recoverable revision conflict', async () => {
    const loaded = await load();
    loaded.cloudSync.getState.mockReturnValue({
      status: 'conflict',
      pendingCount: 4,
      notice: null,
    });
    loaded.page.onShow.call(loaded.context);
    expect(loaded.context.data.syncText).toBe('正在自动保存');
    expect(loaded.context.data.retryVisible).toBe(false);
    expect(loaded.auth.retryBackground).not.toHaveBeenCalled();
  });

  it.each(['onRetrySync', 'onLogout'] as const)(
    '%s releases busy after an exception',
    async (method) => {
      const loaded = await load();
      loaded.cloudSync.getState.mockReturnValue({
        status: 'conflict',
        pendingCount: 4,
        notice: null,
      });
      loaded.auth.retryBackground.mockRejectedValueOnce(new Error('offline'));
      loaded.auth.logout.mockRejectedValueOnce(new Error('offline'));
      loaded.page.onShow.call(loaded.context);
      await expect(loaded.page[method].call(loaded.context)).resolves.toBeUndefined();
      expect(loaded.context.data.busy).toBe(false);
    },
  );

  it('does not write to the page after an in-flight retry completes on unload', async () => {
    const loaded = await load();
    let complete!: () => void;
    loaded.auth.retryBackground.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    loaded.page.onShow.call(loaded.context);
    const operation = loaded.page.onRetrySync.call(loaded.context);
    loaded.page.onUnload.call(loaded.context);
    const changes = vi.spyOn(loaded.context, 'setData');
    complete();
    await operation;
    expect(changes).not.toHaveBeenCalled();
  });

  it('refreshes only while visible when background recovery notifies the page', async () => {
    const loaded = await load();
    loaded.page.onShow.call(loaded.context);
    loaded.cloudSync.getState.mockReturnValue({ status: 'idle', pendingCount: 0, notice: null });
    loaded.notify();
    expect(loaded.context.data.syncText).toBe('已自动保存');

    loaded.page.onHide.call(loaded.context);
    const updates = vi.spyOn(loaded.context, 'setData');
    loaded.cloudSync.getState.mockReturnValue({ status: 'failed', pendingCount: 1, notice: null });
    loaded.notify();
    expect(updates).not.toHaveBeenCalled();
  });

  it.each(['onClearLearningData', 'onDeleteAccount'] as const)(
    '%s ignores success and failure UI effects after unload',
    async (method) => {
      for (const fails of [false, true]) {
        const loaded = await load();
        let finish!: () => void;
        const action =
          method === 'onClearLearningData'
            ? loaded.auth.clearLearningData
            : loaded.auth.deleteAccount;
        action.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              finish = () => (fails ? reject(new Error('offline')) : resolve(true));
            }),
        );
        loaded.page.onShow.call(loaded.context);
        const operation = loaded.page[method].call(loaded.context);
        await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
        loaded.page.onUnload.call(loaded.context);
        const changes = vi.spyOn(loaded.context, 'setData');
        finish();
        await operation;
        expect(changes).not.toHaveBeenCalled();
        expect(loaded.showToast).not.toHaveBeenCalled();
        expect(loaded.reLaunch).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['onClearLearningData', 'onDeleteAccount'] as const)(
    '%s requires two confirmations and blocks duplicate taps',
    async (method) => {
      const loaded = await load();
      let confirmFirst!: (value: { confirm: boolean; cancel: boolean }) => void;
      loaded.showModal.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            confirmFirst = resolve;
          }),
      );
      loaded.page.onShow.call(loaded.context);
      const operation = loaded.page[method].call(loaded.context);
      await loaded.page[method].call(loaded.context);
      expect(loaded.showModal).toHaveBeenCalledOnce();
      expect(loaded.auth.clearLearningData).not.toHaveBeenCalled();
      expect(loaded.auth.deleteAccount).not.toHaveBeenCalled();
      confirmFirst({ confirm: true, cancel: false });
      await operation;
      expect(loaded.showModal).toHaveBeenCalledTimes(2);
      const action =
        method === 'onDeleteAccount' ? loaded.auth.deleteAccount : loaded.auth.clearLearningData;
      expect(action).toHaveBeenCalledOnce();
      expect(loaded.context.data.busy).toBe(false);
    },
  );

  it.each(['onClearLearningData', 'onDeleteAccount'] as const)(
    '%s preserves data when the second confirmation is cancelled or fails',
    async (method) => {
      for (const fails of [false, true]) {
        const loaded = await load();
        loaded.showModal.mockResolvedValueOnce({ confirm: true, cancel: false });
        if (fails) loaded.showModal.mockRejectedValueOnce(new Error('modal unavailable'));
        else loaded.showModal.mockResolvedValueOnce({ confirm: false, cancel: true });
        loaded.page.onShow.call(loaded.context);
        await expect(loaded.page[method].call(loaded.context)).resolves.toBeUndefined();
        expect(loaded.showModal).toHaveBeenCalledTimes(2);
        expect(loaded.auth.clearLearningData).not.toHaveBeenCalled();
        expect(loaded.auth.deleteAccount).not.toHaveBeenCalled();
        expect(loaded.reLaunch).not.toHaveBeenCalled();
        expect(loaded.context.data.busy).toBe(false);
      }
    },
  );

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
  it('keeps data and explains when a pending clear blocks logout', async () => {
    const { page, context, auth, reLaunch, showToast } = await load(true, true, true);
    page.onShow.call(context);
    await expect(page.onLogout.call(context)).resolves.toBeUndefined();
    expect(auth.logout).toHaveBeenCalledOnce();
    expect(reLaunch).not.toHaveBeenCalled();
    expect(context.data.busy).toBe(false);
    expect(showToast).toHaveBeenCalledWith({ title: '数据正在清理，请稍后重试退出', icon: 'none' });
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

  it('contains automatic restore copy and failed-network retry branch', () => {
    const markup = readFileSync(
      resolve(
        import.meta.dirname,
        '../miniprogram/packages/auxiliary/pages/account-data/index.wxml',
      ),
      'utf8',
    );
    expect(markup).toContain('云端学习记录将永久删除且无法恢复。');
    expect(markup).toContain('wx:if="{{retryVisible}}"');
    expect(markup).toContain('立即重试');
    expect(markup).toContain('登录时会自动恢复此前记录');
    expect(markup).not.toContain('处理同步冲突');
  });
});
