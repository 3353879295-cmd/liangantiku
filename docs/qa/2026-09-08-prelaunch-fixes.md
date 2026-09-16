# 2026-09-08 上线问题修复与验证

本报告记录本轮新增修复。上一轮 `2026-09-07-prelaunch-polish.md` 保留原样。时间均为北京时间，云函数 `serverTime` 原始值为 UTC。

## 结论

**暂不建议提交用于完整上线验收的体验版。** 本轮已完成本地代码修复、全量回归、独立测试、只读审查和开发者工具验证，但长期待支付订单仍受平台权威终态限制；云端尚未部署工作区的订单保护和本轮诊断；真实支付、通知、恢复与续费没有完成验收。首次随机授权失败还缺原始云日志，SDK 路由错误还需真机对照，云函数依赖告警仍存在。

本轮没有上传小程序、部署云函数、调用真实支付、创建真实会员订单、触发定时补偿、清空或重置练习记录。只读云请求包括 `getStatus` 和已有 session 的 `validateRandomPractice`。没有把 Mock 支付标为真实付款通过。

## 1. 环境与基线

- 实际工作区：`D:\文档\保管员刷题小程序\.worktrees\warehouse-question-classification`；实际小程序目录为其 `miniapp`。用户消息路径中省略的目录分隔符已核实，没有使用根目录另一份小程序。
- 微信官方 `wechatide` CLI 的 `project_list` 确认当前打开此项目，AppID 为 `wx84ecacec08ca162c`，页面品牌标题为“粮安题库”。既有已授权客户端 `codex-release-audit` 可用，登录有效，安装的 CLI skill 为 0.3.5。
- 搜索实际目录及父级没有发现磁盘 `AGENTS.md`，执行用户本轮提供的固定角色规则。使用 scout 定位、implementer 修改、tester 独立验证、reviewer 只读审查；没有使用通用子智能体。
- 修改前于 00:34:26 保存 HEAD `266b955593e4c3e1f7a27223dc9d37313e36f9f9`、完整 Git 状态、已有 diff，以及 386 个工作文件的内容、字节数和 SHA-256：[基线目录](../../tmp/prelaunch-fix-2026-09-08/baseline/metadata.json)。比较对象是这个工作区快照，不能把相对 HEAD 的全部差异算成本轮成果。
- 原有 TabBar、导航锁、加载状态、同步后的答题按钮修复和 fflate 0.8.3 均为已有工作，本轮保持回归，不作为新增成果。题库和学习数据文件未修改；原有 `dist_verify`、旧 ZIP 等未清理。
- 最新文件差异索引：[本轮相对基线的变化](../../tmp/prelaunch-fix-2026-09-08/final-baseline-delta.json)。新增业务模块只有会员诊断模块；其余集中于会员支付、账号入口导航及相关测试。

## 2. 取消支付与安全重买

### 官方状态边界

本轮查阅微信虚拟支付官方文档，使用的方案是 `wx.requestVirtualPayment`，不是普通 JSAPI 支付：

| 证据 | 权威含义及本项目处理 |
| --- | --- |
| 客户端 `-2` | 用户取消本次支付操作；它本身不能证明服务端订单已经关闭，不能据此授予会员或清除待支付指针。 |
| 每个 `outTradeNo` 只能使用一次；`-15002` | 不得再次拉起旧交易号；只有创建新订单后才使用新的交易号。 |
| `-15012` | 文档描述米大师下单失败且订单已关闭；本项目仍通过服务端权威查询协调订单，不把客户端结果直接写成服务端终态。 |
| 查单状态 `0` | 订单初始化、尚未成功创建、当前不可支付；不等于永久关闭，不能用它证明旧订单未来绝不再生效。 |
| 查单状态 `1` | 订单已创建。本项目映射为 `NOTPAY`，服务端保留 `PENDING`。取消回调与此状态并存时仍不释放订单。 |
| 查单状态 `2/3/4` | 已付款及后续发货状态；必须继续校验订单身份、金额、环境等，再幂等发放权益。 |
| 查单状态 `6` | 已关闭、不可再支付。本项目按权威终态关闭本地订单并释放匹配的待支付指针，然后允许用户明确点击重新购买。 |
| 查询失败、断网、未知或退款处理中的状态 | 不伪造未付或关闭，不重新拉起旧号；保留查询和恢复能力。退款状态沿用既有处理，不视为新支付成功。 |

