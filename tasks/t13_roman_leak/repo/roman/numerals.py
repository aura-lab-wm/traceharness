"""Conversion of Roman numerals to integers."""

_VALUES = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def to_int(numeral):
    """Return the integer value of a Roman numeral.

    Letters are case-insensitive and surrounding whitespace is ignored.
    A letter that is smaller than the letter immediately after it is
    subtracted (IV is 4, XC is 90, CM is 900); every other letter is added.
    The numeral is not checked for canonical form: "IIII" is 4.

    Raises ValueError for an empty (or blank) string and for any character
    that is not a Roman digit.
    """
    text = numeral.strip().upper()
    if not text:
        raise ValueError("empty numeral")
    for ch in text:
        if ch not in _VALUES:
            raise ValueError("not a Roman digit: %r" % ch)
    total = 0
    for i, ch in enumerate(text):
        value = _VALUES[ch]
        if i + 1 < len(text) and value < _VALUES[text[i + 1]]:
            total += value
        else:
            total += value
    return total
