import { afterEach, describe, expect, it, vi } from 'vitest';

interface ReportData {
  loading: boolean;
  loadError: boolean;
  ready: boolean;
}

interface ReportContext {
  data: ReportData;
  setData(update: Partial<ReportData>): void;
  loadReport(): Promise<void>;
  syncTheme(): void;
}

interface ReportDefinition {
  data: ReportData;
  onLoad(this: ReportContext): Promise<void>;
  onUnload(this: ReportContext): void;
  onRetryLoad(this: ReportContext): void;
  loadReport(this: ReportContext): Promise<void>;
  syncTheme(this: ReportContext): void;
}

const loadReportPage = async (restorePractice: ReturnType<typeof vi.fn>) => {
  vi.resetModules();
  let definition: ReportDefinition | undefined;
  const recordActivePractice = vi.fn();
  const submitActivePractice = vi.fn(() => null);
  vi.doMock('../miniprogram/services/practice-runtime', () => ({
    getActivePractice: vi.fn(),
    recordActivePractice,
    restorePractice,
    startPracticeFromQuestions: vi.fn(),
    startRandomPracticeFromQuestions: vi.fn(),
    submitActivePractice,
  }));
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: { theme: { get: vi.fn(() => 'light'), toggle: vi.fn(() => 'night') } },
  }));
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateTo: vi.fn(), switchTab: vi.fn() });
  vi.stubGlobal('Page', (value: ReportDefinition) => {
    definition = value;
  });

  await import('../miniprogram/pages/report/index');
  if (!definition) throw new Error('report Page was not registered');
  const registered = definition;
  const context: ReportContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    loadReport() {
      return registered.loadReport.call(this);
    },
    syncTheme() {
      registered.syncTheme.call(this);
    },
  };
  return { context, definition: registered, recordActivePractice, submitActivePractice };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('report restoration', () => {
  it('shows a retryable restoration failure and coalesces retry taps', async () => {
    let resolveRestore!: () => void;
    const restorePractice = vi
      .fn()
      .mockRejectedValueOnce(new Error('restore unavailable'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveRestore = resolve;
          }),
      );
    const { context, definition } = await loadReportPage(restorePractice);

    await definition.onLoad.call(context);
    expect(context.data).toMatchObject({ loading: false, loadError: true, ready: false });

    definition.onRetryLoad.call(context);
    definition.onRetryLoad.call(context);
    resolveRestore();
    await Promise.resolve();

    expect(restorePractice).toHaveBeenCalledTimes(2);
    expect(context.data).toMatchObject({ loading: false, loadError: false, ready: false });
  });

  it('does not apply a late restoration result after unload', async () => {
    let resolveRestore!: () => void;
    const restorePractice = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRestore = resolve;
        }),
    );
    const { context, definition, recordActivePractice, submitActivePractice } =
      await loadReportPage(restorePractice);
    const setData = vi.spyOn(context, 'setData');

    const loading = definition.onLoad.call(context);
    const writesBeforeUnload = setData.mock.calls.length;
    definition.onUnload.call(context);
    resolveRestore();
    await loading;

    expect(setData).toHaveBeenCalledTimes(writesBeforeUnload);
    expect(context.data.loading).toBe(true);
    expect(submitActivePractice).not.toHaveBeenCalled();
    expect(recordActivePractice).not.toHaveBeenCalled();
  });
});
