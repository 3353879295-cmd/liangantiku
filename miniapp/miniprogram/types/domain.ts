export type OccupationCode = '4-02-06-01' | '4-08-05-01';
export type CertificateLevel = 5 | 4 | 3 | 2 | 1;
export type AvailableQuestionLevel = 5 | 4 | 3 | 2 | 1;
export type CertificateAvailability = 'available' | 'coming-soon';
export type AnswerTheme = 'light' | 'night';
export type AnswerRevealMode = 'immediate' | 'deferred';
export type CertificateKey = `${OccupationCode}:${CertificateLevel}`;
export const QUESTION_TYPES = ['single', 'multiple', 'judge', 'case'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const PRACTICE_QUESTION_LIMITS = [10, 20, 30, 50] as const;
export type PracticeQuestionLimit = (typeof PRACTICE_QUESTION_LIMITS)[number];
export type Difficulty = 'easy' | 'medium' | 'hard';
export type PracticeMode = 'chapter' | 'sequential' | 'random' | 'mock' | 'wrong' | 'favorite';

export interface QuestionOption {
  key: string;
  text: string;
}

export interface Question {
  id: string;
  occupation: OccupationCode;
  direction: string;
  level: CertificateLevel;
  module: string;
  topic: string;
  chapterId: string;
  sectionId: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: string[];
  explanation: string;
  difficulty: Difficulty;
  keywords: string[];
  sourceIds: string[];
  standardReference: string;
  reviewStatus: 'verified' | 'sample';
  contentVersion: number;
  knowledgePoint: string;
  commonMistake?: string;
}

export interface QuestionFilter {
  occupation?: OccupationCode;
  level?: CertificateLevel;
  module?: string;
  chapterId?: string;
  sectionId?: string;
  ids?: string[];
}

export interface QuestionRepository {
  list(filter?: QuestionFilter): Promise<Question[]>;
  getById(id: string): Promise<Question | null>;
  getByIds(ids: string[]): Promise<Question[]>;
}

export interface GradeResult {
  correct: boolean;
  selected: string[];
  expected: string[];
}

export interface StorageAdapter {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

export interface AppGlobalData {
  selectedCertificateKey: CertificateKey;
  answerTheme: AnswerTheme;
  recoveryNotice: string;
}

declare global {
  interface IAppOption {
    globalData: AppGlobalData;
  }
}

export {};
