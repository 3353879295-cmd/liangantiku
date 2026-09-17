import { buildPaper } from './paper-builder';
import {
  createPracticeSession,
  prunePersistedPracticeSession,
  rehydratePracticeSession,
  serializePracticeSession,
  submitSession,
} from './practice-session';
import { appServices, localDateKey } from './app-services';
import {
  authorizeRandomStart,
  finishRandomStart,
  getPendingRandomStart,
} from './random-practice-access';
import { MembershipError } from '../repositories/membership-client';
import type { PracticeSession } from './practice-session';
import type { PersistedPracticeSession } from '../storage/migrations';
import type {
  AnswerRevealMode,
  CertificateLevel,
  OccupationCode,
  PracticeMode,
  PracticeQuestionLimit,
  Question,
  QuestionType,
} from '../types/domain';
import type { ProgressScope } from '../types/account-sync';

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
let activeSessionScope: ProgressScope | null = null;
let activeSessionPersisted: PersistedPracticeSession | null = null;
const sessionScopes = new Map<string, ProgressScope>();
let randomStart: Promise<PracticeSession | null> | null = null;

const samePersistedSession = (
  left: PersistedPracticeSession | null,
  right: PersistedPracticeSession | null,
): boolean => {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (
    left.id !== right.id ||
    left.mode !== right.mode ||
    left.answerRevealMode !== right.answerRevealMode ||
    left.currentIndex !== right.currentIndex ||
    left.status !== right.status ||
    left.startedAt !== right.startedAt ||
    left.updatedAt !== right.updatedAt ||
    left.submittedAt !== right.submittedAt ||
    (left.progressRecorded ?? false) !== (right.progressRecorded ?? false) ||
    left.questionIds.length !== right.questionIds.length
  ) {
    return false;
  }
  if (left.questionIds.some((questionId, index) => questionId !== right.questionIds[index])) {
    return false;
  }
  const leftAnswerIds = Object.keys(left.answers);
  const rightAnswerIds = Object.keys(right.answers);
  if (leftAnswerIds.length !== rightAnswerIds.length) return false;
  return leftAnswerIds.every((questionId) => {
    const leftAnswer = left.answers[questionId];
    const rightAnswer = right.answers[questionId];
    return (
      leftAnswer !== undefined &&
      rightAnswer !== undefined &&
      leftAnswer.length === rightAnswer.length &&
      leftAnswer.every((option, index) => option === rightAnswer[index])
    );
  });
};

const clearStaleActiveSession = (): void => {
  if (
    activeSession &&
    (activeSessionScope !== appServices.progress.getScope() ||
      (activeSessionPersisted !== null &&
        !samePersistedSession(appServices.progress.restoreSession(), activeSessionPersisted)))
  ) {
    activeSession = null;
    activeSessionScope = null;
    activeSessionPersisted = null;
  }
};

const isCurrentScope = (scope: ProgressScope): boolean => appServices.progress.getScope() === scope;

const isCurrentRestoredSession = (
  scope: ProgressScope,
  session: ReturnType<typeof appServices.progress.restoreSession>,
): boolean =>
  isCurrentScope(scope) && samePersistedSession(appServices.progress.restoreSession(), session);

const saveStartedPractice = (session: PracticeSession): PracticeSession => {
  const scope = appServices.progress.getScope();
  appServices.progress.saveSession(serializePracticeSession(session));
  activeSession = session;
  activeSessionScope = scope;
  activeSessionPersisted = appServices.progress.restoreSession();
  sessionScopes.set(session.id, scope);
  return session;
};

const withRandomStart = (work: () => Promise<PracticeSession | null>) => {
  if (randomStart) return randomStart;
  randomStart = work().finally(() => {
    randomStart = null;
  });
  return randomStart;
};

const saveAuthorizedRandomStart = (
  session: PracticeSession,
  id: string,
  key: string,
): PracticeSession => {
  const saved = saveStartedPractice(session);
  finishRandomStart(id, key);
  return saved;
};

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

const preparePractice = async (input: StartPracticeInput): Promise<PracticeSession | null> => {
  const scope = appServices.progress.getScope();
  const candidates = await loadCandidates(input);
  if (!isCurrentScope(scope)) return null;
  if (!candidates.length) return null;
  const paper = buildPaper(candidates, {
    mode: input.mode,
    limit: input.mode === 'random' ? 10 : (input.limit ?? (input.mode === 'mock' ? 50 : 20)),
    ...(input.questionTypes ? { questionTypes: input.questionTypes } : {}),
    ...(input.module ? { module: input.module } : {}),
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    ...(input.sectionId ? { sectionId: input.sectionId } : {}),
  });
  if (!paper.length) return null;
  if (input.mode === 'random') {
    const session = await authorizeRandomStart(paper, JSON.stringify(input));
    if (!isCurrentScope(scope)) return null;
    return saveAuthorizedRandomStart(session, session.id, JSON.stringify(input));
  }
  const preference = appServices.progress.getPreferences().answerRevealMode;
  const session = createPracticeSession(paper, {
    mode: input.mode,
    answerRevealMode: resolveAnswerRevealMode(input.mode, preference),
    now: Date.now(),
  });
  if (!isCurrentScope(scope)) return null;
  return saveStartedPractice(session);
};

