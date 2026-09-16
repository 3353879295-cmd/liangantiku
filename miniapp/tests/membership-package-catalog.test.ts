import { describe, expect, it } from 'vitest';
import CATALOG from '../../data/knowledge_catalog.json';
import { RUNTIME_KNOWLEDGE_CATALOG } from '../miniprogram/data/questions/runtime-knowledge-catalog';

describe('catalog packaging for membership size budget', () => {
  it('preserves the complete canonical catalog after gzip decompression', () => {
    expect(RUNTIME_KNOWLEDGE_CATALOG).toEqual(CATALOG);
  });
});
