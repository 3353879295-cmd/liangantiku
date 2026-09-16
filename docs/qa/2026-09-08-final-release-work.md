# 2026-09-08 上线收尾执行记录

> 续验更新：四项 UI 已安全合入；accountSync 已控制台部署，原记录及偏好恢复为修订 20/3、pending=0，独立云核对及重进通过。会员 HTTP 412 已修复并于 18:51:46 控制台部署，原订单真实查单三次成功，但平台仍返回未完成状态。用户新随机练习的真实授权也已成功。最终全量为 69 文件、639 项，详见 [真实写入恢复续验](2026-09-08-real-write-recovery.md) 与 [上传说明](2026-09-08-upload-guide.md)。下文保留先前停止电脑操作时的历史状态，不作为最新结论。

## 当前结论

**仍不能将当前版本作为已验收的上线版本上传。** 本轮已修复可离线复现的 accountSync 写入缺陷并生成标准 ZIP；真实云日志、部署及原四条 outbox 写入验收尚未完成。电脑操作工具报告实体 Esc 键停止后，未再执行任何电脑或模拟器操作。前端修复为避免触发已打开项目的热重载，保留在本 worktree 内的隔离候选，尚未应用到运行项目。

实际项目始终为 `.worktrees/warehouse-question-classification/miniapp`，未切换根目录副本。未提交、上传小程序、审核或发布；没有修改数据库权限、环境配置、会员额度、权益或支付数据。原有未提交修改保留。

## 本轮实际修复

### accountSync：完整进度快照的保存语义

固定 scout 使用实际安装的 `@cloudbase/database` 1.4.3 拦截请求序列化，确认旧 `doc.update` 会将会话对象展开成 `active_session.id` 等点路径，而初始进度定义为 `active_session: null`；空 `favorites`、`wrong_questions` 等对象不生成更新字段，旧键会残留。这是可离线确认的代码/SDK契约缺陷，与首次保存失败吻合；**尚未取得本轮真实写入的底层稳定错误码，不能把推断写成线上根因已证实。**

固定 implementer 仅修改当前 `miniapp` 的以下五个文件：

- `cloudfunctions/accountSync/lib/cloud-store.js`：`saveProgress` 使用 `doc.set` 保存完整快照，保持既有事务、修订校验、诊断和失败传播。
- `cloudfunctions/accountSync/lib/handler.js`：学习清除分支用原进度与空学习字段合并，保留原 update 同样保留的创建时间和其他元数据。本轮没有调用清除接口。
- `cloudfunctions/accountSync/index.js`：重新生成入口；日志标记为 `account-sync-store-progress-replacement-20260908-v1`。
- `tests/account-sync-cloud-store.test.ts`：保留失败传播等原验证，新增真实已安装 SDK 的无网络序列化回归，覆盖完整会话、null/对象切换、空映射和创建时间保留。
- `tests/account-sync-function.test.ts`：新增完整两步学习清除流程的集成回归，证明学习字段重置同时保留创建时间和既有元数据。此为离线测试，未调用真实用户清除接口。

新标准包相对已上线 v2 诊断 ZIP 仅 `index.js`、`lib/cloud-store.js`、`lib/handler.js` 三项内容不同，零新增/移除条目，依赖未变。未采用手工写接口后删队列、修改修订或伪造成功的做法。

### 前端隔离候选：删除确认与冲突提示

独立 reviewer 发现账号数据页的清除/注销，以及“我的”游客清除入口缺少项目要求的二次确认。主智能体在隔离候选中完成：三个入口均须两次确认；第一弹窗前加操作锁；取消、弹窗失败和服务失败不误报成功；重复点击不会重复发起操作。账号清除与注销的待同步记录提示按实际服务行为分别说明。

账号数据页和“我的”页的冲突提示由“已恢复云端记录”改为“同步已暂停”，继续保留 outbox 持久暂停，不新增移除暂停或自动重试入口。

候选位置为 `tmp/final-release-20260908/ui-candidate`，仅四个前端/测试文件与运行项目不同；补丁为 `ui-candidate.patch`，逐文件原始与候选 SHA 见 `ui-candidate-manifest.json`。**这些前端修复未应用到准确项目、未在模拟器或真机运行，不能声称已经上线。** 候选从未导入开发者工具；候选依赖和根级题库采用本地目录映射供测试使用，不是上传目录。

运维文档同时补充 09-08 的当前状态、共用环境边界，并停用账号同步旧 Windows CLI 回滚示例和云端安装依赖步骤。历史证据保留。

## 标准部署包与回滚

