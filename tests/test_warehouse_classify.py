import json
from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.warehouse_classify import load_warehouse_rules


CATALOG = load_knowledge_catalog(Path("data/knowledge_catalog.json"))


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
