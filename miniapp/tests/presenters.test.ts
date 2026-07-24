import { describe, expect, it } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import { KNOWLEDGE_CATALOG } from '../miniprogram/data/knowledge-catalog';
import {
  findCatalogChapterLabel,
  findCatalogChapterTitle,
  presentCatalogParts as presentCatalogPartsDirect,
} from '../miniprogram/presenters/catalog-presenter';
import type { RuntimeKnowledgeCatalog } from '../miniprogram/types/knowledge-catalog';
import { presentDashboard } from '../miniprogram/presenters/home-presenter';
import {
  groupCertificates,
  presentCatalogParts,
  presentLibraryModules,
} from '../miniprogram/presenters/library-presenter';
import { presentQuestionOption } from '../miniprogram/presenters/question-option-presenter';
import { presentQuestionList } from '../miniprogram/presenters/question-list-presenter';
import { presentReport } from '../miniprogram/presenters/report-presenter';
import { makeQuestion } from './factories';

describe('presentDashboard', () => {
  it('formats an untouched learning dashboard without dividing by zero', () => {
    expect(
      presentDashboard({
        answered: 0,
        correct: 0,
        accuracy: 0,
        durationMs: 0,
        streakDays: 0,
        todayAnswered: 0,
        dailyGoal: 20,
      }),
    ).toMatchObject({
      accuracyText: '0%',
      durationText: '0 分钟',
      streakText: '从今天开始',
      goalText: '0 / 20 题',
      goalPercent: 0,
    });
  });

  it('caps the displayed goal progress and describes a resumable session', () => {
    expect(
      presentDashboard(
        {
          answered: 36,
          correct: 27,
          accuracy: 75,
          durationMs: 5_400_000,
          streakDays: 4,
          todayAnswered: 24,
          dailyGoal: 20,
        },
        { currentIndex: 6, total: 20 },
      ),
    ).toMatchObject({
      accuracyText: '75%',
      durationText: '1 小时 30 分',
      streakText: '连续 4 天',
      goalText: '24 / 20 题',
      goalPercent: 100,
      resumeText: '继续第 7 题 · 共 20 题',
    });
  });
});

describe('library presenters', () => {
  it('groups the six certificates by occupation', () => {
    const groups = groupCertificates(CERTIFICATES);

    expect(groups.map((group) => group.items.length)).toEqual([3, 3]);
    expect(groups.map((group) => group.title)).toEqual(['储粮保管员', '粮油质检员']);
  });

  it('sorts modules by first appearance and includes their counts', () => {
    const modules = presentLibraryModules([
      makeQuestion({ id: 'Q1', module: '粮情检查' }),
      makeQuestion({ id: 'Q2', module: '安全生产' }),
      makeQuestion({ id: 'Q3', module: '粮情检查' }),
    ]);

    expect(modules).toEqual([
      { name: '粮情检查', count: 2, countText: '2 题' },
      { name: '安全生产', count: 1, countText: '1 题' },
    ]);
  });

  it('keeps the catalog presenter available without removing the legacy module presenter', () => {
    expect(presentCatalogParts).toBe(presentCatalogPartsDirect);
    expect(presentLibraryModules([makeQuestion()])).toHaveLength(1);
  });
});

