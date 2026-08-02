import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CertificateKey } from '../miniprogram/types/domain';
import { makeQuestion } from './factories';

interface HomePageData {
  selectedKey: CertificateKey;
  certificate: { questionCountText: string };
  catalogChapters: unknown[];
  loading: boolean;
}

interface HomePageContext {
  data: HomePageData;
  setData(update: Partial<HomePageData>): void;
}

interface HomePageDefinition {
  data: HomePageData;
  loadCertificate(this: HomePageContext, key: CertificateKey): Promise<void>;
}

const loadHomePage = async () => {
  vi.resetModules();
  let definition: HomePageDefinition | undefined;

  vi.stubGlobal('Page', (value: HomePageDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });

  await import('../miniprogram/pages/home/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  if (!definition) throw new Error('home Page was not registered');

  const registered = definition;
  const context: HomePageContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  };

  return { appServices, context, definition: registered };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('home page current catalog', () => {
  it('loads the current catalog without depending on recent-practice records', async () => {
    const { appServices, context, definition } = await loadHomePage();
    vi.spyOn(appServices.questions, 'list').mockResolvedValue([
      makeQuestion({ id: 'HOME-CURRENT-Q1' }),
    ]);
    vi.spyOn(appServices.questions, 'getByIds').mockRejectedValue(
      new Error('recent-practice records are unavailable'),
    );
    vi.spyOn(appServices.progress, 'listRecentQuestionIds').mockReturnValue(['RECENT-Q1']);

    await expect(definition.loadCertificate.call(context, '4-02-06-01:5')).resolves.toBeUndefined();

    expect(context.data.loading).toBe(false);
    expect(context.data.certificate.questionCountText).toBe('1 题');
  });
});
