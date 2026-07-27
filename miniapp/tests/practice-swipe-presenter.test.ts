import { describe, expect, it } from 'vitest';

import { resolvePracticeSwipe } from '../miniprogram/presenters/practice-swipe-presenter';

describe('resolvePracticeSwipe', () => {
  it('moves to the next question for a long, horizontally dominant left swipe', () => {
    expect(
      resolvePracticeSwipe({
        deltaX: -80,
        deltaY: 10,
        currentIndex: 0,
        total: 3,
      }),
    ).toEqual({ direction: 'next', boundary: false });
  });

  it('rebounds instead of leaving the first question on a valid right swipe', () => {
    expect(
      resolvePracticeSwipe({
        deltaX: 80,
        deltaY: 10,
        currentIndex: 0,
        total: 3,
      }),
    ).toEqual({ direction: 'none', boundary: true });
  });

  it('ignores horizontal movement shorter than the 48px threshold', () => {
    expect(
      resolvePracticeSwipe({
        deltaX: -40,
        deltaY: 0,
        currentIndex: 0,
        total: 3,
      }),
    ).toEqual({ direction: 'none', boundary: false });
  });

  it('ignores a swipe without 1.25x horizontal dominance', () => {
    expect(
      resolvePracticeSwipe({
        deltaX: -80,
        deltaY: 70,
        currentIndex: 0,
        total: 3,
      }),
    ).toEqual({ direction: 'none', boundary: false });
  });

  it('moves back from a later question and rebounds at the final question', () => {
    expect(
      resolvePracticeSwipe({
        deltaX: 48,
        deltaY: 38.4,
        currentIndex: 1,
        total: 3,
      }),
    ).toEqual({ direction: 'previous', boundary: false });
    expect(
      resolvePracticeSwipe({
        deltaX: -64,
        deltaY: 0,
        currentIndex: 2,
        total: 3,
      }),
    ).toEqual({ direction: 'none', boundary: true });
  });

  it('does not classify gestures when the session contains only one question', () => {
    expect(
      resolvePracticeSwipe({
        deltaX: -80,
        deltaY: 0,
        currentIndex: 0,
        total: 1,
      }),
    ).toEqual({ direction: 'none', boundary: false });
  });
});
