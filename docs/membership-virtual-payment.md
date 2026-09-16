# 个人主体会员虚拟支付接入

> 2026-09-15 最新状态：28 元半年会员的真实 Apple IAP 付款、查单到账、通知发货和幂等已通过，详见 [最终支付验收报告](qa/2026-09-15-person-payment-acceptance.md)。下文保留接入设计及当时的准备步骤；涉及“尚未验收”的历史描述以最终报告为准。develop/trial/release 均连接既有会员环境，不能把环境名称 staging 当隔离承诺。

2026-09-06 用户确认：小程序为个人主体，已解锁虚拟支付。沿用原会员、免费额度、练习授权和订单集合，商品仍为 28 元、六个自然月、不自动续费；本轮只适配收款、查单、发货及退款确认。原账号同步全局环境保持不变。

依据：[个人主体指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)、[虚拟支付接口](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)、[查询订单](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order)、[确认发货](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_notify_provide_goods)、[消息推送安全模式](https://developers.weixin.qq.com/miniprogram/dev/framework/server-ability/message-push.html)。

## 后台准备

在公众平台“支付与交易 → 虚拟支付 → 道具管理”核对已有商品，避免重复创建。如果尚无半年会员道具，按以下内容准备：

| 字段     | 内容                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| 道具名称 | 保管员刷题半年会员                                                                  |
| 道具 ID  | 优先使用已有道具 ID；新建时建议 `warehouse_member_6m`，以后台实际允许和保存结果为准 |
| 价格     | 28.00 元（接口中为 2800 分）                                                        |
| 数量     | 每笔固定 1                                                                          |
| 权益     | 六个自然月内随机练习不限次数，不自动续费                                            |

道具保存、发布、平台同步生效是不同状态，须分别核实。代码不会擅自上传或发布道具。当前未读取到后台道具记录，不将上述建议 ID 记为已创建商品。若使用 iOS，另核对小程序简称和 Apple IAP 开通状态。[官方总指引的 iOS 下单条件](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)要求 iPhone/iPad、iOS 15 及以上、微信 8.0.68 及以上、中国大陆 App Store 账户，最低支付 1 元；其中 App Store 账户地区仍须真机验收。

个人主体官方条件还包括居民身份证、服务类目含“工具”、认证和备案；用户已说明支付开通，其他条件没有重新读取平台验证，不另行代签协议。官方当前全终端月支付限额为 10 万元；Android 等终端费率 1%、通常 T+3 结算，iOS 12%、通常约 45–60 天结算。Android 等终端可在后台发起退款，iOS 由用户向 App Store 申请并由 Apple 判断。本次不新增自动续费、代币、主动退款或提现操作。

## 云端配置

只在 `membership-staging-d7c032b6e3273` 的会员函数环境变量或密钥管理中录入。不要把实际值放进聊天、本地 `.env`、部署 ZIP、源代码、日志或截图。`.env.example` 仅为变量名说明，程序不会自动加载该文件。

| 参数                         | 来源及作用                                                           |
| ---------------------------- | -------------------------------------------------------------------- |
| `MEMBERSHIP_PAYMENT_ENABLED` | 默认 `false`，只控制新下单；须在明确金额、次数、操作并获得确认后启用 |
| `WX_APP_ID`                  | 当前小程序 AppID，必须与可信 SDK APPID 一致                          |
| `WX_APP_SECRET`              | 小程序 AppSecret，用于服务端换取会话及稳定版 access token            |
| `WX_VIRTUAL_OFFER_ID`        | 虚拟支付基本配置中的 OfferID                                         |
| `WX_VIRTUAL_APP_KEY`         | 虚拟支付现网 AppKey；个人道具直购固定 `env=0`                        |
| `WX_VIRTUAL_PRODUCT_ID`      | 已发布且价格为 2800 分的半年会员道具 ID                              |
| `WX_MESSAGE_TOKEN`           | 消息推送 Token，与后台配置一致                                       |
| `WX_MESSAGE_AES_KEY`         | 消息推送 EncodingAESKey，43 字符，与后台安全模式配置一致             |

不要复制原 JSAPI 的商户 RSA 私钥、APIv3 密钥和平台证书到这条协议。服务端使用 Node HTTPS/crypto，不新增 SDK 或 XML 依赖。稳定版 token 只在内存缓存；`session_key` 只用于本次签名，不保存或返回客户端，登录 code 也不写入订单。

新购关闭但有效支付配置仍保留时，服务端继续查单、接收通知并完成已有订单；这是相较旧 JSAPI 实现的行为调整。已有付款不能通过删除密钥或清理集合回退。

## HTTP 消息推送

当前函数已核对启用公网访问及 HTTP 路径 `/membership/virtual-pay/notify`。路由存在不代表真实发货通知或平台透传已经验收；真实付款触发的通知仍须闭环。

在创建公网路由和修改公众平台消息推送之前，先读取并保留现有配置，确认不会覆盖其他业务的消息推送。新增公网访问及消息订阅属于新的云权限/外部配置变更，须展示最终环境、URL、事件和权限范围并取得确认。

- GET 按 Token、timestamp、nonce 校验 `signature`，通过后原样返回 `echostr`。
- POST 仅接受安全模式 `encrypt_type=aes`，核验 `msg_signature`，解密后核对接收 AppID；客户端伪造事件不得进入发货入口。
- 网关须保留查询参数和原始字符串或 Base64 报文，不要先解析并重写 body。该协议不使用 `Wechatpay-*` 头验签。
- 接收 `xpay_goods_deliver_notify` 和 `xpay_refund_notify`。发货通知校验商品、用户、金额后再查原支付单确认；Apple 通知可能无 `WeChatPayInfo`，不能据此拒绝合法 iOS 付款或伪造交易号。退款则使用经过消息验签、解密、接收 AppID 校验的退款成功通知作为权威证据，绑定原支付单及全额退款金额，不混用原支付单与退款单的查询编号。
- 成功处理返回与明文消息格式对应的 XML/JSON `ErrCode=0`；验签、查单或事务失败返回非成功，让平台重试。

本轮没有订阅代币、自动续费或 iOS 退款问询事件。若后续平台要求接收额外事件，先明确契约再接入，不能把未实现的事件统一返回成功。

## 订单与权益

前端继续共用进行中的购买请求。服务端先创建 PENDING 订单，再生成支付双签名；金额、商品、数量和环境全部由服务端固定。登录 code 必须换取与可信 SDK OPENID 一致的会话。

虚拟支付每个商户单号只用于一次调起。客户端取消本身不能证明平台已关闭；未完成订单只走查询恢复，不重用旧号或创建替代单。只有平台权威终态协调完成，且没有其他旧待支付订单拦截时，才允许下一次明确购买。创建请求响应丢失时保留 requestId；旧订单一直保留供核查和补偿。前端 success 不能直接开通会员。

查单验证业务单号、请求用户、现网标记、金额、支付订单类型和状态，并以平台 `wx_order_id` 建立唯一锁。订单快照增加 `payment_provider=virtual`、`product_id`。旧 JSAPI 适配器代码暂留供历史回归，实际 `index.js` 只加载虚拟支付实现，不能通过旧配置重新启用 JSAPI。

付款确认后继续使用现有原子事务和按付款时间排序的半年延期。查单路径在本地发货成功后调用平台确认发货；如果确认失败，PAID 订单仍进入后续补偿，不会再次延期。十分钟定时器同时轮询到期 PENDING 和 PAID 订单，虚拟支付每批最多两单，为查单和确认发货的两次网络请求保留 60 秒函数时间预算；已确认发货的 PAID 订单下次定时查询安排在 24 小时后，仅作原支付单状态复核，不承诺可替代退款推送或查到独立退款单。查询沿用现有 status/next_check_at 索引，不创建新集合或权限。后续须监测到期订单积压，不能将固定批量视为任意交易规模下均可及时补偿。

全额退款主要以可信的 `xpay_refund_notify` 成功通知确认：钉死原用户、原商户单号、原平台支付单号、商品快照、2800 分和 `RetCode=0`，记录退款平台单号。未经验签或复制的同形对象不能生成退款证明。此外，现有代码允许服务端 `query_order` 返回经过完整订单绑定校验的全额退款状态时结算退款；这条路径不会假造退款单号，也不表示原支付单一定能查询到独立退款单，须由平台联调核实可达性。保留交易锁和延期历史，仅将该订单的历史贡献标记 `refunded=true`，重放其余付款；最后一笔被退回后可回到无有效会员状态。退款先到、付款通知后到也不能重新赠送权益。部分退款不自动换算会员时长，返回待核对失败而不伪造处理成功；正式开放前须确定实际退款操作边界与异常处理负责人。当前尚无平台真实退款报文，必须在 staging 验证通知字段映射；退款通知耗尽重试后的自动找回不在已验证能力内。

## 开发版页面连接与验收

会员专用 transport 的 develop/trial/release 当前都显式连接 `membership-staging-d7c032b6e3273`。这是真实共用环境，函数更新会影响三个客户端版本。`miniprogram/config/cloud.ts` 与 accountSync 环境保持 `cloud1-d2gglad830c91db10`；未切换根目录副本或扩大权限。

本地检查覆盖代码与合成数据，不能替代以下验收：

1. 道具已发布且同步生效、签名用的商品 ID/价格一致；iOS 简称/IAP 状态和设备版本符合要求。
2. 新函数标准 ZIP 在 staging 普通部署，读回 Node.js 20.19 / 60 秒 / 256 MB / `index.main`，保留运行时 timer、Type、TriggerName 三项可信守卫。
3. 配置公网消息路由后，GET 握手、原始 XML/JSON/Base64、篡改拒绝和真实平台通知通过。
4. 开发者工具首页、会员页、随机设置、恢复及报告页面取得有效截图；真机完成支付取消、结果恢复、发货/查单和退款通知验收。
5. SDK 6 项传递告警完成兼容修复或明确风险处置；不能因本次未增加依赖就记为审计通过。

真实联调使用 `env=0`，会产生真实付款。本任务已有本人操作下一笔 28 元首购与一笔 28 元续费、合计不超过 56 元的授权；无需重复申请该范围。当前旧订单未安全处理，不应启动新付款。不得为凑覆盖增加收费，不清零或删除已有免费额度和授权。
