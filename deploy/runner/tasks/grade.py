#!/usr/bin/env python3
"""Offline task grader: privileged result writer, unprivileged candidate process.

Production must execute this inside the separate isolated grader container. This
is not a host-side sandbox. --local-validation is only for operator baseline /
reference checks in an already trusted temporary source checkout.
"""
from __future__ import annotations
import argparse
import ast
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import resource
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import tokenize

MAX_FILES = 10000
MAX_BYTES = 256 * 1024 * 1024


class EditContractError(ValueError):
    """Candidate does not satisfy this curated task's reviewed edit policy."""


def source_tree(raw):
    """Parse exactly the source encoding Python will execute, then normalize it."""
    try:
        encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
        if encoding not in ('utf-8', 'utf-8-sig'):
            raise EditContractError('Task source must use UTF-8 encoding.')
        source = raw.decode(encoding)
        return ast.parse(source, type_comments=True), source.encode('utf-8')
    except (SyntaxError, UnicodeError, LookupError, RecursionError) as error:
        raise EditContractError('Task source is not valid UTF-8 Python.') from error


def validate_json_reduce(baseline_raw, candidate_raw):
    """Accept only the reviewed serialization repair, without executing source."""
    baseline, _ = source_tree(baseline_raw)
    candidate, normalized = source_tree(candidate_raw)
    dump = lambda node: ast.dump(node, include_attributes=False)
    # An unchanged baseline still runs the behavioral regression checks and fails.
    if dump(candidate) == dump(baseline):
        return normalized
    classes = [node for node in candidate.body if isinstance(node, ast.ClassDef) and node.name == 'JSONDecodeError']
    if len(classes) != 1:
        raise EditContractError('Task requires exactly one JSONDecodeError class.')
    owner = classes[0]
    methods = [node for node in owner.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == '__reduce__']
    if len(methods) != 1 or not isinstance(methods[0], ast.FunctionDef):
        raise EditContractError('Task permits one synchronous __reduce__ method.')
    method = methods[0]
    arguments = method.args
    if (arguments.posonlyargs or len(arguments.args) != 1 or arguments.args[0].arg != 'self'
            or arguments.args[0].annotation is not None or arguments.args[0].type_comment is not None
            or arguments.vararg or arguments.kwarg or arguments.kwonlyargs or arguments.defaults
            or arguments.kw_defaults or method.decorator_list or method.returns is not None
            or method.type_comment is not None or getattr(method, 'type_params', [])):
        raise EditContractError('Task requires an undecorated __reduce__(self) without annotations or defaults.')
    body = method.body
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
        body = body[1:]
    approved = [
        'CompatJSONDecodeError.__reduce__(self)',
        '(self.__class__, (self.msg, self.doc, self.pos))',
        '(type(self), (self.msg, self.doc, self.pos))',
    ]
    if (len(body) != 1 or not isinstance(body[0], ast.Return) or body[0].value is None
            or dump(body[0].value) not in {dump(ast.parse(expression, mode='eval').body) for expression in approved}):
        raise EditContractError('Task permits only its documented safe reduction expressions.')
    owner.body.remove(method)
    if dump(candidate) != dump(baseline):
        raise EditContractError('Only the JSONDecodeError.__reduce__ addition may change the module.')
    return normalized


def files(root):
    result, total = {}, 0
    for directory, dirs, names in os.walk(root, followlinks=False):
        for name in dirs:
            if (Path(directory) / name).is_symlink():
                raise ValueError('Symlinked candidate directory')
        for name in names:
            path = Path(directory) / name
            mode = path.lstat().st_mode
            if not stat.S_ISREG(mode) or path.stat().st_nlink != 1:
                raise ValueError('Candidate must contain ordinary unlinked files')
            total += path.stat().st_size
            if len(result) >= MAX_FILES or total > MAX_BYTES:
                raise ValueError('Candidate source limit exceeded')
            result[path.relative_to(root).as_posix()] = path
    return result


def reconstruct(task, workspace, target, prefix, contract=None):
    """Ignore agent configuration/tests; overlay permitted source into pristine repo."""
    if not prefix.endswith('/') or '..' in PurePosixPath(prefix).parts or prefix.startswith('/'):
        raise ValueError('Invalid source policy')
    baseline = files(task / 'repo')
    candidate = files(workspace)
    allowed = lambda name: name.startswith(prefix) and name.endswith('.py')
    normalized = None
    if contract is not None:
        if (set(contract) != {'kind', 'path', 'baseline_sha256'}
                or contract['kind'] != 'requests-jsondecode-reduce-v1'
                or contract['path'] != 'src/requests/exceptions.py'
                or not allowed(contract['path']) or contract['path'] not in baseline):
            raise ValueError('Unsupported curated edit contract')
        name = contract['path']
        original = baseline[name].read_bytes()
        if hashlib.sha256(original).hexdigest() != contract['baseline_sha256']:
            raise ValueError('Curated edit contract baseline mismatch')
        if name not in candidate:
            raise EditContractError('Required task source is missing.')
        normalized = validate_json_reduce(original, candidate[name].read_bytes())
        allowed = lambda name: name == contract['path']
    for name, source in baseline.items():
        if not allowed(name):
            if name not in candidate or hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(candidate[name].read_bytes()).digest():
                error = EditContractError if contract is not None else ValueError
                raise error('Protected task file changed')
    shutil.copytree(task / 'repo', target)
    for name in list(baseline):
        if allowed(name) and name not in candidate:
            (target / name).unlink()
    for name, source in candidate.items():
        if allowed(name):
            dest = target / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if normalized is not None:
                dest.write_bytes(normalized)
            else:
                shutil.copyfile(source, dest)
    for directory, dirs, names in os.walk(target):
        Path(directory).chmod(0o755)
        for name in names:
            (Path(directory) / name).chmod(0o444)


