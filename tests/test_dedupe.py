from grain_quiz.dedupe import find_duplicates
from grain_quiz.models import Question
from grain_quiz.normalize import exact_fingerprint, normalize_text
from tests.factories import BASE


def test_normalize_text_folds_width_space_and_punctuation():
    assert normalize_text(" \u7cae\u3000\u6e29\uff08\u2103\uff09\uff1f ") == "\u7cae\u6e29\u2103"


def test_exact_fingerprint_ignores_option_order():
    left = Question.model_validate(BASE)
    right_data = {
        **BASE,
        "id": "WH-L5-000002",
        "options": list(reversed(BASE["options"])),
    }
    right = Question.model_validate(right_data)

    assert exact_fingerprint(left) == exact_fingerprint(right)


def test_find_duplicates_flags_reworded_stem():
    left_data = {**BASE, "stem": "\u7cae\u6e29\u68c0\u67e5\u65f6\uff0c\u9996\u5148\u5e94\u4fdd\u8bc1\u4ec0\u4e48\uff1f"}
    left = Question.model_validate(left_data)
    right = Question.model_validate(
        {
            **left_data,
            "id": "WH-L5-000002",
            "stem": "\u8fdb\u884c\u7cae\u6e29\u68c0\u67e5\u65f6\uff0c\u9996\u5148\u5e94\u4fdd\u8bc1\u4ec0\u4e48\uff1f",
        }
    )

    report = find_duplicates([left, right], threshold=80)

    assert [(pair.left_id, pair.right_id) for pair in report.near] == [
        ("WH-L5-000001", "WH-L5-000002")
    ]


def test_find_duplicates_groups_exact_fingerprints_globally():
    left = Question.model_validate(BASE)
    right = Question.model_validate(
        {**BASE, "id": "WH-L4-000002", "level": 4}
    )

    report = find_duplicates([right, left])

    assert [(pair.left_id, pair.right_id, pair.score) for pair in report.exact] == [
        ("WH-L4-000002", "WH-L5-000001", 100.0)
    ]
    assert report.near == []


def test_find_duplicates_blocks_near_matches_by_module_and_topic():
    left = Question.model_validate(
        {**BASE, "stem": "\u7cae\u6e29\u68c0\u67e5\u65f6\uff0c\u9996\u5148\u5e94\u4fdd\u8bc1\u4ec0\u4e48\uff1f"}
    )
    right = Question.model_validate(
        {
            **BASE,
            "id": "WH-L5-000002",
            "module": "different module",
            "stem": "\u8fdb\u884c\u7cae\u6e29\u68c0\u67e5\u65f6\uff0c\u9996\u5148\u5e94\u4fdd\u8bc1\u4ec0\u4e48\uff1f",
        }
    )

    report = find_duplicates([left, right], threshold=80)

    assert report.near == []
