"""Phase of an agent's shell command: explore, reproduce, edit, test, lookup, env, submit or other.

Deterministic labels for mini-swe-agent bash commands.

A command is split into shell segments at top-level `&&`, `||`, `;`, `|`, `&`, newlines and
parentheses (quotes and heredoc bodies respected). Each segment gets one label from its program;
the command's label is the highest-precedence segment label:

    submit > lookup > edit > test > reproduce > env > explore > other

Segment rules (program = first word after env assignments and timeout/nohup/time/xargs/setsid/
env -u NAME; `bash -c '...'`/`sh -c '...'` is judged by its inner command; `cd DIR` sets the directory
that relative paths of later segments resolve against, every command starting in /testbed):
  submit    the command contains COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT
  lookup    network fetch from an outside host: curl/wget naming an external http(s) host, git clone/fetch/
            pull/ls-remote/remote add, pip download/index, pip install of the task's own package by name,
            python code that calls urlopen/urllib.request/requests.get|post|head/http.client/httpx/socket
            and names an external http(s) host (local and placeholder hosts such as localhost, 127.x,
            example.com, httpbin.org, dotless names do not count: those runs are labelled by the other rules)
  edit      a write to a non-scratch file: sed -i, perl -i, awk -i inplace, patch, git apply/am,
            git checkout -- <file>/git restore/git reset --hard, output redirection (>, >>, tee) to a
            non-scratch path, cp/mv onto a non-scratch path, python code that writes files (open(..,'w'|'a'),
            write_text, shutil.copy/move, os.replace/rename, fileinput inplace) and names a non-scratch path
  test      pytest/py.test, runtests.py, tox, nosetests, bin/test, bin/doctest, python -m unittest/doctest/
            sympy.testing.runtests, manage.py test, django-admin test, python code calling pytest.main/
            unittest.main/call_command('test'/sympy.test(/doctest.testmod; running a script that lives in a
            tests/ or testing/ directory; static checks of the agent's edit (py_compile, compileall, flake8,
            pyflakes, mypy, black --check, python code calling ast.parse/py_compile.compile)
  reproduce any other python run: python -c, python - (stdin/heredoc), python <script> (scratch scripts,
            the project's own tools such as python -m sphinx/pylint), curl/wget to a local host, sed -i on a
            scratch file, and cat/echo/printf writes to scratch paths. A scratch path is: anything under
            /tmp, /var/tmp, /dev, ~, /root; a .log .diff .patch .out .orig .bak .rej .pyc .swp file anywhere;
            at the repository root only, a .py/.sh/.txt/.json/.html/.csv file that is not a project file
            (setup.py, conftest.py, ...) or a file named like scratch (repro*, debug*, test_fix*, ...).
            Files inside the project's directories are never scratch.
  env       pip install/uninstall/list/show/freeze/config/cache/--version, python -m pip/venv, conda, apt(-get),
            setup.py, which, uname, nproc, env/printenv, python --version, python code that only prints
            __version__
  explore   ls, find, grep/egrep/rg/ag, cat/head/tail/less/nl/wc/awk/sed without -i, tree, file, stat, diff,
            cmp, sort/uniq/cut/tr, [ / test file checks, git apply --check/--stat, git log/show/diff/status/blame/grep/ls-files/rev-parse/tag/branch/
            merge-base/describe/cat-file/ls-tree/shortlog/remote -v, python code that only reads source
            (inspect.getsource, __file__, open(..).read()) and writes nothing
  other     everything else (rm, mkdir, touch, echo/printf to stdout, sleep, kill, ps, git stash/add/commit,
            unzip/tar, cp/mv/tee onto scratch paths, shell keywords)

Scripts written by heredoc (cat > f <<EOF, tee f <<EOF) are remembered per run, so running such a
script later (python /tmp/fix.py) is judged by its body, as python code.

Lookup here is the rule's call (any fetch from an outside host); a source that lists its own lookups
can be more exact. Paths resolve against /testbed, the SWE-bench working directory.

Runs that call lab tools instead of a shell get their phase from the tool (`tool_phase`), and
`action_letter` maps a phase onto the patterns alphabet (core/patterns.py).
"""
from __future__ import annotations

