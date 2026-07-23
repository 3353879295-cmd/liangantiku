import json
from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog


CATALOG_PATH = Path("data/knowledge_catalog.json")


def test_warehouse_catalog_matches_confirmed_textbook_structure():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert catalog.counts("4-02-06-01") == {
        "parts": 4,
        "chapters": 11,
        "sections": 44,
    }
    assert catalog.allows(
        "4-02-06-01",
        5,
        "warehouse-basic-c01",
        "warehouse-basic-c01-s01",
    )
    assert catalog.allows(
        "4-02-06-01",
        3,
        "warehouse-l3-c11",
        "warehouse-l3-c11-s06",
    )
    assert not catalog.allows(
        "4-02-06-01",
        4,
        "warehouse-l3-c11",
        "warehouse-l3-c11-s06",
    )


def test_inspector_catalog_is_independent_and_available_to_every_level():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert catalog.counts("4-08-05-01") == {
        "parts": 1,
        "chapters": 8,
        "sections": 16,
    }
    assert catalog.allows(
        "4-08-05-01",
        5,
        "inspector-c02",
        "inspector-c02-s01",
    )
    assert catalog.allows(
        "4-08-05-01",
        3,
        "inspector-c08",
        "inspector-c08-s02",
    )


def test_catalog_rejects_duplicate_ids(tmp_path: Path):
    document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    first_part = document["occupations"]["4-02-06-01"]["parts"][0]
    first_part["chapters"][1]["id"] = first_part["chapters"][0]["id"]
    path = tmp_path / "duplicate.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicate catalog ID"):
        load_knowledge_catalog(path)
