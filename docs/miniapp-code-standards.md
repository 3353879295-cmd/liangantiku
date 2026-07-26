# 小程序代码规范

## 1. 技术边界

- 使用原生微信小程序、TypeScript 严格模式和 TDesign MiniProgram；不引入跨端运行时。
- 页面只负责生命周期、事件转发和视图状态，组卷、判分、进度计算放在 `services/`，数据读取放在 `repositories/`，视图模型转换放在 `presenters/`。
- 业务核心不得直接依赖全局 `wx` 对象；本地存储通过适配器注入，便于测试和迁移。
- 本地题库是当前正式实现；云端仓储只保留兼容边界，未配置时不得影响离线使用。

### 1.1 存储边界

- 页面、组件和 Presenter 不得直接调用 `wx.getStorage*`、`wx.setStorage*`、`wx.removeStorage*` 或 `wx.clearStorage*` 保存偏好与学习数据。
- 页面通过 `appServices` 表达用户意图；主题使用 `appServices.theme`，每日目标、目标证书、头像等偏好使用 `appServices.progress.updatePreferences`。
- Service 负责业务规则和事务边界，Repository 负责领域数据的读取与写入，`storage/` 中的适配器和迁移是唯一允许接触底层存储格式的位置。
- 新增持久字段时必须同时定义默认值、运行时校验和迁移；不得在页面临时写一个新 key 绕过现有版本化结构。

### 1.2 题库可用性与等级

- `CertificateLevel` 只表达职业等级身份；`CertificateAvailability` 只表达当前题库能否开放，两者不得合并成一个字段或由等级高低推断。
- 可用性使用明确状态 `available` / `coming-soon`。等级即使显示在选择器中，也只有在 `availability === 'available'` 且实际题量大于 0 时才能开始练习。
- “待补充”是可用性状态，不是一个等级；页面不得为待补充等级创建空会话、空试卷或伪造题量。
- 题库同步不得改写职业编码、等级、题目 ID、章节 ID 或小节 ID；生成物出现差异时必须先审查差异再提交。

## 2. TypeScript

- 开启 `strict`、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`。
- 禁止显式 `any`。外部 JSON 先通过运行时边界检查，再映射为领域类型。
- 优先纯函数和不可变返回值；不要让页面直接修改 Service 内部对象。
- 异步调用必须处理或显式忽略 Promise，不允许悬空 Promise。
- 文件、变量和函数使用英文语义命名；面向用户的文案使用自然、简短的中文。

## 3. 页面与组件

- 页面路径统一为 `pages/<name>/index.{json,ts,wxml,wxss}`，公共组件位于 `components/`。
- 重复出现两次以上且具有独立状态或语义的视图才抽成组件，避免为抽象而抽象。
- WXML 列表必须设置稳定的 `wx:key`；事件参数使用 `data-*`，页面事件处理器统一以 `on` 开头。
- 页面离开、交卷和切题时要保存会话；恢复会话时先验证题目是否仍存在。
- 所有空列表、已下架题目和异常数据必须有可理解的退路，不显示空白屏。

### 3.1 Page、Presenter 与 Service 职责

- Page 只处理生命周期、路由参数、事件转发、异步加载状态和 `setData`；事件处理器以 `on` 开头，不在事件中实现组卷、判分、统计或持久化算法。
- Presenter 必须是可单测的纯转换层：把领域数据转换为文案、状态、排序和路由模型，不读取存储、不调用 `wx`、不产生持久副作用。
- Service 负责组卷、会话、判分、收藏、错题、进度、偏好等业务操作，并通过 Repository 或存储适配器持久化；Service 不依赖页面实例或 WXML 字段。
- Repository 负责题库和记录的 I/O，不承担页面展示决策。相同规则若被两个页面使用，应下沉到 Presenter 或 Service，而不是复制到 Page。

### 3.2 二级页返回行为

- 所有非 `home`、`practical`、`profile` 的页面统一在页面 `.json` 注册并在 WXML 使用 `app-topbar`。
- 返回目标统一由 `navigation-presenter.resolveBackTarget` 决定：页面栈深度大于 1 时调用 `wx.navigateBack`；直接打开、页面栈无上级时调用 `wx.switchTab` 回到 `fallbackTab`。
- `fallbackTab` 只能是 `home`、`practical`、`profile`。教材、练习与复习链路默认回首页，实操详情回实操，个人中心二级页回“我的”。
- 页面不得自行复制页面栈判断；提交成功等业务按钮如需专用跳转，应单独命名，不得改变顶部返回按钮的统一语义。

## 4. 题目与学习记录

- `data/questions/*.jsonl` 是人工维护源；小程序 JSON 是构建产物，禁止手工双写。
- 只有 `review_status=verified` 的题目可以进入正式运行时。
- 普通练习提交后即时显示正确答案、解析、易错提示和依据；模拟考试交卷前不得泄漏答案。
- 错题记录按会话幂等写入，避免重复进入结果页造成计数翻倍。
- 本地存储结构带版本号；结构升级必须在 `storage/migrations.ts` 增加迁移，不直接破坏旧数据。

## 5. 视觉与可用性

- 颜色、圆角、阴影、间距和字号优先复用 `styles/tokens.wxss`，不在页面随意创造近似值。
- 视觉保持克制：大留白、清晰层级、轻阴影、单一强调色；不使用无意义渐变、发光边框、机器人插画或套路化 AI 文案。
- 正文保证可读对比度；可点击区域不小于 44px，重要状态不能只靠颜色表达。
- 交互文案说明结果和下一步，例如“查看解析”“继续练习”，避免含糊的“确定”“好的”。

### 5.1 主题与状态命名

- 领域主题类型固定为 `AnswerTheme = 'light' | 'night'`；页面数据使用 `theme`，根节点派生类使用 `themeClass`，夜间类名使用 `theme-night`。
- 不混用 `dark`、`darkMode`、`nightMode` 等同义字段。布尔值只用于真正的二态判断，并使用 `is*`、`has*`、`can*` 命名。
- 选项状态使用语义值 `default`、`selected`、`correct`、`wrong`；加载、空态、不可用和错误必须是不同状态，不得仅靠颜色或一个模糊布尔值复用。
- 主题偏好由 `ThemeService` 持久化。页面在 `onLoad` / `onShow` 同步服务状态，切换后更新 `theme` 与 `themeClass`，不得维护第二份页面专属主题 key。

## 6. 质量门禁

提交前至少执行：

```powershell
python -m pytest -q
grain-quiz validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json
grain-quiz dedupe --questions data/questions --threshold 92
Set-Location miniapp
npm run sync:questions
npm run verify
```

涉及界面或路由的变更，还必须在微信开发者工具完成 npm 构建、无编译错误检查和核心流程冒烟测试。不得以跳过检查、降低规则或删除测试的方式换取通过。
