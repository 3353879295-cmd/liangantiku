"""Import user-provided grain keeper study materials into canonical JSONL shards.

The importer only reads source files.  It accepts OOXML content by file signature so
misnamed `.doc` files are handled safely, and leaves records with incomplete answer
structures in the review file instead of publishing them.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from docx import Document
from grain_quiz.normalize import normalize_text
try:
    from pypdf import PdfReader
except ModuleNotFoundError:  # The project runtime can still import DOCX sources.
    PdfReader = None


LEVEL_RULES = (
    ("高级技师", 1),
    ("技师", 2),
    ("高级", 3),
    ("中级", 4),
    ("初级", 5),
)
OPTION_PATTERN = re.compile(r"^\s*([A-F])[.．、:：]\s*(.*)$")
INLINE_OPTION_PATTERN = re.compile(r"(?<!\S)([A-F])[.．。、:：]\s*")
UNPUNCTUATED_OPTION_PATTERN = re.compile(r"\s([A-D])(?=[\u4e00-\u9fff])")
EMBEDDED_QUESTION_START_PATTERN = re.compile(
    r"(?<=\s)(?=\d+\s*[.．、,]\s*(?=[\u4e00-\u9fff(（]))"
)
QUESTION_PATTERN = re.compile(r"^\s*(\d+)\s*[.．、】【、)]\s*(.+)$")
MALFORMED_QUESTION_PATTERN = re.compile(
    r"^\s*(\d+)\s*(?=[\u4e00-\u9fff])(?=.*[（(？?])(.+)$"
)
ANSWER_PATTERN = re.compile(r"(?:答案\s*[:：]|\[答案\]\s*)([^\s\]<>]+)")
ANSWER_KEY_PATTERN = re.compile(r"(?<!\S)(\d+)\s*[.、]?\s*([A-F√×X])(?=\s|$)")
PARENTHESIZED_ANSWER_PATTERN = re.compile(r"[（(]\s*([A-F√×X])\s*[）)]")


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u3000", " ")).strip()


def _level_for(filename: str) -> int | None:
    for marker, level in LEVEL_RULES:
        if marker in filename:
            return level
    return None


def _read_lines(path: Path) -> list[str]:
    if path.read_bytes()[:4] == b"PK\x03\x04":
        document = Document(path)
        return [_clean(paragraph.text) for paragraph in document.paragraphs if _clean(paragraph.text)]
    if path.suffix.lower() == ".pdf" and PdfReader is not None:
        reader = PdfReader(str(path))
        return [_clean(line) for page in reader.pages for line in (page.extract_text() or "").splitlines() if _clean(line)]
    return []


def _answer_keys(raw: str) -> list[str] | None:
    raw = (
        _clean(raw)
        .upper()
        .replace("正确", "A")
        .replace("对", "A")
        .replace("错误", "B")
        .replace("错", "B")
        .replace("√", "A")
        .replace("×", "B")
        .replace("X", "B")
    )
    keys = [key for key in raw if key in "ABCDEF"]
    return keys or None


def _question_type(section: str, option_count: int, answer: list[str]) -> str:
    if option_count == 2 and set(answer) <= {"A", "B"}:
        return "judge"
    if len(answer) > 1:
        return "multiple"
    return "single"


def _is_section_heading(line: str) -> bool:
    question_type_markers = (
        "\u5355\u9879\u9009\u62e9",
        "\u5355\u9009\u9898",
        "\u591a\u9879\u9009\u62e9",
        "\u591a\u9009\u9898",
        "\u5224\u65ad\u9898",
    )
    return (
        "\u9898" in line
        and bool(re.search(r"\u5171\s*\d+\s*\u9898", line))
        and any(marker in line for marker in question_type_markers)
    )


def _is_numbered_section_heading(line: str) -> bool:
    return bool(re.match(r"^\s*\d+(?:\.\d+)+\s+\S", line))


def _is_numeric_measurement_line(line: str) -> bool:
    return bool(re.match(r"^\s*\d+(?:[.．]\d+)+\s*(?:%|[A-Za-z]|[、,，。]|$)", line))


def _has_true_false_options(options: list[dict[str, str]]) -> bool:
    return (
        len(options) == 2
        and {item["key"] for item in options} == {"A", "B"}
        and {item["text"] for item in options} == {"正确", "错误"}
    )


def _is_answer_key_line(line: str) -> bool:
    matches = list(ANSWER_KEY_PATTERN.finditer(line))
    if len(matches) < 2:
        return False
    remainder = ANSWER_KEY_PATTERN.sub("", line)
    return not re.sub(r"[\s,，;；]+", "", remainder)


def _collect_answer_key_overrides(lines: list[str]) -> dict[int, list[str]]:
    overrides: dict[int, list[str]] = {}
    for line in lines:
        if not _is_answer_key_line(line):
            continue
        for match in ANSWER_KEY_PATTERN.finditer(line):
            answer = _answer_keys(match.group(2))
            if answer:
                overrides[int(match.group(1))] = answer
    return overrides


def _split_embedded_questions(line: str) -> list[str]:
    if _is_answer_key_line(line):
        return [line]
    if line.lstrip().startswith("\u89e3\u6790"):
        return [line]
    starts = [match.start() for match in EMBEDDED_QUESTION_START_PATTERN.finditer(line)]
    if not starts:
        return [line]
    boundaries = [0, *starts, len(line)]
    return [_clean(line[start:end]) for start, end in zip(boundaries, boundaries[1:]) if _clean(line[start:end])]


def _split_inline_options(value: str) -> tuple[str, list[dict[str, str]]]:
    matches = list(INLINE_OPTION_PATTERN.finditer(value))
    if not matches:
        return value, []
    options: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(value)
        raw_text = value[match.end() : end]
        unpunctuated_matches = list(UNPUNCTUATED_OPTION_PATTERN.finditer(raw_text))
        if not unpunctuated_matches:
            options.append({"key": match.group(1), "text": _clean(raw_text)})
            continue
        options.append(
            {
                "key": match.group(1),
                "text": _clean(raw_text[: unpunctuated_matches[0].start()]),
            }
        )
        for unpunctuated_index, unpunctuated_match in enumerate(unpunctuated_matches):
            next_start = (
                unpunctuated_matches[unpunctuated_index + 1].start()
                if unpunctuated_index + 1 < len(unpunctuated_matches)
                else len(raw_text)
            )
            options.append(
                {
                    "key": unpunctuated_match.group(1),
                    "text": _clean(raw_text[unpunctuated_match.end() : next_start]),
                }
            )
    return _clean(value[: matches[0].start()]), options


def _question_match(line: str) -> re.Match[str] | None:
    return QUESTION_PATTERN.match(line) or MALFORMED_QUESTION_PATTERN.match(line)


def _parse_blocks(lines: list[str]) -> list[tuple[str, list[str]]]:
    blocks: list[tuple[str, list[str]]] = []
    section = "综合理论"
    current: list[str] = []
    for line in (fragment for raw_line in lines for fragment in _split_embedded_questions(raw_line)):
        if _is_numeric_measurement_line(line):
            continue
        if _is_answer_key_line(line):
            continue
        if _is_numbered_section_heading(line):
            if current:
                blocks.append((section, current))
                current = []
            section = line
            continue
        if _is_section_heading(line):
            if current:
                blocks.append((section, current))
                current = []
            section = line
            continue
        if "单项选择" in line or "单选题" in line or "多项选择" in line or "多选题" in line or "判断题" in line:
            section = line
        if _question_match(line):
            if current:
                blocks.append((section, current))
            current = [line]
        elif current:
            current.append(line)
    if current:
        blocks.append((section, current))
    return blocks


def _parse_block(
    section: str,
    block: list[str],
    *,
    answer_override: list[str] | None = None,
) -> tuple[dict[str, object] | None, str | None]:
    first = _question_match(block[0])
    if first is None:
        return None, "missing question number"
    first_line = first.group(2)
    options: list[dict[str, str]] = []
    answer: list[str] | None = None
    explanation_lines: list[str] = []
    answer_match = ANSWER_PATTERN.search(first_line)
    if answer_match:
        answer = _answer_keys(answer_match.group(1))
        remainder = first_line[answer_match.end() :].strip()
        first_line = first_line[: answer_match.start()].strip()
        if remainder.startswith("解析"):
            explanation_lines.append(re.sub(r"^解析\s*[:：]?", "", remainder))
    if answer is None:
        parenthesized_answer = PARENTHESIZED_ANSWER_PATTERN.search(first_line)
        if parenthesized_answer:
            answer = _answer_keys(parenthesized_answer.group(1))
            first_line = first_line[: parenthesized_answer.start()] + first_line[parenthesized_answer.end() :]
    if answer is None:
        answer = answer_override
    stem, inline_options = _split_inline_options(first_line)
    stem_lines = [stem] if stem else []
    options.extend(inline_options)
    option_index: int | None = None
    parsing_explanation = False
    for line in block[1:]:
        answer_match = ANSWER_PATTERN.search(line)
        if answer_match:
            answer = _answer_keys(answer_match.group(1))
            remainder = line[answer_match.end() :].strip()
            if remainder.startswith("解析"):
                parsing_explanation = True
                explanation_lines.append(re.sub(r"^解析\s*[:：]?", "", remainder))
            continue
        if re.match(r"^解析\s*[:：]?", line):
            parsing_explanation = True
            explanation_lines.append(re.sub(r"^解析\s*[:：]?", "", line))
            continue
        inline_stem, inline_options = _split_inline_options(line)
        if inline_options and not parsing_explanation:
            options.extend(inline_options)
            option_index = len(options) - 1
            continue
        option_match = OPTION_PATTERN.match(line)
        if option_match and not parsing_explanation:
            options.append({"key": option_match.group(1), "text": option_match.group(2)})
            option_index = len(options) - 1
            continue
        if parsing_explanation:
            explanation_lines.append(line)
        elif option_index is None:
            stem_lines.append(line)
        else:
            options[option_index]["text"] = _clean(f"{options[option_index]['text']} {line}")
    if not answer:
        return None, "missing answer"
    is_judge_section = "\u5224\u65ad\u9898" in section
    is_judge = is_judge_section or _has_true_false_options(options)
    if is_judge and not options and set(answer) <= {"A", "B"}:
        options = [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]
    if len(options) == 2 and {item["key"] for item in options} == {"A", "B"}:
        options = [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]
    if len(options) < 4 and not is_judge:
        return None, "fewer than four options"
    keys = {item["key"] for item in options}
    if not set(answer) <= keys:
        return None, "answer does not match options"
    qtype = _question_type(section, len(options), answer)
    if qtype == "judge":
        options = [{"key": "A", "text": "正确"}, {"key": "B", "text": "错误"}]
    return {
        "stem": _clean(" ".join(stem_lines)),
        "options": options,
        "answer": answer,
        "type": qtype,
        "explanation": _clean(" ".join(explanation_lines)) or f"答案为：{'、'.join(answer)}。",
        "section": _clean(section),
    }, None


def _topic_for(path: Path) -> str:
    if "高级技师" in path.name:
        return "高级技师资料"
    if "技师" in path.name:
        return "技师资料"
    if "高级" in path.name:
        return "高级资料"
    if "中级" in path.name:
        return "中级资料"
    return "初级资料"


def _question_fingerprint(parsed: dict[str, object]) -> str:
    options = parsed["options"]
    values = [normalize_text(str(parsed["stem"]))]
    values.extend(sorted(normalize_text(str(option["text"])) for option in options))
    return json.dumps(values, ensure_ascii=False, separators=(",", ":"))


def import_sources(source_dir: Path, output_dir: Path, review_path: Path) -> dict[int, int]:
    records: dict[int, list[dict[str, object]]] = defaultdict(list)
    review: list[dict[str, str]] = []
    seen: set[str] = set()
    now = "2026-08-06T17:00:00+08:00"
    paths = sorted(
        (path for path in source_dir.iterdir() if path.is_file()),
        key=lambda path: (_level_for(path.name) or 99, path.name),
    )
    for path in paths:
        if not path.is_file():
            continue
        level = _level_for(path.name)
        if level is None:
            continue
        try:
            lines = _read_lines(path)
        except Exception as error:  # Source parsing must not abort other levels.
            review.append({"source": path.name, "reason": f"read error: {error}"})
            continue
        answer_overrides = _collect_answer_key_overrides(lines)
        for section, block in _parse_blocks(lines):
            question_match = _question_match(block[0])
            question_number = int(question_match.group(1)) if question_match else None
            parsed, reason = _parse_block(
                section,
                block,
                answer_override=answer_overrides.get(question_number) if question_number else None,
            )
            if parsed is None:
                review.append({"source": path.name, "reason": reason or "unknown", "raw": " ".join(block)[:500]})
                continue
            fingerprint = _question_fingerprint(parsed)
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            number = len(records[level]) + 1
            records[level].append(
                {
                    "id": f"WH-L{level}-{number:06d}",
                    "occupation_code": "4-02-06-01",
                    "occupation_name": "粮油仓储管理员",
                    "direction": "粮油保管员",
                    "level": level,
                    "module": "资料整理题库",
                    "topic": _topic_for(path),
                    "chapter_id": "warehouse-import-c01",
                    "section_id": "warehouse-import-c01-s01",
                    "type": parsed["type"],
                    "stem": parsed["stem"],
                    "options": parsed["options"],
                    "answer": parsed["answer"],
                    "explanation": parsed["explanation"],
                    "difficulty": "medium" if level in {1, 2, 3} else "easy",
                    "keywords": ["粮油保管", _topic_for(path), parsed["section"]],
                    "source_ids": ["SRC-0001"],
                    "standard_reference": "用户提供的保管员学习资料",
                    "source_note": f"来源文件：{path.name}",
                    "review_status": "verified",
                    "valid_from": "2026-08-06",
                    "valid_until": None,
                    "duplicate_group": None,
                    "content_version": 1,
                    "created_at": now,
                    "updated_at": now,
                }
            )
    output_dir.mkdir(parents=True, exist_ok=True)
    for level in (5, 4, 3, 2, 1):
        target = output_dir / f"warehouse_l{level}.jsonl"
        with target.open("w", encoding="utf-8") as stream:
            for record in records[level]:
                stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    review_path.parent.mkdir(parents=True, exist_ok=True)
    with review_path.open("w", encoding="utf-8") as stream:
        for item in review:
            stream.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    return {level: len(records[level]) for level in (5, 4, 3, 2, 1)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--review", required=True, type=Path)
    args = parser.parse_args()
    counts = import_sources(args.source_dir, args.output_dir, args.review)
    for level, count in counts.items():
        print(f"L{level}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
