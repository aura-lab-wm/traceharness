#!/usr/bin/env python3
"""Build a pinned real task package without modifying the recorded run store.

Only operator-reviewed local recipes are accepted. No service endpoint invokes
this script and no image, compatibility receipt or successful run is fabricated.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import urllib.request
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from harnesslab.runner_service.registry import tree_hash

MAX_ARCHIVE = 32 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024


def read_source(recipe, archive=None):
    if archive:
        raw = Path(archive).read_bytes()
    else:
        url = recipe['archive_url']
        if not re.fullmatch(r'https://codeload\.github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/tar\.gz/[0-9a-f]{40}', url):
            raise ValueError('Only exact upstream Git commit archives are supported')
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read(MAX_ARCHIVE + 1)
    if len(raw) > MAX_ARCHIVE or hashlib.sha256(raw).hexdigest() != recipe['archive_sha256']:
        raise ValueError('Source archive digest/size mismatch')
    return raw


def extract_source(raw, prefix, dest, excluded_symlinks=None):
    if excluded_symlinks is None:
        excluded_symlinks = {}
    if (not isinstance(excluded_symlinks, dict) or any(
            not isinstance(name, str) or not name or name.startswith('/')
            or '..' in PurePosixPath(name).parts or not isinstance(target, str)
            or not target or target.startswith('/')
            for name, target in excluded_symlinks.items())):
        raise ValueError('Invalid explicit source exclusions')
    seen, excluded, total = set(), set(), 0
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        for member in archive:
            parts = PurePosixPath(member.name).parts
            if not parts or parts[0] != prefix or '..' in parts or member.name.startswith('/'):
                raise ValueError('Unsafe source archive path')
            if len(parts) == 1:
                if not member.isdir():
                    raise ValueError('Archive root must be a directory')
                continue
            name = '/'.join(parts[1:])
            if name in seen or len(seen) >= 10000:
                raise ValueError('Duplicate or excessive source entries')
            seen.add(name)
            if name in excluded_symlinks:
                if not member.issym() or member.linkname != excluded_symlinks[name]:
                    raise ValueError('Reviewed source exclusion changed')
                excluded.add(name)
                continue  # Never resolve, follow, or create the omitted link.
            if not (member.isfile() or member.isdir()):
                raise ValueError('Source archives cannot contain symlinks or special files')
            target = dest.joinpath(*parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            total += member.size
            if total > MAX_EXPANDED:
                raise ValueError('Expanded archive is too large')
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as src, target.open('xb') as out:
                shutil.copyfileobj(src, out)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
    if excluded != set(excluded_symlinks):
        raise ValueError('Reviewed source exclusion is absent')


def package(recipe_path, output, archive=None):
    recipe_path, output = Path(recipe_path).resolve(), Path(output).absolute()
    root = recipe_path.parent
    recipe = json.loads(recipe_path.read_text())
    if recipe.get('version') != 1 or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,119}', recipe.get('id', '')):
        raise ValueError('Unsupported task recipe')
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing to replace an existing task package')
    raw = read_source(recipe, archive)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.task-package-', dir=output.parent) as temporary:
        stage = Path(temporary) / 'task'
        (stage / 'repo').mkdir(parents=True)
        extract_source(raw, recipe['archive_prefix'], stage / 'repo', recipe.get('excluded_source_symlinks'))
        (stage / 'repo' / 'public_tests').mkdir(exist_ok=False)
        public_name = recipe.get('public_test_filename', 'test_json_pickle.py')
        if not isinstance(public_name, str) or not re.fullmatch(r'test_[A-Za-z0-9_]+\.py', public_name):
            raise ValueError('Invalid public test filename')
        shutil.copyfile(root / 'public_test.py', stage / 'repo' / 'public_tests' / public_name)
        if 'edit_contract' in recipe:
            shutil.copyfile(root / 'public_policy.json', stage / 'repo' / 'TRACEHARNESS_TASK_POLICY.json')
        shutil.copyfile(root / 'issue.md', stage / 'issue.md')
        (stage / 'task.json').write_text(json.dumps({'visible_test_command': recipe['visible_test_command']}, indent=2) + '\n')
        (stage / 'grader').mkdir()
        shutil.copyfile(root / recipe['hidden_checks'], stage / 'grader' / recipe['hidden_checks'])
        shutil.copyfile(root / 'requirements.lock', stage / 'requirements.lock')
        grading = {k: recipe[k] for k in ('allowed_source_prefix', 'hidden_checks', 'grading_timeout_seconds')}
        if 'edit_contract' in recipe:
            grading['edit_contract'] = recipe['edit_contract']
        if 'expected_checks' in recipe:
            grading['expected_checks'] = recipe['expected_checks']
        (stage / 'grading.json').write_text(json.dumps(grading, indent=2) + '\n')
        provenance = {k: recipe[k] for k in ('id', 'title', 'repository', 'issue_url', 'revision', 'archive_url', 'archive_sha256', 'license')}
        provenance.update(kind='real-upstream-issue', benchmark_claim=False, source='pinned upstream archive plus independent offline regression checks')
        if recipe.get('excluded_source_symlinks'):
            provenance['excluded_source_symlinks'] = recipe['excluded_source_symlinks']
        if 'provenance_details' in recipe:
            provenance['upstream_fix'] = recipe['provenance_details']
        (stage / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
        digest = tree_hash(stage)
        os.rename(stage, output)
    return {**provenance, 'path': str(output), 'content_sha256': digest,
            'execution_verified': False, 'image_digest': None, 'grader_image_digest': None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recipe', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--archive', type=Path, help='Previously downloaded exact archive; digest is still checked')
    args = parser.parse_args()
    try:
        result = package(args.recipe, args.output, args.archive)
    except (OSError, ValueError, tarfile.TarError) as error:
        raise SystemExit(str(error)) from None
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
