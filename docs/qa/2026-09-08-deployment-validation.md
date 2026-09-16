# 2026-09-08 授权后执行记录

本记录接续 `2026-09-08-prelaunch-fixes.md`，不覆盖此前报告。用户已授权部署报告中的 membership 包，授权范围明确不包括真实扣款。

## 当前结论

**本地修复与验证已完成新增一轮，会员部署尚未完成。** 微信开发者工具的云函数部署请求仍在等待界面确认。不得将聊天授权、工具返回 `success:true` 或已发起请求写成实际部署成功。

账号页自动返回的可重复残留问题已取得明确修复证据；真实支付、长时间 NOTPAY 的平台处理、随机首次异常日志、云函数依赖告警仍按前报告列为未完成项。另定位到当前账号已有待同步会话写入失败，见下文。

## 部署授权与执行边界

- 当前项目再次由 `project_list` 确认为 `D:\文档\保管员刷题小程序\.worktrees\warehouse-question-classification\miniapp`，AppID `wx84ecacec08ca162c`。没有切换根目录副本。
- 部署目标：`membership-staging-d7c032b6e3273/membership`；开发、体验、正式客户端共用该环境的影响范围已在授权前说明。
- 原已验证 ZIP SHA-256 仍为 `c2144452f827b3e2de835bc89352f2a78f147ed70b30fee9e551325ff3a6c5fb`，没有临时替换内容。
- 将 ZIP 解压到独立 `tmp/prelaunch-fix-2026-09-08/authorized-deploy/membership`。独立 reviewer 核对 5,824 个路径及逐文件 SHA-256，均与 ZIP 一致。
- 部署前再次只读下载线上代码到 `tmp/prelaunch-fix-2026-09-08/before-authorized-deploy`。函数为 Active、Nodejs20.19、超时 60 秒。[部署前状态](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/before-info.json)
- 仅调用一次 `cloud_fn_deploy`，没有启用远程 npm 安装。包内不含 `.env`、私钥证书、`config.json` 和数据库规则；没有提交生产配置、触发器或 accountSync 部署变更。
- 原任务 ID：`confirmation_cloud_fn_deploy_c6a0c086-08aa-4903-8072-9247c26c5011`。工具返回 `Waiting for user confirmation`；完成独立工作、准备接续部署时读取原任务，仍为 `pending`。没有重复提交、强制取消或绕过确认。[原始请求结果](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/deploy-result.json)、[接续时的状态](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/deployment-confirmation-state.json)、[恢复上下文](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/pending-task.json)

确认后的必要验证已准备好：从原 taskId 获取结果 → 确认函数 Active/运行时/超时 → 再次下载实际线上代码、与部署包比较 → 调用真实只读 getStatus 和原有授权 validateRandomPractice → 核对诊断版本及失败日志。不会重新下单、消费练习次数、手动调用补偿任务或通知入口来充当只读验证。

## 新增导航根因证据与修复

