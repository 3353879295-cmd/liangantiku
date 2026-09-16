import { describe, expect, it, vi } from 'vitest';
import { canUseMembershipStaging } from '../miniprogram/config/membership';
import { MEMBERSHIP_STAGING_ENV_ID } from '../miniprogram/config/membership';
import { MembershipClient } from '../miniprogram/repositories/membership-client';

const status = {
  isMember: false,
  startsAt: null,
  expiresAt: null,
  freeUsed: 0,
  freeRemaining: 3,
  freeLimit: 3,
  freeDate: '2026-09-06',
  serverTime: '2026-09-06T00:00:00.000Z',
  paymentAvailable: false,
};

describe('membership environment boundary', () => {
  it('permits the dedicated membership environment from every mini-program build', () => {
    expect(canUseMembershipStaging('develop')).toBe(true);
    expect(canUseMembershipStaging('trial')).toBe(true);
    expect(canUseMembershipStaging('release')).toBe(true);
    expect(canUseMembershipStaging(undefined)).toBe(false);
    expect(canUseMembershipStaging('unknown')).toBe(false);
  });

  it('fails closed for unknown builds and always calls the dedicated membership environment', async () => {
    const callFunction = vi.fn().mockResolvedValue({ result: { ok: true, data: status } });
    vi.stubGlobal('wx', {
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'unknown' } }),
      cloud: { callFunction },
    });
    await expect(new MembershipClient().call({ action: 'getStatus' })).rejects.toMatchObject({
      code: 'MEMBERSHIP_UNAVAILABLE',
    });
    expect(callFunction).not.toHaveBeenCalled();

    for (const envVersion of ['trial', 'release']) {
      vi.stubGlobal('wx', {
        getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
        cloud: { callFunction },
      });
      await expect(new MembershipClient().call({ action: 'getStatus' })).resolves.toEqual(status);
      expect(callFunction).toHaveBeenLastCalledWith({
        name: 'membership',
        data: { action: 'getStatus' },
        config: { env: MEMBERSHIP_STAGING_ENV_ID },
      });
    }
    expect(callFunction).toHaveBeenCalledTimes(2);
  });
});
