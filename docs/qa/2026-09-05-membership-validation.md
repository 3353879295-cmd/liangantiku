# 2026-09-05 会员功能验证记录

2026-09-06 后续已完成个人虚拟支付本地适配及 64 文件 / 483 项门禁，尚未部署；见[后续验证记录](2026-09-06-membership-virtual-payment.md)。下文保留 2026-09-05 云端与历史证据，不代表虚拟支付已完成真实联调。

开发目录：`.worktrees/warehouse-question-classification/miniapp`。最初阶段仅本地验证；用户后续授权独立 staging 部署和联调，并自行购买云套餐。真实会员支付始终未执行。以下先列当前云端进度，早期记录保留作为历史。

最新结论：标准部署包与定时器 SDK 身份残留兼容问题均已修复，正式包于 21:29:54 部署。21:40:04 真实平台调度返回 `{"ok":true,"data":{"processed":0}}`，没有临时诊断字段；客户端伪造 Timer 和无效 HTTP 回调均拒绝。五集合客户端读写全部拒绝，免费额度最终为三次且重复恢复不扣次。完整门禁 60 文件、454 项通过。支付配置、真实交易/查单补偿、HTTP 网关及真机视觉验收仍未完成，依赖审计仍有 6 项告警。

## 接续核对：支付适用性与依赖（2026-09-05）

- 商户号开通、AppID 绑定状态已询问，尚待答复；另待确认小程序主体类型、公众平台“虚拟支付”状态及目标终端。未索取密钥，也未代为开通或签约。
- 搜索工具读取微信虚拟支付文档失败，浏览器打开超时；随后以 HTTPS 直接请求成功读取[企业/个体户官方指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)及[个人主体官方指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)。官方要求虚拟商品（含解锁功能、付费功能）在所有终端接入虚拟支付。结合当前商品定义，普通 JSAPI 方案不满足本会员商品上线要求；已在执行清单置顶记录，暂停旧收款路径的真实配置。未将第三方转述作为最终规则依据。
- 静态核对确认目前使用 `wx.requestPayment`、API v3 JSAPI 下单/查单和 `Wechatpay-*` 回调。虚拟支付的客户端接口、查单、发货通知与签名体系不同，需要单独明确适配范围；此次未修改代码或将其记为已实现。
- scout 只读运行 `npm audit --omit=dev --json`，仍为 6 项（1 中、5 高）。锁定路径为 `wx-server-sdk@4.0.2 → @cloudbase/node-sdk@3.17.2`，其下为 `axios@0.27.2` 和 `@cloudbase/database@1.4.3 → lodash.set@4.3.2 / lodash.unset@4.5.2`；另外三个 SDK/database 包为传递聚合告警，不代表六个独立可利用入口。
- npm registry 复查稳定版仍为 `wx-server-sdk@4.0.2`；`4.0.3-beta.1 → @cloudbase/node-sdk@3.18.5` 仍带 `axios@0.27.2` 与 `@cloudbase/database@1.4.3`，故没有采用该测试版。自动修复建议涉及降至 `wx-server-sdk@2.5.3`，未执行。任何 overrides/替代 SDK 方案都须在隔离实验中检查完整依赖树、公告安全范围及 Node.js 20 下事务、身份、定时来源兼容性，再做部署验证；此次锁文件保持不变，审计仍未通过。
- 会员当前使用数据库文档、事务和查询，没有调用 realtime/watch；支付请求使用 Node HTTPS。此调用面限制不等于漏洞修复或风险接受。本轮未改 accountSync、全局环境、题库、学习记录、测试额度/授权，未创建云权限或公网路由，未下单或扣款。
- 本轮为文档与只读核对，没有代码实现，未机械重跑已通过的完整门禁。开发者工具页面截图、真机验收、实际公网报文透传和真实查单补偿仍未完成。

## 独立测试环境部署（用户购买后）

