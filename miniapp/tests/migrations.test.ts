import { describe, expect, it } from 'vitest';

import {
  CURRENT_SCHEMA_VERSION,
  createEmptyProgress,
  migrateProgress,
} from '../miniprogram/storage/migrations';

describe('progress migrations', () => {
  it('creates clean version-one data on first launch', () => {
    expect(migrateProgress(null)).toEqual({
      data: createEmptyProgress(),
      recovered: false,
    });
    expect(createEmptyProgress().schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('preserves valid version-one data', () => {
    const data = createEmptyProgress();
    data.favorites.Q1 = 1000;
    data.dailyTotals['2026-07-22'] = { answered: 2, correct: 1, durationMs: 900 };

    expect(migrateProgress(data)).toEqual({ data, recovered: false });
  });

  it('rejects a future schema version', () => {
    expect(() => migrateProgress({ ...createEmptyProgress(), schemaVersion: 2 })).toThrow(
      /newer schema version/,
    );
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
