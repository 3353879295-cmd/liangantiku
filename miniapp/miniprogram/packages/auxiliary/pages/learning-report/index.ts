import { CERTIFICATES } from '../../../../data/certificates';
import { KNOWLEDGE_CATALOG } from '../../../../data/knowledge-catalog';
import {
  buildChapterDetailRoute,
  presentCatalogParts,
} from '../../../../presenters/catalog-presenter';
import { presentLearningReport } from '../../../../presenters/profile-presenter';
import type { LearningReportViewModel } from '../../../../presenters/profile-presenter';
import { appServices, localDateKey } from '../../../../services/app-services';
import type { CertificateKey, CertificateLevel, OccupationCode } from '../../../../types/domain';

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

const emptyReport = presentLearningReport({
  dashboard: {
    answered: 0,
    correct: 0,
    accuracy: 0,
    durationMs: 0,
    streakDays: 0,
    todayAnswered: 0,
    dailyGoal: 20,
  },
  activity: [],
  chapters: [],
});

interface LearningReportPageData extends LearningReportViewModel {
  loading: boolean;
  selectedKey: CertificateKey;
  occupation: OccupationCode;
  level: CertificateLevel;
  certificateTitle: string;
  chapterIds: string[];
  loadError: string;
}

const initialData: LearningReportPageData = {
  loading: true,
  selectedKey: '4-02-06-01:5',
  occupation: '4-02-06-01',
  level: 5,
  certificateTitle: '',
  chapterIds: [],
  loadError: '',
  ...emptyReport,
};
const reportVersions = new WeakMap<object, number>();

Page({
  data: initialData,

  onShow() {
    void this.loadReport();
  },

  async loadReport() {
    const preferences = appServices.progress.getPreferences();
    const certificate = getCertificate(preferences.selectedCertificateKey);
    if (!certificate) return;

    const version = (reportVersions.get(this) ?? 0) + 1;
    reportVersions.set(this, version);
    this.setData({
      loading: true,
      selectedKey: certificate.key,
      occupation: certificate.occupation,
      level: certificate.level,
      certificateTitle: certificate.title,
      chapterIds: [] as string[],
      loadError: '',
    });

    const today = localDateKey();
    const dashboard = appServices.progress.getDashboard(today);
    const activity = appServices.progress.getActivity(today, 7);
    try {
      const questions = await appServices.questions.list({
        occupation: certificate.occupation,
        level: certificate.level,
      });
      if (reportVersions.get(this) !== version) return;

      const parts = presentCatalogParts({
        catalog: KNOWLEDGE_CATALOG,
        occupation: certificate.occupation,
        level: certificate.level,
        questions,
        getProgress: (questionIds) => appServices.progress.getQuestionProgress(questionIds),
      });
      const questionIdsByChapter = new Map<string, string[]>();
      for (const question of questions) {
        const ids = questionIdsByChapter.get(question.chapterId) ?? [];
        ids.push(question.id);
        questionIdsByChapter.set(question.chapterId, ids);
      }
      const chapters = parts.flatMap((part) =>
        part.chapters.map((chapter) => ({
          id: chapter.id,
          numberText: chapter.numberText,
          title: chapter.title,
          progress: appServices.progress.getQuestionProgress(
            questionIdsByChapter.get(chapter.id) ?? [],
          ),
        })),
      );
      const report = presentLearningReport({ dashboard, activity, chapters });

      this.setData({ loading: false, chapterIds: chapters.map(({ id }) => id), ...report });
    } catch {
      if (reportVersions.get(this) !== version) return;
      this.setData({ loading: false, loadError: '报告暂时无法读取，请重试。' });
    }
  },

  onRetryLoad() {
    void this.loadReport();
  },

  onStartPractice() {
    void wx.navigateTo({ url: '/pages/library/index' });
  },

  onWeakChapterTap(event: WechatMiniprogram.TouchEvent) {
    const chapterId = String(event.currentTarget.dataset['chapterId'] ?? '');
    const url = buildChapterDetailRoute({
      loading: this.data.loading,
      occupation: this.data.occupation,
      level: this.data.level,
      chapterId,
      chapterIds: this.data.chapterIds,
    });
    if (url) void wx.navigateTo({ url });
  },
});
