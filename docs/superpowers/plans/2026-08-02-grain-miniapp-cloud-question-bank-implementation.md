# 粮安库版本化云题库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“粮安库”小程序切换为通过微信云函数读取版本化云数据库题库，并建立从本地 JSONL 校验、云发布、激活到回滚的安全流程。

**Architecture:** `data/questions/*.jsonl` 继续作为唯一真源，本地构建器生成不可变的云发布包；小程序通过 `CloudQuestionRepository` 调用只读 `questionBank` 云函数，云函数只读取当前版或上一版。用户进度继续保存在本地，题库只在单次运行的内存中复用，不写入持久化缓存。

**Tech Stack:** Python 3、Node.js 24（本地工具）、TypeScript 6、Vitest 4、原生微信小程序、微信云开发、Node.js 20 云函数、`wx-server-sdk` 3.0.1、云开发文档型数据库。

## Global Constraints

- 正式 AppID 固定为 `wx84ecacec08ca162c`。
- 云环境固定为 `cloud1-d2gglad830c91db10`。
- `data/questions/*.jsonl` 是题目唯一真源，禁止在云数据库中直接编辑题目正文。
- 只有 `verified` 题目可以进入云发布包。
- 第一阶段学习进度、错题、收藏和设置继续保存在微信本地存储。
- 题库不使用 `wx.setStorage`、`wx.setStorageSync` 或其他持久化缓存。
- 云端仅保留当前正式版和上一个正式版的题目正文；历史发布记录保留。
- 不索取、保存、打印或提交 AppSecret、SecretId、SecretKey、访问令牌或 OpenID。
- 不修改套餐、自动续费、超额按量付费或其他计费设置。
- 创建集合、索引、权限或云函数前必须再次取得用户确认。
- 导入正式题库和切换正式版本指针前必须展示环境、发布 ID、题量和回滚目标并再次取得用户确认。
- 保留工作区现有未提交改动；禁止使用 `git reset --hard`、`git checkout --`、整仓暂存或覆盖式格式化。
- 每次提交只暂存当前任务明确列出的文件或补丁块，不使用无范围的 `git add .`。
- 实施前使用 `superpowers:using-git-worktrees` 检查隔离条件；由于当前工作区存在会与本计划重叠的未提交改动，先取得用户对安全检查点提交的授权，再决定在当前工作区继续或创建 worktree。

---

## File Structure

### 本地发布边界

- `miniapp/scripts/build-cloud-question-bank-release.mjs`：读取已验证的 `dist/json` 和源数据，生成不可变云发布包。
- `miniapp/scripts/build-cloud-question-bank-release.d.mts`：给 Vitest/TypeScript 暴露发布器类型。
- `miniapp/tests/build-cloud-question-bank-release.test.ts`：覆盖摘要、版本 ID、题量、原子输出和非法数据拒绝。
- `miniapp/scripts/sync-knowledge-catalog.mjs`：只同步随包发布的知识目录，不再生成本地题目。
- `miniapp/scripts/sync-knowledge-catalog.d.mts`：知识目录同步器类型。
- `miniapp/tests/sync-knowledge-catalog.test.ts`：验证目录同步边界。
- `miniapp/tests/source-question-fixtures.ts`：测试环境从 JSONL 真源读取已发布题目，代替小程序包内题库副本。

### 小程序云读取边界

- `miniapp/miniprogram/config/cloud.ts`：环境 ID、函数名和数据结构版本常量。
- `miniapp/miniprogram/types/cloud-question.ts`：云函数请求、响应和稳定业务错误码。
- `miniapp/miniprogram/repositories/runtime-question-adapter.ts`：运行时记录校验与 `snake_case` → `camelCase` 映射。
- `miniapp/miniprogram/repositories/cloud-question-repository.ts`：版本固定、分批读取、内存复用和响应校验。
- `miniapp/miniprogram/repositories/local-question-repository.ts`：保留给单元测试和纯内存场景，复用共享适配器。
- `miniapp/miniprogram/data/knowledge-catalog.ts`：导出随包目录及其摘要，用于阻止不兼容云版本。
- `miniapp/miniprogram/services/app-services.ts`：生产单例改用云 Repository。
- `miniapp/miniprogram/app.ts`：全局初始化指定云环境。

### 云函数边界

- `miniapp/cloudfunctions/questionBank/lib/handler.js`：纯业务处理器，校验 action、版本和筛选条件。
- `miniapp/cloudfunctions/questionBank/lib/handler.d.ts`：处理器测试类型。
- `miniapp/cloudfunctions/questionBank/lib/store.js`：数据库查询、分页和字段投影。
- `miniapp/cloudfunctions/questionBank/lib/store.d.ts`：Store 测试类型。
- `miniapp/cloudfunctions/questionBank/index.js`：初始化 `wx-server-sdk` 并组合 Store 与 Handler。
- `miniapp/cloudfunctions/questionBank/package.json`、`package-lock.json`：固定云函数依赖。
- `miniapp/tests/cloud-question-function.test.ts`：纯 Handler 契约测试。
- `miniapp/tests/cloud-question-store.test.ts`：数据库适配与分页测试。

### 页面与文档

- 首页、目录、章节、设置、模拟、练习和学习报告页面：增加明确加载失败和重试状态。
- `docs/cloud-question-bank-operations.md`：面向首次开发者的发布、回滚和故障处理手册。
- `docs/question-runtime-contract.md`、`docs/miniapp-acceptance-checklist.md`、`README.md`：改为云题库发布契约。
- `docs/qa/2026-08-02-cloud-resource-provisioning.md`：记录资源创建结果，不记录秘密。
- `docs/qa/2026-08-02-cloud-question-bank-release.md`：记录首次发布与回滚证据。

---

### Task 1: Build a deterministic cloud release package

**Files:**
- Create: `miniapp/scripts/build-cloud-question-bank-release.mjs`
- Create: `miniapp/scripts/build-cloud-question-bank-release.d.mts`
- Create: `miniapp/tests/build-cloud-question-bank-release.test.ts`
- Modify: `miniapp/package.json`

**Interfaces:**
- Consumes: six JSON arrays and `knowledge_catalog.json` in `dist/json`, `dist/version-report.json`, plus `data/questions/*.jsonl`, `data/sources.json`, `data/taxonomy.json`, and `data/knowledge_catalog.json`.
- Produces: `buildCloudQuestionBankRelease(options): CloudReleaseBuildResult` and the three files under `dist/cloud/$releaseId`.

- [ ] **Step 1: Write the failing release-builder tests**

Create fixtures for six one-record shards, a matching version report, and four source inputs. Assert deterministic output and a safe database shape:

```ts
const result = buildCloudQuestionBankRelease({
  repositoryRoot: fixture.repositoryRoot,
  outputRoot: fixture.outputRoot,
  now: new Date('2026-08-02T05:00:00.000Z'),
});

expect(result.releaseId).toMatch(/^qb-20260802T050000Z-[a-f0-9]{12}$/);
expect(result.questionCount).toBe(6);
expect(result.shardCounts).toEqual(Object.fromEntries(SHARDS.map((name) => [name, 1])));

const documents = readFileSync(result.questionsPath, 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
expect(documents[0]).toMatchObject({
  _id: `${result.releaseId}__WH-L5-000001`,
  release_id: result.releaseId,
  question_id: 'WH-L5-000001',
  id: 'WH-L5-000001',
  review_status: 'verified',
});
```

