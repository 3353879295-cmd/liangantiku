import { WechatStorageAdapter } from '../storage/storage-adapter';
import type { AnswerRevealMode, Question } from '../types/domain';
import { appServices } from './app-services';
import { createPracticeSession } from './practice-session';
import type { PracticeSession } from './practice-session';

const PENDING_KEY = 'membership.pending-random.v1';
const storage = new WechatStorageAdapter();

export interface PendingRandomStart {
  key: string;
  id: string;
  questionIds: string[];
  now: number;
  answerRevealMode: AnswerRevealMode;
}

const isPendingStart = (value: unknown): value is PendingRandomStart => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.key === 'string' &&
    typeof item.id === 'string' &&
    item.id.length <= 128 &&
    Array.isArray(item.questionIds) &&
    item.questionIds.length > 0 &&
    item.questionIds.length <= 10 &&
    item.questionIds.every((id: unknown) => typeof id === 'string' && id.length > 0) &&
    new Set(item.questionIds).size === item.questionIds.length &&
    typeof item.now === 'number' &&
    Number.isFinite(item.now) &&
    (item.answerRevealMode === 'immediate' || item.answerRevealMode === 'deferred')
  );
};

export const getPendingRandomStart = (): PendingRandomStart | null => {
  const pending = storage.get<unknown>(PENDING_KEY);
  return isPendingStart(pending) ? pending : null;
};

// Pending data never grants access.
export const authorizeRandomStart = async (
  paper: readonly Question[],
  key: string,
): Promise<PracticeSession> => {
  const scope = appServices.progress.getScope();
  const saved = getPendingRandomStart();
  let pending: PendingRandomStart;
  let questions: readonly Question[] = paper.slice(0, 10);
  if (saved?.key === key) {
    const restored = await appServices.questions.getByIds(saved.questionIds);
    const byId = new Map(restored.map((question) => [question.id, question]));
    if (saved.questionIds.some((id) => !byId.has(id))) {
      throw new Error('待恢复随机练习的题目已更新，已保留恢复记录，请在题库恢复后重试。');
    }
    questions = saved.questionIds.map((id) => byId.get(id)!);
    pending = saved;
  } else {
    if (saved) throw new Error('请先恢复上次随机练习。');
    const now = Date.now();
    pending = {
      key,
      id: `random-${now}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`,
      questionIds: questions.map((question) => question.id),
      now,
      answerRevealMode: appServices.progress.getPreferences().answerRevealMode,
    };
    // Persist first to reuse the server grant after a lost response.
    storage.set(PENDING_KEY, pending);
  }
  if (appServices.progress.getScope() !== scope) throw new Error('学习账号状态已变化，请重试。');
  await appServices.membership.startRandomPractice(pending.id, pending.questionIds);
  if (appServices.progress.getScope() !== scope) throw new Error('学习账号状态已变化，请重试。');
  return createPracticeSession(questions, {
    id: pending.id,
    mode: 'random',
    now: pending.now,
    answerRevealMode: pending.answerRevealMode,
  });
};

export const finishRandomStart = (id: string, key: string): void => {
  const pending = getPendingRandomStart();
  if (pending?.id === id && pending.key === key) storage.remove(PENDING_KEY);
};
