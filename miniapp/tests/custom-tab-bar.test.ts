import { afterEach, describe, expect, it, vi } from 'vitest';

interface TabBarData {
  value: string;
  tabs: unknown[];
}

interface TabBarContext {
  data: TabBarData;
  setData(update: Partial<TabBarData>): void;
}

interface SwitchOptions {
  url: string;
  success?: () => void;
  fail?: () => void;
  complete?: () => void;
}

interface TabBarDefinition {
  data: TabBarData;
  lifetimes?: { attached?(this: TabBarContext): void; detached?(this: TabBarContext): void };
  pageLifetimes?: { show?(this: TabBarContext): void };
  methods: {
    onTabTap(this: TabBarContext, event: { currentTarget: { dataset: { value?: string } } }): void;
  };
}

interface TabPageContext {
  getTabBar(): TabBarContext;
}

interface TabPageDefinition {
  onShow?(this: TabPageContext): void;
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const contextFor = (definition: TabBarDefinition): TabBarContext => ({
  data: structuredClone(definition.data),
  setData(update) {
    Object.assign(this.data, update);
  },
});

const tap = (definition: TabBarDefinition, context: TabBarContext, value: string): void => {
  definition.methods.onTabTap.call(context, { currentTarget: { dataset: { value } } });
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('custom tab bar route synchronization', () => {
  it('uses the real route to repair a stale same-tab highlighter without navigating', async () => {
    let definition: TabBarDefinition | undefined;
    const switchTab = vi.fn();
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/home/index' }]);
    vi.stubGlobal('wx', { switchTab });

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const context = contextFor(definition);
    context.data.value = '/pages/profile/index';
    definition.lifetimes?.attached?.call(context);
    tap(definition, context, '/pages/home/index');

    expect(context.data.value).toBe('/pages/home/index');
    expect(switchTab).not.toHaveBeenCalled();
  });

  it('releases a failed transition so the same target can be retried', async () => {
    let definition: TabBarDefinition | undefined;
    const switchTab = vi.fn((options: SwitchOptions) => options.fail?.());
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/home/index' }]);
    vi.stubGlobal('wx', { switchTab });

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const context = contextFor(definition);
    definition.lifetimes?.attached?.call(context);
    tap(definition, context, '/pages/practical/index');
    tap(definition, context, '/pages/practical/index');

    expect(switchTab).toHaveBeenCalledTimes(2);
    expect(context.data.value).toBe('/pages/home/index');
  });

  it('keeps only the final target during fast taps and starts it after the active transition settles', async () => {
    let definition: TabBarDefinition | undefined;
    let route = 'pages/home/index';
    const requests: SwitchOptions[] = [];
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route }]);
    vi.stubGlobal('wx', { switchTab: vi.fn((options: SwitchOptions) => requests.push(options)) });

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const context = contextFor(definition);
    definition.lifetimes?.attached?.call(context);
    tap(definition, context, '/pages/practical/index');
    tap(definition, context, '/pages/profile/index');
    tap(definition, context, '/pages/practical/index');
    expect(requests.map(({ url }) => url)).toEqual(['/pages/practical/index']);

    route = 'pages/practical/index';
    requests[0]?.success?.();
    requests[0]?.complete?.();
    expect(requests.map(({ url }) => url)).toEqual(['/pages/practical/index']);
    expect(context.data.value).toBe('/pages/practical/index');
  });

