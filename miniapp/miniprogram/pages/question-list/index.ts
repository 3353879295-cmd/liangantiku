import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { CERTIFICATES } from '../../data/certificates';
import {
  findCatalogChapterLabel,
  findCatalogChapterTitle,
} from '../../presenters/catalog-presenter';
import { presentQuestionList } from '../../presenters/question-list-presenter';
import { appServices } from '../../services/app-services';
import {
  getActivePractice,
  restorePractice,
  startPracticeFromQuestions,
} from '../../services/practice-runtime';
import type {
  QuestionListFilter,
  QuestionListKind,
  QuestionListViewModel,
} from '../../presenters/question-list-presenter';
import type { WrongQuestionRecord } from '../../storage/migrations';
import type { CertificateLevel, OccupationCode, Question } from '../../types/domain';

const PAGE_SIZE = 20;
const KINDS = new Set<QuestionListKind>(['wrong', 'favorite', 'session']);
const emptyView = presentQuestionList({ kind: 'wrong', questions: [], ids: [] });
interface PageState {
  ids: string[];
  questions: Question[];
  wrongRecords: WrongQuestionRecord[];
  selectedAnswers: Record<string, string[]>;
  fullView: QuestionListViewModel;
  version: number;
  pending: Promise<void> | undefined;
  destroyed: boolean;
  startingPractice: boolean;
  practiceSignature: string | undefined;
}
const pageStates = new WeakMap<object, PageState>();
const getPageState = (page: object): PageState => {
  let state = pageStates.get(page);
  if (!state) {
    state = {
      ids: [],
      questions: [],
      wrongRecords: [],
      selectedAnswers: {},
      fullView: emptyView,
      version: 0,
      pending: undefined,
      destroyed: false,
      startingPractice: false,
      practiceSignature: undefined,
    };
    pageStates.set(page, state);
  }
  return state;
};

