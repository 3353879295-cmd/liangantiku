# 粮油仓储与质检题库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套可持续收集、核验、去重并导出粮油保管员和粮油质量检验员五级、四级、三级题目的数据生产系统，并交付首批至少 1200 道审核合格题目。

**Architecture:** 以版本控制中的 JSONL 文件作为题目事实源，以 JSON 文件维护来源目录和受控分类。Python 管道负责模型校验、跨文件核验、相似题检测、统计以及 Excel/JSON 发布；原始、待复核、已核验和已停用状态在同一数据模型中管理，发布器只读取 `verified` 题目。

**Tech Stack:** Python 3.11+、Pydantic 2、RapidFuzz、openpyxl、pytest、标准库 `argparse/json/pathlib/hashlib/unicodedata`。

## Global Constraints

- 职业仅包含仓储管理员—粮油保管员方向（`4-02-06-01`）和农产品食品检验员—粮油质量检验员方向（`4-08-05-01`）。
- 等级仅包含五级/初级工、四级/中级工、三级/高级工，对应数值 `5`、`4`、`3`。
- 不获取、破解或传播受保密管理的国家正式题库，不绕过登录、付费、验证码或其他访问限制。
- 对受版权保护的资料只提取知识依据并重新编写，不大批量照录第三方题库或教材。
- 发布数据只包含 `verified` 题目；`pending` 和 `retired` 永不进入小程序 JSON。
- 每个职业、每个等级的目标题型分布为单选约 60%、多选约 20%、判断约 20%，单批偏差不得超过 5 个百分点。
- 每道正式题至少关联一个有效来源；完全重复题数量必须为 0。
- Excel 必须包含 `正式题库`、`来源索引`、`待复核题`、`停用题`、`题量统计` 五张工作表。
- JSON 必须按职业编码和等级拆分为六个文件，并通过标准 JSON 解析。
- 首批发布目标为六个职业等级组各 200 道 `verified` 题，共至少 1200 道；无法核验的候选题保留为 `pending`，用其他合格题补足发布目标。

---

## File Map

```text
pyproject.toml                         # Python 版本、依赖、pytest 和 CLI 配置
README.md                              # 安装、采集、审核、校验和导出命令
src/grain_quiz/__init__.py             # 包版本
src/grain_quiz/models.py               # Source、Question 和枚举模型
src/grain_quiz/io.py                   # JSON/JSONL 读写与稳定排序
src/grain_quiz/taxonomy.py             # 受控分类加载和归属校验
src/grain_quiz/normalize.py            # 中文题干规范化与指纹
src/grain_quiz/dedupe.py               # 完全重复和相似题检测
src/grain_quiz/validate.py             # 跨记录校验和发布门禁
src/grain_quiz/stats.py                # 题量与分布统计
src/grain_quiz/export.py               # Excel 和六份 JSON 导出
src/grain_quiz/cli.py                  # validate、dedupe、export、build 命令
data/taxonomy.json                     # 两个职业的模块和知识点词表
data/sources.json                      # 来源索引
data/questions/warehouse_l5.jsonl      # 粮油保管员五级题目
data/questions/warehouse_l4.jsonl      # 粮油保管员四级题目
data/questions/warehouse_l3.jsonl      # 粮油保管员三级题目
data/questions/inspector_l5.jsonl      # 粮油质量检验员五级题目
data/questions/inspector_l4.jsonl      # 粮油质量检验员四级题目
data/questions/inspector_l3.jsonl      # 粮油质量检验员三级题目
docs/source-and-authoring-guide.md      # 来源合规、编题、核验和停用规则
docs/source-search-log.md               # 系统检索式、结果和取舍记录
tests/                                 # 与上述模块一一对应的测试
dist/                                  # 生成的工作簿、JSON 和版本报告
```

## Stable Interfaces

后续任务统一使用以下接口，名称和参数不得自行变更：

```python
def load_sources(path: Path) -> dict[str, Source]: ...
def load_questions(directory: Path) -> list[Question]: ...
def load_taxonomy(path: Path) -> Taxonomy: ...
def normalize_text(value: str) -> str: ...
def exact_fingerprint(question: Question) -> str: ...
def find_duplicates(questions: list[Question], threshold: float = 92.0) -> DuplicateReport: ...
def validate_dataset(questions: list[Question], sources: dict[str, Source], taxonomy: Taxonomy) -> ValidationReport: ...
def build_stats(questions: list[Question]) -> dict[str, object]: ...
def export_workbook(questions: list[Question], sources: dict[str, Source], report: ValidationReport, output: Path) -> None: ...
def export_json_shards(questions: list[Question], output_dir: Path) -> dict[str, int]: ...
```

---

### Task 1: Scaffold the project and enforce record-level invariants

