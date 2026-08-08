import json
from pathlib import Path

import pytest

from grain_quiz.catalog import KnowledgeCatalog, load_knowledge_catalog
from grain_quiz.warehouse_classify import (
    WarehouseClassifier,
    WarehouseRule,
    WarehouseRuleSet,
    classify_warehouse_question,
    load_warehouse_rules,
)


CATALOG = load_knowledge_catalog(Path("data/knowledge_catalog.json"))
RULES_PATH = Path("tools/warehouse_classification_rules.json")


def _expected_rule_targets() -> set[tuple[int, str]]:
    targets: set[tuple[int, str]] = set()
    occupation = CATALOG.occupations["4-02-06-01"]
    for level in (5, 4, 3, 2, 1):
        for part in occupation.parts:
            if level not in part.levels:
                continue
            for chapter in part.chapters:
                for section in chapter.sections:
                    if not section.id.endswith("-s00"):
                        targets.add((level, section.id))
    return targets


def test_production_rules_cover_every_publishable_non_fallback_section() -> None:
    rules = load_warehouse_rules(RULES_PATH, CATALOG)

    assert {(rule.level, rule.section_id) for rule in rules.rules} == _expected_rule_targets()
    assert len(rules.rules) == 92


REPRESENTATIVE_ADVANCED_CASES = (
    (2, "warehouse-l2-c01-s01", "粮食入库前应制定接收方案并检查仓房、输送设备和计量器具"),
    (2, "warehouse-l2-c02-s01", "使用气体检测仪测定粮堆氧气和二氧化碳浓度"),
    (2, "warehouse-l2-c02-s02", "通过取样筛检识别玉米象虫态并统计虫口密度"),
    (2, "warehouse-l2-c02-s03", "检测脂肪酸值和品尝评分以判定粮油储藏品质"),
    (2, "warehouse-l2-c02-s04", "粮堆发热伴随霉菌活动时应分析霉变原因"),
    (2, "warehouse-l2-c03-s01", "根据粮温变化制定机械通风降温措施"),
    (2, "warehouse-l2-c03-s02", "对高水分粮实施通风降水和水分控制"),
    (2, "warehouse-l2-c03-s03", "采用充氮气调控制粮堆氧气浓度"),
    (2, "warehouse-l2-c03-s04", "制定磷化氢环流熏蒸方案并控制剂量和散气"),
    (2, "warehouse-l2-c03-s05", "对发热霉变粮进行倒仓通风和局部处理"),
    (2, "warehouse-l2-c03-s06", "计算储粮损耗能耗和保管费用并分析储粮效益"),
    (2, "warehouse-l2-c04-s01", "编制保管员培训计划教案并组织理论授课"),
    (2, "warehouse-l2-c04-s02", "现场指导初级人员操作通风设备并纠正错误"),
    (2, "warehouse-l2-c04-s03", "撰写粮食仓储专业技术报告并形成摘要数据和结论"),
    (1, "warehouse-l1-c01-s01", "制定大型粮库粮油出入库作业组织方案和应急预案"),
    (1, "warehouse-l1-c02-s01", "分析储粮害虫抗药性虫种虫态和虫口密度"),
    (1, "warehouse-l1-c02-s02", "综合脂肪酸值降落数值和品尝评分判定储藏品质"),
    (1, "warehouse-l1-c03-s01", "优化粮温控制和机械通风降温运行参数"),
    (1, "warehouse-l1-c03-s02", "制定高水分粮水分控制和安全降水方案"),
    (1, "warehouse-l1-c03-s03", "设计储粮害虫综合治理和抗药性防治方案"),
    (1, "warehouse-l1-c03-s04", "依据储存品质指标确定轮换时机和处置措施"),
    (1, "warehouse-l1-c04-s01", "设计谷物冷却机低温储粮工艺和冷源参数"),
    (1, "warehouse-l1-c04-s02", "设计增湿调质通风工艺并计算通风量"),
    (1, "warehouse-l1-c04-s03", "设计氮气气调储粮系统并计算气密性和耗氮量"),
    (1, "warehouse-l1-c04-s04", "比较低温气调工艺投资运行费用和储粮效益"),
    (1, "warehouse-l1-c05-s01", "建立高级保管员培训体系课程计划和考核标准"),
    (1, "warehouse-l1-c05-s02", "指导技师解决复杂粮情控制问题并评价操作质量"),
    (1, "warehouse-l1-c05-s03", "组织撰写仓储专业技术报告和技术成果总结"),
)


