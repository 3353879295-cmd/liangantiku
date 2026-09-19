import type { AnswerRevealMode } from '../../../types/domain';

export interface RevealModeOption {
  value: AnswerRevealMode;
  title: string;
  selected: boolean;
}

export const presentRevealModes = (selected: AnswerRevealMode): RevealModeOption[] => [
  {
    value: 'immediate',
    title: '即时解析',
    selected: selected === 'immediate',
  },
  {
    value: 'deferred',
    title: '交卷后解析',
    selected: selected === 'deferred',
  },
];
