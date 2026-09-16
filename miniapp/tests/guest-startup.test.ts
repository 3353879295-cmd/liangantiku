import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CertificateKey } from '../miniprogram/types/domain';

interface BrowsePage {
  data: Record<string, unknown>;
  onShow(): void;
  loadCertificate(key: CertificateKey): Promise<void>;
  loadMembership(): Promise<void>;
  openStartRoute(route: string): void;
  onResume(): void;
  onCertificateChange(event: { detail: { key: CertificateKey } }): void;
}

const loadApp = async (storage = new Map<string, unknown>()) => {
  vi.resetModules();
  const personalInfo = {
    getPhoneNumber: vi.fn(),
    getUserProfile: vi.fn(),
    getUserInfo: vi.fn(),
    chooseAvatar: vi.fn(),
    login: vi.fn(),
  };
  const navigation = {
    navigateTo: vi.fn<(options: { success?: () => void }) => void>((options) => {
      options.success?.();
    }),
    redirectTo: vi.fn(),
    reLaunch: vi.fn(),
    switchTab: vi.fn(),
    showModal: vi.fn(),
  };
  const callFunction = vi.fn(() => Promise.reject(new Error('offline')));
  const onNetworkStatusChange = vi.fn();
  vi.stubGlobal('wx', {
    ...personalInfo,
    ...navigation,
    cloud: { init: vi.fn(), callFunction },
    onNetworkStatusChange,
    getStorageSync: (key: string) => structuredClone(storage.get(key) ?? ''),
    setStorageSync: (key: string, value: unknown) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key: string) => storage.delete(key),
  });
  let app: (IAppOption & { onLaunch(): void; onShow(): void }) | undefined;
  vi.stubGlobal('App', (definition: typeof app) => {
    app = definition;
  });
  vi.stubGlobal('getApp', () => app);
  await import('../miniprogram/app');
  if (!app) throw new Error('App was not registered');
  const { appServices, localDateKey } = await import('../miniprogram/services/app-services');
  const login = vi.spyOn(appServices.auth, 'login');
  app.onLaunch();
  app.onShow();
  await appServices.auth.initialize();
  const reconnect = onNetworkStatusChange.mock.calls[0]?.[0] as
    ((status: { isConnected: boolean }) => void) | undefined;
  reconnect?.({ isConnected: true });
  return { app, appServices, localDateKey, storage, personalInfo, navigation, callFunction, login };
};

const loadHome = async () => {
  let page: BrowsePage | undefined;
  vi.stubGlobal('Page', (definition: BrowsePage) => {
    page = definition;
  });
  await import('../miniprogram/pages/home/index');
  if (!page) throw new Error('Home was not registered');
  return {
    ...page,
    data: structuredClone(page.data),
    getTabBar: () => undefined,
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('guest startup and local learning', () => {
  it.each(['fresh', 'guest'] as const)(
    '%s launch, foreground and home browse never request personal information or login',
    async (preference) => {
      const storage = new Map<string, unknown>();
      if (preference === 'guest') storage.set('grain-practice:auth-preference', 'guest');
      const { appServices, personalInfo, navigation, login, callFunction } = await loadApp(storage);
      expect(appServices.auth.getState().status).toBe('guest');
      expect(callFunction).not.toHaveBeenCalled();
      const home = await loadHome();
      home.onShow();
      await vi.waitFor(() => expect(home.data.loading).toBe(false));
      expect(home.data.certificate).toMatchObject({ canStart: true });
      for (const call of Object.values(navigation)) expect(call).not.toHaveBeenCalled();
      for (const call of Object.values(personalInfo)) expect(call).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();

      home.onCertificateChange({ detail: { key: '4-08-05-01:4' } });
      await vi.waitFor(() => expect(home.data.loading).toBe(false));
      expect(appServices.progress.getPreferences().selectedCertificateKey).toBe('4-08-05-01:4');
      expect(home.data.certificate).toMatchObject({ canStart: true });
      home.onResume();
      expect(navigation.navigateTo).toHaveBeenCalledOnce();
      expect(navigation.navigateTo).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/pages/library/index',
        }),
      );

      let library: BrowsePage | undefined;
      vi.stubGlobal('Page', (definition: BrowsePage) => {
        library = definition;
      });
      await import('../miniprogram/pages/library/index');
      if (!library) throw new Error('Library was not registered');
      const context = {
        ...library,
        data: structuredClone(library.data),
        setData(update: Record<string, unknown>) {
          Object.assign(this.data, update);
        },
      };
      context.onShow();
      await vi.waitFor(() => expect(context.data.loading).toBe(false));
      expect(context.data.questionCount).toBeGreaterThan(0);
      expect(context.data.parts).not.toEqual([]);
      expect(appServices.progress.getScope()).toBe('guest');
      expect(login).not.toHaveBeenCalled();
    },
  );

  it('starts real basic practice offline and restores guest answers and preferences after restart', async () => {
    const { appServices, localDateKey, storage, navigation, personalInfo, callFunction } =
      await loadApp();
    const runtime = await import('../miniprogram/services/practice-runtime');
    const { answerQuestion } = await import('../miniprogram/services/practice-session');
    appServices.progress.updatePreferences({ selectedCertificateKey: '4-08-05-01:4' });
    const session = await runtime.startPractice({
      occupation: '4-08-05-01',
      level: 4,
      mode: 'sequential',
    });
    if (!session || !session.questions[0]) throw new Error('Guest practice has no questions');
    const question = session.questions[0];
    runtime.saveActivePractice(answerQuestion(session, question.id, question.answer, Date.now()));
    expect(appServices.progress.restoreSession()?.answers[question.id]).toEqual(question.answer);
    runtime.submitActivePractice();
    runtime.recordActivePractice();
    const answered = appServices.progress.getDashboard(localDateKey()).answered;
    expect(answered).toBeGreaterThan(0);
    expect(callFunction).not.toHaveBeenCalled();
    for (const call of Object.values(navigation)) expect(call).not.toHaveBeenCalled();
    for (const call of Object.values(personalInfo)) expect(call).not.toHaveBeenCalled();

    const restarted = await loadApp(storage);
    expect(restarted.appServices.auth.getState().status).toBe('guest');
    expect(restarted.appServices.progress.getPreferences().selectedCertificateKey).toBe(
      '4-08-05-01:4',
    );
    expect(restarted.appServices.progress.getDashboard(localDateKey()).answered).toBe(answered);
    expect(restarted.appServices.progress.restoreSession()?.answers[question.id]).toEqual(
      question.answer,
    );
    expect(restarted.callFunction).not.toHaveBeenCalled();
  });
});
