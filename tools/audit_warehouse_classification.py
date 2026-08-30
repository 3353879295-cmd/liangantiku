"""Deterministic invariants and human-sample audits for warehouse classifications."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from grain_quiz.catalog import KnowledgeCatalog, load_knowledge_catalog


LEVELS = (5, 4, 3, 2, 1)
IMMUTABLE_FIELDS = (
    "id",
    "level",
    "stem",
    "options",
    "answer",
    "explanation",
    "source_ids",
    "source_note",
    "standard_reference",
    "created_at",
)
SAMPLE_FIELDS = (
    "question_id",
    "level",
    "chapter_id",
    "chapter_title",
    "section_id",
    "section_title",
    "stem",
    "source_note",
    "chapter_correct",
    "review_note",
)


class AuditError(RuntimeError):
    """Raised when a classification audit gate fails."""


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise AuditError(f"missing JSONL file: {path}")
    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise AuditError(f"invalid JSON at {path}:{line_number}: {error}") from error
        if not isinstance(value, dict):
            raise AuditError(f"JSONL record at {path}:{line_number} must be an object")
        records.append(value)
    return records


def _read_baseline(directory: Path) -> dict[int, dict[str, dict[str, Any]]]:
    result: dict[int, dict[str, dict[str, Any]]] = {}
    for level in LEVELS:
        rows = _read_jsonl(directory / f"warehouse_l{level}.jsonl")
        by_id: dict[str, dict[str, Any]] = {}
        for row in rows:
            question_id = row.get("id")
            if not isinstance(question_id, str) or not question_id:
                raise AuditError(f"baseline level {level} contains a record without id")
            if question_id in by_id:
                raise AuditError(f"duplicate baseline question id: {question_id}")
            by_id[question_id] = row
        result[level] = by_id
    return result


def _read_published(directory: Path) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for level in LEVELS:
        for row in _read_jsonl(directory / f"warehouse_l{level}.jsonl"):
            question_id = row.get("id")
            if not isinstance(question_id, str) or not question_id:
                raise AuditError(f"published level {level} contains a record without id")
            if question_id in by_id:
                raise AuditError(f"duplicate published question id: {question_id}")
            if int(row.get("level", -1)) != level:
                raise AuditError(f"published record {question_id} is in the wrong level shard")
            by_id[question_id] = row
    return by_id


def _read_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise AuditError(f"cannot read manifest {path}: {error}") from error
    if not isinstance(value, dict):
        raise AuditError("manifest must be an object")
    return value


def audit_invariants(
    *,
    baseline_dir: Path,
    questions_dir: Path,
    review_path: Path,
    manifest_path: Path,
) -> dict[str, Any]:
    baseline_by_level = _read_baseline(baseline_dir)
    published = _read_published(questions_dir)
    review = _read_jsonl(review_path)
    manifest = _read_manifest(manifest_path)

    baseline = {
        question_id: row
        for level_rows in baseline_by_level.values()
        for question_id, row in level_rows.items()
    }
    review_by_id: dict[str, dict[str, Any]] = {}
    for row in review:
        question_id = row.get("question_id")
        if not isinstance(question_id, str) or not question_id:
            raise AuditError("review record is missing question_id")
        if question_id in review_by_id:
            raise AuditError(f"duplicate review question id: {question_id}")
        review_by_id[question_id] = row

    baseline_ids = set(baseline)
    published_ids = set(published)
    review_ids = set(review_by_id)
    if published_ids & review_ids:
        raise AuditError("published and review question IDs overlap")
    if baseline_ids != published_ids | review_ids:
        missing = sorted(baseline_ids - published_ids - review_ids)
        extra = sorted((published_ids | review_ids) - baseline_ids)
        raise AuditError(f"baseline ID partition mismatch; missing={missing[:5]} extra={extra[:5]}")

    for question_id, after in published.items():
        before = baseline[question_id]
        for field in IMMUTABLE_FIELDS:
            if after.get(field) != before.get(field):
                raise AuditError(f"immutable field drift for {question_id}: {field}")

    manifest_baseline = manifest.get("baseline_counts")
    manifest_published = manifest.get("published_counts")
    manifest_pending = manifest.get("pending_counts")
    if not all(isinstance(value, dict) for value in (manifest_baseline, manifest_published, manifest_pending)):
        raise AuditError("manifest count fields must be objects")

    actual_baseline_counts = {str(level): len(baseline_by_level[level]) for level in LEVELS}
    actual_published_counts = {
        str(level): sum(1 for row in published.values() if int(row["level"]) == level)
        for level in LEVELS
    }
    actual_pending_counts = {
        str(level): sum(1 for row in review_by_id.values() if int(row.get("level", -1)) == level)
        for level in LEVELS
    }
    for label, expected, actual in (
        ("baseline_counts", manifest_baseline, actual_baseline_counts),
        ("published_counts", manifest_published, actual_published_counts),
        ("pending_counts", manifest_pending, actual_pending_counts),
    ):
        normalized = {str(key): int(value) for key, value in expected.items()}
        if normalized != actual:
            raise AuditError(f"manifest {label} mismatch: expected={normalized} actual={actual}")

    pending_manifest = manifest.get("pending")
    if not isinstance(pending_manifest, list):
        raise AuditError("manifest pending must be an array")
    expected_pending = sorted(
        [
            {
                "question_id": question_id,
                "level": int(row.get("level", baseline[question_id]["level"])),
                "reason": str(row.get("reason", "")),
            }
            for question_id, row in review_by_id.items()
        ],
        key=lambda item: item["question_id"],
    )
    if pending_manifest != expected_pending:
        raise AuditError("manifest pending records do not match review")

    baseline_count = len(baseline)
    published_count = len(published)
    pending_count = len(review_by_id)
    coverage = published_count / baseline_count if baseline_count else 0.0
    if int(manifest.get("baseline_total", baseline_count)) != baseline_count:
        raise AuditError("manifest baseline_total mismatch")
    if int(manifest.get("published_total", published_count)) != published_count:
        raise AuditError("manifest published_total mismatch")
    if int(manifest.get("pending_total", pending_count)) != pending_count:
        raise AuditError("manifest pending_total mismatch")
    if abs(float(manifest.get("coverage", coverage)) - coverage) > 1e-9:
        raise AuditError("manifest coverage mismatch")

    return {
        "baseline_count": baseline_count,
        "published_count": published_count,
        "pending_count": pending_count,
        "coverage": coverage,
        "baseline_counts": actual_baseline_counts,
        "published_counts": actual_published_counts,
        "pending_counts": actual_pending_counts,
    }


def _catalog_titles(
    catalog: KnowledgeCatalog,
    *,
    level: int,
    chapter_id: str,
    section_id: str,
) -> tuple[str, str]:
    occupation = catalog.occupations["4-02-06-01"]
    for part in occupation.parts:
        if level not in part.levels:
            continue
        for chapter in part.chapters:
            if chapter.id != chapter_id:
                continue
            for section in chapter.sections:
                if section.id == section_id:
                    return chapter.title, section.title
    raise AuditError(f"catalog path not found: L{level} {chapter_id}/{section_id}")


def _sample_records(
    questions_dir: Path,
    *,
    catalog: KnowledgeCatalog,
    per_level: int,
) -> list[dict[str, Any]]:
    if per_level <= 0:
        raise AuditError("per_level must be positive")
    selected: list[dict[str, Any]] = []
    for level in LEVELS:
        rows = [row for row in _read_jsonl(questions_dir / f"warehouse_l{level}.jsonl") if int(row["level"]) == level]
        by_chapter: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in rows:
            by_chapter[str(row["chapter_id"])].append(row)
        for chapter_rows in by_chapter.values():
            chapter_rows.sort(key=lambda row: hashlib.sha256(str(row["id"]).encode("utf-8")).hexdigest())
        chapter_ids = sorted(by_chapter)
        positions = {chapter_id: 0 for chapter_id in chapter_ids}
        while len([row for row in selected if int(row["level"]) == level]) < per_level:
            progressed = False
            for chapter_id in chapter_ids:
                index = positions[chapter_id]
                chapter_rows = by_chapter[chapter_id]
                if index >= len(chapter_rows):
                    continue
                row = chapter_rows[index]
                positions[chapter_id] += 1
                chapter_title, section_title = _catalog_titles(
                    catalog,
                    level=level,
                    chapter_id=str(row["chapter_id"]),
                    section_id=str(row["section_id"]),
                )
                selected.append(
                    {
                        "question_id": row["id"],
                        "level": level,
                        "chapter_id": row["chapter_id"],
                        "chapter_title": chapter_title,
                        "section_id": row["section_id"],
                        "section_title": section_title,
                        "stem": row["stem"],
                        "source_note": row.get("source_note", ""),
                        "chapter_correct": "",
                        "review_note": "",
                    }
                )
                progressed = True
                if len([item for item in selected if int(item["level"]) == level]) >= per_level:
                    break
            if not progressed:
                raise AuditError(f"level {level} has fewer than {per_level} published questions")
    return selected


def generate_sample(
    *,
    questions_dir: Path,
    catalog_path: Path,
    output_path: Path,
    per_level: int = 20,
) -> dict[str, Any]:
    catalog = load_knowledge_catalog(catalog_path)
    rows = _sample_records(questions_dir, catalog=catalog, per_level=per_level)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=SAMPLE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    return {"sample_count": len(rows), "per_level": per_level, "output": str(output_path)}


def verify_sample(
    *,
    sample_path: Path,
    report_path: Path,
    output_summary_path: Path,
    expected_count: int = 100,
) -> dict[str, Any]:
    with sample_path.open("r", encoding="utf-8", newline="") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != expected_count:
        raise AuditError(f"sample must contain {expected_count} rows, got {len(rows)}")
    for row in rows:
        if any(not row.get(field, "").strip() for field in SAMPLE_FIELDS[:-2]):
            raise AuditError(f"sample row {row.get('question_id', '<unknown>')} has blank required fields")
        if row.get("chapter_correct") not in {"yes", "no"}:
            raise AuditError(f"sample row {row.get('question_id', '<unknown>')} must set chapter_correct to yes/no")

    def accuracy(group: list[dict[str, str]]) -> float:
        return sum(row["chapter_correct"] == "yes" for row in group) / len(group) if group else 0.0

    level_accuracy = {
        level: accuracy([row for row in rows if int(row["level"]) == level])
        for level in LEVELS
    }
    chapter_groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        chapter_groups[row["chapter_id"]].append(row)
    chapter_accuracy = {
        chapter_id: accuracy(group)
        for chapter_id, group in sorted(chapter_groups.items())
    }
    overall_accuracy = accuracy(rows)
    under_sampled_chapters = {
        chapter_id: len(group)
        for chapter_id, group in chapter_groups.items()
        if len(group) >= 3 and accuracy(group) < 0.85
    }
    if overall_accuracy < 0.90:
        raise AuditError(f"overall chapter accuracy {overall_accuracy:.2%} is below 90%")
    if under_sampled_chapters:
        raise AuditError(f"chapter accuracy gate failed: {under_sampled_chapters}")

    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise AuditError(f"cannot read classification report {report_path}: {error}") from error
    summary = {
        "overall_accuracy": overall_accuracy,
        "level_accuracy": {str(level): level_accuracy[level] for level in LEVELS},
        "chapter_accuracy": chapter_accuracy,
        "reviewed_count": len(rows),
        "classification_coverage": report.get("coverage"),
        "under_sampled_chapters": under_sampled_chapters,
    }
    output_summary_path.parent.mkdir(parents=True, exist_ok=True)
    output_summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    invariants = subparsers.add_parser("invariants")
    invariants.add_argument("--baseline-dir", required=True, type=Path)
    invariants.add_argument("--questions", required=True, type=Path)
    invariants.add_argument("--review", required=True, type=Path)
    invariants.add_argument("--manifest", required=True, type=Path)

    sample = subparsers.add_parser("sample")
    sample.add_argument("--audit", required=False, type=Path)
    sample.add_argument("--questions", required=True, type=Path)
    sample.add_argument("--catalog", required=True, type=Path)
    sample.add_argument("--output", required=True, type=Path)
    sample.add_argument("--per-level", required=False, type=int, default=20)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--sample", required=True, type=Path)
    verify.add_argument("--report", required=True, type=Path)
    verify.add_argument("--output-summary", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "invariants":
            summary = audit_invariants(
                baseline_dir=args.baseline_dir,
                questions_dir=args.questions,
                review_path=args.review,
                manifest_path=args.manifest,
            )
        elif args.command == "sample":
            summary = generate_sample(
                questions_dir=args.questions,
                catalog_path=args.catalog,
                output_path=args.output,
                per_level=args.per_level,
            )
        else:
            summary = verify_sample(
                sample_path=args.sample,
                report_path=args.report,
                output_summary_path=args.output_summary,
            )
    except (AuditError, ValueError) as error:
        print(f"audit failed: {error}")
        return 1
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
