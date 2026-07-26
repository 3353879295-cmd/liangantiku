import type { QuestionType } from '../types/domain';

export type QuestionOptionState = 'idle' | 'selected' | 'correct' | 'wrong';
export type QuestionSelectionMode = 'single' | 'multiple';

export interface QuestionOptionPresentationInput {
  key: string;
  selected: boolean;
  revealAnswer: boolean;
  correctKeys: string[];
}

export interface QuestionOptionPresentation {
  selected: boolean;
  state: QuestionOptionState;
  disabled: boolean;
}

export const presentQuestionOption = (
  input: QuestionOptionPresentationInput,
): QuestionOptionPresentation => {
  if (!input.revealAnswer) {
    return {
      selected: input.selected,
      state: input.selected ? 'selected' : 'idle',
      disabled: false,
    };
  }
  if (input.correctKeys.includes(input.key)) {
    return { selected: input.selected, state: 'correct', disabled: true };
  }
  if (input.selected) {
    return { selected: true, state: 'wrong', disabled: true };
  }
  return { selected: false, state: 'idle', disabled: true };
};

export const getQuestionSelectionMode = (
  questionType: QuestionType,
  correctKeys: readonly string[],
): QuestionSelectionMode =>
  questionType === 'multiple' || (questionType === 'case' && correctKeys.length > 1)
    ? 'multiple'
    : 'single';

export const selectDraftOption = (
  selectedKeys: readonly string[],
  key: string,
  mode: QuestionSelectionMode,
): string[] => {
  if (mode === 'single') return [key];
  return selectedKeys.includes(key)
    ? selectedKeys.filter((selectedKey) => selectedKey !== key)
    : [...selectedKeys, key];
};
