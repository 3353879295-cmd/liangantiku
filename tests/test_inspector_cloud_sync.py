import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.inspector_cloud_sync import (
    CloudSyncValidationError,
    plan_inspector_cloud_sync,
)
from grain_quiz.io import load_sources
from grain_quiz.models import Question
from grain_quiz.taxonomy import load_taxonomy


ROOT = Path(__file__).parents[1]
RELEASE_AT = datetime(2026, 8, 30, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def dependencies(tmp_path: Path):
    catalog_path = tmp_path / "knowledge_catalog.json"
    taxonomy_path = tmp_path / "taxonomy.json"
    catalog_data = json.loads((ROOT / "data" / "knowledge_catalog.json").read_text(encoding="utf-8"))
    taxonomy_data = json.loads((ROOT / "data" / "taxonomy.json").read_text(encoding="utf-8"))
    inspector_parts = catalog_data["occupations"]["4-08-05-01"]["parts"]
    inspector_levels = taxonomy_data["occupations"]["4-08-05-01"]["levels"]
    inspector_levels["2"] = {"modules": {"质检员综合理论": ["质检员综合理论"]}}
    inspector_levels["1"] = {"modules": {"质检员综合理论": ["质检员综合理论"]}}
    catalog_path.write_text(json.dumps(catalog_data, ensure_ascii=False), encoding="utf-8")
    taxonomy_path.write_text(json.dumps(taxonomy_data, ensure_ascii=False), encoding="utf-8")
    return (
        load_knowledge_catalog(catalog_path),
        load_taxonomy(taxonomy_path),
        load_sources(ROOT / "data" / "sources.json"),
    )


def cloud_question(**changes):
    level = changes.get("level", 5)
    imported_level = level in {1, 2}
    row = {
        "id": "QI-L5-000001",
        "question_id": "QI-L5-000001",
        "occupation": "4-08-05-01",
        "direction": "粮油质量检验员",
        "level": level,
        "module": "质检员综合理论" if imported_level else "粮油检验基础",
        "topic": "质检员综合理论" if imported_level else "粮油检验方法",
        "chapter_id": "inspector-import-c01" if imported_level else "inspector-basic-c04",
        "section_id": "inspector-import-c01-s01" if imported_level else "inspector-basic-c04-s03",
        "type": "single",
        "stem": "云端题干",
        "options": [
            {"key": "A", "text": "选项 A"},
            {"key": "B", "text": "选项 B"},
            {"key": "C", "text": "选项 C"},
            {"key": "D", "text": "选项 D"},
        ],
        "answer": ["A"],
        "explanation": "云端解析",
        "difficulty": "easy",
        "keywords": ["扦样"],
        "source_ids": ["SRC-0002"],
        "standard_reference": "检验员职业技能标准",
        "review_status": "verified",
        "content_version": 1,
    }
    row.update(changes)
    return row


def local_question(cloud=None, **changes):
    cloud = cloud or cloud_question()
    row = {
        "id": cloud["id"],
        "occupation_code": cloud["occupation"],
        "occupation_name": "农产品食品检验员",
        "direction": cloud["direction"],
        "level": cloud["level"],
        "module": cloud["module"],
        "topic": cloud["topic"],
        "chapter_id": cloud["chapter_id"],
        "section_id": cloud["section_id"],
        "type": cloud["type"],
        "stem": cloud["stem"],
        "options": cloud["options"],
        "answer": cloud["answer"],
        "explanation": cloud["explanation"],
        "difficulty": cloud["difficulty"],
        "keywords": cloud["keywords"],
        "source_ids": cloud["source_ids"],
        "standard_reference": cloud["standard_reference"],
        "source_note": cloud.get(
            "source_note", "云端 question_bank_questions 发布版本 release-20260830 单向同步生成。"
        ),
        "review_status": cloud["review_status"],
        "valid_from": "2026-08-30",
        "valid_until": None,
        "duplicate_group": None,
        "content_version": cloud["content_version"],
        "created_at": "2026-08-30T12:00:00+00:00",
        "updated_at": "2026-08-30T12:00:00+00:00",
    }
    row.update(changes)
    return Question.model_validate(row)


def plan(documents, locals_, dependencies):
    catalog, taxonomy, sources = dependencies
    return plan_inspector_cloud_sync(
        documents, locals_, catalog, taxonomy, sources, "release-20260830", RELEASE_AT
    )


def test_repeat_sync_deduplicates_same_runtime_question(dependencies):
    cloud = cloud_question()
    result = plan([cloud], [local_question(cloud)], dependencies)

    assert result.synced == ()
    assert result.deduplicated == ("QI-L5-000001",)
    assert result.merged_questions == (local_question(cloud),)


def test_cloud_source_note_is_preserved_and_missing_note_gets_auditable_fallback(dependencies):
    preserved = plan([cloud_question(source_note="云端可审计说明")], [], dependencies)
    missing_note = cloud_question(id="QI-L5-000002", question_id="QI-L5-000002")
    missing_note.pop("source_note", None)
    fallback = plan([missing_note], [], dependencies)

    assert preserved.synced[0].source_note == "云端可审计说明"
    assert fallback.synced[0].source_note == "云端 question_bank_questions 发布版本 release-20260830 单向同步生成。"


@pytest.mark.parametrize("field,value", [("occupation", "4-02-06-01"), ("level", 6)])
def test_invalid_occupation_or_level_blocks_sync(field, value, dependencies):
    with pytest.raises(CloudSyncValidationError):
        plan([cloud_question(**{field: value})], [], dependencies)


@pytest.mark.parametrize("level", [2, 1])
def test_l2_and_l1_are_published(level, dependencies):
    result = plan([cloud_question(id=f"QI-L{level}-000001", question_id=f"QI-L{level}-000001", level=level)], [], dependencies)

    assert [question.id for question in result.synced] == [f"QI-L{level}-000001"]
    assert result.skipped == ()


@pytest.mark.parametrize(
    "field,value",
    [("chapter_id", "wrong-chapter"), ("module", "错误模块")],
)
def test_bad_catalog_or_taxonomy_blocks_sync(field, value, dependencies):
    with pytest.raises(CloudSyncValidationError):
        plan([cloud_question(**{field: value})], [], dependencies)


def test_same_id_changed_answer_is_a_conflict(dependencies):
    cloud = cloud_question()
    local = local_question(cloud, answer=["B"])

    result = plan([cloud], [local], dependencies)

    assert result.has_conflicts
    assert result.conflicts[0].kind == "id_content_mismatch"
    assert result.merged_questions == (local,)


def test_different_ids_same_fingerprint_with_changed_answer_is_a_conflict(dependencies):
    cloud = cloud_question(id="QI-L5-000002", question_id="QI-L5-000002")
    local = local_question(cloud_question(), answer=["B"])

    result = plan([cloud], [local], dependencies)

    assert result.has_conflicts
    assert result.conflicts[0].kind == "fingerprint_content_mismatch"
    assert result.merged_questions == (local,)


def test_missing_ids_are_deterministically_allocated_and_existing_warehouse_is_unchanged(dependencies):
    warehouse = Question.model_validate({
        **local_question(cloud_question()).model_dump(mode="json"),
        "id": "WH-L5-000001",
        "occupation_code": "4-02-06-01",
        "occupation_name": "粮油仓储管理员",
    })
    first = cloud_question(id=None, question_id=None, stem="B 题干")
    second = cloud_question(id=None, question_id=None, stem="A 题干")

    result = plan([first, second], [warehouse], dependencies)

    assert result.generated_ids == ("QI-L5-000001", "QI-L5-000002")
    assert [item.stem for item in result.synced] == ["A 题干", "B 题干"]
    assert warehouse == local_question(cloud_question()).model_copy(update={
        "id": "WH-L5-000001", "occupation_code": "4-02-06-01", "occupation_name": "粮油仓储管理员"
    })
    assert all("release-20260830" in item.source_note for item in result.synced)
    assert all(item.created_at == RELEASE_AT and item.valid_from == RELEASE_AT.date() for item in result.synced)


def test_missing_id_reuses_the_existing_fingerprint_id_on_repeat_sync(dependencies):
    cloud = cloud_question(id=None, question_id=None)

    first = plan([cloud], [], dependencies)
    second = plan([cloud], list(first.merged_questions), dependencies)

    assert first.generated_ids == ("QI-L5-000001",)
    assert second.synced == ()
    assert second.generated_ids == ()
    assert second.deduplicated == ("QI-L5-000001",)
    assert second.merged_questions == first.merged_questions


def test_question_id_must_match_id_and_pending_review_blocks_sync(dependencies):
    with pytest.raises(CloudSyncValidationError):
        plan([cloud_question(question_id="QI-L5-000002")], [], dependencies)
    with pytest.raises(CloudSyncValidationError):
        plan([cloud_question(review_status="pending")], [], dependencies)


def test_generated_ids_reserve_every_explicit_cloud_id(dependencies):
    explicit = cloud_question()
    missing = cloud_question(id=None, question_id=None, stem="无稳定 ID 的另一道题")

    result = plan([missing, explicit], [], dependencies)

    assert result.generated_ids == ("QI-L5-000002",)
    assert [item.id for item in result.merged_questions] == [
        "QI-L5-000001",
        "QI-L5-000002",
    ]


def test_batch_duplicate_explicit_id_with_different_content_blocks_the_entire_plan(dependencies):
    first = cloud_question()
    second = cloud_question(stem="同一云端 ID 的另一道题")

    with pytest.raises(CloudSyncValidationError, match="conflicting content"):
        plan([first, second], [], dependencies)


def test_batch_duplicate_explicit_id_with_identical_content_is_deduplicated(dependencies):
    result = plan([cloud_question(), cloud_question()], [], dependencies)

    assert [item.id for item in result.synced] == ["QI-L5-000001"]
    assert result.conflicts == ()
    assert result.deduplicated == ("QI-L5-000001",)
