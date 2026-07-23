import { describe, expect, it } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import { presentDashboard } from '../miniprogram/presenters/home-presenter';
import {
  groupCertificates,
  presentLibraryModules,
} from '../miniprogram/presenters/library-presenter';
import { presentQuestionOption } from '../miniprogram/presenters/question-option-presenter';
import { presentQuestionList } from '../miniprogram/presenters/question-list-presenter';
import { presentReport } from '../miniprogram/presenters/report-presenter';
import { makeQuestion } from './factories';

describe('presentDashboard', () => {
  it('formats an untouched learning dashboard without dividing by zero', () => {
    expect(
      presentDashboard({
        answered: 0,
        correct: 0,
        accuracy: 0,
        durationMs: 0,
        streakDays: 0,
        todayAnswered: 0,
        dailyGoal: 20,
      }),
    ).toMatchObject({
      accuracyText: '0%',
      durationText: '0 分钟',
      streakText: '从今天开始',
      goalText: '0 / 20 题',
      goalPercent: 0,
    });
  });

  it('caps the displayed goal progress and describes a resumable session', () => {
    expect(
      presentDashboard(
        {
          answered: 36,
          correct: 27,
          accuracy: 75,
          durationMs: 5_400_000,
          streakDays: 4,
          todayAnswered: 24,
          dailyGoal: 20,
        },
        { currentIndex: 6, total: 20 },
      ),
    ).toMatchObject({
      accuracyText: '75%',
      durationText: '1 小时 30 分',
      streakText: '连续 4 天',
      goalText: '24 / 20 题',
      goalPercent: 100,
      resumeText: '继续第 7 题 · 共 20 题',
    });
  });
});

describe('library presenters', () => {
  it('groups the six certificates by occupation', () => {
    const groups = groupCertificates(CERTIFICATES);

    expect(groups.map((group) => group.items.length)).toEqual([3, 3]);
    expect(groups.map((group) => group.title)).toEqual(['储粮保管员', '粮油质检员']);
  });

  it('sorts modules by first appearance and includes their counts', () => {
    const modules = presentLibraryModules([
      makeQuestion({ id: 'Q1', module: '粮情检查' }),
      makeQuestion({ id: 'Q2', module: '安全生产' }),
      makeQuestion({ id: 'Q3', module: '粮情检查' }),
    ]);

    expect(modules).toEqual([
      { name: '粮情检查', count: 2, countText: '2 题' },
      { name: '安全生产', count: 1, countText: '1 题' },
    ]);
  });
});

describe('presentReport', () => {
  it('formats the score, time and weakest module', () => {
    const report = presentReport({
      total: 10,
      correct: 7,
      wrong: 3,
      durationMs: 125_000,
      wrongQuestionIds: ['Q1', 'Q2', 'Q3'],
      modules: {
        粮情检查: { total: 4, correct: 1 },
        安全生产: { total: 6, correct: 6 },
      },
    });

    expect(report).toMatchObject({
      scoreText: '70',
      accuracyText: '70%',
      durationText: '02:05',
    });
    expect(report.weakModules[0]).toMatchObject({ name: '粮情检查', accuracyText: '25%' });
  });
});

describe('presentQuestionList', () => {
  const questions = [
    makeQuestion({ id: 'Q1', occupation: '4-02-06-01', level: 5, module: '粮情检查' }),
    makeQuestion({ id: 'Q2', occupation: '4-08-05-01', level: 3, module: '样品检验' }),
    makeQuestion({ id: 'Q3', occupation: '4-02-06-01', level: 3, module: '安全生产' }),
  ];

  it('retains favorite ID order, reports retired IDs and applies certificate filters', () => {
    const view = presentQuestionList({
      kind: 'favorite',
      questions,
      ids: ['Q2', 'retired', 'Q1'],
      filter: { occupation: '4-02-06-01', level: 5 },
    });

    expect(view.items.map((item) => item.question.id)).toEqual(['Q1']);
    expect(view.items[0]?.id).toBe('Q1');
    expect(view.unresolvedIds).toEqual(['retired']);
  });

  it('sorts wrong questions, hides mastered records and filters modules', () => {
    const view = presentQuestionList({
      kind: 'wrong',
      questions,
      ids: ['Q1', 'Q2', 'Q3'],
      wrongRecords: [
        {
          questionId: 'Q1',
          errorCount: 2,
          firstWrongAt: '2026-07-20',
          lastWrongAt: '2026-07-22',
          mastered: false,
          lastRetryCorrect: false,
        },
        {
          questionId: 'Q2',
          errorCount: 5,
          firstWrongAt: '2026-07-20',
          lastWrongAt: '2026-07-23',
          mastered: true,
          lastRetryCorrect: true,
        },
        {
          questionId: 'Q3',
          errorCount: 3,
          firstWrongAt: '2026-07-20',
          lastWrongAt: '2026-07-21',
          mastered: false,
          lastRetryCorrect: false,
        },
      ],
      filter: { module: '粮情检查', includeMastered: false },
    });

    expect(view.items.map((item) => item.question.id)).toEqual(['Q1']);
    expect(view.items[0]).toMatchObject({ errorCountText: '错 2 次', latestText: '最近 07-22' });
  });

  it('provides useful empty copy for each list kind', () => {
    expect(presentQuestionList({ kind: 'wrong', questions: [], ids: [] }).emptyTitle).toBe(
      '还没有错题',
    );
    expect(presentQuestionList({ kind: 'favorite', questions: [], ids: [] }).emptyTitle).toBe(
      '还没有收藏',
    );
  });
});

describe('presentQuestionOption', () => {
  it('shows a selected option before submission', () => {
    expect(
      presentQuestionOption({ key: 'A', selected: true, submitted: false, correctKeys: [] }),
    ).toEqual({ selected: true, state: 'selected', disabled: false });
  });

  it('marks a selected wrong option after submission', () => {
    expect(
      presentQuestionOption({ key: 'A', selected: true, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: true, state: 'wrong', disabled: true });
  });

  it('reveals the correct option after submission', () => {
    expect(
      presentQuestionOption({ key: 'B', selected: false, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: false, state: 'correct', disabled: true });
  });

  it('keeps unrelated options neutral after submission', () => {
    expect(
      presentQuestionOption({ key: 'C', selected: false, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: false, state: 'neutral', disabled: true });
  });
});
