import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRACTICAL_SKILLS, getPracticalSkill } from '../miniprogram/data/practical-skills';
import { QUESTION_RECORDS } from '../miniprogram/data/question-bank';

const miniprogramRoot = resolve(import.meta.dirname, '..', 'miniprogram');

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

  it('gives every guide a meaningful purpose and a local semantic PNG icon', () => {
    const expectedIcons = new Set([
      '/assets/practical/warehouse.png',
      '/assets/practical/thermometer.png',
      '/assets/practical/grain-pest.png',
      '/assets/practical/sampler.png',
      '/assets/practical/moisture-test.png',
    ]);

    for (const skill of PRACTICAL_SKILLS) {
      expect(skill.purpose.trim(), `${skill.id} needs an operation purpose`).not.toBe('');
      expect(expectedIcons.has(skill.iconAsset), `${skill.id} needs a semantic icon`).toBe(true);

      const filename = basename(skill.iconAsset);
      expect(filename).not.toMatch(/^\p{Script=Han}\.png$/u);
      expect(filename).not.toMatch(/^text-/);

      const iconPath = join(miniprogramRoot, ...skill.iconAsset.split('/').filter(Boolean));
      expect(existsSync(iconPath), `${skill.iconAsset} is missing`).toBe(true);
      expect(readFileSync(iconPath).subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    }
  });

  it('links every skill only to published questions for the same occupation', () => {
    const questions = new Map(QUESTION_RECORDS.map((question) => [question.id, question]));

    for (const skill of PRACTICAL_SKILLS) {
      expect(skill.relatedQuestionIds.length, `${skill.id} needs related practice`).toBeGreaterThan(
        0,
      );
      for (const questionId of skill.relatedQuestionIds) {
        const question = questions.get(questionId);
        expect(question, `${skill.id} links missing question ${questionId}`).toBeDefined();
        expect(question?.occupation, `${skill.id} links another occupation`).toBe(skill.occupation);
      }
    }
  });
});
