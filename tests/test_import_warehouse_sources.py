from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.warehouse_classify import WarehouseClassifier, load_warehouse_rules

def _load_importer():
    path = Path(__file__).resolve().parents[1] / "tools" / "import_warehouse_sources.py"
    spec = importlib.util.spec_from_file_location("warehouse_importer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load importer at {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


IMPORTER = _load_importer()


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


def test_section_heading_is_not_imported_as_a_question_and_keeps_its_question_type():
    heading = "4.1 检查储粮温度 判断题 (共70题)"
    question = "1. 仓房屋顶外表面喷涂反光材料，可以降低太阳辐射对仓内温度的影响。 A.正确 B.错误 答案：A"

    blocks = IMPORTER._parse_blocks([heading, question])

    assert blocks == [(heading, [question])]


def test_inline_true_false_options_are_imported_as_a_judgement_question():
    heading = "4.1 检查储粮温度 判断题 (共70题)"
    question = "1. 仓房屋顶外表面喷涂反光材料，可以降低太阳辐射对仓内温度的影响。 A.正确 B.错误 答案：A"

    parsed, reason = IMPORTER._parse_block(heading, [question])

    assert reason is None
    assert parsed is not None
    assert parsed["type"] == "judge"
    assert parsed["answer"] == ["A"]
    assert parsed["options"] == [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]


def test_true_false_options_are_imported_as_a_judgement_question_without_a_heading():
    question = "2. 在仓房屋顶外表面喷涂反光材料，可以降低太阳辐射对仓内温度的影响。 A.正确 B.错误 答案：A"

    parsed, reason = IMPORTER._parse_block("综合理论", [question])

    assert reason is None
    assert parsed is not None
    assert parsed["type"] == "judge"
    assert parsed["options"] == [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]


def test_decimal_section_heading_is_not_imported_as_a_question():
    heading = "3.1 粮油出入库准备"
    question = "1. 粮食入库前应检查仓房。 A.正确 B.错误 答案：A"

    blocks = IMPORTER._parse_blocks([heading, question])

    assert blocks == [(heading, [question])]


def test_answer_key_lines_are_not_imported_as_questions_and_can_supply_answers():
    question = "1、储备粮专卡中要求填写一式四份，（ ）储粮单位、保管员、上级主管部门各一份。 A、每货位挂一份 B、每粮库挂一份 C、计划部门一份 D、管理部门一份"
    answer_key = "1.A 2.B"

    blocks = IMPORTER._parse_blocks([question, answer_key])
    parsed, reason = IMPORTER._parse_block("选择题", blocks[0][1], answer_override=["A"])

    assert blocks == [("综合理论", [question])]
    assert IMPORTER._collect_answer_key_overrides([answer_key]) == {1: ["A"], 2: ["B"]}
    assert reason is None
    assert parsed is not None
    assert parsed["answer"] == ["A"]


def test_parenthesized_answer_and_inline_options_are_imported():
    question = "1、引起结露的主要条件是温差，并达到（ C ）。"
    options = "A、温度 B、湿度 C、露点 D、结点"

    parsed, reason = IMPORTER._parse_block("选择题", [question, options])

    assert reason is None
    assert parsed is not None
    assert parsed["answer"] == ["C"]
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D"]


def test_inline_options_allow_a_missing_option_label_punctuation_mark():
    question = "3、储备粮专卡中，储备性质分中央储备粮、省级储备、地方储备、（ ）临时储备等。 A、备荒储备 B、军队储备 C。战争储备 D特种储备"

    parsed, reason = IMPORTER._parse_block("选择题", [question], answer_override=["D"])

    assert reason is None
    assert parsed is not None
    assert parsed["answer"] == ["D"]
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D"]


def test_inline_option_parser_keeps_technical_e2_notation_inside_option_text():
    question = "1. 关于单位能耗要求，下列说法中正确的是（ ）。"
    options = "A.玉米降水: E2≤2.5 kW·h B.小麦降水: E2≤2.0 kW·h C.稻谷降水: E2≤2.5 kW·h D.大豆降水: E2≤2.0 kW·h"

    parsed, reason = IMPORTER._parse_block("选择题", [question, options], answer_override=["C"])

    assert reason is None
    assert parsed is not None
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D"]
    assert "E2≤2.5" in parsed["options"][0]["text"]


def test_inline_option_parser_preserves_an_a_class_stem_prefix():
    question = "1. A类火灾场所应选择（ ）。"
    options = "A.水型灭火器 B.泡沫灭火器 C.碳酸氢钠干粉灭火器 D.磷酸铵盐干粉灭火器 E.卤代烷灭火器"

    parsed, reason = IMPORTER._parse_block("多项选择题", [question, options], answer_override=["A", "B", "D", "E"])

    assert reason is None
    assert parsed is not None
    assert parsed["stem"].startswith("A类火灾场所")
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D", "E"]


def test_question_starts_embedded_in_one_source_paragraph_are_split():
    first = "8. 粮食储存是重要工作。 A.甲 B.乙 C.丙 D.丁"
    second = "9、对储粮害虫而言，无虫间隔期应超过一个世代的（ ）倍。 A、1 B、2 C、3 D、4"

    blocks = IMPORTER._parse_blocks([f"{first} {second}"])

    assert blocks == [("综合理论", [first]), ("综合理论", [second])]


def test_number_inside_an_explanation_is_not_split_into_a_question():
    explanation = (
        "\u89e3\u6790\uff1a\u4f7f\u7528\u9632\u62a4\u5242\u9632\u6cbb\u50a8\u7cae\u5bb3\u866b "
        "2.\u5c06\u9632\u62a4\u5242\u4e73\u6cb9\u52a0\u6c34\u7a00\u91ca\u3002"
        "\u7a00\u91ca\u540e\u7684\u603b\u836f\u91cf\u4e0d\u5e94\u8d85\u8fc7"
        "\u62cc\u548c\u7cae\u6cb9\u91cd\u91cf\u76840.1%\u3002"
    )
    question = "834. \u78f7\u5316\u94dd\u7247\u5242\u4e2d\u786c\u8102\u9178\u9541\u7684\u542b\u91cf\u4e3a( )\u3002"

    blocks = IMPORTER._parse_blocks([explanation, question])

    assert blocks == [("\u7efc\u5408\u7406\u8bba", [question])]


def test_question_without_punctuation_starts_a_new_block():
    first = "8\u3001\u7cae\u98df\u4ed3\u50a8\u4ece\u4e1a\u4eba\u5458\u7231\u5c97\u656c\u4e1a\uff0c\u7cbe\u76ca\u6c42\u7cbe\u7684\u57fa\u672c\u8981\u6c42\u662f\uff1a\uff08 \uff09"
    first_options = "A\u3001\u8981\u62e9\u4e1a B\u3001\u8981\u4e50\u4e1a C\u3001\u8981\u52e4\u4e1a D\u3001\u8981\u7cbe\u4e1a"
    second = "9\u5bf9\u50a8\u7cae\u5bb3\u866b\u800c\u8a00\uff0c\u65e0\u866b\u95f4\u9694\u671f\u5e94\u8d85\u8fc7\u4e00\u822c\u5bb3\u866b\u5b8c\u6210\u4e00\u4e2a\u4e16\u4ee3\u7684\u5386\u671f\u7684\uff08 \uff09\u500d"
    second_options = "A\u30011 B\u30012 C\u30013 D\u30014"

    blocks = IMPORTER._parse_blocks([first, first_options, second, second_options])

    assert blocks == [("\u7efc\u5408\u7406\u8bba", [first, first_options]), ("\u7efc\u5408\u7406\u8bba", [second, second_options])]


def test_question_fingerprint_ignores_formatting_only_variants():
    first = {
        "stem": "\u9898\u5e72\uff08 \uff09",
        "options": [{"key": "A", "text": "\u9009\u9879A."}, {"key": "B", "text": "\u9009\u9879B"}],
    }
    second = {
        "stem": "\u9898\u5e72",
        "options": [{"key": "A", "text": "\u9009\u9879A"}, {"key": "B", "text": "\u9009\u9879B"}],
    }

    assert IMPORTER._question_fingerprint(first) == IMPORTER._question_fingerprint(second)


def test_numeric_measurements_inside_a_paragraph_are_not_split_as_questions():
    line = "13. 关于通风隔热层材料要求，导热系数≤（ ）；7.1% 吸水率；0.85、0.65、0.50。"

    blocks = IMPORTER._parse_blocks([line])

    assert blocks == [("综合理论", [line])]


def test_numeric_measurement_line_is_not_imported_as_a_question():
    assert IMPORTER._parse_blocks(["7.1%", "0．85"]) == []


def test_standard_number_inside_question_is_not_split_as_a_new_question():
    line = "627. 粮油水分测量主要依据 GB 5009.3国家标准规定的方法进行测定。"

    blocks = IMPORTER._parse_blocks([line])

    assert blocks == [("综合理论", [line])]


def test_classification_preserves_baseline_ids_when_a_middle_question_is_pending():
    baseline = [
        _baseline_question("WH-L2-000001", "磷化氢环流熏蒸并检测浓度"),
        _baseline_question("WH-L2-000002", "无法从语义判断章节"),
        _baseline_question("WH-L2-000003", "编制保管员培训计划和教案"),
    ]
    result = IMPORTER.classify_baseline_records(
        baseline,
        classifier=_production_classifier(),
        catalog=load_knowledge_catalog(Path("data/knowledge_catalog.json")),
        effective_at="2026-08-07T18:00:00+08:00",
    )

    assert [item["id"] for item in result.published] == [
        "WH-L2-000001",
        "WH-L2-000003",
    ]
    assert [item["question_id"] for item in result.review] == ["WH-L2-000002"]


def test_classification_changes_only_allowed_metadata_fields():
    before = _baseline_question("WH-L2-000001", "磷化氢环流熏蒸并检测浓度")
    result = IMPORTER.classify_baseline_records(
        [before],
        classifier=_production_classifier(),
        catalog=load_knowledge_catalog(Path("data/knowledge_catalog.json")),
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


def test_pending_records_are_not_published_and_keep_top_three_candidates():
    result = IMPORTER.classify_baseline_records(
        [_baseline_question("WH-L2-000002", "无法从语义判断章节")],
        classifier=_production_classifier(),
        catalog=load_knowledge_catalog(Path("data/knowledge_catalog.json")),
        effective_at="2026-08-07T18:00:00+08:00",
    )

    assert result.published == []
    assert result.review[0]["reason"] in {"ambiguous", "low_score", "no_rule"}
    assert len(result.review[0]["candidates"]) <= 3


def test_generic_single_character_evidence_remains_pending():
    class PendingClassifier:
        def classify(self, **kwargs):
            from grain_quiz.warehouse_classify import ClassificationResult

            return ClassificationResult("pending", None, None, (), "no_rule")

    result = IMPORTER.classify_baseline_records(
        [_baseline_question("WH-L2-000009", "水")],
        classifier=PendingClassifier(),
        catalog=load_knowledge_catalog(Path("data/knowledge_catalog.json")),
        effective_at="2026-08-07T18:00:00+08:00",
    )

    assert result.published == []
    assert result.review[0]["reason"] == "no_rule"


def test_classified_record_preserves_immutable_baseline_fields():
    baseline = _baseline_question("WH-L2-000010", "磷化氢环流熏蒸并检测浓度")
    result = IMPORTER.classify_baseline_records(
        [baseline],
        classifier=_production_classifier(),
        catalog=load_knowledge_catalog(Path("data/knowledge_catalog.json")),
        effective_at="2026-08-07T18:00:00+08:00",
    )

    assert result.published
    for field in IMPORTER.IMMUTABLE_FIELDS:
        assert result.published[0][field] == baseline[field]


def _classification_result(*, published: int, pending: int):
    return SimpleNamespace(
        level=2,
        baseline_count=published + pending,
        published=[{"id": f"published-{index}"} for index in range(published)],
        review=[
            {"question_id": f"pending-{index}", "reason": "low_score"}
            for index in range(pending)
        ],
        audit=[],
    )


def test_output_files_are_unchanged_when_coverage_is_below_80_percent(tmp_path: Path):
    output_dir = tmp_path / "questions"
    output_dir.mkdir()
    target = output_dir / "warehouse_l2.jsonl"
    review = tmp_path / "review.jsonl"
    audit = tmp_path / "audit.jsonl"
    report = tmp_path / "report.json"
    manifest = tmp_path / "manifest.json"
    target.write_text("sentinel\n", encoding="utf-8")
    review.write_text("old-review\n", encoding="utf-8")
    audit.write_text("old-audit\n", encoding="utf-8")
    report.write_text('{"old":"report"}\n', encoding="utf-8")
    manifest.write_text('{"old":"manifest"}\n', encoding="utf-8")

    with pytest.raises(IMPORTER.ClassificationCoverageError, match="80%"):
        IMPORTER.write_classification_outputs(
            results={2: _classification_result(published=1, pending=4)},
            output_dir=output_dir,
            review_path=review,
            audit_path=audit,
            report_path=report,
            manifest_path=manifest,
            minimum_coverage=0.80,
        )

    assert target.read_text(encoding="utf-8") == "sentinel\n"
    assert review.read_text(encoding="utf-8") == "old-review\n"
    assert audit.read_text(encoding="utf-8") == "old-audit\n"
    assert report.read_text(encoding="utf-8") == '{"old":"report"}\n'
    assert manifest.read_text(encoding="utf-8") == '{"old":"manifest"}\n'


def test_output_rolls_back_all_artifacts_when_report_replace_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    output_dir = tmp_path / "questions"
    output_dir.mkdir()
    target = output_dir / "warehouse_l2.jsonl"
    manifest = tmp_path / "manifest.json"
    review = tmp_path / "review.jsonl"
    audit = tmp_path / "audit.jsonl"
    report = tmp_path / "report.json"
    target.write_text("old-question\n", encoding="utf-8")
    manifest.write_text('{"old":true}\n', encoding="utf-8")
    review.write_text("old-review\n", encoding="utf-8")
    audit.write_text("old-audit\n", encoding="utf-8")
    report.write_text('{"old":"report"}\n', encoding="utf-8")
    original_replace = IMPORTER._replace_staged

    def fail_report(source: Path, destination: Path) -> None:
        if destination == report:
            raise OSError("simulated report replacement failure")
        original_replace(source, destination)

    monkeypatch.setattr(IMPORTER, "_replace_staged", fail_report)

    with pytest.raises(OSError, match="report replacement"):
        IMPORTER.write_classification_outputs(
            results={2: _classification_result(published=2, pending=0)},
            output_dir=output_dir,
            review_path=review,
            audit_path=audit,
            report_path=report,
            manifest_path=manifest,
            minimum_coverage=0.80,
        )

    assert target.read_text(encoding="utf-8") == "old-question\n"
    assert manifest.read_text(encoding="utf-8") == '{"old":true}\n'
    assert review.read_text(encoding="utf-8") == "old-review\n"
    assert audit.read_text(encoding="utf-8") == "old-audit\n"
    assert report.read_text(encoding="utf-8") == '{"old":"report"}\n'


def test_output_files_are_unchanged_when_backup_creation_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    output_dir = tmp_path / "questions"
    output_dir.mkdir()
    target = output_dir / "warehouse_l2.jsonl"
    manifest = tmp_path / "manifest.json"
    review = tmp_path / "review.jsonl"
    audit = tmp_path / "audit.jsonl"
    report = tmp_path / "report.json"
    targets = {
        target: "old-question\n",
        manifest: '{"old":true}\n',
        review: "old-review\n",
        audit: "old-audit\n",
        report: '{"old":"report"}\n',
    }
    for path, contents in targets.items():
        path.write_text(contents, encoding="utf-8")

    original_copy2 = IMPORTER.shutil.copy2
    copy_count = 0

    def fail_third_backup(source: Path, destination: Path):
        nonlocal copy_count
        copy_count += 1
        if copy_count == 3:
            raise OSError("simulated backup failure")
        return original_copy2(source, destination)

    monkeypatch.setattr(IMPORTER.shutil, "copy2", fail_third_backup)

    with pytest.raises(OSError, match="backup failure"):
        IMPORTER.write_classification_outputs(
            results={2: _classification_result(published=2, pending=0)},
            output_dir=output_dir,
            review_path=review,
            audit_path=audit,
            report_path=report,
            manifest_path=manifest,
            minimum_coverage=0.80,
        )

    assert copy_count == 3
    for path, contents in targets.items():
        assert path.read_text(encoding="utf-8") == contents
