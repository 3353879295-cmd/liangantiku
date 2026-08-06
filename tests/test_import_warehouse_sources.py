from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_importer():
    path = Path(__file__).resolve().parents[1] / "tools" / "import_warehouse_sources.py"
    spec = importlib.util.spec_from_file_location("warehouse_importer", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load importer at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


IMPORTER = _load_importer()


def test_section_heading_is_not_imported_as_a_question_and_keeps_its_question_type():
    heading = "4.1 检查储粮温度 判断题 (共70题)"
    question = "1. 仓房屋顶外表面喷涂反光材料，可以降低太阳辐射对仓内温度的影响。 A.正确 B.错误 答案：A"

    blocks = IMPORTER._parse_blocks([heading, question])

    assert blocks == [(heading, [question])]


def test_inline_true_false_options_are_imported_as_a_judgement_question():
    heading = "4.1 检查储粮温度 判断题 (共70题)"
    question = "1. 仓房屋顶外表面喷涂反光材料，可以降低太阳辐射对仓内温度的影响。 A.正确 B.错误 答案：A"

    parsed, reason = IMPORTER._parse_block(heading, [question])

    assert reason is None
    assert parsed is not None
    assert parsed["type"] == "judge"
    assert parsed["answer"] == ["A"]
    assert parsed["options"] == [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]


def test_true_false_options_are_imported_as_a_judgement_question_without_a_heading():
    question = "2. 在仓房屋顶外表面喷涂反光材料，可以降低太阳辐射对仓内温度的影响。 A.正确 B.错误 答案：A"

    parsed, reason = IMPORTER._parse_block("综合理论", [question])

    assert reason is None
    assert parsed is not None
    assert parsed["type"] == "judge"
    assert parsed["options"] == [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]


def test_decimal_section_heading_is_not_imported_as_a_question():
    heading = "3.1 粮油出入库准备"
    question = "1. 粮食入库前应检查仓房。 A.正确 B.错误 答案：A"

    blocks = IMPORTER._parse_blocks([heading, question])

    assert blocks == [(heading, [question])]


def test_answer_key_lines_are_not_imported_as_questions_and_can_supply_answers():
    question = "1、储备粮专卡中要求填写一式四份，（ ）储粮单位、保管员、上级主管部门各一份。 A、每货位挂一份 B、每粮库挂一份 C、计划部门一份 D、管理部门一份"
    answer_key = "1.A 2.B"

    blocks = IMPORTER._parse_blocks([question, answer_key])
    parsed, reason = IMPORTER._parse_block("选择题", blocks[0][1], answer_override=["A"])

    assert blocks == [("综合理论", [question])]
    assert IMPORTER._collect_answer_key_overrides([answer_key]) == {1: ["A"], 2: ["B"]}
    assert reason is None
    assert parsed is not None
    assert parsed["answer"] == ["A"]


def test_parenthesized_answer_and_inline_options_are_imported():
    question = "1、引起结露的主要条件是温差，并达到（ C ）。"
    options = "A、温度 B、湿度 C、露点 D、结点"

    parsed, reason = IMPORTER._parse_block("选择题", [question, options])

    assert reason is None
    assert parsed is not None
    assert parsed["answer"] == ["C"]
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D"]


def test_inline_options_allow_a_missing_option_label_punctuation_mark():
    question = "3、储备粮专卡中，储备性质分中央储备粮、省级储备、地方储备、（ ）临时储备等。 A、备荒储备 B、军队储备 C。战争储备 D特种储备"

    parsed, reason = IMPORTER._parse_block("选择题", [question], answer_override=["D"])

    assert reason is None
    assert parsed is not None
    assert parsed["answer"] == ["D"]
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D"]


def test_inline_option_parser_keeps_technical_e2_notation_inside_option_text():
    question = "1. 关于单位能耗要求，下列说法中正确的是（ ）。"
    options = "A.玉米降水: E2≤2.5 kW·h B.小麦降水: E2≤2.0 kW·h C.稻谷降水: E2≤2.5 kW·h D.大豆降水: E2≤2.0 kW·h"

    parsed, reason = IMPORTER._parse_block("选择题", [question, options], answer_override=["C"])

    assert reason is None
    assert parsed is not None
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D"]
    assert "E2≤2.5" in parsed["options"][0]["text"]


def test_inline_option_parser_preserves_an_a_class_stem_prefix():
    question = "1. A类火灾场所应选择（ ）。"
    options = "A.水型灭火器 B.泡沫灭火器 C.碳酸氢钠干粉灭火器 D.磷酸铵盐干粉灭火器 E.卤代烷灭火器"

    parsed, reason = IMPORTER._parse_block("多项选择题", [question, options], answer_override=["A", "B", "D", "E"])

    assert reason is None
    assert parsed is not None
    assert parsed["stem"].startswith("A类火灾场所")
    assert [option["key"] for option in parsed["options"]] == ["A", "B", "C", "D", "E"]


def test_question_starts_embedded_in_one_source_paragraph_are_split():
    first = "8. 粮食储存是重要工作。 A.甲 B.乙 C.丙 D.丁"
    second = "9、对储粮害虫而言，无虫间隔期应超过一个世代的（ ）倍。 A、1 B、2 C、3 D、4"

    blocks = IMPORTER._parse_blocks([f"{first} {second}"])

    assert blocks == [("综合理论", [first]), ("综合理论", [second])]


def test_number_inside_an_explanation_is_not_split_into_a_question():
    explanation = (
        "\u89e3\u6790\uff1a\u4f7f\u7528\u9632\u62a4\u5242\u9632\u6cbb\u50a8\u7cae\u5bb3\u866b "
        "2.\u5c06\u9632\u62a4\u5242\u4e73\u6cb9\u52a0\u6c34\u7a00\u91ca\u3002"
        "\u7a00\u91ca\u540e\u7684\u603b\u836f\u91cf\u4e0d\u5e94\u8d85\u8fc7"
        "\u62cc\u548c\u7cae\u6cb9\u91cd\u91cf\u76840.1%\u3002"
    )
    question = "834. \u78f7\u5316\u94dd\u7247\u5242\u4e2d\u786c\u8102\u9178\u9541\u7684\u542b\u91cf\u4e3a( )\u3002"

    blocks = IMPORTER._parse_blocks([explanation, question])

    assert blocks == [("\u7efc\u5408\u7406\u8bba", [question])]


def test_question_without_punctuation_starts_a_new_block():
    first = "8\u3001\u7cae\u98df\u4ed3\u50a8\u4ece\u4e1a\u4eba\u5458\u7231\u5c97\u656c\u4e1a\uff0c\u7cbe\u76ca\u6c42\u7cbe\u7684\u57fa\u672c\u8981\u6c42\u662f\uff1a\uff08 \uff09"
    first_options = "A\u3001\u8981\u62e9\u4e1a B\u3001\u8981\u4e50\u4e1a C\u3001\u8981\u52e4\u4e1a D\u3001\u8981\u7cbe\u4e1a"
    second = "9\u5bf9\u50a8\u7cae\u5bb3\u866b\u800c\u8a00\uff0c\u65e0\u866b\u95f4\u9694\u671f\u5e94\u8d85\u8fc7\u4e00\u822c\u5bb3\u866b\u5b8c\u6210\u4e00\u4e2a\u4e16\u4ee3\u7684\u5386\u671f\u7684\uff08 \uff09\u500d"
    second_options = "A\u30011 B\u30012 C\u30013 D\u30014"

    blocks = IMPORTER._parse_blocks([first, first_options, second, second_options])

    assert blocks == [("\u7efc\u5408\u7406\u8bba", [first, first_options]), ("\u7efc\u5408\u7406\u8bba", [second, second_options])]


def test_question_fingerprint_ignores_formatting_only_variants():
    first = {
        "stem": "\u9898\u5e72\uff08 \uff09",
        "options": [{"key": "A", "text": "\u9009\u9879A."}, {"key": "B", "text": "\u9009\u9879B"}],
    }
    second = {
        "stem": "\u9898\u5e72",
        "options": [{"key": "A", "text": "\u9009\u9879A"}, {"key": "B", "text": "\u9009\u9879B"}],
    }

    assert IMPORTER._question_fingerprint(first) == IMPORTER._question_fingerprint(second)


def test_numeric_measurements_inside_a_paragraph_are_not_split_as_questions():
    line = "13. 关于通风隔热层材料要求，导热系数≤（ ）；7.1% 吸水率；0.85、0.65、0.50。"

    blocks = IMPORTER._parse_blocks([line])

    assert blocks == [("综合理论", [line])]


def test_numeric_measurement_line_is_not_imported_as_a_question():
    assert IMPORTER._parse_blocks(["7.1%", "0．85"]) == []


def test_standard_number_inside_question_is_not_split_as_a_new_question():
    line = "627. 粮油水分测量主要依据 GB 5009.3国家标准规定的方法进行测定。"

    blocks = IMPORTER._parse_blocks([line])

    assert blocks == [("综合理论", [line])]
