import type { Certificate } from '../data/certificates';
import type { DashboardStats } from '../services/progress-service';
import type { CertificateKey } from '../types/domain';

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

export interface HomeCertificateViewModel {
  certificateKey: CertificateKey;
  roleTitle: string;
  levelName: string;
  bankTitle: string;
  availabilityText: '可练习' | '待补充';
  canStart: boolean;
  questionCountText: string;
}

export interface HomeAction {
  id: 'chapter' | 'random' | 'mock' | 'wrong' | 'favorite';
  title: string;
  route: string;
}

export const HOME_ACTIONS: readonly HomeAction[] = [
  { id: 'chapter', title: '章节刷题', route: '/pages/library/index' },
  { id: 'random', title: '随机练习', route: '/packages/auxiliary/pages/random-settings/index' },
  { id: 'mock', title: '模拟考试', route: '/packages/auxiliary/pages/mock-info/index' },
  {
    id: 'wrong',
    title: '错题本',
    route: '/pages/question-list/index?kind=wrong',
  },
  {
    id: 'favorite',
    title: '收藏试题',
    route: '/pages/question-list/index?kind=favorite',
  },
];

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

export const presentHomeCertificate = (
  certificates: readonly Certificate[],
  selectedKey: CertificateKey,
  questionCount: number,
): HomeCertificateViewModel => {
  const certificate = certificates.find(({ key }) => key === selectedKey) ?? certificates[0];
  if (!certificate) throw new Error('at least one certificate is required');

  const canStart = certificate.availability === 'available' && questionCount > 0;
  const roleTitle = certificate.title.split(' · ')[0] ?? certificate.title;
  return {
    certificateKey: certificate.key,
    roleTitle,
    levelName: certificate.levelName,
    bankTitle: `${roleTitle} · ${certificate.levelName}`,
    availabilityText: canStart ? '可练习' : '待补充',
    canStart,
    questionCountText: canStart ? `${questionCount} 题` : '题库待补充',
  };
};
