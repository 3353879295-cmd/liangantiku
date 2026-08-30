import json
from pathlib import Path

from grain_quiz.catalog import load_knowledge_catalog


ROOT = Path(__file__).resolve().parents[1]
LEVELS = (5, 4, 3, 2, 1)


def _records_by_id() -> dict[str, dict[str, object]]:
    records: dict[str, dict[str, object]] = {}
    for level in LEVELS:
        path = ROOT / "data" / "questions" / f"warehouse_l{level}.jsonl"
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                record = json.loads(line)
                assert record["id"] not in records
                records[record["id"]] = record
    return records


def _manifest() -> dict[str, object]:
    return json.loads(
        (ROOT / "data" / "warehouse_classification_manifest.json").read_text(
            encoding="utf-8"
        )
    )


def test_published_ids_are_unique_and_pending_ids_are_absent():
    published = _records_by_id()
    manifest = _manifest()
    pending_ids = {item["question_id"] for item in manifest["pending"]}
    assert pending_ids.isdisjoint(published)
    assert len(published) == sum(manifest["published_counts"].values())


def test_every_published_path_is_in_the_level_catalog():
    catalog = load_knowledge_catalog(ROOT / "data" / "knowledge_catalog.json")
    for question in _records_by_id().values():
        assert question["chapter_id"] != "warehouse-import-c01"
        assert question["section_id"] != "warehouse-import-c01-s01"
        assert catalog.allows(
            question["occupation_code"],
            question["level"],
            question["chapter_id"],
            question["section_id"],
        )


def test_manifest_counts_and_coverage_match_published_dataset():
    manifest = _manifest()
    baseline_count = sum(manifest["baseline_counts"].values())
    published_count = sum(manifest["published_counts"].values())
    pending_count = sum(manifest["pending_counts"].values())
    records = _records_by_id()

    assert baseline_count == 4110
    assert published_count == len(records)
    assert published_count + pending_count == baseline_count
    assert manifest["coverage"] >= 0.80
    assert manifest["rules_version"] == "2026-08-10.1"
    assert all(record["content_version"] == 2 for record in records.values())


def test_each_level_has_multiple_nonempty_chapters():
    records = _records_by_id()
    for level in LEVELS:
        chapter_ids = {
            record["chapter_id"]
            for record in records.values()
            if record["level"] == level
        }
        assert len(chapter_ids) > 1
