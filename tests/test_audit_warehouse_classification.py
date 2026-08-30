import csv
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _load_audit():
    path = ROOT / "tools" / "audit_warehouse_classification.py"
    spec = importlib.util.spec_from_file_location("warehouse_audit", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


AUDIT = _load_audit()


def test_sample_generation_is_byte_deterministic(tmp_path: Path):
    first = tmp_path / "first.csv"
    second = tmp_path / "second.csv"
    kwargs = {
        "questions_dir": ROOT / "data" / "questions",
        "catalog_path": ROOT / "data" / "knowledge_catalog.json",
        "per_level": 1,
    }

    AUDIT.generate_sample(output_path=first, **kwargs)
    AUDIT.generate_sample(output_path=second, **kwargs)

    assert first.read_bytes() == second.read_bytes()
    assert len(first.read_text(encoding="utf-8").splitlines()) == 6


def test_verify_sample_requires_explicit_yes_or_no(tmp_path: Path):
    sample = tmp_path / "sample.csv"
    report = tmp_path / "report.json"
    summary = tmp_path / "summary.json"
    report.write_text(json.dumps({"coverage": 0.84}), encoding="utf-8")
    with sample.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=AUDIT.SAMPLE_FIELDS)
        writer.writeheader()
        for index in range(4):
            writer.writerow(
                {
                    "question_id": f"Q-{index}",
                    "level": "2",
                    "chapter_id": "warehouse-l2-c02",
                    "chapter_title": "仓储管理",
                    "section_id": "warehouse-l2-c02-s01",
                    "section_title": "粮情与成分",
                    "stem": "题干",
                    "source_note": "来源",
                    "chapter_correct": "yes",
                    "review_note": "复核",
                }
            )

    result = AUDIT.verify_sample(
        sample_path=sample,
        report_path=report,
        output_summary_path=summary,
        expected_count=4,
    )
    assert result["reviewed_count"] == 4
    assert result["overall_accuracy"] == 1.0

    rows = list(csv.DictReader(sample.open(encoding="utf-8", newline="")))
    rows[0]["chapter_correct"] = ""
    with sample.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=AUDIT.SAMPLE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    with pytest.raises(AUDIT.AuditError, match="chapter_correct"):
        AUDIT.verify_sample(
            sample_path=sample,
            report_path=report,
            output_summary_path=summary,
            expected_count=4,
        )
