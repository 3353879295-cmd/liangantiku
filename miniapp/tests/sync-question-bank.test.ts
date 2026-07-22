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
  return { source, target };
};

describe('question bank sync', () => {
  it('copies all six verified shards', () => {
    const { source, target } = createFixture();

    const counts = syncQuestionBank(source, target, { minimumPerShard: 1 });

    expect(Object.keys(counts)).toEqual(SHARDS);
    expect(counts[firstShard]).toBe(1);
    expect(JSON.parse(readFileSync(join(target, firstShard), 'utf8'))).toHaveLength(1);
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
