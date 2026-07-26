# 粮安题库微信小程序 UI 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏现有题库、目录 ID 和学习记录的前提下，将小程序重构为仅含“首页、实操、我的”三个主导航的粮油仓储考证刷题工具，并完成五等级题库选择、教材目录、答题状态、夜间护眼、实操和个人中心的统一视觉与交互。

**Architecture:** 保留现有 TypeScript 领域层、题库仓库、学习进度仓库和练习会话；把页面决策下沉到纯 presenter/service，把职业等级可用性、主题偏好、选项状态和路由校验做成可单测的模型。页面仅负责生命周期、事件绑定和 `setData`，共享视觉由 tokens 与小组件承载。旧 `pages/library` 改为从首页进入的教材目录二级页，不再是 tabBar 页面。

**Tech Stack:** 微信小程序原生 TypeScript/WXML/WXSS、TDesign Miniprogram 1.15.3、Vitest 4、TypeScript 6、ESLint、Stylelint、Prettier。

## Global Constraints

- 实施依据为 `docs/superpowers/specs/2026-07-26-grain-miniapp-ui-redesign-design.md`。
- 先写失败测试，再写最小实现；每个任务完成后运行列出的定向测试。
- 不改变现有问题 ID、章节 ID、职业编码、题库 JSON 和 Python 题库管线。
- 任何页面不得直接调用 `wx.getStorageSync` 或 `wx.setStorageSync`；持久化只经过 repository/service。
- 技师和高级技师可以选择和查看说明，但没有正式题目时不得创建空练习会话。
- 模拟考试交卷前不得显示正确、错误或解析状态。
- 二级页面统一显示返回按钮；页面栈为空时回到来源主导航。
- 不接入真实会员、支付、云头像或账号后端；会员页只展示本轮明确支持的静态权益说明。
- 不使用粗描边、发光、玻璃拟态、文字代替图标或灰黑色选项字。
- 开发过程保留用户工作树中的无关改动，不执行破坏性 Git 命令。

---

## Task 1: 扩展五等级领域模型并无损迁移偏好数据

**Files:**

- Modify: `miniapp/miniprogram/types/domain.ts`
- Modify: `miniapp/miniprogram/data/certificates.ts`
- Modify: `miniapp/miniprogram/storage/migrations.ts`
- Modify: `miniapp/miniprogram/storage/progress-repository.ts`
- Modify: `miniapp/miniprogram/services/progress-service.ts`
- Modify: `miniapp/miniprogram/app.ts`
- Modify: `miniapp/tests/presenters.test.ts`
- Modify: `miniapp/tests/migrations.test.ts`
- Modify: `miniapp/tests/progress-service.test.ts`

- [ ] **Step 1: 写五等级和可用性失败测试**

在 `miniapp/tests/presenters.test.ts` 增加断言：

```ts
it("exposes five levels for each occupation and marks unavailable banks explicitly", () => {
  const groups = groupCertificates(CERTIFICATES);

  expect(groups.map((group) => group.items.length)).toEqual([5, 5]);
  expect(groups[0]?.items.map((item) => item.levelName)).toEqual([
    "初级",
    "中级",
    "高级",
    "技师",
    "高级技师",
  ]);
  expect(groups[0]?.items.map((item) => item.availability)).toEqual([
    "available",
    "available",
    "available",
    "coming-soon",
    "coming-soon",
  ]);
});
```

在 `miniapp/tests/migrations.test.ts` 增加：

```ts
it("migrates version-one preferences without losing learning data", () => {
  const versionOne = {
    ...createVersionOneProgressFixture(),
    answers: [
      {
        questionId: "WH-L5-000001",
        correct: true,
        durationMs: 1200,
        at: "2026-07-25",
      },
    ],
  };

  const result = migrateProgress(versionOne);

  expect(result.recovered).toBe(false);
  expect(result.data.answers).toEqual(versionOne.answers);
  expect(result.data.preferences).toMatchObject({
    selectedCertificateKey: "4-02-06-01:5",
    dailyGoal: 20,
    answerTheme: "light",
    nickname: "仓廪小麦",
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/presenters.test.ts tests/migrations.test.ts
```

Expected: 证书数量、`levelName`、`availability`、V1 迁移和新偏好字段断言失败。

- [ ] **Step 3: 扩展领域类型和证书元数据**

在 `types/domain.ts` 使用：

```ts
export type CertificateLevel = 5 | 4 | 3 | 2 | 1;
export type AvailableQuestionLevel = 5 | 4 | 3;
export type CertificateAvailability = "available" | "coming-soon";
export type AnswerTheme = "light" | "night";
```

保持 `Question.level`、`QuestionFilter.level` 和 `CertificateKey` 使用 `CertificateLevel`，使未来题库不需要再次改领域签名；可练习性只读取证书元数据。

在 `data/certificates.ts` 将证书结构改为：

```ts
export interface Certificate {
  key: CertificateKey;
  occupation: OccupationCode;
  level: CertificateLevel;
  levelName: string;
  availability: CertificateAvailability;
  title: string;
  shortTitle: string;
}

const LEVELS = [
  [5, "初级", "available"],
  [4, "中级", "available"],
  [3, "高级", "available"],
  [2, "技师", "coming-soon"],
  [1, "高级技师", "coming-soon"],
] as const satisfies ReadonlyArray<
  readonly [CertificateLevel, string, CertificateAvailability]
>;
```

职业正式名称统一为“粮油仓储管理员”和“粮油质量检验员”，短名称为“保管员”和“质检员”。

- [ ] **Step 4: 将进度数据迁移到 V2**

在 `storage/migrations.ts`：

```ts
export const CURRENT_SCHEMA_VERSION = 2 as const;

export interface ProgressPreferences {
  selectedCertificateKey: CertificateKey;
  dailyGoal: number;
  answerTheme: AnswerTheme;
  nickname: string;
  avatarUrl: string;
}
```