Add separate tests that reject a `pending` record, duplicate question ID, report/count mismatch, missing source input, and pre-existing release directory. For each failure, assert that no final release directory exists.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/build-cloud-question-bank-release.test.ts
```

Expected: FAIL because `build-cloud-question-bank-release.mjs` does not exist.

- [ ] **Step 3: Define the public types**

Create the declaration file with exact signatures:

```ts
export const SHARDS: readonly string[];

export interface CloudReleaseBuildOptions {
  repositoryRoot: string;
  outputRoot: string;
  now?: Date;
}

export interface CloudReleaseBuildResult {
  releaseId: string;
  releaseDirectory: string;
  questionsPath: string;
  releasePath: string;
  verificationPath: string;
  questionCount: number;
  shardCounts: Record<string, number>;
  sourceDigest: string;
  catalogDigest: string;
}

export function buildCloudQuestionBankRelease(
  options: CloudReleaseBuildOptions,
): CloudReleaseBuildResult;
```

- [ ] **Step 4: Implement validation, hashing, and atomic output**

Implement these exact rules in the `.mjs` module:

```js
const RELEASE_SCHEMA_VERSION = 1;
const RELEASE_ID_PATTERN = /^qb-\d{8}T\d{6}Z-[a-f0-9]{12}$/;

const formatUtcStamp = (date) =>
  date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

const createReleaseId = (date, sourceDigest) =>
  `qb-${formatUtcStamp(date)}-${sourceDigest.slice(0, 12)}`;

const databaseDocument = (releaseId, record) => ({
  _id: `${releaseId}__${record.id}`,
  release_id: releaseId,
  question_id: record.id,
  ...record,
});
```

Hash source files in sorted relative-path order, including each relative path and raw byte content. Load and validate every input before creating a temporary output directory. Write all three files into the temporary directory, then rename it to the final release directory. Use JSON Lines with exactly one UTF-8 JSON object per line and a final newline.

The release record must contain `status: "staging"`, `schema_version: 1`, the two digests, total and shard counts, warning count, ISO `created_at`, empty `activated_at`, and a non-secret note. The verification record must repeat the release ID, expected counts, digests, and filenames.

- [ ] **Step 5: Add the npm command**

Add this script without removing the existing verification scripts:

```json
"build:cloud-release": "node scripts/build-cloud-question-bank-release.mjs"
```

The command-line entry resolves the repository root as the parent of `miniapp`, uses `$repositoryRoot/dist/cloud` as output, prints only release ID, counts, and file paths, and never prints source contents or credentials.

- [ ] **Step 6: Run focused and existing transfer tests**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/build-cloud-question-bank-release.test.ts tests/sync-question-bank.test.ts
npm run typecheck
npm run lint
```

Expected: all selected tests, typecheck, and lint PASS.

- [ ] **Step 7: Commit only Task 1 files**

```powershell
git add -- miniapp/scripts/build-cloud-question-bank-release.mjs miniapp/scripts/build-cloud-question-bank-release.d.mts miniapp/tests/build-cloud-question-bank-release.test.ts miniapp/package.json miniapp/package-lock.json
git commit -m "feat: build versioned cloud question releases"
```

### Task 2: Share strict runtime question validation

**Files:**
- Create: `miniapp/miniprogram/repositories/runtime-question-adapter.ts`
- Create: `miniapp/tests/runtime-question-adapter.test.ts`
- Modify: `miniapp/miniprogram/repositories/local-question-repository.ts`
- Modify: `miniapp/tests/local-question-repository.test.ts`

**Interfaces:**
- Consumes: unknown cloud values or typed local `RuntimeQuestionRecord` objects.
- Produces: `parseRuntimeQuestionRecord(value: unknown): RuntimeQuestionRecord` and `adaptRuntimeQuestionRecord(record: RuntimeQuestionRecord): Question`.

- [ ] **Step 1: Write failing parser and adapter tests**

```ts
expect(adaptRuntimeQuestionRecord(runtimeQuestion())).toMatchObject({
  id: 'WH-L5-000001',
  chapterId: 'warehouse-l5-c03',
  sourceIds: ['SRC-0001'],
  reviewStatus: 'verified',
  knowledgePoint: '粮温检查',
});

expect(() => parseRuntimeQuestionRecord({ ...runtimeQuestion(), answer: ['Z'] })).toThrow(
  /answer/i,
);
expect(() => parseRuntimeQuestionRecord({ ...runtimeQuestion(), review_status: 'pending' })).toThrow(
  /review_status/i,
);
expect(() => parseRuntimeQuestionRecord({ ...runtimeQuestion(), options: 'bad' })).toThrow(
  /options/i,
);
```

Also assert that returned arrays/options are cloned and sorted answers do not mutate the input.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/runtime-question-adapter.test.ts tests/local-question-repository.test.ts
```

Expected: FAIL because the shared adapter module does not exist.

- [ ] **Step 3: Implement the strict parser**

Use allowlists from existing domain types and reject missing/extra-shape values at the cloud boundary. The exported surface must be:

```ts
export const parseRuntimeQuestionRecord = (value: unknown): RuntimeQuestionRecord => {
  if (!isPlainObject(value)) throw new Error('question must be an object');
  requireString(value, 'id');
  requireOneOf(value, 'occupation', ['4-02-06-01', '4-08-05-01']);
  requireOneOf(value, 'level', [5, 4, 3]);
  requireOneOf(value, 'type', QUESTION_TYPES);
  requireOneOf(value, 'review_status', ['verified', 'sample']);
  validateOptionsAndAnswers(value);
  return cloneRuntimeQuestionRecord(value);
};

export const adaptRuntimeQuestionRecord = (record: RuntimeQuestionRecord): Question => ({
  id: record.id,
  occupation: record.occupation,
  direction: record.direction,
  level: record.level,
  module: record.module,
  topic: record.topic,
  chapterId: record.chapter_id,
  sectionId: record.section_id,
  type: record.type,
  stem: record.stem,
  options: record.options.map((option) => ({ ...option })),
  answer: [...record.answer].sort(),
  explanation: record.explanation,
  difficulty: record.difficulty,
  keywords: [...record.keywords],
  sourceIds: [...record.source_ids],
  standardReference: record.standard_reference,
  reviewStatus: record.review_status,
  contentVersion: record.content_version,
  knowledgePoint: record.topic,
  ...(record.common_mistake ? { commonMistake: record.common_mistake } : {}),
});
```

- [ ] **Step 4: Refactor LocalQuestionRepository to use the adapter**

Replace its private mapping function with `adaptRuntimeQuestionRecord`. Do not change filtering behavior or public signatures.

- [ ] **Step 5: Run tests and static checks**

```powershell
Set-Location miniapp
npx vitest run tests/runtime-question-adapter.test.ts tests/local-question-repository.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- miniapp/miniprogram/repositories/runtime-question-adapter.ts miniapp/miniprogram/repositories/local-question-repository.ts miniapp/tests/runtime-question-adapter.test.ts miniapp/tests/local-question-repository.test.ts
git commit -m "refactor: share runtime question validation"
```

### Task 3: Implement the in-memory, version-pinned CloudQuestionRepository

**Files:**
- Create: `miniapp/miniprogram/config/cloud.ts`
- Create: `miniapp/miniprogram/types/cloud-question.ts`
- Modify: `miniapp/miniprogram/repositories/cloud-question-repository.ts`
- Modify: `miniapp/miniprogram/repositories/local-question-repository.ts`
- Modify: `miniapp/miniprogram/types/domain.ts`
- Create: `miniapp/tests/cloud-question-repository.test.ts`

**Interfaces:**
- Consumes: `CloudQuestionTransport.call(request): Promise<unknown>` and the Task 2 parser/adapter.
- Produces: `WxCloudQuestionTransport`, `CloudQuestionRepository`, `QuestionBankError`, the existing read methods, and `consumeNotice(): string | null` for missing retired IDs.

- [ ] **Step 1: Define and test the cloud contract**

Use these exact request/response types:

```ts
export type QuestionBankErrorCode =
  | 'INVALID_REQUEST'
  | 'RELEASE_NOT_FOUND'
  | 'INCOMPATIBLE_SCHEMA'
  | 'QUESTION_BANK_UNAVAILABLE';

