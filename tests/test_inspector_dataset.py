from pathlib import Path
import shutil

import pytest

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.models import OccupationCode, Question, ReviewStatus
from tools.reclassify_inspector_questions import _path, _source_text, reclassify


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    ("level", "expected_count"),
    ((5, 202), (4, 1102), (3, 875), (2, 1050), (1, 594)),
)
def test_inspector_release_dataset_is_verified_and_catalogued(
    level: int, expected_count: int
):
    path = ROOT / "data" / "questions" / f"inspector_l{level}.jsonl"
    questions = [
        Question.model_validate_json(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    catalog = load_knowledge_catalog(ROOT / "data" / "knowledge_catalog.json")

    assert len(questions) == expected_count
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


def test_inspector_questions_use_the_visible_catalog_labels_and_level_paths():
    catalog = load_knowledge_catalog(ROOT / "data" / "knowledge_catalog.json")
    occupation = catalog.occupations["4-08-05-01"]
    labels = {
        (chapter.id, section.id): (chapter.title, section.title)
        for part in occupation.parts
        for chapter in part.chapters
        for section in chapter.sections
    }
    questions = [
        Question.model_validate_json(line)
        for path in (ROOT / "data" / "questions").glob("inspector_l*.jsonl")
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]

    assert all(
        (question.module, question.topic) == labels[(question.chapter_id, question.section_id)]
        for question in questions
    )
    assert all(
        question.chapter_id == "inspector-import-c01"
        and question.section_id == "inspector-import-c01-s01"
        for question in questions
        if question.level in {1, 2}
    )
    assert all(
        question.chapter_id.startswith(("inspector-basic-", f"inspector-l{question.level}-"))
        and not question.chapter_id.startswith("inspector-import-")
        for question in questions
        if question.level in {3, 4, 5}
    )


@pytest.mark.parametrize(
    ("level", "text", "expected"),
    (
        (5, "天平两臂不等长带来的误差", ("inspector-basic-c04", "inspector-basic-c04-s01")),
        (4, "样品接收时应核对样品状态", ("inspector-l4-c15", "inspector-l4-c15-s02")),
        (3, "有机磷农药残留量测定", ("inspector-l3-c27", "inspector-l3-c27-s03")),
        (3, "黄曲霉毒素B₁的测定方法", ("inspector-l3-c29", "inspector-l3-c29-s02")),
    ),
)
def test_inspector_classifier_prefers_specific_textbook_features(level, text, expected):
    assert _path(level, text) == expected


@pytest.mark.parametrize(
    ("level", "question_id", "expected"),
    (
        (5, "QI-L5-000042", ("inspector-l5-c12", "inspector-l5-c12-s01")),
        (5, "QI-L5-000005", ("inspector-l5-c14", "inspector-l5-c14-s01")),
        (4, "QI-L4-000009", ("inspector-basic-c01", "inspector-basic-c01-s01")),
        (4, "QI-L4-000010", ("inspector-basic-c01", "inspector-basic-c01-s01")),
        (4, "QI-L4-000015", ("inspector-basic-c01", "inspector-basic-c01-s01")),
        (3, "QI-L3-000021", ("inspector-l3-c22", "inspector-l3-c22-s01")),
        (3, "QI-L3-000022", ("inspector-l3-c22", "inspector-l3-c22-s01")),
        (3, "QI-L3-000026", ("inspector-l3-c22", "inspector-l3-c22-s01")),
        (3, "QI-L3-000028", ("inspector-l3-c22", "inspector-l3-c22-s02")),
    ),
)
def test_inspector_classifier_uses_primary_question_content(question_id, level, expected):
    question = next(
        Question.model_validate_json(line)
        for line in (ROOT / "data" / "questions" / f"inspector_l{level}.jsonl").read_text(encoding="utf-8").splitlines()
        if question_id in line
    )

    assert _path(level, " ".join((question.stem, question.explanation))) == expected


@pytest.mark.parametrize(
    ("question_id", "expected"),
    (
        ("QI-L5-000009", ("inspector-basic-c02", "inspector-basic-c02-s02")),
        ("QI-L5-000010", ("inspector-basic-c02", "inspector-basic-c02-s02")),
        ("QI-L5-000011", ("inspector-basic-c02", "inspector-basic-c02-s01")),
        ("QI-L5-000012", ("inspector-basic-c02", "inspector-basic-c02-s01")),
        *((f"QI-L5-{number:06d}", ("inspector-basic-c02", "inspector-basic-c02-s02")) for number in range(13, 19)),
    ),
)
def test_inspector_l5_composition_questions_do_not_fall_back_to_method_or_wheat_rules(question_id, expected):
    question = next(
        Question.model_validate_json(line)
        for line in (ROOT / "data" / "questions" / "inspector_l5.jsonl").read_text(encoding="utf-8").splitlines()
        if question_id in line
    )

    assert _path(5, _source_text(question.model_dump())) == expected


@pytest.mark.parametrize(
    ("question_id", "expected"),
    (
        ("QI-L5-000083", ("inspector-l5-c07", "inspector-l5-c07-s02")),
        ("QI-L5-000089", ("inspector-l5-c07", "inspector-l5-c07-s04")),
    ),
)
def test_inspector_l5_sampling_questions_are_not_classified_by_commodity_name(question_id, expected):
    question = next(
        Question.model_validate_json(line)
        for line in (ROOT / "data" / "questions" / "inspector_l5.jsonl").read_text(encoding="utf-8").splitlines()
        if question_id in line
    )

    assert _path(5, _source_text(question.model_dump())) == expected


def _classification_fixture(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    (root / "data" / "questions").mkdir(parents=True)
    for filename in ("knowledge_catalog.json", "taxonomy.json"):
        shutil.copy2(ROOT / "data" / filename, root / "data" / filename)
    for path in (ROOT / "data" / "questions").glob("inspector_l*.jsonl"):
        shutil.copy2(path, root / "data" / "questions" / path.name)
    return root


def test_inspector_reclassification_is_idempotent_and_does_not_use_written_labels(tmp_path: Path):
    root = _classification_fixture(tmp_path)

    reclassify(root)
    first = {
        path.relative_to(root): path.read_bytes()
        for path in [
            root / "data" / "knowledge_catalog.json",
            root / "data" / "taxonomy.json",
            *(root / "data" / "questions").glob("inspector_l*.jsonl"),
            root / "tmp" / "inspector-classification-report.json",
        ]
    }
    reclassify(root)

    assert {
        path.relative_to(root): path.read_bytes()
        for path in [
            root / "data" / "knowledge_catalog.json",
            root / "data" / "taxonomy.json",
            *(root / "data" / "questions").glob("inspector_l*.jsonl"),
            root / "tmp" / "inspector-classification-report.json",
        ]
    } == first


def test_inspector_reclassification_rolls_back_when_a_shard_is_invalid(tmp_path: Path):
    root = _classification_fixture(tmp_path)
    target = root / "data" / "questions" / "inspector_l4.jsonl"
    target.write_text("not json\n", encoding="utf-8")
    before = (root / "data" / "knowledge_catalog.json").read_bytes()

    with pytest.raises(ValueError):
        reclassify(root)

    assert (root / "data" / "knowledge_catalog.json").read_bytes() == before


def test_inspector_reclassification_rolls_back_after_a_replacement_failure(tmp_path: Path):
    root = _classification_fixture(tmp_path)
    targets = [
        root / "data" / "knowledge_catalog.json",
        root / "data" / "taxonomy.json",
        *(root / "data" / "questions").glob("inspector_l*.jsonl"),
    ]
    before = {path: path.read_bytes() for path in targets}
    calls = 0

    def fail_second_replace(source: Path, target: Path) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("injected replacement failure")
        source.replace(target)

    with pytest.raises(OSError, match="injected replacement failure"):
        reclassify(root, replace=fail_second_replace)

    assert {path: path.read_bytes() for path in targets} == before
