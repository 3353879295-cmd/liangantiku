import { CERTIFICATES } from '../../data/certificates';
import { presentDashboard } from '../../presenters/home-presenter';
import { presentActivityBars } from '../../presenters/profile-presenter';
import { appServices, localDateKey } from '../../services/app-services';
import { presentMembership } from '../../presenters/membership-presenter';

const emptyDashboard = presentDashboard({
  answered: 0,
  correct: 0,
  accuracy: 0,
  durationMs: 0,
  streakDays: 0,
  todayAnswered: 0,
  dailyGoal: 20,
});

const visiblePages = new WeakSet<object>();
const pendingSyncPages = new WeakSet<object>();
const pendingRecoveryRefreshes = new WeakSet<object>();
const membershipRequests = new WeakMap<object, number>();
const authSubscriptions = new WeakMap<object, () => void>();
let membershipRequestId = 0;

const presentAccountStatus = (
  auth: ReturnType<typeof appServices.auth.getState>,
): {
  accountStatus: 'guest' | 'authenticated' | 'recovering' | 'offline';
  syncText: string;
  accountDetail: string;
} => {
  if (auth.status === 'authenticated') {
    return { accountStatus: 'authenticated', syncText: '', accountDetail: '' };
  }
  if (auth.preference === 'account' && !auth.temporaryGuest) {
    return auth.status === 'checking'
      ? {
          accountStatus: 'recovering',
          syncText: '正在恢复账号记录',
          accountDetail: '正在验证账号并恢复记录。',
        }
      : {
          accountStatus: 'offline',
          syncText: '账号暂离线',
          accountDetail: '记录仍保留，联网后自动恢复。',
        };
  }
  return { accountStatus: 'guest', syncText: '', accountDetail: '' };
};

const refreshProfile = (
  page: {
    setData(update: Record<string, unknown>): void;
    loadMembership(): Promise<void>;
  },
  reloadMembership = false,
) => {
  const today = localDateKey();
  const preferences = appServices.progress.getPreferences();
  const certificate = CERTIFICATES.find((item) => item.key === preferences.selectedCertificateKey);
  const auth = appServices.auth.getState();
  const sync = appServices.cloudSync.getState();
  const account = presentAccountStatus(auth);
  page.setData({
    syncing: pendingSyncPages.has(page),
    nickname: preferences.nickname,
    avatarUrl: preferences.avatarUrl,
    certificateTitle: certificate?.title ?? '粮油仓储管理员 · 初级',
    dashboard: presentDashboard(appServices.progress.getDashboard(today)),
    activity: presentActivityBars(appServices.progress.getActivity(today, 7)),
    accountStatus: account.accountStatus,
    syncText: account.syncText || syncLabel(sync.status),
    accountDetail: account.accountDetail,
    lastSyncedAt: formatSyncedAt(appServices.cloudSync.getLastSyncedAt()),
    syncFailed: sync.status === 'failed',
    syncNotice: sync.notice ?? '',
  });
  if (reloadMembership) void page.loadMembership();
};

const unsubscribe = (page: object) => {
  authSubscriptions.get(page)?.();
  authSubscriptions.delete(page);
};

