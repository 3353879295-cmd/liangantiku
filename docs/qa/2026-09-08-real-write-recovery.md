# 2026-09-08 真实写入恢复续验

> 2026-09-08 历史检查点：会员传输修复已于 18:51:46 通过控制台保存，原客户端真实查单三次业务成功；原订单仍为平台未完成状态，购买闭环仍受其终态限制。用户手机 18:34:50 新授权事务真实成功。19:26 另在准确源码复现授权中断后恢复入口被额度拦截，正在补充修复，因此 69/639 仅是该补充前的稳定结果。下文“尚未部署”“查单失败”“已用 2 次”均限定为其历史时点，当前结论以紧随其后的 2026-09-09 接续和上传说明为准。

> **2026-09-09 接续：** accountSync 的真实恢复结论继续有效：profile20/progress3、outbox0，学习数据、原偏好和答案均保留。手机已有 grant 且当天 usage=3，电脑旧 pending 不得用于耗用新额度。当前新增仅云函数和测试：完整单 worker 验证 70 文件、656 项以及类型、Lint、格式、包预算、accountSync bundle 均通过；随机恢复及客户端预览仍以 70/653 基线为准，2026-09-09 新二维码为 `tmp/final-release-20260908/final-client-v3-preview-qrcode.jpg`，压缩主包 1,425,610。

> membership 当前已部署回滚包为 20:17:05 控制台普通保存的 `membership-platform-error-standard.zip`（SHA-256 `a4ee8185b4c251d1db74aa9392f3deca8a252cff6934e0b5d0276e78ae6677db`）。其后第二旧单一次正常查询为 RequestID `4b33a6ba-1130-424d-8b1e-f4bf924084ce`、2762ms、`MEMBERSHIP_UNAVAILABLE`；没有订单写入或付款，平台 errcode 未取到。待部署 v2、回滚和下一步的精确约束见 [部署事故记录](2026-09-08-membership-deploy-incident.md)；此时不得继续真实查单或支付。

本记录接续 `2026-09-08-final-release-work.md`。准确项目仍为当前 worktree 的 `miniapp`。用户已确认恢复电脑操作，以及本人操作下最多一笔 ¥28 首购和一笔 ¥28 续费（合计不超过 ¥56）、专用测试账号一次免费随机练习。主智能体没有创建新订单、付款或开始新的随机练习；用户后来确认自己在手机端开始了一次练习，详见文末。

## 已完成及新证据

- 已按四文件 SHA 清单安全合入前端候选。独立 tester 在准确目录完成类型、Lint、格式、包预算、accountSync bundle 与单 worker 全量：68 文件、630 项通过（20.53 秒）。该时点主包 1,572,845 / 1,572,864 字节。后续新增保护须再验证，不能沿用此数字作为最后结果。
- 17:29:52 原客户端队列真实 `saveActiveSession` 请求 `d3601737-3136-4266-bca4-d6205e3b7c57`，v2 诊断明确 `progress_update.failed`、`errCode=-502001`；事务在 callback 阶段失败，业务返回 `ACCOUNT_SYNC_UNAVAILABLE`。四条记录仍 pending，修订 19/0，待处理头像 0。
- 已通过原控制台“本地上传ZIP包 → Choose File → 保存”直接选择 `accountSync-progress-replacement-standard.zip`，SHA-256 `1ec3a122f2bb6585df4fa0fb54e142f6838a471476f568363cc46f91a95f76c5`。没有 CLI 部署、解压重打包、上传文件夹或安装依赖动作。已保留 v2 标准 ZIP 回滚包。
- 显式账号入口 `onRetry` 经原同步机制确认：pending 4→0、progress 0→3、profile 仍 19，并自动返回“我的”。关闭准确项目并重新打开后，仍为 19/3、pending=0。
- 独立只读定点查询三集合各一份记录：原练习的确定性记录 ID、10 条答案全字段、学习汇总、云进度与最终本地缓存一致。提交会话归档后清空 active session 符合原业务语义，无重复练习记录。

## 偏好差异已通过正常流程纠正

原私有备份中，待同步 `updatePreferences` 与原本地 `progress.preferences` 四字段相等，但所选证书与最终 profile 不同。原云确认 profile 与最终 profile 相等。**因此不能把本次原偏好命令标为合法 no-op 或全部完整恢复。** 当前源码的启动、首页读取、账号重试没有自动修改该偏好的路径；尚缺实际请求链路证明它在哪一步改变。

