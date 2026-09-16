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
    if (this.hasPermission(result)) {
      if (!result.allowed) {
        throw new MembershipError(
          feature === 'randomPractice' ? 'DAILY_LIMIT_REACHED' : 'MEMBERSHIP_REQUIRED',
        );
      }
      return result.membership;
    }
    return this.expectStatus(result);
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
    return (
      typeof value === 'object' && value !== null && 'isMember' in value && 'freeRemaining' in value
    );
  }
  private hasPermission(
    value: unknown,
  ): value is { allowed: boolean; membership: MembershipStatus } {
    return (
      typeof value === 'object' && value !== null && 'allowed' in value && 'membership' in value
    );
  }
}
