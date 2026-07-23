"""Command-line entry point for the grain question-bank pipeline."""

import argparse
import json
from pathlib import Path

from grain_quiz.dedupe import find_duplicates
from grain_quiz.export import export_json_shards, export_workbook
from grain_quiz.io import load_questions, load_sources
from grain_quiz.stats import build_stats
from grain_quiz.taxonomy import load_taxonomy
from grain_quiz.validate import ValidationReport, validate_dataset


def main(argv: list[str] | None = None) -> int:
    """Run a question-bank command and return its process exit code."""
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "dedupe":
        return _dedupe(Path(args.questions), args.threshold)

    questions, sources, report = _load_and_validate(args)
    _print_validation_report(report)
    if args.command == "validate":
        return 1 if report.errors else 0
    if report.errors:
        return 1
    return _publish(
        questions,
        sources,
        report,
        Path(args.output),
        review_workbook=args.review_workbook,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="grain-quiz")
    subcommands = parser.add_subparsers(dest="command", required=True)

    validate = subcommands.add_parser("validate")
    _add_validation_inputs(validate)

    dedupe = subcommands.add_parser("dedupe")
    dedupe.add_argument("--questions", required=True)
    dedupe.add_argument("--threshold", type=float, default=92.0)

    for command in ("export", "build"):
        release = subcommands.add_parser(command)
        _add_validation_inputs(release)
        release.add_argument("--output", required=True)
        release.add_argument(
            "--review-workbook",
            action="store_true",
            help="also create question-bank.xlsx (requires the optional artifact-tool runtime)",
        )
    return parser


def _add_validation_inputs(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--questions", required=True)
    parser.add_argument("--sources", required=True)
    parser.add_argument("--taxonomy", required=True)


def _load_and_validate(
    args: argparse.Namespace,
) -> tuple[list, dict, ValidationReport]:
    questions = load_questions(Path(args.questions))
    sources = load_sources(Path(args.sources))
    taxonomy = load_taxonomy(Path(args.taxonomy))
    return questions, sources, validate_dataset(questions, sources, taxonomy)


def _dedupe(question_path: Path, threshold: float) -> int:
    report = find_duplicates(load_questions(question_path), threshold)
    for pair in report.exact:
        print(f"EXACT {pair.left_id} {pair.right_id} {pair.score:.1f}")
    for pair in report.near:
        print(f"NEAR {pair.left_id} {pair.right_id} {pair.score:.1f}")
    return 0


def _print_validation_report(report: ValidationReport) -> None:
    for issue in report.errors:
        _print_issue("ERROR", issue.code, issue.question_id, issue.message)
    for issue in report.warnings:
        _print_issue("WARNING", issue.code, issue.question_id, issue.message)


def _print_issue(prefix: str, code: str, question_id: str | None, message: str) -> None:
    identifier = f" {question_id}" if question_id else ""
    print(f"{prefix} {code}{identifier}: {message}")


def _publish(
    questions: list,
    sources: dict,
    report: ValidationReport,
    output: Path,
    *,
    review_workbook: bool,
) -> int:
    output.mkdir(parents=True, exist_ok=True)
    if review_workbook:
        export_workbook(questions, sources, report, output / "question-bank.xlsx")
    shard_counts = export_json_shards(questions, output / "json")
    version_report = _version_report(questions, sources, report, shard_counts)
    (output / "version-report.json").write_text(
        json.dumps(version_report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Published release artifacts to {output}")
    return 0


def _version_report(
    questions: list,
    sources: dict,
    report: ValidationReport,
    shard_counts: dict[str, int],
) -> dict[str, object]:
    stats = build_stats(questions)
    status_counts = stats["review_status"]
    return {
        "validation_errors": len(report.errors),
        "validation_warnings": len(report.warnings),
        "verified_questions": status_counts.get("verified", 0),
        "pending_questions": status_counts.get("pending", 0),
        "retired_questions": status_counts.get("retired", 0),
        "source_count": len(sources),
        "shard_counts": shard_counts,
        "statistics": stats,
    }


if __name__ == "__main__":
    raise SystemExit(main())
