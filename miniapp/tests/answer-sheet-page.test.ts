import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeQuestion } from './factories';
import type { PracticeMode } from '../miniprogram/types/domain';

interface SubmitModalOptions {
  title: string;
  content: string;
  confirmText: string;
}

interface AnswerSheetPageModule {
  buildAnswerSheetSubmitModal?: (mode: PracticeMode, unanswered: number) => SubmitModalOptions;
}

interface AnswerSheetPageData {
  items: Array<{ index: number; number: number; status: string; current: boolean }>;
  submitting: boolean;
  loading: boolean;
  loadError: boolean;
}

interface AnswerSheetPageContext {
  data: AnswerSheetPageData;
  setData(update: Partial<AnswerSheetPageData>): void;
  renderSheet(): void;
  loadSheet(): Promise<void>;
  syncTheme(): void;
}

interface AnswerSheetPageDefinition {
  data: AnswerSheetPageData;
  renderSheet(this: AnswerSheetPageContext): void;
  onLoad(this: AnswerSheetPageContext): Promise<void>;
  onUnload(this: AnswerSheetPageContext): void;
  onRetryLoad(this: AnswerSheetPageContext): void;
  loadSheet(this: AnswerSheetPageContext): Promise<void>;
  syncTheme(this: AnswerSheetPageContext): void;
  onSelectQuestion(this: AnswerSheetPageContext, event: WechatMiniprogram.TouchEvent): void;
  onSubmit(this: AnswerSheetPageContext): Promise<void>;
}

interface NavigationOptions {
  url?: string;
  success?: () => void;
  fail?: () => void;
  complete?: () => void;
}

const questionTap = (index: unknown) =>
  ({
    currentTarget: { dataset: { index } },
  }) as unknown as WechatMiniprogram.TouchEvent;