describe('findCatalogChapterTitle', () => {
  it('resolves a known chapter ID from the generated catalog', () => {
    expect(findCatalogChapterTitle(KNOWLEDGE_CATALOG, 'warehouse-l5-c03')).toBe('粮油出入库作业');
  });

  it('returns an unknown chapter ID unchanged', () => {
    expect(findCatalogChapterTitle(KNOWLEDGE_CATALOG, 'retired-chapter')).toBe('retired-chapter');
  });

  it('keeps same-title chapters in different occupations isolated by chapter ID', () => {
    const catalog: RuntimeKnowledgeCatalog = {
      occupations: {
        '4-02-06-01': {
          title: '粮油仓储管理员',
          parts: [
            {
              id: 'warehouse',
              number: 1,
              title: '仓储目录',
              levels: [5],
              chapters: [
                {
                  id: 'warehouse-shared',
                  number: 1,
                  title: '同名章节',
                  page: null,
                  sections: [],
                },
              ],
            },
          ],
        },
        '4-08-05-01': {
          title: '粮油质检员',
          parts: [
            {
              id: 'inspector',
              number: 1,
              title: '质检目录',
              levels: [5],
              chapters: [
                {
                  id: 'inspector-shared',
                  number: 1,
                  title: '同名章节',
                  page: null,
                  sections: [],
                },
              ],
            },
          ],
        },
      },
    };

    expect(findCatalogChapterTitle(catalog, 'warehouse-shared')).toBe('同名章节');
    expect(findCatalogChapterTitle(catalog, 'inspector-shared')).toBe('同名章节');
    expect(findCatalogChapterTitle(catalog, 'shared')).toBe('shared');
  });
});

describe('findCatalogChapterLabel', () => {
  it('combines the exact catalog chapter number and title', () => {
    expect(findCatalogChapterLabel(KNOWLEDGE_CATALOG, 'warehouse-l5-c04')).toBe('第 4 章 粮情检查');
    expect(findCatalogChapterLabel(KNOWLEDGE_CATALOG, 'retired-chapter')).toBe('retired-chapter');
  });
});

describe('presentReport', () => {
  it('formats the score, time and weakest module', () => {
    const report = presentReport(
      {
        total: 10,
        correct: 7,
        wrong: 3,
        durationMs: 125_000,
        wrongQuestionIds: ['Q1', 'Q2', 'Q3'],
        chapters: {
          'warehouse-l5-c04': { total: 4, correct: 1 },
          'warehouse-l5-c05': { total: 6, correct: 6 },
        },
      },
      (chapterId) => (chapterId === 'warehouse-l5-c04' ? '第四章 粮情检查' : chapterId),
    );

    expect(report).toMatchObject({
      scoreText: '70',
      accuracyText: '70%',
      durationText: '02:05',
    });
    expect(report.weakModules[0]).toMatchObject({
      name: '第四章 粮情检查',
      accuracyText: '25%',
    });
  });
});

