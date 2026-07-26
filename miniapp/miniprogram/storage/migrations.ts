import type { AnswerRevealMode, AnswerTheme, CertificateKey, PracticeMode } from '../types/domain';

export const CURRENT_SCHEMA_VERSION = 3 as const;

export interface AnswerHistoryRecord {
  questionId: string;
  correct: boolean;
  durationMs: number;
  at: string;
}

export interface WrongQuestionRecord {
  questionId: string;
  errorCount: number;
  firstWrongAt: string;
  lastWrongAt: string;
  mastered: boolean;
  lastRetryCorrect: boolean;
}

export interface DailyTotal {
  answered: number;
  correct: number;
  durationMs: number;
}

export interface LegacyPersistedPracticeSession {
  id: string;
  mode: PracticeMode;
  questionIds: string[];
  currentIndex: number;
  answers: Record<string, string[]>;
  status: 'active' | 'submitted';
  startedAt: number;
  updatedAt: number;
  submittedAt?: number;
  progressRecorded?: boolean;
}

export interface PersistedPracticeSession extends LegacyPersistedPracticeSession {
  answerRevealMode: AnswerRevealMode;
}

export interface ProgressPreferencesV2 {
  selectedCertificateKey: CertificateKey;
  dailyGoal: number;
  answerTheme: AnswerTheme;
  nickname: string;
  avatarUrl: string;
}

export interface ProgressPreferences extends ProgressPreferencesV2 {
  answerRevealMode: AnswerRevealMode;
}

export interface ProgressDataV1 {
  schemaVersion: 1;
  answers: AnswerHistoryRecord[];
  wrongQuestions: Record<string, WrongQuestionRecord>;
  favorites: Record<string, number>;
  session: LegacyPersistedPracticeSession | null;
  dailyTotals: Record<string, DailyTotal>;
  recordedSessionIds?: string[];
  preferences: Pick<ProgressPreferences, 'selectedCertificateKey' | 'dailyGoal'>;
}

export interface ProgressDataV2 {
  schemaVersion: 2;
  answers: AnswerHistoryRecord[];
  wrongQuestions: Record<string, WrongQuestionRecord>;
  favorites: Record<string, number>;
  session: LegacyPersistedPracticeSession | null;
  dailyTotals: Record<string, DailyTotal>;
  recordedSessionIds: string[];
  preferences: ProgressPreferencesV2;
}

export interface ProgressDataV3 {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  answers: AnswerHistoryRecord[];
  wrongQuestions: Record<string, WrongQuestionRecord>;
  favorites: Record<string, number>;
  session: PersistedPracticeSession | null;
  dailyTotals: Record<string, DailyTotal>;
  recordedSessionIds: string[];
  preferences: ProgressPreferences;
}

export interface MigrationResult {
  data: ProgressDataV3;
  recovered: boolean;
  reason?: string;
}

export const createEmptyProgress = (): ProgressDataV3 => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  answers: [],
  wrongQuestions: {},
  favorites: {},
  session: null,
  dailyTotals: {},
  recordedSessionIds: [],
  preferences: {
    selectedCertificateKey: '4-02-06-01:5',
    dailyGoal: 20,
    answerTheme: 'light',
    nickname: '仓廪小麦',
    avatarUrl: '',
    answerRevealMode: 'immediate',
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CERTIFICATE_PATTERN = /^(4-02-06-01|4-08-05-01):[12345]$/;
const PRACTICE_MODES = new Set<PracticeMode>([
  'chapter',
  'sequential',
  'random',
  'mock',
  'wrong',
  'favorite',
]);

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim());

const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 0;

const isAnswerHistoryRecord = (value: unknown): value is AnswerHistoryRecord =>
  isRecord(value) &&
  isNonBlankString(value.questionId) &&
  typeof value.correct === 'boolean' &&
  isNonNegativeNumber(value.durationMs) &&
  typeof value.at === 'string' &&
  DATE_PATTERN.test(value.at);