仅可部署以下最终包，不能使用同目录的 `untagged-draft`：

- 路径：`tmp/final-release-20260908/accountSync-progress-replacement-standard.zip`
- SHA-256：`1ec3a122f2bb6585df4fa0fb54e142f6838a471476f568363cc46f91a95f76c5`
- 5,824 文件，6,993,923 字节；POSIX 相对路径、Unix 普通文件模式 100644；构建脚本 CRC 和逐文件 SHA 检查通过。
- 独立 tester 再次核验 CRC、全部路径/模式、SHA 与当前源码 5,824/5,824 项内容完全一致，零内容差异；未发现私有备份、密钥或证据文件。独立 reviewer 亦核对包 SHA 并通过源码审查。
- 目标：`cloud1-d2gglad830c91db10 / accountSync`；保留 Nodejs20.19、index.main、256 MB、20 秒和其余原配置。
- 当前已部署 v2 可作为代码回滚包：`tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/accountSync-diagnostics-v2-standard.zip`，实测 SHA `c1eb1788fa49b1e3d02b6255da9e33b6912828904cd8549612ad0761614df8bf`。回滚代码不会撤销已成功同步的数据。

恢复电脑操作后，先查看 v2 的真实写入日志，记录 RequestID、诊断阶段、稳定错误码；如需再次尝试，只从客户端正常恢复入口发送原 outbox。再通过控制台直接选最终 ZIP，普通部署，保留配置。严禁 Windows CLI/cloud_fn_deploy、上传文件夹、解压后重打包或部署并安装依赖。

部署后仍须由原 outbox 正常确认逐条命令。成功标准：四条原记录全部确认，进度修订按实际命令结果核对（无并发且均产生变更时为 0→1→2→3），资料修订预期 19→20；定点核对唯一练习记录、学习统计、偏好、本地缓存及 pending=0，再重新进入验证。冲突时保留全部未确认数据及暂停状态，继续制定可审查的合并方案，不得直接 rebase 或清空。

## 数据保留与真实验收边界

本轮 `open_project_window` 返回复用正确项目窗口。随后官方 evaluate 只读观测：缓存修订 19/0；四条 pending 仍为 `saveActiveSession(0)`、`saveActiveSession(1)`、`recordPractice(2)`、`updatePreferences(19)`；未见 blocked 属性，pending 头像数 0。此为停止电脑操作前的最后观测，不是写入成功结果。过滤的 console/network 样本为空，不能推断没有请求发生。

没有输出私有备份内容、手工删队列、清缓存、修改修订或移除暂停。上传根仅为实际 `miniapp/miniprogram`，备份/日志/ZIP/候选均在外部 `tmp`，不得复制进入上传根或提交。

此前会员标准 ZIP 恢复、新版真实 getStatus、原 session 授权及自然定时器已通过且本轮未改 membership，沿用 09-08 部署事故记录的真实证据，不重复扣次或重测这些已通过项目。

## 验证结果

本轮修改前独立基线：TypeScript、ESLint/Stylelint、Prettier、包预算、bundle 全通过；单 worker 全量 68 文件、619 项通过。初次测试包装脚本的 npm 参数错误保留为 `local-verify-harness-failure.log`，不计为产品测试失败或通过。

最终产品代码的独立验证：TypeScript、ESLint/Stylelint、Prettier、包预算和 accountSync bundle 全部通过；`npm test -- --maxWorkers=1` 为 **68 文件、620 项通过**，56.21 秒。随后仅增加一条 handler 元数据回归，独立补验结果另列，不将未实际执行的“621 项全量”写成通过。日志为 `tmp/final-release-20260908/final-worktree-verify.log`。默认并行 npm run verify 未被声明为通过；没有放宽超时、预算或删除测试。

新增一条 handler 回归之后，独立 TypeScript、该文件 ESLint/Prettier 与 **24/24 项 handler 专项测试**再次通过，见 `final-account-sync-regression-verify.log`。24 项包括原有用例，不能加到 620 上当作新的全量数字。

前端隔离候选最终 TypeScript、四个变更文件 ESLint/Prettier、两个页面测试及预算检查均通过：**3 文件、30 项通过**。日志为 `tmp/final-release-20260908/final-ui-candidate-verify.log`。这些是候选的离线验证，不代表已经合入运行项目或通过真机。

将最终后端、全部 UI 修复与新增元数据回归组合到隔离候选后，独立 tester 又执行了一次 `npm test -- --maxWorkers=1`：**68 文件、630 项全部通过**，55.56 秒，退出码 0。日志为 `tmp/final-release-20260908/final-combined-candidate-test.log`。这是完整组合候选的最新全量结果；准确运行项目的四个 UI 文件仍未替换。