**Files:**
- Create: `pyproject.toml`
- Create: `src/grain_quiz/__init__.py`
- Create: `src/grain_quiz/models.py`
- Create: `tests/__init__.py`
- Create: `tests/factories.py`
- Create: `tests/test_models.py`

**Interfaces:**
- Produces: `Source`, `Question`, `Option`, `OccupationCode`, `QuestionType`, `Difficulty`, `ReviewStatus`.

- [ ] **Step 1: Write failing model tests**

```python
# tests/factories.py
from datetime import date
import json
from pathlib import Path

BASE = {
    "id": "WH-L5-000001",
    "occupation_code": "4-02-06-01",
    "occupation_name": "仓储管理员",
    "direction": "粮油保管员",
    "level": 5,
    "module": "粮情检查",
    "topic": "粮温检查",
    "type": "single",
    "stem": "检查粮温时应优先保证什么？",
    "options": [
        {"key": "A", "text": "测点具有代表性"},
        {"key": "B", "text": "记录可以省略"},
        {"key": "C", "text": "只测仓门位置"},
        {"key": "D", "text": "只在异常后检查"},
    ],
    "answer": ["A"],
    "explanation": "代表性测点才能反映粮堆温度状况。",
    "difficulty": "easy",
    "keywords": ["粮温"],
    "source_ids": ["SRC-0001"],
    "standard_reference": "职业功能：粮情检查",
    "source_note": "依据职业标准原创",
    "review_status": "verified",
    "valid_from": date(2019, 1, 1),
    "valid_until": None,
    "duplicate_group": None,
    "content_version": 1,
    "created_at": "2026-07-22T00:00:00+08:00",
    "updated_at": "2026-07-22T00:00:00+08:00",
}

SOURCE = {
    "id": "SRC-0001",
    "title": "（粮油）仓储管理员国家职业技能标准（2019年版）",
    "url": "https://www.osta.org.cn/api/sys/downloadFile/decrypt?fileName=example.pdf",
    "publisher": "人力资源和社会保障部、国家粮食和物资储备局",
    "published_at": "2019-01-01",
    "accessed_at": "2026-07-22",
    "kind": "occupational_standard",
    "usage": "knowledge_basis",
    "is_active": True,
    "notes": "测试来源记录",
}

def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n"
    path.write_text(payload, encoding="utf-8")

# tests/test_models.py
import pytest
from pydantic import ValidationError
from grain_quiz.models import Question
from tests.factories import BASE

def test_valid_single_question():
    assert Question.model_validate(BASE).answer == ["A"]

def test_single_question_rejects_two_answers():
    with pytest.raises(ValidationError):
        Question.model_validate({**BASE, "answer": ["A", "B"]})

def test_judge_question_requires_fixed_options():
    invalid = {**BASE, "type": "judge", "answer": ["A"]}
    with pytest.raises(ValidationError):
        Question.model_validate(invalid)
```

- [ ] **Step 2: Run tests and confirm the missing-package failure**

Run: `python -m pytest tests/test_models.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'grain_quiz'`.

- [ ] **Step 3: Add packaging and the complete Pydantic models**

`pyproject.toml` must declare Python `>=3.11`, runtime dependencies `pydantic>=2.7,<3`, `rapidfuzz>=3.9,<4`, `openpyxl>=3.1,<4`, and test dependency `pytest>=8,<9`. Configure package discovery from `src` and expose `grain-quiz = "grain_quiz.cli:main"`.

In `models.py`, implement string enums for the allowed codes and statuses, an `Option` model with keys `A-D`, and the complete schemas below. `SourceKind` must allow `occupational_standard`, `law_regulation`, `industry_standard`, `official_manual`, `official_notice`, `publisher_page`, `school_material`, and `public_practice`; `SourceUsage` must allow `knowledge_basis`, `public_sample`, and `bibliography_only`.

```python
class Source(BaseModel):
    id: str
    title: str
    url: HttpUrl
    publisher: str
    published_at: date | None
    accessed_at: date
    kind: SourceKind
    usage: SourceUsage
    is_active: bool
    notes: str

class Question(BaseModel):
    id: str
    occupation_code: OccupationCode
    occupation_name: str
    direction: str
    level: Literal[5, 4, 3]
    module: str
    topic: str
    type: QuestionType
    stem: str
    options: list[Option]
    answer: list[str]
    explanation: str
    difficulty: Difficulty
    keywords: list[str]
    source_ids: list[str]
    standard_reference: str
    source_note: str
    review_status: ReviewStatus
    valid_from: date
    valid_until: date | None
    duplicate_group: str | None
    content_version: int
    created_at: datetime
    updated_at: datetime
```

Use constrained strings to reject blank `stem`, `explanation`, `module`, `topic`, source title and publisher. Constrain `content_version >= 1`, question IDs to `^(WH|QI)-L[345]-[0-9]{6}$`, and source IDs to `^SRC-[0-9]{4}$`. A model-level validator must enforce:

