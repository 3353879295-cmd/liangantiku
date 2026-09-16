import json
import hashlib
from pathlib import Path

import pytest

from grain_quiz.catalog import load_knowledge_catalog


CATALOG_PATH = Path("data/knowledge_catalog.json")


def _lines(value: str) -> tuple[str, ...]:
    return tuple(line.strip() for line in value.splitlines() if line.strip())


EXPECTED_OUTLINES = {
    "4-02-06-01": _lines(
        """
        part|warehouse-basic|1|基础知识|visible_levels=5,4,3,2,1
        chapter|warehouse-basic-c01|1|职业道德|page=2|visible_levels=5,4,3,2,1
        section|warehouse-basic-c01-s01|1|职业道德基础知识|page=2|visible_levels=5,4,3,2,1
        section|warehouse-basic-c01-s02|2|粮油仓储业从业人员职业守则|page=6|visible_levels=5,4,3,2,1
        section|warehouse-basic-c01-s00|3|本章综合考查|page=null|visible_levels=5,4,3,2,1
        chapter|warehouse-basic-c02|2|基础知识|page=9|visible_levels=5,4,3,2,1
        section|warehouse-basic-c02-s01|1|粮油仓储管理基础知识|page=9|visible_levels=5,4,3,2,1
        section|warehouse-basic-c02-s02|2|安全生产与环境保护基础知识|page=62|visible_levels=5,4,3,2,1
        section|warehouse-basic-c02-s03|3|相关法律法规基础知识|page=75|visible_levels=5,4,3,2,1
        section|warehouse-basic-c02-s00|4|本章综合考查|page=null|visible_levels=5,4,3,2,1
        part|warehouse-l5|2|初级粮油仓储管理员|visible_levels=5
        chapter|warehouse-l5-c03|3|粮油出入库作业|page=90|visible_levels=5
        section|warehouse-l5-c03-s01|1|粮油出入库准备|page=90|visible_levels=5
        section|warehouse-l5-c03-s02|2|粮油出入库作业|page=100|visible_levels=5
        section|warehouse-l5-c03-s03|3|粮油出入库收尾工作|page=131|visible_levels=5
        section|warehouse-l5-c03-s00|4|本章综合考查|page=null|visible_levels=5
        chapter|warehouse-l5-c04|4|粮情检查|page=140|visible_levels=5
        section|warehouse-l5-c04-s01|1|检查储粮温度|page=140|visible_levels=5
        section|warehouse-l5-c04-s02|2|检查储粮湿度|page=147|visible_levels=5
        section|warehouse-l5-c04-s03|3|使用电子气体检测仪检查粮堆气体成分|page=157|visible_levels=5
        section|warehouse-l5-c04-s04|4|检查储粮害虫|page=159|visible_levels=5
        section|warehouse-l5-c04-s05|5|检查鼠雀|page=165|visible_levels=5
        section|warehouse-l5-c04-s00|6|本章综合考查|page=null|visible_levels=5
        chapter|warehouse-l5-c05|5|粮情控制|page=173|visible_levels=5
        section|warehouse-l5-c05-s01|1|控制储存粮油温度|page=173|visible_levels=5
        section|warehouse-l5-c05-s02|2|控制储存粮油水分|page=175|visible_levels=5
        section|warehouse-l5-c05-s03|3|控制粮堆气体成分|page=179|visible_levels=5
        section|warehouse-l5-c05-s04|4|防治储粮害虫|page=186|visible_levels=5
        section|warehouse-l5-c05-s05|5|储粮鼠类防治|page=188|visible_levels=5
        section|warehouse-l5-c05-s00|6|本章综合考查|page=null|visible_levels=5
        part|warehouse-l4|3|中级粮油仓储管理员|visible_levels=4
        chapter|warehouse-l4-c06|6|粮油出入库作业|page=196|visible_levels=4
        section|warehouse-l4-c06-s01|1|粮油出入库准备|page=196|visible_levels=4
        section|warehouse-l4-c06-s02|2|粮油出入库作业|page=209|visible_levels=4
        section|warehouse-l4-c06-s03|3|粮油出入库收尾|page=226|visible_levels=4
        section|warehouse-l4-c06-s00|4|本章综合考查|page=null|visible_levels=4
        chapter|warehouse-l4-c07|7|粮情检查|page=230|visible_levels=4
        section|warehouse-l4-c07-s01|1|检查储粮温度|page=230|visible_levels=4
        section|warehouse-l4-c07-s02|2|检查储粮湿度和水分|page=235|visible_levels=4
        section|warehouse-l4-c07-s03|3|检测粮堆气体|page=241|visible_levels=4
        section|warehouse-l4-c07-s04|4|检查储粮害虫|page=244|visible_levels=4
        section|warehouse-l4-c07-s00|5|本章综合考查|page=null|visible_levels=4
        chapter|warehouse-l4-c08|8|粮情控制|page=250|visible_levels=4
        section|warehouse-l4-c08-s01|1|控制储存粮油温度|page=250|visible_levels=4
        section|warehouse-l4-c08-s02|2|控制储存粮油水分|page=273|visible_levels=4
        section|warehouse-l4-c08-s03|3|控制粮堆气体成分|page=277|visible_levels=4
        section|warehouse-l4-c08-s04|4|防治储粮害虫|page=279|visible_levels=4
        section|warehouse-l4-c08-s05|5|储粮鼠类防治|page=297|visible_levels=4
        section|warehouse-l4-c08-s00|6|本章综合考查|page=null|visible_levels=4
        part|warehouse-l3|4|高级粮油仓储管理员|visible_levels=3
        chapter|warehouse-l3-c09|9|粮油出入库管理|page=302|visible_levels=3
        section|warehouse-l3-c09-s01|1|粮油出入库准备|page=302|visible_levels=3
        section|warehouse-l3-c09-s02|2|粮油出入库作业|page=315|visible_levels=3
        section|warehouse-l3-c09-s03|3|粮油出入库收尾|page=328|visible_levels=3
        section|warehouse-l3-c09-s00|4|本章综合考查|page=null|visible_levels=3
        chapter|warehouse-l3-c10|10|粮情检查|page=340|visible_levels=3
        section|warehouse-l3-c10-s01|1|分析储粮温度变化原因|page=340|visible_levels=3
        section|warehouse-l3-c10-s02|2|分析储粮水分变化原因|page=343|visible_levels=3
        section|warehouse-l3-c10-s03|3|检测粮堆气体|page=345|visible_levels=3
        section|warehouse-l3-c10-s04|4|检查储粮害虫|page=349|visible_levels=3
        section|warehouse-l3-c10-s05|5|检查储油质量|page=355|visible_levels=3
        section|warehouse-l3-c10-s00|6|本章综合考查|page=null|visible_levels=3
        chapter|warehouse-l3-c11|11|粮情控制|page=372|visible_levels=3
        section|warehouse-l3-c11-s01|1|控制储存粮油温度|page=372|visible_levels=3
        section|warehouse-l3-c11-s02|2|控制储存粮油水分|page=380|visible_levels=3
        section|warehouse-l3-c11-s03|3|控制粮堆气体成分|page=383|visible_levels=3
        section|warehouse-l3-c11-s04|4|防治储粮害虫|page=388|visible_levels=3
        section|warehouse-l3-c11-s05|5|防治鼠雀|page=399|visible_levels=3
        section|warehouse-l3-c11-s06|6|防治储粮发热霉变|page=402|visible_levels=3
        section|warehouse-l3-c11-s00|7|本章综合考查|page=null|visible_levels=3
        part|warehouse-l2|5|技师粮油仓储管理员|visible_levels=2
        chapter|warehouse-l2-c01|1|粮油出入库管理|page=null|visible_levels=2
        section|warehouse-l2-c01-s01|1|粮油出入库准备|page=null|visible_levels=2
        section|warehouse-l2-c01-s00|2|本章综合考查|page=null|visible_levels=2
        chapter|warehouse-l2-c02|2|粮情检查|page=null|visible_levels=2
        section|warehouse-l2-c02-s01|1|粮堆气体成分|page=null|visible_levels=2
        section|warehouse-l2-c02-s02|2|储粮虫害|page=null|visible_levels=2
        section|warehouse-l2-c02-s03|3|粮油储藏品质|page=null|visible_levels=2
        section|warehouse-l2-c02-s04|4|发热与霉变|page=null|visible_levels=2
        section|warehouse-l2-c02-s00|5|本章综合考查|page=null|visible_levels=2
        chapter|warehouse-l2-c03|3|粮情控制|page=null|visible_levels=2
        section|warehouse-l2-c03-s01|1|储粮温度|page=null|visible_levels=2
        section|warehouse-l2-c03-s02|2|储粮水分|page=null|visible_levels=2
        section|warehouse-l2-c03-s03|3|粮堆气体成分|page=null|visible_levels=2
        section|warehouse-l2-c03-s04|4|储粮虫害|page=null|visible_levels=2
        section|warehouse-l2-c03-s05|5|储粮发热与霉变|page=null|visible_levels=2
        section|warehouse-l2-c03-s06|6|储粮效益分析|page=null|visible_levels=2
        section|warehouse-l2-c03-s00|7|本章综合考查|page=null|visible_levels=2
        chapter|warehouse-l2-c04|4|培训指导|page=null|visible_levels=2
        section|warehouse-l2-c04-s01|1|培训|page=null|visible_levels=2
        section|warehouse-l2-c04-s02|2|指导|page=null|visible_levels=2
        section|warehouse-l2-c04-s03|3|专业技术报告|page=null|visible_levels=2
        section|warehouse-l2-c04-s00|4|本章综合考查|page=null|visible_levels=2
        part|warehouse-l1|6|高级技师粮油仓储管理员|visible_levels=1
        chapter|warehouse-l1-c01|1|粮油出入库管理|page=null|visible_levels=1
        section|warehouse-l1-c01-s01|1|粮油出入库准备|page=null|visible_levels=1
        section|warehouse-l1-c01-s00|2|本章综合考查|page=null|visible_levels=1
        chapter|warehouse-l1-c02|2|粮情检查|page=null|visible_levels=1
        section|warehouse-l1-c02-s01|1|储粮虫害|page=null|visible_levels=1
        section|warehouse-l1-c02-s02|2|粮油储藏品质|page=null|visible_levels=1
        section|warehouse-l1-c02-s00|3|本章综合考查|page=null|visible_levels=1
        chapter|warehouse-l1-c03|3|粮情控制|page=null|visible_levels=1
        section|warehouse-l1-c03-s01|1|储粮温度|page=null|visible_levels=1
        section|warehouse-l1-c03-s02|2|储粮水分|page=null|visible_levels=1
        section|warehouse-l1-c03-s03|3|储粮虫害|page=null|visible_levels=1
        section|warehouse-l1-c03-s04|4|储粮品质|page=null|visible_levels=1
        section|warehouse-l1-c03-s00|5|本章综合考查|page=null|visible_levels=1
        chapter|warehouse-l1-c04|4|粮油储藏工艺设计|page=null|visible_levels=1
        section|warehouse-l1-c04-s01|1|低温储粮|page=null|visible_levels=1
        section|warehouse-l1-c04-s02|2|储粮调质通风|page=null|visible_levels=1
        section|warehouse-l1-c04-s03|3|气调储粮|page=null|visible_levels=1
        section|warehouse-l1-c04-s04|4|储粮效益分析|page=null|visible_levels=1
        section|warehouse-l1-c04-s00|5|本章综合考查|page=null|visible_levels=1
        chapter|warehouse-l1-c05|5|培训指导|page=null|visible_levels=1
        section|warehouse-l1-c05-s01|1|培训|page=null|visible_levels=1
        section|warehouse-l1-c05-s02|2|指导|page=null|visible_levels=1
        section|warehouse-l1-c05-s03|3|专业技术报告|page=null|visible_levels=1
        section|warehouse-l1-c05-s00|4|本章综合考查|page=null|visible_levels=1
        """
    ),
}


