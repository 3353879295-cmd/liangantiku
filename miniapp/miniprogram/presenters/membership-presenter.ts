import type { MembershipStatus } from '../types/membership';

export interface MembershipViewModel {
  isMember: boolean;
  statusText: string;
  detailText: string;
  freePracticeText: string;
  canPurchase: boolean;
}

const dateText = (value: string | null): string => {
  if (!value) return '';
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return '';
  const date = new Date(instant + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}年${`${date.getUTCMonth() + 1}`.padStart(2, '0')}月${`${date.getUTCDate()}`.padStart(2, '0')}日`;
};

export const presentMembership = (status: MembershipStatus): MembershipViewModel => ({
  isMember: status.isMember,
  statusText: status.isMember ? '当前：会员' : '当前：免费用户',
  detailText: status.isMember
    ? `有效期至：${dateText(status.expiresAt) || '以会员中心为准'}`
    : '每日可进行3次随机练习',
  freePracticeText: status.isMember
    ? '会员期间不限次数练习'
    : `今日免费练习：剩余 ${status.freeRemaining}/${status.freeLimit} 次`,
  canPurchase: status.paymentAvailable,
});

export const formatMembershipExpiry = (value: string | null): string => dateText(value);
