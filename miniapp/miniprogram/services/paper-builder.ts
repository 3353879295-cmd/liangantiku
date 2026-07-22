import type { PracticeMode, Question } from '../types/domain';

export interface BuildPaperOptions {
  mode: PracticeMode;
  limit: number;
  module?: string;
  random?: () => number;
}

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
  if (!Number.isInteger(options.limit) || options.limit <= 0) {
    throw new Error('paper limit must be a positive integer');
  }

  const candidates = options.module
    ? questions.filter((question) => question.module === options.module)
    : [...questions];
  const shouldShuffle = options.mode === 'random' || options.mode === 'mock';
  const ordered = shouldShuffle ? shuffle(candidates, options.random ?? Math.random) : candidates;

  return ordered.slice(0, Math.min(options.limit, ordered.length));
};
