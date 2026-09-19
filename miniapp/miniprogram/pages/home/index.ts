import { CERTIFICATES } from '../../data/certificates';
import { HOME_ACTIONS, presentHomeCertificate } from '../../presenters/home-presenter';
import type { HomeAction } from '../../presenters/home-presenter';
import { appServices, localDateKey } from '../../services/app-services';
import { MembershipError } from '../../repositories/membership-client';
import { presentMembership } from '../../presenters/membership-presenter';
import { getPendingRandomStart } from '../../services/random-practice-access';
import type { CertificateKey } from '../../types/domain';

interface HomeActionCard extends HomeAction {
  icon: string;
  note: string;
  emphasized: boolean;
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
const visiblePages = new WeakSet<object>();
const pendingRecoveryRefreshes = new WeakSet<object>();
const pendingHomeEntries = new WeakSet<object>();
const certificateRequestVersions = new WeakMap<object, number>();
const membershipRequestVersions = new WeakMap<object, number>();
const entryVersions = new WeakMap<object, number>();

const navigate = (url: string) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error('页面跳转超时，请重试')), 5000);
    try {
      const result = wx.navigateTo({
        url,
        success: () => finish(),
        fail: () => finish(new Error('页面跳转失败，请重试')),
      });
      void Promise.resolve(result).catch(() => finish(new Error('页面跳转失败，请重试')));
    } catch {
      finish(new Error('页面跳转失败，请重试'));
    }
  });

