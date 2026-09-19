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
  CertificateKey,
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
let startGeneration = 0;
let randomStart: { generation: number; promise: Promise<PracticeSession | null> } | null = null;
const sequentialStarts = new Map<
  string,
  { generation: number; promise: Promise<PracticeSession | null> }
>();

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

const beginStart = (): number => {
  startGeneration += 1;
  return startGeneration;
};

const isCurrentStart = (scope: ProgressScope, generation: number): boolean =>
  isCurrentScope(scope) && generation === startGeneration;

const certificateKeyFor = (occupation: OccupationCode, level: CertificateLevel): CertificateKey =>
  `${occupation}:${level}`;

const sessionBelongsToCurrentBank = (
  session: PersistedPracticeSession,
  candidates: readonly Question[],
): boolean => {
  const candidateIds = new Set(candidates.map((question) => question.id));
  return session.mode === 'sequential' && session.questionIds.every((id) => candidateIds.has(id));
};

const sessionHasRemainingBankQuestions = (
  session: PersistedPracticeSession,
  candidates: readonly Question[],
): boolean => {
  const candidateIds = new Set(candidates.map((question) => question.id));
  return session.mode === 'sequential' && session.questionIds.some((id) => candidateIds.has(id));
};

const sequentialCertificateKeyForSession = (session: PracticeSession): CertificateKey | null => {
  const first = session.questions[0];
  if (!first) return null;
  const key = certificateKeyFor(first.occupation, first.level);
  return session.questions.every(
    (question) => certificateKeyFor(question.occupation, question.level) === key,
  )
    ? key
    : null;
};

const sequentialCandidates = (
  questions: readonly Question[],
  completed: readonly string[],
): Question[] => {
  const completedIds = new Set(completed);
  const seen = new Set<string>();
  return questions.filter((question) => {
    if (seen.has(question.id)) return false;
    seen.add(question.id);
    return !completedIds.has(question.id);
  });
};

const isCurrentRestoredSession = (
  scope: ProgressScope,
  session: ReturnType<typeof appServices.progress.restoreSession>,
  generation: number,
): boolean =>
  isCurrentStart(scope, generation) &&
  samePersistedSession(appServices.progress.restoreSession(), session);

const saveStartedPractice = (session: PracticeSession): PracticeSession => {
  const scope = appServices.progress.getScope();
  appServices.progress.saveSession(serializePracticeSession(session));
  activeSession = session;
  activeSessionScope = scope;
  activeSessionPersisted = appServices.progress.restoreSession();
  sessionScopes.set(session.id, scope);
  if (session.mode === 'sequential') {
    const key = sequentialCertificateKeyForSession(session);
    if (key) appServices.progress.saveSequentialSession(key, activeSessionPersisted);
  }
  return session;
};

const withRandomStart = (generation: number, work: () => Promise<PracticeSession | null>) => {
  if (randomStart?.generation === generation) return randomStart.promise;
  const started = work().finally(() => {
    if (randomStart?.promise === started) randomStart = null;
  });
  randomStart = { generation, promise: started };
  return started;
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

const preparePractice = async (
  input: StartPracticeInput,
  generation: number,
): Promise<PracticeSession | null> => {
  const scope = appServices.progress.getScope();
  const candidates = await loadCandidates(input);
  if (!isCurrentStart(scope, generation)) return null;
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
    if (!isCurrentStart(scope, generation)) return null;
    return saveAuthorizedRandomStart(session, session.id, JSON.stringify(input));
  }
  const preference = appServices.progress.getPreferences().answerRevealMode;
  const session = createPracticeSession(paper, {
    mode: input.mode,
    answerRevealMode: resolveAnswerRevealMode(input.mode, preference),
    now: Date.now(),
  });
  if (!isCurrentStart(scope, generation)) return null;
  return saveStartedPractice(session);
};

const selectNextUnanswered = (session: PracticeSession): PracticeSession => {
  const fromCurrent = session.questionIds.findIndex(
    (questionId, index) => index >= session.currentIndex && !session.answers[questionId],
  );
  const beforeCurrent = session.questionIds.findIndex(
    (questionId, index) => index < session.currentIndex && !session.answers[questionId],
  );
  const currentIndex =
    fromCurrent >= 0
      ? fromCurrent
      : beforeCurrent >= 0
        ? beforeCurrent
        : session.questionIds.length - 1;
  return { ...session, currentIndex };
};

const restoreSequentialSession = (
  persisted: PersistedPracticeSession,
  candidates: readonly Question[],
): PracticeSession | null => {
  const repaired = prunePersistedPracticeSession(persisted, candidates);
  if (!repaired) return null;
  return selectNextUnanswered(rehydratePracticeSession(repaired, candidates));
};

