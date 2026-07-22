from datetime import date
from pathlib import Path

from grain_quiz.io import load_sources
from grain_quiz.models import SourceUsage


CATALOG_PATH = Path(__file__).parents[1] / "data" / "sources.json"


def test_source_catalog_contains_required_foundational_titles() -> None:
    sources = load_sources(CATALOG_PATH)
    titles = {source.title for source in sources.values()}

    assert {
        "（粮油）仓储管理员国家职业技能标准（2019年版）",
        "农产品食品检验员国家职业技能标准（2019年版）",
        "现行粮油行业标准目录",
    } <= titles


def test_source_catalog_has_unique_ids_and_nonfuture_dates() -> None:
    sources = load_sources(CATALOG_PATH)

    assert len(sources) == len({source.id for source in sources.values()})
    assert list(sources) == [f"SRC-{index:04d}" for index in range(1, len(sources) + 1)]
    for source in sources.values():
        assert source.accessed_at <= date.today()
        if source.published_at is not None:
            assert source.published_at <= date.today()


def test_source_catalog_has_active_knowledge_basis_for_each_occupation() -> None:
    sources = load_sources(CATALOG_PATH)

    active_knowledge_sources = [
        source
        for source in sources.values()
        if source.is_active and source.usage is SourceUsage.KNOWLEDGE_BASIS
    ]

    assert any("4-02-06-01" in source.notes for source in active_knowledge_sources)
    assert any("4-08-05-01" in source.notes for source in active_knowledge_sources)


def test_historic_or_bibliography_only_material_is_not_knowledge_basis() -> None:
    sources = load_sources(CATALOG_PATH)

    historic_source_ids = {"SRC-0012", "SRC-0013", "SRC-0014"}
    historic_sources = [sources[source_id] for source_id in historic_source_ids]

    assert all(not source.is_active for source in historic_sources)
    assert all(source.usage is SourceUsage.BIBLIOGRAPHY_ONLY for source in historic_sources)
    assert all(source.usage is not SourceUsage.KNOWLEDGE_BASIS for source in historic_sources)