import os
import re
import shlex
from dataclasses import dataclass, field

PRECEDENCE = ["submit", "lookup", "edit", "test", "reproduce", "env", "explore", "other"]
RANK = {p: i for i, p in enumerate(PRECEDENCE)}
SUBMIT_MARK = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"

PY_NET = re.compile(r"urlopen|urllib\.request|\brequests\.(get|post|head|Session|request)\b|http\.client|"
                    r"\bhttpx\b|\bsocket\.(create_connection|socket)\b|\bhttplib\b|urlretrieve")
URL_HOST = re.compile(r"https?://([^/\s'\"\\:?#]+)")
LOCAL_HOST = re.compile(r"\A(localhost|127\.[\d.]+|0\.0\.0\.0|\[?::1\]?|testserver|[\w.-]*example\.(com|org|net)|"
                        r"[\w.-]*\.(test|invalid|local|localhost)|httpbin\.org|[\w-]+)\Z", re.IGNORECASE)
PACKAGE_KEY = "\x00package"
PY_TEST = re.compile(r"pytest\.main\(|unittest\.main\(|call_command\(\s*['\"]test['\"]|\bsympy\.test\(|"
                     r"\bdoctest\.(testmod|testfile)\(|\brunTests\(|DiscoverRunner|get_runner\(")
PY_WRITE = re.compile(r"open\([^()]*?,\s*(mode\s*=\s*)?['\"](w|a|r\+|wb|ab|w\+|a\+|x)['\"]|\.write_text\(|"
                      r"\.write_bytes\(|shutil\.(copy|copyfile|copy2|move)\(|os\.(rename|replace)\(|"
                      r"fileinput\.(input|FileInput)\([^)]*inplace")
PY_FILE_LIT = re.compile(r"['\"]((?:/|\./|\.\./)?[\w.\-/]+\.(?:py|pyi|pyx|txt|rst|cfg|toml|ini|json|ya?ml|"
                         r"html|css|js|c|h|po|md|in|csv|tex|svg))['\"]")
PY_STATIC = re.compile(r"\bast\.parse\(|py_compile\.compile\(|\bcompile\(\s*open\(")
PY_READ_ONLY = re.compile(r"inspect\.(getsource|getsourcefile|getsourcelines|getfile)|\.__file__|"
                          r"open\([^()]*\)\.read(lines)?\(|\bhelp\(")
PY_VERSION_ONLY = re.compile(r"\A[\s\w.;,()'\"]*__version__[\s\w.;,()'\"]*\Z")

EXPLORE_PROGS = {"ls", "find", "grep", "egrep", "fgrep", "rg", "ag", "cat", "head", "tail", "less", "more", "nl",
                 "wc", "awk", "gawk", "tree", "file", "stat", "diff", "cmp", "sort", "uniq", "cut", "tr", "column",
                 "jq", "du", "readlink", "realpath", "basename", "dirname", "xxd", "od", "hexdump", "strings",
                 "zcat", "zgrep", "bat", "locate", "md5sum", "sha256sum", "comm", "pwd", "zipinfo", "type",
                 "[", "[[", "test"}
GIT_EXPLORE = {"log", "show", "diff", "status", "blame", "grep", "ls-files", "rev-parse", "tag", "branch",
               "merge-base", "describe", "cat-file", "ls-tree", "shortlog", "rev-list", "name-rev", "reflog",
               "whatchanged", "annotate", "config", "--version", "version"}
