# Issue #19: first_index() does not return the first index for repeated values

`first_index([1, 2, 2, 2, 2, 2, 3], 2)` returns `3`; the docs say it returns the index of
the first occurrence, which here is `1`. The same wrong answer makes `count()` too small
for lists with long runs of equal values. Lists without repeated values work fine.
