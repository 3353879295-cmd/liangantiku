export type OccupationCode = '4-02-06-01' | '4-08-05-01';
export type CertificateLevel = 5 | 4 | 3;
export type CertificateKey = `${OccupationCode}:${CertificateLevel}`;
export type QuestionType = 'single' | 'multiple' | 'judge' | 'case';
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
  recoveryNotice: string;
}

declare global {
  interface IAppOption {
    globalData: AppGlobalData;
  }
}

export {};
