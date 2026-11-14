Bug: parse() returns release components as strings (and compare pads with "0"), so "10" < "9" and "02" != "2".
Fix: return [int(p) for p in parts] and pad with fillvalue=0.
Decoy: converts to ints but compares the lists directly without zero padding, so "1.2" != "1.2.0".
Strong adds: 500 random version pairs against an independent sort-key oracle, antisymmetry, numeric pre-release ids (rc.2 < rc.10), numeric before alphanumeric. Shallow compares pre-release identifiers as plain strings.
Weak agent mistake: fixing only the symptom in the issue (multi-digit) and forgetting padding or pre-release ordering.
