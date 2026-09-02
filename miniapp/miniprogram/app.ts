import { appServices } from './services/app-services';
import { initializeCloud } from './config/cloud';

const preferences = appServices.progress.getPreferences();

App<IAppOption>({
  globalData: {
    selectedCertificateKey: preferences.selectedCertificateKey,
    answerTheme: appServices.theme.get(),
    recoveryNotice: appServices.progress.consumeRecoveryNotice() ?? '',
  },
  onLaunch() {
    initializeCloud();
  },
});
