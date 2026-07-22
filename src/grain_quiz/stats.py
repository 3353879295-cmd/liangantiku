"""Deterministic question-bank statistics."""

from collections import Counter
from typing import Callable

from grain_quiz.models import Question


def build_stats(questions: list[Question]) -> dict[str, dict[str, int]]:
    """Count questions across the dimensions used in review exports."""
    dimensions: dict[str, Callable[[Question], str]] = {
        "occupation": lambda question: question.occupation_code.value,
        "level": lambda question: str(question.level),
        "module": lambda question: question.module,
        "type": lambda question: question.type.value,
        "difficulty": lambda question: question.difficulty.value,
        "review_status": lambda question: question.review_status.value,
    }
    return {
        name: dict(sorted(Counter(selector(question) for question in questions).items()))
        for name, selector in dimensions.items()
    }