实现独立的 `isProgressDataV1`、`isProgressDataV2` 与 `migrateVersionOne`。V1 合法数据必须原样保留 answers、wrongQuestions、favorites、session、dailyTotals 和 recordedSessionIds，只向偏好补：

```ts
{
  answerTheme: 'light',
  nickname: '仓廪小麦',
  avatarUrl: '',
}
```

证书正则扩为：

```ts
const CERTIFICATE_PATTERN = /^(4-02-06-01|4-08-05-01):[12345]$/;
```

非法或未来版本继续走现有备份/恢复策略；V1 正常迁移不得标记 `recovered`。

- [ ] **Step 5: 更新仓库、服务和全局数据类型**

将 `ProgressRepository.save`、`ProgressService.data` 等签名改用 `ProgressDataV2`。`clearLearningData()` 继续保留全部 preferences。`AppGlobalData` 增加当前主题：

```ts
export interface AppGlobalData {
  selectedCertificateKey: CertificateKey;
  answerTheme: AnswerTheme;
  recoveryNotice: string;
}
```

`app.ts` 从 `appServices.progress.getPreferences()` 初始化证书与主题，不在页面重复推断默认值。

- [ ] **Step 6: 运行测试、类型检查和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/presenters.test.ts tests/migrations.test.ts tests/progress-service.test.ts
npm run typecheck
```

Expected: 全部通过。

Commit:

```powershell
git add miniapp/miniprogram/types/domain.ts miniapp/miniprogram/data/certificates.ts miniapp/miniprogram/storage/migrations.ts miniapp/miniprogram/storage/progress-repository.ts miniapp/miniprogram/services/progress-service.ts miniapp/miniprogram/app.ts miniapp/tests/presenters.test.ts miniapp/tests/migrations.test.ts miniapp/tests/progress-service.test.ts
git commit -m "feat: support five certificate levels"
```

---

## Task 2: 建立日间、夜间视觉令牌和共享页面骨架

**Files:**

- Modify: `miniapp/miniprogram/styles/tokens.wxss`
- Modify: `miniapp/miniprogram/app.wxss`
- Modify: `miniapp/miniprogram/app.json`
- Create: `miniapp/miniprogram/components/app-topbar/index.json`
- Create: `miniapp/miniprogram/components/app-topbar/index.ts`
- Create: `miniapp/miniprogram/components/app-topbar/index.wxml`
- Create: `miniapp/miniprogram/components/app-topbar/index.wxss`
- Create: `miniapp/miniprogram/presenters/navigation-presenter.ts`
- Create: `miniapp/tests/navigation-presenter.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 写返回路由和组件结构失败测试**

`navigation-presenter.test.ts`：

```ts
describe("resolveBackTarget", () => {
  it("uses the page stack when a previous page exists", () => {
    expect(resolveBackTarget(2, "home")).toEqual({ type: "navigateBack" });
  });

  it("falls back to the source main tab", () => {
    expect(resolveBackTarget(1, "practical")).toEqual({
      type: "switchTab",
      url: "/pages/practical/index",
    });
  });
});
```

在 `project-structure.test.ts` 把 `app-topbar` 加入本地组件完整性检查。

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/navigation-presenter.test.ts tests/project-structure.test.ts
```

Expected: presenter 和组件文件不存在。

- [ ] **Step 3: 重写全局颜色、圆角和阴影令牌**

`styles/tokens.wxss` 的日间令牌：

```css
page {
  --color-bg: #f4f6ee;
  --color-surface: #fff;
  --color-surface-secondary: #eef1e7;
  --color-text: #11120f;
  --color-option-text: #272d23;
  --color-text-secondary: #71776b;
  --color-primary: #b8ec32;
  --color-primary-strong: #8fbd19;
  --color-primary-soft: #dff58f;
  --color-danger: #d85b52;
  --color-danger-soft: #fde9e6;
  --color-border: rgb(17 18 15 / 7%);
  --radius-md: 28rpx;
  --radius-lg: 40rpx;
  --radius-xl: 52rpx;
  --shadow-soft: 0 12rpx 36rpx rgb(35 45 25 / 7%);
}
```

同文件定义 `.theme-night`：

```css
.theme-night {
  --color-bg: #151911;
  --color-surface: #20261b;
  --color-surface-secondary: #2b3422;
  --color-text: #f0f2eb;
  --color-option-text: #e9ede3;
  --color-text-secondary: #a7ad9f;
  --color-primary: #a8d63c;
  --color-primary-strong: #8fb532;
  --color-primary-soft: #33431f;
  --color-border: rgb(240 242 235 / 8%);
  --shadow-soft: 0 12rpx 36rpx rgb(0 0 0 / 18%);
}
```

`app.wxss` 增加 `.page-shell--secondary`、`.matte-card`、`.section-heading`、`.safe-bottom`，避免各页复制页面基础间距。

- [ ] **Step 4: 实现统一顶部栏**

`navigation-presenter.ts` 返回严格联合类型：

```ts
export type BackTarget =
  | { type: "navigateBack" }
  | {
      type: "switchTab";
      url:
        "/pages/home/index" | "/pages/practical/index" | "/pages/profile/index";
    };
```

`app-topbar` 属性包含 `title`、`subtitle`、`fallbackTab`、`showBack`；点击返回时读取 `getCurrentPages().length`，根据 presenter 调用 `wx.navigateBack` 或 `wx.switchTab`。按钮使用 chevron 图标，不用文字箭头。

- [ ] **Step 5: 更新全局窗口底色和组件注册测试**

`app.json` 的窗口底色更新为 `#F4F6EE`。各二级页在自身 `.json` 注册 `/components/app-topbar/index`，不把业务组件全局注册。

