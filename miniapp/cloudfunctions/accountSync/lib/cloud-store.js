const defaultDiagnosticLogger = require('node:console');

const DIAGNOSTIC_REVISION = 'account-sync-store-progress-replacement-20260908-v1';
const SAFE_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError']);
const SAFE_ENUM_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const safeErrorMetadata = (error) => {
  const metadata = { name: 'UnknownError' };
  if (!error || typeof error !== 'object') return metadata;

  try {
    if (SAFE_ERROR_NAMES.has(error.name)) metadata.name = error.name;

    for (const key of ['errCode', 'code']) {
      const value = error[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        metadata[key] = value;
        break;
      }
      if (typeof value === 'string' && SAFE_ENUM_CODE.test(value)) {
        metadata[key] = value;
        break;
      }
    }
  } catch {
    // Error metadata is diagnostic-only and may be supplied by a throwing getter.
    return metadata;
  }
  return metadata;
};

const safeUpdateMetadata = (result) => {
  const metadata = {};
  if (!result || typeof result !== 'object') return metadata;
  try {
    if (typeof result.updated === 'number' && Number.isFinite(result.updated)) {
      metadata.updated = result.updated;
    }
    if (typeof result.requestId === 'string' && UUID.test(result.requestId)) {
      metadata.sdkRequestId = result.requestId;
    }
  } catch {
    // SDK response metadata is diagnostic-only and may be supplied by a throwing getter.
    return metadata;
  }
  return metadata;
};

const emitDiagnostic = (logger, event, metadata = {}) => {
  try {
    if (logger && typeof logger.info === 'function') {
      logger.info('[accountSync] store diagnostic', {
        revision: DIAGNOSTIC_REVISION,
        event,
        ...metadata,
      });
    }
  } catch {
    // Diagnostics must not affect the cloud function's business result.
    return undefined;
  }
};

class CloudStore {
  constructor(
    database,
    serverDate = () => database.serverDate(),
    diagnosticLogger = defaultDiagnosticLogger,
    transactionAttempt,
  ) {
    this.database = database;
    this.serverDate = serverDate;
    this.diagnosticLogger = diagnosticLogger;
    this.transactionAttempt = transactionAttempt;
  }

  async transaction(work) {
    let attempts = 0;
    let latestAttempt;
    emitDiagnostic(this.diagnosticLogger, 'transaction.started');
    try {
      const result = await this.database.runTransaction(async (transaction) => {
        const attempt = { number: ++attempts, stage: 'callback_started' };
        latestAttempt = attempt;
        emitDiagnostic(this.diagnosticLogger, 'transaction.attempt_started', {
          attempt: attempt.number,
        });
        try {
          const callbackResult = await work(
            new CloudStore(transaction, this.serverDate, this.diagnosticLogger, attempt),
          );
          attempt.stage = 'callback_completed';
          emitDiagnostic(this.diagnosticLogger, 'transaction.callback_completed', {
            attempt: attempt.number,
          });
          return callbackResult;
        } catch (error) {
          attempt.stage = 'callback_failed';
          emitDiagnostic(this.diagnosticLogger, 'transaction.callback_failed', {
            attempt: attempt.number,
            ...safeErrorMetadata(error),
          });
          throw error;
        }
      });
      emitDiagnostic(this.diagnosticLogger, 'transaction.committed', { attempts });
      return result && typeof result === 'object' && Object.hasOwn(result, 'result')
        ? result.result
        : result;
    } catch (error) {
      emitDiagnostic(this.diagnosticLogger, 'transaction.failed', {
        attempts,
        phase:
          attempts === 0
            ? 'start'
            : latestAttempt && latestAttempt.stage === 'callback_completed'
              ? 'commit'
              : 'callback',
        ...safeErrorMetadata(error),
      });
      throw error;
    }
  }

  async getAccount(id) {
    const result = await this.database.collection('user_accounts').doc(id).get();
    return CloudStore.withoutDocumentId(result.data);
  }

  async getProgress(id) {
    const result = await this.database.collection('user_progress').doc(id).get();
    return CloudStore.withoutDocumentId(result.data);
  }

  static withoutDocumentId(data) {
    if (!data) {
      return null;
    }
    const value = { ...data };
    delete value._id;
    return value;
  }

  async createAccount(id, value) {
    const now = this.serverDate();
    await this.database
      .collection('user_accounts')
      .doc(id)
      .set({
        data: { ...value, created_at: now, updated_at: now },
      });
  }

  async createProgress(id, value) {
    const now = this.serverDate();
    await this.database
      .collection('user_progress')
      .doc(id)
      .set({
        data: { ...value, created_at: now, updated_at: now },
      });
  }

  async saveAccount(id, value) {
    await this.database
      .collection('user_accounts')
      .doc(id)
      .update({
        data: { ...CloudStore.withoutDocumentId(value), updated_at: this.serverDate() },
      });
  }

  async saveProgress(id, value) {
    const attempt = this.transactionAttempt;
    if (attempt) attempt.stage = 'progress_update_started';
    emitDiagnostic(this.diagnosticLogger, 'progress_update.started', {
      ...(attempt ? { attempt: attempt.number } : {}),
    });
    try {
      const result = await this.database
        .collection('user_progress')
        .doc(id)
        .set({
          data: { ...CloudStore.withoutDocumentId(value), updated_at: this.serverDate() },
        });
      if (attempt) attempt.stage = 'progress_update_completed';
      emitDiagnostic(this.diagnosticLogger, 'progress_update.completed', {
        ...(attempt ? { attempt: attempt.number } : {}),
        ...safeUpdateMetadata(result),
      });
    } catch (error) {
      if (attempt) attempt.stage = 'progress_update_failed';
      emitDiagnostic(this.diagnosticLogger, 'progress_update.failed', {
        ...(attempt ? { attempt: attempt.number } : {}),
        ...safeErrorMetadata(error),
      });
      throw error;
    }
  }

  async getRecord(id) {
    const result = await this.database.collection('user_practice_records').doc(id).get();
    return CloudStore.withoutDocumentId(result.data);
  }

  async createRecord(id, value) {
    await this.database
      .collection('user_practice_records')
      .doc(id)
      .set({ data: { ...value, submitted_at: this.serverDate() } });
  }

  async listRecordIdsForAccount(accountKey) {
    const result = await this.database
      .collection('user_practice_records')
      .where({ account_key: accountKey })
      .orderBy('submitted_at', 'asc')
      .limit(50)
      .get();
    return (result.data || []).map((record) => record._id);
  }

  async removeRecords(ids) {
    await Promise.all(
      ids.map((id) => this.database.collection('user_practice_records').doc(id).remove()),
    );
  }

  async removeProgress(id) {
    await this.database.collection('user_progress').doc(id).remove();
  }

  async removeAccount(id) {
    await this.database.collection('user_accounts').doc(id).remove();
  }
}

module.exports = { CloudStore };
