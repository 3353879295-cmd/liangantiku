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
  QuestionListKind,
  QuestionListFilter,
} from '../../presenters/question-list-presenter';
import type { WrongQuestionRecord } from '../../storage/migrations';
import type { CertificateLevel, OccupationCode, Question } from '../../types/domain';

const KINDS = new Set<QuestionListKind>(['wrong', 'favorite', 'session']);

const emptyView = presentQuestionList({ kind: 'wrong', questions: [], ids: [] });

Page({
  data: {
    loading: true,
    loaded: false,
    loadError: false,
    kind: 'wrong',
    ids: [] as string[],
    rawQuestions: [] as Question[],
    wrongRecords: [] as WrongQuestionRecord[],
    selectedAnswers: {},
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

  onShow() {
    this.syncTheme();
    if (this.data.kind === 'session') return;
    const scopeChanged = this.syncCertificateScope();
    if (scopeChanged && this.data.loaded && !this.data.loadError) this.applyView();
  },

  syncTheme() {
    const theme = appServices.theme.get();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
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
    this.setData({ loading: true, loadError: false });
    const kind = this.data.kind;
    let ids: string[] = [];
    let wrongRecords: WrongQuestionRecord[] = [];
    let selectedAnswers: Record<string, string[]> = {};
    try {
      if (kind === 'wrong') {
        wrongRecords = appServices.progress.listWrongQuestions(true);
        ids = wrongRecords.map((record) => record.questionId);
      } else if (kind === 'favorite') {
        ids = appServices.progress.listFavoriteIds();
      } else {
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
      const rawQuestions = await appServices.questions.getByIds(ids);
      this.setData({
        ids,
        rawQuestions,
        wrongRecords,
        selectedAnswers,
        loading: false,
        loaded: true,
        loadError: false,
      });
      this.applyView();
    } catch {
      this.setData({
        loading: false,
        loaded: true,
        loadError: true,
      });
    }
  },

  applyView() {
    const filter: QuestionListFilter = {
      includeMastered: this.data.includeMastered,
    };
    if (this.data.occupation) filter.occupation = this.data.occupation as OccupationCode;
    if (this.data.level) filter.level = this.data.level as CertificateLevel;
    if (this.data.chapterId) filter.chapterId = this.data.chapterId;
    this.setData({
      view: presentQuestionList({
        kind: this.data.kind as QuestionListKind,
        questions: this.data.rawQuestions,
        ids: this.data.ids,
        wrongRecords: this.data.wrongRecords,
        selectedAnswers: this.data.selectedAnswers,
        filter,
        resolveChapterTitle: (chapterId) => findCatalogChapterTitle(KNOWLEDGE_CATALOG, chapterId),
        resolveChapterLabel: (chapterId) => findCatalogChapterLabel(KNOWLEDGE_CATALOG, chapterId),
      }),
    });
  },

  onFilter(event: WechatMiniprogram.TouchEvent) {
    const group = String(event.currentTarget.dataset['group']);
    const value = String(event.currentTarget.dataset['value']);
    if (group === 'occupation') {
      this.setData({ occupation: value, chapterId: '' });
    } else if (group === 'level') {
      this.setData({ level: Number(value), chapterId: '' });
    } else if (group === 'chapter') {
      this.setData({ chapterId: value });
    }
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
    const questions = this.data.view.items.map((item) => item.question);
    const mode = this.data.kind === 'favorite' ? 'favorite' : 'wrong';
    if (!startPracticeFromQuestions(questions, mode)) return;
    void wx.navigateTo({ url: '/pages/practice/index?resume=1' });
  },

  onReload() {
    void this.loadSource();
  },

  onToggleTheme() {
    const theme = appServices.theme.toggle();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
  },
});
