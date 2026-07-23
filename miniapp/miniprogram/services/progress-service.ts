import { createEmptyProgress } from '../storage/migrations';
import type {
  PersistedPracticeSession,
  ProgressDataV1,
  ProgressPreferences,
  WrongQuestionRecord,
} from '../storage/migrations';
import type { ProgressRepository } from '../storage/progress-repository';

export interface RecordAnswerInput {
  questionId: string;
  correct: boolean;
  durationMs: number;
  at: string;
}

export interface DashboardStats {
  answered: number;
  correct: number;
  accuracy: number;
  durationMs: number;
  streakDays: number;
  todayAnswered: number;
  dailyGoal: number;
}

export interface ActivityDay {
  date: string;
  answered: number;
  correct: number;
  durationMs: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const previousDate = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
};

const calculateStreak = (dailyTotals: ProgressDataV1['dailyTotals'], today: string): number => {
  const activeDates = Object.keys(dailyTotals)
    .filter((date) => date <= today && dailyTotals[date]?.answered)
    .sort();
  let cursor = activeDates.at(-1);
  let streak = 0;
  const activeSet = new Set(activeDates);

  while (cursor && activeSet.has(cursor)) {
    streak += 1;
    cursor = previousDate(cursor);
  }
  return streak;
};

const validateRecordInput = (input: RecordAnswerInput): void => {
  if (!input.questionId.trim()) throw new Error('questionId is required');
  if (!DATE_PATTERN.test(input.at)) throw new Error('answer date must use YYYY-MM-DD');
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) {
    throw new Error('answer duration must be non-negative');
  }
};

const appendAnswer = (data: ProgressDataV1, input: RecordAnswerInput): ProgressDataV1 => {
  const answer = { ...input };
  const previousDay = data.dailyTotals[input.at] ?? {
    answered: 0,
    correct: 0,
    durationMs: 0,
  };
  const dailyTotals = {
    ...data.dailyTotals,
    [input.at]: {
      answered: previousDay.answered + 1,
      correct: previousDay.correct + (input.correct ? 1 : 0),
      durationMs: previousDay.durationMs + input.durationMs,
    },
  };

  let wrongQuestions = data.wrongQuestions;
  const previousWrong = wrongQuestions[input.questionId];
  if (!input.correct) {
    const nextWrong: WrongQuestionRecord = previousWrong
      ? {
          ...previousWrong,
          errorCount: previousWrong.errorCount + 1,
          lastWrongAt: input.at,
          mastered: false,
          lastRetryCorrect: false,
        }
      : {
          questionId: input.questionId,
          errorCount: 1,
          firstWrongAt: input.at,
          lastWrongAt: input.at,
          mastered: false,
          lastRetryCorrect: false,
        };
    wrongQuestions = { ...wrongQuestions, [input.questionId]: nextWrong };
  } else if (previousWrong) {
    wrongQuestions = {
      ...wrongQuestions,
      [input.questionId]: { ...previousWrong, lastRetryCorrect: true },
    };
  }

  return {
    ...data,
    answers: [...data.answers, answer],
    dailyTotals,
    wrongQuestions,
  };
};

export class ProgressService {
  private data: ProgressDataV1;

  constructor(private readonly repository: ProgressRepository) {
    this.data = repository.load().data;
  }

  private persist(): void {
    this.repository.save(this.data);
  }

  recordAnswer(input: RecordAnswerInput): void {
    validateRecordInput(input);
    this.data = appendAnswer(this.data, input);
    this.persist();
  }

  recordPracticeResults(sessionId: string, inputs: readonly RecordAnswerInput[]): boolean {
    if (!sessionId.trim()) throw new Error('sessionId is required');
    for (const input of inputs) validateRecordInput(input);
    if (this.data.recordedSessionIds.includes(sessionId)) return false;

    this.data = inputs.reduce(appendAnswer, this.data);
    this.data = {
      ...this.data,
      recordedSessionIds: [...this.data.recordedSessionIds, sessionId],
    };
    this.persist();
    return true;
  }