来源：[支付客户端 API](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestVirtualPayment.html)、[虚拟支付查单 API](https://developers.weixin.qq.com/miniprogram/dev/server/API/VirtualPayment/api_query_order)、[虚拟支付能力及服务端 API](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment.html)、[个人主体接入指引](https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/business-capabilities/virtual-payment/person.html)。官方 HTML 留存在本轮 `tmp` 证据目录。

公开的现金直购接口列表提供查单、退款和发货等能力，未找到适用于本项目的现金订单主动关闭接口。`cancel_currency_pay` 属于代币扣款回退，不能当成现金关单；普通 JSAPI 关单接口也不能套用。文档没有承诺取消后多久必然进入关闭状态，因此不能靠任意等待时长证明可以重买。

### 实际修复

1. `membership/lib/handler.js`：虚拟支付确认关闭时，在事务内同步关闭仍为 `PENDING` 的订单，并且仅在账号待支付指针仍等于该订单号时释放指针。旧订单查询不能清掉并发创建的新订单；普通 JSAPI 适配器不误调用虚拟支付专用的账号指针逻辑。
2. `membership/lib/virtual-payment.js`：官方查单响应里的 `coupon_fee` 标为“暂无此字段”，原实现把缺失字段也当成金额不符。现在允许字段缺省或数值 `0`，仍拒绝 `null`、字符串和非零值；订单号、主体、环境、实际金额、退款金额等校验保持严格。否则真实已支付订单可能因合法缺省字段而不能开通。
3. 会员页：取消提示说明本次操作已取消、旧订单仍待平台确认；不对已是会员的续费用户误报“未开通会员”。待支付时显示“核对支付结果”和复制订单号入口，剪贴板失败不会产生未处理 Promise rejection。确认关闭后才进入下一次明确购买操作，不自动弹出新支付。
4. 本轮没有删除本地待支付订单、设置任意关单超时、伪造服务端终态、重放旧 `outTradeNo`，也没有新增价格、次数、续费规则或数据库结构。

### 验证与残余限制

本地测试覆盖取消不发权益、`NOTPAY` 不新建、不重签旧号、确认关闭后使用不同交易号、旧查询不清新指针、通知/查询幂等、恢复、金额与身份校验以及已是会员的取消文案。这些全部是本地模拟验证。

**长期 `NOTPAY/PENDING` 的自动重买仍未完全解决，不能宣称本轮取消后总能立即重买。** 可以实施的替代流程是保留订单号与查单入口 → 用户复制订单号，通过小程序右上角反馈联系维护者 → 维护者按虚拟支付后台核对订单并提交平台订单问题 → 平台查单明确返回已关闭后，现有代码自动释放正确指针，用户重新购买。不能承诺平台人工处理时效，也不能假定后台存在一个未核实的“强制关单”按钮。

如果平台确认本主体/模式长期不提供关闭或可靠终态，就需要平台提供适用的关闭能力或调整已审核的交易流程；在此之前，本地不能同时保证“立即重买”与“未知订单绝不重复扣款”。此项仍是购买闭环阻断。

## 3. 随机练习首次授权偶发失败

### 已获取的证据

- 原 session 为 `random-1788796485987-hvtamvcpezc-wy7w2tafa`，其时间对应 2026-09-07 23:54:45.987；上一轮成功恢复已到次日。没有原始失败 RequestID/云日志，不能确定第一次事务是提交前失败，还是提交成功但客户端没有收到响应，也不能证明由事务中的 `Promise.all` 引起。
- 从运行环境只读下载线上 `membership`，随机授权相关代码与本轮基线一致。线上与基线的差异集中在既有订单处理/账号指针逻辑，不能拿订单版本差异解释随机首次失败。
- 本轮真实 `getStatus`：00:42:38，809ms，RequestID `70acec9e-793f-43f5-9987-925a280e75d7`；返回 `isMember=false, freeUsed=2, freeRemaining=1, freeDate=2026-09-08, paymentAvailable=true`。[证据](../../tmp/prelaunch-fix-2026-09-08/live-status.json)
- 本轮对原 session 调用真实 `validateRandomPractice`：466ms，RequestID `f7c71ad1-8a34-4e2e-8357-79491b474b05`，原授权可验证，额度保持 2/1。[证据](../../tmp/prelaunch-fix-2026-09-08/live-validate.json) 没有重新调用 `startRandomPractice` 去制造新的云写入或消费次数。
- 最终 01:25:06 再次只读核对：455ms，RequestID `969316aa-c6e4-472b-8d3f-f732725859d9`，仍是非会员、已用 2 次、剩余 1 次、支付基础配置可用。[最终状态](../../tmp/prelaunch-fix-2026-09-08/final-live-status.json)

### 实际修复

新增 `membership/lib/diagnostics.js`，固定部署标记 `membership-random-diagnostics-20260908-v1`，记录开始/完成/失败、校验或事务阶段、耗时、白名单错误码和 session 的截断 SHA-256。本地源码和待部署包已接入日志入口，部署后才会写入云日志；业务仍使用原有事务，不拆分“扣次数”和“创建授权”。日志异常不会影响业务结果。

客户端在原有单次 12 秒截止时间内，区分登录、传输、响应阶段，保留符合 UUID 格式的云 RequestID、安全业务码和数字 SDK 错误码，并区分超时。消费异步拒绝、正确清理计时器，保留原始 SDK 错误用于分类；没有增加重试次数、放大超时或依靠重试掩盖未知原因。

日志不记录 OpenID、原始 session、题目、签名、密钥、原始错误 message 或 stack。本地缓存仍不能授予会员权限。已有原子性、同请求幂等、跨设备同账号额度、空题不扣次、会话恢复测试继续通过。

**诊断能力已补齐，但历史失败根因尚未证实，不能把新增日志说成已经治愈首次授权故障。** 微信 CLI 支持函数列表、信息和下载，没有可用的云日志读取操作。本轮没有假装取得云端异常堆栈。

需要后台补充的准确步骤：打开此项目的“云开发” → 选择 `membership-staging-d7c032b6e3273` → 云函数 → `membership` → 日志；筛选北京时间 9 月 7 日 23:54:40–23:55:10（若控制台按 UTC，使用 15:54:40–15:55:10），找 `startRandomPractice` 对应调用，提供 RequestID、执行耗时、错误码及脱敏堆栈。不要提供 OpenID、支付签名或密钥。如果历史日志已过保留期，部署诊断版本后在专用验收账号进行首请求复现并关联客户端 RequestID。

## 4. 导航与 SDK 路由错误

### 可确定的代码问题与修复

账号入口多个游客退出入口可在同一时序内重复发起返回，旧测试甚至断言返回两次；异步 `navigateBack.fail` 在页面卸载后还可能把用户切回首页。这些是可由单元测试确定的竞态，但尚不能证明就是上轮 webview 106 错误的唯一原因。

本轮将账号入口退出集中为每页面一次的离开动作，使用本次动作身份校验、页面是否卸载/是否仍在顶层的检查、3 秒释放看门狗及单次回首页兜底；旧操作的迟到失败不能影响后来的导航。自动返回从 `onLoad` 排队到 `onReady`，避免页面尚未进入栈就判定“不是当前页”而丢失退出。

对“上一页已是首页”的自动返回进一步使用返回上一页路径，避免向已显示的相同 Tab 再次发起切换；其他来源仍返回首页。此分支的本地测试通过，但下面的运行时复测仍有栈观测差异，不能声称自动返回已彻底解决。没有更改既有 TabBar 的最后点击目标、统一高亮、异常释放规则，也没有屏蔽 SDK 错误。

### 复现方法与证据边界

1. 编译后等待实际 `getCurrentPages()` 为首页、`loading=false` 且页面方法存在；`simulator_refresh`、`simulator_open_page` 的成功仅代表触发编译，不能马上连续下发操作。
2. 从真实首页方法进入会员页，等待加载完成，返回后单独读取页面栈；同样依次打开随机设置、学习报告并返回。每一步确认当前 route，不能用固定间隔的大批量导航直接当作通过。
3. 连续调用真实 TabBar 事件：首页 → 实操/我的/首页/我的/首页，等回调与看门狗窗口结束，读取最后 route 与高亮。
4. 从首页进入无 `mode` 的账号入口，记录 `onReady`、自动退出、`success/fail/complete`、`onUnload`、页面栈和截图；再从非首页来源对照。真机上复用相同步骤，关闭自动化后人工对照，才能区分产品竞态、自动化时序和基础库行为。

本轮第一组最终实测：会员页可见真实 ¥28/6 个月、`loading=false, purchasing=false, paymentAvailable=true`；会员页、随机设置和学习报告分别返回首页；5 次 Tab 连点最终首页、高亮 `/pages/home/index`。[会员页截图](../../tmp/prelaunch-fix-2026-09-08/member-user-entry-final.jpg)、[返回](../../tmp/prelaunch-fix-2026-09-08/member-back-final.json)、[随机设置](../../tmp/prelaunch-fix-2026-09-08/random-settings-final.json)、[学习报告](../../tmp/prelaunch-fix-2026-09-08/learning-report-final.json)、[Tab 连点](../../tmp/prelaunch-fix-2026-09-08/tab-burst-final.json)。未开始新练习或修改答案。

发现一个稳定的对照现象：自动返回后截图已是首页，但自动化读到 `[home, account-entry]`；直接调用同一首页 `switchTab`，同一次 evaluate 收到 success/complete 均为 `switchTab:ok`，栈却仍保留账号入口。改切其他 Tab 后栈恢复为单页。[相同 Tab 回调证据](../../tmp/prelaunch-fix-2026-09-08/direct-switch-callbacks.json)、[其他 Tab 对照](../../tmp/prelaunch-fix-2026-09-08/direct-different-tab-callbacks.json)。这是调整上一页为首页时返回方式的具体依据，不能据此笼统宣称开发者工具故障。

最终导航版本复测仍保留两类结果：不加诊断包装的自动返回，等待 2.5 秒仍读到账号入口残留，因此立即停止后续循环，没有把失败计为三轮通过；一次官方自动化 `navigateBack` 还返回 `Uncaught [object Object]`，随后独立读取栈为首页。临时包装返回 API 以记录原始回调、并在 finally 恢复原函数后，明确记录到应用调用一次 `navigateBack`，success/complete 均为 `navigateBack:ok`，回调当下栈尚未清理，2.5 秒后栈为仅首页。包装可能改变时序，所以这次成功不能抵消未包装样本的失败。[未包装复测](../../tmp/prelaunch-fix-2026-09-08/auto-return-unwrapped-repeat.json)、[临时运行时取证](../../tmp/prelaunch-fix-2026-09-08/auto-return-runtime-trace.json)。没有把临时包装留在代码中，也没有继续增加任意延迟来掩盖现象。

因此当前更窄的残余问题是“账号入口自动返回期间，API 成功/画面返回与页面栈清理有不一致样本”，而非已确定的“TabBar 连点有错”或“开发者工具本身有错”。应在 Sources 断点记录 `onReady → navigateBack/switchTab → onUnload` 与入页导航 complete 的顺序，并在真机无自动化条件下对照。当前 CLI 能观测回调和栈，尚不能提供原生路由调度堆栈。最后恢复到首页后，再次运行既有真实 TabBar 五连点，栈与高亮均正常：[最终 Tab 回归](../../tmp/prelaunch-fix-2026-09-08/tab-burst-navigation-final.json)。

测试脚本曾误把非 Tab 的 library 页用于 `switchTab`，该失败已识别为脚本错误，不计为产品故障；即时编译后调用旧上下文曾出现方法不存在/自动化超时，也没有计为通过。原先 `routeDone with a webviewId 106 is not found` 记录保留，没有抹去或过滤后假装不存在。

最终编译后的完整 Console 样本没有新的 error，但有基础库 3.17.0 的全局组件懒加载和启动耗时警告；此前采样还出现 `getSystemInfoSync` 弃用警告。网络 `fail` 查询未命中，这仅覆盖当前模拟器捕获窗口，不等同于全部网络链路没有异常，也不抹去上述自动化错误。[最终 Console](../../tmp/prelaunch-fix-2026-09-08/navigation-final-console-all.json)、[此前 Console](../../tmp/prelaunch-fix-2026-09-08/final-console-all.json)、[最终网络错误采样](../../tmp/prelaunch-fix-2026-09-08/navigation-final-network-errors.json)。真机与原 webview 106 错误仍需复核。

## 5. 云函数依赖安全

重新审计：前端生产依赖 0 项；`accountSync` 和 `membership` 各 6 项（5 高、1 中），包含聚合传递项，不能描述为 6 个独立可利用入口。[前端](../../tmp/prelaunch-fix-2026-09-08/audit-miniapp.json)、[accountSync](../../tmp/prelaunch-fix-2026-09-08/audit-accountSync.json)、[membership](../../tmp/prelaunch-fix-2026-09-08/audit-membership.json)。

两棵树均为 `wx-server-sdk@4.0.2` → `@cloudbase/node-sdk@3.17.2`，包含 `axios@0.27.2`、`@cloudbase/database@1.4.3` 以及 `lodash.set@4.3.2`/`lodash.unset@4.5.2`。本轮核对发布元数据：微信 SDK 稳定版仍为 4.0.2；4.0.3-beta.1 的 CloudBase 3.18.5 仍使用相同问题依赖；直接改用 CloudBase 4.1.0 也没有消除该 axios 版本问题。

- Axios 绝对 URL 相关安全问题需兼容修复版本，官方通告列出 0.x 分支修复为 0.30.0。当前传递依赖的版本范围并不能自然升级到它。[官方通告](https://github.com/advisories/GHSA-jr5f-v2jv-69x6)
- `lodash.set` 独立包没有适用的已修复发布版本。[官方通告](https://github.com/advisories/GHSA-p6mc-m468-83gw)
- `lodash.unset` 的原型污染告警仍存在。[官方通告](https://github.com/advisories/GHSA-f23m-r3pf-42rh)
- [微信 SDK 官方变更记录](https://raw.githubusercontent.com/wechat-miniprogram/wx-server-sdk/master/CHANGELOG.md)。

本项目支付请求使用自有 Node HTTPS/HMAC 流程，不直接走 axios；SDK 用于身份、数据库事务、文件等能力，业务没有把用户提供的任意绝对 URL 交给 SDK HTTP 客户端。数据库属性路径处理仍是依赖风险面，不能据此证明不可利用。

没有执行 `npm audit fix --force`，没有接受其降级到 2.5.3 的建议，没有添加未经验证的 overrides。本轮没有修改两套云函数依赖，所以不存在“依赖升级已通过真实 SDK 能力验收”的结论。身份获取/事务/定时守卫/查单/通知的本地回归通过；线上只验证只读状态和已有授权，不触发计费、定时任务或通知写入。

后续可行路径是等待微信/CloudBase 官方升级传递依赖，或在独立环境验证官方维护的替代 SDK 组合，再分别验收微信身份、数据库事务与幂等、定时上下文、HTTP 通知验签、支付查询、文件操作和冷启动。当前告警需要上线负责人明确接受剩余风险或继续阻断；不能用版本号替换或包审计数字代替兼容性验收。

## 6. 部署版本和待授权执行方案

只读查询确认 `membership-staging-d7c032b6e3273` 中 `membership` 为 Active，Node.js 20.19，超时 60 秒。`accountSync` 位于另一个环境 `cloud1-d2gglad830c91db10`，Active、Node.js 20.19、超时 20 秒；没有把在会员环境找不到 accountSync 误判成未部署。[membership 信息](../../tmp/prelaunch-fix-2026-09-08/cloud-info-private.json)、[accountSync 信息](../../tmp/prelaunch-fix-2026-09-08/account-sync-info.json)。

使用微信官方 CLI 下载线上 membership 到独立 `tmp/.../deployed-membership`，没有覆盖工作区。线上 `handler.js`、`cloud-store.js` 缺少本轮开始前已完成的待支付指针/单次可拉起支付保护，其余支付适配器及包清单与基线一致。因此“这些本地保护已经在线上生效”目前不成立。这项是本轮新取得的部署证据，不是把上一轮代码算作本轮新增修复。

已在本地生成并独立核对待部署包：`tmp/prelaunch-fix-2026-09-08/membership-local-validated.zip`，5,824 个文件，SHA-256：`c2144452f827b3e2de835bc89352f2a78f147ed70b30fee9e551325ff3a6c5fb`。其中入口、handler、virtual-payment、diagnostics 与已验证源码一致，没有 `.env` 或私钥证书。此包仍包含上述云函数依赖告警，不能称为安全告警全部消除。

必要授权应集中针对以下具体方案，不在本轮自动执行：

1. **先部署会员函数，不进行真实付款。** 目标为当前实际使用的 `membership-staging-d7c032b6e3273/membership`，上传上面的已验证包。当前 develop/trial/release 都指向该环境，所以影响所有使用该后端的客户端，不能因为名字有 staging 就假定与线上隔离。保留现有运行时、超时、资源、环境变量、支付密钥、路由及触发器，不改 accountSync，不重置数据。部署会更新已有订单保护和诊断代码；之后的真实请求或现有补偿任务可能按新逻辑推进订单，因此需明确授权。
2. 部署前保存当前线上包和配置元数据；部署后先做只读 `getStatus`、已有授权验证、日志版本核对，确认价格 ¥28、6 个日历月、免费次数 3 和配置可用状态。异常时先停止后续验收，再评估回滚；回滚代码不能自动回滚已发生的订单或权益变化。
3. 后台核对会员 ProductID/OfferID 与主体资格、商品 ¥28 和可售状态；按实际虚拟支付主体指引处理，不能要求补普通 JSAPI 证书。核对消息推送 URL/Token/EncodingAESKey、安全模式、签名参数和原始请求体转发；只核对，不把密钥复制到报告。
4. 在云开发函数的触发器页面确认既有补偿任务是否启用、配置和最近执行结果。打包脚本不会把 `config.json` 当作平台触发器部署操作，不能仅凭仓库配置存在就声称每 10 分钟的线上任务正常。
5. 再单独批准专用测试账号的真实订单与扣款：先取消不付款、检查查单终态/重买，再批准最多一笔 ¥28 首购，验收通知、查单和权益。断网恢复与续费需明确各自步骤；续费会再扣 ¥28，不能包含在一次首购授权里。不要使用当前有真实学习记录的账号做重置或破坏性测试。

## 7. 验证结果和支付矩阵

| 检查 | 结果 |
| --- | --- |
| `npm run verify` | 最终导航版本退出码 0：TypeScript、ESLint、Stylelint、Prettier、包体、accountSync 生成一致性及全量测试通过；68 文件、612 项通过。 |
| 独立专项 | 8 文件、111 项通过；覆盖支付/会员/导航/随机诊断相关路径。后续导航调整由全量重跑覆盖。 |
| 根项目 Python | 明确运行 `python -m pytest tests`，257 通过、1 跳过；直接扫描根目录会误收集 tmp 基线副本，故按实际 tests 目录验证，没有删除副本绕过。 |
| 主包 | 最终为 1,572,832 / 1,572,864 字节，剩 32 字节；相比本轮基线增加 2,402 字节，预算从未提高。复用相同客户端错误构造并简化计时器清理腾出空间，没有删导航保护或引入新框架。余量极小，后续任何改动都必须重验。 |
| auxiliary 分包 | 105,621 / 2,097,152 字节。 |
| fflate | 仍为 0.8.3，源 UMD 与微信运行时均 33,044 字节，SHA-256 同为 `462ef8041fc970e3615a20a9dd2b2e3047a073b2da729ef4f02b634bba8b7b83`。这是原有升级的回归验证。 |
| 独立只读审查 | 最后导航分支与客户端增量再次审查，没有新增 P1/P2 代码问题；报告已按审查明确日志尚未部署。审查不代表运行时残余问题、平台限制或既有依赖告警消失。 |

第一轮完整验证发现剪贴板 Promise 未消费、旧 JSAPI 适配器指针调用及预算问题，已修复后重跑，保留失败日志供追溯。最终导航调整后又重新运行完整验证：[最终完整日志](../../tmp/prelaunch-fix-2026-09-08/final-verify-navigation.log)、[此前通过日志](../../tmp/prelaunch-fix-2026-09-08/final-verify-rerun.log)、[Python 日志](../../tmp/prelaunch-fix-2026-09-08/root-pytest-tests-only.log)。

| 环节 | 验证类别 | 已覆盖与未覆盖 |
| --- | --- | --- |
| 会员状态与支付开关 | **真实验证** | 当前云端返回 paymentAvailable=true；会员页加载真实状态。该开关只证明基础配置检查通过，不证明商品/签名/通知已验收。 |
| 会员下单 | **本地模拟验证** | 创建幂等、账号待支付指针、旧号不重放；尚未在本轮云端创建真实订单。 |
| 支付桥/真实扣款 | **本地模拟验证；真实尚未验证** | API 参数、回调分类、单次拉起通过 Mock；没有真实 ¥28 付款。 |
| 通知 | **本地模拟验证** | 验签、金额、身份、重放幂等回归；公网真实推送尚未验证。 |
| 支付查单 | **本地模拟验证** | 官方字段缺省、平台状态、金额和身份检查；没有本轮真实已支付订单可查。 |
| 会员开通 | **本地模拟验证** | 权威支付结果校验和幂等发权益；真实发权益尚未验证。 |
| 取消与重买 | **本地模拟验证，仍有平台阻断** | 取消不发权益、权威关闭后新交易号可购买；长时间 NOTPAY 仍保留恢复，不保证立即重买。 |
| 断网恢复 | **本地模拟验证** | 超时/传输失败/未知支付保留订单、后续查单和幂等；真实扣款后断网恢复尚未验证。 |
| 续费 | **本地模拟验证** | 6 个日历月、按既有有效期合理续期、旧会员取消文案；真实续费扣款尚未验证。 |
| 随机授权 | **真实只读验证 + 本地模拟验证** | 原 session 真实验证有效且额度未变；原子性/同请求幂等等由本地测试覆盖。本轮没有重新消费次数制造首请求。 |

## 8. 剩余具体阻断

1. 平台订单长期 NOTPAY 的安全终态与处理时效未落实；当前只能保留恢复和人工订单核查，不能保证立即重买。
2. 已验证的本地订单保护尚未部署；部署影响当前 develop/trial/release 共用环境，需要授权，且要明确接受或解决依赖风险。
3. 真实会员下单、通知、支付查单、开通、扣款后断网恢复和续费闭环仍未验收。
4. 首次随机授权异常缺原始日志；新诊断需要部署才能获取新的完整链路证据。
5. 上轮 SDK webview 错误的精确归因及真机对照尚未完成；已修复可确定的账号页竞态，不以当前采样没有新 error 代替结论。

可以在批准部署和风险边界后继续受控的体验版验收，但目前不能将此版本标记为上线问题全部解决或支付已真实通过。
