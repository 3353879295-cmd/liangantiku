# 会员设计与改动说明

2026-09-06 支付协议已在本地适配为个人主体虚拟支付道具直购，原会员/额度/授权设计保留。最新配置与协议细节见[个人虚拟支付接入](membership-virtual-payment.md)，本地门禁 64 文件 / 483 项通过但未部署。下文“支付与异常”保留普通 JSAPI 历史设计；当前默认入口不再使用该收款协议。虚拟支付取消后换新单，未知结果只查旧单；全额退款保留历史并撤销该订单的权益贡献。

## 现有项目与边界

开发位置为 `.worktrees/warehouse-question-classification/miniapp`。原生 TypeScript/WXML/WXSS 小程序，页面调用 Service/Repository，本地 gzip 题库使用 fflate 解码。账号资料和学习进度通过 accountSync 同步，学习数据 schemaVersion 仍为 4。

本次保留原题库、判分、解析、收藏、错题、学习记录及账号同步协议。会员使用独立云函数和集合，不往客户端可写的 progress 中加入权益字段。原会员页为占位页，没有已上线且标为会员专属的功能；基础学习报告等仍向免费用户开放。

## 规则

- 价格由服务器固定为 2800 分/CNY；每次开通六个自然月，不自动续费。
- 身份只使用 wx-server-sdk 提供的 APPID+OPENID，SHA-256 派生 account_key。前端游客/登录模式不改变这个身份。
- 免费随机练习每天三次，以服务器 Asia/Shanghai 自然日为准；跨日读取自动得到新日额度，首次扣减时写入新日期。不能通过清缓存、退出登录或清除学习数据重置。
- 随机题目非空且准备完成后，云端事务同时完成额度校验、扣次和固定题目授权。授权成功即建立一轮练习；页面浏览、首页/设置页预检、空题库不扣次。
- 连点共用进行中的请求；请求失败保留已准备题目和 sessionId，重试同一个云端授权。授权前不会保存新的正式练习。
- requestId 与 sessionId 必须相同。同一会话/相同题目重试不扣次；更换题目或请求标识冲突拒绝。
- 恢复已授权的未完成练习不重复扣次。上线前的旧随机会话第一次继续时会云端登记并占用一次额度，随后恢复不再扣次。已交卷结果回看不扣次。
- 会员到期精确到服务器时间；isMember 是读取时从 expires_at 推导的值，不使用可能过期的数据库布尔标记。未到期续费从原 expiry 加六个月；已到期从微信支付成功时间加六个月。目标月无对应日则取月末。
- 支付回调和查单可乱序。服务端在权益文档内保留 `renewal_base`（首次结算时已有权益快照或 null）及 `renewal_payments`（已确认订单号和归一化付款时间），按付款时间、订单号稳定排序重放每次六个月延期，使最终权益与通知到达顺序无关。这些字段不返回客户端，也不进入学习数据。

## 数据模型

| 集合                        | 文档键与关键字段                                                                                                                                     | 用途                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| member_entitlements         | account_key；starts_at、expires_at、updated_at                                                                                                       | 权益时间，读取推导 isMember                 |
| member_usage                | account_key；free_date、free_used                                                                                                                    | 当前自然日已使用免费次数                    |
| member_practice_grants      | account_key:session_id；session_id、request_id、question_ids、created_at                                                                             | 固定题目序列授权及扣次幂等                  |
| member_orders               | 固定32位商户单号；account_key、app_id、open_id、request_id、amount、currency、status、paid_at、transaction_id、created_at、next_check_at、updated_at | 订单与支付状态；同用户同request确定同订单号 |
| member_payment_transactions | 微信transaction_id；order_id                                                                                                                         | 交易号唯一锁，与开通事务一起提交            |

member_entitlements 另含 `renewal_base: { starts_at, expires_at } | null`、`renewal_payments: { order_id, paid_at }[]`。历史与订单、权益、交易号锁同事务保存；不得单独清理重放历史或从聚合到期时间倒推旧订单。当前未部署、没有历史付款迁移；若将来导入旧系统已付款订单，需先明确基准覆盖范围，不能把已计入基准的订单重复导入历史。

五个集合全部禁止客户端直接读写。会员查询返回经裁剪的状态和本用户订单，不返回其他用户或支付密钥。正式上线前按部署文档创建集合和索引。

## 统一调用

`appServices.membership` 提供 getStatus、checkPermission、startRandomPractice、validateRandomPractice、recoverOrders、purchase、queryOrder。前四者统一供首页、随机设置、练习恢复及后续功能复用。

云端 checkPermission 的 randomPractice 允许会员或有免费额度用户；fullPractice/memberFeature 是预留的会员权限键。未知权限拒绝。后续增加付费功能时，必须在提供功能数据的云函数里复用权益校验；仅页面调用 checkPermission 不能替代服务端保护。

本地会员信息只能显示。待处理订单/随机授权缓存仅用于重试标识，每次均向服务器校验。现有题目内容仍随包提供，无法阻止拆包读取题目或修改整个客户端代码；若将来需要内容级防提取，须另行迁移受限题目到服务端，这不在此次最小改动范围。

## 支付与异常

1. 事务先建立 PENDING 订单，提交后才调用微信 JSAPI 下单，避免外网失败或事务重试留下无法识别的付款。
2. 服务端签名生成 wx.requestPayment 参数。取消、失败、成功均不直接修改权益；前端查单取得服务端确认。
3. HTTP 回调验证原始报文签名、证书/公钥序列号和时间窗，AES-256-GCM 解密后验证交易状态、AppID、商户、付款人、金额/币种、订单号、交易号及付款时间。
4. 订单 PAID、会员延期、交易唯一锁在同一数据库事务提交；重复回调和主动查单并发不会重复延期。
5. 未确定结果保留 PENDING，显示订单号与手动检查按钮，再入会员页恢复查单。支付取消后可重用同订单继续支付。
6. 十分钟定时补偿按 next_check_at 查到期订单，每批五单，先事务标记下次检查再查询。失败单不阻断后续订单；失败/关闭状态不赠送会员。
7. 支付配置缺失或无效时支付关闭；会员状态与额度服务仍可独立运行。云函数未部署/网络不可用时随机练习不能开始，基础浏览和其他现有练习不受该服务阻断。

## 文件影响

- 新增：cloudfunctions/membership（后端、支付适配器、HTTP/定时入口、配置样例与权限规则），会员 types/client/service/presenter、随机授权重试服务、membership-prompt 组件、针对性测试。
- 接入：app-services；home/profile；random-settings/member；practice/report/answer-sheet 的相关文件；原页面测试夹具及会员占位断言。
- 包体积：复用现有 gzip/fflate 方式压缩生成的 runtime-knowledge-catalog，同步修改生成脚本，解码后的目录对象保持一致；没有降低 1.5 MiB 主包预算。
- 不执行云部署、生产数据库写入或真实扣款；工作区其他既有未提交变更保留。

## 上线前验收

开发者工具/真机需验证：免费第1至3轮、第4轮提示、重新登录额度不变、跨北京时间零点、会员开通/续费、支付取消重试、断网后订单恢复、重复回调、两笔订单并发、到期后重新限次，及章节/错题/收藏/模拟考试/解析/交卷回看。测试支付应使用独立环境；上线前先完成后端与权限配置再发布限制入口。
