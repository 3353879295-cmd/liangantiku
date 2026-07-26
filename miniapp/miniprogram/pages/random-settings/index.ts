import { CERTIFICATES } from '../../data/certificates';
import {
  presentRandomPracticeSetup,
  RANDOM_QUESTION_LIMITS,
} from '../../presenters/practice-setup-presenter';
import type {
  RandomPracticeSetupViewModel,
  RandomQuestionLimit,
} from '../../presenters/practice-setup-presenter';
import { appServices } from '../../services/app-services';
import { QUESTION_TYPES } from '../../types/domain';
import type { CertificateKey, Question, QuestionType } from '../../types/domain';

const questionTypeWhitelist = new Set<string>(QUESTION_TYPES);
const parseRandomQuestionLimit = (value: unknown): RandomQuestionLimit | null =>
  RANDOM_QUESTION_LIMITS.find((limit) => limit === Number(value)) ?? null;

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

const defaultCertificate = CERTIFICATES[0];
if (!defaultCertificate) throw new Error('at least one certificate is required');

const initialView = presentRandomPracticeSetup({
  certificate: defaultCertificate,
  questions: [],
  limit: 10,
  questionTypes: [],
});

Page({
  data: {
    loading: true,
    certificate: defaultCertificate,
    questions: [] as Array<Pick<Question, 'type'>>,
    limit: 10,
    selectedQuestionTypes: [] as QuestionType[],
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
      selectedQuestionTypes: [] as QuestionType[],
      limit: 10,
      ...presentRandomPracticeSetup({
        certificate,
        questions: [],
        limit: 10,
        questionTypes: [],
      }),
    });

    if (certificate.availability === 'coming-soon') return;
    const questions = await appServices.questions.list({
      occupation: certificate.occupation,
      level: certificate.level,
    });
    if (this.data.certificate.key !== certificate.key) return;
    const inventory = questions.map(({ type }) => ({ type }));
    this.applySetup(inventory, 10, []);
    this.setData({ loading: false });
  },

  applySetup(
    questions: Array<Pick<Question, 'type'>>,
    limit: RandomQuestionLimit,
    questionTypes: QuestionType[],
  ) {
    const view: RandomPracticeSetupViewModel = presentRandomPracticeSetup({
      certificate: this.data.certificate,
      questions,
      limit,
      questionTypes,
    });
    this.setData({
      questions,
      limit,
      selectedQuestionTypes: questionTypes,
      ...view,
    });
  },

  onCountTap(event: WechatMiniprogram.TouchEvent) {
    const limit = parseRandomQuestionLimit(event.currentTarget.dataset['limit']);
    if (!limit) return;
    const option = this.data.countOptions.find((item) => item.value === limit);
    if (!option || option.disabled) return;
    this.applySetup(this.data.questions, limit, this.data.selectedQuestionTypes);
  },

  onTypeTap(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset['type'] ?? '');
    if (value !== 'all' && !questionTypeWhitelist.has(value)) return;
    const option = this.data.typeOptions.find((item) => item.value === value);
    if (!option || option.disabled) return;
    const limit = parseRandomQuestionLimit(this.data.limit);
    if (!limit) return;

    if (value === 'all') {
      this.applySetup(this.data.questions, limit, []);
      return;
    }

    const questionType = value as QuestionType;
    const selectedQuestionTypes = this.data.selectedQuestionTypes.includes(questionType)
      ? this.data.selectedQuestionTypes.filter((item) => item !== questionType)
      : [...this.data.selectedQuestionTypes, questionType];
    this.applySetup(this.data.questions, limit, selectedQuestionTypes);
  },

  onStart() {
    if (this.data.loading || !this.data.canStart) {
      void wx.showToast({ title: this.data.statusText, icon: 'none' });
      return;
    }
    const { certificate, selectedQuestionTypes } = this.data;
    const limit = parseRandomQuestionLimit(this.data.limit);
    if (!limit) return;
    const query = [
      `occupation=${certificate.occupation}`,
      `level=${certificate.level}`,
      'mode=random',
      `limit=${limit}`,
    ];
    if (selectedQuestionTypes.length) {
      query.push(`types=${encodeURIComponent(selectedQuestionTypes.join(','))}`);
    }
    void wx.navigateTo({ url: `/pages/practice/index?${query.join('&')}` });
  },
});
