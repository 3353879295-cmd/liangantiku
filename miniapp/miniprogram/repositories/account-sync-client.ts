import { isProgressDataV4 } from '../storage/migrations';
import {
  ACCOUNT_SYNC_SCHEMA_VERSION,
  type AccountProfileSnapshot,
  type AccountSyncErrorCode,
  type AccountSyncRequest,
  type AccountSyncSnapshot,
  type DeleteAccountResult,
} from '../types/account-sync';

export type { AccountSyncRequest } from '../types/account-sync';

export interface AccountSyncCallOptions {
  name: 'accountSync';
  data: AccountSyncRequest;
}

export type AccountSyncTransport = (
  options: AccountSyncCallOptions,
) => Promise<{ result: unknown }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && typeof value === 'number' && value >= 0;

const isProfile = (value: unknown): value is AccountProfileSnapshot =>
  isRecord(value) &&
  typeof value.nickname === 'string' &&
  typeof value.avatarUrl === 'string' &&
  typeof value.selectedCertificateKey === 'string' &&
  Number.isInteger(value.dailyGoal) &&
  Number(value.dailyGoal) > 0 &&
  (value.answerTheme === 'light' || value.answerTheme === 'night') &&
  (value.answerRevealMode === 'immediate' || value.answerRevealMode === 'deferred');

const isSnapshot = (value: unknown): value is AccountSyncSnapshot =>
  isRecord(value) &&
  value.schemaVersion === ACCOUNT_SYNC_SCHEMA_VERSION &&
  isNonNegativeInteger(value.profileRevision) &&
  isNonNegativeInteger(value.progressRevision) &&
  typeof value.syncedAt === 'string' &&
  isProfile(value.profile) &&
  isProgressDataV4(value.progress);

const DELETE_STAGES = new Set(['marking', 'records', 'progress', 'account', 'done']);
const ERROR_CODES = new Set<AccountSyncErrorCode>([
  'INVALID_REQUEST',
  'REVISION_CONFLICT',
  'SCHEMA_INCOMPATIBLE',
  'ACCOUNT_DELETING',
  'ACCOUNT_SYNC_UNAVAILABLE',
]);

const ERROR_MESSAGES: Record<AccountSyncErrorCode, string> = {
  INVALID_REQUEST: '同步请求无效，请重试。',
  REVISION_CONFLICT: '数据已在其他设备更新，正在恢复云端记录。',
  SCHEMA_INCOMPATIBLE: '云端学习记录格式不兼容，请更新小程序后重试。',
  ACCOUNT_DELETING: '账号正在注销，暂时无法保存新的学习数据。',
  ACCOUNT_SYNC_UNAVAILABLE: '云端学习同步暂不可用，请稍后重试。',
};

const isDeleteAccountResult = (value: unknown): value is DeleteAccountResult =>
  isRecord(value) &&
  value.schemaVersion === ACCOUNT_SYNC_SCHEMA_VERSION &&
  typeof value.done === 'boolean' &&
  typeof value.stage === 'string' &&
  DELETE_STAGES.has(value.stage) &&
  (value.done ? value.stage === 'done' : value.stage !== 'done');

const readBusinessErrorCode = (value: unknown): AccountSyncErrorCode | null => {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) return null;
  const code = value.error.code;
  return typeof code === 'string' && ERROR_CODES.has(code as AccountSyncErrorCode)
    ? (code as AccountSyncErrorCode)
    : null;
};

const readSuccessData = (value: unknown): unknown =>
  isRecord(value) && value.ok === true && Object.hasOwn(value, 'data') ? value.data : undefined;

export class AccountSyncClientError extends Error {
  constructor(
    readonly code: AccountSyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AccountSyncClientError';
  }
}

export class AccountSyncClient {
  constructor(
    private readonly callFunction: AccountSyncTransport = (options) =>
      wx.cloud.callFunction(options),
  ) {}

  async call(
    request: Extract<AccountSyncRequest, { action: 'deleteAccount' }>,
  ): Promise<DeleteAccountResult>;
  async call(
    request: Exclude<AccountSyncRequest, { action: 'deleteAccount' }>,
  ): Promise<AccountSyncSnapshot>;
  async call(request: AccountSyncRequest): Promise<AccountSyncSnapshot | DeleteAccountResult> {
    try {
      const response = await this.callFunction({ name: 'accountSync', data: request });
      const errorCode = readBusinessErrorCode(response.result);
      if (errorCode) throw new AccountSyncClientError(errorCode, ERROR_MESSAGES[errorCode]);
      const data = readSuccessData(response.result);
      if (request.action === 'deleteAccount' && isDeleteAccountResult(data)) return data;
      if (request.action !== 'deleteAccount' && isSnapshot(data)) return data;
      throw new AccountSyncClientError('SCHEMA_INCOMPATIBLE', ERROR_MESSAGES.SCHEMA_INCOMPATIBLE);
    } catch (error) {
      if (error instanceof AccountSyncClientError) throw error;
      throw new AccountSyncClientError(
        'ACCOUNT_SYNC_UNAVAILABLE',
        ERROR_MESSAGES.ACCOUNT_SYNC_UNAVAILABLE,
      );
    }
  }
}
