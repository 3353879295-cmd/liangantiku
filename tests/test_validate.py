from datetime import date
from pathlib import Path

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.models import Question, Source
from grain_quiz.taxonomy import load_taxonomy
from grain_quiz.validate import validate_dataset
from tests.factories import BASE, SOURCE


def valid_question_data(**overrides: object) -> dict[str, object]:
    return {
        **BASE,
        "module": "\u7cae\u60c5\u68c0\u67e5",
        "topic": "\u7cae\u6e29\u68c0\u67e5",
        "review_status": "verified",
        **overrides,
    }


def active_sources() -> dict[str, Source]:
    source = Source.model_validate(SOURCE)
    return {source.id: source}


def taxonomy():
    return load_taxonomy(Path("data/taxonomy.json"))


def catalog():
    return load_knowledge_catalog(Path("data/knowledge_catalog.json"))


def test_verified_question_requires_active_source():
    question = Question.model_validate(valid_question_data())

    report = validate_dataset([question], {}, taxonomy(), catalog())

    assert [(issue.code, issue.question_id) for issue in report.errors] == [
        ("missing_source", question.id)
    ]


def test_pending_question_is_not_a_release_error():
    pending = Question.model_validate(valid_question_data(review_status="pending"))

    report = validate_dataset([pending], {}, taxonomy(), catalog())

    assert not report.errors
    assert report.warnings[0].code == "unreleased_question"


def test_unknown_taxonomy_is_an_error():
    question = Question.model_validate(
        valid_question_data(topic="\u4e0d\u5b58\u5728\u7684\u77e5\u8bc6\u70b9")
    )

    report = validate_dataset([question], active_sources(), taxonomy(), catalog())

    assert report.errors[0].code == "unknown_taxonomy"


def test_duplicate_id_is_an_error():
    first = Question.model_validate(valid_question_data())
    second = Question.model_validate(valid_question_data(stem="alternate test stem"))

    report = validate_dataset([first, second], active_sources(), taxonomy(), catalog())

    assert [(issue.code, issue.question_id) for issue in report.errors] == [
        ("duplicate_id", first.id)
    ]


def test_inactive_source_is_an_error():
    question = Question.model_validate(valid_question_data())
    inactive = Source.model_validate({**SOURCE, "is_active": False})

    report = validate_dataset(
        [question], {inactive.id: inactive}, taxonomy(), catalog()
    )

    assert [(issue.code, issue.question_id) for issue in report.errors] == [
        ("inactive_source", question.id)
    ]


def test_exact_duplicate_is_an_error():
    first = Question.model_validate(valid_question_data())
    second = Question.model_validate(valid_question_data(id="WH-L5-000002"))

    report = validate_dataset([first, second], active_sources(), taxonomy(), catalog())

    assert [issue.code for issue in report.errors] == ["exact_duplicate"]


def test_invalid_validity_window_is_an_error():
    question = Question.model_validate(valid_question_data())
    question.valid_until = date(2025, 12, 31)

    report = validate_dataset([question], active_sources(), taxonomy(), catalog())

    assert [(issue.code, issue.question_id) for issue in report.errors] == [
        ("invalid_validity_window", question.id)
    ]


def test_verified_record_requires_standard_reference_and_explanation():
    question = Question.model_validate(valid_question_data(standard_reference=""))

    report = validate_dataset([question], active_sources(), taxonomy(), catalog())

    assert [(issue.code, issue.question_id) for issue in report.errors] == [
        ("invalid_verified_record", question.id)
    ]


def test_near_duplicate_is_a_warning_without_duplicate_group():
    first = Question.model_validate(valid_question_data(stem="test validation sentence"))
    second = Question.model_validate(
        valid_question_data(
            id="WH-L5-000002",
            stem="test validation sentences",
        )
    )

    report = validate_dataset([first, second], active_sources(), taxonomy(), catalog())

    assert [issue.code for issue in report.warnings] == ["near_duplicate"]


def test_shared_duplicate_group_suppresses_near_duplicate_warning():
    first = Question.model_validate(
        valid_question_data(
            stem="test validation sentence",
            duplicate_group="test-group",
        )
    )
    second = Question.model_validate(
        valid_question_data(
            id="WH-L5-000002",
            stem="test validation sentences",
            duplicate_group="test-group",
        )
    )

    report = validate_dataset([first, second], active_sources(), taxonomy(), catalog())

    assert report.warnings == []


def test_retired_question_is_an_unreleased_warning():
    retired = Question.model_validate(valid_question_data(review_status="retired"))

    report = validate_dataset([retired], {}, taxonomy(), catalog())

    assert not report.errors
    assert [issue.code for issue in report.warnings] == ["unreleased_question"]


def test_distribution_drift_warns_for_large_occupation_level_group():
    questions = [
        Question.model_validate(
                valid_question_data(
                    id=f"WH-L5-{index:06d}",
                    stem=chr(96 + index),
                )
        )
        for index in range(1, 21)
    ]

    report = validate_dataset(questions, active_sources(), taxonomy(), catalog())

    assert [issue.code for issue in report.warnings] == ["distribution_drift"]


def test_distribution_drift_does_not_warn_at_exact_five_point_boundary():
    questions = []
    for index in range(1, 21):
        data = valid_question_data(
            id=f"WH-L5-{index:06d}",
            stem=chr(96 + index),
        )
        if index <= 13:
            pass
        elif index <= 17:
            data.update({"type": "multiple", "answer": ["A", "B"]})
        else:
            data.update(
                {
                    "type": "judge",
                    "options": [
                        {"key": "A", "text": "\u6b63\u786e"},
                        {"key": "B", "text": "\u9519\u8bef"},
                    ],
                }
            )
        questions.append(Question.model_validate(data))

    report = validate_dataset(questions, active_sources(), taxonomy(), catalog())

    assert "distribution_drift" not in [issue.code for issue in report.warnings]


def test_valid_catalog_reference_is_accepted():
    source = Source.model_validate(SOURCE)
    report = validate_dataset(
        [Question.model_validate(BASE)],
        {source.id: source},
        load_taxonomy(Path("data/taxonomy.json")),
        load_knowledge_catalog(Path("data/knowledge_catalog.json")),
    )

    assert not [issue for issue in report.errors if issue.code == "unknown_catalog"]


def test_invalid_catalog_reference_is_an_error():
    invalid = Question.model_validate(
        {
            **BASE,
            "module": "\u7cae\u60c5\u68c0\u67e5",
            "topic": "\u7cae\u6e29\u68c0\u67e5",
            "chapter_id": "warehouse-l3-c11",
            "section_id": "warehouse-l3-c11-s06",
        }
    )

    report = validate_dataset([invalid], {}, taxonomy(), catalog())

    assert "unknown_catalog" in [issue.code for issue in report.errors]
