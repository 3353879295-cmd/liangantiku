import pytest
from pydantic import ValidationError

from grain_quiz.models import Question
from tests.factories import BASE


def test_valid_single_question():
    assert Question.model_validate(BASE).answer == ["A"]


def test_question_accepts_technician_and_senior_technician_levels():
    assert Question.model_validate({**BASE, "id": "WH-L2-000001", "level": 2}).level == 2
    assert Question.model_validate({**BASE, "id": "WH-L1-000001", "level": 1}).level == 1


def test_question_keeps_stable_catalog_references():
    question = Question.model_validate(BASE)

    assert question.chapter_id == "warehouse-l5-c03"
    assert question.section_id == "warehouse-l5-c03-s03"


def test_single_question_rejects_two_answers():
    with pytest.raises(ValidationError):
        Question.model_validate({**BASE, "answer": ["A", "B"]})


def test_judge_question_requires_fixed_options():
    invalid = {**BASE, "type": "judge", "answer": ["A"]}
    with pytest.raises(ValidationError):
        Question.model_validate(invalid)


def test_case_question_uses_four_options_and_one_answer():
    question = Question.model_validate({**BASE, "type": "case", "answer": ["C"]})

    assert question.type.value == "case"
    with pytest.raises(ValidationError):
        Question.model_validate({**BASE, "type": "case", "answer": ["A", "C"]})
