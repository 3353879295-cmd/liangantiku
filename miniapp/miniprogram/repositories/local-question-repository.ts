import type { Question, QuestionFilter, QuestionRepository } from '../types/domain';
import type {
  RuntimeQuestionBank,
  RuntimeQuestionRecord,
  RuntimeQuestionShard,
} from '../types/runtime-question';

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

const matchesFilter = (
  question: Question,
  filter: QuestionFilter,
  ids = filter.ids ? new Set(filter.ids) : undefined,
): boolean => {
  if (filter.occupation && question.occupation !== filter.occupation) return false;
  if (filter.level && question.level !== filter.level) return false;
  if (filter.module && question.module !== filter.module) return false;
  if (filter.chapterId && question.chapterId !== filter.chapterId) return false;
  if (filter.sectionId && question.sectionId !== filter.sectionId) return false;
  if (ids && !ids.has(question.id)) return false;
  return true;
};

export class LocalQuestionRepository implements QuestionRepository {
  private readonly questions: Question[] = [];
  private readonly byId = new Map<string, Question>();
  private readonly orderById = new Map<string, number>();
  private readonly loadedShards = new Set<RuntimeQuestionShard>();
  private readonly pendingShards = new Map<RuntimeQuestionShard, Promise<void>>();
  private readonly bank?: RuntimeQuestionBank;

  constructor(source: readonly RuntimeQuestionRecord[] | RuntimeQuestionBank) {
    if ('shards' in source) {
      this.bank = source;
    } else {
      this.addRecords(source);
    }
  }

  private addRecords(
    records: readonly RuntimeQuestionRecord[],
    orderOffset = this.questions.length,
  ): void {
    const adapted = records.map(adapt);
    for (const [index, question] of adapted.entries()) {
      this.questions.push(question);
      this.byId.set(question.id, question);
      this.orderById.set(question.id, orderOffset + index);
    }
    this.questions.sort(
      (left, right) => (this.orderById.get(left.id) ?? 0) - (this.orderById.get(right.id) ?? 0),
    );
  }

  private matchingShards(filter: QuestionFilter = {}): readonly RuntimeQuestionShard[] {
    return (
      this.bank?.shards.filter(
        (shard) =>
          (!filter.occupation || shard.occupation === filter.occupation) &&
          (!filter.level || shard.level === filter.level),
      ) ?? []
    );
  }

  private loadShard(shard: RuntimeQuestionShard): Promise<void> {
    if (this.loadedShards.has(shard)) return Promise.resolve();
    const pending = this.pendingShards.get(shard);
    if (pending) return pending;
    const loading = Promise.resolve()
      .then(() => shard.load())
      .then((records) => {
        const shardIndex = this.bank?.shards.indexOf(shard) ?? 0;
        this.addRecords(records, shardIndex * 10_000);
        this.loadedShards.add(shard);
      });
    this.pendingShards.set(shard, loading);
    return loading.finally(() => this.pendingShards.delete(shard));
  }

  private loadShards(shards: readonly RuntimeQuestionShard[]): Promise<void> {
    return Promise.all(shards.map((shard) => this.loadShard(shard))).then(() => undefined);
  }

  private async loadForIds(ids: readonly string[]): Promise<void> {
    if (!this.bank) return;
    const unknownId = ids.some((id) => !this.bank?.shardForId?.(id));
    const shards = unknownId
      ? this.bank.shards
      : ([
          ...new Set(ids.map((id) => this.bank?.shardForId?.(id)).filter(Boolean)),
        ] as RuntimeQuestionShard[]);
    await this.loadShards(shards);
  }

  async count(filter: QuestionFilter = {}): Promise<number> {
    if (
      this.bank &&
      filter.occupation &&
      filter.level &&
      !filter.module &&
      !filter.chapterId &&
      !filter.sectionId &&
      !filter.ids
    ) {
      return this.bank.counts[filter.occupation][filter.level];
    }
    return (await this.list(filter)).length;
  }

  async list(filter: QuestionFilter = {}): Promise<Question[]> {
    await this.loadShards(this.matchingShards(filter));
    const ids = filter.ids ? new Set(filter.ids) : undefined;
    return this.questions.filter((question) => matchesFilter(question, filter, ids));
  }

  async getById(id: string): Promise<Question | null> {
    await this.loadForIds([id]);
    return this.byId.get(id) ?? null;
  }

  async getByIds(ids: string[]): Promise<Question[]> {
    const requested = new Set(ids);
    await this.loadForIds([...requested]);
    return ids.flatMap((id) => {
      const question = this.byId.get(id);
      return question ? [question] : [];
    });
  }
}
