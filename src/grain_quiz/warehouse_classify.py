"""Immutable warehouse classification rule models and JSON loading."""

from __future__ import annotations

import json
import unicodedata
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

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


PendingReason = Literal["ambiguous", "low_score", "no_rule"]


@dataclass(frozen=True)
class ClassificationCandidate:
    chapter_id: str
    section_id: str
    score: int
    matched_terms: tuple[str, ...]


@dataclass(frozen=True)
class ClassificationResult:
    status: Literal["section", "chapter", "pending"]
    chapter_id: str | None
    section_id: str | None
    candidates: tuple[ClassificationCandidate, ...]
    reason: PendingReason | None = None


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


def normalize_classification_text(value: str) -> str:
    """Normalize rule and question text without discarding technical symbols."""

    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


class WarehouseClassifier:
    """Deterministically classify warehouse questions using weighted terms."""

    def __init__(self, rules: WarehouseRuleSet):
        self.rules = rules

    def classify(
        self,
        *,
        level: int,
        stem: str,
        options: Sequence[str],
        explanation: str,
    ) -> ClassificationResult:
        level_rules = tuple(rule for rule in self.rules.rules if rule.level == level)
        if not level_rules:
            return ClassificationResult("pending", None, None, (), "no_rule")

        fields = (
            (normalize_classification_text(stem), self.rules.stem_weight),
            (
                normalize_classification_text(" ".join(options)),
                self.rules.options_weight,
            ),
            (
                normalize_classification_text(explanation),
                self.rules.explanation_weight,
            ),
        )
        candidates = tuple(
            sorted(
                (self._score(rule, fields) for rule in level_rules),
                key=lambda item: (-item.score, item.chapter_id, item.section_id),
            )
        )
        positive = tuple(candidate for candidate in candidates if candidate.score > 0)
        if not positive:
            has_weak_evidence = any(candidate.matched_terms for candidate in candidates)
            if not has_weak_evidence:
                has_weak_evidence = any(
                    self._has_context_evidence(rule, fields) for rule in level_rules
                )
            reason: PendingReason = "low_score" if has_weak_evidence else "no_rule"
            return ClassificationResult("pending", None, None, (), reason)

        decision_candidates = self._decision_candidates(positive)
        remaining = tuple(
            candidate
            for candidate in positive
            if candidate not in decision_candidates
        )
        ranked = (*decision_candidates, *remaining)
        first = decision_candidates[0]
        second_score = (
            decision_candidates[1].score if len(decision_candidates) > 1 else 0
        )
        if len(decision_candidates) > 1 and first.score == second_score:
            return ClassificationResult(
                "pending", None, None, ranked[:3], "ambiguous"
            )
        if (
            first.score >= self.rules.section_score
            and first.score - second_score >= self.rules.section_margin
        ):
            return ClassificationResult(
                "section",
                first.chapter_id,
                first.section_id,
                ranked[:3],
            )

        chapter_scores: dict[str, int] = defaultdict(int)
        for candidate in decision_candidates:
            chapter_scores[candidate.chapter_id] += candidate.score
        ranked_chapters = sorted(
            chapter_scores.items(), key=lambda item: (-item[1], item[0])
        )
        chapter_id, chapter_score = ranked_chapters[0]
        second_chapter_score = (
            ranked_chapters[1][1] if len(ranked_chapters) > 1 else 0
        )
        if (
            len(ranked_chapters) > 1
            and chapter_score == second_chapter_score
        ):
            return ClassificationResult(
                "pending", None, None, ranked[:3], "ambiguous"
            )
        if (
            chapter_score >= self.rules.chapter_score
            and chapter_score - second_chapter_score >= self.rules.chapter_margin
        ):
            return ClassificationResult(
                "chapter",
                chapter_id,
                f"{chapter_id}-s00",
                ranked[:3],
            )
        return ClassificationResult("pending", None, None, ranked[:3], "low_score")

    def _score(
        self,
        rule: WarehouseRule,
        fields: tuple[tuple[str, int], ...],
    ) -> ClassificationCandidate:
        score = 0
        matched: dict[str, str] = {}
        primary_hit = False
        counted_by_field = [set() for _ in fields]

        for field_index, (field, field_weight) in enumerate(fields):
            counted = counted_by_field[field_index]
            for term in rule.strong_phrases:
                normalized = normalize_classification_text(term)
                if normalized in field and normalized not in counted:
                    score += self.rules.strong_phrase_weight * field_weight
                    counted.add(normalized)
                    matched.setdefault(normalized, term)
                    primary_hit = True
            for term in rule.keywords:
                normalized = normalize_classification_text(term)
                if normalized in field and normalized not in counted:
                    score += self.rules.keyword_weight * field_weight
                    counted.add(normalized)
                    matched.setdefault(normalized, term)
                    primary_hit = True

        if primary_hit:
            for field_index, (field, field_weight) in enumerate(fields):
                counted = counted_by_field[field_index]
                for term in rule.context_terms:
                    normalized = normalize_classification_text(term)
                    if normalized in field and normalized not in counted:
                        score += self.rules.context_term_weight * field_weight
                        counted.add(normalized)
                        matched.setdefault(normalized, term)

        for field_index, (field, field_weight) in enumerate(fields):
            counted = counted_by_field[field_index]
            for term in rule.exclude_terms:
                normalized = normalize_classification_text(term)
                if normalized in field and normalized not in counted:
                    score += self.rules.exclude_term_weight * field_weight
                    counted.add(normalized)
                    matched.setdefault(f"!{normalized}", f"!{term}")

        return ClassificationCandidate(
            chapter_id=rule.chapter_id,
            section_id=rule.section_id,
            score=score,
            matched_terms=tuple(sorted(matched.values())),
        )

    @staticmethod
    def _has_context_evidence(
        rule: WarehouseRule,
        fields: tuple[tuple[str, int], ...],
    ) -> bool:
        return any(
            normalize_classification_text(term) in field
            for term in rule.context_terms
            for field, _ in fields
        )

    def _decision_candidates(
        self,
        candidates: tuple[ClassificationCandidate, ...],
    ) -> tuple[ClassificationCandidate, ...]:
        basic = tuple(
            candidate
            for candidate in candidates
            if candidate.chapter_id.startswith("warehouse-basic-")
        )
        specific = tuple(
            candidate
            for candidate in candidates
            if not candidate.chapter_id.startswith("warehouse-basic-")
        )
        if not basic or not specific:
            return candidates
        if basic[0].score - specific[0].score < self.rules.basic_lead:
            return specific
        return candidates


DEFAULT_RULES_PATH = (
    Path(__file__).resolve().parents[2] / "tools" / "warehouse_classification_rules.json"
)
DEFAULT_CATALOG_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "knowledge_catalog.json"
)


@lru_cache(maxsize=1)
def _default_classifier() -> WarehouseClassifier:
    from .catalog import load_knowledge_catalog

    catalog = load_knowledge_catalog(DEFAULT_CATALOG_PATH)
    return WarehouseClassifier(load_warehouse_rules(DEFAULT_RULES_PATH, catalog))


def classify_warehouse_question(
    *,
    level: int,
    stem: str,
    options: Sequence[str],
    explanation: str,
) -> ClassificationResult:
    return _default_classifier().classify(
        level=level,
        stem=stem,
        options=options,
        explanation=explanation,
    )