export type QuestionBankRequest =
  | { action: 'manifest' }
  | { action: 'list'; releaseId: string; filter: Required<Pick<QuestionFilter, 'occupation' | 'level'>> & QuestionFilter }
  | { action: 'getByIds'; releaseId: string; ids: string[] };

export type QuestionBankSuccess<T> = { ok: true; releaseId: string; data: T };
export type QuestionBankFailure = { ok: false; code: QuestionBankErrorCode; message: string };
export type QuestionBankResponse<T> = QuestionBankSuccess<T> | QuestionBankFailure;
```

Write tests proving:

```ts
const repository = new CloudQuestionRepository(fakeTransport, {
  expectedSchemaVersion: 1,
  expectedCatalogDigest: 'catalog-digest',
});
await repository.list({ occupation: '4-02-06-01', level: 5 });
await repository.getById('WH-L5-000001');
expect(fakeTransport.requests.filter(({ action }) => action === 'manifest')).toHaveLength(1);

const ids = Array.from({ length: 205 }, (_, index) => `WH-L5-${String(index).padStart(6, '0')}`);
await repository.getByIds(ids);
expect(fakeTransport.requests.filter(({ action }) => action === 'getByIds')).toHaveLength(3);
```

Also test identical `list` calls share one in-flight/result promise, a rejected call is removed from memory so retry works, missing IDs are skipped while order is preserved, bad records are rejected, mismatched release IDs are rejected, and no `wx.setStorage` API is called.

When the transport omits one requested ID, assert:

```ts
await repository.getByIds(['WH-L5-000001', 'retired-id']);
expect(repository.consumeNotice()).toBe('部分旧题已下线，已跳过');
expect(repository.consumeNotice()).toBeNull();
```

Return a manifest with a different `catalogDigest` and assert `INCOMPATIBLE_SCHEMA` before any question request is sent.

- [ ] **Step 2: Run the test and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/cloud-question-repository.test.ts
```

Expected: FAIL because the cloud contract and implementation are absent.

- [ ] **Step 3: Add immutable cloud constants**

```ts
export const CLOUD_ENV_ID = 'cloud1-d2gglad830c91db10';
export const QUESTION_BANK_FUNCTION = 'questionBank';
export const QUESTION_BANK_SCHEMA_VERSION = 1;
export const QUESTION_ID_BATCH_SIZE = 100;
```

- [ ] **Step 4: Implement the transport and stable error class**

```ts
export interface CloudQuestionTransport {
  call(request: QuestionBankRequest): Promise<unknown>;
}

export class QuestionBankError extends Error {
  constructor(
    readonly code: QuestionBankErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QuestionBankError';
  }
}

export class WxCloudQuestionTransport implements CloudQuestionTransport {
  async call(request: QuestionBankRequest): Promise<unknown> {
    const response = await wx.cloud.callFunction({
      name: QUESTION_BANK_FUNCTION,
      data: request,
      config: { env: CLOUD_ENV_ID },
    });
    return response.result;
  }
}
```

- [ ] **Step 5: Implement version pinning, compatibility checks, chunking, notices, and memory reuse**

Use this exact options shape:

```ts
export interface CloudQuestionRepositoryOptions {
  expectedSchemaVersion: number;
  expectedCatalogDigest: string;
}
```

The Repository constructor accepts a transport plus `CloudQuestionRepositoryOptions`. `getReleaseId()` memoizes the manifest promise, requires both manifest values to equal the bundled client values, and clears the promise on rejection. `list()` requires occupation and level, builds a stable sorted cache key, calls `parseRuntimeQuestionRecord`, requires `review_status === "verified"`, and maps with `adaptRuntimeQuestionRecord`. `getByIds()` de-duplicates for transport, slices batches of 100, reconstructs the original unique request order, and records the one-shot missing-question notice when IDs are absent. `getById()` delegates to `getByIds([id])`.

Add `consumeNotice(): string | null` to `QuestionRepository`. The Local Repository always returns `null`; the Cloud Repository returns and clears its pending notice.

Do not add any storage adapter, file cache, local fallback, timer retry, or `QUESTION_RECORDS` import.

- [ ] **Step 6: Run focused and static verification**

```powershell
Set-Location miniapp
npx vitest run tests/cloud-question-repository.test.ts tests/runtime-question-adapter.test.ts tests/local-question-repository.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- miniapp/miniprogram/config/cloud.ts miniapp/miniprogram/types/cloud-question.ts miniapp/miniprogram/types/domain.ts miniapp/miniprogram/repositories/cloud-question-repository.ts miniapp/miniprogram/repositories/local-question-repository.ts miniapp/tests/cloud-question-repository.test.ts
git commit -m "feat: read a pinned cloud question release"
```

### Task 4: Initialize cloud services and remove the bundled question bank

**Files:**
- Create: `miniapp/tests/app-cloud-init.test.ts`
- Create: `miniapp/tests/source-question-fixtures.ts`
- Create: `miniapp/scripts/sync-knowledge-catalog.mjs`
- Create: `miniapp/scripts/sync-knowledge-catalog.d.mts`
- Create: `miniapp/tests/sync-knowledge-catalog.test.ts`
- Modify: `miniapp/miniprogram/app.ts`
- Modify: `miniapp/miniprogram/services/app-services.ts`
- Modify: `miniapp/miniprogram/data/knowledge-catalog.ts`
- Modify: `miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts`
- Modify: `miniapp/project.config.json`
- Modify: `miniapp/package.json`
- Modify: `miniapp/tests/catalog-presenter.test.ts`
- Modify: `miniapp/tests/practical-skills.test.ts`
- Modify: `miniapp/tests/question-list-page.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`
- Delete: `miniapp/miniprogram/data/question-bank.ts`
- Delete: `miniapp/miniprogram/data/questions/runtime-question-records.ts`
- Delete: six `miniapp/miniprogram/data/questions/*.json` question shards
- Delete: `miniapp/scripts/sync-question-bank.mjs`
- Delete: `miniapp/scripts/sync-question-bank.d.mts`
- Delete: `miniapp/tests/sync-question-bank.test.ts`

**Interfaces:**
- Consumes: Task 3 `CloudQuestionRepository` and `WxCloudQuestionTransport`.
- Produces: production `appServices.questions` backed only by cloud; `syncKnowledgeCatalog(sourcePath, targetPath)` for the still-bundled catalog.

- [ ] **Step 1: Write the failing app initialization test**

```ts
await import('../miniprogram/app');
expect(wx.cloud.init).not.toHaveBeenCalled();
registeredApp.onLaunch();
expect(wx.cloud.init).toHaveBeenCalledWith({
  env: 'cloud1-d2gglad830c91db10',
});
expect(registeredApp.globalData).toMatchObject({ selectedCertificateKey: '4-02-06-01:5' });
```

