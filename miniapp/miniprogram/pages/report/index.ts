import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { findCatalogChapterTitle } from '../../presenters/catalog-presenter';
import { presentReport } from '../../presenters/report-presenter';
import {
  getActivePractice,
  getPracticeStartCancellation,
  recordActivePractice,
  restorePractice,
  startPracticeFromQuestions,
  startRandomPracticeFromQuestions,
  submitActivePractice,
} from '../../services/practice-runtime';
import { appServices } from '../../services/app-services';
import { isMembershipAccessError } from '../../repositories/membership-client';

const pendingAnswerSheetNavigations = new WeakSet<object>();
const pendingReportRestores = new WeakSet<object>();
const visibleReports = new WeakSet<object>();
type ReportSession = NonNullable<ReturnType<typeof submitActivePractice>>;
const reportSessions = new WeakMap<object, ReportSession>();
const pendingPracticeSessions = new WeakMap<object, ReportSession>();
const startCancellations = new WeakMap<object, () => void>();

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
    pendingPractice: false,
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
        reportSessions.delete(this);
        pendingPracticeSessions.delete(this);
        this.setData({ ready: false, view: null, loading: false, loadError: false });
        return;
      }
      reportSessions.set(this, session);
      pendingPracticeSessions.delete(this);
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
        pendingPractice: false,
      });
    } catch (error) {
      if (visibleReports.has(this)) {
        this.setData({
          loading: false,
          loadError: true,
          memberPromptVisible: isMembershipAccessError(error),
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
    startCancellations.get(this)?.();
    startCancellations.delete(this);
    visibleReports.delete(this);
    reportSessions.delete(this);
    pendingPracticeSessions.delete(this);
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
    if (!this.data.hasWrong || pendingPracticeSessions.has(this)) return;
    void wx.navigateTo({ url: '/pages/question-list/index?kind=session' });
  },

  async onPracticeChapter(event: WechatMiniprogram.TouchEvent) {
    if (this.data.retrying || pendingPracticeSessions.has(this)) return;
    const chapterId = String(event.currentTarget.dataset['chapterId'] ?? '');
    const session = reportSessions.get(this);
    const question = session?.questions.find((item) => item.chapterId === chapterId);
    if (!chapterId || !question) return;
    this.setData({ retrying: true });
    try {
      await wx.redirectTo({
        url: `/pages/practice/index?occupation=${question.occupation}&level=${question.level}&mode=chapter&chapterId=${encodeURIComponent(chapterId)}`,
      });
    } catch {
      void wx.showToast({ title: '页面未打开，请重试', icon: 'none' });
    } finally {
      if (visibleReports.has(this)) this.setData({ retrying: false });
    }
  },

  onOpenAnswerSheet() {
    if (pendingPracticeSessions.has(this) || pendingAnswerSheetNavigations.has(this)) return;
    pendingAnswerSheetNavigations.add(this);
    void wx.navigateTo({
      url: '/pages/answer-sheet/index',
      ...createAnswerSheetNavigationCallbacks(this),
    });
  },

  async onRetry() {
    if (this.data.retrying || pendingPracticeSessions.has(this)) return;
    const session = reportSessions.get(this);
    if (!session) return;
    this.setData({ retrying: true });
    try {
      const pending =
        session.mode === 'random'
          ? startRandomPracticeFromQuestions(session.questions)
          : startPracticeFromQuestions(session.questions, session.mode);
      startCancellations.set(this, getPracticeStartCancellation());
      const next = await pending;
      if (!visibleReports.has(this)) return;
      if (next) {
        pendingPracticeSessions.set(this, next);
        this.setData({ pendingPractice: true });
        await wx.redirectTo({ url: '/pages/practice/index?resume=1' });
      }
    } catch (error) {
      if (!visibleReports.has(this)) return;
      if (isMembershipAccessError(error)) {
        this.setData({ memberPromptVisible: true });
      } else {
        void wx.showToast({
          title: error instanceof Error ? error.message : '暂时无法开始，请重试',
          icon: 'none',
        });
      }
    } finally {
      if (visibleReports.has(this)) this.setData({ retrying: false });
    }
  },

  async onRetryWrong() {
    if (this.data.retrying || pendingPracticeSessions.has(this)) return;
    this.setData({ retrying: true });
    try {
      const session = reportSessions.get(this);
      const wrongIds = new Set(session?.report?.wrongQuestionIds ?? []);
      const wrongQuestions =
        session?.questions.filter((question) => wrongIds.has(question.id)) ?? [];
      if (!wrongQuestions.length) return;
      const pending = startPracticeFromQuestions(wrongQuestions, 'wrong', wrongQuestions.length);
      startCancellations.set(this, getPracticeStartCancellation());
      const next = await pending;
      if (!visibleReports.has(this)) return;
      if (next) {
        pendingPracticeSessions.set(this, next);
        this.setData({ pendingPractice: true });
      }
      if (next) await wx.redirectTo({ url: '/pages/practice/index?resume=1' });
    } catch (error) {
      if (!visibleReports.has(this)) return;
      if (isMembershipAccessError(error)) {
        this.setData({ memberPromptVisible: true });
        return;
      }
      void wx.showToast({
        title: error instanceof Error ? error.message : '暂时无法开始，请重试',
        icon: 'none',
      });
    } finally {
      if (visibleReports.has(this)) this.setData({ retrying: false });
    }
  },

  async onContinueSequential() {
    if (
      this.data.retrying ||
      pendingPracticeSessions.has(this) ||
      !this.data.sequentialRemaining ||
      !this.data.sequentialRoute
    )
      return;
    this.setData({ retrying: true });
    try {
      await wx.redirectTo({ url: this.data.sequentialRoute });
    } catch {
      void wx.showToast({ title: '页面未打开，请重试', icon: 'none' });
    } finally {
      if (visibleReports.has(this)) this.setData({ retrying: false });
    }
  },

  async onResumePendingPractice() {
    if (this.data.retrying || !pendingPracticeSessions.has(this)) return;
    this.setData({ retrying: true });
    try {
      await wx.redirectTo({ url: '/pages/practice/index?resume=1' });
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
