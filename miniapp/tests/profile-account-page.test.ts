import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Definition = {
  data: Record<string, unknown>;
  onShow(): void;
  onLoginAndSync(): void;
  onOpenAccountData(): void;
  onRetrySync(): Promise<void>;
};

const load = async (
  authStatus: 'guest' | 'authenticated',
  syncStatus: 'idle' | 'syncing' | 'pending' | 'failed' | 'conflict',
) => {
  vi.resetModules();
  let page: Definition | undefined;
  const retryBackground = vi.fn();
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: {
      auth: { getState: () => ({ status: authStatus }), retryBackground },
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
  vi.stubGlobal('wx', { navigateTo });
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
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    },
  };
  return { context, navigateTo, page: registered, retryBackground };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('profile account state', () => {
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
    page.onLoginAndSync.call(context);
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/account-entry/index?mode=login' });
  });

  it.each([
    ['idle', '已同步'],
    ['syncing', '同步中'],
    ['pending', '待同步（2 项）'],
    ['failed', '同步失败'],
    ['conflict', '已恢复云端记录'],
  ] as const)('presents %s state in Chinese', async (status, text) => {
    const { context, page } = await load('authenticated', status);
    page.onShow.call(context);
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
});
