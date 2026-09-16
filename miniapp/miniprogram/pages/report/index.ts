import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { findCatalogChapterTitle } from '../../presenters/catalog-presenter';
import { presentReport } from '../../presenters/report-presenter';
import {
  getActivePractice,
  recordActivePractice,
  restorePractice,
  startPracticeFromQuestions,
  startRandomPracticeFromQuestions,
  submitActivePractice,
} from '../../services/practice-runtime';
import { appServices } from '../../services/app-services';
import { MembershipError } from '../../repositories/membership-client';

const pendingAnswerSheetNavigations = new WeakSet<object>();
const pendingRetryNavigations = new WeakSet<object>();

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
    retrying: false,
    memberPromptVisible: false,
    view: null as ReturnType<typeof presentReport> | null,
    hasWrong: false,
    sessionMode: '',
    theme: 'light',
    themeClass: '',
  },

  async onLoad() {
    this.syncTheme();
    try {
      await restorePractice();
    } catch (error) {
      this.setData({
        memberPromptVisible:
          error instanceof MembershipError && error.code === 'DAILY_LIMIT_REACHED',
      });
      void wx.showToast({
        title: error instanceof Error ? error.message : '练习恢复失败，请重试',
        icon: 'none',
      });
      return;
    }
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

  async onRetry() {
    if (this.data.retrying) return;
    const session = getActivePractice();
    if (!session) return;
    this.setData({ retrying: true });
    try {
      const next = pendingRetryNavigations.has(this)
        ? session
        : session.mode === 'random'
          ? await startRandomPracticeFromQuestions(session.questions)
          : startPracticeFromQuestions(session.questions, session.mode);
      if (next) {
        pendingRetryNavigations.add(this);
        await wx.redirectTo({ url: '/pages/practice/index?resume=1' });
        pendingRetryNavigations.delete(this);
      }
    } catch (error) {
      if (error instanceof MembershipError && error.code === 'DAILY_LIMIT_REACHED') {
        this.setData({ memberPromptVisible: true });
      } else {
        void wx.showToast({
          title: error instanceof Error ? error.message : '暂时无法开始，请重试',
          icon: 'none',
        });
      }
    } finally {
      this.setData({ retrying: false });
    }
  },

  onCloseMemberPrompt() {
    this.setData({ memberPromptVisible: false });
  },

  onOpenMember() {
    this.setData({ memberPromptVisible: false });
    void wx.navigateTo({ url: '/packages/auxiliary/pages/member/index' });
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
