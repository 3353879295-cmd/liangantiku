import { describe, expect, it, vi } from 'vitest';

import { buildPaper } from '../miniprogram/services/paper-builder';
import { makeQuestion } from './factories';

const questions = [
  makeQuestion({
    id: 'Q1',
    module: '粮情检查',
    chapterId: 'warehouse-l5-c04',
    sectionId: 'warehouse-l5-c04-s01',
  }),
  makeQuestion({
    id: 'Q2',
    module: '安全生产',
    chapterId: 'warehouse-l5-c03',
    sectionId: 'warehouse-l5-c03-s01',
    type: 'multiple',
  }),
  makeQuestion({
    id: 'Q3',
    module: '粮情检查',
    chapterId: 'warehouse-l5-c04',
    sectionId: 'warehouse-l5-c04-s02',
    type: 'judge',
  }),
  makeQuestion({
    id: 'Q4',
    module: '设备管理',
    chapterId: 'warehouse-l5-c05',
    sectionId: 'warehouse-l5-c05-s01',
    type: 'case',
  }),
];

describe('buildPaper', () => {
  it('keeps repository order for sequential practice', () => {
    expect(buildPaper(questions, { mode: 'sequential', limit: 10 }).map((item) => item.id)).toEqual(
      ['Q1', 'Q2', 'Q3', 'Q4'],
    );
  });

  it('filters a chapter before applying the limit', () => {
    expect(
      buildPaper(questions, { mode: 'chapter', module: '粮情检查', limit: 10 }).map(
        (item) => item.id,
      ),
    ).toEqual(['Q1', 'Q3']);
  });

  it('filters chapter and section practice by stable catalog IDs', () => {
    expect(
      buildPaper(questions, {
        mode: 'chapter',
        chapterId: 'warehouse-l5-c04',
        limit: 20,
      }).map((item) => item.id),
    ).toEqual(['Q1', 'Q3']);
    expect(
      buildPaper(questions, {
        mode: 'chapter',
        sectionId: 'warehouse-l5-c04-s01',
        limit: 20,
      }).map((item) => item.id),
    ).toEqual(['Q1']);
  });

  it('returns a random paper without duplicates or input mutation', () => {
    const originalOrder = questions.map((item) => item.id);

    const paper = buildPaper(questions, { mode: 'random', limit: 10, random: () => 0.4 });

    expect(paper).toHaveLength(4);
    expect(new Set(paper.map((item) => item.id)).size).toBe(4);
    expect(questions.map((item) => item.id)).toEqual(originalOrder);
  });

  it('filters selected question types before randomizing and clipping', () => {
    const paper = buildPaper(questions, {
      mode: 'random',
      limit: 10,
      questionTypes: ['single', 'judge'],
      random: () => 0.5,
    });

    expect(paper).toHaveLength(2);
    expect(paper.every((question) => ['single', 'judge'].includes(question.type))).toBe(true);
    expect(paper.map((question) => question.id).sort()).toEqual(['Q1', 'Q3']);
  });

  it('clips the requested limit and supports an empty bank', () => {
    expect(buildPaper(questions, { mode: 'mock', limit: 20, random: () => 0.2 })).toHaveLength(4);
    expect(buildPaper([], { mode: 'random', limit: 10 })).toEqual([]);
  });

  it('uses backward-compatible defaults for callers that omit the limit', () => {
    const manyQuestions = Array.from({ length: 25 }, (_, index) =>
      makeQuestion({ id: `Q${index + 1}` }),
    );

    expect(buildPaper(manyQuestions, { mode: 'sequential' })).toHaveLength(20);
    expect(buildPaper(manyQuestions, { mode: 'mock', random: () => 0.2 })).toHaveLength(25);
  });

  it.each([0, 15, 60])('rejects unsupported paper limit %s', (limit) => {
    expect(() => buildPaper(questions, { mode: 'random', limit: limit as 10 })).toThrow(
      /10, 20, 30, or 50/,
    );
  });

  it('rejects question types outside the current domain whitelist', () => {
    expect(() =>
      buildPaper(questions, {
        mode: 'random',
        limit: 10,
        questionTypes: ['essay' as 'single'],
      }),
    ).toThrow(/question type/);
  });
});

interface LibraryPageModule {
  buildTextbookPracticeRoute?: (input: {
    loading: boolean;
    questionCount: number;
    occupation: '4-02-06-01' | '4-08-05-01';
    level: 5 | 4 | 3;
    mode: 'chapter';
    chapterId?: string;
    sectionId?: string;
    chapterIds: readonly string[];
    sectionIds: readonly string[];
  }) => string | null;
}

interface PracticePageModule {
  parsePracticeRoute?: (options: Record<string, string | undefined>) => unknown;
}

const stubMiniProgramPageGlobals = () => {
  vi.stubGlobal('Page', vi.fn());
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });
};

