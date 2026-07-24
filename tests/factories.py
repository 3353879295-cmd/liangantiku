"""Reusable model fixtures for tests."""

import json
from pathlib import Path
from typing import Any


BASE: dict[str, Any] = {
    "id": "WH-L5-000001",
    "occupation_code": "4-02-06-01",
    "occupation_name": "test occupation",
    "direction": "test direction",
    "level": 5,
    "module": "test module",
    "topic": "test topic",
    "chapter_id": "warehouse-l5-c03",
    "section_id": "warehouse-l5-c03-s03",
    "type": "single",
    "stem": "test stem",
    "options": [
        {"key": "A", "text": "option A"},
        {"key": "B", "text": "option B"},
        {"key": "C", "text": "option C"},
        {"key": "D", "text": "option D"},
    ],
    "answer": ["A"],
    "explanation": "test explanation",
    "difficulty": "easy",
    "keywords": ["test"],
    "source_ids": ["SRC-0001"],
    "standard_reference": "test reference",
    "source_note": "test source note",
    "review_status": "pending",
    "valid_from": "2026-01-01",
    "valid_until": None,
    "duplicate_group": None,
    "content_version": 1,
    "created_at": "2026-01-01T00:00:00",
    "updated_at": "2026-01-01T00:00:00",
}

SOURCE: dict[str, Any] = {
    "id": "SRC-0001",
    "title": "test source",
    "url": "https://example.test/source",
    "publisher": "test publisher",
    "published_at": None,
    "accessed_at": "2026-01-01",
    "kind": "official_notice",
    "usage": "knowledge_basis",
    "is_active": True,
    "notes": "test only",
}


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    """Write dictionaries to a UTF-8 JSON Lines file."""
    with path.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False))
            output.write("\n")
