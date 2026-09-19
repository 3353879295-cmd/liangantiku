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
  levelFilters: Array<{ label: string; value: number }>;
  displayedCount: number;
  totalCount: number;
  hasMore: boolean;
  view: QuestionListViewModel;
}

interface QuestionListPageContext {
  data: QuestionListPageData;
  setData(update: Record<string, unknown>): void;
  loadSource(): Promise<void>;
  applyView(): void;
  renderView(reset: boolean): void;
  syncTheme(): void;
  syncCertificateScope(): boolean;
  onLoadMore(): void;
  onStartPractice(): void;
  onUnload(): void;
}

interface QuestionListPageDefinition {
  data: QuestionListPageData;
  onLoad(this: QuestionListPageContext, options: Record<string, string | undefined>): Promise<void>;
  onShow?(this: QuestionListPageContext): void | Promise<void>;
  loadSource(this: QuestionListPageContext): Promise<void>;
  applyView(this: QuestionListPageContext): void;
  renderView(this: QuestionListPageContext, reset: boolean): void;
  syncTheme?(this: QuestionListPageContext): void;
  syncCertificateScope?(this: QuestionListPageContext): boolean;
  onLoadMore(this: QuestionListPageContext): void;
  onStartPractice(this: QuestionListPageContext): void;
  onUnload(this: QuestionListPageContext): void;
}

