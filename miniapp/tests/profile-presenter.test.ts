import { describe, expect, it } from 'vitest';

import {
  presentActivityBars,
  presentLearningReport,
} from '../miniprogram/presenters/profile-presenter';

describe('profile presenter', () => {
  it('scales seven-day activity against the busiest real day without hiding zero days', () => {
    expect(
      presentActivityBars([
        { date: '2026-07-24', answered: 0, correct: 0, durationMs: 0 },
        { date: '2026-07-25', answered: 2, correct: 1, durationMs: 1_000 },
        { date: '2026-07-26', answered: 4, correct: 3, durationMs: 2_000 },
      ]),
    ).toEqual([
      { date: '2026-07-24', label: '07/24', answered: 0, height: 4 },
      { date: '2026-07-25', label: '07/25', answered: 2, height: 50 },
      { date: '2026-07-26', label: '07/26', answered: 4, height: 100 },
    ]);
  });

  it('withholds invented statistics when the learner has no answer history', () => {
    const report = presentLearningReport({
      dashboard: {
        answered: 0,
        correct: 0,
        accuracy: 0,
        durationMs: 0,
        streakDays: 0,
        todayAnswered: 0,
        dailyGoal: 20,
      },
      activity: [],
      chapters: [
        {
          id: 'chapter-unstarted',
          numberText: '1',
          title: '未开始章节',
          progress: { completed: 0, attempts: 0, correctAttempts: 0, wrongQuestions: 0 },
        },
      ],
    });

    expect(report).toMatchObject({
      hasLearningData: false,
      answeredText: '',
      accuracyText: '',
      durationText: '',
      streakText: '',
      weakChapters: [],
    });
  });

  it('ranks only attempted current-catalog chapters by real accuracy and active wrong count', () => {
    const report = presentLearningReport({
      dashboard: {
        answered: 6,
        correct: 3,
        accuracy: 50,
        durationMs: 90_000,
        streakDays: 2,
        todayAnswered: 1,
        dailyGoal: 20,
      },
      activity: [],
      chapters: [
        {
          id: 'chapter-a',
          numberText: '3',
          title: '粮油出入库作业',
          progress: { completed: 2, attempts: 3, correctAttempts: 1, wrongQuestions: 2 },
        },
        {
          id: 'chapter-b',
          numberText: '4',
          title: '粮情检查',
          progress: { completed: 2, attempts: 2, correctAttempts: 2, wrongQuestions: 0 },
        },
        {
          id: 'chapter-c',
          numberText: '5',
          title: '粮情控制',
          progress: { completed: 1, attempts: 1, correctAttempts: 0, wrongQuestions: 1 },
        },
        {
          id: 'chapter-unstarted',
          numberText: '6',
          title: '未开始章节',
          progress: { completed: 0, attempts: 0, correctAttempts: 0, wrongQuestions: 0 },
        },
      ],
    });

    expect(report).toMatchObject({
      hasLearningData: true,
      answeredText: '6',
      accuracyText: '50%',
      durationText: '1 分钟',
      streakText: '连续 2 天',
      weakChapters: [
        {
          id: 'chapter-c',
          title: '第 5 章 粮情控制',
          accuracyText: '0%',
          attemptsText: '练习 1 次',
          wrongText: '1 题待巩固',
        },
        {
          id: 'chapter-a',
          title: '第 3 章 粮油出入库作业',
          accuracyText: '33%',
          attemptsText: '练习 3 次',
          wrongText: '2 题待巩固',
        },
        {
          id: 'chapter-b',
          title: '第 4 章 粮情检查',
          accuracyText: '100%',
          attemptsText: '练习 2 次',
          wrongText: '暂无待巩固错题',
        },
      ],
    });
  });
});
