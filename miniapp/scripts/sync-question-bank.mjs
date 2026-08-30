import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  'inspector_l5.json',
  'inspector_l4.json',
  'inspector_l3.json',
];

const countsForShard = (records) => (Array.isArray(records) ? records.length : 0);

const isVisibleCatalogPath = (catalog, record) => {
  const occupation = catalog.occupations?.[record.occupation];
  if (!occupation || !Array.isArray(occupation.parts)) {
    return false;
  }
  return occupation.parts.some(
    (part) =>
      Array.isArray(part?.levels) &&
      part.levels.includes(record.level) &&
      Array.isArray(part.chapters) &&
      part.chapters.some(
        (chapter) =>
          chapter?.id === record.chapter_id &&
          Array.isArray(chapter.sections) &&
          chapter.sections.some((section) => section?.id === record.section_id),
      ),
  );
};

const loadShard = (sourceDir, filename, minimumPerShard, catalog, seenIds, seenFingerprints) => {
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
  const shardMatch = filename.match(/(warehouse|inspector)_l([1-5])\.json$/u);
  const expectedOccupation = shardMatch?.[1] === 'inspector' ? '4-08-05-01' : '4-02-06-01';
  const expectedLevel = shardMatch ? Number(shardMatch[2]) : null;
  for (const record of records) {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
      throw new Error(`${filename} contains a record without an id`);
    }
    if (record.occupation !== expectedOccupation || record.level !== expectedLevel) {
      throw new Error(`${filename} contains a record with an invalid occupation or level`);
    }
    if (!isVisibleCatalogPath(catalog, record)) {
      throw new Error(`${filename} record ${record.id} is not assigned to a visible catalog path`);
    }
    for (const field of ['stem', 'chapter_id', 'section_id', 'options', 'answer']) {
      if (!(field in record)) {
        throw new Error(`${filename} record ${record.id} is missing ${field}`);
      }
    }
    if (
      record.chapter_id === 'warehouse-import-c01' ||
      record.section_id === 'warehouse-import-c01-s01'
    ) {
      throw new Error(`${filename} contains an unclassified import placeholder`);
    }
    if (seenIds.has(record.id)) {
      throw new Error(`duplicate runtime question id: ${record.id}`);
    }
    const fingerprint = JSON.stringify({
      level: record.level,
      stem: record.stem,
      options: record.options,
      answer: record.answer,
      chapter_id: record.chapter_id,
      section_id: record.section_id,
    });
    if (seenFingerprints.has(fingerprint)) {
      throw new Error(`duplicate runtime question content: ${record.id}`);
    }
    seenIds.add(record.id);
    seenFingerprints.add(fingerprint);
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

  const seenIds = new Set();
  const seenFingerprints = new Set();
  const loaded = Object.fromEntries(
    SHARDS.map((filename) => [
      filename,
      loadShard(sourceDir, filename, minimumPerShard, catalog, seenIds, seenFingerprints),
    ]),
  );
  const manifestCandidates = [
    join(sourceDir, 'warehouse_classification_manifest.json'),
    resolve(sourceDir, '..', '..', 'data', 'warehouse_classification_manifest.json'),
  ];
  const manifestPath = manifestCandidates.find((candidate) => existsSync(candidate));
  if (manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const [level, count] of Object.entries(manifest.published_counts ?? {})) {
      const filename = `warehouse_l${level}.json`;
      if (countsForShard(loaded[filename]) !== count) {
        throw new Error(`${filename} count does not match classification manifest`);
      }
    }
  }
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
