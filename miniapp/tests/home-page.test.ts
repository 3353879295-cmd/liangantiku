import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CertificateKey } from '../miniprogram/types/domain';

interface HomePageData {
  selectedKey: CertificateKey;
  certificate: { questionCountText: string; canStart: boolean };
  loading: boolean;
  loadError: boolean;
  hasResume: boolean;
  hasResult: boolean;
}

interface HomePageContext {
  data: HomePageData;
  setData(update: Partial<HomePageData>): void;
  showNavigationError(error: unknown): void;
  openStartRoute(route: string): Promise<void>;
}

interface HomePageDefinition {
  data: HomePageData;
  loadCertificate(this: HomePageContext, key: CertificateKey): Promise<void>;
  onShow(this: HomePageContext): void;
  onHide(this: HomePageContext): void;
  onUnload(this: HomePageContext): void;
  onOpenMember(this: HomePageContext): Promise<void>;
  onResume(this: HomePageContext): Promise<void>;
  openStartRoute(this: HomePageContext, route: string): Promise<void>;
  showNavigationError(this: HomePageContext, error: unknown): void;
}

const loadHomePage = async () => {
  vi.resetModules();
  vi.doUnmock('../miniprogram/services/app-services');
  const values = new Map<string, unknown>();
  let definition: HomePageDefinition | undefined;
  const navigateTo = vi.fn<(options: { success?: () => void; fail?: () => void }) => void>();
  const showToast = vi.fn();

  vi.stubGlobal('Page', (value: HomePageDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn((key: string) => values.get(key) ?? ''),
    setStorageSync: vi.fn((key: string, value: unknown) => values.set(key, value)),
    removeStorageSync: vi.fn((key: string) => values.delete(key)),
    navigateTo,
    showToast,
  });

  await import('../miniprogram/pages/home/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  if (!definition) throw new Error('home Page was not registered');

  const registered = definition;
  const context: HomePageContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    showNavigationError(error) {
      registered.showNavigationError.call(this, error);
    },
    openStartRoute(route) {
      return registered.openStartRoute.call(this, route);
    },
  };

  return { appServices, context, definition: registered, navigateTo, showToast, values };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('home page certificate loading', () => {
  it('loads the selected certificate question count', async () => {
    const { appServices, context, definition } = await loadHomePage();
    vi.spyOn(appServices.questions, 'count').mockResolvedValue(1);
    const list = vi.spyOn(appServices.questions, 'list');
    await expect(definition.loadCertificate.call(context, '4-02-06-01:5')).resolves.toBeUndefined();

    expect(context.data.loading).toBe(false);
    expect(context.data.selectedKey).toBe('4-02-06-01:5');
    expect(context.data.certificate.questionCountText).toBe('1 题');
    expect(list).not.toHaveBeenCalled();
  });

  it('keeps the latest count when certificate requests finish out of order', async () => {
    const { appServices, context, definition } = await loadHomePage();
    let finishOld!: (count: number) => void;
    vi.spyOn(appServices.questions, 'count')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockResolvedValueOnce(200);
    const old = definition.loadCertificate.call(context, '4-02-06-01:5');
    await definition.loadCertificate.call(context, '4-08-05-01:4');
    finishOld(1);
    await old;
    expect(context.data.selectedKey).toBe('4-08-05-01:4');
    expect(context.data.certificate.questionCountText).toBe('200 题');
  });

  it('offers recovery after a failed count and clears the error on retry', async () => {
    const { appServices, context, definition, showToast } = await loadHomePage();
    vi.spyOn(appServices.questions, 'count')
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(42);
    await definition.loadCertificate.call(context, '4-02-06-01:5');
    expect(context.data.loadError).toBe(true);
    await definition.openStartRoute.call(context, '/pages/library/index');
    expect(showToast).toHaveBeenLastCalledWith({ title: '题库读取失败，请点击重试', icon: 'none' });
    await definition.loadCertificate.call(context, '4-02-06-01:5');
    expect(context.data.loadError).toBe(false);
    expect(context.data.certificate.canStart).toBe(true);
  });

  it('keeps the home page visible and refreshes it after account recovery changes the cache', async () => {
    vi.resetModules();
    let definition: HomePageDefinition | undefined;
    const authState: {
      status: 'checking' | 'authenticated';
      preference: 'account';
      temporaryGuest: boolean;
      notice: null;
    } = {
      status: 'checking',
      preference: 'account' as const,
      temporaryGuest: false,
      notice: null,
    };
    let finishRecovery!: () => void;
    const preferences = {
      nickname: '小麦',
      avatarUrl: '',
      selectedCertificateKey: '4-02-06-01:5' as CertificateKey,
    };
    const initialize = vi.fn(
      () =>
        new Promise((resolve) => {
          finishRecovery = () => {
            authState.status = 'authenticated';
            preferences.selectedCertificateKey = '4-02-06-01:4';
            resolve({ ...authState });
          };
        }),
    );
    vi.doMock('../miniprogram/services/app-services', () => ({
      appServices: {
        auth: { getState: () => ({ ...authState }), initialize },
        progress: {
          getPreferences: () => ({ ...preferences }),
          getPreparationDays: () => 1,
          restoreSession: () =>
            authState.status === 'authenticated'
              ? { status: 'active', currentIndex: 0, questionIds: ['RECOVERY-Q1'] }
              : null,
        },
        questions: { count: vi.fn(() => Promise.resolve(1)) },
        membership: { getStatus: vi.fn(() => Promise.resolve({})) },
      },
      localDateKey: () => '2026-09-02',
    }));
    vi.stubGlobal('getApp', () => ({ globalData: {} }));
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn(() => ''),
      showModal: vi.fn(),
      showToast: vi.fn(),
      navigateTo: vi.fn(),
    });
    vi.stubGlobal('Page', (value: HomePageDefinition) => {
      definition = value;
    });

    await import('../miniprogram/pages/home/index');
    if (!definition) throw new Error('home Page was not registered');
    const registered = definition;
    const context: HomePageContext & {
      getTabBar(): undefined;
      loadCertificate(key: CertificateKey): Promise<void>;
      loadMembership(): Promise<void>;
      onShow(): void;
    } = {
      data: structuredClone(registered.data),
      getTabBar: () => undefined,
      loadCertificate(key) {
        return registered.loadCertificate.call(this, key);
      },
      loadMembership: () => Promise.resolve(),
      onShow() {
        registered.onShow.call(this);
      },
      showNavigationError() {},
      openStartRoute: () => Promise.resolve(),
      setData(update) {
        Object.assign(this.data, update);
      },
    };

    registered.onShow.call(context);
    expect(context.data.selectedKey).toBe('4-02-06-01:5');
    finishRecovery();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.data.selectedKey).toBe('4-02-06-01:4');
    expect(context.data.hasResume).toBe(true);
  });
});

