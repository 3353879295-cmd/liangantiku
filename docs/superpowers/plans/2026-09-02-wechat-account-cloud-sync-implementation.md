# 粮安题库微信账号与云端学习同步 Implementation Plan

> **For agentic workers:** 按本计划逐任务实施。每个任务必须遵循 RED → GREEN → 定向回归 → 精确暂存 → 独立提交；实现人员不得覆盖工作树中的既有用户修改，验证人员不得修改源代码。

**Goal:** 在正式 AppID `wx84ecacec08ca162c` 的原生微信小程序中增加首次登录提示、可选游客模式、完全隔离的游客/账号学习档案、以云端为唯一真源的账号同步、跨设备恢复、可靠冲突处理、退出登录和永久注销账号。

**Architecture:** 保留页面 → `ProgressService` 的现有领域边界，在其下增加可切换的游客/账号存储作用域和领域变更通知；`AuthService` 负责启动、登录、临时游客、退出和注销状态机，`CloudSyncService` 负责持久化 outbox、串行发送、有限退避、冲突回云端和快照替换。小程序只通过固定环境中的 `accountSync` 云函数读写账号数据；云函数从可信微信上下文派生账号键，以纯处理器 + 云数据库适配器实现校验、乐观锁、幂等练习提交和可恢复删除。

**Tech Stack:** 原生微信小程序、TypeScript 6 strict、Vitest 4、ESLint 10、Stylelint 17、Prettier 3、微信云开发、Node.js 20、`wx-server-sdk` 3.0.1、云开发文档型数据库。

---

## 固定实施边界

- 活跃工作树固定为 `D:\文档\保管员刷题小程序\.worktrees\warehouse-question-classification`；小程序目录固定为该工作树下的 `miniapp`。
- 设计依据固定为 `docs/superpowers/specs/2026-09-02-wechat-account-cloud-sync-design.md`，设计提交为 `1381d21 docs: design WeChat account cloud sync`。
- 当前工作树已有大量未提交的题库分类、质检员题库、Python 工具、生成数据和测试修改，全部属于用户内容。禁止 reset、checkout 覆盖、stash、全量暂存或夹带提交。
- 已知直接重叠文件是 `miniapp/miniprogram/pages/practice/index.ts` 和 `miniapp/tests/project-structure.test.ts`。本功能优先不修改前者；若必须修改后者，只精确暂存本功能 hunk。
- 每次提交前必须执行 `git diff --cached --check`、`git diff --cached --name-only` 和 `git diff --cached`，确保只包含当前任务文件或 hunk。禁止使用 `git add .`、`git add -A`。
- 正式 AppID 固定为 `wx84ecacec08ca162c`；目标云环境固定为 `cloud1-d2gglad830c91db10`。
- 小程序包、缓存、响应和业务日志不得包含 AppSecret、OpenID、session key、account key 或固定云密钥。
- 登录后云端数据是唯一真源。游客数据不上传、不合并、不复制，也不作为新账号默认值。
- 本地阶段只写代码、测试、配置和操作说明。不得创建集合、权限、索引，不得上传数据或部署云函数。
- 云函数目录必须位于 `miniprogramRoot` 之外，并由 `cloudfunctionRoot` 明确声明，不能计入小程序主包。
- 当前 `check:package` 仅余约 1.1 KB 余量。不得简单删除包体测试或忽略实际会上传的文件；在接入页和服务后应按 `app.json` 的真实主包/分包边界重新计算，同时保持微信主包限制和仓库的安全余量。

## 核心本地契约

### 存储键

```text
grain-practice:auth-preference
grain-practice:guest-progress
grain-practice:account-cache
grain-practice:account-outbox
grain-practice:progress:recovery-backup
```

- 旧键 `grain-practice:progress` 只可迁移到 `guest-progress`。
- 迁移可重复执行；已有游客档案时不得被旧键覆盖。
- `account-cache` 是云端快照与待确认命令的账号投影，不能从游客档案初始化。
- 退出或注销只按已确认流程清理账号缓存/outbox，始终保留该设备原有游客档案。

