"""Review workbook and runtime JSON shard exports."""

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import asdict
from pathlib import Path

from grain_quiz.catalog import KnowledgeCatalog
from grain_quiz.models import Question, ReviewStatus, Source
from grain_quiz.stats import build_stats
from grain_quiz.validate import ValidationReport


_ROOT = Path(__file__).resolve().parents[2]
_WORKBOOK_BUILDER = _ROOT / "tools" / "review_workbook.mjs"
_SHARDS = (
    ("warehouse_l5.json", "4-02-06-01", 5),
    ("warehouse_l4.json", "4-02-06-01", 4),
    ("warehouse_l3.json", "4-02-06-01", 3),
    ("warehouse_l2.json", "4-02-06-01", 2),
    ("warehouse_l1.json", "4-02-06-01", 1),
    ("inspector_l5.json", "4-08-05-01", 5),
    ("inspector_l4.json", "4-08-05-01", 4),
    ("inspector_l3.json", "4-08-05-01", 3),
    ("inspector_l2.json", "4-08-05-01", 2),
    ("inspector_l1.json", "4-08-05-01", 1),
)


def export_workbook(
    questions: list[Question],
    sources: dict[str, Source],
    report: ValidationReport,
    output: Path,
) -> None:
    """Create the optional review workbook through an artifact-tool runtime."""
    node = _resolve_node()
    if not _WORKBOOK_BUILDER.is_file():
        raise RuntimeError(f"workbook builder is unavailable: {_WORKBOOK_BUILDER}")

    payload = {
        "questions": [
            question.model_dump(mode="json")
            for question in sorted(questions, key=lambda item: item.id)
        ],
        "sources": [
            source.model_dump(mode="json")
            for _, source in sorted(sources.items())
        ],
        "report": {
            "errors": [asdict(issue) for issue in report.errors],
            "warnings": [asdict(issue) for issue in report.warnings],
        },
        "stats": build_stats(questions),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="grain-quiz-workbook-") as temporary:
        input_path = Path(temporary) / "workbook-input.json"
        input_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        result = subprocess.run(
            [node, str(_WORKBOOK_BUILDER), "build", str(input_path), str(output)],
            cwd=_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(f"artifact-tool workbook build failed: {detail}")


def _resolve_node() -> str:
    configured = os.environ.get("GRAIN_QUIZ_NODE")
    if configured:
        path = Path(configured)
        if path.is_file():
            return str(path)
        raise RuntimeError(f"GRAIN_QUIZ_NODE does not point to a file: {path}")
    discovered = shutil.which("node")
    if discovered:
        return discovered
    raise RuntimeError(
        "Node.js is required for --review-workbook; install Node or set GRAIN_QUIZ_NODE"
    )


def export_json_shards(questions: list[Question], output_dir: Path) -> dict[str, int]:
    """Export all verified-only runtime shards in stable ID order."""
    output_dir.mkdir(parents=True, exist_ok=True)
    verified = [
        question
        for question in questions
        if question.review_status == ReviewStatus.VERIFIED
    ]
    counts: dict[str, int] = {}
    for filename, occupation_code, level in _SHARDS:
        records = [
            _runtime_record(question)
            for question in sorted(verified, key=lambda item: item.id)
            if question.occupation_code.value == occupation_code and question.level == level
        ]
        (output_dir / filename).write_text(
            json.dumps(records, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        counts[filename] = len(records)
    return counts


def export_knowledge_catalog(catalog: KnowledgeCatalog, output: Path) -> None:
    """Export the stable runtime knowledge catalog."""
    output.write_text(
        json.dumps(
            catalog.runtime_document(),
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )


def _runtime_record(question: Question) -> dict[str, object]:
    """Select the stable fields consumed by the runtime question player."""
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
        "answer": question.answer,
        "explanation": question.explanation,
        "difficulty": question.difficulty.value,
        "keywords": question.keywords,
        "source_ids": question.source_ids,
        "standard_reference": question.standard_reference,
        "review_status": question.review_status.value,
        "content_version": question.content_version,
    }
