# 储粮保管员与粮油质检员刷题小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Before implementation, use superpowers:using-git-worktrees because the current `codex/grain-question-bank` branch is actively changing. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有可审计题库生产系统之上，交付一套可在微信开发者工具运行的原生微信刷题小程序 MVP，覆盖六个证书分类、刷题解析、模拟考试、错题收藏、学习统计和实操技能。

**Architecture:** 保留根目录 Python 题库流水线作为唯一题目生产端，在 `miniapp/` 建立独立原生微信小程序。同步脚本只消费 `dist/json` 中六个 `verified` 分片；小程序通过 Repository、练习领域服务和版本化本地存储隔离页面、规则和数据来源，未来云端实现保持相同接口。

**Tech Stack:** 微信原生小程序、TypeScript 6.0.3 strict、TDesign MiniProgram 1.15.3、miniprogram-api-typings 5.2.1、Vitest 4.1.10、ESLint 10.7.0、Prettier 3.9.6、Stylelint 17.14.1、现有 Python 3.11+ `grain-quiz` 流水线。

## Global Constraints

- 仅支持微信小程序，不引入 UniApp、Taro、React 或 Vue 运行时。
- 首版没有微信登录、后端、云同步、管理后台、排行榜、支付、视频、AI 出题、Word/PDF 识别和暗色模式。
- 保留现有 `src/grain_quiz/`、`data/`、`tests/` 和 `dist/json`；不得修改或删除用户未跟踪的 `data/questions/` 内容。
- 只同步题库流水线发布的 `verified` 记录；`pending` 和 `retired` 不得进入小程序。
- 六个分片固定为 `warehouse_l5.json`、`warehouse_l4.json`、`warehouse_l3.json`、`inspector_l5.json`、`inspector_l4.json`、`inspector_l3.json`。
- 六个证书分类每类不少于 8 题；实操数据不少于 12 张技能卡。
- UI 支持 `single`、`multiple`、`judge` 和前端扩展 `case`；`case` 仍按稳定答案键集合评分。
- TypeScript 开启 `strict`；页面不得直接读取 JSON、调用 `wx.*Storage*` 或实现评分/组卷规则。
- 视觉固定为克制的 Apple 式浅色：暖灰背景、深灰文字、储粮绿强调、8pt 间距、轻阴影、无大面积渐变和 AI 风装饰。
- npm 依赖使用精确版本并提交 `package-lock.json`。
- 核心行为测试先行：先看到预期失败，再写最小实现并重跑相关测试。

## Execution Setup

实施前读取并使用 `superpowers:using-git-worktrees`，从题库流水线最新提交创建 `codex/grain-practice-miniapp` 分支和独立工作树。不要在当前含有未跟踪题目数据的目录中实施。把已确认但被题库专用分支移除的设计规格从提交 `81f55bc` 恢复到新分支；用 `apply_patch` 恢复，不改写题库分支历史。

## File Map

- `miniapp/package.json`、`tsconfig.json`、`eslint.config.mjs`、`stylelint.config.mjs`、`.prettierrc.json`、`vitest.config.ts`：固定工具链。
- `miniapp/project.config.json`、`project.private.config.example.json`：微信开发者工具项目配置。
- `miniapp/scripts/sync-question-bank.mjs`：校验并同步六个发布分片。
- `miniapp/miniprogram/app.*`、`sitemap.json`、`styles/tokens.wxss`、`custom-tab-bar/`：应用壳和视觉令牌。
- `miniapp/miniprogram/types/domain.ts`：证书、题目、练习、进度和技能类型。
- `miniapp/miniprogram/data/`：证书目录、六个题库分片入口和实操技能。
- `miniapp/miniprogram/repositories/`：本地题库、云端占位和学习记录仓储。
- `miniapp/miniprogram/services/`：评分、组卷、会话、错题、收藏和统计。
- `miniapp/miniprogram/storage/`：可注入存储、迁移和微信适配器。
- `miniapp/miniprogram/components/`：题目选项、解析、统计卡和空状态。
- `miniapp/miniprogram/pages/`：首页、题库、答题、答题卡、练习报告、题目列表、实操、实操详情和我的。
- `miniapp/tests/`：与上述领域模块一一对应的 Vitest 测试。
- `docs/question-runtime-contract.md`：Python 分片到小程序模型的字段契约。
- `docs/miniapp-acceptance-checklist.md`：微信开发者工具人工验收记录。

