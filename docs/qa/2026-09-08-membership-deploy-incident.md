# 2026-09-08 会员部署后故障与回滚记录

本记录接续前两份修复/部署验证报告。**2026-09-08 11:12 更新：membership 已经通过控制台标准 ZIP 恢复，并完成已授权新版部署及真实只读验收。其他上线阻断尚未全部解决。**

## 2026-09-09 最新部署与查单边界

20:17:05 已通过控制台直接普通部署 `membership-platform-error-standard.zip`（SHA-256 `a4ee8185b4c251d1db74aa9392f3deca8a252cff6934e0b5d0276e78ae6677db`）。它是当前已部署版本，也是待部署 v2 的直接回滚包。不得用 CLI、文件夹上传、解压后重打包或“安装依赖”。

部署后只对第二条旧待支付订单正常执行一次 `getOrder`：RequestID `4b33a6ba-1130-424d-8b1e-f4bf924084ce`、2762ms、业务 `MEMBERSHIP_UNAVAILABLE`。没有新建/关闭/修改订单或付款；Active、HTTP 200、terminated、日志新增均不能替代订单恢复成功。腾讯云旧/新标签的 AX、DOM、CDP 都超时，尚未得到准确平台 errcode。

本地已准备唯一下一部署包 `tmp/final-release-20260908/membership-platform-error-response-v2-standard.zip`：SHA-256 `235d5cfb4a041205e9d077dd974c3e8a5434dd3f02d9a92e14d8f500682a1501`，6,996,402 bytes、5,824 files、100644，CRC/路径/源码一致；相对当前回滚包仅 `diagnostics.js`、`handler.js`。它仅在 `ORDER_PLATFORM_ERROR` 和有界安全整数 `platformCode` 同时满足时公开白名单 diagnostic，原错误仍为 `MEMBERSHIP_UNAVAILABLE`，其他错误形状不变。非 v2 草稿 `membership-platform-error-response-standard.zip`（SHA-256 `4d68ebf275f054e8590a440d616e49145f44510060ae0ec3f6717ed651f4f40d`）权限元数据不符合本轮标准，未部署、禁止上传。

v2 尚未部署，故不能继续真实查单或支付。控制台恢复后的唯一动作是“函数代码 → 直接选 v2 标准 ZIP → 普通保存（不安装依赖）”，随后用相同第二旧单参数正常查询一次；成功标准仅为拿到 `diagnostic.platformCode` 或合法订单终态。异常立即回滚 `a4ee...` 包。完整上传判断见 [上传说明](2026-09-08-upload-guide.md)。

## 控制台恢复与新版真实验收（已完成）

用户重新扫码登录后，在已确认的 `membership-staging-d7c032b6e3273 / membership` 操作。旧控制台的实际入口为“函数代码 → 提交方法：本地上传ZIP包 → Choose File → 保存”。“保存”是该界面的普通部署动作；两次均未点击“保存并安装依赖”，没有解压后上传文件夹，也没有调用任何 CLI 部署命令。

1. 首先直接选择交接文件指定的 `membership-rollback-standard.zip`。保存后控制台代码树显示真实 `lib`、`node_modules` 文件夹及根 `index.js`。11:08:29 真实 `getStatus` 返回 `ok=true`，耗时 844ms，RequestID `1239817b-df58-481c-8636-38ff0f1be2cf`；11:08:43 原 session 的 `validateRandomPractice` 返回 `ok=true`，602ms，RequestID `42d40fb2-95c7-479f-8568-e3a7cc71eabe`。
2. 旧版本验收通过后，直接选择已授权的 `membership-local-validated.zip`，普通保存。新版平台函数列表读回上次修改时间为 **2026-09-08 11:11:59**、状态正常、Node.js 20.19。
3. 11:12:42 新版真实 `getStatus` 返回 `ok=true`，882ms，RequestID `0a3e0017-47a2-4f1a-b228-9a3cc898dbc2`；11:12:58 原 session 验证成功，525ms，RequestID `2d0f0386-9bb5-4392-8ac5-e074524b3fb2`。两版四次返回均为 `paymentAvailable=true`、非会员、`freeUsed=2/freeRemaining=1/freeLimit=3/freeDate=2026-09-08`，没有扣次或修改授权。
4. 已在新版云日志逐请求核对成功返回。新版原授权验证的真实日志含 `revision: membership-random-diagnostics-20260908-v1`、`action: validateRandomPractice`、started/completed、`durationMs: 109`，平台执行耗时 111ms、status_code 200、ret_code 0、来源 TCB_API。证明诊断代码已经运行，不只是上传成功。
5. 新版部署后的自然定时调用也取得实际业务成功证据：11:30:06.237 开始，RequestID `63aacdd2-310b-4b66-9f14-371e660d2bd2`，来源 `TRIGGER_TIMER`，日志 `membership.reconcile.complete { processed: 2 }`，11:30:07.264 返回 `{"ok":true,"data":{"processed":2}}`，平台执行 1,020ms、status_code 200、ret_code 0、retry_num 0。这是读取原有触发器自然执行结果，没有手动触发查单协调；不能据 `processed: 2` 推断两条订单已经支付或关闭。

