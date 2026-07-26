import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { appServices as appServicesType } from '../miniprogram/services/app-services';
import type {
  resolveAnswerRevealMode as resolveAnswerRevealModeType,
  startPractice as startPracticeType,
  startPracticeFromQuestions as startPracticeFromQuestionsType,
} from '../miniprogram/services/practice-runtime';
import type { ProgressPreferences } from '../miniprogram/storage/migrations';
import { makeQuestion } from './factories';

interface RuntimeModule {
  resolveAnswerRevealMode: typeof resolveAnswerRevealModeType;
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
});
