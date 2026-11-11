# Native prompt editor correction — 11 November 2026

The signed-in editor is at [Harnesses](https://traceharness.dev/app#/rig/harnesses). It is rendered by `NativePrompts.jsx` in the exported React `/app` snapshot. `/app/shallow` is a separate page.

The unchecked **Use this native prompt profile for the run** checkbox previously disabled replacement editing, bulk selection and named sets. Editing is now independent of applying a profile to execution. **Draft only** means the controls work but the profile is excluded from the current run configuration. Checking the box explicitly includes it in the next review. Unchecking retains the draft and removes the native profile from the dispatch configuration.

Other corrections:

- Codex rows show the filename once rather than repeating it inside its full path. The inspector retains the path and the complete original title/ID in provenance. Inventory contents, pins and byte-capacity rules are unchanged.
- The list has a bounded height and a sticky selection header. Opening a row inspects it; its checkbox selects it for bulk edits. The currently inspected row uses `aria-current` rather than pretending to be a selection toggle.
- Unsaved replacement previews survive unrelated checkbox selection and application-toggle changes. A message distinguishes a preview from a replacement already applied to the profile draft.
- An application-toggle change cancels a pending replacement digest, so a late callback cannot overwrite the newly chosen application state.
- Creating a named set from a fresh, excluded draft initializes a complete valid draft. Bulk changes and inventory repair retain the explicit application choice.
- External execution locks, observed-only fragments, inventory mismatch refusals, placeholder requirements, secret filtering and UTF-8 span limits remain authoritative. Run still requires compatible selections, review and credentials.

## Manual checks

1. Choose native Codex in Harnesses; leave **Use this native prompt profile for the run** unchecked.
2. Inspect a patchable row. Its replacement field and valid authoring controls should work. The complete filename/path and provenance must remain available.
3. Type a preview, change a bulk checkbox, and toggle run application on/off. The unapplied preview must remain; it is not silently dispatched.
4. Apply a valid replacement while the profile is excluded. Inspect full configuration JSON: it must remain version 1 without `native_prompt_profile`.
5. Enable the profile explicitly. JSON must become version 2 and include the exact replacement and its SHA-256. Disable it again: the profile must leave the dispatch JSON while the draft text remains.
6. Select a row, use bulk Disable and individual Include, create a named set, then reload this tab. The excluded draft, remembered replacement and set must survive.
7. Open an observed-only component: mutation controls remain unavailable. Try an over-capacity or invalid-placeholder replacement: Apply remains blocked.
8. Check 320/390/768/1440/1920px layouts. On phones use **Back to prompt list** and reopen an item. Names, filters, controls and the inspector must fit without page-wide horizontal overflow.
9. Confirm the incomplete configuration in the screenshot still cannot Run. This UI correction must not bypass model/task/review/key requirements or start any job.

## Verification boundaries

The old behavior was reproduced headlessly on the published member page with a real session and the actual Codex inventory (`9592e2f237bfed2ea7702f0a88499d342631d4893ca276186abf8b173361b4b7`). A candidate HTML document used the same production authentication, catalog and inventory APIs; no account save or job submission was allowed.

Local regressions passed: **1,088 frontend tests**, including **18 native editor tests**, and **two build/source consistency tests**. The new failure cases were exercised before their fixes, including draft/run separation, valid excluded sets, retained previews and pending-digest cancellation. Existing lint/Node warnings remain recorded. These tests do not constitute a paid native execution or a PostgreSQL save/reload proof.

Published-page readback, snapshot upload receipt and current authentication gates are recorded in [NATIVE_EDITOR_FIX_VERIFICATION.json](NATIVE_EDITOR_FIX_VERIFICATION.json). Runtime images, grader definitions, task definitions, account data, Worker routes and Worker code are unchanged by this correction. The existing eight-dataset / 3,453-row payload and five narration recordings are retained.


## Published receipt

Implementation `8d2ceb2` was pushed to public main. The exact published member HTML SHA-256 read back as `5148e5521184bf96273611b321a05f7492d3a72bf21aeb856acdd8de2d93bbca`.

`app-native-editor-fix-v3.html.gz` uploaded with exit **0**: 15,295,627 bytes, SHA-256 `d0359e47a330dcb2cf887c099a5bfde22418c2ffae0da0d068737f2d46997202`. Worker version `5ff30c89-62aa-4c90-ba78-b37a24ef4bf4` was retained; no Worker deployment was required. The temporary config was deleted.

The published page passed the same real-member checks as the candidate: excluded editing, exact replacement SHA in the version 2 configuration only after opt-in, return to version 1 on exclusion, bulk Disable/Include, retained previews, five viewport widths and named-set/draft reload. Run remained gated; no jobs were submitted. **41 anonymous curl checks** passed with `traceharness-proof`, zero redirects, exact 401 API bodies and no ACAO. Logged-out `/app`, `/app/shallow` and `/link` stayed 302 `/login`.

Last available upload log lines:

```text

 ⛅️ wrangler 4.90.1
───────────────────
Resource location: remote

Writing the contents of /Users/amastro/Documents/TraceHarness-native-editor-fix-2026-11-11/app-native-editor-fix-v3.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

No paid native execution or fresh PostgreSQL save/reload was repeated for this UI-only correction. Safari/Firefox and exhaustive failure permutations remain UNVERIFIED by the current checks.
