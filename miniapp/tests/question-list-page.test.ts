import { afterEach, describe, expect, it, vi } from 'vitest';

import type { QuestionListViewModel } from '../miniprogram/presenters/question-list-presenter';

interface QuestionListPageData {
  loaded: boolean;
  loading: boolean;
  loadError: boolean;
  kind: 'wrong' | 'favorite' | 'session';
  occupation: string;
  level: number;
  chapterId: string;
  view: QuestionListViewModel;
}

interface QuestionListPageContext {
  data: QuestionListPageData;
  setData(update: Partial<QuestionListPageData>): void;
  loadSource(): Promise<void>;
  applyView(): void;
  syncTheme(): void;
  syncCertificateScope(): boolean;
}

interface QuestionListPageDefinition {
  data: QuestionListPageData;
  onLoad(this: QuestionListPageContext, options: Record<string, string | undefined>): Promise<void>;
  onShow?(this: QuestionListPageContext): void | Promise<void>;
  loadSource(this: QuestionListPageContext): Promise<void>;
  applyView(this: QuestionListPageContext): void;
  syncTheme?(this: QuestionListPageContext): void;
  syncCertificateScope?(this: QuestionListPageContext): boolean;
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
    setNavigationBarTitle: vi.fn(),
    navigateTo: vi.fn(),
    showToast: vi.fn(),
  });

  await import('../miniprogram/pages/question-list/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  if (!definition) throw new Error('question-list Page was not registered');

  const registered = definition;
  const context: QuestionListPageContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    loadSource() {
      return registered.loadSource.call(context);
    },
    applyView() {
      registered.applyView.call(context);
    },
    syncTheme() {
      registered.syncTheme?.call(context);
    },
    syncCertificateScope() {
      return registered.syncCertificateScope?.call(context) ?? false;
    },
  };

  return { appServices, context, definition: registered };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('question-list page certificate scope', () => {
  it('defaults wrong questions to the current certificate and scopes its chapters', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    appServices.progress.updatePreferences({ selectedCertificateKey: '4-02-06-01:3' });
    const questions = await appServices.questions.list();
    const currentQuestions = questions
      .filter((question) => question.occupation === '4-02-06-01' && question.level === 3)
      .slice(0, 2);
    const currentIds = currentQuestions.map((question) => question.id);
    const otherId = questions.find(
      (question) => question.occupation === '4-02-06-01' && question.level === 5,
    )?.id;
    if (!otherId || currentIds.length < 2) throw new Error('question fixtures are incomplete');

    for (const questionId of [...currentIds, otherId]) {
      appServices.progress.recordAnswer({
        questionId,
        correct: false,
        durationMs: 100,
        at: '2026-07-26',
      });
    }

    await definition.onLoad.call(context, { kind: 'wrong' });

    expect(context.data.occupation).toBe('4-02-06-01');
    expect(context.data.level).toBe(3);
    expect(context.data.view.items.map((item) => item.id)).toEqual(currentIds);
    expect(context.data.view.chapters.map((chapter) => chapter.id)).toEqual([
      ...new Set(currentQuestions.map((question) => question.chapterId)),
    ]);
  });

  it('resynchronizes filters when the home certificate changes', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    appServices.progress.updatePreferences({ selectedCertificateKey: '4-02-06-01:5' });
    await definition.onLoad.call(context, { kind: 'favorite' });

    appServices.progress.updatePreferences({ selectedCertificateKey: '4-02-06-01:4' });
    expect(typeof definition.onShow).toBe('function');
    await definition.onShow?.call(context);

    expect(context.data.occupation).toBe('4-02-06-01');
    expect(context.data.level).toBe(4);
    expect(context.data.chapterId).toBe('');
  });

  it('keeps a local filter choice when the persisted home certificate did not change', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    appServices.progress.updatePreferences({ selectedCertificateKey: '4-02-06-01:5' });
    await definition.onLoad.call(context, { kind: 'favorite' });
    context.setData({
      occupation: '4-08-05-01',
      level: 3,
      chapterId: 'inspector-c03',
    });

    await definition.onShow?.call(context);

    expect(context.data).toMatchObject({
      occupation: '4-08-05-01',
      level: 3,
      chapterId: 'inspector-c03',
    });
  });

  it('exposes a retryable network state and recovers after repository failure', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    const getByIds = vi
      .spyOn(appServices.questions, 'getByIds')
      .mockRejectedValueOnce(new Error('question repository unavailable'));

    await definition.onLoad.call(context, { kind: 'favorite' });

    expect(context.data.loading).toBe(false);
    expect(context.data.loadError).toBe(true);

    getByIds.mockRestore();
    await definition.loadSource.call(context);

    expect(context.data.loadError).toBe(false);
    expect(context.data.loaded).toBe(true);
  });
});
