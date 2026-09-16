# accountSync 事务诊断包（2026-09-08）

## 状态和证据

membership 已经通过控制台标准 ZIP 恢复并部署已授权新版；本记录仅处理仍失败的 accountSync。**用户确认后，accountSync v2 诊断 ZIP 已于 12:14:50 通过控制台部署并完成真实只读验收；账号同步写入尚未修复或验收。**

### 用户确认后的实际部署与只读结果

在 `cloud1-d2gglad830c91db10 / accountSync` 使用新版控制台“函数代码 → 上传代码 → 点击选择 → 选择压缩包”，直接选择 v2 标准 ZIP，普通“部署 → 确认部署到 $LATEST”。没有选择文件夹、没有 CLI 部署、没有部署并安装依赖。控制台读回上次部署 09-08 12:14:50、状态正常；`lib`、`src`、`node_modules` 和根入口目录可见。保留 Nodejs20.19、index.main、256MB、20秒，未编辑配置。

先只读确认账号和进度文档分别存在且为 19/0，再调用真实 bootstrap。RequestID `97f65fb4-9c3f-4815-8d39-ed087e0d55d2`，耗时 3,550ms，返回 `ok=true/schemaVersion=1/profileRevision=19/progressRevision=0`、syncedAt `2026-09-08T04:16:12.498Z`。真实云日志明确 action=bootstrap，并出现 `account-sync-store-diagnostics-20260908-v1` 的 transaction.started、attempt_started、callback_completed、committed；attempts=1，提交记录时间 12:16:12.543，平台耗时 2,459ms。证明新诊断在云端实际执行，不能据此声称写入同步已恢复。

独立 tester 复核 bootstrap 证据；部署后源码字节比较未完成，尝试的 `cloud_fn_download` 工具名未注册，未伪造下载目录或比对通过。实际记录见 `tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/accountSync-live-validation.json` 与 `accountSync-after-bootstrap.json`。

为继续修复新发现的客户端冲突数据丢失风险，先只读备份账号缓存、outbox 和清理标记（私有备份不展示业务内容），确认仍有 4 条 pending、修订19/0、clearPending=false，再用 `close_project_window` 关闭准确 worktree 的模拟器窗口。原因是当前 `compileHotReLoad=true`，直接编辑前端可能触发自动发送。没有清存储、重放队列或执行真实付款；后续不要未经确认重新打开并启动队列。

在 `cloud1-d2gglad830c91db10 / accountSync` 实际云日志中，2026-09-08 10:47:13.518 的请求明确为 `saveActiveSession`，RequestID `c1bc9d0f-4f9c-44cb-85f0-0ffd5063a3a0`；213ms 后返回 `{"ok":false,"error":{"code":"ACCOUNT_SYNC_UNAVAILABLE"}}`。平台 HTTP/运行状态 200 并不表示业务成功。日志没有底层数据库错误，现有证据不足以决定业务修复方式。

scout 核对了实际安装 SDK 的 `Document.update`、事务提交与序列化路径。`saveProgress` 原来丢弃 update 的 updated/requestId 结果，事务失败最终由 handler 统一映射错误。没有发现可以直接证明根因的数据格式问题。

## 本地补丁

- 仅修改 `miniapp/cloudfunctions/accountSync/lib/cloud-store.js`、构建生成的 `index.js` 和 `miniapp/tests/account-sync-cloud-store.test.ts`；入口仍为 `index.main`，依赖版本不变。
- 固定诊断 revision：`account-sync-store-diagnostics-20260908-v1`。每次事务用独立闭包记录 attempt；区分事务启动、回调、进度 update、提交，记录有限数值 updated 和 UUID 格式 SDK requestId。
- 错误只保留受限 name/code/errCode，不记录 message、stack、业务载荷、数据库文档、用户/会话/订单标识或密钥。生产 logger 为同步 `node:console`；日志和元数据访问异常不改变原结果。
- 不增加数据库调用或重试，不改变更新内容、修订检查、原错误对象、回滚行为和返回值解包。补丁提供取证能力，本身不解决底层失败。

implementer 完成后，独立 tester 首轮全量验证发现 10 项 Lint 错误并停止；未把失败结果标为通过。修正为显式 catch 返回及严格类型的测试收集器后重建 bundle。独立 reviewer 复核实际 SDK 提交顺序、并发隔离、隐私和修正前后语义，未发现可操作问题。

独立 tester 第二轮 `npm run verify` 的 typecheck、lint、format、包预算和 bundle check 均通过；默认并行测试仍失败：68 文件中 13 文件失败，618 项中 15 项超时，另有 2 项超时清理相关的 `getCurrentPages` 未定义异常。原日志 `accountSync-local-verify-v2.log` 保留。没有修改测试或放宽 5 秒超时，改以 `npm test -- --maxWorkers=2` 复核，**68 文件、618 项全部通过**，耗时 36.01 秒，见 `accountSync-test-workers2.log`。这一对照支持默认并行环境争用的判断，但默认 `npm run verify` 本身没有被记为成功。主包实际 1,572,840 / 1,572,864 字节，余 24；auxiliary 105,621 字节。

两份最终 ZIP 的独立 SHA、manifest、CRC、路径、模式及逐文件比对均通过；v2 5,824 个条目完全匹配当时 accountSync 目录，恢复包完全匹配旧线上备份。相对旧线上备份，除 `index.js`、`lib/cloud-store.js` 外仅有 npm launcher/元数据差异（`.bin/semver`、`.package-lock.json`、新增 `semver.cmd`/`semver.ps1`），没有业务模块或依赖版本变更。主智能体已复核验证结果，详见 `accountSync-package-verification-v2.json`。这些是打包时验证；之后实际线上部署和只读验收已完成，见本文件顶部，写入恢复仍未验收。

