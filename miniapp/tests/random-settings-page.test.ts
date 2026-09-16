/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call */
import { afterEach, describe, expect, it, vi } from 'vitest';

const pending = {
  key: 'pending-key',
  id: 'pending-id',
  questionIds: ['Q1'],
  now: 1,
  answerRevealMode: 'immediate' as const,
};

const load = async () => {
  vi.resetModules();
  let definition: any;
  const checkPermission = vi.fn();
  const navigateTo = vi.fn(() => Promise.resolve());
  vi.doMock('../miniprogram/services/random-practice-access', () => ({
    getPendingRandomStart: () => pending,
  }));
  vi.doMock('../miniprogram/services/app-services', () => ({
    appServices: {
      progress: { getPreferences: () => ({ selectedCertificateKey: '4-02-06-01:5' }) },
      questions: { list: vi.fn() },
      membership: { checkPermission, getStatus: vi.fn() },
    },
  }));
  vi.stubGlobal('wx', { navigateTo, showToast: vi.fn() });
  vi.stubGlobal('Page', (value: any) => {
    definition = value;
  });
  await import('../miniprogram/packages/auxiliary/pages/random-settings/index');
  const context = {
    data: structuredClone(definition.data),
    setData(update: Record<string, unknown>) {
      Object.assign(this.data, update);
    },
  };
  return { definition, context, navigateTo, checkPermission };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('random settings pending recovery', () => {
  it('resumes a pending random start without checking the current free allowance', async () => {
    const { definition, context, navigateTo, checkPermission } = await load();
    await definition.onStart.call(context);
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/practice/index?resume=1' });
    expect(checkPermission).not.toHaveBeenCalled();
    expect(context.data.starting).toBe(false);
  });
});
