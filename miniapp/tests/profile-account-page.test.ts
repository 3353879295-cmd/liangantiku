import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Definition = {
  data: Record<string, unknown>;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onLoginAndSync(): void;
  onOpenAccountData(): void;
  onRetrySync(): Promise<void>;
  onClearLearningData(): Promise<void>;
  loadMembership(): Promise<void>;
};

const load = async (
  authStatus: 'checking' | 'guest' | 'authenticated' | 'error',
  syncStatus: 'idle' | 'syncing' | 'pending' | 'failed' | 'conflict',
) => {
  vi.resetModules();
  let page: Definition | undefined;
  const retryBackground = vi.fn();
  const clearLearningData = vi.fn(() => Promise.resolve(true));
  const getStatus = vi.fn<() => Promise<unknown>>();
  const authState = {
    status: authStatus,
    preference: authStatus === 'guest' ? 'guest' : 'account',
    temporaryGuest: false,
    notice: null,
  };
  const initialize = vi.fn(() => Promise.resolve({ ...authState }));
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: {
      membership: { getStatus },
      auth: { getState: () => ({ ...authState }), initialize, retryBackground, clearLearningData },
      cloudSync: {
        getState: () => ({ status: syncStatus, pendingCount: 2 }),
        getLastSyncedAt: () => '2026-09-02T10:20:00Z',
      },
      progress: {
        getPreferences: () => ({
          nickname: '小麦',
          avatarUrl: '',
          selectedCertificateKey: '4-02-06-01:5',
        }),
        getDashboard: () => ({
          answered: 0,
          correct: 0,
          accuracy: 0,
          durationMs: 0,
          streakDays: 0,
          todayAnswered: 0,
          dailyGoal: 20,
        }),
        getActivity: () => [],
      },
    },
    localDateKey: () => '2026-09-02',
  }));
  const navigateTo = vi.fn();
  const showModal = vi.fn(() => Promise.resolve({ confirm: true, cancel: false }));
  const showToast = vi.fn();
  vi.stubGlobal('wx', { navigateTo, showModal, showToast });
  vi.stubGlobal('Page', (value: Definition) => {
    page = value;
  });
  await import('../miniprogram/pages/profile/index');
  if (!page) throw new Error('profile page was not registered');
  const registered = page;
  const context = {
    data: structuredClone(registered.data),
    getTabBar: () => undefined,
    onShow() {
      registered.onShow.call(this);
    },
    loadMembership: vi.fn(),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    },
  };
  return {
    authState,
    clearLearningData,
    context,
    initialize,
    navigateTo,
    page: registered,
    retryBackground,
    getStatus,
    showModal,
    showToast,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('profile account state', () => {
  it.each([1, 2])('preserves guest records when confirmation %s is cancelled', async (step) => {
    const loaded = await load('guest', 'idle');
    if (step === 2) loaded.showModal.mockResolvedValueOnce({ confirm: true, cancel: false });
    loaded.showModal.mockResolvedValueOnce({ confirm: false, cancel: true });
    await loaded.page.onClearLearningData.call(loaded.context);
    expect(loaded.showModal).toHaveBeenCalledTimes(step);
    expect(loaded.clearLearningData).not.toHaveBeenCalled();
    expect(loaded.context.data.clearing).toBe(false);
  });

  it('requires both guest confirmations and ignores duplicate taps while a modal is open', async () => {
    const loaded = await load('guest', 'idle');
    let confirm!: (value: { confirm: boolean; cancel: boolean }) => void;
    loaded.showModal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const operation = loaded.page.onClearLearningData.call(loaded.context);
    await loaded.page.onClearLearningData.call(loaded.context);
    expect(loaded.showModal).toHaveBeenCalledOnce();
    expect(loaded.clearLearningData).not.toHaveBeenCalled();
    confirm({ confirm: true, cancel: false });
    await operation;
    expect(loaded.showModal).toHaveBeenCalledTimes(2);
    expect(loaded.clearLearningData).toHaveBeenCalledOnce();
    expect(loaded.context.data.clearing).toBe(false);
  });

  it('preserves guest records and releases the lock after a modal failure', async () => {
    const loaded = await load('guest', 'idle');
    loaded.showModal.mockResolvedValueOnce({ confirm: true, cancel: false });
    loaded.showModal.mockRejectedValueOnce(new Error('modal unavailable'));
    await expect(loaded.page.onClearLearningData.call(loaded.context)).resolves.toBeUndefined();
    expect(loaded.clearLearningData).not.toHaveBeenCalled();
    expect(loaded.context.data.clearing).toBe(false);
  });

  it('ends an unavailable membership display without retaining stale member status', async () => {
    const { context, page, getStatus } = await load('authenticated', 'idle');
    context.data.isMember = true;
    getStatus.mockRejectedValueOnce(new Error('offline'));
    await page.loadMembership.call(context);
    expect(context.data.isMember).toBe(false);
    expect(context.data.membershipStatus).toBe('会员状态暂未更新');
  });

  it('ignores an old membership reply after hiding and starting a fresh request', async () => {
    const { context, page, getStatus } = await load('authenticated', 'idle');
    let rejectOld!: (reason: Error) => void;
    getStatus.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
    );
    const oldRequest = page.loadMembership.call(context);
    page.onHide.call(context);
    getStatus.mockRejectedValueOnce(new Error('offline'));
    await page.loadMembership.call(context);
    context.data.membershipStatus = 'newer status';
    rejectOld(new Error('late failure'));
    await oldRequest;
    expect(context.data.membershipStatus).toBe('newer status');
  });

  it('shows the guest state and opens explicit login', async () => {
    const { context, navigateTo, page } = await load('guest', 'idle');
    page.onShow.call(context);
    expect(context.data.accountStatus).toBe('guest');
    const markup = readFileSync(
      resolve(import.meta.dirname, '../miniprogram/pages/profile/index.wxml'),
      'utf8',
    );
    expect(markup).toContain('当前为游客');
    expect(markup).toContain('记录仅保存在本机，登录后以云端数据为准');
    expect(markup).toContain('登录并同步');
    expect(markup).toContain('bind:tap="onLoginAndSync"');
    expect(navigateTo).not.toHaveBeenCalled();
    page.onLoginAndSync.call(context);
    expect(navigateTo).toHaveBeenCalledOnce();
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/account-entry/index?mode=login' });
  });

  it.each([
    ['idle', '已同步'],
    ['syncing', '同步中'],
    ['pending', '待同步（2 项）'],
    ['failed', '同步失败'],
    ['conflict', '同步已暂停'],
  ] as const)('presents %s state in Chinese', async (status, text) => {
    const { context, page, navigateTo } = await load('authenticated', status);
    page.onShow.call(context);
    expect(navigateTo).not.toHaveBeenCalled();
    expect(context.data.syncText).toBe(text);
    expect(context.data.lastSyncedAt).toContain('最近同步：2026-09-02 10:20');
  });

  it('retries failed sync and opens account data', async () => {
    const { context, navigateTo, page, retryBackground } = await load('authenticated', 'failed');
    page.onShow.call(context);
    await page.onRetrySync.call(context);
    expect(retryBackground).toHaveBeenCalledOnce();
    page.onOpenAccountData.call(context);
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/packages/auxiliary/pages/account-data/index',
    });
  });

  it('keeps an account recovery failure distinct from a guest session', async () => {
    const { context, page } = await load('error', 'failed');
    page.onShow.call(context);

    expect(context.data.accountStatus).toBe('offline');
    expect(context.data.syncText).toBe('账号暂离线');
    expect(context.data.accountDetail).toBe('正在使用本机账号缓存，可主动登录重试。');
    const markup = readFileSync(
      resolve(import.meta.dirname, '../miniprogram/pages/profile/index.wxml'),
      'utf8',
    );
    expect(markup).toContain('登录并重试');
  });

  it('refreshes a visible profile after account recovery finishes', async () => {
    const { authState, context, initialize, page } = await load('checking', 'idle');
    initialize.mockImplementationOnce(() => {
      authState.status = 'authenticated';
      return Promise.resolve({ ...authState });
    });

    page.onShow.call(context);
    await Promise.resolve();
    await Promise.resolve();

    expect(context.data.accountStatus).toBe('authenticated');
  });

  it('does not refresh a hidden profile after recovery finishes', async () => {
    let completeRecovery!: () => void;
    const { authState, context, initialize, page } = await load('checking', 'idle');
    initialize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeRecovery = () => {
            authState.status = 'authenticated';
            resolve({ ...authState });
          };
        }),
    );

    page.onShow.call(context);
    page.onHide.call(context);
    completeRecovery();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.data.accountStatus).toBe('recovering');
  });
});
