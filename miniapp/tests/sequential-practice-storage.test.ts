import { describe, expect, it } from 'vitest';

import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import type { PersistedPracticeSession } from '../miniprogram/storage/migrations';
import type { StorageAdapter } from '../miniprogram/types/domain';

const memoryStorage = (): StorageAdapter & { keys: () => string[] } => {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: <T>(key: string, value: T) => values.set(key, value),
    remove: (key: string) => values.delete(key),
    keys: () => [...values.keys()],
  };
};

const session = (id = 'sequential-session'): PersistedPracticeSession => ({
  id,
  mode: 'sequential',
  answerRevealMode: 'immediate',
  questionIds: ['Q1'],
  currentIndex: 0,
  answers: {},
  status: 'active',
  startedAt: 1,
  updatedAt: 1,
  progressRecorded: false,
});

describe('sequential practice storage', () => {
  it('keeps certificate backups isolated between guest and account scopes', () => {
    const repository = new ProgressRepository(memoryStorage());
    repository.saveSequentialSession('guest', '4-02-06-01:5', session('guest'));
    repository.saveSequentialSession('account', '4-02-06-01:5', session('account'));

    expect(repository.loadSequentialSession('guest', '4-02-06-01:5')?.id).toBe('guest');
    expect(repository.loadSequentialSession('account', '4-02-06-01:5')?.id).toBe('account');
  });

  it('removes every certificate backup when a scope is cleared', () => {
    const storage = memoryStorage();
    const repository = new ProgressRepository(storage);
    repository.saveSequentialSession('guest', '4-02-06-01:5', session());
    repository.saveSequentialSession('guest', '4-08-05-01:1', session('other'));
    repository.saveSequentialSession('account', '4-02-06-01:5', session('account'));

    repository.removeSequentialSessions('guest');

    expect(repository.loadSequentialSession('guest', '4-02-06-01:5')).toBeNull();
    expect(repository.loadSequentialSession('guest', '4-08-05-01:1')).toBeNull();
    expect(repository.loadSequentialSession('account', '4-02-06-01:5')?.id).toBe('account');
    expect(storage.keys().some((key) => key.includes(':guest:sequential:'))).toBe(false);
  });
});