GIT_NET = {"clone", "fetch", "pull", "ls-remote"}
GIT_EDIT = {"apply", "am", "restore", "cherry-pick", "revert", "merge"}
ENV_PROGS = {"conda", "apt", "apt-get", "yum", "brew", "npm", "which", "uname", "nproc", "env", "printenv",
             "locale", "whereis", "lscpu", "free", "df", "virtualenv", "mamba", "micromamba"}
PIP_ENV = {"install", "uninstall", "list", "show", "freeze", "config", "cache", "--version", "-V", "check",
           "inspect", "debug", "wheel", "hash"}
PREFIX_WORDS = {"timeout", "nohup", "time", "sudo", "xargs", "nice", "stdbuf", "command", "exec", "builtin", "setsid",
                "do", "then", "else", "elif", "if", "while", "until", "!", "{", "eval"}
SKIP_PROGS = {"done", "fi", "esac", "}", "for", "case", "in", "true", "false", ":", "cd", "pushd", "popd",
              "export", "unset", "set", "source", ".", "wait", "exit", "return", "local", "declare", "shopt"}
TEST_MODULES = {"pytest", "py.test", "unittest", "doctest", "nose", "nose2", "tox", "sympy.testing.runtests"}
STATIC_MODULES = {"py_compile", "compileall", "flake8", "pyflakes", "mypy", "black", "pycodestyle", "ruff",
                  "isort"}
PROJECT_ROOT_FILES = {"setup.py", "conftest.py", "runtests.py", "manage.py", "noxfile.py", "tasks.py",
                      "versioneer.py", "isympy.py", "_version.py", "pavement.py", "fabfile.py", "doc_build.py"}
SCRATCH_STEM = re.compile(r"\A(repro|reproduce|debug|check|verify|scratch|temp|tmp|demo|try|my_|test_repro|"
                          r"test_issue|test_fix|test_bug|test_my|fix_|patch|apply_|edit_|modify_|update_|run_|"
                          r"example|sample|out|output|result|log|minimal|mwe|poc|validate|confirm|compare|before|"
                          r"after|orig|new_|old_|final_|simple|quick|trace|inspect|show_|print_|investigate)",
                          re.IGNORECASE)
SCRATCH_EXT = (".log", ".diff", ".patch", ".out", ".orig", ".bak", ".rej", ".pyc", ".swp")   # anywhere
ROOT_SCRATCH_EXT = (".py", ".sh", ".txt", ".json", ".html", ".csv")       # only at the repository root
CWD_KEY = "\x00cwd"
PY_PROG = re.compile(r"\A(python|python3|python3\.\d+|python2(\.\d+)?|pypy3?)\Z")
ENV_ASSIGN = re.compile(r"\A[A-Za-z_][A-Za-z0-9_]*=")
REPO = "/testbed"


@dataclass
class Segment:
    text: str
    heredocs: list = field(default_factory=list)       # heredoc bodies attached to this segment
    redirects: list = field(default_factory=list)      # output redirection targets (> or >>), top level


