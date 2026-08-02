import { describe, expect, it } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import {
  buildRandomPracticeRoute,
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
  it('always presents a fixed ten-question all-type practice', () => {
    const view = presentRandomPracticeSetup({
      certificate: availableCertificate,
      questions,
    });

    expect(view).toEqual({
      bankTitle: availableCertificate.title,
      bankQuestionCount: 12,
      questionCount: 10,
      summaryText: '固定抽取 10 题 · 全部题型',
      statusText: '题目将从当前题库随机抽取',
      canStart: true,
    });
    expect(view.canStart).toBe(true);
  });

  it('does not silently reduce the fixed count when the bank has fewer than ten questions', () => {
    const view = presentRandomPracticeSetup({
      certificate: availableCertificate,
      questions: questions.slice(0, 8),
    });

    expect(view.questionCount).toBe(10);
    expect(view.summaryText).toBe('固定抽取 10 题 · 全部题型');
    expect(view.statusText).toBe('当前题库仅 8 题，暂不足 10 题');
    expect(view.canStart).toBe(false);
  });

  it('never starts a coming-soon certificate even if stale questions are supplied', () => {
    const randomView = presentRandomPracticeSetup({
      certificate: comingSoonCertificate,
      questions,
    });
    const mockView = presentMockPracticeInfo(comingSoonCertificate, questions.length);

    expect(randomView.canStart).toBe(false);
    expect(mockView.canStart).toBe(false);
    expect(mockView.statusText).toBe('该等级题库待补充');
  });

  it('builds only the fixed ten-question route', () => {
    expect(
      buildRandomPracticeRoute({
        occupation: '4-02-06-01',
        level: 5,
      }),
    ).toBe('/pages/practice/index?occupation=4-02-06-01&level=5&mode=random&limit=10');
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