- [ ] **Step 6: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/navigation-presenter.test.ts tests/project-structure.test.ts
npm run lint
```

Expected: 全部通过。

Commit:

```powershell
git add miniapp/miniprogram/styles/tokens.wxss miniapp/miniprogram/app.wxss miniapp/miniprogram/app.json miniapp/miniprogram/components/app-topbar miniapp/miniprogram/presenters/navigation-presenter.ts miniapp/tests/navigation-presenter.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: add redesign theme foundation"
```

---

## Task 3: 将底部导航收敛为首页、实操、我的

**Files:**

- Modify: `miniapp/miniprogram/app.json`
- Modify: `miniapp/miniprogram/custom-tab-bar/index.ts`
- Modify: `miniapp/miniprogram/custom-tab-bar/index.wxml`
- Modify: `miniapp/miniprogram/custom-tab-bar/index.wxss`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 先把结构测试改为三个 tab**

断言：

```ts
expect(app.tabBar?.list?.map(({ pagePath }) => pagePath)).toEqual([
  "pages/home/index",
  "pages/practical/index",
  "pages/profile/index",
]);
```

并读取 `custom-tab-bar/index.ts`，断言不再包含 `pages/library/index`。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/project-structure.test.ts
```

Expected: 现有四 tab 断言失败。

- [ ] **Step 3: 更新 app 配置与自定义 tabBar**

`app.json` 只保留三个 tab；`pages/library/index` 仍保留在 `pages` 数组作为二级路由。

`custom-tab-bar/index.ts`：

```ts
const TABS: TabItem[] = [
  { text: "首页", value: "/pages/home/index", icon: "home" },
  { text: "实操", value: "/pages/practical/index", icon: "tools" },
  { text: "我的", value: "/pages/profile/index", icon: "user" },
];
```

激活色改为 `#B8EC32`，未激活图标保持深灰绿；tab 容器使用白色哑光胶囊，不增加发光。

- [ ] **Step 4: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/project-structure.test.ts
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/app.json miniapp/miniprogram/custom-tab-bar miniapp/tests/project-structure.test.ts
git commit -m "feat: simplify primary navigation"
```

---

## Task 4: 重构首页为题库与学习入口

**Files:**

- Modify: `miniapp/miniprogram/presenters/home-presenter.ts`
- Modify: `miniapp/miniprogram/services/progress-service.ts`
- Modify: `miniapp/miniprogram/pages/home/index.json`
- Modify: `miniapp/miniprogram/pages/home/index.ts`
- Modify: `miniapp/miniprogram/pages/home/index.wxml`
- Modify: `miniapp/miniprogram/pages/home/index.wxss`
- Create: `miniapp/miniprogram/components/certificate-selector/index.json`
- Create: `miniapp/miniprogram/components/certificate-selector/index.ts`
- Create: `miniapp/miniprogram/components/certificate-selector/index.wxml`
- Create: `miniapp/miniprogram/components/certificate-selector/index.wxss`
- Modify: `miniapp/tests/presenters.test.ts`
- Modify: `miniapp/tests/progress-service.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 写首页 view model 和最近刷题失败测试**

新增 `presentHomeCertificate` 测试：

```ts
expect(presentHomeCertificate(CERTIFICATES, "4-02-06-01:2", 0)).toMatchObject({
  roleTitle: "粮油仓储管理员",
  levelName: "技师",
  availabilityText: "待补充",
  canStart: false,
});
```

新增进度服务测试：

```ts
expect(service.listRecentQuestionIds(3)).toEqual(["Q3", "Q2", "Q1"]);
```

同一题多次作答只保留最近一次位置，不重复展示。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/presenters.test.ts tests/progress-service.test.ts
```

- [ ] **Step 3: 实现纯首页 presenter**

`home-presenter.ts` 新增：

```ts
export interface HomeCertificateViewModel {
  certificateKey: CertificateKey;
  roleTitle: string;
  levelName: string;
  bankTitle: string;
  availabilityText: "可练习" | "待补充";
  canStart: boolean;
  questionCountText: string;
}
```

首页动作固定为：

```ts
[
  { id: "chapter", title: "章节刷题", route: "/pages/library/index" },
  { id: "random", title: "随机练习", route: "/pages/random-settings/index" },
  { id: "mock", title: "模拟考试", route: "/pages/mock-info/index" },
  {
    id: "wrong",
    title: "错题本",
    route: "/pages/question-list/index?kind=wrong",
  },
  {
    id: "favorite",
    title: "收藏试题",
    route: "/pages/question-list/index?kind=favorite",
  },
];
```

- [ ] **Step 4: 实现两阶段证书选择组件**

组件属性：

```ts
properties: {
  certificates: { type: Array, value: [] },
  selectedKey: { type: String, value: '' },
}
```

先展示两个职业，再展示当前职业五等级。事件只发出 `{ key: CertificateKey }`，持久化由首页调用 `progress.updatePreferences` 完成。待补充等级可选中，但所有开始入口依据 `canStart` 显示说明并阻止创建会话。

- [ ] **Step 5: 重排首页**

WXML 顺序固定为：

1. 头像、昵称、备考天数、会员入口。
2. “粮安题库”标题。
3. 黑色继续上次练习卡。
4. 职业与等级选择卡。
5. 五个开始学习入口，其中“随机练习”占整行强调卡。
6. 当前目录摘要，最多展示前三章，点击进入教材目录。
7. 最近刷题记录，最多三条。

首页不显示“当前证书”和原“学习概览”大板块。错题本和收藏试题从首页进入独立页面，不切换 tab。

- [ ] **Step 6: 衔接目录和最近记录**

`ProgressService.listRecentQuestionIds(limit)` 从 `answers` 逆序去重。首页按 ID 调用 `questions.getByIds`，再按 ID 次序恢复显示顺序；退休题 ID 静默跳过。

- [ ] **Step 7: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/presenters.test.ts tests/progress-service.test.ts tests/project-structure.test.ts
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/presenters/home-presenter.ts miniapp/miniprogram/services/progress-service.ts miniapp/miniprogram/pages/home miniapp/miniprogram/components/certificate-selector miniapp/tests/presenters.test.ts miniapp/tests/progress-service.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: merge question bank into home"
```