EXPECTED_INSPECTOR_OUTLINE_SHA256 = "cb6744460bbd4abe7cc5da74f50b600e4e9f662b31973db1eef3274910232989"


def _catalog_outline(catalog, occupation_code: str) -> tuple[str, ...]:
    lines: list[str] = []
    for part in catalog.occupations[occupation_code].parts:
        visible_levels = ",".join(str(level) for level in part.levels)
        lines.append(
            f"part|{part.id}|{part.number}|{part.title}"
            f"|visible_levels={visible_levels}"
        )
        for chapter in part.chapters:
            chapter_page = "null" if chapter.page is None else str(chapter.page)
            lines.append(
                f"chapter|{chapter.id}|{chapter.number}|{chapter.title}"
                f"|page={chapter_page}|visible_levels={visible_levels}"
            )
            for section in chapter.sections:
                section_page = "null" if section.page is None else str(section.page)
                lines.append(
                    f"section|{section.id}|{section.number}|{section.title}"
                    f"|page={section_page}|visible_levels={visible_levels}"
                )
    return tuple(lines)


def _write_document(tmp_path: Path, document: object) -> Path:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
    return path


def test_catalog_locks_every_title_page_id_order_and_visible_level():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert {
        code: occupation.title
        for code, occupation in catalog.occupations.items()
    } == {
        "4-02-06-01": "粮油仓储管理员",
        "4-08-05-01": "粮油质量检验员",
    }
    assert _catalog_outline(catalog, "4-02-06-01") == EXPECTED_OUTLINES["4-02-06-01"]
    inspector_outline = _catalog_outline(catalog, "4-08-05-01")
    assert hashlib.sha256("\n".join(inspector_outline).encode()).hexdigest() == (
        EXPECTED_INSPECTOR_OUTLINE_SHA256
    )
    assert 'section|inspector-basic-c03-s03|3|"中国好粮油"标准|page=null|visible_levels=5,4,3' in inspector_outline
    assert 'chapter|inspector-l3-c29|29|黄曲霉毒素B₁的测定|page=null|visible_levels=3' in inspector_outline


