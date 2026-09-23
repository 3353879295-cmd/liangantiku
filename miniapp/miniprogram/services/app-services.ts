import { QUESTION_BANK } from '../data/question-bank';
import { LocalQuestionRepository } from '../repositories/local-question-repository';
import { AccountSyncClient } from '../repositories/account-sync-client';
import { ProgressRepository } from '../storage/progress-repository';
import { WechatStorageAdapter } from '../storage/storage-adapter';
import { SyncOutbox } from '../storage/sync-outbox';
import { AuthService, hasPendingLearningClear, readAuthPreference } from './auth-service';
import { CloudSyncService } from './cloud-sync-service';
import { ProgressService } from './progress-service';
import { ThemeService } from './theme-service';
import { WechatAvatarService } from './wechat-avatar-service';
import { MembershipService } from './membership-service';

const storage = new WechatStorageAdapter();
const authPreference = readAuthPreference(storage);
const progressRepository = new ProgressRepository(storage);
const progress = new ProgressService(progressRepository, 'guest');
const syncOutbox = new SyncOutbox(storage);
const accountSyncClient = new AccountSyncClient();
const wechatAvatar = new WechatAvatarService(undefined, undefined, storage);
const cloudSync = new CloudSyncService(accountSyncClient, progressRepository, syncOutbox, {
  getScope: () => progress.getScope(),
  isClearPending: () =>
    hasPendingLearningClear(
      storage,
      progressRepository.loadAccountCache()?.avatarUploadPathPrefix ?? null,
    ),
  onAccountVerified: () => {
    progress.switchScope('account');
    auth.refreshFromCache();
  },
});
progress.setAccountMutationListener((command) => {
  if (!cloudSync.enqueue(command)) return;
  void cloudSync.process().then(() => {
    auth.refreshFromCache();
  });
});
const auth = new AuthService(
  storage,
  progress,
  progressRepository,
  syncOutbox,
  cloudSync,
  accountSyncClient,
  undefined,
  wechatAvatar,
  authPreference,
);

export const appServices = {
  progress,
  theme: new ThemeService(progress),
  questions: new LocalQuestionRepository(QUESTION_BANK),
  auth,
  cloudSync,
  wechatAvatar,
  membership: new MembershipService(),
};

export const localDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};
