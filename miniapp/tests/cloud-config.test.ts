import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('cloud initialization', () => {
  it('initializes the confirmed cloud environment once during application launch without a cloud call', async () => {
    const init = vi.fn();
    const callFunction = vi.fn();
    const app = vi.fn();
    vi.stubGlobal('App', app);
    vi.stubGlobal('wx', {
      cloud: { init, callFunction },
      getStorageSync: vi.fn(),
      setStorageSync: vi.fn(),
      removeStorageSync: vi.fn(),
      onNetworkStatusChange: vi.fn(),
    });

    await import('../miniprogram/app');
    const definition = app.mock.calls[0]?.[0] as { onLaunch(): void };
    definition.onLaunch();

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith({ env: 'cloud1-d2gglad830c91db10', traceUser: false });
    expect(callFunction).not.toHaveBeenCalled();
  });
});
