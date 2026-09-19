import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncQuestionBank } from '../scripts/sync-question-bank.mjs';

const EXPECTED_SHARDS = [
  'warehouse_l5.json',
  'warehouse_l4.json',
  'warehouse_l3.json',
  'warehouse_l2.json',
  'warehouse_l1.json',
  'inspector_l5.json',
  'inspector_l4.json',
  'inspector_l3.json',
  'inspector_l2.json',
  'inspector_l1.json',
] as const;

const shardRecord = (filename: string) => {
  const [, family, levelText] = filename.match(/(warehouse|inspector)_l([1-5])\.json/u) ?? [];
  const level = Number(levelText);
  const inspector = family === 'inspector';
  const prefix = inspector ? 'QI' : 'WH';
  return {
    id: `${prefix}-L${level}-000001`,
    occupation: inspector ? '4-08-05-01' : '4-02-06-01',
    level,
    chapter_id: inspector ? 'inspector-import-c01' : `warehouse-l${level}-c03`,
    section_id: inspector ? 'inspector-import-c01-s01' : `warehouse-l${level}-c03-s01`,
    stem: `题干 ${filename}`,
    options: [{ key: 'A', text: '选项' }],
    answer: ['A'],
    review_status: 'verified',
  };
};

const catalogPart = (id: string, levels: number[], chapterId: string, sectionId: string) => ({
  id,
  number: 1,
  title: id,
  levels,
  chapters: [
    {
      id: chapterId,
      number: 1,
      title: chapterId,
      page: null,
      sections: [{ id: sectionId, number: 1, title: sectionId, page: null }],
    },
  ],
});

const createCatalog = (inspectorLevels = [5, 4, 3, 2, 1]) => ({
  occupations: {
    '4-02-06-01': {
      title: '粮油仓储管理员',
      parts: [5, 4, 3, 2, 1].map((level) =>
        catalogPart(
          `warehouse-l${level}`,
          [level],
          `warehouse-l${level}-c03`,
          `warehouse-l${level}-c03-s01`,
        ),
      ),
    },
    '4-08-05-01': {
      title: '粮油质量检验员',
      parts: [
        catalogPart(
          'inspector-import',
          inspectorLevels,
          'inspector-import-c01',
          'inspector-import-c01-s01',
        ),
      ],
    },
  },
});

const createFixture = (inspectorLevels = [5, 4, 3, 2, 1]) => {
  const root = mkdtempSync(join(tmpdir(), 'grain-inspector-sync-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(source);
  for (const filename of EXPECTED_SHARDS) {
    writeFileSync(join(source, filename), JSON.stringify([shardRecord(filename)]));
  }
  writeFileSync(
    join(source, 'knowledge_catalog.json'),
    JSON.stringify(createCatalog(inspectorLevels)),
  );
  return { source, target };
};

describe('inspector question bank sync', () => {
  it('packs warehouse and inspector release shards into one runtime module', () => {
    const { source, target } = createFixture();

    const counts = syncQuestionBank(source, target, { minimumPerShard: 1 });

    expect(Object.keys(counts)).toEqual(EXPECTED_SHARDS);
    expect(counts['inspector_l5.json']).toBe(1);
    expect(counts['inspector_l4.json']).toBe(1);
    expect(counts['inspector_l3.json']).toBe(1);
    expect(counts['inspector_l2.json']).toBe(1);
    expect(counts['inspector_l1.json']).toBe(1);
    const runtimeModule = readFileSync(join(target, 'runtime-question-records.ts'), 'utf8');
    expect(runtimeModule).toContain('export const RUNTIME_QUESTION_BANK');
  });

  it('rejects inspector records when their catalog path is not visible at that level', () => {
    const { source, target } = createFixture([5, 4]);

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(/catalog path/);
  });

  it('rejects inspector records whose section is not in the declared chapter', () => {
    const { source, target } = createFixture();
    writeFileSync(
      join(source, 'inspector_l5.json'),
      JSON.stringify([
        {
          ...shardRecord('inspector_l5.json'),
          section_id: 'warehouse-l5-c03-s01',
        },
      ]),
    );

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(/catalog path/);
  });
});
