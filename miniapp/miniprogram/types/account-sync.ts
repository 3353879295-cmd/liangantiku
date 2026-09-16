import type { CurrentProgressData } from '../storage/migrations';
import type { AnswerRevealMode, AnswerTheme, CertificateKey, PracticeMode } from './domain';

export type ProgressScope = 'guest' | 'account';

export type AccountProgressSnapshot = CurrentProgressData;

export const ACCOUNT_SYNC_SCHEMA_VERSION = 1 as const;

export interface AccountProfileSnapshot {
  nickname: string;
  avatarUrl: string;
  selectedCertificateKey: CertificateKey;
  dailyGoal: number;
  answerTheme: AnswerTheme;
  answerRevealMode: AnswerRevealMode;
}

export interface AccountSyncSnapshot {
  schemaVersion: typeof ACCOUNT_SYNC_SCHEMA_VERSION;
  /** Empty disables uploads. */
  avatarUploadPathPrefix: string;
  profileRevision: number;
  progressRevision: number;
  syncedAt: string;
  profile: AccountProfileSnapshot;
  progress: AccountProgressSnapshot;
}

/** The only value stored under grain-practice:account-cache. */
export interface AccountCacheEnvelope extends AccountSyncSnapshot {
  /** Kept explicit so future cache formats can evolve independently from the cloud schema. */
  cacheVersion: 1;
}

interface AccountSyncRequestBase {
  schemaVersion: typeof ACCOUNT_SYNC_SCHEMA_VERSION;
}

export type AccountSyncRequest =
  | (AccountSyncRequestBase & { action: 'bootstrap' })
  | (AccountSyncRequestBase & {
      action: 'updateProfile';
      expectedRevision: number;
      nickname: string;
      avatarUrl: string;
    })
  | (AccountSyncRequestBase & {
      action: 'updatePreferences';
      expectedRevision: number;
      selectedCertificateKey: CertificateKey;
      dailyGoal: number;
      answerTheme: AnswerTheme;
      answerRevealMode: AnswerRevealMode;
    })
  | (AccountSyncRequestBase & {
      action: 'saveActiveSession';
      expectedRevision: number;
      session: AccountProgressSnapshot['session'];
    })
  | (AccountSyncRequestBase & {
      action: 'recordPractice';
      expectedRevision: number;
      sessionId: string;
      mode: PracticeMode;
      answers: readonly { questionId: string; correct: boolean; durationMs: number; at: string }[];
    })
  | (AccountSyncRequestBase & {
      action: 'setFavorite';
      expectedRevision: number;
      questionId: string;
      favorite: boolean;
    })
  | (AccountSyncRequestBase & {
      action: 'markMastered';
      expectedRevision: number;
      questionId: string;
      mastered: boolean;
    })
  | (AccountSyncRequestBase & { action: 'clearLearningData' })
  | (AccountSyncRequestBase & { action: 'deleteAccount' });

export type AccountSyncErrorCode =
  | 'INVALID_REQUEST'
  | 'REVISION_CONFLICT'
  | 'SCHEMA_INCOMPATIBLE'
  | 'ACCOUNT_DELETING'
  | 'ACCOUNT_SYNC_UNAVAILABLE';

export type DeleteAccountStage = 'marking' | 'records' | 'progress' | 'account' | 'done';

export interface DeleteAccountResult {
  schemaVersion: typeof ACCOUNT_SYNC_SCHEMA_VERSION;
  done: boolean;
  stage: DeleteAccountStage;
}

export type AccountSyncSuccessData = AccountSyncSnapshot | DeleteAccountResult;

export type AccountSyncResponse =
  | { ok: true; data: AccountSyncSuccessData }
  | { ok: false; error: { code: AccountSyncErrorCode; message?: string } };

export type SyncCommandAction = Exclude<
  AccountSyncRequest['action'],
  'bootstrap' | 'deleteAccount' | 'clearLearningData'
>;

type OmitCommandMetadata<T> = T extends { expectedRevision: number }
  ? Omit<T, 'schemaVersion' | 'expectedRevision'>
  : never;

export type AccountSyncCommandInput = OmitCommandMetadata<
  Exclude<AccountSyncRequest, { action: 'bootstrap' | 'deleteAccount' | 'clearLearningData' }>
>;

export type SyncRevisionDomain = 'profile' | 'progress';

export type SyncCommand = Extract<AccountSyncRequest, { action: SyncCommandAction }> & {
  id: string;
  createdAt: number;
  /** A command is immutable after it has started being sent. */
  state: 'pending' | 'sending';
};

export interface AccountOutboxState {
  schemaVersion: 1;
  commands: SyncCommand[];
  blocked?: boolean;
}

export type AccountSyncStatus = 'idle' | 'syncing' | 'pending' | 'failed' | 'conflict';

export interface AccountSyncState {
  status: AccountSyncStatus;
  pendingCount: number;
  notice: string | null;
}
