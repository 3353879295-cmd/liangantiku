import { appServices } from './services/app-services';

const preferences = appServices.progress.getPreferences();

App<IAppOption>({
  globalData: {
    selectedCertificateKey: preferences.selectedCertificateKey,
    answerTheme: appServices.theme.get(),
    recoveryNotice: appServices.progress.consumeRecoveryNotice() ?? '',
  },
});
