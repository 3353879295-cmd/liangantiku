import type { CertificateKey, PracticeMode } from '../types/domain';

export const CURRENT_SCHEMA_VERSION = 1 as const;

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

export interface PersistedPracticeSession {
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

export interface ProgressPreferences {
  selectedCertificateKey: CertificateKey;
  dailyGoal: number;
}

export interface ProgressDataV1 {
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
  data: ProgressDataV1;
  recovered: boolean;
  reason?: string;
}

export const createEmptyProgress = (): ProgressDataV1 => ({
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
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CERTIFICATE_PATTERN = /^(4-02-06-01|4-08-05-01):[345]$/;
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

const isPreferences = (value: unknown): value is ProgressPreferences =>
  isRecord(value) &&
  typeof value.selectedCertificateKey === 'string' &&
  CERTIFICATE_PATTERN.test(value.selectedCertificateKey) &&
  Number.isInteger(value.dailyGoal) &&
  Number(value.dailyGoal) > 0;

const isPersistedSession = (value: unknown): value is PersistedPracticeSession => {
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

const isProgressDataV1 = (value: unknown): value is ProgressDataV1 => {
  if (!isRecord(value) || value.schemaVersion !== CURRENT_SCHEMA_VERSION) return false;
  return (
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
    (value.session === null || isPersistedSession(value.session)) &&
    isRecord(value.dailyTotals) &&
    Object.entries(value.dailyTotals).every(
      ([date, total]) => DATE_PATTERN.test(date) && isDailyTotal(total),
    ) &&
    (value.recordedSessionIds === undefined ||
      (Array.isArray(value.recordedSessionIds) &&
        value.recordedSessionIds.every(isNonBlankString) &&
        new Set(value.recordedSessionIds).size === value.recordedSessionIds.length)) &&
    isPreferences(value.preferences)
  );
};

export const migrateProgress = (value: unknown): MigrationResult => {
  if (value === null || value === undefined) {
    return { data: createEmptyProgress(), recovered: false };
  }

  if (isRecord(value) && typeof value.schemaVersion === 'number') {
    if (value.schemaVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error('learning data uses a newer schema version');
    }
  }

  if (!isProgressDataV1(value)) {
    return {
      data: createEmptyProgress(),
      recovered: true,
      reason: 'invalid version-one learning data',
    };
  }

  return {
    data: {
      ...value,
      recordedSessionIds: value.recordedSessionIds ?? [],
    },
    recovered: false,
  };
};