Stub `App`, local storage methods, and `wx.cloud.init`. Assert initialization happens in `onLaunch`, not at module import before `App` registration.

- [ ] **Step 2: Write failing package-boundary and catalog-sync tests**

```ts
expect(readFileSync(appServicesPath, 'utf8')).toContain('new CloudQuestionRepository');
expect(readFileSync(appServicesPath, 'utf8')).not.toContain('QUESTION_RECORDS');
expect(existsSync(join(miniprogramRoot, 'data', 'question-bank.ts'))).toBe(false);
expect(existsSync(join(miniprogramRoot, 'data', 'questions', 'runtime-question-records.ts'))).toBe(false);
```

For `syncKnowledgeCatalog`, assert it writes only `runtime-knowledge-catalog.ts`, exports `RUNTIME_KNOWLEDGE_CATALOG_DIGEST` as the SHA-256 of the source file bytes, returns the same digest, and creates no shard or runtime-question file.

- [ ] **Step 3: Run selected tests and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/app-cloud-init.test.ts tests/sync-knowledge-catalog.test.ts tests/project-structure.test.ts
```

Expected: FAIL because production still uses the bundled question bank.

- [ ] **Step 4: Wire cloud initialization and services**

Use this app lifecycle shape:

```ts
App<IAppOption>({
  globalData: {
    selectedCertificateKey: preferences.selectedCertificateKey,
    answerTheme: appServices.theme.get(),
    recoveryNotice: appServices.progress.consumeRecoveryNotice() ?? '',
  },
  onLaunch() {
    wx.cloud.init({ env: CLOUD_ENV_ID });
  },
});
```

In `data/knowledge-catalog.ts`, re-export the generated digest as `KNOWLEDGE_CATALOG_DIGEST`. In `app-services.ts`, construct:

```ts
new CloudQuestionRepository(new WxCloudQuestionTransport(), {
  expectedSchemaVersion: QUESTION_BANK_SCHEMA_VERSION,
  expectedCatalogDigest: KNOWLEDGE_CATALOG_DIGEST,
});
```

Do not retain an environment-based or error-based local fallback.

- [ ] **Step 5: Keep only the generated knowledge catalog**

Implement:

```js
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function syncKnowledgeCatalog(sourcePath, targetPath) {
  const source = readFileSync(sourcePath);
  const catalog = JSON.parse(source.toString('utf8'));
  if (!catalog || typeof catalog !== 'object' || !catalog.occupations) {
    throw new Error('knowledge_catalog.json must contain occupations');
  }
  const digest = createHash('sha256').update(source).digest('hex');
  const moduleSource = `import type { RuntimeKnowledgeCatalog } from '../../types/knowledge-catalog';\n\nexport const RUNTIME_KNOWLEDGE_CATALOG: RuntimeKnowledgeCatalog = ${JSON.stringify(catalog, null, 2)};\n\nexport const RUNTIME_KNOWLEDGE_CATALOG_DIGEST = '${digest}';\n`;
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, moduleSource, 'utf8');
  return digest;
}
```

Replace `sync:questions` with:

```json
"sync:catalog": "node scripts/sync-knowledge-catalog.mjs"
```

- [ ] **Step 6: Move tests off the bundled question copy**

`source-question-fixtures.ts` must parse every nonblank JSONL line under `data/questions`, retain only `verified` records, and export `loadVerifiedSourceQuestions()`. Construct a new runtime object from the source allowlist—map `occupation_code` to `occupation`, retain `id`, `direction`, `level`, `module`, `topic`, `chapter_id`, `section_id`, `type`, `stem`, `options`, `answer`, `explanation`, `difficulty`, `keywords`, `source_ids`, `standard_reference`, `review_status`, `content_version`, and optional `common_mistake`—then pass that object through Task 2 parser/adapter. Do not pass source-only fields such as `source_note`, `valid_from`, or timestamps to the strict runtime parser. Update practical-skill and catalog presenter tests to call this helper. In `question-list-page.test.ts`, provide explicit `makeQuestion` fixtures through a `getByIds` spy instead of calling the production cloud Repository.

- [ ] **Step 7: Remove bundled question artifacts and set cloudfunctionRoot**

Delete only the files listed in this task. Preserve `runtime-knowledge-catalog.ts`. Add the following top-level project configuration key while preserving the user's formal AppID and current formatting changes:

```json
"cloudfunctionRoot": "cloudfunctions/"
```

- [ ] **Step 8: Run package boundary and regression tests**

```powershell
Set-Location miniapp
npx vitest run tests/app-cloud-init.test.ts tests/sync-knowledge-catalog.test.ts tests/project-structure.test.ts tests/catalog-presenter.test.ts tests/practical-skills.test.ts tests/question-list-page.test.ts
npm run typecheck
npm run lint
npm run check:package
```

Expected: PASS; the measured main package shrinks and no production import references `QUESTION_RECORDS`.

- [ ] **Step 9: Commit only owned hunks/files**

Because `project.config.json` and some tests may already contain user changes, inspect and stage only Task 4 hunks. Confirm `git diff --cached --name-only` before committing.

```powershell
git add -- miniapp/tests/app-cloud-init.test.ts miniapp/tests/source-question-fixtures.ts miniapp/scripts/sync-knowledge-catalog.mjs miniapp/scripts/sync-knowledge-catalog.d.mts miniapp/tests/sync-knowledge-catalog.test.ts miniapp/miniprogram/app.ts miniapp/miniprogram/services/app-services.ts miniapp/miniprogram/data/knowledge-catalog.ts miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts miniapp/package.json miniapp/tests/catalog-presenter.test.ts miniapp/tests/practical-skills.test.ts miniapp/tests/question-list-page.test.ts miniapp/miniprogram/data/question-bank.ts miniapp/miniprogram/data/questions/runtime-question-records.ts miniapp/miniprogram/data/questions/warehouse_l5.json miniapp/miniprogram/data/questions/warehouse_l4.json miniapp/miniprogram/data/questions/warehouse_l3.json miniapp/miniprogram/data/questions/inspector_l5.json miniapp/miniprogram/data/questions/inspector_l4.json miniapp/miniprogram/data/questions/inspector_l3.json miniapp/scripts/sync-question-bank.mjs miniapp/scripts/sync-question-bank.d.mts miniapp/tests/sync-question-bank.test.ts
git add -p -- miniapp/project.config.json miniapp/tests/project-structure.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: switch production services to cloud questions"
```

### Task 5: Implement the pure questionBank handler

**Files:**
- Create: `miniapp/cloudfunctions/questionBank/lib/handler.js`
- Create: `miniapp/cloudfunctions/questionBank/lib/handler.d.ts`
- Create: `miniapp/tests/cloud-question-function.test.ts`

**Interfaces:**
- Consumes: `QuestionBankStore` methods `getConfig()`, `getRelease(id)`, `listQuestions(releaseId, filter)`, and `getQuestionsByIds(releaseId, ids)`.
- Produces: `createQuestionBankHandler(store, logger?): (event: unknown) => Promise<QuestionBankResponse<unknown>>` with the exact Task 3 response contract; `logger` is `Pick<Console, 'error'>` and defaults to `console`.

- [ ] **Step 1: Write the failing Handler tests with an in-memory Store**

```ts
const handler = createQuestionBankHandler({
  getConfig: vi.fn().mockResolvedValue({
    schema_version: 1,
    active_release_id: 'qb-active',
    previous_release_id: 'qb-previous',
  }),
  getRelease: vi.fn().mockResolvedValue({
    _id: 'qb-active',
    status: 'active',
    schema_version: 1,
    question_count: 2,
    catalog_digest: 'abc',
  }),
  listQuestions: vi.fn().mockResolvedValue([runtimeQuestion()]),
  getQuestionsByIds: vi.fn().mockResolvedValue([runtimeQuestion()]),
});

