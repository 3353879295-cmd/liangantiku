import type { ProgressService } from './progress-service';
import type { AnswerTheme } from '../types/domain';

export class ThemeService {
  constructor(private readonly progress: ProgressService) {}

  get(): AnswerTheme {
    return this.progress.getPreferences().answerTheme;
  }

  set(theme: AnswerTheme): AnswerTheme {
    this.progress.updatePreferences({ answerTheme: theme });
    return theme;
  }

  toggle(): AnswerTheme {
    return this.set(this.get() === 'light' ? 'night' : 'light');
  }
}
