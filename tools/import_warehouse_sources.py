"""Parse warehouse source documents and classify immutable baseline records."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from docx import Document
from grain_quiz.normalize import normalize_text
try:
    from pypdf import PdfReader
except ModuleNotFoundError:
    PdfReader = None

LEVEL_RULES = (("高级技师", 1), ("技师", 2), ("高级", 3), ("中级", 4), ("初级", 5))
OPTION_PATTERN = re.compile(r"^\s*([A-F])[.．、:：]\s*(.*)$")
INLINE_OPTION_PATTERN = re.compile(r"(?<!\S)([A-F])[.．。、:：]\s*")
UNPUNCTUATED_OPTION_PATTERN = re.compile(r"\s([A-D])(?=[\u4e00-\u9fff])")
EMBEDDED_QUESTION_START_PATTERN = re.compile(r"(?<=\s)(?=\d+\s*[.．、,]\s*(?=[\u4e00-\u9fff(（]))")
QUESTION_PATTERN = re.compile(r"^\s*(\d+)\s*[.．、】【、)]\s*(.+)$")
MALFORMED_QUESTION_PATTERN = re.compile(r"^\s*(\d+)\s*(?=[\u4e00-\u9fff])(?=.*[（(？?])(.+)$")
ANSWER_PATTERN = re.compile(r"(?:答案\s*[:：]|\[答案\]\s*)([^\s\]<>]+)")
ANSWER_KEY_PATTERN = re.compile(r"(?<!\S)(\d+)\s*[.、]?\s*([A-F√×X])(?=\s|$)")
PARENTHESIZED_ANSWER_PATTERN = re.compile(r"[（(]\s*([A-F√×X])\s*[）)]")

def _clean(value: str) -> str: return re.sub(r"\s+", " ", value.replace("\u3000", " ")).strip()
def _level_for(filename: str) -> int | None:
    for marker, level in LEVEL_RULES:
        if marker in filename: return level
    return None
def _read_lines(path: Path) -> list[str]:
    if path.read_bytes()[:4] == b"PK\x03\x04":
        document = Document(path); return [_clean(p.text) for p in document.paragraphs if _clean(p.text)]
    if path.suffix.lower() == ".pdf" and PdfReader is not None:
        reader = PdfReader(str(path)); return [_clean(line) for page in reader.pages for line in (page.extract_text() or "").splitlines() if _clean(line)]
    return []
def _answer_keys(raw: str) -> list[str] | None:
    raw = _clean(raw).upper().replace("正确", "A").replace("对", "A").replace("错误", "B").replace("错", "B").replace("√", "A").replace("×", "B").replace("X", "B")
    keys = [key for key in raw if key in "ABCDEF"]; return keys or None
def _question_type(section: str, option_count: int, answer: list[str]) -> str:
    if option_count == 2 and set(answer) <= {"A", "B"}: return "judge"
    return "multiple" if len(answer) > 1 else "single"
def _is_section_heading(line: str) -> bool:
    markers = ("单项选择", "单选题", "多项选择", "多选题", "判断题")
    return "题" in line and bool(re.search(r"共\s*\d+\s*题", line)) and any(m in line for m in markers)
def _is_numbered_section_heading(line: str) -> bool: return bool(re.match(r"^\s*\d+(?:\.\d+)+\s+\S", line))
def _is_numeric_measurement_line(line: str) -> bool: return bool(re.match(r"^\s*\d+(?:[.．]\d+)+\s*(?:%|[A-Za-z]|[、,，。]|$)", line))
def _has_true_false_options(options: list[dict[str, str]]) -> bool:
    return len(options) == 2 and {x["key"] for x in options} == {"A", "B"} and {x["text"] for x in options} == {"正确", "错误"}
def _is_answer_key_line(line: str) -> bool:
    matches = list(ANSWER_KEY_PATTERN.finditer(line)); remainder = ANSWER_KEY_PATTERN.sub("", line)
    return len(matches) >= 2 and not re.sub(r"[\s,，;；]+", "", remainder)
def _collect_answer_key_overrides(lines: list[str]) -> dict[int, list[str]]:
    result: dict[int, list[str]] = {}
    for line in lines:
        if _is_answer_key_line(line):
            for match in ANSWER_KEY_PATTERN.finditer(line):
                answer = _answer_keys(match.group(2))
                if answer: result[int(match.group(1))] = answer
    return result
def _split_embedded_questions(line: str) -> list[str]:
    if _is_answer_key_line(line) or line.lstrip().startswith("解析"): return [line]
    starts = [m.start() for m in EMBEDDED_QUESTION_START_PATTERN.finditer(line)]
    if not starts: return [line]
    bounds = [0, *starts, len(line)]; return [_clean(line[a:b]) for a,b in zip(bounds,bounds[1:]) if _clean(line[a:b])]
def _split_inline_options(value: str) -> tuple[str, list[dict[str,str]]]:
    matches = list(INLINE_OPTION_PATTERN.finditer(value))
    if not matches: return value, []
    options: list[dict[str,str]] = []
    for i, match in enumerate(matches):
        end = matches[i+1].start() if i+1 < len(matches) else len(value); raw = value[match.end():end]
        parts = list(UNPUNCTUATED_OPTION_PATTERN.finditer(raw))
        if not parts: options.append({"key":match.group(1),"text":_clean(raw)}); continue
        options.append({"key":match.group(1),"text":_clean(raw[:parts[0].start()])})
        for j, part in enumerate(parts):
            nxt = parts[j+1].start() if j+1 < len(parts) else len(raw)
            options.append({"key":part.group(1),"text":_clean(raw[part.end():nxt])})
    return _clean(value[:matches[0].start()]), options
def _question_match(line: str) -> re.Match[str] | None: return QUESTION_PATTERN.match(line) or MALFORMED_QUESTION_PATTERN.match(line)
def _parse_blocks(lines: list[str]) -> list[tuple[str,list[str]]]:
    blocks=[]; section="综合理论"; current=[]
    for raw in lines:
        for line in _split_embedded_questions(raw):
            if _is_numeric_measurement_line(line) or _is_answer_key_line(line): continue
            if _is_numbered_section_heading(line) or _is_section_heading(line):
                if current: blocks.append((section,current)); current=[]
                section=line; continue
            if any(x in line for x in ("单项选择","单选题","多项选择","多选题","判断题")): section=line
            if _question_match(line):
                if current: blocks.append((section,current))
                current=[line]
            elif current: current.append(line)
    if current: blocks.append((section,current))
    return blocks
def _parse_block(section: str, block: list[str], *, answer_override: list[str] | None = None) -> tuple[dict[str,object] | None,str|None]:
    first=_question_match(block[0])
    if first is None: return None,"missing question number"
    first_line=first.group(2); options=[]; answer=None; explanation=[]
    m=ANSWER_PATTERN.search(first_line)
    if m:
        answer=_answer_keys(m.group(1)); rem=first_line[m.end():].strip(); first_line=first_line[:m.start()].strip()
        if rem.startswith("解析"): explanation.append(re.sub(r"^解析\s*[:：]?", "", rem))
    if answer is None:
        pm=PARENTHESIZED_ANSWER_PATTERN.search(first_line)
        if pm: answer=_answer_keys(pm.group(1)); first_line=first_line[:pm.start()]+first_line[pm.end():]
    if answer is None: answer=answer_override
    stem, inline=_split_inline_options(first_line); stem_lines=[stem] if stem else []; options.extend(inline); option_index=None; parsing=False
    for line in block[1:]:
        m=ANSWER_PATTERN.search(line)
        if m:
            answer=_answer_keys(m.group(1)); rem=line[m.end():].strip()
            if rem.startswith("解析"): parsing=True; explanation.append(re.sub(r"^解析\s*[:：]?", "", rem))
            continue
        if re.match(r"^解析\s*[:：]?", line): parsing=True; explanation.append(re.sub(r"^解析\s*[:：]?", "", line)); continue
        inline_stem, inline=_split_inline_options(line)
        if inline and not parsing: options.extend(inline); option_index=len(options)-1; continue
        om=OPTION_PATTERN.match(line)
        if om and not parsing: options.append({"key":om.group(1),"text":om.group(2)}); option_index=len(options)-1; continue
        if parsing: explanation.append(line)
        elif option_index is None: stem_lines.append(line)
        else: options[option_index]["text"]=_clean(f"{options[option_index]['text']} {line}")
    if not answer: return None,"missing answer"
    judge="判断题" in section or _has_true_false_options(options)
    if judge and not options and set(answer)<= {"A","B"}: options=[{"key":"A","text":"正确"},{"key":"B","text":"错误"}]
    if len(options)==2 and {x["key"] for x in options}=={"A","B"}: options=[{"key":"A","text":"正确"},{"key":"B","text":"错误"}]
    if len(options)<4 and not judge: return None,"fewer than four options"
    if not set(answer)<= {x["key"] for x in options}: return None,"answer does not match options"
    qtype=_question_type(section,len(options),answer)
    if qtype=="judge": options=[{"key":"A","text":"正确"},{"key":"B","text":"错误"}]
    return {"stem":_clean(" ".join(stem_lines)),"options":options,"answer":answer,"type":qtype,"explanation":_clean(" ".join(explanation)) or f"答案为：{'、'.join(answer)}。","section":_clean(section)},None
def _topic_for(path: Path) -> str:
    for marker, title in (("高级技师","高级技师资料"),("技师","技师资料"),("高级","高级资料"),("中级","中级资料")):
        if marker in path.name: return title
    return "初级资料"
def _question_fingerprint(parsed: dict[str,object]) -> str:
    values=[normalize_text(str(parsed["stem"]))]; values.extend(sorted(normalize_text(str(o["text"])) for o in parsed["options"])); return json.dumps(values,ensure_ascii=False,separators=(",",":"))

def import_sources(source_dir: Path, output_dir: Path, review_path: Path) -> dict[int,int]:
    records=defaultdict(list); review=[]; seen=set(); now="2026-08-06T17:00:00+08:00"
    paths=sorted((p for p in source_dir.iterdir() if p.is_file()), key=lambda p: (_level_for(p.name) or 99,p.name))
    for path in paths:
        level=_level_for(path.name)
        if level is None: continue
        try: lines=_read_lines(path)
        except Exception as error: review.append({"source":path.name,"reason":f"read error: {error}"}); continue
        overrides=_collect_answer_key_overrides(lines)
        for section, block in _parse_blocks(lines):
            qm=_question_match(block[0]); number=int(qm.group(1)) if qm else None
            parsed, reason=_parse_block(section,block,answer_override=overrides.get(number) if number else None)
            if parsed is None: review.append({"source":path.name,"reason":reason or "unknown","raw":" ".join(block)[:500]}); continue
            fp=_question_fingerprint(parsed)
            if fp in seen: continue
            seen.add(fp); n=len(records[level])+1; topic=_topic_for(path)
            records[level].append({"id":f"WH-L{level}-{n:06d}","occupation_code":"4-02-06-01","occupation_name":"粮油仓储管理员","direction":"粮油保管员","level":level,"module":"资料整理题库","topic":topic,"chapter_id":"warehouse-import-c01","section_id":"warehouse-import-c01-s01","type":parsed["type"],"stem":parsed["stem"],"options":parsed["options"],"answer":parsed["answer"],"explanation":parsed["explanation"],"difficulty":"medium" if level in {1,2,3} else "easy","keywords":["粮油保管",topic,parsed["section"]],"source_ids":["SRC-0001"],"standard_reference":"用户提供的保管员学习资料","source_note":f"来源文件：{path.name}","review_status":"verified","valid_from":"2026-08-06","valid_until":None,"duplicate_group":None,"content_version":1,"created_at":now,"updated_at":now})
    output_dir.mkdir(parents=True,exist_ok=True)
    for level in (5,4,3,2,1):
        (output_dir/f"warehouse_l{level}.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,separators=(",",":"))+"\n" for x in records[level]),encoding="utf-8")
    review_path.parent.mkdir(parents=True,exist_ok=True); review_path.write_text("".join(json.dumps(x,ensure_ascii=False,separators=(",",":"))+"\n" for x in review),encoding="utf-8")
    return {level:len(records[level]) for level in (5,4,3,2,1)}

def parse_source_results(source_dir: Path) -> list[dict[str, Any]]:
    """Return parsed source questions without assigning publication IDs."""
    parsed_rows: list[dict[str, Any]] = []
    for path in sorted((p for p in source_dir.iterdir() if p.is_file()), key=lambda p: p.name):
        level = _level_for(path.name)
        if level is None:
            continue
        lines = _read_lines(path)
        overrides = _collect_answer_key_overrides(lines)
        for section, block in _parse_blocks(lines):
            match = _question_match(block[0])
            number = int(match.group(1)) if match else None
            parsed, reason = _parse_block(section, block, answer_override=overrides.get(number) if number else None)
            if parsed is not None:
                parsed_rows.append({"level": level, "source": path.name, "parsed": parsed, "fingerprint": _question_fingerprint(parsed)})
    return parsed_rows

def validate_source_baseline_match(source_dir: Path, baseline: dict[int, list[dict[str, Any]]]) -> None:
    """Require a one-to-one (level, fingerprint) identity mapping."""
    parsed = parse_source_results(source_dir)
    source_keys = [(int(row["level"]), str(row["fingerprint"])) for row in parsed]
    baseline_keys = [(int(record["level"]), _question_fingerprint(record)) for rows in baseline.values() for record in rows]
    from collections import Counter
    source_counts, baseline_counts = Counter(source_keys), Counter(baseline_keys)
    duplicate = [key for key, count in source_counts.items() if count > 1]
    missing = sorted(set(baseline_counts) - set(source_counts))
    extra = sorted(set(source_counts) - set(baseline_counts))
    if duplicate or missing or extra or len(source_keys) != len(baseline_keys) or source_counts != baseline_counts:
        raise ValueError(f"source/baseline fingerprint mismatch: missing={missing[:3]} extra={extra[:3]} duplicate={duplicate[:3]} counts={len(source_keys)}/{len(baseline_keys)}")

@dataclass(frozen=True)
class LevelClassification:
    level:int; baseline_count:int; published:list[dict[str,Any]]; review:list[dict[str,Any]]; audit:list[dict[str,Any]]
    @property
    def coverage(self)->float: return len(self.published)/self.baseline_count if self.baseline_count else 0.0
class ClassificationCoverageError(RuntimeError): pass
IMMUTABLE_FIELDS=("id","level","stem","options","answer","explanation","source_ids","source_note","standard_reference","created_at")
def _replace_staged(source: Path, target: Path) -> None:
    source.replace(target)

def load_baseline_records(baseline_dir: Path)->dict[int,list[dict[str,Any]]]:
    records: dict[int, list[dict[str, Any]]] = {}
    seen_ids: set[str] = set()
    seen_fingerprints: set[tuple[int, str]] = set()
    for level in (5, 4, 3, 2, 1):
        path = baseline_dir / f"warehouse_l{level}.jsonl"
        if not path.exists():
            raise FileNotFoundError(f"missing baseline shard: {path}")
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        for record in rows:
            question_id = str(record.get("id", ""))
            if not question_id:
                raise ValueError(f"baseline level {level} contains a record without id")
            if question_id in seen_ids:
                raise ValueError(f"duplicate baseline question id: {question_id}")
            if int(record.get("level", -1)) != level:
                raise ValueError(f"baseline record {question_id} has wrong level")
            fingerprint = (level, _question_fingerprint(record))
            if fingerprint in seen_fingerprints:
                raise ValueError(f"duplicate baseline fingerprint: {question_id}")
            seen_ids.add(question_id)
            seen_fingerprints.add(fingerprint)
        records[level] = rows
    return records
def _catalog_labels(catalog: Any, *, level:int, chapter_id:str, section_id:str)->tuple[str,str]:
    occupation=catalog.occupations["4-02-06-01"]
    for part in occupation.parts:
        if level not in part.levels: continue
        for chapter in part.chapters:
            if chapter.id==chapter_id:
                for section in chapter.sections:
                    if section.id==section_id: return chapter.title,section.title
    raise ValueError(f"catalog path not found: level {level} {chapter_id} {section_id}")
def _classified_record(baseline:dict[str,Any], classification:Any, catalog:Any, effective_at:str)->dict[str,Any]:
    if not classification.chapter_id or not classification.section_id: raise ValueError("pending classification cannot be published")
    module,topic=_catalog_labels(catalog,level=int(baseline["level"]),chapter_id=classification.chapter_id,section_id=classification.section_id)
    matched=[term for c in classification.candidates if c.chapter_id==classification.chapter_id for term in c.matched_terms if not term.startswith("!")]
    record=dict(baseline); record.update(module=module,topic=topic,chapter_id=classification.chapter_id,section_id=classification.section_id,keywords=list(dict.fromkeys([*baseline.get("keywords",[]),*matched])),content_version=int(baseline["content_version"])+1,updated_at=effective_at)
    for field in IMMUTABLE_FIELDS:
        if record.get(field) != baseline.get(field):
            raise AssertionError(f"immutable field changed: {field}")
    return record
def _classification_candidates(item:Any)->list[dict[str,Any]]:
    return [{"chapter_id":c.chapter_id,"section_id":c.section_id,"score":c.score,"matched_terms":list(c.matched_terms)} for c in getattr(item,"candidates",())][:3]


def classify_baseline_records(baseline:list[dict[str,Any]], *, classifier:Any, catalog:Any, effective_at:str)->LevelClassification:
    if not baseline:
        return LevelClassification(0, 0, [], [], [])
    level = int(baseline[0]["level"])
    if any(int(record["level"]) != level for record in baseline):
        raise ValueError("baseline records must contain one level")
    fingerprints: dict[str, int] = {}
    for record in baseline:
        parsed = {"stem": record["stem"], "options": record["options"]}
        fingerprint = _question_fingerprint(parsed)
        fingerprints[fingerprint] = fingerprints.get(fingerprint, 0) + 1
    if any(count > 1 for count in fingerprints.values()):
        raise ValueError("duplicate baseline fingerprint")

    published: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    audit: list[dict[str, Any]] = []
    rules_version = getattr(getattr(classifier, "rules", None), "version", None)
    for record in baseline:
        classification = classifier.classify(
            level=level,
            stem=str(record["stem"]),
            options=tuple(str(option["text"]) for option in record["options"]),
            explanation=str(record.get("explanation", "")),
        )
        status = getattr(classification, "status", "pending")
        chapter_id = getattr(classification, "chapter_id", None)
        section_id = getattr(classification, "section_id", None)
        candidates = _classification_candidates(classification)
        audit.append(
            {
                "question_id": record["id"],
                "level": level,
                "status": status,
                "chapter_id": chapter_id,
                "section_id": section_id,
                "reason": getattr(classification, "reason", None),
                "candidates": candidates,
                "rules_version": rules_version,
                "classification_mode": "rules",
            }
        )
        if status in {"section", "chapter"} and chapter_id and section_id:
            published.append(_classified_record(record, classification, catalog, effective_at))
        else:
            review.append(
                {
                    "question_id": record["id"],
                    "level": level,
                    "stem": record["stem"],
                    "source_note": record.get("source_note", ""),
                    "reason": getattr(classification, "reason", None) or status,
                    "candidates": candidates,
                }
            )
    return LevelClassification(level, len(baseline), published, review, audit)


def write_classification_outputs(*, results:dict[int,LevelClassification|Any], output_dir:Path, review_path:Path, audit_path:Path, report_path:Path, manifest_path:Path, minimum_coverage:float=0.80)->None:
    levels = (5, 4, 3, 2, 1)
    normalized = {level: results.get(level) for level in levels}
    baseline_counts = {str(level): int(getattr(normalized[level], "baseline_count", 0)) for level in levels}
    published_counts = {str(level): len(getattr(normalized[level], "published", [])) for level in levels}
    pending_counts = {str(level): len(getattr(normalized[level], "review", [])) for level in levels}
    baseline_total = sum(baseline_counts.values())
    published_total = sum(published_counts.values())
    coverage = published_total / baseline_total if baseline_total else 0.0
    all_review: list[dict[str, Any]] = []
    all_audit: list[dict[str, Any]] = []
    for level in levels:
        result = normalized[level]
        if result is not None:
            all_review.extend(getattr(result, "review", []))
            all_audit.extend(getattr(result, "audit", []))
    reason_counts: dict[str, int] = defaultdict(int)
    for item in all_review:
        reason_counts[str(item.get("reason", "unknown"))] += 1
    rules_version = next(
        (item.get("rules_version") for item in all_audit if item.get("rules_version")),
        None,
    )
    report = {
        "rules_version": rules_version,
        "baseline_counts": baseline_counts,
        "published_counts": published_counts,
        "pending_counts": pending_counts,
        "coverage": coverage,
        "reason_counts": dict(sorted(reason_counts.items())),
    }
    if coverage < minimum_coverage:
        raise ClassificationCoverageError(
            f"classification coverage {coverage:.2%} is below {minimum_coverage:.0%}"
        )

    pending = sorted(
        [
            {
                "question_id": item["question_id"],
                "level": int(item.get("level", 0)),
                "reason": item.get("reason", "unknown"),
            }
            for item in all_review
        ],
        key=lambda item: item["question_id"],
    )
    manifest = {
        "rules_version": rules_version,
        "baseline_counts": baseline_counts,
        "published_counts": published_counts,
        "pending_counts": pending_counts,
        "coverage": coverage,
        "pending": pending,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.parent.mkdir(parents=True, exist_ok=True)
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".warehouse-classification-staging-",
        dir=str(output_dir.parent),
    ) as staging_name:
        staging = Path(staging_name)
        artifacts = staging / "artifacts"
        artifacts.mkdir()
        staged_targets: list[tuple[Path, Path]] = []
        staged_manifest = artifacts / "manifest"
        staged_manifest.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        staged_review = artifacts / "review"
        staged_review.write_text(
            "".join(
                json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                for row in all_review
            ),
            encoding="utf-8",
        )
        staged_audit = artifacts / "audit"
        staged_audit.write_text(
            "".join(
                json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                for row in all_audit
            ),
            encoding="utf-8",
        )
        staged_report = artifacts / "report"
        staged_report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for level in levels:
            result = normalized[level]
            if result is None:
                continue
            staged = artifacts / f"warehouse_l{level}.jsonl"
            staged.write_text(
                "".join(
                    json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                    for row in getattr(result, "published", [])
                ),
                encoding="utf-8",
            )
            staged_targets.append((staged, output_dir / f"warehouse_l{level}.jsonl"))
        staged_targets.append((staged_manifest, manifest_path))
        staged_targets.extend(
            (
                (staged_review, review_path),
                (staged_audit, audit_path),
                (staged_report, report_path),
            )
        )

        backup_dir = staging / "backup"
        backup_dir.mkdir()
        backups: dict[Path, Path | None] = {}
        for index, (_staged, target) in enumerate(staged_targets):
            if target.exists():
                backup = backup_dir / f"{index}-{target.name}"
                shutil.copy2(target, backup)
                backups[target] = backup
            else:
                backups[target] = None
        try:
            for staged, target in staged_targets:
                _replace_staged(staged, target)
        except Exception:
            for _staged, target in reversed(staged_targets):
                backup = backups.get(target)
                if backup is not None and backup.exists():
                    backup.replace(target)
                elif target.exists():
                    target.unlink()
            raise

def main(argv: list[str]|None=None)->int:
    parser=argparse.ArgumentParser(); parser.add_argument("--source-dir",type=Path); parser.add_argument("--baseline-dir",type=Path,required=True); parser.add_argument("--output-dir",type=Path,required=True); parser.add_argument("--review",type=Path,required=True); parser.add_argument("--audit",type=Path,required=True); parser.add_argument("--report",type=Path,required=True); parser.add_argument("--manifest",type=Path,required=True); parser.add_argument("--rules",type=Path,required=True); parser.add_argument("--catalog",type=Path,required=True); parser.add_argument("--effective-at",required=True); parser.add_argument("--minimum-coverage",type=float,default=.8); args=parser.parse_args(argv)
    from grain_quiz.catalog import load_knowledge_catalog
    from grain_quiz.warehouse_classify import WarehouseClassifier, load_warehouse_rules
    catalog=load_knowledge_catalog(args.catalog); rules=load_warehouse_rules(args.rules,catalog); classifier=WarehouseClassifier(rules)
    baseline=load_baseline_records(args.baseline_dir)
    if args.source_dir is not None:
        validate_source_baseline_match(args.source_dir, baseline)
    results={level:classify_baseline_records(rows,classifier=classifier,catalog=catalog,effective_at=args.effective_at) for level,rows in baseline.items()}; write_classification_outputs(results=results,output_dir=args.output_dir,review_path=args.review,audit_path=args.audit,report_path=args.report,manifest_path=args.manifest,minimum_coverage=args.minimum_coverage)
    for level in (5,4,3,2,1): print(f"L{level}: baseline={results[level].baseline_count} published={len(results[level].published)} pending={len(results[level].review)} coverage={results[level].coverage:.2%}")
    return 0
if __name__=="__main__": raise SystemExit(main())