## Stable Interfaces

```ts
export type OccupationCode = '4-02-06-01' | '4-08-05-01';
export type CertificateLevel = 5 | 4 | 3;
export type QuestionType = 'single' | 'multiple' | 'judge' | 'case';
export type PracticeMode = 'chapter' | 'sequential' | 'random' | 'mock' | 'wrong' | 'favorite';

export interface Question {
  id: string;
  occupation: OccupationCode;
  direction: string;
  level: CertificateLevel;
  module: string;
  topic: string;
  type: QuestionType;
  stem: string;
  options: Array<{ key: string; text: string }>;
  answer: string[];
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
  keywords: string[];
  sourceIds: string[];
  standardReference: string;
  reviewStatus: 'verified' | 'sample';
  contentVersion: number;
  knowledgePoint: string;
  commonMistake?: string;
}

export interface QuestionFilter {
  occupation?: OccupationCode;
  level?: CertificateLevel;
  module?: string;
  ids?: string[];
}

export interface QuestionRepository {
  list(filter?: QuestionFilter): Promise<Question[]>;
  getById(id: string): Promise<Question | null>;
  getByIds(ids: string[]): Promise<Question[]>;
}

export interface GradeResult {
  correct: boolean;
  selected: string[];
  expected: string[];
}

export interface StorageAdapter {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}
```

---

### Task 1: Scaffold the native mini app and certificate catalog

**Files:**
- Create: `miniapp/package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `stylelint.config.mjs`, `.prettierrc.json`, `vitest.config.ts`
- Create: `miniapp/project.config.json`, `project.private.config.example.json`
- Create: `miniapp/miniprogram/app.ts`, `app.json`, `app.wxss`, `sitemap.json`, `styles/tokens.wxss`
- Create: `miniapp/miniprogram/types/domain.ts`, `data/certificates.ts`
- Test: `miniapp/tests/catalog.test.ts`

**Interfaces:** Produces all stable domain types, `CERTIFICATES`, and `certificateKey(occupation, level)`.

- [ ] **Step 1: Create the test and lint harness**

Use this exact `package.json`:

```json
{
  "name": "grain-cert-practice-miniapp",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint . && stylelint \"miniprogram/**/*.wxss\"",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "verify": "npm run typecheck && npm run lint && npm run format:check && npm run test",
    "sync:questions": "node scripts/sync-question-bank.mjs"
  },
  "dependencies": { "tdesign-miniprogram": "1.15.3" },
  "devDependencies": {
    "@eslint/js": "10.0.1",
    "eslint": "10.7.0",
    "miniprogram-api-typings": "5.2.1",
    "prettier": "3.9.6",
    "stylelint": "17.14.1",
    "stylelint-config-standard": "40.0.0",
    "typescript": "6.0.3",
    "typescript-eslint": "8.65.0",
    "vitest": "4.1.10"
  }
}
```

Set TypeScript to `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`, `resolveJsonModule: true`, and include `miniprogram/**/*.ts` plus `tests/**/*.ts`. Configure ESLint flat config for TypeScript; configure Stylelint standard rules with `rpx` accepted; configure Prettier with single quotes, semicolons and width 100.

Run: `cd miniapp; npm install`
Expected: installation exits 0 and creates the lock file.

- [ ] **Step 2: Write the failing catalog test**

```ts
import { describe, expect, it } from 'vitest';
import { CERTIFICATES, certificateKey } from '../miniprogram/data/certificates';

describe('certificate catalog', () => {
  it('contains both occupations at levels five, four and three', () => {
    expect(CERTIFICATES.map((item) => item.key)).toEqual([
      '4-02-06-01:5', '4-02-06-01:4', '4-02-06-01:3',
      '4-08-05-01:5', '4-08-05-01:4', '4-08-05-01:3',
    ]);
    expect(certificateKey('4-08-05-01', 3)).toBe('4-08-05-01:3');
  });
});
```

- [ ] **Step 3: Verify RED**

Run: `cd miniapp; npm test -- tests/catalog.test.ts`
Expected: FAIL because `data/certificates.ts` does not exist.

- [ ] **Step 4: Implement the domain and catalog**

Create the Stable Interfaces, then implement:

```ts
import type { CertificateLevel, OccupationCode } from '../types/domain';

