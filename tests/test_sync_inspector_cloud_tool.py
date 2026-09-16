from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _load_tool():
    path = ROOT / "tools" / "sync_inspector_cloud.py"
    spec = importlib.util.spec_from_file_location("sync_inspector_cloud", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load sync tool at {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


TOOL = _load_tool()


def cloud_question(level: int = 5, **changes):
    imported_level = level in {1, 2}
    row = {
        "id": f"QI-L{level}-000001",
        "question_id": f"QI-L{level}-000001",
        "occupation": "4-08-05-01",
        "direction": "粮油质量检验员",
        "level": level,
        "module": "质检员综合理论" if imported_level else "粮油检验基础",
        "topic": "质检员综合理论" if imported_level else "粮油检验方法",
        "chapter_id": "inspector-import-c01" if imported_level else "inspector-basic-c04",
        "section_id": "inspector-import-c01-s01" if imported_level else "inspector-basic-c04-s03",
        "type": "single",
        "stem": f"云端 L{level} 题干",
        "options": [{"key": key, "text": f"选项 {key}"} for key in "ABCD"],
        "answer": ["A"],
        "explanation": "云端解析",
        "difficulty": "easy",
        "keywords": ["扦样"],
        "source_ids": ["SRC-0002"],
        "standard_reference": "检验员职业技能标准",
        "source_note": "云端说明",
        "review_status": "verified",
        "content_version": 1,
    }
    row.update(changes)
    return row


def fixture_documents(questions):
    counts = {f"inspector_l{level}": sum(item["level"] == level for item in questions) for level in range(1, 6)}
    return {
        "config": {"_id": "active", "active_release_id": "qb-test", "schema_version": 1},
        "release": {
            "_id": "qb-test",
            "status": "active",
            "question_count": sum(counts.values()),
            "shard_counts": counts,
            "activated_at": "2026-08-30T12:00:00+00:00",
        },
        "questions": questions,
    }


def project_root(tmp_path: Path, existing_inspector_levels=(5, 4, 3, 2, 1)) -> Path:
    data = tmp_path / "data"
    data.mkdir()
    for name in ("knowledge_catalog.json", "taxonomy.json", "sources.json"):
        shutil.copy2(ROOT / "data" / name, data / name)
    catalog_path = data / "knowledge_catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    inspector_parts = catalog["occupations"]["4-08-05-01"]["parts"]
    next(part for part in inspector_parts if part["id"] == "inspector-import")["levels"] = [5, 4, 3, 2, 1]
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False), encoding="utf-8")
    taxonomy_path = data / "taxonomy.json"
    taxonomy = json.loads(taxonomy_path.read_text(encoding="utf-8"))
    inspector_levels = taxonomy["occupations"]["4-08-05-01"]["levels"]
    inspector_levels["2"] = {"modules": {"质检员综合理论": ["质检员综合理论"]}}
    inspector_levels["1"] = {"modules": {"质检员综合理论": ["质检员综合理论"]}}
    taxonomy_path.write_text(json.dumps(taxonomy, ensure_ascii=False), encoding="utf-8")
    questions = data / "questions"
    questions.mkdir()
    for level in existing_inspector_levels:
        (questions / f"inspector_l{level}.jsonl").write_text("", encoding="utf-8")
    return tmp_path


