import { CERTIFICATES } from '../../data/certificates';
import { groupCertificates, presentLibraryModules } from '../../presenters/library-presenter';
import { appServices } from '../../services/app-services';
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
    modules: [] as ReturnType<typeof presentLibraryModules>,
    loading: true,
    modes: [
      { mode: 'chapter', title: '章节练习', note: '按知识模块逐项练习', icon: 'layers' },
      { mode: 'sequential', title: '顺序练习', note: '从第一题开始', icon: 'view-list' },
      { mode: 'random', title: '随机练习', note: '每次随机抽取', icon: 'shuffle' },
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
    this.setData({
      questionCount: questions.length,
      modules: presentLibraryModules(questions),
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
    const mode = String(event.currentTarget.dataset['mode']) as PracticeMode;
    if (mode === 'chapter') {
      if (!this.data.modules.length) return;
      void wx.pageScrollTo({ selector: '#module-list', duration: 250 });
      return;
    }
    if (STARTABLE_MODES.has(mode)) this.start(mode);
  },

  onModuleTap(event: WechatMiniprogram.TouchEvent) {
    const module = String(event.currentTarget.dataset['module']);
    if (module) this.start('chapter', module);
  },

  start(mode: PracticeMode, module?: string) {
    const certificate = getCertificate(this.data.selectedKey as CertificateKey);
    if (!certificate || !this.data.questionCount) return;
    const moduleQuery = module ? `&module=${encodeURIComponent(module)}` : '';
    void wx.navigateTo({
      url: `/pages/practice/index?occupation=${certificate.occupation}&level=${certificate.level}&mode=${mode}${moduleQuery}`,
    });
  },
});
