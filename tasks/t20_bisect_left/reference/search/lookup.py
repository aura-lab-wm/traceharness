"""Lookups in sorted sequences."""


def first_index(sorted_list, target):
    """Return the index of the FIRST occurrence of `target`, or -1 if absent.

    `sorted_list` is in non-decreasing order and may contain repeated values.
    This is a binary search: it only uses len() and indexing, and looks at
    O(log n) elements. The sequence is not modified.
    """
    lo, hi = 0, len(sorted_list) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if sorted_list[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    if lo < len(sorted_list) and sorted_list[lo] == target:
        return lo
    return -1


def count(sorted_list, target):
    """Return how many elements of `sorted_list` equal `target`."""
    i = first_index(sorted_list, target)
    if i < 0:
        return 0
    n = 0
    while i + n < len(sorted_list) and sorted_list[i + n] == target:
        n += 1
    return n