await expect(handler({ action: 'manifest' })).resolves.toEqual({
  ok: true,
  releaseId: 'qb-active',
  data: { schemaVersion: 1, questionCount: 2, catalogDigest: 'abc' },
});
```

Add tests for current and previous release acceptance, retired/unknown release rejection, required occupation/level, allowlisted optional filters, 100-ID maximum, input de-duplication, output order, missing IDs, database field stripping, unknown action, Store failure, and schema mismatch.

- [ ] **Step 2: Run the Handler test and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/cloud-question-function.test.ts
```

Expected: FAIL because the Handler does not exist.

- [ ] **Step 3: Implement validators and stable failures**

The Handler must return, never throw platform details to the client:

```js
const failure = (code, message) => ({ ok: false, code, message });

const isAllowedRelease = (config, releaseId) =>
  releaseId === config.active_release_id ||
  (Boolean(config.previous_release_id) && releaseId === config.previous_release_id);

const safeEvent = (event) =>
  event && typeof event === 'object' && !Array.isArray(event) ? event : null;
```

Reject arbitrary filter keys. Allow only `occupation`, `level`, `module`, `chapterId`, and `sectionId`. Convert camelCase request filters to database fields inside the Store call.

- [ ] **Step 4: Implement manifest, list, and getByIds dispatch**

The Handler wraps all Store calls in one `try/catch`. It logs only `{ code, action, releaseId }` through an injected/default logger and returns `QUESTION_BANK_UNAVAILABLE` on unexpected failures. It projects question documents to the existing runtime field allowlist and never returns `_id`, `release_id`, `question_id`, `_openid`, or internal release fields.

- [ ] **Step 5: Run focused checks**

```powershell
Set-Location miniapp
npx vitest run tests/cloud-question-function.test.ts tests/cloud-question-repository.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add -- miniapp/cloudfunctions/questionBank/lib/handler.js miniapp/cloudfunctions/questionBank/lib/handler.d.ts miniapp/tests/cloud-question-function.test.ts
git commit -m "feat: validate cloud question requests"
```

### Task 6: Add the paginated database Store and deployable entry point

**Files:**
- Create: `miniapp/cloudfunctions/questionBank/lib/store.js`
- Create: `miniapp/cloudfunctions/questionBank/lib/store.d.ts`
- Create: `miniapp/cloudfunctions/questionBank/index.js`
- Create: `miniapp/cloudfunctions/questionBank/package.json`
- Create: `miniapp/cloudfunctions/questionBank/package-lock.json`
- Create: `miniapp/tests/cloud-question-store.test.ts`
- Modify: `miniapp/eslint.config.mjs`
- Modify: `miniapp/tests/project-structure.test.ts`

**Interfaces:**
- Consumes: a `wx-server-sdk` database instance.
- Produces: `createQuestionBankStore(db)` implementing the Task 5 Store and deployable `exports.main`.

- [ ] **Step 1: Write failing Store tests against a fake fluent database**

Assert exact collection names and database filters:

```ts
await store.listQuestions('qb-active', {
  occupation: '4-02-06-01',
  level: 5,
  chapterId: 'warehouse-l5-c03',
});

expect(fakeDb.lastWhere).toEqual({
  release_id: 'qb-active',
  occupation: '4-02-06-01',
  level: 5,
  chapter_id: 'warehouse-l5-c03',
});
```

Return 100 rows on the first fake page and 54 on the second; assert both pages are concatenated and the offsets are `[0, 100]`. Assert `getQuestionsByIds` uses `question_id: db.command.in(ids)` and `release_id`.

- [ ] **Step 2: Run the Store test and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/cloud-question-store.test.ts
```

Expected: FAIL because `store.js` does not exist.

- [ ] **Step 3: Implement collection access and pagination**

Use fixed constants:

```js
const CONFIG_COLLECTION = 'question_bank_config';
const RELEASE_COLLECTION = 'question_bank_releases';
const QUESTION_COLLECTION = 'question_bank_questions';
const PAGE_SIZE = 100;
```

`getConfig()` reads document `active`. `getRelease(id)` reads by document ID. `listQuestions()` orders by `question_id`, calls `skip(offset).limit(100).get()` until a page contains fewer than 100 documents, and concatenates `data`. `getQuestionsByIds()` performs one `in` query for its at-most-100 input IDs.

- [ ] **Step 4: Add the cloud function entry**

```js
const cloud = require('wx-server-sdk');
const { createQuestionBankHandler } = require('./lib/handler');
const { createQuestionBankStore } = require('./lib/store');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const handler = createQuestionBankHandler(createQuestionBankStore(db));

exports.main = async (event) => handler(event);
```

Pin the dependency:

```json
{
  "name": "question-bank-cloud-function",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "dependencies": {
    "wx-server-sdk": "3.0.1"
  }
}
```

- [ ] **Step 5: Generate and inspect the lockfile**

```powershell
Set-Location miniapp/cloudfunctions/questionBank
npm install --package-lock-only --ignore-scripts
npm audit --omit=dev
```

Expected: lockfile created; report audit findings without changing to an unpinned or unrelated dependency.

- [ ] **Step 6: Configure lint and structural assertions**

Add read-only Node CommonJS globals only for `cloudfunctions/**/*.js` in `eslint.config.mjs`. Extend the structure test to assert `project.config.json.cloudfunctionRoot === "cloudfunctions/"`, the function package pins `wx-server-sdk` to `3.0.1`, and the function entry contains `cloud.DYNAMIC_CURRENT_ENV`.

- [ ] **Step 7: Run focused and static checks**

```powershell
Set-Location miniapp
npx vitest run tests/cloud-question-store.test.ts tests/cloud-question-function.test.ts tests/project-structure.test.ts
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```powershell
git add -- miniapp/cloudfunctions/questionBank miniapp/tests/cloud-question-store.test.ts miniapp/eslint.config.mjs miniapp/tests/project-structure.test.ts
git commit -m "feat: add deployable question bank cloud function"
```

### Task 7: Add retryable cloud states to catalog surfaces

**Files:**
- Modify: `miniapp/miniprogram/pages/home/index.ts`
- Modify: `miniapp/miniprogram/pages/home/index.wxml`
- Modify: `miniapp/miniprogram/pages/home/index.json`
- Modify: `miniapp/miniprogram/pages/library/index.ts`
- Modify: `miniapp/miniprogram/pages/library/index.wxml`
- Modify: `miniapp/miniprogram/pages/library/index.json`
- Modify: `miniapp/miniprogram/pages/chapter-detail/index.ts`
- Modify: `miniapp/miniprogram/pages/chapter-detail/index.wxml`
- Modify: `miniapp/miniprogram/pages/chapter-detail/index.json`
- Modify: `miniapp/tests/home-page.test.ts`
- Create: `miniapp/tests/catalog-cloud-loading-pages.test.ts`

