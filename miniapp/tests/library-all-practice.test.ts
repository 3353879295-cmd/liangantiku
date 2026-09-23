import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CertificateKey } from '../miniprogram/types/domain';

interface LibraryData {
  questionCount: number;
  completedCount: number;
  hasSequentialResume: boolean;
  selectedKey: CertificateKey;
  loading: boolean;
  loadError: string;
  comingSoon: boolean;
  starting: boolean;
  showingAll: boolean;
  parts: Array<{ chapters: Array<{ canStart: boolean }> }>;
}

interface LibraryContext {
  data: LibraryData;
  setData(update: Partial<LibraryData>): void;
}

interface LibraryDefinition {
  data: LibraryData;
  loadCertificate(this: LibraryContext, key: CertificateKey): Promise<void>;
  onStartAll(this: LibraryContext): Promise<void>;
  onUnload(this: LibraryContext): void;
  onToggleCatalog(this: LibraryContext): void;
}

const loadLibrary = async () => {
  vi.resetModules();
  let page!: LibraryDefinition;
  const storage = new Map<string, unknown>();
  const navigateTo = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    navigateTo,
    showToast: vi.fn(),
  });
  vi.stubGlobal('Page', (definition: LibraryDefinition) => {
    page = definition;
  });
  await import('../miniprogram/pages/library/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  const context: LibraryContext = {
    data: structuredClone(page.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  };
  return { page, context, appServices, navigateTo };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('all-bank practice entry', () => {
  it('opens the current 1102-question bank without sending question bodies to the catalog view', async () => {
    const { page, context, navigateTo } = await loadLibrary();
    await page.loadCertificate.call(context, '4-08-05-01:4');
    expect(context.data.questionCount).toBe(1102);
    expect(JSON.stringify(context.data).length).toBeLessThan(80_000);
    expect(context.data).not.toHaveProperty('questions');
    await page.onStartAll.call(context);
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/pages/practice/index?occupation=4-08-05-01&level=4&mode=sequential',
    });
  });

  it('coalesces repeated taps and allows retry after navigation failure', async () => {
    const { page, context, navigateTo } = await loadLibrary();
    await page.loadCertificate.call(context, '4-08-05-01:4');
    let rejectNavigation!: (error: Error) => void;
    navigateTo.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNavigation = reject;
        }),
    );
    const pending = page.onStartAll.call(context);
    await page.onStartAll.call(context);
    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(context.data.starting).toBe(true);
    rejectNavigation(new Error('navigation failed'));
    await pending;
    expect(context.data.starting).toBe(false);
    await page.onStartAll.call(context);
    expect(navigateTo).toHaveBeenCalledTimes(2);
  });

  it('disables a finished bank while still allowing an active group to finish', async () => {
    const { page, context, navigateTo } = await loadLibrary();
    await page.loadCertificate.call(context, '4-08-05-01:4');
    context.data.completedCount = context.data.questionCount;
    await page.onStartAll.call(context);
    expect(navigateTo).not.toHaveBeenCalled();
    context.data.hasSequentialResume = true;
    await page.onStartAll.call(context);
    expect(navigateTo).toHaveBeenCalledOnce();
  });

  it('shows saved progress and does not write a loading result after leaving', async () => {
    const { page, context, appServices } = await loadLibrary();
    const bank = await appServices.questions.list({ occupation: '4-08-05-01', level: 4 });
    const question = bank[0]!;
    appServices.progress.recordAnswer({
      questionId: question.id,
      correct: true,
      durationMs: 100,
      at: '2026-09-19',
    });
    await page.loadCertificate.call(context, '4-08-05-01:4');
    expect(context.data.completedCount).toBe(1);
    let resolveQuestions!: (questions: typeof bank) => void;
    vi.spyOn(appServices.questions, 'list').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuestions = resolve;
        }),
    );
    const loading = page.loadCertificate.call(context, '4-08-05-01:4');
    page.onUnload.call(context);
    const setData = vi.spyOn(context, 'setData');
    resolveQuestions(bank);
    await loading;
    expect(setData).not.toHaveBeenCalled();
  });

  it('defaults to chapters with questions and restores the complete catalog on request', async () => {
    const { page, context } = await loadLibrary();
    await page.loadCertificate.call(context, '4-08-05-01:4');

    expect(context.data.showingAll).toBe(false);
    expect(
      context.data.parts.flatMap((part) => part.chapters).every((chapter) => chapter.canStart),
    ).toBe(true);

    page.onToggleCatalog.call(context);

    expect(context.data.showingAll).toBe(true);
    expect(
      context.data.parts.flatMap((part) => part.chapters).some((chapter) => !chapter.canStart),
    ).toBe(true);
  });
});
