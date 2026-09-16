# 2026-09-07 会员虚拟支付超时恢复修复

## 定位结论

本次根据当前客户端支付调用链与服务端订单、回调实现定位，没有读取真机日志或发起真实交易，不能据此判断某一笔真实订单是否已扣款。

旧支付桥只等待 success/fail，微信桥回调缺失时 Promise 不结束。页面 purchasing 随之保持 true，而 onShow 又跳过恢复；服务 recoverOrders 还会等待同一个 purchaseInFlight，形成恢复路径阻塞。即使桥 fail 返回，旧实现也会丢失取消/超时差异，使 PENDING 订单看起来像再次点击没有反应。旧逻辑还有 ORDER_NOT_FOUND 删除缓存以及 preflight race 重用旧单的分支，均已收紧。

服务端 getOrder 已能向平台查原单；仅权威 SUCCESS 才提交 PAID 和会员权益。交易号锁、订单状态和续期记录在事务中提供幂等，按付款时间和订单号排序重放处理乱序通知。本次保留权益结算机制，并补齐同账户 PENDING 订单防重：在现有 member_orders 集合内使用独立 pending_账户哈希 文档记录 pending_order_id，事务内只有新建订单可获得支付参数；同 requestId、其他请求命中旧 PENDING、遗留旧单均只返回订单，不重签。canStartPayment 仅随首次新建虚拟订单的有效支付参数返回。原非虚拟 JSAPI 支付兼容行为保持。指针引用缺失、账户不符或未知状态均保守阻断新建。recoverOrders 额外返回安全的 public pendingOrder，支持本地记录丢失后的恢复。

## 状态与恢复

- idle → opening：兼容性检查通过，持久化 requestId，创建订单；在调用支付桥前持久化订单号及 attemptedPayment。
- opening → confirming：桥 success 或明确成功的 complete 返回后查服务端订单，客户端回调本身不代表会员开通。
- opening → cancelled：明确 cancel 或 errCode=-2，仍查询并保留原订单。PAID 权威结果优先；否则展示“已取消支付，未开通会员”。
- opening → unknown：timeout/network/system error、空 complete、回调缺失或收银台返回导致客户端结果未知。先解除桥等待，查询原订单。
- confirming → pending/unknown/cancelled：原单仍为 PENDING，展示订单号、“检查支付结果”及避免重复扣款说明。
- confirming → succeeded：服务端 PAID 且会员状态已确认。
- confirming → failed：服务端 CLOSED/FAILED 后允许下一次购买生成新的 requestId 和 outTradeNo；不支持设备也使用失败展示态并说明支持条件。

支付桥使用 success/fail/complete、settle-once 和 30 秒 watchdog，消费运行时返回 Promise 的拒绝。服务层另有支付等待边界及每次云请求 12 秒边界；一次查单至多请求 3 次。超时只结束客户端等待，不撤销或删除服务端订单。迟到返回不会接着创建订单或重新支付。

onShow 总是恢复；onHide 返回和网络恢复可结束当前客户端桥等待并查单。页面版本号丢弃过期异步 UI 结果，服务层对购买、恢复、同一订单查询分别单飞。onUnload 释放页面监听；进程重启后从持久化原订单恢复。仅剩 requestId 时，onShow 先查服务端、不创建或拉起支付。用户再次点击时复用该幂等请求；旧订单只查，只有服务端明确本次首次新建并返回 canStartPayment=true 和有效支付参数，才允许首拉，避免请求原本未送达服务端时也被卡住；无本地记录时可恢复服务端 pendingOrder。新的恢复结果会清除历史 PAID 缓存，防止已过期或退款的会员状态被旧结果覆盖。ORDER_NOT_FOUND/查单异常均保留原单，不用未知结果推断旧单已关闭。没有“放弃并重新支付”或客户端删除 PENDING 功能。

## 安全诊断

只记录支付阶段、脱敏订单号、数值 errCode、标准化错误类别、平台、系统版本、微信版本、基础库版本和查询状态。任意原始错误对象不会进入日志或界面；signData/paySig/signature/session_key/AppSecret/登录凭证/完整 OPENID 不记录。页面按用户要求显示订单号，诊断日志仅显示脱敏订单号。

## 范围

源代码：

- miniprogram/packages/auxiliary/services/wechat-virtual-payment.ts（从主包 services 移入）
- miniprogram/packages/auxiliary/services/payment-diagnostics.ts
- miniprogram/packages/auxiliary/services/membership-service.ts（支付协调器）
- miniprogram/services/membership-service.ts（共享权限服务基类）
- miniprogram/types/membership.ts
- miniprogram/repositories/membership-client.ts（不支持设备文案与服务端未决订单恢复契约）
- miniprogram/packages/auxiliary/pages/member/index.ts
- miniprogram/packages/auxiliary/pages/member/index.wxml

服务端：cloudfunctions/membership/lib/handler.js、cloudfunctions/membership/lib/cloud-store.js。

测试：tests/member-page.test.ts、tests/membership-service.test.ts、tests/membership-virtual-payment.test.ts、tests/membership-client.test.ts、tests/membership-virtual-integration.test.ts。服务端权益幂等与乱序通知同时运行 membership-function 等现有回归测试。

首次完整 verify 在主包预算处失败（超出 3,356 字节）。为保持原预算不变，将支付协调器、微信桥和诊断代码移入 auxiliary 分包；主包 MembershipService 仅保留共享权限/状态方法。会员页面直接使用分包内的支付服务实例，主包不依赖分包。

价格 ¥28、商品、OfferID、ProductID、AppKey、云环境、签名透传、回调配置、六个月会员期限保持不变。未上传、未部署、未发起真实付款。

## 验证

最终由独立 tester 完整运行 npm run verify，退出码 0：

| 检查 | 结果 |
| --- | --- |
| TypeScript typecheck | 通过 |
| ESLint + Stylelint | 通过 |
| Prettier format:check | 通过 |
| 主包/分包预算 check:package | 通过，1/1 |
| accountSync 产物 check:account-sync | 通过，bundle is current |
| Vitest 全量 test | 65 个测试文件、563 项测试全部通过 |
| 未处理异步错误 | 完整输出中未观察到 Unhandled Error 或 unhandled rejection |

主包 1,555,665 字节（149 文件），低于 1,572,864 字节限额；auxiliary 分包 102,863 字节（39 文件）。未提高任何包体限制。

[完整 npm run verify 日志](../../tmp/2026-09-07-membership-payment-verify.log)包含每步原始输出及 VERIFY_EXIT_CODE=0。首次主包预算失败已通过分包修正；随后发现的非虚拟 JSAPI 回归已通过隔离 virtual 分支修正。本记录的结果属于最终完整重跑。

新增/更新覆盖：success 后延迟 PAID，cancel PENDING/CLOSED，网络与 SystemError timeout，无回调 watchdog，complete 单独到达，迟到 success/Promise rejection，支付期间 onHide/onShow，网络恢复及卸载监听清理，进程重启与本地订单丢失恢复，request-only 的旧单查单与首次未送达请求首拉，连续点击/查询单飞，CLOSED/FAILED 新 requestId/outTradeNo，不支持设备提示，服务端跨请求并发单一订单，遗留多 PENDING 及异常指针保守拦截，历史 PAID 不覆盖最新退款/到期状态，重复与乱序通知权益幂等，诊断日志敏感信息过滤。

只读 reviewer 最终增量复审未发现新的可复现阻断。本次未通过真实交易验证具体真机订单；没有上传、部署或真实支付，线上代码和配置未在本次执行中变更。