已实现并通过独立 tester/reviewer 的确认保护：`updatePreferences` 返回 profile 四字段与发送命令不等时，在 remove/rebase/save 前持久暂停，保留命令和缓存；不解除暂停或伪造确认。该专项 20/20 通过，主包为 1,572,771 / 1,572,864 字节，余 93。

随后仅通过原首页 `onCertificateChange` 选择事件恢复备份中的所选证书，使用正常 outbox 确认。透明观察记录请求四项偏好与原命令全等、expectedRevision=19，RequestID `28c38cd8-b524-470b-a2c6-55077e70980b`；实际业务 `ok=true`，响应四项偏好全等，profile=20、progress=3、pending=0。观测函数已在 finally 恢复。已完成的三条学习命令没有重新发送。

恢复后独立定点云核对 **15 项全部通过**，`resumed-preservation-restored-evidence.json` 的 `consistent=true`：原偏好、完整答案、唯一练习记录、云进度、汇总和本地快照均一致。再次关闭准确项目并重新进入后仍为 20/3、pending=0，两份本地偏好均与原意图一致，见 `resumed-after-reopen-confirmed-evidence.json`。不能把此前差异的未知发生原因改写为已查明；当前数据保留结果已经核实。

## 会员查单的新阻断

当前真实 `getStatus` 请求 `768008cd-1da2-460d-b529-1785da1a4ac8` 成功，paymentAvailable=true、非会员、09-08 已用 2 次/剩余 1 次。原会员页 `onQueryPending` 的真实 `getOrder` 请求 `46993ea4-5cfc-415c-b2c0-f489a31fb76a` 返回 `MEMBERSHIP_UNAVAILABLE`。透明观察原 callFunction 后已在 finally 恢复，未改响应或增加重试。

原订单及待支付指针保留。当前平台订单状态为未知，不能沿用历史推断标为 NOTPAY，更不能删除或手工关闭。现有线上诊断只覆盖随机授权，本地已完成最小安全查单诊断并通过独立审查；必须继续根据真实结果修复，不以诊断部署完成代替查单验收。

待部署的最终标准包为 `tmp/final-release-20260908/membership-order-diagnostics-v2-standard.zip`，SHA-256 `0d50ed8a59b4a526e0c635725dc9170b53cbde60a647a43fba85fe6eb8c41bab`，6,995,924 字节、5,824 文件。相对当前线上回滚包仅 `lib/diagnostics.js`、`lib/handler.js`、`lib/virtual-payment.js` 不同；依赖、业务规则、环境和配置保持。原不带 v2 的草稿因 reviewer 发现抛错 getter 会改变失败响应，已标记不可部署并保留；v2 已增加安全属性读取和回归，独立 reviewer 复验无新增 P1/P2。此时尚未部署。

## 18:18 后续查单取证与本地验收

控制台恢复响应后，已在 `membership-staging-d7c032b6e3273 / membership` 直接选择上述 v2 标准 ZIP 并点击普通“保存”，页面返回在线编辑，新诊断已在真实云日志出现。原页面查询请求 `b15b0379-9b87-4f7e-8c15-18dcb1786962`（18:18:12）仍返回 `MEMBERSHIP_UNAVAILABLE`，新诊断明确 `stage=reconcile`、`errorCode=ORDER_HTTP_STATUS`、`httpStatus=412`。原订单仍保留、页面 unknown，未付款或新建订单。

本地默认 HTTPS 传输使用 `req.write(body); req.end()` 而未设置 Content-Length。实际帧证明 Node 自动发送 chunked；以不含真实 AppID、密钥、token 或订单的无效 JSON 对微信 stable_token 接口做对照，chunked 得到 412，明确 Content-Length 得到 HTTP 200 与缺 AppID 的业务错误 41002。这定位了传输兼容缺陷，不能推断原订单状态。正在修复正文长度，须再部署并真实查单验收。

原偏好请求的真实链路也已补取：17:34:40 `aac67717-486a-48a7-9431-624c3164be11` 确为 updatePreferences，新 progress-replacement 标记、callback_completed 与 committed 均出现；随后 `abe7e645-93cf-434d-bb92-df3edd7d0da0` 是 bootstrap。日志未记录发送偏好的四字段，因此差异发生原因仍未查明，不以这个提交记录抹去之前的数据差异。

