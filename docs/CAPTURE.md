# Capture: record, export, import

TraceHarness capture is local. It reads coding-agent session files on your machine, turns each session
into a ledger under `data/runs/captured/` of your lab, and the local console (`traceharness serve`,
Capture page) shows them as datasets. There is no sign-in and nothing is uploaded; to move sessions to
another machine you export a zip and import it there.

Supported sources: Claude Code, Codex, agy (Antigravity CLI), Qwen Code, Cursor.

## Local capture

```sh
traceharness capture --watch --path /path/to/session-directory --lab /path/to/lab
traceharness capture --backfill --path /path/to/session-directory      # once, then exit
traceharness capture --pause | --resume | --nudge                       # control a running watcher
```

A first run on a large machine: `--backfill` once, then `--seed-cursors` so `--watch` does not read the same
corpus again. `--print-launchd` and `--print-menubar-agent` print a LaunchAgent (nothing is installed); on
macOS the terminal needs Full Disk Access to read some session stores. `--sweep` and `--prune-orphans`
report (and with `--apply` clean up) crash debris and runs whose source is gone.

Only folders on the allow-list are read: `~/.traceharness/capture.json` (editable from the Capture page)
or `--path DIR` for one invocation. A missing or unreadable allow-list allows nothing. `--watch` and
`--backfill` ask you to type `yes` at a terminal first. Optional local gzip copies of the sources are
kept unless you pass `--no-archive`.

What `--backfill` prints (one JSON report; exit 1 if any source failed):

```json
{
  "archived": 0,
  "by_source": {
    "claude_code": 1
  },
  "cache_creation_input_tokens": 1500,
  "cache_read_input_tokens": 130000,
  "closed_new": 1,
  "closed_updated": 0,
  "cost_usd": 0.08194,
  "errors": [],
  "files": 1,
  "forks": 0,
  "input_tokens": 13,
  "lab_runs_root": "/path/to/lab/data/runs",
  "lines_added": 1,
  "lines_removed": 1,
  "models": {
    "claude-opus-5": 1
  },
  "open": 0,
  "output_tokens": 300,
  "runs": 1,
  "superseded": 0,
  "unknown_record_types": {},
  "unmeasured_runs": 0,
  "unpriced_models": []
}
```

## Export

```sh
traceharness capture export --out sessions.zip [--source NAME ...] [--since DATE] [--lab DIR]
```

Writes the sessions already captured in the lab to `sessions.zip` (mode 0600, refuses to overwrite).
`--source` (repeatable) keeps one agent's sessions; `--since 2026-11-01` keeps sessions that ended on or
after that date. Nothing is read from the original session folders and nothing is sent anywhere.

Contents:

| member | what |
|---|---|
| `manifest.json` | `format` `traceharness-capture-export`, `version` 1, `created_at`, `redaction_version`, `sources`, `runs`, and one `files` entry per member with `sha256` and `size` |
| `index.jsonl` | the dataset-index rows of the exported runs |
| `runs/<run_id>/summary.json`, `ledger.jsonl`, `patch.diff` | one folder per session |

Redaction is applied to every string in the summary, ledger, index rows and patch before anything is
written: known API keys and tokens (Anthropic, OpenAI, OpenRouter, GitHub, AWS, Google, Slack, Supabase,
Stripe, Hugging Face, npm, TraceHarness), JWTs, `Bearer` tokens, URL `user:password` segments, private-key
blocks, `password=`/`secret=`/`api_key=` values, and values under keys such as `password`, `secret`,
`token`, `authorization`. A line the redactor does not change keeps its original bytes. Redaction is
pattern-based: a password written as prose or an unusual token shape passes through, so read an export
before sharing it.

## Import

```sh
traceharness capture import sessions.zip [--lab DIR]
traceharness import sessions.zip            # the same, chosen by file type
```

Import treats the zip as untrusted. The archive is read into memory and verified completely before the
first byte is written; nothing in it is executed, and no member name is used as a path. It is refused,
with the reason and "Nothing was written", when:

- the manifest is missing, is not this format, or has a version this TraceHarness does not know;
- a member name contains `..`, a leading `/`, a backslash, a drive prefix, a NUL, or is not exactly
  `manifest.json`, `index.jsonl` or `runs/<id>/{summary.json,ledger.jsonl,patch.diff}`;
- two members share a name (also ignoring case), or a member is not listed in the manifest;
- a member is a symlink, directory, other special file, or is encrypted;
- a member exceeds 64 MiB (checked on the header and again on the bytes actually decompressed), the
  archive has too many members, or would expand past 2 GiB;
- a member's size or SHA-256 differs from the manifest (tampered or damaged);
- a summary does not name its own run, a ledger line is not JSON, or a run has an unknown source.

A run already present in the lab is skipped, never overwritten. Imported sessions appear in the console
exactly like captured ones. Import takes the same single-writer lock as the watcher: if it says another
writer holds the lab, run `traceharness capture --pause` and retry.