### 客户端状态

```ts
type AuthPreference = "undecided" | "guest" | "account";
type AuthStatus = "checking" | "guest" | "authenticated" | "error";
type SyncStatus = "idle" | "syncing" | "pending" | "failed" | "conflict";
```

- 临时游客使用 `AuthStatus='guest'` 加独立的 `temporaryGuest=true`，不改持久化 `account` 偏好。
- `ProgressService` 单例保持现有页面 API，并增加作用域切换、合法快照替换和变更订阅。
- 账号作用域下的页面写操作先更新账号缓存，再产生白名单同步命令；游客作用域永不产生 outbox 命令。

### 同步命令

```text
updateProfile
updatePreferences
saveActiveSession
recordPractice
setFavorite
markMastered
```

- 队列一次只执行一个命令，命令 ID 和创建时版本持久化。
- 资料、设置和未完成练习只合并尚未发送的最新目标状态；完成练习绝不合并。
- 账号 revision 与进度 revision 分开推进，合并后必须重算同一 revision 域中后续未发送命令的 `expectedRevision`。
- 网络失败进行有上限的退避；前台恢复、网络恢复和手动重试复用原命令 ID。
- `REVISION_CONFLICT` 停止发送，清除无法安全重放的账号 outbox，重新 bootstrap 并以云端快照替换账号投影，同时产生一次性用户提示。
- 最终目标型动作在云端发现“版本已增加但目标状态已经相同”时按幂等成功处理；`recordPractice` 通过稳定 `session_id` 幂等。

---

### Task 0: 固化实施计划和基线

**Files:**

- Create: `docs/superpowers/plans/2026-09-02-wechat-account-cloud-sync-implementation.md`

- [ ] **Step 1: 完整读取设计和当前工作树状态**

确认 HEAD 包含 `1381d21`，列出所有已修改/未跟踪文件，并记录已知重叠文件。只读，不整理用户内容。

- [ ] **Step 2: 运行本地基线门禁**

```powershell
Set-Location miniapp
npm run typecheck
npm run lint
npm run format:check
npm run check:package
npm test
```

记录任何由现有用户修改导致的基线失败；不得为了本功能修复无关题库数据。

- [ ] **Step 3: 提交计划文件**

```powershell
git add -- docs/superpowers/plans/2026-09-02-wechat-account-cloud-sync-implementation.md
git diff --cached --check
git diff --cached --name-only
git diff --cached
git commit -m "docs: plan WeChat account cloud sync"
```

### Task 1: 建立聚合进度模型和隔离存储

**Files:**

- Modify: `miniapp/miniprogram/storage/migrations.ts`
- Modify: `miniapp/miniprogram/storage/progress-repository.ts`
- Modify: `miniapp/miniprogram/services/progress-service.ts`
- Create: `miniapp/miniprogram/types/account-sync.ts`
- Create: `miniapp/tests/account-storage.test.ts`
- Modify: `miniapp/tests/migrations.test.ts`
- Modify: `miniapp/tests/progress-service.test.ts`

- [ ] **Step 1: 写聚合 schema 和旧键迁移失败测试（RED）**

锁定 V1/V2/V3 迁移到新的聚合快照：累计答题/正确/耗时/首次日期、逐题统计、错题、收藏、每日统计、最近 100 个题号、未完成练习、已记录 session ID 和偏好均保持现有可观察行为。

锁定旧 `grain-practice:progress` 只进入 `guest-progress`；已有游客档案不被覆盖；账号缓存为空时创建独立空白账号投影；损坏数据仍写入 recovery backup。

- [ ] **Step 2: 运行定向测试并确认 RED**

```powershell
Set-Location miniapp
npx vitest run tests/migrations.test.ts tests/account-storage.test.ts tests/progress-service.test.ts
```

- [ ] **Step 3: 实现最小聚合模型与作用域仓库**

