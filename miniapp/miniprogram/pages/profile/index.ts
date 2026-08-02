import { CERTIFICATES } from '../../data/certificates';
import { presentDashboard } from '../../presenters/home-presenter';
import { presentActivityBars } from '../../presenters/profile-presenter';
import { appServices, localDateKey } from '../../services/app-services';

const emptyDashboard = presentDashboard({
  answered: 0,
  correct: 0,
  accuracy: 0,
  durationMs: 0,
  streakDays: 0,
  todayAnswered: 0,
  dailyGoal: 20,
});

Page({
  data: {
    nickname: '仓廪小麦',
    avatarUrl: '',
    certificateTitle: '',
    dashboard: emptyDashboard,
    activity: [] as ReturnType<typeof presentActivityBars>,
  },

  onShow() {
    this.getTabBar()?.setData({ value: '/pages/profile/index' });

    const today = localDateKey();
    const preferences = appServices.progress.getPreferences();
    const certificate = CERTIFICATES.find(
      (item) => item.key === preferences.selectedCertificateKey,
    );
    this.setData({
      nickname: preferences.nickname,
      avatarUrl: preferences.avatarUrl,
      certificateTitle: certificate?.title ?? '粮油仓储管理员 · 初级',
      dashboard: presentDashboard(appServices.progress.getDashboard(today)),
      activity: presentActivityBars(appServices.progress.getActivity(today, 7)),
    });
  },

  onOpenEditProfile() {
    void wx.navigateTo({ url: '/pages/edit-profile/index' });
  },

  onOpenMember() {
    void wx.navigateTo({ url: '/pages/member/index' });
  },

  onOpenLearningReport() {
    void wx.navigateTo({ url: '/pages/learning-report/index' });
  },

  onOpenLearningSettings() {
    void wx.navigateTo({ url: '/pages/learning-settings/index' });
  },

  async onClearLearningData() {
    const result = await wx.showModal({
      title: '清除学习数据',
      content: '练习记录、错题、收藏和未完成练习将被清除；昵称、头像、每日目标和答题主题会保留。',
      confirmText: '清除',
      confirmColor: '#c44747',
    });
    if (!result.confirm) return;
    appServices.progress.clearLearningData();
    void this.onShow();
    void wx.showToast({ title: '学习数据已清除', icon: 'none' });
  },
});
