import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

type Definition = {
  data: Record<string, unknown>;
  onLoad(options: Record<string, string>): Promise<void>;
  onRouteDone(): void;
  onChooseAvatar(event: { detail?: { avatarUrl?: unknown } }): Promise<void>;
  onLogin(): Promise<void>;
  onGuest(): void;
  onRetry(): Promise<void>;
  onTemporaryGuest(): void;
  onAvatarRejected(): void;
  onUnload(): void;
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
  const wechatAvatar = {
    upload: vi.fn(() =>
      Promise.resolve(
        `cloud://cloud1-d2gglad830c91db10/account-avatars/${'a'.repeat(64)}/nonce0001.jpg`,
      ),
    ),
    confirm: vi.fn(),
    isControlled: vi.fn(() => false),
    remove: vi.fn(() => Promise.resolve()),
  };
  const progress = {
    updatePreferences: vi.fn(),
    getPreferences: vi.fn(() => ({ avatarUrl: '' })),
    refreshAccountSnapshot: vi.fn(),
  };
  const cloudSync = {
    getAvatarUploadPathPrefix: vi.fn<() => string | null>(
      () => `account-avatars/${'a'.repeat(64)}`,
    ),
    getConfirmedAvatarUrl: vi.fn(() => 'cloud://test-env.bucket/account-avatars/a.jpg'),
    getState: vi.fn(() => ({ status: 'idle', pendingCount: 0 })),
    process: vi.fn(() => Promise.resolve()),
  };
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: { auth, wechatAvatar, progress, cloudSync },
  }));
  const navigateBack = vi.fn();
  const switchTab = vi.fn();
  vi.stubGlobal('wx', { navigateBack, switchTab });
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
  return { auth, context, page, navigateBack, switchTab, wechatAvatar, progress, cloudSync };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('account entry page', () => {
  it.each(['login', 'retry', 'avatar'] as const)(
    'does not navigate or update a departed page when pending %s completes',
    async (action) => {
      const { page, context, auth, navigateBack, switchTab, wechatAvatar } = await load();
      await page.onLoad.call(context, { mode: 'login' });
      let finish: (success: boolean) => void = () => undefined;
      auth.login.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      );
      const pending =
        action === 'avatar'
          ? page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/avatar.png' } })
          : action === 'retry'
            ? page.onRetry.call(context)
            : page.onLogin.call(context);
      const departedData = structuredClone(context.data);
      page.onUnload.call(context);
      finish(true);
      await pending;
      expect(context.data).toEqual(departedData);
      expect(navigateBack).not.toHaveBeenCalled();
      expect(switchTab).not.toHaveBeenCalled();
      expect(wechatAvatar.upload).not.toHaveBeenCalled();
    },
  );

  it('removes an avatar upload completed after departure without changing the profile', async () => {
    const { page, context, wechatAvatar, progress, navigateBack } = await load();
    let finish: (fileID: string) => void = () => undefined;
    wechatAvatar.upload.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/avatar.png' } });
    await vi.waitFor(() => expect(wechatAvatar.upload).toHaveBeenCalledOnce());
    page.onUnload.call(context);
    finish('cloud://test/unused.jpg');
    await pending;
    expect(wechatAvatar.remove).toHaveBeenCalledWith('cloud://test/unused.jpg');
    expect(progress.updatePreferences).not.toHaveBeenCalled();
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('finishes a submitted avatar sync without navigating a departed page', async () => {
    const { page, context, cloudSync, navigateBack } = await load();
    let finish: () => void = () => undefined;
    cloudSync.process.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/avatar.png' } });
    await vi.waitFor(() => expect(cloudSync.process).toHaveBeenCalledOnce());
    page.onUnload.call(context);
    finish();
    await pending;
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('keeps a completed account login when leaving optional avatar setup', async () => {
    const { page, context, auth, navigateBack } = await load({
      status: 'authenticated',
      preference: 'account',
      temporaryGuest: false,
      notice: null,
    });
    page.onGuest.call(context);
    expect(auth.chooseGuest).not.toHaveBeenCalled();
    expect(auth.useTemporaryGuest).not.toHaveBeenCalled();
    expect(navigateBack).toHaveBeenCalledOnce();
  });

  it('registers home first and account data as an auxiliary subpackage', async () => {
    const config = await import('../miniprogram/app.json');
    expect(config.default.pages[0]).toBe('pages/home/index');
    const auxiliaryPackage = config.default.subPackages.find(
      (subpackage) => subpackage.root === 'packages/auxiliary',
    );
    expect(auxiliaryPackage?.pages).toContain('pages/account-data/index');
  });

  it('shows the confirmed login copy and persists an explicit guest selection', async () => {
    const { page, context, auth, navigateBack } = await load();
    await page.onLoad.call(context, { mode: 'login' });
    expect(context.data.phase).toBe('choice');
    expect(context.data.message).toBe('');
    const markup = readFileSync(
      resolve(import.meta.dirname, '../miniprogram/pages/account-entry/index.wxml'),
      'utf8',
    );
    for (const copy of [
      '登录粮安题库',
      '使用同一微信登录，会自动恢复学习记录、错题、收藏和设置。',
      '微信登录',
      '使用微信头像（可选）',
      '暂不登录',
      '正在恢复云端学习记录…',
      '重新登录',
      '以游客身份进入',
    ]) {
      expect(markup).toContain(copy);
    }
    page.onGuest.call(context);
    expect(auth.chooseGuest).toHaveBeenCalledOnce();
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('switches home after route completion for a missing-mode visit from a non-home page', async () => {
    const { page, context, auth, switchTab } = await load();
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/library/index' }]);
    await page.onLoad.call(context, {});
    expect(auth.initialize).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
    expect(switchTab).not.toHaveBeenCalled();
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/library/index' }, context]);
    expect(switchTab).not.toHaveBeenCalled();
    page.onRouteDone.call(context);
    expect(switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/home/index' }));
    page.onRouteDone.call(context);
    expect(switchTab).toHaveBeenCalledOnce();
  });

  it('returns back for a missing-mode visit reached directly from home', async () => {
    const { page, context, navigateBack, switchTab } = await load();

    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/home/index' }, context]);
    await page.onLoad.call(context, {});
    expect(navigateBack).not.toHaveBeenCalled();
    page.onRouteDone.call(context);

    expect(navigateBack).toHaveBeenCalledOnce();
    expect(switchTab).not.toHaveBeenCalled();
  });

  it('does not navigate an automatic return when the page unloads before ready', async () => {
    const { page, context, navigateBack, switchTab } = await load();

    await page.onLoad.call(context, {});
    page.onUnload.call(context);
    page.onRouteDone.call(context);

    expect(navigateBack).not.toHaveBeenCalled();
    expect(switchTab).not.toHaveBeenCalled();
  });

  it('only initializes and shows choices for an explicit login visit', async () => {
    const { page, context, auth, navigateBack, switchTab, wechatAvatar } = await load({
      status: 'guest',
      preference: 'guest',
      temporaryGuest: false,
      notice: null,
    });
    await page.onLoad.call(context, { mode: 'login' });
    expect(context.data.phase).toBe('choice');
    expect(auth.initialize).toHaveBeenCalledOnce();
    expect(auth.login).not.toHaveBeenCalled();
    expect(wechatAvatar.upload).not.toHaveBeenCalled();
    expect(navigateBack).not.toHaveBeenCalled();
    expect(switchTab).not.toHaveBeenCalled();
  });

  it('silently restores an authenticated account without displaying login choices', async () => {
    const { page, context, auth, navigateBack } = await load({
      status: 'authenticated',
      preference: 'account',
      temporaryGuest: false,
      notice: null,
    });

    vi.stubGlobal('getCurrentPages', () => [{}]);
    await page.onLoad.call(context, { mode: 'login' });
    expect(navigateBack).not.toHaveBeenCalled();
    vi.stubGlobal('getCurrentPages', () => [context]);
    expect(navigateBack).not.toHaveBeenCalled();
    page.onRouteDone.call(context);

    expect(auth.initialize).toHaveBeenCalledOnce();
    expect(auth.login).not.toHaveBeenCalled();
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('returns after a late authentication recovery when routing is already complete', async () => {
    let resolveInitialize!: (state: {
      status: 'authenticated';
      preference: 'account';
      temporaryGuest: boolean;
      notice: null;
    }) => void;
    const { page, context, auth, navigateBack } = await load();
    auth.initialize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInitialize = resolve;
        }),
    );

    const loading = page.onLoad.call(context, { mode: 'login' });
    page.onRouteDone.call(context);
    expect(navigateBack).not.toHaveBeenCalled();
    resolveInitialize({
      status: 'authenticated',
      preference: 'account',
      temporaryGuest: false,
      notice: null,
    });
    await loading;

    expect(navigateBack).toHaveBeenCalledOnce();
  });

  it('shows a first-run recovery failure without retrying authorization', async () => {
    const { page, context, auth, navigateBack } = await load({
      status: 'error',
      preference: 'undecided',
      temporaryGuest: false,
      notice: '恢复失败',
    });

    await page.onLoad.call(context, { mode: 'login' });

    expect(context.data.phase).toBe('error');
    expect(auth.chooseGuest).not.toHaveBeenCalled();
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.retry).not.toHaveBeenCalled();
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('keeps a first-login failure in guest mode instead of retrying or blocking the app', async () => {
    const { page, context, auth, navigateBack } = await load();
    auth.login.mockResolvedValueOnce(false);

    await page.onLogin.call(context);

    expect(auth.chooseGuest).toHaveBeenCalledOnce();
    expect(auth.retry).not.toHaveBeenCalled();
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('ignores an initialization result after the user leaves the explicit login page', async () => {
    let resolveInitialize!: () => void;
    const { page, context, auth, navigateBack } = await load();
    auth.initialize.mockImplementationOnce(
      () =>
        new Promise<typeof auth.getState extends () => infer State ? State : never>((resolve) => {
          resolveInitialize = () =>
            resolve({
              status: 'authenticated',
              preference: 'account',
              temporaryGuest: false,
              notice: null,
            });
        }),
    );

    const loading = page.onLoad.call(context, { mode: 'login' });
    page.onUnload.call(context);
    resolveInitialize();
    await loading;

    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('falls back to the home tab when returning to the previous page fails', async () => {
    const { page, context, navigateBack, switchTab } = await load();

    page.onGuest.call(context);
    const callbacks = navigateBack.mock.calls[0]?.[0] as
      { fail?: (result: Record<string, never>) => void } | undefined;
    callbacks?.fail?.({});

    expect(switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/home/index' }));
  });

  it('guards repeated login and provides retry plus temporary guest after failure', async () => {
    const { page, context, auth } = await load({
      status: 'error',
      preference: 'account',
      temporaryGuest: false,
      notice: '失败',
    });
    await page.onLoad.call(context, { mode: 'login' });
    const login = page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/avatar.png' } });
    void page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/avatar.png' } });
    await login;
    expect(auth.login).toHaveBeenCalledOnce();
    context.data.busy = false;
    await page.onRetry.call(context);
    expect(auth.retry).toHaveBeenCalledOnce();
    context.data.busy = false;
    page.onTemporaryGuest.call(context);
    expect(auth.useTemporaryGuest).not.toHaveBeenCalled();
  });

  it('logs in before uploading the explicitly selected avatar and returns to the prior page', async () => {
    const { page, context, auth, wechatAvatar, progress, navigateBack } = await load();

    await page.onChooseAvatar.call(context, {});
    expect(auth.login).not.toHaveBeenCalled();
    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/wechat.webp' } });

    expect(auth.login).toHaveBeenCalledOnce();
    expect(wechatAvatar.upload).toHaveBeenCalledWith(
      '/tmp/wechat.webp',
      `account-avatars/${'a'.repeat(64)}`,
    );
    expect(progress.updatePreferences).toHaveBeenCalledWith({
      avatarUrl: `cloud://cloud1-d2gglad830c91db10/account-avatars/${'a'.repeat(64)}/nonce0001.jpg`,
    });
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('allows selecting an avatar again when upload fails', async () => {
    const { page, context, wechatAvatar, navigateBack } = await load();
    wechatAvatar.upload.mockRejectedValueOnce(new Error('upload failed'));

    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/wechat.png' } });

    expect(context.data).toMatchObject({ busy: false, phase: 'choice' });
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('blocks avatar upload while retaining the completed account login when the service is unavailable', async () => {
    const { page, context, auth, cloudSync, wechatAvatar, navigateBack } = await load();
    cloudSync.getAvatarUploadPathPrefix.mockReturnValue(null);

    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/wechat.png' } });

    expect(auth.login).toHaveBeenCalledOnce();
    expect(wechatAvatar.upload).not.toHaveBeenCalled();
    expect(context.data).toMatchObject({
      busy: false,
      phase: 'choice',
      message: '头像服务正在升级，请稍后再试。',
    });
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('uploads the original avatar after a failed first login succeeds on retry', async () => {
    const state = {
      status: 'error' as const,
      preference: 'account' as const,
      temporaryGuest: false,
      notice: '失败',
    };
    const { page, context, auth, wechatAvatar, navigateBack } = await load(state);
    auth.login.mockResolvedValueOnce(false);
    auth.retry.mockResolvedValueOnce(true);

    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/selected.jpeg' } });
    await page.onRetry.call(context);

    expect(auth.retry).toHaveBeenCalledOnce();
    expect(wechatAvatar.upload).toHaveBeenCalledWith(
      '/tmp/selected.jpeg',
      `account-avatars/${'a'.repeat(64)}`,
    );
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('only uploads when an authenticated user selects an avatar again', async () => {
    const { page, context, auth, wechatAvatar } = await load({
      status: 'authenticated',
      preference: 'account',
      temporaryGuest: false,
      notice: null,
    });

    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/new-avatar.png' } });

    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.retry).not.toHaveBeenCalled();
    expect(wechatAvatar.upload).toHaveBeenCalledWith(
      '/tmp/new-avatar.png',
      `account-avatars/${'a'.repeat(64)}`,
    );
  });

  it('returns to the previous page when avatar selection is cancelled or rejected', async () => {
    const { page, context, auth, wechatAvatar, navigateBack } = await load();

    await page.onChooseAvatar.call(context, {});
    page.onAvatarRejected.call(context);

    expect(auth.login).not.toHaveBeenCalled();
    expect(wechatAvatar.upload).not.toHaveBeenCalled();
    expect(navigateBack).toHaveBeenCalledOnce();
  });

  it('uses one return flow when guest entry handlers run in the same tick', async () => {
    const { page, context, auth, navigateBack } = await load({
      status: 'guest',
      preference: 'account',
      temporaryGuest: false,
      notice: null,
    });

    page.onGuest.call(context);
    page.onTemporaryGuest.call(context);
    page.onAvatarRejected.call(context);

    expect(auth.useTemporaryGuest).toHaveBeenCalledOnce();
    expect(navigateBack).toHaveBeenCalledOnce();
  });

  it('does not route home when a late return failure arrives after unload', async () => {
    const { page, context, navigateBack, switchTab } = await load();

    page.onGuest.call(context);
    const callbacks = navigateBack.mock.calls[0]?.[0] as
      { fail?: (result: Record<string, never>) => void } | undefined;
    page.onUnload.call(context);
    callbacks?.fail?.({});

    expect(switchTab).not.toHaveBeenCalled();
  });

  it('does not route home when a late return failure belongs to a newer page', async () => {
    const { page, context, navigateBack, switchTab } = await load();

    page.onGuest.call(context);
    const callbacks = navigateBack.mock.calls[0]?.[0] as
      { fail?: (result: Record<string, never>) => void } | undefined;
    vi.stubGlobal('getCurrentPages', () => [{}]);
    callbacks?.fail?.({});

    expect(switchTab).not.toHaveBeenCalled();
  });

  it('releases a return lock when the navigation API never settles', async () => {
    vi.useFakeTimers();
    const { page, context, auth, navigateBack } = await load({
      status: 'guest',
      preference: 'account',
      temporaryGuest: false,
      notice: null,
    });

    page.onGuest.call(context);
    await vi.advanceTimersByTimeAsync(3000);
    page.onGuest.call(context);

    expect(auth.useTemporaryGuest).toHaveBeenCalledTimes(2);
    expect(navigateBack).toHaveBeenCalledTimes(2);
  });

  it('ignores an old return failure after its watchdog permits another attempt', async () => {
    vi.useFakeTimers();
    const { page, context, navigateBack, switchTab } = await load();

    page.onGuest.call(context);
    const first = navigateBack.mock.calls[0]?.[0] as
      { fail?: (result: Record<string, never>) => void } | undefined;
    await vi.advanceTimersByTimeAsync(3000);
    page.onGuest.call(context);
    const second = navigateBack.mock.calls[1]?.[0] as
      { fail?: (result: Record<string, never>) => void } | undefined;
    first?.fail?.({});

    expect(switchTab).not.toHaveBeenCalled();
    second?.fail?.({});
    expect(switchTab).toHaveBeenCalledOnce();
  });

  it('does not let an old return rejection release a newer attempt', async () => {
    vi.useFakeTimers();
    const { page, context, navigateBack, switchTab } = await load();
    let rejectFirst: (error: Error) => void = () => undefined;
    navigateBack.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    );

    page.onGuest.call(context);
    await vi.advanceTimersByTimeAsync(3000);
    page.onGuest.call(context);
    const second = navigateBack.mock.calls[1]?.[0] as
      { fail?: (result: Record<string, never>) => void } | undefined;
    rejectFirst(new Error('late failure'));
    await Promise.resolve();
    second?.fail?.({});

    expect(switchTab).toHaveBeenCalledOnce();
  });

  it('falls back after a synchronous return failure and permits a new attempt if home fails', async () => {
    const { page, context, navigateBack, switchTab } = await load();
    navigateBack.mockImplementationOnce(() => {
      throw new Error('return failed');
    });
    switchTab.mockImplementationOnce(() => {
      throw new Error('home failed');
    });

    page.onGuest.call(context);
    page.onGuest.call(context);

    expect(navigateBack).toHaveBeenCalledTimes(2);
    expect(switchTab).toHaveBeenCalledOnce();
  });

  it('logs in without requesting an avatar for the normal login button', async () => {
    const { page, context, auth, wechatAvatar, navigateBack } = await load();
    await page.onLogin.call(context);

    expect(auth.login).toHaveBeenCalledOnce();
    expect(wechatAvatar.upload).not.toHaveBeenCalled();
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('cleans an unbound upload after a recovered revision conflict', async () => {
    const { page, context, wechatAvatar, cloudSync, progress, navigateBack } = await load();
    cloudSync.getConfirmedAvatarUrl.mockReturnValue('');
    cloudSync.getState.mockReturnValue({ status: 'conflict', pendingCount: 0 });
    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/a.jpg' } });
    const fileID = wechatAvatar.upload.mock.results[0]?.value;
    await Promise.resolve(fileID);
    expect(wechatAvatar.remove).toHaveBeenCalledOnce();
    expect(progress.updatePreferences).toHaveBeenCalledOnce();
    expect(progress.refreshAccountSnapshot).toHaveBeenCalledOnce();
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('keeps a pending upload and enters home while sync remains retryable', async () => {
    const { page, context, wechatAvatar, cloudSync, navigateBack } = await load();
    cloudSync.getConfirmedAvatarUrl.mockReturnValue('');
    cloudSync.getState.mockReturnValue({ status: 'failed', pendingCount: 1 });
    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/a.jpg' } });
    expect(wechatAvatar.remove).not.toHaveBeenCalled();
    expect(navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  });

  it('confirms a synchronized upload and cleans a replaced controlled avatar', async () => {
    const { page, context, wechatAvatar, cloudSync, progress } = await load();
    const oldAvatar = `cloud://cloud1-d2gglad830c91db10/account-avatars/${'b'.repeat(64)}/nonce0001.jpg`;
    const uploaded = `cloud://cloud1-d2gglad830c91db10/account-avatars/${'a'.repeat(64)}/nonce0001.jpg`;
    progress.getPreferences.mockReturnValue({ avatarUrl: oldAvatar });
    cloudSync.getConfirmedAvatarUrl.mockReturnValue(uploaded);
    wechatAvatar.isControlled.mockReturnValue(true);
    await page.onChooseAvatar.call(context, { detail: { avatarUrl: '/tmp/a.jpg' } });
    expect(wechatAvatar.confirm).toHaveBeenCalledWith(uploaded);
    expect(wechatAvatar.remove).toHaveBeenCalledWith(oldAvatar);
  });

  it('uses chooseAvatar instead of the deprecated profile flow', () => {
    const markup = readFileSync(
      resolve(import.meta.dirname, '../miniprogram/pages/account-entry/index.wxml'),
      'utf8',
    );
    expect(markup).toContain('open-type="chooseAvatar"');
    expect(markup).toContain('bindchooseavatar="onChooseAvatar"');
  });
});
