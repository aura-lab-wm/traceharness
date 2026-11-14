Bug: split_bill uses round(total/people) with float division; when rounding goes up the leftover is negative and the loop does nothing, so the sum is too large (200,3 -> 201).
Fix: `divmod(total_cents, people)`, first `rem` shares get +1.
Decoy: exact floor division but dumps the whole remainder on the last share (sum right, shares differ by more than one cent, order wrong); passes the visible sum test.
Shallow: keeps float rounding but corrects the leftover (capped at `people` steps); correct for small totals, wrong above 2**53. Strong adds brute force on 400 random inputs, huge ints, int type check.
Expected weak-agent mistake: patching the sum by adjusting the last share, or trusting float rounding.