**Interfaces:**
- Consumes: rejected/fulfilled `appServices.questions.list()` promises.
- Produces: `loading`, `loadError`, retry actions, and the approved copy “题库加载失败，请检查网络后重试”。

- [ ] **Step 1: Write failing page-state tests**

For each page, reject the first Repository call and resolve the second:

```ts
const list = vi
  .spyOn(appServices.questions, 'list')
  .mockRejectedValueOnce(new Error('offline'))
  .mockResolvedValueOnce([makeQuestion()]);

await definition.loadCertificate.call(context, '4-02-06-01:5');
expect(context.data).toMatchObject({ loading: false, loadError: true });

await definition.onReload.call(context);
expect(context.data).toMatchObject({ loading: false, loadError: false });
expect(list).toHaveBeenCalledTimes(2);
```

Assert each WXML contains `kind="network"`, the exact description, `action-text="重新加载"`, and a bound retry handler.

- [ ] **Step 2: Run page tests and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/home-page.test.ts tests/catalog-cloud-loading-pages.test.ts
```

Expected: FAIL because the pages do not expose the full retry state.

- [ ] **Step 3: Implement Home and Library error states**

Wrap each async Repository call in `try/catch`. On start set `{ loading: true, loadError: false }`; on failure set `{ loading: false, loadError: true }` only if the same certificate remains selected. Add `onReload()` that reloads the current selected certificate. Register and render `/components/empty-state/index` without removing the user's existing Home layout changes.

- [ ] **Step 4: Implement Chapter Detail retry without changing route validation**

Keep invalid-route and unavailable-level messages non-retryable. Store the parsed occupation, level, and chapter ID, factor the Repository portion into `loadChapter()`, and expose `onReload()` only for Repository failure. Replace “本地题库可能尚未同步” with “题库加载失败，请检查网络后重试”。

- [ ] **Step 5: Run page and structure tests**

```powershell
Set-Location miniapp
npx vitest run tests/home-page.test.ts tests/catalog-cloud-loading-pages.test.ts tests/project-structure.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Expected: PASS.

- [ ] **Step 6: Commit only Task 7 hunks**

The Home files already contain user changes. Review `git diff` and stage only the error-state additions, preserving all existing layout/removal work.

```powershell
git add -p -- miniapp/miniprogram/pages/home/index.ts miniapp/miniprogram/pages/home/index.wxml miniapp/miniprogram/pages/home/index.json miniapp/miniprogram/pages/library/index.ts miniapp/miniprogram/pages/library/index.wxml miniapp/miniprogram/pages/library/index.json miniapp/miniprogram/pages/chapter-detail/index.ts miniapp/miniprogram/pages/chapter-detail/index.wxml miniapp/miniprogram/pages/chapter-detail/index.json miniapp/tests/home-page.test.ts miniapp/tests/catalog-cloud-loading-pages.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: retry cloud catalog loading"
```

### Task 8: Add retryable cloud states to practice surfaces

**Files:**
- Modify: `miniapp/miniprogram/pages/random-settings/index.ts`
- Modify: `miniapp/miniprogram/pages/random-settings/index.wxml`
- Modify: `miniapp/miniprogram/pages/random-settings/index.json`
- Modify: `miniapp/miniprogram/pages/mock-info/index.ts`
- Modify: `miniapp/miniprogram/pages/mock-info/index.wxml`
- Modify: `miniapp/miniprogram/pages/mock-info/index.json`
- Modify: `miniapp/miniprogram/pages/learning-report/index.ts`
- Modify: `miniapp/miniprogram/pages/learning-report/index.wxml`
- Modify: `miniapp/miniprogram/pages/learning-report/index.json`
- Modify: `miniapp/miniprogram/pages/practice/index.ts`
- Modify: `miniapp/miniprogram/pages/practice/index.wxml`
- Modify: `miniapp/miniprogram/pages/question-list/index.wxml`
- Modify: `miniapp/miniprogram/pages/practical-detail/index.wxml`
- Modify: `miniapp/tests/practice-page.test.ts`
- Modify: `miniapp/tests/practical-detail-page.test.ts`
- Modify: `miniapp/tests/question-list-page.test.ts`
- Create: `miniapp/tests/practice-cloud-loading-pages.test.ts`

**Interfaces:**
- Consumes: cloud Repository rejection and later recovery.
- Produces: consistent loading failure copy and one user-triggered retry; no automatic retry loop.

- [ ] **Step 1: Write failing practice-surface tests**

```ts
await expect(definition.loadSetup.call(context)).resolves.toBeUndefined();
expect(context.data).toMatchObject({ loading: false, loadError: true });

await definition.onReload.call(context);
expect(context.data.loadError).toBe(false);
```

For Practice, call `onLoad` with a valid route, reject `startPractice`, assert `loadError: true`, then call `onReload` and assert the same saved route is retried. For Question List and Practical Detail, assert the existing retry states use the exact network copy and no longer say “尚未同步”.

For Practice, Question List, and Practical Detail, make `appServices.questions.consumeNotice()` return `部分旧题已下线，已跳过` and assert each page shows that one-shot text through `wx.showToast` after an otherwise successful load.

- [ ] **Step 2: Run selected tests and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/practice-page.test.ts tests/practical-detail-page.test.ts tests/question-list-page.test.ts tests/practice-cloud-loading-pages.test.ts
```

Expected: FAIL on missing `loadError`/retry behavior or outdated copy.

- [ ] **Step 3: Implement Random, Mock, and Learning Report retries**

Each loader follows one state machine:

```ts
this.setData({ loading: true, loadError: false });
try {
  const questions = await appServices.questions.list(filter);
  this.setData({ loading: false, loadError: false });
  applyQuestions(questions);
} catch {
  this.setData({ loading: false, loadError: true });
}
```

Each page registers `empty-state`, renders the approved network message with “重新加载”, and exposes `onReload()`.

- [ ] **Step 4: Implement Practice retry with the original route**

Add `loadError: false` and a private page method `loadPractice(options)`. `onLoad(options)` stores a shallow copy in page data or a page-local field and calls `loadPractice`. `onReload()` calls it with the same options. Invalid parameters and a valid empty result stay non-network states; only caught Repository/cloud errors set `loadError: true`.

- [ ] **Step 5: Standardize existing retry copy**

Question List, Practical Detail, and Practice use:

```text
题库加载失败
请检查网络后重试。
```

Keep their existing user-triggered handlers and do not add background retries.

After a successful `getByIds`, `startPractice`, or `restorePractice`, consume the Repository notice once and show it with `wx.showToast({ title: notice, icon: 'none' })`. Do not clear wrong/favorite/progress storage when a cloud version omits an old ID.

- [ ] **Step 6: Run page and full TypeScript checks**

```powershell
Set-Location miniapp
npx vitest run tests/practice-page.test.ts tests/practical-detail-page.test.ts tests/question-list-page.test.ts tests/practice-cloud-loading-pages.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Expected: PASS.

- [ ] **Step 7: Commit only Task 8 hunks**

Several listed files already contain user changes. Inspect every staged patch and keep unrelated edits unstaged.

