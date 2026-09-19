import { describe, expect, it } from 'vitest';

import { KNOWLEDGE_CATALOG } from '../miniprogram/data/knowledge-catalog';
import { loadQuestionRecords } from '../miniprogram/data/question-bank';
import * as catalogPresenter from '../miniprogram/presenters/catalog-presenter';
import { LocalQuestionRepository } from '../miniprogram/repositories/local-question-repository';
import type { CertificateLevel, OccupationCode } from '../miniprogram/types/domain';
import type { RuntimeKnowledgeCatalog } from '../miniprogram/types/knowledge-catalog';
import { makeQuestion } from './factories';

const { presentCatalogParts } = catalogPresenter;

const catalog: RuntimeKnowledgeCatalog = {
  occupations: {
    '4-02-06-01': {
      title: '粮油仓储管理员',
      parts: [
        {
          id: 'warehouse-basic',
          number: 1,
          title: '基础知识',
          levels: [5, 4, 3],
          chapters: [],
        },
        {
          id: 'warehouse-l5',
          number: 2,
          title: '初级粮油仓储管理员',
          levels: [5],
          chapters: [
            {
              id: 'warehouse-l5-c03',
              number: 3,
              title: '粮油出入库作业',
              page: 90,
              sections: [
                {
                  id: 'warehouse-l5-c03-s01',
                  number: 1,
                  title: '粮油出入库准备',
                  page: 90,
                },
                {
                  id: 'warehouse-l5-c03-s03',
                  number: 3,
                  title: '粮油出入库收尾工作',
                  page: 131,
                },
              ],
            },
          ],
        },
        {
          id: 'warehouse-l4',
          number: 3,
          title: '中级粮油仓储管理员',
          levels: [4],
          chapters: [],
        },
        {
          id: 'warehouse-l3',
          number: 4,
          title: '高级粮油仓储管理员',
          levels: [3],
          chapters: [],
        },
      ],
    },
    '4-08-05-01': {
      title: '粮油质量检验员',
      parts: [
        {
          id: 'inspector',
          number: 1,
          title: '粮油质检员知识目录',
          levels: [5, 4, 3],
          chapters: [],
        },
      ],
    },
  },
};

const noProgress = () => ({
  completed: 0,
  attempts: 0,
  correctAttempts: 0,
  wrongQuestions: 0,
});

