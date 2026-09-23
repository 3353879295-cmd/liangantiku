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
  onPracticeChapter(this: ReportContext, event: WechatMiniprogram.TouchEvent): Promise<void>;
  onRetryWrong(this: ReportContext): Promise<void>;
  onRetry(this: ReportContext): Promise<void>;
  onReviewWrong(this: ReportContext): void;
  onOpenAnswerSheet(this: ReportContext): void;
  onResumePendingPractice(this: ReportContext): Promise<void>;
}

const loadReportPage = async (restorePractice: ReturnType<typeof vi.fn>) => {
  vi.resetModules();
  let definition: ReportDefinition | undefined;
  const recordActivePractice = vi.fn();
  const submitActivePractice = vi.fn(() => null);
  const getActivePractice = vi.fn();
  const startPracticeFromQuestions = vi.fn();
  vi.doMock('../miniprogram/services/practice-runtime', () => ({
    getActivePractice,
    getPracticeStartCancellation: vi.fn(() => vi.fn()),
    recordActivePractice,
    restorePractice,
    startPracticeFromQuestions,
    startRandomPracticeFromQuestions: vi.fn(),
    submitActivePractice,
  }));
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: { theme: { get: vi.fn(() => 'light'), toggle: vi.fn(() => 'night') } },
  }));
  const navigateTo = vi.fn();
  const redirectTo = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateTo, redirectTo, switchTab: vi.fn() });
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
  return {
    context,
    definition: registered,
    getActivePractice,
    recordActivePractice,
    navigateTo,
    redirectTo,
    startPracticeFromQuestions,
    submitActivePractice,
  };
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

  it('keeps the original result mapping and retries all wrong questions after navigation fails', async () => {
    const restorePractice = vi.fn();
    const {
      context,
      definition,
      navigateTo,
      redirectTo,
      startPracticeFromQuestions,
      submitActivePractice,
    } = await loadReportPage(restorePractice);
    const wrongQuestions = Array.from({ length: 25 }, (_, index) => ({
      id: `wrong-${index}`,
      chapterId: 'warehouse-l5-c04',
      occupation: '4-02-06-01',
      level: 5,
    }));
    const session = {
      id: 'original-result',
      mode: 'chapter',
      questions: wrongQuestions,
      report: {
        total: 25,
        correct: 0,
        wrong: 25,
        durationMs: 0,
        wrongQuestionIds: wrongQuestions.map((question) => question.id),
        chapters: { 'warehouse-l5-c04': { total: 25, correct: 0 } },
      },
    };
    submitActivePractice.mockReturnValue(session as never);
    startPracticeFromQuestions.mockReturnValue({ id: 'retry-wrong' });
    redirectTo
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('navigation failed'))
      .mockResolvedValueOnce(undefined);

    await definition.onLoad.call(context);
    await definition.onPracticeChapter.call(context, {
      currentTarget: { dataset: { chapterId: 'warehouse-l5-c04' } },
    } as unknown as WechatMiniprogram.TouchEvent);
    expect(redirectTo).toHaveBeenCalledWith({
      url: '/pages/practice/index?occupation=4-02-06-01&level=5&mode=chapter&chapterId=warehouse-l5-c04',
    });

    await definition.onRetryWrong.call(context);
    expect(context.data).toMatchObject({ pendingPractice: true });
    definition.onReviewWrong.call(context);
    definition.onOpenAnswerSheet.call(context);
    await definition.onRetry.call(context);
    await definition.onRetryWrong.call(context);
    expect(startPracticeFromQuestions).toHaveBeenCalledWith(wrongQuestions, 'wrong', 25);
    expect(startPracticeFromQuestions).toHaveBeenCalledTimes(1);
    expect(navigateTo).not.toHaveBeenCalled();

    await definition.onResumePendingPractice.call(context);
    expect(redirectTo).toHaveBeenLastCalledWith({ url: '/pages/practice/index?resume=1' });
  });
});
