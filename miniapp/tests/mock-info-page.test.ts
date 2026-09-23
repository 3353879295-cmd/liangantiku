import { afterEach, describe, expect, it, vi } from 'vitest';

type MockInfoPage = {
  data: Record<string, unknown>;
  onLoad(): void;
  onUnload(): void;
  onRetryLoad(): void;
  loadInfo(): Promise<void>;
};

const loadPage = async (list: ReturnType<typeof vi.fn>) => {
  vi.resetModules();
  let page: MockInfoPage | undefined;
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: {
      progress: { getPreferences: vi.fn(() => ({ selectedCertificateKey: '4-02-06-01:5' })) },
      questions: { list },
    },
  }));
  vi.stubGlobal('wx', { showToast: vi.fn(), navigateTo: vi.fn() });
  vi.stubGlobal('Page', (definition: MockInfoPage) => {
    page = definition;
  });
  await import('../miniprogram/packages/auxiliary/pages/mock-info/index');
  if (!page) throw new Error('mock-info Page was not registered');
  const context = {
    ...page,
    data: structuredClone(page.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    },
  };
  return { page, context };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mock exam info page', () => {
  it('leaves loading after a request failure and retries successfully', async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error('题库读取失败'))
      .mockResolvedValueOnce([{}]);
    const { page, context } = await loadPage(list);

    await page.loadInfo.call(context);
    expect(context.data).toMatchObject({
      loading: false,
      state: 'error',
      loadError: '题库暂时无法读取，请重试。',
    });

    page.onRetryLoad.call(context);
    await vi.waitFor(() => expect(context.data).toMatchObject({ loading: false, state: 'ready' }));
  });

  it('ignores a request that resolves after unload', async () => {
    let resolveList!: (questions: unknown[]) => void;
    const list = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolveList = resolve;
        }),
    );
    const { page, context } = await loadPage(list);
    const setData = vi.spyOn(context, 'setData');

    const loading = page.loadInfo.call(context);
    const writesBeforeUnload = setData.mock.calls.length;
    page.onUnload.call(context);
    resolveList([{}]);
    await loading;

    expect(setData).toHaveBeenCalledTimes(writesBeforeUnload);
  });
});
