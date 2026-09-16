# 上线前细节优化与会员检查（2026-09-07 至 09-08）

工作目录：`D:\文档\保管员刷题小程序\.worktrees\warehouse-question-classification\miniapp`，已通过开发者工具项目列表核对。本报告区分本轮修复、既有实现、本地测试与真实云端结果。未上传体验版、未部署云函数、未发起真实会员订单或付款。

## 本次修改内容

本轮文件范围以开始工作时的 `tmp/release-polish-2026-09-07-baseline` 快照比较，不把工作区已有的题库、账号同步、虚拟支付适配等改动计入本轮。

本轮共涉及 49 个源码、测试、依赖/运行时文件，另新增本报告。[逐文件清单](../../tmp/release-polish-changed-files-final.txt)。

| 文件（相对 miniapp） | 本轮内容 |
| --- | --- |
| `miniprogram/custom-tab-bar/index.ts/.wxml/.wxss` | 路由同步、单次切换与最后目标排队、异常释放、触控尺寸与点击反馈 |
| `miniprogram/pages/home/index.ts/.wxml` | 导航锁、离开页面后忽略迟到预检结果、头像失败回退 |
| `miniprogram/pages/library/index.ts/.wxml/.wxss` | 加载失败结束与重试 |
| `miniprogram/pages/practice/index.ts/.wxml/.wxss` | 页内加载、离开后停止更新、答题卡导航超时释放、长文本与底部留白 |
| `miniprogram/pages/answer-sheet/index.ts/.wxml` | 提交/选择题号到跳转完成前防重复、异常和缺失回调释放 |
| `miniprogram/pages/profile/index.ts/.wxml` | 会员状态过期请求隔离、查询失败清除旧显示、头像失败回退 |
| `miniprogram/packages/auxiliary/pages/random-settings/index.ts/.wxml/.wxss` | 失败重试、迟到响应隔离、按钮状态 |
| `miniprogram/packages/auxiliary/pages/learning-report/index.ts/.wxml/.wxss` | 加载失败结束、重试与页面生命周期处理 |
| `miniprogram/packages/auxiliary/pages/member/index.wxml/.wxss` | 半年会员/¥28/6个月文案、购买和查询反馈、触控尺寸 |
| `miniprogram/components/app-topbar/index.ts/.wxml/.wxss` | 原生返回存在时隐藏重复的页面返回，保留单页栈回退 |
| `miniprogram/components/analysis-panel/index.wxss` | 长解析换行、结果层级、减弱装饰与反馈入口尺寸 |
| `miniprogram/components/{empty-state,favorite-button,membership-prompt,theme-toggle}/index.wxss` | 触控区域、对比度、点击态、弹窗可滚动 |
| `miniprogram/styles/tokens.wxss` | 统一较克制的圆角与阴影 |
| `miniprogram/repositories/membership-client.ts` | 登录与云请求合计 12 秒等待边界、消费迟到拒绝 |
| `miniprogram/services/membership-service.ts` | 合并正在执行的会员状态查询，不缓存长期权限 |
| `miniprogram/services/practice-runtime.ts` | 账号/会话隔离，防止旧会话跨账号写入；保留后台同步重建的等价会话 |
| `package.json`、`package-lock.json`、`miniprogram/miniprogram_npm/fflate/index.js` | fflate 升至 0.8.3 并生成匹配的微信运行时 |

测试修改：`tests/answer-sheet-page.test.ts`、`custom-tab-bar.test.ts`、`guest-startup.test.ts`、`home-page.test.ts`、`membership-client.test.ts`、`membership-practice-runtime.test.ts`、`practice-page.test.ts`、`practice-runtime.test.ts`、`profile-account-page.test.ts`；新增 `tests/app-topbar.test.ts`、`tests/practice-loading.test.ts`。本报告为本轮新增文档。

## 修复的问题

