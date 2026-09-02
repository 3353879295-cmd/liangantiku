import { CERTIFICATES } from '../../../../data/certificates';
import { presentMockPracticeInfo } from '../../../../presenters/practice-setup-presenter';
import { appServices } from '../../../../services/app-services';
import type { CertificateKey } from '../../../../types/domain';

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

const defaultCertificate = CERTIFICATES[0];
if (!defaultCertificate) throw new Error('at least one certificate is required');

const initialView = presentMockPracticeInfo(defaultCertificate, 0);

Page({
  data: {
    loading: true,
    certificate: defaultCertificate,
    ...initialView,
  },

  onLoad() {
    void this.loadInfo();
  },

  async loadInfo() {
    const preferences = appServices.progress.getPreferences();
    const certificate = getCertificate(preferences.selectedCertificateKey);
    if (!certificate) return;

    this.setData({
      loading: certificate.availability === 'available',
      certificate,
      ...presentMockPracticeInfo(certificate, 0),
    });
    if (certificate.availability === 'coming-soon') return;

    const questions = await appServices.questions.list({
      occupation: certificate.occupation,
      level: certificate.level,
    });
    if (this.data.certificate.key !== certificate.key) return;
    this.setData({
      loading: false,
      ...presentMockPracticeInfo(certificate, questions.length),
    });
  },

  onStart() {
    if (this.data.loading || !this.data.canStart) {
      void wx.showToast({ title: this.data.statusText, icon: 'none' });
      return;
    }
    const { occupation, level } = this.data.certificate;
    void wx.navigateTo({
      url: `/pages/practice/index?occupation=${occupation}&level=${level}&mode=mock`,
    });
  },
});