@pytest.mark.parametrize("level,section_id,stem", REPRESENTATIVE_ADVANCED_CASES)
def test_production_rules_classify_every_l2_l1_section(level: int, section_id: str, stem: str) -> None:
    result = classify_warehouse_question(level=level, stem=stem, options=(), explanation="")

    assert result.status == "section"
    assert result.section_id == section_id


REPRESENTATIVE_EXISTING_CASES = (
    (5, "warehouse-basic-c01-s01", "诚实守信爱岗敬业是职业道德基本规范"),
    (4, "warehouse-basic-c02-s03", "安全生产法和粮食流通管理条例属于相关法律法规"),
    (5, "warehouse-l5-c03-s01", "入库前检查仓房清洁卫生和输送设备"),
    (4, "warehouse-l4-c07-s04", "取样筛检储粮害虫并识别虫态"),
    (3, "warehouse-l3-c11-s04", "磷化氢熏蒸防治储粮害虫并检测浓度"),
    (3, "warehouse-l3-c11-s01", "根据粮温变化实施机械通风降温"),
)


@pytest.mark.parametrize("level,section_id,stem", REPRESENTATIVE_EXISTING_CASES)
def test_production_rules_classify_existing_and_shared_cases(level: int, section_id: str, stem: str) -> None:
    result = classify_warehouse_question(level=level, stem=stem, options=(), explanation="")

    assert result.status == "section"
    assert result.section_id == section_id


@pytest.fixture
def catalog_with_l2_seed(tmp_path: Path) -> KnowledgeCatalog:
    catalog = load_knowledge_catalog(Path("data/knowledge_catalog.json"))
    if catalog.allows(
        "4-02-06-01",
        2,
        "warehouse-l2-c03",
        "warehouse-l2-c03-s04",
    ):
        return catalog

    document = catalog.runtime_document()
    document["occupations"]["4-02-06-01"]["parts"].append(
        {
            "id": "warehouse-l2-test",
            "number": 100,
            "title": "技师测试目录",
            "levels": [2],
            "chapters": [
                {
                    "id": "warehouse-l2-c03",
                    "number": 3,
                    "title": "粮情控制",
                    "page": None,
                    "sections": [
                        {
                            "id": "warehouse-l2-c03-s04",
                            "number": 4,
                            "title": "储粮害虫",
                            "page": None,
                        }
                    ],
                }
            ],
        }
    )
    path = tmp_path / "knowledge_catalog_with_l2_seed.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return load_knowledge_catalog(path)


def _rule(**overrides: object) -> dict[str, object]:
    rule: dict[str, object] = {
        "level": 3,
        "chapter_id": "warehouse-l3-c11",
        "section_id": "warehouse-l3-c11-s04",
        "strong_phrases": ["储粮害虫防治"],
        "keywords": ["害虫"],
        "context_terms": ["密闭"],
        "exclude_terms": ["虫态检查"],
    }
    rule.update(overrides)
    return rule


def _document(*rules: dict[str, object]) -> dict[str, object]:
    return {
        "version": "2026-08-07.1",
        "field_weights": {"stem": 3, "options": 1, "explanation": 2},
        "term_weights": {
            "strong_phrases": 4,
            "keywords": 2,
            "context_terms": 1,
            "exclude_terms": -4,
        },
        "thresholds": {
            "section_score": 12,
            "section_margin": 4,
            "chapter_score": 9,
            "chapter_margin": 3,
            "basic_lead": 4,
        },
        "rules": list(rules),
    }


def _write_rules(tmp_path: Path, document: dict[str, object]) -> Path:
    path = tmp_path / "warehouse_classification_rules.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return path


