# 小程序代码规范

## 1. 技术边界

- 使用原生微信小程序、TypeScript 严格模式和 TDesign MiniProgram；不引入跨端运行时。
- 页面只负责生命周期、事件转发和视图状态，组卷、判分、进度计算放在 `services/`，数据读取放在 `repositories/`，视图模型转换放在 `presenters/`。
- 业务核心不得直接依赖全局 `wx` 对象；本地存储通过适配器注入，便于测试和迁移。
- 本地题库是当前正式实现；云端仓储只保留兼容边界，未配置时不得影响离线使用。

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
