import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeQuestion } from './factories';
import type { MembershipStatus } from '../miniprogram/types/membership';

const status: MembershipStatus = {
  isMember: false,
  startsAt: null,
  expiresAt: null,
  freeUsed: 1,
  freeRemaining: 2,
  freeLimit: 3,
  freeDate: '2026-09-05',
  serverTime: '2026-09-05T04:00:00.000Z',
  paymentAvailable: false,
};
const values = new Map<string, unknown>();
const input = { occupation: '4-02-06-01', level: 5, mode: 'random' } as const;

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  values.clear();
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => values.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => {
      values.set(key, value);
    },
    removeStorageSync: (key: string) => {
      values.delete(key);
    },
  });
});

const load = async () => {
  const { appServices } = await import('../miniprogram/services/app-services');
  const runtime = await import('../miniprogram/services/practice-runtime');
  const { MembershipError } = await import('../miniprogram/repositories/membership-client');
  const questions = Array.from({ length: 20 }, (_, i) => makeQuestion({ id: `Q${i}` }));
  vi.spyOn(appServices.questions, 'list').mockResolvedValue(questions);
  vi.spyOn(appServices.questions, 'getByIds').mockImplementation((ids) =>
    Promise.resolve(ids.map((id) => questions.find((question) => question.id === id)!)),
  );
  const admit = vi.spyOn(appServices.membership, 'startRandomPractice').mockResolvedValue(status);
  const validate = vi
    .spyOn(appServices.membership, 'validateRandomPractice')
    .mockResolvedValue(status);
  return { appServices, runtime, MembershipError, questions, admit, validate };
};

