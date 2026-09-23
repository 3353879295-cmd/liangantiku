import { MembershipClient, MembershipError } from '../repositories/membership-client';
import type { MembershipFeature, MembershipStatus } from '../types/membership';

export class MembershipService {
  private statusRequest: Promise<MembershipStatus> | null = null;

  constructor(protected readonly client = new MembershipClient()) {}

  getStatus(): Promise<MembershipStatus> {
    if (this.statusRequest) return this.statusRequest;
    const request = this.fetchStatus().finally(() => {
      if (this.statusRequest === request) this.statusRequest = null;
    });
    this.statusRequest = request;
    return request;
  }

  private async fetchStatus(): Promise<MembershipStatus> {
    return this.expectStatus(await this.client.call({ action: 'getStatus' }));
  }

  async checkPermission(feature: MembershipFeature): Promise<MembershipStatus> {
    const result = await this.client.call({ action: 'checkPermission', feature });
    if (!this.hasPermission(result)) throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    const entitled =
      feature === 'randomPractice'
        ? result.membership.isMember || result.membership.freeRemaining > 0
        : result.membership.isMember;
    if (result.allowed !== entitled) throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
    if (!result.allowed) {
      throw new MembershipError(
        feature === 'randomPractice' ? 'DAILY_LIMIT_REACHED' : 'MEMBERSHIP_REQUIRED',
      );
    }
    return result.membership;
  }

  async startRandomPractice(
    sessionId: string,
    questionIds: string[],
    requestId = sessionId,
  ): Promise<MembershipStatus> {
    return this.expectStatus(
      await this.client.call({ action: 'startRandomPractice', requestId, sessionId, questionIds }),
    );
  }

  async validateRandomPractice(
    sessionId: string,
    questionIds: string[],
  ): Promise<MembershipStatus> {
    return this.expectStatus(
      await this.client.call({ action: 'validateRandomPractice', sessionId, questionIds }),
    );
  }

  protected expectStatus(value: unknown): MembershipStatus {
    if (this.isStatus(value)) return value;
    throw new MembershipError('MEMBERSHIP_UNAVAILABLE');
  }
  private isStatus(value: unknown): value is MembershipStatus {
    const status = value as Partial<MembershipStatus> | null;
    return (
      typeof status === 'object' &&
      status !== null &&
      typeof status.isMember === 'boolean' &&
      (typeof status.startsAt === 'string' || status.startsAt === null) &&
      (typeof status.expiresAt === 'string' || status.expiresAt === null) &&
      typeof status.freeUsed === 'number' &&
      Number.isFinite(status.freeUsed) &&
      typeof status.freeRemaining === 'number' &&
      Number.isFinite(status.freeRemaining) &&
      typeof status.freeLimit === 'number' &&
      Number.isFinite(status.freeLimit) &&
      typeof status.freeDate === 'string' &&
      typeof status.serverTime === 'string' &&
      typeof status.paymentAvailable === 'boolean'
    );
  }
  private hasPermission(
    value: unknown,
  ): value is { allowed: boolean; membership: MembershipStatus } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'allowed' in value &&
      typeof value.allowed === 'boolean' &&
      'membership' in value &&
      this.isStatus(value.membership)
    );
  }
}
