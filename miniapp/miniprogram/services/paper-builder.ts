import { PRACTICE_QUESTION_LIMITS, QUESTION_TYPES } from '../types/domain';
import type { PracticeMode, PracticeQuestionLimit, Question, QuestionType } from '../types/domain';

export interface BuildPaperOptions {
  mode: PracticeMode;
  limit?: PracticeQuestionLimit;
  questionTypes?: QuestionType[];
  module?: string;
  chapterId?: string;
  sectionId?: string;
  random?: () => number;
}

const practiceQuestionLimits = new Set<number>(PRACTICE_QUESTION_LIMITS);
const questionTypes = new Set<string>(QUESTION_TYPES);

const shuffle = (questions: Question[], random: () => number): Question[] => {
  const shuffled = [...questions];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    if (swapIndex < 0 || swapIndex > index) {
      throw new Error('random must return a value between 0 and 1');
    }
    const current = shuffled[index];
    const swap = shuffled[swapIndex];
    if (!current || !swap) continue;
    shuffled[index] = swap;
    shuffled[swapIndex] = current;
  }
  return shuffled;
};

export const buildPaper = (
  questions: readonly Question[],
  options: BuildPaperOptions,
): Question[] => {
  const limit = options.limit ?? (options.mode === 'mock' ? 50 : 20);
  if (!practiceQuestionLimits.has(limit)) {
    throw new Error('paper limit must be 10, 20, 30, or 50');
  }
  if (options.questionTypes?.some((questionType) => !questionTypes.has(questionType))) {
    throw new Error('paper contains an unsupported question type filter');
  }

  const selectedTypes = options.questionTypes ? new Set(options.questionTypes) : null;
  const candidates = questions.filter((question) => {
    if (options.chapterId && question.chapterId !== options.chapterId) return false;
    if (options.sectionId && question.sectionId !== options.sectionId) return false;
    if (options.module && question.module !== options.module) return false;
    if (selectedTypes && !selectedTypes.has(question.type)) return false;
    return true;
  });
  const shouldShuffle = options.mode === 'random' || options.mode === 'mock';
  const ordered = shouldShuffle ? shuffle(candidates, options.random ?? Math.random) : candidates;

  return ordered.slice(0, Math.min(limit, ordered.length));
};