```python
if self.type == QuestionType.SINGLE and len(self.answer) != 1:
    raise ValueError("single questions require exactly one answer")
if self.type == QuestionType.MULTIPLE and len(self.answer) < 2:
    raise ValueError("multiple questions require at least two answers")
if self.type == QuestionType.JUDGE:
    expected = [("A", "正确"), ("B", "错误")]
    if [(item.key, item.text) for item in self.options] != expected:
        raise ValueError("judge questions require A=正确 and B=错误")
elif len(self.options) != 4:
    raise ValueError("single and multiple questions require four options")
option_keys = {item.key for item in self.options}
if len(option_keys) != len(self.options) or not set(self.answer) <= option_keys:
    raise ValueError("answer keys must match unique option keys")
if self.valid_until and self.valid_until < self.valid_from:
    raise ValueError("valid_until cannot precede valid_from")
```

- [ ] **Step 4: Run the model tests**

Run: `python -m pytest tests/test_models.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```powershell
git add pyproject.toml src/grain_quiz/__init__.py src/grain_quiz/models.py tests/__init__.py tests/factories.py tests/test_models.py
git commit -m "feat: define question bank data models"
```

---

### Task 2: Load JSONL data and enforce the controlled taxonomy

**Files:**
- Create: `src/grain_quiz/io.py`
- Create: `src/grain_quiz/taxonomy.py`
- Create: `data/taxonomy.json`
- Create: `data/sources.json`
- Create: `tests/test_io_taxonomy.py`

**Interfaces:**
- Consumes: `Source`, `Question` from Task 1.
- Produces: `load_sources()`, `load_questions()`, `write_questions()`, `Taxonomy`, `load_taxonomy()`.

- [ ] **Step 1: Write failing loader and taxonomy tests**

```python
from pathlib import Path
from grain_quiz.io import load_questions
from grain_quiz.taxonomy import load_taxonomy
from tests.factories import BASE, write_jsonl

def test_load_questions_is_stably_sorted(tmp_path):
    write_jsonl(tmp_path / "b.jsonl", [{**BASE, "id": "WH-L5-000002"}])
    write_jsonl(tmp_path / "a.jsonl", [{**BASE, "id": "WH-L5-000001"}])
    assert [q.id for q in load_questions(tmp_path)] == ["WH-L5-000001", "WH-L5-000002"]

def test_taxonomy_accepts_known_topic():
    taxonomy = load_taxonomy(Path("data/taxonomy.json"))
    assert taxonomy.allows("4-02-06-01", 5, "粮情检查", "粮温检查")

def test_taxonomy_rejects_unknown_topic():
    taxonomy = load_taxonomy(Path("data/taxonomy.json"))
    assert not taxonomy.allows("4-02-06-01", 5, "粮情检查", "不存在的知识点")
```

- [ ] **Step 2: Run tests and confirm missing interfaces**

Run: `python -m pytest tests/test_io_taxonomy.py -q`
Expected: FAIL because `grain_quiz.io` and `grain_quiz.taxonomy` do not exist.

- [ ] **Step 3: Implement deterministic IO and taxonomy lookup**

`load_questions()` must glob `*.jsonl`, ignore blank lines, attach `file:line` to validation errors, parse every row with `Question.model_validate_json()`, and return `sorted(records, key=lambda q: q.id)`. `write_questions()` must use UTF-8, `ensure_ascii=False`, one compact JSON object per line, and stable ID order.

`Taxonomy.allows()` must use exact occupation code, numeric level, module and topic membership. Populate `data/taxonomy.json` with all modules approved in the design and at least two concrete topics under every module for each applicable level. Initialize `data/sources.json` to `[]`.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_io_taxonomy.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```powershell
git add src/grain_quiz/io.py src/grain_quiz/taxonomy.py data/taxonomy.json data/sources.json tests/test_io_taxonomy.py
git commit -m "feat: add deterministic data loading and taxonomy"
```

---

### Task 3: Detect exact and near-duplicate questions

**Files:**
- Create: `src/grain_quiz/normalize.py`
- Create: `src/grain_quiz/dedupe.py`
- Create: `tests/test_dedupe.py`

**Interfaces:**
- Consumes: `Question`.
- Produces: `normalize_text()`, `exact_fingerprint()`, `DuplicatePair`, `DuplicateReport`, `find_duplicates()`.

- [ ] **Step 1: Write failing normalization and duplicate tests**

```python
from grain_quiz.dedupe import find_duplicates
from grain_quiz.models import Question
from grain_quiz.normalize import exact_fingerprint, normalize_text
from tests.factories import BASE

def test_normalize_text_folds_width_space_and_punctuation():
    assert normalize_text(" 粮　温（℃）？ ") == "粮温℃"

