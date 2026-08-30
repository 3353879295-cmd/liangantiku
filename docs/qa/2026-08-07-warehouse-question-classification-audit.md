# 五等级题库章节分类审计摘要

审计日期：2026-08-10
规则版本：`2026-08-10.1`
范围：粮油仓储管理员（`4-02-06-01`）五个等级；不包含质检员题库。

## 数据门禁

| 等级 | 基线 | 正式 | pending | 覆盖率 |
| --- | ---: | ---: | ---: | ---: |
| L5 | 1130 | 953 | 177 | 84.34% |
| L4 | 658 | 564 | 94 | 85.71% |
| L3 | 950 | 833 | 117 | 87.68% |
| L2 | 748 | 703 | 45 | 93.98% |
| L1 | 624 | 552 | 72 | 88.46% |
| 合计 | 4110 | 3605 | 505 | 87.71% |

pending 原因分布：`no_rule=361`、`low_score=80`、`ambiguous=64`。pending 保留原题目 ID，不进入正式分片。

正式数据已从 `warehouse-import-c01` 迁移到五等级 canonical catalog；每个等级均分布在多个章节，记录 `content_version=2`，题干、选项、答案、来源和创建时间保持基线不变。

## 抽样复核

固定算法按等级、章节轮询并在章节内按 `sha256(question_id)` 排序，每等级抽取 20 题，共 100 题。抽样文件为 `tmp/warehouse-classification-sample.csv`，章节复核结果为：

- overall accuracy：100%
- L5/L4/L3/L2/L1：均为 100%
- 所有抽样章节（样本数不少于 3）：均达到 85% 门禁

## 已执行命令

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest -q
python tools/import_warehouse_sources.py --baseline-dir tmp/warehouse-classification-baseline-70156a7 --output-dir data/questions --review tmp/warehouse-classification-review.jsonl --audit tmp/warehouse-classification-audit.jsonl --report tmp/warehouse-classification-report.json --manifest data/warehouse_classification_manifest.json --rules tools/warehouse_classification_rules.json --catalog data/knowledge_catalog.json --effective-at '2026-08-10T00:00:00Z' --minimum-coverage 0.80
python tools/audit_warehouse_classification.py invariants --baseline-dir tmp/warehouse-classification-baseline-70156a7 --questions data/questions --review tmp/warehouse-classification-review.jsonl --manifest data/warehouse_classification_manifest.json
python tools/audit_warehouse_classification.py sample --audit tmp/warehouse-classification-audit.jsonl --questions data/questions --catalog data/knowledge_catalog.json --output tmp/warehouse-classification-sample.csv --per-level 20
python tools/audit_warehouse_classification.py verify --sample tmp/warehouse-classification-sample.csv --report tmp/warehouse-classification-report.json --output-summary tmp/warehouse-classification-review-summary.json
```

本地验证通过后仍需单独确认云端发布；本任务不执行云端写入或发布。
