import { describe, expect, it } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import { KNOWLEDGE_CATALOG } from '../miniprogram/data/knowledge-catalog';
import {
  findCatalogChapterLabel,
  findCatalogChapterTitle,
  presentCatalogParts as presentCatalogPartsDirect,
} from '../miniprogram/presenters/catalog-presenter';
import type { RuntimeKnowledgeCatalog } from '../miniprogram/types/knowledge-catalog';
import {
  HOME_ACTIONS,
  presentDashboard,
  presentHomeCertificate,
} from '../miniprogram/presenters/home-presenter';
import {
  groupCertificates,
  presentCatalogParts,
  presentLibraryModules,
} from '../miniprogram/presenters/library-presenter';
import {
  getQuestionSelectionMode,
  presentQuestionOption,
  selectDraftOption,
} from '../miniprogram/presenters/question-option-presenter';
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

describe('home question bank presentation', () => {
  it('keeps a selectable technician certificate visible but prevents an empty practice', () => {
    expect(presentHomeCertificate(CERTIFICATES, '4-02-06-01:2', 0)).toMatchObject({
      roleTitle: '粮油仓储管理员',
      levelName: '技师',
      bankTitle: '粮油仓储管理员 · 技师',
      availabilityText: '待补充',
      canStart: false,
      questionCountText: '题库待补充',
    });
  });

  it('presents an available question bank with its formal role and question count', () => {
    expect(presentHomeCertificate(CERTIFICATES, '4-08-05-01:4', 12)).toMatchObject({
      certificateKey: '4-08-05-01:4',
      roleTitle: '粮油质量检验员',
      levelName: '中级',
      availabilityText: '可练习',
      canStart: true,
      questionCountText: '12 题',
    });
  });

  it('exposes exactly the five home learning routes with independent saved-question pages', () => {
    expect(HOME_ACTIONS).toEqual([
      { id: 'chapter', title: '章节刷题', route: '/pages/library/index' },
      { id: 'random', title: '随机练习', route: '/pages/random-settings/index' },
      { id: 'mock', title: '模拟考试', route: '/pages/mock-info/index' },
      {
        id: 'wrong',
        title: '错题本',
        route: '/pages/question-list/index?kind=wrong',
      },
      {
        id: 'favorite',
        title: '收藏试题',
        route: '/pages/question-list/index?kind=favorite',
      },
    ]);
  });
});

describe('library presenters', () => {
  it('groups certificates by occupation', () => {
    const groups = groupCertificates(CERTIFICATES);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.title)).toEqual(['储粮保管员', '粮油质检员']);
  });

  it('exposes five levels for each occupation and marks unavailable banks explicitly', () => {
    const groups = groupCertificates(CERTIFICATES);

    expect(groups.map((group) => group.items.length)).toEqual([5, 5]);
    expect(groups[0]?.items.map((item) => item.levelName)).toEqual([
      '初级',
      '中级',
      '高级',
      '技师',
      '高级技师',
    ]);
    expect(groups[0]?.items.map((item) => item.availability)).toEqual([
      'available',
      'available',
      'available',
      'coming-soon',
      'coming-soon',
    ]);
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
    expect(presentQuestionList({ kind: 'wrong', questions: [], ids: [] })).toMatchObject({
      emptyTitle: '还没有错题',
      emptyDescription: '答错的题会自动收录到这里。',
    });
    expect(presentQuestionList({ kind: 'favorite', questions: [], ids: [] })).toMatchObject({
      emptyTitle: '还没有收藏',
      emptyDescription: '在答题页点击星标即可收藏。',
    });
  });

  it('presents the selected and expected answers independently for session analysis', () => {
    const view = presentQuestionList({
      kind: 'session',
      questions: [questions[0]!],
      ids: ['Q1'],
      selectedAnswers: { Q1: ['C'] },
    });

    expect(view.items[0]).toMatchObject({
      selectedText: 'C',
      answerText: 'A',
    });
  });

  it('keeps every session wrong answer visible even if it was previously marked mastered', () => {
    const view = presentQuestionList({
      kind: 'session',
      questions: [questions[0]!],
      ids: ['Q1'],
      wrongRecords: [
        {
          questionId: 'Q1',
          errorCount: 2,
          firstWrongAt: '2026-07-20',
          lastWrongAt: '2026-07-26',
          mastered: true,
          lastRetryCorrect: true,
        },
      ],
      filter: { includeMastered: false },
    });

    expect(view.items.map((item) => item.id)).toEqual(['Q1']);
  });
});

describe('presentQuestionOption', () => {
  it('shows a selected option without revealing correctness before confirmation', () => {
    expect(
      presentQuestionOption({
        key: 'A',
        selected: true,
        revealAnswer: false,
        correctKeys: ['B'],
      }),
    ).toEqual({ selected: true, state: 'selected', disabled: false });
  });

  it('keeps an unselected option idle before confirmation', () => {
    expect(
      presentQuestionOption({
        key: 'B',
        selected: false,
        revealAnswer: false,
        correctKeys: ['B'],
      }),
    ).toEqual({ selected: false, state: 'idle', disabled: false });
  });

  it('marks only a selected wrong option wrong after revealing the answer', () => {
    expect(
      presentQuestionOption({
        key: 'A',
        selected: true,
        revealAnswer: true,
        correctKeys: ['B'],
      }),
    ).toEqual({ selected: true, state: 'wrong', disabled: true });
  });

  it('reveals the correct option after confirmation', () => {
    expect(
      presentQuestionOption({
        key: 'B',
        selected: false,
        revealAnswer: true,
        correctKeys: ['B'],
      }),
    ).toEqual({ selected: false, state: 'correct', disabled: true });
  });

  it('keeps unrelated options idle after revealing the answer', () => {
    expect(
      presentQuestionOption({
        key: 'C',
        selected: false,
        revealAnswer: true,
        correctKeys: ['B'],
      }),
    ).toEqual({ selected: false, state: 'idle', disabled: true });
  });
});

describe('question draft selection', () => {
  it('replaces a previous draft for single-answer questions', () => {
    expect(selectDraftOption(['A'], 'B', 'single')).toEqual(['B']);
  });

  it('toggles multiple-answer drafts and immediately restores the previous option', () => {
    expect(selectDraftOption(['A'], 'B', 'multiple')).toEqual(['A', 'B']);
    expect(selectDraftOption(['A', 'B'], 'A', 'multiple')).toEqual(['B']);
  });

  it('uses answer cardinality for case-question selection mode', () => {
    expect(getQuestionSelectionMode('case', ['A'])).toBe('single');
    expect(getQuestionSelectionMode('case', ['A', 'C'])).toBe('multiple');
    expect(getQuestionSelectionMode('multiple', ['A'])).toBe('multiple');
  });
});
