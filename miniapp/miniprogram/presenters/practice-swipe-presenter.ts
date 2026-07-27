export type PracticeSwipeDirection = 'previous' | 'next' | 'none';

export interface PracticeSwipeInput {
  deltaX: number;
  deltaY: number;
  currentIndex: number;
  total: number;
}

export interface PracticeSwipeResult {
  direction: PracticeSwipeDirection;
  boundary: boolean;
}

const SWIPE_THRESHOLD_PX = 48;
const HORIZONTAL_DOMINANCE = 1.25;
const NO_SWIPE: PracticeSwipeResult = { direction: 'none', boundary: false };

export const resolvePracticeSwipe = (input: PracticeSwipeInput): PracticeSwipeResult => {
  if (input.total <= 1) return NO_SWIPE;

  const absoluteX = Math.abs(input.deltaX);
  const absoluteY = Math.abs(input.deltaY);
  if (absoluteX < SWIPE_THRESHOLD_PX || absoluteX < absoluteY * HORIZONTAL_DOMINANCE) {
    return NO_SWIPE;
  }

  if (input.deltaX > 0) {
    return input.currentIndex === 0
      ? { direction: 'none', boundary: true }
      : { direction: 'previous', boundary: false };
  }

  return input.currentIndex >= input.total - 1
    ? { direction: 'none', boundary: true }
    : { direction: 'next', boundary: false };
};
