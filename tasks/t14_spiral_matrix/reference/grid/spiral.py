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
    top, bottom = 0, len(matrix) - 1
    left, right = 0, width - 1
    out = []
    while top <= bottom and left <= right:
        for col in range(left, right + 1):
            out.append(matrix[top][col])
        for row in range(top + 1, bottom + 1):
            out.append(matrix[row][right])
        if top < bottom:
            for col in range(right - 1, left - 1, -1):
                out.append(matrix[bottom][col])
        if left < right:
            for row in range(bottom - 1, top, -1):
                out.append(matrix[row][left])
        top += 1
        bottom -= 1
        left += 1
        right -= 1
    return out
