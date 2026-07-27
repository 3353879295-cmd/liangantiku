import { describe, expect, it } from 'vitest';

import {
  answerQuestion,
  confirmQuestionAnswer,
  createPracticeSession,
  getAnswerSheet,
  navigateToQuestion,
  prunePersistedPracticeSession,
  rehydratePracticeSession,
  serializePracticeSession,
  submitSession,
} from '../miniprogram/services/practice-session';
import { presentQuestionOption } from '../miniprogram/presenters/question-option-presenter';
import { makeQuestion } from './factories';

describe('practice session', () => {
  it('defaults current non-mock sessions to immediate reveal', () => {
    const session = createPracticeSession([makeQuestion()], {
      mode: 'sequential',
      now: 1000,
    });

    expect(session.answerRevealMode).toBe('immediate');
    expect(serializePracticeSession(session).answerRevealMode).toBe('immediate');
  });

  it('forces mock sessions to deferred reveal even when immediate is requested', () => {
    const question = makeQuestion();
    const session = createPracticeSession([question], {
      mode: 'mock',
      now: 1000,
      answerRevealMode: 'immediate',
    });
    const persisted = serializePracticeSession(session);
    const restored = rehydratePracticeSession(persisted, [question]);

    expect(session.answerRevealMode).toBe('deferred');
    expect(persisted.answerRevealMode).toBe('deferred');
    expect(restored.answerRevealMode).toBe('deferred');
  });

  it('keeps a requested deferred reveal mode for current non-mock sessions', () => {
    const question = makeQuestion();
    const session = createPracticeSession([question], {
      mode: 'random',
      now: 1000,
      answerRevealMode: 'deferred',
    });
    const answered = answerQuestion(session, question.id, ['A'], 1200);

    expect(answered.answerRevealMode).toBe('deferred');
    expect(answered.feedback).toEqual({});
    expect(serializePracticeSession(answered).answerRevealMode).toBe('deferred');
  });

  it('uses immediate session policy to reveal feedback for current non-mock sessions', () => {
    const question = makeQuestion();
    const session = createPracticeSession([question], {
      mode: 'sequential',
      now: 1000,
      answerRevealMode: 'immediate',
    });

    const answered = answerQuestion(session, question.id, ['A'], 1200);

    expect(answered.feedback[question.id]?.correct).toBe(true);
  });

  it('restores active feedback only for sessions locked to immediate reveal', () => {
    const question = makeQuestion();
    const createAnswered = (answerRevealMode: 'immediate' | 'deferred') =>
      answerQuestion(
        createPracticeSession([question], {
          mode: 'sequential',
          answerRevealMode,
          now: 1000,
        }),
        question.id,
        ['A'],
        1200,
      );

    const immediate = rehydratePracticeSession(
      serializePracticeSession(createAnswered('immediate')),
      [question],
    );
    const deferred = rehydratePracticeSession(
      serializePracticeSession(createAnswered('deferred')),
      [question],
    );

    expect(immediate.answerRevealMode).toBe('immediate');
    expect(immediate.feedback[question.id]?.correct).toBe(true);
    expect(deferred.answerRevealMode).toBe('deferred');
    expect(deferred.feedback).toEqual({});
  });

  it('restores complete feedback after a deferred session is submitted', () => {
    const question = makeQuestion();
    const submitted = submitSession(
      answerQuestion(
        createPracticeSession([question], {
          mode: 'sequential',
          answerRevealMode: 'deferred',
          now: 1000,
        }),
        question.id,
        ['A'],
        1200,
      ),
      1600,
    );

    const restored = rehydratePracticeSession(serializePracticeSession(submitted), [question]);

    expect(restored.status).toBe('submitted');
    expect(restored.answerRevealMode).toBe('deferred');
    expect(restored.feedback[question.id]?.correct).toBe(true);
  });

  it('shows immediate feedback in normal practice', () => {
    const question = makeQuestion({ id: 'Q1' });
    const questions = [question, makeQuestion({ id: 'Q2' })];
    const session = createPracticeSession(questions, { mode: 'sequential', now: 1000 });

    const answered = confirmQuestionAnswer(session, question.id, ['A'], 1500);

    expect(answered.currentIndex).toBe(0);
    expect(answered.feedback[question.id]).toMatchObject({ correct: true });
    expect(getAnswerSheet(answered)).toEqual([
      { questionId: 'Q1', status: 'answered' },
      { questionId: 'Q2', status: 'unanswered' },
    ]);
  });

  it('hides mock feedback until submission', () => {
    const question = makeQuestion();
    const session = createPracticeSession([question], { mode: 'mock', now: 1000 });

    const answered = answerQuestion(session, question.id, ['A'], 1500);
    const revealBeforeSubmit = answered.status === 'submitted';

    expect(answered.feedback[question.id]).toBeUndefined();
    expect(getAnswerSheet(answered)[0]).toEqual({ questionId: question.id, status: 'answered' });
    expect(
      presentQuestionOption({
        key: 'A',
        selected: true,
        revealAnswer: revealBeforeSubmit,
        correctKeys: question.answer,
      }),
    ).toEqual({ selected: true, state: 'selected', disabled: false });

    const submitted = submitSession(answered, 2500);
    const revealAfterSubmit = submitted.status === 'submitted';
    expect(submitted.status).toBe('submitted');
    expect(submitted.feedback[question.id]).toMatchObject({ correct: true });
    expect(
      presentQuestionOption({
        key: 'A',
        selected: true,
        revealAnswer: revealAfterSubmit,
        correctKeys: question.answer,
      }),
    ).toEqual({ selected: true, state: 'correct', disabled: true });
    expect(submitted.report).toMatchObject({
      total: 1,
      correct: 1,
      wrong: 0,
      durationMs: 1500,
      wrongQuestionIds: [],
    });
    expect(getAnswerSheet(submitted)).toEqual([{ questionId: question.id, status: 'correct' }]);
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

  it('confirms a non-final mock answer and advances in one operation', () => {
    const questions = [makeQuestion({ id: 'Q1' }), makeQuestion({ id: 'Q2' })];
    const session = createPracticeSession(questions, { mode: 'mock', now: 1000 });

    const confirmed = confirmQuestionAnswer(session, 'Q1', ['A'], 1200);

    expect(confirmed.currentIndex).toBe(1);
    expect(confirmed.answers['Q1']).toEqual(['A']);
    expect(confirmed.feedback['Q1']).toBeUndefined();
    expect(confirmed.status).toBe('active');
  });

  it('keeps the final mock answer on the last question without submitting', () => {
    const questions = [makeQuestion({ id: 'Q1' }), makeQuestion({ id: 'Q2' })];
    const onFinalQuestion = navigateToQuestion(
      createPracticeSession(questions, { mode: 'mock', now: 1000 }),
      1,
      1100,
    );

    const confirmed = confirmQuestionAnswer(onFinalQuestion, 'Q2', ['A'], 1200);

    expect(confirmed.currentIndex).toBe(1);
    expect(confirmed.answers['Q2']).toEqual(['A']);
    expect(confirmed.status).toBe('active');
    expect(confirmed.report).toBeUndefined();
  });

  it('defensively treats an empty in-memory selection as unanswered', () => {
    const question = makeQuestion({ id: 'Q-empty-selection' });
    const session = createPracticeSession([question], {
      mode: 'sequential',
      answerRevealMode: 'deferred',
      now: 1000,
    });

    expect(
      getAnswerSheet({
        ...session,
        answers: { [question.id]: [] },
      }),
    ).toEqual([{ questionId: question.id, status: 'unanswered' }]);
  });

  it('aggregates report progress by stable chapter ID', () => {
    const questions = [
      makeQuestion({
        id: 'Q1',
        chapterId: 'warehouse-l5-c04',
        module: '粮情检查',
      }),
      makeQuestion({
        id: 'Q2',
        chapterId: 'warehouse-l5-c04',
        module: '旧版粮情检查模块',
        answer: ['B'],
      }),
    ];
    const session = createPracticeSession(questions, { mode: 'mock', now: 1000 });
    const submitted = submitSession(
      answerQuestion(answerQuestion(session, 'Q1', ['A'], 1200), 'Q2', ['A'], 1300),
      2000,
    );

    expect(submitted.report?.chapters).toEqual({
      'warehouse-l5-c04': { total: 2, correct: 1 },
    });
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

  it('serializes and restores a submitted report without losing its recorded flag', () => {
    const question = makeQuestion();
    const session = submitSession(
      answerQuestion(
        createPracticeSession([question], { mode: 'mock', now: 1000 }),
        question.id,
        ['A'],
        1200,
      ),
      2000,
    );
    const recorded = { ...session, progressRecorded: true };

    const restored = rehydratePracticeSession(serializePracticeSession(recorded), [question]);

    expect(restored.status).toBe('submitted');
    expect(restored.report).toMatchObject({ total: 1, correct: 1 });
    expect(restored.progressRecorded).toBe(true);
  });

  it('prunes retired questions from a persisted session and clamps its position', () => {
    const available = makeQuestion({ id: 'Q1' });
    const persisted = serializePracticeSession(
      answerQuestion(
        navigateToQuestion(
          createPracticeSession([available, makeQuestion({ id: 'Q2' })], {
            mode: 'random',
            now: 1000,
          }),
          1,
          1100,
        ),
        'Q2',
        ['A'],
        1200,
      ),
    );

    expect(prunePersistedPracticeSession(persisted, [available])).toMatchObject({
      questionIds: ['Q1'],
      currentIndex: 0,
      answers: {},
      answerRevealMode: 'immediate',
    });
    expect(prunePersistedPracticeSession(persisted, [])).toBeNull();
  });
});
