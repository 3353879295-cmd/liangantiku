import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from grain_quiz.export import export_json_shards, export_workbook
from grain_quiz.models import Question, Source
from grain_quiz.stats import build_stats
from grain_quiz.validate import ValidationIssue, ValidationReport
from tests.factories import BASE, SOURCE


ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("GRAIN_QUIZ_NODE") or shutil.which("node")
WORKBOOK_TOOL = ROOT / "tools" / "review_workbook.mjs"
ARTIFACT_TOOL = ROOT / "tools" / "node_modules" / "@oai" / "artifact-tool" / "package.json"
SHEET_NAMES = [
    "\u6b63\u5f0f\u9898\u5e93",
    "\u6765\u6e90\u7d22\u5f15",
    "\u5f85\u590d\u6838\u9898",
    "\u505c\u7528\u9898",
    "\u9898\u91cf\u7edf\u8ba1",
]


def question_data(**overrides: object) -> dict[str, object]:
    return {**BASE, "review_status": "verified", **overrides}


def inspect_workbook(path: Path) -> dict[str, object]:
    if not NODE:
        raise RuntimeError("Node.js is required to inspect the workbook")
    result = subprocess.run(
        [NODE, str(WORKBOOK_TOOL), "inspect", str(path)],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=ROOT,
    )
    return json.loads(result.stdout)


def test_build_stats_counts_each_dimension_deterministically():
    questions = [
        Question.model_validate(question_data()),
        Question.model_validate(
            question_data(id="WH-L4-000002", level=4, review_status="pending")
        ),
        Question.model_validate(
            question_data(
                id="QI-L3-000003",
                occupation_code="4-08-05-01",
                level=3,
                module="inspector module",
                topic="inspector topic",
                difficulty="hard",
                review_status="retired",
            )
        ),
    ]

    stats = build_stats(questions)

    assert stats["occupation"] == {"4-02-06-01": 2, "4-08-05-01": 1}
    assert stats["level"] == {"3": 1, "4": 1, "5": 1}
    assert stats["review_status"] == {"pending": 1, "retired": 1, "verified": 1}
    assert stats["type"] == {"single": 3}
    assert stats["difficulty"] == {"easy": 2, "hard": 1}


def test_export_json_shards_are_sorted_and_verified_only(tmp_path: Path):
    questions = [
        Question.model_validate(
            question_data(
                id="WH-L5-000002",
                type="multiple",
                answer=["C", "A"],
            )
        ),
        Question.model_validate(question_data(id="WH-L5-000001")),
        Question.model_validate(
            question_data(id="WH-L5-000003", review_status="pending")
        ),
        Question.model_validate(
            question_data(
                id="QI-L4-000004",
                occupation_code="4-08-05-01",
                level=4,
            )
        ),
    ]

    counts = export_json_shards(questions, tmp_path)

    assert counts == {
        "warehouse_l5.json": 2,
        "warehouse_l4.json": 0,
        "warehouse_l3.json": 0,
        "inspector_l5.json": 0,
        "inspector_l4.json": 1,
        "inspector_l3.json": 0,
    }
    for filename in counts:
        records = json.loads((tmp_path / filename).read_text(encoding="utf-8"))
        assert [record["id"] for record in records] == sorted(
            record["id"] for record in records
        )
        assert all(record["review_status"] == "verified" for record in records)
    warehouse_records = json.loads(
        (tmp_path / "warehouse_l5.json").read_text(encoding="utf-8")
    )
    assert warehouse_records[1]["answer"] == ["C", "A"]
    assert warehouse_records[1]["options"] == BASE["options"]
    assert set(warehouse_records[0]) == {
        "id",
        "occupation",
        "direction",
        "level",
        "module",
        "topic",
        "chapter_id",
        "section_id",
        "type",
        "stem",
        "options",
        "answer",
        "explanation",
        "difficulty",
        "keywords",
        "source_ids",
        "standard_reference",
        "review_status",
        "content_version",
    }


def test_export_json_shards_preserves_case_questions(tmp_path: Path):
    question = Question.model_validate(
        question_data(id="WH-L3-000009", level=3, type="case", answer=["C"])
    )

    export_json_shards([question], tmp_path)

    records = json.loads((tmp_path / "warehouse_l3.json").read_text(encoding="utf-8"))
    assert records[0]["type"] == "case"
    assert records[0]["answer"] == ["C"]


@pytest.mark.skipif(
    not NODE or not ARTIFACT_TOOL.is_file(),
    reason="optional artifact-tool workbook runtime is unavailable",
)
def test_export_workbook_uses_required_sheets_and_separates_statuses(tmp_path: Path):
    verified = Question.model_validate(
        question_data(type="multiple", answer=["C", "A"])
    )
    pending = Question.model_validate(
        question_data(id="WH-L5-000002", review_status="pending")
    )
    retired = Question.model_validate(
        question_data(id="WH-L5-000003", review_status="retired")
    )
    source = Source.model_validate(SOURCE)
    report = ValidationReport(
        errors=[ValidationIssue("missing_source", verified.id, "test error")],
        warnings=[ValidationIssue("unreleased_question", pending.id, "test warning")],
    )
    output = tmp_path / "question-bank.xlsx"

    export_workbook(
        [retired, pending, verified],
        {source.id: source},
        report,
        output,
    )

    inspection = inspect_workbook(output)
    values = inspection["values"]
    assert inspection["sheets"] == SHEET_NAMES
    assert inspection["table_counts"] == {name: 1 for name in SHEET_NAMES}
    official = values[SHEET_NAMES[0]]
    pending_rows = values[SHEET_NAMES[2]]
    retired_rows = values[SHEET_NAMES[3]]
    assert [row[0] for row in official[1:]] == [verified.id]
    assert [row[0] for row in pending_rows[1:]] == [pending.id]
    assert [row[0] for row in retired_rows[1:]] == [retired.id]
    assert pending.id not in [row[0] for row in official[1:]]
    answer_column = official[0].index("\u7b54\u6848")
    options_column = official[0].index("\u9009\u9879")
    assert json.loads(official[1][answer_column]) == ["C", "A"]
    assert json.loads(official[1][options_column]) == BASE["options"]
    assert values[SHEET_NAMES[1]][1][0] == source.id
    assert any(row[0] == "\u6821\u9a8c\u9519\u8bef" for row in values[SHEET_NAMES[4]][1:])
