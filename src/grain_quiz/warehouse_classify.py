"""Immutable warehouse classification rule models and JSON loading."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .catalog import KnowledgeCatalog


WAREHOUSE_OCCUPATION_CODE = "4-02-06-01"
_TOP_LEVEL_KEYS = {"version", "field_weights", "term_weights", "thresholds", "rules"}
_FIELD_WEIGHT_KEYS = {"stem", "options", "explanation"}
_TERM_WEIGHT_KEYS = {"strong_phrases", "keywords", "context_terms", "exclude_terms"}
_THRESHOLD_KEYS = {
    "section_score",
    "section_margin",
    "chapter_score",
    "chapter_margin",
    "basic_lead",
}
_RULE_KEYS = {
    "level",
    "chapter_id",
    "section_id",
    "strong_phrases",
    "keywords",
    "context_terms",
    "exclude_terms",
}


def _key_mismatch_error(
    label: str,
    actual_keys: set[str],
    expected_keys: set[str],
) -> ValueError:
    missing = sorted(expected_keys - actual_keys)
    unexpected = sorted(actual_keys - expected_keys)
    details: list[str] = []
    if missing:
        details.append(f"missing: {', '.join(missing)}")
    if unexpected:
        details.append(f"unexpected: {', '.join(unexpected)}")
    return ValueError(f"{label} has invalid keys ({'; '.join(details)})")


@dataclass(frozen=True)
class WarehouseRule:
    level: int
    chapter_id: str
    section_id: str
    strong_phrases: tuple[str, ...]
    keywords: tuple[str, ...]
    context_terms: tuple[str, ...]
    exclude_terms: tuple[str, ...]


@dataclass(frozen=True)
class WarehouseRuleSet:
    version: str
    stem_weight: int
    options_weight: int
    explanation_weight: int
    strong_phrase_weight: int
    keyword_weight: int
    context_term_weight: int
    exclude_term_weight: int
    section_score: int
    section_margin: int
    chapter_score: int
    chapter_margin: int
    basic_lead: int
    rules: tuple[WarehouseRule, ...]


def _require_nonblank_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-blank string")
    return value.strip()


def _require_exact_mapping(
    value: object,
    label: str,
    expected_keys: set[str],
    *,
    allow_negative_exclude: bool = False,
) -> dict[str, int]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    actual_keys = set(value)
    if actual_keys != expected_keys:
        raise _key_mismatch_error(label, actual_keys, expected_keys)

    result: dict[str, int] = {}
    for key in sorted(expected_keys):
        item = value[key]
        if not isinstance(item, int) or isinstance(item, bool):
            raise ValueError(f"{label}.{key} must be an integer")
        if key == "exclude_terms" and allow_negative_exclude:
            if item >= 0:
                raise ValueError(f"{label}.{key} must be negative")
        elif item <= 0:
            raise ValueError(f"{label}.{key} must be positive")
        result[key] = item
    return result


def _require_terms(value: object, label: str) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    terms: list[str] = []
    seen: dict[str, str] = {}
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{label}[{index}] must be a non-blank string")
        normalized = item.strip()
        if normalized in seen:
            raise ValueError(
                f"{label} contains duplicate term {normalized!r} "
                f"(raw values {seen[normalized]!r} and {item!r})"
            )
        seen[normalized] = item
        terms.append(normalized)
    return tuple(terms)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid warehouse classification rules JSON in {path}: {error}") from error
    if not isinstance(document, dict):
        raise ValueError("warehouse classification rules root must be an object")
    return document


def load_warehouse_rules(path: Path, catalog: KnowledgeCatalog) -> WarehouseRuleSet:
    """Load and validate immutable warehouse classification rules."""

    document = _read_json(path)
    if set(document) != _TOP_LEVEL_KEYS:
        raise _key_mismatch_error(
            "warehouse classification rules", set(document), _TOP_LEVEL_KEYS
        )

    version = _require_nonblank_text(document.get("version"), "version")
    field_weights = _require_exact_mapping(
        document.get("field_weights"), "field_weights", _FIELD_WEIGHT_KEYS
    )
    term_weights = _require_exact_mapping(
        document.get("term_weights"),
        "term_weights",
        _TERM_WEIGHT_KEYS,
        allow_negative_exclude=True,
    )
    thresholds = _require_exact_mapping(
        document.get("thresholds"), "thresholds", _THRESHOLD_KEYS
    )

    raw_rules = document.get("rules")
    if not isinstance(raw_rules, list) or not raw_rules:
        raise ValueError("rules must be a nonempty list")

    rules: list[WarehouseRule] = []
    seen_paths: set[tuple[int, str]] = set()
    for index, raw_rule in enumerate(raw_rules):
        label = f"rule {index}"
        if not isinstance(raw_rule, dict):
            raise ValueError(f"{label} must be an object")
        if set(raw_rule) != _RULE_KEYS:
            raise _key_mismatch_error(label, set(raw_rule), _RULE_KEYS)

        level = raw_rule.get("level")
        if not isinstance(level, int) or isinstance(level, bool) or level not in {1, 2, 3, 4, 5}:
            raise ValueError(f"{label}.level must be an integer from 1 to 5")
        chapter_id = _require_nonblank_text(raw_rule.get("chapter_id"), f"{label}.chapter_id")
        section_id = _require_nonblank_text(raw_rule.get("section_id"), f"{label}.section_id")
        strong_phrases = _require_terms(raw_rule.get("strong_phrases"), f"{label}.strong_phrases")
        keywords = _require_terms(raw_rule.get("keywords"), f"{label}.keywords")
        context_terms = _require_terms(raw_rule.get("context_terms"), f"{label}.context_terms")
        exclude_terms = _require_terms(raw_rule.get("exclude_terms"), f"{label}.exclude_terms")
        if not strong_phrases and not keywords:
            raise ValueError(f"{label} must define strong_phrases or keywords")

        path_key = (level, section_id)
        if path_key in seen_paths:
            raise ValueError(
                f"duplicate warehouse rule for level {level} section {section_id}"
            )
        seen_paths.add(path_key)

        rules.append(
            WarehouseRule(
                level=level,
                chapter_id=chapter_id,
                section_id=section_id,
                strong_phrases=strong_phrases,
                keywords=keywords,
                context_terms=context_terms,
                exclude_terms=exclude_terms,
            )
        )

    # Check this before catalog membership so reserved aggregate sections produce
    # a stable, actionable error even when they are not present in an older catalog.
    for rule in rules:
        if rule.section_id.endswith("-s00"):
            raise ValueError(
                f"warehouse rule section {rule.section_id} uses reserved s00"
            )

    for rule in rules:
        if not catalog.allows(
            WAREHOUSE_OCCUPATION_CODE,
            rule.level,
            rule.chapter_id,
            rule.section_id,
        ):
            raise ValueError(
                f"warehouse rule level {rule.level} path "
                f"{rule.chapter_id}/{rule.section_id} not allowed by catalog"
            )

    return WarehouseRuleSet(
        version=version,
        stem_weight=field_weights["stem"],
        options_weight=field_weights["options"],
        explanation_weight=field_weights["explanation"],
        strong_phrase_weight=term_weights["strong_phrases"],
        keyword_weight=term_weights["keywords"],
        context_term_weight=term_weights["context_terms"],
        exclude_term_weight=term_weights["exclude_terms"],
        section_score=thresholds["section_score"],
        section_margin=thresholds["section_margin"],
        chapter_score=thresholds["chapter_score"],
        chapter_margin=thresholds["chapter_margin"],
        basic_lead=thresholds["basic_lead"],
        rules=tuple(rules),
    )
