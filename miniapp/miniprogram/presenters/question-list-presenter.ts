import type { WrongQuestionRecord } from '../storage/migrations';
import type { CertificateLevel, OccupationCode, Question } from '../types/domain';

export type QuestionListKind = 'wrong' | 'favorite' | 'session';

export interface QuestionListFilter {
  occupation?: OccupationCode;
  level?: CertificateLevel;
  chapterId?: string;
  includeMastered?: boolean;
}

export interface QuestionListInput {
  kind: QuestionListKind;
  questions: readonly Question[];
  ids: readonly string[];
  wrongRecords?: readonly WrongQuestionRecord[];
  filter?: QuestionListFilter;
  resolveChapterTitle?: (chapterId: string) => string;
  resolveChapterLabel?: (chapterId: string) => string;
}

export interface QuestionListItemViewModel {
  id: string;
  question: Question;
  answerText: string;
  chapterTitle: string;
  errorCount: number;
  errorCountText: string;
  latestText: string;
  mastered: boolean;
}

export interface QuestionListViewModel {
  title: string;
  actionText: string;
  emptyTitle: string;
  emptyDescription: string;
  items: QuestionListItemViewModel[];
  chapters: Array<{ id: string; title: string }>;
  unresolvedIds: string[];
}

const COPY: Record<
  QuestionListKind,
  Pick<QuestionListViewModel, 'title' | 'actionText' | 'emptyTitle' | 'emptyDescription'>
> = {
  wrong: {
    title: '错题本',
    actionText: '错题重练',
    emptyTitle: '还没有错题',
    emptyDescription: '做错的题会自动收进这里，方便集中复习。',
  },
  favorite: {
    title: '我的收藏',
    actionText: '收藏练习',
    emptyTitle: '还没有收藏',
    emptyDescription: '答题时点亮星标，重点题目就会出现在这里。',
  },
  session: {
    title: '本次错题',
    actionText: '再练错题',
    emptyTitle: '本次没有错题',
    emptyDescription: '这一组全部答对了，可以继续挑战下一组。',
  },
};

const matchesFilter = (question: Question, filter: QuestionListFilter): boolean => {
  if (filter.occupation && question.occupation !== filter.occupation) return false;
  if (filter.level && question.level !== filter.level) return false;
  if (filter.chapterId && question.chapterId !== filter.chapterId) return false;
  return true;
};

export const presentQuestionList = (input: QuestionListInput): QuestionListViewModel => {
  const copy = COPY[input.kind];
  const filter = input.filter ?? {};
  const resolveChapterTitle = input.resolveChapterTitle ?? ((chapterId: string) => chapterId);
  const resolveChapterLabel = input.resolveChapterLabel ?? resolveChapterTitle;
  const byId = new Map(input.questions.map((question) => [question.id, question]));
  const wrongById = new Map(
    (input.wrongRecords ?? []).map((record) => [record.questionId, record]),
  );
  const unresolvedIds = input.ids.filter((id) => !byId.has(id));
  let items = input.ids.flatMap((id) => {
    const question = byId.get(id);
    if (!question) return [];
    const wrong = wrongById.get(id);
    if (!matchesFilter(question, filter)) return [];
    if (wrong?.mastered && filter.includeMastered === false) return [];
    return [
      {
        id: question.id,
        question,
        answerText: question.answer.join('、'),
        chapterTitle: resolveChapterTitle(question.chapterId),
        errorCount: wrong?.errorCount ?? 0,
        errorCountText: wrong ? `错 ${wrong.errorCount} 次` : '',
        latestText: wrong ? `最近 ${wrong.lastWrongAt.slice(5)}` : '',
        mastered: wrong?.mastered ?? false,
      },
    ];
  });
  if (input.kind === 'wrong') {
    items = items.sort(
      (left, right) =>
        right.errorCount - left.errorCount ||
        right.latestText.localeCompare(left.latestText) ||
        left.question.id.localeCompare(right.question.id),
    );
  }
  const chapterIds = input.questions
    .filter((question) => {
      if (filter.occupation && question.occupation !== filter.occupation) return false;
      if (filter.level && question.level !== filter.level) return false;
      return true;
    })
    .map((question) => question.chapterId);
  const chapters = [...new Set(chapterIds)].map((chapterId) => ({
    id: chapterId,
    title: resolveChapterLabel(chapterId),
  }));
  const filterActive = Boolean(filter.occupation || filter.level || filter.chapterId);
  return {
    ...copy,
    emptyTitle: filterActive && input.ids.length ? '没有符合筛选的题目' : copy.emptyTitle,
    emptyDescription:
      filterActive && input.ids.length
        ? '调整职业、等级或章节筛选后再看看。'
        : copy.emptyDescription,
    items,
    chapters,
    unresolvedIds,
  };
};
