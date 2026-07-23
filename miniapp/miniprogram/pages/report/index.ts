import { presentReport } from '../../presenters/report-presenter';
import {
  getActivePractice,
  recordActivePractice,
  restorePractice,
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
      view: presentReport(session.report),
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
    const question = session?.questions[0];
    if (!session || !question) return;
    void wx.redirectTo({
      url: `/pages/practice/index?occupation=${question.occupation}&level=${question.level}&mode=${session.mode}`,
    });
  },

  onBackHome() {
    void wx.switchTab({ url: '/pages/home/index' });
  },
});