const isWrongQuestionRecord = (value: unknown): value is WrongQuestionRecord =>
  isRecord(value) &&
  isNonBlankString(value.questionId) &&
  Number.isInteger(value.errorCount) &&
  Number(value.errorCount) > 0 &&
  typeof value.firstWrongAt === 'string' &&
  DATE_PATTERN.test(value.firstWrongAt) &&
  typeof value.lastWrongAt === 'string' &&
  DATE_PATTERN.test(value.lastWrongAt) &&
  typeof value.mastered === 'boolean' &&
  typeof value.lastRetryCorrect === 'boolean';

const isDailyTotal = (value: unknown): value is DailyTotal =>
  isRecord(value) &&
  isNonNegativeInteger(value.answered) &&
  isNonNegativeInteger(value.correct) &&
  Number(value.correct) <= Number(value.answered) &&
  isNonNegativeNumber(value.durationMs);

const isVersionOnePreferences = (value: unknown): value is ProgressDataV1['preferences'] =>
  isRecord(value) &&
  typeof value.selectedCertificateKey === 'string' &&
  CERTIFICATE_PATTERN.test(value.selectedCertificateKey) &&
  Number.isInteger(value.dailyGoal) &&
  Number(value.dailyGoal) > 0;

const isAnswerRevealMode = (value: unknown): value is AnswerRevealMode =>
  value === 'immediate' || value === 'deferred';

const isVersionTwoPreferences = (value: unknown): value is ProgressPreferencesV2 =>
  isRecord(value) &&
  typeof value.selectedCertificateKey === 'string' &&
  CERTIFICATE_PATTERN.test(value.selectedCertificateKey) &&
  Number.isInteger(value.dailyGoal) &&
  Number(value.dailyGoal) > 0 &&
  (value.answerTheme === 'light' || value.answerTheme === 'night') &&
  typeof value.nickname === 'string' &&
  typeof value.avatarUrl === 'string';

const isVersionThreePreferences = (value: unknown): value is ProgressPreferences =>
  isVersionTwoPreferences(value) && isRecord(value) && isAnswerRevealMode(value.answerRevealMode);

const isLegacyPersistedSession = (value: unknown): value is LegacyPersistedPracticeSession => {
  if (!isRecord(value)) return false;
  if (!isNonBlankString(value.id) || !PRACTICE_MODES.has(value.mode as PracticeMode)) return false;
  if (
    !Array.isArray(value.questionIds) ||
    !value.questionIds.length ||
    !value.questionIds.every(isNonBlankString) ||
    new Set(value.questionIds).size !== value.questionIds.length
  ) {
    return false;
  }
  if (
    !Number.isInteger(value.currentIndex) ||
    Number(value.currentIndex) < 0 ||
    Number(value.currentIndex) >= value.questionIds.length ||
    !isRecord(value.answers)
  ) {
    return false;
  }
  const questionIds = new Set(value.questionIds);
  if (
    !Object.entries(value.answers).every(
      ([questionId, selected]) =>
        questionIds.has(questionId) &&
        Array.isArray(selected) &&
        selected.length > 0 &&
        selected.every(isNonBlankString),
    )
  ) {
    return false;
  }
  if (value.status !== 'active' && value.status !== 'submitted') return false;
  if (!isNonNegativeNumber(value.startedAt) || !isNonNegativeNumber(value.updatedAt)) return false;
  if (value.submittedAt !== undefined && !isNonNegativeNumber(value.submittedAt)) return false;
  if (value.status === 'submitted' && value.submittedAt === undefined) return false;
  return value.progressRecorded === undefined || typeof value.progressRecorded === 'boolean';
};

const isPersistedSession = (value: unknown): value is PersistedPracticeSession => {
  const answerRevealMode = isRecord(value) ? value.answerRevealMode : undefined;
  return isLegacyPersistedSession(value) && isAnswerRevealMode(answerRevealMode);
};

