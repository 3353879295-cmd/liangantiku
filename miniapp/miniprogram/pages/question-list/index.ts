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
    kind: 'wrong',
    ids: [] as string[],
    rawQuestions: [] as Question[],
    wrongRecords: [] as WrongQuestionRecord[],
    view: emptyView,
    occupation: '',
    level: 0,
    module: '',
    includeMastered: false,
    expandedId: '',
    levelFilters: [
      { label: '全部等级', value: 0 },
      { label: '初级', value: 5 },
      { label: '中级', value: 4 },
      { label: '高级', value: 3 },
    ],
  },

  async onLoad(options: Record<string, string | undefined>) {
    const kind = String(options['kind']) as QuestionListKind;
    if (!KINDS.has(kind)) {
      this.setData({ loading: false });
      return;
    }
    void wx.setNavigationBarTitle({
      title: kind === 'wrong' ? '错题本' : kind === 'favorite' ? '我的收藏' : '本次错题',
    });
    this.setData({ kind });
    await this.loadSource();
  },

  async loadSource() {
    const kind = this.data.kind;
    let ids: string[] = [];
    let wrongRecords: WrongQuestionRecord[] = [];
    if (kind === 'wrong') {
      wrongRecords = appServices.progress.listWrongQuestions(true);
      ids = wrongRecords.map((record) => record.questionId);
    } else if (kind === 'favorite') {
      ids = appServices.progress.listFavoriteIds();
    } else {
      await restorePractice();
      ids = [...(getActivePractice()?.report?.wrongQuestionIds ?? [])];
      wrongRecords = appServices.progress
        .listWrongQuestions(true)
        .filter((record) => ids.includes(record.questionId));
    }
    const rawQuestions = await appServices.questions.getByIds(ids);
    this.setData({ ids, rawQuestions, wrongRecords, loading: false });
    this.applyView();
  },

  applyView() {
    const filter: QuestionListFilter = {
      includeMastered: this.data.includeMastered,
    };
    if (this.data.occupation) filter.occupation = this.data.occupation as OccupationCode;
    if (this.data.level) filter.level = this.data.level as CertificateLevel;
    if (this.data.module) filter.module = this.data.module;
    this.setData({
      view: presentQuestionList({
        kind: this.data.kind as QuestionListKind,
        questions: this.data.rawQuestions,
        ids: this.data.ids,
        wrongRecords: this.data.wrongRecords,
        filter,
      }),
    });
  },

  onFilter(event: WechatMiniprogram.TouchEvent) {
    const group = String(event.currentTarget.dataset['group']);
    const value = String(event.currentTarget.dataset['value']);
    if (group === 'occupation') {
      this.setData({ occupation: value });
    } else if (group === 'level') {
      this.setData({ level: Number(value) });
    } else if (group === 'module') {
      this.setData({ module: value });
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
});
