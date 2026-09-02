import type { CurrentProgressData } from '../storage/migrations';

export type ProgressScope = 'guest' | 'account';

export type AccountProgressSnapshot = CurrentProgressData;
