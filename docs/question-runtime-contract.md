# 小程序题库运行时契约

Python `grain-quiz build` 是题目数据的唯一发布端。小程序同步脚本只读取 `dist/json` 下六个固定 JSON 分片，并拒绝题量不足或包含非 `verified` 记录的发布。

## 固定分片

| 文件 | 职业 | 等级 | 当前题量 |
| --- | --- | --- | ---: |
| `warehouse_l5.json` | 粮油仓储管理员 | 五级 / 初级 | 20 |
| `warehouse_l4.json` | 粮油仓储管理员 | 四级 / 中级 | 8 |
| `warehouse_l3.json` | 粮油仓储管理员 | 三级 / 高级 | 9 |
| `inspector_l5.json` | 粮油质量检验员 | 五级 / 初级 | 8 |
| `inspector_l4.json` | 粮油质量检验员 | 四级 / 中级 | 8 |
| `inspector_l3.json` | 粮油质量检验员 | 三级 / 高级 | 8 |

当前总量为 61 道已审核起步题，其中包含一道人工作业情境案例题。题量是发布版本信息，不应被业务逻辑写死；训练组卷按实际分片数量安全截取。

## 字段映射

运行时记录保留题目 ID、职业、等级、模块、知识点、题型、题干、选项、答案、解析、难度、关键词、来源编号、标准依据、审核状态和内容版本。

Repository 是 `snake_case` 到小程序 `camelCase` 的唯一转换边界：

- `source_ids` → `sourceIds`
- `standard_reference` → `standardReference`
- `review_status` → `reviewStatus`
- `content_version` → `contentVersion`
- `topic` 同时映射为 `knowledgePoint`

前端扩展的 `case` 题型遵守相同的选项和答案键结构。未通过 Python 发布门禁的内容只能标记为 `sample`，不得伪装成正式题库。

## 发布规则

1. 在 `data/questions/*.jsonl` 维护题目，在 `data/sources.json` 维护公开来源。
2. 依次执行 `validate`、`dedupe` 和 `build`。
3. 在 `miniapp/` 执行 `npm run sync:questions`。
4. 执行 `npm run verify`，再进入微信开发者工具编译。

增加 `--review-workbook` 时生成的 `dist/question-bank.xlsx` 用于人工审核；它不是前端运行时输入。发布脚本只覆盖自己管理的已知文件，不递归删除输出目录。
