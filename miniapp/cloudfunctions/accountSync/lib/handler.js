const { AccountSyncError, toErrorResponse } = require('./errors');
const { Buffer } = require('node:buffer');
const { createHash } = require('node:crypto');
const {
  validateEvent,
  validateProfile,
  validatePreferences,
  validateQuestionState,
  validateSession,
  validatePractice,
  isCloudAvatarFileID,
} = require('./validation');

const MAX_SNAPSHOT_RESPONSE_BYTES = 900 * 1024;

const emptyAccount = () => ({
  schema_version: 1,
  status: 'active',
  learning_clear_state: 'idle',
  revision: 0,
  nickname: '仓廪小麦',
  avatar_url: '',
  avatar_file_ids: [],
  selected_certificate_key: '4-02-06-01:5',
  daily_goal: 20,
  answer_theme: 'light',
  answer_reveal_mode: 'immediate',
});

const emptyProgress = () => ({
  schema_version: 1,
  revision: 0,
  summary: { answered: 0, correct: 0, duration_ms: 0, first_answered_at: null },
  question_totals: {},
  wrong_questions: {},
  favorites: {},
  daily_totals: {},
  recent_question_ids: [],
  active_session: null,
});

const createPracticeRecordId = (accountKey, sessionId) =>
  `record_${createHash('sha256').update(`${accountKey}:${sessionId}`).digest('hex')}`;

const fromStoredSession = (session) =>
  session && {
    id: session.id,
    mode: session.mode,
    questionIds: session.question_ids,
    currentIndex: session.current_index,
    answers: session.answers,
    status: session.status,
    startedAt: session.started_at,
    updatedAt: session.updated_at,
    ...(session.submitted_at === undefined ? {} : { submittedAt: session.submitted_at }),
    ...(session.progress_recorded === undefined
      ? {}
      : { progressRecorded: session.progress_recorded }),
    answerRevealMode: session.answer_reveal_mode,
  };

const toStoredSession = (session) =>
  session && {
    id: session.id,
    mode: session.mode,
    question_ids: session.questionIds,
    current_index: session.currentIndex,
    answers: session.answers,
    status: session.status,
    started_at: session.startedAt,
    updated_at: session.updatedAt,
    ...(session.submittedAt === undefined ? {} : { submitted_at: session.submittedAt }),
    ...(session.progressRecorded === undefined
      ? {}
      : { progress_recorded: session.progressRecorded }),
    answer_reveal_mode: session.answerRevealMode,
  };

const fromStoredWrongQuestions = (records) =>
  Object.fromEntries(
    Object.entries(records).map(([questionId, record]) => [
      questionId,
      {
        questionId: record.question_id,
        errorCount: record.error_count,
        firstWrongAt: record.first_wrong_at,
        lastWrongAt: record.last_wrong_at,
        mastered: record.mastered,
        lastRetryCorrect: record.last_retry_correct,
      },
    ]),
  );

const camelCaseTotals = (totals) =>
  Object.fromEntries(
    Object.entries(totals).map(([questionId, total]) => [
      questionId,
      { attempts: total.attempts, correctAttempts: total.correct_attempts },
    ]),
  );

const camelCaseDailyTotals = (totals) =>
  Object.fromEntries(
    Object.entries(totals).map(([date, total]) => [
      date,
      { answered: total.answered, correct: total.correct, durationMs: total.duration_ms },
    ]),
  );

const toSnapshot = (account, progress, accountKey, now) => ({
  schemaVersion: 1,
  avatarUploadPathPrefix: `account-avatars/${accountKey}`,
  profileRevision: account.revision,
  progressRevision: progress.revision,
  syncedAt: now(),
  profile: {
    nickname: account.nickname,
    avatarUrl: account.avatar_url,
    selectedCertificateKey: account.selected_certificate_key,
    dailyGoal: account.daily_goal,
    answerTheme: account.answer_theme,
    answerRevealMode: account.answer_reveal_mode,
  },
  progress: {
    schemaVersion: 4,
    summary: {
      answered: progress.summary.answered,
      correct: progress.summary.correct,
      durationMs: progress.summary.duration_ms,
      firstAnsweredAt: progress.summary.first_answered_at,
    },
    questionTotals: camelCaseTotals(progress.question_totals),
    wrongQuestions: fromStoredWrongQuestions(progress.wrong_questions),
    favorites: progress.favorites,
    session: fromStoredSession(progress.active_session),
    dailyTotals: camelCaseDailyTotals(progress.daily_totals),
    recentQuestionIds: progress.recent_question_ids,
    recordedSessionIds: [],
    preferences: {
      nickname: account.nickname,
      avatarUrl: account.avatar_url,
      selectedCertificateKey: account.selected_certificate_key,
      dailyGoal: account.daily_goal,
      answerTheme: account.answer_theme,
      answerRevealMode: account.answer_reveal_mode,
    },
  },
});

