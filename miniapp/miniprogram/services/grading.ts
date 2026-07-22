import type { GradeResult, Question } from '../types/domain';

const normalizeAnswerKeys = (keys: string[]): string[] => [...new Set(keys)].sort();

export const gradeQuestion = (question: Question, selectedIds: string[]): GradeResult => {
  const selected = normalizeAnswerKeys(selectedIds);
  const expected = normalizeAnswerKeys(question.answer);
  const correct =
    selected.length === expected.length &&
    selected.every((selectedKey, index) => selectedKey === expected[index]);

  return { correct, selected, expected };
};