`ProgressService` 的 dashboard、章节进度、最近题目、备考天数、错题、收藏、练习幂等和偏好 API 必须保持兼容。仓库显式接受 `guest` 或 `account` 作用域，禁止隐式回退到另一个作用域。

- [ ] **Step 4: 运行 GREEN 与现有领域回归**

```powershell
npx vitest run tests/migrations.test.ts tests/account-storage.test.ts tests/progress-service.test.ts tests/theme-service.test.ts tests/practice-runtime.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 5: 精确提交 Task 1**

提交信息：`feat: isolate guest and account progress storage`

### Task 2: 固定账号云函数客户端协议和显式云环境

**Files:**

- Create: `miniapp/miniprogram/config/cloud.ts`
- Create: `miniapp/miniprogram/repositories/account-sync-client.ts`
- Extend: `miniapp/miniprogram/types/account-sync.ts`
- Modify: `miniapp/miniprogram/app.ts`
- Create: `miniapp/tests/account-sync-client.test.ts`
- Create: `miniapp/tests/cloud-config.test.ts`

- [ ] **Step 1: 写 transport、响应校验和脱敏错误测试（RED）**

测试所有白名单 action 只调用 `accountSync`；请求不得包含 OpenID/account key；非法或超版本响应不得覆盖缓存；底层云错误统一映射为 `ACCOUNT_SYNC_UNAVAILABLE` 和简明中文消息。

- [ ] **Step 2: 写显式环境初始化测试（RED）**

锁定 `wx.cloud.init({ env: 'cloud1-d2gglad830c91db10', traceUser: false })`，且代码中不存在 AppSecret、SecretId、SecretKey 或客户端身份参数。

- [ ] **Step 3: 实现客户端与初始化并验证 GREEN**

```powershell
Set-Location miniapp
npx vitest run tests/account-sync-client.test.ts tests/cloud-config.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 4: 精确提交 Task 2**

提交信息：`feat: add account sync cloud client`

### Task 3: 实现云函数身份、校验和常规写入动作

**Files:**

- Modify: `miniapp/project.config.json`
- Create: `miniapp/cloudfunctions/accountSync/package.json`
- Create: `miniapp/cloudfunctions/accountSync/index.js`
- Create: `miniapp/cloudfunctions/accountSync/lib/errors.js`
- Create: `miniapp/cloudfunctions/accountSync/lib/validation.js`
- Create: `miniapp/cloudfunctions/accountSync/lib/account-key.js`
- Create: `miniapp/cloudfunctions/accountSync/lib/handler.js`
- Create: `miniapp/cloudfunctions/accountSync/lib/cloud-store.js`
- Create: `miniapp/tests/account-sync-function.test.ts`
- Create: `miniapp/tests/account-sync-cloud-store.test.ts`
- Modify: `miniapp/eslint.config.mjs`

- [ ] **Step 1: 写纯处理器失败测试（RED）**

覆盖：可信上下文身份、SHA-256 账号键、不接受客户端身份/任意字段/action、默认空白账号、bootstrap、资料/设置、active session、收藏、掌握状态、schema/枚举/长度/数量/日期/题号/耗时限制、账号 deleting/clearing 写入拒绝和稳定错误码。

- [ ] **Step 2: 写 revision 与最终目标幂等测试（RED）**

正常写入必须校验并增加对应 revision；重复送达且云端已经等于最终目标时返回当前快照，不二次增加 revision；真实冲突返回 `REVISION_CONFLICT`。

- [ ] **Step 3: 实现纯 handler 和云数据库适配器**

入口只从 `cloud.getWXContext()` 读取 AppID/OpenID。业务日志只允许 trace ID、action、稳定错误码、耗时和结果，不记录身份与答案。响应必须经过统一序列化，不能泄漏 `_id`、account key、堆栈或数据库错误。

- [ ] **Step 4: 验证 GREEN**

```powershell
Set-Location miniapp
npx vitest run tests/account-sync-function.test.ts tests/account-sync-cloud-store.test.ts
npm run typecheck
npm run lint
npm run format:check
```