export interface Certificate {
  key: `${OccupationCode}:${CertificateLevel}`;
  occupation: OccupationCode;
  level: CertificateLevel;
  title: string;
  shortTitle: string;
}

export const certificateKey = (occupation: OccupationCode, level: CertificateLevel) =>
  `${occupation}:${level}` as const;

const levels: Array<[CertificateLevel, string]> = [[5, '初级'], [4, '中级'], [3, '高级']];
const occupations: Array<[OccupationCode, string, string]> = [
  ['4-02-06-01', '储粮保管员', '保管员'],
  ['4-08-05-01', '粮油质检员', '质检员'],
];

export const CERTIFICATES: Certificate[] = occupations.flatMap(([occupation, title, short]) =>
  levels.map(([level, levelName]) => ({
    key: certificateKey(occupation, level), occupation, level,
    title: `${title} · ${levelName}`, shortTitle: `${short}${levelName}`,
  })),
);
```

Register all routes in `app.json`, enable required-component lazy loading and a custom four-item tab bar. Define `#f5f5f7` background, `#1d1d1f` text, `#2f6b4f` primary, `#c44747` danger, 8pt spacing, 14/18px radii, hairlines and safe-area tokens.

- [ ] **Step 5: Verify GREEN and commit**

Run: `cd miniapp; npm test -- tests/catalog.test.ts; npm run typecheck`
Expected: 1 test passes and TypeScript exits 0.

```powershell
git add miniapp
git commit -m "feat: scaffold grain practice mini app"
```

---

### Task 2: Sync and read the verified question bank

**Files:**
- Create: `miniapp/scripts/sync-question-bank.mjs`, `sync-question-bank.d.ts`
- Create: `miniapp/miniprogram/data/question-shards.ts`, `data/questions/.gitkeep`
- Create: `miniapp/miniprogram/repositories/question-repository.ts`, `local-question-repository.ts`, `cloud-question-repository.ts`
- Create: `docs/question-runtime-contract.md`
- Test: `miniapp/tests/sync-question-bank.test.ts`, `local-question-repository.test.ts`

**Interfaces:** Consumes the six `dist/json/*.json` shards and produces `syncQuestionBank` plus `QuestionRepository` implementations.

- [ ] **Step 1: Write the failing synchronization test**

```ts
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SHARDS, syncQuestionBank } from '../scripts/sync-question-bank.mjs';

it('copies six verified shards and rejects unpublished records', () => {
  const root = mkdtempSync(join(tmpdir(), 'grain-sync-'));
  const source = join(root, 'source');
  const target = join(root, 'target');
  mkdirSync(source);
  for (const name of SHARDS) {
    writeFileSync(join(source, name), JSON.stringify([{ id: `${name}-1`, review_status: 'verified' }]));
  }
  syncQuestionBank(source, target, { minimumPerShard: 1 });
  expect(JSON.parse(readFileSync(join(target, SHARDS[0]), 'utf8'))).toHaveLength(1);
  writeFileSync(join(source, SHARDS[0]), JSON.stringify([{ review_status: 'pending' }]));
  expect(() => syncQuestionBank(source, target, { minimumPerShard: 1 })).toThrow(/verified/);
});
```

- [ ] **Step 2: Verify RED, then implement sync**

Run: `cd miniapp; npm test -- tests/sync-question-bank.test.ts`
Expected: FAIL because the module does not exist.

Implementation:

```js
export const SHARDS = [
  'warehouse_l5.json', 'warehouse_l4.json', 'warehouse_l3.json',
  'inspector_l5.json', 'inspector_l4.json', 'inspector_l3.json',
];

export function syncQuestionBank(sourceDir, targetDir, { minimumPerShard = 8 } = {}) {
  mkdirSync(targetDir, { recursive: true });
  for (const filename of SHARDS) {
    const records = JSON.parse(readFileSync(join(sourceDir, filename), 'utf8'));
    if (!Array.isArray(records) || records.length < minimumPerShard) {
      throw new Error(`${filename} must contain at least ${minimumPerShard} questions`);
    }
    if (records.some((record) => record.review_status !== 'verified')) {
      throw new Error(`${filename} must contain verified questions only`);
    }
    writeFileSync(join(targetDir, filename), `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  }
}
```

Only these six known files may be overwritten; never delete the target directory recursively.

- [ ] **Step 3: Write failing repository tests**

Create complete runtime fixtures and assert that `list({ occupation, level, module })` filters correctly, `getById` returns null when absent, and `getByIds` preserves requested ID order.

Run: `cd miniapp; npm test -- tests/local-question-repository.test.ts`
Expected: FAIL because the repository does not exist.

- [ ] **Step 4: Implement repository and field adapter**

```ts
const adapt = (record: RuntimeQuestionRecord): Question => ({
  id: record.id, occupation: record.occupation, direction: record.direction,
  level: record.level, module: record.module, topic: record.topic, type: record.type,
  stem: record.stem, options: record.options, answer: [...record.answer].sort(),
  explanation: record.explanation, difficulty: record.difficulty, keywords: record.keywords,
  sourceIds: record.source_ids, standardReference: record.standard_reference,
  reviewStatus: record.review_status, contentVersion: record.content_version,
  knowledgePoint: record.topic,
});
```

Confine snake_case to this adapter. `CloudQuestionRepository` implements the same interface but throws `new Error('云端题库尚未配置')` without making a network request.

- [ ] **Step 5: Build and synchronize verified data**

```powershell
python -m pip install -e ".[test]"
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
Set-Location miniapp
npm run sync:questions
```

Expected: release gate has zero errors and all six target files contain at least 8 verified records. If the parallel question-bank work has not reached this threshold, stop without fabricating verified records and resume after that release is valid.

- [ ] **Step 6: Verify and commit**

Run: `cd miniapp; npm test -- tests/sync-question-bank.test.ts tests/local-question-repository.test.ts; npm run typecheck`
Expected: all tests pass.

```powershell
git add miniapp/scripts miniapp/miniprogram/data miniapp/miniprogram/repositories miniapp/tests docs/question-runtime-contract.md
git commit -m "feat: integrate verified question bank"
```

---

### Task 3: Implement grading, paper building and practice sessions

**Files:**
- Create: `miniapp/miniprogram/services/grading.ts`, `paper-builder.ts`, `practice-session.ts`
- Test: `miniapp/tests/grading.test.ts`, `paper-builder.test.ts`, `practice-session.test.ts`

**Interfaces:** Produces `gradeQuestion`, `buildPaper`, `createPracticeSession`, `answerQuestion`, and `submitSession`.

- [ ] **Step 1: Write failing grading tests**

```ts
it.each([
  ['single', ['A'], ['A'], true], ['multiple', ['C', 'A'], ['A', 'C'], true],
  ['multiple', ['A'], ['A', 'C'], false], ['judge', ['B'], ['A'], false],
  ['case', ['B'], ['B'], true],
])('grades %s without answer-order dependence', (type, selected, answer, correct) => {
  expect(gradeQuestion(makeQuestion({ type, answer }), selected).correct).toBe(correct);
});
```

Run: `cd miniapp; npm test -- tests/grading.test.ts`
Expected: FAIL because `gradeQuestion` is missing.

- [ ] **Step 2: Implement minimal grading and verify GREEN**

```ts
const normalize = (keys: string[]) => [...new Set(keys)].sort();
export const gradeQuestion = (question: Question, selectedIds: string[]): GradeResult => {
  const selected = normalize(selectedIds);
  const expected = normalize(question.answer);
  return { correct: selected.length === expected.length && selected.every((key, i) => key === expected[i]), selected, expected };
};
```

- [ ] **Step 3: Test-drive paper building**

Tests must cover chapter filtering, sequential order, deterministic injected random order, no duplicates, limit clipping and empty input:

```ts
expect(buildPaper(questions, { mode: 'sequential', limit: 2 }).map((q) => q.id)).toEqual(['Q1', 'Q2']);
expect(buildPaper(questions, { mode: 'chapter', module: '粮情检查', limit: 10 })
  .every((q) => q.module === '粮情检查')).toBe(true);
