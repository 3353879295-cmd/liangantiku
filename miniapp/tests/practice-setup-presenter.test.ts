import { describe, expect, it } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import {
  presentMockPracticeInfo,
  presentRandomPracticeSetup,
} from '../miniprogram/presenters/practice-setup-presenter';
import type { CertificateKey, QuestionType } from '../miniprogram/types/domain';
import { makeQuestion } from './factories';

const requireCertificate = (key: CertificateKey) => {
  const certificate = CERTIFICATES.find((item) => item.key === key);
  if (!certificate) throw new Error(`missing certificate fixture: ${key}`);
  return certificate;
};

const availableCertificate = requireCertificate('4-02-06-01:5');
const comingSoonCertificate = requireCertificate('4-02-06-01:2');
const questionTypes: QuestionType[] = [
  'single',
  'single',
  'single',
  'single',
  'single',
  'single',
  'multiple',
  'multiple',
  'judge',
  'judge',
  'judge',
  'judge',
];
const questions = questionTypes.map((type, index) => makeQuestion({ id: `Q${index + 1}`, type }));

describe('random practice setup presenter', () => {
  it('offers only 10, 20, and 30 while disabling counts above the filtered inventory', () => {
    const view = presentRandomPracticeSetup({
      certificate: availableCertificate,
      questions,
      limit: 10,
      questionTypes: [],
    });

    expect(view.availableQuestionCount).toBe(12);
    expect(view.countOptions).toEqual([
      { value: 10, label: '10 题', selected: true, disabled: false },
      { value: 20, label: '20 题', selected: false, disabled: true },
      { value: 30, label: '30 题', selected: false, disabled: true },
    ]);
    expect(view.countOptions.some(({ value }) => value === (50 as number))).toBe(false);
    expect(view.canStart).toBe(true);
  });

  it('counts selected whitelisted types and refuses a type absent from the current bank', () => {
    const selected = presentRandomPracticeSetup({
      certificate: availableCertificate,
      questions,
      limit: 10,
      questionTypes: ['single', 'judge'],
    });
    const unavailable = presentRandomPracticeSetup({
      certificate: availableCertificate,
      questions,
      limit: 10,
      questionTypes: ['case'],
    });

    expect(selected.availableQuestionCount).toBe(10);
    expect(selected.typeOptions.find(({ value }) => value === 'single')?.selected).toBe(true);
    expect(selected.typeOptions.find(({ value }) => value === 'multiple')?.selected).toBe(false);
    expect(selected.summaryText).toContain('单选题、判断题');
    expect(selected.canStart).toBe(true);

    expect(unavailable.availableQuestionCount).toBe(0);
    expect(unavailable.typeOptions.find(({ value }) => value === 'case')).toMatchObject({
      selected: true,
      disabled: true,
      count: 0,
    });
    expect(unavailable.canStart).toBe(false);
  });

  it('never starts a coming-soon certificate even if stale questions are supplied', () => {
    const randomView = presentRandomPracticeSetup({
      certificate: comingSoonCertificate,
      questions,
      limit: 10,
      questionTypes: [],
    });
    const mockView = presentMockPracticeInfo(comingSoonCertificate, questions.length);

    expect(randomView.canStart).toBe(false);
    expect(mockView.canStart).toBe(false);
    expect(mockView.statusText).toBe('该等级题库待补充');
  });
});

describe('mock practice info presenter', () => {
  it('reports the actual possible count and the pre-submit feedback policy', () => {
    const view = presentMockPracticeInfo(availableCertificate, 61);

    expect(view.questionCount).toBe(50);
    expect(view.questionCountText).toBe('本次可生成 50 题');
    expect(view.canStart).toBe(true);
    expect(view.policy).toEqual({
      revealFeedbackBeforeSubmit: false,
      allowAnswerChangesBeforeSubmit: true,
      revealAnalysisAfterSubmit: true,
      gradeUnansweredAsWrong: true,
    });
  });

  it('uses the bank count when fewer than 50 questions can be generated', () => {
    expect(presentMockPracticeInfo(availableCertificate, 12)).toMatchObject({
      questionCount: 12,
      questionCountText: '本次可生成 12 题',
      canStart: true,
    });
    expect(presentMockPracticeInfo(availableCertificate, 0)).toMatchObject({
      questionCount: 0,
      canStart: false,
      statusText: '该等级题库待补充',
    });
  });
});
