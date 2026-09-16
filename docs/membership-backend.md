# 会员云函数配置与部署

**当前执行基线（2026-09-08）：** `membership-staging-d7c032b6e3273 / membership` 已于 11:11:59 通过控制台直接上传标准 ZIP 部署新版，真实状态查询和原 session 授权验证均通过，未重复扣次。该环境由 develop/trial/release 共用；环境名不代表与客户端隔离。支付配置返回可用，但真实付款、通知、恢复与续费尚未完成验收。详见[最新部署证据](qa/2026-09-08-membership-deploy-incident.md)；下文旧日期的部署状态仅作历史记录。

后续部署和回滚只能在原环境的云控制台直接上传经过 CRC、路径及源码核验的标准 ZIP，普通部署并保留回滚包与原配置。禁止 Windows CLI deploy/cloud_fn_deploy、上传文件夹、解压后重打包和云端重新安装依赖。状态 Active 或 HTTP 200 不能代替真实业务验收；已通过且未受改动影响的原 session 验证不需要重新消费练习次数。

**历史记录（2026-09-06，部署状态已被上述 09-08 基线更新）：** 用户确认个人主体、虚拟支付已解锁。接入改为个人道具直购，配置以[个人会员虚拟支付接入](membership-virtual-payment.md)为准。以下第 2 节普通 JSAPI 密钥及第 3 节 API v3 回调说明保留为历史，不能按其启用本会员收款。当时 staging 仍为 2026-09-05 21:29:54 的支付关闭版，本地适配尚未部署。

历史上，会员函数首次部署至 `membership-staging-d7c032b6e3273`（上海）时真实支付关闭。2026-09-05 读回 Node.js 20.19、60 秒、256 MB、五集合 ADMINONLY 权限及两条订单索引；当时联调状态见 [验证记录](qa/2026-09-05-membership-validation.md)。

**支付适用性更新（2026-09-05）：** 已读取[微信官方虚拟支付指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)，解锁功能、付费功能等虚拟商品在所有终端均须接入小程序虚拟支付。当前半年会员属于此类数字权益，现有普通 JSAPI 方案不能直接启用收款。下文商户密钥和 API v3 回调配置仅描述当前实现，暂停实际配置；先核对主体及“虚拟支付”开通状态、明确支付适配范围，详见[最新执行决定](qa/2026-09-05-membership-release-plan.md)。会员、额度、授权和定时器已完成的验收不因此回退。

## 1. 数据库

在云开发控制台数据库中创建以下五个集合：member_entitlements、member_usage、member_practice_grants、member_orders、member_payment_transactions。

对每个集合依次进入「权限设置」→「自定义安全规则」，粘贴 `miniapp/cloudfunctions/membership/database.rules.json` 的完整内容：

```json
{ "read": false, "write": false }
```

这是适用于每个集合的 CloudBase 规则模板，并非自动部署清单；必须对五个集合逐个保存。它拒绝客户端直接读写，云函数使用服务端 SDK 访问。

在 member_orders 添加普通复合索引：`status ASC, next_check_at ASC` 及 `account_key ASC, status ASC, next_check_at ASC`。订单幂等由确定性商户订单文档键实现；微信交易号幂等由 member_payment_transactions 文档键实现，不需要 nullable transaction_id 唯一索引。不要把学习数据清除接口连到这些集合；会员和计数应保留独立生命周期。

## 2. 商户参数

以下参数只在云函数环境变量/密钥管理中设置；`.env.example` 是格式说明，程序不会自动读取本地 .env 文件。

