"""`traceharness doctor`: do the package, the UI build, the shared sources, the runner image and the
site agree? (SPEC 4.3)

    traceharness doctor                          the local checks, as a table
    traceharness doctor --site ../traceharness-site
    traceharness doctor --compare https://traceharness.dev
    traceharness doctor --json

Every check is a row {check, status, detail}; status is ok, drift, not_applicable (the check has
nothing to look at here, e.g. an installed package has no console source) or failed (the check
could not run). Exit 0 when no row drifted or failed, 1 on any drift, 2 when a check failed.

`--compare URL` is the only network use in the package, and only when asked for: it reads
URL/api/version once, over https (or http on 127.0.0.1 / localhost), with no credentials in the URL,
a 5 s timeout, no redirect followed and at most 64 KiB read. Standard library only.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from . import generate

#: The directory that holds the `traceharness` package (a checkout's root, or site-packages).
ROOT = generate.BASE
STATUSES = ("ok", "drift", "not_applicable", "failed")
TIMEOUT_S = 5.0
MAX_BYTES = 64 * 1024
LOOPBACK = ("127.0.0.1", "localhost")

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_WHEEL = re.compile(r"traceharness-([0-9][0-9A-Za-z.+!-]*?)-py3-none-any\.whl")
_PYPROJECT_VERSION = re.compile(r'^version = "([^"]+)"', re.M)
_PYPROJECT_NAME = re.compile(r'^name = "([^"]+)"', re.M)
_TEST_FILE = re.compile(r"\.test\.[jt]sx?$")
_SITE_KEYS = ("schema", "component", "shared_sources_sha256", "shared_sources_package_version",
              "compiler_oracle_sha256", "app_snapshot", "runner")


def row(check: str, status: str, detail: str) -> dict:
    assert status in STATUSES, status
    return {"check": check, "status": status, "detail": detail}


def _version() -> str:
    from traceharness.__main__ import __version__
    return __version__


def _read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _read_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _short(value) -> str:
    return value[:12] if isinstance(value, str) else "none"


def local_bundle(root: str = ROOT) -> dict:
    """The shared-sources bundle this package ships (generate.TARGETS[0])."""
    return _read_json(os.path.join(root, generate.TARGETS[0]))


# --------------------------------------------------------------------------- local checks
def check_package(root: str = ROOT, version: str | None = None) -> dict:
    """`__version__` equals pyproject.toml's version (only in a checkout)."""
    version = version or _version()
    path = os.path.join(root, "pyproject.toml")
    if not os.path.isfile(path):
        return row("package", "not_applicable", f"traceharness {version}; no pyproject.toml here (an installed package)")
    try:
        text = _read_text(path)
    except OSError as e:
        return row("package", "failed", f"cannot read pyproject.toml: {e.strerror}")
    name, declared = _PYPROJECT_NAME.search(text), _PYPROJECT_VERSION.search(text)
    if not name or name.group(1) != "traceharness":
        return row("package", "not_applicable", f"traceharness {version}; pyproject.toml here is another project's")
    if not declared:
        return row("package", "failed", "pyproject.toml states no version")
    if declared.group(1) != version:
        return row("package", "drift", f"the package says {version}, pyproject.toml says {declared.group(1)}")
    return row("package", "ok", f"traceharness {version}, as pyproject.toml says")


def ui_source_hash(frontend: str) -> dict:
    """The hash of the console source, exactly as vite.config.js stamps it into dist/build-source.json
    and tests_agentlab/test_dist_current.py recomputes it: every non-test file under src/, plus
    index.html and package.json, sorted, each framed as path NUL bytes NUL."""
    files = []
    for dirpath, _dirs, names in os.walk(os.path.join(frontend, "src")):
        for name in names:
            if _TEST_FILE.search(name) or name == ".DS_Store":
                continue
            files.append(os.path.relpath(os.path.join(dirpath, name), frontend).replace(os.sep, "/"))
    files = sorted(files + ["index.html", "package.json"])
    h = hashlib.sha256()
    for rel in files:
        h.update(rel.encode() + b"\0")
        with open(os.path.join(frontend, rel), "rb") as f:
            h.update(f.read())
        h.update(b"\0")
    return {"sha256": h.hexdigest(), "files": len(files)}


