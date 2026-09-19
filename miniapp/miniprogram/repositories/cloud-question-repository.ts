import type { Question, QuestionRepository } from '../types/domain';

const notConfigured = (): Error => new Error('云端题库尚未配置');

export class CloudQuestionRepository implements QuestionRepository {
  count(): Promise<number> {
    return Promise.reject(notConfigured());
  }

  list(): Promise<Question[]> {
    return Promise.reject(notConfigured());
  }

  getById(): Promise<Question | null> {
    return Promise.reject(notConfigured());
  }

  getByIds(): Promise<Question[]> {
    return Promise.reject(notConfigured());
  }
}
