import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { appServices as appServicesType } from '../miniprogram/services/app-services';
import type {
  resolveAnswerRevealMode as resolveAnswerRevealModeType,
  getActivePractice as getActivePracticeType,
  restorePractice as restorePracticeType,
  saveActivePractice as saveActivePracticeType,
  startPractice as startPracticeType,
  startPracticeFromQuestions as startPracticeFromQuestionsType,
} from '../miniprogram/services/practice-runtime';
import type { ProgressPreferences } from '../miniprogram/storage/migrations';
import type { PersistedPracticeSession } from '../miniprogram/storage/migrations';
import { ProgressService } from '../miniprogram/services/progress-service';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import type { StorageAdapter } from '../miniprogram/types/domain';
import { makeQuestion } from './factories';

interface RuntimeModule {
  resolveAnswerRevealMode: typeof resolveAnswerRevealModeType;
  getActivePractice: typeof getActivePracticeType;
  restorePractice: typeof restorePracticeType;
  saveActivePractice: typeof saveActivePracticeType;
  startPractice: typeof startPracticeType;
  startPracticeFromQuestions: typeof startPracticeFromQuestionsType;
}

interface AppServicesModule {
  appServices: typeof appServicesType;
}

let runtime: RuntimeModule;
let servicesModule: AppServicesModule;

beforeAll(async () => {
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });
  servicesModule = await import('../miniprogram/services/app-services');
  runtime = await import('../miniprogram/services/practice-runtime');
});

beforeEach(() => {
  vi.restoreAllMocks();
});

const preferencesWith = (
  answerRevealMode: ProgressPreferences['answerRevealMode'],
): ProgressPreferences => ({
  selectedCertificateKey: '4-02-06-01:5',
  dailyGoal: 20,
  answerTheme: 'light',
  nickname: '仓廪小麦',
  avatarUrl: '',
  answerRevealMode,
});

const memoryStorage = (): StorageAdapter => {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: <T>(key: string, value: T) => values.set(key, value),
    remove: (key: string) => values.delete(key),
  };
};

const reorderPersistedSession = (session: PersistedPracticeSession): PersistedPracticeSession => {
  const { answerRevealMode, answers, ...remaining } = session;
  return {
    ...remaining,
    answers: Object.fromEntries(Object.entries(answers).reverse()),
    answerRevealMode,
  };
};

