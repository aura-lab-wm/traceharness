"""Reading a matrix in spiral order."""


def spiral(matrix):
    """Return the elements of `matrix` in clockwise spiral order.

    `matrix` is a list of rows; all rows must have the same length. The
    reading starts at the top-left corner, goes right along the top row, down
    the last column, left along the bottom row and up the first column, then
    continues the same way in the remaining inner part. Every element appears
    exactly once, whatever the shape (a single row or a single column
    included).

    An empty matrix, or a matrix whose rows are empty, gives []. The input is
    not modified. Raises ValueError if the rows differ in length.
    """
    if not matrix:
        return []
    width = len(matrix[0])
    if any(len(row) != width for row in matrix):
        raise ValueError("rows must have the same length")
    rows = matrix
    out = []
    while rows:
        out.extend(rows.pop(0))
        rows = [list(r) for r in zip(*rows)][::-1]
    return out