export const startPractice = (input: StartPracticeInput): Promise<PracticeSession | null> =>
  input.mode === 'random' ? withRandomStart(() => preparePractice(input)) : preparePractice(input);

export const startRandomPracticeFromQuestions = (
  questions: readonly Question[],
): Promise<PracticeSession | null> =>
  withRandomStart(async () => {
    if (!questions.length) return null;
    const scope = appServices.progress.getScope();
    const session = await authorizeRandomStart(
      questions,
      `retry:${questions.map(({ id }) => id).join(',')}`,
    );
    if (!isCurrentScope(scope)) return null;
    return saveAuthorizedRandomStart(
      session,
      session.id,
      `retry:${questions.map(({ id }) => id).join(',')}`,
    );
  });

export const startPracticeFromQuestions = (
  questions: readonly Question[],
  mode: PracticeMode,
): PracticeSession | null => {
  if (mode === 'random') throw new Error('随机练习必须通过云端授权后开始。');
  if (!questions.length) return null;
  const scope = appServices.progress.getScope();
  const preference = appServices.progress.getPreferences().answerRevealMode;
  activeSession = createPracticeSession(questions.slice(0, 20), {
    mode,
    answerRevealMode: resolveAnswerRevealMode(mode, preference),
    now: Date.now(),
  });
  appServices.progress.saveSession(serializePracticeSession(activeSession));
  activeSessionScope = scope;
  activeSessionPersisted = appServices.progress.restoreSession();
  sessionScopes.set(activeSession.id, scope);
  return activeSession;
};

export const restorePractice = async (resumePending = false): Promise<PracticeSession | null> => {
  clearStaleActiveSession();
  if (activeSession && (!resumePending || activeSession.status === 'active')) return activeSession;
  const scope = appServices.progress.getScope();
  const persisted = appServices.progress.restoreSession();
  const pending = getPendingRandomStart();
  if (
    resumePending &&
    pending &&
    (!persisted || (persisted.status === 'submitted' && persisted.progressRecorded === true))
  ) {
    return withRandomStart(async () => {
      if (!isCurrentRestoredSession(scope, persisted)) return null;
      const session = await authorizeRandomStart([], pending.key);
      const latest = getPendingRandomStart();
      if (
        !isCurrentRestoredSession(scope, persisted) ||
        latest?.id !== pending.id ||
        latest?.key !== pending.key
      )
        return null;
      return saveAuthorizedRandomStart(session, pending.id, pending.key);
    });
  }
  if (!persisted) return null;
  const questions = await appServices.questions.getByIds(persisted.questionIds);
  if (!isCurrentRestoredSession(scope, persisted)) return null;
  const repaired = prunePersistedPracticeSession(persisted, questions);
  if (!repaired) {
    appServices.progress.saveSession(null);
    return null;
  }
  if (persisted.mode === 'random' && persisted.status === 'active') {
    if (repaired.questionIds.length !== persisted.questionIds.length) {
      throw new MembershipError('INVALID_GRANT', '部分题目已更新，请返回首页开始新一轮随机练习。');
    }
    // Local state is never an access token.
    try {
      await appServices.membership.validateRandomPractice(persisted.id, persisted.questionIds);
    } catch (error) {
      if (!(error instanceof MembershipError) || error.code !== 'GRANT_NOT_FOUND') throw error;
      // The backend still enforces quota.
      await appServices.membership.startRandomPractice(persisted.id, persisted.questionIds);
    }
    if (!isCurrentRestoredSession(scope, persisted)) return null;
  }
  activeSession = rehydratePracticeSession(repaired, questions);
  activeSessionScope = scope;
  activeSessionPersisted = persisted;
  sessionScopes.set(activeSession.id, scope);
  if (repaired.questionIds.length !== persisted.questionIds.length) {
    appServices.progress.saveSession(serializePracticeSession(activeSession));
    activeSessionPersisted = appServices.progress.restoreSession();
  }
  return activeSession;
};

export const getActivePractice = (): PracticeSession | null => {
  clearStaleActiveSession();
  return activeSession;
};

export const saveActivePractice = (session: PracticeSession): void => {
  const sessionScope = sessionScopes.get(session.id);
  clearStaleActiveSession();
  if (sessionScope !== undefined && sessionScope !== appServices.progress.getScope()) return;
  saveStartedPractice(session);
};

export const submitActivePractice = (now = Date.now()): PracticeSession | null => {
  clearStaleActiveSession();
  if (!activeSession) return null;
  if (activeSession.status === 'active') activeSession = submitSession(activeSession, now);
  saveStartedPractice(activeSession);
  return activeSession;
};

export const recordActivePractice = (): PracticeSession | null => {
  clearStaleActiveSession();
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
  appServices.progress.recordPracticeResults(session.id, records, session.mode);
  activeSession = { ...session, progressRecorded: true };
  saveStartedPractice(activeSession);
  return activeSession;
};