```powershell
git add -p -- miniapp/miniprogram/pages/random-settings/index.ts miniapp/miniprogram/pages/random-settings/index.wxml miniapp/miniprogram/pages/random-settings/index.json miniapp/miniprogram/pages/mock-info/index.ts miniapp/miniprogram/pages/mock-info/index.wxml miniapp/miniprogram/pages/mock-info/index.json miniapp/miniprogram/pages/learning-report/index.ts miniapp/miniprogram/pages/learning-report/index.wxml miniapp/miniprogram/pages/learning-report/index.json miniapp/miniprogram/pages/practice/index.ts miniapp/miniprogram/pages/practice/index.wxml miniapp/miniprogram/pages/question-list/index.wxml miniapp/miniprogram/pages/practical-detail/index.wxml miniapp/tests/practice-page.test.ts miniapp/tests/practical-detail-page.test.ts miniapp/tests/question-list-page.test.ts miniapp/tests/practice-cloud-loading-pages.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: retry cloud practice loading"
```

### Task 9: Update operations documentation and pass the complete local gate

**Files:**
- Create: `docs/cloud-question-bank-operations.md`
- Modify: `README.md`
- Modify: `docs/question-runtime-contract.md`
- Modify: `docs/miniapp-acceptance-checklist.md`
- Modify: `miniapp/tests/project-structure.test.ts`

**Interfaces:**
- Consumes: Tasks 1–8 commands and contracts.
- Produces: one beginner-readable local build/publish/rollback runbook and a green local release gate.

- [ ] **Step 1: Write documentation contract assertions**

Add a structure test that reads all four documents and asserts these exact strings appear in the appropriate documents:

```ts
for (const required of [
  'cloud1-d2gglad830c91db10',
  'question_bank_config',
  'question_bank_releases',
  'question_bank_questions',
  'questionBank',
  'npm run build:cloud-release',
  '不需要 AppSecret',
]) {
  expect(combinedDocumentation).toContain(required);
}
```

Assert README no longer says the app is independent of cloud development or that production pages read local JSON.

- [ ] **Step 2: Run the documentation assertion and verify RED**

```powershell
Set-Location miniapp
npx vitest run tests/project-structure.test.ts
```

Expected: FAIL until the documentation is updated.

- [ ] **Step 3: Write the beginner operations guide**

Document exact sections in this order:

1. Environment and non-secret identifiers.
2. Local validation commands.
3. Release artifact contents.
4. Cloud resource confirmation checklist.
5. Import-as-staging instructions.
6. Count/digest/sample verification.
7. Active pointer switch.
8. Smoke tests.
9. Rollback.
10. Old-version cleanup with a separate deletion confirmation.
11. Common error messages.

