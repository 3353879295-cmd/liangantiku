import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
type Context = { APPID: string; OPENID: string };
type Response = {
  ok: boolean;
  data?: { accountScope?: string };
  error?: { code: string };
};
const { createHandler } = require('../cloudfunctions/membership/lib/handler.js') as {
  createHandler: (
    options: Record<string, unknown>,
  ) => (event: Record<string, unknown>, context: Context) => Promise<Response>;
};
const account = { APPID: 'wx-scope-test', OPENID: 'private-scope-user-a' };
const setup = () => {
  const accessed = vi.fn(() => {
    throw new Error('unexpected database access');
  });
  const store = new Proxy({}, { get: () => accessed });
  const logger = { start: vi.fn(), complete: vi.fn(), fail: vi.fn() };
  return { handler: createHandler({ store, diagnostics: logger }), accessed, logger };
};

describe('payment account scope from authenticated cloud context', () => {
  it('returns a stable payment-only namespace without reading or writing account data', async () => {
    const { handler, accessed, logger } = setup();
    const first = await handler({ action: 'getPaymentContext' }, account);
    expect(first).toEqual({
      ok: true,
      data: { accountScope: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(
      await handler({ action: 'getPaymentContext', OPENID: 'injected-identity' }, account),
    ).toEqual(first);
    expect(
      await handler({ action: 'getPaymentContext' }, { ...account, OPENID: 'user-b' }),
    ).not.toEqual(first);
    expect(
      await handler({ action: 'getPaymentContext' }, { ...account, APPID: 'wx-other-app' }),
    ).not.toEqual(first);
    expect(accessed).not.toHaveBeenCalled();
    expect(logger.start).not.toHaveBeenCalled();
    expect(logger.complete).not.toHaveBeenCalled();
    expect(logger.fail).not.toHaveBeenCalled();
    expect(JSON.stringify(first)).not.toContain(account.OPENID);
  });

  it.each([
    'createOrder',
    'resumePayment',
    'markPaymentStarting',
    'markPaymentUnknown',
    'getOrder',
    'recoverOrders',
  ])('rejects an account switch before %s can access an order', async (action) => {
    const { handler, accessed } = setup();
    const resolved = await handler({ action: 'getPaymentContext' }, account);
    const result = await handler(
      { action, expectedPaymentAccountScope: resolved.data?.accountScope },
      { ...account, OPENID: 'private-scope-user-b' },
    );
    expect(result).toEqual({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(accessed).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-scope-user|accountScope/);
  });

  it('cannot obtain an account scope without the authenticated cloud identity', async () => {
    const { handler, accessed } = setup();
    expect(
      await handler(
        { action: 'getPaymentContext', OPENID: account.OPENID },
        { APPID: account.APPID, OPENID: '' },
      ),
    ).toEqual({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    expect(accessed).not.toHaveBeenCalled();
  });
});