const loadAnswerSheetPage = async () => {
  vi.resetModules();
  let definition: AnswerSheetPageDefinition | undefined;
  const navigateBack = vi.fn<(options: NavigationOptions) => void>();
  const navigateTo = vi.fn<(options: NavigationOptions) => void>();
  const redirectTo = vi.fn<(options: NavigationOptions) => void>();
  const setStorageSync = vi.fn();
  const showModal = vi.fn(() => Promise.resolve({ confirm: true, cancel: false }));
  const showToast = vi.fn();

  vi.stubGlobal('Page', (value: AnswerSheetPageDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync,
    removeStorageSync: vi.fn(),
    navigateBack,
    navigateTo,
    redirectTo,
    showModal,
    showToast,
  });

  const page = (await import('../miniprogram/pages/answer-sheet/index')) as AnswerSheetPageModule;
  const runtime = await import('../miniprogram/services/practice-runtime');
  const practiceSession = await import('../miniprogram/services/practice-session');
  if (!definition) throw new Error('answer-sheet Page was not registered');

  const registered = definition;
  const context: AnswerSheetPageContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    renderSheet() {
      registered.renderSheet.call(this);
    },
    loadSheet() {
      return registered.loadSheet.call(this);
    },
    syncTheme() {
      registered.syncTheme.call(this);
    },
  };

  return {
    context,
    definition: registered,
    navigateBack,
    navigateTo,
    page,
    practiceSession,
    redirectTo,
    runtime,
    setStorageSync,
    showModal,
    showToast,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('answer-sheet submit modal', () => {
  it('keeps the normal-practice confirm text within the WeChat four-character limit', async () => {
    const { page } = await loadAnswerSheetPage();

    expect(typeof page.buildAnswerSheetSubmitModal).toBe('function');
    expect(page.buildAnswerSheetSubmitModal?.('random', 3)).toEqual({
      title: '结束本次练习',
      content: '未答题 3 道，提交后将按未答处理。',
      confirmText: '确认结束',
    });
  });

  it('keeps the mock-exam submission wording distinct', async () => {
    const { page } = await loadAnswerSheetPage();

    expect(page.buildAnswerSheetSubmitModal?.('mock', 0)).toEqual({
      title: '确认交卷',
      content: '未答题 0 道，提交后将生成本次结果。',
      confirmText: '确认交卷',
    });
  });
});

describe('answer-sheet restoration', () => {
  it('keeps a restoration failure out of the empty state and coalesces retry taps', async () => {
    const { context, definition, runtime } = await loadAnswerSheetPage();
    let resolveRestore!: (session: Awaited<ReturnType<typeof runtime.restorePractice>>) => void;
    vi.spyOn(runtime, 'restorePractice')
      .mockRejectedValueOnce(new Error('restore unavailable'))
      .mockImplementationOnce(
        () =>
          new Promise<Awaited<ReturnType<typeof runtime.restorePractice>>>((resolve) => {
            resolveRestore = resolve;
          }),
      );

    await definition.onLoad.call(context);
    expect(context.data.loading).toBe(false);
    expect(context.data.loadError).toBe(true);

    definition.onRetryLoad.call(context);
    definition.onRetryLoad.call(context);
    resolveRestore(null);
    await Promise.resolve();

    expect(runtime.restorePractice).toHaveBeenCalledTimes(2);
    expect(context.data.loading).toBe(false);
    expect(context.data.loadError).toBe(false);
  });

  it('does not write a late restoration response after unload', async () => {
    const { context, definition, runtime } = await loadAnswerSheetPage();
    let resolveRestore!: (session: Awaited<ReturnType<typeof runtime.restorePractice>>) => void;
    vi.spyOn(runtime, 'restorePractice').mockImplementationOnce(
      () =>
        new Promise<Awaited<ReturnType<typeof runtime.restorePractice>>>((resolve) => {
          resolveRestore = resolve;
        }),
    );
    const setData = vi.spyOn(context, 'setData');

    const loading = definition.onLoad.call(context);
    const writesBeforeUnload = setData.mock.calls.length;
    definition.onUnload.call(context);
    resolveRestore(null);
    await loading;

    expect(setData).toHaveBeenCalledTimes(writesBeforeUnload);
    expect(context.data.loading).toBe(true);
  });
});

describe('answer-sheet submission', () => {
  it('submits a deferred session before opening its report', async () => {
    const { context, definition, practiceSession, redirectTo, runtime, showModal } =
      await loadAnswerSheetPage();
    const question = makeQuestion({ id: 'Q-DEFERRED-SUBMIT' });
    const active = practiceSession.answerQuestion(
      practiceSession.createPracticeSession([question], {
        mode: 'random',
        answerRevealMode: 'deferred',
        now: 1000,
      }),
      question.id,
      ['A'],
      1200,
    );
    runtime.saveActivePractice(active);
    let statusWhenOpeningReport = '';
    redirectTo.mockImplementation((options) => {
      statusWhenOpeningReport = runtime.getActivePractice()?.status ?? '';
      options.success?.();
    });

    await definition.onSubmit.call(context);

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(statusWhenOpeningReport).toBe('submitted');
    expect(runtime.getActivePractice()?.feedback[question.id]?.correct).toBe(true);
    expect(redirectTo).toHaveBeenCalledWith({
      url: '/pages/report/index',
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function),
    });
  });

  it('ignores repeated submission taps while confirmation is pending', async () => {
    const { context, definition, practiceSession, runtime, showModal } =
      await loadAnswerSheetPage();
    const question = makeQuestion({ id: 'Q-SUBMIT-LOCK' });
    runtime.saveActivePractice(
      practiceSession.createPracticeSession([question], {
        mode: 'random',
        answerRevealMode: 'deferred',
        now: 1000,
      }),
    );
    let resolveModal!: (value: { confirm: boolean; cancel: boolean }) => void;
    showModal.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveModal = resolve;
        }),
    );

    const first = definition.onSubmit.call(context);
    const second = definition.onSubmit.call(context);
    expect(showModal).toHaveBeenCalledTimes(1);
    resolveModal({ confirm: false, cancel: true });
    await Promise.all([first, second]);

    expect(context.data.submitting).toBe(false);
  });

  it('keeps the submission lock until report navigation calls back', async () => {
    const { context, definition, practiceSession, redirectTo, runtime, showModal } =
      await loadAnswerSheetPage();
    const question = makeQuestion({ id: 'Q-SUBMIT-NAVIGATION-LOCK' });
    runtime.saveActivePractice(
      practiceSession.createPracticeSession([question], {
        mode: 'random',
        answerRevealMode: 'deferred',
        now: 1000,
      }),
    );
    const first = definition.onSubmit.call(context);
    await Promise.resolve();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(redirectTo).toHaveBeenCalledTimes(1);

    const second = definition.onSubmit.call(context);
    expect(showModal).toHaveBeenCalledTimes(1);
    redirectTo.mock.calls[0]?.[0]?.success?.();
    await Promise.all([first, second]);

    expect(context.data.submitting).toBe(false);
  });

  it('releases a stalled report navigation through its timeout fallback', async () => {
    vi.useFakeTimers();
    const { context, definition, practiceSession, runtime, showToast } =
      await loadAnswerSheetPage();
    const question = makeQuestion({ id: 'Q-SUBMIT-NAVIGATION-TIMEOUT' });
    runtime.saveActivePractice(
      practiceSession.createPracticeSession([question], {
        mode: 'random',
        answerRevealMode: 'deferred',
        now: 1000,
      }),
    );

    const submission = definition.onSubmit.call(context);
    await vi.advanceTimersByTimeAsync(5000);
    await submission;

    expect(context.data.submitting).toBe(false);
    expect(showToast).toHaveBeenCalledWith({ title: '页面跳转超时，请重试', icon: 'none' });
  });
});

