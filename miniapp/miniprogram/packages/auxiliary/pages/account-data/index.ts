import { appServices } from '../../../../services/app-services';

const homeUrl = '/pages/home/index';
const mountedPages = new WeakSet<object>();
const pendingPages = new WeakSet<object>();
const authSubscriptions = new WeakMap<object, () => void>();

const refreshPage = (page: { setData(update: Record<string, unknown>): void }) => {
  const authenticated = appServices.auth.getState().status === 'authenticated';
  const sync = appServices.cloudSync.getState();
  page.setData({
    available: authenticated,
    syncText: syncLabel(sync.status),
    retryVisible: sync.status === 'failed',
    syncNotice: sync.notice ?? '',
    busy: pendingPages.has(page),
  });
};

const unsubscribe = (page: object) => {
  authSubscriptions.get(page)?.();
  authSubscriptions.delete(page);
};

Page({
  data: {
    available: false,
    syncText: '未登录',
    retryVisible: false,
    syncNotice: '',
    busy: false,
  },

  onShow() {
    mountedPages.add(this);
    if (!authSubscriptions.has(this)) {
      authSubscriptions.set(
        this,
        appServices.auth.subscribe(() => {
          if (mountedPages.has(this)) refreshPage(this);
        }),
      );
    }
    refreshPage(this);
  },

  onHide() {
    mountedPages.delete(this);
    unsubscribe(this);
  },

  onUnload() {
    mountedPages.delete(this);
    unsubscribe(this);
  },

  async onRetrySync() {
    if (!this.data.available || this.data.busy) return;
    pendingPages.add(this);
    this.setData({ busy: true });
    try {
      await appServices.auth.retryBackground();
      if (mountedPages.has(this)) {
        refreshPage(this);
        const sync = appServices.cloudSync.getState();
        void wx.showToast({
          title: sync.status === 'idle' ? '已自动保存' : '记录已保存在本机，联网后自动保存',
          icon: 'none',
        });
      }
    } catch {
      if (mountedPages.has(this)) void wx.showToast({ title: '同步未完成，请重试', icon: 'none' });
    } finally {
      pendingPages.delete(this);
      if (mountedPages.has(this)) this.setData({ busy: false });
    }
  },

  async onClearLearningData() {
    if (!this.data.available || this.data.busy) return;
    pendingPages.add(this);
    this.setData({ busy: true });
    try {
      if (!(await confirmRemoval(false)) || !mountedPages.has(this)) return;
      const completed = await appServices.auth.clearLearningData();
      if (!mountedPages.has(this)) return;
      void wx.showToast({
        title: completed ? '学习数据已清除' : '清除未完成，请重试',
        icon: 'none',
      });
      if (mountedPages.has(this)) refreshPage(this);
    } catch {
      if (mountedPages.has(this)) void wx.showToast({ title: '清除未完成，请重试', icon: 'none' });
    } finally {
      pendingPages.delete(this);
      if (mountedPages.has(this)) this.setData({ busy: false });
    }
  },

  async onLogout() {
    if (!this.data.available || this.data.busy) return;
    pendingPages.add(this);
    this.setData({ busy: true });
    try {
      const result = await appServices.auth.logout();
      if (!mountedPages.has(this)) return;
      if (!result.needsDecision) {
        await wx.reLaunch({ url: homeUrl });
        return;
      }
      void wx.showToast({ title: '数据正在清理，请稍后重试退出', icon: 'none' });
    } catch {
      if (mountedPages.has(this)) void wx.showToast({ title: '退出未完成，请重试', icon: 'none' });
    } finally {
      pendingPages.delete(this);
      if (mountedPages.has(this)) this.setData({ busy: false });
    }
  },

  async onDeleteAccount() {
    if (!this.data.available || this.data.busy) return;
    pendingPages.add(this);
    this.setData({ busy: true });
    try {
      if (!(await confirmRemoval(true)) || !mountedPages.has(this)) return;
      const deleted = await appServices.auth.deleteAccount();
      if (!mountedPages.has(this)) return;
      if (!deleted) {
        void wx.showToast({ title: '账号注销未完成，请重试', icon: 'none' });
        return;
      }
      void wx.showToast({ title: '账号已注销', icon: 'none' });
      void wx.reLaunch({ url: homeUrl });
    } catch {
      if (mountedPages.has(this))
        void wx.showToast({ title: '账号注销未完成，请重试', icon: 'none' });
    } finally {
      pendingPages.delete(this);
      if (mountedPages.has(this)) this.setData({ busy: false });
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

const syncLabel = (status: ReturnType<typeof appServices.cloudSync.getState>['status']): string => {
  if (status === 'syncing' || status === 'pending' || status === 'conflict') return '正在自动保存';
  if (status === 'failed') return '已保存在本机，联网后自动保存';
  return '已自动保存';
};