- TabBar 原来先更改高亮，再用高亮值拦截同页点击。`switchTab` 失败时没有回退和释放处理，下一次点击可能被错误拦截；快速点击也会同时发起多个切换。
- 首页快速连点、等待权限预检时退出页面，可能重复打开页面或在离开后突然跳转。
- 作答页原来的全局 loading 遮罩可能在页面离开后影响返回页的交互；现改为页内加载状态。
- 答题卡跳转回调缺失时可永久锁住；提交后的锁也需要持续到实际跳转结束。
- 题库、随机设置、学习报告等加载失败需要结束等待并提供重试；会员状态迟到响应不能覆盖新页面状态。
- 实际模拟器发现本轮新增的会话引用检查会把账号同步后内容相同的新对象当作会话变化，导致页面有题目但选项/下一题无效。现改为同 scope 下比较持久内容，新增真实 ProgressService 缓存刷新回归；重新编译后的实际选择、解析和前后翻题均恢复正常。
- 原生导航栏与页面组件同时绘制返回入口，造成重复返回图标。
- 头像加载失败、长题干/解析、小屏操作尺寸等细节已处理。
- fflate 的公告问题通过官方修复版本 0.8.3 解决，项目生产依赖审计现为 0 项。参见 [fflate 修复公告](https://github.com/advisories/GHSA-px8p-9vwx-vf98)。

## TabBar 检查结果

实际三个 Tab 是“首页 / 实操 / 我的”。代码中的上述状态失配和并发切换可由回归测试重现；没有证据把所有偶发失灵都归因于某个透明遮罩。

现在点击立即反馈，同一时间只执行一个 `switchTab`；快速点击保留最后一次目标。是否已在当前页以真实路由判断，组件 attached/show 及切换结束都会同步高亮。success、fail、complete、Promise 拒绝、同步抛错都会释放；1.5 秒 watchdog 只处理回调缺失，并非点击防抖。触控区至少 44px，保留底部安全区。

本地回归覆盖同页点击、连续切换、最后一次点击回到当前页、失败、迟到回调与 watchdog。在实际模拟器中连续触发 5 次 Tab 点击处理器，最终路由和高亮均为首页，栈深度为 1。该结果是模拟器处理器级验证，不能替代真机触屏命中和不同机型压力测试。

最后再次重复同样的 5 次连点仍正常收敛；此前导航压力检查产生的 SDK routeDone 错误没有增加。该错误的触发位置尚未定位，不能据此宣布路由链路完全没有运行时错误。

## UI 优化内容

保持米白、黑色和绿色的现有风格。共用圆角调整为 24/32/40rpx，弱化阴影，保留现有统一边距和字体层级；按钮点击态以轻微透明度变化为主。空状态按钮使用深色文字，主要小按钮补齐 44px 操作尺寸。会员页明确显示“半年会员 / ¥28 / 有效期 6 个月”。

长题干与解析允许换行，解析保留自然分段；作答页固定底栏预留内容和安全区空间；会员弹窗限制高度并可滚动。原生导航栏负责有返回栈时的返回，避免双箭头。

截图证据：

- [首页实际截图](../../tmp/release-polish-random-after.jpg)（文件名来自当时截图步骤，画面实际为首页）。
- [随机练习失败时的实际错误页](../../tmp/release-polish-practice-after.png)：非白屏、没有全局遮罩、可重试。
- [恢复后的作答与解析实际截图](../../tmp/release-polish-practice-recovered.png)。真实页面方法选择 A 后显示解析，实际“下一题”按钮从 1/10 推进至 2/10，再点击“上一题”返回并保留答案。选择题目使用页面处理器调用；前后翻题使用模拟器元素点击，不是手机物理触屏验收。
- [会员页修改后的实际截图](../../tmp/release-polish-member-after.png)：价格、期限、单一返回入口与按钮正常显示。

18 个已注册页面均取得实际打开结果：

| 页面范围 | 实际检查 |
| --- | --- |
| 首页、实操、我的 | 三个 Tab 的路由、高亮一致，页栈均为 1 |
| 登录/账号入口、账号数据、编辑资料、学习设置 | 页面可以打开；未修改资料或清除数据 |
| 题库、章节详情 | 目录结束加载；实际点击章节卡片打开“职业道德”详情 |
| 随机设置、模拟考试说明、实操详情 | 页面可以打开；不额外点击创建练习 |
| 答题、答题卡、报告 | 恢复、作答、解析、前后翻题、答题卡均可用；报告页 ready=true、mode=random，返回首页成功 |
| 题目列表 | 错题和收藏两个参数分别打开，loaded=true、loadError=false |
| 学习报告、会员中心 | loading=false；会员中心 purchasing=false、paymentAvailable=true |

这些是页面打开和局部交互检查，不代表每个页面的所有按钮/异常分支都已在真机执行。报告页按现有路由逻辑提交并记录了本次模拟练习，测试记录与实际免费次数保留。[主要路由采样](../../tmp/release-polish-route-smoke.jsonl)记录了其中的批量打开结果；章节详情、答题和报告的后续结果由工具单独采集。

不同手机尺寸、深色模式全页面、键盘弹出和真机 Home Indicator 尚未完成视觉验收；代码适配存在不等于所有机型实测通过。

## 会员流程检查结果

| 步骤 | 代码和本地验证 | 本轮真实验证 |
| --- | --- | --- |
| 查询身份/会员 | 云端 APPID + OPENID 识别用户；不接受前端自报会员 | getStatus、checkPermission 已成功；当前账号非会员 |
| 创建订单 | 服务端固定 2800 分；请求幂等、账号待支付指针、仅首次新单返回支付参数 | 未发起真实下单 |
| 调起支付 | 现用 `wx.requestVirtualPayment`；有能力检测、取消/失败/未知状态和等待边界 | 未调起真实收银台 |
| 通知与查单 | 校验平台证明、订单/金额/身份；只有权威成功才发权益 | 未验收真实付费通知和公网报文透传 |
| 开通与刷新 | 订单、权益、交易号锁在事务中提交；前端查询确认后刷新 | 本地成功/重复/乱序回归通过，真实会员开通未验证 |
| 到期与续费 | 上海时区加 6 个日历月，月底截到目标月最后一天；有效会员从原到期日顺延，过期从付款时间开始；按付款时间重放避免乱序多发 | 日历/月末/到期边界为本地测试，未真实续费 |
| 成功但前端断网 | 持久化原订单；重进、返回前台、网络恢复后查单；服务端补偿任务 | 本地模拟覆盖，未发生真实扣款后断网验收 |
| 取消后重买 | 不开通、不把取消直接当失败；保留原订单防止重复扣款 | **未完整满足要求：旧单一直 NOTPAY/PENDING 时，后续购买只查旧单** |

取消的剩余问题不能通过删除本地订单或重复拉起旧订单解决。微信官方说明同一 `outTradeNo` 只能用于一次支付调用。需要先确认虚拟支付平台取消后关闭订单的权威状态与安全重买流程，再更改服务器状态机。参见 [wx.requestVirtualPayment 官方文档](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)。当前没有证据证明存在可直接套用的虚拟支付关单 API，不套用普通 JSAPI 的关单接口。

## 每日 3 次免费逻辑

- 服务端 `member_usage` 保存账户、上海日期和当日使用数；`member_practice_grants` 保存幂等练习授权及固定题序。
- 每次**成功开始一轮随机练习**扣一次，不是每道题或交卷扣一次；每轮 10 题。空题库不扣次，重试/恢复同一授权不再扣次。
- 开始时服务端事务检查额度，非会员第 4 次拒绝；会员不扣免费次数。客户端各入口预检用于提示，直接进入作答页仍需服务端授权。
- 日期取服务端时间的 Asia/Shanghai 自然日；新一天按 0 次计算并在下一次成功使用时落库。修改手机时间、删本地缓存、换设备不会改变同一微信账户的服务端记录。
- 本地记录只保存待恢复请求和题序，不能自行授予权限；恢复活动随机练习向服务端验证题序。题库本身在客户端包中，因此不承诺对改包客户端做到题目保密或不可破解付费墙。
- 本地测试覆盖并发限额、重复请求、请求冲突、篡改题序、空题、账号变化、跨日和会员到期。

实际云端过程：23:54 首次 startRandomPractice 显示“会员服务暂不可用”，错误页正常结束等待。随后同一 session 在 2026-09-08 00:00:25 成功生成唯一授权；直接 validate 与再次 start 重放均成功，后两次查询都显示 `freeUsed=1, freeRemaining=2, freeDate=2026-09-08`。针对原失败请求的诊断始终复用原 ID，没有重新创建一批压力测试请求，也没有清空或重置额度。后续重新编译后的界面显示当日剩余 1/3 次，不能把早先的 2/3 当作整个检查结束时余额；保留所有实际练习记录。首次异常的原始云端堆栈尚未取得，不能声称根因已修复；当前 SDK 适配检查未发现确定的缺失文档或事务返回值错误。

这证明一次真实授权及幂等恢复可用；不能据此宣称本轮已在真实账号完成“当天第 1 至第 4 次、多设备、真机跨日”的全套验收。

最终 00:17:46 服务端再次返回 `freeUsed=2, freeRemaining=1, freeDate=2026-09-08, isMember=false, paymentAvailable=true`，与最后页面余额一致。[最终真实会员状态](../../tmp/release-polish-final-cloud-status.json)。

## 尚需我配置的内容

真实 getStatus 当前返回 `paymentAvailable=true`，说明运行环境已通过代码的基础配置开关检查，**不能再把所有支付配置都列为缺失**。没有读取或展示密钥，其值是否正确、产品是否审核通过尚未验证。

1. 在公众平台核对当前主体适用的虚拟支付资格、OfferID、会员 ProductID、商品价格和可售状态；按实际主体使用官方接入流程。当前代码对接虚拟支付，不能笼统要求补一套普通 JSAPI 商户证书。[官方虚拟支付指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)
2. 核对消息推送 URL、Token、EncodingAESKey 及安全模式与云函数一致；验证公网回调能原样传递签名、查询参数和请求体。
3. 核对定时查单任务实际在运行，支付开关和密钥/product 值正确。代码配置为每 10 分钟补偿，用户主动回到会员页可立即查单。
4. 确认 `membership-staging-d7c032b6e3273` 的套餐持续可用，并明确它是否承担体验版/正式版服务；当前 develop/trial/release 都使用此环境。名称带 staging 本身不是错误，本轮没有擅自切换环境。
5. 在允许真实扣款的专用验收账户上完成一次 ¥28 支付、取消重买、成功后断网恢复和续费验收；这些涉及真实支付/部署的操作未在本轮执行。

## 上线风险

| 风险 | 当前结论 |
| --- | --- |
| 取消后长期 PENDING | 阻断完整购买闭环，需要平台权威终态与安全重买方案 |
| 真实支付闭环未验收 | 无法声称已跑通下单、收银台、通知、发权益、恢复与续费 |
| 随机授权首次暂时异常 | 同 session 已恢复、没有重复扣次；原始失败仍需云端日志定位与稳定性复测 |
| SDK 路由错误 | 连续打开/返回页面期间出现 `routeDone with a webviewId 106 is not found`；当前页面已恢复，单独复测 Tab 连点没有新增同类日志，触发位置仍需定位 |
| 云函数传递依赖告警 | accountSync 和 membership 各 6 项（5 高、1 中），主要涉及微信 SDK 的 axios/lodash 依赖；没有用自动降级 SDK 或未经验证的 overrides 隐藏问题。告警数量包含传递聚合项，不等于 6 个独立可利用入口 |
| 主包余量较小 | 保留原 1.5 MiB 限额，最终大小见下方验证记录；后续加功能需持续检查 |
| 视觉与设备覆盖 | 已有真实截图和模拟器流程；不同真机、系统支付能力、全部安全区未全部验收 |

早期 Console 查询没有 Error 匹配，但最后导航压力检查出现一组 SDK `routeDone with a webviewId 106 is not found` 和 `appServiceSDKScriptError` 日志；不能写成“Console 无 Error”。单独再跑 5 次 Tab 连点后日志未增加，路由/高亮正常，不足以确定该 SDK 错误根因。[最后 Console 错误采样](../../tmp/release-polish-final-console-errors.json)。

另有全局图标组件的懒加载性能提示和一次启动耗时提示。构建 npm 曾提示 fflate 的 `.cjs.js` 入口识别失败；项目既有 UMD 准备脚本已生成可用文件，文件与 0.8.3 源 UMD 哈希一致，gzip/题库专项通过。这些 Warning 不能写成“Console 完全无警告”。

最终独立 tester 验证（包含最后的真实账号快照回归）：

| 检查 | 最终结果 |
| --- | --- |
| `npm run verify` | 退出码 0；67 个测试文件、590 项测试全部通过 |
| TypeScript、ESLint、Stylelint、Prettier | 全部通过 |
| accountSync 生成文件一致性 | 通过 |
| 主包 | 1,570,430 / 1,572,864 字节，剩余 2,434 字节，未上调预算 |
| auxiliary 分包 | 104,978 / 2,097,152 字节 |
| fflate 运行时 | 0.8.3，UMD 源与微信目标 SHA-256 一致 |
| 题库/gzip 专项 | 11 文件、89 项通过；最终仅会话比较改动后由全量 verify 再覆盖 |
| 根项目生产依赖审计 | 0 项，退出码 0；不包含另有告警的两个云函数依赖树 |
| 最终只读审查 | 最新快照修复没有新增 P1/P2；既有取消后 PENDING 风险仍保留 |

证据：[最终 verify](../../tmp/2026-09-08-release-polish-final-verify.log)、[最终包体](../../tmp/2026-09-08-release-polish-final-metrics.log)、[题库专项](../../tmp/2026-09-07-release-polish-question-runtime-regression.log)、[前端生产依赖审计](../../tmp/2026-09-07-release-polish-final-npm-audit.log)、[含云函数的依赖审计](../../tmp/2026-09-07-release-polish-npm-audit.log)。

## 最终结论

**暂时不要提交。** 先解决取消后待支付订单无法安全重新购买的问题，处理或明确接受云函数依赖风险，并在确认当前配置和部署版本后完成真实支付闭环及真机验收。首次随机授权异常和最后的 SDK 路由错误也需要完成稳定性复核与原因定位。

本轮完成的是本地细节修复、回归验证和真实环境排查；没有将模拟支付或本地测试当作真实付款成功。
