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
  }),
  makeQuestion({
    id: 'Q3',
    module: '粮情检查',
    chapterId: 'warehouse-l5-c04',
    sectionId: 'warehouse-l5-c04-s02',
  }),
  makeQuestion({
    id: 'Q4',
    module: '设备管理',
    chapterId: 'warehouse-l5-c05',
    sectionId: 'warehouse-l5-c05-s01',
  }),
];

describe('buildPaper', () => {
  it('keeps repository order for sequential practice', () => {
    expect(buildPaper(questions, { mode: 'sequential', limit: 2 }).map((item) => item.id)).toEqual([
      'Q1',
      'Q2',
    ]);
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

    const paper = buildPaper(questions, { mode: 'random', limit: 3, random: () => 0.4 });

    expect(paper).toHaveLength(3);
    expect(new Set(paper.map((item) => item.id)).size).toBe(3);
    expect(questions.map((item) => item.id)).toEqual(originalOrder);
  });

  it('clips the requested limit and supports an empty bank', () => {
    expect(buildPaper(questions, { mode: 'mock', limit: 20, random: () => 0.2 })).toHaveLength(4);
    expect(buildPaper([], { mode: 'random', limit: 10 })).toEqual([]);
  });

  it('rejects non-positive limits', () => {
    expect(() => buildPaper(questions, { mode: 'random', limit: 0 })).toThrow(/positive/);
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
});
