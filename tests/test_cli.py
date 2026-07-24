import json
from pathlib import Path

from grain_quiz.cli import main
from tests.factories import BASE, SOURCE, write_jsonl


def valid_question_data(**overrides: object) -> dict[str, object]:
    return {
        **BASE,
        "module": "\u7cae\u60c5\u68c0\u67e5",
        "topic": "\u7cae\u6e29\u68c0\u67e5",
        "review_status": "verified",
        **overrides,
    }


def write_inputs(
    tmp_path: Path,
    questions: list[dict[str, object]],
    sources: list[dict[str, object]],
) -> tuple[Path, Path, Path, Path]:
    question_directory = tmp_path / "questions"
    question_directory.mkdir()
    write_jsonl(question_directory / "questions.jsonl", questions)
    source_path = tmp_path / "sources.json"
    source_path.write_text(json.dumps(sources, ensure_ascii=False), encoding="utf-8")
    taxonomy_path = Path("data/taxonomy.json")
    catalog_path = Path("data/knowledge_catalog.json")
    return question_directory, source_path, taxonomy_path, catalog_path


def test_validate_prints_release_errors_for_missing_source(tmp_path: Path, capsys):
    questions, sources, taxonomy, catalog = write_inputs(
        tmp_path,
        [valid_question_data()],
        [],
    )

    exit_code = main(
        [
            "validate",
            "--questions",
            str(questions),
            "--sources",
            str(sources),
            "--taxonomy",
            str(taxonomy),
            "--catalog",
            str(catalog),
        ]
    )

    assert exit_code == 1
    assert "missing_source" in capsys.readouterr().out


def test_dedupe_prints_exact_pairs(tmp_path: Path, capsys):
    questions, _, _, _ = write_inputs(
        tmp_path,
        [
            valid_question_data(),
            valid_question_data(id="WH-L5-000002"),
        ],
        [],
    )

    exit_code = main(["dedupe", "--questions", str(questions), "--threshold", "92"])

    assert exit_code == 0
    assert "EXACT WH-L5-000001 WH-L5-000002" in capsys.readouterr().out


def test_build_rejects_missing_source_without_publishing(tmp_path: Path, capsys):
    questions, sources, taxonomy, catalog = write_inputs(
        tmp_path,
        [valid_question_data()],
        [],
    )
    output = tmp_path / "release"

    exit_code = main(
        [
            "build",
            "--questions",
            str(questions),
            "--sources",
            str(sources),
            "--taxonomy",
            str(taxonomy),
            "--catalog",
            str(catalog),
            "--output",
            str(output),
        ]
    )

    assert exit_code == 1
    assert "missing_source" in capsys.readouterr().out
    assert not output.exists()


def test_build_exports_portable_runtime_artifacts_by_default(tmp_path: Path):
    questions, sources, taxonomy, catalog = write_inputs(
        tmp_path,
        [valid_question_data()],
        [SOURCE],
    )
    output = tmp_path / "release"

    exit_code = main(
        [
            "build",
            "--questions",
            str(questions),
            "--sources",
            str(sources),
            "--taxonomy",
            str(taxonomy),
            "--catalog",
            str(catalog),
            "--output",
            str(output),
        ]
    )

    version_report = json.loads(
        (output / "version-report.json").read_text(encoding="utf-8")
    )
    shard = json.loads(
        (output / "json" / "warehouse_l5.json").read_text(encoding="utf-8")
    )
    assert exit_code == 0
    assert not (output / "question-bank.xlsx").exists()
    assert (output / "json" / "knowledge_catalog.json").is_file()
    assert [record["id"] for record in shard] == ["WH-L5-000001"]
    assert version_report["validation_errors"] == 0
    assert version_report["source_count"] == 1
    assert version_report["shard_counts"]["warehouse_l5.json"] == 1


def test_build_can_request_an_optional_review_workbook(tmp_path: Path, monkeypatch):
    questions, sources, taxonomy, catalog = write_inputs(
        tmp_path,
        [valid_question_data()],
        [SOURCE],
    )
    output = tmp_path / "release"

    def fake_export_workbook(questions, sources, report, target):
        target.write_bytes(b"review workbook")

    monkeypatch.setattr("grain_quiz.cli.export_workbook", fake_export_workbook)

    exit_code = main(
        [
            "build",
            "--questions",
            str(questions),
            "--sources",
            str(sources),
            "--taxonomy",
            str(taxonomy),
            "--catalog",
            str(catalog),
            "--output",
            str(output),
            "--review-workbook",
        ]
    )

    assert exit_code == 0
    assert (output / "question-bank.xlsx").read_bytes() == b"review workbook"