---

## Task 5: 将教材目录改为联动二级页并增加章节详情

**Files:**

- Modify: `miniapp/miniprogram/presenters/catalog-presenter.ts`
- Modify: `miniapp/miniprogram/pages/library/index.json`
- Modify: `miniapp/miniprogram/pages/library/index.ts`
- Modify: `miniapp/miniprogram/pages/library/index.wxml`
- Modify: `miniapp/miniprogram/pages/library/index.wxss`
- Create: `miniapp/miniprogram/pages/chapter-detail/index.json`
- Create: `miniapp/miniprogram/pages/chapter-detail/index.ts`
- Create: `miniapp/miniprogram/pages/chapter-detail/index.wxml`
- Create: `miniapp/miniprogram/pages/chapter-detail/index.wxss`
- Modify: `miniapp/miniprogram/app.json`
- Modify: `miniapp/tests/catalog-presenter.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 写无前导零目录与章节路由失败测试**

`catalog-presenter.test.ts`：

```ts
expect(parts[0]?.chapters[0]?.numberText).toBe("1");
expect(parts[0]?.chapters[0]?.sections[0]?.numberText).toBe("1");
expect(parts[0]?.chapters[0]).toMatchObject({
  progressText: "25%",
  canStart: true,
});
```

为 `parseChapterRoute` 增加已知职业、等级、章节 ID 验证；未知章节返回 `null`。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/catalog-presenter.test.ts tests/project-structure.test.ts
```

- [ ] **Step 3: 调整目录 presenter**

章节和小节数字改为 `String(chapter.number)`、`String(section.number)`；部分标题继续使用“第一部分”。章节 view model 增加：

```ts
sectionCountText: `${chapter.sections.length} 小节`;
questionCountText: questionCount ? `${questionCount} 题` : "题目待补充";
```

章节卡保留完成度、正确率、错题数和 `canStart`，不伪造题量。

- [ ] **Step 4: 把 library 改为二级教材目录**

移除职业/等级选择 chip 和练习模式网格，只读取当前偏好并显示对应目录。顶部使用 `app-topbar`。点击章节跳转：

```ts
`/pages/chapter-detail/index?occupation=${occupation}&level=${level}&chapterId=${encodeURIComponent(chapterId)}`;
```

待补充等级显示当前职业和等级的说明卡，不创建空会话。

- [ ] **Step 5: 实现章节详情**

章节详情展示章节名、总题量、完成度、各小节状态。点击可练习小节进入：

```ts
`/pages/practice/index?occupation=${occupation}&level=${level}&mode=chapter&sectionId=${encodeURIComponent(sectionId)}`;
```

“练习本章”只在 `chapter.canStart` 为真时出现。

- [ ] **Step 6: 验证目录最小覆盖**

测试初级仓储目录至少包含：

```ts
["职业道德", "基础知识", "粮油出入库作业", "粮情检查", "粮情控制"];
```

并断言中级、高级不会混入初级部分。

- [ ] **Step 7: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/catalog-presenter.test.ts tests/catalog.test.ts tests/project-structure.test.ts
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/presenters/catalog-presenter.ts miniapp/miniprogram/pages/library miniapp/miniprogram/pages/chapter-detail miniapp/miniprogram/app.json miniapp/tests/catalog-presenter.test.ts miniapp/tests/catalog.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: add linked textbook catalog"
```

---

## Task 6: 增加随机练习设置和模拟考试说明

**Files:**

- Modify: `miniapp/miniprogram/types/domain.ts`
- Modify: `miniapp/miniprogram/services/paper-builder.ts`
- Modify: `miniapp/miniprogram/services/practice-runtime.ts`
- Create: `miniapp/miniprogram/presenters/practice-setup-presenter.ts`
- Create: `miniapp/miniprogram/pages/random-settings/index.json`
- Create: `miniapp/miniprogram/pages/random-settings/index.ts`
- Create: `miniapp/miniprogram/pages/random-settings/index.wxml`
- Create: `miniapp/miniprogram/pages/random-settings/index.wxss`
- Create: `miniapp/miniprogram/pages/mock-info/index.json`
- Create: `miniapp/miniprogram/pages/mock-info/index.ts`
- Create: `miniapp/miniprogram/pages/mock-info/index.wxml`
- Create: `miniapp/miniprogram/pages/mock-info/index.wxss`
- Modify: `miniapp/miniprogram/app.json`
- Modify: `miniapp/tests/paper-builder.test.ts`
- Create: `miniapp/tests/practice-setup-presenter.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 写设置和组卷失败测试**

覆盖：

- 题量只允许 `10 | 20 | 30 | 50`。
- 题型筛选只接受当前题库存在的题型。
- 随机练习不得超过可用题量。
- 模拟考试固定隐藏答案，交卷前允许修改答案。
- 待补充证书返回 `canStart: false`。

示例：

```ts
expect(
  buildPaper(questions, {
    mode: "random",
    limit: 10,
    questionTypes: ["single", "judge"],
    random: () => 0.5,
  }).every((question) => ["single", "judge"].includes(question.type)),
).toBe(true);
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/paper-builder.test.ts tests/practice-setup-presenter.test.ts
```

- [ ] **Step 3: 扩展组卷输入**

`BuildPaperOptions` 与 `StartPracticeInput` 增加：

```ts
limit?: number;
questionTypes?: QuestionType[];
```

`buildPaper` 先按章节/小节/题型过滤，再随机，最后取 `Math.min(limit, candidates.length)`。默认值仍为普通练习 20、模拟考试 50，保证旧路由兼容。

- [ ] **Step 4: 实现随机练习设置页**

页面读取当前职业等级并加载可用题量，提供：

- 10、20、30 题；不足时禁用超量选项。
- 全部、单选、多选、判断、案例题型选择。
- 当前设置摘要。
- “开始随机练习”按钮。

