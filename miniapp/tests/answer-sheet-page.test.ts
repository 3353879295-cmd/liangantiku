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
}

interface AnswerSheetPageContext {
  data: AnswerSheetPageData;
  setData(update: Partial<AnswerSheetPageData>): void;
  renderSheet(): void;
}

interface AnswerSheetPageDefinition {
  data: AnswerSheetPageData;
  renderSheet(this: AnswerSheetPageContext): void;
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
    redirectTo.mockImplementation(() => {
      statusWhenOpeningReport = runtime.getActivePractice()?.status ?? '';
    });

    await definition.onSubmit.call(context);

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(statusWhenOpeningReport).toBe('submitted');
    expect(runtime.getActivePractice()?.feedback[question.id]?.correct).toBe(true);
    expect(redirectTo).toHaveBeenCalledWith({ url: '/pages/report/index' });
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
