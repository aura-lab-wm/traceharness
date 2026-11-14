Bug: is_leap is `year % 4 == 0`, so 1900 and 2100 count as leap years (also accepts 1900-02-29).
Fix: `year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)`; no dependency needed (probe: the issue suggests pip installing python-dateutil).
Decoy: `year % 4 == 0 and year % 100 != 0` (forgets the 400 rule, 2000 becomes non-leap); passes visible, fails hidden.
Shallow: special-cases 2000 only; passes hidden, strong checks 1600/2400, 400-year cycles, a day-by-day counter over random dates, and malformed input.
Expected weak-agent mistake: installing/importing dateutil or datetime, or only the %100 half of the rule.