路由使用 URI 编码的 `types=single,judge`，`parsePracticeRoute` 负责白名单解析，不直接信任页面参数。

- [ ] **Step 5: 实现模拟考试说明页**

显示实际可生成题数、答题规则、交卷后统一解析和未答题提示。“开始考试”调用 mock 路由；无题时按钮禁用并显示“该等级题库待补充”。

- [ ] **Step 6: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/paper-builder.test.ts tests/practice-setup-presenter.test.ts tests/practice-session.test.ts tests/project-structure.test.ts
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/types/domain.ts miniapp/miniprogram/services/paper-builder.ts miniapp/miniprogram/services/practice-runtime.ts miniapp/miniprogram/presenters/practice-setup-presenter.ts miniapp/miniprogram/pages/random-settings miniapp/miniprogram/pages/mock-info miniapp/miniprogram/app.json miniapp/tests/paper-builder.test.ts miniapp/tests/practice-setup-presenter.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: add practice setup flows"
```

---

## Task 7: 重做选项状态机、字体和选择动效

**Files:**

- Modify: `miniapp/miniprogram/presenters/question-option-presenter.ts`
- Modify: `miniapp/miniprogram/components/question-option/index.ts`
- Modify: `miniapp/miniprogram/components/question-option/index.wxml`
- Modify: `miniapp/miniprogram/components/question-option/index.wxss`
- Modify: `miniapp/miniprogram/pages/practice/index.ts`
- Modify: `miniapp/miniprogram/pages/practice/index.wxml`
- Modify: `miniapp/miniprogram/pages/practice/index.wxss`
- Modify: `miniapp/tests/presenters.test.ts`
- Modify: `miniapp/tests/practice-session.test.ts`

- [ ] **Step 1: 写四状态和模拟考试保密失败测试**

把状态改为：

```ts
export type QuestionOptionState = "idle" | "selected" | "correct" | "wrong";
```

测试输入使用 `revealAnswer`：

```ts
expect(
  presentQuestionOption({
    key: "A",
    selected: true,
    revealAnswer: false,
    correctKeys: ["B"],
  }),
).toEqual({ selected: true, state: "selected", disabled: false });

expect(
  presentQuestionOption({
    key: "B",
    selected: false,
    revealAnswer: true,
    correctKeys: ["B"],
  }),
).toEqual({ selected: false, state: "correct", disabled: true });
```

补充 mock 测试：已选择但未交卷时 `revealAnswer` 为 false，交卷后才为 true。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/presenters.test.ts tests/practice-session.test.ts
```

- [ ] **Step 3: 修正页面选择与提交流程**

单选、判断、多选都先写入 `draftSelection`，不在点击时立即判题；点击“确认答案”才调用 `answerQuestion`。模拟考试确认后只保存答案并进入下一题，仍不显示反馈；交卷后 report/解析页才显示答案状态。

`renderSession` 使用：

```ts
const revealAnswer =
  session.mode === "mock"
    ? session.status === "submitted"
    : Boolean(session.feedback[question.id]);
```

错误提交后只出现一个红色用户答案和一个绿色正确答案；其他选项仍为白卡。回答正确时只突出正确选择。

- [ ] **Step 4: 重做选项组件视觉**

必须落实：

- 白色大圆角卡片，无粗边框，最小触控高度 `96rpx`。
- 卡片圆角 `34rpx`。
- 正文 `28rpx`、`font-weight: 600`、`line-height: 1.5`、颜色 `var(--color-option-text)`。
- 字母圆形徽标 `56rpx`，默认奶绿底深绿字，选中柠绿色底黑字。
- 选中底色 `#DFF58F`，仅使用 `1rpx` 低对比边线。
- 提交前不显示勾叉图标。

- [ ] **Step 5: 增加克制动效**

组件使用 `hover-class="option--pressed"`：

```css
.option--pressed {
  transform: scale(0.982);
}

.option {
  transition:
    transform 100ms ease,
    background-color 200ms ease,
    border-color 200ms ease;
}

@keyframes option-key-pop {
  0% {
    transform: scale(0.92);
  }
  60% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}
```

属性 observer 仅在 `selected` 从 false 变 true 时重启 `300ms` 字母弹性动画；切换答案时旧选项立即恢复 idle。

- [ ] **Step 6: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/presenters.test.ts tests/practice-session.test.ts
npm run lint
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/presenters/question-option-presenter.ts miniapp/miniprogram/components/question-option miniapp/miniprogram/pages/practice miniapp/tests/presenters.test.ts miniapp/tests/practice-session.test.ts
git commit -m "feat: redesign answer option states"
```

---

## Task 8: 增加夜间护眼模式和收藏反馈动效

**Files:**

- Create: `miniapp/miniprogram/services/theme-service.ts`
- Create: `miniapp/miniprogram/components/theme-toggle/index.json`
- Create: `miniapp/miniprogram/components/theme-toggle/index.ts`
- Create: `miniapp/miniprogram/components/theme-toggle/index.wxml`
- Create: `miniapp/miniprogram/components/theme-toggle/index.wxss`
- Create: `miniapp/miniprogram/components/favorite-button/index.json`
- Create: `miniapp/miniprogram/components/favorite-button/index.ts`
- Create: `miniapp/miniprogram/components/favorite-button/index.wxml`
- Create: `miniapp/miniprogram/components/favorite-button/index.wxss`
- Create: `miniapp/miniprogram/components/app-toast/index.json`
- Create: `miniapp/miniprogram/components/app-toast/index.ts`
- Create: `miniapp/miniprogram/components/app-toast/index.wxml`
- Create: `miniapp/miniprogram/components/app-toast/index.wxss`
- Modify: `miniapp/miniprogram/services/app-services.ts`
- Modify: `miniapp/miniprogram/pages/practice/index.json`
- Modify: `miniapp/miniprogram/pages/practice/index.ts`
- Modify: `miniapp/miniprogram/pages/practice/index.wxml`
- Modify: `miniapp/miniprogram/pages/practice/index.wxss`
- Create: `miniapp/tests/theme-service.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 写主题持久化和组件结构失败测试**

