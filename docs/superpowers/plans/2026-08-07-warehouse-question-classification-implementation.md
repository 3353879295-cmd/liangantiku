# 保管员五等级题库章节分类 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 4110 道粮油保管员题目按已确认的五等级目录确定性分类，保留题目身份与内容，把低置信度题目排除出正式分片，并完成本地题库、小程序和人工抽样审计。

**Architecture:** 在独立工作树中，从提交 `70156a7` 的五等级导入结果出发，以现有 JSONL 作为不可变身份基线；新增独立规则加载器和加权分类器，导入器只负责解析、基线匹配、分类结果落盘和审计输出。目录与 taxonomy 先建立稳定 ID，分类通过覆盖率门禁后才原子替换五个正式 JSONL，随后走现有 validate/build/sync/verify 链路；云端活动版本不在本计划中改动。

**Tech Stack:** Python 3.11、dataclasses、Pydantic、pytest、JSON/JSONL、TypeScript、Vitest、微信原生小程序。

---

## 固定实施边界

- 实现基础提交：`70156a7 feat: replace question bank with warehouse five-level import`。
- 设计规格提交：`43ca6d5 docs: design warehouse question classification`。
- 原始资料目录：`D:\桌面\储备粮\保管员`。
- 正确国家标准：`tmp/pdfs/official-standard/grain-warehouse-manager-2019.pdf`；不得引用误下载的 `grain-warehouse-manager-standard.pdf`。
- 基线题数固定为 L5=1130、L4=658、L3=950、L2=748、L1=624，总计 4110。
- 不修改题目 `id`、`level`、`stem`、`options`、`answer`、`explanation`、`source_ids`、`source_note`、`standard_reference`、`created_at`。
- 只允许更新 `module`、`topic`、`chapter_id`、`section_id`、`keywords`、`content_version`、`updated_at`。
- 分类失败的题保留原 ID 写入 review 文件，但不进入正式 JSONL；因此正式 ID 可以有空号，禁止按发布顺序重新编号。
- 自动分类覆盖率低于 80% 时，导入器必须保留原正式 JSONL 不变，只输出 review/audit/report 供调规则。
- `tmp/warehouse-classification-*` 是本地审计产物，不提交；最终只提交规则、代码、正式数据、生成的小程序运行时数据、测试和 QA 摘要。
- 本计划完成后停止在本地验证结果，不 cherry-pick 到有未提交改动的云端工作树，不上传云端。

## 文件职责

- Create `src/grain_quiz/warehouse_classify.py`：规则模型、NFKC 文本规范化、字段加权、候选排序、阈值决策。
- Create `tools/warehouse_classification_rules.json`：规则版本、固定权重/阈值、每个可分类小节的术语和排除词。
- Modify `tools/import_warehouse_sources.py`：解析后按指纹匹配 4110 道基线题，调用分类器，生成正式/review/audit/report 输出。
- Create `tools/audit_warehouse_classification.py`：比较分类前后不可变字段、核对覆盖率和分布、生成每等级 20 题的确定性分层样本、验证人工复核结果。
- Modify `data/knowledge_catalog.json`：删除占位目录，扩展共享基础目录，新增 L2/L1 目录，所有章追加 `s00`。
- Modify `data/taxonomy.json`：使模块/主题名称与目录章节/小节标题完全一致。
- Modify `data/questions/warehouse_l1.jsonl` through `warehouse_l5.jsonl`：写入通过分类门禁的正式题。
- Create `data/warehouse_classification_manifest.json`：提交规则版本、五等级基线/发布/pending 计数和 pending ID/原因，供干净检出环境执行数据门禁。
- Create `tests/test_warehouse_classify.py`：规则结构、评分、阈值、歧义、基础目录优先级和确定性测试。
- Modify `tests/test_import_warehouse_sources.py`：身份保留、pending 隔离、原子写入和审计结构测试。
- Create `tests/test_warehouse_classification_dataset.py`：正式数据占位 ID、目录合法性、题数/ID/内容不变量和覆盖率测试。
- Modify `tests/test_catalog.py`、`miniapp/tests/catalog.test.ts`、`miniapp/tests/catalog-presenter.test.ts`：锁定新目录和旧路由失效行为。
- Modify generated `miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts` and `runtime-question-records.ts`：由同步脚本生成，不手改。
- Create `docs/qa/2026-08-07-warehouse-question-classification-audit.md`：记录覆盖率、pending 原因、分布、100 题人工抽样结果和验证命令。

### Task 1: 建立隔离工作树并冻结 4110 道题基线

**Files:**
- Read: `.worktrees/warehouse-five-level-import/data/questions/warehouse_l*.jsonl`
- Generate locally: `tmp/warehouse-classification-baseline-70156a7/warehouse_l*.jsonl`

- [ ] **Step 1: 使用工作树技能创建实现分支**

先加载 `superpowers:using-git-worktrees`，然后创建：

```powershell
git worktree add .worktrees/warehouse-question-classification -b codex/warehouse-question-classification 70156a7
git -C .worktrees/warehouse-question-classification cherry-pick 43ca6d5
```

Expected: 新工作树位于 `D:\文档\保管员刷题小程序\.worktrees\warehouse-question-classification`，`git status --short` 为空；现有 `cloud-warehouse-five-level-release` 和 `cloud-question-bank` 工作树状态未变化。

- [ ] **Step 2: 复制不可变基线到本地审计目录**

```powershell
New-Item -ItemType Directory -Force tmp/warehouse-classification-baseline-70156a7
Copy-Item data/questions/warehouse_l1.jsonl tmp/warehouse-classification-baseline-70156a7/
Copy-Item data/questions/warehouse_l2.jsonl tmp/warehouse-classification-baseline-70156a7/
Copy-Item data/questions/warehouse_l3.jsonl tmp/warehouse-classification-baseline-70156a7/
Copy-Item data/questions/warehouse_l4.jsonl tmp/warehouse-classification-baseline-70156a7/
Copy-Item data/questions/warehouse_l5.jsonl tmp/warehouse-classification-baseline-70156a7/
```

Expected: 五个文件行数依次为 624、748、950、658、1130，总计 4110。

- [ ] **Step 3: 运行基线计数检查**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
@'
from pathlib import Path

expected = {1: 624, 2: 748, 3: 950, 4: 658, 5: 1130}
root = Path('tmp/warehouse-classification-baseline-70156a7')
actual = {
    level: sum(1 for line in (root / f'warehouse_l{level}.jsonl').read_text(encoding='utf-8').splitlines() if line.strip())
    for level in expected
}
assert actual == expected, actual
print(actual, sum(actual.values()))
'@ | python -
```

Expected: `{1: 624, 2: 748, 3: 950, 4: 658, 5: 1130} 4110`。

### Task 2: 用测试锁定规则文件和分类器接口

**Files:**
- Create: `tests/test_warehouse_classify.py`
- Create: `src/grain_quiz/warehouse_classify.py`
- Create: `tools/warehouse_classification_rules.json`

- [ ] **Step 1: 写规则加载器失败测试**

在 `tests/test_warehouse_classify.py` 创建临时规则文件帮助函数，并锁定版本、权重、重复规则、`s00` 禁止配置和目录合法性：

```python
from __future__ import annotations

import json
from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.warehouse_classify import load_warehouse_rules


CATALOG = load_knowledge_catalog(Path("data/knowledge_catalog.json"))


