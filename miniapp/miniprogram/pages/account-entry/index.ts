import { appServices } from '../../services/app-services';

const homeUrl = '/pages/home/index';

Page({
  data: {
    phase: 'loading',
    busy: false,
    message: '',
  },

  async onLoad(options: Record<string, string | undefined>) {
    const explicitLogin = options.mode === 'login';
    const state = await appServices.auth.initialize();
    if (
      !explicitLogin &&
      (state.status === 'authenticated' ||
        (state.status === 'guest' && state.preference === 'guest' && !state.temporaryGuest))
    ) {
      void wx.reLaunch({ url: homeUrl });
      return;
    }
    this.setData({
      phase: state.status === 'error' ? 'error' : 'choice',
      busy: false,
      message: state.notice ?? '',
    });
  },

  async onLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, phase: 'loading', message: '' });
    const success = await appServices.auth.login();
    if (success) {
      void wx.reLaunch({ url: homeUrl });
      return;
    }
    this.setData({
      busy: false,
      phase: 'error',
      message: appServices.auth.getState().notice ?? '',
    });
  },

  onGuest() {
    if (this.data.busy) return;
    appServices.auth.chooseGuest();
    void wx.reLaunch({ url: homeUrl });
  },

  async onRetry() {
    if (this.data.busy) return;
    this.setData({ busy: true, phase: 'loading', message: '' });
    const isAccountRecovery = appServices.auth.getState().preference === 'account';
    const success = isAccountRecovery
      ? await appServices.auth.retry()
      : await appServices.auth.login();
    if (success) {
      void wx.reLaunch({ url: homeUrl });
      return;
    }
    this.setData({
      busy: false,
      phase: 'error',
      message: appServices.auth.getState().notice ?? '',
    });
  },

  onTemporaryGuest() {
    if (this.data.busy) return;
    appServices.auth.useTemporaryGuest();
    void wx.reLaunch({ url: homeUrl });
  },
});
