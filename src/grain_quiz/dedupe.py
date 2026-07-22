"""Exact and near-duplicate question detection."""

from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

from rapidfuzz import fuzz

from grain_quiz.models import Question
from grain_quiz.normalize import exact_fingerprint, normalize_text


@dataclass(frozen=True)
class DuplicatePair:
    """A deterministic pair of duplicate question IDs and its similarity score."""

    left_id: str
    right_id: str
    score: float


@dataclass
class DuplicateReport:
    """Exact and near-duplicate question pairs."""

    exact: list[DuplicatePair]
    near: list[DuplicatePair]


def find_duplicates(
    questions: list[Question],
    threshold: float = 92.0,
) -> DuplicateReport:
    """Find exact pairs globally and near pairs within classification blocks."""
    fingerprint_groups: dict[str, list[Question]] = defaultdict(list)
    for question in questions:
        fingerprint_groups[exact_fingerprint(question)].append(question)

    exact: list[DuplicatePair] = []
    exact_ids: set[tuple[str, str]] = set()
    for group in fingerprint_groups.values():
        for first, second in combinations(group, 2):
            pair = _pair(first.id, second.id, 100.0)
            exact.append(pair)
            exact_ids.add((pair.left_id, pair.right_id))

    blocks: dict[tuple[str, str, str], list[Question]] = defaultdict(list)
    for question in questions:
        key = (question.occupation_code.value, question.module, question.topic)
        blocks[key].append(question)

    near: list[DuplicatePair] = []
    for group in blocks.values():
        for first, second in combinations(group, 2):
            pair = _pair(first.id, second.id, 0.0)
            if (pair.left_id, pair.right_id) in exact_ids:
                continue
            score = float(
                fuzz.ratio(normalize_text(first.stem), normalize_text(second.stem))
            )
            if score >= threshold:
                near.append(DuplicatePair(pair.left_id, pair.right_id, score))

    return DuplicateReport(
        exact=sorted(exact, key=lambda pair: (pair.left_id, pair.right_id)),
        near=sorted(near, key=lambda pair: (pair.left_id, pair.right_id)),
    )


def _pair(first_id: str, second_id: str, score: float) -> DuplicatePair:
    """Create a pair with lexicographically ordered identifiers."""
    left_id, right_id = sorted((first_id, second_id))
    return DuplicatePair(left_id=left_id, right_id=right_id, score=score)
