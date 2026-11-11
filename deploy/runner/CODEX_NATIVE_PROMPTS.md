# Codex embedded prompt assets

The adapter targets the inspected Linux x86_64 Codex CLI **0.167.1**. It edits
source-owned strings embedded in that executable, separately from the existing
additional `developer_instructions` overlay. Model-instruction file overrides are
not used to stand in for embedded editing.

## Exact scope and limits

The initial inventory contains 22 whole source-asset groups: **13 patchable** at
**16 source occurrences**, plus **nine observed-only** dynamic templates. The
source metadata is pinned in `codex-source-assets-0.167.1.json`. Its names and
hashes identify complete files from the official source archive; it contains no
native prompt bodies or private binary anchors. No arbitrary string scanning or
operator-home prompt cache is accepted as source ownership.

Each patchable asset must match all of its complete byte occurrences in the
binary's allocated `.rodata` section and read-only, nonexecutable load segment.
Missing, overlapping, executable, writable, changed or unlisted occurrences
refuse materialization. Templates with dynamic interpolation remain read-only.
The initial unit of editing is a complete source asset, not every paragraph or
native tool description. Other embedded/dynamic instructions remain outside the
inventory; a fragment absent from a particular request is not proven disabled.

Rust slices have fixed lengths. Replace must fit the asset's original **UTF-8
byte capacity**, then receives trailing ASCII spaces. Disable writes spaces over
the entire asset. Keep and an exact-baseline Replace preserve the whole binary
byte-for-byte. Pointers, load addresses, section sizes and executable code are not
rewritten. Application evidence identifies content bytes, padding bytes and span
bytes separately. Disable does not reduce span length to zero, and source byte
counts do not establish provider token or cost savings.

The same native prompt profile schema and member editor are used for Claude and
Codex. Their binary adapters and materializer pins are separate. The Claude Bun
source/cache policy does not apply to the Codex adapter. Each job starts from a
pristine binary and mounts a fresh result read-only at the fixed installed Codex
path. Members cannot select patch paths, commands or source anchors. The task
container cannot write trusted application evidence.

## Inspected identities

| Input | Identity |
| --- | --- |
| Official source commit | `0a94398fa60c4fac0e7659e4213a0a36e613dd46` |
| Official source tarball SHA256 | `214e5017a3c519557da811fe1df8e6fa51d408df0463c08f38a572b7e30b80fe` |
| Registered native image | `sha256:e1e4ef84997e7c17acdb210ef55679b3d637fb590cdf469614fc6ab60459f2b0` |
| Pristine native binary | `dd5bfdf19d794dcc6fb482d2d5a2d9fb31d11f6caa44b303bb72890d461e8a02` — 320,186,856 bytes |
| Source-asset metadata SHA256 | `c6865c05c50ec8fa366a3d0a43bf985afae89bceadd7314dabb31634ecc7dead` |

The dedicated source files and instruction use are visible at the
[pinned official source](https://github.com/openai/codex/tree/0a94398fa60c4fac0e7659e4213a0a36e613dd46/codex-rs).
The default base asset also appears in the models-manager fallback instructions.
This is why an unknown OpenRouter model slug can exercise that embedded asset;
actual native capture is still required to establish consumption. The native
`without_update_plan_instructions` function can remove checklist guidance before
emission. In the retained capture, the 20,903-byte source asset becomes a
17,119-byte first developer message. Whole-source literal matching therefore
remains unobserved even though the exact source-declared rendered form matches.
A marked replacement and its padding can instead appear verbatim.

## Prepare privately, then prove application

Export the pristine executable from the exact registered image and retain the
pinned official source archive outside the repository. Run the local preparer:

```sh
python deploy/runner/prepare_codex_prompt_inventory.py \
  --binary "$NATIVE_WORKSPACE/codex-pristine" \
  --source-archive "$NATIVE_WORKSPACE/codex-source.tar.gz" \
  --output "$NATIVE_WORKSPACE/codex-inventory.private.json"
```

The preparer verifies the source archive, binary and metadata digests; rereads
complete asset bodies directly from the archive; independently computes the
complete read-only occurrence sets; excludes templates; validates a Keep
read-back; and creates one new mode-0600 private file without overwriting an
existing output. It does not deploy, install a receipt or launch a provider call.
The private inventory binds source provenance, every source asset and all anchors.
The member response strips private anchors and retains the trusted inventory
identity, following the existing protocol.

Before admitting any inventory for execution, run the actual pinned native CLI
in fresh isolated homes with the existing gVisor/network-none constraints. A
loopback-only capture endpoint may establish loading without provider spend.
Retain original, Keep, baseline Replace, marked Replace, selected Disable and
all-patchable Disable captures. Compare actual `instructions`, `input`, model and
tools; preserve every unsuccessful attempt. Fresh input messages carry `msg_UUID`
transport identifiers; comparisons may ignore only those validated ID fields,
never instruction content, roles, model or tools. Keep and no-op captures must
match the original after that explicit normalization; a selected marker must appear in the emitted native request; the
original selected literal must disappear after Disable. Read-back alone or
`--version` output cannot establish application.

Only then issue the existing schema-1 mechanism receipt binding all seven
runtime/inventory/materializer pins and application/baseline/no-op/changed proof.
Ordinary exact runtime/model/task/grader compatibility remains required. A
receipt proves machinery, not the task grade or treatment performance. Release
notes must separately identify offline native captures, live member execution,
task outcomes and comparative evidence. This guide itself makes no deployment
or task-completion claim.
