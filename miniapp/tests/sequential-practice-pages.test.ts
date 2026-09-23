import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeQuestion } from './factories';
import {
  serializePracticeSession,
  type PracticeSession,
} from '../miniprogram/services/practice-session';

interface ReportData {
  ready: boolean;
  retrying: boolean;
  sessionMode: string;
  sequentialRemaining: number;
  sequentialProgressText: string;
  sequentialRoute: string;
}

interface ReportContext {
  data: ReportData;
  setData(update: Partial<ReportData>): void;
  loadReport(): Promise<void>;
  syncTheme(): void;
}

interface ReportPage {
  data: ReportData;
  onLoad(this: ReportContext): Promise<void>;
  loadReport(this: ReportContext): Promise<void>;
  onContinueSequential(this: ReportContext): Promise<void>;
}

const setup = async (bankSize: number) => {
  vi.resetModules();
  const values = new Map<string, unknown>();
  const redirectTo = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => values.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
    redirectTo,
    showToast: vi.fn(),
  });
  const { appServices } = await import('../miniprogram/services/app-services');
  const runtime = await import('../miniprogram/services/practice-runtime');
  const sessionService = await import('../miniprogram/services/practice-session');
  const questions = Array.from({ length: bankSize }, (_, index) =>
    makeQuestion({ id: `sequence-${index}` }),
  );
  vi.spyOn(appServices.questions, 'list').mockResolvedValue(questions);
  vi.spyOn(appServices.membership, 'checkPermission').mockResolvedValue({
    isMember: true,
    startsAt: null,
    expiresAt: null,
    freeUsed: 0,
    freeRemaining: 3,
    freeLimit: 3,
    freeDate: '2026-09-23',
    serverTime: '2026-09-23T00:00:00.000Z',
    paymentAvailable: false,
  });
  const session = await runtime.startPracticeFromQuestions(questions, 'sequential');
  if (!session) throw new Error('practice session was not created');
  let answered = session;
  for (const question of session.questions) {
    answered = sessionService.answerQuestion(answered, question.id, question.answer, Date.now());
  }
  runtime.saveActivePractice(answered);
  return { runtime, session, appServices, redirectTo };
};

