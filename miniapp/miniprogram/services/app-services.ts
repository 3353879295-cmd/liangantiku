import { QUESTION_RECORDS } from '../data/question-bank';
import { LocalQuestionRepository } from '../repositories/local-question-repository';
import { ProgressRepository } from '../storage/progress-repository';
import { WechatStorageAdapter } from '../storage/storage-adapter';
import { ProgressService } from './progress-service';
import { ThemeService } from './theme-service';

const progressRepository = new ProgressRepository(new WechatStorageAdapter());
const progress = new ProgressService(progressRepository);

export const appServices = {
  progress,
  theme: new ThemeService(progress),
  questions: new LocalQuestionRepository(QUESTION_RECORDS),
};

export const localDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};