- [ ] **Step 5: 精确提交 Task 3**

提交信息：`feat: implement account sync cloud handler`

### Task 4: 实现练习事务、清除数据和永久注销

**Files:**

- Modify: `miniapp/cloudfunctions/accountSync/lib/validation.js`
- Modify: `miniapp/cloudfunctions/accountSync/lib/handler.js`
- Modify: `miniapp/cloudfunctions/accountSync/lib/cloud-store.js`
- Modify: `miniapp/tests/account-sync-function.test.ts`
- Modify: `miniapp/tests/account-sync-cloud-store.test.ts`

- [ ] **Step 1: 写 recordPractice 事务与幂等失败测试（RED）**

同一账号与 `session_id` 生成确定记录 ID；事务内创建不可变练习记录、更新 summary/question totals/wrong/daily/recent、清理匹配 active session 并增加进度 revision。重复提交不得重复统计；不同账号的相同 session ID 不冲突。

- [ ] **Step 2: 写可恢复清理/注销失败测试（RED）**

`clearLearningData` 先标记 `clearing`，分批删练习记录、重置进度、最后恢复 `idle`；`deleteAccount` 先标记 `deleting`，分批删练习记录，再删 progress，最后删 account。每个阶段失败后重试均从剩余阶段继续，`done:true` 前不得声称完成。

- [ ] **Step 3: 实现事务与分批状态机并验证 GREEN**

```powershell
Set-Location miniapp
npx vitest run tests/account-sync-function.test.ts tests/account-sync-cloud-store.test.ts
npm run lint
npm run typecheck
```

- [ ] **Step 4: 精确提交 Task 4**

提交信息：`feat: add resumable cloud learning deletion`

### Task 5: 实现持久化 outbox 和可靠同步协调器

**Files:**

- Create: `miniapp/miniprogram/storage/sync-outbox.ts`
- Create: `miniapp/miniprogram/services/cloud-sync-service.ts`
- Extend: `miniapp/miniprogram/types/account-sync.ts`
- Create: `miniapp/tests/sync-outbox.test.ts`
- Create: `miniapp/tests/cloud-sync-service.test.ts`

- [ ] **Step 1: 写 outbox 排序、持久化和合并失败测试（RED）**

覆盖串行顺序、重启恢复、稳定命令 ID、同 revision 域版本推进、资料/设置/session 的安全合并、recordPractice 不合并、手动重试复用命令和游客无队列。

- [ ] **Step 2: 写重试、冲突和 bootstrap 失败测试（RED）**

覆盖单飞发送、有上限退避、达到上限进入 failed、网络/前台恢复、先重放后 bootstrap、冲突停止队列并以云覆盖、非法云响应保留有效缓存。

- [ ] **Step 3: 实现 outbox 与协调器并验证 GREEN**

