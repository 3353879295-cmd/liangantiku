"""Deterministic JSONL readers and writers for question-bank records."""

import json
from pathlib import Path

from pydantic import ValidationError

from grain_quiz.models import Question, Source


def load_sources(path: Path) -> dict[str, Source]:
    """Load source records from a JSON array, indexed by source ID."""
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid source JSON in {path}: {error}") from error

    if not isinstance(rows, list):
        raise ValueError(f"source JSON in {path} must contain an array")

    sources: dict[str, Source] = {}
    for index, row in enumerate(rows, start=1):
        try:
            source = Source.model_validate(row)
        except ValidationError as error:
            raise ValueError(f"invalid source in {path}:{index}: {error}") from error
        if source.id in sources:
            raise ValueError(f"duplicate source ID: {source.id}")
        sources[source.id] = source
    return sources


def load_questions(directory: Path) -> list[Question]:
    """Load every JSONL question record in a directory in stable ID order."""
    questions: list[Question] = []
    for path in sorted(directory.glob("*.jsonl")):
        for line_number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(),
            start=1,
        ):
            if not line.strip():
                continue
            try:
                questions.append(Question.model_validate_json(line))
            except ValidationError as error:
                raise ValueError(f"invalid question at {path}:{line_number}: {error}") from error
    return sorted(questions, key=lambda question: question.id)


def write_questions(path: Path, questions: list[Question]) -> None:
    """Write validated question records as compact, stably sorted JSONL."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        for question in sorted(questions, key=lambda item: item.id):
            output.write(
                json.dumps(
                    question.model_dump(mode="json"),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
            output.write("\n")