def check_ui_build(root: str = ROOT) -> dict:
    """frontend/dist/build-source.json equals the hash of frontend/src."""
    frontend = os.path.join(root, "traceharness", "frontend")
    if not os.path.isdir(os.path.join(frontend, "src")):
        return row("ui_build", "not_applicable", "no console source here (an installed package ships only dist/)")
    try:
        source = ui_source_hash(frontend)
    except OSError as e:
        return row("ui_build", "failed", f"cannot hash the console source: {e.strerror}")
    try:
        stamp = _read_json(os.path.join(frontend, "dist", "build-source.json"))
    except (OSError, ValueError):
        return row("ui_build", "drift", f"dist/ has no readable build-source.json; the source is {_short(source['sha256'])}: "
                                        "make build-frontend")
    if stamp != source:
        built = stamp.get("sha256") if isinstance(stamp, dict) else None
        return row("ui_build", "drift", f"dist/ was built from {_short(built)}, the source is now {_short(source['sha256'])}: "
                                        "make build-frontend")
    return row("ui_build", "ok", f"dist/ was built from this source ({_short(source['sha256'])}, {source['files']} files)")


def check_shared_sources(root: str = ROOT) -> dict:
    """`python -m traceharness.shared.generate --check` is clean: both copies are what it writes."""
    if not os.path.isdir(os.path.join(root, "traceharness", "frontend", "src")):
        return row("shared_sources", "not_applicable", "no console source here to generate the bundle from")
    try:
        bundle = generate.build_bundle()
        stale = generate.stale(generate.render(bundle), root)
    except Exception as e:                                     # a source the generator reads is broken
        return row("shared_sources", "failed", f"the generator could not run: {type(e).__name__}: {e}"[:300])
    if stale:
        return row("shared_sources", "drift", f"stale: {', '.join(stale)}: python -m traceharness.shared.generate")
    return row("shared_sources", "ok", f"both copies current ({_short(bundle['content_sha256'])})")


def check_runner_image(root: str = ROOT, version: str | None = None) -> dict:
    """The wheel deploy/runner/fly/Dockerfile installs is this package's version."""
    version = version or _version()
    path = os.path.join(root, "deploy", "runner", "fly", "Dockerfile")
    if not os.path.isfile(path):
        return row("runner_image", "not_applicable", "no deploy/runner/fly/Dockerfile here")
    try:
        pins = sorted(set(_WHEEL.findall(_read_text(path))))
    except OSError as e:
        return row("runner_image", "failed", f"cannot read deploy/runner/fly/Dockerfile: {e.strerror}")
    if not pins:
        return row("runner_image", "failed", "deploy/runner/fly/Dockerfile names no traceharness-<version>-py3-none-any.whl")
    if pins != [version]:
        return row("runner_image", "drift", f"the runner image installs the traceharness {' and '.join(pins)} wheel; "
                                            f"the package is {version} (the pin moves at release, SPEC 7 step 3)")
    return row("runner_image", "ok", f"the runner image installs the traceharness {version} wheel")


def local_checks(root: str = ROOT) -> list[dict]:
    return [check_package(root), check_ui_build(root), check_shared_sources(root), check_runner_image(root)]


