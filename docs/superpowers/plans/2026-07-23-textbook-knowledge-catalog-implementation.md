# Textbook Knowledge Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the warehouse question bank’s flat module list with the confirmed four-part, 11-chapter, 44-section textbook catalog while keeping the grain inspector catalog independent and preserving all question-ID-based learning data.

**Architecture:** `data/knowledge_catalog.json` becomes the canonical catalog shared by the Python release pipeline and the mini-program runtime. Questions gain stable `chapter_id` and `section_id` references; the release gate validates those references, exports them with the runtime shards, and publishes a runtime catalog that the mini-program sync script converts into a TypeScript module. The mini-program renders catalog nodes independently of question counts, filters practice by stable IDs, and derives progress from existing question-ID answer history.

**Tech Stack:** Python 3.11+, Pydantic 2, Pytest 8, native WeChat Mini Program, TypeScript 6 strict mode, TDesign MiniProgram 1.15.3, Vitest 4, ESLint 10, Stylelint 17, Prettier 3.

## Global Constraints

- Warehouse catalog content must exactly match `docs/superpowers/specs/2026-07-23-textbook-knowledge-catalog-design.md`: four parts, 11 chapters, 44 sections.
- Junior shows basic + junior; intermediate shows basic + intermediate; senior shows basic + senior.
- Keep grain inspector as an independent occupation catalog.
- Do not create a formal “其他” or “未分类” catalog node.
- Keep question IDs unchanged so wrong questions, favorites, answer history, and resumable sessions remain valid.
- Preserve legacy `module` and `topic` fields during the first migration; all new catalog filters use stable IDs.
- A zero-question chapter or section remains visible and is labeled “待补充”.
- Use the existing Apple-style light interface; no AI-themed copy or decorative imagery.
- Preserve unrelated user changes. Review staged diffs before every commit.
- Implement behavior test-first and make a focused commit after every task.

---

## File Structure

### Canonical data and release pipeline

- Create `data/knowledge_catalog.json`: single source of truth for both occupations.
- Create `src/grain_quiz/catalog.py`: catalog loader, structural validation, lookup, and runtime projection.
- Modify `src/grain_quiz/models.py`: add `chapter_id` and `section_id`.
- Modify `src/grain_quiz/validate.py`: reject invalid catalog references.
- Modify `src/grain_quiz/export.py`: include stable IDs in shards and export `knowledge_catalog.json`.
- Modify `src/grain_quiz/cli.py`: accept `--catalog`, load it once, and publish its runtime projection.
- Modify all six `data/questions/*.jsonl`: add reviewed stable catalog references without changing IDs.
- Modify `README.md` and `docs/question-runtime-contract.md`: document the new input and runtime fields.

### Mini-program runtime and interface

- Create `miniapp/miniprogram/types/knowledge-catalog.ts`: runtime catalog types.
- Create `miniapp/miniprogram/data/knowledge-catalog.ts`: typed import boundary for generated catalog data.
- Create `miniapp/miniprogram/presenters/catalog-presenter.ts`: pure catalog tree/count/progress presentation.
- Modify `miniapp/scripts/sync-question-bank.mjs`: validate and generate runtime catalog TypeScript.
- Modify `miniapp/miniprogram/types/runtime-question.ts` and `types/domain.ts`: stable catalog fields and filters.
- Modify `miniapp/miniprogram/repositories/local-question-repository.ts`: adapt/filter catalog IDs.
- Modify `miniapp/miniprogram/services/progress-service.ts`: derive node progress from question IDs.
- Modify `miniapp/miniprogram/services/paper-builder.ts` and `practice-runtime.ts`: chapter/section filtering.
- Modify `miniapp/miniprogram/pages/library/index.*`: expandable part/chapter/section catalog.
- Modify `miniapp/miniprogram/pages/practice/index.ts`: parse stable catalog route parameters.
- Modify `miniapp/miniprogram/services/practice-session.ts`, report presenter/page, and question-list presenter/page: display and filter standard chapter names.

### Tests

- Create `tests/test_catalog.py`.
- Create `miniapp/tests/catalog-presenter.test.ts`.
- Modify existing Python pipeline tests and mini-program repository, sync, presenter, progress, paper-builder, and structure tests.

---

### Task 1: Commit the already-verified WeChat runtime baseline

**Files:**

- Modify: `.gitignore`
- Modify: `miniapp/.prettierignore`
- Modify: `miniapp/eslint.config.mjs`
- Modify: `miniapp/miniprogram/data/question-bank.ts`
- Modify: `miniapp/project.config.json`
- Modify: `miniapp/scripts/sync-question-bank.mjs`
- Modify: `miniapp/stylelint.config.mjs`
- Modify: `miniapp/tests/project-structure.test.ts`
- Modify: `miniapp/tests/sync-question-bank.test.ts`
- Create: `miniapp/miniprogram/data/questions/runtime-question-records.ts`

**Interfaces:**

- Consumes: the current verified worktree state that loads questions without JSON ESM imports.
- Produces: a committed baseline where WeChat npm output is ignored and `QUESTION_RECORDS` imports generated TypeScript.

- [ ] **Step 1: Confirm only the known runtime fixes are present**

Run:

```powershell
git diff -- .gitignore miniapp/.prettierignore miniapp/eslint.config.mjs miniapp/miniprogram/data/question-bank.ts miniapp/project.config.json miniapp/scripts/sync-question-bank.mjs miniapp/stylelint.config.mjs miniapp/tests/project-structure.test.ts miniapp/tests/sync-question-bank.test.ts
git status --short
```

Expected: no temporary diagnostics in `app.ts`, `app.json`, or the home page; the generated runtime module is the only untracked mini-program data file.

- [ ] **Step 2: Re-run the verified mini-program gate**

Run:

```powershell
Set-Location miniapp
npm run verify
```

Expected: TypeScript, ESLint, Stylelint, Prettier, and 57 Vitest tests pass.

- [ ] **Step 3: Stage only the runtime baseline**

Run:

```powershell
git add -- .gitignore miniapp/.prettierignore miniapp/eslint.config.mjs miniapp/miniprogram/data/question-bank.ts miniapp/project.config.json miniapp/scripts/sync-question-bank.mjs miniapp/stylelint.config.mjs miniapp/tests/project-structure.test.ts miniapp/tests/sync-question-bank.test.ts miniapp/miniprogram/data/questions/runtime-question-records.ts
git diff --cached --check
git diff --cached --stat
```

Expected: only the listed runtime-loading files are staged.

- [ ] **Step 4: Commit the baseline**

Run:

```powershell
git commit -m "fix: load local question bank in devtools"
```

Expected: one focused baseline commit; catalog implementation starts from a test-green state.

---

### Task 2: Add and validate the canonical knowledge catalog

**Files:**

- Create: `data/knowledge_catalog.json`
- Create: `src/grain_quiz/catalog.py`
- Create: `tests/test_catalog.py`

**Interfaces:**

- Produces: `KnowledgeCatalog`, `load_knowledge_catalog(path: Path)`, `KnowledgeCatalog.allows(occupation_code: str, level: int, chapter_id: str, section_id: str) -> bool`, and `KnowledgeCatalog.runtime_document() -> dict[str, object]`.
- Consumes: no new project interface.

- [ ] **Step 1: Write failing catalog tests**

