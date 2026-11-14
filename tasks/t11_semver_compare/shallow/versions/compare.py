"""Compare dotted version strings such as "1.10.2" or "2.0.0-rc.1"."""
from itertools import zip_longest


def parse(version):
    """Split a version string into (release, pre).

    release is a list of ints, one per dotted numeric component ("1.02.3" gives
    [1, 2, 3]; leading zeros are ignored). pre is the list of dot-separated
    pre-release identifiers after the first "-", or [] if there is none.
    Identifiers are non-empty and made of ASCII letters, digits and "-".
    Surrounding whitespace is ignored.

    Raises ValueError for an empty string, an empty or non-numeric release
    component ("1..2", "1.x"), or an empty pre-release part ("1.0-", "1.0-a..b").
    """
    text = version.strip()
    release, dash, tag = text.partition("-")
    parts = release.split(".")
    if not all(p.isascii() and p.isdigit() for p in parts):
        raise ValueError(f"bad version: {version!r}")
    pre = tag.split(".") if dash else []
    for ident in pre:
        if not (ident.isascii() and ident.replace("-", "").isalnum()):
            raise ValueError(f"bad version: {version!r}")
    return [int(p) for p in parts], pre


def _ident_key(ident):
    # Numeric identifiers compare as numbers and sort before alphanumeric ones.
    return (0, 0, ident)


def compare(a, b):
    """Return -1, 0 or 1 as version a is lower than, equal to, or higher than b.

    Release numbers are compared component by component as integers; a missing
    trailing component counts as 0, so "1.2" equals "1.2.0". If the releases
    are equal, a version with a pre-release tag is LOWER than the same version
    without one ("1.2.0-rc1" < "1.2.0"). Two pre-release tags are compared
    identifier by identifier using _ident_key; if one tag is a prefix of the
    other, the shorter one is lower ("1.0-rc" < "1.0-rc.1").
    """
    ra, pa = parse(a)
    rb, pb = parse(b)
    for x, y in zip_longest(ra, rb, fillvalue=0):
        if x != y:
            return -1 if x < y else 1
    if pa == pb:
        return 0
    if not pa:
        return 1
    if not pb:
        return -1
    ka = [_ident_key(i) for i in pa]
    kb = [_ident_key(i) for i in pb]
    return (ka > kb) - (ka < kb)
