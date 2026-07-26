import { buildPaper } from './paper-builder';
import {
  createPracticeSession,
  prunePersistedPracticeSession,
  rehydratePracticeSession,
  serializePracticeSession,
  submitSession,
} from './practice-session';
import { appServices, localDateKey } from './app-services';
import type { PracticeSession } from './practice-session';
import type {
  AnswerRevealMode,
  CertificateLevel,
  OccupationCode,
  PracticeMode,
  PracticeQuestionLimit,
  Question,
  QuestionType,
} from '../types/domain';

export interface StartPracticeInput {
  occupation: OccupationCode;
  level: CertificateLevel;
  mode: PracticeMode;
  limit?: PracticeQuestionLimit;
  questionTypes?: QuestionType[];
  module?: string;
  chapterId?: string;
  sectionId?: string;
}

let activeSession: PracticeSession | null = null;

export const resolveAnswerRevealMode = (
  mode: PracticeMode,
  preference: AnswerRevealMode,
): AnswerRevealMode => (mode === 'mock' ? 'deferred' : preference);

const filterCertificate = (
  questions: readonly Question[],
  occupation: OccupationCode,
  level: CertificateLevel,
): Question[] =>
  questions.filter((question) => question.occupation === occupation && question.level === level);

const loadCandidates = async (input: StartPracticeInput): Promise<Question[]> => {
  if (input.mode === 'wrong') {
    const ids = appServices.progress.listWrongQuestions(false).map((record) => record.questionId);
    return filterCertificate(
      await appServices.questions.getByIds(ids),
      input.occupation,
      input.level,
    );
  }
  if (input.mode === 'favorite') {
    return filterCertificate(
      await appServices.questions.getByIds(appServices.progress.listFavoriteIds()),
      input.occupation,
      input.level,
    );
  }
  return appServices.questions.list({
    occupation: input.occupation,
    level: input.level,
    ...(input.module ? { module: input.module } : {}),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
  });
};

export const startPractice = async (input: StartPracticeInput): Promise<PracticeSession | null> => {
  const candidates = await loadCandidates(input);
  if (!candidates.length) return null;
  const paper = buildPaper(candidates, {
    mode: input.mode,
    limit: input.limit ?? (input.mode === 'mock' ? 50 : 20),
    ...(input.questionTypes ? { questionTypes: input.questionTypes } : {}),
    ...(input.module ? { module: input.module } : {}),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
  });
  if (!paper.length) return null;
  const preference = appServices.progress.getPreferences().answerRevealMode;
  activeSession = createPracticeSession(paper, {
    mode: input.mode,
    answerRevealMode: resolveAnswerRevealMode(input.mode, preference),
    now: Date.now(),
  });
  appServices.progress.saveSession(serializePracticeSession(activeSession));
  return activeSession;
};

export const startPracticeFromQuestions = (
  questions: readonly Question[],
  mode: PracticeMode,
): PracticeSession | null => {
  if (!questions.length) return null;
  const preference = appServices.progress.getPreferences().answerRevealMode;
  activeSession = createPracticeSession(questions.slice(0, 20), {
    mode,
    answerRevealMode: resolveAnswerRevealMode(mode, preference),
    now: Date.now(),
  });
  appServices.progress.saveSession(serializePracticeSession(activeSession));
  return activeSession;
};

export const restorePractice = async (): Promise<PracticeSession | null> => {
  if (activeSession) return activeSession;
  const persisted = appServices.progress.restoreSession();
  if (!persisted) return null;
  const questions = await appServices.questions.getByIds(persisted.questionIds);
  const repaired = prunePersistedPracticeSession(persisted, questions);
  if (!repaired) {
    appServices.progress.saveSession(null);
    return null;
  }
  activeSession = rehydratePracticeSession(repaired, questions);
  if (repaired.questionIds.length !== persisted.questionIds.length) {
    appServices.progress.saveSession(serializePracticeSession(activeSession));
  }
  return activeSession;
};

export const getActivePractice = (): PracticeSession | null => activeSession;

export const saveActivePractice = (session: PracticeSession): void => {
  activeSession = session;
  appServices.progress.saveSession(serializePracticeSession(session));
};

export const submitActivePractice = (now = Date.now()): PracticeSession | null => {
  if (!activeSession) return null;
  if (activeSession.status === 'active') activeSession = submitSession(activeSession, now);
  appServices.progress.saveSession(serializePracticeSession(activeSession));
  return activeSession;
};

export const recordActivePractice = (): PracticeSession | null => {
  const session = activeSession;
  if (!session || session.status !== 'submitted') return session;
  const report = session.report;
  if (!report) return session;
  const durationPerQuestion = Math.floor(report.durationMs / session.questions.length);
  const records = session.questions.map((question, index) => ({
    questionId: question.id,
    correct: session.feedback[question.id]?.correct ?? false,
    durationMs:
      index === session.questions.length - 1
        ? report.durationMs - durationPerQuestion * (session.questions.length - 1)
        : durationPerQuestion,
    at: localDateKey(),
  }));
  appServices.progress.recordPracticeResults(session.id, records);
  activeSession = { ...session, progressRecorded: true };
  appServices.progress.saveSession(serializePracticeSession(activeSession));
  return activeSession;
};
