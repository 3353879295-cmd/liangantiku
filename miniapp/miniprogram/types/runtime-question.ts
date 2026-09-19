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
  chapter_id: string;
  section_id: string;
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

export interface RuntimeQuestionShard {
  occupation: OccupationCode;
  level: CertificateLevel;
  count: number;
  paths: readonly RuntimeQuestionPath[];
  load(): readonly RuntimeQuestionRecord[];
}

export interface RuntimeQuestionPath {
  module: string;
  chapterId: string;
  sectionId: string;
}

export interface RuntimeQuestionBank {
  shards: readonly RuntimeQuestionShard[];
  counts: Readonly<Record<OccupationCode, Readonly<Record<CertificateLevel, number>>>>;
  shardForId?(id: string): RuntimeQuestionShard | undefined;
}
