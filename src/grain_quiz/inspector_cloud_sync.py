"""Pure planning for importing verified inspector questions from the cloud."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pydantic import ValidationError

from grain_quiz.catalog import KnowledgeCatalog
from grain_quiz.models import Question, Source
from grain_quiz.taxonomy import Taxonomy


INSPECTOR_CODE = "4-08-05-01"
INSPECTOR_NAME = "农产品食品检验员"
PUBLISHED_LEVELS = frozenset({1, 2, 3, 4, 5})
_QUESTION_ID = re.compile(r"^QI-L([12345])-(\d{6})$")
_RUNTIME_FIELDS = (
    "id", "occupation", "direction", "level", "module", "topic", "chapter_id",
    "section_id", "type", "stem", "options", "answer", "explanation", "difficulty",
    "keywords", "source_ids", "standard_reference", "source_note", "review_status", "content_version",
)


class CloudSyncValidationError(ValueError):
    """A cloud document cannot safely be incorporated into the local source."""


@dataclass(frozen=True)
class CloudSyncConflict:
    kind: str
    cloud_id: str
    local_id: str
    message: str


@dataclass(frozen=True)
class CloudSyncPlan:
    merged_questions: tuple[Question, ...]
    synced: tuple[Question, ...]
    deduplicated: tuple[str, ...]
    skipped: tuple[str, ...]
    conflicts: tuple[CloudSyncConflict, ...]
    generated_ids: tuple[str, ...]

    @property
    def has_conflicts(self) -> bool:
        return bool(self.conflicts)


def _error(index: int, message: str) -> CloudSyncValidationError:
    return CloudSyncValidationError(f"cloud document {index}: {message}")


def _read_id(document: Mapping[str, Any], index: int) -> str | None:
    values = []
    for name in ("id", "question_id"):
        value = document.get(name)
        if value is not None:
            if not isinstance(value, str) or not value.strip():
                raise _error(index, f"{name} must be a non-blank string when present")
            values.append(value.strip())
    if len(set(values)) > 1:
        raise _error(index, "id and question_id must match")
    return values[0] if values else None


def _validate_id(question_id: str, level: int, index: int) -> None:
    match = _QUESTION_ID.fullmatch(question_id)
    if match is None:
        raise _error(index, "id must use QI-L{level}-NNNNNN format")
    if int(match.group(1)) != level:
        raise _error(index, "id level must match level")


def _runtime_record(question: Question) -> dict[str, Any]:
    return {
        "id": question.id,
        "occupation": question.occupation_code.value,
        "direction": question.direction,
        "level": question.level,
        "module": question.module,
        "topic": question.topic,
        "chapter_id": question.chapter_id,
        "section_id": question.section_id,
        "type": question.type.value,
        "stem": question.stem,
        "options": [option.model_dump() for option in question.options],
        "answer": list(question.answer),
        "explanation": question.explanation,
        "difficulty": question.difficulty.value,
        "keywords": list(question.keywords),
        "source_ids": list(question.source_ids),
        "standard_reference": question.standard_reference,
        "source_note": question.source_note,
        "review_status": question.review_status.value,
        "content_version": question.content_version,
    }


def _fingerprint(record: Mapping[str, Any]) -> str:
    return json.dumps(
        {"stem": record["stem"], "options": record["options"]},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _validate_document(
    document: object,
    index: int,
    catalog: KnowledgeCatalog,
    taxonomy: Taxonomy,
    sources: Mapping[str, Source],
) -> tuple[dict[str, Any], str | None]:
    if not isinstance(document, Mapping):
        raise _error(index, "must be an object")
    raw = dict(document)
    question_id = _read_id(raw, index)
    if raw.get("occupation") != INSPECTOR_CODE:
        raise _error(index, "occupation must be 4-08-05-01")
    level = raw.get("level")
    if not isinstance(level, int) or isinstance(level, bool) or level not in {1, 2, 3, 4, 5}:
        raise _error(index, "level must be an integer from 1 through 5")
    if question_id is not None:
        _validate_id(question_id, level, index)
    if level not in PUBLISHED_LEVELS:
        return raw, question_id
    required = set(_RUNTIME_FIELDS) - {"id", "source_note"}
    missing = sorted(name for name in required if name not in raw)
    if missing:
        raise _error(index, f"missing required fields: {', '.join(missing)}")
    if raw["review_status"] != "verified":
        raise _error(index, "review_status must be verified")
    if not catalog.allows(INSPECTOR_CODE, level, raw["chapter_id"], raw["section_id"]):
        raise _error(index, "chapter_id and section_id are not allowed by catalog")
    if not taxonomy.allows(INSPECTOR_CODE, level, raw["module"], raw["topic"]):
        raise _error(index, "module and topic are not allowed by taxonomy")
    source_ids = raw.get("source_ids")
    if not isinstance(source_ids, list) or any(source_id not in sources for source_id in source_ids):
        raise _error(index, "source_ids must refer to known sources")
    return raw, question_id


def _new_question(record: Mapping[str, Any], question_id: str, release_id: str, timestamp: datetime) -> Question:
    try:
        return Question.model_validate({
            **record,
            "id": question_id,
            "occupation_code": INSPECTOR_CODE,
            "occupation_name": INSPECTOR_NAME,
            "source_note": record.get(
                "source_note",
                f"云端 question_bank_questions 发布版本 {release_id} 单向同步生成。",
            ),
            "valid_from": timestamp.date(),
            "valid_until": None,
            "duplicate_group": None,
            "created_at": timestamp,
            "updated_at": timestamp,
        })
    except ValidationError as error:
        raise CloudSyncValidationError(f"invalid cloud question {question_id}: {error}") from error


def _next_id(level: int, used_ids: set[str]) -> str:
    serial = 1
    while f"QI-L{level}-{serial:06d}" in used_ids:
        serial += 1
    return f"QI-L{level}-{serial:06d}"


def plan_inspector_cloud_sync(
    cloud_documents: Sequence[object],
    local_questions: Sequence[Question],
    catalog: KnowledgeCatalog,
    taxonomy: Taxonomy,
    sources: Mapping[str, Source],
    release_id: str,
    release_timestamp: datetime,
) -> CloudSyncPlan:
    """Return a deterministic, non-mutating merge plan for inspector cloud records."""
    if not isinstance(release_id, str) or not release_id.strip():
        raise CloudSyncValidationError("release_id must be non-blank")
    if release_timestamp.tzinfo is None:
        raise CloudSyncValidationError("release_timestamp must be timezone-aware")

    local_by_id = {question.id: question for question in local_questions}
    local_runtime = {question.id: _runtime_record(question) for question in local_questions}
    local_by_fingerprint: dict[str, list[Question]] = {}
    for question in local_questions:
        local_by_fingerprint.setdefault(_fingerprint(local_runtime[question.id]), []).append(question)

    validated: list[tuple[dict[str, Any], str | None]] = []
    skipped: list[str] = []
    for index, document in enumerate(cloud_documents, start=1):
        record, question_id = _validate_document(document, index, catalog, taxonomy, sources)
        if record["level"] not in PUBLISHED_LEVELS:
            skipped.append(question_id or f"cloud-document-{index}")
        else:
            validated.append((record, question_id))

    explicit = [
        (record, question_id)
        for record, question_id in validated
        if question_id is not None
    ]
    explicit_questions: dict[str, Question] = {}
    for record, question_id in explicit:
        candidate = _new_question(record, question_id, release_id.strip(), release_timestamp)
        previous = explicit_questions.get(question_id)
        if previous is not None and _runtime_record(previous) != _runtime_record(candidate):
            raise CloudSyncValidationError(
                f"cloud batch contains conflicting content for question ID {question_id}"
            )
        explicit_questions[question_id] = candidate
    used_ids = set(local_by_id) | {question_id for _, question_id in explicit}
    generated_id_candidates: set[str] = set()
    assigned: list[tuple[dict[str, Any], str]] = []
    missing = sorted(
        (record for record, question_id in validated if question_id is None),
        key=lambda record: (record["level"], _fingerprint(record)),
    )
    generated_for_fingerprint: dict[tuple[int, str], str] = {}
    for record in missing:
        key = (record["level"], _fingerprint(record))
        question_id = generated_for_fingerprint.get(key)
        if question_id is None:
            question_id = None
            for local in sorted(local_by_fingerprint.get(key[1], []), key=lambda question: question.id):
                candidate = _new_question(record, local.id, release_id.strip(), release_timestamp)
                if _runtime_record(local) == _runtime_record(candidate):
                    question_id = local.id
                    break
            if question_id is None:
                question_id = _next_id(record["level"], used_ids)
                used_ids.add(question_id)
                generated_id_candidates.add(question_id)
            generated_for_fingerprint[key] = question_id
        assigned.append((record, question_id))
    assigned.extend(explicit)

    synced: list[Question] = []
    deduplicated: list[str] = []
    conflicts: list[CloudSyncConflict] = []
    cloud_by_id: dict[str, Question] = {}
    planned_fingerprints: dict[str, Question] = {}
    for record, question_id in sorted(assigned, key=lambda item: item[1]):
        candidate = _new_question(record, question_id, release_id.strip(), release_timestamp)
        candidate_runtime = _runtime_record(candidate)
        previous_cloud = cloud_by_id.get(question_id)
        if previous_cloud is not None:
            if _runtime_record(previous_cloud) == candidate_runtime:
                deduplicated.append(question_id)
            else:
                conflicts.append(CloudSyncConflict(
                    "cloud_id_content_mismatch", question_id, question_id,
                    "云端批次内同一题目 ID 对应不同内容。",
                ))
            continue
        cloud_by_id[question_id] = candidate
        existing = local_by_id.get(question_id)
        if existing is not None:
            if local_runtime[question_id] == candidate_runtime:
                deduplicated.append(question_id)
            else:
                conflicts.append(CloudSyncConflict(
                    "id_content_mismatch", question_id, question_id,
                    "同一题目 ID 的云端内容与本地内容不一致。",
                ))
            continue
        fingerprint = _fingerprint(candidate_runtime)
        matches = local_by_fingerprint.get(fingerprint, [])
        if matches:
            match = matches[0]
            if _runtime_record(match) == candidate_runtime | {"id": match.id}:
                deduplicated.append(match.id)
            else:
                conflicts.append(CloudSyncConflict(
                    "fingerprint_content_mismatch", question_id, match.id,
                    "相同题干和选项的云端题目与本地答案或内容不一致。",
                ))
            continue
        planned = planned_fingerprints.get(fingerprint)
        if planned is not None:
            if _runtime_record(planned) == candidate_runtime | {"id": planned.id}:
                deduplicated.append(planned.id)
            else:
                conflicts.append(CloudSyncConflict(
                    "cloud_fingerprint_content_mismatch", question_id, planned.id,
                    "云端批次内相同题干和选项的内容不一致。",
                ))
            continue
        planned_fingerprints[fingerprint] = candidate
        synced.append(candidate)

    merged = tuple(sorted((*local_questions, *synced), key=lambda question: question.id))
    return CloudSyncPlan(
        merged_questions=merged,
        synced=tuple(sorted(synced, key=lambda question: question.id)),
        deduplicated=tuple(sorted(set(deduplicated))),
        skipped=tuple(skipped),
        conflicts=tuple(conflicts),
        generated_ids=tuple(
            question.id for question in sorted(synced, key=lambda question: question.id)
            if question.id in generated_id_candidates
        ),
    )