describe('random practice admission at every session entry', () => {
  it('does not charge migration when all questions in an old random session have been removed', async () => {
    const { runtime, appServices, admit, validate } = await load();
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue({
      id: 'removed-random',
      mode: 'random',
      questionIds: ['deleted'],
      answers: {},
      currentIndex: 0,
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      answerRevealMode: 'immediate',
    });
    vi.spyOn(appServices.questions, 'getByIds').mockResolvedValue([]);
    expect(await runtime.restorePractice()).toBeNull();
    expect(admit).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });
  it('keeps report reads free of pending admission but explicitly resumes it over an old submitted session', async () => {
    const { runtime, appServices, admit, validate } = await load();
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue({
      id: 'submitted-random',
      mode: 'random',
      questionIds: ['Q1'],
      answers: {},
      currentIndex: 0,
      status: 'submitted',
      startedAt: 1,
      updatedAt: 2,
      submittedAt: 2,
      answerRevealMode: 'immediate',
      progressRecorded: true,
    });
    values.set('membership.pending-random.v1', {
      key: JSON.stringify(input),
      id: 'pending-after-submitted',
      questionIds: ['Q1'],
      now: 3,
      answerRevealMode: 'immediate',
    });
    expect((await runtime.restorePractice())?.status).toBe('submitted');
    expect(admit).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
    expect((await runtime.restorePractice(true))?.id).toBe('pending-after-submitted');
    expect(admit).toHaveBeenCalledWith('pending-after-submitted', ['Q1']);
  });

  it('keeps an unrecorded submitted session and pending admission intact on explicit resume', async () => {
    const { runtime, appServices, admit } = await load();
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue({
      id: 'submitted-unrecorded',
      mode: 'random',
      questionIds: ['Q1'],
      answers: { Q1: ['A'] },
      currentIndex: 0,
      status: 'submitted',
      startedAt: 1,
      updatedAt: 2,
      submittedAt: 2,
      answerRevealMode: 'immediate',
      progressRecorded: false,
    });
    const pending = {
      key: JSON.stringify(input),
      id: 'pending-after-unrecorded',
      questionIds: ['Q1'],
      now: 3,
      answerRevealMode: 'immediate',
    };
    values.set('membership.pending-random.v1', pending);
    const restored = await runtime.restorePractice(true);
    expect(restored?.id).toBe('submitted-unrecorded');
    expect(restored?.answers).toEqual({ Q1: ['A'] });
    expect(admit).not.toHaveBeenCalled();
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
  });

  it('reuses the same pending grant after a guest/account scope transition', async () => {
    const { runtime, appServices, admit } = await load();
    let scope: 'guest' | 'account' = 'guest';
    vi.spyOn(appServices.progress, 'getScope').mockImplementation(() => scope);
    admit.mockImplementationOnce(() => {
      scope = 'account';
      return Promise.resolve(status);
    });
    await expect(runtime.startPractice(input)).rejects.toThrow('账号状态');
    const first = admit.mock.calls[0];
    await runtime.startPractice(input);
    expect(admit.mock.calls[1]).toEqual(first);
  });
  it('prepares at most ten questions, awaits cloud admission, then saves exactly one start for double taps', async () => {
    const { appServices, runtime, admit } = await load();
    let release!: (value: MembershipStatus) => void;
    admit.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const saved = vi.spyOn(appServices.progress, 'saveSession');
    const first = runtime.startPractice(input);
    const second = runtime.startPractice(input);
    await vi.waitFor(() => expect(admit).toHaveBeenCalledTimes(1));
    expect(saved).not.toHaveBeenCalled();
    expect(runtime.getActivePractice()).toBeNull();
    release(status);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a?.questionIds).toHaveLength(10);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('never spends quota on an empty bank and leaves a previous session intact on denial', async () => {
    const { appServices, runtime, questions, admit, MembershipError } = await load();
    const previous = runtime.startPracticeFromQuestions(questions, 'sequential');
    admit.mockRejectedValue(new MembershipError('DAILY_LIMIT_REACHED'));
    await expect(runtime.startPractice(input)).rejects.toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
    });
    expect(runtime.getActivePractice()).toBe(previous);
    admit.mockClear();
    vi.spyOn(appServices.questions, 'list').mockResolvedValue([]);
    await expect(runtime.startPractice(input)).resolves.toBeNull();
    expect(admit).not.toHaveBeenCalled();
  });

  it('reuses the prepared session and request after a lost cloud response', async () => {
    const { runtime, admit, MembershipError } = await load();
    admit.mockRejectedValueOnce(new MembershipError('MEMBERSHIP_UNAVAILABLE'));
    await expect(runtime.startPractice(input)).rejects.toThrow();
    const firstRequest = admit.mock.calls[0];
    const session = await runtime.startPractice(input);
    expect(admit.mock.calls[1]).toEqual(firstRequest);
    expect(session?.id).toBe(firstRequest?.[0]);
    expect(values.has('membership.pending-random.v1')).toBe(false);
  });

  it('restores a persisted random admission after its successful response was lost, even at quota zero', async () => {
    const { runtime, appServices, admit } = await load();
    values.set('membership.pending-random.v1', {
      key: JSON.stringify(input),
      id: 'lost-response-session',
      questionIds: ['Q1'],
      now: 1,
      answerRevealMode: 'immediate',
    });
    admit.mockResolvedValue({ ...status, freeRemaining: 0 });
    const saved = vi.spyOn(appServices.progress, 'saveSession');
    const restored = await runtime.restorePractice(true);
    expect(restored?.id).toBe('lost-response-session');
    expect(admit).toHaveBeenCalledWith('lost-response-session', ['Q1']);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(values.has('membership.pending-random.v1')).toBe(false);
  });

  it('keeps a pending admission when the cloud still denies it or saving the session fails', async () => {
    const { runtime, appServices, admit, MembershipError } = await load();
    const pending = {
      key: JSON.stringify(input),
      id: 'pending-denied',
      questionIds: ['Q1'],
      now: 1,
      answerRevealMode: 'immediate',
    };
    values.set('membership.pending-random.v1', pending);
    admit.mockRejectedValueOnce(new MembershipError('DAILY_LIMIT_REACHED'));
    await expect(runtime.restorePractice(true)).rejects.toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
    });
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
    admit.mockResolvedValueOnce(status);
    vi.spyOn(appServices.progress, 'saveSession').mockImplementationOnce(() => {
      throw new Error('save failed');
    });
    await expect(runtime.restorePractice(true)).rejects.toThrow('save failed');
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
  });

  it('keeps an active local session and a pending record when recovery cannot find every question', async () => {
    const { runtime, appServices, questions, admit } = await load();
    const active = runtime.startPracticeFromQuestions(questions, 'sequential');
    const pending = {
      key: JSON.stringify(input),
      id: 'pending-preserved',
      questionIds: ['missing'],
      now: 1,
      answerRevealMode: 'immediate',
    };
    values.set('membership.pending-random.v1', pending);
    expect(await runtime.restorePractice()).toBe(active);
    expect(admit).not.toHaveBeenCalled();
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue(null);
    vi.spyOn(appServices.questions, 'getByIds').mockResolvedValue([]);
    await expect(runtime.restorePractice(true)).rejects.toThrow('已保留恢复记录');
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
  });

  it('does not save or clear a pending admission when scope or persisted storage changes while awaiting it', async () => {
    const { runtime, appServices, admit } = await load();
    const pending = {
      key: JSON.stringify(input),
      id: 'pending-race',
      questionIds: ['Q1'],
      now: 1,
      answerRevealMode: 'immediate',
    };
    values.set('membership.pending-random.v1', pending);
    let scope: 'guest' | 'account' = 'guest';
    let resolveAdmission!: (value: MembershipStatus) => void;
    vi.spyOn(appServices.progress, 'getScope').mockImplementation(() => scope);
    admit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdmission = resolve;
        }),
    );
    const restoring = runtime.restorePractice(true);
    await vi.waitFor(() => expect(admit).toHaveBeenCalledTimes(1));
    scope = 'account';
    resolveAdmission(status);
    await expect(restoring).rejects.toThrow('账号状态');
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
    expect(runtime.getActivePractice()).toBeNull();
  });

  it('does not let an older completion clear a replacement pending record', async () => {
    await load();
    const access = await import('../miniprogram/services/random-practice-access');
    const replacement = {
      key: 'replacement-key',
      id: 'replacement-id',
      questionIds: ['Q1'],
      now: 2,
      answerRevealMode: 'deferred',
    };
    values.set('membership.pending-random.v1', replacement);
    access.finishRandomStart('old-id', 'old-key');
    expect(values.get('membership.pending-random.v1')).toEqual(replacement);
  });

  it('never replaces a pending random admission when normal or report retry keys differ', async () => {
    const { runtime, questions, admit } = await load();
    const pending = {
      key: 'original-key',
      id: 'original-id',
      questionIds: ['Q1'],
      now: 1,
      answerRevealMode: 'immediate',
    };
    values.set('membership.pending-random.v1', pending);
    await expect(runtime.startPractice(input)).rejects.toThrow('先恢复上次随机练习');
    await expect(runtime.startRandomPracticeFromQuestions(questions)).rejects.toThrow(
      '先恢复上次随机练习',
    );
    expect(admit).not.toHaveBeenCalled();
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
  });

  it('does not save a report retry when scope changes after authorization resolves', async () => {
    const { runtime, appServices, questions, admit } = await load();
    let scope: 'guest' | 'account' = 'guest';
    let scopeReads = 0;
    vi.spyOn(appServices.progress, 'getScope').mockImplementation(() => {
      scopeReads += 1;
      if (scopeReads === 4) queueMicrotask(() => (scope = 'account'));
      return scope;
    });
    const saved = vi.spyOn(appServices.progress, 'saveSession');
    admit.mockResolvedValue(status);
    await expect(runtime.startRandomPracticeFromQuestions(questions)).resolves.toBeNull();
    expect(saved).not.toHaveBeenCalled();
    expect(values.has('membership.pending-random.v1')).toBe(true);
  });

  it('does not overwrite a newly persisted practice while pending admission is awaiting the cloud', async () => {
    const { runtime, appServices, admit } = await load();
    const pending = {
      key: JSON.stringify(input),
      id: 'pending-storage-race',
      questionIds: ['Q1'],
      now: 1,
      answerRevealMode: 'immediate',
    };
    values.set('membership.pending-random.v1', pending);
    let persisted: ReturnType<typeof appServices.progress.restoreSession> = null;
    vi.spyOn(appServices.progress, 'restoreSession').mockImplementation(() => persisted);
    let resolveAdmission!: (value: MembershipStatus) => void;
    admit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdmission = resolve;
        }),
    );
    const restoring = runtime.restorePractice(true);
    await vi.waitFor(() => expect(admit).toHaveBeenCalledTimes(1));
    persisted = {
      id: 'new-active',
      mode: 'sequential',
      questionIds: ['Q1'],
      answers: {},
      currentIndex: 0,
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      answerRevealMode: 'immediate',
    };
    resolveAdmission(status);
    await expect(restoring).resolves.toBeNull();
    expect(values.get('membership.pending-random.v1')).toEqual(pending);
  });

  it('rechecks restored local random sessions and refuses a forged question list', async () => {
    const { runtime, appServices, validate, MembershipError } = await load();
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue({
      id: 'random-existing',
      mode: 'random',
      questionIds: ['Q1'],
      answers: {},
      currentIndex: 0,
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      answerRevealMode: 'immediate',
    });
    validate.mockRejectedValue(new MembershipError('INVALID_GRANT'));
    await expect(runtime.restorePractice()).rejects.toMatchObject({ code: 'INVALID_GRANT' });
    expect(runtime.getActivePractice()).toBeNull();
  });

  it('migrates an old random session through cloud admission once and keeps existing questions', async () => {
    const { runtime, appServices, validate, admit, MembershipError } = await load();
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue({
      id: 'session-legacy',
      mode: 'random',
      questionIds: ['Q1'],
      answers: {},
      currentIndex: 0,
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      answerRevealMode: 'immediate',
    });
    validate.mockRejectedValue(new MembershipError('GRANT_NOT_FOUND'));
    const session = await runtime.restorePractice();
    expect(admit).toHaveBeenCalledWith('session-legacy', ['Q1']);
    expect(session?.questionIds).toEqual(['Q1']);
    await runtime.restorePractice();
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('does not install an asynchronously restored session into a different progress scope', async () => {
    const { runtime, appServices, questions } = await load();
    let scope: 'guest' | 'account' = 'guest';
    let resolveQuestions!: (value: typeof questions) => void;
    vi.spyOn(appServices.progress, 'getScope').mockImplementation(() => scope);
    vi.spyOn(appServices.progress, 'restoreSession').mockReturnValue({
      id: 'guest-session',
      mode: 'sequential',
      questionIds: ['Q1'],
      answers: {},
      currentIndex: 0,
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      answerRevealMode: 'immediate',
    });
    vi.spyOn(appServices.questions, 'getByIds').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );
    const saved = vi.spyOn(appServices.progress, 'saveSession');

    const restoring = runtime.restorePractice();
    scope = 'account';
    resolveQuestions(questions);

    await expect(restoring).resolves.toBeNull();
    expect(runtime.getActivePractice()).toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });

  it('drops a restore when account synchronization replaces the persisted session in the same scope', async () => {
    const { runtime, appServices, validate } = await load();
    const restoring = {
      id: 'account-before-sync',
      mode: 'random' as const,
      questionIds: ['Q1'],
      answers: {},
      currentIndex: 0,
      status: 'active' as const,
      startedAt: 1,
      updatedAt: 1,
      answerRevealMode: 'immediate' as const,
    };
    const afterSync = { ...restoring, id: 'account-after-sync' };
    vi.spyOn(appServices.progress, 'restoreSession')
      .mockReturnValueOnce(restoring)
      .mockReturnValue(afterSync);

    await expect(runtime.restorePractice()).resolves.toBeNull();
    expect(validate).not.toHaveBeenCalled();
    expect(runtime.getActivePractice()).toBeNull();
  });

  it('report retries obtain a new grant and synchronous supplied-question calls cannot bypass it', async () => {
    const { runtime, questions, admit } = await load();
    const first = await runtime.startRandomPracticeFromQuestions(questions);
    const second = await runtime.startRandomPracticeFromQuestions(questions);
    expect(first?.id).not.toEqual(second?.id);
    expect(admit).toHaveBeenCalledTimes(2);
    expect(() => runtime.startPracticeFromQuestions(questions, 'random')).toThrow('云端授权');
  });
});
