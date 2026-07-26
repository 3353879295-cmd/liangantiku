import { CERTIFICATES } from '../../data/certificates';
import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { findCatalogChapterTitle, presentCatalogParts } from '../../presenters/catalog-presenter';
import { HOME_ACTIONS, presentHomeCertificate } from '../../presenters/home-presenter';
import type { HomeAction } from '../../presenters/home-presenter';
import { appServices, localDateKey } from '../../services/app-services';
import type { CertificateKey, Question } from '../../types/domain';

interface HomeActionCard extends HomeAction {
  icon: string;
  note: string;
  emphasized: boolean;
}

interface HomeCatalogChapter {
  id: string;
  numberText: string;
  title: string;
  metaText: string;
  progressText: string;
}

interface RecentQuestionItem {
  id: string;
  title: string;
  metaText: string;
}

const defaultCertificateKey = (): CertificateKey => '4-02-06-01:5';

const getCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

const actionDetails: Record<HomeAction['id'], { icon: string; note: string }> = {
  chapter: { icon: 'book-open', note: '按当前教材目录' },
  random: { icon: 'swap', note: '从当前职业与等级题库随机抽题' },
  mock: { icon: 'assignment', note: '完整模拟后交卷' },
  wrong: { icon: 'error-circle', note: '复习当前题库错题' },
  favorite: { icon: 'star', note: '查看当前题库收藏' },
};

const actions: HomeActionCard[] = HOME_ACTIONS.map((action) => ({
  ...action,
  ...actionDetails[action.id],
  emphasized: action.id === 'random',
}));

const initialCertificate = presentHomeCertificate(CERTIFICATES, defaultCertificateKey(), 0);

const isQuestion = (question: Question | undefined): question is Question => Boolean(question);

Page({
  data: {
    certificates: CERTIFICATES,
    selectedKey: defaultCertificateKey(),
    certificate: initialCertificate,
    nickname: '仓廪小麦',
    avatarUrl: '',
    preparationDays: 1,
    hasResume: false,
    resumeText: '选择题库，开始今天的第一次练习',
    resumeActionText: '去学习',
    actions,
    catalogChapters: [] as HomeCatalogChapter[],
    recentQuestions: [] as RecentQuestionItem[],
    loading: true,
  },

  onShow() {
    const app = getApp<IAppOption>();
    if (app.globalData.recoveryNotice) {
      const content = app.globalData.recoveryNotice;
      app.globalData.recoveryNotice = '';
      void wx.showModal({
        title: '学习数据已恢复',
        content,
        showCancel: false,
      });
    }

    const today = localDateKey();
    const preferences = appServices.progress.getPreferences();
    const session = appServices.progress.restoreSession();
    const hasResume = session?.status === 'active';
    app.globalData.selectedCertificateKey = preferences.selectedCertificateKey;
    this.setData({
      nickname: preferences.nickname,
      avatarUrl: preferences.avatarUrl,
      preparationDays: appServices.progress.getPreparationDays(today),
      hasResume,
      resumeText: hasResume
        ? `继续第 ${session.currentIndex + 1} 题 · 共 ${session.questionIds.length} 题`
        : '选择题库，开始今天的第一次练习',
      resumeActionText: hasResume ? '继续' : '去学习',
    });
    void this.loadCertificate(preferences.selectedCertificateKey);
  },

  async loadCertificate(key: CertificateKey) {
    const certificate = getCertificate(key);
    if (!certificate) return;
    this.setData({
      selectedKey: certificate.key,
      certificate: presentHomeCertificate(CERTIFICATES, certificate.key, 0),
      catalogChapters: [] as HomeCatalogChapter[],
      recentQuestions: [] as RecentQuestionItem[],
      loading: true,
    });

    const recentIds = appServices.progress.listRecentQuestionIds(Number.MAX_SAFE_INTEGER);
    const [questions, recentQuestionRecords] = await Promise.all([
      appServices.questions.list({
        occupation: certificate.occupation,
        level: certificate.level,
      }),
      appServices.questions.getByIds(recentIds),
    ]);
    if (this.data.selectedKey !== certificate.key) return;

    const parts = presentCatalogParts({
      catalog: KNOWLEDGE_CATALOG,
      occupation: certificate.occupation,
      level: certificate.level,
      questions,
      getProgress: (ids) => appServices.progress.getQuestionProgress(ids),
    });
    const catalogChapters = parts
      .flatMap(({ chapters }) => chapters)
      .slice(0, 3)
      .map((chapter) => ({
        id: chapter.id,
        numberText: chapter.numberText,
        title: chapter.title,
        metaText: chapter.metaText,
        progressText: chapter.progressText,
      }));

    const recentById = new Map(recentQuestionRecords.map((question) => [question.id, question]));
    const recentQuestions = recentIds
      .map((id) => recentById.get(id))
      .filter(isQuestion)
      .filter(
        (question) =>
          question.occupation === certificate.occupation && question.level === certificate.level,
      )
      .slice(0, 3)
      .map((question) => ({
        id: question.id,
        title: question.stem,
        metaText: `${findCatalogChapterTitle(KNOWLEDGE_CATALOG, question.chapterId)} · ${certificate.levelName}`,
      }));

    this.setData({
      certificate: presentHomeCertificate(CERTIFICATES, certificate.key, questions.length),
      catalogChapters,
      recentQuestions,
      loading: false,
    });
  },

  onCertificateChange(event: WechatMiniprogram.CustomEvent<{ key: CertificateKey }>) {
    const key = event.detail.key;
    if (!CERTIFICATES.some((certificate) => certificate.key === key)) return;
    appServices.progress.updatePreferences({ selectedCertificateKey: key });
    getApp<IAppOption>().globalData.selectedCertificateKey = key;
    void this.loadCertificate(key);
  },

  onResume() {
    if (this.data.hasResume) {
      void wx.navigateTo({ url: '/pages/practice/index?resume=1' });
      return;
    }
    this.openStartRoute('/pages/library/index');
  },

  onAction(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset['id']) as HomeAction['id'];
    const action = actions.find((candidate) => candidate.id === id);
    if (!action) return;
    let route = action.route;
    if (id === 'wrong' || id === 'favorite') {
      const certificate = getCertificate(this.data.selectedKey);
      if (!certificate) return;
      route += `&occupation=${certificate.occupation}&level=${certificate.level}`;
    }
    this.openStartRoute(route);
  },

  openStartRoute(route: string) {
    const certificate = this.data.certificate;
    if (this.data.loading || !certificate.canStart) {
      void wx.showToast({ title: '该等级题库待补充', icon: 'none' });
      return;
    }
    void wx.navigateTo({ url: route });
  },

  onOpenCatalog() {
    void wx.navigateTo({ url: '/pages/library/index' });
  },

  onOpenMember() {
    void wx.navigateTo({ url: '/pages/member/index' });
  },
});
