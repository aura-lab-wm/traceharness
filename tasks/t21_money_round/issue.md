# Issue #112: split_bill does not add up to the bill

`split_bill(200, 3)` returns `[67, 67, 67]`, which is 201 cents: the restaurant
gets a cent more than the bill and the group is out of balance. Other totals come
out one cent short instead. The shares must always add up to exactly the amount
that was split. Fix `money/split.py`.
