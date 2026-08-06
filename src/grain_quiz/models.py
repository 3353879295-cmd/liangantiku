"""Validated records used by the grain question bank."""

from datetime import date, datetime
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, Field, HttpUrl, StringConstraints, model_validator


NonBlankString = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]
QuestionId = Annotated[
    str,
    StringConstraints(pattern=r"^(WH|QI)-L[12345]-[0-9]{6}$"),
]
SourceId = Annotated[
    str,
    StringConstraints(pattern=r"^SRC-[0-9]{4}$"),
]


class SourceKind(str, Enum):
    """Allowed classifications for source records."""

    OCCUPATIONAL_STANDARD = "occupational_standard"
    LAW_REGULATION = "law_regulation"
    INDUSTRY_STANDARD = "industry_standard"
    OFFICIAL_MANUAL = "official_manual"
    OFFICIAL_NOTICE = "official_notice"
    PUBLISHER_PAGE = "publisher_page"
    SCHOOL_MATERIAL = "school_material"
    PUBLIC_PRACTICE = "public_practice"


class SourceUsage(str, Enum):
    """Permitted use of a source in the question bank."""

    KNOWLEDGE_BASIS = "knowledge_basis"
    PUBLIC_SAMPLE = "public_sample"
    BIBLIOGRAPHY_ONLY = "bibliography_only"


class OccupationCode(str, Enum):
    """Occupation codes within the project scope."""

    GRAIN_KEEPER = "4-02-06-01"
    GRAIN_INSPECTOR = "4-08-05-01"


class QuestionType(str, Enum):
    """Supported question response formats."""

    SINGLE = "single"
    MULTIPLE = "multiple"
    JUDGE = "judge"
    CASE = "case"


class Difficulty(str, Enum):
    """Supported question difficulty levels."""

    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class ReviewStatus(str, Enum):
    """Review lifecycle states for a question."""

    VERIFIED = "verified"
    PENDING = "pending"
    RETIRED = "retired"


class Option(BaseModel):
    """A selectable response option."""

    key: Literal["A", "B", "C", "D", "E", "F"]
    text: str


class Source(BaseModel):
    """A provenance record for knowledge used by the question bank."""

    id: SourceId
    title: NonBlankString
    url: HttpUrl
    publisher: NonBlankString
    published_at: date | None
    accessed_at: date
    kind: SourceKind
    usage: SourceUsage
    is_active: bool
    notes: str


class Question(BaseModel):
    """A validated question-bank record."""

    id: QuestionId
    occupation_code: OccupationCode
    occupation_name: str
    direction: str
    level: Literal[5, 4, 3, 2, 1]
    module: NonBlankString
    topic: NonBlankString
    chapter_id: NonBlankString
    section_id: NonBlankString
    type: QuestionType
    stem: NonBlankString
    options: list[Option]
    answer: list[str]
    explanation: NonBlankString
    difficulty: Difficulty
    keywords: list[str]
    source_ids: list[SourceId]
    standard_reference: str
    source_note: str
    review_status: ReviewStatus
    valid_from: date
    valid_until: date | None
    duplicate_group: str | None
    content_version: Annotated[int, Field(ge=1)]
    created_at: datetime
    updated_at: datetime

    @model_validator(mode="after")
    def validate_record_invariants(self) -> "Question":
        """Enforce consistency between a question's type and its answers."""
        if self.type in {QuestionType.SINGLE, QuestionType.CASE} and len(self.answer) != 1:
            raise ValueError("single and case questions require exactly one answer")
        if self.type == QuestionType.MULTIPLE and len(self.answer) < 2:
            raise ValueError("multiple questions require at least two answers")
        if self.type == QuestionType.JUDGE:
            expected = [("A", "\u6b63\u786e"), ("B", "\u9519\u8bef")]
            if [(item.key, item.text) for item in self.options] != expected:
                raise ValueError(
                    "judge questions require A=\u6b63\u786e and B=\u9519\u8bef"
                )
        elif len(self.options) < 4 or len(self.options) > 6:
            raise ValueError("single, multiple and case questions require four to six options")
        option_keys = {item.key for item in self.options}
        if len(option_keys) != len(self.options) or not set(self.answer) <= option_keys:
            raise ValueError("answer keys must match unique option keys")
        if self.valid_until and self.valid_until < self.valid_from:
            raise ValueError("valid_until cannot precede valid_from")
        return self