def test_runtime_document_round_trips_the_canonical_json():
    document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    catalog = load_knowledge_catalog(CATALOG_PATH)

    runtime_document = catalog.runtime_document()

    assert runtime_document == document
    assert json.loads(json.dumps(runtime_document, ensure_ascii=False)) == document


def test_inspector_catalog_digest_rejects_a_title_or_punctuation_mutation():
    outline = list(_catalog_outline(load_knowledge_catalog(CATALOG_PATH), "4-08-05-01"))
    target = 'section|inspector-basic-c03-s03|3|"中国好粮油"标准|page=null|visible_levels=5,4,3'
    index = outline.index(target)
    outline[index] = target.replace('"中国好粮油"标准', "中国好粮油标准")

    assert hashlib.sha256("\n".join(outline).encode()).hexdigest() != (
        EXPECTED_INSPECTOR_OUTLINE_SHA256
    )


def test_catalog_occupations_are_immutable():
    catalog = load_knowledge_catalog(CATALOG_PATH)
    original_document = catalog.runtime_document()

    with pytest.raises(AttributeError):
        getattr(catalog.occupations, "clear")()
    with pytest.raises(TypeError):
        catalog.occupations["new"] = catalog.occupations["4-02-06-01"]

    assert catalog.runtime_document() == original_document


