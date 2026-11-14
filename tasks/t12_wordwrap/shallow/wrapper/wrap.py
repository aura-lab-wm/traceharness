"""Greedy word wrapping for plain text."""


def wrap(text, width):
    """Wrap text into a list of lines of at most `width` characters.

    Words are the runs of non-whitespace characters in text; any run of spaces,
    tabs or newlines between words counts as one separator. Words are packed
    greedily: a word joins the current line, separated by one space, whenever
    the line stays at most `width` characters long (a line may be exactly
    `width` long). Otherwise it starts a new line.

    A word longer than `width` always starts on a new line and is cut into
    pieces of exactly `width` characters; the last piece (which may be shorter)
    is then treated like an ordinary word, so following words can join it.

    Text without words gives []. Raises ValueError if width < 1.
    """
    if width < 1:
        raise ValueError("width must be at least 1")
    lines = []
    current = ""
    for word in text.split():
        if len(word) > width:
            if current:
                lines.append(current)
                current = ""
            lines.extend(word[i:i + width] for i in range(0, len(word), width))
            continue
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines
