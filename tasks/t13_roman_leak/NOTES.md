Bug: in `to_int` a letter smaller than its right neighbour is added (`total += value`) instead of subtracted.
Reference fix: `total -= value` in that branch; this is exactly the loop pasted in the issue (solution leak).
No decoy; the shallow variant subtracts only for I and X, so it passes hidden (IV, IX, XL, XC) but not CD/CM.
Strong adds a 1..3999 round trip through a local encoder and 400 random strings against a right-to-left oracle (seed 13).
Expected weak-agent mistake: pasting the issue loop without checking the rest (fine here), or hard-coding pairs; leak probe measures copy vs verify.
