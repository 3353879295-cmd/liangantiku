import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { gzipSync } from 'node:zlib';

export const SHARDS = [
  'warehouse_l5.json',
  'warehouse_l4.json',
  'warehouse_l3.json',
  'warehouse_l2.json',
  'warehouse_l1.json',
];

const loadShard = (sourceDir, filename, minimumPerShard) => {
  const sourcePath = join(sourceDir, filename);
  let records;
  try {
    records = JSON.parse(readFileSync(sourcePath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${filename}: ${detail}`, { cause: error });
  }
  if (!Array.isArray(records) || records.length < minimumPerShard) {
    throw new Error(`${filename} must contain at least ${minimumPerShard} questions`);
  }
  if (records.some((record) => record?.review_status !== 'verified')) {
    throw new Error(`${filename} must contain verified questions only`);
  }
  return records;
};

export function syncQuestionBank(sourceDir, targetDir, { minimumPerShard = 8 } = {}) {
  if (!Number.isInteger(minimumPerShard) || minimumPerShard < 1) {
    throw new Error('minimumPerShard must be a positive integer');
  }

  const catalog = JSON.parse(readFileSync(join(sourceDir, 'knowledge_catalog.json'), 'utf8'));
  if (!catalog || typeof catalog !== 'object' || !catalog.occupations) {
    throw new Error('knowledge_catalog.json must contain occupations');
  }

  const loaded = Object.fromEntries(
    SHARDS.map((filename) => [filename, loadShard(sourceDir, filename, minimumPerShard)]),
  );
  mkdirSync(targetDir, { recursive: true });

  const counts = {};
  for (const filename of SHARDS) {
    const records = loaded[filename];
    counts[filename] = records.length;
  }
  const runtimeRecords = SHARDS.flatMap((filename) => loaded[filename]);
  const encodedRecords = gzipSync(Buffer.from(JSON.stringify(runtimeRecords))).toString('base64');
  const packedChunks = encodedRecords.match(/.{1,120}/g) ?? [];
  const runtimeModule = `import { gunzipSync, strFromU8 } from 'fflate';
import type { RuntimeQuestionRecord } from '../../types/runtime-question';

const packed = [
${packedChunks.map((chunk) => `  '${chunk}',`).join('\n')}
].join('');

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof wx !== 'undefined' && typeof wx.base64ToArrayBuffer === 'function') {
    return new Uint8Array(wx.base64ToArrayBuffer(value));
  }
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const compressed = base64ToBytes(packed);
const records: unknown = JSON.parse(strFromU8(gunzipSync(compressed)));

export const RUNTIME_QUESTION_RECORDS = records as RuntimeQuestionRecord[];
`;
  writeFileSync(join(targetDir, 'runtime-question-records.ts'), runtimeModule, 'utf8');
  const catalogModule = `import type { RuntimeKnowledgeCatalog } from '../../types/knowledge-catalog';

const catalog: unknown = ${JSON.stringify(catalog, null, 2)};

export const RUNTIME_KNOWLEDGE_CATALOG = catalog as RuntimeKnowledgeCatalog;
`;
  writeFileSync(join(targetDir, 'runtime-knowledge-catalog.ts'), catalogModule, 'utf8');
  return counts;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(modulePath)) {
  const scriptDir = dirname(modulePath);
  const sourceDir = resolve(scriptDir, '..', '..', 'dist', 'json');
  const targetDir = resolve(scriptDir, '..', 'miniprogram', 'data', 'questions');
  const counts = syncQuestionBank(sourceDir, targetDir);
  for (const filename of SHARDS) {
    process.stdout.write(`${filename}: ${counts[filename]}\n`);
  }
}