Create `tests/test_catalog.py` with:

```python
import json
from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog


CATALOG_PATH = Path("data/knowledge_catalog.json")


def test_warehouse_catalog_matches_confirmed_textbook_structure():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert catalog.counts("4-02-06-01") == {
        "parts": 4,
        "chapters": 11,
        "sections": 44,
    }
    assert catalog.allows(
        "4-02-06-01",
        5,
        "warehouse-basic-c01",
        "warehouse-basic-c01-s01",
    )
    assert catalog.allows(
        "4-02-06-01",
        3,
        "warehouse-l3-c11",
        "warehouse-l3-c11-s06",
    )
    assert not catalog.allows(
        "4-02-06-01",
        4,
        "warehouse-l3-c11",
        "warehouse-l3-c11-s06",
    )


def test_inspector_catalog_is_independent_and_available_to_every_level():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert catalog.counts("4-08-05-01") == {
        "parts": 1,
        "chapters": 8,
        "sections": 16,
    }
    assert catalog.allows(
        "4-08-05-01",
        5,
        "inspector-c02",
        "inspector-c02-s01",
    )
    assert catalog.allows(
        "4-08-05-01",
        3,
        "inspector-c08",
        "inspector-c08-s02",
    )


def test_catalog_rejects_duplicate_ids(tmp_path: Path):
    document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    first_part = document["occupations"]["4-02-06-01"]["parts"][0]
    first_part["chapters"][1]["id"] = first_part["chapters"][0]["id"]
    path = tmp_path / "duplicate.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicate catalog ID"):
        load_knowledge_catalog(path)
```

- [ ] **Step 2: Run the tests and verify the missing-module failure**

Run:

```powershell
python -m pytest tests/test_catalog.py -q
```

Expected: collection fails because `grain_quiz.catalog` does not exist.

- [ ] **Step 3: Create the canonical JSON catalog**

Create `data/knowledge_catalog.json` with an `occupations` object containing the keys `4-02-06-01` and `4-08-05-01`. Each occupation contains its exact `title` and a non-empty `parts` array; each part contains `id`, `number`, `title`, `levels`, and `chapters`; each chapter contains `id`, `number`, `title`, `page`, and `sections`; each section contains `id`, `number`, `title`, and `page`.

Populate the warehouse `parts` array with these complete four-part, 11-chapter, 44-section definitions:

```text
warehouse-basic | 1 | 基础知识 | levels 5,4,3
  warehouse-basic-c01 | 1 | 职业道德 | page 2
    warehouse-basic-c01-s01 | 1 | 职业道德基础知识 | page 2
    warehouse-basic-c01-s02 | 2 | 粮油仓储业从业人员职业守则 | page 6
  warehouse-basic-c02 | 2 | 基础知识 | page 9
    warehouse-basic-c02-s01 | 1 | 粮油仓储管理基础知识 | page 9
    warehouse-basic-c02-s02 | 2 | 安全生产与环境保护基础知识 | page 62
    warehouse-basic-c02-s03 | 3 | 相关法律法规基础知识 | page 75
warehouse-l5 | 2 | 初级粮油仓储管理员 | levels 5
  warehouse-l5-c03 | 3 | 粮油出入库作业 | page 90
    warehouse-l5-c03-s01 | 1 | 粮油出入库准备 | page 90
    warehouse-l5-c03-s02 | 2 | 粮油出入库作业 | page 100
    warehouse-l5-c03-s03 | 3 | 粮油出入库收尾工作 | page 131
  warehouse-l5-c04 | 4 | 粮情检查 | page 140
    warehouse-l5-c04-s01 | 1 | 检查储粮温度 | page 140
    warehouse-l5-c04-s02 | 2 | 检查储粮湿度 | page 147
    warehouse-l5-c04-s03 | 3 | 使用电子气体检测仪检查粮堆气体成分 | page 157
    warehouse-l5-c04-s04 | 4 | 检查储粮害虫 | page 159
    warehouse-l5-c04-s05 | 5 | 检查鼠雀 | page 165
  warehouse-l5-c05 | 5 | 粮情控制 | page 173
    warehouse-l5-c05-s01 | 1 | 控制储存粮油温度 | page 173
    warehouse-l5-c05-s02 | 2 | 控制储存粮油水分 | page 175
    warehouse-l5-c05-s03 | 3 | 控制粮堆气体成分 | page 179
    warehouse-l5-c05-s04 | 4 | 防治储粮害虫 | page 186
    warehouse-l5-c05-s05 | 5 | 储粮鼠类防治 | page 188
warehouse-l4 | 3 | 中级粮油仓储管理员 | levels 4
  warehouse-l4-c06 | 6 | 粮油出入库作业 | page 196
    warehouse-l4-c06-s01 | 1 | 粮油出入库准备 | page 196
    warehouse-l4-c06-s02 | 2 | 粮油出入库作业 | page 209
    warehouse-l4-c06-s03 | 3 | 粮油出入库收尾 | page 226
  warehouse-l4-c07 | 7 | 粮情检查 | page 230
    warehouse-l4-c07-s01 | 1 | 检查储粮温度 | page 230
    warehouse-l4-c07-s02 | 2 | 检查储粮湿度和水分 | page 235
    warehouse-l4-c07-s03 | 3 | 检测粮堆气体 | page 241
    warehouse-l4-c07-s04 | 4 | 检查储粮害虫 | page 244
  warehouse-l4-c08 | 8 | 粮情控制 | page 250
    warehouse-l4-c08-s01 | 1 | 控制储存粮油温度 | page 250
    warehouse-l4-c08-s02 | 2 | 控制储存粮油水分 | page 273
    warehouse-l4-c08-s03 | 3 | 控制粮堆气体成分 | page 277
    warehouse-l4-c08-s04 | 4 | 防治储粮害虫 | page 279
    warehouse-l4-c08-s05 | 5 | 储粮鼠类防治 | page 297
warehouse-l3 | 4 | 高级粮油仓储管理员 | levels 3
  warehouse-l3-c09 | 9 | 粮油出入库管理 | page 302
    warehouse-l3-c09-s01 | 1 | 粮油出入库准备 | page 302
    warehouse-l3-c09-s02 | 2 | 粮油出入库作业 | page 315
    warehouse-l3-c09-s03 | 3 | 粮油出入库收尾 | page 328
  warehouse-l3-c10 | 10 | 粮情检查 | page 340
    warehouse-l3-c10-s01 | 1 | 分析储粮温度变化原因 | page 340
    warehouse-l3-c10-s02 | 2 | 分析储粮水分变化原因 | page 343
    warehouse-l3-c10-s03 | 3 | 检测粮堆气体 | page 345
    warehouse-l3-c10-s04 | 4 | 检查储粮害虫 | page 349
    warehouse-l3-c10-s05 | 5 | 检查储油质量 | page 355
  warehouse-l3-c11 | 11 | 粮情控制 | page 372
    warehouse-l3-c11-s01 | 1 | 控制储存粮油温度 | page 372
    warehouse-l3-c11-s02 | 2 | 控制储存粮油水分 | page 380
    warehouse-l3-c11-s03 | 3 | 控制粮堆气体成分 | page 383
    warehouse-l3-c11-s04 | 4 | 防治储粮害虫 | page 388
    warehouse-l3-c11-s05 | 5 | 防治鼠雀 | page 399
    warehouse-l3-c11-s06 | 6 | 防治储粮发热霉变 | page 402
```