def test_exact_fingerprint_ignores_option_order():
    left = Question.model_validate(BASE)
    right_data = {**BASE, "id": "WH-L5-000002", "options": list(reversed(BASE["options"]))}
    right = Question.model_validate(right_data)
    assert exact_fingerprint(left) == exact_fingerprint(right)

def test_find_duplicates_flags_reworded_stem():
    left = Question.model_validate(BASE)
    right = Question.model_validate({**BASE, "id": "WH-L5-000002", "stem": "进行粮温检查时，首先应保证什么？"})
    report = find_duplicates([left, right], threshold=80)
    assert [(p.left_id, p.right_id) for p in report.near] == [("WH-L5-000001", "WH-L5-000002")]
```

- [ ] **Step 2: Run tests and confirm missing modules**

Run: `python -m pytest tests/test_dedupe.py -q`
Expected: FAIL because normalization and duplicate interfaces are missing.

- [ ] **Step 3: Implement normalization, global exact matching and blocked fuzzy matching**

`normalize_text()` must apply Unicode NFKC, lowercase Latin text, remove whitespace and punctuation, and retain Chinese characters, letters, digits and symbols carrying measurement meaning. `exact_fingerprint()` must hash normalized stem plus sorted normalized option texts with SHA-256.

`find_duplicates()` must first group the global fingerprints. For near duplicates, block by `(occupation_code, module, topic)` across all three levels, compare normalized stems using `rapidfuzz.fuzz.ratio`, skip exact pairs, and return pairs at or above the threshold sorted by `(left_id, right_id)`. This blocking keeps comparisons tractable at 20,000+ records while still comparing cross-level variants of the same knowledge point.

- [ ] **Step 4: Run tests**

Run: `python -m pytest tests/test_dedupe.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```powershell
git add src/grain_quiz/normalize.py src/grain_quiz/dedupe.py tests/test_dedupe.py
git commit -m "feat: detect duplicate question variants"
```

---

### Task 4: Build cross-record validation and release gates

**Files:**
- Create: `src/grain_quiz/validate.py`
- Create: `tests/test_validate.py`

**Interfaces:**
- Consumes: questions, source map, taxonomy and duplicate report.
- Produces: `ValidationIssue`, `ValidationReport`, `validate_dataset()`; `ValidationReport.errors` and `.warnings` are stable lists.

- [ ] **Step 1: Write failing validation tests**

```python
from pathlib import Path
from grain_quiz.models import Question, Source
from grain_quiz.taxonomy import load_taxonomy
from grain_quiz.validate import validate_dataset
from tests.factories import BASE, SOURCE

def test_verified_question_requires_active_source():
    question = Question.model_validate(BASE)
    report = validate_dataset([question], {}, load_taxonomy(Path("data/taxonomy.json")))
    assert [(i.code, i.question_id) for i in report.errors] == [("missing_source", question.id)]

def test_pending_question_is_not_a_release_error():
    pending = Question.model_validate({**BASE, "review_status": "pending"})
    report = validate_dataset([pending], {}, load_taxonomy(Path("data/taxonomy.json")))
    assert not report.errors
    assert report.warnings[0].code == "unreleased_question"

def test_unknown_taxonomy_is_an_error():
    question = Question.model_validate({**BASE, "topic": "不存在的知识点"})
    source = Source.model_validate(SOURCE)
    report = validate_dataset([question], {source.id: source}, load_taxonomy(Path("data/taxonomy.json")))
    assert report.errors[0].code == "unknown_taxonomy"
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `python -m pytest tests/test_validate.py -q`
Expected: FAIL because `validate_dataset()` is missing.

- [ ] **Step 3: Implement deterministic validation**

Validation error codes must include `duplicate_id`, `missing_source`, `inactive_source`, `unknown_taxonomy`, `exact_duplicate`, `invalid_validity_window`, and `invalid_verified_record`. Warning codes must include `near_duplicate`, `unreleased_question`, and `distribution_drift`.

Rules:

```python
verified = [q for q in questions if q.review_status == ReviewStatus.VERIFIED]
for question in verified:
    if not question.source_ids:
        add_error("missing_source", question.id)
    for source_id in question.source_ids:
        if source_id not in sources:
            add_error("missing_source", question.id)
        elif not sources[source_id].is_active:
            add_error("inactive_source", question.id)
    if not taxonomy.allows(question.occupation_code, question.level, question.module, question.topic):
        add_error("unknown_taxonomy", question.id)
