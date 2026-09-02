import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PracticalSkill } from '../miniprogram/data/practical-skills';
import type { Question } from '../miniprogram/types/domain';

interface PracticalDetailData {
  skill: PracticalSkill | null;
  roleText: string;
  sourceText: string;
  relatedQuestions: Question[];
  relatedReady: boolean;
  relatedLoadError: boolean;
}

interface PracticalDetailContext {
  data: PracticalDetailData;
  setData(update: Partial<PracticalDetailData>): void;
  loadRelatedQuestions(): Promise<void>;
}

interface PracticalDetailDefinition {
  data: PracticalDetailData;
  onLoad(this: PracticalDetailContext, options: Record<string, string | undefined>): Promise<void>;
  loadRelatedQuestions(this: PracticalDetailContext): Promise<void>;
  onRetryRelatedQuestions(this: PracticalDetailContext): Promise<void>;
  onStartRelatedPractice(this: PracticalDetailContext): void;
}

const loadPracticalDetailPage = async () => {
  vi.resetModules();
  let definition: PracticalDetailDefinition | undefined;
  const navigateTo = vi.fn();
  const showToast = vi.fn();

  vi.stubGlobal('Page', (value: PracticalDetailDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    setNavigationBarTitle: vi.fn(),
    navigateTo,
    showToast,
  });

  const practiceRuntime = await import('../miniprogram/services/practice-runtime');
  const startPractice = vi.spyOn(practiceRuntime, 'startPracticeFromQuestions');
  await import('../miniprogram/packages/auxiliary/pages/practical-detail/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  if (!definition) throw new Error('practical-detail Page was not registered');

  const registered = definition;
  const context: PracticalDetailContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    loadRelatedQuestions() {
      return registered.loadRelatedQuestions.call(context);
    },
  };

  return {
    appServices,
    context,
    definition: registered,
    navigateTo,
    showToast,
    startPractice,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('practical detail related practice', () => {
  it('shows a retryable error without creating a session when repository loading fails', async () => {
    const { appServices, context, definition, navigateTo, startPractice } =
      await loadPracticalDetailPage();
    const getByIds = vi
      .spyOn(appServices.questions, 'getByIds')
      .mockRejectedValueOnce(new Error('question repository unavailable'))
      .mockResolvedValueOnce([]);

    await definition.onLoad.call(context, { id: 'grain-condition-rounds' });

    expect(context.data.relatedReady).toBe(true);
    expect(context.data.relatedLoadError).toBe(true);
    definition.onStartRelatedPractice.call(context);
    expect(startPractice).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();

    await definition.onRetryRelatedQuestions.call(context);
    expect(context.data.relatedLoadError).toBe(false);
    expect(context.data.relatedQuestions).toEqual([]);
    expect(getByIds).toHaveBeenCalledTimes(2);
  });

  it('keeps a successful empty result out of the practice runtime', async () => {
    const { appServices, context, definition, navigateTo, startPractice } =
      await loadPracticalDetailPage();
    vi.spyOn(appServices.questions, 'getByIds').mockResolvedValueOnce([]);

    await definition.onLoad.call(context, { id: 'grain-condition-rounds' });
    definition.onStartRelatedPractice.call(context);

    expect(context.data.relatedReady).toBe(true);
    expect(context.data.relatedLoadError).toBe(false);
    expect(startPractice).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
