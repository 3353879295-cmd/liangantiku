import type {
  CertificateLevel,
  Difficulty,
  OccupationCode,
  QuestionOption,
  QuestionType,
} from './domain';

export interface RuntimeQuestionRecord {
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
  source_ids: string[];
  standard_reference: string;
  review_status: 'verified' | 'sample';
  content_version: number;
  common_mistake?: string;
}
