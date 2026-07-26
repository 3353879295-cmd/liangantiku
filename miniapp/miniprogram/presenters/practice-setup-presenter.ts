import { QUESTION_TYPES } from '../types/domain';
import type {
  CertificateAvailability,
  PracticeQuestionLimit,
  Question,
  QuestionType,
} from '../types/domain';
import type { Certificate } from '../data/certificates';

export const RANDOM_QUESTION_LIMITS = [10, 20, 30] as const;
export type RandomQuestionLimit = (typeof RANDOM_QUESTION_LIMITS)[number];

const randomQuestionLimits = new Set<PracticeQuestionLimit>(RANDOM_QUESTION_LIMITS);

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  case: '案例题',
};

export interface RandomCountOption {
  value: RandomQuestionLimit;
  label: string;
  selected: boolean;
  disabled: boolean;
}

export interface RandomTypeOption {
  value: 'all' | QuestionType;
  label: string;
  count: number;
  selected: boolean;
  disabled: boolean;
}

export interface RandomPracticeSetupViewModel {
  bankTitle: string;
  bankQuestionCount: number;
  availableQuestionCount: number;
  countOptions: RandomCountOption[];
  typeOptions: RandomTypeOption[];
  summaryText: string;
  statusText: string;
  canStart: boolean;
}

export interface RandomPracticeSetupInput {
  certificate: Certificate;
  questions: readonly Pick<Question, 'type'>[];
  limit: PracticeQuestionLimit;
  questionTypes: readonly QuestionType[];
}

const countQuestionTypes = (
  questions: readonly Pick<Question, 'type'>[],
): Record<QuestionType, number> => {
  const counts: Record<QuestionType, number> = {
    single: 0,
    multiple: 0,
    judge: 0,
    case: 0,
  };
  for (const question of questions) counts[question.type] += 1;
  return counts;
};

const canUseCertificate = (availability: CertificateAvailability, questionCount: number): boolean =>
  availability === 'available' && questionCount > 0;

export const presentRandomPracticeSetup = ({
  certificate,
  questions,
  limit,
  questionTypes,
}: RandomPracticeSetupInput): RandomPracticeSetupViewModel => {
  const counts = countQuestionTypes(questions);
  const requestedTypes = [...new Set(questionTypes)];
  const availableQuestionCount = requestedTypes.length
    ? requestedTypes.reduce((total, questionType) => total + counts[questionType], 0)
    : questions.length;
  const hasUnavailableType = requestedTypes.some((questionType) => counts[questionType] === 0);
  const validRandomLimit = randomQuestionLimits.has(limit);
  const canStart =
    canUseCertificate(certificate.availability, questions.length) &&
    validRandomLimit &&
    !hasUnavailableType &&
    availableQuestionCount >= limit;
  const selectedTypeText = requestedTypes.length
    ? requestedTypes.map((questionType) => QUESTION_TYPE_LABELS[questionType]).join('、')
    : '全部题型';

  return {
    bankTitle: certificate.title,
    bankQuestionCount: questions.length,
    availableQuestionCount,
    countOptions: RANDOM_QUESTION_LIMITS.map((value) => ({
      value,
      label: `${value} 题`,
      selected: value === limit,
      disabled: value > availableQuestionCount,
    })),
    typeOptions: [
      {
        value: 'all',
        label: '全部',
        count: questions.length,
        selected: requestedTypes.length === 0,
        disabled: questions.length === 0,
      },
      ...QUESTION_TYPES.map((value) => ({
        value,
        label: QUESTION_TYPE_LABELS[value],
        count: counts[value],
        selected: requestedTypes.includes(value),
        disabled: counts[value] === 0,
      })),
    ],
    summaryText: `抽取 ${limit} 题 · ${selectedTypeText}`,
    statusText:
      certificate.availability === 'coming-soon' || questions.length === 0
        ? '该等级题库待补充'
        : canStart
          ? `当前筛选可用 ${availableQuestionCount} 题`
          : `当前筛选仅 ${availableQuestionCount} 题，题量不足`,
    canStart,
  };
};

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