```

Run RED, then implement a filter-first, copy-before-shuffle builder that never mutates repository arrays.

- [ ] **Step 4: Test-drive session state**

```ts
const session = createPracticeSession([question], { mode: 'mock', now: 1000 });
const answered = answerQuestion(session, question.id, ['A'], 1500);
expect(answered.feedback[question.id]).toBeUndefined();
const submitted = submitSession(answered, 2500);
expect(submitted.report).toMatchObject({ total: 1, correct: 1, durationMs: 1500 });
expect(() => answerQuestion(submitted, question.id, ['B'], 3000)).toThrow(/已交卷/);
```

Also cover immediate normal-practice feedback, pre-submit mock edits, navigation and answer-sheet status. Run RED, then implement immutable transitions.

- [ ] **Step 5: Verify and commit**

Run: `cd miniapp; npm test -- tests/grading.test.ts tests/paper-builder.test.ts tests/practice-session.test.ts; npm run typecheck`
Expected: all tests pass.

```powershell
git add miniapp/miniprogram/services miniapp/tests
git commit -m "feat: add tested practice engine"
```

---

### Task 4: Add versioned local progress, wrong questions and favorites

**Files:**
- Create: `miniapp/miniprogram/storage/storage-adapter.ts`, `migrations.ts`, `progress-repository.ts`
- Create: `miniapp/miniprogram/services/progress-service.ts`
- Test: `miniapp/tests/migrations.test.ts`, `progress-service.test.ts`

**Interfaces:** Produces `recordAnswer`, `toggleFavorite`, `markMastered`, `getDashboard`, `saveSession`, `restoreSession`, and `clearLearningData`.

- [ ] **Step 1: Write failing migration tests**

Define schema v1 with answers, wrong questions, favorites, sessions, daily totals and preferences. Test null initialization, a v1 round trip, future-version rejection and damaged-value recovery with a diagnostic flag.

Run: `cd miniapp; npm test -- tests/migrations.test.ts`
Expected: FAIL because migrations are missing.

- [ ] **Step 2: Implement the storage boundary**

```ts
export class WechatStorageAdapter implements StorageAdapter {
  get<T>(key: string): T | null {
    const value = wx.getStorageSync(key) as T | '';
    return value === '' ? null : value;
  }
  set<T>(key: string, value: T): void { wx.setStorageSync(key, value); }
  remove(key: string): void { wx.removeStorageSync(key); }
}
export const STORAGE_KEY = 'grain-practice:progress';
export const CURRENT_SCHEMA_VERSION = 1;
```

- [ ] **Step 3: Write failing progress tests**

```ts
service.recordAnswer({ questionId: 'Q1', correct: false, durationMs: 800, at: '2026-07-22' });
service.recordAnswer({ questionId: 'Q1', correct: false, durationMs: 600, at: '2026-07-22' });
expect(service.getWrongQuestion('Q1')).toMatchObject({ errorCount: 2, mastered: false });
service.markMastered('Q1');
service.toggleFavorite('Q1', 1000);
expect(service.isFavorite('Q1')).toBe(true);
expect(service.getDashboard()).toMatchObject({ answered: 2, correct: 0, accuracy: 0 });
```

Also test zero-answer accuracy, month-boundary streaks, session resume, re-wronging a mastered question and namespaced clearing. Run RED.

- [ ] **Step 4: Implement progress and persistence**

Use injected ISO local dates so aggregation is timezone-stable. Preserve wrong history after marking mastered; a later error makes it unmastered. Favorites are idempotent. Pages consume this service only.

- [ ] **Step 5: Verify and commit**

Run: `cd miniapp; npm test -- tests/migrations.test.ts tests/progress-service.test.ts; npm run typecheck`
Expected: all tests pass.

```powershell
git add miniapp/miniprogram/storage miniapp/miniprogram/services/progress-service.ts miniapp/tests
git commit -m "feat: persist learning progress locally"
```

---

### Task 5: Build shared Apple-style UI components

**Files:**
- Create: `miniapp/miniprogram/custom-tab-bar/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/components/question-option/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/components/analysis-panel/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/components/stat-card/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/components/empty-state/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/presenters/question-option-presenter.ts`
- Test: `miniapp/tests/presenters.test.ts`

**Interfaces:** Produces reusable visual components and `presentQuestionOption`.

- [ ] **Step 1: Write the failing option-state presenter test**

```ts
expect(presentQuestionOption({ key: 'A', selected: true, submitted: false, correctKeys: [] }))
  .toEqual({ selected: true, state: 'selected', disabled: false });
