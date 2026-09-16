# 个人主体虚拟支付：部署前逐项验收（2026-09-15）

## 当前结论

**28 元半年会员的现网真实支付闭环已通过，可从当前项目上传小程序。官方第 13 项属于上线后的真单与账单复核，仍须在发布后完成。**

本次已现场读取微信官方个人主体指引、公众平台、CloudBase 控制台及当前云函数源码。商品已发布为 **28 元 / 6 个自然月，不自动续费**。两条已确认未扣款的旧测试单已解除购买占用并保留原记录。用户于 21:59:31 完成一笔 Apple IAP 真实付款；平台核对实付 28 元、退款 0 元。修复查单字段兼容后，原订单 PAID，会员至 **2027-03-15 22:31:53（北京时间）**。真实发货通知于 22:50:42 成功处理，MP 已发货列表显示发货时间 **22:50:43**；最终查单确认平台状态 **4（已发货完成）**。最终云函数普通 ZIP 部署时间 **22:56:31**。未上传正式小程序、未提交审核或发布。

下方早期现场事实与部署记录保留排查过程；最终结果以本节、清单及“最终交付核验”节为准。

实际项目：`D:\文档\保管员刷题小程序\.worktrees\warehouse-question-classification\miniapp`。AppID 为 `wx84ecacec08ca162c`。会员函数 `membership` 在 `membership-staging-d7c032b6e3273`；develop/trial/release 共用此环境，名称不代表隔离。

## 官方清单逐项结果

来源：[个人主体接入指引，第八节](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)。

| 项 | 验收内容 | 状态与本次证据 |
| --- | --- | --- |
| 1 | 主体、身份、类目、认证及备案 | 后台显示个人主体、工具 > 信息查询、已认证（2026-08-02）、已备案；不收集或展示身份证号码，具体身份证资格以平台审核为准。 |
| 2 | 月收款限额告知 | 已告知：个人主体全终端合计每月 10 万元。后台同样显示此限额。 |
| 3 | 虚拟支付开通 | 通过。后台已开放基本配置、交易订单及现网商品。 |
| 4 | AppID、OfferID、正式 AppKey | 通过。配置与后台一致，新购开关开启；真实 iOS 收银台已完成 28 元付款。密钥不写入本报告或部署包。 |
| 5 | iOS 简称与开通 | 通过。简称“粮安库”，苹果 IAP 已开通；本次真实 iOS 付款成功。客户端有 iOS 15、微信 8.0.68 版本检查。未另测 Android 真机。 |
| 6 | 消息接收部署 | 通过。安全模式（AES）、JSON、Token 握手通过；真实通知记录 delivery_notice_processed_at，平台确认发货完成。最终部署后无签名 GET 返回 401。 |
| 7 | MP 发货地址与测试支付 | 通过。回调配置、真实 Apple IAP 实付 28 元、会员到账、平台已发货均有实际证据。 |
| 8 | 服务端签名与验签 | 自动化基线通过；另使用官方第 5.5 节 Python hmac/hashlib 公式独立核对服务端生成的双签名，字节一致，价格 2800 分、数量 1、env=0。证据 `tmp/payment-acceptance-20260915/official-signature-verification.json`。 |
| 9 | 按平台单号去重发货 | 通过。平台交易号锁与会员延期同一事务；本次查单补发后又收到真实通知，最终只有一笔 renewal，到期时间未重复延长。自动化另覆盖重复通知。 |
| 10 | 前端拉起、付款、收到推送 | 通过。Apple IAP 实付 28 元，云端 PAID/isMember=true，真实通知已处理，query_order 状态 4；开发者工具重入会员页显示会员与正确到期日。 |
| 11 | query_order 兜底 | 就绪并验证查单补发。SUCCESS 严格核对 left_fee=2800，退款字段可缺省；10 分钟定时器已实测。本次原订单经正常查单开通会员。异常确认发货接口已补通用 pay_sig，并经独立签名字节测试；本单在最终签名部署前已由通知重试完成发货，未另扣款验证此接口分支。 |
| 12 | 退款、结算、费率告知 | 已告知 Android 1%、T+3；iOS 12%、约 45–60 天。Android 可由开发者发起退款，iOS 由用户向 Apple 申请；付款 180 天内退款退手续费，之后不退手续费。 |
| 13 | 上线后真单与账单对账 | **上线后项待执行。** 本次现网预览真单已对上实付 28 元、Apple 服务费 3.36 元、退款 0 元、会员期限与平台单号；尚未上传正式版，次日账单及约 45–60 天结算尚未产生，不标记已完成。 |

