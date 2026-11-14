Bug: the fit test uses < width, so a line that exactly fills the width is never allowed.
Fix: change < to <= in len(current) + 1 + len(word) <= width.
Decoy: drops the separator from the length check (len(current) + len(word) <= width), so lines can exceed width by the number of joins; visible tests only use cases where this does not show.
Strong adds: 400 random texts against a token-by-token oracle, line-length/no-loss properties, tail of a split long word joined by later words. Shallow ends the line after a split long word.
Weak agent mistake: off-by-one in the other direction (lines of width+1) or rewriting the long-word logic and breaking it.
