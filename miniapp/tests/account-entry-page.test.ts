import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Definition = {
  data: Record<string, unknown>;
  onLoad(options: Record<string, string>): Promise<void>;
  onLogin(): Promise<void>;
  onGuest(): void;
  onRetry(): Promise<void>;
  onTemporaryGuest(): void;
};

const load = async (
  state = {
    status: 'guest',
    preference: 'undecided',
    temporaryGuest: false,
    notice: null as string | null,
  },
) => {
  vi.resetModules();
  let page: Definition | undefined;
  const auth = {
    initialize: vi.fn(() => Promise.resolve(state)),
    login: vi.fn(() => Promise.resolve(true)),
    chooseGuest: vi.fn(),
    retry: vi.fn(() => Promise.resolve(true)),
    useTemporaryGuest: vi.fn(),
    getState: vi.fn(() => state),
  };
  vi.doMock('../miniprogram/services/app-services', () => ({ appServices: { auth } }));
  const reLaunch = vi.fn();
  vi.stubGlobal('wx', { reLaunch });
  vi.stubGlobal('Page', (value: Definition) => {
    page = value;
  });
  await import('../miniprogram/pages/account-entry/index');
  if (!page) throw new Error('account entry page was not registered');
  const context = {
    data: structuredClone(page.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    },
  };
  return { auth, context, page, reLaunch };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('account entry page', () => {
  it('registers entry first and account data as an auxiliary subpackage', async () => {
    const config = await import('../miniprogram/app.json');
    expect(config.default.pages[0]).toBe('pages/account-entry/index');
    const auxiliaryPackage = config.default.subPackages.find(
      (subpackage) => subpackage.root === 'packages/auxiliary',
    );
    expect(auxiliaryPackage?.pages).toContain('pages/account-data/index');
  });

  it('shows the confirmed first-login copy and persists guest selection', async () => {
    const { page, context, auth } = await load();
    await page.onLoad.call(context, {});
    expect(context.data.phase).toBe('choice');
    expect(context.data.message).toBe('');
    const markup = readFileSync(
      resolve(import.meta.dirname, '../miniprogram/pages/account-entry/index.wxml'),
      'utf8',
    );
    for (const copy of [
      '登录粮安题库',
      '登录后可跨设备同步学习记录、错题、收藏和设置。',
      '微信登录',
      '暂不登录',
      '正在恢复云端学习记录…',
      '重新登录',
      '以游客身份进入',
    ]) {
      expect(markup).toContain(copy);
    }
    page.onGuest.call(context);
    expect(auth.chooseGuest).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 'authenticated', preference: 'account', temporaryGuest: false, notice: null },
    { status: 'guest', preference: 'guest', temporaryGuest: false, notice: null },
  ])('automatically enters the app for a resolved $preference preference', async (state) => {
    const { page, context, reLaunch } = await load(state);
    await page.onLoad.call(context, {});
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/home/index' });
  });

  it('does not auto-redirect a persistent guest opened for explicit login', async () => {
    const { page, context, reLaunch } = await load({
      status: 'guest',
      preference: 'guest',
      temporaryGuest: false,
      notice: null,
    });
    await page.onLoad.call(context, { mode: 'login' });
    expect(context.data.phase).toBe('choice');
    expect(reLaunch).not.toHaveBeenCalled();
  });

  it('guards repeated login and provides retry plus temporary guest after failure', async () => {
    const { page, context, auth } = await load({
      status: 'error',
      preference: 'account',
      temporaryGuest: false,
      notice: '失败',
    });
    await page.onLoad.call(context, {});
    const login = page.onLogin.call(context);
    void page.onLogin.call(context);
    await login;
    expect(auth.login).toHaveBeenCalledOnce();
    context.data.busy = false;
    await page.onRetry.call(context);
    expect(auth.retry).toHaveBeenCalledOnce();
    context.data.busy = false;
    page.onTemporaryGuest.call(context);
    expect(auth.useTemporaryGuest).toHaveBeenCalledOnce();
  });
});
