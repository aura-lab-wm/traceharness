# Issue #112: last page is followed by a phantom empty page

With 9 items and `per_page=3`, `paginate(items, 3, 3)` says `has_next` is true and
`total_pages` is 4. Page 4 then comes back as an empty list instead of an error.
This only happens when the item count is an exact multiple of `per_page`; 10 items
at 3 per page is fine. Fix `pager/paginate.py`.
