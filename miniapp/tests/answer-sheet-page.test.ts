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
}

const questionTap = (index: number) =>
  ({
    currentTarget: { dataset: { index } },
  }) as unknown as WechatMiniprogram.TouchEvent;

const loadAnswerSheetPage = async () => {
  vi.resetModules();
  let definition: AnswerSheetPageDefinition | undefined;
  const navigateBack = vi.fn();
  const navigateTo = vi.fn();

  vi.stubGlobal('Page', (value: AnswerSheetPageDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    navigateBack,
    navigateTo,
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
    runtime,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('answer-sheet submit modal', () => {
  it('uses the exact normal-practice action in the title and confirm button', async () => {
    const { page } = await loadAnswerSheetPage();

    expect(typeof page.buildAnswerSheetSubmitModal).toBe('function');
    expect(page.buildAnswerSheetSubmitModal?.('random', 3)).toEqual({
      title: '结束本次练习',
      content: '未答题 3 道，提交后将按未答处理。',
      confirmText: '结束本次练习',
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
    const { context, definition, navigateBack, navigateTo, runtime } = await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-review-1' }), makeQuestion({ id: 'Q-review-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }
    let indexWhenNavigating = -1;
    navigateTo.mockImplementation(() => {
      indexWhenNavigating = runtime.getActivePractice()?.currentIndex ?? -1;
    });

    definition.onSelectQuestion.call(context, questionTap(1));

    expect(indexWhenNavigating).toBe(1);
    expect(runtime.getActivePractice()?.currentIndex).toBe(1);
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/pages/practice/index?resume=1',
      complete: expect.any(Function),
    });
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('ignores repeated submitted selections until navigation completes', async () => {
    const { context, definition, navigateTo, runtime } = await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-repeat-1' }), makeQuestion({ id: 'Q-repeat-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }

    definition.onSelectQuestion.call(context, questionTap(1));
    definition.onSelectQuestion.call(context, questionTap(0));

    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(runtime.getActivePractice()?.currentIndex).toBe(1);

    const firstNavigation = navigateTo.mock.calls[0]?.[0] as { complete?: () => void } | undefined;
    firstNavigation?.complete?.();
    definition.onSelectQuestion.call(context, questionTap(0));

    expect(navigateTo).toHaveBeenCalledTimes(2);
    expect(runtime.getActivePractice()?.currentIndex).toBe(0);
  });

  it('unlocks submitted selection after a failed navigation completes', async () => {
    const { context, definition, navigateTo, runtime } = await loadAnswerSheetPage();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-failure-1' }), makeQuestion({ id: 'Q-failure-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }
    navigateTo.mockImplementationOnce((options: { complete?: () => void }) => {
      options.complete?.();
    });

    definition.onSelectQuestion.call(context, questionTap(1));
    definition.onSelectQuestion.call(context, questionTap(0));

    expect(navigateTo).toHaveBeenCalledTimes(2);
    expect(runtime.getActivePractice()?.currentIndex).toBe(0);
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
