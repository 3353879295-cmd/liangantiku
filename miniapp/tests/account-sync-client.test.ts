import { describe, expect, it, vi } from 'vitest';

import {
  AccountSyncClient,
  AccountSyncClientError,
  type AccountSyncRequest,
} from '../miniprogram/repositories/account-sync-client';

const createBootstrapResponse = () => ({
  schemaVersion: 1,
  profileRevision: 0,
  progressRevision: 0,
  syncedAt: '2026-09-02T00:00:00.000Z',
  profile: {
    nickname: '仓廪小麦',
    avatarUrl: '',
    selectedCertificateKey: '4-02-06-01:5',
    dailyGoal: 20,
    answerTheme: 'light',
    answerRevealMode: 'immediate',
  },
  progress: {
    schemaVersion: 4,
    summary: { answered: 0, correct: 0, durationMs: 0, firstAnsweredAt: null },
    questionTotals: {},
    wrongQuestions: {},
    favorites: {},
    session: null,
    dailyTotals: {},
    recentQuestionIds: [],
    recordedSessionIds: [],
    preferences: {
      selectedCertificateKey: '4-02-06-01:5',
      dailyGoal: 20,
      answerTheme: 'light',
      nickname: '仓廪小麦',
      avatarUrl: '',
      answerRevealMode: 'immediate',
    },
  },
});

const success = (data: unknown) => ({ ok: true, data });

describe('AccountSyncClient', () => {
  it('calls only accountSync and sends the whitelisted request without identity fields', async () => {
    const callFunction = vi.fn().mockResolvedValue({ result: success(createBootstrapResponse()) });
    const client = new AccountSyncClient(callFunction);
    const request: AccountSyncRequest = { action: 'bootstrap', schemaVersion: 1 };

    await expect(client.call(request)).resolves.toMatchObject({ profileRevision: 0 });

    expect(callFunction).toHaveBeenCalledWith({ name: 'accountSync', data: request });
    expect(JSON.stringify(callFunction.mock.calls[0]?.[0])).not.toMatch(/openid|account_key/i);
  });

  it('rejects malformed cloud responses instead of accepting a cache-corrupting snapshot', async () => {
    const client = new AccountSyncClient(vi.fn().mockResolvedValue({ result: success({}) }));

    await expect(client.call({ action: 'bootstrap', schemaVersion: 1 })).rejects.toMatchObject({
      code: 'SCHEMA_INCOMPATIBLE',
    });
  });

  it('maps a stable cloud business error without exposing its raw message', async () => {
    const client = new AccountSyncClient(
      vi.fn().mockResolvedValue({
        result: {
          ok: false,
          error: { code: 'REVISION_CONFLICT', message: 'database details must stay hidden' },
        },
      }),
    );

    await expect(client.call({ action: 'bootstrap', schemaVersion: 1 })).rejects.toEqual(
      new AccountSyncClientError('REVISION_CONFLICT', '数据已在其他设备更新，正在恢复云端记录。'),
    );
  });

  it('validates the resumable delete-account result independently from snapshots', async () => {
    const client = new AccountSyncClient(
      vi.fn().mockResolvedValue({
        result: success({ schemaVersion: 1, done: false, stage: 'records' }),
      }),
    );

    await expect(client.call({ action: 'deleteAccount', schemaVersion: 1 })).resolves.toEqual({
      schemaVersion: 1,
      done: false,
      stage: 'records',
    });
  });

  it('maps platform failures to a stable Chinese unavailable error', async () => {
    const client = new AccountSyncClient(vi.fn().mockRejectedValue(new Error('network down')));

    await expect(client.call({ action: 'bootstrap', schemaVersion: 1 })).rejects.toEqual(
      new AccountSyncClientError('ACCOUNT_SYNC_UNAVAILABLE', '云端学习同步暂不可用，请稍后重试。'),
    );
  });
});