- 环境 `membership-staging-d7c032b6e3273`，上海，个人版，文档型数据库实例 `tnt-n02cdyc56`。套餐到期 2026-10-05 23:59:59；创建表单未启用自动续费或超限按量。
- 五集合已创建，逐集合进入权限设置读回 `无权限[ADMINONLY]` 为 checked：member_entitlements、member_usage、member_practice_grants、member_orders、member_payment_transactions。客户端实际拒绝测试另行记录，不能以控制台选项替代端上验证。
- member_orders 索引已保存并读回：`status_next_check_at`（status ASC, next_check_at ASC）和 `account_status_next_check_at`（account_key ASC, status ASC, next_check_at ASC），均非唯一、非稀疏。
- 当前为普通云函数 Node.js 20.19 / 60 秒 / 256 MB；标准 ZIP 于 2026-09-05 19:45:41 部署后实际调用成功。初次 CLI 自动创建的 Node.js 16.13 / 3 秒配置已替换，CLI 上传存在下述路径缺陷，不再使用。
- 已读回 `MEMBERSHIP_PAYMENT_ENABLED=false`，无商户参数；函数入口 index.main。触发器 `membership-reconcile-pending`、`0 */10 * * * * *` 已保存并读回，实际平台调度验收待记录。未手动配置 TRIGGER_SRC。
- 保留原全局云环境和账号同步配置；未发布前端、未执行真实微信下单或扣款、尚未创建公网回调路由。
- 最终使用控制台「上传代码 → 点击选择 → 选择压缩包」上传标准 ZIP；此前超时发生在下拉菜单阶段，不能在「点击选择」之前等待文件选择器。不得把在线编辑器仍显示的模板草稿另行部署。
- 用户已同意日志服务条款及计费，日志表已可查询。20:50:01 曾出现真实平台来源但业务 INVALID_REQUEST，定位与修复过程见下节。最终 21:40:04 调度通过；本次从系统日志的业务 ret_msg 验收，没有仅凭状态码 200 判断成功。未手动设置 TRIGGER_SRC。支付关闭时 processed=0 不能证明完整查单补偿成功。
- 开发者工具自动化已连接；工具仅安装于系统临时目录。使用 `wx.cloud.database({ env: 'membership-staging-d7c032b6e3273' })` 逐一读、写五集合，均返回客户端拒绝码 `-502003`，写入探针没有意外成功。
- 标准 ZIP 部署后，显式 staging 的 getStatus 返回 ok；randomPractice 预检 allowed=true、freeUsed=0、freeRemaining=3、paymentAvailable=false；createOrder 返回 PAYMENT_NOT_CONFIGURED，伪造 Timer 返回 INVALID_REQUEST，伪造 HTTP 返回 401。
- 额度批量测试的自动化响应超时后，按原有四个 session 逐项核对，未新建另一批请求：最终 3 个授权成功、1 个无授权且重试返回 DAILY_LIMIT_REACHED，freeUsed=3、freeRemaining=0。三个已授权会话重复启动和恢复均成功且不增加额度；篡改题序启动均 IDEMPOTENCY_CONFLICT、恢复均 INVALID_GRANT。满额预检 allowed=false，新会话被拒绝。保留测试额度和授权，没有清理或重置。批量首轮具体返回与事务冲突次数因超时不可恢复，不声称四个原始响应全部收齐。
- 空题序和 requestId/sessionId 不一致实测均 INVALID_REQUEST；基线 0、最终 3 与有效授权数一致。非敏感证据存于系统临时目录 membership-staging-quota-1788611779735.json 及对应 progress/followup/integrity 文件。

## 云端启动故障定位与打包修复

