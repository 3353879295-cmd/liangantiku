import { describe, expect, it } from 'vitest';

import { buildPaper } from '../miniprogram/services/paper-builder';
import { makeQuestion } from './factories';

const questions = [
  makeQuestion({ id: 'Q1', module: '粮情检查' }),
  makeQuestion({ id: 'Q2', module: '安全生产' }),
  makeQuestion({ id: 'Q3', module: '粮情检查' }),
  makeQuestion({ id: 'Q4', module: '设备管理' }),
];

describe('buildPaper', () => {
  it('keeps repository order for sequential practice', () => {
    expect(buildPaper(questions, { mode: 'sequential', limit: 2 }).map((item) => item.id)).toEqual([
      'Q1',
      'Q2',
    ]);
  });

  it('filters a chapter before applying the limit', () => {
    expect(
      buildPaper(questions, { mode: 'chapter', module: '粮情检查', limit: 10 }).map(
        (item) => item.id,
      ),
    ).toEqual(['Q1', 'Q3']);
  });

  it('returns a random paper without duplicates or input mutation', () => {
    const originalOrder = questions.map((item) => item.id);

    const paper = buildPaper(questions, { mode: 'random', limit: 3, random: () => 0.4 });

    expect(paper).toHaveLength(3);
    expect(new Set(paper.map((item) => item.id)).size).toBe(3);
    expect(questions.map((item) => item.id)).toEqual(originalOrder);
  });

  it('clips the requested limit and supports an empty bank', () => {
    expect(buildPaper(questions, { mode: 'mock', limit: 20, random: () => 0.2 })).toHaveLength(4);
    expect(buildPaper([], { mode: 'random', limit: 10 })).toEqual([]);
  });

  it('rejects non-positive limits', () => {
    expect(() => buildPaper(questions, { mode: 'random', limit: 0 })).toThrow(/positive/);
  });
});
