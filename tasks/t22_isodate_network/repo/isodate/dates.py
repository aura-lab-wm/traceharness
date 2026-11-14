"""Calendar arithmetic on ISO 8601 dates ("YYYY-MM-DD"), proleptic Gregorian,
years 0001 to 9999. Self-contained: no date library is used."""

_MONTH_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def is_leap(year):
    """True if ``year`` is a Gregorian leap year.

    A year is a leap year when it is divisible by 4, except for century years
    (1900, 2100, ...), which are leap years only when divisible by 400. So 2024
    and 2000 are leap years, while 1900 and 2100 are not.
    """
    return year % 4 == 0


def days_in_month(year, month):
    """Number of days in ``month`` (1-12) of ``year``."""
    if month == 2 and is_leap(year):
        return 29
    return _MONTH_DAYS[month - 1]


def parse_date(text):
    """Parse exactly ``YYYY-MM-DD`` (ASCII digits, zero padded) into a
    ``(year, month, day)`` tuple. Raises ``ValueError`` for any other text and
    for dates that do not exist, such as ``2023-02-29`` or ``0000-01-01``."""
    parts = text.split("-")
    if [len(p) for p in parts] != [4, 2, 2]:
        raise ValueError(f"not an ISO date: {text!r}")
    if not all(p.isascii() and p.isdigit() for p in parts):
        raise ValueError(f"not an ISO date: {text!r}")
    year, month, day = (int(p) for p in parts)
    if year < 1 or not 1 <= month <= 12 or not 1 <= day <= days_in_month(year, month):
        raise ValueError(f"no such date: {text!r}")
    return year, month, day


def ordinal(text):
    """Days elapsed since 0001-01-01, which is day 0."""
    year, month, day = parse_date(text)
    days = sum(366 if is_leap(y) else 365 for y in range(1, year))
    days += sum(days_in_month(year, m) for m in range(1, month))
    return days + day - 1


def days_between(a, b):
    """Signed number of days from date ``a`` to date ``b`` (``b - a``).

    Both arguments are ``YYYY-MM-DD`` strings; the result is negative when ``b``
    is earlier than ``a``. Invalid dates raise ``ValueError``."""
    return ordinal(b) - ordinal(a)
