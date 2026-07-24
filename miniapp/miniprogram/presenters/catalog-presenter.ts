import type { QuestionProgressSummary } from '../services/progress-service';
import type { CertificateLevel, OccupationCode, Question } from '../types/domain';
import type { RuntimeKnowledgeCatalog } from '../types/knowledge-catalog';

export interface CatalogSectionViewModel {
  id: string;
  numberText: string;
  title: string;
  questionCount: number;
  countText: string;
  statusText: string;
  canStart: boolean;
}

export interface CatalogChapterViewModel {
  id: string;
  numberText: string;
  title: string;
  questionCount: number;
  metaText: string;
  progressText: string;
  accuracyText: string;
  wrongText: string;
  canStart: boolean;
  sections: CatalogSectionViewModel[];
}

export interface CatalogPartViewModel {
  id: string;
  numberText: string;
  title: string;
  chapters: CatalogChapterViewModel[];
}

interface PresentCatalogPartsInput {
  catalog: RuntimeKnowledgeCatalog;
  occupation: OccupationCode;
  level: CertificateLevel;
  questions: readonly Question[];
  getProgress: (questionIds: readonly string[]) => QuestionProgressSummary;
}

const percentage = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);

const sectionStatusText = (questionCount: number, completed: number): string => {
  if (questionCount === 0) return '待补充';
  if (completed === 0) return '未开始';
  if (completed >= questionCount) return '已完成';
  return `已完成 ${completed}/${questionCount}`;
};

export const findCatalogChapterTitle = (
  catalog: RuntimeKnowledgeCatalog,
  chapterId: string,
): string =>
  Object.values(catalog.occupations)
    .flatMap((occupation) => occupation.parts)
    .flatMap((part) => part.chapters)
    .find((chapter) => chapter.id === chapterId)?.title ?? chapterId;

export const presentCatalogParts = (input: PresentCatalogPartsInput): CatalogPartViewModel[] => {
  const questions = input.questions.filter(
    (question) => question.occupation === input.occupation && question.level === input.level,
  );

  return input.catalog.occupations[input.occupation].parts
    .filter((part) => part.levels.includes(input.level))
    .map((part) => ({
      id: part.id,
      numberText: `第 ${part.number} 部分`,
      title: part.title,
      chapters: part.chapters.map((chapter) => {
        const chapterQuestionIds = questions
          .filter((question) => question.chapterId === chapter.id)
          .map((question) => question.id);
        const progress = input.getProgress(chapterQuestionIds);
        const questionCount = chapterQuestionIds.length;

        return {
          id: chapter.id,
          numberText: `第 ${chapter.number} 章`,
          title: chapter.title,
          questionCount,
          metaText: questionCount === 0 ? '待补充' : `${questionCount} 题`,
          progressText: `${percentage(progress.completed, questionCount)}%`,
          accuracyText: `${percentage(progress.correctAttempts, progress.attempts)}%`,
          wrongText: `${progress.wrongQuestions}`,
          canStart: questionCount > 0,
          sections: chapter.sections.map((section) => {
            const sectionQuestionIds = questions
              .filter((question) => question.sectionId === section.id)
              .map((question) => question.id);
            const sectionQuestionCount = sectionQuestionIds.length;
            const sectionCompleted =
              sectionQuestionCount > 0 ? input.getProgress(sectionQuestionIds).completed : 0;
            return {
              id: section.id,
              numberText: `第 ${section.number} 节`,
              title: section.title,
              questionCount: sectionQuestionCount,
              countText: `${sectionQuestionCount} 题`,
              statusText: sectionStatusText(sectionQuestionCount, sectionCompleted),
              canStart: sectionQuestionCount > 0,
            };
          }),
        };
      }),
    }));
};