def test_valid_fixed_contract_loads(tmp_path: Path) -> None:
    rules = load_warehouse_rules(
        _write_rules(tmp_path, _document(_rule())),
        CATALOG,
    )

    assert rules.version == "2026-08-07.1"
    assert (rules.stem_weight, rules.options_weight, rules.explanation_weight) == (3, 1, 2)
    assert (
        rules.strong_phrase_weight,
        rules.keyword_weight,
        rules.context_term_weight,
        rules.exclude_term_weight,
    ) == (4, 2, 1, -4)
    assert (rules.section_score, rules.section_margin, rules.chapter_score, rules.chapter_margin, rules.basic_lead) == (12, 4, 9, 3, 4)
    assert rules.rules[0].strong_phrases == ("储粮害虫防治",)


def test_checked_in_l2_rules_artifact_loads_in_target_catalog(
    catalog_with_l2_seed: KnowledgeCatalog,
) -> None:
    rules = load_warehouse_rules(RULES_PATH, catalog_with_l2_seed)

    assert rules.version == "2026-08-07.1"
    target = next(
        rule
        for rule in rules.rules
        if rule.level == 2 and rule.section_id == "warehouse-l2-c03-s04"
    )
    assert target.chapter_id == "warehouse-l2-c03"


def test_duplicate_level_and_section_is_rejected(tmp_path: Path) -> None:
    path = _write_rules(tmp_path, _document(_rule(), _rule()))

    with pytest.raises(ValueError, match="duplicate warehouse rule"):
        load_warehouse_rules(path, CATALOG)


def test_s00_is_rejected_before_catalog_validation(tmp_path: Path) -> None:
    path = _write_rules(
        tmp_path,
        _document(_rule(section_id="warehouse-l3-c11-s00")),
    )

    with pytest.raises(ValueError, match="s00"):
        load_warehouse_rules(path, CATALOG)


def test_catalog_path_not_allowed_for_rule_level_is_rejected(tmp_path: Path) -> None:
    path = _write_rules(tmp_path, _document(_rule(level=2)))

    with pytest.raises(ValueError, match="not allowed by catalog"):
        load_warehouse_rules(path, CATALOG)


@pytest.mark.parametrize(
    ("mapping", "key", "value"),
    [
        ("field_weights", "stem", True),
        ("term_weights", "keywords", True),
        ("thresholds", "basic_lead", True),
    ],
)
def test_bool_values_are_not_accepted_as_integers(
    tmp_path: Path,
    mapping: str,
    key: str,
    value: object,
) -> None:
    document = _document(_rule())
    document[mapping][key] = value  # type: ignore[index]

    with pytest.raises(ValueError, match="must be an integer"):
        load_warehouse_rules(_write_rules(tmp_path, document), CATALOG)


@pytest.mark.parametrize(
    ("mapping", "key", "value", "message"),
    [
        ("field_weights", "stem", 0, "positive"),
        ("field_weights", "stem", -1, "positive"),
        ("term_weights", "strong_phrases", 0, "positive"),
        ("term_weights", "exclude_terms", 0, "negative"),
        ("term_weights", "exclude_terms", 1, "negative"),
        ("thresholds", "section_score", 0, "positive"),
    ],
)
def test_weight_and_threshold_signs_are_strict(
    tmp_path: Path,
    mapping: str,
    key: str,
    value: int,
    message: str,
) -> None:
    document = _document(_rule())
    document[mapping][key] = value  # type: ignore[index]

    with pytest.raises(ValueError, match=message):
        load_warehouse_rules(_write_rules(tmp_path, document), CATALOG)


def test_blank_terms_are_rejected(tmp_path: Path) -> None:
    path = _write_rules(tmp_path, _document(_rule(strong_phrases=["  "])))

    with pytest.raises(ValueError, match="non-blank string"):
        load_warehouse_rules(path, CATALOG)


def test_normalized_duplicate_terms_report_the_term(tmp_path: Path) -> None:
    path = _write_rules(
        tmp_path,
        _document(_rule(keywords=[" 害虫 ", "害虫"])),
    )

    with pytest.raises(ValueError, match=r"duplicate term.*害虫"):
        load_warehouse_rules(path, CATALOG)


