import { presentDashboard } from './home-presenter';
import type {
  ActivityDay,
  DashboardStats,
  QuestionProgressSummary,
} from '../services/progress-service';

export interface ActivityBarViewModel {
  date: string;
  label: string;
  answered: number;
  height: number;
}

export interface ChapterPerformanceInput {
  id: string;
  numberText: string;
  title: string;
  progress: QuestionProgressSummary;
}

export interface WeakChapterViewModel {
  id: string;
  title: string;
  accuracyText: string;
  attemptsText: string;
  wrongText: string;
}

interface LearningReportInput {
  dashboard: DashboardStats;
  activity: readonly ActivityDay[];
  chapters: readonly ChapterPerformanceInput[];
}

const compareChapterNumbers = (left: string, right: string): number => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
};

export interface LearningReportViewModel {
  hasLearningData: boolean;
  answeredText: string;
  accuracyText: string;
  durationText: string;
  streakText: string;
  activity: ActivityBarViewModel[];
  weakChapters: WeakChapterViewModel[];
}

const percentage = (numerator: number, denominator: number): number =>
  denominator ? Math.round((numerator / denominator) * 100) : 0;

export const presentActivityBars = (activity: readonly ActivityDay[]): ActivityBarViewModel[] => {
  const maximum = Math.max(1, ...activity.map(({ answered }) => answered));
  return activity.map(({ date, answered }) => ({
    date,
    label: date.slice(5).replace('-', '/'),
    answered,
    height: answered ? Math.max(12, Math.round((answered / maximum) * 100)) : 4,
  }));
};

export const presentLearningReport = (input: LearningReportInput): LearningReportViewModel => {
  const hasLearningData = input.dashboard.answered > 0;
  if (!hasLearningData) {
    return {
      hasLearningData: false,
      answeredText: '',
      accuracyText: '',
      durationText: '',
      streakText: '',
      activity: presentActivityBars(input.activity),
      weakChapters: [],
    };
  }

  const dashboard = presentDashboard(input.dashboard);
  const weakChapters = input.chapters
    .filter(({ progress }) => progress.attempts > 0)
    .map((chapter) => ({
      ...chapter,
      accuracy: percentage(chapter.progress.correctAttempts, chapter.progress.attempts),
    }))
    .sort(
      (left, right) =>
        left.accuracy - right.accuracy ||
        right.progress.wrongQuestions - left.progress.wrongQuestions ||
        right.progress.attempts - left.progress.attempts ||
        compareChapterNumbers(left.numberText, right.numberText),
    )
    .slice(0, 3)
    .map(({ id, numberText, title, progress, accuracy }) => ({
      id,
      title: `第 ${numberText} 章 ${title}`,
      accuracyText: `${accuracy}%`,
      attemptsText: `练习 ${progress.attempts} 次`,
      wrongText: progress.wrongQuestions ? `${progress.wrongQuestions} 题待巩固` : '暂无待巩固错题',
    }));

  return {
    hasLearningData: true,
    answeredText: dashboard.answeredText,
    accuracyText: dashboard.accuracyText,
    durationText: dashboard.durationText,
    streakText: dashboard.streakText,
    activity: presentActivityBars(input.activity),
    weakChapters,
  };
};