Page({
  data: {
    clearing: false,
    syncing: false,
    nickname: '仓廪小麦',
    avatarUrl: '',
    certificateTitle: '',
    dashboard: emptyDashboard,
    activity: [] as ReturnType<typeof presentActivityBars>,
    accountStatus: 'guest',
    syncText: '',
    accountDetail: '',
    lastSyncedAt: '',
    syncFailed: false,
    syncNotice: '',
    isMember: false,
    membershipStatus: '正在查询会员状态',
    membershipDetail: '每日可进行3次随机练习',
    membershipPractice: '',
  },

  onShow() {
    visiblePages.add(this);
    this.getTabBar()?.setData({ value: '/pages/profile/index' });
    if (!authSubscriptions.has(this)) {
      authSubscriptions.set(
        this,
        appServices.auth.subscribe(() => {
          if (visiblePages.has(this)) refreshProfile(this);
        }),
      );
    }
    refreshProfile(this, true);

    if (appServices.auth.getState().status === 'checking' && !pendingRecoveryRefreshes.has(this)) {
      pendingRecoveryRefreshes.add(this);
      void appServices.auth.initialize().finally(() => {
        pendingRecoveryRefreshes.delete(this);
        if (!visiblePages.has(this) || appServices.auth.getState().status === 'checking') return;
        refreshProfile(this, true);
      });
    }
  },

  onHide() {
    visiblePages.delete(this);
    unsubscribe(this);
    membershipRequests.delete(this);
  },

  onUnload() {
    visiblePages.delete(this);
    unsubscribe(this);
    membershipRequests.delete(this);
  },

  async loadMembership() {
    const request = ++membershipRequestId;
    membershipRequests.set(this, request);
    try {
      const membership = await appServices.membership.getStatus();
      if (membershipRequests.get(this) !== request) return;
      const view = presentMembership(membership);
      this.setData({
        membershipStatus: view.statusText,
        isMember: view.isMember,
        membershipDetail: view.detailText,
        membershipPractice: view.freePracticeText,
      });
    } catch {
      if (membershipRequests.get(this) !== request) return;
      this.setData({
        isMember: false,
        membershipStatus: '会员状态暂未更新',
        membershipDetail: '进入会员中心可重新查询',
        membershipPractice: '',
      });
    }
  },

  onAvatarError() {
    this.setData({ avatarUrl: '' });
  },

  onOpenEditProfile() {
    void wx.navigateTo({ url: '/packages/auxiliary/pages/edit-profile/index' });
  },

  onOpenMember() {
    void wx.navigateTo({ url: '/packages/auxiliary/pages/member/index' });
  },

  onOpenLearningReport() {
    void wx.navigateTo({ url: '/packages/auxiliary/pages/learning-report/index' });
  },

  onOpenLearningSettings() {
    void wx.navigateTo({ url: '/packages/auxiliary/pages/learning-settings/index' });
  },

  onLoginAndSync() {
    void wx.navigateTo({ url: '/pages/account-entry/index?mode=login' });
  },

  onOpenAccountData() {
    void wx.navigateTo({ url: '/packages/auxiliary/pages/account-data/index' });
  },

  async onRetrySync() {
    if (pendingSyncPages.has(this)) return;
    pendingSyncPages.add(this);
    this.setData({ syncing: true });
    try {
      await appServices.auth.retryBackground();
      if (visiblePages.has(this)) refreshProfile(this);
    } catch {
      if (visiblePages.has(this)) {
        void wx.showToast({ title: '同步暂时失败，请稍后重试', icon: 'none' });
      }
    } finally {
      pendingSyncPages.delete(this);
      if (visiblePages.has(this)) this.setData({ syncing: false });
    }
  },

  async onClearLearningData() {
    if (this.data.clearing) return;
    this.setData({ clearing: true });
    try {
      for (const title of ['清除学习数据', '再次确认清除']) {
        const result = await wx
          .showModal({
            title,
            content: '学习记录将永久清除，无法恢复；资料与设置保留。',
            confirmText: '清除',
            confirmColor: '#c44747',
          })
          .catch(() => null);
        if (!result?.confirm) return;
      }
      const completed = await appServices.auth.clearLearningData().catch(() => false);
      if (completed) refreshProfile(this);
      void wx.showToast({
        title: completed ? '学习数据已清除' : '清除未完成，请重试',
        icon: 'none',
      });
    } finally {
      this.setData({ clearing: false });
    }
  },
});

const syncLabel = (status: ReturnType<typeof appServices.cloudSync.getState>['status']): string => {
  if (status === 'syncing' || status === 'pending' || status === 'conflict') return '正在保存';
  if (status === 'failed') return '已保存在本机，联网后自动保存';
  return '已自动保存';
};

const formatSyncedAt = (value: string | null): string => {
  if (!value) return '暂未同步';
  return Number.isNaN(Date.parse(value))
    ? '暂未同步'
    : `最近同步：${value.replace('T', ' ').slice(0, 16)}`;
};