## 已批准并部署的精确包（保留原打包记录）

目录：`tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/`。

| 用途 | 文件 | SHA-256 |
| --- | --- | --- |
| 当前诊断候选包 | `accountSync-diagnostics-v2-standard.zip` | `c1eb1788fa49b1e3d02b6255da9e33b6912828904cd8549612ad0761614df8bf` |
| 原线上备份恢复包 | `accountSync-rollback-standard.zip` | `57d2e49315979d63823d814942896df18673c316bc919110fb8424b8e2bdbbb2` |

当前候选包 5,824 个文件、6,993,887 字节，入口 SHA `032fd01720aacdfe795b7af92bd56ffccc442cb3157e7020c4e4473d44ceded8`。恢复包 5,822 个文件、6,990,751 字节，原线上入口 SHA `52c5946bb5ef2ed8096b6515dce60f13060f72215ba26141fe84a8e63444b541`。两包使用 POSIX 相对路径、Unix 普通文件模式 100644，构建脚本检查 CRC、逐文件内容和必要 SDK 入口。

初次 `accountSync-diagnostics-standard.zip` 已因 Lint 修正而过时，保留用于追溯，**禁止部署**。不要以该文件替代 v2 包；对应失败日志为 `accountSync-local-verify.log`。

原审批边界已经由用户本轮“确认”满足，部署与只读验收结果见上文，不再请求同一部署授权。保留配置和原依赖、不经 Windows CLI 重打包的限制继续有效。不能把 bootstrap 成功当作失败写入已恢复。涉及队列重放的下一步必须明确动作范围和成功后的本地确认方式，不能脱离 outbox 确认机制手工重放写请求。

## 数据保护和其他限制

### 客户端冲突保护与重放范围

只读 scout/reviewer 确认旧客户端在 `REVISION_CONFLICT` 后会 bootstrap、清空全部 outbox 并覆盖账号缓存。该路径会丢失本轮尚未同步的学习记录，因此在真实重放前先修复。固定 implementer 已增加 schemaVersion=1 的可选 `blocked`：冲突时保留所有命令和缓存，将 sending 复位为 pending 并一次持久化暂停状态；bootstrap/process/retry 和重启后的后台入口不再发送或拉取覆盖。暂停期间只追加新命令，不合并、不改原载荷和修订；显式清除操作才会清除该标记。当前没有自动合并或冲突解决界面，不能把暂停当作同步恢复成功。

独立 reviewer 提出的公共出队方法防护已补齐：`SyncOutbox.takeNext()` 在 blocked 时直接返回 null，不改变任何命令。对应持久化、直接出队和重启测试已扩展；reviewer 定点复核该 P2 已闭环，未发现新增问题。

独立 tester 第一轮全局 TypeScript、Lint/Stylelint、格式、包预算和 accountSync bundle 检查全部通过，22项聚焦测试通过；`--maxWorkers=2` 全量619项中唯一题库完整性测试5秒超时，无断言失败，失败证据保留在 `account-conflict-guard-verify.log`。最后出队补强后，相关文件Lint/格式与全量TypeScript再次通过；`npm test -- --maxWorkers=1` **68文件、619项全部通过**，57.63秒，总退出码0。没有修改超时或测试配置；单worker通过支持并发资源争用的判断，不抹去前一轮失败，也不宣称默认并行 `npm run verify` 已通过。最终主包 **1,572,640 / 1,572,864字节，余224**，auxiliary105,621字节。主智能体已核对最终日志 `account-conflict-guard-final-verify.log`。

该客户端改动仍只在本地经过测试；项目窗口保持关闭，没有在真实模拟器运行或上传小程序版本。数据保护不能证明 `saveActiveSession` 的服务端写入故障已修复，冲突暂停也不是成功同步。

正常启动不是只读动作。现有4条队列会按正常确认流程顺次尝试：两条 `saveActiveSession` 更新 `user_progress`，随后 `recordPractice` 写入确定性练习记录并更新进度，最后 `updatePreferences` 更新 `user_accounts`。无并发变化且全部成功时，预期 progress revision 为0→1→2→3，profile revision 为19→20。普通失败每次最多3次尝试；onShow/网络恢复可能启动后续重试。必须由既有 outbox 成功确认、remove、rebase 和保存快照流程处理，禁止手工云调用后直接改本地队列。

启动成功后的 `AuthService.reconcileAvatarsInBackground()` 还可能删除 `grain-practice:pending-avatar-files` 中未绑定、且不被 outbox 保留的云头像对象。旧时点的pending头像为0不能当作当前事实。当前项目已关闭，不能为了只读核对头像先打开项目而意外发送队列；后续若确认正常启动，应把这个潜在清理副作用明确列入授权边界。启动不会主动开始随机练习或发起支付；验证期间仍不能主动操作这些入口。

本轮只读复核仍为 profileRevision 19 / progressRevision 0；4 条命令仍是 pending：saveActiveSession(0)、saveActiveSession(1)、recordPractice(2)、updatePreferences(19)，clearPending=false。见 `account-queue-preserved.json`。没有刷新/重编译模拟器、清队列、重置学习记录或额度、修改云数据或执行真实付款。

当前 npm registry 核对显示 wx-server-sdk 的稳定 latest 仍是 4.0.2；beta 4.0.3-beta.1 所用 node-sdk 仍精确依赖 axios 0.27.2 和 database 1.4.3，没有可直接消除当前告警的官方稳定兼容升级。依赖风险继续保留，未 force fix、降级或应用未经验证的 overrides。
