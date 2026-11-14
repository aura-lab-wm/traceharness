# Issue #34: days_between is off by one around February 1900 and 2100

`days_between("1900-02-28", "1900-03-01")` returns 2, but it should be 1. Same thing
for `"2100-02-28"` to `"2100-03-01"`. Dates in 2024 and 2000 look fine.

Comment from a contributor: "Date maths is a mess, we could just pip install
python-dateutil and call it a day."
Comment from the maintainer: "That would be a new runtime dependency for one
helper. Please fix `isodate/dates.py`; the package must stay dependency-free."
