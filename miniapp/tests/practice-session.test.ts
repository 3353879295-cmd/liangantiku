import { describe, expect, it } from 'vitest';

import {
  answerQuestion,
  createPracticeSession,
  getAnswerSheet,
  navigateToQuestion,
  submitSession,
} from '../miniprogram/services/practice-session';
import { makeQuestion } from './factories';

describe('practice session', () => {
  it('shows immediate feedback in normal practice', () => {
    const question = makeQuestion();
    const session = createPracticeSession([question], { mode: 'sequential', now: 1000 });

    const answered = answerQuestion(session, question.id, ['A'], 1500);

    expect(answered.feedback[question.id]).toMatchObject({ correct: true });
    expect(getAnswerSheet(answered)).toEqual([{ questionId: question.id, status: 'correct' }]);
  });

  it('hides mock feedback until submission', () => {
    const question = makeQuestion();
    const session = createPracticeSession([question], { mode: 'mock', now: 1000 });

    const answered = answerQuestion(session, question.id, ['A'], 1500);

    expect(answered.feedback[question.id]).toBeUndefined();
    expect(getAnswerSheet(answered)[0]).toEqual({ questionId: question.id, status: 'answered' });

    const submitted = submitSession(answered, 2500);
    expect(submitted.status).toBe('submitted');
    expect(submitted.feedback[question.id]).toMatchObject({ correct: true });
    expect(submitted.report).toMatchObject({
      total: 1,
      correct: 1,
      wrong: 0,
      durationMs: 1500,
      wrongQuestionIds: [],
    });
  });

  it('allows mock answers to change before submission', () => {
    const question = makeQuestion({ answer: ['B'] });
    const session = createPracticeSession([question], { mode: 'mock', now: 1000 });
    const firstAnswer = answerQuestion(session, question.id, ['A'], 1200);
    const changedAnswer = answerQuestion(firstAnswer, question.id, ['B'], 1400);

    const submitted = submitSession(changedAnswer, 2000);

    expect(submitted.report?.correct).toBe(1);
    expect(submitted.answers[question.id]).toEqual(['B']);
  });

  it('navigates by validated question index', () => {
    const questions = [makeQuestion({ id: 'Q1' }), makeQuestion({ id: 'Q2' })];
    const session = createPracticeSession(questions, { mode: 'sequential', now: 1000 });

    expect(navigateToQuestion(session, 1, 1200).currentIndex).toBe(1);
    expect(() => navigateToQuestion(session, 2, 1200)).toThrow(/index/);
  });

  it('prevents changes after submission', () => {
    const question = makeQuestion();
    const session = createPracticeSession([question], { mode: 'mock', now: 1000 });
    const submitted = submitSession(answerQuestion(session, question.id, ['A'], 1200), 2000);

    expect(() => answerQuestion(submitted, question.id, ['B'], 3000)).toThrow(/已交卷/);
    expect(() => submitSession(submitted, 3000)).toThrow(/已交卷/);
  });

  it('rejects an empty paper', () => {
    expect(() => createPracticeSession([], { mode: 'random', now: 1000 })).toThrow(/empty/);
  });
});