expect(presentQuestionOption({ key: 'A', selected: true, submitted: true, correctKeys: ['B'] }))
  .toEqual({ selected: true, state: 'wrong', disabled: true });
expect(presentQuestionOption({ key: 'B', selected: false, submitted: true, correctKeys: ['B'] }))
  .toEqual({ selected: false, state: 'correct', disabled: true });
```

Run RED, then implement the pure presenter.

- [ ] **Step 2: Implement accessible shared components**

`question-option` exposes only `key`, `text`, `selected`, `state`, `disabled`, emits the stable key and uses a native button reset with 52px minimum height. `analysis-panel` renders correct/wrong, expected answer, explanation, knowledge point, optional common mistake and standard reference; missing optional data has no empty label.

Custom tab items are exactly:

```ts
const tabs = [
  { text: '首页', value: '/pages/home/index', icon: 'home' },
  { text: '题库', value: '/pages/library/index', icon: 'book' },
  { text: '实操', value: '/pages/practical/index', icon: 'tools' },
  { text: '我的', value: '/pages/profile/index', icon: 'user' },
];
```

Use TDesign where it reduces boilerplate. Do not add gradients, glass effects, emojis or AI illustrations.

- [ ] **Step 3: Verify and commit**

Run: `cd miniapp; npm test -- tests/presenters.test.ts; npm run typecheck; npm run lint`
Expected: tests and checks pass.

```powershell
git add miniapp/miniprogram/custom-tab-bar miniapp/miniprogram/components miniapp/miniprogram/presenters miniapp/tests/presenters.test.ts
git commit -m "feat: add accessible mini app design system"
```

---

### Task 6: Implement home and question-library flows

**Files:**
- Create: `miniapp/miniprogram/presenters/home-presenter.ts`, `library-presenter.ts`
- Create: `miniapp/miniprogram/pages/home/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/pages/library/index.{ts,json,wxml,wxss}`
- Modify: `miniapp/tests/presenters.test.ts`

**Interfaces:** Consumes certificate catalog, question repository and progress service.

- [ ] **Step 1: Add failing presenter tests**

```ts
expect(presentDashboard({ answered: 0, correct: 0, streakDays: 0 })).toMatchObject({
  accuracyText: '0%', streakText: '从今天开始',
});
expect(groupCertificates(CERTIFICATES).map((group) => group.items.length)).toEqual([3, 3]);
```

Also test resumable-session copy and module counts for the chosen occupation/level. Run RED, then implement pure presenters.

- [ ] **Step 2: Implement home**

Layout: large greeting and current certificate; conditional “继续上次练习”; three-stat row; today goal; daily, random, wrong and favorite shortcuts. Fetch dashboard from `ProgressService`; the page performs no aggregation.

- [ ] **Step 3: Implement library**

Provide certificate switching, 章节/顺序/随机/模拟 mode cards, module rows with counts and an explicit empty state. Starting practice passes only `occupation`, `level`, `mode` and optional `module` query parameters.

- [ ] **Step 4: Verify and commit**

Run: `cd miniapp; npm test -- tests/presenters.test.ts; npm run verify`
Expected: all checks pass.

```powershell
git add miniapp/miniprogram/pages/home miniapp/miniprogram/pages/library miniapp/miniprogram/presenters miniapp/tests/presenters.test.ts
git commit -m "feat: add home and question library"
```

---

### Task 7: Implement practice, answer sheet and practice report

**Files:**
- Create: `miniapp/miniprogram/pages/practice/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/pages/answer-sheet/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/pages/report/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/presenters/report-presenter.ts`
- Modify: `miniapp/tests/presenters.test.ts`

**Interfaces:** Consumes repository, paper builder, practice session, progress service and shared components.

- [ ] **Step 1: Write failing report presenter tests**

```ts
const report = presentReport({ total: 10, correct: 7, durationMs: 125000, modules: {
  '粮情检查': { total: 4, correct: 1 }, '安全生产': { total: 6, correct: 6 },
}});
expect(report).toMatchObject({ scoreText: '70', accuracyText: '70%', durationText: '02:05' });
expect(report.weakModules[0].name).toBe('粮情检查');
```

Run RED, then implement stable formatting and weak-module sorting.

- [ ] **Step 2: Implement practice controller**

Validate route parameters, load matching questions, build or restore a session and show a clear empty state. Single/judge/case with one answer submit on selection; multiple choice uses “确认答案”. Normal practice reveals analysis immediately; mock mode never reveals it before submission. Save every transition through the progress service.

- [ ] **Step 3: Implement answer sheet**

Normal mode displays neutral/green/red answered state; mock mode displays answered/unanswered only. Selecting a number updates the shared session index and returns, without serializing the session into a URL.

- [ ] **Step 4: Implement report**

Render score, accuracy, duration, correct/wrong counts, weak modules, “查看错题解析” and “再练一组”. Record submitted answers exactly once; revisiting the report cannot double-count. Open `question-list` with wrong IDs for review.

- [ ] **Step 5: Verify and commit**

Run: `cd miniapp; npm test -- tests/practice-session.test.ts tests/presenters.test.ts tests/progress-service.test.ts; npm run verify`
Expected: all checks pass.

```powershell
git add miniapp/miniprogram/pages/practice miniapp/miniprogram/pages/answer-sheet miniapp/miniprogram/pages/report miniapp/miniprogram/presenters/report-presenter.ts miniapp/tests
git commit -m "feat: add practice and report flows"
```

---

### Task 8: Implement wrong-book, favorites and profile

**Files:**
- Create: `miniapp/miniprogram/pages/question-list/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/pages/profile/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/presenters/question-list-presenter.ts`
- Modify: `miniapp/tests/presenters.test.ts`

**Interfaces:** Consumes progress IDs and repository; produces filtered wrong/favorite views and data management.

- [ ] **Step 1: Add failing list presenter tests**

Test role/level/module filters, unresolved IDs, wrong-count sorting, mastered filtering, favorite ordering and empty copy. Return unresolved IDs for diagnostics and never crash when a question has been retired.

- [ ] **Step 2: Implement reusable question list**

`kind=wrong|favorite|session` selects IDs. Provide certificate/mastery filters, wrong count and latest time, plus “错题重练” or “收藏练习”. Marking mastered never deletes history.

- [ ] **Step 3: Implement profile**

Render cumulative questions, accuracy, duration, streak, seven-day activity, certificate preference, wrong/favorite shortcuts and app version. “清除学习数据” requires a destructive confirmation and calls only `clearLearningData`; question data remains intact.

- [ ] **Step 4: Verify and commit**

Run: `cd miniapp; npm test -- tests/presenters.test.ts tests/progress-service.test.ts; npm run verify`
Expected: all checks pass.

```powershell
git add miniapp/miniprogram/pages/question-list miniapp/miniprogram/pages/profile miniapp/miniprogram/presenters/question-list-presenter.ts miniapp/tests
git commit -m "feat: add wrong questions favorites and profile"
```

---

### Task 9: Add twelve practical-skill guides

**Files:**
- Create: `miniapp/miniprogram/data/practical-skills.ts`
- Create: `miniapp/miniprogram/pages/practical/index.{ts,json,wxml,wxss}`
- Create: `miniapp/miniprogram/pages/practical-detail/index.{ts,json,wxml,wxss}`
- Test: `miniapp/tests/practical-skills.test.ts`

**Interfaces:** Produces `PRACTICAL_SKILLS` and `getPracticalSkill(id)`.

- [ ] **Step 1: Write the failing content-contract test**

```ts
expect(PRACTICAL_SKILLS).toHaveLength(12);
expect(new Set(PRACTICAL_SKILLS.map((item) => item.id)).size).toBe(12);
for (const skill of PRACTICAL_SKILLS) {
  expect(skill.steps.length).toBeGreaterThanOrEqual(3);
  expect(skill.safetyNotes.length).toBeGreaterThan(0);
  expect(skill.commonMistakes.length).toBeGreaterThan(0);
}
expect(PRACTICAL_SKILLS.map((item) => item.id)).toEqual([
  'grain-condition-rounds', 'warehouse-entry-check', 'mechanical-ventilation',
  'fumigation-safety', 'stored-pest-check', 'abnormal-heating-response',
  'sampling', 'sample-division', 'moisture-test', 'impurity-test',
  'test-weight', 'laboratory-safety',
]);
```

Run RED.

- [ ] **Step 2: Author structured, source-aligned data**

Each item contains id, occupation, title, summary, preparations, at least three numbered steps, safety notes, common mistakes, related question IDs, source IDs and standard reference. Use the existing official source catalog. Do not claim a guide replaces on-site training; the fumigation guide is safety-focused and omits unsupervised dosage instructions.

- [ ] **Step 3: Implement list and detail**

Group cards by 保管/质检 with line icons and text. Detail renders preparation, numbered steps, danger-accent warnings, common mistakes, source basis and “练习相关题目”; missing related IDs disable the action with an explanation.

- [ ] **Step 4: Verify and commit**

Run: `cd miniapp; npm test -- tests/practical-skills.test.ts; npm run verify`
Expected: 12 complete records and all checks pass.

```powershell
git add miniapp/miniprogram/data/practical-skills.ts miniapp/miniprogram/pages/practical miniapp/miniprogram/pages/practical-detail miniapp/tests/practical-skills.test.ts
git commit -m "feat: add grain operation skill guides"
```

---

### Task 10: Document, package and verify the MVP

**Files:**
- Modify: `README.md`
- Create: `docs/miniapp-acceptance-checklist.md`
- Restore: `docs/superpowers/specs/2026-07-22-grain-cert-practice-miniprogram-design.md`

**Interfaces:** Consumes all prior tasks and produces reproducible delivery instructions.

- [ ] **Step 1: Restore the approved design**

Read the file from commit `81f55bc`, restore its approved content with `apply_patch`, then add one integration note: the later question-bank pipeline is the runtime data producer. Restore only in the isolated mini-app branch.

- [ ] **Step 2: Write exact run instructions**

README commands:

```powershell
python -m pip install -e ".[test]"
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
Set-Location miniapp
npm install
npm run sync:questions
npm run verify
```

Then instruct importing `miniapp/` into微信开发者工具, choosing a test or owned AppID, running “工具 → 构建 npm”, compiling, and following the checklist. No cloud environment is required.

- [ ] **Step 3: Verify the source-of-truth pipeline**

```powershell
python -m pytest -q
grain-quiz validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json
grain-quiz dedupe --questions data/questions --threshold 92
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
```

Expected: zero Python test failures, zero release errors, no unresolved exact duplicates, build exit 0 and six JSON shards.

- [ ] **Step 4: Verify the complete mini app**

```powershell
Set-Location miniapp
npm run sync:questions
npm run verify
```

Expected: six shards each have at least eight verified records; TypeScript, ESLint, Stylelint, Prettier and Vitest all exit 0.

- [ ] **Step 5: Complete微信开发者工具 smoke testing**

Record simulator and base-library version, then verify four tabs, all six certificates, four practice modes, all supported question types, immediate analysis, mock answer hiding, answer-sheet navigation, report totals, wrong/favorite/mastery persistence, session resume, twelve skills, readable error states and absence of AI-style decoration.

- [ ] **Step 6: Review scope and commit**

Run `git status --short`. Stage only mini-app, integration docs and verified synchronized shards; confirm original authoring files were not staged.

```powershell
git add README.md docs/question-runtime-contract.md docs/miniapp-acceptance-checklist.md docs/superpowers/specs/2026-07-22-grain-cert-practice-miniprogram-design.md miniapp
git commit -m "docs: finalize grain practice mini app delivery"
```

## Final Verification

Before claiming completion, use `superpowers:verification-before-completion` and freshly run:

```powershell
python -m pytest -q
grain-quiz validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
Set-Location miniapp
npm run sync:questions
npm run verify
git status --short --branch
```

Completion requires zero Python failures, zero release errors, six synchronized verified shards with at least eight records each, zero TypeScript/lint/format/test failures, a completed微信开发者工具 checklist, and a clean mini-app branch except explicitly preserved user-owned untracked data.
