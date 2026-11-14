"""Helpers for dividing amounts of money held as integer cents."""


def split_bill(total_cents, people):
    """Split ``total_cents`` between ``people`` and return the shares in cents.

    ``total_cents`` is a non-negative ``int`` of any size and ``people`` is an
    ``int`` >= 1; anything else raises ``TypeError`` (wrong type) or
    ``ValueError`` (negative total, fewer than one person).

    The result is a list of ``people`` ints that add up to exactly
    ``total_cents``. Shares differ by at most one cent: the first
    ``total_cents % people`` shares are one cent larger than the others, so the
    list is never increasing. Amounts are exact: no floating point is involved.
    """
    if not isinstance(total_cents, int) or not isinstance(people, int):
        raise TypeError("total_cents and people must be ints")
    if total_cents < 0:
        raise ValueError("total_cents must be >= 0")
    if people < 1:
        raise ValueError("people must be >= 1")
    share, leftover = divmod(total_cents, people)
    shares = [share] * people
    for i in range(leftover):
        shares[i] += 1
    return shares
