import { describe, expect, it } from 'vitest';

import { ACCOUNT_OUTBOX_KEY, SyncOutbox } from '../miniprogram/storage/sync-outbox';
import type { StorageAdapter } from '../miniprogram/types/domain';

class MemoryStorage implements StorageAdapter {
  values = new Map<string, unknown>();
  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  set<T>(key: string, value: T): void {
    this.values.set(key, structuredClone(value));
  }
  remove(key: string): void {
    this.values.delete(key);
  }
}

describe('SyncOutbox', () => {
  it('persists commands, restores them as pending, and keeps a stable id on coalesce', () => {
    const storage = new MemoryStorage();
    let id = 0;
    const outbox = new SyncOutbox(
      storage,
      () => 10,
      () => `id-${++id}`,
    );
    const first = outbox.enqueue({
      action: 'updateProfile',
      nickname: '甲',
      avatarUrl: '',
      schemaVersion: 1,
      expectedRevision: 0,
    });
    const second = outbox.enqueue({
      action: 'updateProfile',
      nickname: '乙',
      avatarUrl: '',
      schemaVersion: 1,
      expectedRevision: 0,
    });
    expect(second.id).toBe(first.id);
    expect(outbox.list()).toHaveLength(1);
    expect(outbox.takeNext()?.state).toBe('sending');
    const restored = new SyncOutbox(storage);
    expect(restored.list()[0]).toMatchObject({ id: first.id, state: 'pending', nickname: '乙' });
    expect(storage.get(ACCOUNT_OUTBOX_KEY)).not.toBeNull();
  });

  it('does not merge practice records and rebases each revision domain independently', () => {
    const outbox = new SyncOutbox(
      new MemoryStorage(),
      () => 1,
      () => crypto.randomUUID(),
    );
    outbox.enqueue({
      action: 'recordPractice',
      schemaVersion: 1,
      expectedRevision: 0,
      sessionId: 's1',
      mode: 'random',
      answers: [],
    });
    outbox.enqueue({
      action: 'recordPractice',
      schemaVersion: 1,
      expectedRevision: 0,
      sessionId: 's2',
      mode: 'random',
      answers: [],
    });
    outbox.enqueue({
      action: 'updatePreferences',
      schemaVersion: 1,
      expectedRevision: 0,
      selectedCertificateKey: '4-02-06-01:5',
      dailyGoal: 20,
      answerTheme: 'light',
      answerRevealMode: 'immediate',
    });
    outbox.enqueue({
      action: 'updateProfile',
      schemaVersion: 1,
      expectedRevision: 0,
      nickname: '甲',
      avatarUrl: '',
    });
    outbox.rebase(4, 9);
    const commands = outbox.list();
    expect(commands.filter((item) => item.action === 'recordPractice')).toHaveLength(2);
    expect(commands.map((item) => item.expectedRevision)).toEqual([9, 10, 4, 5]);
  });

  it('does not replace a command already being sent', () => {
    let number = 0;
    const outbox = new SyncOutbox(
      new MemoryStorage(),
      () => 1,
      () => `id-${++number}`,
    );
    const first = outbox.enqueue({
      action: 'saveActiveSession',
      schemaVersion: 1,
      expectedRevision: 0,
      session: null,
    });
    expect(outbox.takeNext()?.id).toBe(first.id);
    const later = outbox.enqueue({
      action: 'saveActiveSession',
      schemaVersion: 1,
      expectedRevision: 1,
      session: null,
    });
    expect(later.id).not.toBe(first.id);
    expect(outbox.list()).toHaveLength(2);
  });

  it('rejects a persisted command whose action is outside the sync whitelist', () => {
    const storage = new MemoryStorage();
    storage.set(ACCOUNT_OUTBOX_KEY, {
      schemaVersion: 1,
      commands: [
        {
          id: 'forged',
          action: 'deleteAccount',
          schemaVersion: 1,
          expectedRevision: 0,
          createdAt: 1,
          state: 'pending',
        },
      ],
    });

    expect(new SyncOutbox(storage).list()).toEqual([]);
  });

  it('persists a conflict block, resets sending commands, and only clear removes it', () => {
    const storage = new MemoryStorage();
    const outbox = new SyncOutbox(
      storage,
      () => 1,
      () => 'id-1',
    );
    outbox.enqueue({
      action: 'setFavorite',
      schemaVersion: 1,
      expectedRevision: 4,
      questionId: 'q1',
      favorite: true,
    });
    outbox.takeNext();
    outbox.block();
    outbox.enqueue({
      action: 'recordPractice',
      schemaVersion: 1,
      expectedRevision: 5,
      sessionId: 's1',
      mode: 'random',
      answers: [],
    });
    const preserved = outbox.list();

    expect(outbox.isBlocked).toBe(true);
    expect(outbox.takeNext()).toBeNull();
    expect(outbox.list()).toEqual(preserved);
    const restored = new SyncOutbox(storage);
    expect(restored.isBlocked).toBe(true);
    expect(restored.list()).toEqual(preserved);
    outbox.rebase(8, 9);
    expect(outbox.list()[0]?.expectedRevision).toBe(4);
    outbox.clear();
    expect(outbox.isBlocked).toBe(false);
  });

  it('merges only locally changed profile fields and unions coalesced metadata', () => {
    const outbox = new SyncOutbox(
      new MemoryStorage(),
      () => 1,
      () => 'id',
    );
    outbox.enqueue({
      action: 'updatePreferences',
      schemaVersion: 1,
      expectedRevision: 0,
      selectedCertificateKey: '4-02-06-01:5',
      dailyGoal: 30,
      answerTheme: 'light',
      answerRevealMode: 'immediate',
      changedFields: ['dailyGoal'],
    });
    outbox.enqueue({
      action: 'updatePreferences',
      schemaVersion: 1,
      expectedRevision: 0,
      selectedCertificateKey: '4-02-06-01:5',
      dailyGoal: 30,
      answerTheme: 'night',
      answerRevealMode: 'immediate',
      changedFields: ['answerTheme'],
    });
    const cloud = {
      nickname: '云端',
      avatarUrl: '',
      selectedCertificateKey: '4-08-05-01:4' as const,
      dailyGoal: 20,
      answerTheme: 'light' as const,
      answerRevealMode: 'deferred' as const,
    };
    outbox.mergeProfileChanges(cloud, {
      ...cloud,
      selectedCertificateKey: '4-02-06-01:5',
      dailyGoal: 20,
      answerTheme: 'light',
      answerRevealMode: 'immediate',
    });
    expect(outbox.list()[0]).toMatchObject({
      dailyGoal: 30,
      answerTheme: 'night',
      selectedCertificateKey: '4-08-05-01:4',
      answerRevealMode: 'deferred',
      changedFields: ['dailyGoal', 'answerTheme'],
    });
  });

  it('infers legacy profile changes and leaves sending payload immutable', () => {
    const outbox = new SyncOutbox(
      new MemoryStorage(),
      () => 1,
      () => 'id',
    );
    outbox.enqueue({
      action: 'updateProfile',
      schemaVersion: 1,
      expectedRevision: 0,
      nickname: '本机',
      avatarUrl: '',
    });
    const sending = outbox.takeNext();
    expect(sending).not.toBeNull();
    outbox.mergeProfileChanges(
      {
        nickname: '云端',
        avatarUrl: 'cloud.png',
        selectedCertificateKey: '4-02-06-01:5',
        dailyGoal: 20,
        answerTheme: 'night',
        answerRevealMode: 'deferred',
      },
      {
        nickname: '旧名',
        avatarUrl: '',
        selectedCertificateKey: '4-02-06-01:5',
        dailyGoal: 20,
        answerTheme: 'light',
        answerRevealMode: 'immediate',
      },
    );
    expect(outbox.list()[0]).toEqual(sending);
  });
});
