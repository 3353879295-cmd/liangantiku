import { describe, expect, it } from 'vitest';

import {
  CURRENT_SCHEMA_VERSION,
  createEmptyProgress,
  migrateProgress,
} from '../miniprogram/storage/migrations';

const createVersionOneProgressFixture = () => ({
  schemaVersion: 1 as const,
  answers: [],
  wrongQuestions: {
    'WH-L5-000002': {
      questionId: 'WH-L5-000002',
      errorCount: 1,
      firstWrongAt: '2026-07-24',
      lastWrongAt: '2026-07-24',
      mastered: false,
      lastRetryCorrect: false,
    },
  },
  favorites: { 'WH-L5-000003': 1_753_392_000_000 },
  session: {
    id: 'session-v1',
    mode: 'sequential' as const,
    questionIds: ['WH-L5-000004'],
    currentIndex: 0,
    answers: { 'WH-L5-000004': ['A'] },
    status: 'active' as const,
    startedAt: 1_753_392_000_000,
    updatedAt: 1_753_392_001_000,
  },
  dailyTotals: {
    '2026-07-25': { answered: 1, correct: 1, durationMs: 1200 },
  },
  recordedSessionIds: ['submitted-v1'],
  preferences: {
    selectedCertificateKey: '4-02-06-01:5' as const,
    dailyGoal: 20,
  },
});

const createVersionTwoProgressFixture = (mode: 'mock' | 'sequential' = 'sequential') => ({
  schemaVersion: 2 as const,
  answers: [],
  wrongQuestions: {},
  favorites: {},
  session: {
    id: `session-v2-${mode}`,
    mode,
    questionIds: ['WH-L5-000004'],
    currentIndex: 0,
    answers: { 'WH-L5-000004': ['A'] },
    status: 'active' as const,
    startedAt: 1_753_392_000_000,
    updatedAt: 1_753_392_001_000,
  },
  dailyTotals: {},
  recordedSessionIds: [],
  preferences: {
    selectedCertificateKey: '4-02-06-01:5' as const,
    dailyGoal: 20,
    answerTheme: 'light' as const,
    nickname: '仓廪小麦',
    avatarUrl: '',
  },
});

describe('progress migrations', () => {
  it('creates clean current-version data on first launch', () => {
    expect(migrateProgress(null)).toEqual({
      data: createEmptyProgress(),
      recovered: false,
    });
    expect(createEmptyProgress().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(createEmptyProgress().preferences.answerRevealMode).toBe('immediate');
  });

  it('preserves valid current-version data', () => {
    const data = createEmptyProgress();
    data.favorites.Q1 = 1000;
    data.dailyTotals['2026-07-22'] = { answered: 2, correct: 1, durationMs: 900 };

    expect(migrateProgress(data)).toEqual({ data, recovered: false });
  });

  it('migrates version-one preferences without losing learning data', () => {
    const versionOne = {
      ...createVersionOneProgressFixture(),
      answers: [
        {
          questionId: 'WH-L5-000001',
          correct: true,
          durationMs: 1200,
          at: '2026-07-25',
        },
      ],
    };

    const result = migrateProgress(versionOne);

    expect(result.recovered).toBe(false);
    expect(result.data.answers).toEqual(versionOne.answers);
    expect(result.data.wrongQuestions).toEqual(versionOne.wrongQuestions);
    expect(result.data.favorites).toEqual(versionOne.favorites);
    expect(result.data.session).toEqual({
      ...versionOne.session,
      answerRevealMode: 'immediate',
    });
    expect(result.data.dailyTotals).toEqual(versionOne.dailyTotals);
    expect(result.data.recordedSessionIds).toEqual(versionOne.recordedSessionIds);
    expect(result.data.preferences).toMatchObject({
      selectedCertificateKey: '4-02-06-01:5',
      dailyGoal: 20,
      answerTheme: 'light',
      nickname: '仓廪小麦',
      answerRevealMode: 'immediate',
    });
  });

  it('adds the immediate reveal preference when migrating version-two data', () => {
    const versionTwo = { ...createVersionTwoProgressFixture(), session: null };

    expect(migrateProgress(versionTwo).data.preferences.answerRevealMode).toBe('immediate');
  });

  it('keeps legacy mock sessions deferred when migrating version-two data', () => {
    const versionTwoMock = createVersionTwoProgressFixture('mock');

    expect(migrateProgress(versionTwoMock).data.session?.answerRevealMode).toBe('deferred');
  });

  it('keeps legacy sequential sessions immediate when migrating version-two data', () => {
    const versionTwoSequential = createVersionTwoProgressFixture('sequential');

    expect(migrateProgress(versionTwoSequential).data.session?.answerRevealMode).toBe('immediate');
  });

  it('returns a safe recovery result for a future schema version', () => {
    const result = migrateProgress({ ...createEmptyProgress(), schemaVersion: 4 });

    expect(result).toEqual({
      data: createEmptyProgress(),
      recovered: true,
      reason: 'unsupported learning data schema version 4',
    });
  });

  it('repairs only a damaged current answer-reveal preference and preserves learning data', () => {
    const damaged = createEmptyProgress();
    damaged.favorites.Q1 = 1000;
    const result = migrateProgress({
      ...damaged,
      preferences: { ...damaged.preferences, answerRevealMode: 'unknown' },
    });

    expect(result.recovered).toBe(true);
    expect(result.data.favorites).toEqual({ Q1: 1000 });
    expect(result.data.preferences.answerRevealMode).toBe('immediate');
  });

  it('repairs a missing current answer-reveal preference without clearing learning data', () => {
    const damaged = createEmptyProgress();
    damaged.answers.push({
      questionId: 'Q1',
      correct: true,
      durationMs: 1200,
      at: '2026-07-25',
    });
    const result = migrateProgress({
      ...damaged,
      preferences: {
        selectedCertificateKey: damaged.preferences.selectedCertificateKey,
        dailyGoal: damaged.preferences.dailyGoal,
        answerTheme: damaged.preferences.answerTheme,
        nickname: damaged.preferences.nickname,
        avatarUrl: damaged.preferences.avatarUrl,
      },
    });

    expect(result.recovered).toBe(true);
    expect(result.data.answers).toEqual(damaged.answers);
    expect(result.data.preferences.answerRevealMode).toBe('immediate');
  });

  it('rejects a damaged current persisted-session reveal mode', () => {
    const current = createEmptyProgress();
    const result = migrateProgress({
      ...current,
      schemaVersion: 3,
      session: {
        id: 'session-v3',
        mode: 'sequential',
        questionIds: ['Q1'],
        currentIndex: 0,
        answers: {},
        status: 'active',
        startedAt: 1000,
        updatedAt: 1200,
        answerRevealMode: 'unknown',
      },
    });

    expect(result).toMatchObject({
      recovered: true,
      data: createEmptyProgress(),
      reason: 'invalid learning data',
    });
  });

  it('recovers from damaged current-version data', () => {
    const result = migrateProgress({
      ...createEmptyProgress(),
      wrongQuestions: null,
    });

    expect(result.recovered).toBe(true);
    expect(result.data).toEqual(createEmptyProgress());
    expect(result.reason).toMatch(/invalid/);
  });

  it('rejects malformed nested records instead of trusting container shapes', () => {
    const damaged = {
      ...createEmptyProgress(),
      answers: [{ questionId: '', correct: 'yes', durationMs: -1, at: 'today' }],
      preferences: { selectedCertificateKey: 'unknown', dailyGoal: 0 },
    };

    expect(migrateProgress(damaged)).toMatchObject({
      recovered: true,
      data: createEmptyProgress(),
    });
  });
});
