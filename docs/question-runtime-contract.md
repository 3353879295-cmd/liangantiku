# 小程序题库运行时契约

Python `grain-quiz build` 是题目数据的唯一发布端。小程序同步脚本只读取
`dist/json` 下六个固定 JSON 分片，并拒绝题量不足或包含非 `verified` 记录的发布。

## 分片

| 文件 | 职业 | 等级 |
| --- | --- | --- |
| `warehouse_l5.json` | 粮油保管员 | 五级/初级 |
| `warehouse_l4.json` | 粮油保管员 | 四级/中级 |
| `warehouse_l3.json` | 粮油保管员 | 三级/高级 |
| `inspector_l5.json` | 粮油质量检验员 | 五级/初级 |
| `inspector_l4.json` | 粮油质量检验员 | 四级/中级 |
| `inspector_l3.json` | 粮油质量检验员 | 三级/高级 |

## 字段映射

运行时记录保留题目 ID、职业、等级、模块、知识点、题型、题干、选项、答案、解析、
难度、关键词、来源编号、标准依据、审核状态和内容版本。Repository 是 snake_case 到
小程序 camelCase 的唯一转换边界：`source_ids` 转为 `sourceIds`、
`standard_reference` 转为 `standardReference`、`review_status` 转为 `reviewStatus`、
`content_version` 转为 `contentVersion`，`topic` 同时作为 `knowledgePoint`。

前端扩展的 `case` 题型遵守相同选项和答案键结构；未通过 Python 发布门禁的内容必须标记
为 `sample`，不得伪装成正式题库。