部署前在控制台实际读回 Nodejs20.19、index.main、256MB、60秒、在线安装依赖“否”、公网访问已启用、原 `membership-reconcile-pending` 十分钟触发器、HTTP 路径 `/membership/virtual-pay/notify`；没有修改配置、密钥、触发器、权限、路由或灰度流量。说明字段“真实支付关闭”是遗留描述，与实际支付配置可用状态不符，本次未为修正说明而额外编辑函数配置。

独立 tester 完成两个 ZIP 的 CRC、安全路径和逐文件核对；主智能体复核结果一致。独立 reviewer 确认新版 ZIP 的 Windows 来源权限元数据没有具体的启动或安全阻断证据，不为此替换已经授权的精确 ZIP。新版权限元数据为 5,823 项 `100666`、1 项 Windows npm shim `100777`；平台具体权限保留策略未验证，该观察不能与反斜杠目录故障混为一谈。

此次用逐字节一致的旧业务内容、正确归档路径恢复了真实服务，结合历史 Windows 归档缺陷与控制台目录树，支持该故障复发的判断。本轮没有直接读取失败容器 `/var/user`，所以没有将本次失败容器的路径布局写成直接观测事实。

证据：[恢复版状态](../../tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/rollback-live-status.json)、[恢复版授权](../../tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/rollback-live-validate.json)、[新版状态](../../tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/validated-live-status.json)、[新版授权](../../tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/validated-live-validate.json)、[独立验包](../../tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/package-verification.json)。

### 账号同步取得的新增云端证据（尚未修复）

`cloud1-d2gglad830c91db10` 的日志自定义历史查询及“最近24小时”触发套餐升级提示，未升级或付款。转而只读检查已保留的最近一小时调用：RequestID `c1bc9d0f-4f9c-44cb-85f0-0ffd5063a3a0`，北京时间 10:47:13.518，明确记录 `[accountSync] request { action: 'saveActiveSession' }`；213ms 后实际 RetMsg 为 `{"ok":false,"error":{"code":"ACCOUNT_SYNC_UNAVAILABLE"}}`，平台 status_code 200、ret_code 0。没有底层错误或 unhandled 日志。

因此已证实云函数业务返回失败，不再将客户端响应解析边界与服务端失败等量列为未知。底层事务写入或提交原因仍缺证据，不能据统一错误码猜测。没有为了复现而重新编译、刷新模拟器、重放队列或调用该写 action。

### 历史随机异常窗口新增证据

membership 环境通过控制台“最近24小时”和“加载更多”正常读取到昨晚日志。23:54:45.947 的 `3d605f0f-224a-4a34-9b81-517e9cde45e5` 返回 `ok=true/allowed=true`，额度 2/1；23:54:47.227 的 `f93f42ea-a788-406d-9f11-29c8613bdccc` 在 380ms 后实际返回 `MEMBERSHIP_UNAVAILABLE`。两条平台状态都为 200。后者与历史首次授权异常时间窗吻合，但旧日志没有 action/session 或原始错误，不能把时间关联升级为同 session 的确定匹配，底层根因仍未证实。未新增随机授权或扣次请求。

## 控制台恢复接续（2026-09-08 10:49）

本节更新下文历史“回滚 pending”状态：交接文件已确认两次 CLI 部署任务均已成功结束，但服务仍未恢复；不再等待或重发这些任务。此次接手没有调用任何 CLI 部署命令。

