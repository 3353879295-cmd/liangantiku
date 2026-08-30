from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.models import OccupationCode, Question, ReviewStatus


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("level", (5, 4, 3))
def test_inspector_release_dataset_is_verified_and_catalogued(level: int):
    path = ROOT / "data" / "questions" / f"inspector_l{level}.jsonl"
    questions = [
        Question.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    catalog = load_knowledge_catalog(ROOT / "data" / "knowledge_catalog.json")

    assert len(questions) >= 8
    assert all(question.occupation_code == OccupationCode.GRAIN_INSPECTOR for question in questions)
    assert all(question.level == level for question in questions)
    assert all(question.review_status == ReviewStatus.VERIFIED for question in questions)
    assert all(
        catalog.allows(
            question.occupation_code.value,
            question.level,
            question.chapter_id,
            question.section_id,
        )
        for question in questions
    )
