import { describe, expect, it } from 'vitest';
import { presentMembership } from '../miniprogram/presenters/membership-presenter';

describe('presentMembership', () => {
  it('presents free quota and a Shanghai calendar expiry', () => {
    expect(
      presentMembership({
        isMember: false,
        startsAt: null,
        expiresAt: null,
        freeUsed: 1,
        freeRemaining: 2,
        freeLimit: 3,
        freeDate: '2026-09-05',
        serverTime: '2026-09-05T00:00:00Z',
        paymentAvailable: true,
      }),
    ).toMatchObject({
      statusText: '当前：免费用户',
      freePracticeText: '今日免费练习：剩余 2/3 次',
    });
    expect(
      presentMembership({
        isMember: true,
        startsAt: '2026-09-01T00:00:00Z',
        expiresAt: '2027-03-04T16:00:00Z',
        freeUsed: 0,
        freeRemaining: 3,
        freeLimit: 3,
        freeDate: '2026-09-05',
        serverTime: '2026-09-05T00:00:00Z',
        paymentAvailable: true,
      }).detailText,
    ).toBe('有效期至：2027年03月05日');
  });
});
