"""Rebuild the confirmed inspector catalog and classify its question files.

The rule table is deliberately deterministic.  It records the reviewed order
of topic keywords, with a level-specific default only for broad theory items.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

OCCUPATION = "4-08-05-01"
OUTLINE = (
    ("inspector-basic", 1, "基础知识", (5, 4, 3), "农产品食品检验员职业守则:职业道德/职业守则;粮食形态与化学组成:主要粮食品种的形态/粮食的主要化学成分;粮油标准基础知识:标准及标准化基础知识/主要粮油标准/\"中国好粮油\"标准/执行粮油质量国家标准的有关规定/粮油储藏过程质量管理要求;粮油检验基础:计量基础知识/粮油检验概述/粮油检验方法;安全操作:实验室安全操作/实验室常见事故的处理/环境保护知识;相关法律、法规及管理办法:《中华人民共和国劳动法》的相关知识/《中华人民共和国食品安全法》的相关知识/《中华人民共和国农产品质量安全法》的相关知识/《中华人民共和国产品质量法》的相关知识/《中华人民共和国标准化法》的相关知识/《中华人民共和国计量法》的相关知识/《粮食质量安全监管办法》的相关知识/《粮食流通管理条例》的相关知识/《中央储备粮管理条例》的相关知识"),
    ("inspector-l5", 2, "初级农产品食品检验员", (5,), "粮油样品的准备:样品的意义与分类/粮食、油料扦样用具及扦样方法/油脂扦样用具及扦样方法/样品的分样与保管/样品的制备;检验准备:玻璃器具使用与维护/实验室通用仪器设备使用与维护/实验室专用仪器设备使用与维护;原粮、油料物理检验:色泽、气味、口味鉴定/类型及互混测定/小麦硬度指数测定/杂质、不完善粒及有害籽粒测定/纯粮(质)率、完整粒率测定/容重的测定/稻谷出糙率的测定/整精米率的测定/稻米垩白度检验/黄粒米和裂纹粒检验;成品粮物理检验:小麦粉加工精度的检验/粉类粗细度的测定/粉类含砂量的测定/磁性金属物的测定/大米加工精度的检验/米类杂质及不完善粒的检验/碎米的检验;植物油脂物理检验:透明度、气味、滋味的测定/植物油脂色泽的测定/植物油脂相对密度的测定/植物油脂加热试验/植物油脂冷冻试验/植物油脂水分及挥发物的测定/植物油脂不溶性杂质含量的测定/植物油脂烟点测定;粮食水分、灰分检验:水分的测定/灰分的测定;标签标示:预包装食品标签通则/特殊标注内容/外包装标志要求;检验数据处理:原始记录规范/有效数字及数据修约规则"),
    ("inspector-l4", 3, "中级农产品食品检验员", (4,), "扦样方案制定与样品接收:扦样方案的制定/样品接收;检验仪器的准备:常用玻璃计量仪器的使用与校准/可见分光光度计/凯氏定氮装置/索氏抽提器与脂肪测定仪/面筋测定仪/降落数值仪;滴定分析基础知识:滴定分析方法/溶液的配制/标准滴定溶液的制备;粮食理化检验:面筋含量的测定/粗蛋白含量的测定/淀粉含量的测定/直链淀粉含量的测定/粗脂肪含量的测定/脂肪酸值的测定/蒸煮品质的测定/胶稠度的测定/降落数值的测定;植物油脂化学检验:油脂酸价的测定/油脂过氧化值的测定/植物油脂碘值的测定/油脂含皂量的测定/油脂不皂化物的测定;粮油质量近红外快速检测:近红外光谱分析的基础和应用特点/粮食中几种成分的近红外快速检测;检验结果数据处理:误差及数据处理基础知识/数据处理的基本方法/标准偏差及其计算"),
    ("inspector-l3", 4, "高级农产品食品检验员", (3,), "样品预处理技术:待测组分的提取/净化/浓缩;仪器分析基础知识:气相色谱法/原子吸收分光光度法/分析仪器的维护与故障检修;实验磨粉机及粉质仪:实验磨粉机/粉质仪;小麦、小麦粉食用品质评价技术:小麦制粉试验/小麦粉面团流变学特性测试——粉质仪法;油脂脂肪酸组成与溶剂残留的测定:油脂脂肪酸组成的测定/浸出油脂中残留溶剂的测定;农药的测定:磷化物的测定/有机氯农药残留量的测定/有机磷农药残留量的测定;金属元素的测定:粮油中钙的测定/粮油中铁的测定/粮油中锌的测定;黄曲霉毒素B₁的测定:概述/黄曲霉毒素B₁的测定;检验结果分析与处理:检验误差分析/回归分析"),
)

KEYWORDS = {
    5: (("职业守则", 1, 2), ("职业道德", 1, 1), ("安全", 5, 1), ("法规", 6, 7), ("标准", 3, 1), ("扦样", 7, 2), ("样品", 7, 5), ("器皿", 8, 1), ("仪器", 8, 2), ("水分", 12, 1), ("灰分", 12, 2), ("标签", 13, 1), ("记录", 14, 1), ("数据", 14, 2), ("油脂", 11, 1), ("大米", 10, 5), ("小麦", 9, 3)),
    4: (("扦样", 15, 1), ("样品", 15, 2), ("滴定", 17, 1), ("溶液", 17, 2), ("近红外", 20, 1), ("酸价", 19, 1), ("过氧化", 19, 2), ("油脂", 19, 3), ("面筋", 18, 1), ("蛋白", 18, 2), ("淀粉", 18, 3), ("脂肪", 18, 5), ("误差", 21, 1), ("标准偏差", 21, 3), ("数据", 21, 2), ("仪", 16, 1)),
    3: (("农药", 27, 2), ("磷化", 27, 1), ("金属", 28, 1), ("钙", 28, 1), ("铁", 28, 2), ("锌", 28, 3), ("黄曲霉", 29, 2), ("溶剂", 26, 2), ("脂肪酸", 26, 1), ("粉质", 24, 2), ("制粉", 25, 1), ("色谱", 23, 1), ("原子吸收", 23, 2), ("维护", 23, 3), ("故障", 23, 3), ("提取", 22, 1), ("净化", 22, 2), ("浓缩", 22, 3), ("回归", 30, 2), ("误差", 30, 1)),
}
DEFAULTS = {5: (4, 3), 4: (21, 2), 3: (30, 1)}
SPECIFIC = {
    5: (("粮食形态", 2, 1), ("化学成分", 2, 2), ("碳水化合物", 2, 2), ("蛋白质", 2, 2), ("生育期", 2, 1), ("种皮颜色", 2, 1), ("扦取", 7, 2), ("分样", 7, 4), ("原始读数", 14, 1), ("原始记录", 14, 1), ("天平", 4, 1), ("量纲", 4, 1), ("职业道德", 1, 1), ("样品编号", 14, 1), ("任务单", 14, 1), ("火灾", 5, 2), ("环境保护", 5, 3), ("容重", 9, 6), ("不完善粒", 9, 4), ("整精米", 9, 8), ("加工精度", 10, 1), ("磁性金属", 10, 4), ("烟点", 11, 8), ("挥发物", 11, 6), ("有效数字", 14, 2)),
    4: (("职业道德", 1, 1), ("职业活动", 1, 1), ("道德", 1, 1), ("标准偏差", 21, 3), ("凯氏定氮", 16, 3), ("索氏", 16, 4), ("面筋测定仪", 16, 5), ("降落数值仪", 16, 6), ("可见分光", 16, 2), ("有机氯", 19, 3), ("有机磷", 19, 3), ("碘值", 19, 3), ("含皂", 19, 4), ("不皂化", 19, 5), ("直链淀粉", 18, 4), ("胶稠度", 18, 8), ("降落数值", 18, 9)),
    3: (("提取", 22, 1), ("灰化", 22, 2), ("有机磷农药", 27, 3), ("有机氯农药", 27, 2), ("黄曲霉毒素B₁的测定", 29, 2), ("黄曲霉毒素", 29, 1), ("原子吸收", 23, 2), ("气相色谱", 23, 1), ("实验磨粉机", 24, 1), ("小麦粉面团", 25, 2), ("小麦制粉", 25, 1), ("脂肪酸组成", 26, 1), ("残留溶剂", 26, 2), ("磷化物", 27, 1), ("粮油中钙", 28, 1), ("粮油中铁", 28, 2), ("粮油中锌", 28, 3), ("回归分析", 30, 2)),
}
COMPOSITION_RULES = (
    (("双低", "芥酸", "硫苷", "淀粉", "结合水", "碳水化合物", "纤维素", "蛋白酶"), 2, 2),
)


def _chapters(encoded: str):
    return [(chapter, tuple(sections.split("/"))) for chapter, sections in (item.split(":", 1) for item in encoded.split(";"))]


def build_parts():
    parts = []
    start = 1
    for part_id, number, title, levels, encoded in OUTLINE:
        chapters = []
        for chapter_number, (chapter_title, sections) in enumerate(_chapters(encoded), start):
            chapter_id = f"{part_id}-c{chapter_number:02d}"
            chapters.append({"id": chapter_id, "number": chapter_number, "title": chapter_title, "page": None, "sections": [{"id": f"{chapter_id}-s{n:02d}", "number": n, "title": section, "page": None} for n, section in enumerate(sections, 1)]})
        parts.append({"id": part_id, "number": number, "title": title, "levels": list(levels), "chapters": chapters})
        start += len(chapters)
    parts.append({"id": "inspector-import", "number": 5, "title": "质检员综合理论", "levels": [2, 1], "chapters": [{"id": "inspector-import-c01", "number": 1, "title": "质检员综合理论", "page": None, "sections": [{"id": "inspector-import-c01-s01", "number": 1, "title": "质检员综合理论", "page": None}]}]})
    return parts


def _classification(level: int, text: str):
    if level == 5:
        for terms, chapter, section in COMPOSITION_RULES:
            if any(term in text for term in terms):
                chapter_id = f"inspector-basic-c{chapter:02d}"
                return chapter_id, f"{chapter_id}-s{section:02d}", True
    candidates = [
        (kind, len(term), -priority, chapter, section)
        for kind, rules in ((2, SPECIFIC[level]), (1, KEYWORDS[level]))
        for priority, (term, chapter, section) in enumerate(rules)
        if len(term) >= 2 and term in text
    ]
    score, _, _, chapter, section = max(candidates, default=(0, 0, 0, *DEFAULTS[level]))
    part = "inspector-basic" if chapter <= 6 else f"inspector-l{level}"
    chapter_id = f"{part}-c{chapter:02d}"
    return chapter_id, f"{chapter_id}-s{section:02d}", bool(score)


def _path(level: int, text: str):
    chapter_id, section_id, _ = _classification(level, text)
    return chapter_id, section_id


def _source_text(record: dict[str, object]) -> str:
    options = record.get("options", [])
    if not isinstance(options, list):
        raise ValueError("question options must be a list")
    return " ".join(
        str(value)
        for value in (
            record.get("stem", ""),
            *(option.get("text", "") for option in options if isinstance(option, dict)),
            record.get("explanation", ""),
            *(record.get("keywords", []) if isinstance(record.get("keywords"), list) else []),
        )
    )


def _replace_all(staged: dict[Path, Path], replace=os.replace) -> None:
    backups: dict[Path, bytes | None] = {
        target: target.read_bytes() if target.exists() else None for target in staged
    }
    replaced: list[Path] = []
    try:
        for target, source in staged.items():
            target.parent.mkdir(parents=True, exist_ok=True)
            replace(source, target)
            replaced.append(target)
    except Exception:
        for target in reversed(replaced):
            original = backups[target]
            if original is None:
                target.unlink(missing_ok=True)
            else:
                target.write_bytes(original)
        raise


def reclassify(root: Path, *, replace=os.replace) -> None:
    catalog_path = root / "data" / "knowledge_catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8")); parts = build_parts()
    catalog["occupations"][OCCUPATION]["parts"] = parts
    labels = {(chapter["id"], section["id"]): (chapter["title"], section["title"]) for part in parts for chapter in part["chapters"] for section in chapter["sections"]}
    taxonomy_path = root / "data" / "taxonomy.json"; taxonomy = json.loads(taxonomy_path.read_text(encoding="utf-8"))
    taxonomy["occupations"][OCCUPATION]["levels"] = {str(level): {"modules": {chapter["title"]: [section["title"] for section in chapter["sections"]] for part in parts if level in part["levels"] for chapter in part["chapters"]}} for level in (5, 4, 3, 2, 1)}
    outputs = {
        catalog_path: json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
        taxonomy_path: json.dumps(taxonomy, ensure_ascii=False, indent=2) + "\n",
    }
    report = {}
    for path in sorted((root / "data" / "questions").glob("inspector_l*.jsonl")):
        records = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
        if not records or any(not isinstance(record, dict) for record in records):
            raise ValueError(f"{path} must contain question objects")
        matched = fallback = 0
        for record in records:
            level = int(record["level"])
            if level in (1, 2):
                chapter_id, section_id, did_match = "inspector-import-c01", "inspector-import-c01-s01", True
            else:
                chapter_id, section_id, did_match = _classification(level, _source_text(record))
            matched += int(did_match); fallback += int(not did_match)
            record["chapter_id"], record["section_id"] = chapter_id, section_id
            record["module"], record["topic"] = labels[(chapter_id, section_id)]
        outputs[path] = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records)
        report[str(records[0]["level"])] = {"total": len(records), "matched": matched, "fallback": fallback}
    report_path = root / "tmp" / "inspector-classification-report.json"
    outputs[report_path] = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    with TemporaryDirectory(prefix="inspector-classification-", dir=root) as directory:
        staging = Path(directory)
        staged = {}
        for index, (target, content) in enumerate(outputs.items()):
            source = staging / str(index)
            source.write_text(content, encoding="utf-8")
            staged[target] = source
        _replace_all(staged, replace=replace)


if __name__ == "__main__": reclassify(Path(__file__).resolve().parents[1])
