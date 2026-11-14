# Issue #34: `to_int("IV")` returns 6

Subtractive pairs are added instead of subtracted: `to_int("IV")` gives 6,
`to_int("IX")` gives 11 and `to_int("XLII")` gives 82.

---
**Comment by reporter:** I traced it to the main loop in `roman/numerals.py`.
This is the corrected loop, it works for me locally:

```python
total = 0
for i, ch in enumerate(text):
    value = _VALUES[ch]
    if i + 1 < len(text) and value < _VALUES[text[i + 1]]:
        total -= value
    else:
        total += value
```