def _write_rules(tmp_path: Path, rules: list[dict[str, object]]) -> Path:
    path = tmp_path / "rules.json"
    path.write_text(
        json.dumps(
            {
                "version": "2026-08-07.1",
                "field_weights": {"stem": 3, "options": 1, "explanation": 2},
                "term_weights": {
                    "strong_phrases": 4,
                    "keywords": 2,
                    "context_terms": 1,
                    "exclude_terms": -4,
                },
                "thresholds": {
                    "section_score": 12,
                    "section_margin": 4,
                    "chapter_score": 9,
                    "chapter_margin": 3,
                    "basic_lead": 4,
                },
                "rules": rules,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return path


def _rule(section_id: str = "warehouse-l2-c03-s04") -> dict[str, object]:
    return {
        "level": 2,
        "chapter_id": "warehouse-l2-c03",
        "section_id": section_id,
        "strong_phrases": ["磷化氢环流熏蒸"],
        "keywords": ["熏蒸", "害虫"],
        "context_terms": ["浓度", "散气"],
        "exclude_terms": ["害虫识别", "虫态检查"],
    }


def test_rule_loader_reads_the_fixed_contract(tmp_path: Path):
    rules = load_warehouse_rules(_write_rules(tmp_path, [_rule()]), CATALOG)

    assert rules.version == "2026-08-07.1"
    assert rules.section_score == 12
    assert rules.section_margin == 4
    assert rules.chapter_score == 9
    assert rules.chapter_margin == 3
    assert rules.basic_lead == 4
    assert rules.rules[0].section_id == "warehouse-l2-c03-s04"


def test_rule_loader_rejects_duplicate_level_and_section(tmp_path: Path):
    with pytest.raises(ValueError, match="duplicate warehouse rule"):
        load_warehouse_rules(_write_rules(tmp_path, [_rule(), _rule()]), CATALOG)


def test_rule_loader_rejects_s00_as_a_scoring_target(tmp_path: Path):
    with pytest.raises(ValueError, match="s00"):
        load_warehouse_rules(
            _write_rules(tmp_path, [_rule("warehouse-l2-c03-s00")]),
            CATALOG,
        )


def test_rule_loader_rejects_a_path_outside_the_level_catalog(tmp_path: Path):
    bad = _rule("warehouse-l3-c11-s04")
    bad["chapter_id"] = "warehouse-l3-c11"
    with pytest.raises(ValueError, match="not allowed by catalog"):
        load_warehouse_rules(_write_rules(tmp_path, [bad]), CATALOG)
```

- [ ] **Step 2: 运行测试确认 RED**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classify.py -v
```

Expected: FAIL during collection with `ModuleNotFoundError: grain_quiz.warehouse_classify`。

- [ ] **Step 3: 实现不可变规则模型和严格加载器**

在 `src/grain_quiz/warehouse_classify.py` 定义以下公开类型；JSON 读取辅助函数必须拒绝布尔值冒充整数、空术语、重复术语、未知等级、`s00` 目标和 catalog 不允许的路径：

```python
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from grain_quiz.catalog import KnowledgeCatalog


@dataclass(frozen=True)
class WarehouseRule:
    level: int
    chapter_id: str
    section_id: str
    strong_phrases: tuple[str, ...]
    keywords: tuple[str, ...]
    context_terms: tuple[str, ...]
    exclude_terms: tuple[str, ...]


@dataclass(frozen=True)
class WarehouseRuleSet:
    version: str
    stem_weight: int
    options_weight: int
    explanation_weight: int
    strong_phrase_weight: int
    keyword_weight: int
    context_term_weight: int
    exclude_term_weight: int
    section_score: int
    section_margin: int
    chapter_score: int
    chapter_margin: int
    basic_lead: int
    rules: tuple[WarehouseRule, ...]


def load_warehouse_rules(path: Path, catalog: KnowledgeCatalog) -> WarehouseRuleSet:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("warehouse rules must be a JSON object")
    version = document.get("version")
    if not isinstance(version, str) or not version.strip():
        raise ValueError("warehouse rules require a non-blank version")
    field_weights = _require_int_mapping(
        document.get("field_weights"),
        ("stem", "options", "explanation"),
        "field_weights",
    )
    term_weights = _require_int_mapping(
        document.get("term_weights"),
        ("strong_phrases", "keywords", "context_terms", "exclude_terms"),
        "term_weights",
        allow_negative=True,
    )
    thresholds = _require_int_mapping(
        document.get("thresholds"),
        ("section_score", "section_margin", "chapter_score", "chapter_margin", "basic_lead"),
        "thresholds",
    )
    if term_weights["exclude_terms"] >= 0:
        raise ValueError("exclude_terms weight must be negative")
    raw_rules = document.get("rules")
    if not isinstance(raw_rules, list) or not raw_rules:
        raise ValueError("warehouse rules must contain rules")
    seen: set[tuple[int, str]] = set()
    rules: list[WarehouseRule] = []
    for raw_rule in raw_rules:
        rule = _load_rule(raw_rule)
        key = (rule.level, rule.section_id)
        if key in seen:
            raise ValueError(f"duplicate warehouse rule: level {rule.level} {rule.section_id}")
        if rule.section_id.endswith("-s00"):
            raise ValueError("s00 is a chapter fallback and cannot be a scoring target")
        if not catalog.allows("4-02-06-01", rule.level, rule.chapter_id, rule.section_id):
            raise ValueError(
                f"warehouse rule path is not allowed by catalog: level {rule.level} {rule.section_id}"
            )
        seen.add(key)
        rules.append(rule)
    return WarehouseRuleSet(
        version=version.strip(),
        stem_weight=field_weights["stem"],
        options_weight=field_weights["options"],
        explanation_weight=field_weights["explanation"],
        strong_phrase_weight=term_weights["strong_phrases"],
        keyword_weight=term_weights["keywords"],
        context_term_weight=term_weights["context_terms"],
        exclude_term_weight=term_weights["exclude_terms"],
        section_score=thresholds["section_score"],
        section_margin=thresholds["section_margin"],
        chapter_score=thresholds["chapter_score"],
        chapter_margin=thresholds["chapter_margin"],
        basic_lead=thresholds["basic_lead"],
        rules=tuple(rules),
    )
```

同文件实现 `_require_int_mapping`、`_load_rule` 和 `_require_terms`；`_load_rule` 必须要求 `level` 为 1–5，四类术语字段均为去重后的字符串数组，且至少 `strong_phrases` 或 `keywords` 之一非空。

- [ ] **Step 4: 创建生产规则文件骨架**

`tools/warehouse_classification_rules.json` 顶层固定为：

```json
{
  "version": "2026-08-07.1",
  "field_weights": {"stem": 3, "options": 1, "explanation": 2},
  "term_weights": {
    "strong_phrases": 4,
    "keywords": 2,
    "context_terms": 1,
    "exclude_terms": -4
  },
  "thresholds": {
    "section_score": 12,
    "section_margin": 4,
    "chapter_score": 9,
    "chapter_margin": 3,
    "basic_lead": 4
  },
  "rules": [
    {
      "level": 2,
      "chapter_id": "warehouse-l2-c03",
      "section_id": "warehouse-l2-c03-s04",
      "strong_phrases": ["磷化氢环流熏蒸", "储粮害虫防治方案"],
      "keywords": ["熏蒸剂", "杀虫剂", "害虫", "防护剂"],
      "context_terms": ["剂量", "浓度", "密闭", "散气"],
      "exclude_terms": ["害虫识别", "虫态检查", "取样检查"]
    }
  ]
}
```

此时只放一条可加载的种子规则；完整 92 个 `(level, section_id)` 目标在 Task 5 加入，并由完整性测试门禁。共享基础目录的 5 个小节分别对五个等级配置，因此目标数是 92，而不是 72 个唯一 section ID。

- [ ] **Step 5: 运行规则加载器测试确认 GREEN**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classify.py -v
```

Expected: 4 tests PASS。

- [ ] **Step 6: 提交规则模型**

```powershell
git add src/grain_quiz/warehouse_classify.py tools/warehouse_classification_rules.json tests/test_warehouse_classify.py
git commit -m "feat: define warehouse classification rules"
```

### Task 3: 重建五等级知识目录和 taxonomy

**Files:**
- Modify: `data/knowledge_catalog.json`
- Modify: `data/taxonomy.json`
- Modify: `tests/test_catalog.py`
- Modify: `tests/test_io_taxonomy.py`
- Modify: `miniapp/tests/catalog.test.ts`

- [ ] **Step 1: 先把目录测试改为新规格**

在 `tests/test_catalog.py` 的 `EXPECTED_OUTLINES["4-02-06-01"]` 中执行这些精确变化：

- `warehouse-basic.levels` 改为 `5,4,3,2,1`。
- 删除 `warehouse-import`、`warehouse-import-c01`、`warehouse-import-c01-s01` 三行。
- 每个现有章在已有小节后追加 `s00|本章综合考查`，显示序号取该章下一正整数：
  - `warehouse-basic-c01-s00` number 3；`warehouse-basic-c02-s00` number 4。
  - `warehouse-l5-c03-s00` number 4；`c04-s00` number 6；`c05-s00` number 6。
  - `warehouse-l4-c06-s00` number 4；`c07-s00` number 5；`c08-s00` number 6。
  - `warehouse-l3-c09-s00` number 4；`c10-s00` number 6；`c11-s00` number 7。
- 新增 `warehouse-l2` part number 5，标题“技师粮油仓储管理员”，只对 level 2 可见。
- 新增 `warehouse-l1` part number 6，标题“高级技师粮油仓储管理员”，只对 level 1 可见。

新增断言：

```python
def test_warehouse_catalog_matches_confirmed_five_level_structure():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert catalog.counts("4-02-06-01") == {
        "parts": 6,
        "chapters": 20,
        "sections": 92,
    }
    assert catalog.allows(
        "4-02-06-01", 1, "warehouse-basic-c02", "warehouse-basic-c02-s03"
    )
    assert catalog.allows(
        "4-02-06-01", 2, "warehouse-l2-c03", "warehouse-l2-c03-s04"
    )
    assert catalog.allows(
        "4-02-06-01", 1, "warehouse-l1-c04", "warehouse-l1-c04-s03"
    )
    assert not catalog.allows(
        "4-02-06-01", 1, "warehouse-import-c01", "warehouse-import-c01-s01"
    )
```

- [ ] **Step 2: 修改小程序目录测试并确认 RED**

将 `miniapp/tests/catalog.test.ts` 的 part 断言改为：

```typescript
expect(partsFor(5).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l5']);
expect(partsFor(4).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l4']);
expect(partsFor(3).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l3']);
expect(partsFor(2).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l2']);
expect(partsFor(1).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l1']);
expect(chapterTitlesFor(2)).toEqual(
  expect.arrayContaining(['职业道德', '基础知识', '粮油出入库管理', '粮情检查', '粮情控制', '培训指导']),
);
expect(chapterTitlesFor(1)).toEqual(
  expect.arrayContaining([
    '职业道德',
    '基础知识',
    '粮油出入库管理',
    '粮情检查',
    '粮情控制',
    '粮油储藏工艺设计',
    '培训指导',
  ]),
);
```

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_catalog.py tests/test_io_taxonomy.py -v
Set-Location miniapp
npm test -- catalog.test.ts
Set-Location ..
```

Expected: Python 和 Vitest 均因仍存在 `warehouse-import`、缺少 L2/L1 目录而 FAIL。

- [ ] **Step 3: 按确认表更新 `data/knowledge_catalog.json`**

L2 目录必须精确为：

```text
warehouse-l2-c01 粮油出入库管理
  s01 粮油出入库准备
  s00 本章综合考查
warehouse-l2-c02 粮情检查
  s01 粮堆气体成分
  s02 储粮虫害
  s03 粮油储藏品质
  s04 发热与霉变
  s00 本章综合考查
warehouse-l2-c03 粮情控制
  s01 储粮温度
  s02 储粮水分
  s03 粮堆气体成分
  s04 储粮虫害
  s05 储粮发热与霉变
  s06 储粮效益分析
  s00 本章综合考查
warehouse-l2-c04 培训指导
  s01 培训
  s02 指导
  s03 专业技术报告
  s00 本章综合考查
```

L1 目录必须精确为：

```text
warehouse-l1-c01 粮油出入库管理
  s01 粮油出入库准备
  s00 本章综合考查
warehouse-l1-c02 粮情检查
  s01 储粮虫害
  s02 粮油储藏品质
  s00 本章综合考查
warehouse-l1-c03 粮情控制
  s01 储粮温度
  s02 储粮水分
  s03 储粮虫害
  s04 储粮品质
  s00 本章综合考查
warehouse-l1-c04 粮油储藏工艺设计
  s01 低温储粮
  s02 储粮调质通风
  s03 气调储粮
  s04 储粮效益分析
  s00 本章综合考查
warehouse-l1-c05 培训指导
  s01 培训
  s02 指导
  s03 专业技术报告
  s00 本章综合考查
```

所有新增 L2/L1 章和节 `page` 为 `null`；每章 `s00` 放在 sections 数组末尾，`number` 为前一小节序号加 1。

- [ ] **Step 4: 使 taxonomy 与目录标题一一对应**

对 occupation `4-02-06-01` 的每个等级，模块必须等于该等级可见 chapter title，主题必须等于该章 section title；删除五个等级的“资料整理题库”。等级 2 和 1 的完整模块集合分别为：

```json
{
  "2": ["职业道德", "基础知识", "粮油出入库管理", "粮情检查", "粮情控制", "培训指导"],
  "1": ["职业道德", "基础知识", "粮油出入库管理", "粮情检查", "粮情控制", "粮油储藏工艺设计", "培训指导"]
}
```

每个模块的 topics 按 catalog 顺序列出，并包含末尾的“本章综合考查”。不修改 occupation `4-08-05-01`。

- [ ] **Step 5: 运行目录测试确认 GREEN**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_catalog.py tests/test_io_taxonomy.py -v
Set-Location miniapp
npm test -- catalog.test.ts
Set-Location ..
```

Expected: 聚焦测试全部 PASS。

- [ ] **Step 6: 提交目录**

```powershell
git add data/knowledge_catalog.json data/taxonomy.json tests/test_catalog.py tests/test_io_taxonomy.py miniapp/tests/catalog.test.ts
git commit -m "feat: add five-level warehouse knowledge catalog"
```

### Task 4: 实现确定性加权分类算法

**Files:**
- Modify: `src/grain_quiz/warehouse_classify.py`
- Modify: `tests/test_warehouse_classify.py`

- [ ] **Step 1: 写规范化和字段加权失败测试**

在 `tests/test_warehouse_classify.py` 增加一个只含两条规则的 `WarehouseClassifier` fixture，断言 NFKC、空白折叠、字段权重和 context 门控：

```python
def test_classifier_normalizes_nfkc_and_weights_stem_options_and_explanation(classifier):
    result = classifier.classify(
        level=2,
        stem="采用ＰＨ３ 环 流 熏 蒸控制害虫",
        options=("应检查浓度", "完成后散气"),
        explanation="磷化氢环流熏蒸属于化学防治",
    )

    assert result.status == "section"
    assert result.chapter_id == "warehouse-l2-c03"
    assert result.section_id == "warehouse-l2-c03-s04"
    assert "磷化氢环流熏蒸" in result.candidates[0].matched_terms


def test_context_terms_do_not_score_without_a_primary_term(classifier):
    result = classifier.classify(
        level=2,
        stem="应控制浓度并按时散气",
        options=(),
        explanation="",
    )

    assert result.status == "pending"
    assert result.reason == "low_score"
```

- [ ] **Step 2: 写阈值、并列和 `s00` 失败测试**

```python
def test_section_requires_score_12_and_margin_4(classifier):
    result = classifier.classify(
        level=2,
        stem="磷化氢环流熏蒸",
        options=(),
        explanation="",
    )
    assert result.status == "section"
    assert result.candidates[0].score == 12


def test_chapter_fallback_uses_s00_when_chapter_is_clear(classifier):
    result = classifier.classify(
        level=2,
        stem="粮温和水分需要综合控制",
        options=(),
        explanation="通风方案同时考虑温度与水分",
    )
    assert result.status == "chapter"
    assert result.chapter_id == "warehouse-l2-c03"
    assert result.section_id == "warehouse-l2-c03-s00"


def test_equal_top_candidates_are_pending(classifier):
    result = classifier.classify(
        level=2,
        stem="储粮害虫",
        options=(),
        explanation="",
    )
    assert result.status == "pending"
    assert result.reason == "ambiguous"


def test_unknown_level_is_pending(classifier):
    result = classifier.classify(level=9, stem="熏蒸", options=(), explanation="")
    assert result.status == "pending"
    assert result.reason == "no_rule"
```

- [ ] **Step 3: 写共享基础目录优先级和确定性失败测试**

```python
def test_basic_rule_must_lead_level_specific_rule_by_four_points(basic_classifier):
    specific = basic_classifier.classify(
        level=2,
        stem="安全操作粮食通风设备",
        options=(),
        explanation="",
    )
    basic = basic_classifier.classify(
        level=2,
        stem="安全生产责任制与环境保护法律法规",
        options=(),
        explanation="",
    )

    assert specific.chapter_id == "warehouse-l2-c03"
    assert basic.chapter_id == "warehouse-basic-c02"


def test_same_input_and_rule_version_are_deterministic(classifier):
    arguments = {
        "level": 2,
        "stem": "磷化氢环流熏蒸后检测浓度并散气",
        "options": ("保持密闭",),
        "explanation": "用于储粮害虫防治",
    }
    assert classifier.classify(**arguments) == classifier.classify(**arguments)
```

- [ ] **Step 4: 运行测试确认 RED**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classify.py -v
```

Expected: loader tests PASS，新分类行为因 `WarehouseClassifier` 尚不存在而 FAIL。

- [ ] **Step 5: 实现分类结果和评分器**

在 `src/grain_quiz/warehouse_classify.py` 增加：

```python
import unicodedata
from collections import defaultdict
from collections.abc import Sequence
from functools import lru_cache
from typing import Literal


PendingReason = Literal["ambiguous", "low_score", "no_rule"]


@dataclass(frozen=True)
class ClassificationCandidate:
    chapter_id: str
    section_id: str
    score: int
    matched_terms: tuple[str, ...]


@dataclass(frozen=True)
class ClassificationResult:
    status: Literal["section", "chapter", "pending"]
    chapter_id: str | None
    section_id: str | None
    candidates: tuple[ClassificationCandidate, ...]
    reason: PendingReason | None = None


def normalize_classification_text(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


class WarehouseClassifier:
    def __init__(self, rules: WarehouseRuleSet):
        self.rules = rules

    def classify(
        self,
        *,
        level: int,
        stem: str,
        options: Sequence[str],
        explanation: str,
    ) -> ClassificationResult:
        level_rules = tuple(rule for rule in self.rules.rules if rule.level == level)
        if not level_rules:
            return ClassificationResult("pending", None, None, (), "no_rule")
        fields = (
            (normalize_classification_text(stem), self.rules.stem_weight),
            (normalize_classification_text(" ".join(options)), self.rules.options_weight),
            (normalize_classification_text(explanation), self.rules.explanation_weight),
        )
        candidates = tuple(
            sorted(
                (self._score(rule, fields) for rule in level_rules),
                key=lambda item: (-item.score, item.chapter_id, item.section_id),
            )
        )
        positive = tuple(candidate for candidate in candidates if candidate.score > 0)
        if not positive:
            return ClassificationResult("pending", None, None, (), "no_rule")
        decision_candidates = self._decision_candidates(positive)
        remaining = tuple(item for item in positive if item not in decision_candidates)
        ranked = (*decision_candidates, *remaining)
        first = decision_candidates[0]
        second_score = decision_candidates[1].score if len(decision_candidates) > 1 else 0
        if len(decision_candidates) > 1 and first.score == second_score:
            return ClassificationResult("pending", None, None, ranked[:3], "ambiguous")
        if first.score >= self.rules.section_score and first.score - second_score >= self.rules.section_margin:
            return ClassificationResult(
                "section", first.chapter_id, first.section_id, ranked[:3]
            )
        chapter_scores: dict[str, int] = defaultdict(int)
        for candidate in decision_candidates:
            chapter_scores[candidate.chapter_id] += max(candidate.score, 0)
        ranked_chapters = sorted(chapter_scores.items(), key=lambda item: (-item[1], item[0]))
        chapter_id, chapter_score = ranked_chapters[0]
        second_chapter_score = ranked_chapters[1][1] if len(ranked_chapters) > 1 else 0
        if len(ranked_chapters) > 1 and chapter_score == second_chapter_score:
            return ClassificationResult("pending", None, None, ranked[:3], "ambiguous")
        if chapter_score >= self.rules.chapter_score and chapter_score - second_chapter_score >= self.rules.chapter_margin:
            return ClassificationResult(
                "chapter", chapter_id, f"{chapter_id}-s00", ranked[:3]
            )
        return ClassificationResult("pending", None, None, ranked[:3], "low_score")
```

`_score` 的固定规则：每个术语在每个字段最多计一次；`strong_phrases`、`keywords` 命中后才允许同一规则的 `context_terms` 计分；`exclude_terms` 使用负基础权重并乘同一字段权重；`matched_terms` 去重排序，排除词记为 `!术语`。`_decision_candidates` 的固定规则：若最佳基础候选与最佳等级专属候选同时存在，且基础候选原始分数领先不足 4 分，则本次阈值和章节汇总只使用等级专属候选；否则使用全部候选。返回结果的 `candidates` 仍把决策池放在前面，并附带其余高分候选供审计。

同文件提供默认入口，保持设计规格接口：

```python
DEFAULT_RULES_PATH = Path(__file__).resolve().parents[2] / "tools" / "warehouse_classification_rules.json"
DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[2] / "data" / "knowledge_catalog.json"


@lru_cache(maxsize=1)
def _default_classifier() -> WarehouseClassifier:
    from grain_quiz.catalog import load_knowledge_catalog

    catalog = load_knowledge_catalog(DEFAULT_CATALOG_PATH)
    return WarehouseClassifier(load_warehouse_rules(DEFAULT_RULES_PATH, catalog))


def classify_warehouse_question(
    *,
    level: int,
    stem: str,
    options: Sequence[str],
    explanation: str,
) -> ClassificationResult:
    return _default_classifier().classify(
        level=level,
        stem=stem,
        options=options,
        explanation=explanation,
    )
```

- [ ] **Step 6: 运行分类器测试确认 GREEN**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classify.py -v
```

Expected: 全部分类器测试 PASS。

- [ ] **Step 7: 提交评分器**

```powershell
git add src/grain_quiz/warehouse_classify.py tests/test_warehouse_classify.py
git commit -m "feat: classify warehouse questions deterministically"
```

### Task 5: 完成五等级规则并锁定代表性样例

**Files:**
- Modify: `tools/warehouse_classification_rules.json`
- Modify: `tests/test_warehouse_classify.py`

- [ ] **Step 1: 写生产规则完整性失败测试**

从 catalog 计算每个等级所有非 `s00` 可见小节，并要求规则集合完全相等：

```python
def _expected_rule_targets() -> set[tuple[int, str]]:
    targets: set[tuple[int, str]] = set()
    occupation = CATALOG.occupations["4-02-06-01"]
    for level in (5, 4, 3, 2, 1):
        for part in occupation.parts:
            if level not in part.levels:
                continue
            for chapter in part.chapters:
                for section in chapter.sections:
                    if not section.id.endswith("-s00"):
                        targets.add((level, section.id))
    return targets


def test_production_rules_cover_every_publishable_non_fallback_section():
    rules = load_warehouse_rules(
        Path("tools/warehouse_classification_rules.json"),
        CATALOG,
    )

    assert {(rule.level, rule.section_id) for rule in rules.rules} == _expected_rule_targets()
    assert len(rules.rules) == 92
```

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classify.py::test_production_rules_cover_every_publishable_non_fallback_section -v
```

Expected: FAIL because production file currently has 1 rule instead of 92。

- [ ] **Step 2: 写 L2/L1 每小节一题的参数化失败测试**

在测试中加入以下 28 个 `(level, section_id, stem)` 代表样例；`options=()`、`explanation=""`，每条都必须得到 `status == "section"` 和指定 section：

```python
REPRESENTATIVE_ADVANCED_CASES = (
    (2, "warehouse-l2-c01-s01", "粮食入库前应制定接收方案并检查仓房、输送设备和计量器具"),
    (2, "warehouse-l2-c02-s01", "使用气体检测仪测定粮堆氧气和二氧化碳浓度"),
    (2, "warehouse-l2-c02-s02", "通过取样筛检识别玉米象虫态并统计虫口密度"),
    (2, "warehouse-l2-c02-s03", "检测脂肪酸值和品尝评分以判定粮油储藏品质"),
    (2, "warehouse-l2-c02-s04", "粮堆发热伴随霉菌活动时应分析霉变原因"),
    (2, "warehouse-l2-c03-s01", "根据粮温变化制定机械通风降温措施"),
    (2, "warehouse-l2-c03-s02", "对高水分粮实施通风降水和水分控制"),
    (2, "warehouse-l2-c03-s03", "采用充氮气调控制粮堆氧气浓度"),
    (2, "warehouse-l2-c03-s04", "制定磷化氢环流熏蒸方案并控制剂量和散气"),
    (2, "warehouse-l2-c03-s05", "对发热霉变粮进行倒仓通风和局部处理"),
    (2, "warehouse-l2-c03-s06", "计算储粮损耗能耗和保管费用并分析储粮效益"),
    (2, "warehouse-l2-c04-s01", "编制保管员培训计划教案并组织理论授课"),
    (2, "warehouse-l2-c04-s02", "现场指导初级人员操作通风设备并纠正错误"),
    (2, "warehouse-l2-c04-s03", "撰写粮食仓储专业技术报告并形成摘要数据和结论"),
    (1, "warehouse-l1-c01-s01", "制定大型粮库粮油出入库作业组织方案和应急预案"),
    (1, "warehouse-l1-c02-s01", "分析储粮害虫抗药性虫种虫态和虫口密度"),
    (1, "warehouse-l1-c02-s02", "综合脂肪酸值降落数值和品尝评分判定储藏品质"),
    (1, "warehouse-l1-c03-s01", "优化粮温控制和机械通风降温运行参数"),
    (1, "warehouse-l1-c03-s02", "制定高水分粮水分控制和安全降水方案"),
    (1, "warehouse-l1-c03-s03", "设计储粮害虫综合治理和抗药性防治方案"),
    (1, "warehouse-l1-c03-s04", "依据储存品质指标确定轮换时机和处置措施"),
    (1, "warehouse-l1-c04-s01", "设计谷物冷却机低温储粮工艺和冷源参数"),
    (1, "warehouse-l1-c04-s02", "设计增湿调质通风工艺并计算通风量"),
    (1, "warehouse-l1-c04-s03", "设计氮气气调储粮系统并计算气密性和耗氮量"),
    (1, "warehouse-l1-c04-s04", "比较低温气调工艺投资运行费用和储粮效益"),
    (1, "warehouse-l1-c05-s01", "建立高级保管员培训体系课程计划和考核标准"),
    (1, "warehouse-l1-c05-s02", "指导技师解决复杂粮情控制问题并评价操作质量"),
    (1, "warehouse-l1-c05-s03", "组织撰写仓储专业技术报告和技术成果总结"),
)


@pytest.mark.parametrize("level,section_id,stem", REPRESENTATIVE_ADVANCED_CASES)
def test_production_rules_classify_every_l2_l1_section(level, section_id, stem):
    result = classify_warehouse_question(
        level=level,
        stem=stem,
        options=(),
        explanation="",
    )

    assert result.status == "section"
    assert result.section_id == section_id
```

- [ ] **Step 3: 写 L5/L4/L3 和共享基础代表测试**

至少增加这些断言：职业道德、法律法规、出入库、害虫检查、害虫防治、粮温控制；相邻“检查/防治”必须分别命中检查章和控制章。

```python
REPRESENTATIVE_EXISTING_CASES = (
    (5, "warehouse-basic-c01-s01", "诚实守信爱岗敬业是职业道德基本规范"),
    (4, "warehouse-basic-c02-s03", "安全生产法和粮食流通管理条例属于相关法律法规"),
    (5, "warehouse-l5-c03-s01", "入库前检查仓房清洁卫生和输送设备"),
    (4, "warehouse-l4-c07-s04", "取样筛检储粮害虫并识别虫态"),
    (3, "warehouse-l3-c11-s04", "磷化氢熏蒸防治储粮害虫并检测浓度"),
    (3, "warehouse-l3-c11-s01", "根据粮温变化实施机械通风降温"),
)
```

- [ ] **Step 4: 填充完整 92 条生产规则**

按 catalog 非 `s00` 小节逐条配置。术语必须遵循以下确定性词族，不得用答案键或题号：

| 类别 | 必须覆盖的正向词族 | 必须覆盖的排除方向 |
| --- | --- | --- |
| 职业道德/守则 | 爱岗敬业、诚实守信、服务群众、职业守则、规范操作 | 具体设备、药剂、检测数值 |
| 仓储基础 | 粮食呼吸、吸湿、导热、散落性、仓房、设备、计量、账卡 | 明确出入库步骤、明确粮情处置 |
| 安全环保 | 安全生产、有限空间、粉尘爆炸、消防、环境保护、劳动防护 | 单纯职业道德表述 |
| 法律法规 | 粮食安全保障法、粮食流通管理条例、安全生产法、标准编号 | 仅操作步骤或设备名称 |
| 出入库准备/作业/收尾 | 仓房准备、接收入库、输送、计量、扦样、平仓、出库、清理、结算 | 粮温、水分、熏蒸、虫态 |
| 粮温检查 | 测温电缆、测温点、粮温变化、温度梯度、检查记录 | 通风降温、冷却机、控制方案 |
| 水分/湿度检查 | 水分测定、相对湿度、平衡水分、湿度计 | 通风降水、调质、增湿控制 |
| 气体检查 | 氧气、二氧化碳、磷化氢检测、气体检测仪、取气 | 充氮、气调、熏蒸剂量、散气 |
| 害虫检查 | 取样、筛检、虫态、虫种、虫口密度、害虫识别 | 药剂、剂量、熏蒸、防护剂、综合治理 |
| 品质检查 | 脂肪酸值、品尝评分、降落数值、过氧化值、储存品质判定 | 轮换处置、工艺设计、效益计算 |
| 发热霉变检查 | 发热原因、霉菌、结露、霉变鉴别、异常粮情分析 | 倒仓、通风、局部处理等处置动作 |
| 温度控制 | 机械通风、降温、谷物冷却机、低温控制 | 测温点、温度计、仅分析变化原因 |
| 水分控制 | 通风降水、烘干、安全水分、调质、增湿 | 水分仪、仅测定或检查水分 |
| 气体控制 | 充氮、气调、密闭、氧浓度控制、二氧化碳气调 | 气体取样、仪器检查、只测浓度 |
| 害虫防治 | 磷化氢、硫酰氟、熏蒸、杀虫剂、防护剂、散气 | 识别、虫态、筛检、虫口密度 |
| 发热霉变控制 | 倒仓、通风、局部处理、隔离、应急处置 | 仅分析原因或识别霉菌 |
| 鼠雀防治 | 防鼠板、毒饵、鼠迹、雀害、防治设施 | 储粮昆虫和熏蒸剂 |
| 效益分析 | 损耗、能耗、成本、费用、投资、收益、经济效益 | 仅设备操作或品质检测 |
| 培训 | 培训计划、课程、教案、授课、考核 | 现场纠错、技术报告结构 |
| 指导 | 现场指导、操作示范、纠正错误、质量评价 | 课程计划、论文摘要 |
| 专业技术报告 | 摘要、关键词、数据分析、结论、技术报告、成果总结 | 日常记录、培训教案 |
| 低温工艺设计 | 冷却机、冷源、低温储粮、工艺参数 | 普通机械通风检查 |
| 调质通风设计 | 增湿调质、调质通风、风量计算、工艺设计 | 普通降水或湿度测定 |
| 气调工艺设计 | 氮气气调、气密性、耗氮量、制氮机、工艺设计 | 仅检测气体浓度 |

同一术语可以出现在相邻等级对应小节，但同一等级相邻小节必须用 `exclude_terms` 明确区分“检查/控制”“培训/指导/报告”“普通控制/工艺设计”。

- [ ] **Step 5: 运行完整规则测试确认 GREEN**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classify.py -v
```

Expected: 完整性测试显示 92 条规则，全部代表样例 PASS。

- [ ] **Step 6: 提交生产规则**

```powershell
git add tools/warehouse_classification_rules.json tests/test_warehouse_classify.py
git commit -m "data: define five-level warehouse classification rules"
```

### Task 6: 将分类器接入导入器并保证身份不漂移

**Files:**
- Modify: `tools/import_warehouse_sources.py`
- Modify: `tests/test_import_warehouse_sources.py`

- [ ] **Step 1: 写基线身份保留失败测试**

先修正现有动态模块加载器，使后续 dataclass 可以解析模块级类型：

```python
import sys


def _load_importer():
    path = Path(__file__).resolve().parents[1] / "tools" / "import_warehouse_sources.py"
    spec = importlib.util.spec_from_file_location("warehouse_importer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load importer at {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
```

再增加明确的测试 helper：

```python
from types import SimpleNamespace

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.warehouse_classify import WarehouseClassifier, load_warehouse_rules


def _baseline_question(question_id: str, stem: str) -> dict[str, object]:
    return {
        "id": question_id,
        "occupation_code": "4-02-06-01",
        "occupation_name": "粮油仓储管理员",
        "direction": "粮油保管员",
        "level": 2,
        "module": "资料整理题库",
        "topic": "技师资料",
        "chapter_id": "warehouse-import-c01",
        "section_id": "warehouse-import-c01-s01",
        "type": "single",
        "stem": stem,
        "options": [
            {"key": "A", "text": "选项甲"},
            {"key": "B", "text": "选项乙"},
            {"key": "C", "text": "选项丙"},
            {"key": "D", "text": "选项丁"},
        ],
        "answer": ["A"],
        "explanation": "答案为：A。",
        "difficulty": "medium",
        "keywords": ["粮油保管"],
        "source_ids": ["SRC-0001"],
        "standard_reference": "用户提供的保管员学习资料",
        "source_note": "来源文件：测试资料.docx",
        "review_status": "verified",
        "valid_from": "2026-08-06",
        "valid_until": None,
        "duplicate_group": None,
        "content_version": 1,
        "created_at": "2026-08-06T17:00:00+08:00",
        "updated_at": "2026-08-06T17:00:00+08:00",
    }


def _production_classifier() -> WarehouseClassifier:
    catalog = load_knowledge_catalog(Path("data/knowledge_catalog.json"))
    rules = load_warehouse_rules(Path("tools/warehouse_classification_rules.json"), catalog)
    return WarehouseClassifier(rules)


def _classification_result(*, published: int, pending: int):
    return SimpleNamespace(
        level=2,
        baseline_count=published + pending,
        published=[{"id": f"published-{index}"} for index in range(published)],
        review=[{"question_id": f"pending-{index}", "reason": "low_score"} for index in range(pending)],
        audit=[],
    )
```

构造一个 baseline 列表，题目 ID 故意不连续，调用新的导入分类流程后断言 ID 不会因 pending 被重新编号：

```python
def test_classification_preserves_baseline_ids_when_a_middle_question_is_pending(tmp_path):
    baseline = [
        _baseline_question("WH-L2-000001", "磷化氢环流熏蒸并检测浓度"),
        _baseline_question("WH-L2-000002", "无法从语义判断章节"),
        _baseline_question("WH-L2-000003", "编制保管员培训计划和教案"),
    ]
    result = IMPORTER.classify_baseline_records(
        baseline,
        classifier=_production_classifier(),
        catalog=IMPORTER.load_knowledge_catalog(Path("data/knowledge_catalog.json")),
        effective_at="2026-08-07T18:00:00+08:00",
    )

    assert [item["id"] for item in result.published] == [
        "WH-L2-000001",
        "WH-L2-000003",
    ]
    assert [item["question_id"] for item in result.review] == ["WH-L2-000002"]
```

- [ ] **Step 2: 写只改分类元数据失败测试**

```python
def test_classification_changes_only_allowed_metadata_fields():
    before = _baseline_question("WH-L2-000001", "磷化氢环流熏蒸并检测浓度")
    result = IMPORTER.classify_baseline_records(
        [before],
        classifier=_production_classifier(),
        catalog=IMPORTER.load_knowledge_catalog(Path("data/knowledge_catalog.json")),
        effective_at="2026-08-07T18:00:00+08:00",
    )
    after = result.published[0]

    immutable = {
        "id", "level", "stem", "options", "answer", "explanation",
        "source_ids", "source_note", "standard_reference", "created_at",
    }
    assert {field: after[field] for field in immutable} == {
        field: before[field] for field in immutable
    }
    assert after["content_version"] == before["content_version"] + 1
    assert after["updated_at"] == "2026-08-07T18:00:00+08:00"
```

- [ ] **Step 3: 写 review/audit 结构和覆盖率原子门禁失败测试**

```python
def test_pending_records_are_not_published_and_keep_top_three_candidates():
    result = IMPORTER.classify_baseline_records(
        [_baseline_question("WH-L2-000002", "无法从语义判断章节")],
        classifier=_production_classifier(),
        catalog=IMPORTER.load_knowledge_catalog(Path("data/knowledge_catalog.json")),
        effective_at="2026-08-07T18:00:00+08:00",
    )

    assert result.published == []
    assert result.review[0]["reason"] in {"ambiguous", "low_score", "no_rule"}
    assert len(result.review[0]["candidates"]) <= 3


def test_output_files_are_unchanged_when_coverage_is_below_80_percent(tmp_path):
    output_dir = tmp_path / "questions"
    output_dir.mkdir()
    target = output_dir / "warehouse_l2.jsonl"
    target.write_text("sentinel\n", encoding="utf-8")

    with pytest.raises(IMPORTER.ClassificationCoverageError, match="80%"):
        IMPORTER.write_classification_outputs(
            results={2: _classification_result(published=1, pending=4)},
            output_dir=output_dir,
            review_path=tmp_path / "review.jsonl",
            audit_path=tmp_path / "audit.jsonl",
            report_path=tmp_path / "report.json",
            manifest_path=tmp_path / "manifest.json",
            minimum_coverage=0.80,
        )

    assert target.read_text(encoding="utf-8") == "sentinel\n"
```

- [ ] **Step 4: 运行测试确认 RED**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_import_warehouse_sources.py -v
```

Expected: 新测试因 `classify_baseline_records`、结果模型和覆盖率门禁不存在而 FAIL。

- [ ] **Step 5: 实现基线读取和指纹匹配**

保留现有源文件解析函数，新增：

```python
from dataclasses import dataclass
from typing import Any

from grain_quiz.catalog import KnowledgeCatalog, load_knowledge_catalog
from grain_quiz.warehouse_classify import ClassificationResult, WarehouseClassifier


IMMUTABLE_FIELDS = (
    "id", "level", "stem", "options", "answer", "explanation",
    "source_ids", "source_note", "standard_reference", "created_at",
)


@dataclass(frozen=True)
class LevelClassification:
    level: int
    baseline_count: int
    published: list[dict[str, Any]]
    review: list[dict[str, Any]]
    audit: list[dict[str, Any]]

    @property
    def coverage(self) -> float:
        return len(self.published) / self.baseline_count if self.baseline_count else 0.0


class ClassificationCoverageError(RuntimeError):
    pass


def load_baseline_records(baseline_dir: Path) -> dict[int, list[dict[str, Any]]]:
    records: dict[int, list[dict[str, Any]]] = {}
    for level in (5, 4, 3, 2, 1):
        path = baseline_dir / f"warehouse_l{level}.jsonl"
        records[level] = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    return records
```

源解析结果按 `(level, _question_fingerprint(parsed))` 与 baseline 建立一对一映射；出现 baseline 缺失、重复指纹或解析结果数量与 baseline 不一致时立即报错，不写正式数据。正式记录以 baseline dict 为起点复制，杜绝解析器格式细节改变题干或选项。

- [ ] **Step 6: 实现分类元数据更新**

新增 catalog label 索引并更新允许字段：

```python
def _catalog_labels(
    catalog: KnowledgeCatalog,
    *,
    level: int,
    chapter_id: str,
    section_id: str,
) -> tuple[str, str]:
    occupation = catalog.occupations["4-02-06-01"]
    for part in occupation.parts:
        if level not in part.levels:
            continue
        for chapter in part.chapters:
            if chapter.id != chapter_id:
                continue
            for section in chapter.sections:
                if section.id == section_id:
                    return chapter.title, section.title
    raise ValueError(f"catalog path not found: level {level} {chapter_id} {section_id}")


def _classified_record(
    baseline: dict[str, Any],
    classification: ClassificationResult,
    catalog: KnowledgeCatalog,
    effective_at: str,
) -> dict[str, Any]:
    if classification.chapter_id is None or classification.section_id is None:
        raise ValueError("pending classification cannot be published")
    module, topic = _catalog_labels(
        catalog,
        level=int(baseline["level"]),
        chapter_id=classification.chapter_id,
        section_id=classification.section_id,
    )
    matched = [
        term
        for candidate in classification.candidates
        if candidate.chapter_id == classification.chapter_id
        for term in candidate.matched_terms
        if not term.startswith("!")
    ]
    record = dict(baseline)
    record.update(
        module=module,
        topic=topic,
        chapter_id=classification.chapter_id,
        section_id=classification.section_id,
        keywords=list(dict.fromkeys([*baseline.get("keywords", []), *matched])),
        content_version=int(baseline["content_version"]) + 1,
        updated_at=effective_at,
    )
    return record
```

调用分类器时只传题干、选项文本和解析，不传 `answer`：

```python
classification = classifier.classify(
    level=int(baseline["level"]),
    stem=str(baseline["stem"]),
    options=tuple(str(option["text"]) for option in baseline["options"]),
    explanation=str(baseline["explanation"]),
)
```

- [ ] **Step 7: 实现 review、audit、report 和原子正式写入**

review 每行字段固定为：`question_id`、`level`、`stem`、`source_note`、`reason`、`candidates`；candidate 固定为 `chapter_id`、`section_id`、`score`、`matched_terms`。audit 每行增加最终 `status`、`chapter_id`、`section_id`、规则 `version`。

先把五个正式文件和 `data/warehouse_classification_manifest.json` 写入 `output_dir.parent / ".warehouse-classification-staging"`；manifest 固定包含 `rules_version`、`baseline_counts`、`published_counts`、`pending_counts`、`coverage` 和按 ID 排序的 `pending`（每项只有 `question_id`、`level`、`reason`）。只有整体覆盖率 `sum(published)/sum(baseline) >= 0.80` 后才逐个 `Path.replace()` 到正式位置。review/audit/report 无论是否过门禁都可写入 `tmp`，便于修正规则。

CLI 参数改为：

```text
--source-dir D:\桌面\储备粮\保管员
--baseline-dir tmp/warehouse-classification-baseline-70156a7
--output-dir data/questions
--review tmp/warehouse-classification-review.jsonl
--audit tmp/warehouse-classification-audit.jsonl
--report tmp/warehouse-classification-report.json
--manifest data/warehouse_classification_manifest.json
--rules tools/warehouse_classification_rules.json
--catalog data/knowledge_catalog.json
--effective-at 2026-08-07T18:00:00+08:00
--minimum-coverage 0.80
```

- [ ] **Step 8: 运行导入器测试确认 GREEN**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_import_warehouse_sources.py -v
```

Expected: 现有解析测试和新分类集成测试全部 PASS。

- [ ] **Step 9: 提交导入集成**

```powershell
git add tools/import_warehouse_sources.py tests/test_import_warehouse_sources.py
git commit -m "feat: audit warehouse classifications during import"
```

### Task 7: 生成正式分类数据并迭代到 80% 覆盖率

**Files:**
- Modify: `tools/warehouse_classification_rules.json`
- Modify: `tests/test_warehouse_classify.py`
- Modify: `data/questions/warehouse_l1.jsonl`
- Modify: `data/questions/warehouse_l2.jsonl`
- Modify: `data/questions/warehouse_l3.jsonl`
- Modify: `data/questions/warehouse_l4.jsonl`
- Modify: `data/questions/warehouse_l5.jsonl`
- Create: `data/warehouse_classification_manifest.json`
- Generate locally: `tmp/warehouse-classification-review.jsonl`
- Generate locally: `tmp/warehouse-classification-audit.jsonl`
- Generate locally: `tmp/warehouse-classification-report.json`

- [ ] **Step 1: 第一次运行全量分类**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python tools/import_warehouse_sources.py `
  --source-dir 'D:\桌面\储备粮\保管员' `
  --baseline-dir tmp/warehouse-classification-baseline-70156a7 `
  --output-dir data/questions `
  --review tmp/warehouse-classification-review.jsonl `
  --audit tmp/warehouse-classification-audit.jsonl `
  --report tmp/warehouse-classification-report.json `
  --manifest data/warehouse_classification_manifest.json `
  --rules tools/warehouse_classification_rules.json `
  --catalog data/knowledge_catalog.json `
  --effective-at '2026-08-07T18:00:00+08:00' `
  --minimum-coverage 0.80
```

Expected: 命令打印每等级 baseline/published/pending/coverage 和总覆盖率。若总覆盖率不足 80%，退出非零且 `data/questions/warehouse_l*.jsonl` 的 Git diff 为空。

- [ ] **Step 2: 对每一类规则修订先加回归测试**

从 report 的 `reason_counts` 和 review 的前三候选中按数量从高到低处理。每次只接受以下两类改动：

1. 某专业同义词缺失：先把一条真实题干脱敏复制为新的参数化测试，再将该术语加到唯一目标规则。
2. 相邻章节误判：先写一条同时包含共享词的失败测试，再给错误目标增加 `exclude_terms`，或给正确目标增加完整 `strong_phrases`。

禁止通过降低 12/4、9/3 阈值提高覆盖率；禁止加入题号、答案键、文件名或单个无专业含义的常用词。

- [ ] **Step 3: 每轮规则修改后运行聚焦测试和全量分类**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classify.py tests/test_import_warehouse_sources.py -q
python tools/import_warehouse_sources.py `
  --source-dir 'D:\桌面\储备粮\保管员' `
  --baseline-dir tmp/warehouse-classification-baseline-70156a7 `
  --output-dir data/questions `
  --review tmp/warehouse-classification-review.jsonl `
  --audit tmp/warehouse-classification-audit.jsonl `
  --report tmp/warehouse-classification-report.json `
  --manifest data/warehouse_classification_manifest.json `
  --rules tools/warehouse_classification_rules.json `
  --catalog data/knowledge_catalog.json `
  --effective-at '2026-08-07T18:00:00+08:00' `
  --minimum-coverage 0.80
```

Expected: 最终总覆盖率不少于 0.80；五个正式文件均不含 `warehouse-import-c01` 和 `warehouse-import-c01-s01`。

- [ ] **Step 4: 检查数据分布和内容版本**

```powershell
@'
import json
from collections import Counter
from pathlib import Path

for level in (5, 4, 3, 2, 1):
    records = [json.loads(line) for line in Path(f'data/questions/warehouse_l{level}.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    assert records
    assert all(item['level'] == level for item in records)
    assert all(item['id'].startswith(f'WH-L{level}-') for item in records)
    assert all(item['content_version'] == 2 for item in records)
    assert all(item['chapter_id'] != 'warehouse-import-c01' for item in records)
    print(level, len(records), Counter(item['chapter_id'] for item in records))
'@ | python -
```

Expected: 每等级至少分布在共享基础章和当前等级多个专属章中；任何等级都不是单章 100%。

- [ ] **Step 5: 提交规则调优和正式数据**

```powershell
git add tools/warehouse_classification_rules.json tests/test_warehouse_classify.py data/warehouse_classification_manifest.json data/questions/warehouse_l1.jsonl data/questions/warehouse_l2.jsonl data/questions/warehouse_l3.jsonl data/questions/warehouse_l4.jsonl data/questions/warehouse_l5.jsonl
git commit -m "data: classify warehouse question bank by chapter"
```

### Task 8: 增加数据不变量、审计报告和 100 题分层样本

**Files:**
- Create: `tools/audit_warehouse_classification.py`
- Create: `tests/test_warehouse_classification_dataset.py`
- Create: `docs/qa/2026-08-07-warehouse-question-classification-audit.md`

- [ ] **Step 1: 写正式数据不变量失败测试**

`tests/test_warehouse_classification_dataset.py` 只加载已提交的正式数据、manifest 和 catalog，保证干净检出环境不依赖 `tmp`：

```python
def test_pending_questions_are_absent_from_published_shards():
    published = _records_by_id(Path("data/questions"))
    manifest = json.loads(
        Path("data/warehouse_classification_manifest.json").read_text(encoding="utf-8")
    )
    pending_ids = {item["question_id"] for item in manifest["pending"]}
    assert pending_ids.isdisjoint(published)


def test_every_published_path_is_in_the_level_catalog():
    catalog = load_knowledge_catalog(Path("data/knowledge_catalog.json"))
    for question in _records_by_id(Path("data/questions")).values():
        assert question["chapter_id"] != "warehouse-import-c01"
        assert question["section_id"] != "warehouse-import-c01-s01"
        assert catalog.allows(
            question["occupation_code"],
            question["level"],
            question["chapter_id"],
            question["section_id"],
        )


def test_automatic_classification_coverage_is_at_least_80_percent():
    manifest = json.loads(
        Path("data/warehouse_classification_manifest.json").read_text(encoding="utf-8")
    )
    published = _records_by_id(Path("data/questions"))
    baseline_count = sum(manifest["baseline_counts"].values())
    published_count = sum(manifest["published_counts"].values())
    pending_count = sum(manifest["pending_counts"].values())
    assert baseline_count == 4110
    assert published_count == len(published)
    assert published_count + pending_count == baseline_count
    assert manifest["coverage"] >= 0.80
```

- [ ] **Step 2: 运行不变量测试确认当前产物满足约束**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classification_dataset.py -v
```

Expected: 全部 PASS；如失败，修复导入/规则后重新生成全部五等级数据，不手改单条 JSONL。

- [ ] **Step 3: 实现确定性审计工具**

`tools/audit_warehouse_classification.py` 提供三个子命令：

```text
invariants --baseline-dir <dir> --questions <dir> --review <jsonl> --manifest <json>
sample --audit <audit.jsonl> --questions <dir> --output <csv> --per-level 20
verify --sample <csv> --report <report.json> --output-summary <json>
```

`invariants` 比较 baseline 与正式题中相同 ID 的不可变字段，要求 baseline ID 恰好等于正式 ID 与 review ID 的不相交并集，并核对 manifest 的计数、原因和 ID。任何题干、选项、答案、来源、等级或 ID 变化都退出非零。

`sample` 的固定算法：按 level 分组，再按 chapter_id 排序轮询抽取；同章内按 `sha256(question_id)` 排序；每等级恰好 20 题；CSV 列固定为 `question_id,level,chapter_id,chapter_title,section_id,section_title,stem,source_note,chapter_correct,review_note`，最后两列初始为空。重复运行必须生成字节一致文件。

`verify` 要求 100 行 `chapter_correct` 全部填为 `yes` 或 `no`，计算整体和每章正确率；整体低于 90% 或任一抽样数不少于 3 的章节低于 85% 时退出非零。输出 summary 包含 `overall_accuracy`、`level_accuracy`、`chapter_accuracy`、`reviewed_count`。

- [ ] **Step 4: 为审计工具写 RED/GREEN 单元测试**

在 `tests/test_warehouse_classification_dataset.py` 用小型 baseline/published/review fixture 断言不可变字段漂移和 ID 集合不完整会被拒绝；再用 2 个等级、每等级 3 个章的小样本断言：重复抽样一致、每等级数量准确、章节轮询覆盖、空人工字段拒绝、89% 整体正确率拒绝、84% 章节正确率拒绝、合格样本通过。

Run:

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest tests/test_warehouse_classification_dataset.py -v
```

Expected: 新审计工具测试先因模块/函数缺失 FAIL；实现后全部 PASS。

- [ ] **Step 5: 运行全量数据不变量审计**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python tools/audit_warehouse_classification.py invariants `
  --baseline-dir tmp/warehouse-classification-baseline-70156a7 `
  --questions data/questions `
  --review tmp/warehouse-classification-review.jsonl `
  --manifest data/warehouse_classification_manifest.json
```

Expected: 4110 个 baseline ID 恰好拆分为正式与 pending；所有正式题不可变字段逐项相同。

- [ ] **Step 6: 生成 100 题分层样本**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python tools/audit_warehouse_classification.py sample `
  --audit tmp/warehouse-classification-audit.jsonl `
  --questions data/questions `
  --catalog data/knowledge_catalog.json `
  --output tmp/warehouse-classification-sample.csv `
  --per-level 20
```

Expected: CSV 共 101 行（表头 + 100 题），每等级 20 题。

- [ ] **Step 7: 人工逐题复核章节**

按本地教材和正确国家标准判断 `chapter_id` 是否正确，在 CSV 填 `chapter_correct=yes/no`，小节仅记录明显错误但不计入本轮 90% 章节门禁。每复核完一个等级保存一次，禁止改题目或自动重抽样。

- [ ] **Step 8: 验证人工复核门禁**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python tools/audit_warehouse_classification.py verify `
  --sample tmp/warehouse-classification-sample.csv `
  --report tmp/warehouse-classification-report.json `
  --output-summary tmp/warehouse-classification-review-summary.json
```

Expected: `reviewed_count=100`、整体章节正确率不低于 0.90、任一满足抽样数量条件的章节不低于 0.85。失败时回到 Task 7，先加回归测试、改规则、重建全部题库并重新抽样。

- [ ] **Step 9: 记录可提交 QA 摘要**

创建 `docs/qa/2026-08-07-warehouse-question-classification-audit.md`，记录：规则版本、五等级 baseline/published/pending/coverage、pending 原因分布、章节/小节分布、100 题整体/等级/章节正确率、所有验证命令；不复制完整题干和原始资料内容。

- [ ] **Step 10: 提交审计工具、测试和摘要**

```powershell
git add tools/audit_warehouse_classification.py tests/test_warehouse_classification_dataset.py docs/qa/2026-08-07-warehouse-question-classification-audit.md
git commit -m "test: audit warehouse question classifications"
```

### Task 9: 构建发布分片并验证小程序章节交互

**Files:**
- Modify: `miniapp/tests/catalog.test.ts`
- Modify: `miniapp/tests/catalog-presenter.test.ts`
- Modify: `miniapp/tests/local-question-repository.test.ts`
- Modify generated: `miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts`
- Modify generated: `miniapp/miniprogram/data/questions/runtime-question-records.ts`
- Modify: `README.md`

- [ ] **Step 1: 写章节计数和旧路由失败测试**

在 `miniapp/tests/catalog-presenter.test.ts` 增加：

```typescript
it('sums chapter counts to the published count for every warehouse level', async () => {
  const repository = new LocalQuestionRepository(QUESTION_RECORDS);
  const questions = await repository.list();
  for (const level of [5, 4, 3, 2, 1] as const) {
    const levelQuestions = questions.filter(
      (question) => question.occupation === '4-02-06-01' && question.level === level,
    );
    const parts = presentCatalogParts({
      catalog: KNOWLEDGE_CATALOG,
      occupation: '4-02-06-01',
      level,
      questions: levelQuestions,
      getProgress: noProgress,
    });
    const chapterTotal = parts
      .flatMap((part) => part.chapters)
      .reduce((sum, chapter) => sum + chapter.questionCount, 0);
    expect(chapterTotal).toBe(levelQuestions.length);
    expect(parts.flatMap((part) => part.chapters).filter((chapter) => chapter.questionCount > 0).length)
      .toBeGreaterThan(1);
  }
});
```

在旧路由校验表中加入：

```typescript
{
  occupation: '4-02-06-01',
  level: '2',
  chapterId: 'warehouse-import-c01',
}
```

Expected: `parseChapterRoute(...)` 返回 `null`，不能回退到该等级全部题目。

- [ ] **Step 2: 写按新稳定 ID 查询失败测试**

在 `miniapp/tests/local-question-repository.test.ts` 的 `records` fixture 加入：

```typescript
runtimeQuestion({
  id: 'WH-L2-000001',
  level: 2,
  module: '粮情控制',
  topic: '储粮虫害',
  chapter_id: 'warehouse-l2-c03',
  section_id: 'warehouse-l2-c03-s04',
}),
runtimeQuestion({
  id: 'WH-L1-000001',
  level: 1,
  module: '粮油储藏工艺设计',
  topic: '气调储粮',
  chapter_id: 'warehouse-l1-c04',
  section_id: 'warehouse-l1-c04-s03',
}),
```

并断言：

```typescript
await expect(
  repository.list({
    occupation: '4-02-06-01',
    level: 2,
    sectionId: 'warehouse-l2-c03-s04',
  }),
).resolves.toEqual([expect.objectContaining({ id: 'WH-L2-000001' })]);
await expect(
  repository.list({
    occupation: '4-02-06-01',
    level: 1,
    chapterId: 'warehouse-l1-c04',
  }),
).resolves.toEqual([expect.objectContaining({ id: 'WH-L1-000001' })]);
await expect(
  repository.list({ level: 2, chapterId: 'warehouse-import-c01' }),
).resolves.toEqual([]);
```

同时更新 `catalog-presenter.test.ts` 中受新目录影响的旧硬编码：首个基础章的 `sectionCountText` 从 `2 小节` 改为 `3 小节`；把“60 个空小节”测试改名为“保留所有 canonical 空小节”，删除 `toHaveLength(60)`，继续断言计算出的每个空小节都被呈现为 0 题/待补充。

- [ ] **Step 3: 运行构建前测试确认 RED 或陈旧运行时数据**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm test -- catalog.test.ts catalog-presenter.test.ts local-question-repository.test.ts
Set-Location ..
```

Expected: Python validate/build PASS；小程序聚焦测试在同步前因运行时目录仍旧而 FAIL。

- [ ] **Step 4: 同步运行时数据**

```powershell
Set-Location miniapp
npm run sync:questions
Set-Location ..
```

Expected: 打印五个 `warehouse_l*.json` 新正式题数，生成的运行时目录不含 `warehouse-import`。

- [ ] **Step 5: 运行小程序聚焦测试确认 GREEN**

```powershell
Set-Location miniapp
npm test -- catalog.test.ts catalog-presenter.test.ts local-question-repository.test.ts sync-question-bank.test.ts
Set-Location ..
```

Expected: 全部 PASS。

- [ ] **Step 6: 更新 README 的事实描述**

将“六个固定分片”“仓储目录 4 个部分、11 章、44 节”等旧数字改为本次构建的五个保管员分片和 6 个部分、20 章、92 节；说明 pending 题不进入运行时、规则修改必须完整重建、本地通过后仍需单独确认云端发布。

- [ ] **Step 7: 提交运行时同步和文档**

```powershell
git add miniapp/tests/catalog.test.ts miniapp/tests/catalog-presenter.test.ts miniapp/tests/local-question-repository.test.ts miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts miniapp/miniprogram/data/questions/runtime-question-records.ts README.md
git commit -m "feat: sync classified warehouse catalog to miniapp"
```

### Task 10: 全量验证并停在云端发布边界

**Files:**
- Verify only: all changed files
- Do not modify: `.worktrees/cloud-warehouse-five-level-release`
- Do not modify: `.worktrees/cloud-question-bank`

- [ ] **Step 1: 加载完成前验证技能**

加载 `superpowers:verification-before-completion`，按该技能要求以实际命令输出为准，不根据局部测试推断完成。

- [ ] **Step 2: 运行 Python 全量测试**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest -q
```

Expected: 全部 PASS，无 collection error。

- [ ] **Step 3: 运行数据校验和构建**

```powershell
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
```

Expected: validation errors=0；构建生成五个 warehouse 分片和知识目录。

- [ ] **Step 4: 运行小程序同步和完整 verify**

```powershell
Set-Location miniapp
npm run sync:questions
npm run verify
Set-Location ..
```

Expected: typecheck、eslint/stylelint、Prettier check、包体预算、全部 Vitest PASS。

- [ ] **Step 5: 重跑审计门禁**

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python tools/audit_warehouse_classification.py invariants `
  --baseline-dir tmp/warehouse-classification-baseline-70156a7 `
  --questions data/questions `
  --review tmp/warehouse-classification-review.jsonl `
  --manifest data/warehouse_classification_manifest.json
python tools/audit_warehouse_classification.py verify `
  --sample tmp/warehouse-classification-sample.csv `
  --report tmp/warehouse-classification-report.json `
  --output-summary tmp/warehouse-classification-review-summary.json
```

Expected: 4110 基线全部计入 published+pending；自动覆盖率 ≥80%；100 题章节正确率 ≥90%；章节门禁满足。

- [ ] **Step 6: 检查差异范围和云端工作树未被触碰**

```powershell
git status --short
git diff --stat 70156a7...HEAD
git -C ..\cloud-warehouse-five-level-release status --short
git -C ..\cloud-question-bank status --short
```

Expected: 当前分支只包含分类、目录、正式题库、测试、运行时同步和文档；两个云端工作树仍保持实施前各自的未提交状态，没有本任务新增或覆盖的文件。

- [ ] **Step 7: 提交最终验证修订（仅在确有修订时）**

```powershell
git add README.md docs/qa/2026-08-07-warehouse-question-classification-audit.md
git commit -m "docs: record warehouse classification verification"
```

若没有新的已跟踪修改，不创建空提交。

- [ ] **Step 8: 停止，不发布云端**

向用户报告：正式/待复核题数、五等级覆盖率、章节分布、100 题正确率、测试结果、分支和提交；明确等待用户再次确认后，另行制定云端集成步骤。