```

Integrate `find_duplicates()`: exact duplicates are errors; near duplicates are warnings unless both records share the same non-empty `duplicate_group`, which records a reviewed decision.

- [ ] **Step 4: Run validation tests and full suite**

Run: `python -m pytest tests/test_validate.py -q`
Expected: `3 passed`.

Run: `python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/grain_quiz/validate.py tests/test_validate.py
git commit -m "feat: enforce question release gates"
```

---

### Task 5: Export the review workbook, JSON shards and statistics

**Files:**
- Create: `src/grain_quiz/stats.py`
- Create: `src/grain_quiz/export.py`
- Create: `tests/test_export.py`

**Interfaces:**
- Consumes: validated questions, source map and validation report.
- Produces: `build_stats()`, `export_workbook()`, `export_json_shards()`.

- [ ] **Step 1: Write failing export tests**

```python
import json
import openpyxl
from grain_quiz.export import export_json_shards, export_workbook
from grain_quiz.models import Question, Source
from grain_quiz.validate import ValidationReport
from tests.factories import BASE, SOURCE

def test_workbook_has_required_sheets(tmp_path):
    questions = [
        Question.model_validate(BASE),
        Question.model_validate({**BASE, "id": "WH-L5-000002", "review_status": "pending"}),
        Question.model_validate({**BASE, "id": "WH-L5-000003", "review_status": "retired"}),
    ]
    source = Source.model_validate(SOURCE)
    output = tmp_path / "question-bank.xlsx"
    export_workbook(questions, {source.id: source}, ValidationReport(errors=[], warnings=[]), output)
    workbook = openpyxl.load_workbook(output, read_only=True)
    assert workbook.sheetnames == ["正式题库", "来源索引", "待复核题", "停用题", "题量统计"]

def test_json_exports_only_verified_records(tmp_path):
    questions = [
        Question.model_validate(BASE),
        Question.model_validate({**BASE, "id": "WH-L5-000002", "review_status": "pending"}),
    ]
    counts = export_json_shards(questions, tmp_path)
    assert set(counts) == {
        "warehouse_l5.json", "warehouse_l4.json", "warehouse_l3.json",
        "inspector_l5.json", "inspector_l4.json", "inspector_l3.json",
    }
    records = json.loads((tmp_path / "warehouse_l5.json").read_text(encoding="utf-8"))
    assert all(record["review_status"] == "verified" for record in records)
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `python -m pytest tests/test_export.py -q`
Expected: FAIL because export functions do not exist.

- [ ] **Step 3: Implement statistics and exports**

`build_stats()` must count by occupation, level, module, type, difficulty and status. `export_workbook()` must freeze the first row, enable filters, wrap long text, use readable Chinese column widths, and serialize options and answers without losing multiple-answer order. It must include all statuses in their designated sheets and never put `pending` or `retired` rows into `正式题库`.

`export_json_shards()` must always create all six UTF-8 JSON files, sort records by ID, include `ensure_ascii=False`, and return each filename's record count. Runtime JSON must retain `id`, occupation, direction, level, module, topic, type, stem, options, answer, explanation, difficulty, keywords, `source_ids`, `standard_reference`, `review_status`, and `content_version`.

- [ ] **Step 4: Run export tests**

Run: `python -m pytest tests/test_export.py -q`
Expected: `2 passed`.

- [ ] **Step 5: Commit**

```powershell
git add src/grain_quiz/stats.py src/grain_quiz/export.py tests/test_export.py
git commit -m "feat: export reviewed question bank artifacts"
```

---

### Task 6: Add the CLI and end-to-end build command

**Files:**
- Create: `src/grain_quiz/cli.py`
- Create: `tests/test_cli.py`
- Create: `README.md`

**Interfaces:**
- Consumes: all stable interfaces from Tasks 1-5.
- Produces: `grain-quiz validate`, `grain-quiz dedupe`, `grain-quiz export`, `grain-quiz build`, and `main(argv: list[str] | None = None) -> int`.

- [ ] **Step 1: Write a failing CLI build test**

