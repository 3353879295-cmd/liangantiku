"""Text normalization and exact question fingerprinting."""

import hashlib
import json
import unicodedata

from grain_quiz.models import Question


_MEASUREMENT_SYMBOLS = frozenset({"\u2103", "\u2109", "\u00b0", "%", "\u2030", "\u03bc", "\u00b5", "\u00d7"})
_ION_SOURCE_SIGNS = frozenset({"+", "-", "\u2212"})


def _is_ion_source_sign(value: str, index: int) -> bool:
    """Return whether a sign terminates an uppercase ASCII ion-source token."""
    if value[index] not in _ION_SOURCE_SIGNS:
        return False
    following_character = value[index + 1 : index + 2]
    if following_character.isascii() and following_character.isalnum():
        return False

    uppercase_count = 0
    for character in reversed(value[:index]):
        if character.isascii() and character.isupper():
            uppercase_count += 1
            continue
        break
    return uppercase_count >= 2


def normalize_text(value: str) -> str:
    """Normalize text while retaining letters, digits, and measurement symbols."""
    placeholders = {
        symbol: chr(0xE000 + index)
        for index, symbol in enumerate(sorted(_MEASUREMENT_SYMBOLS))
    }
    protected = value
    for symbol, placeholder in placeholders.items():
        protected = protected.replace(symbol, placeholder)

    restored = {placeholder: symbol for symbol, placeholder in placeholders.items()}
    compatibility_normalized = unicodedata.normalize("NFKC", protected)
    normalized = compatibility_normalized.lower()
    return "".join(
        restored.get(character, character)
        for index, character in enumerate(normalized)
        if character in restored
        or character.isalnum()
        or character in _MEASUREMENT_SYMBOLS
        or _is_ion_source_sign(compatibility_normalized, index)
    )


def exact_fingerprint(question: Question) -> str:
    """Return an option-order-independent SHA-256 fingerprint for a question."""
    values = [
        normalize_text(question.stem),
        *sorted(normalize_text(option.text) for option in question.options),
    ]
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
