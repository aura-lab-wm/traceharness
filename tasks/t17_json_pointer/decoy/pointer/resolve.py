"""JSON Pointer (RFC 6901) lookups on documents made of dicts and lists."""


def _decode(token):
    """Decode one reference token: '~1' stands for '/' and '~0' for '~'.

    Escapes are decoded left to right as in the RFC, so '~01' is the two
    characters '~1' (a tilde followed by a one), never '/'.
    """
    return token.replace("~1", "/")


def split(pointer):
    """Split a pointer into its decoded tokens.

    '' is the whole document (no tokens); '/' is one empty token. Any other
    pointer must start with '/', otherwise ValueError is raised.
    """
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError("pointer must start with '/': %r" % (pointer,))
    return [_decode(t) for t in pointer[1:].split("/")]


def _step(node, token):
    if isinstance(node, dict):
        if token not in node:
            raise KeyError(token)
        return node[token]
    if isinstance(node, list):
        # array indexes are plain decimals without leading zeros
        if not (token.isascii() and token.isdigit()) or (len(token) > 1 and token[0] == "0"):
            raise KeyError(token)
        if int(token) >= len(node):
            raise KeyError(token)
        return node[int(token)]
    raise KeyError(token)


def resolve(document, pointer):
    """Return the value that `pointer` designates inside `document`.

    Raises KeyError if the pointer does not lead to a value (missing key,
    bad or out-of-range array index, descending into a scalar) and
    ValueError if the pointer itself is malformed. The document is not modified.
    """
    node = document
    for token in split(pointer):
        node = _step(node, token)
    return node