const snapshotResponse = (account, progress, accountKey, now) => {
  const response = { ok: true, data: toSnapshot(account, progress, accountKey, now) };
  if (Buffer.byteLength(JSON.stringify(response), 'utf8') > MAX_SNAPSHOT_RESPONSE_BYTES) {
    throw new AccountSyncError('ACCOUNT_SYNC_UNAVAILABLE');
  }
  return response;
};

const accountAvatarFileIDs = (account, accountKey) =>
  [
    ...new Set([
      ...(Array.isArray(account.avatar_file_ids) ? account.avatar_file_ids : []),
      account.avatar_url,
    ]),
  ].filter((fileID) => isCloudAvatarFileID(fileID, accountKey));

const deleteStatusesSucceeded = (requestedFileIDs, files) =>
  Array.isArray(files) &&
  files.length === requestedFileIDs.length &&
  files.every(
    (file, index) =>
      file &&
      file.fileID === requestedFileIDs[index] &&
      (file.status === 0 || file.status === -503003),
  );

const createHandler =
  ({
    store,
    hash,
    now = () => new Date().toISOString(),
    deleteFiles = async () => [],
    inTransaction = false,
  }) =>
  async (event, context) => {
    if (!inTransaction && typeof store.transaction === 'function') {
      return store
        .transaction((transactionStore) =>
          createHandler({ store: transactionStore, hash, now, deleteFiles, inTransaction: true })(
            event,
            context,
          ),
        )
        .catch(toErrorResponse);
    }
    try {
      const request = validateEvent(event);
      if (
        !context ||
        !context.APPID ||
        !context.OPENID ||
        typeof context.APPID !== 'string' ||
        typeof context.OPENID !== 'string'
      ) {
        throw new AccountSyncError('INVALID_REQUEST');
      }
      const key = hash(context.APPID, context.OPENID);
      const accountId = `account_${key}`;
      const progressId = `progress_${key}`;
      let account = await store.getAccount(accountId);
      let progress = await store.getProgress(progressId);

      if (request.action === 'bootstrap') {
        if (!account) {
          account = emptyAccount();
          await store.createAccount(accountId, account);
        }
        if (!progress) {
          progress = emptyProgress();
          await store.createProgress(progressId, progress);
        }
        return snapshotResponse(account, progress, key, now);
      }
      if (request.action === 'deleteAccount') {
        if (!account) return { ok: true, data: { schemaVersion: 1, done: true, stage: 'done' } };
        if (account.status !== 'deleting') {
          await store.saveAccount(accountId, { ...account, status: 'deleting' });
          return { ok: true, data: { schemaVersion: 1, done: false, stage: 'records' } };
        }
        const recordIds = await store.listRecordIdsForAccount(key);
        if (recordIds.length > 0) {
          await store.removeRecords(recordIds);
          return { ok: true, data: { schemaVersion: 1, done: false, stage: 'records' } };
        }
        const avatarFileIDs = accountAvatarFileIDs(account, key);
        const batch = avatarFileIDs.slice(0, 50);
        if (batch.length > 0 && !deleteStatusesSucceeded(batch, await deleteFiles(batch))) {
          throw new AccountSyncError('ACCOUNT_SYNC_UNAVAILABLE');
        }
        if (batch.length > 0) {
          account = {
            ...account,
            avatar_file_ids: avatarFileIDs.slice(batch.length),
            avatar_url: '',
          };
          await store.saveAccount(accountId, account);
          if (account.avatar_file_ids.length > 0)
            return { ok: true, data: { schemaVersion: 1, done: false, stage: 'account' } };
        }
        if (progress) await store.removeProgress(progressId);
        await store.removeAccount(accountId);
        return { ok: true, data: { schemaVersion: 1, done: true, stage: 'done' } };
      }
      if (!account || !progress) throw new AccountSyncError('ACCOUNT_SYNC_UNAVAILABLE');
      if (request.action === 'clearLearningData') {
        if (account.status === 'deleting') throw new AccountSyncError('ACCOUNT_DELETING');
        if (account.learning_clear_state !== 'clearing') {
          await store.saveAccount(accountId, { ...account, learning_clear_state: 'clearing' });
          return { ok: false, error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' } };
        }
        const recordIds = await store.listRecordIdsForAccount(key);
        if (recordIds.length > 0) {
          await store.removeRecords(recordIds);
          if ((await store.listRecordIdsForAccount(key)).length > 0) {
            return { ok: false, error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' } };
          }
        }
        progress = { ...progress, ...emptyProgress() };
        await store.saveProgress(progressId, progress);
        account = { ...account, learning_clear_state: 'idle' };
        await store.saveAccount(accountId, account);
        return snapshotResponse(account, progress, key, now);
      }
      if (account.status === 'deleting') throw new AccountSyncError('ACCOUNT_DELETING');
      if (account.status !== 'active' || account.learning_clear_state !== 'idle') {
        throw new AccountSyncError('ACCOUNT_DELETING');
      }

      if (request.action === 'updateProfile') {
        validateProfile(request, key);
        const matches =
          account.nickname === request.nickname && account.avatar_url === request.avatarUrl;
        if (!matches && request.expectedRevision !== account.revision) {
          throw new AccountSyncError('REVISION_CONFLICT');
        }
        if (!matches) {
          account = {
            ...account,
            nickname: request.nickname,
            avatar_url: request.avatarUrl,
            avatar_file_ids: isCloudAvatarFileID(request.avatarUrl, key)
              ? [...new Set([...accountAvatarFileIDs(account, key), request.avatarUrl])]
              : accountAvatarFileIDs(account, key),
            revision: account.revision + 1,
          };
          await store.saveAccount(accountId, account);
        }
      } else if (request.action === 'updatePreferences') {
        validatePreferences(request);
        const matches =
          account.selected_certificate_key === request.selectedCertificateKey &&
          account.daily_goal === request.dailyGoal &&
          account.answer_theme === request.answerTheme &&
          account.answer_reveal_mode === request.answerRevealMode;
        if (!matches && request.expectedRevision !== account.revision)
          throw new AccountSyncError('REVISION_CONFLICT');
        if (!matches) {
          account = {
            ...account,
            selected_certificate_key: request.selectedCertificateKey,
            daily_goal: request.dailyGoal,
            answer_theme: request.answerTheme,
            answer_reveal_mode: request.answerRevealMode,
            revision: account.revision + 1,
          };
          await store.saveAccount(accountId, account);
        }
      } else if (request.action === 'saveActiveSession') {
        validateSession(request);
        const storedSession = toStoredSession(request.session);
        const matches = JSON.stringify(progress.active_session) === JSON.stringify(storedSession);
        if (!matches && request.expectedRevision !== progress.revision)
          throw new AccountSyncError('REVISION_CONFLICT');
        if (!matches) {
          progress = {
            ...progress,
            active_session: storedSession,
            revision: progress.revision + 1,
          };
          await store.saveProgress(progressId, progress);
        }
      } else if (request.action === 'setFavorite') {
        validateQuestionState(request, 'favorite');
        const current = Object.hasOwn(progress.favorites, request.questionId);
        if (current !== request.favorite && request.expectedRevision !== progress.revision) {
          throw new AccountSyncError('REVISION_CONFLICT');
        }
        if (current !== request.favorite) {
          const favorites = { ...progress.favorites };
          if (request.favorite) favorites[request.questionId] = Date.now();
          else delete favorites[request.questionId];
          progress = { ...progress, favorites, revision: progress.revision + 1 };
          await store.saveProgress(progressId, progress);
        }
      } else if (request.action === 'markMastered') {
        validateQuestionState(request, 'mastered');
        const record = progress.wrong_questions[request.questionId];
        if (!record) throw new AccountSyncError('INVALID_REQUEST');
        const matches = record.mastered === request.mastered;
        if (!matches && request.expectedRevision !== progress.revision)
          throw new AccountSyncError('REVISION_CONFLICT');
        if (!matches) {
          progress = {
            ...progress,
            wrong_questions: {
              ...progress.wrong_questions,
              [request.questionId]: {
                ...record,
                mastered: request.mastered,
                last_retry_correct: request.mastered,
              },
            },
            revision: progress.revision + 1,
          };
          await store.saveProgress(progressId, progress);
        }
      } else if (request.action === 'recordPractice') {
        validatePractice(request);
        const recordId = createPracticeRecordId(key, request.sessionId);
        if (!store.getRecord || !(await store.getRecord(recordId))) {
          if (request.expectedRevision !== progress.revision)
            throw new AccountSyncError('REVISION_CONFLICT');
          const summary = { ...progress.summary };
          const questionTotals = { ...progress.question_totals };
          const dailyTotals = { ...progress.daily_totals };
          const wrongQuestions = { ...progress.wrong_questions };
          let recentQuestionIds = [...progress.recent_question_ids];
          for (const answer of request.answers) {
            summary.answered += 1;
            summary.correct += answer.correct ? 1 : 0;
            summary.duration_ms += answer.durationMs;
            const total = questionTotals[answer.questionId] || { attempts: 0, correct_attempts: 0 };
            questionTotals[answer.questionId] = {
              attempts: total.attempts + 1,
              correct_attempts: total.correct_attempts + (answer.correct ? 1 : 0),
            };
            const day = dailyTotals[answer.at] || { answered: 0, correct: 0, duration_ms: 0 };
            dailyTotals[answer.at] = {
              answered: day.answered + 1,
              correct: day.correct + (answer.correct ? 1 : 0),
              duration_ms: day.duration_ms + answer.durationMs,
            };
            summary.first_answered_at =
              summary.first_answered_at === null || answer.at < summary.first_answered_at
                ? answer.at
                : summary.first_answered_at;
            const wrong = wrongQuestions[answer.questionId];
            if (!answer.correct) {
              wrongQuestions[answer.questionId] = wrong
                ? {
                    ...wrong,
                    error_count: wrong.error_count + 1,
                    last_wrong_at: answer.at,
                    mastered: false,
                    last_retry_correct: false,
                  }
                : {
                    question_id: answer.questionId,
                    error_count: 1,
                    first_wrong_at: answer.at,
                    last_wrong_at: answer.at,
                    mastered: false,
                    last_retry_correct: false,
                  };
            } else if (wrong) {
              wrongQuestions[answer.questionId] = { ...wrong, last_retry_correct: true };
            }
            recentQuestionIds = [
              answer.questionId,
              ...recentQuestionIds.filter((questionId) => questionId !== answer.questionId),
            ].slice(0, 100);
          }
          if (store.createRecord)
            await store.createRecord(recordId, {
              schema_version: 1,
              account_key: key,
              session_id: request.sessionId,
              mode: request.mode,
              answers: request.answers.map((answer) => ({
                question_id: answer.questionId,
                correct: answer.correct,
                duration_ms: answer.durationMs,
                answered_at: answer.at,
              })),
              answered: request.answers.length,
              correct: request.answers.filter((answer) => answer.correct).length,
              duration_ms: request.answers.reduce((total, answer) => total + answer.durationMs, 0),
            });
          progress = {
            ...progress,
            summary,
            question_totals: questionTotals,
            wrong_questions: wrongQuestions,
            daily_totals: dailyTotals,
            recent_question_ids: recentQuestionIds,
            active_session:
              progress.active_session && progress.active_session.id === request.sessionId
                ? null
                : progress.active_session,
            revision: progress.revision + 1,
          };
          await store.saveProgress(progressId, progress);
        }
      }
      return snapshotResponse(account, progress, key, now);
    } catch (error) {
      if (inTransaction) throw error;
      return toErrorResponse(error);
    }
  };

module.exports = { createHandler, emptyAccount, emptyProgress, createPracticeRecordId };
