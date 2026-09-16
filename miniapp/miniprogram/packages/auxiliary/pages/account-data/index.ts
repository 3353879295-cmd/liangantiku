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
    this.setData({ busy: true });
    try {
      if (!(await confirmRemoval(false))) return;
      const completed = await appServices.auth.clearLearningData();
      void wx.showToast({
        title: completed ? '学习数据已清除' : '清除未完成，请重试',
        icon: 'none',
      });
      void this.onShow();
    } catch {
      void wx.showToast({ title: '清除未完成，请重试', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
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
    const decision = await wx
      .showModal({
        title: '仍有未同步数据',
        content: '请继续重试同步，或放弃未同步数据后退出登录。',
        confirmText: '放弃数据',
        cancelText: '继续重试',
        confirmColor: '#c44747',
      })
      .catch(() => {
        this.setData({ syncText: '确认窗口暂时无法打开，请重试。' });
        return null;
      });
    if (!decision) return;
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
    this.setData({ busy: true });
    try {
      if (!(await confirmRemoval(true))) return;
      const deleted = await appServices.auth.deleteAccount();
      if (!deleted) {
        void wx.showToast({ title: '账号注销未完成，请重试', icon: 'none' });
        return;
      }
      void wx.showToast({ title: '账号已注销', icon: 'none' });
      void wx.reLaunch({ url: homeUrl });
    } catch {
      void wx.showToast({ title: '账号注销未完成，请重试', icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },
});

const confirmRemoval = async (account: boolean): Promise<boolean> => {
  const first = await wx.showModal({
    title: account ? '永久注销账号' : '清除学习数据',
    content: account
      ? '云端学习记录将永久删除且无法恢复。确定要注销账号吗？'
      : '云端练习记录、错题、收藏和未完成练习将被清除；资料和设置会保留。',
    confirmText: '继续',
    confirmColor: '#c44747',
  });
  if (!first.confirm) return false;
  const second = await wx.showModal({
    title: account ? '再次确认注销' : '再次确认清除',
    content: account
      ? '此操作无法撤销，本机待同步的学习记录也会被移除。请确认已不再需要这些记录。'
      : '学习记录清除后无法恢复。有待同步记录时会拒绝清除，请先完成同步。',
    confirmText: account ? '永久删除' : '确认清除',
    confirmColor: '#c44747',
  });
  return second.confirm;
};

const syncLabel = (
  status: ReturnType<typeof appServices.cloudSync.getState>['status'],
  pending: number,
): string => {
  if (status === 'syncing') return '同步中';
  if (status === 'pending') return `待同步${pending > 0 ? `（${pending} 项）` : ''}`;
  if (status === 'failed') return '同步失败';
  if (status === 'conflict') return '同步已暂停';
  return '已同步';
};