## 现场事实

- 现网商品：`warehouse_member_6m`，名称“保管员刷题半年会员”，28 元，备注“六个自然月会员不自动续费”，2026-09-06 发布。
- 云函数：Node.js 20.19、`index.main`、256 MB、60 秒；读到的最近修改时间为 2026-09-14 18:18:05。下载的 `index.js` 及全部 `lib/*.js` 与本地修改前版本逐字节一致。不能部署 9 月 9 日的旧诊断 ZIP 覆盖当前代码。
- 真实 `getStatus` 成功：RequestID `ec791e16-02c3-4f3d-aa55-68a1675faf42`，服务端日期 2026-09-15，非会员，免费额度 0/3 已用，`paymentAvailable=true`。这只证明状态接口及配置可用。
- 自然定时调用：RequestID `45d519a1-5470-42fc-9079-ec2bbe3de6bd`，2026-09-15 13:30，来源 `TRIGGER_TIMER`。一个旧单返回 NOTPAY、平台状态 1；另一个返回 `268490002`、`platformDetail=UNRECOGNIZED`。平台 RID `6aa8d7e4-4250ab50-393e8592`。本地没有把这个参数错误当成关闭/未付款证明。
- 只读查询发现 5 条 9 月 6–7 日的旧订单：4 条本地 CLOSED，1 条 PENDING。四条 CLOSED 没有完整 `platform_evidence_version/platform_verified_at` 等凭证，当前代码继续将它们作为未知结果处理。完整订单号不写入公开报告。
- 回调地址：[会员发货接收入口](https://membership-staging-d7c032b6e3273-1462241656.ap-shanghai.app.tcloudbase.com/membership/virtual-pay/notify)。已存在通配域名路由，指向 membership，路由启用。公众平台已在用户确认后完成绑定，见下文。

## 已启用的消息推送配置

只用于当前 AppID 的发货与退款通知：

- URL：上述会员发货接收入口。
- 消息模式：安全模式（AES）。
- Token、EncodingAESKey：与该会员函数当前环境变量 `WX_MESSAGE_TOKEN`、`WX_MESSAGE_AES_KEY` 一致；不新建、不旋转、不写入源码。
- 处理事件：`xpay_goods_deliver_notify`、`xpay_refund_notify`。
- 用户已完成管理员/开发者扫码；保存时微信执行合法握手，返回“服务器配置已完成”；返回设置首页再次核对“已启用”、安全模式、JSON。Token 和 EncodingAESKey 仅在现有云函数配置与当前小程序后台之间复用，没有写入源码或报告。

## 本次验证及修复

修改前独立 tester：TypeScript、Lint、格式、包预算、accountSync bundle 均通过；单 worker 全量 **73 文件、773 项通过**。主包 **1,564,444 / 1,572,864 字节**，余 **8,420 字节**；辅助包 116,057 字节。日志位于 `tmp/payment-acceptance-20260915/tester/`。

本次已完成的本地修复：

1. 服务端已完成旧订单但客户端重入时，本地交易缓存仍可能阻塞购买；恢复时按原单查询权威状态，只有已付款/合法终态才清理缓存。
2. 微信 HTTPS 请求只设置连接空闲超时，缺少全程截止及响应截断处理；增加完整超时与响应错误处理，防止支付查单挂起。

两处修复均已通过实现者的定向测试、类型、Lint 与格式检查。独立 tester 最终复测全部通过：TypeScript、Lint、格式、包预算、accountSync bundle，以及单 worker 全量 **74 个测试文件、784 项测试**（Vitest 退出码 0，耗时 21.52 秒）。日志位于 `tmp/payment-acceptance-20260915/tester-final/`。最终主包 1,564,444 字节，距项目预算剩余 8,420 字节；辅助包 116,168 字节。云函数修复已部署；客户端修复在当前预览项目中，尚未上传正式版本或真机付款。

### 开发者工具与手机预览

已实际导航到会员页，读取到 `loading=false`、`paymentAvailable=true`、`transactionStage=PAYMENT_UNKNOWN`，截图已检查：28 元、6 个月、免费额度、旧订单阻塞提示显示正常。截图 `tmp/payment-acceptance-20260915/member-page.jpg`。

最新手机预览已生成：`tmp/payment-acceptance-20260915/membership-preview.jpg`，入口为会员页。平台编译包 1,528,756 字节（主包 1,429,077、辅助包 99,679）。这是预览编译成功，不代表已付款、已上传正式版本或提交审核。

### 只读审查

reviewer 复核本次两处改动未发现确定新增缺陷。保留一项原有时限风险：冷启动的 token + query 两次网络请求，各自最多 8 秒，可能超过客户端单次云调用的 12 秒窗口；前端此时保留未知订单并允许后续检查，定时任务继续补偿。此情况未在真机慢网下验收。

早期因单接口文档未列 pay_sig 而暂缓改动。真实发货确认返回 268490002 后，再依据通用虚拟支付文档 2.5 与个人指引 5.5 补充服务端支付签名，见最终交付核验；order_type 7 为合法苹果支付类型，始终保留。

## 本次已部署包

`tmp/payment-acceptance-20260915/membership-payment-recovery-standard.zip`，SHA-256：`71d9752376cbeca826d6e77ddbd5a9b92ce92a79d2b391e39e2b64406c00b084`。

5,825 文件；打包脚本与独立 tester 均已核对 POSIX 路径、100644、CRC 和打包时当前源码逐字节一致，无缺失、多余、重复或敏感配置文件。部署前对比线上下载，运行文件仅 `lib/virtual-payment.js` 有变更，内容为 HTTPS 超时与截断处理。不变更商品、金额、密钥、数据库或订单状态。

用户确认后已通过 CloudBase 控制台选择该 ZIP、点击普通“部署”，未选择文件夹、未使用 Windows CLI 部署、未点击安装依赖。控制台显示正常，最近部署时间 **2026-09-15 17:11:23**。部署后的独立下载验证及只读状态验证记录在 `tmp/payment-acceptance-20260915/postdeploy/`。

部署后线上 `getStatus` 验证成功（2026-09-15 17:19:53）：RequestID `072ff878-bbd1-4089-b9da-d57cb073ee0f`，`ok=true`、`paymentAvailable=true`、非会员、免费额度剩余 3 次。此调用没有创建付款单或人工修改会员权益。

独立 tester 下载核对：5,825 文件集合完整；业务入口、全部 `lib`、`package.json`、`package-lock.json` 与部署 ZIP 及本地源码逐字节一致，本次 `virtual-payment.js` 修复确认已在线。ZIP 中 4,516 个 `.js/.cjs/.mjs` 文件与下载版全部一致。

不能宣称整个下载包逐字节一致：另有 25 项依赖产物差异，包含 1 个无扩展名 `semver` 命令链接、1 个依赖锁定元数据、12 个 `@types/node` 文件和 11 个 `undici-types` 文件。类型包版本分别从 26.4.1 变为 26.5.1、8.3.0 变为 8.9.0；下载 stdout 没有安装依赖记录，目前证据不能区分云平台部署处理与其他归一化步骤。业务运行 JavaScript 未出现额外差异，线上状态验证通过；详见 `postdeploy/dependency-diff-analysis.json` 与 `postdeploy/zip-js-compare.json`。

历史订单仍保留原记录。用户随后明确回复此前测试“没有”实际扣款。进一步核对发现 5 条旧单属于 4 个账号，当前手机/开发者工具已验证账号仅有 2 条；其他 3 条不在本次恢复范围。公众平台对指定旧单、现网普通虚拟支付、未发货、2026-09-06 至 2026-09-15 的查询显示暂无数据；这个有限筛选结果不作为无扣款或关闭订单的依据。

### 手机查单复现

2026-09-15 17:36 已重新生成二维码 `tmp/payment-acceptance-20260915/membership-preview-20260915-173635.jpg`。用户成功进入会员页，底部提示“请先检查支付结果”；点订单提示区的“检查支付结果”后仍显示未知/核对中。

手机云调用 RequestID `4759948a-25ac-45bf-96de-0aa27421cbac`（17:39:24）记录 `getOrder` 在 `reconcile` 阶段失败，`ORDER_PLATFORM_ERROR[errcode=268490002]`、`platformDetail=UNRECOGNIZED`，耗时 588 毫秒。日志订单摘要 `acbaf8b185930ff7` 与本地当前旧单摘要相同。随后开发者工具查询原单的 RequestID `5a9d19e1-7a92-46cf-9c52-710523198c34` 返回同一平台错误码；云调用本身成功，并非云函数不可达。

此时没有关闭、删除旧单，也没有创建新付款或人工授予会员。用户已确认未实际扣款；平台明确终态仍未取得。现有诊断无法确定具体哪个请求字段被平台拒绝，不将错误码当作未扣款证明。

### 已确认未扣款测试单的恢复

仅对当前账号尾号 `dcaa9e`、`2c7b52` 两条旧测试单准备服务端管理标记，解除新购买占用并保留原订单及迟到付款的正常对账。新恢复代码已通过独立全量 76 文件 / 802 项及类型、Lint、格式、包预算、accountSync 检查；随后仅加强测试，定向 8/8 和静态检查通过，审查问题已闭环。

用户授权后，新 ZIP 已于 **2026-09-15 18:47:48** 通过 CloudBase 控制台普通部署；SHA-256 `dac943190b979226068d375814fcd9755b46b9039b02efd6c096a44c1feaa431`。控制台正常，函数状态 Active；真实 getStatus（RequestID `7cef414e-5253-4327-b9b9-c831f70430a0`）及 recoverOrders（RequestID `8efc2ab9-bde1-4e7a-aaef-d2818b54e55f`）均成功，`paymentAvailable=true`。无签名 webhook GET 仍返回 401。

独立下载验收确认文件集合 5,825/5,825 一致、业务文件 10/10 及运行 JS 4,516/4,516 逐字节一致；25 个依赖类型/元数据/shim 差异单独记录在 `test-hold-release/postdeploy-184748/`，不宣称整包字节相同。

用户随后明确“只解除占用”，已授权保留原单并写入恢复标记。原 CLI 待确认任务在重连后返回 Task not found，未重放该任务。随后在已登录 CloudBase 控制台分别保存两个管理字段，写前查询匹配各目标，写后精确回读匹配两条标记；这是“预检查＋界面保存”，不是原子条件更新。独立 tester 确认旧订单仍为五条，仅指定两条新增标记，其他三条未新增标记，金额及支付业务字段未改动。真实 recoverOrders RequestID `96dc70aa-fb4f-40ee-a674-a6319e2eb7f0` 返回无 pendingOrder，会员页恢复可购买。范围及精确回退方式详见 [测试旧单恢复方案](2026-09-15-test-order-recovery.md)。线上 `member_orders` 权限为 ADMINONLY。

### 真实 Apple IAP 付款与会员到账（22:31 修复后）

- 用户报告已付款。MP 现网 Apple IAP、2026-09-15、指定商户单号查询确认：实付 **28.00 元**，服务费 **3.36 元**，退款 **0.00 元**，支付时间 **21:59:31**。商户单尾号 `4b2418`，MP Apple 交易号尾号 `296627`；query_order 的微信内部单号尾号 `272815`，两类单号不同。
- 初次手机 getOrder 日志 RequestID `50e72570-326c-425c-9440-cf9eda8bdf76` 报 `ORDER_QUERY_SETTLEMENT`，amountMatch=true、refundMatch=false；当时云端仍 PAYMENT_UNKNOWN，不能依赖手机口头状态直接判为闭环成功。
- 对照[官方 query_order 文档](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order.html)，refund_fee 适用于退款单，支付单应看 left_fee。修复只对 SUCCESS 要求 left_fee=2800，refund_fee 可缺省或数值 0，其余订单、身份、金额、时间、签名校验均保留。
- 修复 ZIP：`tmp/payment-acceptance-20260915/settlement-fix/membership-settlement-fix-standard.zip`，SHA-256 `f3232985225cf7954d76c875c8be9757e8d2550c18ff200d067e5083aa69c654`；5,825 文件，相对 18:47 包只改 `lib/virtual-payment.js`。普通 ZIP 部署于 **22:31:07**，函数正常。独立全量 **76 文件 / 817 项**及类型、Lint、格式通过；随后仅补 4 项退款保持测试，该文件 **76/76**及类型、格式通过。
- 真实 getOrder RequestID `89050c32-4618-4885-89df-f59a2108c6ac`：PAID、2800 分、isMember=true，会员起始 **2026-09-15 22:31:53.708**，到期 **2027-03-15 22:31:53**。这是正常平台查单及数据库事务生成，未人工写 PAID 或授予权益。
- 再次查单 RequestID `e703ab1d-f58f-40c6-ab2a-d6053e97bcc1`，会员起止不变；数据库只有本单一笔 renewal。开发者工具重入会员页显示“当前：会员”“有效期至：2027年03月15日”，无待核对单号。截图 `settlement-fix/member-active.jpg`。
- 部署后无签名 webhook GET 仍为 **401**。此阶段尚未取得最终发货状态；最终已完成，见下一节。阶段原始审计数据在 `tmp/payment-acceptance-20260915/settlement-fix/`，不在此报告公开完整用户标识或密钥。

### 最终交付核验（22:57）

- 最终包 `tmp/payment-acceptance-20260915/delivery-signature/membership-delivery-signature-standard.zip`，SHA-256 `1f690f4351b04a653824413091e91262d5efe2509361a419d67c71a8b4cafdb7`，5,825 文件，普通 ZIP 部署时间 **2026-09-15 22:56:31**。
- 独立线上下载核验：5,825 文件集合一致，无缺失或多余；业务入口/lib/package 共 10 文件及全部 `.js/.cjs/.mjs` 无字节差异。另有与此前相同的 25 个依赖类型/shim/metadata 差异，详见 `delivery-signature/postdeploy-verification.json`，不宣称整包字节相同。
- 修复发货失败诊断，并按[虚拟支付通用文档 2.5](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)为异常确认发货增加 `HMAC-SHA256(AppKey, path + '&' + 原始正文)`。支付单页文档没有列出该参数，通用签名规则应结合阅读。诊断只记录受限数值错误码，不输出密钥、openid、响应正文。
- 最后全量基线 **76 文件 / 823 项通过**；随后只增加发货签名及一项回归，独立复测相关两文件 **122 项**、typecheck、lint、四文件格式检查通过。最终变更经只读 reviewer 审查无阻塞。
- 真实通知处理时间 `2026-09-15T14:50:42.639Z`；最终 getOrder RequestID `29af8f51-1432-49e1-b443-92742f79f9a9` 返回 PAID、2800 分、isMember=true。数据库平台状态 **4**，内部平台单号尾号 `272815`，`provided_at=2026-09-15T14:56:59.992Z`。
- MP 指定商户单号、Apple IAP、现网、2026-09-15、“已发货”筛选：订单与实付均 **28.00 元**，Apple 服务费 **3.36 元**，退款及平台回退均 **0.00 元**；支付 **21:59:31**，发货 **22:50:43**。
- 本次先查单补发会员，再收到真实通知；再次读取权益仍只有一笔 renewal，六个月到期时间不变。最终无签名 webhook GET **401**。
- 真实成功的发货路径是通知重试。增加 pay_sig 后的异常确认发货分支经过本地测试，未另创建真实付款来强制走此分支；不把现有订单的通知成功归因于该新增签名。
- 最终证据位于 `tmp/payment-acceptance-20260915/delivery-signature/`，其中 `final-order.json`、`final-entitlement.json`、`mp-real-payment-final.json` 对应平台发货、权益和 MP 金额。尚未生成正式上线后的账单，不将订单列表当作日/月结算账单。

## 回滚准备

已将本次真实线上下载制作成标准 ZIP：`tmp/payment-acceptance-20260915/membership-rollback-standard.zip`，5,825 文件、7,004,630 字节，POSIX 路径、100644 权限、CRC 与源码逐字节校验通过。

SHA-256：`a213b46af2c970b660707834f29aa0cd65b0748d387be8f6aa0e20a539c70fcf`。

若需要回滚，使用控制台直接上传上述已核验回滚 ZIP、普通部署；不要通过 Windows CLI 或文件夹上传重新打包。本次部署和回调启用已经用户确认，未执行回滚、未提交审核或发布小程序。

## 契约核验说明

本次重新读取了[查询订单接口](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order)：`268490002` 是请求参数错误，具体原因取决于 errmsg；不是通用“订单不存在”或“可以关闭”信号。支付类型 7 是苹果 iOS 支付，不能移除。

重新读取[异常确认发货接口](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods)：单页查询参数只列 access_token；正常发货推送成功回复后无需调用该接口。最终按通用虚拟支付服务端签名规则补齐 pay_sig；本单的正常推送已成功，异常发货分支的实测边界如上。
