import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

export const SHARDS = [
  'warehouse_l5.json',
  'warehouse_l4.json',
  'warehouse_l3.json',
  'inspector_l5.json',
  'inspector_l4.json',
  'inspector_l3.json',
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
    writeFileSync(join(targetDir, filename), `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    counts[filename] = records.length;
  }
  const runtimeRecords = SHARDS.flatMap((filename) => loaded[filename]);
  const runtimeModule = `import type { RuntimeQuestionRecord } from '../../types/runtime-question';

export const RUNTIME_QUESTION_RECORDS: RuntimeQuestionRecord[] = ${JSON.stringify(runtimeRecords, null, 2)};
`;
  writeFileSync(join(targetDir, 'runtime-question-records.ts'), runtimeModule, 'utf8');
  const catalogModule = `import type { RuntimeKnowledgeCatalog } from '../../types/knowledge-catalog';

export const RUNTIME_KNOWLEDGE_CATALOG: RuntimeKnowledgeCatalog = ${JSON.stringify(catalog, null, 2)};
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
