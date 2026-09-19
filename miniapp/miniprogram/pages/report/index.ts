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
const pendingReportRestores = new WeakSet<object>();
const visibleReports = new WeakSet<object>();

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
    loading: true,
    loadError: false,
    retrying: false,
    memberPromptVisible: false,
    view: null as ReturnType<typeof presentReport> | null,
    hasWrong: false,
    sessionMode: '',
    sequentialRemaining: 0,
    sequentialProgressText: '',
    sequentialRoute: '',
    theme: 'light',
    themeClass: '',
  },

  async onLoad() {
    visibleReports.add(this);
    this.syncTheme();
    await this.loadReport();
  },

  async loadReport() {
    if (pendingReportRestores.has(this)) return;
    pendingReportRestores.add(this);
    if (visibleReports.has(this)) this.setData({ loading: true, loadError: false });
    try {
      await restorePractice();
      if (!visibleReports.has(this)) return;
      const session = submitActivePractice();
      recordActivePractice();
      if (!session?.report) {
        this.setData({ ready: false, view: null, loading: false, loadError: false });
        return;
      }
      let sequentialRemaining = 0;
      let sequentialProgressText = '';
      let sequentialRoute = '';
      const firstQuestion = session.questions[0];
      if (session.mode === 'sequential' && firstQuestion) {
        const scope = appServices.progress.getScope();
        const { occupation, level } = firstQuestion;
        const questions = await appServices.questions.list({ occupation, level });
        if (
          !visibleReports.has(this) ||
          appServices.progress.getScope() !== scope ||
          getActivePractice()?.id !== session.id
        )
          return;
        const ids = [...new Set(questions.map((question) => question.id))];
        const completed = appServices.progress.getQuestionProgress(ids).completed;
        sequentialRemaining = ids.length - completed;
        sequentialProgressText = `本题库已完成 ${completed} / ${ids.length} 题`;
        sequentialRoute = `/pages/practice/index?occupation=${occupation}&level=${level}&mode=sequential`;
      }
      this.setData({
        ready: true,
        loading: false,
        loadError: false,
        view: presentReport(session.report, (chapterId) =>
          findCatalogChapterTitle(KNOWLEDGE_CATALOG, chapterId),
        ),
        hasWrong: Boolean(session.report.wrongQuestionIds.length),
        sessionMode: session.mode,
        sequentialRemaining,
        sequentialProgressText,
        sequentialRoute,
      });
    } catch (error) {
      if (visibleReports.has(this)) {
        this.setData({
          loading: false,
          loadError: true,
          memberPromptVisible:
            error instanceof MembershipError && error.code === 'DAILY_LIMIT_REACHED',
        });
        void wx.showToast({
          title: error instanceof Error ? error.message : '练习恢复失败，请重试',
          icon: 'none',
        });
      }
    } finally {
      pendingReportRestores.delete(this);
    }
  },

  onShow() {
    visibleReports.add(this);
    this.syncTheme();
  },

  onUnload() {
    visibleReports.delete(this);
  },

  onRetryLoad() {
    void this.loadReport();
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

  async onContinueSequential() {
    if (this.data.retrying || !this.data.sequentialRemaining || !this.data.sequentialRoute) return;
    this.setData({ retrying: true });
    try {
      await wx.redirectTo({ url: this.data.sequentialRoute });
    } catch {
      void wx.showToast({ title: '页面未打开，请重试', icon: 'none' });
    } finally {
      if (visibleReports.has(this)) this.setData({ retrying: false });
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
