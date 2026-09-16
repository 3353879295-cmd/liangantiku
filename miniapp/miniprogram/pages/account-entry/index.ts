import { appServices } from '../../services/app-services';

const homeUrl = '/pages/home/index';
const { auth } = appServices;
const unloadedPages = new WeakSet<object>();
const routedPages = new WeakSet<object>();
const pendingAutomaticLeaves = new WeakMap<object, boolean>();
const leavingPages = new WeakMap<object, () => void>();

const isCurrentPage = (page: object) => {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  return pages.length === 0 || pages[pages.length - 1] === page;
};

const returnsToHome = () => {
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  return pages[pages.length - 2]?.route === 'pages/home/index';
};

const leavePage = (page: object, home = false) => {
  if (leavingPages.has(page) || unloadedPages.has(page)) return;
  let fallingBack = false;
  const release = () => {
    if (leavingPages.get(page) !== release) return;
    clearTimeout(timer);
    leavingPages.delete(page);
  };
  const go = (toHome: boolean) => {
    if (
      leavingPages.get(page) !== release ||
      unloadedPages.has(page) ||
      !isCurrentPage(page) ||
      (toHome && fallingBack)
    ) {
      return;
    }
    if (toHome) fallingBack = true;
    const fail = toHome ? release : () => go(true);
    try {
      const request = toHome
        ? wx.switchTab({ url: homeUrl, fail })
        : wx.navigateBack({ delta: 1, fail });
      void Promise.resolve(request).catch(fail);
    } catch {
      fail();
    }
  };
  leavingPages.set(page, release);
  const timer = setTimeout(release, 3000);
  go(home);
};

const runAutomaticLeave = (page: object) => {
  if (!pendingAutomaticLeaves.has(page) || unloadedPages.has(page)) return;
  const home = !!pendingAutomaticLeaves.get(page);
  pendingAutomaticLeaves.delete(page);
  leavePage(page, home && !returnsToHome());
};

const scheduleAutomaticLeave = (page: object, home: boolean) => {
  pendingAutomaticLeaves.set(page, home);
  if (routedPages.has(page)) runAutomaticLeave(page);
};

const handleLoginFailure = (page: { setData(update: Record<string, unknown>): void }) => {
  const state = auth.getState();
  if (state.preference !== 'account') {
    auth.chooseGuest();
    leavePage(page);
    return;
  }
  page.setData({
    busy: false,
    phase: 'error',
    message: state.notice ?? '',
  });
};

const returnAsGuest = (page: object) => {
  if (leavingPages.has(page) || unloadedPages.has(page)) return;
  const state = auth.getState();
  if (state.status !== 'authenticated') {
    if (state.preference === 'account') auth.useTemporaryGuest();
    else auth.chooseGuest();
  }
  leavePage(page);
};

const uploadAvatarAndEnterHome = async (
  page: { setData(update: Record<string, unknown>): void },
  avatarPath: string,
): Promise<void> => {
  const { cloudSync, progress, wechatAvatar } = appServices;
  const prefix = cloudSync.getAvatarUploadPathPrefix();
  if (!prefix) {
    page.setData({
      busy: false,
      phase: 'choice',
      message: '头像服务正在升级，请稍后再试。',
    });
    return;
  }
  try {
    const fileID = await wechatAvatar.upload(avatarPath, prefix);
    if (unloadedPages.has(page)) {
      await wechatAvatar.remove(fileID);
      return;
    }
    const previousAvatar = progress.getPreferences().avatarUrl;
    progress.updatePreferences({ avatarUrl: fileID });
    await cloudSync.process();
    const confirmedAvatar = cloudSync.getConfirmedAvatarUrl();
    if (confirmedAvatar === fileID) {
      wechatAvatar.confirm(fileID);
      if (
        previousAvatar &&
        previousAvatar !== fileID &&
        wechatAvatar.isControlled(previousAvatar)
      ) {
        void wechatAvatar.remove(previousAvatar).catch(() => undefined);
      }
    } else {
      const syncState = cloudSync.getState();
      if (syncState.status === 'conflict' && syncState.pendingCount === 0) {
        await wechatAvatar.remove(fileID);
        progress.refreshAccountSnapshot();
      }
    }
    if (!unloadedPages.has(page)) leavePage(page);
  } catch {
    if (unloadedPages.has(page)) return;
    page.setData({
      busy: false,
      phase: 'choice',
      message: '微信头像上传失败，请重新选择后再试。',
    });
  }
};

Page({
  data: {
    phase: 'loading',
    busy: false,
    message: '',
    avatarPath: '',
  },

  async onLoad(options: Record<string, string | undefined>) {
    unloadedPages.delete(this);
    const explicitLogin = options.mode === 'login';
    if (!explicitLogin) {
      scheduleAutomaticLeave(this, true);
      return;
    }

    const state = await auth.initialize();
    if (unloadedPages.has(this)) return;
    if (state.status === 'authenticated') {
      scheduleAutomaticLeave(this, false);
      return;
    }
    this.setData({
      phase: state.status === 'error' ? 'error' : 'choice',
      busy: false,
      message: state.notice ?? '',
    });
  },

  onRouteDone() {
    routedPages.add(this);
    runAutomaticLeave(this);
  },

  async onChooseAvatar(event: { detail?: { avatarUrl?: unknown } }) {
    if (this.data.busy) return;
    const avatarPath = event.detail?.avatarUrl;
    if (typeof avatarPath !== 'string' || !avatarPath) {
      returnAsGuest(this);
      return;
    }
    this.setData({ busy: true, phase: 'loading', message: '', avatarPath });
    const success = auth.getState().status === 'authenticated' ? true : await auth.login();
    if (unloadedPages.has(this)) return;
    if (!success) {
      handleLoginFailure(this);
      return;
    }
    await uploadAvatarAndEnterHome(this, avatarPath);
  },

  async onLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, phase: 'loading', message: '', avatarPath: '' });
    const success = auth.getState().status === 'authenticated' ? true : await auth.login();
    if (unloadedPages.has(this)) return;
    if (success) {
      leavePage(this);
      return;
    }
    handleLoginFailure(this);
  },

  onGuest() {
    if (this.data.busy) return;
    returnAsGuest(this);
  },

  async onRetry() {
    if (this.data.busy) return;
    this.setData({ busy: true, phase: 'loading', message: '' });
    const success =
      auth.getState().preference === 'account' ? await auth.retry() : await auth.login();
    if (unloadedPages.has(this)) return;
    if (success) {
      const avatarPath = this.data.avatarPath;
      if (typeof avatarPath === 'string' && avatarPath) {
        await uploadAvatarAndEnterHome(this, avatarPath);
        return;
      }
      leavePage(this);
      return;
    }
    this.setData({
      busy: false,
      phase: 'error',
      message: auth.getState().notice ?? '',
    });
  },

  onTemporaryGuest() {
    if (this.data.busy) return;
    returnAsGuest(this);
  },

  onAvatarRejected() {
    if (this.data.busy) return;
    returnAsGuest(this);
  },

  onUnload() {
    unloadedPages.add(this);
    routedPages.delete(this);
    pendingAutomaticLeaves.delete(this);
    leavingPages.get(this)?.();
  },
});
