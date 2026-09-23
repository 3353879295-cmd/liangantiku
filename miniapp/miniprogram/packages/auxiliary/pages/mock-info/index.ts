import { CERTIFICATES } from '../../../../data/certificates';
import { presentMockPracticeInfo } from '../../presenters/practice-setup-presenter';
import { appServices } from '../../../../services/app-services';
import type { CertificateKey } from '../../../../types/domain';

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

const defaultCertificate = CERTIFICATES[0];
if (!defaultCertificate) throw new Error('at least one certificate is required');

const initialView = presentMockPracticeInfo(defaultCertificate, 0);
const loadVersions = new WeakMap<object, number>();

Page({
  data: {
    loading: true,
    state: 'loading',
    loadError: '',
    certificate: defaultCertificate,
    ...initialView,
  },

  onLoad() {
    void this.loadInfo();
  },

  async loadInfo() {
    const version = (loadVersions.get(this) ?? 0) + 1;
    loadVersions.set(this, version);
    const preferences = appServices.progress.getPreferences();
    const certificate = getCertificate(preferences.selectedCertificateKey);
    if (!certificate) return;

    this.setData({
      loading: certificate.availability === 'available',
      state: certificate.availability === 'available' ? 'loading' : 'empty',
      loadError: '',
      certificate,
      ...presentMockPracticeInfo(certificate, 0),
    });
    if (certificate.availability === 'coming-soon') return;

    try {
      const questions = await appServices.questions.list({
        occupation: certificate.occupation,
        level: certificate.level,
      });
      if (loadVersions.get(this) !== version) return;
      this.setData({
        loading: false,
        state: questions.length ? 'ready' : 'empty',
        ...presentMockPracticeInfo(certificate, questions.length),
      });
    } catch {
      if (loadVersions.get(this) !== version) return;
      this.setData({
        loading: false,
        state: 'error',
        loadError: '题库暂时无法读取，请重试。',
      });
    }
  },

  onRetryLoad() {
    void this.loadInfo();
  },

  onUnload() {
    loadVersions.delete(this);
  },

  onStart() {
    if (this.data.state !== 'ready' || !this.data.canStart) {
      void wx.showToast({ title: this.data.statusText, icon: 'none' });
      return;
    }
    const { occupation, level } = this.data.certificate;
    void wx.navigateTo({
      url: `/pages/practice/index?occupation=${occupation}&level=${level}&mode=mock`,
    });
  },
});
