import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadQuestionRecords } from '../miniprogram/data/question-bank';
import { LocalQuestionRepository } from '../miniprogram/repositories/local-question-repository';
import { buildPaper } from '../miniprogram/services/paper-builder';
import type { MembershipStatus } from '../miniprogram/types/membership';

const WAREHOUSE = '4-02-06-01' as const;
const INSPECTOR = '4-08-05-01' as const;
const memberStatus: MembershipStatus = {
  isMember: true,
  startsAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-10-01T00:00:00.000Z',
  freeUsed: 3,
  freeRemaining: 0,
  freeLimit: 3,
  freeDate: '2026-09-23',
  serverTime: '2026-09-23T00:00:00.000Z',
  paymentAvailable: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('published inspector runtime bank', () => {
  it('keeps warehouse unchanged and publishes all five isolated inspector levels', () => {
    const questionRecords = loadQuestionRecords();
    const warehouse = questionRecords.filter(({ occupation }) => occupation === WAREHOUSE);
    const inspector = questionRecords.filter(({ occupation }) => occupation === INSPECTOR);

    expect(warehouse).toHaveLength(3605);
    expect(questionRecords).toHaveLength(7428);
    expect(inspector).toHaveLength(3823);
    expect(
      Object.fromEntries(
        [5, 4, 3, 2, 1].map((level) => [
          level,
          inspector.filter((question) => question.level === level).length,
        ]),
      ),
    ).toEqual({ 5: 202, 4: 1102, 3: 875, 2: 1050, 1: 594 });
  });

  it('isolates both occupations and every inspector level in sequential, random and mock papers', async () => {
    const repository = new LocalQuestionRepository(loadQuestionRecords());
    const warehouse = await repository.list({ occupation: WAREHOUSE, level: 4 });

    expect(warehouse).toHaveLength(564);
    expect(warehouse.every(({ occupation }) => occupation === WAREHOUSE)).toBe(true);

    for (const level of [5, 4, 3, 2, 1] as const) {
      const inspector = await repository.list({ occupation: INSPECTOR, level });
      expect(inspector.length).toBeGreaterThanOrEqual(50);
      expect(
        inspector.every(
          (question) => question.occupation === INSPECTOR && question.level === level,
        ),
      ).toBe(true);
      for (const mode of ['sequential', 'random', 'mock'] as const) {
        const paper = buildPaper(inspector, { mode, limit: mode === 'mock' ? 50 : 20 });
        expect(paper).toHaveLength(mode === 'mock' ? 50 : 20);
        expect(
          paper.every((question) => question.occupation === INSPECTOR && question.level === level),
        ).toBe(true);
      }
    }
  });

  it.each([
    ['wrong', 2, 'QI-L2-000001', ['QI-L1-000001', 'QI-L3-000001', 'WH-L4-000001']],
    ['favorite', 1, 'QI-L1-000001', ['QI-L2-000001', 'QI-L3-000001', 'WH-L4-000001']],
  ] as const)(
    'uses real synced records without mixing inspector levels or occupations in %s practice',
    async (mode, level, inspectorId, excludedIds) => {
      vi.stubGlobal('wx', {
        getStorageSync: vi.fn(() => ''),
        setStorageSync: vi.fn(),
        removeStorageSync: vi.fn(),
      });
      const { appServices } = await import('../miniprogram/services/app-services');
      const { startPractice } = await import('../miniprogram/services/practice-runtime');
      vi.spyOn(appServices.membership, 'checkPermission').mockResolvedValue(memberStatus);
      appServices.progress.clearLearningData();
      if (mode === 'wrong') {
        for (const questionId of [inspectorId, ...excludedIds]) {
          appServices.progress.recordAnswer({
            questionId,
            correct: false,
            durationMs: 1,
            at: '2026-08-30',
          });
        }
      } else {
        appServices.progress.toggleFavorite(inspectorId, 2);
        for (const questionId of excludedIds) appServices.progress.toggleFavorite(questionId, 1);
      }

      const session = await startPractice({
        occupation: INSPECTOR,
        level,
        mode,
        limit: 20,
      });

      expect(session?.questions.map(({ id }) => id)).toEqual([inspectorId]);
      expect(session?.questions.every(({ occupation }) => occupation === INSPECTOR)).toBe(true);
      expect(session?.questions.every((question) => question.level === level)).toBe(true);
      appServices.progress.clearLearningData();
    },
  );
});