describe('home page navigation', () => {
  it('opens the unrecorded result shown on the resume card', async () => {
    const { context, definition, navigateTo } = await loadHomePage();
    context.data.hasResult = true;
    navigateTo.mockImplementation((options) => options.success?.());
    await definition.onResume.call(context);
    expect(navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/pages/report/index' }),
    );
  });

  it('describes loading accurately and does not navigate before the bank is ready', async () => {
    const { context, definition, navigateTo, showToast } = await loadHomePage();
    await definition.openStartRoute.call(context, '/pages/library/index');
    expect(navigateTo).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith({ title: '题库正在加载，请稍候', icon: 'none' });
  });
  it('sends a pending random start directly to resume without an allowance precheck', async () => {
    const { appServices, context, definition, navigateTo, values } = await loadHomePage();
    values.set('membership.pending-random.v1', {
      key: 'pending-key',
      id: 'pending-id',
      questionIds: ['Q1'],
      now: 1,
      answerRevealMode: 'immediate',
    });
    navigateTo.mockImplementation((options) => options.success?.());
    const permission = vi.spyOn(appServices.membership, 'checkPermission');

    await (
      definition as unknown as { onAction(this: HomePageContext, event: unknown): Promise<void> }
    ).onAction.call(context, { currentTarget: { dataset: { id: 'random' } } });

    expect(navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/pages/practice/index?resume=1' }),
    );
    expect(permission).not.toHaveBeenCalled();
  });

  it('releases a failed member navigation and shows a retry message', async () => {
    const { context, definition, navigateTo, showToast } = await loadHomePage();
    navigateTo
      .mockImplementationOnce((options) => options.fail?.())
      .mockImplementationOnce((options) => options.success?.());

    await definition.onOpenMember.call(context);

    expect(showToast).toHaveBeenCalledWith({ title: '页面跳转失败，请重试', icon: 'none' });
    await definition.onOpenMember.call(context);
    expect(navigateTo).toHaveBeenCalledTimes(2);
  });

  it('releases a navigation with no callback through the timeout fallback', async () => {
    vi.useFakeTimers();
    const { context, definition, showToast } = await loadHomePage();
    const navigation = definition.onOpenMember.call(context);

    await vi.advanceTimersByTimeAsync(5000);
    await navigation;

    expect(showToast).toHaveBeenCalledWith({ title: '页面跳转超时，请重试', icon: 'none' });
  });
});
