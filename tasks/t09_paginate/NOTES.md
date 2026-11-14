Bug: page_count() returns n // per_page + 1, one page too many when n is a multiple of per_page.
Fix: max(1, ceil(n / per_page)) via (n + per_page - 1) // per_page.
Decoy: fixes only has_next (start + per_page < total); total_pages stays wrong and page 4 of 9/3 is accepted.
Strong adds: empty input has one page, brute-force page walk over 300 random inputs, no mutation, error cases. Shallow special-cases exact multiples and gives 0 pages for empty input.
Weak agent mistake: patches has_next or the last-page slice instead of the page count, or special-cases n % per_page == 0 and breaks the empty list.
