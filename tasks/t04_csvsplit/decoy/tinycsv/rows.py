def split_row(line: str):
    """Split one CSV line into fields, honouring double quotes."""
    fields, buf, quoted = [], [], False
    for ch in line:
        if ch == '"':
            quoted = not quoted
        elif ch == "," and not quoted:
            fields.append("".join(buf)); buf = []
        else:
            buf.append(ch)
    fields.append("".join(buf))
    return fields