Populate the inspector occupation with one part named `粮油质检员知识目录`, `levels: [5, 4, 3]`, and the existing eight module/two-topic groups:

```text
inspector-c01 职业道德与实验室安全
  inspector-c01-s01 实验室安全规范
  inspector-c01-s02 检验职业道德
inspector-c02 扦样分样与样品制备
  inspector-c02-s01 扦样方法
  inspector-c02-s02 样品制备
inspector-c03 试剂器皿与仪器
  inspector-c03-s01 试剂管理
  inspector-c03-s02 仪器校准
inspector-c04 粮油质量指标
  inspector-c04-s01 水分指标
  inspector-c04-s02 杂质指标
inspector-c05 理化检验方法
  inspector-c05-s01 水分测定
  inspector-c05-s02 杂质测定
inspector-c06 储存品质与安全指标
  inspector-c06-s01 储存品质判定
  inspector-c06-s02 食品安全指标
inspector-c07 数据处理与质量控制
  inspector-c07-s01 检验数据处理
  inspector-c07-s02 质量控制样
inspector-c08 检验记录与报告
  inspector-c08-s01 原始记录
  inspector-c08-s02 检验报告
```

Inspector nodes use `page: null`; warehouse nodes use the confirmed page numbers.

- [ ] **Step 4: Implement the loader and lookup**

Create `src/grain_quiz/catalog.py` with immutable node dataclasses and strict structural checks:

```python
"""Canonical knowledge catalog loading and lookup."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CatalogSection:
    id: str
    number: int
    title: str
    page: int | None


@dataclass(frozen=True)
class CatalogChapter:
    id: str
    number: int
    title: str
    page: int | None
    sections: tuple[CatalogSection, ...]


@dataclass(frozen=True)
class CatalogPart:
    id: str
    number: int
    title: str
    levels: tuple[int, ...]
    chapters: tuple[CatalogChapter, ...]


@dataclass(frozen=True)
class CatalogOccupation:
    title: str
    parts: tuple[CatalogPart, ...]


@dataclass(frozen=True)
class KnowledgeCatalog:
    occupations: dict[str, CatalogOccupation]

    def allows(
        self,
        occupation_code: str,
        level: int,
        chapter_id: str,
        section_id: str,
    ) -> bool:
        occupation = self.occupations.get(occupation_code)
        if occupation is None:
            return False
        return any(
            part.levels
            and level in part.levels
            and any(
                chapter.id == chapter_id
                and any(section.id == section_id for section in chapter.sections)
                for chapter in part.chapters
            )
            for part in occupation.parts
        )

    def counts(self, occupation_code: str) -> dict[str, int]:
        occupation = self.occupations[occupation_code]
        return {
            "parts": len(occupation.parts),
            "chapters": sum(len(part.chapters) for part in occupation.parts),
            "sections": sum(
                len(chapter.sections)
                for part in occupation.parts
                for chapter in part.chapters
            ),
        }

    def runtime_document(self) -> dict[str, object]:
        return {
            "occupations": {
                code: {
                    "title": occupation.title,
                    "parts": [
                        {
                            "id": part.id,
                            "number": part.number,
                            "title": part.title,
                            "levels": list(part.levels),
                            "chapters": [
                                {
                                    "id": chapter.id,
                                    "number": chapter.number,
                                    "title": chapter.title,
                                    "page": chapter.page,
                                    "sections": [
                                        {
                                            "id": section.id,
                                            "number": section.number,
                                            "title": section.title,
                                            "page": section.page,
                                        }
                                        for section in chapter.sections
                                    ],
                                }
                                for chapter in part.chapters
                            ],
                        }
                        for part in occupation.parts
                    ],
                }
                for code, occupation in self.occupations.items()
            }
        }


def _require_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be non-blank")
    return value.strip()


def _require_page(value: object, label: str) -> int | None:
    if value is None:
        return None
    return _require_int(value, label)


def load_knowledge_catalog(path: Path) -> KnowledgeCatalog:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid knowledge catalog JSON in {path}: {error}") from error
    raw_occupations = document.get("occupations") if isinstance(document, dict) else None
    if not isinstance(raw_occupations, dict) or not raw_occupations:
        raise ValueError("knowledge catalog must contain occupations")

    seen: set[str] = set()
    occupations: dict[str, CatalogOccupation] = {}
    for code, raw_occupation in raw_occupations.items():
        if not isinstance(raw_occupation, dict):
            raise ValueError(f"occupation {code} must be an object")
        raw_parts = raw_occupation.get("parts")
        if not isinstance(raw_parts, list) or not raw_parts:
            raise ValueError(f"occupation {code} must contain parts")
        parts: list[CatalogPart] = []
        for raw_part in raw_parts:
            part_id = _require_text(raw_part.get("id"), "part id")
            if part_id in seen:
                raise ValueError(f"duplicate catalog ID: {part_id}")
            seen.add(part_id)
            raw_levels = raw_part.get("levels")
            if (
                not isinstance(raw_levels, list)
                or not raw_levels
                or any(level not in {5, 4, 3} for level in raw_levels)
            ):
                raise ValueError(f"part {part_id} has invalid levels")
            chapters: list[CatalogChapter] = []
            for raw_chapter in raw_part.get("chapters", []):
                chapter_id = _require_text(raw_chapter.get("id"), "chapter id")
                if chapter_id in seen:
                    raise ValueError(f"duplicate catalog ID: {chapter_id}")
                seen.add(chapter_id)
                sections: list[CatalogSection] = []
                for raw_section in raw_chapter.get("sections", []):
                    section_id = _require_text(raw_section.get("id"), "section id")
                    if section_id in seen:
                        raise ValueError(f"duplicate catalog ID: {section_id}")
                    seen.add(section_id)
                    sections.append(
                        CatalogSection(
                            id=section_id,
                            number=_require_int(raw_section.get("number"), "section number"),
                            title=_require_text(raw_section.get("title"), "section title"),
                            page=_require_page(raw_section.get("page"), "section page"),
                        )
                    )
                if not sections:
                    raise ValueError(f"chapter {chapter_id} must contain sections")
                chapters.append(
                    CatalogChapter(
                        id=chapter_id,
                        number=_require_int(raw_chapter.get("number"), "chapter number"),
                        title=_require_text(raw_chapter.get("title"), "chapter title"),
                        page=_require_page(raw_chapter.get("page"), "chapter page"),
                        sections=tuple(sections),
                    )
                )
            if not chapters:
                raise ValueError(f"part {part_id} must contain chapters")
            parts.append(
                CatalogPart(
                    id=part_id,
                    number=_require_int(raw_part.get("number"), "part number"),
                    title=_require_text(raw_part.get("title"), "part title"),
                    levels=tuple(raw_levels),
                    chapters=tuple(chapters),
                )
            )
        occupations[code] = CatalogOccupation(
            title=_require_text(raw_occupation.get("title"), "occupation title"),
            parts=tuple(parts),
        )
    return KnowledgeCatalog(occupations=occupations)
```

- [ ] **Step 5: Run the catalog tests**

Run:

```powershell
python -m pytest tests/test_catalog.py -q
```

