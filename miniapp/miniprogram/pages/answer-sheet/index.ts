import { getAnswerSheet, navigateToQuestion } from '../../services/practice-session';
import {
  getActivePractice,
  restorePractice,
  saveActivePractice,
  submitActivePractice,
} from '../../services/practice-runtime';
import { appServices } from '../../services/app-services';
import type { PracticeMode } from '../../types/domain';

const pendingQuestionSelections = new WeakSet<object>();
const pendingSubmissions = new WeakSet<object>();
const pendingSheetRestores = new WeakSet<object>();
const visibleSheets = new WeakSet<object>();

const redirectToReport = () =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('页面跳转超时，请重试')), 5000);
    try {
      const result = wx.redirectTo({
        url: '/pages/report/index',
        success: () => finish(),
        fail: () => finish(new Error('页面跳转失败，请重试')),
        complete: () => finish(),
      });
      void Promise.resolve(result).catch(() => finish(new Error('页面跳转失败，请重试')));
    } catch {
      finish(new Error('页面跳转失败，请重试'));
    }
  });

const createNavigationCallbacks = (page: object) => {
  let released = false;
  const release = (message?: string) => {
    if (released) return;
    released = true;
    clearTimeout(timeout);
    pendingQuestionSelections.delete(page);
    if (message && visibleSheets.has(page)) void wx.showToast({ title: message, icon: 'none' });
  };
  const timeout = setTimeout(() => release('页面跳转超时，请重试'), 5000);
  return {
    success: () => release(),
    fail: () => release('页面跳转失败，请重试'),
    complete: () => release(),
  };
};

export const buildAnswerSheetSubmitModal = (
  mode: PracticeMode,
  unanswered: number,
): { title: string; content: string; confirmText: string } => {
  const isMock = mode === 'mock';
  return {
    title: isMock ? '确认交卷' : '结束本次练习',
    content:
      mode === 'sequential' && unanswered
        ? `未答题 ${unanswered} 道，会保留到后续练习，不计入已完成题目。`
        : unanswered
          ? `未答题 ${unanswered} 道，提交后将按未答处理。`
          : '未答题 0 道，提交后将生成本次结果。',
    confirmText: isMock ? '确认交卷' : '确认结束',
  };
};

Page({
  data: {
    ready: false,
    loading: true,
    loadError: false,
    modeText: '',
    answeredText: '',
    submitted: false,
    submitting: false,
    submitText: '',
    theme: 'light',
    themeClass: '',
    items: [] as Array<{ index: number; number: number; status: string; current: boolean }>,
  },

  async onLoad() {
    visibleSheets.add(this);
    this.syncTheme();
    await this.loadSheet();
  },

  async loadSheet() {
    if (pendingSheetRestores.has(this)) return;
    pendingSheetRestores.add(this);
    if (visibleSheets.has(this)) this.setData({ loading: true, loadError: false });
    try {
      await restorePractice();
    } catch (error) {
      if (visibleSheets.has(this)) {
        this.setData({ loading: false, loadError: true });
        void wx.showToast({
          title: error instanceof Error ? error.message : '练习恢复失败，请重试',
          icon: 'none',
        });
      }
      return;
    } finally {
      pendingSheetRestores.delete(this);
    }
    if (visibleSheets.has(this)) {
      this.renderSheet();
      this.setData({ loading: false, loadError: false });
    }
  },

  onShow() {
    visibleSheets.add(this);
    this.syncTheme();
    if (getActivePractice()) this.renderSheet();
  },

  onUnload() {
    visibleSheets.delete(this);
  },

  onRetryLoad() {
    void this.loadSheet();
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
      this.setData({ ready: false, items: [] });
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
    visibleSheets.add(this);
    saveActivePractice(navigateToQuestion(session, index, Date.now()));
    pendingQuestionSelections.add(this);
    const callbacks = createNavigationCallbacks(this);
    try {
      const result =
        session.status === 'submitted'
          ? wx.redirectTo({ url: '/pages/practice/index?resume=1', ...callbacks })
          : wx.navigateBack(callbacks);
      void Promise.resolve(result).catch(() => callbacks.fail());
    } catch {
      callbacks.fail();
    }
  },

  async onSubmit() {
    if (pendingSubmissions.has(this)) return;
    const session = getActivePractice();
    if (!session) return;
    visibleSheets.add(this);
    pendingSubmissions.add(this);
    this.setData({ submitting: true });
    try {
      const unanswered = getAnswerSheet(session).filter(
        (item) => item.status === 'unanswered',
      ).length;
      const result = await wx.showModal(buildAnswerSheetSubmitModal(session.mode, unanswered));
      if (!result.confirm) return;
      const submitted = submitActivePractice();
      if (!submitted?.report) throw new Error('提交失败，请稍后重试');
      await redirectToReport();
      return;
    } catch (error) {
      void wx.showToast({
        title: error instanceof Error ? error.message : '提交失败，请稍后重试',
        icon: 'none',
      });
    } finally {
      if (pendingSubmissions.has(this)) {
        pendingSubmissions.delete(this);
        if (visibleSheets.has(this)) this.setData({ submitting: false });
      }
    }
  },

  onToggleTheme() {
    const theme = appServices.theme.toggle();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
  },
});
