import { afterEach, describe, expect, it, vi } from 'vitest';

const loadServices = async (preference: 'guest' | 'account') => {
  vi.resetModules();
  const values = new Map<string, unknown>([['grain-practice:auth-preference', preference]]);
  const getStorageSync = vi.fn((key: string) => values.get(key) ?? '');
  vi.stubGlobal('wx', {
    getStorageSync,
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    removeStorageSync: (key: string) => values.delete(key),
  });

  const { appServices } = await import('../miniprogram/services/app-services');
  return { appServices, getStorageSync };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('app services startup', () => {
  it.each([
    ['guest', 'guest'],
    ['account', 'guest'],
  ] as const)(
    'reads %s preference once and initializes the %s scope',
    async (preference, scope) => {
      const { appServices, getStorageSync } = await loadServices(preference);

      expect(appServices.progress.getScope()).toBe(scope);
      expect(appServices.auth.getState().preference).toBe(preference);
      expect(
        getStorageSync.mock.calls.filter(([key]) => key === 'grain-practice:auth-preference'),
      ).toHaveLength(1);
    },
  );
});
