import { describe, expect, it } from 'vitest';

import { ProgressService } from '../miniprogram/services/progress-service';
import {
  createPracticeSession,
  serializePracticeSession,
} from '../miniprogram/services/practice-session';
import {
  RECOVERY_BACKUP_KEY,
  ProgressRepository,
  STORAGE_KEY,
} from '../miniprogram/storage/progress-repository';
import { createEmptyProgress } from '../miniprogram/storage/migrations';
import type { StorageAdapter } from '../miniprogram/types/domain';
import type { PersistedPracticeSession } from '../miniprogram/storage/migrations';
import type { AccountSyncCommandInput } from '../miniprogram/types/account-sync';
import { makeQuestion } from './factories';

class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }
}

const createService = () => {
  const storage = new MemoryStorageAdapter();
  const repository = new ProgressRepository(storage);
  return { storage, repository, service: new ProgressService(repository) };
};

describe('ProgressService', () => {
  it('emits only final account-domain mutations after optimistic account writes', () => {
    const { service } = createService();
    const commands: AccountSyncCommandInput[] = [];
    service.setAccountMutationListener((command) => commands.push(command));
    service.updatePreferences({ nickname: '云端麦穗', dailyGoal: 30 });
    service.toggleFavorite('guest-q', 1);
    expect(commands).toEqual([]);

    service.switchScope('account');
    service.updatePreferences({ nickname: '云端麦穗', dailyGoal: 30 });
    service.toggleFavorite('account-q', 2);
    expect(commands).toEqual([
      expect.objectContaining({
        action: 'updateProfile',
        nickname: '云端麦穗',
        avatarUrl: '',
        changedFields: ['nickname'],
      }),
      expect.objectContaining({ action: 'updatePreferences', dailyGoal: 30 }),
      { action: 'setFavorite', questionId: 'account-q', favorite: true },
    ]);
  });

  it('sends complete account targets for sessions, practice, favorites and mastery after persisting', () => {
    const { repository, service } = createService();
    service.switchScope('account');
    const observed: AccountSyncCommandInput[] = [];
    service.setAccountMutationListener((command) => {
      expect(repository.load('account').data).toEqual(expect.any(Object));
      observed.push(command);
    });
    service.saveSession({
      id: 'active-1',
      mode: 'random',
      answerRevealMode: 'immediate',
      questionIds: ['Q1'],
      currentIndex: 0,
      answers: {},
      status: 'submitted',
      startedAt: 1,
      updatedAt: 2,
    });
    service.recordPracticeResults(
      'practice-1',
      [{ questionId: 'Q1', correct: false, durationMs: 5, at: '2026-09-02' }],
      'mock',
    );
    service.toggleFavorite('Q1', 1);
    service.markMastered('Q1');
    expect(observed).toEqual([
      { action: 'saveActiveSession', session: null },
      {
        action: 'recordPractice',
        sessionId: 'practice-1',
        mode: 'mock',
        answers: [{ questionId: 'Q1', correct: false, durationMs: 5, at: '2026-09-02' }],
      },
      { action: 'setFavorite', questionId: 'Q1', favorite: true },
      { action: 'markMastered', questionId: 'Q1', mastered: true },
    ]);
  });

  it('refreshes account reads from a cloud-replaced cache without emitting mutations', () => {
    const { repository, service } = createService();
    service.switchScope('account');
    service.replaceSnapshot(createEmptyProgress());
    const commands: AccountSyncCommandInput[] = [];
    service.setAccountMutationListener((command) => commands.push(command));
    const cloud = createEmptyProgress();
    cloud.summary.answered = 9;
    repository.save('account', cloud);
    service.refreshAccountSnapshot();
    expect(service.getDashboard('2026-09-02').answered).toBe(9);
    expect(commands).toEqual([]);
  });
  it('can replace the active account snapshot without reading guest progress', () => {
    const { repository, service } = createService();
    service.recordAnswer({
      questionId: 'guest-question',
      correct: true,
      durationMs: 1,
      at: '2026-07-22',
    });
    const accountSnapshot = createEmptyProgress();
    accountSnapshot.summary.answered = 5;

    expect(() => service.replaceSnapshot(accountSnapshot)).toThrow(/account scope/);
    service.switchScope('account');
    service.replaceSnapshot(accountSnapshot);
    service.recordAnswer({
      questionId: 'account-question',
      correct: true,
      durationMs: 1,
      at: '2026-07-22',
    });

    expect(service.getDashboard('2026-07-22').answered).toBe(6);
    expect(accountSnapshot.summary.answered).toBe(5);
    expect(accountSnapshot.questionTotals).toEqual({});
    service.switchScope('guest');
    expect(service.getDashboard('2026-07-22').answered).toBe(1);
    expect(new ProgressService(repository).getDashboard('2026-07-22').answered).toBe(1);
  });
  it('counts wrong answers and retains history after mastery', () => {
    const { service } = createService();
    service.recordAnswer({ questionId: 'Q1', correct: false, durationMs: 800, at: '2026-07-22' });
    service.recordAnswer({ questionId: 'Q1', correct: false, durationMs: 600, at: '2026-07-22' });

    expect(service.getWrongQuestion('Q1')).toMatchObject({ errorCount: 2, mastered: false });
    service.markMastered('Q1');
    expect(service.getWrongQuestion('Q1')).toMatchObject({ errorCount: 2, mastered: true });

    service.recordAnswer({ questionId: 'Q1', correct: false, durationMs: 500, at: '2026-07-23' });
    expect(service.getWrongQuestion('Q1')).toMatchObject({ errorCount: 3, mastered: false });
  });

  it('toggles favorites idempotently and persists them', () => {
    const { repository, service } = createService();

    expect(service.toggleFavorite('Q1', 1000)).toBe(true);
    expect(service.isFavorite('Q1')).toBe(true);
    expect(new ProgressService(repository).isFavorite('Q1')).toBe(true);
    expect(service.toggleFavorite('Q1', 2000)).toBe(false);
    expect(service.isFavorite('Q1')).toBe(false);
  });

  it('returns stable zero statistics and aggregates answers', () => {
    const { service } = createService();
    expect(service.getDashboard('2026-07-22')).toMatchObject({
      answered: 0,
      correct: 0,
      accuracy: 0,
      durationMs: 0,
      streakDays: 0,
      todayAnswered: 0,
    });

    service.recordAnswer({ questionId: 'Q1', correct: true, durationMs: 800, at: '2026-07-22' });
    service.recordAnswer({ questionId: 'Q2', correct: false, durationMs: 200, at: '2026-07-22' });

    expect(service.getDashboard('2026-07-22')).toMatchObject({
      answered: 2,
      correct: 1,
      accuracy: 50,
      durationMs: 1000,
      todayAnswered: 2,
    });
  });

  it('lists the most recently answered question IDs without duplicate positions', () => {
    const { service } = createService();
    service.recordAnswer({ questionId: 'Q1', correct: true, durationMs: 10, at: '2026-07-20' });
    service.recordAnswer({ questionId: 'Q2', correct: false, durationMs: 10, at: '2026-07-21' });
    service.recordAnswer({ questionId: 'Q1', correct: false, durationMs: 10, at: '2026-07-22' });
    service.recordAnswer({ questionId: 'Q3', correct: true, durationMs: 10, at: '2026-07-23' });

    expect(service.listRecentQuestionIds(3)).toEqual(['Q3', 'Q1', 'Q2']);
  });

  it('returns no recent question IDs when the requested limit is zero', () => {
    const { service } = createService();
    service.recordAnswer({ questionId: 'Q1', correct: true, durationMs: 10, at: '2026-07-20' });

    expect(service.listRecentQuestionIds(0)).toEqual([]);
  });

  it('derives preparation days from answer history and starts untouched users at day one', () => {
    const { service } = createService();
    expect(service.getPreparationDays('2026-07-22')).toBe(1);

    service.recordAnswer({ questionId: 'Q1', correct: true, durationMs: 10, at: '2026-07-20' });
    service.recordAnswer({ questionId: 'Q2', correct: true, durationMs: 10, at: '2026-07-22' });

    expect(service.getPreparationDays('2026-07-22')).toBe(3);
  });

  it('summarizes unique completion, attempt accuracy and active wrong questions by ID', () => {
    const { repository } = createService();
    const service = new ProgressService(repository);
    service.recordAnswer({
      questionId: 'Q1',
      correct: false,
      durationMs: 10,
      at: '2026-07-23',
    });
    service.recordAnswer({
      questionId: 'Q1',
      correct: true,
      durationMs: 10,
      at: '2026-07-23',
    });
    service.recordAnswer({
      questionId: 'Q2',
      correct: true,
      durationMs: 10,
      at: '2026-07-23',
    });

    expect(service.getQuestionProgress(['Q1', 'Q2', 'Q3'])).toEqual({
      completed: 2,
      attempts: 3,
      correctAttempts: 2,
      wrongQuestions: 1,
    });
  });

  it('calculates a consecutive streak across a month boundary', () => {
    const { service } = createService();
    service.recordAnswer({ questionId: 'Q1', correct: true, durationMs: 10, at: '2026-01-31' });
    service.recordAnswer({ questionId: 'Q2', correct: true, durationMs: 10, at: '2026-02-01' });
    service.recordAnswer({ questionId: 'Q3', correct: true, durationMs: 10, at: '2026-02-02' });

    expect(service.getDashboard('2026-02-02').streakDays).toBe(3);
    expect(service.getDashboard('2026-02-03').streakDays).toBe(3);
    expect(service.getDashboard('2026-02-04').streakDays).toBe(0);
    expect(service.getActivity('2026-02-02', 3).map((day) => day.date)).toEqual([
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
  });

  it('records a submitted practice session exactly once', () => {
    const { repository, service } = createService();
    const records = [
      { questionId: 'Q1', correct: true, durationMs: 500, at: '2026-07-22' },
      { questionId: 'Q2', correct: false, durationMs: 500, at: '2026-07-22' },
    ];

    expect(service.recordPracticeResults('session-1', records)).toBe(true);
    expect(service.recordPracticeResults('session-1', records)).toBe(false);
    expect(new ProgressService(repository).getDashboard('2026-07-22')).toMatchObject({
      answered: 2,
      correct: 1,
    });
  });

  it('saves and restores an unfinished session', () => {
    const { repository, service } = createService();
    const session: PersistedPracticeSession = {
      id: 'session-1',
      mode: 'random',
      answerRevealMode: 'immediate',
      questionIds: ['Q1'],
      currentIndex: 0,
      answers: { Q1: ['A'] },
      status: 'active',
      startedAt: 1000,
      updatedAt: 1200,
    };

    service.saveSession(session);

    expect(new ProgressService(repository).restoreSession()).toEqual(session);
  });

  it('forces persisted mock sessions to deferred reveal at the service write boundary', () => {
    const { repository, service } = createService();
    const session: PersistedPracticeSession = {
      id: 'session-mock',
      mode: 'mock',
      answerRevealMode: 'immediate',
      questionIds: ['Q1'],
      currentIndex: 0,
      answers: {},
      status: 'active',
      startedAt: 1000,
      updatedAt: 1200,
    };

    service.saveSession(session);

    expect(new ProgressService(repository).restoreSession()?.answerRevealMode).toBe('deferred');
  });

  it('reloads a serialized current session without recovering or losing learning data', () => {
    const storage = new MemoryStorageAdapter();
    const repository = new ProgressRepository(storage);
    const service = new ProgressService(repository);
    service.recordAnswer({
      questionId: 'Q1',
      correct: true,
      durationMs: 500,
      at: '2026-07-25',
    });
    service.toggleFavorite('Q1', 1000);
    const session = createPracticeSession([makeQuestion({ id: 'Q1' })], {
      mode: 'mock',
      now: 1200,
    });
    service.saveSession(serializePracticeSession(session));

    const reloaded = new ProgressService(repository);

    expect(reloaded.consumeRecoveryNotice()).toBeNull();
    expect(reloaded.getDashboard('2026-07-25').answered).toBe(1);
    expect(reloaded.isFavorite('Q1')).toBe(true);
    expect(reloaded.restoreSession()).toMatchObject({
      id: session.id,
      status: 'active',
      answerRevealMode: 'deferred',
    });
    expect(storage.get(RECOVERY_BACKUP_KEY)).toBeNull();
  });

  it('persists profile and study preference updates across service instances', () => {
    const { repository, service } = createService();

    service.updatePreferences({
      nickname: '麦穗',
      avatarUrl: '/assets/avatars/granary.svg',
    });
    service.updatePreferences({ dailyGoal: 30 });

    expect(new ProgressService(repository).getPreferences()).toEqual({
      ...createEmptyProgress().preferences,
      nickname: '麦穗',
      avatarUrl: '/assets/avatars/granary.svg',
      dailyGoal: 30,
    });
  });

  it('preserves the answer reveal preference when clearing learning data', () => {
    const { service } = createService();

    service.updatePreferences({ answerRevealMode: 'deferred' });
    expect(service.getPreferences().answerRevealMode).toBe('deferred');

    service.clearLearningData();

    expect(service.getPreferences().answerRevealMode).toBe('deferred');
  });

  it('clears learning data but preserves preferences and other storage', () => {
    const { storage, repository, service } = createService();
    storage.set('unrelated:key', { keep: true });
    service.updatePreferences({
      selectedCertificateKey: '4-08-05-01:3',
      dailyGoal: 30,
      answerTheme: 'night',
      nickname: '麦穗',
      avatarUrl: 'https://example.com/avatar.png',
      answerRevealMode: 'immediate',
    });
    service.recordAnswer({ questionId: 'Q1', correct: false, durationMs: 10, at: '2026-07-22' });

    service.clearLearningData();

    expect(service.getDashboard('2026-07-22').answered).toBe(0);
    expect(service.getPreferences()).toEqual({
      selectedCertificateKey: '4-08-05-01:3',
      dailyGoal: 30,
      answerTheme: 'night',
      nickname: '麦穗',
      avatarUrl: 'https://example.com/avatar.png',
      answerRevealMode: 'immediate',
    });
    expect(storage.get('unrelated:key')).toEqual({ keep: true });
    expect(storage.get(STORAGE_KEY)).not.toBeNull();
    expect(new ProgressService(repository).getDashboard('2026-07-22').answered).toBe(0);
  });

  it('backs up damaged storage and exposes a one-time recovery notice', () => {
    const storage = new MemoryStorageAdapter();
    storage.set(STORAGE_KEY, {
      ...createEmptyProgress(),
      preferences: { selectedCertificateKey: 'invalid', dailyGoal: 0 },
    });
    const service = new ProgressService(new ProgressRepository(storage, () => 1234));

    expect(service.consumeRecoveryNotice()).toMatch(/备份/);
    expect(service.consumeRecoveryNotice()).toBeNull();
    expect(storage.get(RECOVERY_BACKUP_KEY)).toMatchObject({
      capturedAt: 1234,
      reason: 'invalid learning data',
    });
    expect(storage.get(STORAGE_KEY)).toEqual(createEmptyProgress());
    expect(service.getPreferences()).toEqual(createEmptyProgress().preferences);
  });

  it('backs up a future schema and starts with safe data instead of crashing', () => {
    const storage = new MemoryStorageAdapter();
    const futureData = {
      ...createEmptyProgress(),
      schemaVersion: 5,
      futureOnlyField: { keep: 'verbatim' },
    };
    storage.set(STORAGE_KEY, futureData);

    const service = new ProgressService(new ProgressRepository(storage, () => 5678));

    expect(service.consumeRecoveryNotice()).toMatch(/备份/);
    expect(storage.get(RECOVERY_BACKUP_KEY)).toEqual({
      capturedAt: 5678,
      reason: 'unsupported learning data schema version 5',
      value: futureData,
    });
    expect(storage.get(STORAGE_KEY)).toEqual(createEmptyProgress());
    expect(service.getPreferences()).toEqual(createEmptyProgress().preferences);
  });

  it('persists a normal version-one migration without creating a recovery backup', () => {
    const storage = new MemoryStorageAdapter();
    storage.set(STORAGE_KEY, {
      schemaVersion: 1,
      answers: [],
      wrongQuestions: {},
      favorites: {},
      session: null,
      dailyTotals: {},
      recordedSessionIds: [],
      preferences: {
        selectedCertificateKey: '4-08-05-01:3',
        dailyGoal: 30,
      },
    });

    const service = new ProgressService(new ProgressRepository(storage));

    expect(service.getPreferences()).toEqual({
      selectedCertificateKey: '4-08-05-01:3',
      dailyGoal: 30,
      answerTheme: 'light',
      nickname: '仓廪小麦',
      avatarUrl: '',
      answerRevealMode: 'immediate',
    });
    expect(storage.get(STORAGE_KEY)).toMatchObject({
      schemaVersion: 4,
      preferences: service.getPreferences(),
    });
    expect(storage.get(RECOVERY_BACKUP_KEY)).toBeNull();
  });
});
