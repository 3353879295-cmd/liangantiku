import { mkdtempSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHARDS, syncQuestionBank } from '../scripts/sync-question-bank.mjs';

const firstShard = SHARDS[0];
if (!firstShard) {
  throw new Error('The question bank contract must define at least one shard');
}

const verifiedRecord = (id: string, level = 5, occupation = '4-02-06-01') => ({
  id,
  occupation,
  level,
  chapter_id: occupation === '4-08-05-01' ? 'inspector-import-c01' : `warehouse-l${level}-c03`,
  section_id:
    occupation === '4-08-05-01' ? 'inspector-import-c01-s01' : `warehouse-l${level}-c03-s01`,
  stem: `题干 ${id}`,
  options: [{ key: 'A', text: '选项' }],
  answer: ['A'],
  review_status: 'verified',
});

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

const createCatalog = () => ({
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
          [5, 4, 3, 2, 1],
          'inspector-import-c01',
          'inspector-import-c01-s01',
        ),
      ],
    },
  },
});

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'grain-sync-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(source);
  for (const filename of SHARDS) {
    const level = Number(filename.match(/l([1-5])/u)?.[1]);
    const occupation = filename.startsWith('inspector_') ? '4-08-05-01' : '4-02-06-01';
    writeFileSync(
      join(source, filename),
      JSON.stringify([verifiedRecord(`${filename}-1`, level, occupation)]),
    );
  }
  writeFileSync(join(source, 'knowledge_catalog.json'), JSON.stringify(createCatalog()));
  return { source, target };
};

describe('question bank sync', () => {
  it('packs every verified release shard into the runtime module', () => {
    const { source, target } = createFixture();

    const counts = syncQuestionBank(source, target, { minimumPerShard: 1 });

    expect(Object.keys(counts)).toEqual(SHARDS);
    expect(counts[firstShard]).toBe(1);
    const runtimeModule = readFileSync(join(target, 'runtime-question-records.ts'), 'utf8');
    expect(runtimeModule).toContain('export const RUNTIME_QUESTION_BANK');
    expect(runtimeModule).toContain('export const RUNTIME_QUESTION_COUNTS');
    expect(runtimeModule).toContain("import { gunzipSync, strFromU8 } from 'fflate';");
    expect(runtimeModule).toContain('const createShard');
    expect(runtimeModule).not.toContain("from './");
    const catalogModule = readFileSync(join(target, 'runtime-knowledge-catalog.ts'), 'utf8');
    expect(catalogModule).toContain('export const RUNTIME_KNOWLEDGE_CATALOG');
    expect(catalogModule).toContain('粮油仓储管理员');
  });

  it('rolls back both generated runtime modules when the second replacement fails', () => {
    const { source, target } = createFixture();
    const recordsPath = join(target, 'runtime-question-records.ts');
    const catalogPath = join(target, 'runtime-knowledge-catalog.ts');
    mkdirSync(target);
    writeFileSync(recordsPath, 'old records', 'utf8');
    writeFileSync(catalogPath, 'old catalog', 'utf8');

    expect(() =>
      syncQuestionBank(source, target, {
        minimumPerShard: 1,
        fileOps: {
          renameSync(from: string, to: string) {
            if (to === catalogPath) throw new Error('second replacement failed');
            renameSync(from, to);
          },
        },
      }),
    ).toThrow(/second replacement failed/);
    expect(readFileSync(recordsPath, 'utf8')).toBe('old records');
    expect(readFileSync(catalogPath, 'utf8')).toBe('old catalog');
  });

  it('restores the current artifact after a Windows EEXIST fallback loses its second rename', () => {
    const { source, target } = createFixture();
    const recordsPath = join(target, 'runtime-question-records.ts');
    const catalogPath = join(target, 'runtime-knowledge-catalog.ts');
    mkdirSync(target);
    writeFileSync(recordsPath, 'old records', 'utf8');
    writeFileSync(catalogPath, 'old catalog', 'utf8');
    let catalogRenameAttempts = 0;

    expect(() =>
      syncQuestionBank(source, target, {
        minimumPerShard: 1,
        fileOps: {
          renameSync(from: string, to: string) {
            if (to === catalogPath) {
              catalogRenameAttempts += 1;
              const error = new Error(
                catalogRenameAttempts === 1 ? 'destination exists' : 'second rename failed',
              ) as NodeJS.ErrnoException;
              error.code = catalogRenameAttempts === 1 ? 'EEXIST' : 'EIO';
              throw error;
            }
            renameSync(from, to);
          },
        },
      }),
    ).toThrow(/second rename failed/);
    expect(catalogRenameAttempts).toBe(2);
    expect(readFileSync(recordsPath, 'utf8')).toBe('old records');
    expect(readFileSync(catalogPath, 'utf8')).toBe('old catalog');
  });

  it('rejects unpublished records', () => {
    const { source, target } = createFixture();
    writeFileSync(
      join(source, firstShard),
      JSON.stringify([{ ...verifiedRecord('pending-1'), review_status: 'pending' }]),
    );

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(/verified/);
  });

  it('requires every shard to meet the release minimum', () => {
    const { source, target } = createFixture();

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 2 })).toThrow(/at least 2/);
  });

  it('rejects duplicate ids before generating runtime files', () => {
    const { source, target } = createFixture();
    writeFileSync(
      join(source, SHARDS[1] ?? firstShard),
      JSON.stringify([verifiedRecord(`${firstShard}-1`, 4)]),
    );

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(
      /duplicate runtime question id/,
    );
  });

  it('rejects duplicate content with different ids before generating runtime files', () => {
    const { source, target } = createFixture();
    const record = verifiedRecord('original-1');
    writeFileSync(
      join(source, firstShard),
      JSON.stringify([record, { ...record, id: 'duplicate-content-1' }]),
    );

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(
      /duplicate runtime question content: duplicate-content-1/,
    );
  });

  it('rejects warehouse records whose chapter or section is not on their catalog path', () => {
    const { source, target } = createFixture();
    writeFileSync(
      join(source, firstShard),
      JSON.stringify([
        {
          ...verifiedRecord('warehouse-invalid-path'),
          chapter_id: 'warehouse-l5-c99',
          section_id: 'warehouse-l5-c99-s01',
        },
      ]),
    );

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(/catalog path/);
  });

  it('rejects warehouse records whose section belongs to a different occupation path', () => {
    const { source, target } = createFixture();
    writeFileSync(
      join(source, firstShard),
      JSON.stringify([
        {
          ...verifiedRecord('warehouse-cross-occupation-path'),
          chapter_id: 'inspector-c01',
          section_id: 'inspector-c01-s01',
        },
      ]),
    );

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(/catalog path/);
  });
});
