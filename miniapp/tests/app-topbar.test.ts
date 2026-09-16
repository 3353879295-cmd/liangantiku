import { afterEach, describe, expect, it, vi } from 'vitest';

interface Context {
  data: { hasNativeBack: boolean; fallbackTab: string };
  setData(update: { hasNativeBack: boolean }): void;
}
interface Definition {
  lifetimes: { attached(this: Context): void };
  pageLifetimes: { show(this: Context): void };
  methods: { handleBack(this: Context): void };
}

afterEach(() => vi.unstubAllGlobals());

describe('topbar return navigation', () => {
  it('uses the native return on a page stack and retains a fallback for direct links', async () => {
    vi.resetModules();
    let definition!: Definition;
    let depth = 2;
    const switchTab = vi.fn();
    const navigateBack = vi.fn();
    vi.stubGlobal('Component', (value: Definition) => {
      definition = value;
    });
    vi.stubGlobal('getCurrentPages', () => Array.from({ length: depth }, () => ({})));
    vi.stubGlobal('wx', { switchTab, navigateBack });
    await import('../miniprogram/components/app-topbar/index');
    const context: Context = {
      data: { hasNativeBack: false, fallbackTab: 'profile' },
      setData(update) {
        Object.assign(this.data, update);
      },
    };
    definition.lifetimes.attached.call(context);
    expect(context.data.hasNativeBack).toBe(true);
    definition.methods.handleBack.call(context);
    expect(navigateBack).toHaveBeenCalledOnce();
    depth = 1;
    definition.pageLifetimes.show.call(context);
    expect(context.data.hasNativeBack).toBe(false);
    definition.methods.handleBack.call(context);
    expect(switchTab).toHaveBeenCalledWith({ url: '/pages/profile/index' });
  });
});
