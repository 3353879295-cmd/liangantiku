import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../miniprogram/services/practice-runtime');
  vi.doUnmock('../miniprogram/services/app-services');
});

describe('practice loading lifecycle', () => {
  it('allows leaving a slow restore without a global mask or late page update', async () => {
    vi.resetModules();
    let rejectRestore!: (error: Error) => void;
    const restorePractice = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectRestore = reject;
        }),
    );
    const cancelStart = vi.fn();
    vi.doMock('../miniprogram/services/practice-runtime', () => ({
      restorePractice,
      getPracticeStartCancellation: () => cancelStart,
    }));
    vi.doMock('../miniprogram/services/app-services', () => ({ appServices: {} }));
    interface Definition {
      onLoad(options: Record<string, string>): Promise<void>;
      onUnload(): void;
    }
    let page!: Definition;
    const showLoading = vi.fn();
    vi.stubGlobal('wx', { showLoading });
    vi.stubGlobal('Page', (definition: Definition) => {
      page = definition;
    });
    await import('../miniprogram/pages/practice/index');
    const context = { syncTheme: vi.fn(), setData: vi.fn(), renderSession: vi.fn() };
    const pending = page.onLoad.call(context, { resume: '1' });
    page.onUnload.call(context);
    rejectRestore(new Error('offline'));
    await pending;
    expect(cancelStart).toHaveBeenCalledOnce();
    expect(showLoading).not.toHaveBeenCalled();
    expect(context.setData).not.toHaveBeenCalled();
    expect(context.renderSession).not.toHaveBeenCalled();
  });
});