describe('practice runtime reveal policy', () => {
  it('forces mock practice to deferred and otherwise keeps the saved preference', () => {
    expect(runtime.resolveAnswerRevealMode('mock', 'immediate')).toBe('deferred');
    expect(runtime.resolveAnswerRevealMode('random', 'deferred')).toBe('deferred');
    expect(runtime.resolveAnswerRevealMode('sequential', 'immediate')).toBe('immediate');
  });

  it('locks the saved preference when starting practice from supplied questions', () => {
    const preference = vi
      .spyOn(servicesModule.appServices.progress, 'getPreferences')
      .mockReturnValue(preferencesWith('deferred'));

    const session = runtime.startPracticeFromQuestions([makeQuestion()], 'sequential');
    preference.mockReturnValue(preferencesWith('immediate'));

    expect(session?.answerRevealMode).toBe('deferred');
  });

  it('locks the saved preference when starting repository-backed practice', async () => {
    vi.spyOn(servicesModule.appServices.progress, 'getPreferences').mockReturnValue(
      preferencesWith('deferred'),
    );
    vi.spyOn(servicesModule.appServices.questions, 'list').mockResolvedValue([
      makeQuestion({ id: 'RUNTIME-Q1' }),
    ]);

    const session = await runtime.startPractice({
      occupation: '4-02-06-01',
      level: 5,
      mode: 'sequential',
      limit: 10,
    });

    expect(session?.answerRevealMode).toBe('deferred');
  });

  it('forces supplied mock practice to deferred despite an immediate preference', () => {
    vi.spyOn(servicesModule.appServices.progress, 'getPreferences').mockReturnValue(
      preferencesWith('immediate'),
    );

    const session = runtime.startPracticeFromQuestions([makeQuestion()], 'mock');

    expect(session?.answerRevealMode).toBe('deferred');
  });

  it('invalidates the in-memory session after the progress scope changes', () => {
    let scope: 'guest' | 'account' = 'guest';
    vi.spyOn(servicesModule.appServices.progress, 'getScope').mockImplementation(() => scope);

    const session = runtime.startPracticeFromQuestions([makeQuestion()], 'sequential');
    scope = 'account';

    expect(session).not.toBeNull();
    expect(runtime.getActivePractice()).toBeNull();
  });

  it('does not let an old page save its held session into a new progress scope', () => {
    let scope: 'guest' | 'account' = 'guest';
    vi.spyOn(servicesModule.appServices.progress, 'getScope').mockImplementation(() => scope);
    const saved = vi.spyOn(servicesModule.appServices.progress, 'saveSession');

    const session = runtime.startPracticeFromQuestions([makeQuestion()], 'sequential');
    scope = 'account';
    runtime.saveActivePractice({ ...session! });

    expect(saved).toHaveBeenCalledTimes(1);
    expect(runtime.getActivePractice()).toBeNull();
  });

  it('keeps a live session when a real account-cache refresh rebuilds equal session data', () => {
    const original = servicesModule.appServices.progress;
    const progress = new ProgressService(new ProgressRepository(memoryStorage()), 'account');
    servicesModule.appServices.progress = progress;
    try {
      const session = runtime.startPracticeFromQuestions([makeQuestion()], 'sequential');
      const beforeRefresh = progress.restoreSession();
      progress.refreshAccountSnapshot();

      expect(progress.restoreSession()).toEqual(beforeRefresh);
      expect(progress.restoreSession()).not.toBe(beforeRefresh);
      expect(runtime.getActivePractice()).toBe(session);
    } finally {
      servicesModule.appServices.progress = original;
    }
  });

  it('keeps a live session when cloud synchronization reorders session and answer fields', () => {
    const original = servicesModule.appServices.progress;
    const progress = new ProgressService(new ProgressRepository(memoryStorage()), 'account');
    servicesModule.appServices.progress = progress;
    try {
      const session = runtime.startPracticeFromQuestions(
        [makeQuestion({ id: 'Q1' }), makeQuestion({ id: 'Q2' })],
        'sequential',
      );
      runtime.saveActivePractice({ ...session!, answers: { Q1: ['A'], Q2: ['B'] } });
      const beforeRefresh = progress.restoreSession();
      vi.spyOn(progress, 'restoreSession').mockReturnValue(reorderPersistedSession(beforeRefresh!));

      expect(runtime.getActivePractice()).toMatchObject({ id: session?.id });
    } finally {
      servicesModule.appServices.progress = original;
    }
  });

  it.each([
    ['id', (session: PersistedPracticeSession) => ({ ...session, id: 'changed-id' })],
    [
      'question order',
      (session: PersistedPracticeSession) => ({
        ...session,
        questionIds: [...session.questionIds].reverse(),
      }),
    ],
    ['current index', (session: PersistedPracticeSession) => ({ ...session, currentIndex: 1 })],
    ['answers', (session: PersistedPracticeSession) => ({ ...session, answers: { Q1: ['B'] } })],
    [
      'status',
      (session: PersistedPracticeSession) => ({ ...session, status: 'submitted', submittedAt: 2 }),
    ],
  ])('invalidates a live session when its persisted %s changes', (_change, change) => {
    runtime.startPracticeFromQuestions(
      [makeQuestion({ id: 'Q1' }), makeQuestion({ id: 'Q2' })],
      'sequential',
    );
    const persisted = servicesModule.appServices.progress.restoreSession();
    vi.spyOn(servicesModule.appServices.progress, 'restoreSession').mockReturnValue(
      change(persisted!) as PersistedPracticeSession,
    );

    expect(runtime.getActivePractice()).toBeNull();
  });

  it('treats an omitted progressRecorded value as false and still invalidates a cleared session', () => {
    const session = runtime.startPracticeFromQuestions([makeQuestion({ id: 'Q1' })], 'sequential');
    const persisted = servicesModule.appServices.progress.restoreSession();
    const legacySession = { ...persisted! };
    delete legacySession.progressRecorded;
    vi.spyOn(servicesModule.appServices.progress, 'restoreSession').mockReturnValue(legacySession);

    expect(runtime.getActivePractice()).toMatchObject({ id: session?.id });

    vi.spyOn(servicesModule.appServices.progress, 'restoreSession').mockReturnValue(null);
    expect(runtime.getActivePractice()).toBeNull();
  });

  it('restores a session when cloud synchronization only reorders fields while questions load', async () => {
    let scope: 'guest' | 'account' = 'guest';
    vi.spyOn(servicesModule.appServices.progress, 'getScope').mockImplementation(() => scope);
    const questions = [makeQuestion({ id: 'Q1' }), makeQuestion({ id: 'Q2' })];
    const started = runtime.startPracticeFromQuestions(questions, 'sequential');
    const persisted = servicesModule.appServices.progress.restoreSession()!;
    let latest = persisted;
    vi.spyOn(servicesModule.appServices.progress, 'restoreSession').mockImplementation(
      () => latest,
    );
    let resolveQuestions: ((value: typeof questions) => void) | undefined;
    vi.spyOn(servicesModule.appServices.questions, 'getByIds').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );
    scope = 'account';

    const restoring = runtime.restorePractice();
    latest = reorderPersistedSession(persisted);
    resolveQuestions?.(questions);

    await expect(restoring).resolves.toMatchObject({ id: started?.id });
  });
});
