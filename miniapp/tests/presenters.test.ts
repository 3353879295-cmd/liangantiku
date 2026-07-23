import { describe, expect, it } from 'vitest';

import { presentQuestionOption } from '../miniprogram/presenters/question-option-presenter';

describe('presentQuestionOption', () => {
  it('shows a selected option before submission', () => {
    expect(
      presentQuestionOption({ key: 'A', selected: true, submitted: false, correctKeys: [] }),
    ).toEqual({ selected: true, state: 'selected', disabled: false });
  });

  it('marks a selected wrong option after submission', () => {
    expect(
      presentQuestionOption({ key: 'A', selected: true, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: true, state: 'wrong', disabled: true });
  });

  it('reveals the correct option after submission', () => {
    expect(
      presentQuestionOption({ key: 'B', selected: false, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: false, state: 'correct', disabled: true });
  });

  it('keeps unrelated options neutral after submission', () => {
    expect(
      presentQuestionOption({ key: 'C', selected: false, submitted: true, correctKeys: ['B'] }),
    ).toEqual({ selected: false, state: 'neutral', disabled: true });
  });
});