# --------------------------------------------------------------------------- the site
def check_site_checkout(site: str, root: str = ROOT) -> dict:
    """SITE/auth/shared/shared-sources.json is this package's bundle (hash and version)."""
    path = os.path.join(site, "auth", "shared", "shared-sources.json")
    try:
        mine = local_bundle(root)
    except (OSError, ValueError):
        return row("site_checkout", "failed", "this package has no readable shared-sources.json")
    try:
        theirs = _read_json(path)
    except OSError:
        return row("site_checkout", "failed", f"no readable auth/shared/shared-sources.json under {site}")
    except ValueError:
        return row("site_checkout", "failed", f"{path} is not JSON")
    if not isinstance(theirs, dict):
        return row("site_checkout", "failed", f"{path} is not a JSON object")
    problems = []
    if generate.content_sha256(theirs) != theirs.get("content_sha256"):
        problems.append("its content no longer matches its own content_sha256 (edited by hand?)")
    if theirs.get("content_sha256") != mine.get("content_sha256"):
        problems.append(f"content_sha256 {_short(theirs.get('content_sha256'))}, this package {_short(mine.get('content_sha256'))}")
    if theirs.get("package_version") != mine.get("package_version"):
        problems.append(f"package_version {theirs.get('package_version')}, this package {mine.get('package_version')}")
    if problems:
        return row("site_checkout", "drift", "the site's vendored bundle differs: " + "; ".join(problems)
                   + ": python3 tools/sync_shared.py --from <this checkout>")
    return row("site_checkout", "ok", f"the site vendors this bundle ({_short(mine['content_sha256'])}, "
                                      f"traceharness {mine['package_version']})")


def compare_base(url: str) -> str:
    """The base URL for --compare, or ValueError naming why it is refused: https, or http on
    127.0.0.1 / localhost only; no credentials, query or fragment; no whitespace or control
    characters. A trailing slash is dropped."""
    if not isinstance(url, str) or not url or any(c.isspace() or ord(c) < 0x20 or ord(c) == 0x7F for c in url):
        raise ValueError("the URL is empty or contains whitespace or control characters")
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("https", "http"):
        raise ValueError("only https:// URLs are compared (http:// only on 127.0.0.1 or localhost)")
    if "@" in parts.netloc:
        raise ValueError("credentials in the URL are refused")
    try:
        host, _port = parts.hostname, parts.port
    except ValueError:
        raise ValueError("the URL's host or port is malformed") from None
    if not host:
        raise ValueError("the URL names no host")
    if parts.scheme == "http" and host not in LOOPBACK:
        raise ValueError("http:// is allowed only on 127.0.0.1 or localhost; use https://")
    if parts.query or parts.fragment or url.endswith(("?", "#")):
        raise ValueError("a query or fragment is refused")
    return f"{parts.scheme}://{parts.netloc}{parts.path.rstrip('/')}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: urllib then raises HTTPError carrying the 3xx status."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_fetch(url: str, timeout: float = TIMEOUT_S, limit: int = MAX_BYTES):
    """(status, headers, at most limit + 1 body bytes) for one GET, with no redirect followed."""
    host = urllib.parse.urlsplit(url).hostname
    handlers = [_NoRedirect()]
    if host in LOOPBACK:
        handlers.append(urllib.request.ProxyHandler({}))      # a loopback check never goes through a proxy
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, method="GET", headers={"Accept": "application/json",
                                                                "User-Agent": "traceharness-doctor"})
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read(limit + 1)
    except urllib.error.HTTPError as e:                        # a 3xx (not followed) or an error status
        try:
            body = e.read(limit + 1)
        except Exception:
            body = b""
        return e.code, dict(e.headers.items()) if e.headers else {}, body


def _site_schema_problem(body) -> str | None:
    if not isinstance(body, dict):
        return "the answer is not a JSON object"
    missing = [k for k in _SITE_KEYS if k not in body]
    if missing:
        return f"the answer lacks {', '.join(missing)}"
    if body["schema"] != 1 or body["component"] != "site":
        return "the answer is not the site's version stamp (schema 1, component site)"
    for key in ("shared_sources_sha256", "compiler_oracle_sha256"):
        if not isinstance(body[key], str) or not _HEX64.match(body[key]):
            return f"{key} is not a 64-hex digest"
    if body["app_snapshot"] is not None and not isinstance(body["app_snapshot"], dict):
        return "app_snapshot is neither an object nor null"
    return None