```powershell
Set-Location miniapp
npx vitest run tests/sync-outbox.test.ts tests/cloud-sync-service.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 4: 精确提交 Task 5**

提交信息：`feat: add reliable account sync outbox`

### Task 6: 接入 ProgressService、AuthService 和应用生命周期

**Files:**

- Modify: `miniapp/miniprogram/services/progress-service.ts`
- Modify: `miniapp/miniprogram/services/practice-runtime.ts`
- Create: `miniapp/miniprogram/services/auth-service.ts`
- Modify: `miniapp/miniprogram/services/app-services.ts`
- Modify: `miniapp/miniprogram/services/theme-service.ts` only if needed for scope switching
- Modify: `miniapp/miniprogram/app.ts`
- Modify: `miniapp/miniprogram/types/domain.ts`
- Create: `miniapp/tests/auth-service.test.ts`
- Modify: `miniapp/tests/progress-service.test.ts`
- Modify: `miniapp/tests/practice-runtime.test.ts`

- [ ] **Step 1: 写领域变更与作用域切换失败测试（RED）**

覆盖游客写入只落游客档案；账号写入先更新 account cache 后产生正确最终目标命令；账号快照替换发出变更通知；切到账号绝不读游客；退出/注销后恢复原游客；练习提交携带稳定 session ID、mode 和完整 answers。

- [ ] **Step 2: 写 AuthService 状态机失败测试（RED）**

覆盖 undecided、guest、account 自动恢复、首次登录失败、临时游客、前台/网络恢复、退出成功、退出失败必须明确选择、放弃后退出、注销中断保留账号恢复信息、注销完成后切游客。

- [ ] **Step 3: 实现服务装配和生命周期钩子**

`appServices.progress` 对既有页面保持同一对象身份；`onShow` 和网络恢复仅在账号模式触发有限重试。初始化/恢复尚未完成时，普通页面不得把游客状态冒充账号状态。

- [ ] **Step 4: 验证 GREEN 与答题回归**

```powershell
Set-Location miniapp
npx vitest run tests/auth-service.test.ts tests/progress-service.test.ts tests/practice-runtime.test.ts tests/theme-service.test.ts tests/practice-page.test.ts tests/question-list-page.test.ts
npm run typecheck
npm run lint
```

- [ ] **Step 5: 精确提交 Task 6**

提交信息：`feat: integrate account-backed progress services`

### Task 7: 增加首次进入页和账号数据页面

**Files:**

- Modify: `miniapp/miniprogram/app.json`
- Create: `miniapp/miniprogram/pages/account-entry/index.ts`
- Create: `miniapp/miniprogram/pages/account-entry/index.wxml`
- Create: `miniapp/miniprogram/pages/account-entry/index.wxss`
- Create: `miniapp/miniprogram/pages/account-entry/index.json`
- Create: `miniapp/miniprogram/pages/account-data/index.ts`
- Create: `miniapp/miniprogram/pages/account-data/index.wxml`
- Create: `miniapp/miniprogram/pages/account-data/index.wxss`
- Create: `miniapp/miniprogram/pages/account-data/index.json`
- Modify: `miniapp/miniprogram/pages/profile/index.ts`
- Modify: `miniapp/miniprogram/pages/profile/index.wxml`
- Modify: `miniapp/miniprogram/pages/profile/index.wxss`
- Modify: `miniapp/miniprogram/pages/edit-profile/index.ts`
- Modify: `miniapp/miniprogram/pages/learning-settings/index.ts`
- Create: `miniapp/tests/account-entry-page.test.ts`
- Create: `miniapp/tests/account-data-page.test.ts`
- Create: `miniapp/tests/profile-account-page.test.ts`

- [ ] **Step 1: 写首次进入页面失败测试（RED）**

覆盖未选择、恢复中、登录失败、微信登录、暂不登录、重新登录和临时游客；锁定已确认文案；成功后 `reLaunch` 首页；临时游客不改 `account` 偏好。

- [ ] **Step 2: 写“我的”和账号数据页面失败测试（RED）**

游客显示本机记录声明和登录入口；账号显示最近同步时间及 syncing/pending/failed 状态；失败可重试。退出失败弹出“继续重试/放弃未同步数据”选择；注销必须二次确认且 `done:true` 后才显示成功并清本地账号数据。

- [ ] **Step 3: 实现页面与轻量样式**

继续使用现有绿色 token、内置头像和昵称输入，不调用微信用户资料接口。资料/设置页只调用领域服务，不直接调用云函数。

- [ ] **Step 4: 按真实页面边界处理包体门禁**

如把非首屏账号管理页放入分包，更新 `app.json` 和包体测试，使其按真实 subpackage root 排除分包文件；首次进入页、tabBar 页面及其共享依赖仍计入主包。不得忽略真实上传文件或提高限制来掩盖超限。

- [ ] **Step 5: 验证页面与包体 GREEN**

```powershell
Set-Location miniapp
npx vitest run tests/account-entry-page.test.ts tests/account-data-page.test.ts tests/profile-account-page.test.ts tests/project-structure.test.ts
npm run typecheck
npm run lint
npm run format:check
npm run check:package
```

- [ ] **Step 6: 精确提交 Task 7**

如果 `project-structure.test.ts` 仍包含用户未提交 hunk，使用交互式/补丁式暂存，只提交本功能片段。

提交信息：`feat: add WeChat account entry and management pages`

### Task 8: 补齐操作说明、安全扫描和完整本地门禁

**Files:**

- Create: `docs/wechat-account-cloud-sync-operations.md`
- Create: `docs/qa/2026-09-02-wechat-account-cloud-sync-local.md`
- Create: `miniapp/tests/account-sync-security.test.ts`
- Modify: `miniapp/tests/main-package-budget.test.ts` only if Task 7 introduced a real subpackage boundary

- [ ] **Step 1: 写安全与发布说明断言（RED）**

检查客户端包中无 AppSecret/OpenID/account key/固定密钥；三集合只能由云函数访问；操作说明列出精确环境、集合、索引、权限、云函数、部署方式、回滚/故障处理和“不修改计费”。

- [ ] **Step 2: 写本地运维文档和 QA 记录**

记录各阶段测试、主包大小、已知基线用户改动以及本地尚未执行任何云写。文档不得包含个人身份、答案内容、token 或控制台登录数据。

- [ ] **Step 3: 依次运行完整本地门禁**

```powershell
Set-Location miniapp
npm run typecheck
npm run lint
npm run format:check
npm run check:package
npm test
npm run verify
```

所有命令必须通过。若失败来自既有用户修改，先用证据区分来源；不得覆盖或夹带其内容。

- [ ] **Step 4: 使用 tester 做只读验证，使用 reviewer 做只读审查**

tester 复跑定向测试和 `npm run verify`；reviewer 检查身份边界、删除幂等、revision 契约、游客隔离、敏感信息、包体和缺失测试。主智能体整合问题后再提交。

- [ ] **Step 5: 精确提交 Task 8**

提交信息：`docs: document account sync local verification`

### Task 9: 展示云端精确变更清单并暂停

本任务不产生本地代码提交，也不执行任何云写。向用户原样展示：

```text
目标环境：cloud1-d2gglad830c91db10
新建集合：user_accounts、user_progress、user_practice_records
新建索引：user_practice_records(account_key ASC, submitted_at ASC)
客户端权限：三个集合均为“无权限”
新建并部署云函数：accountSync（Node.js 20，wx-server-sdk 3.0.1）
不会修改：套餐、自动续费、超额付费或其他计费设置
不需要：AppSecret、SecretId、SecretKey
```

必须同时列出云函数动作：`bootstrap`、`updateProfile`、`updatePreferences`、`saveActiveSession`、`recordPractice`、`setFavorite`、`markMastered`、`clearLearningData`、`deleteAccount`。

到此停止，等待用户对上述精确清单明确确认。确认前不得打开云控制台执行资源创建、修改权限/索引或部署。

### Task 10: 用户确认后的云端部署与真机验证（本轮禁止提前执行）

- [ ] 部署前重新只读核对环境和同名资源，存在资源时检查并协调，禁止覆盖。
- [ ] 创建三个集合并设置客户端“无权限”。
- [ ] 创建唯一复合索引 `account_key ASC, submitted_at ASC`。
- [ ] 部署 `accountSync`，不配置秘密或付费项。
- [ ] 在开发者工具和真机依次验证：首次登录、游客模式、新账号空白、同账号跨设备恢复、离线答题/恢复重试、双设备 revision 冲突、退出失败选择、退出后游客恢复、清除学习数据、注销中断重试与最终删除。
- [ ] 记录不含身份信息的部署/QA 证据，并另行提交。

---

## 每阶段统一提交检查

```powershell
git status --short
git diff --check
git diff --cached --check
git diff --cached --name-only
git diff --cached
git commit -m "<当前阶段唯一提交信息>"
git status --short
```

预期：提交后只减少本阶段新增/修改内容；任务开始前已有的用户改动仍原样保留在工作树中。
