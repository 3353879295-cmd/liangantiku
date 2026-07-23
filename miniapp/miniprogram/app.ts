import { appServices } from './services/app-services';

App<IAppOption>({
  globalData: {
    selectedCertificateKey: '4-02-06-01:5',
    recoveryNotice: appServices.progress.consumeRecoveryNotice() ?? '',
  },
});
