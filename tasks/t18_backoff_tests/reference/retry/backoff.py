"""Exponential backoff schedules for retrying failed requests."""


def delays(attempts, base, cap):
    """Return the list of waiting times (seconds) before each of `attempts` retries.

    The first delay is `base`, every following delay is twice the previous
    one, and no delay is ever larger than `cap`: once the doubling would
    exceed `cap`, that delay and all later ones are exactly `cap`. If `base`
    itself is larger than `cap`, every delay is `cap`.

    `attempts` may be 0 (empty schedule) but not negative; `base` and `cap`
    must be positive. Violations raise ValueError.
    """
    if attempts < 0 or base <= 0 or cap <= 0:
        raise ValueError("attempts must be >= 0 and base, cap must be > 0")
    out = []
    delay = base
    for _ in range(attempts):
        out.append(min(delay, cap))
        delay *= 2
    return out
