import type { PracticeReport } from '../services/practice-session';

export interface WeakModuleViewModel {
  name: string;
  accuracy: number;
  accuracyText: string;
  summary: string;
}

export interface ReportViewModel {
  scoreText: string;
  accuracyText: string;
  durationText: string;
  correctText: string;
  wrongText: string;
  weakModules: WeakModuleViewModel[];
}

const percentage = (correct: number, total: number): number =>
  total ? Math.round((correct / total) * 100) : 0;

const duration = (durationMs: number): string => {
  const seconds = Math.floor(durationMs / 1000);
  const minutesPart = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secondsPart = (seconds % 60).toString().padStart(2, '0');
  return `${minutesPart}:${secondsPart}`;
};

export const presentReport = (report: PracticeReport): ReportViewModel => ({
  scoreText: `${percentage(report.correct, report.total)}`,
  accuracyText: `${percentage(report.correct, report.total)}%`,
  durationText: duration(report.durationMs),
  correctText: `${report.correct}`,
  wrongText: `${report.wrong}`,
  weakModules: Object.entries(report.modules)
    .map(([name, module]) => {
      const accuracy = percentage(module.correct, module.total);
      return {
        name,
        accuracy,
        accuracyText: `${accuracy}%`,
        summary: `${module.correct} / ${module.total} 题`,
      };
    })
    .sort((left, right) => left.accuracy - right.accuracy || left.name.localeCompare(right.name)),
});
