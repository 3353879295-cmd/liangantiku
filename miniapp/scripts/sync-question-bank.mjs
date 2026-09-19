import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  'inspector_l2.json',
  'inspector_l1.json',
];

const countsForShard = (records) => (Array.isArray(records) ? records.length : 0);

const replaceGeneratedArtifacts = (targetDir, artifacts, { rename = renameSync } = {}) => {
  const timestamp = `${process.pid}-${Date.now()}`;
  const staged = artifacts.map(({ filename, content }, index) => {
    const targetPath = join(targetDir, filename);
    const temporaryPath = join(targetDir, `.${filename}.${timestamp}-${index}.tmp`);
    const previous = existsSync(targetPath) ? readFileSync(targetPath) : null;
    writeFileSync(temporaryPath, content, 'utf8');
    return { targetPath, temporaryPath, previous };
  });
  const replaced = [];
  let currentArtifact;
  try {
    for (const artifact of staged) {
      currentArtifact = artifact;
      try {
        rename(artifact.temporaryPath, artifact.targetPath);
      } catch (error) {
        if (!existsSync(artifact.targetPath) || error?.code !== 'EEXIST') throw error;
        unlinkSync(artifact.targetPath);
        rename(artifact.temporaryPath, artifact.targetPath);
      }
      replaced.push(artifact);
      currentArtifact = undefined;
    }
  } catch (error) {
    const restore = currentArtifact ? [...replaced, currentArtifact] : replaced;
    for (const artifact of restore.reverse()) {
      if (artifact.previous === null) {
        if (existsSync(artifact.targetPath)) unlinkSync(artifact.targetPath);
      } else {
        writeFileSync(artifact.targetPath, artifact.previous);
      }
    }
    throw error;
  } finally {
    for (const artifact of staged) {
      if (existsSync(artifact.temporaryPath)) unlinkSync(artifact.temporaryPath);
    }
  }
};

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

/**
 * @param {string} sourceDir
 * @param {string} targetDir
 * @param {{minimumPerShard?: number, fileOps?: {renameSync?: (from: string, to: string) => void}}} options
 */
export function syncQuestionBank(sourceDir, targetDir, { minimumPerShard = 8, fileOps } = {}) {
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
  const runtimeShards = SHARDS.map((filename) => {
    const match = filename.match(/(warehouse|inspector)_l([1-5])\.json$/u);
    if (!match) throw new Error(`Cannot determine runtime shard metadata for ${filename}`);
    const encoded = gzipSync(Buffer.from(JSON.stringify(loaded[filename])), { level: 9 }).toString(
      'base64',
    );
    return {
      occupation: match[1] === 'inspector' ? '4-08-05-01' : '4-02-06-01',
      level: Number(match[2]),
      count: loaded[filename].length,
      paths: [
        ...new Map(
          loaded[filename].map((record) => [
            `${record.module}\u0000${record.chapter_id}\u0000${record.section_id}`,
            { module: record.module, chapterId: record.chapter_id, sectionId: record.section_id },
          ]),
        ).values(),
      ],
      chunks: encoded.match(/.{1,4096}/g) ?? [],
    };
  });
  const runtimeModule = `import { gunzipSync, strFromU8 } from 'fflate';
import type {
  RuntimeQuestionBank,
  RuntimeQuestionRecord,
  RuntimeQuestionShard,
} from '../../types/runtime-question';

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof wx !== 'undefined' && typeof wx.base64ToArrayBuffer === 'function') {
    return new Uint8Array(wx.base64ToArrayBuffer(value));
  }
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const createShard = (
  occupation: RuntimeQuestionShard['occupation'],
  level: RuntimeQuestionShard['level'],
  count: number,
  paths: RuntimeQuestionShard['paths'],
  packed: string,
): RuntimeQuestionShard => {
  let records: RuntimeQuestionRecord[] | undefined;
  return {
    occupation,
    level,
    count,
    paths,
    load: () => {
      if (records) return records;
      const decoded: unknown = JSON.parse(strFromU8(gunzipSync(base64ToBytes(packed))));
      if (!Array.isArray(decoded)) throw new Error('题库分片数据格式无效');
      records = decoded as RuntimeQuestionRecord[];
      return records;
    },
  };
};

export const RUNTIME_QUESTION_SHARDS: readonly RuntimeQuestionShard[] = [
${runtimeShards
  .map(
    ({ occupation, level, count, paths, chunks }) => `  createShard(
    '${occupation}',
    ${level},
    ${count},
    ${JSON.stringify(paths)},
    [
${chunks.map((chunk) => `      '${chunk}',`).join('\n')}
    ].join(''),
  ),`,
  )
  .join('\n')}
];

export const RUNTIME_QUESTION_COUNTS: RuntimeQuestionBank['counts'] = {
  '4-02-06-01': {
${runtimeShards
  .filter(({ occupation }) => occupation === '4-02-06-01')
  .map(({ level, count }) => `    ${level}: ${count},`)
  .join('\n')}
  },
  '4-08-05-01': {
${runtimeShards
  .filter(({ occupation }) => occupation === '4-08-05-01')
  .map(({ level, count }) => `    ${level}: ${count},`)
  .join('\n')}
  },
};

const shardForId = (id: string): RuntimeQuestionShard | undefined => {
  const match = /^(WH|QI)-L([1-5])-/u.exec(id);
  if (!match) return undefined;
  const occupation = match[1] === 'QI' ? '4-08-05-01' : '4-02-06-01';
  const level = Number(match[2]);
  return RUNTIME_QUESTION_SHARDS.find(
    (shard) => shard.occupation === occupation && shard.level === level,
  );
};

export const RUNTIME_QUESTION_BANK: RuntimeQuestionBank = {
  shards: RUNTIME_QUESTION_SHARDS,
  counts: RUNTIME_QUESTION_COUNTS,
  shardForId,
};

/** @deprecated Load through RUNTIME_QUESTION_BANK to avoid startup decompression. */
export const loadRuntimeQuestionRecords = (): RuntimeQuestionRecord[] =>
  RUNTIME_QUESTION_SHARDS.flatMap((shard) => shard.load());
`;
  const encodedCatalog = gzipSync(Buffer.from(JSON.stringify(catalog)), { level: 9 }).toString(
    'base64',
  );
  const catalogChunks = encodedCatalog.match(/.{1,4096}/g) ?? [];
  const catalogModule = `import { gunzipSync, strFromU8 } from 'fflate';
import type { RuntimeKnowledgeCatalog } from '../../types/knowledge-catalog';

// 目录数据包含：${Object.values(catalog.occupations)
    .map((occupation) => occupation.title)
    .join('、')}

const packed = [
${catalogChunks.map((chunk) => `  '${chunk}',`).join('\n')}
].join('');

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof wx !== 'undefined' && typeof wx.base64ToArrayBuffer === 'function') {
    return new Uint8Array(wx.base64ToArrayBuffer(value));
  }
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const catalog: unknown = JSON.parse(strFromU8(gunzipSync(base64ToBytes(packed))));

export const RUNTIME_KNOWLEDGE_CATALOG = catalog as RuntimeKnowledgeCatalog;
`;
  replaceGeneratedArtifacts(
    targetDir,
    [
      { filename: 'runtime-question-records.ts', content: runtimeModule },
      { filename: 'runtime-knowledge-catalog.ts', content: catalogModule },
    ],
    { rename: fileOps?.renameSync },
  );
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
