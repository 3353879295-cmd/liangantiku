import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { appServices as appServicesType } from '../miniprogram/services/app-services';
import type {
  resolveAnswerRevealMode as resolveAnswerRevealModeType,
  getActivePractice as getActivePracticeType,
  saveActivePractice as saveActivePracticeType,
  startPractice as startPracticeType,
  startPracticeFromQuestions as startPracticeFromQuestionsType,
} from '../miniprogram/services/practice-runtime';
import type { ProgressPreferences } from '../miniprogram/storage/migrations';
import { ProgressService } from '../miniprogram/services/progress-service';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import type { StorageAdapter } from '../miniprogram/types/domain';
import { makeQuestion } from './factories';

interface RuntimeModule {
  resolveAnswerRevealMode: typeof resolveAnswerRevealModeType;
  getActivePractice: typeof getActivePracticeType;
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
});
