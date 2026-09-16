import { CERTIFICATES } from '../../data/certificates';
import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { buildChapterDetailRoute, presentCatalogParts } from '../../presenters/catalog-presenter';
import type { CatalogPartViewModel } from '../../presenters/catalog-presenter';
import { appServices } from '../../services/app-services';
import type {
  CertificateKey,
  CertificateLevel,
  OccupationCode,
  PracticeMode,
} from '../../types/domain';

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

interface TextbookPracticeRouteInput {
  loading: boolean;
  questionCount: number;
  occupation: OccupationCode;
  level: CertificateLevel;
  mode: PracticeMode;
  chapterId?: string;
  sectionId?: string;
  chapterIds: readonly string[];
  sectionIds: readonly string[];
}

interface LibraryPageData {
  selectedKey: CertificateKey;
  selectedTitle: string;
  occupationTitle: string;
  levelName: string;
  questionCount: number;
  parts: CatalogPartViewModel[];
  comingSoon: boolean;
  loading: boolean;
  loadError: string;
}

const initialData: LibraryPageData = {
  selectedKey: '4-02-06-01:5',
  selectedTitle: '',
  occupationTitle: '',
  levelName: '',
  questionCount: 0,
  parts: [],
  comingSoon: false,
  loading: true,
  loadError: '',
};
const loadVersions = new WeakMap<object, number>();

export const buildTextbookPracticeRoute = (input: TextbookPracticeRouteInput): string | null => {
  if (input.loading || !input.questionCount) return null;
  if (input.chapterId && !input.chapterIds.includes(input.chapterId)) return null;
  if (input.sectionId && !input.sectionIds.includes(input.sectionId)) return null;
  const chapterQuery = input.chapterId ? `&chapterId=${encodeURIComponent(input.chapterId)}` : '';
  const sectionQuery = input.sectionId ? `&sectionId=${encodeURIComponent(input.sectionId)}` : '';
  return `/pages/practice/index?occupation=${input.occupation}&level=${input.level}&mode=${input.mode}${chapterQuery}${sectionQuery}`;
};

Page({
  data: initialData,

  onShow() {
    const key = appServices.progress.getPreferences().selectedCertificateKey;
    void this.loadCertificate(key);
  },

  async loadCertificate(key: CertificateKey) {
    const certificate = getCertificate(key);
    if (!certificate) return;
    const version = (loadVersions.get(this) ?? 0) + 1;
    loadVersions.set(this, version);
    this.setData({
      selectedKey: certificate.key,
      selectedTitle: certificate.title,
      occupationTitle: KNOWLEDGE_CATALOG.occupations[certificate.occupation].title,
      levelName: certificate.levelName,
      questionCount: 0,
      parts: [] as CatalogPartViewModel[],
      comingSoon: certificate.availability === 'coming-soon',
      loading: certificate.availability === 'available',
      loadError: '',
    });

    if (certificate.availability === 'coming-soon') return;

    try {
      const questions = await appServices.questions.list({
        occupation: certificate.occupation,
        level: certificate.level,
      });
      if (loadVersions.get(this) !== version) return;
      const parts = presentCatalogParts({
        catalog: KNOWLEDGE_CATALOG,
        occupation: certificate.occupation,
        level: certificate.level,
        questions,
        getProgress: (ids) => appServices.progress.getQuestionProgress(ids),
      });
      this.setData({ questionCount: questions.length, parts, loading: false });
    } catch {
      if (loadVersions.get(this) !== version) return;
      this.setData({ loading: false, loadError: '题库暂时无法读取，请重试。' });
    }
  },

  onRetryLoad() {
    void this.loadCertificate(this.data.selectedKey);
  },

  onChapterTap(event: WechatMiniprogram.TouchEvent) {
    const chapterId = String(event.currentTarget.dataset['chapterId'] ?? '');
    const certificate = getCertificate(this.data.selectedKey);
    if (!certificate || !chapterId) return;
    const url = buildChapterDetailRoute({
      loading: this.data.loading,
      occupation: certificate.occupation,
      level: certificate.level,
      chapterId,
      chapterIds: this.data.parts.flatMap((part) => part.chapters.map((chapter) => chapter.id)),
    });
    if (url) void wx.navigateTo({ url });
  },
});