  it('replaces an older queued target when the user taps the real current tab during a transition', async () => {
    let definition: TabBarDefinition | undefined;
    let route = 'pages/home/index';
    const requests: SwitchOptions[] = [];
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route }]);
    vi.stubGlobal('wx', { switchTab: vi.fn((options: SwitchOptions) => requests.push(options)) });

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const context = contextFor(definition);
    definition.lifetimes?.attached?.call(context);
    tap(definition, context, '/pages/practical/index');
    tap(definition, context, '/pages/profile/index');
    tap(definition, context, '/pages/home/index');

    route = 'pages/practical/index';
    requests[0]?.complete?.();

    expect(requests.map(({ url }) => url)).toEqual(['/pages/practical/index', '/pages/home/index']);
  });

  it('shares one coordinator across instances and ignores detached instances', async () => {
    let definition: TabBarDefinition | undefined;
    const requests: SwitchOptions[] = [];
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/home/index' }]);
    vi.stubGlobal('wx', { switchTab: vi.fn((options: SwitchOptions) => requests.push(options)) });

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const first = contextFor(definition);
    const second = contextFor(definition);
    const detached = contextFor(definition);
    definition.lifetimes?.attached?.call(first);
    definition.lifetimes?.attached?.call(second);
    definition.lifetimes?.attached?.call(detached);
    definition.lifetimes?.detached?.call(detached);
    tap(definition, first, '/pages/profile/index');

    expect(requests).toHaveLength(1);
    expect(first.data.value).toBe('/pages/profile/index');
    expect(second.data.value).toBe('/pages/profile/index');
    expect(detached.data.value).toBe('/pages/home/index');
  });

  it('recovers from a missing callback and ignores a late callback from that old request', async () => {
    vi.useFakeTimers();
    let definition: TabBarDefinition | undefined;
    let route = 'pages/home/index';
    const requests: SwitchOptions[] = [];
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route }]);
    vi.stubGlobal('wx', { switchTab: vi.fn((options: SwitchOptions) => requests.push(options)) });

    const { TAB_SWITCH_WATCHDOG_MS } = await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const context = contextFor(definition);
    definition.lifetimes?.attached?.call(context);
    tap(definition, context, '/pages/practical/index');
    tap(definition, context, '/pages/profile/index');
    await vi.advanceTimersByTimeAsync(TAB_SWITCH_WATCHDOG_MS);
    expect(requests.map(({ url }) => url)).toEqual([
      '/pages/practical/index',
      '/pages/profile/index',
    ]);

    route = 'pages/profile/index';
    requests[0]?.success?.();
    expect(requests).toHaveLength(2);
    requests[1]?.complete?.();
    expect(context.data.value).toBe('/pages/profile/index');
  });

  it('settles a rejected Promise result and synchronizes the route on page show', async () => {
    let definition: TabBarDefinition | undefined;
    let route = 'pages/home/index';
    const switchTab = vi.fn(() => Promise.reject(new Error('native rejection')));
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route }]);
    vi.stubGlobal('wx', { switchTab });

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const context = contextFor(definition);
    definition.lifetimes?.attached?.call(context);
    tap(definition, context, '/pages/practical/index');
    await flush();
    tap(definition, context, '/pages/practical/index');
    expect(switchTab).toHaveBeenCalledTimes(2);

    route = 'pages/profile/index';
    definition.pageLifetimes?.show?.call(context);
    expect(context.data.value).toBe('/pages/profile/index');
  });

  it('settles a synchronous native exception so a later tap is not locked out', async () => {
    let definition: TabBarDefinition | undefined;
    const switchTab = vi.fn(() => {
      throw new Error('native exception');
    });
    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route: 'pages/home/index' }]);
    vi.stubGlobal('wx', { switchTab });

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');
    const context = contextFor(definition);
    definition.lifetimes?.attached?.call(context);
    tap(definition, context, '/pages/practical/index');
    tap(definition, context, '/pages/practical/index');

    expect(switchTab).toHaveBeenCalledTimes(2);
    expect(context.data.value).toBe('/pages/home/index');
  });

  it('keeps destination page lifecycle synchronization for the practical tab', async () => {
    let definition: TabPageDefinition | undefined;
    const tabBar: TabBarContext = {
      data: { value: '/pages/home/index', tabs: [] },
      setData(update) {
        Object.assign(this.data, update);
      },
    };
    vi.stubGlobal('Page', (value: TabPageDefinition) => {
      definition = value;
    });

    await import('../miniprogram/pages/practical/index');
    if (!definition) throw new Error('practical Page was not registered');
    definition.onShow?.call({ getTabBar: () => tabBar });

    expect(tabBar.data.value).toBe('/pages/practical/index');
  });

  it('keeps destination page lifecycle synchronization for the profile tab', async () => {
    let definition: TabPageDefinition | undefined;
    const tabBar: TabBarContext = {
      data: { value: '/pages/home/index', tabs: [] },
      setData(update) {
        Object.assign(this.data, update);
      },
    };
    vi.stubGlobal('Page', (value: TabPageDefinition) => {
      definition = value;
    });
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn(() => ''),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });

    await import('../miniprogram/pages/profile/index');
    if (!definition) throw new Error('profile Page was not registered');
    const profilePage = {
      ...definition,
      getTabBar: () => tabBar,
      loadMembership: vi.fn(),
      setData: vi.fn(),
    };
    definition.onShow?.call(profilePage);

    expect(tabBar.data.value).toBe('/pages/profile/index');
  });

  it('keeps destination page lifecycle synchronization for the home tab', async () => {
    let definition: TabPageDefinition | undefined;
    const tabBar: TabBarContext = {
      data: { value: '/pages/profile/index', tabs: [] },
      setData(update) {
        Object.assign(this.data, update);
      },
    };
    vi.stubGlobal('Page', (value: TabPageDefinition) => {
      definition = value;
    });
    vi.stubGlobal('wx', {
      getStorageSync: vi.fn(() => ''),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
    });
    vi.stubGlobal('getApp', () => ({
      globalData: { recoveryNotice: '', selectedCertificateKey: '4-02-06-01:5' },
    }));

    await import('../miniprogram/pages/home/index');
    if (!definition) throw new Error('home Page was not registered');
    const homePage = {
      ...definition,
      data: { randomStarting: false },
      getTabBar: () => tabBar,
      loadCertificate: vi.fn(),
      loadMembership: vi.fn(),
      setData: vi.fn(),
    };
    definition.onShow?.call(homePage);

    expect(tabBar.data.value).toBe('/pages/home/index');
  });
});