Include the official CloudBase references for [database permissions](https://docs.cloudbase.net/database/data-permission), [JSON Lines import](https://docs.cloudbase.net/database/manage), [WeChat mini-program cloud function calls](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram), and [cloud function deployment](https://docs.cloudbase.net/cli-v1/functions/deploy).

- [ ] **Step 4: Update root and runtime documentation**

Replace the old local release sequence with:

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest -q
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm run sync:catalog
npm run build:cloud-release
npm run verify
```

Explain that `build:cloud-release` prepares files only and never uploads or activates a cloud release.

- [ ] **Step 5: Run the complete local source and miniapp gate**

From the repository root:

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest -q
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm run sync:catalog
npm run build:cloud-release
npm run verify
```

Expected: every command PASS. Record the generated release ID, total count, six shard counts, source digest, catalog digest, and warnings. Do not upload anything.

- [ ] **Step 6: Inspect the generated release without exposing question content**

Check:

```powershell
$releaseDirectory=Get-ChildItem '..\dist\cloud' -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$verification=Get-Content -Raw (Join-Path $releaseDirectory.FullName 'verification.json') | ConvertFrom-Json
$questionLineCount=(Get-Content (Join-Path $releaseDirectory.FullName 'questions.jsonl')).Count
$verification
$questionLineCount
```

Expected: `$releaseDirectory.Name` equals `$verification.release_id` and `$questionLineCount` equals `$verification.question_count`; current baseline is 546 with shard counts 125, 154, 147, 35, 35, and 50 in the named shards.

- [ ] **Step 7: Commit Task 9 documentation**

```powershell
git add -- docs/cloud-question-bank-operations.md README.md docs/question-runtime-contract.md docs/miniapp-acceptance-checklist.md miniapp/tests/project-structure.test.ts
git commit -m "docs: document cloud question releases"
```

### Task 10: Confirm and provision the cloud resources

**Files:**
- Create after successful provisioning: `docs/qa/2026-08-02-cloud-resource-provisioning.md`

**Interfaces:**
- Consumes: local green gate, deployable `questionBank` function, user authorization.
- Produces: three protected collections, four indexes, one deployed read-only function, and a non-secret evidence record.

- [ ] **Step 1: Present the exact resource-write confirmation and stop**

Show the user:

```text
目标环境：cloud1-d2gglad830c91db10
将创建：question_bank_config、question_bank_releases、question_bank_questions
将创建索引：4 个（仅在 question_bank_questions）
将部署云函数：questionBank（Node.js 20，wx-server-sdk 3.0.1）
不会修改：套餐、自动续费、超额付费设置
不需要：AppSecret、SecretId、SecretKey
```

Do not continue until the user explicitly confirms this list.

- [ ] **Step 2: Re-check existing resources before creating anything**

In the logged-in WeChat Developer Tools cloud console, list collections, indexes, functions, and the selected environment. If a named resource already exists, inspect it and reconcile rather than creating a duplicate or overwriting it.

- [ ] **Step 3: Create collections with client “无权限”**

Create exactly:

```text
question_bank_config
question_bank_releases
question_bank_questions
```

Set each collection's client permission to “无权限”. Do not create sample records yet. If the console shows a charge, overage, renewal, service-enablement, or new paid-resource dialog, stop and request a separate confirmation.

- [ ] **Step 4: Create the four indexes**

On `question_bank_questions`, create:

```text
idx_release_occupation_level: release_id ASC, occupation ASC, level ASC
idx_release_chapter: release_id ASC, chapter_id ASC
idx_release_section: release_id ASC, section_id ASC
idx_release_question: release_id ASC, question_id ASC
```

Do not create indexes on unlisted fields.

- [ ] **Step 5: Deploy the read-only cloud function**

From the Developer Tools cloudfunctions tree, use “上传并部署：云端安装依赖” for `questionBank`. Select the existing target environment, Node.js 20 runtime, and do not add environment variables or secrets.

- [ ] **Step 6: Verify the empty-state function safely**

Invoke:

```json
{ "action": "manifest" }
```

Expected before config data exists: a stable business failure such as `QUESTION_BANK_UNAVAILABLE`; no stack, database name, OpenID, or credential appears in the response.

- [ ] **Step 7: Record and commit provisioning evidence**

The QA document records environment ID, collection names, permission mode, index names, function name/runtime/dependency version, deployment timestamp, and empty-state response code. It must explicitly state that billing settings were not changed and contain no screenshots or copied values that reveal personal identifiers.

```powershell
git add -- docs/qa/2026-08-02-cloud-resource-provisioning.md
git commit -m "docs: record cloud resource provisioning"
```

### Task 11: Confirm, import, activate, and verify the first release

**Files:**
- Create after successful release: `docs/qa/2026-08-02-cloud-question-bank-release.md`

**Interfaces:**
- Consumes: the exact Task 9 release directory and Task 10 resources.
- Produces: one active release, an empty previous pointer on first publication, readable cloud questions, and release evidence.

- [ ] **Step 1: Re-run the complete local release gate immediately before upload**

Run the Task 9 Step 5 commands again. If the release ID, question count, shard counts, source digest, or catalog digest differs from the previously reviewed artifact, discard the old upload plan and use only the new artifact.

- [ ] **Step 2: Present the exact data-write confirmation and stop**

Load the exact values and show the resulting strings:

```powershell
$releaseDirectory=Get-ChildItem '..\dist\cloud' -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$verification=Get-Content -Raw (Join-Path $releaseDirectory.FullName 'verification.json') | ConvertFrom-Json
$releaseId=[string]$verification.release_id
$questionCount=[int]$verification.question_count
$shardCounts=$verification.shard_counts | ConvertTo-Json -Compress
$activeReleaseId='无（首次发布）'
$previousReleaseId='无（首次发布）'
@(
  '目标环境：cloud1-d2gglad830c91db10',
  "发布 ID：$releaseId",
  "题目总数：$questionCount",
  "六个分片：$shardCounts",
  "将写入：1 条 staging 发布记录、$questionCount 条题目、1 条 active 配置",
  "当前正式版：$activeReleaseId",
  "回滚目标：$previousReleaseId"
)
```

For a later release, replace the two “无（首次发布）” values with IDs read from `question_bank_config/active` before presenting the confirmation.

Do not continue until the user explicitly confirms this exact release.

- [ ] **Step 3: Create the staging release record**

Import/add `release.json` to `question_bank_releases` with its generated `_id` and `status: "staging"`. Read it back and compare all counts and digests to `verification.json`.

- [ ] **Step 4: Import questions in Insert mode**

Use the CloudBase collection import UI on `question_bank_questions`:

```text
File: questions.jsonl
Encoding: UTF-8
Mode: Insert
Stop on error: enabled
```

Wait for completion. Do not choose Upsert and do not activate after a partial failure.

- [ ] **Step 5: Verify cloud data before activation**

Check total count for the new `release_id`, the six occupation/level counts, duplicate `question_id` count, and at least one random sample from each shard. Compare only IDs, field presence, counts, and digests in logs; do not paste full question text into the QA document.

Current baseline expected from the last observed local build:

```json
{
  "warehouse_l5.json": 125,
  "warehouse_l4.json": 154,
  "warehouse_l3.json": 147,
  "inspector_l5.json": 35,
  "inspector_l4.json": 35,
  "inspector_l3.json": 50
}
```

The freshly generated `verification.json` is authoritative if the source has legitimately changed.

- [ ] **Step 6: Activate with the pointer as the final visibility switch**

For a first release, build the document from the verified runtime value:

```powershell
$configDocument=[ordered]@{
  _id='active'
  schema_version=1
  active_release_id=$releaseId
  previous_release_id=''
  updated_at=(Get-Date).ToUniversalTime().ToString('o')
}
$configDocument | ConvertTo-Json
```

First set the release status to `active` and `activated_at` to the current UTC time. Then create/update `question_bank_config/active` last. On later releases, mark the old active release `previous`, move its ID into `previous_release_id`, and update the config pointer last.

- [ ] **Step 7: Verify manifest, filtered list, IDs, and permissions**

Invoke the three events generated from the verified release package:

```powershell
$firstQuestion=Get-Content (Join-Path $releaseDirectory.FullName 'questions.jsonl') -First 1 | ConvertFrom-Json
@{ action='manifest' } | ConvertTo-Json -Compress
@{
  action='list'
  releaseId=$releaseId
  filter=@{ occupation='4-02-06-01'; level=5 }
} | ConvertTo-Json -Depth 4 -Compress
@{
  action='getByIds'
  releaseId=$releaseId
  ids=@([string]$firstQuestion.question_id)
} | ConvertTo-Json -Depth 4 -Compress
```

Expected: manifest count/digest matches local verification; list count matches the chosen shard; getByIds returns one sanitized record. From the mini-program console, a direct collection read must fail with permission denied while the cloud function call succeeds.

- [ ] **Step 8: Record and commit release evidence**

Record release ID, counts, digests, activation time, function response checks, permission-denial check, and rollback pointer. Do not include full question text, OpenID, tokens, or console login data.

```powershell
git add -- docs/qa/2026-08-02-cloud-question-bank-release.md
git commit -m "docs: record first cloud question release"
```

### Task 12: Run end-to-end Developer Tools and failure-mode verification

**Files:**
- Modify after testing: `docs/qa/2026-08-02-cloud-question-bank-release.md`

**Interfaces:**
- Consumes: active cloud release and production mini-program code.
- Produces: verified online-only reading, retry behavior, local-only learning progress, and a final handoff record.

- [ ] **Step 1: Re-run all local verification**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest -q
Set-Location miniapp
npm run verify
```

Expected: PASS with no uncommitted generated question-bank files under `miniprogram/data/questions`.

- [ ] **Step 2: Compile in WeChat Developer Tools**

Confirm the selected project is “粮安库”, AppID is `wx84ecacec08ca162c`, `isSandbox=false`, and environment is `cloud1-d2gglad830c91db10`. Build npm only if Developer Tools reports that `miniprogram_npm` is stale, then compile with no cloud initialization, function-not-found, permission, TypeScript, or WXML errors.

- [ ] **Step 3: Smoke-test online reading**

Verify in this order:

```text
首页题量与章节 → 教材目录 → 章节练习 → 随机练习 → 模拟考试
→ 错题列表 → 收藏列表 → 实操关联题 → 学习报告
```

Confirm a practice session receives the complete selected paper before the first question is displayed and remains on one release ID for the session.

- [ ] **Step 4: Verify network failure and retry**

Use Developer Tools network-offline simulation. Open each covered surface and confirm it stops loading, shows “题库加载失败，请检查网络后重试”, and does not start an automatic retry loop. Restore network, tap “重新加载”, and confirm recovery.

- [ ] **Step 5: Verify local progress and absence of persistent question cache**

Answer, favorite, and intentionally miss a question; restart the mini-program and confirm progress/favorite/wrong state remains. Inspect Storage and confirm no key contains cloud release manifests, question arrays, or cloud response bodies.

- [ ] **Step 6: Verify rollback procedure without changing the active release unnecessarily**

For the first release, inspect and document that `previous_release_id` is empty; do not manufacture a rollback target. After a second real release exists, rollback verification uses the runbook and requires a separate user confirmation before changing the pointer.

- [ ] **Step 7: Finalize QA evidence and commit the update**

Append command outcomes, Developer Tools version, base library `3.17.0`, compile result, online smoke paths, offline/retry result, local-progress result, and storage inspection result.

```powershell
git add -- docs/qa/2026-08-02-cloud-question-bank-release.md
git commit -m "test: verify cloud question bank end to end"
```

- [ ] **Step 8: Inspect final Git scope**

```powershell
git status --short
git log --oneline --decorate -15
git diff --check HEAD~1 HEAD
```

Expected: only pre-existing user changes remain uncommitted; no secret, cloud login cache, generated `dist/`, `node_modules`, or AppSecret-like value is tracked.

---

## Execution Checkpoints

1. **Before code execution:** protect the current dirty worktree without overwriting user changes and choose the execution workspace.
2. **After Task 9:** show the locally verified release ID and counts; no cloud writes have happened.
3. **Before Task 10:** obtain explicit confirmation for three collections, four indexes, and one cloud function.
4. **Before Task 11:** obtain explicit confirmation for the exact release ID, counts, import, and active pointer switch.
5. **Before any cleanup or rollback:** obtain a separate confirmation naming the exact release IDs affected.