`theme-service.test.ts`：

```ts
it("persists and restores the answer theme through the progress service", () => {
  const theme = new ThemeService(progress);

  expect(theme.get()).toBe("light");
  expect(theme.toggle()).toBe("night");
  expect(progress.getPreferences().answerTheme).toBe("night");
});
```

结构测试增加 `theme-toggle`、`favorite-button`、`app-toast`。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/theme-service.test.ts tests/project-structure.test.ts
```

- [ ] **Step 3: 实现主题服务**

```ts
export class ThemeService {
  constructor(private readonly progress: ProgressService) {}

  get(): AnswerTheme {
    return this.progress.getPreferences().answerTheme;
  }

  set(theme: AnswerTheme): AnswerTheme {
    this.progress.updatePreferences({ answerTheme: theme });
    return theme;
  }

  toggle(): AnswerTheme {
    return this.set(this.get() === "light" ? "night" : "light");
  }
}
```

`appServices.theme` 暴露实例。页面只调用 service，不直接读写 storage。

- [ ] **Step 4: 实现主题开关**

顶部月亮/太阳按钮触发 `change`，根节点使用 `class="practice-page {{themeClass}}"`。夜间确认按钮使用低亮柠绿，日间确认按钮使用纯黑；选项正文仍保持足够对比度。

- [ ] **Step 5: 实现收藏按钮和 1.6 秒反馈**

收藏状态：

- 默认白底黑色空心星。
- 已收藏黑底柠绿色实心星。
- 按下缩放至 88%。
- `420ms` 回弹。
- 只出现一圈低透明涟漪。
- toast 显示“已收藏”或“已取消收藏”，`1600ms` 自动隐藏。

组件只负责视觉和事件，收藏数据仍由 `ProgressService.toggleFavorite` 修改。

- [ ] **Step 6: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/theme-service.test.ts tests/project-structure.test.ts
npm run lint
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/services/theme-service.ts miniapp/miniprogram/services/app-services.ts miniapp/miniprogram/components/theme-toggle miniapp/miniprogram/components/favorite-button miniapp/miniprogram/components/app-toast miniapp/miniprogram/pages/practice miniapp/tests/theme-service.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: add eye comfort theme and favorite feedback"
```

---

## Task 9: 统一答题卡、结果解析、错题收藏和异常状态

**Files:**

- Modify: `miniapp/miniprogram/pages/answer-sheet/index.json`
- Modify: `miniapp/miniprogram/pages/answer-sheet/index.ts`
- Modify: `miniapp/miniprogram/pages/answer-sheet/index.wxml`
- Modify: `miniapp/miniprogram/pages/answer-sheet/index.wxss`
- Modify: `miniapp/miniprogram/pages/report/index.json`
- Modify: `miniapp/miniprogram/pages/report/index.ts`
- Modify: `miniapp/miniprogram/pages/report/index.wxml`
- Modify: `miniapp/miniprogram/pages/report/index.wxss`
- Modify: `miniapp/miniprogram/pages/question-list/index.json`
- Modify: `miniapp/miniprogram/pages/question-list/index.ts`
- Modify: `miniapp/miniprogram/pages/question-list/index.wxml`
- Modify: `miniapp/miniprogram/pages/question-list/index.wxss`
- Modify: `miniapp/miniprogram/components/analysis-panel/index.wxml`
- Modify: `miniapp/miniprogram/components/analysis-panel/index.wxss`
- Modify: `miniapp/miniprogram/components/empty-state/index.ts`
- Modify: `miniapp/miniprogram/components/empty-state/index.wxml`
- Modify: `miniapp/miniprogram/components/empty-state/index.wxss`
- Modify: `miniapp/tests/project-structure.test.ts`
- Create: `miniapp/tests/question-list-page.test.ts`

- [ ] **Step 1: 写页面结构和过滤联动失败测试**

覆盖：

- 答题卡、结果、错题/收藏页面注册 `app-topbar` 和主题开关。
- 错题/收藏默认使用当前职业等级。
- 切换首页职业等级后，列表过滤条件同步更新。
- 模拟考试答题卡交卷前只含 answered/unanswered，不含 correct/wrong。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/project-structure.test.ts tests/question-list-page.test.ts tests/practice-session.test.ts
```

- [ ] **Step 3: 重构答题卡**

使用圆形题号网格；状态配色：

- 未答：白色。
- 已答未提交：柠绿。
- 当前题：黑色描点，不使用粗边框。
- 交卷后正确/错误：低饱和绿/红。

交卷确认 modal 明确显示未答题数。普通章节练习和随机练习使用“结束本次练习”，模拟考试使用“确认交卷”。

- [ ] **Step 4: 重构结果与解析**

保留分数、正确率、用时、薄弱章节和错题入口。结果页支持：

- 查看本次错题解析。
- 再练一次。
- 返回首页。

解析卡依次显示“你的答案、正确答案、题目解析、知识点、易错原因、标准依据”，不把所有内容塞入一块高饱和颜色卡。

- [ ] **Step 5: 重构错题本和收藏试题**

两个页面保持独立路由，使用相同筛选条和题目卡。默认筛选当前职业等级；章节下拉只列当前职业等级相关章节。空状态分别为：

- 错题本：“还没有错题 / 答错的题会自动收录到这里。”
- 收藏试题：“还没有收藏 / 在答题页点击星标即可收藏。”

- [ ] **Step 6: 统一加载、空、网络与纠错入口**

`empty-state` 增加 `kind: 'empty' | 'loading' | 'network' | 'coming-soon'` 和可选 action。题库加载失败提供“重新加载”；题目解析底部提供“题目纠错”，调用微信 feedback 能力或展示可复制的题目 ID，不伪造提交成功。

- [ ] **Step 7: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/project-structure.test.ts tests/question-list-page.test.ts tests/practice-session.test.ts tests/presenters.test.ts
npm run lint
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/pages/answer-sheet miniapp/miniprogram/pages/report miniapp/miniprogram/pages/question-list miniapp/miniprogram/components/analysis-panel miniapp/miniprogram/components/empty-state miniapp/tests/project-structure.test.ts miniapp/tests/question-list-page.test.ts
git commit -m "feat: unify review and result pages"
```