def check_site_live(url: str, fetch=http_fetch, root: str = ROOT, version: str | None = None) -> dict:
    """URL/api/version answers the site schema with this package's shared sources, compiler oracle
    and package version."""
    try:
        target = compare_base(url) + "/api/version"
    except ValueError as e:
        return row("site_live", "failed", f"refused URL: {e}")
    try:
        mine = local_bundle(root)
    except (OSError, ValueError):
        return row("site_live", "failed", "this package has no readable shared-sources.json")
    version = version or _version()
    try:
        status, headers, raw = fetch(target, TIMEOUT_S, MAX_BYTES)
    except Exception as e:                                     # refused, unreachable, timed out, bad TLS
        return row("site_live", "failed", f"{target} could not be read: {type(e).__name__}")
    if 300 <= status < 400:
        location = {k.lower(): v for k, v in (headers or {}).items()}.get("location", "")
        where = urllib.parse.urlsplit(location).netloc or "the same host"
        return row("site_live", "failed", f"{target} answered a redirect ({status}) to {where[:80]}; redirects are not followed")
    if status != 200:
        return row("site_live", "failed", f"{target} answered HTTP {status}")
    if len(raw) > MAX_BYTES:
        return row("site_live", "failed", f"{target} answered more than {MAX_BYTES} bytes")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return row("site_live", "failed", f"{target} did not answer JSON")
    problem = _site_schema_problem(body)
    if problem:
        return row("site_live", "failed", f"{target}: {problem}")
    snapshot = body["app_snapshot"]
    differ = []
    if body["shared_sources_sha256"] != mine.get("content_sha256"):
        differ.append(f"shared sources {_short(body['shared_sources_sha256'])}, here {_short(mine.get('content_sha256'))}")
    if body["shared_sources_package_version"] != mine.get("package_version"):
        differ.append(f"the vendored bundle is from {body['shared_sources_package_version']!s:.20}, here {mine.get('package_version')}")
    if body["compiler_oracle_sha256"] != (mine.get("compiler_oracle") or {}).get("sha256"):
        differ.append(f"compiler oracle {_short(body['compiler_oracle_sha256'])}, here "
                      f"{_short((mine.get('compiler_oracle') or {}).get('sha256'))}")
    if snapshot is None:
        differ.append("the site reports no /app snapshot record")
    elif snapshot.get("package_version") != version:
        differ.append(f"/app is a traceharness {snapshot.get('package_version')!s:.20} snapshot, here {version}")
    if differ:
        return row("site_live", "drift", "; ".join(differ))
    return row("site_live", "ok", f"{target} serves this bundle and a traceharness {version} /app snapshot")


# --------------------------------------------------------------------------- command
def run(root: str = ROOT, site: str | None = None, compare: str | None = None, fetch=http_fetch) -> list[dict]:
    rows = local_checks(root)
    if site is not None:
        rows.append(check_site_checkout(site, root))
    if compare is not None:
        rows.append(check_site_live(compare, fetch=fetch, root=root))
    return rows


def exit_code(rows: list[dict]) -> int:
    statuses = {r["status"] for r in rows}
    return 2 if "failed" in statuses else 1 if "drift" in statuses else 0


def table(rows: list[dict]) -> str:
    width_check = max(len(r["check"]) for r in rows)
    width_status = max(len(r["status"]) for r in rows)
    return "\n".join(f"{r['check']:<{width_check}}  {r['status']:<{width_status}}  {r['detail']}" for r in rows)


def main(argv: list[str] | None = None, fetch=http_fetch, root: str = ROOT) -> int:
    import argparse
    p = argparse.ArgumentParser(prog="traceharness doctor",
                                description="Check that the package, the UI build, the shared sources, the runner "
                                            "image and (optionally) the site agree.")
    p.add_argument("--site", metavar="PATH", help="also compare a traceharness-site checkout's vendored bundle")
    p.add_argument("--compare", metavar="URL", help="also read URL/api/version (https, or http on 127.0.0.1/localhost); "
                                                    "the only network use, never by default")
    p.add_argument("--json", action="store_true", help="print the rows as JSON")
    args = p.parse_args(argv)
    rows = run(root, site=args.site, compare=args.compare, fetch=fetch)
    code = exit_code(rows)
    if args.json:
        print(json.dumps({"schema": 1, "result": {0: "ok", 1: "drift", 2: "failed"}[code], "rows": rows}, indent=2))
    else:
        print(table(rows))
    return code


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
