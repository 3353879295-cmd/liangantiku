const { AccountSyncError, toErrorResponse } = require('./errors');
const {
  validateEvent,
  validateProfile,
  validatePreferences,
  validateQuestionState,
  validateSession,
} = require('./validation');

const emptyAccount = () => ({
  schema_version: 1,
  status: 'active',
  learning_clear_state: 'idle',
  revision: 0,
  nickname: '仓廪小麦',
  avatar_url: '',
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

const toSnapshot = (account, progress, now) => ({
  schemaVersion: 1,
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

const createHandler =
  ({ store, hash, now = () => new Date().toISOString(), inTransaction = false }) =>
  async (event, context) => {
    if (!inTransaction && typeof store.transaction === 'function') {
      return store
        .transaction((transactionStore) =>
          createHandler({ store: transactionStore, hash, now, inTransaction: true })(
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
        return { ok: true, data: toSnapshot(account, progress, now) };
      }
      if (!account || !progress) throw new AccountSyncError('ACCOUNT_SYNC_UNAVAILABLE');
      if (account.status === 'deleting') throw new AccountSyncError('ACCOUNT_DELETING');
      if (account.status !== 'active' || account.learning_clear_state !== 'idle') {
        throw new AccountSyncError('ACCOUNT_DELETING');
      }

      if (request.action === 'updateProfile') {
        validateProfile(request);
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
      }
      return { ok: true, data: toSnapshot(account, progress, now) };
    } catch (error) {
      if (inTransaction) throw error;
      return toErrorResponse(error);
    }
  };

module.exports = { createHandler, emptyAccount, emptyProgress };
