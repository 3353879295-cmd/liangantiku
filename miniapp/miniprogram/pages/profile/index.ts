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
    accountStatus: 'guest',
    syncText: '',
    lastSyncedAt: '',
    syncFailed: false,
  },

  onShow() {
    this.getTabBar()?.setData({ value: '/pages/profile/index' });

    const today = localDateKey();
    const preferences = appServices.progress.getPreferences();
    const certificate = CERTIFICATES.find(
      (item) => item.key === preferences.selectedCertificateKey,
    );
    const auth = appServices.auth.getState();
    const sync = appServices.cloudSync.getState();
    this.setData({
      nickname: preferences.nickname,
      avatarUrl: preferences.avatarUrl,
      certificateTitle: certificate?.title ?? '粮油仓储管理员 · 初级',
      dashboard: presentDashboard(appServices.progress.getDashboard(today)),
      activity: presentActivityBars(appServices.progress.getActivity(today, 7)),
      accountStatus: auth.status === 'authenticated' ? 'authenticated' : 'guest',
      syncText: syncLabel(sync.status, sync.pendingCount),
      lastSyncedAt: formatSyncedAt(appServices.cloudSync.getLastSyncedAt()),
      syncFailed: sync.status === 'failed',
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

  onLoginAndSync() {
    void wx.navigateTo({ url: '/pages/account-entry/index?mode=login' });
  },

  onOpenAccountData() {
    void wx.navigateTo({ url: '/packages/auxiliary/pages/account-data/index' });
  },

  async onRetrySync() {
    await appServices.auth.retryBackground();
    void this.onShow();
  },

  async onClearLearningData() {
    const result = await wx.showModal({
      title: '清除学习数据',
      content: '练习记录、错题、收藏和未完成练习将被清除；昵称、头像、每日目标和答题主题会保留。',
      confirmText: '清除',
      confirmColor: '#c44747',
    });
    if (!result.confirm) return;
    const completed = await appServices.auth.clearLearningData();
    if (!completed) {
      void wx.showToast({ title: '清除未完成，请重试', icon: 'none' });
      return;
    }
    void this.onShow();
    void wx.showToast({ title: '学习数据已清除', icon: 'none' });
  },
});

const syncLabel = (
  status: ReturnType<typeof appServices.cloudSync.getState>['status'],
  pending: number,
): string => {
  if (status === 'syncing') return '同步中';
  if (status === 'pending') return `待同步${pending > 0 ? `（${pending} 项）` : ''}`;
  if (status === 'failed') return '同步失败';
  if (status === 'conflict') return '已恢复云端记录';
  return '已同步';
};

const formatSyncedAt = (value: string | null): string => {
  if (!value) return '暂未同步';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '暂未同步'
    : `最近同步：${value.replace('T', ' ').slice(0, 16)}`;
};
