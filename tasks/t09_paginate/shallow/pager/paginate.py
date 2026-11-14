"""Split a sequence into numbered pages."""


def page_count(total_items, per_page):
    """Return the number of pages needed to show total_items, per_page at a time.

    The last page may be shorter than per_page. An empty collection still has
    one (empty) page, so the result is always at least 1. per_page must be >= 1.
    """
    if total_items % per_page == 0:
        return total_items // per_page
    return total_items // per_page + 1


def paginate(items, page, per_page):
    """Return one page of items as a dict.

    Pages are numbered from 1. The result has these keys:
      items        a new list with the items on this page
      page         the requested page number
      per_page     the page size
      total_items  len(items) of the whole input
      total_pages  see page_count()
      has_next     True if a page after this one exists
      has_prev     True if a page before this one exists

    Raises ValueError if per_page < 1, page < 1, or page > total_pages.
    The input sequence is never modified.
    """
    if per_page < 1:
        raise ValueError("per_page must be at least 1")
    total = len(items)
    pages = page_count(total, per_page)
    if page < 1 or page > pages:
        raise ValueError(f"page {page} out of range 1..{pages}")
    start = (page - 1) * per_page
    return {
        "items": list(items[start:start + per_page]),
        "page": page,
        "per_page": per_page,
        "total_items": total,
        "total_pages": pages,
        "has_next": page < pages,
        "has_prev": page > 1,
    }