- 完整阅读交接文件与历史 Windows ZIP 路径故障记录；恢复 ZIP 的 SHA-256 实测为 `54ba3814a74803789a1300a9edc95734bbfa60f25cc5c75f4ffca5d71e0b95b2`，新版 ZIP 为 `c2144452f827b3e2de835bc89352f2a78f147ed70b30fee9e551325ff3a6c5fb`，均与交接一致。
- `project_list` 再次确认打开的是 worktree 下的 miniapp；只读函数信息仍为 Active、Nodejs20.19、60 秒。这不等于业务运行成功，也不证明未返回的配置项已经核验。
- 10:49:00 发起一次真实只读 `getStatus`，仍返回 `-504002 / 0 code exit unexpected`，callId 为 `1788835740203-0.16544952796724222`。未在相同状态下循环重试。[实际失败返回](../../tmp/prelaunch-fix-2026-09-08/console-recovery-20260908/initial-status.json)
- 浏览器枚举可见 Edge 中的腾讯云控制台；接管页面 25 秒超时。内置浏览器创建控制台页同样 25 秒超时，后续枚举仅确认生成了腾讯云登录页，未取得可操作的控制台。没有上传代码、点击部署或获取云日志。
- 已请用户仅接手交接文件指定的标准恢复 ZIP 普通部署步骤；这是页面控制故障所需的操作协助，既有部署/恢复授权继续有效。尚未取得这次 ZIP 上传成功结果，恢复仍未完成。
- 恢复后继续执行真实 `getStatus`、原 session 的 `validateRandomPractice`，核对服务端日期、额度和支付配置可用状态；这两条处理路径只读，不调用 `startRandomPractice`。旧版恢复验收通过后，再直接上传已授权新版标准 ZIP 并重新验收。

本次接手尚无源码或依赖修改，没有重新编译/刷新模拟器、重放账号同步写请求、清理本地记录、调整额度或执行真实支付。原有全部未提交改动保留；613 项验证仍是上轮结果，没有作为本轮重跑结果报告。

## 已确认事实

1. 原部署任务 `confirmation_cloud_fn_deploy_c6a0c086-08aa-4903-8072-9247c26c5011` 已于北京时间 07:32:38 返回 `success / execution_success`，部署 5,824 个文件；不再处于待确认状态。
2. 函数仍显示 Active、Nodejs20.19、超时 60 秒。重新下载线上代码后，由独立 tester 与批准 ZIP 比较全部路径及 SHA-256，5,824 个文件完全一致，0 缺失、0 多余、0 内容差异。[文件比对证据](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/membership-zip-deploy-evidence.json)
3. 07:34:44 发起的真实只读 getStatus 失败，返回 `-504002 functions execute fail / 0 code exit unexpected`。07:35:45 仅做一次有界复核，再次得到相同错误，耗时 5,463ms。没有继续增加重试次数。[首次失败](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/after-status.json)、[复核失败](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/after-status-recheck.json)
4. 此前同账号 getStatus 成功、paymentAvailable=true、额度 2/1；因此当前只能标为“文件部署成功，运行验收失败”，不能写成会员后端修复已上线。

两个调用的 callId 分别为 `1788824084100-0.6875589387176225`、`1788824145382-0.04502487568121216`，供在对应环境 membership 云日志中定位。CLI 没有提供平台 stderr/云函数日志读取能力，具体退出原因尚未取得。

## 回滚处理

独立 reviewer 评为 P1，建议优先恢复部署前的可用版本。已从本次部署前只读下载的原始代码建立独立回滚目录 `tmp/prelaunch-fix-2026-09-08/authorized-deploy/rollback/membership`，5,821 个文件与原备份逐文件 SHA 一致，入口 SHA-256 为 `84643355f04746a6d960a9eb488d6809eedf55980ef7cc757eb60259454a62fb`。

回滚目标仍为 `membership-staging-d7c032b6e3273/membership`。仅恢复该函数代码和原打包依赖，不修改数据库或本地修复源码，不清订单、授权、额度、练习记录或待同步队列。恢复旧版本也会暂时退回原来的支付保护缺陷，因此即使服务恢复，仍不能视为已经具备上线条件。

已提交一次回滚请求，任务 ID：`confirmation_cloud_fn_deploy_6edf51b7-5e16-4141-b302-234b1df4748c`。当前返回 `pending / Waiting for user confirmation`，需在微信开发者工具确认此次回滚弹窗；尚未取得回滚成功结果。[回滚请求](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/rollback-result.json)

确认后先从原回滚 taskId 获取结果，再验证实际线上代码、函数状态和真实只读 getStatus。服务恢复之前不进行付款、创建订单、随机次数消费、查单协调、人工通知或定时任务测试。

## 根因与后续边界

静态语法检查及最小 SDK 桩加载没有找到确定的加载错误；新增入口初始化链包含 diagnostics 模块加载与注入，但仅凭变更位置不能断言它就是原因。需要先恢复服务，再按上述时间和 callId 查阅云端退出日志，区分代码初始化、依赖和运行环境。Mock 可加载不能代替真实云运行验证。

本地最终验证仍是 68 个文件、613 项测试通过，主包剩 24 字节。账号页 onRouteDone 修复已有三轮真实模拟器回归证据。长期待支付、账号同步写入失败、随机首次异常日志、依赖告警、真实付款闭环和真机覆盖仍未全部完成。当前不应提交体验版进行正式验收。