def split_segments(cmd: str) -> list:
    """Split a shell command at top-level separators; keep heredoc bodies and > targets per segment."""
    segs, buf, i, n = [], [], 0, len(cmd)
    cur = Segment("")
    pending: list = []          # heredocs opened on this line: (delimiter, strip_tabs)
    quote = None

    def flush() -> None:
        nonlocal cur, buf
        cur.text = "".join(buf).strip()
        if cur.text or cur.heredocs:
            segs.append(cur)
        cur, buf = Segment(""), []

    while i < n:
        ch = cmd[i]
        if quote:
            buf.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < n:
                buf.append(cmd[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "\\" and i + 1 < n:
            buf.append(cmd[i:i + 2])
            i += 2
            continue
        if ch == "#" and (not buf or buf[-1] in (" ", "\t", "\n")) and not "".join(buf).strip():
            j = cmd.find("\n", i)                         # a comment line
            i = n if j < 0 else j
            continue
        if cmd.startswith("<<", i) and not cmd.startswith("<<<", i):
            m = re.match(r"<<(-?)\s*(['\"]?)([\w.\-]+)\2", cmd[i:])
            if m:
                pending.append((m.group(3), m.group(1) == "-", cur))
                buf.append(m.group(0))
                i += m.end()
                continue
        if cmd.startswith(">&", i) or cmd.startswith("&>", i) and cmd.startswith("&>&", i):
            m = re.match(r"(?:>&|&>&)\s*-?\d*-?", cmd[i:])          # fd duplication: 2>&1, >&2
            buf.append(m.group(0))
            i += m.end()
            continue
        if cmd.startswith("&>", i):                                   # &> file and &>> file
            m = re.match(r"&>>?\s*(['\"]?)([^\s;&|()'\"<>]+)\1", cmd[i:])
            if m:
                if m.group(2) != "/dev/null":
                    cur.redirects.append(m.group(2))
                buf.append(m.group(0))
                i += m.end()
                continue
        if ch == ">" and not (buf and buf[-1] in ("2", "1")):
            m = re.match(r">>?\s*(['\"]?)([^\s;&|()'\"<>]+)\1", cmd[i:])
            if m:
                tgt = m.group(2)
                if tgt != "/dev/null" and not tgt.startswith("&"):
                    cur.redirects.append(tgt)
                buf.append(m.group(0))
                i += m.end()
                continue
        if ch == "\n":
            if pending:                                  # consume heredoc bodies after this line
                rest = cmd[i + 1:]
                lines = rest.split("\n")
                k = 0
                for delim, strip_tabs, owner in pending:
                    body = []
                    while k < len(lines):
                        line = lines[k]
                        k += 1
                        if (line.lstrip("\t") if strip_tabs else line).strip() == delim:
                            break
                        body.append(line)
                    owner.heredocs.append("\n".join(body))
                pending = []
                i = i + 1 + len("\n".join(lines[:k])) + (1 if k < len(lines) else 0)
                # the heredoc ends a line: whatever follows on the delimiter line is a new segment
                flush()
                continue
            flush()
            i += 1
            continue
        if cmd.startswith("&&", i) or cmd.startswith("||", i):
            flush()
            i += 2
            continue
        if ch in ";|&()":
            if ch == "(" and buf and buf[-1] == "$":       # keep $( ... ) inside the segment
                buf.append(ch)
                i += 1
                continue
            flush()
            i += 1
            continue
        buf.append(ch)
        i += 1
    flush()
    return segs


def _words(text: str) -> list:
    try:
        return shlex.split(text, comments=False, posix=True)
    except ValueError:
        return text.split()


def _strip_prefix(words: list) -> list:
    out = list(words)
    while out:
        w = out[0]
        if ENV_ASSIGN.match(w):
            out = out[1:]
        elif w in PREFIX_WORDS:
            out = out[1:]
            if w == "timeout":
                while out and (out[0].startswith("-") or re.fullmatch(r"[\d.]+[smhd]?", out[0])):
                    out = out[1:]
            elif w in ("time", "nice", "stdbuf", "xargs"):
                while out and out[0].startswith("-"):
                    out = out[1:]
        elif w == "env" and len(out) > 1 and (ENV_ASSIGN.match(out[1]) or out[1].startswith("-")):
            out = out[1:]
            while out and out[0].startswith("-"):                      # env -i, env -u NAME
                out = out[2:] if out[0] in ("-u", "--unset", "-C", "--chdir") else out[1:]
        else:
            break
    return out


def resolve(path: str, cwd: str = REPO) -> str:
    p = path.strip().strip("'\"")
    if p.startswith(("/", "~", "$")):
        return p
    return os.path.normpath(os.path.join(cwd, p))


def is_scratch(path: str, cwd: str = REPO) -> bool:
    """True for files the agent writes for itself, not part of the code under repair: anything
    under /tmp, /var/tmp, /dev, ~ or /root; backup/diff/log files anywhere; and at the repository
    root, ad-hoc .py/.sh/.txt/.json files that are not project files, or files named like scratch
    (repro*, debug*, test_fix*, ...). Files inside the project's directories are never scratch."""
    p = resolve(path, cwd)
    if p.startswith(("/tmp", "/var/tmp", "/dev/", "~", "$HOME", "$TMP", "/root")):
        return True
    base = os.path.basename(p)
    if base.lower().endswith(SCRATCH_EXT):
        return True
    if p.startswith(REPO + "/") and "/" not in p[len(REPO) + 1:]:
        if base in PROJECT_ROOT_FILES or base.lower().startswith("requirements"):
            return False
        return base.lower().endswith(ROOT_SCRATCH_EXT) or bool(SCRATCH_STEM.match(base))
    return False


def _is_test_path(path: str, cwd: str = REPO) -> bool:
    p = resolve(path, cwd)
    return bool(re.search(r"/(tests?|testing)/", p)) and not is_scratch(p)


def external_url(text: str) -> bool:
    """True when the text names an http(s) host that is not local or a test/placeholder host
    (localhost, 127.x, example.com, *.test, httpbin.org, or a dotless name such as 'testserver')."""
    return any(not LOCAL_HOST.match(h) for h in URL_HOST.findall(text))


def _pip_label(args: list, package: str) -> str:
    """pip download/index, or pip install of the task's own package by name, fetch from PyPI."""
    words = [a for a in args if not a.startswith("-")]
    sub = words[0] if words else ""
    if sub in ("download", "index"):
        return "lookup"
    if sub == "install" and package:
        norm = package.lower().replace("_", "-")
        names = [re.split(r"[<>=!~\[ ;@]", w, maxsplit=1)[0].lower().replace("_", "-") for w in words[1:]]
        if norm in names:
            return "lookup"
    return "env"


def classify_python_code(code: str, cwd: str = REPO) -> str:
    if PY_NET.search(code) and external_url(code):
        return "lookup"
    if PY_WRITE.search(code):
        targets = [t for t in PY_FILE_LIT.findall(code)]
        if any(not is_scratch(t, cwd) for t in targets):
            return "edit"
        return "reproduce"
    if PY_TEST.search(code) or PY_STATIC.search(code):
        return "test"
    if PY_VERSION_ONLY.match(code.strip()) and "__version__" in code:
        return "env"
    if PY_READ_ONLY.search(code) and not re.search(r"\b(assert|raise)\b", code):
        return "explore"
    return "reproduce"


def _python(words: list, seg: Segment, scripts: dict) -> str:
    cwd = scripts.get(CWD_KEY, REPO)
    args = words[1:]
    while args and args[0].startswith("-") and args[0] not in ("-c", "-m", "-"):
        if args[0] in ("--version", "-V", "-VV"):
            return "env"
        args = args[1:] if args[0] not in ("-W", "-X") else args[2:]
    if not args or args[0].startswith("<"):                          # python << EOF, python < file
        return classify_python_code("\n".join(seg.heredocs), cwd) if seg.heredocs else "reproduce"
    a = args[0]
    if a == "-c":
        return classify_python_code(args[1] if len(args) > 1 else "", cwd)
    if a == "-":
        return classify_python_code("\n".join(seg.heredocs), cwd) if seg.heredocs else "reproduce"
    if a == "-m":
        mod = args[1] if len(args) > 1 else ""
        if mod in TEST_MODULES or mod.startswith("sympy.testing"):
            return "test"
        if mod in STATIC_MODULES:
            return "test"
        if mod == "pip":
            return _pip_label(args[2:], scripts.get(PACKAGE_KEY, ""))
        if mod in ("venv", "ensurepip", "site"):
            return "env"
        if mod == "django" and "test" in args[2:3]:
            return "test"
        if mod in ("zipfile", "tarfile", "json.tool", "http.server"):
            return "other"
        return "reproduce"
    return _run_script(a, args[1:], scripts)


def _run_script(path: str, rest: list, scripts: dict) -> str:
    cwd = scripts.get(CWD_KEY, REPO)
    base = os.path.basename(path)
    if base == "runtests.py" or base in ("test", "doctest") and "bin" in path:
        return "test"
    if base == "manage.py":
        return "test" if rest[:1] == ["test"] else "reproduce"
    if base == "setup.py":
        return "env"
    key = resolve(path, cwd)
    if key in scripts:
        return classify_python_code(scripts[key], cwd)
    if _is_test_path(path, cwd):
        return "test"
    return "reproduce"


def _write_label(targets: list, cwd: str = REPO) -> str:
    return "edit" if any(not is_scratch(t, cwd) for t in targets) else "reproduce"


def classify_segment(seg: Segment, scripts: dict) -> str:
    cwd = scripts.get(CWD_KEY, REPO)
    words = _strip_prefix(_words(seg.text))
    prog = os.path.basename(words[0]) if words else ""
    args = words[1:]
    labels = []
    # a redirect onto a project file is an edit whatever the program; a scratch redirect only
    # counts (as reproduce set-up) for programs whose job is to write text: cat, echo, printf
    if any(not is_scratch(t, cwd) for t in seg.redirects):
        labels.append("edit")
    elif seg.redirects and prog in ("cat", "echo", "printf", ""):
        labels.append("reproduce")
    if not words:
        return labels[0] if labels else "other"
    if prog in SKIP_PROGS:
        lab = "other"
    elif prog in ("bash", "sh", "zsh") and "-c" in args[:2] and args.index("-c") + 1 < len(args):
        lab = classify(args[args.index("-c") + 1], scripts)          # judged by the inner command
        scripts[CWD_KEY] = cwd                                        # the inner shell's cd does not leak
    elif PY_PROG.match(prog):
        lab = _python(words, seg, scripts)
    elif prog in ("pytest", "py.test", "tox", "nosetests", "nose2", "runtests.py") or \
            (prog in ("test", "doctest") and "bin" in words[0]):
        lab = "test"
    elif prog in ("flake8", "pyflakes", "mypy", "pycodestyle", "ruff") or (prog == "black" and "--check" in args):
        lab = "test"
    elif prog in ("curl", "wget"):
        lab = "lookup" if external_url(seg.text) else "reproduce"
    elif prog in ("pip", "pip3"):
        lab = _pip_label(args, scripts.get(PACKAGE_KEY, ""))
    elif prog == "git":
        a = list(args)
        while a and a[0] in ("-C", "-c", "--git-dir", "--work-tree", "--no-pager") or (a and a[0].startswith("--")):
            a = a[2:] if a[0] in ("-C", "-c", "--git-dir", "--work-tree") else a[1:]
        sub = a[0] if a else ""
        if sub in GIT_NET or (sub == "remote" and a[1:2] == ["add"]):
            lab = "lookup"
        elif sub == "apply" and ("--check" in a or "--stat" in a):
            lab = "explore"                                          # read-only dry run
        elif sub in GIT_EDIT or (sub == "checkout" and ("--" in a or any(x.endswith(".py") for x in a))) or \
                (sub == "reset" and "--hard" in a):
            lab = "edit"
        elif sub in GIT_EXPLORE or sub == "remote" or sub == "stash" and a[1:2] in (["list"], ["show"]):
            lab = "explore"
        else:
            lab = "other"
    elif prog == "sed":
        inplace = any(re.match(r"\A(-i|--in-place|-[a-zA-Z]*i)", x) for x in args if x.startswith("-"))
        files = [x for x in args if not x.startswith("-")][1:]
        lab = _write_label(files, cwd) if inplace and files else ("edit" if inplace else "explore")
    elif prog == "perl":
        inplace = any(re.match(r"\A-[a-zA-Z]*i", x) for x in args if x.startswith("-"))
        files = [x for x in args if not x.startswith("-")][1:]
        lab = (_write_label(files, cwd) if files else "edit") if inplace else "explore"
    elif prog in ("awk", "gawk") and "inplace" in args:
        lab = "edit"
    elif prog in ("patch",):
        lab = "edit"
    elif prog == "tee":
        files = [x for x in args if not x.startswith("-")]
        if seg.heredocs:
            for f in files:
                scripts[resolve(f, cwd)] = "\n".join(seg.heredocs)
        lab = "edit" if any(not is_scratch(f, cwd) for f in files) else "other"
    elif prog in ("cp", "mv", "install", "rsync"):
        dst = [x for x in args if not x.startswith("-")][-1:]
        lab = "edit" if dst and not is_scratch(dst[0], cwd) else "other"
        if dst and dst[0].endswith("/") and not is_scratch(dst[0], cwd):
            lab = "edit"
    elif prog in ENV_PROGS:
        lab = "env"
    elif prog in EXPLORE_PROGS:
        lab = "explore"
    else:
        lab = "other"
    if seg.heredocs and seg.redirects and prog in ("cat", "echo", "printf", "tee"):
        for t in seg.redirects:
            scripts[resolve(t, cwd)] = "\n".join(seg.heredocs)
    if seg.redirects and prog in ("cat", "echo", "printf") and labels:
        return labels[0]                                 # writing a file is the whole point of the segment
    labels.append(lab)
    return min(labels, key=RANK.__getitem__)


def classify(cmd: str, scripts: dict | None = None, package: str = "") -> str:
    """Phase of one tool-call command. `scripts` is the run's memory of heredoc-written files
    (pass the same dict for every command of one run); `package` is the task's PyPI name."""
    scripts = {} if scripts is None else scripts
    if package:
        scripts[PACKAGE_KEY] = package
    if SUBMIT_MARK in cmd:
        return "submit"
    scripts[CWD_KEY] = REPO                       # every mini-swe-agent command starts in /testbed
    labels = []
    for seg in split_segments(cmd):
        words = _strip_prefix(_words(seg.text))
        if words[:1] == ["cd"] and len(words) > 1 and not words[1].startswith("-"):
            scripts[CWD_KEY] = resolve(words[1], scripts[CWD_KEY])
        labels.append(classify_segment(seg, scripts))
    return min(labels, key=RANK.__getitem__) if labels else "other"


# ------------------------------------------------------------------ runs, lab tools, the patterns alphabet
PHASES = ("explore", "reproduce", "edit", "test", "lookup", "env", "submit", "other")
_SWE_ID = re.compile(r"\A[\w.-]+__([\w.-]+)-\d+\Z")
_KIND_PHASE = {"view": "explore", "search": "explore", "edit": "edit", "run": "test", "submit": "submit"}
_TOOL_PHASE = {"read_file": "explore", "list_files": "explore", "search": "explore", "edit_file": "edit",
               "write_file": "edit", "run_tests": "test", "submit": "submit"}
WRITE_TOOLS = ("edit_file", "write_file")
SEARCH_PROGS = {"grep", "egrep", "fgrep", "rg", "ag", "zgrep", "locate"}
LIST_PROGS = {"ls", "tree", "du", "pwd", "stat", "file", "readlink", "realpath", "find"}
WRITE_PROGS = {"tee", "cp", "mv", "install", "rsync"}


def package_of(task_id: str) -> str:
    """The PyPI-ish name of a SWE-bench task's repository (django__django-15268 -> django), else ""."""
    m = _SWE_ID.match(task_id or "")
    return m.group(1) if m else ""


def tool_phase(tool: str, args: dict, scripts: dict, package: str = "", kind: str = "") -> str:
    """Phase of one lab tool call. A shell command goes through `classify` (pass one `scripts` dict per
    run, in call order); a lab tool has the phase its name says, except that a write to the agent's own
    scratch file (`_tool_scratch`) is reproduce, not edit."""
    if kind in _KIND_PHASE:
        return _KIND_PHASE[kind]
    if tool == "bash":
        return classify(str((args or {}).get("command") or ""), scripts, package)
    if tool in WRITE_TOOLS and _tool_scratch(str((args or {}).get("path") or "")):
        return "reproduce"
    return _TOOL_PHASE.get(tool, "other")


def span_phases(spans: list, task_id: str = "") -> list:
    """The phase of each span of one run, in order: an execute_tool span's recorded phase, else its tool's
    (`tool_phase`, one scripts memory for the run); None for every other span. Read time only: nothing is written."""
    start = next((s for s in spans if s.get("span") == "invoke_agent" and s.get("status") == "start"), {})
    scripts, package = {}, package_of(task_id or start.get("task_id") or "")
    return [(s.get("phase") or tool_phase(s.get("gen_ai.tool.name") or "", s.get("args") or {}, scripts, package,
                                          s.get("kind") or ""))
            if s.get("span") == "execute_tool" else None for s in spans]


def _tool_scratch(path: str) -> bool:
    """A lab tool's write target is scratch when `is_scratch` says so, except a file at the repository root: a lab
    task's own module can sit there (slugify.py), so at the root only a scratch name or extension counts."""
    if not path or not is_scratch(path):
        return False
    p = resolve(path)
    base = os.path.basename(p)
    at_root = p.startswith(REPO + "/") and "/" not in p[len(REPO) + 1:]
    return not at_root or bool(SCRATCH_STEM.match(base)) or base.lower().endswith(SCRATCH_EXT)


def _programs(cmd: str) -> list:
    """(program, args, segment) of each segment that runs a program."""
    out = []
    for seg in split_segments(cmd):
        words = _strip_prefix(_words(seg.text))
        if words and words[0] not in SKIP_PROGS:
            out.append((os.path.basename(words[0]), words[1:], seg))
    return out


#: the patterns alphabet for a lab tool, and for a step an older import labelled with a kind
TOOL_LETTER = {"list_files": "L", "read_file": "R", "write_file": "W", "edit_file": "E", "run_tests": "T", "bash": "B",
               "submit": "S"}
KIND_LETTER = {"view": "R", "search": "F", "edit": "E", "run": "T", "submit": "S", "other": "B"}


def call_letter(span: dict, phase: str) -> str:
    """The letter of one execute_tool span: its kind's, a shell command's by its phase (action_letter),
    else its lab tool's ("?" for a tool outside the alphabet)."""
    if span.get("kind") in KIND_LETTER:
        return KIND_LETTER[span["kind"]]
    tool = span.get("gen_ai.tool.name")
    if tool == "bash":
        return action_letter((span.get("args") or {}).get("command", "") or "", phase)
    return TOOL_LETTER.get(tool, "?")


def action_letter(cmd: str, phase: str) -> str:
    """One letter of the patterns alphabet for a shell command of a known phase: L/R/F for explore
    (list, read, search), T test, W/E edit (a whole-file write, an in-place change), S submit, B the rest."""
    if phase == "submit":
        return "S"
    if phase == "test":
        return "T"
    progs = _programs(cmd or "")
    if phase == "edit":
        for prog, args, seg in progs:
            if any(not is_scratch(t) for t in seg.redirects):
                return "W"
            dst = [a for a in args if not a.startswith("-")][-1:]
            if prog in WRITE_PROGS and dst and not is_scratch(dst[0]):
                return "W"
        return "E"
    if phase == "explore":
        names = [p for p, args, _ in progs] + [args[0] for p, args, _ in progs if p == "git" and args]
        if any(n in SEARCH_PROGS for n in names):
            return "F"
        return "L" if any(n in LIST_PROGS or n in ("ls-files", "status") for n in names) else "R"
    return "B"