Expected: 3 tests pass and the confirmed warehouse counts are exact.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- data/knowledge_catalog.json src/grain_quiz/catalog.py tests/test_catalog.py
git diff --cached --check
git commit -m "data: add canonical knowledge catalog"
```

---

### Task 3: Add catalog references to the release pipeline and all 61 questions

**Files:**

- Modify: `src/grain_quiz/models.py`
- Modify: `src/grain_quiz/validate.py`
- Modify: `src/grain_quiz/export.py`
- Modify: `src/grain_quiz/cli.py`
- Modify: `tests/factories.py`
- Modify: `tests/test_models.py`
- Modify: `tests/test_validate.py`
- Modify: `tests/test_export.py`
- Modify: `tests/test_cli.py`
- Modify: `data/questions/warehouse_l5.jsonl`
- Modify: `data/questions/warehouse_l4.jsonl`
- Modify: `data/questions/warehouse_l3.jsonl`
- Modify: `data/questions/inspector_l5.jsonl`
- Modify: `data/questions/inspector_l4.jsonl`
- Modify: `data/questions/inspector_l3.jsonl`

**Interfaces:**

- Consumes: `KnowledgeCatalog.allows(...)` and `runtime_document()`.
- Produces: source fields `chapter_id`, `section_id`; runtime fields with the same names; build artifact `dist/json/knowledge_catalog.json`; CLI argument `--catalog`.

- [ ] **Step 1: Write failing model, validation, export, and CLI assertions**

Add to the Python fixtures:

```python
"chapter_id": "warehouse-l5-c03",
"section_id": "warehouse-l5-c03-s03",
```

Add a model assertion:

```python
def test_question_keeps_stable_catalog_references():
    question = Question.model_validate(BASE)

    assert question.chapter_id == "warehouse-l5-c03"
    assert question.section_id == "warehouse-l5-c03-s03"
```

Update validation tests to load the catalog and assert:

```python
report = validate_dataset(
    [Question.model_validate(BASE)],
    {source.id: source},
    load_taxonomy(Path("data/taxonomy.json")),
    load_knowledge_catalog(Path("data/knowledge_catalog.json")),
)
assert not [issue for issue in report.errors if issue.code == "unknown_catalog"]
```

Add an invalid-reference case:

```python
invalid = Question.model_validate(
    {
        **BASE,
        "module": "粮情检查",
        "topic": "粮温检查",
        "chapter_id": "warehouse-l3-c11",
        "section_id": "warehouse-l3-c11-s06",
    }
)
report = validate_dataset([invalid], {}, taxonomy, catalog)
assert "unknown_catalog" in [issue.code for issue in report.errors]
```

Update the expected runtime field set in `tests/test_export.py` to include:

```python
"chapter_id",
"section_id",
```

Update every CLI test invocation to pass:

```text
--catalog data/knowledge_catalog.json
```

Assert the successful build creates `output / "json" / "knowledge_catalog.json"`.

- [ ] **Step 2: Run targeted tests and verify failures**

Run:

```powershell
python -m pytest tests/test_models.py tests/test_validate.py tests/test_export.py tests/test_cli.py -q
```

Expected: failures report missing model fields, the old `validate_dataset` signature, absent runtime fields, and missing catalog artifact.

- [ ] **Step 3: Implement the pipeline fields and release gate**

Add to `Question` in `models.py`:

```python
chapter_id: NonBlankString
section_id: NonBlankString
```

Change `validate_dataset` to accept a `KnowledgeCatalog` and pass it into `_validate_questions`:

```python
def validate_dataset(
    questions: list[Question],
    sources: dict[str, Source],
    taxonomy: Taxonomy,
    catalog: KnowledgeCatalog,
) -> ValidationReport:
```

Inside `_validate_questions`, add:

```python
if not catalog.allows(
    question.occupation_code.value,
    question.level,
    question.chapter_id,
    question.section_id,
):
    errors.append(
        ValidationIssue(
            code="unknown_catalog",
            question_id=question.id,
            message="question chapter or section is not valid for its occupation and level",
        )
    )
