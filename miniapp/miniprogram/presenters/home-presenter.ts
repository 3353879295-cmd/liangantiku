import type { DashboardStats } from '../services/progress-service';

export interface ResumeSummary {
  currentIndex: number;
  total: number;
}

export interface DashboardViewModel {
  answeredText: string;
  accuracyText: string;
  durationText: string;
  streakText: string;
  goalText: string;
  goalPercent: number;
  resumeText: string;
}

const presentDuration = (durationMs: number): string => {
  const totalMinutes = Math.floor(durationMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
};

export const presentDashboard = (
  stats: DashboardStats,
  resume?: ResumeSummary,
): DashboardViewModel => ({
  answeredText: `${stats.answered}`,
  accuracyText: `${stats.accuracy}%`,
  durationText: presentDuration(stats.durationMs),
  streakText: stats.streakDays ? `连续 ${stats.streakDays} 天` : '从今天开始',
  goalText: `${stats.todayAnswered} / ${stats.dailyGoal} 题`,
  goalPercent: Math.min(100, Math.round((stats.todayAnswered / stats.dailyGoal) * 100)),
  resumeText: resume ? `继续第 ${resume.currentIndex + 1} 题 · 共 ${resume.total} 题` : '',
});