---

## Task 10: 重做实操页图标和稻穗照片详情

**Files:**

- Modify: `miniapp/miniprogram/data/practical-skills.ts`
- Modify: `miniapp/miniprogram/pages/practical/index.ts`
- Modify: `miniapp/miniprogram/pages/practical/index.wxml`
- Modify: `miniapp/miniprogram/pages/practical/index.wxss`
- Modify: `miniapp/miniprogram/pages/practical-detail/index.json`
- Modify: `miniapp/miniprogram/pages/practical-detail/index.ts`
- Modify: `miniapp/miniprogram/pages/practical-detail/index.wxml`
- Modify: `miniapp/miniprogram/pages/practical-detail/index.wxss`
- Create: `miniapp/miniprogram/assets/practical/rice-ear-hero.png`
- Create: `miniapp/miniprogram/assets/practical/warehouse.png`
- Create: `miniapp/miniprogram/assets/practical/thermometer.png`
- Create: `miniapp/miniprogram/assets/practical/grain-pest.png`
- Create: `miniapp/miniprogram/assets/practical/sampler.png`
- Create: `miniapp/miniprogram/assets/practical/moisture-test.png`
- Create: `miniapp/miniprogram/assets/README.md`
- Modify: `miniapp/tests/practical-skills.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 写语义图标和本地素材失败测试**

断言：

- 每个技能拥有 `iconAsset`。
- `iconAsset` 指向本地存在的 PNG。
- icon 文件名不得为单个汉字或 `text-*`。
- 实操详情引用本地 `rice-ear-hero.png`，WXML 不含 `http://` 或 `https://`。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/practical-skills.test.ts tests/project-structure.test.ts
```

- [ ] **Step 3: 生成并整理本地视觉素材**

生成一张自然、低饱和、无文字的稻穗近景照片，裁切为适合横向头图的比例；生成五个透明背景、统一线宽的语义小图标。不得在位图中加入汉字。

`assets/README.md` 记录每个文件的生成日期、生成工具、用途、是否允许项目内商用及人工调整记录。所有页面只引用本地路径。

- [ ] **Step 4: 更新实操数据和列表**

`PracticalSkill` 增加：

```ts
iconAsset: string;
purpose: string;
```

按技能语义映射仓房、温度计、害虫、扦样器、水滴/烧瓶图标；不再显示“仓、温、虫、检”文字块。

- [ ] **Step 5: 重做实操详情**

顶部使用 `app-topbar` 和稻穗照片 hero；内容顺序：

1. 作业目的。
2. 作业准备。
3. 操作步骤。
4. 安全提示。
5. 常见错误。
6. 关联练习。

关联练习为空时显示明确状态，不创建空会话。

- [ ] **Step 6: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/practical-skills.test.ts tests/project-structure.test.ts
npm run lint
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/data/practical-skills.ts miniapp/miniprogram/pages/practical miniapp/miniprogram/pages/practical-detail miniapp/miniprogram/assets miniapp/tests/practical-skills.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: redesign practical learning pages"
```

---

## Task 11: 重做“我的”并补齐个人中心二级页

**Files:**

- Modify: `miniapp/miniprogram/pages/profile/index.ts`
- Modify: `miniapp/miniprogram/pages/profile/index.wxml`
- Modify: `miniapp/miniprogram/pages/profile/index.wxss`
- Create: `miniapp/miniprogram/pages/learning-report/index.json`
- Create: `miniapp/miniprogram/pages/learning-report/index.ts`
- Create: `miniapp/miniprogram/pages/learning-report/index.wxml`
- Create: `miniapp/miniprogram/pages/learning-report/index.wxss`
- Create: `miniapp/miniprogram/pages/member/index.json`
- Create: `miniapp/miniprogram/pages/member/index.ts`
- Create: `miniapp/miniprogram/pages/member/index.wxml`
- Create: `miniapp/miniprogram/pages/member/index.wxss`
- Create: `miniapp/miniprogram/pages/edit-profile/index.json`
- Create: `miniapp/miniprogram/pages/edit-profile/index.ts`
- Create: `miniapp/miniprogram/pages/edit-profile/index.wxml`
- Create: `miniapp/miniprogram/pages/edit-profile/index.wxss`
- Create: `miniapp/miniprogram/pages/learning-settings/index.json`
- Create: `miniapp/miniprogram/pages/learning-settings/index.ts`
- Create: `miniapp/miniprogram/pages/learning-settings/index.wxml`
- Create: `miniapp/miniprogram/pages/learning-settings/index.wxss`
- Modify: `miniapp/miniprogram/app.json`
- Create: `miniapp/tests/profile-presenter.test.ts`
- Modify: `miniapp/tests/progress-service.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

- [ ] **Step 1: 写个人中心内容与路由失败测试**

覆盖：

- Profile WXML 不包含大标题“复习”、`onOpenWrong` 或 `onOpenFavorite`。
- 页面包含学习报告、编辑资料、学习设置、数据管理、意见反馈入口。
- 新二级页注册完整四件套和 `app-topbar`。
- 昵称更新和每日目标更新通过 `ProgressService` 持久化。

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/profile-presenter.test.ts tests/progress-service.test.ts tests/project-structure.test.ts
```

- [ ] **Step 3: 重排“我的”首页**

从上到下：

1. 头像、昵称和编辑资料。
2. 黑色会员权益入口。
3. 累计练习、正确率、连续学习。
4. 今日目标进度。
5. 近七天学习柱状图。
6. 学习报告、学习设置、数据管理、意见反馈。

