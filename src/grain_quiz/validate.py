"""Cross-record validation and question release gates."""

from collections import Counter, defaultdict
from dataclasses import dataclass

from grain_quiz.dedupe import find_duplicates
from grain_quiz.models import Question, QuestionType, ReviewStatus, Source
from grain_quiz.taxonomy import Taxonomy


@dataclass(frozen=True)
class ValidationIssue:
    """A deterministic validation finding for a record or record pair."""

    code: str
    question_id: str | None
    message: str


@dataclass
class ValidationReport:
    """Errors that block release and warnings that require review."""

    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]


def validate_dataset(
    questions: list[Question],
    sources: dict[str, Source],
    taxonomy: Taxonomy,
) -> ValidationReport:
    """Validate release gates and cross-record consistency for questions."""
    errors: list[ValidationIssue] = []
    warnings: list[ValidationIssue] = []

    _validate_duplicate_ids(questions, errors)
    _validate_questions(questions, sources, taxonomy, errors, warnings)
    _validate_duplicates(questions, errors, warnings)
    _validate_distribution(questions, warnings)

    return ValidationReport(
        errors=sorted(errors, key=_issue_sort_key),
        warnings=sorted(warnings, key=_issue_sort_key),
    )


def _validate_duplicate_ids(
    questions: list[Question],
    errors: list[ValidationIssue],
) -> None:
    counts = Counter(question.id for question in questions)
    for question_id, count in counts.items():
        if count > 1:
            errors.append(
                ValidationIssue(
                    code="duplicate_id",
                    question_id=question_id,
                    message=f"question ID appears {count} times",
                )
            )


def _validate_questions(
    questions: list[Question],
    sources: dict[str, Source],
    taxonomy: Taxonomy,
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    for question in questions:
        if not taxonomy.allows(
            question.occupation_code.value,
            question.level,
            question.module,
            question.topic,
        ):
            errors.append(
                ValidationIssue(
                    code="unknown_taxonomy",
                    question_id=question.id,
                    message="question classification is not in the taxonomy",
                )
            )

        if question.valid_until and question.valid_until < question.valid_from:
            errors.append(
                ValidationIssue(
                    code="invalid_validity_window",
                    question_id=question.id,
                    message="valid_until cannot precede valid_from",
                )
            )

        if question.review_status == ReviewStatus.VERIFIED:
            _validate_verified_question(question, sources, errors)
        elif question.review_status in {ReviewStatus.PENDING, ReviewStatus.RETIRED}:
            warnings.append(
                ValidationIssue(
                    code="unreleased_question",
                    question_id=question.id,
                    message=f"question is {question.review_status.value}",
                )
            )


def _validate_verified_question(
    question: Question,
    sources: dict[str, Source],
    errors: list[ValidationIssue],
) -> None:
    if not question.source_ids:
        errors.append(
            ValidationIssue(
                code="missing_source",
                question_id=question.id,
                message="verified question requires at least one source",
            )
        )
    for source_id in question.source_ids:
        source = sources.get(source_id)
        if source is None:
            errors.append(
                ValidationIssue(
                    code="missing_source",
                    question_id=question.id,
                    message=f"source {source_id} is missing",
                )
            )
        elif not source.is_active:
            errors.append(
                ValidationIssue(
                    code="inactive_source",
                    question_id=question.id,
                    message=f"source {source_id} is inactive",
                )
            )

    if not question.standard_reference.strip():
        errors.append(
            ValidationIssue(
                code="invalid_verified_record",
                question_id=question.id,
                message="verified question requires a standard reference",
            )
        )
    if not question.explanation.strip():
        errors.append(
            ValidationIssue(
                code="invalid_verified_record",
                question_id=question.id,
                message="verified question requires an explanation",
            )
        )


def _validate_duplicates(
    questions: list[Question],
    errors: list[ValidationIssue],
    warnings: list[ValidationIssue],
) -> None:
    duplicate_report = find_duplicates(questions)
    questions_by_id = {question.id: question for question in questions}

    for pair in duplicate_report.exact:
        errors.append(
            ValidationIssue(
                code="exact_duplicate",
                question_id=None,
                message=f"exact duplicate pair: {pair.left_id}, {pair.right_id}",
            )
        )

    for pair in duplicate_report.near:
        left = questions_by_id[pair.left_id]
        right = questions_by_id[pair.right_id]
        if left.duplicate_group and left.duplicate_group == right.duplicate_group:
            continue
        warnings.append(
            ValidationIssue(
                code="near_duplicate",
                question_id=None,
                message=(
                    f"near duplicate pair: {pair.left_id}, {pair.right_id} "
                    f"({pair.score:.1f})"
                ),
            )
        )


def _validate_distribution(
    questions: list[Question],
    warnings: list[ValidationIssue],
) -> None:
    targets = {
        QuestionType.SINGLE: 0.60,
        QuestionType.MULTIPLE: 0.20,
        QuestionType.JUDGE: 0.20,
    }
    groups: dict[tuple[str, int], list[Question]] = defaultdict(list)
    for question in questions:
        groups[(question.occupation_code.value, question.level)].append(question)

    for (occupation_code, level), group in groups.items():
        if len(group) < 20:
            continue
        counts = Counter(question.type for question in group)
        drift = [
            question_type.value
            for question_type, target in targets.items()
            if abs(counts[question_type] / len(group) - target) > 0.05
        ]
        if drift:
            warnings.append(
                ValidationIssue(
                    code="distribution_drift",
                    question_id=None,
                    message=(
                        f"{occupation_code} level {level} drifts in: "
                        f"{', '.join(drift)}"
                    ),
                )
            )


def _issue_sort_key(issue: ValidationIssue) -> tuple[str, str, str]:
    return (issue.code, issue.question_id or "", issue.message)
