import { CERTIFICATES } from '../../data/certificates';
import { presentDashboard } from '../../presenters/home-presenter';
import { appServices, localDateKey } from '../../services/app-services';

const goalOptions = [10, 20, 30, 50];

Page({
  data: {
    certificateTitle: '',
    dashboard: presentDashboard({
      answered: 0,
      correct: 0,
      accuracy: 0,
      durationMs: 0,
      streakDays: 0,
      todayAnswered: 0,
      dailyGoal: 20,
    }),
    wrongCount: 0,
    favoriteCount: 0,
    dailyGoal: 20,
    activity: [] as Array<{ date: string; label: string; answered: number; height: number }>,
  },

  onShow() {
    const today = localDateKey();
    const preferences = appServices.progress.getPreferences();
    const certificate = CERTIFICATES.find(
      (item) => item.key === preferences.selectedCertificateKey,
    );
    const activity = appServices.progress.getActivity(today, 7);
    const maximum = Math.max(1, ...activity.map((day) => day.answered));
    this.setData({
      certificateTitle: certificate?.title ?? '储粮保管员 · 初级',
      dashboard: presentDashboard(appServices.progress.getDashboard(today)),
      wrongCount: appServices.progress.listWrongQuestions(false).length,
      favoriteCount: appServices.progress.listFavoriteIds().length,
      dailyGoal: preferences.dailyGoal,
      activity: activity.map((day) => ({
        date: day.date,
        label: day.date.slice(5).replace('-', '/'),
        answered: day.answered,
        height: day.answered ? Math.max(12, Math.round((day.answered / maximum) * 100)) : 4,
      })),
    });
  },

  onOpenWrong() {
    void wx.navigateTo({ url: '/pages/question-list/index?kind=wrong' });
  },

  onOpenFavorite() {
    void wx.navigateTo({ url: '/pages/question-list/index?kind=favorite' });
  },

  onChangeCertificate() {
    void wx.switchTab({ url: '/pages/library/index' });
  },

  async onChangeGoal() {
    let result: WechatMiniprogram.ShowActionSheetSuccessCallbackResult;
    try {
      result = await wx.showActionSheet({
        itemList: goalOptions.map((goal) => `每天 ${goal} 题`),
      });
    } catch {
      return;
    }
    const goal = goalOptions[result.tapIndex];
    if (!goal) return;
    appServices.progress.updatePreferences({ dailyGoal: goal });
    void this.onShow();
  },

  async onClearLearningData() {
    const result = await wx.showModal({
      title: '清除学习数据',
      content: '练习记录、错题、收藏和未完成练习将被清除，题库内容不会受影响。',
      confirmText: '清除',
      confirmColor: '#c44747',
    });
    if (!result.confirm) return;
    appServices.progress.clearLearningData();
    void this.onShow();
    void wx.showToast({ title: '学习数据已清除', icon: 'none' });
  },
});
