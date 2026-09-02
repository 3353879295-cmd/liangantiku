const { AccountSyncError } = require('./errors');

const ACTION_FIELDS = {
  bootstrap: ['action', 'schemaVersion'],
  updateProfile: ['action', 'schemaVersion', 'expectedRevision', 'nickname', 'avatarUrl'],
  updatePreferences: [
    'action',
    'schemaVersion',
    'expectedRevision',
    'selectedCertificateKey',
    'dailyGoal',
    'answerTheme',
    'answerRevealMode',
  ],
  saveActiveSession: ['action', 'schemaVersion', 'expectedRevision', 'session'],
  setFavorite: ['action', 'schemaVersion', 'expectedRevision', 'questionId', 'favorite'],
  markMastered: ['action', 'schemaVersion', 'expectedRevision', 'questionId', 'mastered'],
  recordPractice: ['action', 'schemaVersion', 'expectedRevision', 'sessionId', 'mode', 'answers'],
  clearLearningData: ['action', 'schemaVersion'],
  deleteAccount: ['action', 'schemaVersion'],
};
const AVATAR_PATHS = new Set([
  '/assets/avatars/granary.svg',
  '/assets/avatars/wheat.svg',
  '/assets/avatars/field.svg',
  '/assets/avatars/book.svg',
]);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const invalid = () => {
  throw new AccountSyncError('INVALID_REQUEST');
};
const isRevision = (value) => Number.isInteger(value) && value >= 0;
const isQuestionId = (value) =>
  typeof value === 'string' &&
  value.length <= 64 &&
  /^(?:Q\d+|[A-Z]{2,}(?:-[A-Z0-9]+)+)$/.test(value);
const isDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const validateEvent = (event) => {
  if (!isRecord(event) || typeof event.action !== 'string') invalid();
  if (event.schemaVersion !== 1) throw new AccountSyncError('SCHEMA_INCOMPATIBLE');
  const allowed = ACTION_FIELDS[event.action];
  if (!allowed || Object.keys(event).some((key) => !allowed.includes(key))) invalid();
  if (
    !['bootstrap', 'clearLearningData', 'deleteAccount'].includes(event.action) &&
    !isRevision(event.expectedRevision)
  )
    invalid();
  return event;
};

const validateProfile = (event) => {
  if (
    typeof event.nickname !== 'string' ||
    !event.nickname.trim() ||
    Array.from(event.nickname).length > 12 ||
    typeof event.avatarUrl !== 'string' ||
    (event.avatarUrl !== '' && !AVATAR_PATHS.has(event.avatarUrl))
  ) {
    invalid();
  }
};

const validatePreferences = (event) => {
  if (
    typeof event.selectedCertificateKey !== 'string' ||
    !/^(4-02-06-01|4-08-05-01):[1-5]$/.test(event.selectedCertificateKey) ||
    !Number.isInteger(event.dailyGoal) ||
    event.dailyGoal < 1 ||
    event.dailyGoal > 100 ||
    !['light', 'night'].includes(event.answerTheme) ||
    !['immediate', 'deferred'].includes(event.answerRevealMode)
  ) {
    invalid();
  }
};

const validateQuestionState = (event, stateField) => {
  if (!isQuestionId(event.questionId) || typeof event[stateField] !== 'boolean') invalid();
};

const validateSession = (event) => {
  if (event.session === null) return;
  const session = event.session;
  const allowed = new Set([
    'id',
    'mode',
    'questionIds',
    'currentIndex',
    'answers',
    'status',
    'startedAt',
    'updatedAt',
    'submittedAt',
    'progressRecorded',
    'answerRevealMode',
  ]);
  if (
    !isRecord(session) ||
    Object.keys(session).some((key) => !allowed.has(key)) ||
    typeof session.id !== 'string' ||
    !session.id.trim() ||
    !['chapter', 'sequential', 'random', 'mock', 'wrong', 'favorite'].includes(session.mode) ||
    !Array.isArray(session.questionIds) ||
    session.questionIds.length === 0 ||
    session.questionIds.length > 100 ||
    !session.questionIds.every(isQuestionId) ||
    new Set(session.questionIds).size !== session.questionIds.length ||
    !Number.isInteger(session.currentIndex) ||
    session.currentIndex < 0 ||
    session.currentIndex >= session.questionIds.length ||
    !isRecord(session.answers) ||
    !Object.entries(session.answers).every(
      ([questionId, answers]) =>
        session.questionIds.includes(questionId) &&
        Array.isArray(answers) &&
        answers.length > 0 &&
        answers.length <= 10 &&
        answers.every(
          (answer) => typeof answer === 'string' && answer.length > 0 && answer.length <= 10,
        ),
    ) ||
    !['active', 'submitted'].includes(session.status) ||
    !Number.isFinite(session.startedAt) ||
    session.startedAt < 0 ||
    !Number.isFinite(session.updatedAt) ||
    session.updatedAt < 0 ||
    (session.submittedAt !== undefined &&
      (!Number.isFinite(session.submittedAt) || session.submittedAt < 0)) ||
    (session.progressRecorded !== undefined && typeof session.progressRecorded !== 'boolean') ||
    (session.status === 'submitted' && session.submittedAt === undefined) ||
    !['immediate', 'deferred'].includes(session.answerRevealMode)
  ) {
    invalid();
  }
};

const validatePractice = (event) => {
  const answerFields = new Set(['questionId', 'correct', 'durationMs', 'at']);
  if (
    !['chapter', 'sequential', 'random', 'mock', 'wrong', 'favorite'].includes(event.mode) ||
    typeof event.sessionId !== 'string' ||
    !event.sessionId.trim() ||
    event.sessionId.length > 128 ||
    !Array.isArray(event.answers) ||
    event.answers.length === 0 ||
    event.answers.length > 100 ||
    !event.answers.every(
      (answer) =>
        isRecord(answer) &&
        Object.keys(answer).length === answerFields.size &&
        Object.keys(answer).every((key) => answerFields.has(key)) &&
        isQuestionId(answer.questionId) &&
        typeof answer.correct === 'boolean' &&
        Number.isInteger(answer.durationMs) &&
        answer.durationMs >= 0 &&
        answer.durationMs <= 86_400_000 &&
        isDate(answer.at),
    )
  )
    invalid();
};

module.exports = {
  validateEvent,
  validateProfile,
  validatePreferences,
  validateQuestionState,
  validateSession,
  validatePractice,
};
