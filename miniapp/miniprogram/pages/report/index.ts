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
import { appServices } from '../../services/app-services';

const pendingAnswerSheetNavigations = new WeakSet<object>();

const createAnswerSheetNavigationCallbacks = (page: object) => {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pendingAnswerSheetNavigations.delete(page);
  };
  return { success: release, fail: release, complete: release };
};

Page({
  data: {
    ready: false,
    view: null as ReturnType<typeof presentReport> | null,
    hasWrong: false,
    sessionMode: '',
    theme: 'light',
    themeClass: '',
  },

  async onLoad() {
    this.syncTheme();
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

  onShow() {
    this.syncTheme();
  },

  syncTheme() {
    const theme = appServices.theme.get();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
  },

  onReviewWrong() {
    if (!this.data.hasWrong) return;
    void wx.navigateTo({ url: '/pages/question-list/index?kind=session' });
  },

  onOpenAnswerSheet() {
    if (pendingAnswerSheetNavigations.has(this)) return;
    pendingAnswerSheetNavigations.add(this);
    void wx.navigateTo({
      url: '/pages/answer-sheet/index',
      ...createAnswerSheetNavigationCallbacks(this),
    });
  },

  onRetry() {
    const session = getActivePractice();
    if (!session || !startPracticeFromQuestions(session.questions, session.mode)) return;
    void wx.redirectTo({ url: '/pages/practice/index?resume=1' });
  },

  onBackHome() {
    void wx.switchTab({ url: '/pages/home/index' });
  },

  onToggleTheme() {
    const theme = appServices.theme.toggle();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
  },
});
