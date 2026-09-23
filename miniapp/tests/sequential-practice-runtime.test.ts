import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageAdapter } from '../miniprogram/types/domain';
import { makeQuestion } from './factories';

const memoryStorage = (): StorageAdapter => {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: <T>(key: string, value: T) => values.set(key, value),
    remove: (key: string) => values.delete(key),
  };
};

const setup = async (
  questions = Array.from({ length: 55 }, (_, index) => makeQuestion({ id: `Q${index + 1}` })),
  scope: 'guest' | 'account' = 'guest',
) => {
  vi.resetModules();
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });
  const { appServices } = await import('../miniprogram/services/app-services');
  const { ProgressService } = await import('../miniprogram/services/progress-service');
  const { ProgressRepository } = await import('../miniprogram/storage/progress-repository');
  appServices.progress = new ProgressService(new ProgressRepository(memoryStorage()), scope);
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
  const runtime = await import('../miniprogram/services/practice-runtime');
  return { appServices, runtime, questions };
};

const allAnswers = (session: { questionIds: readonly string[] }) =>
  Object.fromEntries(session.questionIds.map((questionId) => [questionId, ['A']]));

describe('sequential practice runtime', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('covers an ordered bank in non-repeating groups and ends after completion', async () => {
    const { runtime } = await setup();
    const input = {
      occupation: '4-02-06-01' as const,
      level: 5 as const,
      mode: 'sequential' as const,
    };
    const groups: string[][] = [];

    for (let index = 0; index < 3; index += 1) {
      const started = await runtime.startPractice(input);
      expect(started).not.toBeNull();
      groups.push([...started!.questionIds]);
      runtime.saveActivePractice({ ...started!, answers: allAnswers(started!) });
      runtime.submitActivePractice();
      runtime.recordActivePractice();
    }

    expect(groups.map((group) => group.length)).toEqual([20, 20, 15]);
    expect(new Set(groups.flat()).size).toBe(55);
    await expect(runtime.startPractice(input)).resolves.toBeNull();
  });

  it('de-duplicates ids and carries unanswered questions into the following group', async () => {
    const questions = [
      ...Array.from({ length: 21 }, (_, index) => makeQuestion({ id: `Q${index + 1}` })),
      makeQuestion({ id: 'Q1' }),
    ];
    const { runtime } = await setup(questions);
    const input = {
      occupation: '4-02-06-01' as const,
      level: 5 as const,
      mode: 'sequential' as const,
    };
    const first = await runtime.startPractice(input);
    expect(first?.questionIds).toHaveLength(20);
    runtime.saveActivePractice({
      ...first!,
      answers: Object.fromEntries(first!.questionIds.slice(0, 19).map((id) => [id, ['A']])),
    });
    runtime.submitActivePractice();
    runtime.recordActivePractice();

    const next = await runtime.startPractice(input);
    expect(next?.questionIds).toEqual(['Q20', 'Q21']);
  });

  it('shares concurrent starts for the same certificate', async () => {
    const { runtime } = await setup();
    const input = {
      occupation: '4-02-06-01' as const,
      level: 5 as const,
      mode: 'sequential' as const,
    };
    const [first, second] = await Promise.all([
      runtime.startPractice(input),
      runtime.startPractice(input),
    ]);

    expect(first?.id).toBe(second?.id);
  });

  it('restores the certificate backup after another mode replaces the active session', async () => {
    const { runtime, questions } = await setup();
    const input = {
      occupation: '4-02-06-01' as const,
      level: 5 as const,
      mode: 'sequential' as const,
    };
    const sequential = await runtime.startPractice(input);
    await runtime.startPracticeFromQuestions([questions[0]!], 'mock');

    const restored = await runtime.startPractice(input);

    expect(restored?.id).toBe(sequential?.id);
    expect(restored?.questionIds).toEqual(sequential?.questionIds);
  });

  it('does not save a delayed start into a different scope', async () => {
    const { appServices, runtime, questions } = await setup();
    let resolveQuestions: ((value: typeof questions) => void) | undefined;
    vi.spyOn(appServices.questions, 'list').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );

    const starting = runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'sequential',
    });
    appServices.progress.switchScope('account');
    resolveQuestions?.(questions);

    await expect(starting).resolves.toBeNull();
    expect(appServices.progress.restoreSession()).toBeNull();
  });

  it('keeps a later certificate start when an earlier bank load finishes last', async () => {
    const { appServices, runtime, questions } = await setup();
    let resolveFirst: ((value: typeof questions) => void) | undefined;
    vi.spyOn(appServices.questions, 'list').mockImplementation((filter) => {
      const occupation = filter?.occupation;
      if (occupation === '4-02-06-01') {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve([
        makeQuestion({ id: 'QUALITY-Q1', occupation: '4-08-05-01', level: 5 }),
      ]);
    });

    const slow = runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'sequential',
    });
    const fast = await runtime.startPractice({
      occupation: '4-08-05-01',
      level: 5,
      mode: 'sequential',
    });
    resolveFirst?.(questions);

    await expect(slow).resolves.toBeNull();
    expect(runtime.getActivePractice()?.id).toBe(fast?.id);
  });

  it('invalidates a slow sequential start when a synchronous mode starts', async () => {
    const { appServices, runtime, questions } = await setup();
    let resolveQuestions: ((value: typeof questions) => void) | undefined;
    vi.spyOn(appServices.questions, 'list').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );

    const slow = runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'sequential',
    });
    const replacement = await runtime.startPracticeFromQuestions([questions[0]!], 'mock');
    resolveQuestions?.(questions);

    await expect(slow).resolves.toBeNull();
    expect(runtime.getActivePractice()?.id).toBe(replacement?.id);
  });

  it('cancels a loading sequential start without writing an active or backup session', async () => {
    const { appServices, runtime, questions } = await setup();
    let resolveQuestions: ((value: typeof questions) => void) | undefined;
    vi.spyOn(appServices.questions, 'list').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );
    const pending = runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'sequential',
    });

    runtime.getPracticeStartCancellation()();
    resolveQuestions?.(questions);

    await expect(pending).resolves.toBeNull();
    expect(runtime.getActivePractice()).toBeNull();
    expect(appServices.progress.restoreSequentialSession('4-02-06-01:5')).toBeNull();
  });

  it('cancels a loading chapter start without writing an active session', async () => {
    const { appServices, runtime, questions } = await setup();
    let resolveQuestions: ((value: typeof questions) => void) | undefined;
    vi.spyOn(appServices.questions, 'list').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );
    const pending = runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'chapter',
    });

    runtime.getPracticeStartCancellation()();
    resolveQuestions?.(questions);

    await expect(pending).resolves.toBeNull();
    expect(runtime.getActivePractice()).toBeNull();
    expect(appServices.progress.restoreSession()).toBeNull();
  });

  it('cancels a loading restore without changing the saved session', async () => {
    const { appServices, runtime, questions } = await setup();
    appServices.progress.saveSession({
      id: 'restore-session',
      mode: 'chapter',
      answerRevealMode: 'immediate',
      questionIds: ['Q1'],
      currentIndex: 0,
      answers: {},
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      progressRecorded: false,
    });
    let resolveQuestions: ((value: typeof questions) => void) | undefined;
    vi.spyOn(appServices.questions, 'getByIds').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );
    const pending = runtime.restorePractice();

    runtime.getPracticeStartCancellation()();
    resolveQuestions?.([questions[0]!]);

    await expect(pending).resolves.toBeNull();
    expect(runtime.getActivePractice()).toBeNull();
    expect(appServices.progress.restoreSession()?.id).toBe('restore-session');
  });

  it('does not let cancelling an old request cancel a newer start', async () => {
    const { appServices, runtime, questions } = await setup();
    let resolveOld: ((value: typeof questions) => void) | undefined;
    vi.spyOn(appServices.questions, 'list').mockImplementation((filter) => {
      if (filter?.occupation === '4-02-06-01') {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve([
        makeQuestion({ id: 'QUALITY-Q1', occupation: '4-08-05-01', level: 5 }),
      ]);
    });
    const old = runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'sequential',
    });
    const cancelOld = runtime.getPracticeStartCancellation();
    const latest = await runtime.startPractice({
      occupation: '4-08-05-01',
      level: 5,
      mode: 'sequential',
    });

    cancelOld();
    resolveOld?.(questions);

    await expect(old).resolves.toBeNull();
    expect(runtime.getActivePractice()?.id).toBe(latest?.id);
  });

  it('reuses the newest same-bank start after an older request becomes stale', async () => {
    const { appServices, runtime, questions } = await setup();
    let resolveFirst: ((value: typeof questions) => void) | undefined;
    let resolveSecond: ((value: typeof questions) => void) | undefined;
    let firstBankRequests = 0;
    vi.spyOn(appServices.questions, 'list').mockImplementation((filter) => {
      const occupation = filter?.occupation;
      if (occupation === '4-08-05-01') {
        return Promise.resolve([
          makeQuestion({ id: 'QUALITY-Q1', occupation: '4-08-05-01', level: 5 }),
        ]);
      }
      firstBankRequests += 1;
      return new Promise((resolve) => {
        if (firstBankRequests === 1) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    });
    const input = {
      occupation: '4-02-06-01' as const,
      level: 5 as const,
      mode: 'sequential' as const,
    };

    const stale = runtime.startPractice(input);
    await vi.waitFor(() => expect(firstBankRequests).toBe(1));
    await runtime.startPractice({ occupation: '4-08-05-01', level: 5, mode: 'sequential' });
    const current = runtime.startPractice(input);
    await vi.waitFor(() => expect(firstBankRequests).toBe(2));
    resolveFirst?.(questions);
    const reused = runtime.startPractice(input);
    resolveSecond?.([makeQuestion({ id: 'FRESH-Q1' })]);

    await expect(stale).resolves.toBeNull();
    await expect(reused).resolves.toMatchObject({ id: (await current)?.id });
    expect(firstBankRequests).toBe(2);
  });

  it('repairs a certificate backup when a question is removed from the bank', async () => {
    const { appServices, runtime, questions } = await setup();
    const input = {
      occupation: '4-02-06-01' as const,
      level: 5 as const,
      mode: 'sequential' as const,
    };
    const started = await runtime.startPractice(input);
    runtime.saveActivePractice({ ...started!, answers: { Q2: ['A'] } });
    vi.spyOn(appServices.questions, 'list').mockResolvedValue(questions.slice(1));

    const restored = await runtime.startPractice(input);

    expect(restored?.questionIds).toHaveLength(19);
    expect(restored?.questionIds).not.toContain('Q1');
    expect(restored?.answers).toEqual({ Q2: ['A'] });
  });

  it('replaces a certificate backup when none of its questions remain in the bank', async () => {
    const { appServices, runtime } = await setup(
      Array.from({ length: 20 }, (_, index) => makeQuestion({ id: `OLD-Q${index + 1}` })),
    );
    const input = {
      occupation: '4-02-06-01' as const,
      level: 5 as const,
      mode: 'sequential' as const,
    };
    await runtime.startPractice(input);
    vi.spyOn(appServices.questions, 'list').mockResolvedValue([makeQuestion({ id: 'NEW-Q1' })]);

    const replacement = await runtime.startPractice(input);

    expect(replacement?.questionIds).toEqual(['NEW-Q1']);
    expect(appServices.progress.restoreSequentialSession('4-02-06-01:5')?.questionIds).toEqual([
      'NEW-Q1',
    ]);
  });

  it('marks a zero-answer submission recorded without queuing an invalid account write', async () => {
    const { appServices, runtime } = await setup(undefined, 'account');
    const listener = vi.fn();
    appServices.progress.setAccountMutationListener(listener);
    const started = await runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'sequential',
    });
    listener.mockClear();
    runtime.submitActivePractice();

    const recorded = runtime.recordActivePractice();

    expect(recorded?.progressRecorded).toBe(true);
    expect(listener).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recordPractice' }),
    );
    expect(started).not.toBeNull();
  });
});
