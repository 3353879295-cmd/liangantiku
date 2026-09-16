import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../miniprogram/app.ts'), 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('../miniprogram/services/app-services');
});

describe('application account lifecycle wiring', () => {
  it('does not block launch or request authorization while a saved account recovers silently', async () => {
    vi.resetModules();
    let finishRecovery: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const initialize = vi.fn(() => pending);
    const retryBackground = vi.fn();
    let selectedCertificateKey = '4-02-06-01:5';
    vi.doMock('../miniprogram/services/app-services', () => ({
      appServices: {
        progress: {
          getPreferences: () => ({ selectedCertificateKey }),
          consumeRecoveryNotice: () => null,
        },
        theme: { get: () => 'light' },
        auth: { initialize, retryBackground },
      },
    }));
    const interactive = {
      navigateTo: vi.fn(),
      redirectTo: vi.fn(),
      reLaunch: vi.fn(),
      switchTab: vi.fn(),
      showModal: vi.fn(),
      getUserProfile: vi.fn(),
      getPhoneNumber: vi.fn(),
      chooseAvatar: vi.fn(),
    };
    vi.stubGlobal('wx', {
      ...interactive,
      cloud: { init: vi.fn() },
      onNetworkStatusChange: vi.fn(),
    });
    let app: (IAppOption & { onLaunch(): void; onShow(): void }) | undefined;
    vi.stubGlobal('App', (definition: typeof app) => {
      app = definition;
    });
    await import('../miniprogram/app');
    if (!app) throw new Error('App was not registered');
    expect(app.onLaunch()).toBeUndefined();
    app.onShow();
    expect(initialize).toHaveBeenCalledOnce();
    for (const call of Object.values(interactive)) expect(call).not.toHaveBeenCalled();
    selectedCertificateKey = '4-08-05-01:4';
    finishRecovery?.();
    await pending;
    expect(app.globalData.selectedCertificateKey).toBe('4-08-05-01:4');
    app.onShow();
    expect(initialize).toHaveBeenCalledOnce();
    expect(retryBackground).toHaveBeenCalledTimes(2);
    for (const call of Object.values(interactive)) expect(call).not.toHaveBeenCalled();
  });

  it('initializes cloud before account recovery and retries only on foreground or reconnect', () => {
    expect(source.indexOf('initializeCloud();')).toBeLessThan(source.indexOf('auth.initialize()'));
    expect(source).toContain('onShow()');
    expect(source).toContain('auth.retryBackground()');
    expect(source).toContain('wx.onNetworkStatusChange');
    expect(source).toContain('if (status.isConnected)');
  });
});