Page({
  data: {
    loading: true,
    loaded: false,
    loadError: false,
    loadingMore: false,
    hasMore: false,
    totalCount: 0,
    displayedCount: 0,
    startingPractice: false,
    kind: 'wrong',
    view: emptyView,
    occupation: '',
    level: 0,
    chapterId: '',
    preferenceKey: '',
    certificateTitle: '',
    includeMastered: false,
    expandedId: '',
    theme: 'light',
    themeClass: '',
    levelFilters: [
      { label: '初级', value: 5 },
      { label: '中级', value: 4 },
      { label: '高级', value: 3 },
      { label: '技师', value: 2 },
      { label: '高级技师', value: 1 },
    ],
  },
  async onLoad(options: Record<string, string | undefined>) {
    const kind = String(options['kind']) as QuestionListKind;
    if (!KINDS.has(kind)) {
      this.setData({ loading: false, loaded: true, loadError: true });
      return;
    }
    void wx.setNavigationBarTitle({
      title: kind === 'wrong' ? '错题本' : kind === 'favorite' ? '我的收藏' : '本次错题',
    });
    this.setData({ kind });
    this.syncTheme();
    if (kind !== 'session') this.syncCertificateScope();
    await this.loadSource();
  },
  async onShow() {
    this.syncTheme();
    const state = getPageState(this);
    state.startingPractice = false;
    state.practiceSignature = undefined;
    if (this.data.startingPractice) this.setData({ startingPractice: false });
    if (this.data.kind === 'session' || state.pending || !this.data.loaded) return;
    this.syncCertificateScope();
    await this.loadSource();
  },
  onUnload() {
    const state = getPageState(this);
    state.destroyed = true;
    state.version += 1;
  },
  syncTheme() {
    const theme = appServices.theme.get();
    this.setData({ theme, themeClass: theme === 'night' ? 'theme-night' : '' });
  },
  syncCertificateScope() {
    const selectedKey = appServices.progress.getPreferences().selectedCertificateKey;
    if (this.data.preferenceKey === selectedKey) return false;
    const certificate = CERTIFICATES.find(({ key }) => key === selectedKey) ?? CERTIFICATES[0];
    if (!certificate) return false;
    this.setData({
      occupation: certificate.occupation,
      level: certificate.level,
      chapterId: '',
      preferenceKey: selectedKey,
      certificateTitle: certificate.shortTitle,
    });
    return true;
  },
  async loadSource() {
    const state = getPageState(this);
    if (state.pending) return state.pending;
    const requestVersion = ++state.version;
    const kind = this.data.kind as QuestionListKind;
    this.setData({ loading: true, loadError: false });
    const pending = (async () => {
      try {
        let ids: string[] = [];
        let wrongRecords: WrongQuestionRecord[] = [];
        let selectedAnswers: Record<string, string[]> = {};
        if (kind === 'wrong') {
          wrongRecords = appServices.progress.listWrongQuestions(true);
          ids = wrongRecords.map((record) => record.questionId);
        } else if (kind === 'favorite') ids = appServices.progress.listFavoriteIds();
        else {
          await restorePractice();
          const session = getActivePractice();
          ids = [...(session?.report?.wrongQuestionIds ?? [])];
          selectedAnswers = Object.fromEntries(
            ids.map((id) => [id, [...(session?.answers[id] ?? [])]]),
          );
          wrongRecords = appServices.progress
            .listWrongQuestions(true)
            .filter((record) => ids.includes(record.questionId));
        }
        const questions = await appServices.questions.getByIds(ids);
        if (state.destroyed || state.version !== requestVersion) return;
        state.ids = ids;
        state.questions = questions;
        state.wrongRecords = wrongRecords;
        state.selectedAnswers = selectedAnswers;
        this.setData({ loaded: true, loading: false, loadError: false, expandedId: '' });
        this.applyView();
      } catch {
        if (!state.destroyed && state.version === requestVersion)
          this.setData({ loading: false, loaded: true, loadError: true });
      }
    })();
    state.pending = pending;
    try {
      await pending;
    } finally {
      if (state.pending === pending) state.pending = undefined;
    }
  },
  applyView() {
    const state = getPageState(this);
    const filter: QuestionListFilter = { includeMastered: this.data.includeMastered };
    if (this.data.occupation) filter.occupation = this.data.occupation as OccupationCode;
    if (this.data.level) filter.level = this.data.level as CertificateLevel;
    if (this.data.chapterId) filter.chapterId = this.data.chapterId;
    state.fullView = presentQuestionList({
      kind: this.data.kind as QuestionListKind,
      questions: state.questions,
      ids: state.ids,
      wrongRecords: state.wrongRecords,
      selectedAnswers: state.selectedAnswers,
      filter,
      resolveChapterTitle: (chapterId) => findCatalogChapterTitle(KNOWLEDGE_CATALOG, chapterId),
      resolveChapterLabel: (chapterId) => findCatalogChapterLabel(KNOWLEDGE_CATALOG, chapterId),
    });
    this.renderView(true);
  },
  renderView(reset: boolean) {
    const state = getPageState(this);
    const displayedCount = reset
      ? Math.min(PAGE_SIZE, state.fullView.items.length)
      : this.data.displayedCount;
    this.setData({
      view: { ...state.fullView, items: state.fullView.items.slice(0, displayedCount) },
      displayedCount,
      totalCount: state.fullView.items.length,
      hasMore: displayedCount < state.fullView.items.length,
      loadingMore: false,
    });
  },
  onReachBottom() {
    this.onLoadMore();
  },
  onLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.setData({ loadingMore: true });
    const state = getPageState(this);
    const firstNewIndex = this.data.displayedCount;
    const displayedCount = Math.min(firstNewIndex + PAGE_SIZE, state.fullView.items.length);
    const update: Record<string, unknown> = {
      displayedCount,
      hasMore: displayedCount < state.fullView.items.length,
      loadingMore: false,
    };
    state.fullView.items.slice(firstNewIndex, displayedCount).forEach((item, offset) => {
      update[`view.items[${firstNewIndex + offset}]`] = item;
    });
    this.setData(update);
  },
  onFilter(event: WechatMiniprogram.TouchEvent) {
    const group = String(event.currentTarget.dataset['group']);
    const value = String(event.currentTarget.dataset['value']);
    if (group === 'occupation') this.setData({ occupation: value, chapterId: '' });
    else if (group === 'level') this.setData({ level: Number(value), chapterId: '' });
    else if (group === 'chapter') this.setData({ chapterId: value });
    this.applyView();
  },
  onToggleMasteredFilter() {
    this.setData({ includeMastered: !this.data.includeMastered });
    this.applyView();
  },
  onToggleAnalysis(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset['id']);
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },
  onMarkMastered(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset['id']);
    if (!id || !appServices.progress.markMastered(id)) return;
    void wx.showToast({ title: '已标记为掌握', icon: 'none' });
    void this.loadSource();
  },
  onStartPractice() {
    const state = getPageState(this);
    if (state.startingPractice || !state.fullView.items.length) return;
    state.startingPractice = true;
    this.setData({ startingPractice: true });
    const mode = this.data.kind === 'favorite' ? 'favorite' : 'wrong';
    const signature = `${mode}:${state.fullView.items.map((item) => item.id).join(',')}`;
    try {
      if (
        state.practiceSignature !== signature &&
        !startPracticeFromQuestions(
          state.fullView.items.map((item) => item.question),
          mode,
        )
      ) {
        state.startingPractice = false;
        this.setData({ startingPractice: false });
        return;
      }
      state.practiceSignature = signature;
      let navigationSettled = false;
      const unlockAfterNavigationFailure = () => {
        if (navigationSettled) return;
        navigationSettled = true;
        state.startingPractice = false;
        if (!state.destroyed) {
          this.setData({ startingPractice: false });
          void wx.showToast({ title: '打开练习失败，请重试', icon: 'none' });
        }
      };
      const navigation = wx.navigateTo({
        url: '/pages/practice/index?resume=1',
        fail: unlockAfterNavigationFailure,
      });
      void Promise.resolve(navigation).catch(unlockAfterNavigationFailure);
    } catch {
      state.startingPractice = false;
      this.setData({ startingPractice: false });
    }
  },
  onReload() {
    void this.loadSource();
  },
  onToggleTheme() {
    const theme = appServices.theme.toggle();
    this.setData({ theme, themeClass: theme === 'night' ? 'theme-night' : '' });
  },
});