describe('textbook practice route guards', () => {
  it('does not build a stale or cross-certificate route while the catalog is loading', async () => {
    stubMiniProgramPageGlobals();
    const pageModule =
      (await import('../miniprogram/pages/library/index')) as unknown as LibraryPageModule;

    expect(pageModule.buildTextbookPracticeRoute).toBeTypeOf('function');
    expect(
      pageModule.buildTextbookPracticeRoute?.({
        loading: true,
        questionCount: 12,
        occupation: '4-08-05-01',
        level: 5,
        mode: 'chapter',
        sectionId: 'warehouse-l5-c04-s01',
        chapterIds: ['inspector-c04'],
        sectionIds: ['inspector-c04-s01'],
      }),
    ).toBeNull();
    expect(
      pageModule.buildTextbookPracticeRoute?.({
        loading: false,
        questionCount: 12,
        occupation: '4-08-05-01',
        level: 5,
        mode: 'chapter',
        sectionId: 'warehouse-l5-c04-s01',
        chapterIds: ['inspector-c04'],
        sectionIds: ['inspector-c04-s01'],
      }),
    ).toBeNull();
    expect(
      pageModule.buildTextbookPracticeRoute?.({
        loading: false,
        questionCount: 12,
        occupation: '4-08-05-01',
        level: 5,
        mode: 'chapter',
        sectionId: 'inspector-c04-s01',
        chapterIds: ['inspector-c04'],
        sectionIds: ['inspector-c04-s01'],
      }),
    ).toBe(
      '/pages/practice/index?occupation=4-08-05-01&level=5&mode=chapter&sectionId=inspector-c04-s01',
    );
  });

  it.each(['chapterId', 'sectionId'] as const)(
    'treats malformed encoded %s as an invalid route',
    async (field) => {
      stubMiniProgramPageGlobals();
      const pageModule =
        (await import('../miniprogram/pages/practice/index')) as unknown as PracticePageModule;
      const options = {
        occupation: '4-02-06-01',
        level: '5',
        mode: 'chapter',
        [field]: '%',
      };

      expect(pageModule.parsePracticeRoute).toBeTypeOf('function');
      expect(() => pageModule.parsePracticeRoute?.(options)).not.toThrow();
      expect(pageModule.parsePracticeRoute?.(options)).toBeNull();
    },
  );

  it('decodes a random-practice type filter once and accepts supported counts', async () => {
    stubMiniProgramPageGlobals();
    const pageModule =
      (await import('../miniprogram/pages/practice/index')) as unknown as PracticePageModule;

    expect(
      pageModule.parsePracticeRoute?.({
        occupation: '4-02-06-01',
        level: '5',
        mode: 'random',
        limit: '30',
        types: 'single%2Cjudge',
      }),
    ).toEqual({
      resume: false,
      input: {
        occupation: '4-02-06-01',
        level: 5,
        mode: 'random',
        limit: 30,
        questionTypes: ['single', 'judge'],
      },
    });
  });

  it('accepts the internal 50-question limit for mock exams', async () => {
    stubMiniProgramPageGlobals();
    const pageModule =
      (await import('../miniprogram/pages/practice/index')) as unknown as PracticePageModule;

    expect(
      pageModule.parsePracticeRoute?.({
        occupation: '4-02-06-01',
        level: '5',
        mode: 'mock',
        limit: '50',
      }),
    ).toEqual({
      resume: false,
      input: {
        occupation: '4-02-06-01',
        level: 5,
        mode: 'mock',
        limit: 50,
      },
    });
  });

  it.each([
    { limit: '15' },
    { limit: '50' },
    { types: 'single%2Cessay' },
    { types: 'single%252Cjudge' },
    { types: '' },
  ])('rejects unsafe random-practice setup params: $limit$types', async (unsafeParams) => {
    stubMiniProgramPageGlobals();
    const pageModule =
      (await import('../miniprogram/pages/practice/index')) as unknown as PracticePageModule;

    expect(
      pageModule.parsePracticeRoute?.({
        occupation: '4-02-06-01',
        level: '5',
        mode: 'random',
        ...unsafeParams,
      }),
    ).toBeNull();
  });

  it('returns no session when a safe type filter has no matching candidates', async () => {
    stubMiniProgramPageGlobals();
    const { appServices } = await import('../miniprogram/services/app-services');
    const { startPractice } = await import('../miniprogram/services/practice-runtime');
    vi.spyOn(appServices.questions, 'list').mockResolvedValue([
      makeQuestion({ id: 'ONLY-SINGLE', type: 'single' }),
    ]);

    await expect(
      startPractice({
        occupation: '4-02-06-01',
        level: 5,
        mode: 'random',
        limit: 10,
        questionTypes: ['case'],
      }),
    ).resolves.toBeNull();

    vi.restoreAllMocks();
  });
});