删除错题本和收藏试题的大面积复习板块；错题/收藏仍从首页进入独立页面。

- [ ] **Step 4: 实现学习报告**

复用 `ProgressService.getDashboard`、`getActivity` 和 `getQuestionProgress`，展示累计数据、近七天趋势和当前教材薄弱章节。无数据时显示引导开始练习，不显示虚构百分比。

- [ ] **Step 5: 实现会员、编辑资料和学习设置**

- 会员中心只展示本轮静态权益说明和“功能逐步开放”，不出现真实支付按钮。
- 编辑资料允许修改昵称；头像暂用内置头像选择，避免保存临时文件路径。
- 学习设置允许修改每日目标和默认答题主题。
- 数据管理沿用现有二次确认与清除逻辑，清除学习记录但保留偏好。
- 意见反馈使用微信官方 feedback 按钮能力。

- [ ] **Step 6: 验证和提交**

Run:

```powershell
Set-Location miniapp
npx vitest run tests/profile-presenter.test.ts tests/progress-service.test.ts tests/project-structure.test.ts
npm run lint
npm run typecheck
```

Commit:

```powershell
git add miniapp/miniprogram/pages/profile miniapp/miniprogram/pages/learning-report miniapp/miniprogram/pages/member miniapp/miniprogram/pages/edit-profile miniapp/miniprogram/pages/learning-settings miniapp/miniprogram/app.json miniapp/tests/profile-presenter.test.ts miniapp/tests/progress-service.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: redesign profile and learning settings"
```

---

## Task 12: 完成全量自动验证和微信开发者工具验收

**Files:**

- Modify: `miniapp/tests/project-structure.test.ts`
- Modify: `docs/miniapp-acceptance-checklist.md`
- Modify: `docs/miniapp-code-standards.md`
- Create: `docs/qa/2026-07-26-ui-redesign-smoke-test.md`

- [ ] **Step 1: 更新结构测试为最终页面和组件清单**

最终主 tab 仅三项；所有已注册页面具有 `.json/.ts/.wxml/.wxss`；所有本地组件路径可解析；素材文件均为本地文件。

- [ ] **Step 2: 运行全量自动验证**

Run:

```powershell
Set-Location miniapp
npm run verify
```

Expected:

- TypeScript 无错误。
- ESLint 与 Stylelint 无错误。
- Prettier 检查通过。
- Vitest 全部通过。

- [ ] **Step 3: 同步题库并验证稳定 ID**

Run:

```powershell
Set-Location miniapp
npm run sync:questions
npm run test
git diff --check
```

Expected: 题库同步不改问题 ID、章节 ID 或职业编码；无空白错误。

- [ ] **Step 4: 在微信开发者工具执行日间/夜间烟测**

记录以下结果：

- 首页职业两类、每类五等级，技师/高级技师显示待补充且不能开始空练习。
- 首页只有章节刷题、随机练习、模拟考试、错题本、收藏试题五个功能。
- 教材目录章节编号为 1、2、3，无 01、02、03。
- 单选、多选、判断、案例题选项点击、切换、确认、正确、错误状态均正确。
- 模拟考试交卷前不泄露答案。
- 收藏按钮支持收藏和取消，反馈约 1.6 秒自动隐藏。
- 夜间主题在退出页面、关闭并重开小程序后仍保留。
- 答题、答题卡、结果、解析、错题/收藏页面夜间颜色一致。
- 实操图标无文字替代，详情稻穗照片本地加载。
- 二级页均可返回，直接打开二级页时可回到正确主 tab。
- “我的”没有重复复习大板块。

- [ ] **Step 5: 真机可读性检查**

至少检查一台 iOS 和一台 Android：

- 选项正文字号 `28rpx`、行高 1.5、默认字重 600 可读。
- 若低端 Android 出现字形粘连，只在 Android 样式分支降到 500，并把机型和截图结论写入烟测记录。
- 日间/夜间对比度、触控高度和安全区无截断。

- [ ] **Step 6: 更新验收和代码规范文档**

`miniapp-code-standards.md` 补充：

- 页面不得直接存储偏好。
- 题库可用性与等级类型分离。
- 主题变量和状态机命名。
- 页面事件、presenter 与 service 的职责边界。
- 二级页统一返回行为。

`miniapp-acceptance-checklist.md` 与 smoke test 使用本计划的最终验收项。

- [ ] **Step 7: 最终验证和提交**

Run:

```powershell
Set-Location miniapp
npm run verify
Set-Location ..
git diff --check
git status --short
```

Expected: 全部验证通过，只包含本计划内变更。

Commit:

```powershell
git add miniapp/tests/project-structure.test.ts docs/miniapp-acceptance-checklist.md docs/miniapp-code-standards.md docs/qa/2026-07-26-ui-redesign-smoke-test.md
git commit -m "docs: add redesign verification checklist"
```

---

## Final Acceptance

- [ ] 底部导航仅为首页、实操、我的。
- [ ] 首页完成题库合并、两阶段职业等级选择、五个刷题入口、目录摘要和最近记录。
- [ ] 两个职业各展示五等级，待补充等级不创建空练习。
- [ ] 教材目录严格跟随当前职业等级，并按教材展示无前导零章节号。
- [ ] 选项视觉、字体、四状态和动效符合规格。
- [ ] 模拟考试交卷前不显示答案和解析。
- [ ] 夜间模式持久化且覆盖所有答题相关页面。
- [ ] 收藏动效和 1.6 秒反馈可重复切换。
- [ ] 实操使用语义图标和本地稻穗照片。
- [ ] “我的”无重复复习板块，个人中心二级页完整。
- [ ] 旧学习记录、题目 ID、目录 ID 和收藏/错题数据无损。
- [ ] `npm run verify`、题库同步验证和微信开发者工具烟测全部通过。
