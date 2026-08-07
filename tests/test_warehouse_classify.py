import json
from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.warehouse_classify import load_warehouse_rules


CATALOG = load_knowledge_catalog(Path("data/knowledge_catalog.json"))
RULES_PATH = Path("tools/warehouse_classification_rules.json")


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


def test_checked_in_rules_artifact_loads() -> None:
    rules = load_warehouse_rules(RULES_PATH, CATALOG)

    assert rules.version == "2026-08-07.1"
    assert rules.rules[0].section_id == "warehouse-l3-c11-s04"


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