Page({
  data: {
    certificates: CERTIFICATES,
    selectedKey: defaultCertificateKey(),
    certificate: initialCertificate,
    nickname: '仓廪小麦',
    avatarUrl: '',
    preparationDays: 1,
    hasResume: false,
    hasResult: false,
    resumeText: '选择题库，开始今天的第一次练习',
    resumeActionText: '去学习',
    actions,
    freePracticeText: '',
    showMembershipPrompt: false,
    randomStarting: false,
    loading: true,
    loadError: false,
  },

  onShow() {
    visiblePages.add(this);
    if (this.data.randomStarting) this.setData({ randomStarting: false });
    this.getTabBar()?.setData({ value: '/pages/home/index' });

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
    const pending = getPendingRandomStart();
    const hasActiveSession = session?.status === 'active';
    const hasUnrecordedResult = session?.status === 'submitted' && !session.progressRecorded;
    const hasResume = hasActiveSession || Boolean(pending);
    app.globalData.selectedCertificateKey = preferences.selectedCertificateKey;
    this.setData({
      nickname: preferences.nickname,
      avatarUrl: preferences.avatarUrl,
      preparationDays: appServices.progress.getPreparationDays(today),
      hasResume,
      hasResult: Boolean(hasUnrecordedResult),
      resumeText: hasActiveSession
        ? `继续第 ${session.currentIndex + 1} 题 · 共 ${session.questionIds.length} 题`
        : hasUnrecordedResult
          ? '查看上次练习结果'
          : pending
            ? '恢复上次随机练习'
            : '选择题库，开始今天的第一次练习',
      resumeActionText: hasUnrecordedResult ? '查看结果' : hasResume ? '继续' : '去学习',
    });
    void this.loadCertificate(preferences.selectedCertificateKey);
    void this.loadMembership();

    if (appServices.auth.getState().status === 'checking' && !pendingRecoveryRefreshes.has(this)) {
      pendingRecoveryRefreshes.add(this);
      void appServices.auth.initialize().finally(() => {
        pendingRecoveryRefreshes.delete(this);
        if (!visiblePages.has(this) || appServices.auth.getState().status === 'checking') return;
        void this.onShow();
      });
    }
  },

  onHide() {
    visiblePages.delete(this);
    certificateRequestVersions.set(this, (certificateRequestVersions.get(this) ?? 0) + 1);
    membershipRequestVersions.set(this, (membershipRequestVersions.get(this) ?? 0) + 1);
    entryVersions.set(this, (entryVersions.get(this) ?? 0) + 1);
  },

  onUnload() {
    visiblePages.delete(this);
    certificateRequestVersions.set(this, (certificateRequestVersions.get(this) ?? 0) + 1);
    membershipRequestVersions.set(this, (membershipRequestVersions.get(this) ?? 0) + 1);
    entryVersions.set(this, (entryVersions.get(this) ?? 0) + 1);
  },

  async loadMembership() {
    const version = (membershipRequestVersions.get(this) ?? 0) + 1;
    membershipRequestVersions.set(this, version);
    try {
      const membership = await appServices.membership.getStatus();
      if (membershipRequestVersions.get(this) !== version) return;
      this.setData({ freePracticeText: presentMembership(membership).freePracticeText });
    } catch {
      if (membershipRequestVersions.get(this) !== version) return;
      this.setData({ freePracticeText: '' });
    }
  },

  async loadCertificate(key: CertificateKey) {
    const certificate = getCertificate(key);
    if (!certificate) return;
    const version = (certificateRequestVersions.get(this) ?? 0) + 1;
    certificateRequestVersions.set(this, version);
    this.setData({
      selectedKey: certificate.key,
      certificate: presentHomeCertificate(CERTIFICATES, certificate.key, 0),
      loading: true,
      loadError: false,
    });

    try {
      const questionCount = await appServices.questions.count({
        occupation: certificate.occupation,
        level: certificate.level,
      });
      if (certificateRequestVersions.get(this) !== version) return;
      this.setData({
        certificate: presentHomeCertificate(CERTIFICATES, certificate.key, questionCount),
        loading: false,
      });
    } catch {
      if (certificateRequestVersions.get(this) !== version) return;
      this.setData({ loading: false, loadError: true });
    }
  },

  onCertificateChange(event: WechatMiniprogram.CustomEvent<{ key: CertificateKey }>) {
    const key = event.detail.key;
    if (!CERTIFICATES.some((certificate) => certificate.key === key)) return;
    if (key === this.data.selectedKey && !this.data.loadError) return;
    entryVersions.set(this, (entryVersions.get(this) ?? 0) + 1);
    appServices.progress.updatePreferences({ selectedCertificateKey: key });
    getApp<IAppOption>().globalData.selectedCertificateKey = key;
    void this.loadCertificate(key);
  },

  onRetryLoad() {
    void this.loadCertificate(this.data.selectedKey);
  },

  async onResume() {
    if (pendingHomeEntries.has(this)) return;
    pendingHomeEntries.add(this);
    const version = entryVersions.get(this) ?? 0;
    try {
      if (this.data.hasResume) {
        await navigate('/pages/practice/index?resume=1');
        return;
      }
      if (this.data.hasResult) {
        await navigate('/pages/report/index');
        return;
      }
      await this.openStartRoute('/pages/library/index');
    } catch (error) {
      if ((entryVersions.get(this) ?? 0) === version) this.showNavigationError(error);
    } finally {
      pendingHomeEntries.delete(this);
    }
  },

  async onAction(event: WechatMiniprogram.TouchEvent) {
    if (pendingHomeEntries.has(this)) return;
    const id = String(event.currentTarget.dataset['id']) as HomeAction['id'];
    const action = actions.find((candidate) => candidate.id === id);
    if (!action) return;
    pendingHomeEntries.add(this);
    const version = entryVersions.get(this) ?? 0;
    try {
      let route = action.route;
      if (id === 'wrong' || id === 'favorite') {
        const certificate = getCertificate(this.data.selectedKey);
        if (!certificate) return;
        route += `&occupation=${certificate.occupation}&level=${certificate.level}`;
      }
      if (id === 'random') {
        if (getPendingRandomStart()) {
          await navigate('/pages/practice/index?resume=1');
          return;
        }
        if (this.data.loading || this.data.loadError || !this.data.certificate.canStart) {
          await this.openStartRoute(route);
          return;
        }
        this.setData({ randomStarting: true });
        try {
          const membership = await appServices.membership.checkPermission('randomPractice');
          if (!visiblePages.has(this) || (entryVersions.get(this) ?? 0) !== version) return;
          this.setData({ freePracticeText: presentMembership(membership).freePracticeText });
        } catch (error) {
          if (!visiblePages.has(this) || (entryVersions.get(this) ?? 0) !== version) return;
          if (error instanceof MembershipError && error.code === 'DAILY_LIMIT_REACHED') {
            this.setData({ showMembershipPrompt: true });
            return;
          }
          void wx.showToast({ title: '随机练习服务暂不可用，请稍后再试', icon: 'none' });
          return;
        } finally {
          if (visiblePages.has(this)) this.setData({ randomStarting: false });
        }
      }
      if ((entryVersions.get(this) ?? 0) !== version) return;
      await this.openStartRoute(route);
    } catch (error) {
      if ((entryVersions.get(this) ?? 0) === version) this.showNavigationError(error);
    } finally {
      pendingHomeEntries.delete(this);
    }
  },

  openStartRoute(route: string) {
    const certificate = this.data.certificate;
    if (this.data.loading || this.data.loadError || !certificate.canStart) {
      void wx.showToast({
        title: this.data.loading
          ? '题库正在加载，请稍候'
          : this.data.loadError
            ? '题库读取失败，请点击重试'
            : '该等级题库待补充',
        icon: 'none',
      });
      return Promise.resolve();
    }
    return navigate(route);
  },

  async onOpenMember() {
    if (pendingHomeEntries.has(this)) return;
    pendingHomeEntries.add(this);
    const version = entryVersions.get(this) ?? 0;
    try {
      await navigate('/packages/auxiliary/pages/member/index');
    } catch (error) {
      if ((entryVersions.get(this) ?? 0) === version) this.showNavigationError(error);
    } finally {
      pendingHomeEntries.delete(this);
    }
  },

  onAvatarError() {
    this.setData({ avatarUrl: '' });
  },

  showNavigationError(error: unknown) {
    void wx.showToast({
      title: error instanceof Error ? error.message : '页面跳转失败，请重试',
      icon: 'none',
    });
  },

  onCloseMembershipPrompt() {
    this.setData({ showMembershipPrompt: false });
  },
  onConfirmMembershipPrompt() {
    this.setData({ showMembershipPrompt: false });
    void this.onOpenMember();
  },
});
