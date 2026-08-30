# 小程序题库运行时契约

`grain_quiz.cli validate/build --catalog` 是知识目录完整结构的严格校验边界，`build` 是题目与知识目录数据的唯一发布端。小程序同步脚本只对 `dist/json` 发布产物做传输与一致性检查：目录文件必须存在、可解析为 JSON 对象且包含顶层 `occupations`，五个仓储 JSON 分片与三个质检员 JSON 分片必须存在、可解析为数组、满足最低题量、只含 `verified` 记录，并且题目 ID、职业、等级、题干、选项、答案和章节路径必须与 `data/questions` 发布源一致。脚本会先读取并检查全部输入，任何检查失败都发生在写入小程序目标文件之前。

## 固定分片

| 文件                | 职业           | 等级        | 题量来源 |
| ------------------- | -------------- | ----------- | -------- |
| `warehouse_l5.json` | 粮油仓储管理员 | 五级 / 初级 | manifest |
| `warehouse_l4.json` | 粮油仓储管理员 | 四级 / 中级 | manifest |
| `warehouse_l3.json` | 粮油仓储管理员 | 三级 / 高级 | manifest |
| `warehouse_l2.json` | 粮油仓储管理员 | 技师        | manifest |
| `warehouse_l1.json` | 粮油仓储管理员 | 高级技师    | manifest |
| `inspector_l5.json` | 粮油质量检验员 | 五级 / 初级 | 源题库   |
| `inspector_l4.json` | 粮油质量检验员 | 四级 / 中级 | 源题库   |
| `inspector_l3.json` | 粮油质量检验员 | 三级 / 高级 | 源题库   |

仓储题库基线为 4,110 道：自动分类发布 3,605 道，其余 505 道保留在 review/pending 清单，不进入运行时，自动分类覆盖率为 87.7129%。质检员初级、中级、高级各发布 8 道已审核题目；技师和高级技师暂不生成分片，在界面显示“待补充”。仓储题量以 `data/warehouse_classification_manifest.json` 为准，所有职业的训练组卷均按实际分片数量安全截取。

## 知识目录

`data/knowledge_catalog.json` 是目录层级与稳定 ID 的唯一人工维护源。粮油仓储管理员目录由 6 个部分、20 章和 92 个可评分小节组成；每章另有仅用于章节级回退的 `s00` 综合小节。质检员使用独立的 8 章目录，运行时按职业和等级隔离。不同目录项即使标题相同，也必须按 ID 查找，不能按标题合并。

构建将规范目录复制到 `dist/json/knowledge_catalog.json`，同步再生成 `miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts`。`miniapp/miniprogram/data/knowledge-catalog.ts` 只负责向界面暴露这份生成目录，三者都不应绕过规范源手工维护。

## 字段映射

运行时记录保留题目 ID、职业、等级、模块、知识点、题型、题干、选项、答案、解析、难度、关键词、来源编号、标准依据、审核状态和内容版本。

Repository 是 `snake_case` 到小程序 `camelCase` 的唯一转换边界：

- `chapter_id` → `chapterId`
- `section_id` → `sectionId`
- `source_ids` → `sourceIds`
- `standard_reference` → `standardReference`
- `review_status` → `reviewStatus`
- `content_version` → `contentVersion`
- `topic` 同时映射为 `knowledgePoint`

目录生成映射为 `knowledge_catalog.json` → `runtime-knowledge-catalog.ts`。前端扩展的 `case` 题型遵守相同的选项和答案键结构。未通过 Python 发布门禁的内容只能标记为 `sample`，不得伪装成正式题库。

## 发布流程

1. 更新 `data/questions/*.jsonl`、`data/knowledge_catalog.json` 和分类 manifest。
2. 运行 Python validate/build，确认 `dist/json` 与 manifest 计数一致。
3. 运行 `miniapp` 的 `npm run sync:questions`，同步脚本再次校验 ID 与内容字段。
4. 运行 `npm run verify`，再进入微信开发者工具编译；本地验证不代表云端已发布。