const startSequentialPractice = async (
  input: StartPracticeInput,
  generation: number,
): Promise<PracticeSession | null> => {
  const scope = appServices.progress.getScope();
  const key = certificateKeyFor(input.occupation, input.level);
  const candidates = await loadCandidates(input);
  if (!isCurrentStart(scope, generation)) return null;
  const orderedCandidates = sequentialCandidates(candidates, []);
  if (!orderedCandidates.length) return null;

  const backup = appServices.progress.restoreSequentialSession(key);
  const active = appServices.progress.restoreSession();
  if (backup && !sessionHasRemainingBankQuestions(backup, orderedCandidates)) {
    appServices.progress.saveSequentialSession(key, null);
  }
  const persisted = [
    backup && sessionHasRemainingBankQuestions(backup, orderedCandidates) ? backup : null,
    active && sessionBelongsToCurrentBank(active, orderedCandidates) ? active : null,
  ]
    .filter((session): session is PersistedPracticeSession => session !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

  if (persisted) {
    const restored = restoreSequentialSession(persisted, orderedCandidates);
    if (restored) {
      if (!isCurrentStart(scope, generation)) return null;
      saveStartedPractice(restored);
      if (restored.status === 'active') return restored;
      if (!restored.progressRecorded) recordActivePractice();
      if (!isCurrentStart(scope, generation)) return null;
    } else {
      appServices.progress.saveSequentialSession(key, null);
    }
  }

  const remaining = sequentialCandidates(
    orderedCandidates,
    appServices.progress.listCompletedQuestionIds(),
  );
  if (!remaining.length || !isCurrentStart(scope, generation)) return null;
  const preference = appServices.progress.getPreferences().answerRevealMode;
  const session = createPracticeSession(remaining.slice(0, 20), {
    mode: 'sequential',
    answerRevealMode: resolveAnswerRevealMode('sequential', preference),
    now: Date.now(),
  });
  if (!isCurrentStart(scope, generation)) return null;
  return saveStartedPractice(session);
};

const withSequentialStart = (
  input: StartPracticeInput,
  generation: number,
  work: () => Promise<PracticeSession | null>,
): Promise<PracticeSession | null> => {
  const key = `${appServices.progress.getScope()}:${input.occupation}:${input.level}`;
  const pending = sequentialStarts.get(key);
  if (pending?.generation === generation) return pending.promise;
  const started = work().finally(() => {
    if (sequentialStarts.get(key)?.promise === started) sequentialStarts.delete(key);
  });
  sequentialStarts.set(key, { generation, promise: started });
  return started;
};

export const startPractice = (input: StartPracticeInput): Promise<PracticeSession | null> => {
  const sequentialKey = `${appServices.progress.getScope()}:${input.occupation}:${input.level}`;
  const pendingSequential =
    input.mode === 'sequential' ? sequentialStarts.get(sequentialKey) : null;
  if (pendingSequential?.generation === startGeneration) return pendingSequential.promise;
  if (input.mode === 'random' && randomStart?.generation === startGeneration) {
    return randomStart.promise;
  }
  const generation = beginStart();
  if (input.mode === 'random')
    return withRandomStart(generation, () => preparePractice(input, generation));
  if (input.mode === 'sequential') {
    return withSequentialStart(input, generation, () => startSequentialPractice(input, generation));
  }
  return preparePractice(input, generation);
};

/** Capture cancellation for the start that was just requested by this page. */
export const getPracticeStartCancellation = (): (() => void) => {
  const generation = startGeneration;
  return () => {
    if (generation === startGeneration) beginStart();
  };
};

export const startRandomPracticeFromQuestions = (
  questions: readonly Question[],
): Promise<PracticeSession | null> => {
  if (randomStart?.generation === startGeneration) return randomStart.promise;
  const generation = beginStart();
  return withRandomStart(generation, async () => {
    if (!questions.length) return null;
    const scope = appServices.progress.getScope();
    const session = await authorizeRandomStart(
      questions,
      `retry:${questions.map(({ id }) => id).join(',')}`,
    );
    if (!isCurrentStart(scope, generation)) return null;
    return saveAuthorizedRandomStart(
      session,
      session.id,
      `retry:${questions.map(({ id }) => id).join(',')}`,
    );
  });
};

export const startPracticeFromQuestions = (
  questions: readonly Question[],
  mode: PracticeMode,
): PracticeSession | null => {
  if (mode === 'random') throw new Error('随机练习必须通过云端授权后开始。');
  if (!questions.length) return null;
  beginStart();
  const preference = appServices.progress.getPreferences().answerRevealMode;
  activeSession = createPracticeSession(questions.slice(0, 20), {
    mode,
    answerRevealMode: resolveAnswerRevealMode(mode, preference),
    now: Date.now(),
  });
  return saveStartedPractice(activeSession);
};

export const restorePractice = async (resumePending = false): Promise<PracticeSession | null> => {
  const generation = beginStart();
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
    return withRandomStart(generation, async () => {
      if (!isCurrentRestoredSession(scope, persisted, generation)) return null;
      const session = await authorizeRandomStart([], pending.key);
      const latest = getPendingRandomStart();
      if (
        !isCurrentRestoredSession(scope, persisted, generation) ||
        latest?.id !== pending.id ||
        latest?.key !== pending.key
      )
        return null;
      return saveAuthorizedRandomStart(session, pending.id, pending.key);
    });
  }
  if (!persisted) return null;
  const questions = await appServices.questions.getByIds(persisted.questionIds);
  if (!isCurrentRestoredSession(scope, persisted, generation)) return null;
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
    if (!isCurrentRestoredSession(scope, persisted, generation)) return null;
  }
  if (!isCurrentRestoredSession(scope, persisted, generation)) return null;
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
  const answeredQuestions =
    session.mode === 'sequential'
      ? session.questions.filter((question) => Boolean(session.answers[question.id]?.length))
      : session.questions;
  const durationPerQuestion = answeredQuestions.length
    ? Math.floor(report.durationMs / answeredQuestions.length)
    : 0;
  const records = answeredQuestions.map((question, index) => ({
    questionId: question.id,
    correct: session.feedback[question.id]?.correct ?? false,
    durationMs:
      index === answeredQuestions.length - 1
        ? report.durationMs - durationPerQuestion * (answeredQuestions.length - 1)
        : durationPerQuestion,
    at: localDateKey(),
  }));
  if (records.length) appServices.progress.recordPracticeResults(session.id, records, session.mode);
  activeSession = { ...session, progressRecorded: true };
  saveStartedPractice(activeSession);
  return activeSession;
};
