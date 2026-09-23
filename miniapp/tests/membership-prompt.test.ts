import { afterEach, describe, expect, it, vi } from 'vitest';

interface TabBar {
  setData(update: { membershipPromptVisible: boolean }): void;
}

interface Context {
  data: { visible: boolean };
  getTabBar?: () => TabBar | undefined;
  triggerEvent(name: string): void;
  setTabBarVisibility(visible: boolean): void;
  syncTabBarVisibility(): void;
}

interface Definition {
  properties: { visible: { observer(this: Context, visible: boolean): void } };
  lifetimes: { ready(this: Context): void; detached(this: Context): void };
  pageLifetimes: { show(this: Context): void; hide(this: Context): void };
  methods: {
    close(this: Context): void;
    confirm(this: Context): void;
    setTabBarVisibility(this: Context, visible: boolean): void;
    syncTabBarVisibility(this: Context): void;
  };
}

const loadComponent = async (path: string): Promise<Definition> => {
  let definition!: Definition;
  vi.stubGlobal('Component', (value: Definition) => {
    definition = value;
  });
  await import(path);
  return definition;
};

const createContext = (
  definition: Definition,
  visible = false,
  tabBar?: TabBar,
): { context: Context; events: string[] } => {
  const events: string[] = [];
  const context: Context = {
    data: { visible },
    triggerEvent(name) {
      events.push(name);
    },
    setTabBarVisibility(visible) {
      definition.methods.setTabBarVisibility.call(this, visible);
    },
    syncTabBarVisibility() {
      definition.methods.syncTabBarVisibility.call(this);
    },
    ...(tabBar ? { getTabBar: () => tabBar } : {}),
  };
  return { context, events };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('membership prompt', () => {
  it('hides the current custom tab bar while opening and restores it when closing', async () => {
    const setData = vi.fn();
    const definition = await loadComponent('../miniprogram/components/membership-prompt/index');
    const { context } = createContext(definition, false, { setData });

    definition.properties.visible.observer.call(context, true);
    context.data.visible = true;
    definition.properties.visible.observer.call(context, false);

    expect(setData).toHaveBeenNthCalledWith(1, { membershipPromptVisible: true });
    expect(setData).toHaveBeenNthCalledWith(2, { membershipPromptVisible: false });
  });

  it('restores the tab bar when the page hides or the component is unloaded', async () => {
    const setData = vi.fn();
    const definition = await loadComponent('../miniprogram/components/membership-prompt/index');
    const { context } = createContext(definition, true, { setData });

    definition.pageLifetimes.hide.call(context);
    definition.lifetimes.detached.call(context);

    expect(setData).toHaveBeenNthCalledWith(1, { membershipPromptVisible: false });
    expect(setData).toHaveBeenNthCalledWith(2, { membershipPromptVisible: false });
  });

  it('hides the tab bar again after returning to a visible prompt', async () => {
    const setData = vi.fn();
    const definition = await loadComponent('../miniprogram/components/membership-prompt/index');
    const { context } = createContext(definition, true, { setData });

    definition.pageLifetimes.show.call(context);
    definition.lifetimes.ready.call(context);

    expect(setData).toHaveBeenNthCalledWith(1, { membershipPromptVisible: true });
    expect(setData).toHaveBeenNthCalledWith(2, { membershipPromptVisible: true });
  });

  it('works on a page without a custom tab bar and retains its close events', async () => {
    const definition = await loadComponent('../miniprogram/components/membership-prompt/index');
    const { context, events } = createContext(definition, true);

    expect(() => definition.lifetimes.ready.call(context)).not.toThrow();
    definition.methods.close.call(context);
    definition.methods.confirm.call(context);

    expect(events).toEqual(['close', 'confirm']);
  });
});
