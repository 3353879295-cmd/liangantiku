import { describe, expect, it } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import { presentDashboard } from '../miniprogram/presenters/home-presenter';
import {
  groupCertificates,
  presentLibraryModules,
} from '../miniprogram/presenters/library-presenter';
import { presentQuestionOption } from '../miniprogram/presenters/question-option-presenter';
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