- 首次 CLI 包实际执行失败，错误为 `-504002 / 0 code exit unexpected`；控制台返回 errorCode=1、statusCode=443。日志仅有 Report，没有业务堆栈。
- 下载实际部署包至系统临时目录，tester 比较 index.js、package-lock.json 和 lib 下四个 JS 的 SHA-256，6 文件全部与 worktree 一致。使用临时安装的 Node v20.20.2 加载下载包，隔离商户变量并调用无可信身份的 main，正常返回 `UNAUTHENTICATED`，进程未异常退出。本地 Node 20 次版本并非云端 20.19，此结果不能替代云端执行验收，也未据此改 SDK 或入口。
- 临时最小入口实际运行成功，确认云端 Node.js 20.19.3；加载 SDK 则报 MODULE_NOT_FOUND。云端目录诊断发现 /var/user 有 5826 个顶层项，但没有 lib、node_modules 目录，条目实际为含反斜杠的文件名。由此确认 Windows CLI 归档路径是故障根因。临时诊断入口已由完整业务 ZIP 替换，没有保留诊断接口。
- 新增 `miniapp/scripts/package-membership-cloud-function.py`，仅收录业务入口、lib、包描述及锁定 node_modules，使用 POSIX 路径。归档 5822 项逐字节与源文件一致，无反斜杠、绝对路径或上级路径；缺失 SDK、敏感 PEM、输出位于源目录等负例均拒绝。采用同目录临时文件校验后原子替换，失败注入验证旧输出保留且无临时残留。
- 只读增量复审确认可信定时入口四项条件未变，日志只有处理数量，不暴露身份、订单或密钥；异常和幂等行为未变。
- 最新日志增量使用 node:console 显式导入，后端/入口/支付 3 文件 23 项回归、入口 ESLint 和 Prettier 均通过。最终归档 membership-staging-final.zip 为 5822 文件、6,985,934 字节，SHA-256 `7536116259565c0867aeec3611e950ac3fef24bf387ca4f2625ccca24c63b9fa`。
- 最终归档于 2026-09-05 20:47:09 在控制台普通部署成功；读回 Node.js 20.19、60 秒、256 MB、index.main、唯一环境变量 MEMBERSHIP_PAYMENT_ENABLED=false，以及原十分钟触发器均保留。
- 部署后的显式 staging getStatus 成功，freeUsed=3、freeRemaining=0、freeDate=2026-09-05、paymentAvailable=false。截图仍未取得：后续正确 MiniProgram.screenshot API 尝试时，自动化端点 ws://127.0.0.1:9420 已不可连接；没有导航或更改全局云环境。
- 定时器追加诊断版于 20:59:23 部署，入口回归 23 项、Lint、格式及只读复审通过；归档 SHA-256 `ef046f0cc86e4807cff2dddf21c73a7abf1bad7392e23265dfb24b63da2f7f33`。21:00:02 真实调度返回 ok / processed=0，但先前失败仍需查清，不能仅凭一次冷启动通过记为稳定。
- 21:09:01 临时布尔诊断包用于定位运行时条件（不改变业务鉴权、不记录身份或密钥，完成后恢复标准包）。21:10:01 真实调度诊断 capturedTimer、liveTimer、sameEnvObject、timerType、triggerMatches、hasCaller 全为 true，唯一不满足的守卫是“无 OPENID”。这排除了环境对象捕获不一致的假设。SDK 源码每次读取环境，无自身缓存；平台调用身份残留是当前主要疑点。
- 21:16:06 客户端伪造 Timer 返回 INVALID_REQUEST、capturedTimer/liveTimer 均 false、hasCaller=true。此请求与 21:10 timer 使用不同容器，尚不足以证明同一暖容器的来源隔离，暂不移除 OPENID 守卫。
- 后续取得同容器证据：21:20:04 真实 timer（649676c3-63f9-45d2-9014-776a1810d322）来源 TRIGGER_TIMER、liveTimer=true，返回 processed=0；21:20:55 客户端伪造（69c51d76-69ee-43c2-889b-f9d738d52abc）来源 TCB_API、liveTimer=false、hasCaller=true、INVALID_REQUEST。两条日志 container_id 同为 c437aea27ea948cab7f855d492b1eedc，证实来源标记随调用切换。另两次顺序伪造也拒绝。基于此证据，采用最小兼容修复：保留可信运行时、类型及固定名称三项，移除不可靠的“无 SDK OPENID”附加条件；不修改或清理 process.env。
- 最终兼容修复通过 3 文件 24 项后端回归、入口和测试文件 ESLint/Prettier、只读增量复审；标准包 SHA-256 `235a6270b830f83918a1a2b186d6280f723cad015f54d5818bc3dc2bbb5350f3`，业务 index/lib 不含临时 diagnostic / sameEnvObject 返回字段。21:29:54 已在 staging 普通部署；Node.js 20.19、60 秒、256 MB、支付 false、十分钟触发器读回不变。
- 21:31:21 部署后调用：getStatus 成功、freeUsed=3、支付 false；客户端伪造 Timer 为 INVALID_REQUEST，无效签名 HTTP 为 401，三者均无 diagnostic 字段。21:30 的平台调度仍返回临时诊断字段，说明它执行了切换前版本，不能作为修复版调度通过的证据；需核对下一轮调度。
- 最终兼容修复后 tester 再次执行 npm run verify，退出码 0；60 个文件 454 项测试通过，TypeScript、ESLint、Stylelint、Prettier、包体预算、accountSync 产物全部通过。本轮未重跑或修改题库/Python内容。
- 21:40:04 正式修复版真实调度（48d2dfbd-169b-4632-aa31-9e70cbc09777）来源 TRIGGER_TIMER，ret_msg 为 `{"ok":true,"data":{"processed":0}}`，无临时诊断字段，可信定时入口验收通过。支付始终关闭，因此真实订单查单与结算补偿仍未验收。
- 官方事件函数使用 index.main / exports.main，不需要 Web 函数的 scf_bootstrap。本次未添加启动脚本、降级 SDK 或更改业务架构。日志费用依据：[云开发计费说明](https://cloud.tencent.com/document/product/876/127357)。

## 接手后本地验证及早期准备（历史，云端状态以上节为准）

- 用户确认测试环境部署后，已按锁文件离线安装 membership 的 102 个依赖包；tester 对 5 个后端 JS 文件语法检查通过，隔离空支付环境下实际 SDK 和入口加载成功（main 为 function、paymentAvailable=false），后端三文件 23 项测试通过。未部署或调用云函数。本机 Node 24，目标云端 Node 20 仍待实测。
- 创建测试环境目前受控制台登录阻挡：已打开并保留腾讯云登录页，尚未确认免费名额，未创建环境或变更权限。用户先前对独立测试环境的创建、部署及集合配置授权继续有效；购买套餐与真实付款尚未授权。
- 后续用户已完成登录：网页新建入口未显示免费选项，已准备上海/云数据库/个人版/1 个月的 `membership-staging` 表单，报价 19.90 元，关闭自动续费和超限按量，停在购买按钮之前等待套餐费用确认。尚未创建环境、部署或扣款。

- 已修复付款通知乱序导致权益多延长的问题：同样的 1 月/6 月两笔付款，原倒序结果为次年 6 月，现正逆序均为次年 1 月。
- 服务端权益文档增加 `renewal_base`、`renewal_payments`，同事务按付款时间稳定重放，未修改学习 schemaVersion、客户端接口、题库或包体预算。
- tester 执行 `npm run verify`，退出码 0；60 个测试文件、453 项通过（原 448 项）。类型、Lint、格式、包体和 accountSync 产物校验均通过。
- 新增回归覆盖：两单正逆序、月底三单全部 6 种排列、已有权益基准与断档、真实签名通知乱序、交易锁写失败时权益历史/订单共同回滚后重试。
- reviewer 已完成本轮最终增量复审：此前乱序到账缺陷已解决，未发现新的可操作缺陷；另行运行后端/入口/支付定向测试 23 项通过。真实云端事务与运行时条件仍待联调。
- 通过开发者工具 CLI 只读查询，当前项目可见环境仅 `cloud1-d2gglad830c91db10`，函数列表为 `accountSync`、`questionBank`，未部署 `membership`。没有读取密钥、修改云权限或写入云数据。
- Windows 截图重新选窗重试后仍为 `SetIsBorderRequired failed: 不支持此接口 (0x80004002)`；可访问性树无页面内容。视觉冒烟、真机支付与独立环境联调仍未完成。
- npm 审计最初因 DNS 失败未返回报告，scout 后续联网复查成功：仍为 6 项（1 中、5 高），未消除，不记为通过。`axios@0.28.1` 仍在部分公告受影响范围内，不作为修复版本；保留现有锁文件，不采用自动建议的 SDK 大版本降级。执行与配置准备见 [上线前执行清单](2026-09-05-membership-release-plan.md)。

## 上一轮已通过（历史基线）

- `npm run verify` 完整通过。
- Vitest：60个文件、448个测试全部通过。
- TypeScript、ESLint、Stylelint、Prettier 全部通过。
- 原主包1.5 MiB预算和分包预算通过，没有上调门槛。
- `check:account-sync`：现有账号同步生成产物一致。
- gzip目录解码与完整源目录对象深度相等。
- 后端18项定向测试含真实RSA签名/AES解密通知、报文篡改/金额不符拒绝、重复回调、两笔订单并发续费、付款时间+08:00归一化、订单先落库后的超时恢复、只对当前查单订单开通、关闭状态不授权、批次公平与单单失败隔离。
- 前端测试覆盖空题不扣次、连点、网络响应丢失后重试同授权、登录scope变化、恢复与报告回看、报告页重试导航失败不重扣、待确认订单显示与手动检查、旧订单缓存失效及失败购买后重试。

## 上一轮未完成的实测及告警（历史，当前状态见文首）

- 微信开发者工具已尝试连接；Windows截图接口返回 `SetIsBorderRequired failed: 不支持此接口 (0x80004002)`，无可用页面截图；可访问性树未提供小程序页面内容。没有声称完成开发者工具视觉冒烟或真机验收。
- 真实商户配置、微信支付、云数据库事务、HTTP回调与定时调度仍需部署测试环境联调。
- 微信SDK依赖审计报告6项传递依赖告警（1中、5高）；未将依赖审计标记为通过。详情与上线顺序见 `../membership-backend.md`。
- 前后端已委派实现、测试和只读审查。审查发现的问题由主智能体完成修复；后续只读复查调用因角色服务容量不足未返回最终delta审查意见，主智能体结合回归测试核对了修复。

## 题库工具侧验证

- 在独立 `.venv` 安装项目声明的 test 依赖与现有导入测试所需 python-docx 后，Python pytest：257 passed，1 skipped；2.16秒。
- 题库 validate 添加当前CLI要求的 `--catalog data/knowledge_catalog.json` 后退出码0；存在既有 distribution_drift / near_duplicate 警告，未据此修改题目。
- 题库 dedupe 扫描退出码0；完整输出保存在工作区 tmp/membership-dedupe.txt，未对近似题执行合并或删除。
