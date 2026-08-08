import json
from pathlib import Path

import pytest

from grain_quiz.catalog import KnowledgeCatalog, load_knowledge_catalog
from grain_quiz.warehouse_classify import (
    WarehouseClassifier,
    WarehouseRule,
    WarehouseRuleSet,
    load_warehouse_rules,
)


CATALOG = load_knowledge_catalog(Path("data/knowledge_catalog.json"))
RULES_PATH = Path("tools/warehouse_classification_rules.json")


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
    assert rules.rules[0].level == 2
    assert rules.rules[0].chapter_id == "warehouse-l2-c03"
    assert rules.rules[0].section_id == "warehouse-l2-c03-s04"


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
