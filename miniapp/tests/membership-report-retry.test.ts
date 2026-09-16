import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeQuestion } from './factories';

interface ReportPage {
  data: Record<string, unknown>;
  onRetry(): Promise<void>;
}

const randomSession = {
  id: 'report-random-session',
  mode: 'random' as const,
  questions: [makeQuestion({ id: 'REPORT-RANDOM-Q1' })],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('membership report retry', () => {
  it('reuses an authorized random retry when the first redirect fails', async () => {
    vi.resetModules();
    let page: ReportPage | undefined;
    const startRandomPracticeFromQuestions = vi.fn().mockResolvedValue(randomSession);
    vi.doMock('../miniprogram/services/practice-runtime', () => ({
      getActivePractice: vi.fn(() => randomSession),
      recordActivePractice: vi.fn(),
      restorePractice: vi.fn(),
      startPracticeFromQuestions: vi.fn(),
      startRandomPracticeFromQuestions,
      submitActivePractice: vi.fn(),
    }));
    vi.doMock('../miniprogram/services/app-services', () => ({
      appServices: { theme: { get: vi.fn(() => 'light'), toggle: vi.fn(() => 'night') } },
    }));
    const redirectTo = vi
      .fn()
      .mockRejectedValueOnce(new Error('navigation interrupted'))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal('wx', {
      redirectTo,
      showToast: vi.fn(),
      navigateTo: vi.fn(),
      switchTab: vi.fn(),
    });
    vi.stubGlobal('Page', (definition: ReportPage) => {
      page = definition;
    });

    await import('../miniprogram/pages/report/index');
    if (!page) throw new Error('report page was not registered');
    const context = {
      data: structuredClone(page.data),
      setData(update: Record<string, unknown>) {
        Object.assign(this.data, update);
      },
    };

    await page.onRetry.call(context);
    await page.onRetry.call(context);

    expect(startRandomPracticeFromQuestions).toHaveBeenCalledTimes(1);
    expect(redirectTo).toHaveBeenCalledTimes(2);
    expect(context.data.retrying).toBe(false);
  });

  it('restores a submitted random session without requesting a new admission', async () => {
    vi.resetModules();
    vi.doUnmock('../miniprogram/services/practice-runtime');
    vi.doUnmock('../miniprogram/services/app-services');
    const values = new Map<string, unknown>();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => values.get(key) ?? '',
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
      removeStorageSync: (key: string) => values.delete(key),
    });
    const { appServices } = await import('../miniprogram/services/app-services');
    const runtime = await import('../miniprogram/services/practice-runtime');
    const question = makeQuestion({ id: 'SUBMITTED-RANDOM-Q1' });
    vi.spyOn(appServices.questions, 'getByIds').mockResolvedValue([question]);
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue({
      id: 'submitted-random-session',
      mode: 'random',
      questionIds: [question.id],
      answers: { [question.id]: ['A'] },
      currentIndex: 0,
      status: 'submitted',
      startedAt: 1,
      updatedAt: 2,
      submittedAt: 2,
      answerRevealMode: 'immediate',
      progressRecorded: false,
    });
    const admit = vi.spyOn(appServices.membership, 'startRandomPractice');
    const validate = vi.spyOn(appServices.membership, 'validateRandomPractice');

    await expect(runtime.restorePractice()).resolves.toMatchObject({ status: 'submitted' });
    expect(admit).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });
});
