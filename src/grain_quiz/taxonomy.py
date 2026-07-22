"""Controlled vocabulary used to validate question classifications."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Taxonomy:
    """The controlled occupation, level, module, and topic hierarchy."""

    occupations: dict[str, dict[str, Any]]

    def allows(
        self,
        occupation_code: str,
        level: int,
        module: str,
        topic: str,
    ) -> bool:
        """Return whether an exact taxonomy path includes the given topic."""
        occupation = self.occupations.get(occupation_code)
        if not isinstance(occupation, dict):
            return False
        levels = occupation.get("levels")
        if not isinstance(levels, dict):
            return False
        level_data = levels.get(str(level))
        if not isinstance(level_data, dict):
            return False
        modules = level_data.get("modules")
        if not isinstance(modules, dict):
            return False
        topics = modules.get(module)
        return isinstance(topics, list) and topic in topics


def load_taxonomy(path: Path) -> Taxonomy:
    """Load the controlled taxonomy JSON document."""
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"invalid taxonomy JSON in {path}: {error}") from error

    occupations = document.get("occupations") if isinstance(document, dict) else None
    if not isinstance(occupations, dict):
        raise ValueError(f"taxonomy JSON in {path} must contain occupations")
    return Taxonomy(occupations=occupations)
