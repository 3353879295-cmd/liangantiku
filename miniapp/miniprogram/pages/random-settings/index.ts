import { CERTIFICATES } from '../../data/certificates';
import {
  buildRandomPracticeRoute,
  presentRandomPracticeSetup,
} from '../../presenters/practice-setup-presenter';
import type { RandomPracticeSetupViewModel } from '../../presenters/practice-setup-presenter';
import { appServices } from '../../services/app-services';
import type { CertificateKey, Question } from '../../types/domain';

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

const defaultCertificate = CERTIFICATES[0];
if (!defaultCertificate) throw new Error('at least one certificate is required');

const initialView = presentRandomPracticeSetup({
  certificate: defaultCertificate,
  questions: [],
});

Page({
  data: {
    loading: true,
    certificate: defaultCertificate,
    questions: [] as Array<Pick<Question, 'type'>>,
    ...initialView,
  },

  onLoad() {
    void this.loadSetup();
  },

  async loadSetup() {
    const preferences = appServices.progress.getPreferences();
    const certificate = getCertificate(preferences.selectedCertificateKey);
    if (!certificate) return;

    this.setData({
      loading: certificate.availability === 'available',
      certificate,
      questions: [] as Array<Pick<Question, 'type'>>,
      ...presentRandomPracticeSetup({
        certificate,
        questions: [],
      }),
    });

    if (certificate.availability === 'coming-soon') return;
    const questions = await appServices.questions.list({
      occupation: certificate.occupation,
      level: certificate.level,
    });
    if (this.data.certificate.key !== certificate.key) return;
    const inventory = questions.map(({ type }) => ({ type }));
    this.applySetup(inventory);
    this.setData({ loading: false });
  },

  applySetup(questions: Array<Pick<Question, 'type'>>) {
    const view: RandomPracticeSetupViewModel = presentRandomPracticeSetup({
      certificate: this.data.certificate,
      questions,
    });
    this.setData({
      questions,
      ...view,
    });
  },

  onStart() {
    if (this.data.loading || !this.data.canStart) {
      void wx.showToast({ title: this.data.statusText, icon: 'none' });
      return;
    }
    const { certificate } = this.data;
    const url = buildRandomPracticeRoute({
      occupation: certificate.occupation,
      level: certificate.level,
    });
    void wx.navigateTo({ url });
  },
});
