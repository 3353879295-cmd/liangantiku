import { CERTIFICATES } from '../../data/certificates';
import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { groupCertificates, presentCatalogParts } from '../../presenters/library-presenter';
import { appServices } from '../../services/app-services';
import type { CatalogPartViewModel } from '../../presenters/catalog-presenter';
import type {
  CertificateKey,
  CertificateLevel,
  OccupationCode,
  PracticeMode,
} from '../../types/domain';

const STARTABLE_MODES = new Set<PracticeMode>(['sequential', 'random', 'mock']);

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

export const buildTextbookPracticeRoute = (input: TextbookPracticeRouteInput): string | null => {
  if (input.loading || !input.questionCount) return null;
  if (input.chapterId && !input.chapterIds.includes(input.chapterId)) return null;
  if (input.sectionId && !input.sectionIds.includes(input.sectionId)) return null;
  const chapterQuery = input.chapterId ? `&chapterId=${encodeURIComponent(input.chapterId)}` : '';
  const sectionQuery = input.sectionId ? `&sectionId=${encodeURIComponent(input.sectionId)}` : '';
  return `/pages/practice/index?occupation=${input.occupation}&level=${input.level}&mode=${input.mode}${chapterQuery}${sectionQuery}`;
};

Page({
  data: {
    groups: groupCertificates(CERTIFICATES),
    selectedKey: '4-02-06-01:5',
    selectedTitle: '',
    questionCount: 0,
    parts: [] as CatalogPartViewModel[],
    expandedChapterId: '',
    loading: true,
    modes: [
      { mode: 'chapter', title: '章节练习', note: '按教材目录逐章逐节练习', icon: 'layers' },
      { mode: 'sequential', title: '顺序练习', note: '从第一题开始', icon: 'view-list' },
      { mode: 'random', title: '随机练习', note: '每次随机抽取', icon: 'swap' },
      { mode: 'mock', title: '模拟考试', note: '交卷后统一解析', icon: 'assignment' },
    ],
  },

  onShow() {
    const key = appServices.progress.getPreferences().selectedCertificateKey;
    void this.loadCertificate(key);
  },

  async loadCertificate(key: CertificateKey) {
    const certificate = getCertificate(key);
    if (!certificate) return;
    const certificateChanged = this.data.selectedKey !== certificate.key;
    this.setData({
      selectedKey: certificate.key,
      selectedTitle: certificate.title,
      loading: true,
      ...(certificateChanged
        ? {
            questionCount: 0,
            parts: [] as CatalogPartViewModel[],
            expandedChapterId: '',
          }
        : {}),
    });
    const questions = await appServices.questions.list({
      occupation: certificate.occupation,
      level: certificate.level,
    });
    if (this.data.selectedKey !== key) return;
    const parts = presentCatalogParts({
      catalog: KNOWLEDGE_CATALOG,
      occupation: certificate.occupation,
      level: certificate.level,
      questions,
      getProgress: (ids) => appServices.progress.getQuestionProgress(ids),
    });
    this.setData({
      questionCount: questions.length,
      parts,
      loading: false,
    });
  },

  onSelectCertificate(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset['key']) as CertificateKey;
    if (!CERTIFICATES.some((certificate) => certificate.key === key)) return;
    appServices.progress.updatePreferences({ selectedCertificateKey: key });
    getApp<IAppOption>().globalData.selectedCertificateKey = key;
    void this.loadCertificate(key);
  },

  onModeTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading) return;
    const mode = String(event.currentTarget.dataset['mode']) as PracticeMode;
    if (mode === 'chapter') {
      if (!this.data.parts.length) return;
      void wx.pageScrollTo({ selector: '#catalog-list', duration: 250 });
      return;
    }
    if (STARTABLE_MODES.has(mode)) this.start(mode);
  },

  onToggleChapter(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading) return;
    const chapterId = String(event.currentTarget.dataset['chapterId'] ?? '');
    if (!chapterId) return;
    this.setData({
      expandedChapterId: this.data.expandedChapterId === chapterId ? '' : chapterId,
    });
  },

  onChapterPractice(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading) return;
    const chapterId = String(event.currentTarget.dataset['chapterId'] ?? '');
    if (chapterId) this.start('chapter', { chapterId });
  },

  onSectionPractice(event: WechatMiniprogram.TouchEvent) {
    if (this.data.loading) return;
    const sectionId = String(event.currentTarget.dataset['sectionId'] ?? '');
    if (sectionId) this.start('chapter', { sectionId });
  },

  start(mode: PracticeMode, scope: { chapterId?: string; sectionId?: string } = {}) {
    if (this.data.loading) return;
    const certificate = getCertificate(this.data.selectedKey as CertificateKey);
    if (!certificate) return;
    const chapters = this.data.parts.flatMap((part) => part.chapters);
    const url = buildTextbookPracticeRoute({
      loading: this.data.loading,
      questionCount: this.data.questionCount,
      occupation: certificate.occupation,
      level: certificate.level,
      mode,
      chapterIds: chapters.filter((chapter) => chapter.canStart).map((chapter) => chapter.id),
      sectionIds: chapters.flatMap((chapter) =>
        chapter.sections.filter((section) => section.canStart).map((section) => section.id),
      ),
      ...(scope.chapterId ? { chapterId: scope.chapterId } : {}),
      ...(scope.sectionId ? { sectionId: scope.sectionId } : {}),
    });
    if (url) void wx.navigateTo({ url });
  },
});
