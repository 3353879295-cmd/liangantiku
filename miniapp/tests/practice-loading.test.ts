import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeQuestion } from './factories';

type Route = Record<string, string | undefined>;

interface PracticePage {
  data: Record<string, unknown>;
  onLoad(options: Route): void;
  onShow(): void;
  onHide(): void;
  onReady(): Promise<void> | undefined;
  onUnload(): void;
  onRetryLoad(): void;
  loadPractice(options: Route): Promise<void>;
  syncTheme(): void;
  renderSession: (session: unknown) => void;
  setData: (update: Record<string, unknown>) => void;
}

const loadPage = async (): Promise<PracticePage> => {
  let definition!: PracticePage;
  vi.stubGlobal('Page', (value: PracticePage) => {
    definition = value;
  });
  await import('../miniprogram/pages/practice/index');
  return {
    ...definition,
    data: structuredClone(definition.data),
    setData: vi.fn(function (this: PracticePage, update: Record<string, unknown>) {
      Object.assign(this.data, update);
    }),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('../miniprogram/services/practice-runtime');
  vi.doUnmock('../miniprogram/services/app-services');
});

describe('practice loading lifecycle', () => {
  it('waits for the first render before preparing and persisting a new practice session', async () => {
    vi.resetModules();
    const values = new Map<string, unknown>();
    const setStorageSync = vi.fn((key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    });
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => structuredClone(values.get(key) ?? ''),
      setStorageSync,
      removeStorageSync: (key: string) => values.delete(key),
    });
    const page = await loadPage();
    const { appServices } = await import('../miniprogram/services/app-services');
    vi.spyOn(appServices.membership, 'checkPermission').mockResolvedValue({
      isMember: true,
      startsAt: null,
      expiresAt: null,
      freeUsed: 0,
      freeRemaining: 3,
      freeLimit: 3,
      freeDate: '2026-09-23',
      serverTime: '2026-09-23T00:00:00.000Z',
      paymentAvailable: false,
    });
    const list = vi.spyOn(appServices.questions, 'list').mockResolvedValue([makeQuestion()]);
    setStorageSync.mockClear();

    page.onLoad({ occupation: '4-02-06-01', level: '5', mode: 'sequential' });
    page.onShow();
    expect(page.data.loading).toBe(true);
    expect(list).not.toHaveBeenCalled();
    expect(setStorageSync).not.toHaveBeenCalled();

    await page.onReady();
    expect(page.data.loading).toBe(false);
    expect(page.data.sessionReady).toBe(true);
    expect(list).toHaveBeenCalledOnce();
    expect(values.get('grain-practice:guest-progress')).toMatchObject({
      session: { mode: 'sequential', questionIds: [makeQuestion().id] },
    });
    expect(values.get('grain-practice:guest:sequential:4-02-06-01:5')).toMatchObject({
      questionIds: [makeQuestion().id],
    });
  });

  it('does not prepare or save a session if the page leaves before its first render', async () => {
    vi.resetModules();
    const restorePractice = vi.fn();
    vi.doMock('../miniprogram/services/practice-runtime', () => ({
      restorePractice,
      setPracticePageVisible: vi.fn(),
    }));
    vi.doMock('../miniprogram/services/app-services', () => ({ appServices: {} }));
    const page = await loadPage();
    page.syncTheme = vi.fn();

    page.onLoad({ resume: '1' });
    page.onUnload();
    await page.onReady();
    expect(restorePractice).not.toHaveBeenCalled();
    expect(page.setData).not.toHaveBeenCalled();
  });

  it('allows leaving a slow restore without a global mask or late page update', async () => {
    vi.resetModules();
    let rejectRestore!: (error: Error) => void;
    const restorePractice = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectRestore = reject;
        }),
    );
    const cancelStart = vi.fn();
    vi.doMock('../miniprogram/services/practice-runtime', () => ({
      restorePractice,
      getPracticeStartCancellation: () => cancelStart,
      setPracticePageVisible: vi.fn(),
    }));
    vi.doMock('../miniprogram/services/app-services', () => ({ appServices: {} }));
    const showLoading = vi.fn();
    vi.stubGlobal('wx', { showLoading });
    const page = await loadPage();
    page.syncTheme = vi.fn();
    page.renderSession = vi.fn();
    page.onLoad({ resume: '1' });
    const pending = page.onReady();
    page.onUnload();
    rejectRestore(new Error('offline'));
    await pending;
    expect(cancelStart).toHaveBeenCalledOnce();
    expect(showLoading).not.toHaveBeenCalled();
    expect(page.setData).not.toHaveBeenCalled();
    expect(page.renderSession).not.toHaveBeenCalled();
  });

  it('retries a failed restore after the one-time ready event has already fired', async () => {
    vi.resetModules();
    const restorePractice = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(null);
    vi.doMock('../miniprogram/services/practice-runtime', () => ({
      restorePractice,
      getPracticeStartCancellation: () => vi.fn(),
      setPracticePageVisible: vi.fn(),
    }));
    vi.doMock('../miniprogram/services/app-services', () => ({ appServices: {} }));
    const page = await loadPage();
    page.syncTheme = vi.fn();
    page.onLoad({ resume: '1' });
    await page.onReady();
    expect(page.data.errorTitle).toBe('题目加载失败');

    page.onRetryLoad();
    await vi.waitFor(() => expect(page.data.errorTitle).toBe('暂时没有可练习的题目'));
    expect(restorePractice).toHaveBeenCalledTimes(2);
    expect(page.data.loading).toBe(false);
  });

  it('does not resume timing when a slow load finishes after the page hides', async () => {
    vi.resetModules();
    let resolveRestore!: (session: { mode: string }) => void;
    const restorePractice = vi.fn(
      () =>
        new Promise<{ mode: string }>((resolve) => {
          resolveRestore = resolve;
        }),
    );
    const setPracticePageVisible = vi.fn();
    vi.doMock('../miniprogram/services/practice-runtime', () => ({
      restorePractice,
      getPracticeStartCancellation: () => vi.fn(),
      getActivePractice: () => null,
      setPracticePageVisible,
    }));
    vi.doMock('../miniprogram/services/app-services', () => ({ appServices: {} }));
    const page = await loadPage();
    page.syncTheme = vi.fn();
    page.renderSession = vi.fn();

    page.onLoad({ resume: '1' });
    page.onShow();
    const pending = page.onReady();
    page.onHide();
    resolveRestore({ mode: 'sequential' });
    await pending;

    expect(setPracticePageVisible).toHaveBeenCalledWith(false);
    expect(setPracticePageVisible).not.toHaveBeenCalledWith(true);
  });
});
