"""The one guard that turns a caller-supplied name into a path under an allowed root.

A results-directory name, a run id, a harness id or a sentinel-model name can arrive in a request
(or in a CLI argument, or inside a trace read from disk). None of them may walk the filesystem, so
every such value goes through `confine` before it reaches `open`, `os.stat` or `os.path.exists`.

`confine(root, *parts)` refuses, with `PathRefused` (a ValueError):
  * a part that is not a string, is empty, or holds a NUL or any other control character;
  * an absolute part (POSIX, a drive letter, or a leading backslash), which `os.path.join` would
    otherwise let replace the root;
  * a part with a `..` component in either separator style;
  * any result that, once symlinks are followed (`realpath`), is not the root or below it.
Route code uses `traceharness.backend.safe_paths.http_confine`, which turns a refusal into a 400.
"""
from __future__ import annotations

import os


class PathRefused(ValueError):
    """The name does not stay under the root."""


def _check_part(part) -> None:
    if not isinstance(part, str) or part == "":
        raise PathRefused("empty or non-text path component")
    if any(ord(c) < 0x20 or c == "\x7f" for c in part):
        raise PathRefused("control character in path component")
    if part.startswith(("/", "\\")) or os.path.isabs(part) or (len(part) > 1 and part[1] == ":"):
        raise PathRefused("absolute path component")
    if ".." in part.replace("\\", "/").split("/"):
        raise PathRefused("'..' in path component")


def confine(root: str, *parts: str) -> str:
    """`root/parts...` as a real path, raising PathRefused unless it stays inside `root`."""
    for part in parts:
        _check_part(part)
    base = os.path.realpath(root)
    full = os.path.realpath(os.path.join(base, *parts))
    if full != base and not full.startswith(base.rstrip(os.sep) + os.sep):
        raise PathRefused("path escapes its root")
    return full