| 参数                         | 含义                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------- |
| MEMBERSHIP_PAYMENT_ENABLED   | 缺省关闭；配置核验完后设 true                                                   |
| WX_APP_ID                    | 当前小程序AppID；必须与SDK可信APPID一致                                         |
| WX_PAY_MCH_ID                | 已开通小程序JSAPI支付并与AppID绑定的商户号                                      |
| WX_PAY_MERCHANT_SERIAL       | 商户API证书序列号                                                               |
| WX_PAY_MERCHANT_PRIVATE_KEY  | 商户RSA私钥PEM，可用字面量 `\n` 换行                                            |
| WX_PAY_API_V3_KEY            | 32字节APIv3密钥，用于通知资源解密                                               |
| WX_PAY_NOTIFY_URL            | 指向membership云函数HTTP入口的公网HTTPS完整URL                                  |
| WX_PAY_PLATFORM_CERTIFICATES | JSON字典：平台证书序列号或公钥ID → 对应PEM证书/公钥；可同时保留新旧键以支持轮换 |

不把私钥、API密钥或实际证书配置提交到仓库或小程序包。回调公钥ID必须与 Wechatpay-Serial 一致。配置无效时支付不会启用。当前实现为普通商户小程序 JSAPI 支付；商户服务类目及各终端渠道需在微信商户/公众平台开通对应能力，尚未实现另一套虚拟支付协议。

## 3. 云函数、回调与定时器

后续重新部署时明确选择已建立的测试环境 `membership-staging-d7c032b6e3273`。当前小程序全局云配置用于已有账号同步，不能直接将“当前项目环境”视为独立测试环境。package-lock.json 固定依赖解析版本。

本机 Windows 微信开发者工具 CLI 上传的 ZIP 已实测出现反斜杠文件名，Linux 无法解析 lib 和 node_modules 目录，导致入口退出。**不要再用该 CLI 上传 membership 代码包（含增量上传），也不要让控制台自行压缩 Windows 文件夹。** CLI 的环境查询、配置读取可继续使用。

在 worktree 根目录生成标准 ZIP，再到函数「函数代码 → 上传代码 → 点击选择 → 选择压缩包」上传，选择普通「部署」，保留包内锁定依赖，不使用云端重新安装依赖的选项：

```powershell
npm ci --prefix miniapp/cloudfunctions/membership --ignore-scripts
New-Item -ItemType Directory -Force dist | Out-Null
.\.venv\Scripts\python.exe miniapp/scripts/package-membership-cloud-function.py --output dist/membership.zip
```

脚本只打包 index.js、package.json、package-lock.json、lib 和 node_modules，使用正斜杠 ZIP 路径，校验 SDK 版本和归档完整性后原子替换输出。上传前核对包含 `lib/cloud-store.js` 和 `node_modules/wx-server-sdk/package.json`，没有反斜杠条目。规则、触发器配置和 `.env.example` 不在部署包中；真实密钥仅配置于云端，不能放入归档。

云函数执行超时时间配置为60秒；单个微信HTTPS请求超时10秒，补偿每批最多五单。HTTP回调应快速返回，正常仅验签、解密和单事务处理。

为该函数启用HTTP访问服务，绑定一个固定回调路径，填入 WX_PAY_NOTIFY_URL。网关必须透传原始请求字符串或Base64字节及完整 Wechatpay-* 头；不要将JSON先解析再序列化。HTTP只接受POST；即使是合法JSON，对象形式body也会被拒绝。成功事务返回HTTP200，失败返回非200让微信重试。

部署同目录config.json的定时触发器 membership-reconcile-pending（十分钟一次）。调度入口同时检查运行时 `TRIGGER_SRC=timer` 与固定触发器名，SDK调用者无法仅伪造事件字段执行全量查单。部署后由平台实际触发并核对执行结果，确认当前云环境确实提供该运行时标记；不能用控制台伪造事件代替真实调度。若平台版本不提供，需配置可信调度入口，不能改为信任客户端event字段。

staging 已观察到暖容器中的真实 timer 仍带 SDK OPENID，因此不能把“OPENID 为空”作为定时器必要条件。来源以平台注入的 TRIGGER_SRC 为准，仍须同时满足 Type=Timer 和固定 TriggerName。已用同一容器验证真实 timer 后客户端调用的来源标记恢复为非 timer，伪造事件被拒绝；不清理或改写身份环境变量。诊断仅记录布尔条件和处理数，不打印上下文或密钥。

