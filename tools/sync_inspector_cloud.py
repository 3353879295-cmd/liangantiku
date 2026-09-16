"""Read an active WeChat cloud release and atomically plan it into inspector JSONL."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable, Mapping
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = PROJECT_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from grain_quiz.catalog import load_knowledge_catalog
from grain_quiz.inspector_cloud_sync import INSPECTOR_CODE, CloudSyncValidationError, plan_inspector_cloud_sync
from grain_quiz.io import load_questions, load_sources
from grain_quiz.models import Question
from grain_quiz.taxonomy import load_taxonomy
from grain_quiz.validate import validate_dataset


APP_ID = "wx84ecacec08ca162c"
ENV_ID = "cloud1-d2gglad830c91db10"
CLIENT_NAME = "codex-sync"
WECHATIDE = Path(r"C:\Program Files (x86)\Tencent\微信web开发者工具\wechatide.cmd")
COLLECTIONS = frozenset({"question_bank_config", "question_bank_releases", "question_bank_questions"})
PUBLISHED_LEVELS = (5, 4, 3, 2, 1)
ALL_LEVELS = (5, 4, 3, 2, 1)
PAGE_SIZE = 1000


class CloudReadError(ValueError):
    """Cloud records or the configured read-only target cannot be trusted."""


class FixtureCloudReader:
    """Deterministic reader used by tests and offline fixture runs."""

    def __init__(self, document: Mapping[str, Any]) -> None:
        self.document = document

    def get_config(self) -> Mapping[str, Any]:
        return _mapping(self.document.get("config"), "fixture config")

    def get_release(self, release_id: str) -> Mapping[str, Any]:
        release = _mapping(self.document.get("release"), "fixture release")
        if release.get("_id") != release_id:
            raise CloudReadError("fixture release ID does not match active config")
        return release

    def list_questions(self, release_id: str, level: int) -> list[Mapping[str, Any]]:
        records = self.document.get("questions")
        if not isinstance(records, list):
            raise CloudReadError("fixture questions must be an array")
        return [
            _mapping(item, "fixture question") for item in records
            if item.get("occupation") == INSPECTOR_CODE and item.get("level") == level
        ]

    def count_questions(self, release_id: str, level: int) -> int:
        return len(self.list_questions(release_id, level))


class WechatIdeCloudReader:
    """Minimal adapter which invokes only read-only WeChat IDE database commands."""

    def __init__(
        self,
        runner: Callable[[list[str]], str] | None = None,
        *,
        appid: str = APP_ID,
        env_id: str = ENV_ID,
    ) -> None:
        if appid != APP_ID:
            raise CloudReadError(f"appid must be {APP_ID}")
        if env_id != ENV_ID:
            raise CloudReadError(f"environment must be {ENV_ID}")
        self._runner = runner or self._run_wechatide

    @staticmethod
    def _run_wechatide(command: list[str]) -> str:
        try:
            completed = subprocess.run(
                command,
                check=True,
                capture_output=True,
                encoding="utf-8",
            )
        except (OSError, subprocess.CalledProcessError) as error:
            raise CloudReadError(f"WeChat IDE read failed: {error}") from error
        return completed.stdout

    def _read(
        self,
        collection: str,
        query: Mapping[str, Any],
        *,
        limit: int,
        offset: int = 0,
        sort: list[Mapping[str, Any]] | None = None,
    ) -> tuple[list[Mapping[str, Any]], int]:
        if collection not in COLLECTIONS:
            raise CloudReadError(f"unknown cloud collection: {collection}")
        with tempfile.TemporaryDirectory(prefix="inspector-cloud-read-") as name:
            query_path = Path(name) / "query.json"
            query_path.write_text(
                json.dumps(query, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            command = [
                str(WECHATIDE), "-c", CLIENT_NAME, "cloud_db_read_doc",
                "--appid", APP_ID, "--env", ENV_ID,
                "--collection-name", collection,
                "--query-file", str(query_path),
                "--limit", str(limit), "--offset", str(offset),
            ]
            if sort is not None:
                sort_path = Path(name) / "sort.json"
                sort_path.write_text(
                    json.dumps(sort, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )
                command.extend(("--sort-file", str(sort_path)))
            return _wechatide_page(self._runner(command), collection)

    def _read_one(self, collection: str, query: Mapping[str, Any]) -> Mapping[str, Any]:
        rows, total = self._read(collection, query, limit=2)
        if total != 1 or len(rows) != 1:
            raise CloudReadError(f"expected exactly one document in {collection}, got {total}")
        return rows[0]

    def get_config(self) -> Mapping[str, Any]:
        return self._read_one("question_bank_config", {"_id": "active"})

    def get_release(self, release_id: str) -> Mapping[str, Any]:
        return self._read_one("question_bank_releases", {"_id": release_id})

    def list_questions(self, release_id: str, level: int) -> list[Mapping[str, Any]]:
        query = {"release_id": release_id, "occupation": INSPECTOR_CODE, "level": level}
        records: list[Mapping[str, Any]] = []
        offset = 0
        while True:
            page, total = self._read(
                "question_bank_questions",
                query,
                limit=PAGE_SIZE,
                offset=offset,
                sort=[{"key": "question_id", "direction": 1}],
            )
            records.extend(page)
            offset += len(page)
            if offset >= total:
                return records
            if not page:
                raise CloudReadError("cloud pagination stopped before the reported total")

    def count_questions(self, release_id: str, level: int) -> int:
        _, total = self._read(
            "question_bank_questions",
            {"release_id": release_id, "occupation": INSPECTOR_CODE, "level": level},
            limit=1,
        )
        return total


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise CloudReadError(f"{label} must be an object")
    return value


def _json_object(value: str, label: str) -> Mapping[str, Any]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise CloudReadError(f"invalid JSON returned for {label}: {error}") from error
    return _mapping(parsed, label)


def _wechatide_page(value: str, collection: str) -> tuple[list[Mapping[str, Any]], int]:
    start = value.find("{")
    if start < 0:
        raise CloudReadError(f"WeChat IDE returned no JSON for {collection}")
    envelope = _json_object(value[start:], f"WeChat IDE {collection} response")
    result = _mapping(envelope.get("result"), f"WeChat IDE {collection} result")
    if envelope.get("ok") is not True or result.get("success") is not True:
        raise CloudReadError(f"WeChat IDE could not read {collection}")
    data = result.get("data")
    total = result.get("total")
    if not isinstance(data, list) or not isinstance(total, int) or isinstance(total, bool) or total < 0:
        raise CloudReadError(f"WeChat IDE returned an invalid page for {collection}")
    return [_mapping(item, f"{collection} document") for item in data], total


def _release_count(release: Mapping[str, Any], level: int) -> int:
    counts = release.get("shard_counts")
    if not isinstance(counts, Mapping):
        raise CloudReadError("release shard_counts must be an object")
    candidates = (f"inspector_l{level}", f"inspector_l{level}.json", f"inspector_l{level}.jsonl")
    values = [counts[name] for name in candidates if name in counts]
    if len(values) != 1 or not isinstance(values[0], int) or isinstance(values[0], bool) or values[0] < 0:
        raise CloudReadError(f"release shard_counts must contain one non-negative inspector L{level} count")
    return values[0]


def _validate_release(release: Mapping[str, Any], release_id: str) -> None:
    if release.get("_id") != release_id or release.get("status") != "active":
        raise CloudReadError("active config must point to an active matching release")
    question_count = release.get("question_count")
    counts = release.get("shard_counts")
    if not isinstance(question_count, int) or isinstance(question_count, bool) or question_count < 0:
        raise CloudReadError("release question_count must be a non-negative integer")
    if not isinstance(counts, Mapping) or any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts.values()):
        raise CloudReadError("release shard_counts must contain non-negative integers")
    if sum(counts.values()) != question_count:
        raise CloudReadError("release question_count does not equal shard_counts total")


def _release_timestamp(release: Mapping[str, Any]) -> datetime:
    value = release.get("activated_at") or release.get("created_at")
    if not isinstance(value, str):
        raise CloudReadError("release must contain activated_at or created_at")
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise CloudReadError("release timestamp must be ISO-8601") from error
    if timestamp.tzinfo is None:
        raise CloudReadError("release timestamp must include timezone")
    return timestamp


def _load_local_inspector_questions(question_dir: Path) -> list[Question]:
    questions: list[Question] = []
    for level in PUBLISHED_LEVELS:
        path = question_dir / f"inspector_l{level}.jsonl"
        if not path.exists():
            if level in {2, 1}:
                continue
            raise CloudReadError(f"missing local inspector shard: {path}")
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                questions.append(Question.model_validate_json(line))
            except ValidationError as error:
                raise CloudReadError(f"invalid local question {path}:{line_number}: {error}") from error
    return questions


def _replace_staged(source: Path, target: Path) -> None:
    source.replace(target)


def _write_atomically(root: Path, questions: tuple[Question, ...], report: Mapping[str, Any]) -> None:
    question_dir = root / "data" / "questions"
    targets: list[tuple[Path, Path]] = []
    with tempfile.TemporaryDirectory(prefix=".inspector-cloud-sync-", dir=str(root / "data")) as name:
        staging = Path(name)
        for level in PUBLISHED_LEVELS:
            staged = staging / f"inspector_l{level}.jsonl"
            rows = [item for item in questions if item.level == level]
            staged.write_text(
                "".join(json.dumps(item.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")) + "\n" for item in rows),
                encoding="utf-8",
            )
            targets.append((staged, question_dir / f"inspector_l{level}.jsonl"))
        staged_report = staging / "report.json"
        staged_report.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        targets.append((staged_report, root / "data" / "inspector_cloud_sync_report.json"))
        backup_dir = staging / "backups"
        backup_dir.mkdir()
        backups: dict[Path, Path | None] = {}
        for index, (_, target) in enumerate(targets):
            if target.exists():
                backup = backup_dir / f"{index}-{target.name}"
                shutil.copy2(target, backup)
                backups[target] = backup
            else:
                backups[target] = None
        try:
            for staged, target in targets:
                _replace_staged(staged, target)
        except Exception:
            for _, target in reversed(targets):
                backup = backups[target]
                if backup is not None and backup.exists():
                    backup.replace(target)
                elif target.exists():
                    target.unlink()
            raise


def sync_inspector_cloud(root: Path, reader: Any) -> dict[str, Any]:
    """Read, validate, plan, and commit inspector data without any cloud write operation."""
    config = _mapping(reader.get_config(), "active config")
    release_id = config.get("active_release_id")
    if not isinstance(release_id, str) or not release_id.strip():
        raise CloudReadError("active config must contain active_release_id")
    release = _mapping(reader.get_release(release_id), "active release")
    _validate_release(release, release_id)
    cloud_documents: list[Mapping[str, Any]] = []
    level_counts: dict[str, int] = {}
    for level in ALL_LEVELS:
        expected = _release_count(release, level)
        actual = reader.count_questions(release_id, level)
        if actual != expected:
            raise CloudReadError(f"release shard_counts mismatch for inspector L{level}: expected {expected}, got {actual}")
        level_counts[f"L{level}"] = actual
        if level in PUBLISHED_LEVELS:
            rows = reader.list_questions(release_id, level)
            if len(rows) != expected:
                raise CloudReadError(f"release shard_counts mismatch for inspector L{level}: expected {expected}, got {len(rows)}")
            cloud_documents.extend(rows)
    data = root / "data"
    catalog = load_knowledge_catalog(data / "knowledge_catalog.json")
    taxonomy = load_taxonomy(data / "taxonomy.json")
    sources = load_sources(data / "sources.json")
    local_inspector = _load_local_inspector_questions(data / "questions")
    plan = plan_inspector_cloud_sync(
        cloud_documents,
        local_inspector,
        catalog,
        taxonomy,
        sources,
        release_id,
        _release_timestamp(release),
    )
    local_non_inspector = [
        question
        for question in load_questions(data / "questions")
        if question.occupation_code.value != INSPECTOR_CODE
    ]
    validation = validate_dataset(
        [*local_non_inspector, *plan.merged_questions],
        sources,
        taxonomy,
        catalog,
    )
    if validation.errors:
        details = "; ".join(
            f"{issue.code}{f' {issue.question_id}' if issue.question_id else ''}: {issue.message}"
            for issue in validation.errors
        )
        raise CloudReadError(f"merged question validation failed: {details}")
    skipped_unpublished = 0
    report = {
        "appid": APP_ID,
        "environment": ENV_ID,
        "collections": sorted(COLLECTIONS),
        "release_id": release_id,
        "release_created_at": release.get("created_at"),
        "release_activated_at": release.get("activated_at"),
        "release_question_count": release.get("question_count"),
        "source_digest": release.get("source_digest"),
        "catalog_digest": release.get("catalog_digest"),
        "questions_digest": release.get("questions_digest"),
        "synced": len(plan.synced),
        "deduplicated": len(plan.deduplicated),
        "skipped": len(plan.skipped) + skipped_unpublished,
        "skipped_unpublished": skipped_unpublished,
        "conflicts": [asdict(conflict) for conflict in plan.conflicts],
        "generated_ids": list(plan.generated_ids),
        "validation_warnings": len(validation.warnings),
        "cloud_level_counts": level_counts,
        "before_local_level_counts": {
            f"L{level}": sum(item.level == level for item in local_inspector)
            for level in PUBLISHED_LEVELS
        },
        "after_local_level_counts": {
            f"L{level}": sum(item.level == level for item in plan.merged_questions)
            for level in PUBLISHED_LEVELS
        },
    }
    _write_atomically(root, plan.merged_questions, report)
    return {**report, "conflicts": len(plan.conflicts)}


def sync_fixture(root: Path, fixture: Mapping[str, Any]) -> dict[str, Any]:
    return sync_inspector_cloud(root, FixtureCloudReader(fixture))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--fixture", type=Path, help="offline JSON fixture; no WeChat login is required")
    args = parser.parse_args(argv)
    if args.fixture is None:
        result = sync_inspector_cloud(args.root, WechatIdeCloudReader())
    else:
        result = sync_fixture(args.root, _json_object(args.fixture.read_text(encoding="utf-8"), "fixture"))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
