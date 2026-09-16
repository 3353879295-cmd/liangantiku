import { CERTIFICATES } from '../../../../data/certificates';
import {
  buildRandomPracticeRoute,
  presentRandomPracticeSetup,
} from '../../../../presenters/practice-setup-presenter';
import type { RandomPracticeSetupViewModel } from '../../../../presenters/practice-setup-presenter';
import { appServices } from '../../../../services/app-services';
import { presentMembership } from '../../../../presenters/membership-presenter';
import { MembershipError } from '../../../../repositories/membership-client';
import { getPendingRandomStart } from '../../../../services/random-practice-access';
import type { CertificateKey, Question } from '../../../../types/domain';

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

const defaultCertificate = CERTIFICATES[0];
if (!defaultCertificate) throw new Error('at least one certificate is required');

const initialView = presentRandomPracticeSetup({
  certificate: defaultCertificate,
  questions: [],
});
const setupVersions = new WeakMap<object, number>();

Page({
  data: {
    loading: true,
    loadError: '',
    starting: false,
    freePracticeText: '正在查询今日免费次数',
    memberPromptVisible: false,
    certificate: defaultCertificate,
    questions: [] as Array<Pick<Question, 'type'>>,
    ...initialView,
  },

  onLoad() {
    void this.loadSetup();
  },

  onShow() {
    void this.refreshMembership();
  },

  async refreshMembership() {
    try {
      const status = await appServices.membership.getStatus();
      this.setData({ freePracticeText: presentMembership(status).freePracticeText });
    } catch {
      this.setData({ freePracticeText: '免费次数暂时无法查询，开始前将重新校验' });
    }
  },

  async loadSetup() {
    const preferences = appServices.progress.getPreferences();
    const certificate = getCertificate(preferences.selectedCertificateKey);
    if (!certificate) return;

    const version = (setupVersions.get(this) ?? 0) + 1;
    setupVersions.set(this, version);
    this.setData({
      loading: certificate.availability === 'available',
      loadError: '',
      certificate,
      questions: [] as Array<Pick<Question, 'type'>>,
      ...presentRandomPracticeSetup({
        certificate,
        questions: [],
      }),
    });

    if (certificate.availability === 'coming-soon') return;
    try {
      const questions = await appServices.questions.list({
        occupation: certificate.occupation,
        level: certificate.level,
      });
      if (setupVersions.get(this) !== version) return;
      this.applySetup(questions.map(({ type }) => ({ type })));
      this.setData({ loading: false });
    } catch {
      if (setupVersions.get(this) !== version) return;
      this.setData({ loading: false, loadError: '题库暂时无法读取，请重试。' });
    }
  },

  onRetryLoad() {
    void this.loadSetup();
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

  async onStart() {
    if (this.data.starting) return;
    if (getPendingRandomStart()) {
      this.setData({ starting: true });
      try {
        await wx.navigateTo({ url: '/pages/practice/index?resume=1' });
      } finally {
        this.setData({ starting: false });
      }
      return;
    }
    if (this.data.loading || !this.data.canStart) {
      void wx.showToast({ title: this.data.statusText, icon: 'none' });
      return;
    }
    this.setData({ starting: true });
    try {
      const status = await appServices.membership.checkPermission('randomPractice');
      this.setData({ freePracticeText: presentMembership(status).freePracticeText });
      const { certificate } = this.data;
      const url = buildRandomPracticeRoute({
        occupation: certificate.occupation,
        level: certificate.level,
      });
      await wx.navigateTo({ url });
    } catch (error) {
      if (error instanceof MembershipError && error.code === 'DAILY_LIMIT_REACHED') {
        this.setData({ memberPromptVisible: true });
        void this.refreshMembership();
      } else {
        void wx.showToast({
          title: error instanceof Error ? error.message : '暂时无法开始，请重试',
          icon: 'none',
        });
      }
    } finally {
      this.setData({ starting: false });
    }
  },

  onCloseMemberPrompt() {
    this.setData({ memberPromptVisible: false });
  },

  onOpenMember() {
    this.setData({ memberPromptVisible: false });
    void wx.navigateTo({ url: '/packages/auxiliary/pages/member/index' });
  },
});
