import { QUESTION_RECORDS } from '../data/question-bank';
import { LocalQuestionRepository } from '../repositories/local-question-repository';
import { AccountSyncClient } from '../repositories/account-sync-client';
import { ProgressRepository } from '../storage/progress-repository';
import { WechatStorageAdapter } from '../storage/storage-adapter';
import { SyncOutbox } from '../storage/sync-outbox';
import { ACCOUNT_CLEAR_PENDING_KEY, AuthService, readAuthPreference } from './auth-service';
import { CloudSyncService } from './cloud-sync-service';
import { ProgressService } from './progress-service';
import { ThemeService } from './theme-service';

const storage = new WechatStorageAdapter();
const progressRepository = new ProgressRepository(storage);
const progress = new ProgressService(
  progressRepository,
  readAuthPreference(storage) === 'account' ? 'account' : 'guest',
);
const syncOutbox = new SyncOutbox(storage);
const accountSyncClient = new AccountSyncClient();
const cloudSync = new CloudSyncService(accountSyncClient, progressRepository, syncOutbox, {
  getScope: () => progress.getScope(),
  isClearPending: () => storage.get<unknown>(ACCOUNT_CLEAR_PENDING_KEY) === true,
});
progress.setAccountMutationListener((command) => {
  if (!cloudSync.enqueue(command)) return;
  void cloudSync.process().then(() => {
    if (progress.getScope() === 'account') progress.refreshAccountSnapshot();
  });
});
const auth = new AuthService(
  storage,
  progress,
  progressRepository,
  syncOutbox,
  cloudSync,
  accountSyncClient,
);

export const appServices = {
  progress,
  theme: new ThemeService(progress),
  questions: new LocalQuestionRepository(QUESTION_RECORDS),
  auth,
  cloudSync,
};

export const localDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};
