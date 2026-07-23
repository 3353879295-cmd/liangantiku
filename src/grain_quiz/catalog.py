"""Canonical knowledge catalog loading and lookup."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CatalogSection:
    id: str
    number: int
    title: str
    page: int | None


@dataclass(frozen=True)
class CatalogChapter:
    id: str
    number: int
    title: str
    page: int | None
    sections: tuple[CatalogSection, ...]


@dataclass(frozen=True)
class CatalogPart:
    id: str
    number: int
    title: str
    levels: tuple[int, ...]
    chapters: tuple[CatalogChapter, ...]


@dataclass(frozen=True)
class CatalogOccupation:
    title: str
    parts: tuple[CatalogPart, ...]


@dataclass(frozen=True)
class KnowledgeCatalog:
    occupations: dict[str, CatalogOccupation]

    def allows(
        self,
        occupation_code: str,
        level: int,
        chapter_id: str,
        section_id: str,
    ) -> bool:
        occupation = self.occupations.get(occupation_code)
        if occupation is None:
            return False
        return any(
            part.levels
            and level in part.levels
            and any(
                chapter.id == chapter_id
                and any(section.id == section_id for section in chapter.sections)
                for chapter in part.chapters
            )
            for part in occupation.parts
        )

    def counts(self, occupation_code: str) -> dict[str, int]:
        occupation = self.occupations[occupation_code]
        return {
            "parts": len(occupation.parts),
            "chapters": sum(len(part.chapters) for part in occupation.parts),
            "sections": sum(
                len(chapter.sections)
                for part in occupation.parts
                for chapter in part.chapters
            ),
        }

    def runtime_document(self) -> dict[str, object]:
        return {
            "occupations": {
                code: {
                    "title": occupation.title,
                    "parts": [
                        {
                            "id": part.id,
                            "number": part.number,
                            "title": part.title,
                            "levels": list(part.levels),
                            "chapters": [
                                {
                                    "id": chapter.id,
                                    "number": chapter.number,
                                    "title": chapter.title,
                                    "page": chapter.page,
                                    "sections": [
                                        {
                                            "id": section.id,
                                            "number": section.number,
                                            "title": section.title,
                                            "page": section.page,
                                        }
                                        for section in chapter.sections
                                    ],
                                }
                                for chapter in part.chapters
                            ],
                        }
                        for part in occupation.parts
                    ],
                }
                for code, occupation in self.occupations.items()
            }
        }


def _require_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be non-blank")
    return value.strip()


def _require_page(value: object, label: str) -> int | None:
    if value is None:
        return None
    return _require_int(value, label)


def load_knowledge_catalog(path: Path) -> KnowledgeCatalog:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid knowledge catalog JSON in {path}: {error}") from error
    raw_occupations = document.get("occupations") if isinstance(document, dict) else None
    if not isinstance(raw_occupations, dict) or not raw_occupations:
        raise ValueError("knowledge catalog must contain occupations")

    seen: set[str] = set()
    occupations: dict[str, CatalogOccupation] = {}
    for code, raw_occupation in raw_occupations.items():
        if not isinstance(raw_occupation, dict):
            raise ValueError(f"occupation {code} must be an object")
        raw_parts = raw_occupation.get("parts")
        if not isinstance(raw_parts, list) or not raw_parts:
            raise ValueError(f"occupation {code} must contain parts")
        parts: list[CatalogPart] = []
        for raw_part in raw_parts:
            part_id = _require_text(raw_part.get("id"), "part id")
            if part_id in seen:
                raise ValueError(f"duplicate catalog ID: {part_id}")
            seen.add(part_id)
            raw_levels = raw_part.get("levels")
            if (
                not isinstance(raw_levels, list)
                or not raw_levels
                or any(level not in {5, 4, 3} for level in raw_levels)
            ):
                raise ValueError(f"part {part_id} has invalid levels")
            chapters: list[CatalogChapter] = []
            for raw_chapter in raw_part.get("chapters", []):
                chapter_id = _require_text(raw_chapter.get("id"), "chapter id")
                if chapter_id in seen:
                    raise ValueError(f"duplicate catalog ID: {chapter_id}")
                seen.add(chapter_id)
                sections: list[CatalogSection] = []
                for raw_section in raw_chapter.get("sections", []):
                    section_id = _require_text(raw_section.get("id"), "section id")
                    if section_id in seen:
                        raise ValueError(f"duplicate catalog ID: {section_id}")
                    seen.add(section_id)
                    sections.append(
                        CatalogSection(
                            id=section_id,
                            number=_require_int(raw_section.get("number"), "section number"),
                            title=_require_text(raw_section.get("title"), "section title"),
                            page=_require_page(raw_section.get("page"), "section page"),
                        )
                    )
                if not sections:
                    raise ValueError(f"chapter {chapter_id} must contain sections")
                chapters.append(
                    CatalogChapter(
                        id=chapter_id,
                        number=_require_int(raw_chapter.get("number"), "chapter number"),
                        title=_require_text(raw_chapter.get("title"), "chapter title"),
                        page=_require_page(raw_chapter.get("page"), "chapter page"),
                        sections=tuple(sections),
                    )
                )
            if not chapters:
                raise ValueError(f"part {part_id} must contain chapters")
            parts.append(
                CatalogPart(
                    id=part_id,
                    number=_require_int(raw_part.get("number"), "part number"),
                    title=_require_text(raw_part.get("title"), "part title"),
                    levels=tuple(raw_levels),
                    chapters=tuple(chapters),
                )
            )
        occupations[code] = CatalogOccupation(
            title=_require_text(raw_occupation.get("title"), "occupation title"),
            parts=tuple(parts),
        )
    return KnowledgeCatalog(occupations=occupations)