describe('answer-sheet question selection', () => {
  it('saves an active selection before returning to the in-progress practice page', async () => {
    const { context, definition, navigateBack, navigateTo, runtime } = await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-active-1' }), makeQuestion({ id: 'Q-active-2' })],
      'sequential',
    );
    if (!session) throw new Error('active practice session was not created');
    let indexWhenNavigating = -1;
    navigateBack.mockImplementation(() => {
      indexWhenNavigating = runtime.getActivePractice()?.currentIndex ?? -1;
    });

    definition.onSelectQuestion.call(context, questionTap(1));

    expect(indexWhenNavigating).toBe(1);
    expect(runtime.getActivePractice()?.currentIndex).toBe(1);
    expect(navigateBack).toHaveBeenCalledTimes(1);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('saves a submitted selection before opening its read-only practice review', async () => {
    const { context, definition, navigateBack, navigateTo, redirectTo, runtime } =
      await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-review-1' }), makeQuestion({ id: 'Q-review-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }
    let indexWhenNavigating = -1;
    redirectTo.mockImplementation(() => {
      indexWhenNavigating = runtime.getActivePractice()?.currentIndex ?? -1;
    });

    definition.onSelectQuestion.call(context, questionTap(1));

    expect(indexWhenNavigating).toBe(1);
    expect(runtime.getActivePractice()?.currentIndex).toBe(1);
    expect(redirectTo).toHaveBeenCalledWith({
      url: '/pages/practice/index?resume=1',
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function),
    });
    expect(navigateTo).not.toHaveBeenCalled();
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('ignores repeated submitted selections until navigation completes', async () => {
    const { context, definition, redirectTo, runtime } = await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-repeat-1' }), makeQuestion({ id: 'Q-repeat-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }

    definition.onSelectQuestion.call(context, questionTap(1));
    definition.onSelectQuestion.call(context, questionTap(0));

    expect(redirectTo).toHaveBeenCalledTimes(1);
    expect(runtime.getActivePractice()?.currentIndex).toBe(1);

    const firstNavigation = redirectTo.mock.calls[0]?.[0];
    firstNavigation?.complete?.();
    definition.onSelectQuestion.call(context, questionTap(0));

    expect(redirectTo).toHaveBeenCalledTimes(2);
    expect(runtime.getActivePractice()?.currentIndex).toBe(0);
  });

  it('releases a selection with no navigation callback through its timeout fallback', async () => {
    vi.useFakeTimers();
    const { context, definition, redirectTo, runtime, showToast } = await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-SELECT-TIMEOUT-1' }), makeQuestion({ id: 'Q-SELECT-TIMEOUT-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }

    definition.onSelectQuestion.call(context, questionTap(1));
    await vi.advanceTimersByTimeAsync(5000);
    definition.onSelectQuestion.call(context, questionTap(0));

    expect(redirectTo).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith({ title: '页面跳转超时，请重试', icon: 'none' });
  });

  it('unlocks submitted selection from the failure callback before complete for retry', async () => {
    const { context, definition, redirectTo, runtime } = await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-failure-1' }), makeQuestion({ id: 'Q-failure-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }
    redirectTo.mockImplementationOnce((options) => {
      options.fail?.();
    });

    definition.onSelectQuestion.call(context, questionTap(1));
    definition.onSelectQuestion.call(context, questionTap(0));

    expect(redirectTo).toHaveBeenCalledTimes(2);
    expect(runtime.getActivePractice()?.currentIndex).toBe(0);
  });

  it.each([
    { label: 'negative', index: -1 },
    { label: 'upper bound', index: 2 },
    { label: 'missing', index: undefined },
  ])('ignores a $label cell index without saving or navigating', async ({ index }) => {
    const { context, definition, navigateBack, navigateTo, redirectTo, runtime, setStorageSync } =
      await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-guard-1' }), makeQuestion({ id: 'Q-guard-2' })],
      'sequential',
    );
    if (!session) throw new Error('active practice session was not created');
    setStorageSync.mockClear();

    expect(() => definition.onSelectQuestion.call(context, questionTap(index))).not.toThrow();

    expect(runtime.getActivePractice()?.currentIndex).toBe(0);
    expect(setStorageSync).not.toHaveBeenCalled();
    expect(navigateBack).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('ignores a cell selection when no session exists', async () => {
    const { context, definition, navigateBack, navigateTo, redirectTo, runtime, setStorageSync } =
      await loadAnswerSheetPage();
    setStorageSync.mockClear();

    definition.onSelectQuestion.call(context, questionTap(0));

    expect(runtime.getActivePractice()).toBeNull();
    expect(setStorageSync).not.toHaveBeenCalled();
    expect(navigateBack).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('keeps correct, wrong, and unanswered submitted cells distinct', async () => {
    const { context, definition, practiceSession, runtime } = await loadAnswerSheetPage();
    const correct = makeQuestion({ id: 'Q-status-correct', answer: ['A'] });
    const wrong = makeQuestion({ id: 'Q-status-wrong', answer: ['B'] });
    const unanswered = makeQuestion({ id: 'Q-status-unanswered' });
    const session = runtime.startPracticeFromQuestions([correct, wrong, unanswered], 'sequential');
    if (!session) throw new Error('practice session was not created');
    const withCorrect = practiceSession.answerQuestion(session, correct.id, ['A'], 1100);
    const withWrong = practiceSession.answerQuestion(withCorrect, wrong.id, ['A'], 1200);
    runtime.saveActivePractice(withWrong);
    if (!runtime.submitActivePractice(2000)) {
      throw new Error('practice session was not submitted');
    }

    definition.renderSheet.call(context);

    expect(context.data.items.map(({ status }) => status)).toEqual([
      'correct',
      'wrong',
      'unanswered',
    ]);
  });
});
