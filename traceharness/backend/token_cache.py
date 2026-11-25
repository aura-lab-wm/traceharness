"""The Tokens page's dataset-wide token profiles, kept on disk next to the dataset's index.

    load_or_build(dataset_dir, build) -> {run_id: core.tokens.run_profile}

Reading every ledger of a large dataset takes seconds (2,174 runs: about 2.7 s), and the in-memory study cache
starts empty with every server. The profiles are small once compressed (that dataset: about 1 MB), so they are
written to `<dataset_dir>/.token_profiles.json.gz` and read back on the next start.

The file is used only when its key matches: the index's mtime (ns) and size, and the code that computes the
profiles (core/tokens.py, and core/phases.py for their phases). Anything else -- a changed index, changed code, a
file that is not gzip or JSON, a profile of the wrong shape -- means the profiles are built again from the ledgers
and the file is replaced. A folder that cannot be written (a read-only install) still answers; it only skips the
file. The file is written to a temporary name and renamed, so a reader never sees half a file.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import tempfile
import zlib
from typing import Callable, Optional

CACHE_NAME = ".token_profiles.json.gz"
FORMAT = 1
#: the largest compressed file written; a bigger one is not worth keeping on disk
MAX_BYTES = 64 * 1024 * 1024
#: the most bytes a read unpacks; a file that unpacks to more is treated as damaged (no gzip bomb fills memory)
MAX_READ = 16 * MAX_BYTES
log = logging.getLogger(__name__)
_CODE: Optional[str] = None


def code_version() -> str:
    """A short hash of core/tokens.py and core/phases.py: the profiles (and their phases) depend on both, so a change
    to either invalidates every file."""
    global _CODE
    if _CODE is None:
        from traceharness.core import phases, tokens
        h = hashlib.sha256()
        for mod in (tokens, phases):
            with open(mod.__file__, "rb") as f:
                h.update(f.read())
        _CODE = h.hexdigest()[:16]
    return _CODE


def cache_key(dataset_dir: str) -> Optional[str]:
    """index mtime + size + code version, or None when there is no index to key on."""
    try:
        st = os.stat(os.path.join(dataset_dir, "index.jsonl"))
    except OSError:
        return None
    return f"{st.st_mtime_ns}:{st.st_size}:{code_version()}"


def _valid(profiles) -> bool:
    return isinstance(profiles, dict) and all(
        isinstance(k, str) and isinstance(v, dict) and isinstance(v.get("calls"), list) and all(isinstance(c, dict) for c in v["calls"])
        for k, v in profiles.items())


def load(dataset_dir: str, key: Optional[str]) -> Optional[dict]:
    """The cached profiles when the file exists and its key is `key`, else None."""
    if key is None:
        return None
    try:
        with gzip.open(os.path.join(dataset_dir, CACHE_NAME), "rb") as f:
            raw = f.read(MAX_READ)                    # cut at MAX_READ: a longer file cannot parse
        doc = json.loads(raw)
    except (OSError, EOFError, ValueError, zlib.error, RecursionError):
        return None
    if not isinstance(doc, dict) or doc.get("format") != FORMAT or doc.get("key") != key:
        return None
    profiles = doc.get("profiles")
    return profiles if _valid(profiles) else None


def save(dataset_dir: str, key: Optional[str], profiles: dict) -> bool:
    """Write the file (temp file + rename). False, and no file, when it cannot be written or is too big."""
    if key is None:
        return False
    try:
        data = gzip.compress(json.dumps({"format": FORMAT, "key": key, "profiles": profiles}, separators=(",", ":")).encode(), 6)
    except (TypeError, ValueError, RecursionError) as e:
        log.info("token profile cache not written for %s: %s", os.path.basename(dataset_dir), e)
        return False
    if len(data) > MAX_BYTES:
        return False
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(prefix=".tmp-token-profiles-", dir=dataset_dir)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, os.path.join(dataset_dir, CACHE_NAME))
        return True
    except OSError as e:
        log.info("token profile cache not written for %s: %s", os.path.basename(dataset_dir), e)
        if tmp and os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        return False


def load_or_build(dataset_dir: str, build: Callable[[], dict]) -> dict:
    """The profiles from the file when it is current, else `build()` (then written for next time)."""
    key = cache_key(dataset_dir)
    hit = load(dataset_dir, key)
    if hit is not None:
        return hit
    profiles = build()
    # the index may have changed while the ledgers were read: keep the file only if the key still holds
    if cache_key(dataset_dir) == key:
        save(dataset_dir, key, profiles)
    return profiles