describe('presentQuestionList', () => {
  const questions = [
    makeQuestion({
      id: 'Q1',
      occupation: '4-02-06-01',
      level: 5,
      module: '粮情检查',
      chapterId: 'warehouse-l5-c04',
    }),
    makeQuestion({
      id: 'Q2',
      occupation: '4-08-05-01',
      level: 3,
      module: '样品检验',
      chapterId: 'inspector-l3-c04',
    }),
    makeQuestion({
      id: 'Q3',
      occupation: '4-02-06-01',
      level: 3,
      module: '安全生产',
      chapterId: 'warehouse-l3-c02',
    }),
  ];

  it('retains favorite ID order, reports retired IDs and applies certificate filters', () => {
    const view = presentQuestionList({
      kind: 'favorite',
      questions,
      ids: ['Q2', 'retired', 'Q1'],
      filter: { occupation: '4-02-06-01', level: 5 },
    });

    expect(view.items.map((item) => item.question.id)).toEqual(['Q1']);
    expect(view.items[0]?.id).toBe('Q1');
    expect(view.unresolvedIds).toEqual(['retired']);
  });

  it('sorts wrong questions, hides mastered records and filters stable chapter IDs', () => {
    const view = presentQuestionList({
      kind: 'wrong',
      questions,
      ids: ['Q1', 'Q2', 'Q3'],
      wrongRecords: [
        {
          questionId: 'Q1',
          errorCount: 2,
          firstWrongAt: '2026-07-20',
          lastWrongAt: '2026-07-22',
          mastered: false,
          lastRetryCorrect: false,
        },
        {
          questionId: 'Q2',
          errorCount: 5,
          firstWrongAt: '2026-07-20',
          lastWrongAt: '2026-07-23',
          mastered: true,
          lastRetryCorrect: true,
        },
        {
          questionId: 'Q3',
          errorCount: 3,
          firstWrongAt: '2026-07-20',
          lastWrongAt: '2026-07-21',
          mastered: false,
          lastRetryCorrect: false,
        },
      ],
      filter: { chapterId: 'warehouse-l5-c04', includeMastered: false },
      resolveChapterTitle: (chapterId) =>
        chapterId === 'warehouse-l5-c04' ? '第四章 粮情检查' : chapterId,
    });

    expect(view.items.map((item) => item.question.id)).toEqual(['Q1']);
    expect(view.items[0]).toMatchObject({
      chapterTitle: '第四章 粮情检查',
      errorCountText: '错 2 次',
      latestText: '最近 07-22',
    });
    expect(view.chapters).toContainEqual({
      id: 'warehouse-l5-c04',
      title: '第四章 粮情检查',
    });
  });

  it('narrows chapter candidates by occupation and level without applying chapterId', () => {
    const scopedQuestions = [
      makeQuestion({
        id: 'Q1',
        occupation: '4-02-06-01',
        level: 5,
        chapterId: 'warehouse-l5-c04',
      }),
      makeQuestion({
        id: 'Q2',
        occupation: '4-02-06-01',
        level: 5,
        chapterId: 'warehouse-l5-c07',
      }),
      makeQuestion({
        id: 'Q3',
        occupation: '4-02-06-01',
        level: 3,
        chapterId: 'warehouse-l3-c04',
      }),
      makeQuestion({
        id: 'Q4',
        occupation: '4-08-05-01',
        level: 5,
        chapterId: 'inspector-l5-c04',
      }),
    ];

    const view = presentQuestionList({
      kind: 'favorite',
      questions: scopedQuestions,
      ids: scopedQuestions.map((question) => question.id),
      filter: {
        occupation: '4-02-06-01',
        level: 5,
        chapterId: 'warehouse-l5-c04',
      },
    });

    expect(view.items.map((item) => item.id)).toEqual(['Q1']);
    expect(view.chapters.map((chapter) => chapter.id)).toEqual([
      'warehouse-l5-c04',
      'warehouse-l5-c07',
    ]);
  });

  it('uses numbered labels for chapter filters while keeping card titles concise', () => {
    const view = presentQuestionList({
      kind: 'favorite',
      questions: [questions[0]!],
      ids: ['Q1'],
      resolveChapterTitle: () => '粮情检查',
      resolveChapterLabel: () => '第 4 章 粮情检查',
    });

    expect(view.items[0]?.chapterTitle).toBe('粮情检查');
    expect(view.chapters).toEqual([{ id: 'warehouse-l5-c04', title: '第 4 章 粮情检查' }]);
  });

  it('provides useful empty copy for each list kind', () => {
    expect(presentQuestionList({ kind: 'wrong', questions: [], ids: [] }).emptyTitle).toBe(
      '还没有错题',
    );
    expect(presentQuestionList({ kind: 'favorite', questions: [], ids: [] }).emptyTitle).toBe(
      '还没有收藏',
    );
  });
});

describe('presentQuestionOption', () => {
  it('shows a selected option before submission', () => {
    expect(
      presentQuestionOption({ key: 'A', selected: true, submitted: false, correctKeys: [] }),
    ).toEqual({ selected: true, state: 'selected', disabled: false });
  });

  it('marks a selected wrong option after submission', () => {
    expect(
      presentQuestionOption({ key: 'A', selected: true, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: true, state: 'wrong', disabled: true });
  });

  it('reveals the correct option after submission', () => {
    expect(
      presentQuestionOption({ key: 'B', selected: false, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: false, state: 'correct', disabled: true });
  });

  it('keeps unrelated options neutral after submission', () => {
    expect(
      presentQuestionOption({ key: 'C', selected: false, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: false, state: 'neutral', disabled: true });
  });
});