def test_unknown_level_is_rejected(tmp_path: Path) -> None:
    path = _write_rules(tmp_path, _document(_rule(level=6)))

    with pytest.raises(ValueError, match="level"):
        load_warehouse_rules(path, CATALOG)


def test_bool_level_is_rejected(tmp_path: Path) -> None:
    path = _write_rules(tmp_path, _document(_rule(level=True)))

    with pytest.raises(ValueError, match="level"):
        load_warehouse_rules(path, CATALOG)


@pytest.mark.parametrize(
    ("mapping", "mutation", "message"),
    [
        (
            "field_weights",
            lambda value: value.pop("stem"),
            r"missing.*stem",
        ),
        (
            "term_weights",
            lambda value: value.__setitem__("unexpected", 1),
            r"unexpected.*unexpected",
        ),
    ],
)
def test_missing_or_extra_mapping_keys_are_reported(
    tmp_path: Path,
    mapping: str,
    mutation: object,
    message: str,
) -> None:
    document = _document(_rule())
    mutation_fn = mutation
    mutation_fn(document[mapping])  # type: ignore[operator,index]

    with pytest.raises(ValueError, match=message):
        load_warehouse_rules(_write_rules(tmp_path, document), CATALOG)


def test_missing_strong_phrases_and_keywords_are_rejected(tmp_path: Path) -> None:
    path = _write_rules(
        tmp_path,
        _document(_rule(strong_phrases=[], keywords=[])),
    )

    with pytest.raises(ValueError, match="strong_phrases or keywords"):
        load_warehouse_rules(path, CATALOG)


def _classification_rules(*rules: WarehouseRule) -> WarehouseRuleSet:
    return WarehouseRuleSet(
        version="2026-08-07.1",
        stem_weight=3,
        options_weight=1,
        explanation_weight=2,
        strong_phrase_weight=4,
        keyword_weight=2,
        context_term_weight=1,
        exclude_term_weight=-4,
        section_score=12,
        section_margin=4,
        chapter_score=9,
        chapter_margin=3,
        basic_lead=4,
        rules=rules,
    )


@pytest.fixture
def classifier() -> WarehouseClassifier:
    return WarehouseClassifier(
        _classification_rules(
            WarehouseRule(
                level=2,
                chapter_id="warehouse-l2-c03",
                section_id="warehouse-l2-c03-s04",
                strong_phrases=("磷化氢环流熏蒸",),
                keywords=("PH3环流熏蒸", "储粮害虫"),
                context_terms=("浓度", "散气", "密闭"),
                exclude_terms=("害虫识别", "虫态检查"),
            ),
            WarehouseRule(
                level=2,
                chapter_id="warehouse-l2-c02",
                section_id="warehouse-l2-c02-s02",
                strong_phrases=("害虫识别", "虫态检查"),
                keywords=("储粮害虫",),
                context_terms=("取样", "筛检"),
                exclude_terms=("熏蒸", "杀虫剂"),
            ),
            WarehouseRule(
                level=2,
                chapter_id="warehouse-l2-c03",
                section_id="warehouse-l2-c03-s01",
                strong_phrases=(),
                keywords=("粮温",),
                context_terms=("通风",),
                exclude_terms=(),
            ),
            WarehouseRule(
                level=2,
                chapter_id="warehouse-l2-c03",
                section_id="warehouse-l2-c03-s02",
                strong_phrases=(),
                keywords=("水分",),
                context_terms=(),
                exclude_terms=(),
            ),
        )
    )


@pytest.fixture
def basic_classifier() -> WarehouseClassifier:
    return WarehouseClassifier(
        _classification_rules(
            WarehouseRule(
                level=2,
                chapter_id="warehouse-basic-c02",
                section_id="warehouse-basic-c02-s03",
                strong_phrases=("安全操作", "安全生产责任制"),
                keywords=(),
                context_terms=("设备", "环境保护法律法规"),
                exclude_terms=(),
            ),
            WarehouseRule(
                level=2,
                chapter_id="warehouse-l2-c03",
                section_id="warehouse-l2-c03-s01",
                strong_phrases=("安全操作粮食通风设备",),
                keywords=(),
                context_terms=(),
                exclude_terms=(),
            ),
        )
    )


