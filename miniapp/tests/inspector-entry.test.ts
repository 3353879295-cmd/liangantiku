import { afterEach, describe, expect, it, vi } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import { makeQuestion } from './factories';

const loadParsePracticeRoute = async () => {
  vi.resetModules();
  vi.stubGlobal('Page', vi.fn());
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });
  const page = await import('../miniprogram/pages/practice/index');
  return page.parsePracticeRoute;
};

interface QuestionListPageDefinition {
  data: Record<string, unknown>;
  applyView(this: QuestionListPageContext): void;
  onFilter(this: QuestionListPageContext, event: WechatMiniprogram.TouchEvent): void;
}

interface QuestionListPageContext {
  data: Record<string, unknown>;
  setData(update: Record<string, unknown>): void;
  applyView(): void;
}

const loadQuestionListPage = async () => {
  vi.resetModules();
  let definition: QuestionListPageDefinition | undefined;
  vi.stubGlobal('Page', (value: QuestionListPageDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });
  await import('../miniprogram/pages/question-list/index');
  if (!definition) throw new Error('question-list Page was not registered');

  const registered = definition;
  const context: QuestionListPageContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    applyView() {
      registered.applyView.call(this);
    },
  };
  return { context, definition: registered };
};

const occupationFilterEvent = (occupation: string): WechatMiniprogram.TouchEvent =>
  ({
    currentTarget: { dataset: { group: 'occupation', value: occupation } },
  }) as unknown as WechatMiniprogram.TouchEvent;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('quality inspector practice entry', () => {
  it("offers the quality inspector's three released levels while keeping warehouse levels released", () => {
    expect(
      CERTIFICATES.filter(({ occupation }) => occupation === '4-08-05-01').map(
        ({ title, shortTitle, level, availability }) => ({
          title,
          shortTitle,
          level,
          availability,
        }),
      ),
    ).toEqual([
      {
        title: '粮油质量检验员 · 初级',
        shortTitle: '质检员初级',
        level: 5,
        availability: 'available',
      },
      {
        title: '粮油质量检验员 · 中级',
        shortTitle: '质检员中级',
        level: 4,
        availability: 'available',
      },
      {
        title: '粮油质量检验员 · 高级',
        shortTitle: '质检员高级',
        level: 3,
        availability: 'available',
      },
      {
        title: '粮油质量检验员 · 技师',
        shortTitle: '质检员技师',
        level: 2,
        availability: 'coming-soon',
      },
      {
        title: '粮油质量检验员 · 高级技师',
        shortTitle: '质检员高级技师',
        level: 1,
        availability: 'coming-soon',
      },
    ]);
    expect(
      CERTIFICATES.filter(({ occupation }) => occupation === '4-02-06-01').every(
        ({ availability }) => availability === 'available',
      ),
    ).toBe(true);
  });

  it('opens practice routes for quality inspectors and rejects unknown occupations', async () => {
    const parsePracticeRoute = await loadParsePracticeRoute();

    expect(
      parsePracticeRoute({ occupation: '4-08-05-01', level: '5', mode: 'sequential' }),
    ).toEqual({
      resume: false,
      input: { occupation: '4-08-05-01', level: 5, mode: 'sequential' },
    });
    expect(
      parsePracticeRoute({ occupation: 'unknown', level: '5', mode: 'sequential' }),
    ).toBeNull();
  });

  it('rejects inspector deep links for unreleased levels without blocking warehouse levels', async () => {
    const parsePracticeRoute = await loadParsePracticeRoute();

    expect(
      parsePracticeRoute({ occupation: '4-08-05-01', level: '2', mode: 'sequential' }),
    ).toBeNull();
    expect(
      parsePracticeRoute({ occupation: '4-02-06-01', level: '2', mode: 'sequential' }),
    ).toEqual({
      resume: false,
      input: { occupation: '4-02-06-01', level: 2, mode: 'sequential' },
    });
  });

  it.each(['wrong', 'favorite'] as const)(
    'switches the %s review list between warehouse and inspector questions without mixing occupations',
    async (kind) => {
      const { context, definition } = await loadQuestionListPage();
      const warehouse = makeQuestion({ id: `${kind}-warehouse`, occupation: '4-02-06-01' });
      const inspector = makeQuestion({
        id: `${kind}-inspector`,
        occupation: '4-08-05-01',
        direction: '粮油质量检验',
        chapterId: 'inspector-l5-c01',
      });
      context.setData({
        kind,
        ids: [warehouse.id, inspector.id],
        rawQuestions: [warehouse, inspector],
        wrongRecords: [],
        selectedAnswers: {},
        occupation: '4-02-06-01',
        level: 0,
        chapterId: '',
        includeMastered: false,
      });

      definition.onFilter.call(context, occupationFilterEvent('4-08-05-01'));
      expect(
        (context.data['view'] as { items: Array<{ id: string }> }).items.map(({ id }) => id),
      ).toEqual([inspector.id]);

      definition.onFilter.call(context, occupationFilterEvent('4-02-06-01'));
      expect(
        (context.data['view'] as { items: Array<{ id: string }> }).items.map(({ id }) => id),
      ).toEqual([warehouse.id]);
    },
  );
});
