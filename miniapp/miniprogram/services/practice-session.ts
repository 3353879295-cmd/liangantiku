import { gradeQuestion } from './grading';
import type { PersistedPracticeSession } from '../storage/migrations';
import type { GradeResult, PracticeMode, Question } from '../types/domain';

export type SessionStatus = 'active' | 'submitted';
export type AnswerSheetStatus = 'unanswered' | 'answered' | 'correct' | 'wrong';

export interface ModuleReport {
  total: number;
  correct: number;
}

export interface PracticeReport {
  total: number;
  correct: number;
  wrong: number;
  durationMs: number;
  wrongQuestionIds: string[];
  modules: Record<string, ModuleReport>;
}

export interface PracticeSession {
  id: string;
  mode: PracticeMode;
  questions: Question[];
  questionIds: string[];
  currentIndex: number;
  answers: Record<string, string[]>;
  feedback: Partial<Record<string, GradeResult>>;
  status: SessionStatus;
  startedAt: number;
  updatedAt: number;
  submittedAt?: number;
  report?: PracticeReport;
  progressRecorded: boolean;
}

export interface CreateSessionOptions {
  mode: PracticeMode;
  now: number;
  id?: string;
}

const requireActive = (session: PracticeSession): void => {
  if (session.status === 'submitted') {
    throw new Error('本次练习已交卷，不能继续修改');
  }
};

const findQuestion = (session: PracticeSession, questionId: string): Question => {
  const question = session.questions.find((item) => item.id === questionId);
  if (!question) throw new Error(`question not found in session: ${questionId}`);
  return question;
};

export const createPracticeSession = (
  questions: readonly Question[],
  options: CreateSessionOptions,
): PracticeSession => {
  const firstQuestion = questions[0];
  if (!firstQuestion) throw new Error('cannot create a practice session from an empty paper');

  return {
    id: options.id ?? `session-${options.now}-${firstQuestion.id}`,
    mode: options.mode,
    questions: [...questions],
    questionIds: questions.map((question) => question.id),
    currentIndex: 0,
    answers: {},
    feedback: {},
    status: 'active',
    startedAt: options.now,
    updatedAt: options.now,
    progressRecorded: false,
  };
};

export const answerQuestion = (
  session: PracticeSession,
  questionId: string,
  selectedIds: string[],
  now: number,
): PracticeSession => {
  requireActive(session);
  const question = findQuestion(session, questionId);
  const optionKeys = new Set(question.options.map((option) => option.key));
  if (selectedIds.some((key) => !optionKeys.has(key))) {
    throw new Error('selected answer contains an unknown option key');
  }

  const result = gradeQuestion(question, selectedIds);
  const feedback =
    session.mode === 'mock' ? session.feedback : { ...session.feedback, [questionId]: result };

  return {
    ...session,
    answers: { ...session.answers, [questionId]: result.selected },
    feedback,
    updatedAt: now,
  };
};

export const navigateToQuestion = (
  session: PracticeSession,
  index: number,
  now: number,
): PracticeSession => {
  if (!Number.isInteger(index) || index < 0 || index >= session.questionIds.length) {
    throw new Error('question index is outside the session');
  }
  return { ...session, currentIndex: index, updatedAt: now };
};

export const getAnswerSheet = (
  session: PracticeSession,
): Array<{ questionId: string; status: AnswerSheetStatus }> =>
  session.questionIds.map((questionId) => {
    if (!session.answers[questionId]) return { questionId, status: 'unanswered' };
    const result = session.feedback[questionId];
    if (!result) return { questionId, status: 'answered' };
    return { questionId, status: result.correct ? 'correct' : 'wrong' };
  });

export const submitSession = (session: PracticeSession, now: number): PracticeSession => {
  requireActive(session);
  const feedback: Record<string, GradeResult> = {};
  const modules: Record<string, ModuleReport> = {};
  const wrongQuestionIds: string[] = [];
  let correct = 0;

  for (const question of session.questions) {
    const result = gradeQuestion(question, session.answers[question.id] ?? []);
    feedback[question.id] = result;
    const previous = modules[question.module] ?? { total: 0, correct: 0 };
    modules[question.module] = {
      total: previous.total + 1,
      correct: previous.correct + (result.correct ? 1 : 0),
    };
    if (result.correct) correct += 1;
    else wrongQuestionIds.push(question.id);
  }

  const report: PracticeReport = {
    total: session.questions.length,
    correct,
    wrong: session.questions.length - correct,
    durationMs: Math.max(0, now - session.startedAt),
    wrongQuestionIds,
    modules,
  };

  return {
    ...session,
    feedback,
    status: 'submitted',
    updatedAt: now,
    submittedAt: now,
    report,
  };
};

export const serializePracticeSession = (session: PracticeSession): PersistedPracticeSession => {
  const persisted: PersistedPracticeSession = {
    id: session.id,
    mode: session.mode,
    questionIds: [...session.questionIds],
    currentIndex: session.currentIndex,
    answers: Object.fromEntries(
      Object.entries(session.answers).map(([questionId, selected]) => [questionId, [...selected]]),
    ),
    status: session.status,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    progressRecorded: session.progressRecorded,
  };
  if (session.submittedAt !== undefined) persisted.submittedAt = session.submittedAt;
  return persisted;
};

export const rehydratePracticeSession = (
  persisted: PersistedPracticeSession,
  questions: readonly Question[],
): PracticeSession => {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const orderedQuestions = persisted.questionIds.map((questionId) => {
    const question = byId.get(questionId);
    if (!question) throw new Error(`cannot restore missing question: ${questionId}`);
    return question;
  });
  const base: PracticeSession = {
    id: persisted.id,
    mode: persisted.mode,
    questions: orderedQuestions,
    questionIds: [...persisted.questionIds],
    currentIndex: persisted.currentIndex,
    answers: Object.fromEntries(
      Object.entries(persisted.answers).map(([questionId, selected]) => [
        questionId,
        [...selected],
      ]),
    ),
    feedback: {},
    status: 'active',
    startedAt: persisted.startedAt,
    updatedAt: persisted.updatedAt,
    progressRecorded: persisted.progressRecorded ?? false,
  };

  if (persisted.status === 'submitted') {
    return {
      ...submitSession(base, persisted.submittedAt ?? persisted.updatedAt),
      progressRecorded: persisted.progressRecorded ?? false,
    };
  }

  if (persisted.mode === 'mock') return base;
  const feedback = Object.fromEntries(
    Object.entries(base.answers).map(([questionId, selected]) => {
      const question = byId.get(questionId);
      if (!question) throw new Error(`cannot grade missing question: ${questionId}`);
      return [questionId, gradeQuestion(question, selected)];
    }),
  );
  return { ...base, feedback };
};
