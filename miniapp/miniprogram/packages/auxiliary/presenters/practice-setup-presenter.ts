import type {
  CertificateLevel,
  CertificateAvailability,
  OccupationCode,
  Question,
} from '../../../types/domain';
import type { Certificate } from '../../../data/certificates';

export const RANDOM_QUESTION_LIMIT = 10;

export interface RandomPracticeSetupViewModel {
  bankTitle: string;
  bankQuestionCount: number;
  questionCount: typeof RANDOM_QUESTION_LIMIT;
  summaryText: string;
  statusText: string;
  canStart: boolean;
}

export interface RandomPracticeSetupInput {
  certificate: Certificate;
  questions: readonly Pick<Question, 'type'>[];
}

const canUseCertificate = (availability: CertificateAvailability, questionCount: number): boolean =>
  availability === 'available' && questionCount > 0;

export const presentRandomPracticeSetup = ({
  certificate,
  questions,
}: RandomPracticeSetupInput): RandomPracticeSetupViewModel => {
  const bankQuestionCount = questions.length;
  const canStart =
    canUseCertificate(certificate.availability, bankQuestionCount) &&
    bankQuestionCount >= RANDOM_QUESTION_LIMIT;

  return {
    bankTitle: certificate.title,
    bankQuestionCount,
    questionCount: RANDOM_QUESTION_LIMIT,
    summaryText: `固定抽取 ${RANDOM_QUESTION_LIMIT} 题 · 全部题型`,
    statusText:
      certificate.availability === 'coming-soon' || bankQuestionCount === 0
        ? '该等级题库待补充'
        : canStart
          ? '题目将从当前题库随机抽取'
          : `当前题库仅 ${bankQuestionCount} 题，暂不足 ${RANDOM_QUESTION_LIMIT} 题`,
    canStart,
  };
};

export interface RandomPracticeRouteInput {
  occupation: OccupationCode;
  level: CertificateLevel;
}

export const buildRandomPracticeRoute = ({ occupation, level }: RandomPracticeRouteInput): string =>
  `/pages/practice/index?occupation=${occupation}&level=${level}&mode=random&limit=${RANDOM_QUESTION_LIMIT}`;

export interface MockExamPolicy {
  revealFeedbackBeforeSubmit: false;
  allowAnswerChangesBeforeSubmit: true;
  revealAnalysisAfterSubmit: true;
  gradeUnansweredAsWrong: true;
}

export const MOCK_EXAM_POLICY: MockExamPolicy = {
  revealFeedbackBeforeSubmit: false,
  allowAnswerChangesBeforeSubmit: true,
  revealAnalysisAfterSubmit: true,
  gradeUnansweredAsWrong: true,
};

export interface MockRuleViewModel {
  id: 'feedback' | 'changes' | 'analysis' | 'unanswered';
  title: string;
  description: string;
}

export interface MockPracticeInfoViewModel {
  bankTitle: string;
  questionCount: number;
  questionCountText: string;
  statusText: string;
  canStart: boolean;
  policy: MockExamPolicy;
  rules: MockRuleViewModel[];
}

const MOCK_QUESTION_LIMIT = 50;

export const presentMockPracticeInfo = (
  certificate: Certificate,
  bankQuestionCount: number,
): MockPracticeInfoViewModel => {
  const questionCount = Math.min(MOCK_QUESTION_LIMIT, Math.max(0, bankQuestionCount));
  const canStart = canUseCertificate(certificate.availability, questionCount);

  return {
    bankTitle: certificate.title,
    questionCount,
    questionCountText: `本次可生成 ${questionCount} 题`,
    statusText: canStart ? '题目将从当前题库随机生成' : '该等级题库待补充',
    canStart,
    policy: MOCK_EXAM_POLICY,
    rules: [
      {
        id: 'feedback',
        title: '答题中隐藏答案',
        description: '考试过程中不显示正误、答案和解析。',
      },
      {
        id: 'changes',
        title: '交卷前可以修改',
        description: '交卷前可返回任意题目调整已选答案。',
      },
      {
        id: 'analysis',
        title: '交卷后统一解析',
        description: '提交试卷后统一查看作答结果与题目解析。',
      },
      {
        id: 'unanswered',
        title: '未答题提示',
        description: '未作答题目会按错题计入本次考试结果。',
      },
    ],
  };
};
