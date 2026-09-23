import { appServices } from './services/app-services';
import { initializeCloud } from './config/cloud';
import { pauseActivePractice, resumeVisiblePractice } from './services/practice-runtime';

const preferences = appServices.progress.getPreferences();

App<IAppOption>({
  globalData: {
    selectedCertificateKey: preferences.selectedCertificateKey,
    answerTheme: appServices.theme.get(),
    recoveryNotice: appServices.progress.consumeRecoveryNotice() ?? '',
  },
  onLaunch() {
    initializeCloud();
    void appServices.auth.initialize().then(() => {
      const current = appServices.progress.getPreferences();
      this.globalData.selectedCertificateKey = current.selectedCertificateKey;
      this.globalData.answerTheme = appServices.theme.get();
      this.globalData.recoveryNotice = appServices.progress.consumeRecoveryNotice() ?? '';
    });
    wx.onNetworkStatusChange((status) => {
      if (status.isConnected) void appServices.auth.retryBackground();
    });
  },
  onShow() {
    resumeVisiblePractice();
    void appServices.auth.retryBackground();
  },
  onHide() {
    pauseActivePractice();
  },
});