def test_warehouse_catalog_matches_confirmed_five_level_structure():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert catalog.counts("4-02-06-01") == {"parts": 6, "chapters": 20, "sections": 92}
    assert catalog.allows("4-02-06-01", 1, "warehouse-basic-c02", "warehouse-basic-c02-s03")
    assert catalog.allows("4-02-06-01", 2, "warehouse-l2-c03", "warehouse-l2-c03-s04")
    assert catalog.allows("4-02-06-01", 1, "warehouse-l1-c04", "warehouse-l1-c04-s03")
    assert not catalog.allows("4-02-06-01", 1, "warehouse-import-c01", "warehouse-import-c01-s01")


def test_inspector_catalog_matches_the_confirmed_textbook_level_structure():
    catalog = load_knowledge_catalog(CATALOG_PATH)

    assert catalog.counts("4-08-05-01") == {
        "parts": 5,
        "chapters": 31,
        "sections": 117,
    }
    assert catalog.allows(
        "4-08-05-01",
        5,
        "inspector-basic-c01",
        "inspector-basic-c01-s01",
    )
    assert catalog.allows(
        "4-08-05-01",
        3,
        "inspector-l3-c30",
        "inspector-l3-c30-s02",
    )
    assert catalog.allows(
        "4-08-05-01",
        2,
        "inspector-import-c01",
        "inspector-import-c01-s01",
    )
    assert catalog.allows(
        "4-08-05-01",
        1,
        "inspector-import-c01",
        "inspector-import-c01-s01",
    )
    assert catalog.allows(
        "4-08-05-01",
        1,
        "inspector-import-c01",
        "inspector-import-c01-s01",
    )
    assert not catalog.allows(
        "4-08-05-01",
        2,
        "inspector-basic-c01",
        "inspector-basic-c01-s01",
    )


