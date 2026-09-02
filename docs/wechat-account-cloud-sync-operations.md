# 微信账号与云端学习同步运维说明

## 操作闸门

本功能当前只完成本地代码、配置和自动化测试。未取得明确确认前，不执行任何云端操作，包括创建集合、修改权限、创建索引和部署云函数；确认内容必须覆盖下述完整清单。

## 待确认的精确云端变更

- 目标环境：`cloud1-d2gglad830c91db10`
- 新建集合：`user_accounts`、`user_progress`、`user_practice_records`
- 新建普通复合索引：`user_practice_records(account_key ASC, submitted_at ASC)`
- 客户端权限：三个集合均设为“无权限”，只允许云函数通过服务端数据库 API 访问
- 新建并部署云函数：`accountSync`
- 云函数运行时：Node.js 20
- 云函数依赖：`wx-server-sdk 3.0.1`，由云端安装依赖
- 云函数触发方式：仅微信小程序 `wx.cloud.callFunction`，不增加 HTTP 触发器、定时触发器或环境变量
- 云函数动作：`bootstrap`、`updateProfile`、`updatePreferences`、`saveActiveSession`、`recordPractice`、`setFavorite`、`markMastered`、`clearLearningData`、`deleteAccount`
- 快照响应安全上限：900 KiB UTF-8；达到上限的写入在事务中回滚并返回稳定错误，不截断或返回半份进度

本次不会修改任何计费设置，包括套餐、自动续费和超额付费。部署不需要 AppSecret、SecretId 或 SecretKey，也不得把这些凭据写入项目、客户端缓存、云函数配置或操作记录。

## 已完成的本地配置

- `miniapp/project.config.json` 的 `cloudfunctionRoot` 指向 `cloudfunctions/`。
- 小程序启动时显式初始化环境 `cloud1-d2gglad830c91db10`，首次启动不主动调用账号云函数。
- `miniapp/cloudfunctions/accountSync/package.json` 固定 Node.js 20 和 `wx-server-sdk 3.0.1`。
- 云函数从可信微信调用上下文读取 AppID 和 OpenID，并在服务端生成内部账号键；身份字段不由客户端提供，也不返回客户端。

## 确认后的部署顺序

1. 在微信开发者工具中确认当前项目是本工作树的 `miniapp`，云开发环境为 `cloud1-d2gglad830c91db10`。
2. 只读检查三个集合和 `accountSync` 是否已存在。若存在，停止并核对结构与现有数据，不覆盖同名资源。
3. 创建 `user_accounts`、`user_progress`、`user_practice_records`，立即将三个集合的客户端权限设为“无权限”。
4. 在 `user_practice_records` 创建普通复合索引 `account_key ASC, submitted_at ASC`，等待索引状态变为可用；不得启用唯一性约束。
5. 从 `miniapp/cloudfunctions/accountSync` 上传并部署 `accountSync`，选择“云端安装依赖”，确认运行时为 Node.js 20。
6. 不含用户身份和答案内容地检查云函数日志，只记录请求追踪 ID、动作、稳定错误码、耗时和结果状态。
7. 按“部署后验收”顺序完成开发者工具和真机验证；验收完成前不发布小程序版本。

## 部署后验收

依次验证：首次登录提示、选择游客、游客与账号数据隔离、新账号取得云端空白数据、同账号跨设备恢复、断网写入与恢复重放、双设备 revision 冲突恢复、退出登录的等待/保留/丢弃选择、退出后游客数据恢复、清除学习数据的中断重试、永久注销的中断重试与最终删除。

验收时不得在截图、日志或工单中记录 OpenID、内部账号键、用户答案、会话密钥或任何控制台凭据。

## 故障处理与回滚

- 集合或索引创建失败：停止后续步骤，保留已创建资源，记录不含敏感信息的错误码；核对环境和权限后从失败步骤重试。
- 云函数部署失败：不改动集合权限，不发布客户端；修复本地代码并重新通过 `npm run verify` 后再部署。
- 同名资源已存在：不得删除、覆盖或改变权限；先确认其所有者、结构、索引和数据用途。
- 客户端同步失败：账号本地缓存和 outbox 保持可恢复，游客数据不受影响；使用稳定错误码定位，禁止直接手工修改用户文档。
- 新部署版本异常：停止发布客户端，回退到上一已验证的云函数版本。若这是首次部署，则暂停 `accountSync` 使用但保留集合数据，不以删除集合方式回滚。
- 注销或清除中断：重复调用原动作继续状态机，完成前不得向用户显示成功，也不得手工跳过删除阶段。

任何涉及删除集合、删除线上数据、改变客户端权限或计费的动作都不属于本清单，必须另行评审并取得明确确认。
