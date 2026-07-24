# 小程序题库运行时契约

Python `grain_quiz.cli validate/build --catalog` 是知识目录完整结构的严格校验边界，`build` 是题目与知识目录数据的唯一发布端。小程序同步脚本只对 `dist/json` 发布产物做基础传输检查：目录文件必须存在、可解析为 JSON 对象且包含顶层 `occupations`，六个固定 JSON 分片必须存在、可解析为数组、满足最低题量且只含 `verified` 记录。脚本会先读取并检查全部输入，任何检查失败都发生在写入小程序目标文件之前；它不重复验证目录内部的 part、chapter、section 完整结构。

## 固定分片

| 文件                | 职业           | 等级        | 当前题量 |
| ------------------- | -------------- | ----------- | -------: |
| `warehouse_l5.json` | 粮油仓储管理员 | 五级 / 初级 |       20 |
| `warehouse_l4.json` | 粮油仓储管理员 | 四级 / 中级 |        8 |
| `warehouse_l3.json` | 粮油仓储管理员 | 三级 / 高级 |        9 |
| `inspector_l5.json` | 粮油质量检验员 | 五级 / 初级 |        8 |
| `inspector_l4.json` | 粮油质量检验员 | 四级 / 中级 |        8 |
| `inspector_l3.json` | 粮油质量检验员 | 三级 / 高级 |        8 |

当前总量为 61 道已审核起步题，其中包含一道人工作业情境案例题。题量是发布版本信息，不应被业务逻辑写死；训练组卷按实际分片数量安全截取。

## 知识目录

`data/knowledge_catalog.json` 是目录层级与稳定 ID 的唯一人工维护源。仓储目录由 4 个部分、11 章、44 节组成；粮油质检员使用独立的 1 个部分、8 章、16 节目录。两个职业按各自的 `chapter_id` 和 `section_id` 隔离；不同目录项即使标题相同，也必须按 ID 查找，不能按标题合并。

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

目录生成映射为 `knowledge_catalog.json` → `runtime-knowledge-catalog.ts`。

前端扩展的 `case` 题型遵守相同的选项和答案键结构。未通过 Python 发布门禁的内容只能标记为 `sample`，不得伪装成正式题库。

## 发布规则

1. 在 `data/questions/*.jsonl` 维护题目，在 `data/sources.json` 维护公开来源，在 `data/knowledge_catalog.json` 维护目录。
2. 从仓库根目录执行下面的完整验证、构建、同步命令。
3. 在 `miniapp/` 执行 `npm run sync:questions`。
4. 执行 `npm run verify`，再进入微信开发者工具编译。

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest -q
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm run sync:questions
npm run verify
```

如需在内容修订后检查近似重复题，可在构建前另行运行 `grain-quiz dedupe --questions data/questions --threshold 92`；它不替代上述发布门禁。

增加 `--review-workbook` 时生成的 `dist/question-bank.xlsx` 用于人工审核；它不是前端运行时输入。发布脚本只覆盖自己管理的已知文件，不递归删除输出目录。
