import re
_UNIT = {"h": 3600, "m": 60, "s": 1}
_TOKEN = re.compile(r"(\d+)([hms])")

def parse_duration(text: str) -> int:
    text = text.strip()
    return sum(int(n) * _UNIT[u] for n, u in _TOKEN.findall(text))