const loadReport = async () => {
  let page!: ReportPage;
  vi.stubGlobal('Page', (value: ReportPage) => {
    page = value;
  });
  await import('../miniprogram/pages/report/index');
  const context: ReportContext = {
    data: structuredClone(page.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    syncTheme() {},
    loadReport() {
      return page.loadReport.call(this);
    },
  };
  await page.onLoad.call(context);
  return { page, context };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sequential group pages', () => {
  it.each(['metadata', 'session', 'resume', 'chapter'])(
    'does not start practice after leaving during %s loading',
    async (stage) => {
      const { runtime, appServices, session } = await setup(3);
      appServices.progress.saveSession(null);
      appServices.progress.saveSequentialSession('4-02-06-01:5', null);
      expect(runtime.getActivePractice()).toBeNull();
      if (stage === 'resume') appServices.progress.saveSession(serializePracticeSession(session));
      const saved = appServices.progress.restoreSession();
      const questions = [makeQuestion()];
      let resolveLoading!: () => void;
      const loading = new Promise<void>((resolve) => {
        resolveLoading = resolve;
      });
      const count = vi.spyOn(appServices.questions, 'count').mockImplementation(async () => {
        if (stage === 'metadata') await loading;
        return questions.length;
      });
      const list = vi.spyOn(appServices.questions, 'list').mockImplementation(async () => {
        if (stage === 'session' || stage === 'chapter') await loading;
        return questions;
      });
      list.mockClear();
      const byIds = vi.spyOn(appServices.questions, 'getByIds').mockImplementation(async () => {
        await loading;
        return session.questions;
      });
      interface Context {
        data: Record<string, unknown>;
        setData(update: Record<string, unknown>): void;
        syncTheme(): void;
        renderSession(session: PracticeSession): void;
        loadPractice(options: Record<string, string>): Promise<void>;
      }
      let page!: {
        data: Record<string, unknown>;
        onLoad(this: Context, options: Record<string, string>): void;
        onReady(this: Context): Promise<void> | undefined;
        loadPractice(this: Context, options: Record<string, string>): Promise<void>;
        onUnload(this: Context): void;
      };
      vi.stubGlobal('Page', (definition: typeof page) => {
        page = definition;
      });
      await import('../miniprogram/pages/practice/index');
      const setData = vi.fn();
      const renderSession = vi.fn();
      const context: Context = {
        data: structuredClone(page.data),
        setData,
        syncTheme: vi.fn(),
        renderSession,
        loadPractice(options) {
          return page.loadPractice.call(this, options);
        },
      };
      page.onLoad.call(context, {
        occupation: '4-02-06-01',
        level: '5',
        mode: stage === 'chapter' ? 'chapter' : 'sequential',
        ...(stage === 'resume' ? { resume: '1' } : {}),
      });
      const pending = page.onReady.call(context);
      await vi.waitFor(() =>
        expect(
          stage === 'metadata' ? count : stage === 'resume' ? byIds : list,
        ).toHaveBeenCalledOnce(),
      );
      page.onUnload.call(context);
      resolveLoading();
      await pending;
      expect(runtime.getActivePractice()).toBeNull();
      expect(appServices.progress.restoreSession()).toEqual(saved);
      expect(appServices.progress.restoreSequentialSession('4-02-06-01:5')).toBeNull();
      expect(setData).not.toHaveBeenCalled();
      expect(renderSession).not.toHaveBeenCalled();
    },
  );

  it('explains that skipped questions remain available in later groups', async () => {
    await setup(3);
    vi.stubGlobal('Page', vi.fn());
    const { buildAnswerSheetSubmitModal } = await import('../miniprogram/pages/answer-sheet/index');
    expect(buildAnswerSheetSubmitModal('sequential', 2).content).toBe(
      '未答题 2 道，会保留到后续练习，不计入已完成题目。',
    );
  });

  it('shows whole-bank progress and continues to the next group with retry protection', async () => {
    const { redirectTo } = await setup(55);
    const { page, context } = await loadReport();
    expect(context.data).toMatchObject({ ready: true, sequentialRemaining: 35 });
    expect(context.data.sequentialProgressText).toContain('20 / 55');
    let rejectNavigation!: (error: Error) => void;
    redirectTo.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNavigation = reject;
        }),
    );
    const pending = page.onContinueSequential.call(context);
    await page.onContinueSequential.call(context);
    expect(redirectTo).toHaveBeenCalledOnce();
    rejectNavigation(new Error('navigation failed'));
    await pending;
    expect(context.data.retrying).toBe(false);
    await page.onContinueSequential.call(context);
    expect(redirectTo).toHaveBeenLastCalledWith({
      url: '/pages/practice/index?occupation=4-02-06-01&level=5&mode=sequential',
    });
  });

  it('stops after the final group instead of starting the first questions again', async () => {
    const { redirectTo } = await setup(3);
    const { page, context } = await loadReport();
    expect(context.data).toMatchObject({
      sequentialRemaining: 0,
      sequentialProgressText: '本题库已完成 3 / 3 题',
    });
    await page.onContinueSequential.call(context);
    expect(redirectTo).not.toHaveBeenCalled();
  });

  it('sends only the current question to the practice view for a large bank', async () => {
    const { session } = await setup(1102);
    interface PracticePage {
      data: Record<string, unknown>;
      renderSession(
        this: { setData(update: Record<string, unknown>): void },
        session: PracticeSession,
      ): void;
    }
    let page!: PracticePage;
    vi.stubGlobal('Page', (value: PracticePage) => {
      page = value;
    });
    await import('../miniprogram/pages/practice/index');
    const setData = vi.fn();
    page.renderSession.call({ setData }, session);
    const update = setData.mock.calls[0]![0] as Record<string, unknown>;
    expect(session.questions).toHaveLength(20);
    expect(update.question).toEqual(session.questions[0]);
    expect(update).not.toHaveProperty('questions');
    expect(JSON.stringify(update).length).toBeLessThan(10_000);
  });
});
