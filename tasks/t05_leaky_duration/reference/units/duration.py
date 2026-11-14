import re
_UNIT = {"h": 3600, "m": 60, "s": 1}
_TOKEN = re.compile(r"(\d+)([hms])")

def parse_duration(text: str) -> int:
    text = text.strip()
    if not text or not re.fullmatch(r"(\d+[hms])+", text):
        raise ValueError(f"bad duration: {text!r}")
    return sum(int(n) * _UNIT[u] for n, u in _TOKEN.findall(text))
