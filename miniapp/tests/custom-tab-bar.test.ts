import { afterEach, describe, expect, it, vi } from 'vitest';

interface TabBarData {
  value: string;
}

interface TabBarContext {
  data: TabBarData;
  setData(update: Partial<TabBarData>): void;
}

interface TabBarDefinition {
  data: TabBarData;
  lifetimes?: {
    attached?(this: TabBarContext): void;
  };
  pageLifetimes?: {
    show?(this: TabBarContext): void;
  };
}

interface TabPageContext {
  getTabBar(): TabBarContext;
}

interface TabPageDefinition {
  onShow?(this: TabPageContext): void;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('custom tab bar route synchronization', () => {
  it('updates the active tab whenever an existing tab page is shown again', async () => {
    let definition: TabBarDefinition | undefined;
    let route = 'pages/home/index';

    vi.stubGlobal('Component', (value: TabBarDefinition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => [{ route }]);

    await import('../miniprogram/custom-tab-bar/index');
    if (!definition) throw new Error('custom tab bar was not registered');

    const registered = definition;
    const context: TabBarContext = {
      data: structuredClone(registered.data),
      setData(update) {
        Object.assign(this.data, update);
      },
    };

    registered.lifetimes?.attached?.call(context);
    expect(context.data.value).toBe('/pages/home/index');

    route = 'pages/practical/index';
    registered.pageLifetimes?.show?.call(context);

    expect(context.data.value).toBe('/pages/practical/index');
  });

  it('selects the practical tab from the destination page when it is shown', async () => {
    let definition: TabPageDefinition | undefined;
    const tabBar: TabBarContext = {
      data: { value: '/pages/home/index' },
      setData(update) {
        Object.assign(this.data, update);
      },
    };

    vi.stubGlobal('Page', (value: TabPageDefinition) => {
      definition = value;
    });

    await import('../miniprogram/pages/practical/index');
    if (!definition) throw new Error('practical Page was not registered');

    const registered = definition;
    expect(typeof registered.onShow).toBe('function');
    registered.onShow?.call({ getTabBar: () => tabBar });

    expect(tabBar.data.value).toBe('/pages/practical/index');
  });

  it('selects the profile tab from the destination page when it is shown', async () => {
    let definition: TabPageDefinition | undefined;
    const tabBar: TabBarContext = {
      data: { value: '/pages/home/index' },
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

    const registered = definition;
    expect(typeof registered.onShow).toBe('function');
    registered.onShow?.call({
      getTabBar: () => tabBar,
      setData: vi.fn(),
    } as TabPageContext);

    expect(tabBar.data.value).toBe('/pages/profile/index');
  });

  it('selects the home tab when returning to the home page', async () => {
    let definition: TabPageDefinition | undefined;
    const tabBar: TabBarContext = {
      data: { value: '/pages/profile/index' },
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
      globalData: {
        recoveryNotice: '',
        selectedCertificateKey: '4-02-06-01:5',
      },
    }));

    await import('../miniprogram/pages/home/index');
    if (!definition) throw new Error('home Page was not registered');

    const registered = definition;
    expect(typeof registered.onShow).toBe('function');
    registered.onShow?.call({
      getTabBar: () => tabBar,
      loadCertificate: vi.fn(),
      setData: vi.fn(),
    } as TabPageContext);

    expect(tabBar.data.value).toBe('/pages/home/index');
  });
});
