import json
from pathlib import Path

import pytest

from grain_quiz.io import load_questions, load_sources, write_questions
from grain_quiz.models import Question
from grain_quiz.taxonomy import load_taxonomy
from tests.factories import BASE, SOURCE, write_jsonl


def test_load_questions_is_stably_sorted(tmp_path: Path):
    write_jsonl(tmp_path / "b.jsonl", [{**BASE, "id": "WH-L5-000002"}])
    write_jsonl(tmp_path / "a.jsonl", [{**BASE, "id": "WH-L5-000001"}])

    assert [question.id for question in load_questions(tmp_path)] == [
        "WH-L5-000001",
        "WH-L5-000002",
    ]


def test_load_questions_reports_file_and_line_for_invalid_row(tmp_path: Path):
    invalid_path = tmp_path / "invalid.jsonl"
    invalid_path.write_text("not valid json\n", encoding="utf-8")

    with pytest.raises(ValueError, match=r"invalid\.jsonl:1"):
        load_questions(tmp_path)


def test_write_questions_creates_parent_and_sorts_compact_json(tmp_path: Path):
    path = tmp_path / "nested" / "questions.jsonl"
    first = Question.model_validate(BASE)
    second = Question.model_validate({**BASE, "id": "WH-L5-000002"})

    write_questions(path, [second, first])

    lines = path.read_text(encoding="utf-8").splitlines()
    assert [json.loads(line)["id"] for line in lines] == [
        "WH-L5-000001",
        "WH-L5-000002",
    ]
    assert all(": " not in line and ", " not in line for line in lines)


def test_load_sources_returns_records_indexed_by_source_id(tmp_path: Path):
    path = tmp_path / "sources.json"
    path.write_text(json.dumps([SOURCE]), encoding="utf-8")

    sources = load_sources(path)

    assert list(sources) == ["SRC-0001"]
    assert sources["SRC-0001"].title == "test source"


def test_load_sources_rejects_duplicate_source_ids(tmp_path: Path):
    path = tmp_path / "sources.json"
    path.write_text(json.dumps([SOURCE, SOURCE]), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicate source ID: SRC-0001"):
        load_sources(path)


def test_taxonomy_accepts_known_topic():
    taxonomy = load_taxonomy(Path("data/taxonomy.json"))

    assert taxonomy.allows(
        "4-02-06-01",
        5,
        "\u7cae\u60c5\u68c0\u67e5",
        "\u7cae\u6e29\u68c0\u67e5",
    )


def test_taxonomy_rejects_unknown_topic():
    taxonomy = load_taxonomy(Path("data/taxonomy.json"))

    assert not taxonomy.allows(
        "4-02-06-01",
        5,
        "\u7cae\u60c5\u68c0\u67e5",
        "\u4e0d\u5b58\u5728\u7684\u77e5\u8bc6\u70b9",
    )