def test_fixture_sync_writes_only_inspector_shards_and_auditable_report(tmp_path: Path):
    root = project_root(tmp_path)
    warehouse = root / "data" / "questions" / "warehouse_l5.jsonl"
    warehouse.write_text(
        (ROOT / "data" / "questions" / "warehouse_l5.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
        + "\n",
        encoding="utf-8",
    )
    warehouse_before = warehouse.read_bytes()
    fixture = fixture_documents([cloud_question(5), cloud_question(4), cloud_question(3), cloud_question(2), cloud_question(1)])

    result = TOOL.sync_fixture(root, fixture)

    assert result["synced"] == 5
    assert result["skipped"] == 0
    assert result["skipped_unpublished"] == 0
    assert result["cloud_level_counts"] == {"L5": 1, "L4": 1, "L3": 1, "L2": 1, "L1": 1}
    assert result["before_local_level_counts"] == {"L5": 0, "L4": 0, "L3": 0, "L2": 0, "L1": 0}
    assert result["after_local_level_counts"] == {"L5": 1, "L4": 1, "L3": 1, "L2": 1, "L1": 1}
    assert warehouse.read_bytes() == warehouse_before
    assert [json.loads(line)["id"] for line in (root / "data" / "questions" / "inspector_l5.jsonl").read_text(encoding="utf-8").splitlines()] == ["QI-L5-000001"]
    report = json.loads((root / "data" / "inspector_cloud_sync_report.json").read_text(encoding="utf-8"))
    assert report["release_id"] == "qb-test"
    assert report["synced"] == 5


def test_sync_bootstraps_only_missing_l2_and_l1_shards(tmp_path: Path):
    root = project_root(tmp_path, existing_inspector_levels=(5, 4, 3))
    warehouse = root / "data" / "questions" / "warehouse_l5.jsonl"
    warehouse.write_text(
        (ROOT / "data" / "questions" / "warehouse_l5.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()[0]
        + "\n",
        encoding="utf-8",
    )
    warehouse_before = warehouse.read_bytes()

    result = TOOL.sync_fixture(root, fixture_documents([cloud_question(2), cloud_question(1)]))

    assert result["synced"] == 2
    assert result["before_local_level_counts"] == {"L5": 0, "L4": 0, "L3": 0, "L2": 0, "L1": 0}
    assert result["after_local_level_counts"] == {"L5": 0, "L4": 0, "L3": 0, "L2": 1, "L1": 1}
    assert (root / "data" / "questions" / "inspector_l2.jsonl").exists()
    assert (root / "data" / "questions" / "inspector_l1.jsonl").exists()
    assert warehouse.read_bytes() == warehouse_before


def test_sync_keeps_existing_l5_l4_l3_shards_mandatory(tmp_path: Path):
    root = project_root(tmp_path, existing_inspector_levels=(4, 3))

    with pytest.raises(TOOL.CloudReadError, match="missing local inspector shard"):
        TOOL.sync_fixture(root, fixture_documents([cloud_question(2), cloud_question(1)]))


def test_release_count_mismatch_aborts_without_changing_existing_files(tmp_path: Path):
    root = project_root(tmp_path)
    target = root / "data" / "questions" / "inspector_l5.jsonl"
    report = root / "data" / "inspector_cloud_sync_report.json"
    target.write_text("old-question\n", encoding="utf-8")
    report.write_text('{"old":true}\n', encoding="utf-8")
    fixture = fixture_documents([cloud_question(5)])
    fixture["release"]["question_count"] = 2

    with pytest.raises(TOOL.CloudReadError, match="question_count"):
        TOOL.sync_fixture(root, fixture)

    assert target.read_text(encoding="utf-8") == "old-question\n"
    assert report.read_text(encoding="utf-8") == '{"old":true}\n'


def test_repeating_the_same_sync_is_idempotent(tmp_path: Path):
    root = project_root(tmp_path)
    fixture = fixture_documents([cloud_question(level) for level in (5, 4, 3, 2, 1)])

    first = TOOL.sync_fixture(root, fixture)
    first_contents = {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    }
    second = TOOL.sync_fixture(root, fixture)

    assert first["synced"] == 5
    assert second["synced"] == 0
    assert second["deduplicated"] == 5
    assert {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    } == first_contents


def test_missing_ids_repeat_without_new_ids_or_shard_changes(tmp_path: Path):
    root = project_root(tmp_path)
    fixture = fixture_documents([
        cloud_question(level, id=None, question_id=None)
        for level in (5, 4, 3, 2, 1)
    ])

    first = TOOL.sync_fixture(root, fixture)
    first_shards = {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    }
    second = TOOL.sync_fixture(root, fixture)

    assert len(first["generated_ids"]) == 5
    assert second["synced"] == 0
    assert second["generated_ids"] == []
    assert second["deduplicated"] == 5
    assert second["after_local_level_counts"] == first["after_local_level_counts"]
    report = json.loads((root / "data" / "inspector_cloud_sync_report.json").read_text(encoding="utf-8"))
    assert report["generated_ids"] == []
    assert report["after_local_level_counts"] == first["after_local_level_counts"]
    assert {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    } == first_shards


def test_batch_duplicate_explicit_id_aborts_before_any_local_write(tmp_path: Path):
    root = project_root(tmp_path)
    report = root / "data" / "inspector_cloud_sync_report.json"
    report.write_text('{"old":true}\n', encoding="utf-8")
    before = {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    }
    first = cloud_question(5)
    second = cloud_question(5, stem="同一云端 ID 的另一道题")

    with pytest.raises(TOOL.CloudSyncValidationError, match="conflicting content"):
        TOOL.sync_fixture(root, fixture_documents([first, second, cloud_question(4)]))

    assert {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    } == before
    assert report.read_text(encoding="utf-8") == '{"old":true}\n'


def test_existing_validation_rejects_inactive_cloud_source_before_writing(tmp_path: Path):
    root = project_root(tmp_path)
    sources_path = root / "data" / "sources.json"
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    next(item for item in sources if item["id"] == "SRC-0002")["is_active"] = False
    sources_path.write_text(json.dumps(sources, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(TOOL.CloudReadError, match="inactive_source"):
        TOOL.sync_fixture(root, fixture_documents([cloud_question(5)]))

    assert (root / "data" / "questions" / "inspector_l5.jsonl").read_text(
        encoding="utf-8"
    ) == ""


def test_existing_validation_rejects_non_knowledge_basis_source_before_writing(tmp_path: Path):
    root = project_root(tmp_path)
    sources_path = root / "data" / "sources.json"
    sources = json.loads(sources_path.read_text(encoding="utf-8"))
    next(item for item in sources if item["id"] == "SRC-0002")["usage"] = "public_sample"
    sources_path.write_text(json.dumps(sources, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(TOOL.CloudReadError, match="invalid_source_usage"):
        TOOL.sync_fixture(root, fixture_documents([cloud_question(5)]))

    assert (root / "data" / "questions" / "inspector_l5.jsonl").read_text(
        encoding="utf-8"
    ) == ""


def test_existing_validation_rejects_normalized_exact_duplicate_before_writing(tmp_path: Path):
    root = project_root(tmp_path)
    first = cloud_question(5, stem="云端 L5 题干。")
    second = cloud_question(
        5,
        id="QI-L5-000002",
        question_id="QI-L5-000002",
        stem="云端L5题干",
        options=list(reversed(first["options"])),
    )

    with pytest.raises(TOOL.CloudReadError, match="exact_duplicate"):
        TOOL.sync_fixture(root, fixture_documents([first, second]))

    assert (root / "data" / "questions" / "inspector_l5.jsonl").read_text(
        encoding="utf-8"
    ) == ""


def test_atomic_commit_rolls_back_when_a_later_replacement_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    root = project_root(tmp_path)
    report = root / "data" / "inspector_cloud_sync_report.json"
    report.write_text('{"old":true}\n', encoding="utf-8")
    before = {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    }
    original_replace = TOOL._replace_staged
    replacements = 0

    def fail_second_replacement(source: Path, target: Path):
        nonlocal replacements
        replacements += 1
        if replacements == 2:
            raise OSError("injected replacement failure")
        original_replace(source, target)

    monkeypatch.setattr(TOOL, "_replace_staged", fail_second_replacement)

    with pytest.raises(OSError, match="injected replacement failure"):
        TOOL.sync_fixture(
            root,
            fixture_documents([cloud_question(level) for level in (5, 4, 3, 2, 1)]),
        )

    assert {
        level: (root / "data" / "questions" / f"inspector_l{level}.jsonl").read_bytes()
        for level in (5, 4, 3, 2, 1)
    } == before
    assert report.read_text(encoding="utf-8") == '{"old":true}\n'


def test_reader_rejects_wrong_target_and_uses_only_read_only_wechatide_commands():
    commands = []
    expected_appid = "wx84ecacec08ca162c"

    def runner(command):
        commands.append(command)
        query_path = Path(command[command.index("--query-file") + 1])
        assert json.loads(query_path.read_text(encoding="utf-8")) == {"_id": "active"}
        return '[wechatide] skill-call\n' + json.dumps({
            "ok": True,
            "result": {
                "success": True,
                "data": [{"_id": "active", "active_release_id": "qb-test"}],
                "total": 1,
            },
        })

    reader = TOOL.WechatIdeCloudReader(runner)
    assert reader.get_config()["active_release_id"] == "qb-test"
    assert all(command[3] == "cloud_db_read_doc" for command in commands)
    assert all(command[command.index("--appid") + 1] == expected_appid for command in commands)
    assert all("--collection-name" in command and "--query-file" in command for command in commands)
    assert all("cloud_db_collection_list" not in command for command in commands)
    with pytest.raises(TOOL.CloudReadError, match="appid"):
        TOOL.WechatIdeCloudReader(runner, appid="wrong")
    with pytest.raises(TOOL.CloudReadError, match="environment"):
        TOOL.WechatIdeCloudReader(runner, env_id="wrong")


def test_wechat_reader_paginates_question_collection_reads():
    calls = []

    def runner(command):
        calls.append(command)
        query_path = Path(command[command.index("--query-file") + 1])
        assert json.loads(query_path.read_text(encoding="utf-8")) == {
            "release_id": "qb-test", "occupation": "4-08-05-01", "level": 5,
        }
        offset = int(command[command.index("--offset") + 1])
        rows = [{"page": index} for index in range(offset, min(offset + 1000, 1001))]
        return json.dumps({
            "ok": True,
            "result": {"success": True, "data": rows, "total": 1001},
        })

    rows = TOOL.WechatIdeCloudReader(runner).list_questions("qb-test", 5)

    assert len(rows) == 1001
    assert rows[0] == {"page": 0}
    assert rows[-1] == {"page": 1000}
    assert len(calls) == 2
    assert "--offset" in calls[0]
    assert all(command[3] == "cloud_db_read_doc" for command in calls)
    assert all("--sort-file" in command for command in calls)
    assert TOOL.WechatIdeCloudReader(runner).count_questions("qb-test", 5) == 1001
