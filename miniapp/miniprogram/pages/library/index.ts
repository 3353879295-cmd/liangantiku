import { CERTIFICATES } from '../../data/certificates';
import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { groupCertificates, presentCatalogParts } from '../../presenters/library-presenter';
import { appServices } from '../../services/app-services';
import type { CatalogPartViewModel } from '../../presenters/catalog-presenter';
import type { CertificateKey, PracticeMode } from '../../types/domain';

const STARTABLE_MODES = new Set<PracticeMode>(['sequential', 'random', 'mock']);

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

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
    this.setData({
      selectedKey: certificate.key,
      selectedTitle: certificate.title,
      loading: true,
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
    this.setData({ expandedChapterId: '' });
    void this.loadCertificate(key);
  },

  onModeTap(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset['mode']) as PracticeMode;
    if (mode === 'chapter') {
      if (!this.data.parts.length) return;
      void wx.pageScrollTo({ selector: '#catalog-list', duration: 250 });
      return;
    }
    if (STARTABLE_MODES.has(mode)) this.start(mode);
  },

  onToggleChapter(event: WechatMiniprogram.TouchEvent) {
    const chapterId = String(event.currentTarget.dataset['chapterId'] ?? '');
    if (!chapterId) return;
    this.setData({
      expandedChapterId: this.data.expandedChapterId === chapterId ? '' : chapterId,
    });
  },

  onChapterPractice(event: WechatMiniprogram.TouchEvent) {
    const chapterId = String(event.currentTarget.dataset['chapterId'] ?? '');
    if (chapterId) this.start('chapter', { chapterId });
  },

  onSectionPractice(event: WechatMiniprogram.TouchEvent) {
    const sectionId = String(event.currentTarget.dataset['sectionId'] ?? '');
    if (sectionId) this.start('chapter', { sectionId });
  },

  start(mode: PracticeMode, scope: { chapterId?: string; sectionId?: string } = {}) {
    const certificate = getCertificate(this.data.selectedKey as CertificateKey);
    if (!certificate || !this.data.questionCount) return;
    const chapterQuery = scope.chapterId ? `&chapterId=${encodeURIComponent(scope.chapterId)}` : '';
    const sectionQuery = scope.sectionId ? `&sectionId=${encodeURIComponent(scope.sectionId)}` : '';
    void wx.navigateTo({
      url: `/pages/practice/index?occupation=${certificate.occupation}&level=${certificate.level}&mode=${mode}${chapterQuery}${sectionQuery}`,
    });
  },
});
