import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeQuestion } from './factories';
import type { PracticeSession } from '../miniprogram/services/practice-session';

interface NavigationOptions {
  url: string;
  success?: () => void;
  fail?: () => void;
  complete?: () => void;
}

interface AnswerSheetContext {
  data: Record<string, unknown>;
  setData(update: Record<string, unknown>): void;
}

interface AnswerSheetDefinition {
  data: Record<string, unknown>;
  onSelectQuestion(this: AnswerSheetContext, event: WechatMiniprogram.TouchEvent): void;
}

interface PracticeData {
  isLast: boolean;
  [key: string]: unknown;
}

interface PracticeContext {
  data: PracticeData;
  setData(update: Partial<PracticeData>): void;
}

interface PracticeDefinition {
  data: PracticeData;
  renderSession(this: PracticeContext, session: PracticeSession): void;
  onOpenAnswerSheet(this: PracticeContext): void;
}

interface ReportContext {
  data: Record<string, unknown>;
  setData(update: Record<string, unknown>): void;
}

interface ReportDefinition {
  data: Record<string, unknown>;
  onOpenAnswerSheet(this: ReportContext): void;
}

const questionTap = (index: number): WechatMiniprogram.TouchEvent =>
  ({
    currentTarget: { dataset: { index } },
  }) as unknown as WechatMiniprogram.TouchEvent;

const loadReviewNavigationPages = async () => {
  vi.resetModules();
  let capturedDefinition: unknown;
  const stack = ['/pages/home/index', '/pages/practice/index', '/pages/report/index'];
  let maximumDepth = stack.length;
  const completeNavigation = (options: NavigationOptions) => {
    options.success?.();
    options.complete?.();
  };
  const navigateTo = vi.fn<(options: NavigationOptions) => void>((options) => {
    stack.push(options.url);
    maximumDepth = Math.max(maximumDepth, stack.length);
    completeNavigation(options);
  });
  const redirectTo = vi.fn<(options: NavigationOptions) => void>((options) => {
    stack[stack.length - 1] = options.url;
    completeNavigation(options);
  });
  const navigateBack = vi.fn<(options: Omit<NavigationOptions, 'url'>) => void>((options) => {
    stack.pop();
    options.success?.();
    options.complete?.();
  });

  vi.stubGlobal('Page', (value: unknown) => {
    capturedDefinition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    navigateTo,
    redirectTo,
    navigateBack,
    pageScrollTo: vi.fn(),
  });

  const takeDefinition = <T>(): T => {
    if (!capturedDefinition) throw new Error('Page was not registered');
    const definition = capturedDefinition as T;
    capturedDefinition = undefined;
    return definition;
  };

  await import('../miniprogram/pages/answer-sheet/index');
  const answerSheet = takeDefinition<AnswerSheetDefinition>();
  await import('../miniprogram/pages/practice/index');
  const practice = takeDefinition<PracticeDefinition>();
  await import('../miniprogram/pages/report/index');
  const report = takeDefinition<ReportDefinition>();
  const runtime = await import('../miniprogram/services/practice-runtime');

  const answerSheetContext: AnswerSheetContext = {
    data: structuredClone(answerSheet.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  };
  const practiceContext: PracticeContext = {
    data: structuredClone(practice.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  };
  const reportContext: ReportContext = {
    data: structuredClone(report.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  };

  return {
    answerSheet,
    answerSheetContext,
    getMaximumDepth: () => maximumDepth,
    navigateTo,
    practice,
    practiceContext,
    redirectTo,
    report,
    reportContext,
    runtime,
    stack,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('submitted review navigation state machine', () => {
  it('keeps the report return layer and a constant stack depth across repeated review loops', async () => {
    const {
      answerSheet,
      answerSheetContext,
      getMaximumDepth,
      practice,
      practiceContext,
      report,
      reportContext,
      runtime,
      stack,
    } = await loadReviewNavigationPages();
    const session = runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q-loop-1' }), makeQuestion({ id: 'Q-loop-2' })],
      'sequential',
    );
    if (!session || !runtime.submitActivePractice(2000)) {
      throw new Error('submitted practice session was not created');
    }

    report.onOpenAnswerSheet.call(reportContext);
    for (let loop = 0; loop < 5; loop += 1) {
      answerSheet.onSelectQuestion.call(answerSheetContext, questionTap(loop % 2));
      const submitted = runtime.getActivePractice();
      if (!submitted) throw new Error('submitted practice session disappeared');
      practice.renderSession.call(practiceContext, submitted);
      practice.onOpenAnswerSheet.call(practiceContext);
    }

    expect(getMaximumDepth()).toBe(4);
    expect(stack).toEqual([
      '/pages/home/index',
      '/pages/practice/index',
      '/pages/report/index',
      '/pages/answer-sheet/index',
    ]);
  });

  it('locks duplicate report entries and releases from fail before complete', async () => {
    const { navigateTo, report, reportContext } = await loadReviewNavigationPages();
    navigateTo.mockImplementation(() => undefined);

    report.onOpenAnswerSheet.call(reportContext);
    report.onOpenAnswerSheet.call(reportContext);

    expect(navigateTo).toHaveBeenCalledTimes(1);
    const first = navigateTo.mock.calls[0]?.[0];
    expect(first).toMatchObject({
      url: '/pages/answer-sheet/index',
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function),
    });

    first?.fail?.();
    report.onOpenAnswerSheet.call(reportContext);
    expect(navigateTo).toHaveBeenCalledTimes(2);
  });
});
