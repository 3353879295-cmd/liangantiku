import { appServices } from '../../../../services/app-services';

const homeUrl = '/pages/home/index';

Page({
  data: {
    available: false,
    syncText: '未登录',
    retryVisible: false,
    busy: false,
  },

  onShow() {
    const authenticated = appServices.auth.getState().status === 'authenticated';
    const sync = appServices.cloudSync.getState();
    this.setData({
      available: authenticated,
      syncText: syncLabel(sync.status, sync.pendingCount),
      retryVisible: sync.status === 'pending' || sync.status === 'failed',
      busy: false,
    });
  },

  async onRetrySync() {
    if (!this.data.available || this.data.busy) return;
    this.setData({ busy: true });
    await appServices.auth.retryBackground();
    this.setData({ busy: false });
    void this.onShow();
  },

  async onClearLearningData() {
    if (!this.data.available || this.data.busy) return;
    const result = await wx.showModal({
      title: '清除学习数据',
      content: '云端练习记录、错题、收藏和未完成练习将被清除；资料和设置会保留。',
      confirmText: '清除',
      confirmColor: '#c44747',
    });
    if (!result.confirm) return;
    this.setData({ busy: true });
    const completed = await appServices.auth.clearLearningData();
    this.setData({ busy: false });
    void wx.showToast({ title: completed ? '学习数据已清除' : '清除未完成，请重试', icon: 'none' });
    void this.onShow();
  },

  async onLogout() {
    if (!this.data.available || this.data.busy) return;
    this.setData({ busy: true });
    const result = await appServices.auth.logout();
    if (!result.needsDecision) {
      void wx.reLaunch({ url: homeUrl });
      return;
    }
    this.setData({ busy: false });
    const decision = await wx.showModal({
      title: '仍有未同步数据',
      content: '请继续重试同步，或放弃未同步数据后退出登录。',
      confirmText: '放弃并退出',
      cancelText: '继续重试',
      confirmColor: '#c44747',
    });
    if (decision.confirm) {
      this.setData({ busy: true });
      const discarded = await appServices.auth.logout(true);
      if (!discarded.needsDecision) void wx.reLaunch({ url: homeUrl });
      return;
    }
    this.setData({ busy: true });
    await appServices.auth.retryBackground();
    const retried = await appServices.auth.logout();
    if (!retried.needsDecision) {
      void wx.reLaunch({ url: homeUrl });
      return;
    }
    this.setData({ busy: false });
    void this.onShow();
  },

  async onDeleteAccount() {
    if (!this.data.available || this.data.busy) return;
    const confirmation = await wx.showModal({
      title: '永久注销账号',
      content: '云端学习记录将永久删除且无法恢复。确定要注销账号吗？',
      confirmText: '永久删除',
      confirmColor: '#c44747',
    });
    if (!confirmation.confirm) return;
    this.setData({ busy: true });
    const deleted = await appServices.auth.deleteAccount();
    if (!deleted) {
      this.setData({ busy: false });
      void wx.showToast({ title: '账号注销未完成，请重试', icon: 'none' });
      return;
    }
    void wx.showToast({ title: '账号已注销', icon: 'none' });
    void wx.reLaunch({ url: homeUrl });
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