```python
import json
from grain_quiz.cli import main
from tests.factories import BASE, SOURCE, write_jsonl

def write_sources(path, records):
    path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")

def build_args(tmp_path):
    return [
        "build", "--questions", str(tmp_path / "questions"),
        "--sources", str(tmp_path / "sources.json"),
        "--taxonomy", "data/taxonomy.json",
        "--output", str(tmp_path / "dist"),
    ]

def test_build_rejects_release_errors(tmp_path, capsys):
    write_jsonl(tmp_path / "questions/warehouse_l5.jsonl", [BASE])
    write_sources(tmp_path / "sources.json", [])
    assert main(build_args(tmp_path)) == 1
    assert "missing_source" in capsys.readouterr().out

def test_build_creates_workbook_json_and_report(tmp_path):
    write_jsonl(tmp_path / "questions/warehouse_l5.jsonl", [BASE])
    write_sources(tmp_path / "sources.json", [SOURCE])
    assert main(build_args(tmp_path)) == 0
    assert (tmp_path / "dist/question-bank.xlsx").exists()
    assert (tmp_path / "dist/json/warehouse_l5.json").exists()
    assert json.loads((tmp_path / "dist/version-report.json").read_text(encoding="utf-8"))["validation_errors"] == 0
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `python -m pytest tests/test_cli.py -q`
Expected: FAIL because the CLI is missing.

- [ ] **Step 3: Implement CLI commands and documented usage**

`build` must load all inputs once, run validation, print errors and return exit code `1` without publishing when errors exist. With zero errors it must recreate `dist/json`, export the workbook, six shards and `version-report.json`, then print exact totals.

Document these commands in `README.md`:

```powershell
python -m pip install -e ".[test]"
grain-quiz validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json
grain-quiz dedupe --questions data/questions --threshold 92
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
python -m pytest -q
```

- [ ] **Step 4: Run CLI tests and full suite**

Run: `python -m pytest tests/test_cli.py -q`
Expected: `2 passed`.

Run: `python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/grain_quiz/cli.py tests/test_cli.py README.md
git commit -m "feat: add reproducible question bank build command"
```

---

### Task 7: Establish the official source catalog and authoring policy

**Files:**
- Modify: `data/sources.json`
- Create: `docs/source-and-authoring-guide.md`
- Create: `tests/test_source_catalog.py`

**Interfaces:**
- Produces: stable `SRC-####` records used by every content batch.

- [ ] **Step 1: Write a failing source-catalog test**

```python
from datetime import date
from pathlib import Path
from grain_quiz.io import load_sources

def test_source_catalog_has_required_official_foundations():
    sources = load_sources(Path("data/sources.json"))
    titles = {source.title for source in sources.values()}
    assert "（粮油）仓储管理员国家职业技能标准（2019年版）" in titles
    assert "农产品食品检验员国家职业技能标准（2019年版）" in titles
    assert "现行粮油行业标准目录" in titles
    assert all(source.accessed_at <= date.today() for source in sources.values())
```

- [ ] **Step 2: Run the catalog test and confirm failure**

Run: `python -m pytest tests/test_source_catalog.py -q`
Expected: FAIL because the source catalog is empty.

- [ ] **Step 3: Populate and document the initial source set**

Add the two 2019 national occupational standards, both official operation-skill manuals, the official confidentiality notice, the current industry-standard directory, current grain reserve quality/safety management rules, and publisher pages for authorized reference books. Every source record must identify `kind`, `publisher`, `published_at`, `accessed_at`, `usage`, `is_active`, and notes explaining whether it supports a standard, knowledge point, public sample or bibliography only.

The authoring guide must define: permitted sources, prohibited copying, source ID assignment, question ID assignment, level mapping, single/multiple/judge writing rules, distractor quality, explanation requirements, numerical-unit checks, standard-version checks, near-duplicate review, state transitions, and correction/retirement procedure.

- [ ] **Step 4: Run the catalog and full tests**

Run: `python -m pytest tests/test_source_catalog.py -q`
Expected: `1 passed`.

