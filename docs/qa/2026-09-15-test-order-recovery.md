# 未扣款测试旧单恢复方案（2026-09-15）

## 问题与范围

用户手机会员页卡在“请先检查支付结果”。原单查询返回微信 `268490002` 请求参数错误，不能视为平台已关闭或未扣款证明。用户随后明确回答此前测试“没有”实际扣款。

本次进一步核对发现，环境中的 5 条旧订单分属 **4 个账号**。仅当前已验证账号的 **2 条**进入恢复范围：单号尾号 `dcaa9e`（本地 CLOSED，缺少平台终态证据）、`2c7b52`（PENDING，之前平台返回 NOTPAY/1）。两单都是 28 元、同一小程序和半年会员商品，未读到付款时间或平台付款凭证；其他账号的 3 条不处理。

这两条均早于 2026-09-08；当前账号通过实际 `getOrder` 权限校验，手机日志订单摘要和开发者工具查询的原单一致。完整匹配条件及变更前投影位于 `tmp/payment-acceptance-20260915/test-hold-release/`，不在本报告展示账号标识或完整单号。

## 恢复方式

给两条原单增加服务端管理字段：

```json
{
  "purchase_hold_release": {
    "version": 1,
    "reason": "confirmed_unpaid_test",
    "confirmed_at": "记录用户确认时的 UTC 时间"
  }
}
```

该字段只解除测试旧单对新购买的占用，**不是微信支付终态，也不是已付款或已退款证明**。原订单、金额和支付状态保留；后台定时查单及合法迟到支付/退款通知继续处理，同一平台交易号仍只发放一次权益。

普通待支付订单仍阻止重复购买。小程序客户端没有设置该字段的接口，会员数据库的客户端规则仍为禁止读写。`recoverOrders` 只对当前用户指定且拥有的原单返回明确的 `releasedTestOrderId`；客户端仅在账号、会话及原单均匹配时解除本地占用，不凭查询失败或没有 pendingOrder 清理缓存。

## 管理变更方案及实际执行

仅在代码审查和独立测试通过后应用：

1. 部署通过验收的标准 ZIP，使用 CloudBase 控制台普通部署。
2. 管理更新同时匹配：当前账号和 open_id、两个准确订单号、AppID、商品、2800 分、CNY、virtual、本地 CLOSED/PENDING、尚无释放字段。另原子要求 `paid_at`、`transaction_id`、`settled_at`、`refunded_at`、`platform_wx_order_id` 均缺失或空，且平台状态不是 SUCCESS/REFUNDED。只增加 `purchase_hold_release`。
3. 写入前复读确认两单没有出现已付款变化；写入后复读确认仅两条被标记，金额和原支付状态不变。
4. 使用当前代码预览，确认恢复后不再被旧单占用，再由用户在手机上完成 28 元付款。
5. 核对微信订单、发货通知、半年会员到账和重新进入后的状态。

用户已授权部署，标准 ZIP 于 **2026-09-15 18:47:48（北京时间）** 通过 CloudBase 控制台普通部署完成。控制台显示正常，函数状态 Active。用户随后明确“只解除占用”，保留原单的恢复方案已获授权。

管理写入前再次只读核对，带付款/退款凭证保护的条件仍恰好匹配当前账号两条旧单；原 5 条订单投影已保存。先前一次 `cloud_db_write_doc update` 返回待微信开发者工具确认；用户确认后，原任务查询返回 `Task not found`，数据库复查两条均没有标记。因此没有重复提交该 CLI 请求。

已使用用户此前授权的 CloudBase 控制台“添加字段”操作，分别给两个准确订单新增恢复对象。每次保存前均按原筛选条件复查剩余未标记订单及付款/退款证据。**实际 UI 写入并非带条件的原子更新，不宣称执行过原计划的原子筛选写入。** 两次均只添加新字段，保留原记录。

保存后按原回退条件只读查询，**精确匹配 2 条**，尾号 `dcaa9e`、`2c7b52`，对象的 version/reason/confirmed_at 与准备文件一致。证据 `released-markers-verified.json`、`records-after-ui-release.json`；旧任务已标记为被此次已验证的 UI 更新替代，不应重发。

前端恢复已通过：recoverOrders 无待付款占用，会员页恢复可购买。用户随后完成一笔新的 Apple IAP 28 元付款；经平台查单补发及真实通知，订单最终为 PAID、平台状态 4（已发货完成），会员至 2027-03-15 22:31:53（北京时间），只生成一笔 renewal。旧两单标记保留，未删除原订单，未将新付款单加入释放范围。完整验收与新增修复见 [部署前逐项验收](2026-09-15-person-payment-acceptance.md)。

## 回退

标记可撤回：仅匹配本批次订单、账号、open_id、version=1、reason 和本批次 `confirmed_at`，移除新增字段。不得覆盖订单整行或回退支付流水。准备的 `rollback-query.json`、`rollback-update.json` 只操作这个字段。

代码可回退到本任务此前已验收部署的 `membership-payment-recovery-standard.zip`。若恢复后已产生新订单，回退前先核对新旧订单和当前占用指针，避免用旧客户端缓存覆盖新的交易。

## 验证记录

独立 tester 全量 **76 文件 / 802 项通过**，类型、Lint、格式、包预算和 accountSync 检查全部通过。审查发现的签名期间释放、旧 lease 重启支付、恢复响应覆盖新事务三类并发问题已修复。之后仅加强测试用例，业务源码未再改变；最后定向 **8/8 通过**，类型、Lint、格式复验通过，记录见 `tester-final/*regression.log`。只读 reviewer 已确认所有发现闭环。

主包 1,565,601 / 1,572,864 字节，余量 7,263；辅助包 117,189 字节。以上是本地包预算，并非手机真实支付验收。

回退的 `confirmed_at` 已从 apply 的原始字符串复制，用 Python JSON 读取后作精确相等验证（24 字符），同时核对 version/reason 一致，避免日期格式化损失精度。证据 `rollback-local-verification.json`。

线上 `member_orders` 权限页实际选中“无权限 [ADMINONLY]”，此次只读核验，没有修改权限。加强后的管理条件已使用 `cloud_db_read_doc` 只读试查，恰好匹配当前账号的 2 条记录；没有执行写入。

标准 ZIP：`tmp/payment-acceptance-20260915/test-hold-release/membership-test-hold-release-standard.zip`，SHA-256 `dac943190b979226068d375814fcd9755b46b9039b02efd6c096a44c1feaa431`。脚本验证 5,825 文件、POSIX 路径、100644、CRC 及源码字节一致。相对 17:11 部署包仅 `lib/cloud-store.js`、`lib/handler.js`、`lib/order-state.js` 改变，详见同目录 `zip-comparison.json`。该 ZIP 已在用户授权后部署。

部署后真实 `getStatus` 成功：RequestID `7cef414e-5253-4327-b9b9-c831f70430a0`，服务端时间 `2026-09-15T10:49:00.018Z`，`paymentAvailable=true`、非会员、剩余 3 次免费额度。该调用未创建订单、未扣款、未授予会员。

独立 tester 重新下载线上代码并完成比对：5,825 文件集合完全一致，业务入口/全部 lib/package/lock 共 10/10 文件逐字节相同，4,516/4,516 JS 文件逐字节相同。另 25 个依赖类型、元数据或 semver shim 与 ZIP 有差异，不能称整包完全一致；差异类别与上一版部署后的下载相同。详见 `postdeploy-184748/byte-compare-summary.txt` 及 `byte-compare-details.csv`。