  getWrongQuestion(questionId: string): WrongQuestionRecord | null {
    return this.data.wrongQuestions[questionId] ?? null;
  }

  listWrongQuestions(includeMastered = true): WrongQuestionRecord[] {
    return Object.values(this.data.wrongQuestions)
      .filter((record) => includeMastered || !record.mastered)
      .sort((left, right) => {
        if (left.lastWrongAt !== right.lastWrongAt) {
          return right.lastWrongAt.localeCompare(left.lastWrongAt);
        }
        return right.errorCount - left.errorCount;
      });
  }

  markMastered(questionId: string): boolean {
    const record = this.data.wrongQuestions[questionId];
    if (!record) return false;
    this.data = {
      ...this.data,
      wrongQuestions: {
        ...this.data.wrongQuestions,
        [questionId]: { ...record, mastered: true, lastRetryCorrect: true },
      },
    };
    this.persist();
    return true;
  }

  toggleFavorite(questionId: string, savedAt: number): boolean {
    const favorites = { ...this.data.favorites };
    const currentlySaved = Object.hasOwn(favorites, questionId);
    if (currentlySaved) delete favorites[questionId];
    else favorites[questionId] = savedAt;
    this.data = { ...this.data, favorites };
    this.persist();
    return !currentlySaved;
  }

  isFavorite(questionId: string): boolean {
    return Object.hasOwn(this.data.favorites, questionId);
  }

  listFavoriteIds(): string[] {
    return Object.entries(this.data.favorites)
      .sort(([, left], [, right]) => right - left)
      .map(([questionId]) => questionId);
  }

  getDashboard(today: string): DashboardStats {
    const answered = this.data.answers.length;
    const correct = this.data.answers.filter((answer) => answer.correct).length;
    const durationMs = this.data.answers.reduce((sum, answer) => sum + answer.durationMs, 0);
    return {
      answered,
      correct,
      accuracy: answered === 0 ? 0 : Math.round((correct / answered) * 100),
      durationMs,
      streakDays: calculateStreak(this.data.dailyTotals, today),
      todayAnswered: this.data.dailyTotals[today]?.answered ?? 0,
      dailyGoal: this.data.preferences.dailyGoal,
    };
  }

  getActivity(endDate: string, days = 7): ActivityDay[] {
    if (!DATE_PATTERN.test(endDate)) throw new Error('activity date must use YYYY-MM-DD');
    if (!Number.isInteger(days) || days <= 0) throw new Error('activity days must be positive');
    const dates: string[] = [];
    let cursor = endDate;
    for (let index = 0; index < days; index += 1) {
      dates.unshift(cursor);
      cursor = previousDate(cursor);
    }
    return dates.map((date) => ({
      date,
      answered: this.data.dailyTotals[date]?.answered ?? 0,
      correct: this.data.dailyTotals[date]?.correct ?? 0,
      durationMs: this.data.dailyTotals[date]?.durationMs ?? 0,
    }));
  }

  saveSession(session: PersistedPracticeSession | null): void {
    this.data = { ...this.data, session };
    this.persist();
  }

  restoreSession(): PersistedPracticeSession | null {
    return this.data.session;
  }

  getPreferences(): ProgressPreferences {
    return { ...this.data.preferences };
  }

  updatePreferences(preferences: Partial<ProgressPreferences>): void {
    const next = { ...this.data.preferences, ...preferences };
    if (!Number.isInteger(next.dailyGoal) || next.dailyGoal <= 0) {
      throw new Error('daily goal must be a positive integer');
    }
    this.data = { ...this.data, preferences: next };
    this.persist();
  }

  clearLearningData(): void {
    const preferences = { ...this.data.preferences };
    this.data = { ...createEmptyProgress(), preferences };
    this.persist();
  }
}
