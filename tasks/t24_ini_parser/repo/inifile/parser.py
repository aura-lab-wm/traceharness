"""A tiny INI dialect."""


def parse(text):
    """Parse INI ``text`` into ``{section: {key: value}}`` (all strings).

    * ``[name]`` on its own line opens a section; the name is whatever lies
      between the first ``[`` and the last ``]``, stripped. It may not be empty.
      Opening a section again continues it.
    * ``key = value`` sets a key in the current section. The line is split at
      the FIRST ``=``; key and value are stripped of surrounding whitespace.
      The value is everything after that ``=`` and may itself contain ``=``,
      ``#`` and ``;``. There are no inline comments. An empty value is ``""``.
      A repeated key keeps its last value.
    * Blank lines, and lines whose first non-blank character is ``#`` or ``;``,
      are ignored.
    * Anything else raises ``ValueError``: a key line before any section, a line
      without ``=``, or an empty key.
    """
    result = {}
    section = None
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line[0] in "#;":
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            if not section:
                raise ValueError(f"line {number}: empty section name")
            result.setdefault(section, {})
            continue
        if section is None:
            raise ValueError(f"line {number}: key outside of a section")
        parts = line.split("=")
        if len(parts) < 2:
            raise ValueError(f"line {number}: expected key = value")
        key = parts[0].strip()
        if not key:
            raise ValueError(f"line {number}: empty key")
        result[section][key] = parts[1].split("#")[0].strip()
    return result
