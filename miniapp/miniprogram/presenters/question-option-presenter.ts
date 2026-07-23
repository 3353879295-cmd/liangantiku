export type QuestionOptionState = 'neutral' | 'selected' | 'correct' | 'wrong';

export interface QuestionOptionPresentationInput {
  key: string;
  selected: boolean;
  submitted: boolean;
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
  if (!input.submitted) {
    return {
      selected: input.selected,
      state: input.selected ? 'selected' : 'neutral',
      disabled: false,
    };
  }
  if (input.correctKeys.includes(input.key)) {
    return { selected: input.selected, state: 'correct', disabled: true };
  }
  if (input.selected) {
    return { selected: true, state: 'wrong', disabled: true };
  }
  return { selected: false, state: 'neutral', disabled: true };
};
