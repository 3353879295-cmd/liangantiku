import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../miniprogram/app.ts'), 'utf8');

describe('application account lifecycle wiring', () => {
  it('initializes cloud before account recovery and retries only on foreground or reconnect', () => {
    expect(source.indexOf('initializeCloud();')).toBeLessThan(source.indexOf('auth.initialize()'));
    expect(source).toContain('onShow()');
    expect(source).toContain('auth.retryBackground()');
    expect(source).toContain('wx.onNetworkStatusChange');
    expect(source).toContain('if (status.isConnected)');
  });
});
