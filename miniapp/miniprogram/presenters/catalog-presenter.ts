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
  sectionCountText: string;
  questionCountText: string;
  progressText: string;
  accuracyText: string;
  wrongText: string;
  statusText: string;
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

interface BuildChapterDetailRouteInput {
  loading: boolean;
  occupation: OccupationCode;
  level: CertificateLevel;
  chapterId: string;
  chapterIds: readonly string[];
}

interface BuildChapterPracticeRouteInput {
  loading: boolean;
  occupation: OccupationCode;
  level: CertificateLevel;
  chapter: CatalogChapterViewModel;
  chapterId?: string;
  sectionId?: string;
}

export interface ChapterRoute {
  occupation: OccupationCode;
  level: CertificateLevel;
  chapterId: string;
}

const CERTIFICATE_LEVELS = new Set<CertificateLevel>([5, 4, 3, 2, 1]);

const percentage = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);

const sectionStatusText = (questionCount: number, completed: number): string => {
  if (questionCount === 0) return '待补充';
  if (completed === 0) return '未开始';
  if (completed >= questionCount) return '已完成';
  return `已完成 ${completed}/${questionCount}`;
};

const chapterStatusText = (questionCount: number, attempts: number): string => {
  if (questionCount === 0) return '暂无题目';
  if (attempts === 0) return '未练习';
  return '已练习';
};

const findCatalogChapter = (catalog: RuntimeKnowledgeCatalog, chapterId: string) =>
  Object.values(catalog.occupations)
    .flatMap((occupation) => occupation.parts)
    .flatMap((part) => part.chapters)
    .find((chapter) => chapter.id === chapterId);

export const parseChapterRoute = (
  catalog: RuntimeKnowledgeCatalog,
  options: Record<string, string | undefined>,
): ChapterRoute | null => {
  const occupation = options['occupation'] as OccupationCode;
  const level = Number(options['level']) as CertificateLevel;
  if (!Object.hasOwn(catalog.occupations, occupation) || !CERTIFICATE_LEVELS.has(level))
    return null;

  let chapterId = '';
  try {
    chapterId = decodeURIComponent(options['chapterId'] ?? '');
  } catch {
    return null;
  }
  if (!chapterId) return null;

  const occupationCatalog = catalog.occupations[occupation];
  const chapterBelongsToCertificate = occupationCatalog.parts
    .filter((part) => part.levels.includes(level))
    .some((part) => part.chapters.some((chapter) => chapter.id === chapterId));
  return chapterBelongsToCertificate ? { occupation, level, chapterId } : null;
};

export const buildChapterDetailRoute = (input: BuildChapterDetailRouteInput): string | null => {
  if (input.loading || !input.chapterIds.includes(input.chapterId)) return null;
  return `/packages/auxiliary/pages/chapter-detail/index?occupation=${input.occupation}&level=${input.level}&chapterId=${encodeURIComponent(input.chapterId)}`;
};

export const buildChapterPracticeRoute = (input: BuildChapterPracticeRouteInput): string | null => {
  if (input.loading) return null;
  const hasChapter = Boolean(input.chapterId);
  const hasSection = Boolean(input.sectionId);
  if (hasChapter === hasSection) return null;

  if (input.chapterId) {
    if (!input.chapter.canStart || input.chapter.id !== input.chapterId) return null;
    return `/pages/practice/index?occupation=${input.occupation}&level=${input.level}&mode=chapter&chapterId=${encodeURIComponent(input.chapterId)}`;
  }

  const section = input.chapter.sections.find(({ id }) => id === input.sectionId);
  if (!section?.canStart) return null;
  return `/pages/practice/index?occupation=${input.occupation}&level=${input.level}&mode=chapter&sectionId=${encodeURIComponent(section.id)}`;
};

export const findCatalogChapterTitle = (
  catalog: RuntimeKnowledgeCatalog,
  chapterId: string,
): string => findCatalogChapter(catalog, chapterId)?.title ?? chapterId;

export const findCatalogChapterLabel = (
  catalog: RuntimeKnowledgeCatalog,
  chapterId: string,
): string => {
  const chapter = findCatalogChapter(catalog, chapterId);
  return chapter ? `第 ${chapter.number} 章 ${chapter.title}` : chapterId;
};

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
          numberText: String(chapter.number),
          title: chapter.title,
          questionCount,
          metaText: questionCount === 0 ? '待补充' : `${questionCount} 题`,
          sectionCountText: `${chapter.sections.length} 小节`,
          questionCountText: questionCount ? `${questionCount} 题` : '题目待补充',
          progressText:
            questionCount === 0 ? '—' : `${percentage(progress.completed, questionCount)}%`,
          accuracyText:
            questionCount === 0
              ? '—'
              : progress.attempts === 0
                ? '未练习'
                : `${percentage(progress.correctAttempts, progress.attempts)}%`,
          wrongText: questionCount === 0 ? '—' : `${progress.wrongQuestions}`,
          statusText: chapterStatusText(questionCount, progress.attempts),
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
              numberText: String(section.number),
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
