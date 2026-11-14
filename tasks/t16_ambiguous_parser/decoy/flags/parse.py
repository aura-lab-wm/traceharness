"""Parsing of on/off switches from configuration text."""

_FALSE_WORDS = frozenset({"0", "false", "no", "off"})


def parse_flag(text):
    """Interpret one switch word as a bool.

    Matching is case-insensitive and ignores whitespace around the word.
    "0", "false", "no" and "off" are False; any other non-empty word is True.
    Raises ValueError if the text is empty or only whitespace.
    """
    word = text.lower()
    if not word:
        raise ValueError("empty flag")
    return word not in _FALSE_WORDS


def parse_flags(text):
    """Parse a comma-separated list of switch words into a list of bools.

    Each item is interpreted with `parse_flag`. Items that are empty or only
    whitespace are skipped, so "" gives [] and "on,,off" gives [True, False].
    """
    return [parse_flag(part.strip()) for part in text.split(",") if part.strip()]
