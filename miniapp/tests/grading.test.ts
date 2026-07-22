import { describe, expect, it } from 'vitest';

import { gradeQuestion } from '../miniprogram/services/grading';
import type { QuestionType } from '../miniprogram/types/domain';
import { makeQuestion } from './factories';

describe('gradeQuestion', () => {
  it.each<[QuestionType, string[], string[], boolean]>([
    ['single', ['A'], ['A'], true],
    ['multiple', ['C', 'A'], ['A', 'C'], true],
    ['multiple', ['A'], ['A', 'C'], false],
    ['judge', ['B'], ['A'], false],
    ['case', ['B'], ['B'], true],
  ])('grades %s by answer-key set', (type, selected, answer, correct) => {
    const question = makeQuestion({ type, answer });

    expect(gradeQuestion(question, selected)).toEqual({
      correct,
      selected: [...new Set(selected)].sort(),
      expected: [...new Set(answer)].sort(),
    });
  });

  it('does not accept duplicated selected keys as extra answers', () => {
    const question = makeQuestion({ answer: ['A'] });

    expect(gradeQuestion(question, ['A', 'A']).correct).toBe(true);
  });
});
