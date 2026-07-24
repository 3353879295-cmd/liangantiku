import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { findCatalogChapterTitle } from '../../presenters/catalog-presenter';
import { presentReport } from '../../presenters/report-presenter';
import {
  getActivePractice,
  recordActivePractice,
  restorePractice,
  startPracticeFromQuestions,
  submitActivePractice,
} from '../../services/practice-runtime';

Page({
  data: {
    ready: false,
    view: null as ReturnType<typeof presentReport> | null,
    hasWrong: false,
    sessionMode: '',
  },

  async onLoad() {
    await restorePractice();
    const session = submitActivePractice();
    recordActivePractice();
    if (!session?.report) return;
    this.setData({
      ready: true,
      view: presentReport(session.report, (chapterId) =>
        findCatalogChapterTitle(KNOWLEDGE_CATALOG, chapterId),
      ),
      hasWrong: Boolean(session.report.wrongQuestionIds.length),
      sessionMode: session.mode,
    });
  },

  onReviewWrong() {
    if (!this.data.hasWrong) return;
    void wx.navigateTo({ url: '/pages/question-list/index?kind=session' });
  },

  onRetry() {
    const session = getActivePractice();
    if (!session || !startPracticeFromQuestions(session.questions, session.mode)) return;
    void wx.redirectTo({ url: '/pages/practice/index?resume=1' });
  },

  onBackHome() {
    void wx.switchTab({ url: '/pages/home/index' });
  },
});