Run: `python -m pytest -q`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add data/sources.json docs/source-and-authoring-guide.md tests/test_source_catalog.py
git commit -m "docs: establish question source and authoring policy"
```

---

### Task 8: Author and verify 200 warehouse-manager level-5 questions

**Files:**
- Create: `data/questions/warehouse_l5.jsonl`
- Modify: `data/sources.json` when new public sources are required.

**Interfaces:**
- Produces: IDs `WH-L5-000001` through `WH-L5-000200`, all `verified`.

- [ ] Collect candidate knowledge points from registered public sources and write original questions with this exact quota: 120 single, 40 multiple, 40 judge; at least 25 safety/law, 30 storage basics, 25 facilities, 35 inbound/outbound, 45 grain-condition inspection, and 40 grain-condition control questions.
- [ ] For every numerical threshold, method, interval or instrument rule, record a specific standard reference; records without sufficient evidence stay `pending` and do not count toward 200.
- [ ] Run `grain-quiz validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json`; expected: zero errors for `WH-L5-*`.
- [ ] Run `grain-quiz dedupe --questions data/questions --threshold 92`; review every reported pair, consolidate duplicates or assign a documented `duplicate_group`; expected: zero unreviewed exact duplicates.
- [ ] Run `grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist`; expected report: exactly 200 verified `WH-L5` questions and type counts `120/40/40`.
- [ ] Commit with `git commit -m "data: add warehouse level 5 question batch"`.

---

### Task 9: Author and verify 200 warehouse-manager level-4 questions

**Files:**
- Create: `data/questions/warehouse_l4.jsonl`
- Modify: `data/sources.json` when new public sources are required.

**Interfaces:**
- Produces: IDs `WH-L4-000001` through `WH-L4-000200`, all `verified`.

- [ ] Write 120 single, 40 multiple and 40 judge questions emphasizing independent operation and general abnormal-condition handling; allocate at least 25 facilities/equipment, 30 inbound/outbound quality and quantity, 45 inspection, 60 condition-control/pest/mold, and 40 safety/law/data-record questions.
- [ ] Ensure any knowledge point shared with level 5 uses a different cognitive task or operational scenario; identical stems with changed level labels are prohibited.
- [ ] Run validation; expected: zero errors for `WH-L4-*` and no inactive or missing sources.
- [ ] Run duplicate detection across all warehouse levels; resolve every exact pair and review every near pair at threshold 92.
- [ ] Run the build; expected cumulative warehouse total 400 and exact `WH-L4` type counts `120/40/40`.
- [ ] Commit with `git commit -m "data: add warehouse level 4 question batch"`.

---

### Task 10: Author and verify 200 warehouse-manager level-3 questions

**Files:**
- Create: `data/questions/warehouse_l3.jsonl`
- Modify: `data/sources.json` when new public sources are required.

**Interfaces:**
- Produces: IDs `WH-L3-000001` through `WH-L3-000200`, all `verified`.

- [ ] Write 120 single, 40 multiple and 40 judge questions emphasizing integrated analysis, plan selection, complex abnormal-condition handling and equipment-fault reasoning; allocate at least 30 facilities/fault, 25 inbound/outbound analysis, 45 advanced inspection, 70 control/pest/mold/fumigation, and 30 safety/law/quality-management questions.
- [ ] Treat fumigation, controlled-atmosphere storage and hazardous-operation content as high-risk: require official standard references and explanations that state safety boundaries.
- [ ] Run validation; expected: zero errors for `WH-L3-*`.
- [ ] Run duplicate detection across all warehouse levels and resolve every pair as in Task 9.
- [ ] Run the build; expected warehouse total 600 and exact `WH-L3` type counts `120/40/40`.
- [ ] Commit with `git commit -m "data: add warehouse level 3 question batch"`.

---

### Task 11: Author and verify 200 inspector level-5 questions

**Files:**
- Create: `data/questions/inspector_l5.jsonl`
- Modify: `data/sources.json` when new public sources are required.

**Interfaces:**
- Produces: IDs `QI-L5-000001` through `QI-L5-000200`, all `verified`.

- [ ] Write 120 single, 40 multiple and 40 judge questions; allocate at least 25 safety/law, 35 sampling/sample preparation, 35 reagents/glassware/instruments, 55 grain/oil quality indicators, 30 basic data processing, and 20 records/report questions.
- [ ] Every test-method question must identify the applicable grain/oil product, measurement principle or method standard; ambiguous generic “food inspection” questions are excluded.
- [ ] Run validation; expected: zero errors for `QI-L5-*`.
- [ ] Run duplicate detection across all inspector levels and resolve every reported pair.
- [ ] Run the build; expected inspector total 200 and exact `QI-L5` type counts `120/40/40`.
- [ ] Commit with `git commit -m "data: add inspector level 5 question batch"`.

---

### Task 12: Author and verify 200 inspector level-4 questions

**Files:**
- Create: `data/questions/inspector_l4.jsonl`
- Modify: `data/sources.json` when new public sources are required.

**Interfaces:**
- Produces: IDs `QI-L4-000001` through `QI-L4-000200`, all `verified`.

- [ ] Write 120 single, 40 multiple and 40 judge questions emphasizing independent testing and routine anomaly handling; allocate at least 25 sampling/preparation, 30 reagents/instruments, 75 physicochemical and storage-quality tests, 40 data/precision/result judgment, and 30 safety/law/report questions.
- [ ] Calculation questions must include sufficient data, units, rounding rule and a reproducible explanation; validate all arithmetic independently before marking `verified`.
- [ ] Run validation; expected: zero errors for `QI-L4-*`.
- [ ] Run duplicate detection across all inspector levels and resolve every reported pair.
- [ ] Run the build; expected inspector total 400 and exact `QI-L4` type counts `120/40/40`.
- [ ] Commit with `git commit -m "data: add inspector level 4 question batch"`.

---

### Task 13: Author and verify 200 inspector level-3 questions

**Files:**
- Create: `data/questions/inspector_l3.jsonl`
- Modify: `data/sources.json` when new public sources are required.

**Interfaces:**
- Produces: IDs `QI-L3-000001` through `QI-L3-000200`, all `verified`.

- [ ] Write 120 single, 40 multiple and 40 judge questions emphasizing method selection, quality control, complex anomaly analysis and result review; allocate at least 25 instrument/method selection, 80 advanced quality/safety/storage tests, 55 data/quality-control/result judgment, and 40 safety/law/report/abnormal handling questions.
- [ ] Questions involving toxins, contaminants or regulated limits require a current authoritative reference and validity date; if current applicability cannot be confirmed, keep the record `pending` and replace it in the release quota.
- [ ] Run validation; expected: zero errors for `QI-L3-*`.
- [ ] Run duplicate detection across all inspector levels and resolve every reported pair.
- [ ] Run the build; expected inspector total 600, overall total 1200 and exact `QI-L3` type counts `120/40/40`.
- [ ] Commit with `git commit -m "data: add inspector level 3 question batch"`.

---

### Task 14: Exhaust the current public-source search matrix and expand beyond 1200

**Files:**
- Create: `docs/source-search-log.md`
- Modify: `data/sources.json`
- Modify: all six `data/questions/*.jsonl` files when additional verified questions are supported.

**Interfaces:**
- Consumes: the six 200-question seed batches and the authoring policy.
- Produces: a documented best-effort expansion pass with no fixed upper count.

- [ ] Create a search matrix with separate rows for every approved module in both occupations. For every row, run two query families: an authority-focused query using `site:lswz.gov.cn`, `site:mohrss.gov.cn`, `site:osta.org.cn`, `site:gov.cn` or recognized college domains, and a broad public-material query using the occupation, level, module and `试题/练习/题库/技能竞赛/操作手册` synonyms.
- [ ] Log the exact query, search date, result URL, publisher, access restriction, relevance, usage decision and rejection reason. Do not register pages requiring login/payment or pages that merely duplicate another source.
- [ ] Process every usable result: add source metadata, extract knowledge points, write original questions, classify unsupported claims as `pending`, and continue each file's numeric ID sequence without gaps among published IDs.
- [ ] Complete a second synonym pass for all matrix rows after the first pass. The expansion phase ends only when every matrix row has two completed passes and every discovered candidate has an explicit `verified`, `pending`, `retired` or rejected disposition in the log.
- [ ] Run full validation and duplicate detection. Resolve all exact duplicates; review all threshold-92 near pairs. Build `dist` and record how many verified questions were added beyond 1200, without inventing filler questions to increase the count.
- [ ] Commit with `git commit -m "data: expand question bank from public sources"`.

---

### Task 15: Verify and package the first release

**Files:**
- Create: `tests/test_release.py`
- Create: `dist/question-bank.xlsx`
- Create: `dist/json/*.json`
- Create: `dist/version-report.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: all six verified question files and the source/taxonomy catalogs.
- Produces: first reviewable release with at least 1200 verified questions.

- [ ] **Step 1: Write a release acceptance test**

```python
from collections import Counter
from pathlib import Path
from grain_quiz.io import load_questions, load_sources
from grain_quiz.models import ReviewStatus
from grain_quiz.taxonomy import load_taxonomy
from grain_quiz.validate import validate_dataset

def test_first_release_acceptance():
    questions = load_questions(Path("data/questions"))
    verified = [q for q in questions if q.review_status == ReviewStatus.VERIFIED]
    assert len(verified) >= 1200
    groups = Counter((q.occupation_code, q.level) for q in verified)
    assert all(groups[(code, level)] >= 200 for code in ("4-02-06-01", "4-08-05-01") for level in (5, 4, 3))
    assert len({q.id for q in verified}) == len(verified)
    report = validate_dataset(verified, load_sources(Path("data/sources.json")), load_taxonomy(Path("data/taxonomy.json")))
    assert report.errors == []
```

- [ ] **Step 2: Run the release test**

Run: `python -m pytest tests/test_release.py -q`
Expected: `1 passed`.

- [ ] **Step 3: Build and independently inspect artifacts**

Run:

```powershell
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
python -m pytest -q
```

Expected: build exits `0`; full test suite has zero failures; `version-report.json` reports zero validation errors, at least 1200 verified questions, six groups with at least 200 each, and zero exact duplicates.

Open `dist/question-bank.xlsx` with openpyxl in read-only mode and assert the five sheet names and formal row count. Parse every `dist/json/*.json` file with `json.loads()` and assert its count equals the matching report count.

- [ ] **Step 4: Perform stratified content sampling**

Randomly sample at least 10 questions from each occupation-level group using seed `20260722`. For all 60 sampled questions, manually confirm profession, level, answer, explanation, source link and standard reference. Move any failure to `pending`, add a corrected verified replacement, rebuild, and repeat the same seeded sample plus the corrected records until all checks pass.

- [ ] **Step 5: Document the release and commit**

Add the exact release totals, source count, known limitations, build command and correction process to `README.md`.

```powershell
git add tests/test_release.py README.md data dist
git commit -m "release: publish first grain question bank batch"
```

---

## Final Verification

Run these commands from the repository root immediately before claiming completion:

```powershell
python -m pytest -q
grain-quiz validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json
grain-quiz dedupe --questions data/questions --threshold 92
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
git status --short
```

Completion evidence must include: test totals, validation error count, exact/near-duplicate review totals, six JSON record counts, Excel formal-row count, verified/pending/retired totals, source count, and Git status. Do not describe the题库 as an official national题库 or claim it contains real exam questions.
