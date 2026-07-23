import { getAnswerSheet, navigateToQuestion } from '../../services/practice-session';
import {
  getActivePractice,
  restorePractice,
  saveActivePractice,
} from '../../services/practice-runtime';

Page({
  data: {
    ready: false,
    modeText: '',
    answeredText: '',
    items: [] as Array<{ index: number; number: number; status: string; current: boolean }>,
  },

  async onLoad() {
    await restorePractice();
    this.renderSheet();
  },

  onShow() {
    if (getActivePractice()) this.renderSheet();
  },

  renderSheet() {
    const session = getActivePractice();
    if (!session) {
      this.setData({ ready: false });
      return;
    }
    const sheet = getAnswerSheet(session);
    const answered = sheet.filter((item) => item.status !== 'unanswered').length;
    this.setData({
      ready: true,
      modeText: session.mode === 'mock' ? '模拟考试' : '练习答题卡',
      answeredText: `已答 ${answered} / ${sheet.length} 题`,
      items: sheet.map((item, index) => ({
        index,
        number: index + 1,
        status: item.status,
        current: index === session.currentIndex,
      })),
    });
  },

  onSelectQuestion(event: WechatMiniprogram.TouchEvent) {
    const session = getActivePractice();
    const index = Number(event.currentTarget.dataset['index']);
    if (!session || !Number.isInteger(index)) return;
    saveActivePractice(navigateToQuestion(session, index, Date.now()));
    void wx.navigateBack();
  },

  async onSubmit() {
    const session = getActivePractice();
    if (!session) return;
    const unanswered = getAnswerSheet(session).filter(
      (item) => item.status === 'unanswered',
    ).length;
    const result = await wx.showModal({
      title: '确认交卷',
      content: unanswered
        ? `还有 ${unanswered} 题未作答，仍要交卷吗？`
        : '交卷后将生成本次练习结果。',
      confirmText: '交卷',
    });
    if (result.confirm) void wx.redirectTo({ url: '/pages/report/index' });
  },
});