def restricted_child():
    os.setgroups([])
    os.setgid(10002)
    os.setuid(10002)
    # Cannot reacquire identity or privileges through a subsequently invoked binary.
    if sys.platform == 'linux':
        if ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) != 0:
            raise OSError('no_new_privileges failed')
    resource.setrlimit(resource.RLIMIT_FSIZE, (262144, 262144))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def kill_candidate_group(pid):
    """Signal the unprivileged child without granting the writer CAP_KILL.

    Only the effective UID changes. The writer's real/saved UID stays root, so
    evaluated code cannot signal the writer during this interval. Restore the
    writer identity even if the process group already exited or signalling fails.
    """
    original_uid = os.geteuid()
    changed = original_uid == 0
    if changed:
        os.seteuid(10002)
    try:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    finally:
        if changed:
            os.seteuid(original_uid)


def run_grade(task, workspace, *, local_validation=False, python=sys.executable):
    if not local_validation and (sys.platform != 'linux' or os.geteuid() != 0):
        raise ValueError('Production grader requires isolated Linux root writer')
    recipe = json.loads((task / 'grading.json').read_text())
    checks = recipe['hidden_checks']
    if Path(checks).name != checks or not checks.endswith('.py'):
        raise ValueError('Invalid check file')
    timeout = recipe['grading_timeout_seconds']
    if type(timeout) is not int or not 1 <= timeout <= 90:
        raise ValueError('Invalid grading deadline')
    with tempfile.TemporaryDirectory(prefix='traceharness-grade-') as temporary:
        directory = Path(temporary)
        directory.chmod(0o755)
        source = directory / 'source'
        try:
            reconstruct(task, workspace, source, recipe['allowed_source_prefix'], recipe.get('edit_contract'))
        except EditContractError as error:
            # No candidate code has been imported or subprocess started.
            return {'outcome': 'failed', 'reason': str(error)}
        script = directory / 'checks.py'
        shutil.copyfile(task / 'grader' / checks, script)
        script.chmod(0o444)
        # Never inherit agent-controlled PYTHONPATH/PYTHONHOME/startup/plugin settings.
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
        log = directory / 'test.log'
        with log.open('wb') as output:
            proc = subprocess.Popen([python, '-I', '-B', str(script), str(source)], cwd=directory,
                                    env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                    preexec_fn=None if local_validation else restricted_child,
                                    start_new_session=True)
            try:
                returncode = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                kill_candidate_group(proc.pid)
                proc.wait(timeout=5)
                return {'outcome': 'error', 'reason': 'Offline grading timed out.'}
            finally:
                # A candidate cannot leave grandchildren after its test process exits.
                kill_candidate_group(proc.pid)
        raw = log.read_bytes()[-262144:].decode('utf-8', errors='replace')
        try:
            summary = json.loads(raw.rstrip().splitlines()[-1])
        except (ValueError, IndexError):
            summary = {}
        complete = summary == {'checks_run': 4, 'success': True}
        return {'outcome': 'passed' if returncode == 0 and complete else 'failed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--task', type=Path, default=Path('/task'))
    parser.add_argument('--workspace', type=Path, default=Path('/workspace'))
    parser.add_argument('--output', type=Path, default=Path('/output'))
    parser.add_argument('--local-validation', action='store_true')
    args = parser.parse_args()
    if args.output.is_symlink() or not args.output.is_dir():
        raise SystemExit('Output must be an existing ordinary directory')
    if not args.local_validation:
        mode = args.output.stat()
        if mode.st_uid != 0 or mode.st_mode & 0o022:
            raise SystemExit('Grade output must be root owned and not writable by candidates')
    try:
        result = run_grade(args.task, args.workspace, local_validation=args.local_validation)
    except Exception:
        result = {'outcome': 'error', 'reason': 'Offline grading could not validate this workspace.'}
    # Root creates this after the unprivileged process group is terminated.
    dest = args.output / 'grade.json'
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, 'w') as stream:
        json.dump(result, stream, sort_keys=True)
        stream.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