def test_classifier_normalizes_nfkc_and_weights_fields(
    classifier: WarehouseClassifier,
) -> None:
    result = classifier.classify(
        level=2,
        stem="采用ＰＨ３ 环 流 熏 蒸控制害虫",
        options=("应检查浓度", "完成后散气"),
        explanation="磷化氢环流熏蒸属于化学防治",
    )

    assert result.status == "section"
    assert result.chapter_id == "warehouse-l2-c03"
    assert result.section_id == "warehouse-l2-c03-s04"
    assert result.candidates[0].score == 16
    assert "磷化氢环流熏蒸" in result.candidates[0].matched_terms


def test_context_terms_do_not_score_without_a_primary_term(
    classifier: WarehouseClassifier,
) -> None:
    result = classifier.classify(
        level=2,
        stem="应控制浓度并按时散气",
        options=(),
        explanation="",
    )

    assert result.status == "pending"
    assert result.reason == "low_score"


def test_section_requires_score_12_and_margin_4(
    classifier: WarehouseClassifier,
) -> None:
    result = classifier.classify(
        level=2,
        stem="磷化氢环流熏蒸",
        options=(),
        explanation="",
    )

    assert result.status == "section"
    assert result.candidates[0].score == 12


def test_chapter_fallback_uses_s00_when_chapter_is_clear(
    classifier: WarehouseClassifier,
) -> None:
    result = classifier.classify(
        level=2,
        stem="粮温和水分需要综合控制",
        options=(),
        explanation="通风方案同时考虑温度与水分",
    )

    assert result.status == "chapter"
    assert result.chapter_id == "warehouse-l2-c03"
    assert result.section_id == "warehouse-l2-c03-s00"


def test_equal_top_candidates_are_pending(classifier: WarehouseClassifier) -> None:
    result = classifier.classify(
        level=2,
        stem="储粮害虫",
        options=(),
        explanation="",
    )

    assert result.status == "pending"
    assert result.reason == "ambiguous"


def test_unknown_level_is_pending(classifier: WarehouseClassifier) -> None:
    result = classifier.classify(
        level=9,
        stem="熏蒸",
        options=(),
        explanation="",
    )

    assert result.status == "pending"
    assert result.reason == "no_rule"


def test_basic_rule_must_lead_level_specific_rule_by_four_points(
    basic_classifier: WarehouseClassifier,
) -> None:
    specific = basic_classifier.classify(
        level=2,
        stem="安全操作粮食通风设备",
        options=(),
        explanation="",
    )
    basic = basic_classifier.classify(
        level=2,
        stem="安全生产责任制与环境保护法律法规",
        options=(),
        explanation="",
    )

    assert specific.chapter_id == "warehouse-l2-c03"
    assert basic.chapter_id == "warehouse-basic-c02"


def test_same_input_and_rule_version_are_deterministic(
    classifier: WarehouseClassifier,
) -> None:
    arguments = {
        "level": 2,
        "stem": "磷化氢环流熏蒸后检测浓度并散气",
        "options": ("保持密闭",),
        "explanation": "用于储粮害虫防治",
    }

    assert classifier.classify(**arguments) == classifier.classify(**arguments)


def test_same_normalized_term_scores_only_once_per_field_across_buckets() -> None:
    duplicate_term_classifier = WarehouseClassifier(
        _classification_rules(
            WarehouseRule(
                level=2,
                chapter_id="warehouse-l2-c03",
                section_id="warehouse-l2-c03-s04",
                strong_phrases=("害虫",),
                keywords=("害虫",),
                context_terms=("害虫",),
                exclude_terms=("害虫",),
            )
        )
    )

    result = duplicate_term_classifier.classify(
        level=2,
        stem="害虫",
        options=(),
        explanation="",
    )

    assert result.status == "section"
    assert result.candidates[0].score == 12
    assert result.candidates[0].matched_terms == ("害虫",)
