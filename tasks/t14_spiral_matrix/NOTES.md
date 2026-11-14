Bug: the bottom-row and left-column legs of each ring run unguarded, so a leftover single row or column is traversed twice.
Reference fix: wrap them in `if top < bottom:` and `if left < right:`.
Decoy special-cases a top-level single row/column only, so visible (squares) pass but 3x4, 4x3, 2x5 etc. still repeat inner elements.
Strong adds a cell-walking brute force on 300 random shapes (seed 14), a each-cell-once check, no-mutation and ragged-row ValueError; the shallow pop/zip-rotate rewrite mutates the input.
Expected mistake: patching only the 1xN / Nx1 symptom from the issue instead of the inner-ring case.
