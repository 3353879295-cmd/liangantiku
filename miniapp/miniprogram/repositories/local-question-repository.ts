import type { Question, QuestionFilter, QuestionRepository } from '../types/domain';
import type { RuntimeQuestionRecord } from '../types/runtime-question';

const adapt = (record: RuntimeQuestionRecord): Question => {
  const question: Question = {
    id: record.id,
    occupation: record.occupation,
    direction: record.direction,
    level: record.level,
    module: record.module,
    topic: record.topic,
    chapterId: record.chapter_id,
    sectionId: record.section_id,
    type: record.type,
    stem: record.stem,
    options: record.options.map((option) => ({ ...option })),
    answer: [...record.answer].sort(),
    explanation: record.explanation,
    difficulty: record.difficulty,
    keywords: [...record.keywords],
    sourceIds: [...record.source_ids],
    standardReference: record.standard_reference,
    reviewStatus: record.review_status,
    contentVersion: record.content_version,
    knowledgePoint: record.topic,
  };
  if (record.common_mistake) {
    question.commonMistake = record.common_mistake;
  }
  return question;
};

const matchesFilter = (question: Question, filter: QuestionFilter): boolean => {
  if (filter.occupation && question.occupation !== filter.occupation) return false;
  if (filter.level && question.level !== filter.level) return false;
  if (filter.module && question.module !== filter.module) return false;
  if (filter.chapterId && question.chapterId !== filter.chapterId) return false;
  if (filter.sectionId && question.sectionId !== filter.sectionId) return false;
  if (filter.ids && !filter.ids.includes(question.id)) return false;
  return true;
};

export class LocalQuestionRepository implements QuestionRepository {
  private readonly questions: Question[];
  private readonly byId: Map<string, Question>;

  constructor(records: readonly RuntimeQuestionRecord[]) {
    this.questions = records.map(adapt);
    this.byId = new Map(this.questions.map((question) => [question.id, question]));
  }

  list(filter: QuestionFilter = {}): Promise<Question[]> {
    return Promise.resolve(this.questions.filter((question) => matchesFilter(question, filter)));
  }

  getById(id: string): Promise<Question | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  getByIds(ids: string[]): Promise<Question[]> {
    return Promise.resolve(
      ids.flatMap((id) => {
        const question = this.byId.get(id);
        return question ? [question] : [];
      }),
    );
  }
}
