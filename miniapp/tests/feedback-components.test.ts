import { afterEach, describe, expect, it, vi } from 'vitest';

interface VisualData {
  active: boolean;
  popActive: boolean;
  rippleActive: boolean;
}

interface FavoriteContext {
  data: VisualData;
  setData(updates: Partial<VisualData>, callback?: () => void): void;
  triggerEvent(name: string, detail: { active: boolean }): void;
}

interface FavoriteDefinition {
  properties: {
    active: {
      observer?: (this: FavoriteContext, active: boolean, previous: boolean | undefined) => void;
    };
  };
  lifetimes?: {
    attached?: (this: FavoriteContext) => void;
    detached?: (this: FavoriteContext) => void;
  };
  methods: {
    handleTap(this: FavoriteContext): void;
  };
}

interface ToastData {
  visible: boolean;
  message: string;
}

interface ToastContext {
  data: ToastData;
  triggerEvent(name: string): void;
}

interface ToastDefinition {
  properties: {
    visible: {
      observer?: (this: ToastContext, visible: boolean) => void;
    };
    message: {
      observer?: (this: ToastContext) => void;
    };
  };
  lifetimes?: {
    attached?: (this: ToastContext) => void;
    detached?: (this: ToastContext) => void;
  };
}

interface ThemeContext {
  data: { theme: 'light' | 'night' };
  triggerEvent(name: string, detail: { theme: 'light' | 'night' }): void;
}

interface ThemeDefinition {
  methods: {
    handleTap(this: ThemeContext): void;
  };
}

interface AnalysisContext {
  data: { questionId: string };
}

interface AnalysisDefinition {
  methods: {
    handleCopyQuestionId?(this: AnalysisContext): Promise<unknown> | void;
  };
}

const loadComponent = async <T>(path: string): Promise<T> => {
  let captured: T | undefined;
  vi.stubGlobal('Component', (definition: T) => {
    captured = definition;
  });
  vi.resetModules();

  await import(path);

  if (!captured) throw new Error(`${path} did not register a component`);
  return captured;
};

const makeFavoriteContext = () => {
  const data: VisualData = {
    active: false,
    popActive: false,
    rippleActive: false,
  };
  const events: Array<{ name: string; detail: { active: boolean } }> = [];
  let setDataCount = 0;
  const context: FavoriteContext = {
    data,
    setData(updates, callback) {
      setDataCount += 1;
      Object.assign(data, updates);
      callback?.();
    },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    },
  };
  return { context, data, events, getSetDataCount: () => setDataCount };
};

const makeToastContext = () => {
  const events: string[] = [];
  const context: ToastContext = {
    data: { visible: false, message: '' },
    triggerEvent(name) {
      events.push(name);
    },
  };
  return { context, events };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('favorite-button feedback contract', () => {
  it('emits the requested next state without owning favorite data', async () => {
    const definition = await loadComponent<FavoriteDefinition>(
      '../miniprogram/components/favorite-button/index',
    );
    const { context, events } = makeFavoriteContext();

    definition.methods.handleTap.call(context);

    expect(events).toEqual([{ name: 'change', detail: { active: true } }]);
    expect(context.data.active).toBe(false);
  });

  it('restarts the 420ms pop and ripple window on a rapid repeat toggle', async () => {
    vi.useFakeTimers();
    const definition = await loadComponent<FavoriteDefinition>(
      '../miniprogram/components/favorite-button/index',
    );
    const observer = definition.properties.active.observer;
    if (!observer) throw new Error('active observer is missing');
    const { context, data } = makeFavoriteContext();

    observer.call(context, false, undefined);
    expect(data.popActive).toBe(false);

    observer.call(context, true, false);
    expect(data).toMatchObject({ popActive: true, rippleActive: true });

    vi.advanceTimersByTime(200);
    observer.call(context, false, true);
    vi.advanceTimersByTime(220);
    expect(data).toMatchObject({ popActive: true, rippleActive: true });

    vi.advanceTimersByTime(200);
    expect(data).toMatchObject({ popActive: false, rippleActive: false });
  });

  it('ignores a stale delayed setData callback from an earlier toggle', async () => {
    vi.useFakeTimers();
    const definition = await loadComponent<FavoriteDefinition>(
      '../miniprogram/components/favorite-button/index',
    );
    const observer = definition.properties.active.observer;
    if (!observer) throw new Error('active observer is missing');
    const data: VisualData = {
      active: false,
      popActive: false,
      rippleActive: false,
    };
    const callbacks: Array<() => void> = [];
    const context: FavoriteContext = {
      data,
      setData(updates, callback) {
        Object.assign(data, updates);
        if (callback) callbacks.push(callback);
      },
      triggerEvent() {},
    };

    observer.call(context, true, false);
    observer.call(context, false, true);
    expect(callbacks).toHaveLength(2);

    callbacks.shift()?.();
    vi.advanceTimersByTime(100);
    callbacks.shift()?.();
    vi.advanceTimersByTime(320);

    expect(data).toMatchObject({ popActive: true, rippleActive: true });
    vi.advanceTimersByTime(100);
    expect(data).toMatchObject({ popActive: false, rippleActive: false });
  });

  it('clears feedback timers on detach without a late setData', async () => {
    vi.useFakeTimers();
    const definition = await loadComponent<FavoriteDefinition>(
      '../miniprogram/components/favorite-button/index',
    );
    const observer = definition.properties.active.observer;
    const detached = definition.lifetimes?.detached;
    if (!observer || !detached) throw new Error('favorite lifecycle contract is missing');
    const { context, getSetDataCount } = makeFavoriteContext();

    observer.call(context, true, false);
    detached.call(context);
    const countAtDetach = getSetDataCount();
    vi.advanceTimersByTime(420);

    expect(getSetDataCount()).toBe(countAtDetach);
  });
});

describe('app-toast timer contract', () => {
  it('restarts its 1600ms hide timer when a visible message changes', async () => {
    vi.useFakeTimers();
    const definition = await loadComponent<ToastDefinition>(
      '../miniprogram/components/app-toast/index',
    );
    const visibleObserver = definition.properties.visible.observer;
    const messageObserver = definition.properties.message.observer;
    if (!visibleObserver || !messageObserver) throw new Error('toast observers are missing');
    const { context, events } = makeToastContext();

    context.data.visible = true;
    context.data.message = '已收藏';
    visibleObserver.call(context, true);
    vi.advanceTimersByTime(1000);

    context.data.message = '已取消收藏';
    messageObserver.call(context);
    vi.advanceTimersByTime(600);
    expect(events).toEqual([]);

    vi.advanceTimersByTime(999);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['close']);
  });

  it('cancels its pending close event when hidden or detached', async () => {
    vi.useFakeTimers();
    const definition = await loadComponent<ToastDefinition>(
      '../miniprogram/components/app-toast/index',
    );
    const visibleObserver = definition.properties.visible.observer;
    const detached = definition.lifetimes?.detached;
    if (!visibleObserver || !detached) throw new Error('toast lifecycle contract is missing');
    const first = makeToastContext();

    first.context.data.visible = true;
    visibleObserver.call(first.context, true);
    first.context.data.visible = false;
    visibleObserver.call(first.context, false);
    vi.advanceTimersByTime(1600);
    expect(first.events).toEqual([]);

    const second = makeToastContext();
    second.context.data.visible = true;
    visibleObserver.call(second.context, true);
    detached.call(second.context);
    vi.advanceTimersByTime(1600);
    expect(second.events).toEqual([]);
  });
});