const loadQuestionListPage = async () => {
  vi.resetModules();
  let definition: QuestionListPageDefinition | undefined;
  const navigateTo = vi.fn();
  const showToast = vi.fn();

  vi.stubGlobal('Page', (value: QuestionListPageDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    setNavigationBarTitle: vi.fn(),
    navigateTo,
    showToast,
  });

  await import('../miniprogram/pages/question-list/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  if (!definition) throw new Error('question-list Page was not registered');

  const registered = definition;
  const context: QuestionListPageContext = {
    data: structuredClone(registered.data),
    setData(update) {
      for (const [key, value] of Object.entries(update)) {
        const itemIndex = /^view\.items\[(\d+)\]$/.exec(key)?.[1];
        if (itemIndex !== undefined) {
          this.data.view.items[Number(itemIndex)] = value as QuestionListViewModel['items'][number];
        } else Object.assign(this.data, { [key]: value });
      }
    },
    loadSource() {
      return registered.loadSource.call(context);
    },
    applyView() {
      registered.applyView.call(context);
    },
    renderView(reset) {
      registered.renderView.call(context, reset);
    },
    syncTheme() {
      registered.syncTheme?.call(context);
    },
    syncCertificateScope() {
      return registered.syncCertificateScope?.call(context) ?? false;
    },
    onLoadMore() {
      registered.onLoadMore.call(context);
    },
    onStartPractice() {
      registered.onStartPractice.call(context);
    },
    onUnload() {
      registered.onUnload.call(context);
    },
  };

  return { appServices, context, definition: registered, navigateTo, showToast };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
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
    expect(context.data.levelFilters.map((filter) => filter.value)).toEqual([5, 4, 3, 2, 1]);
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

  it('renders the first page only while retaining every filtered question for load more', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    appServices.progress.updatePreferences({ selectedCertificateKey: '4-02-06-01:3' });
    const seed = (await appServices.questions.list()).find(
      (question) => question.occupation === '4-02-06-01' && question.level === 3,
    );
    if (!seed) throw new Error('question fixtures are incomplete');
    const questions = Array.from({ length: 21 }, (_, index) => ({
      ...seed,
      id: `page-test-${index}`,
    }));
    const ids = questions.map((question) => question.id);
    for (const questionId of ids) {
      appServices.progress.recordAnswer({
        questionId,
        correct: false,
        durationMs: 1,
        at: '2026-08-01',
      });
    }
    vi.spyOn(appServices.questions, 'getByIds').mockResolvedValueOnce(questions);

    await definition.onLoad.call(context, { kind: 'wrong' });

    expect(context.data.view.items).toHaveLength(20);
    expect(context.data.totalCount).toBe(21);
    expect(context.data.hasMore).toBe(true);
    context.onLoadMore();
    expect(context.data.view.items).toHaveLength(21);
    expect(context.data.hasMore).toBe(false);
  });

  it('refreshes favorite entries when returning to the page', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    const question = (await appServices.questions.list())[0];
    if (!question) throw new Error('question fixtures are incomplete');

    await definition.onLoad.call(context, { kind: 'favorite' });
    expect(context.data.view.items).toHaveLength(0);

    appServices.progress.toggleFavorite(question.id, Date.now());
    await definition.onShow?.call(context);
    expect(context.data.view.items.map((item) => item.id)).toEqual([question.id]);

    appServices.progress.toggleFavorite(question.id, Date.now());
    await definition.onShow?.call(context);
    expect(context.data.view.items).toHaveLength(0);
  });

  it('refreshes wrong-question entries when returning to the page', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    const question = (await appServices.questions.list())[0];
    if (!question) throw new Error('question fixtures are incomplete');

    await definition.onLoad.call(context, { kind: 'wrong' });
    appServices.progress.recordAnswer({
      questionId: question.id,
      correct: false,
      durationMs: 1,
      at: '2026-08-01',
    });
    await definition.onShow?.call(context);

    expect(context.data.view.items.map((item) => item.id)).toEqual([question.id]);
  });

  it('coalesces an overlapping return refresh so an older load cannot overwrite it', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    let resolveQuestions:
      ((questions: Awaited<ReturnType<typeof appServices.questions.getByIds>>) => void) | undefined;
    const pendingQuestions = new Promise<
      Awaited<ReturnType<typeof appServices.questions.getByIds>>
    >((resolve) => {
      resolveQuestions = resolve;
    });
    const getByIds = vi
      .spyOn(appServices.questions, 'getByIds')
      .mockReturnValueOnce(pendingQuestions);

    const initialLoad = definition.onLoad.call(context, { kind: 'favorite' });
    await flushPromises();
    const returnRefresh = definition.onShow?.call(context);
    expect(getByIds).toHaveBeenCalledTimes(1);

    resolveQuestions?.([]);
    await initialLoad;
    await returnRefresh;
    expect(context.data.loadError).toBe(false);
    expect(context.data.view.items).toHaveLength(0);
  });

  it('does not write a completed request into an unloaded page', async () => {
    const { appServices, context, definition } = await loadQuestionListPage();
    let resolveQuestions:
      ((questions: Awaited<ReturnType<typeof appServices.questions.getByIds>>) => void) | undefined;
    const pendingQuestions = new Promise<
      Awaited<ReturnType<typeof appServices.questions.getByIds>>
    >((resolve) => {
      resolveQuestions = resolve;
    });
    vi.spyOn(appServices.questions, 'getByIds').mockReturnValueOnce(pendingQuestions);

    const initialLoad = definition.onLoad.call(context, { kind: 'favorite' });
    await flushPromises();
    context.onUnload();
    resolveQuestions?.([]);
    await initialLoad;

    expect(context.data.loaded).toBe(false);
    expect(context.data.view.items).toEqual([]);
  });

  it('creates one practice session for rapid taps, then retries navigation without replacing it', async () => {
    const { appServices, context, definition, navigateTo, showToast } =
      await loadQuestionListPage();
    const question = (await appServices.questions.list())[0];
    if (!question) throw new Error('question fixtures are incomplete');
    appServices.progress.recordAnswer({
      questionId: question.id,
      correct: false,
      durationMs: 1,
      at: '2026-08-01',
    });
    await definition.onLoad.call(context, { kind: 'wrong' });
    const saveSession = vi.spyOn(appServices.progress, 'saveSession');
    navigateTo.mockRejectedValueOnce(new Error('navigation failed'));

    context.onStartPractice();
    context.onStartPractice();
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledTimes(1);

    await flushPromises();
    context.onStartPractice();
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith({ title: '打开练习失败，请重试', icon: 'none' });
  });
});
