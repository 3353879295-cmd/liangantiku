import { describe, expect, it } from 'vitest';

import { PRACTICAL_SKILLS, getPracticalSkill } from '../miniprogram/data/practical-skills';

describe('practical skill catalog', () => {
  it('contains twelve complete and uniquely addressable guides', () => {
    expect(PRACTICAL_SKILLS).toHaveLength(12);
    expect(new Set(PRACTICAL_SKILLS.map((item) => item.id)).size).toBe(12);
    for (const skill of PRACTICAL_SKILLS) {
      expect(skill.preparations.length).toBeGreaterThan(0);
      expect(skill.steps.length).toBeGreaterThanOrEqual(3);
      expect(skill.safetyNotes.length).toBeGreaterThan(0);
      expect(skill.commonMistakes.length).toBeGreaterThan(0);
      expect(skill.sourceIds.length).toBeGreaterThan(0);
      expect(skill.standardReference.trim()).not.toBe('');
      expect(getPracticalSkill(skill.id)).toBe(skill);
    }
    expect(PRACTICAL_SKILLS.map((item) => item.id)).toEqual([
      'grain-condition-rounds',
      'warehouse-entry-check',
      'mechanical-ventilation',
      'fumigation-safety',
      'stored-pest-check',
      'abnormal-heating-response',
      'sampling',
      'sample-division',
      'moisture-test',
      'impurity-test',
      'test-weight',
      'laboratory-safety',
    ]);
  });

  it('returns undefined for an unknown guide', () => {
    expect(getPracticalSkill('missing')).toBeUndefined();
  });
});
