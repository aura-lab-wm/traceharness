# Issue #12: `spiral` repeats elements for some rectangular matrices

`spiral([[1, 2, 3]])` returns `[1, 2, 3, 2, 1]` instead of `[1, 2, 3]`, and
`spiral([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]])` returns more than twelve
values. Square matrices look fine. Every element should appear exactly once.