describe('presentCatalogParts', () => {
  it('uses plain chapter and section numbers with real catalog counts and progress', () => {
    const questions = ['Q1', 'Q2', 'Q3', 'Q4'].map((id) =>
      makeQuestion({
        id,
        chapterId: 'warehouse-basic-c01',
        sectionId: 'warehouse-basic-c01-s01',
      }),
    );

    const parts = presentCatalogParts({
      catalog: KNOWLEDGE_CATALOG,
      occupation: '4-02-06-01',
      level: 5,
      questions,
      getProgress: () => ({
        completed: 1,
        attempts: 4,
        correctAttempts: 3,
        wrongQuestions: 1,
      }),
    });

    expect(parts[0]?.chapters[0]?.numberText).toBe('1');
    expect(parts[0]?.chapters[0]?.sections[0]?.numberText).toBe('1');
    expect(parts[0]?.chapters[0]).toMatchObject({
      sectionCountText: '3 小节',
      questionCountText: '4 题',
      progressText: '25%',
      canStart: true,
    });
  });

  it('retains empty catalog sections and counts questions by stable section ID', () => {
    const requestedProgressIds: string[][] = [];
    const view = presentCatalogParts({
      catalog,
      occupation: '4-02-06-01',
      level: 5,
      questions: [
        makeQuestion({ id: 'Q1' }),
        makeQuestion({ id: 'Q2', level: 4 }),
        makeQuestion({ id: 'Q3', occupation: '4-08-05-01' }),
      ],
      getProgress: (questionIds) => {
        requestedProgressIds.push([...questionIds]);
        return {
          completed: 1,
          attempts: 2,
          correctAttempts: 1,
          wrongQuestions: 1,
        };
      },
    });

    expect(view[1]?.chapters[0]?.sections).toEqual([
      expect.objectContaining({
        id: 'warehouse-l5-c03-s01',
        questionCount: 0,
        countText: '0 题',
        statusText: '待补充',
        canStart: false,
      }),
      expect.objectContaining({
        id: 'warehouse-l5-c03-s03',
        questionCount: 1,
        countText: '1 题',
        statusText: '已完成',
        canStart: true,
      }),
    ]);
    expect(view[1]?.chapters[0]).toMatchObject({
      id: 'warehouse-l5-c03',
      questionCount: 1,
      sectionCountText: '2 小节',
      questionCountText: '1 题',
      progressText: '100%',
      accuracyText: '50%',
      wrongText: '1',
      canStart: true,
    });
    expect(requestedProgressIds).toEqual([['Q1'], ['Q1']]);
    expect(view.map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l5']);
  });

  it('presents the learning status for empty, untouched, partial and completed sections', () => {
    const sectionFor = (questionIds: string[], completed: number) => {
      const view = presentCatalogParts({
        catalog,
        occupation: '4-02-06-01',
        level: 5,
        questions: questionIds.map((id) => makeQuestion({ id })),
        getProgress: () => ({
          completed,
          attempts: completed,
          correctAttempts: completed,
          wrongQuestions: 0,
        }),
      });
      return view[1]?.chapters[0]?.sections[1];
    };

    expect(sectionFor([], 0)).toMatchObject({
      countText: '0 题',
      statusText: '待补充',
    });
    expect(sectionFor(['Q1'], 0)).toMatchObject({
      countText: '1 题',
      statusText: '未开始',
    });
    expect(sectionFor(['Q1', 'Q2'], 1)).toMatchObject({
      countText: '2 题',
      statusText: '已完成 1/2',
    });
    expect(sectionFor(['Q1', 'Q2'], 2)).toMatchObject({
      countText: '2 题',
      statusText: '已完成',
    });
  });

  it.each([
    [5, ['warehouse-basic', 'warehouse-l5']],
    [4, ['warehouse-basic', 'warehouse-l4']],
    [3, ['warehouse-basic', 'warehouse-l3']],
  ] as const)('shows only shared and level %i warehouse parts', (level, partIds) => {
    const view = presentCatalogParts({
      catalog,
      occupation: '4-02-06-01',
      level,
      questions: [],
      getProgress: noProgress,
    });

    expect(view.map((part) => part.id)).toEqual(partIds);
  });

  it('keeps the inspector catalog independent of warehouse level parts', () => {
    const view = presentCatalogParts({
      catalog,
      occupation: '4-08-05-01',
      level: 3,
      questions: [],
      getProgress: noProgress,
    });

    expect(view.map((part) => part.id)).toEqual(['inspector']);
  });

  it.each([2, 1] as const)(
    'exposes the inspector import catalog for released level %i',
    (level) => {
      const view = presentCatalogParts({
        catalog: KNOWLEDGE_CATALOG,
        occupation: '4-08-05-01',
        level,
        questions: [],
        getProgress: noProgress,
      });

      expect(view.map((part) => part.id)).toEqual(['inspector-import']);
      expect(view[0]?.chapters[0]).toMatchObject({
        id: 'inspector-import-c01',
        title: '质检员综合理论',
        canStart: false,
      });
    },
  );

  it('uses stable zero text for an empty chapter without NaN or division by zero', () => {
    const view = presentCatalogParts({
      catalog,
      occupation: '4-02-06-01',
      level: 5,
      questions: [],
      getProgress: noProgress,
    });

    expect(view[1]?.chapters[0]).toMatchObject({
      questionCount: 0,
      questionCountText: '题目待补充',
      progressText: '0%',
      accuracyText: '0%',
      wrongText: '0',
      canStart: false,
    });
    expect(JSON.stringify(view)).not.toContain('NaN');
  });

  it('preserves canonical zero-question sections from the runtime catalog', async () => {
    const repository = new LocalQuestionRepository(loadQuestionRecords());
    const questions = await repository.list();
    const canonicalSectionIds = Object.values(KNOWLEDGE_CATALOG.occupations).flatMap((occupation) =>
      occupation.parts.flatMap((part) =>
        part.chapters.flatMap((chapter) => chapter.sections.map((section) => section.id)),
      ),
    );
    const populatedSectionIds = new Set(questions.map((question) => question.sectionId));
    const canonicalEmptySectionIds = canonicalSectionIds.filter(
      (sectionId) => !populatedSectionIds.has(sectionId),
    );
    const views = (
      [
        ['4-02-06-01', 5],
        ['4-02-06-01', 4],
        ['4-02-06-01', 3],
        ['4-02-06-01', 2],
        ['4-02-06-01', 1],
        ['4-08-05-01', 5],
        ['4-08-05-01', 4],
        ['4-08-05-01', 3],
        ['4-08-05-01', 2],
        ['4-08-05-01', 1],
      ] as const satisfies ReadonlyArray<readonly [OccupationCode, CertificateLevel]>
    ).flatMap(([occupation, level]) =>
      presentCatalogParts({
        catalog: KNOWLEDGE_CATALOG,
        occupation,
        level,
        questions,
        getProgress: noProgress,
      }),
    );
    const presentedSections = new Map(
      views.flatMap((part) =>
        part.chapters.flatMap((chapter) =>
          chapter.sections.map((section) => [section.id, section] as const),
        ),
      ),
    );

    expect(
      canonicalEmptySectionIds.every((sectionId) => {
        const section = presentedSections.get(sectionId);
        return (
          section?.questionCount === 0 &&
          section.countText === '0 题' &&
          section.statusText === '待补充'
        );
      }),
    ).toBe(true);
  });
});

type ParseChapterRoute = (
  catalog: RuntimeKnowledgeCatalog,
  options: Record<string, string | undefined>,
) => { occupation: OccupationCode; level: CertificateLevel; chapterId: string } | null;

type BuildChapterDetailRoute = (input: {
  loading: boolean;
  occupation: OccupationCode;
  level: CertificateLevel;
  chapterId: string;
  chapterIds: readonly string[];
}) => string | null;

type BuildChapterPracticeRoute = (input: {
  loading: boolean;
  occupation: OccupationCode;
  level: CertificateLevel;
  chapter: ReturnType<typeof presentCatalogParts>[number]['chapters'][number];
  chapterId?: string;
  sectionId?: string;
}) => string | null;

const routeFunctions = catalogPresenter as typeof catalogPresenter & {
  parseChapterRoute?: ParseChapterRoute;
  buildChapterDetailRoute?: BuildChapterDetailRoute;
  buildChapterPracticeRoute?: BuildChapterPracticeRoute;
};

describe('catalog chapter routes', () => {
  it('parses only a known chapter belonging to the requested occupation and level', () => {
    expect(routeFunctions.parseChapterRoute).toBeTypeOf('function');
    expect(
      routeFunctions.parseChapterRoute?.(KNOWLEDGE_CATALOG, {
        occupation: '4-02-06-01',
        level: '5',
        chapterId: 'warehouse-l5-c03',
      }),
    ).toEqual({
      occupation: '4-02-06-01',
      level: 5,
      chapterId: 'warehouse-l5-c03',
    });

    for (const options of [
      { occupation: 'unknown', level: '5', chapterId: 'warehouse-l5-c03' },
      { occupation: '4-02-06-01', level: '9', chapterId: 'warehouse-l5-c03' },
      { occupation: '4-02-06-01', level: '4', chapterId: 'warehouse-l5-c03' },
      { occupation: '4-08-05-01', level: '5', chapterId: 'warehouse-l5-c03' },
      { occupation: '4-02-06-01', level: '5', chapterId: 'missing-chapter' },
      { occupation: '4-02-06-01', level: '5', chapterId: '%' },
    ]) {
      expect(routeFunctions.parseChapterRoute?.(KNOWLEDGE_CATALOG, options)).toBeNull();
    }
  });

  it('encodes validated chapter detail and practice routes', () => {
    expect(routeFunctions.buildChapterDetailRoute).toBeTypeOf('function');
    expect(
      routeFunctions.buildChapterDetailRoute?.({
        loading: false,
        occupation: '4-02-06-01',
        level: 5,
        chapterId: 'chapter/id',
        chapterIds: ['chapter/id'],
      }),
    ).toBe(
      '/packages/auxiliary/pages/chapter-detail/index?occupation=4-02-06-01&level=5&chapterId=chapter%2Fid',
    );
    expect(
      routeFunctions.buildChapterDetailRoute?.({
        loading: false,
        occupation: '4-02-06-01',
        level: 5,
        chapterId: 'stale-id',
        chapterIds: ['chapter/id'],
      }),
    ).toBeNull();

    const chapter = {
      id: 'chapter/id',
      numberText: '1',
      title: '示例章节',
      questionCount: 1,
      metaText: '1 题',
      sectionCountText: '1 小节',
      questionCountText: '1 题',
      progressText: '0%',
      accuracyText: '0%',
      wrongText: '0',
      canStart: true,
      sections: [
        {
          id: 'section/id',
          numberText: '1',
          title: '示例小节',
          questionCount: 1,
          countText: '1 题',
          statusText: '未开始',
          canStart: true,
        },
      ],
    };
    expect(routeFunctions.buildChapterPracticeRoute).toBeTypeOf('function');
    expect(
      routeFunctions.buildChapterPracticeRoute?.({
        loading: false,
        occupation: '4-02-06-01',
        level: 5,
        chapter,
        sectionId: 'section/id',
      }),
    ).toBe(
      '/pages/practice/index?occupation=4-02-06-01&level=5&mode=chapter&sectionId=section%2Fid',
    );
    expect(
      routeFunctions.buildChapterPracticeRoute?.({
        loading: false,
        occupation: '4-02-06-01',
        level: 5,
        chapter,
        chapterId: 'chapter/id',
      }),
    ).toBe(
      '/pages/practice/index?occupation=4-02-06-01&level=5&mode=chapter&chapterId=chapter%2Fid',
    );
    expect(
      routeFunctions.buildChapterPracticeRoute?.({
        loading: false,
        occupation: '4-02-06-01',
        level: 5,
        chapter,
        sectionId: 'stale-id',
      }),
    ).toBeNull();
  });
});