本轮开发者工具 CLI 首次创建函数实际使用 Node.js 16.13、3 秒，且未创建 config.json 中的触发器。因此先在控制台创建普通云函数，明确选择 Node.js 20.19、60 秒，再上传上述标准 ZIP；另外在控制台保存定时配置。每次部署后读回实际运行时、超时、支付开关和触发器，并以显式 staging 的 getStatus 调用验收启动，不能只看上传成功。不要通过在线编辑器把模板或未部署草稿覆盖到已验证的业务代码。

## 4. 上线顺序与联调

1. 独立云环境建立集合、逐集合权限与两条查询索引。
2. 部署会员云函数、环境变量、HTTPS回调和定时器。
3. 不开启真实支付前检查状态查询和自然日三次额度（网络失败必须拒绝新随机练习）。
4. 开启商户测试配置，真机核验下单、取消后重付、回调先/后于前端、查询补偿、重复通知及未到期续费。
5. 验证清学习数据和登录切换不会删掉额度/会员；旧未完成随机会话首次登记会占用一次当日额度。
6. 后端与权限验证通过后再发布小程序，避免先发布前端限制导致旧用户无法进行随机练习。

有未确认订单时，通过订单号查 member_orders 与微信商户平台核对；只重查/重放已验证通知，不手动伪造前端支付成功或直接延长到期时间。密钥轮换期间保留当前仍有效的验签公钥，确保旧通知能验证。

会员延期现按服务端 `renewal_payments` 的付款时间稳定重放，和 `renewal_base`、订单 PAID、交易号锁同事务提交，不受通知先后影响。无需增加集合或索引；本轮测试环境为首次部署，无历史付款迁移。不要单独清理这两个权益字段。独立云环境不等于支付沙箱，真实 JSAPI 下单和扣款必须单独确认。具体分阶段操作见 [上线前执行清单](qa/2026-09-05-membership-release-plan.md)。

## 5. 已知验证限制

独立 staging 已实测免费额度与授权事务：四个请求最终只有三个授权、额度为三，重复启动和恢复不扣次，篡改题序及超限拒绝。批量原始响应因自动化超时未收齐，结果由同一批会话逐项核实。真实商户配置、回调公网路由、订单结算云事务和真机支付尚未联调。单元测试使用可回滚的内存事务并使用真实RSA/AES加解密覆盖报文验证，不能替代部署环境验收。

当前复用既有 accountSync 的 wx-server-sdk 4.0.2。本次对锁定依赖执行 npm audit，报告6项传递依赖告警（1项中、5项高，涉及旧axios及lodash.set/unset）。未使用 npm audit fix --force 降级整个微信SDK；支付直连使用Node HTTPS/crypto，不使用axios。上线前需要核对SDK供应方修复版本并做兼容验证，该依赖审计尚未通过。

接手后联网复查仍为同样 6 项。已查询的 CloudBase SDK 3.18.x 仍带旧 axios/database 依赖；不能仅替换它就声称修复。axios 0.28.1 也仍受部分公告影响，不采用该候选覆盖；lodash 两个拆包未找到直接安全升级版本。SDK 官方包源码中的 lodash 调用位于 realtime，当前会员不使用该能力，客户端也不提供字段更新路径；这是调用面限制，并非审计通过。保持锁文件不变，正式启用支付前需完成兼容修复验证或另行形成明确的风险处置决定。

参考：[微信支付回调文档](https://pay.wechatpay.cn/doc/v3/merchant/4012791902)、[签名与验签](https://pay.wechatpay.cn/doc/v3/merchant/4012365352)、[CloudBase数据库安全规则](https://docs.cloudbase.net/database/security-rules)。
