import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHARDS, syncQuestionBank } from '../scripts/sync-question-bank.mjs';

const firstShard = SHARDS[0];
if (!firstShard) {
  throw new Error('The question bank contract must define at least one shard');
}

const verifiedRecord = (id: string) => ({ id, review_status: 'verified' });

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'grain-sync-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(source);
  for (const filename of SHARDS) {
    writeFileSync(join(source, filename), JSON.stringify([verifiedRecord(`${filename}-1`)]));
  }
  writeFileSync(
    join(source, 'knowledge_catalog.json'),
    JSON.stringify({
      occupations: {
        '4-02-06-01': {
          title: '粮油仓储管理员',
          parts: [],
        },
      },
    }),
  );
  return { source, target };
};

describe('question bank sync', () => {
  it('packs all five verified shards into the runtime module', () => {
    const { source, target } = createFixture();

    const counts = syncQuestionBank(source, target, { minimumPerShard: 1 });

    expect(Object.keys(counts)).toEqual(SHARDS);
    expect(counts[firstShard]).toBe(1);
    const runtimeModule = readFileSync(join(target, 'runtime-question-records.ts'), 'utf8');
    expect(runtimeModule).toContain('export const RUNTIME_QUESTION_RECORDS');
    expect(runtimeModule).toContain("import { gunzipSync, strFromU8 } from 'fflate';");
    expect(runtimeModule).toContain('const base64ToBytes');
    expect(runtimeModule).not.toContain("from './");
    const catalogModule = readFileSync(join(target, 'runtime-knowledge-catalog.ts'), 'utf8');
    expect(catalogModule).toContain('export const RUNTIME_KNOWLEDGE_CATALOG');
    expect(catalogModule).toContain('粮油仓储管理员');
  });

  it('rejects unpublished records', () => {
    const { source, target } = createFixture();
    writeFileSync(
      join(source, firstShard),
      JSON.stringify([{ id: 'pending-1', review_status: 'pending' }]),
    );

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(/verified/);
  });

  it('requires every shard to meet the release minimum', () => {
    const { source, target } = createFixture();

    expect(() => syncQuestionBank(source, target, { minimumPerShard: 2 })).toThrow(/at least 2/);
  });
});