最终本地稳定源码（传输修复前）已完成类型、Lint、格式、预算、bundle 与单 worker 全量：**68 文件、637 项通过，19.76 秒**。当前主包源码预算 **1,572,771 / 1,572,864，余 93 字节**；辅助包 106,406 字节。证据为 `resumed-combined-v2-final-verify.log`，不是默认并行 verify 全通过。

官方 npm 构建报告 fflate 入口 `lib/index.cjs.js` 不存在；其实际 package main 为 `lib/index.cjs`。已按仓库既有 `npm run prepare:runtime-deps` 工作流恢复官方 UMD，产物 33,044 字节、SHA-256 `462ef8041fc970e3615a20a9dd2b2e3047a073b2da729ef4f02b634bba8b7b83`，与已验收产物一致，预算再次通过。随后**官方完整预览编译成功并生成二维码**：压缩主包 1,441,224 字节、辅助包 91,391 字节、总计 1,532,615 字节。此压缩数字与仓库源码预算口径不同。未调用小程序 upload、提交审核或正式发布。

旧基础库尝试只修改两个项目配置中的 3.17.0→3.0.0，但实际运行 SDKVersion 为 3.17.2，故**旧基础库未通过**。两个配置已从测试前备份逐字节恢复，SHA 一致，`old-sdk-test-state.json` 的 restoreRequired=false。实际运行仍保持 profile20/progress3、pending0、两份偏好一致。需要在开发者工具“详情→本地设置→调试基础库”选择旧版本并读回实际 SDKVersion，不能用配置文件代替；原生 UI 操作当前不可用。

## HTTP 412 修复交付与最终独立验证

传输修复现已完成：有 body 时使用 UTF-8 `Content-Length=Buffer.byteLength(body)` 并 `req.end(body)`，无 body 时不添加长度或分块头。仅增加受控 `httpOperation=token|query|provide|other` 诊断；不记录路径、token、请求体或订单身份。支付签名原文、金额/身份/状态校验、订单事务、权益、超时与配置均未改变。

独立 tester 最终在准确 worktree 完成全部六项检查：类型、Lint、格式、包预算、accountSync bundle，以及 **69 文件、639 项全量测试通过（单 worker，20.03 秒）**。日志 `membership-transport-final-verify.log`。主包预算仍余 93 字节。独立 reviewer 相比实际已部署的 v2 ZIP 复核无 P1/P2，并完成 25 项针对性回归。

最终新包 `membership-http-transport-standard.zip`：SHA-256 `760680be39a535527c1d92ec46c5619ecaab9b9128d07b5f17620e1b0e0a5b0c`，6,996,058 字节、5,824 文件、零目录条目；CRC、POSIX 路径、Unix 100644 和全文件源码一致性均独立通过。相对当前线上 v2 包仅 diagnostics.js、virtual-payment.js 变化，v2 包保留为直接回滚包。**该传输修复包尚未部署，当前线上查单故障尚未消除。** 已再次请求维护者保持本任务控制台可见，部署授权无需重复。

官方预览编译未受仅云函数的传输改动影响。上传根核对 AppID `wx84ecacec08ca162c`、`miniprogramRoot=miniprogram/`、不上传 source map；扫描上传根未发现私有备份、ZIP、密钥或临时恢复文件。私有证据及云函数 ZIP 都位于上传根外。

## 证据位置与边界

安全汇总位于 `tmp/final-release-20260908/`：`resumed-original-write-failure.json`、`resumed-applied-verify.log`、`resumed-preservation-evidence.json`、`resumed-membership-query-failure.json`。原始备份、客户端缓存和精准云记录捕获均带 private 标记，不输出、提交或进入小程序上传根。

浏览器在部署后发生 CDP 超时，已请求用户保持本任务日志标签可见，以读取短期保留的真实请求链路。未通过浏览器凭据提取或云 API 私接绕过登录。没有实际小程序上传、提交审核或正式发布。

目前所有可独立执行的代码修复、标准 ZIP 打包核验、本地完整检查及官方预览编译均已完成。会员传输修复的最后一步仍受浏览器连接阻断：原控制台、日志标签分别读取均超时（30–35 秒），并已请求维护者保持本任务可见；不能将超时当作部署成功或未经验证再次发起保存。待连接恢复后继续原控制台部署和真实查单，用户授权仍有效。