实际运行项目的主包为 **1,572,640 / 1,572,864 字节，余 224**，auxiliary 为 105,621 字节。包含所有 UI 修复的隔离候选主包为 **1,572,845 / 1,572,864 字节，余 19**，auxiliary 为 106,406 字节。阈值未变；合入或上传前有任何源码/依赖变化都须重新测量，不能把 224 字节作为最终候选余量。

固定 reviewer 已复核完整快照替换、事务/失败传播、元数据保留测试、三个清除/注销入口的双确认、冲突提示和部署文档，未发现未处理的 P1/P2 实现问题。云端、支付和真机阻断仍保留。

候选第一次 typecheck 因隔离目录缺少相对位置的题库 JSON 失败，随后补充本地目录映射供测试读取；原失败日志保留。游客入口双确认加入后包预算曾超出 10 字节，随后等价简化日期解析；未调高预算。最终以独立 tester 复验为准。

## 依赖风险

本轮重新执行生产依赖审计：前端 0；accountSync、membership 各 6 项（5 高、1 中，含传递聚合项）。Registry 实查 wx-server-sdk 稳定 latest 仍为 4.0.2，精确依赖 node-sdk 3.17.2；node-sdk 的 latest 返回 3.18.3，仍精确使用 axios 0.27.2 和 database 1.4.3；后者精确依赖 lodash.set 4.3.2 / lodash.unset 4.5.2。虽然 lodash.unset 的 latest 已有 4.18.0，当前父依赖精确版本不能自然更新到它，其他告警也不会随之消失。

未执行 force fix、降级、替换锁文件或未经验证的 overrides。支付直连使用 Node HTTPS，任意用户 URL 不进入该业务 HTTP 客户端；这只是调用面说明，不能证明 SDK 全部不可利用或宣称告警已解决。[Axios 安全公告](https://github.com/advisories/GHSA-jr5f-v2jv-69x6)、[lodash.set 公告](https://github.com/advisories/GHSA-p6mc-m468-83gw)、[lodash.unset 公告](https://github.com/advisories/GHSA-f23m-r3pf-42rh)。当前剩余依赖风险仍须兼容修复验证或上线负责人明确处置。

## 剩余必要动作与上传步骤

1. 恢复本任务的电脑操作；若登录失效，由维护者扫码。浏览器连接本轮多次超时，原生截图报 `SetIsBorderRequired / 0x80004002`；工具随后报告实体 Esc 停止，不再尝试界面动作。若恢复后控制台仍不可控，仅需要维护者协助准确标准 ZIP 的直接上传，已授权的部署不重复申请概念性许可。
2. 应用已审查的四文件 UI 候选前核对原始 SHA、先关闭准确项目避免热重载；合入后仍使用同一准确目录打开，按上方 outbox 机制完成真实写入、云端数据核对与重进验收。这一步不是新建任务，也不是让维护者手工修代码。
3. 真实待支付订单先走原恢复/权威查单；长期 NOTPAY 仍保留订单。只有平台确认关闭才释放对应指针并允许新号，不能伪造关闭、重复拉起旧号或保证立即重买。
4. 维护者提供真机操作：iOS/Android 各完成账号恢复/导航、随机练习、日夜模式、大字号与安全区；旧基础库还需实际对照。新的随机首次授权测试需明确专用账号和可消费的一次免费额度，现有原 session 验证不能替代首次授权。
5. 支付需要额外明确的限额授权和本人确认付款：先处理原待支付订单，再至多一笔 28 元首购和一笔 28 元续费（总上限 56 元），核对真实通知/查单/权益、取消后的权威终态与扣款后断网重进恢复。未获得该授权前不创建用于收费验收的新订单、不扣款。支付配置为可用不代表上述闭环通过。
6. 阻断闭环后，在微信开发者工具使用准确 `miniapp` 项目，核对 AppID `wx84ecacec08ca162c`、miniprogramRoot=`miniprogram/`、原云环境；执行构建 npm/编译并检查上传内容，填写版本说明后上传供体验验收。当前未执行上传，且未授权提交审核或正式发布。

建议候选版本说明：修复账号进度快照保存与空映射更新；保留冲突待同步数据并准确显示暂停；补齐学习数据清除与账号注销二次确认；保留既有支付订单恢复和随机授权保护。只有对应代码实际合入/部署并完成验收后，才能将这些描述用于上线版本。