此前账号页在 `onReady` 自动离开。微信官方说明 `onReady` 代表首次渲染完成，`onRouteDone` 才在页面完全推入、路由动画完成时触发。[官方 Page 生命周期](https://developers.weixin.qq.com/miniprogram/dev/reference/api/Page.html#onRouteDone)

因此改为在 `onRouteDone` 才设置已完成入页路由的标记，并执行原排队的自动退出；若身份恢复晚于路由结束，身份结果到达后照常执行。保留单次动作锁、晚到回调隔离、卸载清理、看门狗，以及“上一页是首页则 navigateBack，否则 switchTab 首页”的分支。不增加任意延迟，不屏蔽日志，也不添加空的 onReady 生命周期。

实际修改仅为账号入口页面及对应测试。会员待部署 ZIP 没有因这项前端修改变化。

### 开发者工具实测

使用与此前失败相同的未包装脚本：每轮确认只有首页，进入无 mode 账号入口，等待 2.5 秒后读取真实页面栈。这个等待仅是测试观察窗口，不在产品代码中。

| 路径 | 结果 |
| --- | --- |
| 首页 → 无 mode 账号入口 → 自动返回，连续 3 次 | 每次最终均只有首页。此前同脚本第 1 次就会残留账号入口。 |
| 实操 → 无 mode 账号入口 → 自动回首页 | 最终只有首页，Tab 高亮正确。 |
| 显式 `mode=login` | 正确保留需要处理的账号错误界面，没有把错误页面强制关闭；当前账号恢复失败属于下面的同步问题，不能记为“已认证自动返回通过”。 |
| 显式账号错误页手动返回 | 返回首页成功。 |

证据：[三轮相同复现](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/auto-return-route-done.json)、[非首页来源](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/auto-return-from-practical.json)、[显式登录状态](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/login-page-state.json)。最终只删除空生命周期，未再次编译模拟器，避免继续触发既有同步队列的自动重放；该删除不改变已实测的路由逻辑，最终源码重新完成全量验证。

当前 Console 没有新增原 `routeDone ... webviewId` 或 `appServiceSDKScriptError`，仍有全局组件懒加载和启动耗时警告。网络 fail 搜索无匹配不代表没有业务错误，HTTP 200 的账号同步失败就是反例。[Console](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/runtime-console.json)、[网络 fail 采样](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/network-fail-final.json)

该证据支持“自动返回发起时机过早”是本次可重复残留的原因，不能追溯证明上轮 webview 106 的全部错误都只有此原因。实测基础库为 3.17.0，真机及旧基础库尚未覆盖。

## 新发现的账号恢复问题：保留记录后的定位

显式打开登录入口时，页面报告“账号记录暂时无法恢复”。读取最少必要本地元数据发现：原缓存 profileRevision=19、progressRevision=0，4 条原有待同步命令仍存在，清除学习数据标记为 false；没有清空或改写缓存和队列。

当前小程序启动会自动重放原有队列。网络中首条 `saveActiveSession`（expectedRevision=0）自动尝试了 3 次；HTTP 200，但账号恢复最终失败。没有手动重发该写请求，也没有通过点击重试或删除队列绕过它。

本轮只读取得以下证据：

1. 下载线上 `accountSync`；其实际执行入口与本地 SHA-256 完全一致，为 `52c5946bb5ef2ed8096b6515dce60f13060f72215ba26141fe84a8e63444b541`。本问题不能归因为入口代码未同步部署。
2. 根据当前账号缓存中的受控上传路径前缀定位对应账号，仅查询该账号的数据库元数据，没有列出其他用户记录。账号为 active/idle、schema 1、revision 19；进度 schema 1、revision 0、answered 0。说明这些练习仍在本地待同步队列内，不能宣称已经保存至云端，也不能丢弃它们。
3. 确认账号及进度文档已经存在之后，仅调用 bootstrap 读取既有快照。真实返回成功：schema 1、progress schema 4、修订 19/0，耗时 4096ms，RequestID `dcc97eb2-f1b6-45f2-b713-ebdd2f197a32`。此动作未改变修订。[只读 bootstrap](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/account-bootstrap-readonly.json)
4. 从网络记录提取第一条真实事件，在本地执行实际 validateEvent、validateSession 及 createHandler，均通过；同样的修订 19/0 在本地模拟 store 中能写出进度修订 1。
5. 生产 handler 在 transaction 内会重新抛出错误，事务外才映射响应；没有发现吞掉事务异常导致不能回滚的问题。真实 bootstrap 也经过事务，已证明身份、事务读取和快照路径可用，不能笼统归因于 Promise.all 或 SDK 全部不可用。

目前故障范围缩小到生产 `saveProgress`/事务写提交，或云调用边界将返回变成客户端不可解析响应。平台网络缓冲区不包含响应 body，尚无证据确定实际数据库错误码。未修改 accountSync 业务代码或依赖，不把本地模拟通过视为线上写入成功。

需要在云开发 `cloud1-d2gglad830c91db10 → 云函数 → accountSync → 日志` 查看 2026-09-08 05:51:42–05:51:50 北京时间的三次 `saveActiveSession`，核对事务错误；对照 06:02:36 附近的成功 bootstrap 和上述 RequestID。若控制台按 UTC，分别为 9 月 7 日 21:51:42–21:51:50、22:02:36。当前函数只记录 action，若缺底层错误，则需准备脱敏诊断补丁并单独批准该函数的部署，不能修改现有数据来代替定位。

已检查官方 CLI 功能，没有云日志读取命令；尝试连接已打开的公众平台浏览器两次均超时，没有获得可操作页面，没有绕过登录或提取浏览器凭据。

## 最终本地验证和真实只读状态

独立 tester 在源码稳定后运行完整 `npm run verify`，退出码 0：

- TypeScript、ESLint/Stylelint、Prettier、主包预算和 accountSync bundle 一致性全部通过。
- **68 个测试文件、613 项测试通过**，账号入口 37 项。
- 主包 **1,572,840 / 1,572,864 字节，剩 24 字节**；没有提高限额。
- auxiliary 分包 105,621 字节、39 个文件。
- 本次没有 Python/题库/依赖变更；此前 Python 257 通过、1 跳过和依赖审计仍适用，没有机械重跑或声称告警消失。
- 独立 reviewer 核对部署内容与授权一致，并审查最终导航生命周期、异步身份、重复回调和卸载行为，没有新增 P1/P2。

[最终完整验证日志](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/local-verify-final.log)

06:07:52 真实只读会员状态仍为：非会员、已用 2 次、剩余 1 次、免费上限 3、paymentAvailable=true，RequestID `0a4308e5-aec7-43f6-b082-eaa6f751804d`。会员价格和续期规则未改。[状态证据](../../tmp/prelaunch-fix-2026-09-08/authorized-deploy/member-status-readonly.json)

真实付款、会员下单/通知/开通/续费、扣款后断网恢复仍未执行；其本地模拟验证结论沿用前报告。未上传体验版。当前不能把“全部上线问题已处理完”或“已部署”作为完成结论。