@pytest.mark.parametrize(
    ("level", "expected_parts"),
    ((5, ("inspector-basic", "inspector-l5")), (4, ("inspector-basic", "inspector-l4")), (3, ("inspector-basic", "inspector-l3")), (2, ("inspector-import",)), (1, ("inspector-import",))),
)
def test_inspector_visible_parts_match_its_certificate_level(level, expected_parts):
    occupation = load_knowledge_catalog(CATALOG_PATH).occupations["4-08-05-01"]
    visible = tuple(part.id for part in occupation.parts if level in part.levels)

    assert visible == expected_parts
    if level in {1, 2}:
        part = next(part for part in occupation.parts if part.id == "inspector-import")
        assert (part.title, part.chapters[0].title, part.chapters[0].sections[0].title) == (
            "质检员综合理论",
            "质检员综合理论",
            "质检员综合理论",
        )


def test_catalog_rejects_duplicate_ids(tmp_path: Path):
    document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    first_part = document["occupations"]["4-02-06-01"]["parts"][0]
    first_part["chapters"][1]["id"] = first_part["chapters"][0]["id"]
    path = tmp_path / "duplicate.json"
    path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ValueError, match="duplicate catalog ID"):
        load_knowledge_catalog(path)


@pytest.mark.parametrize("invalid_level", [5.0, True])
def test_catalog_levels_require_strict_integers(
    tmp_path: Path,
    invalid_level: object,
):
    document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    document["occupations"]["4-02-06-01"]["parts"][0]["levels"] = [invalid_level]
    path = _write_document(tmp_path, document)

    with pytest.raises(ValueError, match="invalid levels"):
        load_knowledge_catalog(path)


@pytest.mark.parametrize("node_kind", ["part", "chapter", "section"])
def test_catalog_rejects_non_object_nested_nodes(
    tmp_path: Path,
    node_kind: str,
):
    document = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    first_part = document["occupations"]["4-02-06-01"]["parts"][0]
    if node_kind == "part":
        document["occupations"]["4-02-06-01"]["parts"][0] = []
    elif node_kind == "chapter":
        first_part["chapters"][0] = []
    else:
        first_part["chapters"][0]["sections"][0] = []
    path = _write_document(tmp_path, document)

    with pytest.raises(ValueError, match=rf"{node_kind} must be an object"):
        load_knowledge_catalog(path)