18:34 控制台复查前的历史结论：客户端可编译生成预览，但当时会员传输修复还未部署，尚不满足上线验收。主智能体未执行付款、开始新随机练习、小程序 upload、提交审核或发布；用户稍后手机端的新练习及额度变化另见下文。最新阻断、剩余本人操作、版本说明与上传步骤见 [上传说明](2026-09-08-upload-guide.md)。

## 18:34–18:39 控制台连接复查

维护者回复“已打开”后，浏览器列表确认原会员控制台存在且地址正确，但读取原标签仍超时；按浏览器支持的恢复方式尝试同一浏览器新标签也超时。没有点击新的上传或保存，不能称传输修复已部署。最终 ZIP 与 v2 回滚包 SHA 已再次核对未变。已请求维护者在原 membership 函数直接选择最终标准 ZIP 并点普通“保存”，随后仍由本任务通过原会员页完成真实查单和核对；这是自动化通道故障所需的界面协助，不是新一轮部署授权。

微信开发者工具连接正常，定点只读确认原会员页 paymentState=unknown、hasPendingOrder=true、purchasing=false。仅查询该原订单，云集合返回一条 PENDING、金额 2800、provider=virtual、无 paid_at；这只是本地订单库状态，不能当作微信平台权威状态。安全证据为 `membership-before-user-console-save.json` 与 `membership-order-before-save-safe.json`，原订单号查询与原始响应留在 private 文件中，不输出或进入上传根。

## 18:51 后最终部署与真实查单成功

用户按已给出的完整路径直接选择最终标准 ZIP，回复“已保存”。随后控制台恢复可读，`membership-staging-d7c032b6e3273 / membership` 显示最近部署 **2026-09-08 18:51:46**、状态正常。只读函数信息为 Active、Nodejs20.19、60 秒。保留 v2 ZIP 回滚包和全部原环境配置。未点击在线 IDE 中另一个未部署的模板草稿，避免覆盖已验收函数。

原会员页 `onQueryPending` 经正常客户端查询流程返回三次 **业务 `ok=true`**：`c919b19e-8084-4f3e-8477-7405526cad5a`、`886c7d39-dadd-42b5-8bea-c881667b35e8`、`acfdac29-65a1-447f-b504-4b20f131688e`。这是原服务对未完成订单的既有轮询，没有额外下单或重拉支付。控制台第一条请求诊断为 `getOrder / completed / status-read`，`paymentAvailable=true`；新证据见 `membership-http-fix-real-query-evidence.json` 与 `membership-http-fix-cloud-log-evidence.json`。透明观察函数在 finally 恢复。

独立 reviewer 核对 `getOrder` 直接 await 平台查询，查询错误不会被批量恢复的 catch 吞掉。因此三个成功响应证明平台返回合法、身份/金额/环境已核验的未完成状态（平台 0 或 1，经适配器映射，不能区分二者）。**HTTP 412 查单故障已完成真实修复验收，购买恢复尚未完成。** 客户端继续保留原订单及 `unknown` 提示；它表示付款尚未确认，不再表示上述查单失败。没有下载部署后源码再做 SHA 比对，故不声称实际线上代码的逐文件哈希已核验。

## 手机端新随机授权与额度核对

用户确认于手机自行开始一次新的随机练习。云日志 **18:34:50** 的 `startRandomPractice` 请求 `ca5f6a00-54c4-4672-a14e-a3a761f38ece`：诊断标记 `membership-random-diagnostics-20260908-v1`、`completed / transaction`、246ms，业务成功、已用 3 次。独立 tester 按原订单账号键限定查询，最新 grant 创建时间 `2026-09-08T10:34:50.144Z`，包含 10 题，request SHA-256 前 16 位 `56736b340104f51e` 与真实日志相等。

该账号共 8 个不同 session 授权：北京时间 09-05 三条、09-07 两条、09-08 三条；今日 usage=3、remaining=0，与 09-08 三条授权精确一致。没有多扣次的证据。最新真实成功补齐了新练习首次授权样本；**不能反推 09-07 历史首次失败原因已经查明**。手机同一会话重新进入、断网恢复仍需本人操作，不能用电脑 cache 或直接调用只读授权接口替代。

当前会员权益集合无记录、仍为非会员，没有误发权益。电脑本地仍 profile20/progress3、outbox0、未暂停；这是电脑时点，不能当作手机正在答题的本地状态。安全证据为 `user-random-start-cloud-log-evidence.json`、`membership-live-safe-summary-v2.json`。