```

Add both stable IDs to `_runtime_record`:

```python
"chapter_id": question.chapter_id,
"section_id": question.section_id,
```

Add to `export.py`:

```python
def export_knowledge_catalog(catalog: KnowledgeCatalog, output: Path) -> None:
    output.write_text(
        json.dumps(
            catalog.runtime_document(),
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
```

Add `--catalog` in `_add_validation_inputs`:

```python
parser.add_argument("--catalog", required=True)
```

Use this return order from `_load_and_validate`:

```python
def _load_and_validate(
    args: argparse.Namespace,
) -> tuple[list, dict, KnowledgeCatalog, ValidationReport]:
    questions = load_questions(Path(args.questions))
    sources = load_sources(Path(args.sources))
    taxonomy = load_taxonomy(Path(args.taxonomy))
    catalog = load_knowledge_catalog(Path(args.catalog))
    report = validate_dataset(questions, sources, taxonomy, catalog)
    return questions, sources, catalog, report
```

Unpack `questions, sources, catalog, report` in `main`, pass `catalog` into `_publish`, and publish:

```python
export_knowledge_catalog(catalog, output / "json" / "knowledge_catalog.json")
```

- [ ] **Step 4: Map every warehouse question by reviewed question ID**

Apply these exact warehouse mappings:

```text
WH-L5-000001 through WH-L5-000020, inclusive -> warehouse-l5-c03 / warehouse-l5-c03-s03

WH-L4-000001 -> warehouse-l4-c07 / warehouse-l4-c07-s01
WH-L4-000002 -> warehouse-basic-c02 / warehouse-basic-c02-s02
WH-L4-000003 -> warehouse-basic-c02 / warehouse-basic-c02-s01
WH-L4-000004 -> warehouse-basic-c02 / warehouse-basic-c02-s01
WH-L4-000005 -> warehouse-l4-c07 / warehouse-l4-c07-s01
WH-L4-000006 -> warehouse-l4-c06 / warehouse-l4-c06-s03
WH-L4-000007 -> warehouse-l4-c06 / warehouse-l4-c06-s03
WH-L4-000008 -> warehouse-l4-c08 / warehouse-l4-c08-s01

WH-L3-000001 -> warehouse-l3-c10 / warehouse-l3-c10-s01
WH-L3-000002 -> warehouse-l3-c10 / warehouse-l3-c10-s04
WH-L3-000003 -> warehouse-l3-c11 / warehouse-l3-c11-s06
WH-L3-000004 -> warehouse-basic-c02 / warehouse-basic-c02-s02
WH-L3-000005 -> warehouse-basic-c02 / warehouse-basic-c02-s01
WH-L3-000006 -> warehouse-l3-c09 / warehouse-l3-c09-s03
WH-L3-000007 -> warehouse-l3-c11 / warehouse-l3-c11-s01
WH-L3-000008 -> warehouse-l3-c11 / warehouse-l3-c11-s01
WH-L3-000009 -> warehouse-l3-c11 / warehouse-l3-c11-s06
```

Review the four broader mappings (`WH-L4-000008`, `WH-L3-000003`, `WH-L3-000005`, `WH-L3-000009`) against their stems and explanations before staging, then keep the reviewed mappings above. Do not change the catalog or invent a catch-all node.

- [ ] **Step 5: Map every inspector question from its existing module/topic pair**

Use the same independent IDs at all three levels:

```text
职业道德与实验室安全 / 实验室安全规范 -> inspector-c01 / inspector-c01-s01
职业道德与实验室安全 / 检验职业道德 -> inspector-c01 / inspector-c01-s02
扦样分样与样品制备 / 扦样方法 -> inspector-c02 / inspector-c02-s01
扦样分样与样品制备 / 样品制备 -> inspector-c02 / inspector-c02-s02
试剂器皿与仪器 / 试剂管理 -> inspector-c03 / inspector-c03-s01
试剂器皿与仪器 / 仪器校准 -> inspector-c03 / inspector-c03-s02
粮油质量指标 / 水分指标 -> inspector-c04 / inspector-c04-s01
粮油质量指标 / 杂质指标 -> inspector-c04 / inspector-c04-s02
理化检验方法 / 水分测定 -> inspector-c05 / inspector-c05-s01
理化检验方法 / 杂质测定 -> inspector-c05 / inspector-c05-s02
储存品质与安全指标 / 储存品质判定 -> inspector-c06 / inspector-c06-s01
储存品质与安全指标 / 食品安全指标 -> inspector-c06 / inspector-c06-s02
数据处理与质量控制 / 检验数据处理 -> inspector-c07 / inspector-c07-s01
数据处理与质量控制 / 质量控制样 -> inspector-c07 / inspector-c07-s02
检验记录与报告 / 原始记录 -> inspector-c08 / inspector-c08-s01
检验记录与报告 / 检验报告 -> inspector-c08 / inspector-c08-s02
```

- [ ] **Step 6: Run pipeline tests and build the real release**

Run:

```powershell
python -m pytest -q
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
```

Expected: all Python tests pass; build succeeds; six shards contain `chapter_id` and `section_id`; `dist/json/knowledge_catalog.json` exists; shard counts remain 20, 8, 9, 8, 8, 8.

- [ ] **Step 7: Commit**

Run:

```powershell
git add -- src/grain_quiz/models.py src/grain_quiz/validate.py src/grain_quiz/export.py src/grain_quiz/cli.py tests/factories.py tests/test_models.py tests/test_validate.py tests/test_export.py tests/test_cli.py data/questions/warehouse_l5.jsonl data/questions/warehouse_l4.jsonl data/questions/warehouse_l3.jsonl data/questions/inspector_l5.jsonl data/questions/inspector_l4.jsonl data/questions/inspector_l3.jsonl
git diff --cached --check
git commit -m "data: classify questions by textbook section"
```

Do not commit `dist/`; it is a build artifact.

---

### Task 4: Sync the catalog into the mini-program and add typed filters

**Files:**

- Modify: `miniapp/scripts/sync-question-bank.mjs`
- Modify: `miniapp/tests/sync-question-bank.test.ts`
- Create: `miniapp/miniprogram/types/knowledge-catalog.ts`
- Create: `miniapp/miniprogram/data/knowledge-catalog.ts`
- Create: `miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts`
- Modify: `miniapp/miniprogram/types/runtime-question.ts`
- Modify: `miniapp/miniprogram/types/domain.ts`
- Modify: `miniapp/miniprogram/repositories/local-question-repository.ts`
- Modify: `miniapp/tests/local-question-repository.test.ts`
- Modify: `miniapp/tests/factories.ts`

**Interfaces:**

- Consumes: `dist/json/knowledge_catalog.json` and shard fields `chapter_id`, `section_id`.
- Produces: `KNOWLEDGE_CATALOG: RuntimeKnowledgeCatalog`; `Question.chapterId`; `Question.sectionId`; `QuestionFilter.chapterId`; `QuestionFilter.sectionId`.

- [ ] **Step 1: Write failing sync and repository tests**

Extend the sync fixture with:

```ts
writeFileSync(
  join(source, "knowledge_catalog.json"),
  JSON.stringify({
    occupations: {
      "4-02-06-01": {
        title: "粮油仓储管理员",
        parts: [],
      },
    },
  }),
);
```

Assert:

```ts
const catalogModule = readFileSync(
  join(target, "runtime-knowledge-catalog.ts"),
  "utf8",
);
expect(catalogModule).toContain("export const RUNTIME_KNOWLEDGE_CATALOG");
expect(catalogModule).toContain("粮油仓储管理员");
```

Add stable IDs to `runtimeQuestion` and `makeQuestion` fixtures:

```ts
chapter_id: 'warehouse-l5-c03',
section_id: 'warehouse-l5-c03-s03',
```

and:

```ts
chapterId: 'warehouse-l5-c03',
sectionId: 'warehouse-l5-c03-s03',
```

Add repository assertions:

```ts
await expect(
  repository.list({ sectionId: "warehouse-l5-c03-s03" }),
).resolves.toHaveLength(1);
await expect(
  repository.list({ chapterId: "warehouse-l4-c07" }),
).resolves.toEqual([expect.objectContaining({ id: "WH-L4-000001" })]);
```

- [ ] **Step 2: Run targeted tests and verify failures**

Run:

```powershell
Set-Location miniapp
npm test -- --run tests/sync-question-bank.test.ts tests/local-question-repository.test.ts
```

Expected: missing catalog module and unknown catalog filter fields.

- [ ] **Step 3: Add runtime catalog types**

Create `miniapp/miniprogram/types/knowledge-catalog.ts`:

```ts
import type { CertificateLevel, OccupationCode } from "./domain";

export interface CatalogSection {
  id: string;
  number: number;
  title: string;
  page: number | null;
}

export interface CatalogChapter {
  id: string;
  number: number;
  title: string;
  page: number | null;
  sections: CatalogSection[];
}

export interface CatalogPart {
  id: string;
  number: number;
  title: string;
  levels: CertificateLevel[];
  chapters: CatalogChapter[];
}

export interface CatalogOccupation {
  title: string;
  parts: CatalogPart[];
}

export interface RuntimeKnowledgeCatalog {
  occupations: Record<OccupationCode, CatalogOccupation>;
}
```

Create the import boundary:

```ts
import { RUNTIME_KNOWLEDGE_CATALOG } from "./questions/runtime-knowledge-catalog";

export const KNOWLEDGE_CATALOG = RUNTIME_KNOWLEDGE_CATALOG;
```

- [ ] **Step 4: Generate the runtime catalog TypeScript module**

In `syncQuestionBank`, read and validate `knowledge_catalog.json` before writing any target:

```js
const catalog = JSON.parse(
  readFileSync(join(sourceDir, "knowledge_catalog.json"), "utf8"),
);
if (!catalog || typeof catalog !== "object" || !catalog.occupations) {
  throw new Error("knowledge_catalog.json must contain occupations");
}
```

Generate:

```js
const catalogModule = `import type { RuntimeKnowledgeCatalog } from '../../types/knowledge-catalog';

export const RUNTIME_KNOWLEDGE_CATALOG: RuntimeKnowledgeCatalog = ${JSON.stringify(catalog, null, 2)};
`;
writeFileSync(
  join(targetDir, "runtime-knowledge-catalog.ts"),
  catalogModule,
  "utf8",
);
```

Keep the existing generated `runtime-question-records.ts` behavior intact.

- [ ] **Step 5: Add stable IDs to runtime and domain questions**

Add to `RuntimeQuestionRecord`:

```ts
chapter_id: string;
section_id: string;
```

Add to `Question`:

```ts
chapterId: string;
sectionId: string;
```

Add to `QuestionFilter`:

```ts
chapterId?: string;
sectionId?: string;
```

Adapt and filter:

```ts
chapterId: record.chapter_id,
sectionId: record.section_id,
```

```ts
if (filter.chapterId && question.chapterId !== filter.chapterId) return false;
if (filter.sectionId && question.sectionId !== filter.sectionId) return false;
```

- [ ] **Step 6: Rebuild runtime assets and run tests**

Run from the repository root:

```powershell
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm run sync:questions
npm test -- --run tests/sync-question-bank.test.ts tests/local-question-repository.test.ts
```

Expected: both test files pass; generated question records include stable IDs; generated catalog imports no JSON.

- [ ] **Step 7: Commit**

Run:

```powershell
git add -- miniapp/scripts/sync-question-bank.mjs miniapp/tests/sync-question-bank.test.ts miniapp/miniprogram/types/knowledge-catalog.ts miniapp/miniprogram/data/knowledge-catalog.ts miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts miniapp/miniprogram/types/runtime-question.ts miniapp/miniprogram/types/domain.ts miniapp/miniprogram/repositories/local-question-repository.ts miniapp/tests/local-question-repository.test.ts miniapp/tests/factories.ts miniapp/miniprogram/data/questions/runtime-question-records.ts miniapp/miniprogram/data/questions/warehouse_l5.json miniapp/miniprogram/data/questions/warehouse_l4.json miniapp/miniprogram/data/questions/warehouse_l3.json miniapp/miniprogram/data/questions/inspector_l5.json miniapp/miniprogram/data/questions/inspector_l4.json miniapp/miniprogram/data/questions/inspector_l3.json
git diff --cached --check
git commit -m "feat: sync textbook catalog into miniapp"
```

---

### Task 5: Derive catalog counts and learning progress

**Files:**

- Modify: `miniapp/miniprogram/services/progress-service.ts`
- Modify: `miniapp/tests/progress-service.test.ts`
- Create: `miniapp/miniprogram/presenters/catalog-presenter.ts`
- Create: `miniapp/tests/catalog-presenter.test.ts`
- Modify: `miniapp/miniprogram/presenters/library-presenter.ts`
- Modify: `miniapp/tests/presenters.test.ts`

**Interfaces:**

- Consumes: `RuntimeKnowledgeCatalog`, `Question.chapterId`, `Question.sectionId`.
- Produces: `ProgressService.getQuestionProgress(questionIds)` and `presentCatalogParts(...)`.

- [ ] **Step 1: Write failing progress tests**

Add:

```ts
it("summarizes unique completion, attempt accuracy and active wrong questions by ID", () => {
  const service = new ProgressService(repository);
  service.recordAnswer({
    questionId: "Q1",
    correct: false,
    durationMs: 10,
    at: "2026-07-23",
  });
  service.recordAnswer({
    questionId: "Q1",
    correct: true,
    durationMs: 10,
    at: "2026-07-23",
  });
  service.recordAnswer({
    questionId: "Q2",
    correct: true,
    durationMs: 10,
    at: "2026-07-23",
  });

  expect(service.getQuestionProgress(["Q1", "Q2", "Q3"])).toEqual({
    completed: 2,
    attempts: 3,
    correctAttempts: 2,
    wrongQuestions: 1,
  });
});
```

- [ ] **Step 2: Write failing catalog presenter tests**

Create a minimal catalog fixture with one empty and one populated section, then assert:

```ts
expect(view[0]?.chapters[0]?.sections).toEqual([
  expect.objectContaining({
    id: "warehouse-l5-c03-s01",
    questionCount: 0,
    countText: "待补充",
    canStart: false,
  }),
  expect.objectContaining({
    id: "warehouse-l5-c03-s03",
    questionCount: 1,
    countText: "1 题",
    canStart: true,
  }),
]);
```

Assert the selected level includes the basic part and exactly one level part:

```ts
expect(view.map((part) => part.id)).toEqual([
  "warehouse-basic",
  "warehouse-l5",
]);
```

- [ ] **Step 3: Run targeted tests and verify failures**

Run:

```powershell
Set-Location miniapp
npm test -- --run tests/progress-service.test.ts tests/catalog-presenter.test.ts
```

Expected: missing method and missing presenter module.

- [ ] **Step 4: Implement the progress summary**

Add:

```ts
export interface QuestionProgressSummary {
  completed: number;
  attempts: number;
  correctAttempts: number;
  wrongQuestions: number;
}
```

Implement:

```ts
getQuestionProgress(questionIds: readonly string[]): QuestionProgressSummary {
  const ids = new Set(questionIds);
  const answers = this.data.answers.filter((answer) => ids.has(answer.questionId));
  return {
    completed: new Set(answers.map((answer) => answer.questionId)).size,
    attempts: answers.length,
    correctAttempts: answers.filter((answer) => answer.correct).length,
    wrongQuestions: Object.values(this.data.wrongQuestions).filter(
      (record) => ids.has(record.questionId) && !record.mastered,
    ).length,
  };
}
```

- [ ] **Step 5: Implement the pure catalog presenter**

Use this public signature:

```ts
export const presentCatalogParts = (input: {
  catalog: RuntimeKnowledgeCatalog;
  occupation: OccupationCode;
  level: CertificateLevel;
  questions: readonly Question[];
  getProgress: (questionIds: readonly string[]) => QuestionProgressSummary;
}): CatalogPartViewModel[];
```

For each visible part, chapter, and section:

- filter parts by `part.levels.includes(level)`;
- collect question IDs by stable chapter/section IDs;
- retain empty nodes;
- use `待补充` for zero questions and `${count} 题` otherwise;
- calculate completion as `completed / questionCount`;
- calculate accuracy as `correctAttempts / attempts`;
- display wrong count from `wrongQuestions`;
- preserve canonical catalog order.

Use these view-model fields:

```ts
export interface CatalogSectionViewModel {
  id: string;
  numberText: string;
  title: string;
  questionCount: number;
  countText: string;
  canStart: boolean;
}

export interface CatalogChapterViewModel {
  id: string;
  numberText: string;
  title: string;
  questionCount: number;
  metaText: string;
  progressText: string;
  accuracyText: string;
  wrongText: string;
  canStart: boolean;
  sections: CatalogSectionViewModel[];
}

export interface CatalogPartViewModel {
  id: string;
  numberText: string;
  title: string;
  chapters: CatalogChapterViewModel[];
}
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- --run tests/progress-service.test.ts tests/catalog-presenter.test.ts tests/presenters.test.ts
```

Expected: progress, catalog presenter, and legacy presenter tests pass. Remove `presentLibraryModules` only after all call sites have moved in Task 6.

- [ ] **Step 7: Commit**

Run:

```powershell
git add -- miniapp/miniprogram/services/progress-service.ts miniapp/tests/progress-service.test.ts miniapp/miniprogram/presenters/catalog-presenter.ts miniapp/tests/catalog-presenter.test.ts miniapp/miniprogram/presenters/library-presenter.ts miniapp/tests/presenters.test.ts
git diff --cached --check
git commit -m "feat: present catalog learning progress"
```

---

### Task 6: Replace the flat library with expandable textbook sections

**Files:**

- Modify: `miniapp/miniprogram/pages/library/index.ts`
- Modify: `miniapp/miniprogram/pages/library/index.wxml`
- Modify: `miniapp/miniprogram/pages/library/index.wxss`
- Modify: `miniapp/miniprogram/services/paper-builder.ts`
- Modify: `miniapp/miniprogram/services/practice-runtime.ts`
- Modify: `miniapp/miniprogram/pages/practice/index.ts`
- Modify: `miniapp/tests/paper-builder.test.ts`
- Modify: `miniapp/tests/local-question-repository.test.ts`

**Interfaces:**

- Consumes: `presentCatalogParts`, stable repository filters, and `KNOWLEDGE_CATALOG`.
- Produces: routes `chapterId=<id>` and `sectionId=<id>`; expandable catalog UI.

- [ ] **Step 1: Write failing paper-builder tests**

Add catalog IDs to the test questions and assert:

```ts
it("filters chapter and section practice by stable catalog IDs", () => {
  expect(
    buildPaper(questions, {
      mode: "chapter",
      chapterId: "warehouse-l5-c04",
      limit: 20,
    }).map((item) => item.id),
  ).toEqual(["Q1", "Q3"]);
  expect(
    buildPaper(questions, {
      mode: "chapter",
      sectionId: "warehouse-l5-c04-s01",
      limit: 20,
    }).map((item) => item.id),
  ).toEqual(["Q1"]);
});
```

- [ ] **Step 2: Run the paper-builder test and verify failure**

Run:

```powershell
Set-Location miniapp
npm test -- --run tests/paper-builder.test.ts
```

Expected: TypeScript reports unknown `chapterId` and `sectionId` options.

- [ ] **Step 3: Implement stable practice filters**

Replace the module-only build option with:

```ts
export interface BuildPaperOptions {
  mode: PracticeMode;
  limit: number;
  module?: string;
  chapterId?: string;
  sectionId?: string;
  random?: () => number;
}
```

Filter in this order:

```ts
const candidates = questions.filter((question) => {
  if (options.chapterId && question.chapterId !== options.chapterId)
    return false;
  if (options.sectionId && question.sectionId !== options.sectionId)
    return false;
  if (options.module && question.module !== options.module) return false;
  return true;
});
```

Add both optional fields to `StartPracticeInput`, the repository query, and `buildPaper` options. Keep `module` as a compatibility fallback.

Parse routes in `practice/index.ts`:

```ts
...(options['chapterId'] ? { chapterId: decodeURIComponent(options['chapterId']) } : {}),
...(options['sectionId'] ? { sectionId: decodeURIComponent(options['sectionId']) } : {}),
```

- [ ] **Step 4: Replace library module data with catalog data**

Use:

```ts
parts: [] as CatalogPartViewModel[],
expandedChapterId: '',
```

After loading certificate questions:

```ts
const parts = presentCatalogParts({
  catalog: KNOWLEDGE_CATALOG,
  occupation: certificate.occupation,
  level: certificate.level,
  questions,
  getProgress: (ids) => appServices.progress.getQuestionProgress(ids),
});
this.setData({ questionCount: questions.length, parts, loading: false });
```

Add handlers:

```ts
onToggleChapter(event: WechatMiniprogram.TouchEvent) {
  const chapterId = String(event.currentTarget.dataset['chapterId']);
  this.setData({
    expandedChapterId: this.data.expandedChapterId === chapterId ? '' : chapterId,
  });
}

onChapterPractice(event: WechatMiniprogram.TouchEvent) {
  const chapterId = String(event.currentTarget.dataset['chapterId']);
  if (chapterId) this.start('chapter', { chapterId });
}

onSectionPractice(event: WechatMiniprogram.TouchEvent) {
  const sectionId = String(event.currentTarget.dataset['sectionId']);
  if (sectionId) this.start('chapter', { sectionId });
}
```

Build the route with encoded stable IDs and do not send Chinese titles.

- [ ] **Step 5: Render all parts, chapters, and sections**

Replace the flat module WXML with:

```xml
<view id="catalog-list" class="catalog">
  <view wx:for="{{parts}}" wx:key="id" class="catalog-part">
    <view class="catalog-part__eyebrow">{{item.numberText}}</view>
    <view class="catalog-part__title">{{item.title}}</view>

    <view wx:for="{{item.chapters}}" wx:for-item="chapter" wx:key="id" class="catalog-chapter">
      <view
        class="catalog-chapter__header"
        data-chapter-id="{{chapter.id}}"
        bind:tap="onToggleChapter"
      >
        <view class="catalog-chapter__copy">
          <text class="catalog-chapter__number">{{chapter.numberText}}</text>
          <view class="catalog-chapter__title">{{chapter.title}}</view>
          <text class="catalog-chapter__meta">{{chapter.metaText}}</text>
        </view>
        <t-icon name="chevron-down" size="32rpx" color="#86868b" />
      </view>

      <view wx:if="{{expandedChapterId === chapter.id}}" class="catalog-section-list">
        <view wx:for="{{chapter.sections}}" wx:for-item="section" wx:key="id" class="catalog-section">
          <view class="catalog-section__copy">
            <text class="catalog-section__number">{{section.numberText}}</text>
            <view class="catalog-section__title">{{section.title}}</view>
            <text class="catalog-section__count">{{section.countText}}</text>
          </view>
          <view
            wx:if="{{section.canStart}}"
            class="catalog-section__action"
            data-section-id="{{section.id}}"
            catch:tap="onSectionPractice"
          >开始</view>
          <text wx:else class="catalog-section__pending">待补充</text>
        </view>
        <view
          wx:if="{{chapter.canStart}}"
          class="catalog-chapter__practice"
          data-chapter-id="{{chapter.id}}"
          catch:tap="onChapterPractice"
        >练习本章</view>
      </view>
    </view>
  </view>
</view>
```

Style the hierarchy with existing tokens: white surface, `var(--color-border)` separators, no new gradients, and minimum 88rpx touch targets.

- [ ] **Step 6: Run mini-program tests**

Run:

```powershell
npm test -- --run tests/paper-builder.test.ts tests/local-question-repository.test.ts tests/catalog-presenter.test.ts
npm run typecheck
npm run lint
```

Expected: targeted tests, TypeScript, ESLint, and Stylelint pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add -- miniapp/miniprogram/pages/library/index.ts miniapp/miniprogram/pages/library/index.wxml miniapp/miniprogram/pages/library/index.wxss miniapp/miniprogram/services/paper-builder.ts miniapp/miniprogram/services/practice-runtime.ts miniapp/miniprogram/pages/practice/index.ts miniapp/tests/paper-builder.test.ts miniapp/tests/local-question-repository.test.ts
git diff --cached --check
git commit -m "feat: add textbook chapter practice"
```

---

### Task 7: Use standard catalog names in reports and saved-question filters

**Files:**

- Modify: `miniapp/miniprogram/services/practice-session.ts`
- Modify: `miniapp/tests/practice-session.test.ts`
- Modify: `miniapp/miniprogram/presenters/report-presenter.ts`
- Modify: `miniapp/tests/presenters.test.ts`
- Modify: `miniapp/miniprogram/pages/report/index.ts`
- Modify: `miniapp/miniprogram/presenters/question-list-presenter.ts`
- Modify: `miniapp/miniprogram/pages/question-list/index.ts`
- Modify: `miniapp/miniprogram/pages/question-list/index.wxml`

**Interfaces:**

- Consumes: `Question.chapterId`, `Question.sectionId`, and the runtime catalog lookup.
- Produces: `PracticeReport.chapters`; `QuestionListFilter.chapterId`; standard chapter labels.

- [ ] **Step 1: Write failing report aggregation tests**

Change the practice-session assertion to expect:

```ts
expect(submitted.report?.chapters).toEqual({
  "warehouse-l5-c04": { total: 2, correct: 1 },
});
```

Add presenter input with a catalog label resolver:

```ts
const view = presentReport(report, (chapterId) =>
  chapterId === "warehouse-l5-c04" ? "第四章 粮情检查" : chapterId,
);
expect(view.weakModules[0]?.name).toBe("第四章 粮情检查");
```

Add question-list filtering:

```ts
filter: {
  chapterId: "warehouse-l5-c04";
}
```

- [ ] **Step 2: Run targeted tests and verify failures**

Run:

```powershell
Set-Location miniapp
npm test -- --run tests/practice-session.test.ts tests/presenters.test.ts
```

Expected: old reports expose `modules`, and question-list filters do not accept `chapterId`.

- [ ] **Step 3: Aggregate reports by stable chapter ID**

Rename `PracticeReport.modules` to:

```ts
chapters: Record<string, ModuleReport>;
```

In `submitSession`, aggregate with:

```ts
const previous = chapters[question.chapterId] ?? { total: 0, correct: 0 };
chapters[question.chapterId] = {
  total: previous.total + 1,
  correct: previous.correct + (result.correct ? 1 : 0),
};
```

Keep the view-model name `weakModules` in this phase to avoid changing report WXML classes; its displayed names come from the standard catalog.

- [ ] **Step 4: Add catalog label lookup**

Export from `catalog-presenter.ts`:

```ts
export const findCatalogChapterTitle = (
  catalog: RuntimeKnowledgeCatalog,
  chapterId: string,
): string =>
  Object.values(catalog.occupations)
    .flatMap((occupation) => occupation.parts)
    .flatMap((part) => part.chapters)
    .find((chapter) => chapter.id === chapterId)?.title ?? chapterId;
```

Change `presentReport` to accept a resolver:

```ts
export const presentReport = (
  report: PracticeReport,
  resolveChapterTitle: (chapterId: string) => string = (chapterId) => chapterId,
): ReportViewModel => {
```

Pass `findCatalogChapterTitle(KNOWLEDGE_CATALOG, chapterId)` from the report page.

- [ ] **Step 5: Filter wrong and favorite lists by chapter**

Add `chapterId?: string` to `QuestionListFilter`, filter by `question.chapterId`, and expose unique filters as:

```ts
chapters: Array<{ id: string; title: string }>;
```

Add this optional resolver to `QuestionListInput`:

```ts
resolveChapterTitle?: (chapterId: string) => string;
```

Default it to `(chapterId) => chapterId` inside the presenter. The page passes `(chapterId) => findCatalogChapterTitle(KNOWLEDGE_CATALOG, chapterId)`, uses the stable ID as the filter value, and displays the resolved chapter title on question cards. Retain legacy `module` data only as hidden compatibility, not as the new filter key.

- [ ] **Step 6: Run targeted and full mini-program tests**

Run:

```powershell
npm test -- --run tests/practice-session.test.ts tests/presenters.test.ts
npm run verify
```

Expected: all mini-program checks pass and the total Vitest count is greater than 57 because catalog tests were added.

- [ ] **Step 7: Commit**

Run:

```powershell
git add -- miniapp/miniprogram/services/practice-session.ts miniapp/tests/practice-session.test.ts miniapp/miniprogram/presenters/report-presenter.ts miniapp/tests/presenters.test.ts miniapp/miniprogram/pages/report/index.ts miniapp/miniprogram/presenters/question-list-presenter.ts miniapp/miniprogram/pages/question-list/index.ts miniapp/miniprogram/pages/question-list/index.wxml miniapp/miniprogram/presenters/catalog-presenter.ts
git diff --cached --check
git commit -m "feat: report progress by textbook chapter"
```

---

### Task 8: Document and verify the complete catalog release

**Files:**

- Modify: `README.md`
- Modify: `docs/question-runtime-contract.md`
- Modify: `miniapp/tests/project-structure.test.ts`

**Interfaces:**

- Consumes: completed catalog pipeline and mini-program UI.
- Produces: documented build commands and final verification evidence.

- [ ] **Step 1: Add failing structure assertions**

Assert the canonical and generated catalog files exist:

```ts
for (const relativePath of [
  join(miniappRoot, "..", "..", "data", "knowledge_catalog.json"),
  join(miniappRoot, "data", "knowledge-catalog.ts"),
  join(miniappRoot, "data", "questions", "runtime-knowledge-catalog.ts"),
]) {
  expect(existsSync(relativePath)).toBe(true);
}
```

Assert the old library page no longer calls `presentLibraryModules`.

- [ ] **Step 2: Run the structure test and verify the intended failure**

Run:

```powershell
Set-Location miniapp
npm test -- --run tests/project-structure.test.ts
```

Expected: failure until the final generated catalog and library cleanup are present.

- [ ] **Step 3: Update documentation**

Document the exact release commands:

```powershell
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm run sync:questions
npm run verify
```

Document runtime mappings:

```text
chapter_id -> chapterId
section_id -> sectionId
knowledge_catalog.json -> runtime-knowledge-catalog.ts
```

State that the warehouse catalog is four parts, 11 chapters, 44 sections and that inspector uses a separate eight-module catalog.

- [ ] **Step 4: Run full verification**

Run from the worktree root:

```powershell
python -m pytest -q
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm run sync:questions
npm run verify
```

Expected:

- every Python test passes;
- validation reports no errors;
- warehouse shard counts remain release-valid;
- mini-program typecheck, lint, format check, and all Vitest tests pass.

- [ ] **Step 5: Verify in WeChat Developer Tools**

Perform this smoke sequence:

1. Compile the mini-program.
2. Open 题库 → 储粮保管员 → 初级.
3. Confirm “第一部分 基础知识” and “第二部分 初级粮油仓储管理员” display.
4. Expand all junior chapters and confirm empty sections remain with “待补充”.
5. Start the populated “粮油出入库收尾工作” section and answer one question.
6. Switch to 中级 and confirm junior-only chapters disappear.
7. Switch to 高级 and confirm 第九至第十一章 display.
8. Switch to 粮油质检员 and confirm its independent directory still opens.
9. Open 错题本 and a practice report; confirm standard chapter names display.
10. Resume a pre-existing session and confirm question position and answers remain.

Expected: no console errors, no blank screen, stable catalog filtering, and no learning-data reset.

- [ ] **Step 6: Commit documentation and final structure checks**

Run:

```powershell
git add -- README.md docs/question-runtime-contract.md miniapp/tests/project-structure.test.ts
git diff --cached --check
git commit -m "docs: document textbook catalog workflow"
```

- [ ] **Step 7: Final status audit**

Run:

```powershell
git status --short
git log --oneline -10
```

Expected: only intentionally preserved user-local files remain modified; the catalog implementation is represented by focused commits.