const hasValidLearningData = (
  value: Record<string, unknown>,
  allowMissingRecordedSessionIds: boolean,
  isValidSession: (session: unknown) => boolean,
): boolean =>
  Array.isArray(value.answers) &&
  value.answers.every(isAnswerHistoryRecord) &&
  isRecord(value.wrongQuestions) &&
  Object.entries(value.wrongQuestions).every(
    ([questionId, record]) => isWrongQuestionRecord(record) && record.questionId === questionId,
  ) &&
  isRecord(value.favorites) &&
  Object.entries(value.favorites).every(
    ([questionId, savedAt]) => isNonBlankString(questionId) && isNonNegativeNumber(savedAt),
  ) &&
  (value.session === null || isValidSession(value.session)) &&
  isRecord(value.dailyTotals) &&
  Object.entries(value.dailyTotals).every(
    ([date, total]) => DATE_PATTERN.test(date) && isDailyTotal(total),
  ) &&
  ((allowMissingRecordedSessionIds && value.recordedSessionIds === undefined) ||
    (Array.isArray(value.recordedSessionIds) &&
      value.recordedSessionIds.every(isNonBlankString) &&
      new Set(value.recordedSessionIds).size === value.recordedSessionIds.length));

export const isProgressDataV1 = (value: unknown): value is ProgressDataV1 => {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return (
    hasValidLearningData(value, true, isLegacyPersistedSession) &&
    isVersionOnePreferences(value.preferences)
  );
};

export const isProgressDataV2 = (value: unknown): value is ProgressDataV2 => {
  if (!isRecord(value) || value.schemaVersion !== 2) return false;
  return (
    hasValidLearningData(value, false, isLegacyPersistedSession) &&
    isVersionTwoPreferences(value.preferences)
  );
};

export const isProgressDataV3 = (value: unknown): value is ProgressDataV3 => {
  if (!isRecord(value) || value.schemaVersion !== CURRENT_SCHEMA_VERSION) return false;
  return (
    hasValidLearningData(value, false, isPersistedSession) &&
    isVersionThreePreferences(value.preferences)
  );
};

const migrateVersionOneToVersionTwo = (value: ProgressDataV1): ProgressDataV2 => ({
  ...value,
  schemaVersion: 2,
  recordedSessionIds: value.recordedSessionIds ?? [],
  preferences: {
    ...value.preferences,
    answerTheme: 'light',
    nickname: '仓廪小麦',
    avatarUrl: '',
  },
});

const legacyRevealMode = (mode: PracticeMode): AnswerRevealMode =>
  mode === 'mock' ? 'deferred' : 'immediate';

export const migrateVersionTwo = (value: ProgressDataV2): ProgressDataV3 => ({
  ...value,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  session: value.session
    ? { ...value.session, answerRevealMode: legacyRevealMode(value.session.mode) }
    : null,
  preferences: { ...value.preferences, answerRevealMode: 'immediate' },
});

export const migrateVersionOne = (value: ProgressDataV1): ProgressDataV3 =>
  migrateVersionTwo(migrateVersionOneToVersionTwo(value));

export const migrateProgress = (value: unknown): MigrationResult => {
  if (value === null || value === undefined) {
    return { data: createEmptyProgress(), recovered: false };
  }

  if (isRecord(value) && typeof value.schemaVersion === 'number') {
    if (value.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return {
        data: createEmptyProgress(),
        recovered: true,
        reason: `unsupported learning data schema version ${value.schemaVersion}`,
      };
    }
  }

  if (isProgressDataV3(value)) {
    return { data: value, recovered: false };
  }

  if (
    isRecord(value) &&
    value.schemaVersion === CURRENT_SCHEMA_VERSION &&
    hasValidLearningData(value, false, isPersistedSession) &&
    isVersionTwoPreferences(value.preferences) &&
    isRecord(value.preferences) &&
    !isAnswerRevealMode(value.preferences.answerRevealMode)
  ) {
    return {
      data: {
        ...(value as unknown as ProgressDataV3),
        preferences: {
          ...value.preferences,
          answerRevealMode: 'immediate',
        },
      },
      recovered: true,
      reason: 'invalid answer reveal preference',
    };
  }

  if (isProgressDataV2(value)) {
    return { data: migrateVersionTwo(value), recovered: false };
  }

  if (isProgressDataV1(value)) {
    return { data: migrateVersionOne(value), recovered: false };
  }

  return {
    data: createEmptyProgress(),
    recovered: true,
    reason: 'invalid learning data',
  };
};