describe('theme-toggle event contract', () => {
  it('requests the opposite theme without persisting it itself', async () => {
    const definition = await loadComponent<ThemeDefinition>(
      '../miniprogram/components/theme-toggle/index',
    );
    const events: Array<{ name: string; detail: { theme: 'light' | 'night' } }> = [];
    const context: ThemeContext = {
      data: { theme: 'night' },
      triggerEvent(name, detail) {
        events.push({ name, detail });
      },
    };

    definition.methods.handleTap.call(context);

    expect(events).toEqual([{ name: 'change', detail: { theme: 'light' } }]);
    expect(context.data.theme).toBe('night');
  });
});

describe('analysis correction fallback', () => {
  it('shows copied feedback only after the clipboard operation resolves', async () => {
    const setClipboardData = vi.fn().mockResolvedValue({});
    const showToast = vi.fn();
    const showModal = vi.fn();
    vi.stubGlobal('wx', { setClipboardData, showToast, showModal });
    const definition = await loadComponent<AnalysisDefinition>(
      '../miniprogram/components/analysis-panel/index',
    );
    const context: AnalysisContext = { data: { questionId: 'WH-L5-000001' } };

    expect(typeof definition.methods.handleCopyQuestionId).toBe('function');
    const pending = definition.methods.handleCopyQuestionId?.call(context);

    expect(setClipboardData).toHaveBeenCalledWith({ data: 'WH-L5-000001' });
    expect(showToast).not.toHaveBeenCalled();
    await pending;
    expect(showToast).toHaveBeenCalledWith({ title: '题目 ID 已复制', icon: 'none' });
    expect(showModal).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('提交') }),
    );
  });

  it('provides the stable question ID for manual recording when clipboard copy rejects', async () => {
    const setClipboardData = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    const showToast = vi.fn();
    const showModal = vi.fn();
    vi.stubGlobal('wx', { setClipboardData, showToast, showModal });
    const definition = await loadComponent<AnalysisDefinition>(
      '../miniprogram/components/analysis-panel/index',
    );
    const context: AnalysisContext = { data: { questionId: 'WH-L5-000001' } };

    const pending = definition.methods.handleCopyQuestionId?.call(context);

    expect(showModal).not.toHaveBeenCalled();
    await pending;
    expect(showToast).not.toHaveBeenCalledWith({
      title: '题目 ID 已复制',
      icon: 'none',
    });
    expect(showModal).toHaveBeenCalledWith({
      title: '复制失败',
      content: '复制未完成，请手动记录题目 ID：WH-L5-000001',
      showCancel: false,
      confirmText: '知道了',
    });
  });
});
