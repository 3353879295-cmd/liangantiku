import { CERTIFICATES } from '../../data/certificates';
import { presentDashboard } from '../../presenters/home-presenter';
import { appServices, localDateKey } from '../../services/app-services';
import type { CertificateKey, PracticeMode } from '../../types/domain';

const PRACTICE_MODES = new Set<PracticeMode>(['sequential', 'random', 'wrong', 'favorite']);

const selectedCertificate = (key: CertificateKey) =>
  CERTIFICATES.find((certificate) => certificate.key === key) ?? CERTIFICATES[0];

Page({
  data: {
    certificateTitle: '',
    certificateKey: '4-02-06-01:5',
    dashboard: presentDashboard({
      answered: 0,
      correct: 0,
      accuracy: 0,
      durationMs: 0,
      streakDays: 0,
      todayAnswered: 0,
      dailyGoal: 20,
    }),
    hasResume: false,
    shortcuts: [
      { label: '顺序练习', note: '按题库顺序巩固', mode: 'sequential', icon: 'view-list' },
      { label: '随机练习', note: '打乱顺序抽题', mode: 'random', icon: 'swap' },
      { label: '错题重练', note: '集中解决薄弱点', mode: 'wrong', icon: 'error-circle' },
      { label: '我的收藏', note: '复习重点题目', mode: 'favorite', icon: 'star' },
    ],
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
    const preferences = appServices.progress.getPreferences();
    const certificate = selectedCertificate(preferences.selectedCertificateKey);
    const session = appServices.progress.restoreSession();
    const resume =
      session?.status === 'active'
        ? { currentIndex: session.currentIndex, total: session.questionIds.length }
        : undefined;
    app.globalData.selectedCertificateKey = preferences.selectedCertificateKey;
    this.setData({
      certificateTitle: certificate?.title ?? '储粮保管员 · 初级',
      certificateKey: preferences.selectedCertificateKey,
      dashboard: presentDashboard(appServices.progress.getDashboard(localDateKey()), resume),
      hasResume: Boolean(resume),
    });
  },

  onChooseCertificate() {
    void wx.switchTab({ url: '/pages/library/index' });
  },

  onResume() {
    void wx.navigateTo({ url: '/pages/practice/index?resume=1' });
  },

  onShortcut(event: WechatMiniprogram.TouchEvent) {
    const mode = String(event.currentTarget.dataset['mode']);
    if (!PRACTICE_MODES.has(mode as PracticeMode)) return;
    const certificate = selectedCertificate(this.data.certificateKey as CertificateKey);
    if (!certificate) return;
    void wx.navigateTo({
      url: `/pages/practice/index?occupation=${certificate.occupation}&level=${certificate.level}&mode=${mode}`,
    });
  },
});
