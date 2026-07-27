import { getAnswerSheet, navigateToQuestion } from '../../services/practice-session';
import {
  getActivePractice,
  restorePractice,
  saveActivePractice,
} from '../../services/practice-runtime';
import { appServices } from '../../services/app-services';
import type { PracticeMode } from '../../types/domain';

const pendingQuestionSelections = new WeakSet<object>();

const createNavigationCallbacks = (page: object) => {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    pendingQuestionSelections.delete(page);
  };
  return { success: release, fail: release, complete: release };
};

export const buildAnswerSheetSubmitModal = (
  mode: PracticeMode,
  unanswered: number,
): { title: string; content: string; confirmText: string } => {
  const isMock = mode === 'mock';
  return {
    title: isMock ? '确认交卷' : '结束本次练习',
    content: unanswered
      ? `未答题 ${unanswered} 道，提交后将按未答处理。`
      : '未答题 0 道，提交后将生成本次结果。',
    confirmText: isMock ? '确认交卷' : '结束本次练习',
  };
};

Page({
  data: {
    ready: false,
    modeText: '',
    answeredText: '',
    submitted: false,
    submitText: '',
    theme: 'light',
    themeClass: '',
    items: [] as Array<{ index: number; number: number; status: string; current: boolean }>,
  },

  async onLoad() {
    this.syncTheme();
    await restorePractice();
    this.renderSheet();
  },

  onShow() {
    this.syncTheme();
    if (getActivePractice()) this.renderSheet();
  },

  syncTheme() {
    const theme = appServices.theme.get();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
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
      submitted: session.status === 'submitted',
      submitText: session.mode === 'mock' ? '确认交卷' : '结束本次练习',
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
    if (
      !session ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= session.questionIds.length ||
      pendingQuestionSelections.has(this)
    ) {
      return;
    }
    saveActivePractice(navigateToQuestion(session, index, Date.now()));
    pendingQuestionSelections.add(this);
    const callbacks = createNavigationCallbacks(this);
    if (session.status === 'submitted') {
      void wx.redirectTo({ url: '/pages/practice/index?resume=1', ...callbacks });
      return;
    }
    void wx.navigateBack(callbacks);
  },

  async onSubmit() {
    const session = getActivePractice();
    if (!session) return;
    const unanswered = getAnswerSheet(session).filter(
      (item) => item.status === 'unanswered',
    ).length;
    const result = await wx.showModal(buildAnswerSheetSubmitModal(session.mode, unanswered));
    if (result.confirm) void wx.redirectTo({ url: '/pages/report/index' });
  },

  onToggleTheme() {
    const theme = appServices.theme.toggle();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
  },
});