## 两条历史待支付订单与真实剩余阻断

定点只读查询发现同账号有两条旧 `PENDING` 订单，原客户端订单保留，金额 2800。当前实际平台成功查单证据只覆盖原客户端单，不把另一条数据库 PENDING 当作平台状态。精确 `_id=pending_<accountKey>` 查询没有读到云指针，已用原订单 `_id` 对照确认查询语义；不得写成“云指针仍指向原单”。本地待支付记录仍保留。

独立 reviewer 确认这是旧订单兼容契约：纯 `getOrder/recoverOrders` 不补建云指针；`createOrder` 会先按当前账号读全部旧 PENDING 候选，再在事务中复读、绑定并返回旧订单，不创建新单或签发支付参数。此分支已有 legacy 和 NOTPAY 防重测试。未手工建立、删除或修改指针。缺少云指针本身不是额外的数据丢失或重复扣款漏洞；两条订单均须按平台权威结果处理。

固定 scout 又直接读取了微信官方 [支付客户端 API](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)、[查单状态](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order) 和 [个人主体指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)：每个交易号仅用一次；换 login session 不是重用例外；状态 6 才明确关闭且不可再用。未找到适用于 `short_series_goods / env=0` 的未付款关单接口或保证自动过期时间。不能套用 JSAPI 关单、依据本地超时自行关闭或删除旧订单后重买。

已准备 [平台订单问题草稿](2026-09-08-platform-order-support-draft.md)，未向外发送。剩余支付动作依赖平台对旧单给出明确处理办法或权威终态；在此之前不能执行本人已授权的首购、续费及付费通知/断网闭环。完整上传条件、版本说明和必要本人操作见 [上传说明](2026-09-08-upload-guide.md)。此处 69 文件、639 项及相关预算仅是当时检查点；2026-09-09 当前完整结果为 70 文件、656 项，具体见本文顶部接续记录。

## 19:26 手机反馈后的独立复现与补充修复

用户明确：手机为 iPhone，通过“最近使用/体验版”进入，答题页左上角返回后首页找不到“继续”；没有确认使用本轮预览二维码。因此这是需要追查的真实现象，但不能直接认定它发生在尚未上传的当前客户端。没有新开随机练习、清手机缓存或覆盖手机学习记录来取证。

固定 scout 和 tester 在准确 worktree 独立确认一条当前源码缺口：随机授权先持久保存 pending 意图，云端成功后才保存 active session；若成功响应丢失或进程在本地保存前结束，pending 仍在，首页仅根据 active session 显示继续，而首页随机入口/设置页又先查额度，最后一次已成功授权便会被 0 额度阻止恢复。19:26 的离线实验成功复现，`pending-crash-window-repro-v2.log` 记录实际 CWD、导入路径和源码 SHA。该实验不是新的真实扣次，也不证明手机现场只有这个原因。

已交由固定 implementer 补齐两入口与 runtime 的原授权恢复，必须复用原 ID/题序并走服务端幂等确认；失败、缺题和并发变化保留 pending，持久化成功后仅删除仍匹配的确认项。独立 reviewer 先行审查了数据保留及并发约束。[微信官方存储隔离](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/storage.html) 明确按微信用户和小程序隔离；当前产品没有应用内多微信账号切换，不额外引入不存在的跨账号代次机制，同身份 guest/account 恢复保留。

电脑在修改前已定点私有备份成功：profile20/progress3、outbox0、没有暂停、存在 pending random 和原待支付记录；文件 `before-random-resume-fix-v3-private.json`。前两次捕获分别是参数转义错误和重开后 automator 超时，均保留失败结果，不能把它们的空值算作用户数据。已关闭准确项目，避免实现时热重载发送任何命令。新代码稳定后必须重新独立测试/审查、复验预算并生成新预览，之前 69/639 不能替代新代码最终结果。

旧基础库仍未切换：当前实际读回 3.17.0，用户找不到设置入口。电脑操作技能只能读到空窗格，截图两次返回 `SetIsBorderRequired / 0x80004002`，没有用猜测坐标点击或通过私有界面协议绕过。需要准确开发者工具完整窗口截图才能进一步指明控件；原两个配置仍为 3.17.0，没有留在试验版本。
