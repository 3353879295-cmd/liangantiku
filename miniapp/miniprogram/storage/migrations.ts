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
  preferences: {
    selectedCertificateKey: '4-02-06-01:5',
    dailyGoal: 20,
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isProgressDataV1 = (value: unknown): value is ProgressDataV1 => {
  if (!isRecord(value) || value.schemaVersion !== CURRENT_SCHEMA_VERSION) return false;
  return (
    Array.isArray(value.answers) &&
    isRecord(value.wrongQuestions) &&
    isRecord(value.favorites) &&
    (value.session === null || isRecord(value.session)) &&
    isRecord(value.dailyTotals) &&
    isRecord(value.preferences)
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

  return { data: value, recovered: false };
};
