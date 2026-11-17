"""When a dataset was last updated: the newest run time in its rows (SPEC 4.7).

    dataset_updated(rows) -> ("2026-09-03T04:14:59Z", "runs") | (None, "unknown")

For each row the time is its `finished_at`, else its `started_at` (the first of the two that
parses). A time is ISO-8601 with an explicit zone: `Z` or `+HH:MM` (converted to UTC), with or
without fractional seconds. Anything else -- an empty string, a number, a time without a zone --
is ignored rather than guessed at. The answer is the newest time, to the second, as
`YYYY-MM-DDTHH:MM:SSZ`, with "runs"; or (None, "unknown") when no row has a time.

This replaces the modification time of `index.jsonl`, which a clone, a copy or a publish resets to
the day it happened. Standard library only, and it parses by hand because Python 3.10's
`datetime.fromisoformat` accepts neither `Z` nor a fraction of other than 3 or 6 digits.
"""
from __future__ import annotations

import datetime as _dt
import re

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})")
_FIELDS = ("finished_at", "started_at")


def parse_time(value) -> _dt.datetime | None:
    """`value` as an aware UTC datetime, or None when it is not a zoned ISO-8601 string."""
    if not isinstance(value, str):
        return None
    m = _ISO.fullmatch(value)
    if not m:
        return None
    year, month, day, hour, minute, second = (int(g) for g in m.groups()[:6])
    fraction, zone = m.group(7) or "", m.group(8)
    if zone == "Z":
        tz = _dt.timezone.utc
    else:
        sign = -1 if zone[0] == "-" else 1
        hours, minutes = int(zone[1:3]), int(zone[4:6])
        if hours > 23 or minutes > 59:
            return None
        tz = _dt.timezone(sign * _dt.timedelta(hours=hours, minutes=minutes))
    try:
        when = _dt.datetime(year, month, day, hour, minute, second, int((fraction + "000000")[:6]), tzinfo=tz)
        return when.astimezone(_dt.timezone.utc)
    except (ValueError, OverflowError):                    # month 13, second 61, year 1 at -01:00, ...
        return None


def row_time(row) -> _dt.datetime | None:
    """The row's `finished_at`, else its `started_at`; None when neither parses."""
    if not isinstance(row, dict):
        return None
    for field in _FIELDS:
        when = parse_time(row.get(field))
        if when is not None:
            return when
    return None


def dataset_updated(rows) -> tuple[str | None, str]:
    """(newest run time as YYYY-MM-DDTHH:MM:SSZ, "runs"), or (None, "unknown")."""
    newest = None
    for row in rows:
        when = row_time(row)
        if when is not None and (newest is None or when > newest):
            newest = when
    if newest is None:
        return None, "unknown"
    n = newest                                             # formatted by hand: %Y does not pad years < 1000 everywhere
    return f"{n.year:04d}-{n.month:02d}-{n.day:02d}T{n.hour:02d}:{n.minute:02d}:{n.second:02d}Z", "runs"
