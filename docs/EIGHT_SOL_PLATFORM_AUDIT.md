# Eight-workstream platform audit and release

November 11, 2026 Eastern / November 12 UTC. Initial application source: `7c354b5d99f910022c93cb565709c91d14bb5a95`; current application source after the Chrome review: `f55c182260d7b74eded6763ff0f7c5032d50dc5b`. Site proof-only commit: `72b5670dfb09b1e8600b2ff3cdd25afea8a792eb`, local only. Eight Sol workstreams ran in batches within the available concurrency limit.

Nine application defects were repaired in the initial release, followed by repeat-evidence, pointer-selection and grade-coverage repairs from the requested ChatGPT-in-Chrome review: **twelve application repairs in total**. A real edited native Codex task passed in production, its prompt replacement was observed in the actual model request, and its real trace was uploaded and reviewed through capture. This is evidence for that trial, not a performance-improvement or whole-platform-completion claim. The new [account/admin design](ACCOUNT_PLATFORM_DESIGN.md) is a proposal, not deployed functionality.

## Where the member experience runs

The full member workspace is [traceharness.dev/app](https://traceharness.dev/app), not the public Pages homepage. The site's `auth/worker/src/index.js` authenticates the request and serves the gzipped `app.html.gz` KV snapshot. That snapshot contains the built React workbench. Editing React source alone does not publish it.

The compatibility editor at [/app/shallow](https://traceharness.dev/app/shallow) remains a separately rendered plain-JavaScript page in `auth/worker/src/shallow.js`. Capture and device approval are separately rendered authenticated member routes. Tests of the Python/React lab are not described as proof of those production routes.

## Repairs

| Defect | Resulting behavior | Verification |
| --- | --- | --- |
| Native prompt selection on narrow layouts left keyboard focus on a hidden list row | Selection moves focus into the inspector; Back restores list focus; edits do not steal textarea focus | DOM regression and actual fixture-browser keyboard/focus checks |
| Cancelled/expired work could cross the process-launch boundary; a fast return could escape the deadline check | The executor checks cancellation/deadline before launch and checks deadline after completion | Three red-to-green boundary regressions; three checks against the deployed controller with mocked process launch |
| Secret-looking mapping keys escaped capture redaction | Keys as well as values are redacted, preserving collision-safe entries | Python regression cases |
| Legacy capture push could follow a symlinked patch | Reads require bounded regular files through pinned descriptors | Filesystem attack regressions |
| Both capture clients could follow a symlinked captured parent | Parent directories are descriptor-pinned and reject symlinks | Filesystem attack regressions |
| Repeat counts were inferred from maximum repeat ordinal | Analysis uses observed repeats per model/harness/task and displays actual ranges | Python and frontend regressions |
| Reports described mixed or partially unknown harness cohorts using their first configuration | Reports retain distinct recorded configurations/run associations and expose unknown configuration counts | Python and frontend regressions |
| Installed wheels omitted Field font CSS, breaking export | The exact required asset is packaged | Fresh sdist-to-wheel installation/export and final wheel parity |
| Installed harness/fork routes used source-checkout paths instead of `--lab` | Routes resolve through canonical configured paths | Fresh-install endpoint/export checks |

The live-evidence helper also needed repair: it mistook the known capture-link injection for changed snapshot bytes. It now removes only the exact expected injection in its valid position; altered, duplicate or misplaced scripts fail validation. This was a proof-tool defect, not a reason to weaken production CSP or accept arbitrary HTML differences.

An initially proposed efficiency-metric change was rejected during review because it contradicted the documented metric. It is not shipped or counted as a repair.

## Automated and local checks

| Check | Result |
| --- | --- |
| Integrated Python suite | **1,617 passed, 68 skipped**, 1,097 subtests passed, two warnings |
| Integrated frontend suite | Initial **1,095 passed**; final Chrome-follow-up suite **1,118 passed** across 66 files, with no pending/failing tests |
| Worker and Pages suite | **273 passed**, no skips |
| Release verification helper | **54 passed** |
| Member-evidence helper | **7 passed** using the interpreter with its required browser dependency |
| ESLint and production build | Passed; the existing large-bundle advisory remains |
| Initial source parity | 305 tested tracked files matched the initial application commit |
| Wheel parity | Initial 132 source/assets; final 140 source/assets matched, with no mismatches |
| Local fixture browser audit | 40 valid module/width/theme states; no observed horizontal overflow, uncaught page errors or unnamed visible buttons |
| Capture storage integration | 12 real temporary PostgreSQL cases passed |

Focused workstream counts overlap these suites and must not be added into a larger unique-test total. JUnit's combined case count includes subtests.

The 68 skips include platform/optional-dependency, full-checkout tool/documentation, instructor-solution, optional corpus and isolated Linux privilege cases. They did not pass. The two warnings concern the Starlette/httpx test client and an existing pytest helper returning text. The final build still reports a large JavaScript chunk. Older Python/platform/minimum-dependency combinations, the absent declared `py.typed` marker and upcoming setuptools license-metadata maintenance remain outside this repair set.

## Production evidence, with timing kept separate

The following visible-browser flows ran on the previously published `5c254f…740fd` HTML snapshot, before this release's snapshot upload and runner v17 rollout. They establish real hosted behavior, but are not silently attributed to the later release.

| Production flow | Observed result |
| --- | --- |
| Full workspace navigation | 1,176 headless render checks across 196 states, eight datasets, three widths and two themes; zero reported failures/page errors/blocked requests |
| Visible Chrome editor | Whole JSON/Unicode application, invalid JSON refusal, discard, actual export/import, checkpoint restore and real compiler read-only/permissive warnings; zero jobs |
| Harness/model/task readiness | Nine actual UI configurations; 72 server reviews across eight registered tasks: 67 accepted and five intentionally unsupported combinations rejected, all matching expectations; these were not executions |
| Provider connection lifecycle | Key absent from local/session storage; configuration changes invalidate prior review; disconnect revokes the credential and blocks dispatch |
| Real member persistence | Conditional fixed-prompt save acknowledged by production storage; a fresh visible browser painted the exact saved prompt; original restored and revalidated; member JWT only, no service-role key |
| Edited native Codex execution | One `requests-unicode-length` trial on native Codex 0.167.1 using `openai/gpt-5.1-codex-mini`: status succeeded, grade/artifact passed; replacement application readback and actual model-request observation verified |
| Result evidence | Visible result, full frozen manifest and actual downloaded manifest matched; failures/unknown grades were not relabelled |
| Capture of actual execution | Shipped client/device approval uploaded 20 events from that real owned Codex trace and verified artifacts; visible detail and deletion confirmed; original capture-ID set preserved; capture token revoked |

The native trial used **8 requests, 71,395 input tokens and 1,300 output tokens**, with reported cost **$0.00901579**. It was bounded to one new job, a $0.25 model cap and no automatic retries. The temporary provider credential was revoked. Review manifest SHA-256: `ea973b4ce17e07f817f23737016a7c0f03466c65ed3a23034dbbacc4d1d0c457`. Downloaded manifest bytes SHA-256: `70c9beaa98d4b66704b1e965f569bfde954aada7d44560e26e9963975e18e5ca`.

This capture proof used a real trace, unlike the deliberately synthetic transcripts in the [earlier capture activation proof](CAPTURE_PRODUCTION_VERIFICATION.md). The original job remains available. Normal revoked-token/device audit records remain; cleanup does not mean every database row disappeared.

### After publication

- A real member HTTP readback of `/app` matched the new HTML SHA-256 exactly, after accounting only for the known validated member injections. The temporary upload configuration was deleted.
- Fifteen fresh curl cases used `User-Agent: traceharness-proof` and `--max-redirs 0`. Logged-out `/app`, `/app/shallow`, `/link`, `/app/device` and `/app/capture` returned 302 `/login`. Protected APIs returned the exact 401 `{"error":"Sign in required."}`, including hostile Origin cases, with no ACAO.
- Actual authenticated post-publication APIs confirmed the execution catalog and original passed native job survived. Four hostile-origin requests returned 403; three stale-scope requests returned 409; seven machine-local mutation endpoints remained blocked with 403.
- Actual capture-token wire results were identity **200 → revoke 200 → identity 401 and upload 401**. The refused upload stored no payload. These probes started no model jobs or model requests.
- Runner v17 was complete, its machine/check healthy, live module hash exact, registry hash unchanged and no active/needs-attention jobs or containers left. Three live-controller deadline/cancellation probes used mocked process launch; they are not three paid Docker executions.

The subsequent Chrome/ChatGPT review completed through the actual browser integration in the operator's regular Chrome profile, after normal 1Password saved-login sign-in. It navigated the newly published production workspace, not a local fixture. Its two findings and follow-up release are below. A completed review does not imply every product behavior was exercised.

## Initial published artifacts

| Artifact | Identity |
| --- | --- |
| KV file | `app-eight-sol-candidate.html.gz`, **16,432,241 bytes** |
| Gzip SHA-256 | `415304afe56e7dc9da1bde38f4b330dea3b4a11faa582134ba81d461f8c61ae4` |
| Decompressed HTML SHA-256 | `993b77359850be8a94d682f2454e3cfbeb0a75ff8b5450b3ea6d0da594ae0041` |
| Build-source manifest | `b24132b2a3367c9a7f7d5bfc080752d56e640c6c664cdbeb838bec287b2d9fa5`, 103 files |
| Final wheel | `traceharness-0.3.0-py3-none-any.whl`, SHA-256 `ca343118098eb782c52f457b75f6bd051ebc200219b5a425b6f32822e5cd673d` |
| Worker version, unchanged this pass | `4b0d1d11-83b1-42f4-844b-0256ace83c8e` |
| Runner release | **v17**, complete |
| Runner immutable image | `registry.fly.io/traceharness-runner@sha256:9c3331292fe6c85de7fc2cdb1db2f41e188a123601368ad260cd8fdfca2d9d6d` |
| Live controller module SHA-256 | `1f174a62f72219a7baba5217ea0a053ccb90b55366cfcfe491ebbba219760d8d` |
| Runner registry SHA-256, unchanged | `2d90f0f7a9710890c2aedad0e972ac6d1f1a52ecebec4848d195793370496d10` |

All **3,453 embedded recorded runs and 80,396 spans**, across eight datasets, were preserved. All 3,461 recorded index/detail endpoint values deep-equalled the original snapshot. Derived analysis was regenerated to include the metric/report fixes; the entire encoded payload is therefore not byte-identical to its predecessor. Five audio chapters remain.

The snapshot is close to the Worker's 16 MiB compressed-file limit. Desktop rendering does not prove mobile memory, public traffic capacity or acceptable full-corpus transfer cost. Authenticated lazy dataset delivery is a separate scaling task. No Worker source, routes, bindings, Durable Objects, workers.dev target, SQL, account role, signup policy or authentication-provider setting was changed in this release. No site push was performed, and unrelated marketing/roster files were excluded. A final read-only check found a site `origin` configured despite the initial no-remote description; it was left untouched.

### Runner deployment log

Exit **0**, release **v17**, immutable image as above. Last ten emitted lines:

```text
> Updating 8e64d7b7d01e68 [app]
> Updated machine config for 8e64d7b7d01e68
✔ Machine 8e64d7b7d01e68 is now in a good state
> Clearing lease for 8e64d7b7d01e68
✔ Cleared lease for 8e64d7b7d01e68
Checking DNS configuration for traceharness-runner.fly.dev
✓ DNS configuration verified

Visit your newly deployed app at https://traceharness-runner.fly.dev/

```

Post-deploy verifier exit **0**, `DEPLOY_OK=1`; one started machine and its TCP check passed. Rollback image: `registry.fly.io/traceharness-runner@sha256:b336f41a0d10dfab76989443ed67ec11a203df103f5d284a6ba1e552e6ab8c89`.

The controller image changed only `DockerExecutor._run` in the deployed legacy `harnesslab` module after its pre-change method was matched to the public baseline. The rest of that module, runtime/grader images, effective service configuration and registry were retained. A whole renamed public module was not blindly copied into the legacy runtime.

### KV upload log

Exit **0**, pinned Wrangler **4.90.1**. No Worker deployment/version change. The command emitted fewer than ten lines; all available lines follow:

```text

 ⛅️ wrangler 4.90.1
───────────────────
Resource location: remote 

Writing the contents of /Users/amastro/Documents/TraceHarness-eight-sol-audit-2026-11-11/app-eight-sol-candidate.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

The prior `app-review-fixes.html.gz` artifact remains available to the operator for a deliberate exact-file rollback. Uploading a previous UI does not roll back runner code or database security.

## ChatGPT Chrome review and follow-up release

The requested independent review ran in the actual ChatGPT Work side panel in Chrome, using its browser integration against production. It completed in 4 minutes 56 seconds. The operator's regular profile signed into TraceHarness through 1Password's saved-login UI; no raw credentials entered the transcript.

The reviewer observed two defects:

1. A single ungraded captured attempt was described as universal repeat agreement. Root reproduced the false answer in current source. The answer now requires at least two known grades for a task, uses the selected suite rather than hidden-suite metrics, counts only eligible tasks, and discloses excluded/unknown coverage. Seven new regression cases failed before the correction and passed afterward.
2. Harness option clicks intermittently closed the menu without selecting, while keyboard selection worked. Root found that one later native accessibility click selected successfully, so this was not treated as an unconditional failure. A layout-aware regression independently proved a pointer hazard: hovering a partly visible row scrolled it 50 pixels before click hit-testing. Pointer hover now leaves scroll position stable; opening/searching/keyboard navigation still autoscroll, including a same-row keyboard transition after hover. Exact browser retest results are recorded separately below.

The reviewer also navigated real run JSON and partial-source explanations, model/task selection, expanded prompt editing, the native Codex inventory, an existing completed experiment queue, an existing run result, tutorial chapter navigation, Buddy's workflow link and the capture/device listing. It did not start execution, enter provider credentials, approve devices or save/delete member data. Narration playback was not tested. Existing passed results were inspected rather than manufactured by this review.

The follow-up application commit is **`fc1397956e28b9a6bf2f8d046170e101fba20241`**, pushed to public main. All **1,103 frontend tests** across 66 files passed, as did lint/build and two distribution contracts. The follow-up wheel matched **140 source/assets** with no differences; SHA-256 `e88fb152f6173dcfe1bb92fd8cb90c204e4a243bcba6024656c8bab43c8ffc3b`. Python/Worker suites were not rerun for this frontend-only follow-up; their earlier results remain scoped to the initial release.

Only the rebuilt application module was replaced in the already-verified full-corpus HTML. The encoded recorded-data block, bootstrap, CSS and five audio chapters were retained exactly. A local exact-file integration through the actual Worker `serveWorkbench` code passed, explicitly using a fixture scope; a subsequent **real-member production HTTP readback** matched the final HTML hash. Fifteen fresh anonymous curl cases again passed after this upload.

Current KV artifact: **`app-chrome-reviewed.html.gz`**, **16,432,391 bytes**. Gzip SHA-256: `280d3b9e8b1c26b9eeeb1edaf88760035bb7ab3046b764fe55a124a533df9e61`. HTML SHA-256: `75b3f2d1b2651d8dcf771712b770aca65a3cc3e1895bbbee497cc7cb93057826`. This supersedes the initial snapshot in the table above. Worker version remains `4b0d1d11-83b1-42f4-844b-0256ace83c8e`; runner remains v17. No additional Worker or runner deployment occurred.

Follow-up KV upload exit **0**. All available command log lines (fewer than ten):

```text

 ⛅️ wrangler 4.90.1 (update available 4.160.1)
──────────────────────────────────────────────
Resource location: remote 

Writing the contents of /Users/amastro/Documents/TraceHarness-eight-sol-audit-2026-11-11/app-chrome-reviewed.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

### Post-fix Chrome retest

The first live retest reloaded production and passed direct pointer selection of Custom, stock Claude Code, native Codex and native Claude Code with both fully visible and roughly half-clipped rows in a scrolled upward-opening popup. Keyboard selection also passed. The primary repeat answer correctly reported insufficient evidence in its Overview question, analysis document and detailed answer, without a disagreement rate.

It found a remaining related inconsistency: the separate Overview tile and task quick filter still displayed misleading zero mixed-outcome counts for the ungraded singleton. Those counters and the corresponding Outcomes, reading-guide and Student Lab statements were corrected in the additional follow-up below. Locator-positioned automation clicks still closed the popup without selecting; the reviewer could not reproduce that discrepancy using direct pointer input. That automation-specific discrepancy remains unresolved and is not hidden by the passing direct-pointer checks.

### Complete repeat-evidence coverage

Commit **`4522f750b137cc29063ee76abacdace3fc3c5482`**, pushed to public main, completes the same repeat-evidence repair across Overview, task quick filters, Outcomes flip figures/headlines, the reading guide and Student Lab explanations. Comparisons require at least two known selected-suite grades in the same model/harness/task group. Ineligible tasks and unknown attempts are disclosed, and **all actual attempts remain available**. Singleton attempts are never pooled across different model/harness conditions to manufacture eligible repeats.

All **1,117 frontend tests** passed, along with lint/build and two distribution contracts. The final wheel was built from a fresh tracked-source archive; **140 source/assets** matched, and it contains only the current JavaScript asset. Wheel SHA-256: `c66a78b39dac7b9f429387bf17d6c23aa8883843fbf705248c7f444ed71546c0`.

The final production snapshot is **`app-repeat-counters.html.gz`**, **16,432,789 bytes**, gzip SHA-256 `8c831e62b93a3d4644d6c8889ab5feb311bab56f2ec392caf07f484fbbaa372b`, HTML SHA-256 `d502a0f009bd4ca176dabf2585aeaa75d28d1b3aa5a9053ccb83c1dbd083e550`. It retains the exact embedded data, bootstrap, CSS and five audio chapters from the verified full corpus. Local exact-file Worker streaming and real-member production HTTP readback passed. Five fresh required anonymous curl cases also passed after this final upload: `/app`, `/app/shallow` and `/link` redirect to `/login`; the shallow API returns the exact sign-in-required 401 with and without a hostile Origin, without ACAO.

Upload exit **0**; Worker and runner versions unchanged. All available upload log lines (fewer than ten):

```text

 ⛅️ wrangler 4.90.1 (update available 4.160.1)
──────────────────────────────────────────────
Resource location: remote 

Writing the contents of /Users/amastro/Documents/TraceHarness-eight-sol-audit-2026-11-11/app-repeat-counters.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

The actual Chrome retest reloaded production and passed the Overview tile, task quick filter, All view and Outcomes flip statistics: comparisons were unavailable, zero tasks were eligible, the one unknown attempt remained visible, and no zero disagreement rate was asserted. It also found the adjacent pass@1 task-count label repaired below.

### Recorded attempts and known-grade labels

The final follow-up **`f55c182260d7b74eded6763ff0f7c5032d50dc5b`** fixes the adjacent pass@1 coverage label. The summary, tile and pinned figure description now share one explicit coverage string, distinguishing recorded attempts/tasks from known hidden grades. A targeted regression failed before the repair; the final complete frontend suite passed **1,118 tests**. Lint/build and two distribution contracts passed. The final wheel was built from a clean tracked-source archive, matches **140 source/assets** and contains only the current JavaScript asset; SHA-256 `d8aa71250129283ec3bdfcab09d496788043bcba53fbe29e4776b129cf068a59`.

**Current production artifact:** `app-grade-coverage.html.gz`, **16,432,791 bytes**, gzip SHA-256 `e40597e8a8d6363b2654c3637c325ea9244e7c7cf35c0e8b9417f0c406ac551b`, HTML SHA-256 `afc9ce38a0ef7f44ee757583282ab9af935fd482fbe0651173668412e664e4c7`. Real-member HTTP readback matched exactly. The recorded-data block, bootstrap, CSS and five audio chapters remain unchanged from the verified corpus. Five fresh required anonymous curl cases passed again after this last upload. Worker remains `4b0d1d11-83b1-42f4-844b-0256ace83c8e`; runner remains v17.

Upload exit **0**, source pinned to public main and temporary configuration deleted. All available upload log lines (fewer than ten):

```text

 ⛅️ wrangler 4.90.1 (update available 4.160.1)
──────────────────────────────────────────────
Resource location: remote 

Writing the contents of /Users/amastro/Documents/TraceHarness-eight-sol-audit-2026-11-11/app-grade-coverage.html.gz to the key "app.html.gz" on namespace id: "8a74dd2fba124b1a8d82e6eeff5ba3ae".

```

The final actual Chrome check reloaded production and **passed** in 15 seconds. The summary and pass@1 tile both showed “1 recorded attempt · 1 recorded task · 1 repeat · 0 known hidden grades”; the pass estimate/interval were unavailable, the repeat comparison was unavailable, and “Run 1 unknown” remained visible. The recorded-task versus unlabeled-graded-task contradiction was resolved. No job or member-data mutation was performed.

## Explicit remaining limits

**UNVERIFIED:** a fresh paid task under runner v17; a newly matched baseline/edited performance comparison; performance improvement; historical unknown charges; successful Claude completion; arbitrary native/profile/model/task combinations; live general-matrix throughput; production crowd load; the complete new-snapshot interactive matrix; and an end-to-end email/OAuth/PKCE callback repair.

**Designed, not implemented:** unified account authority, refresh/session registry, owner/admin console, MFA/step-up, full suspension across authorization planes, invitation/outbox lifecycle and public enrollment policy. Existing admin access has not been presented as this new system.

## Focused manual review

1. Sign into `/app`; confirm both recorded analysis and Harnesses are accessible, not just the simple editor.
2. Open Harnesses. Choose a stock/custom/native harness, compatible model and registered task. Inspect the complete JSON, apply a harmless prompt edit, export/import it, restore a checkpoint and check that changes invalidate an earlier review.
3. On a narrow viewport, select a native prompt with the keyboard, inspect/edit it and return to the list; focus must remain usable. Do not infer total vendor prompt coverage from patchable inventory counts.
4. Inspect the existing successful Codex result and its manifest, grade, prompt-application evidence and usage. A new execution costs money; select an explicit budget and task before starting it.
5. Open a recorded family/report cohort; verify observed repeat counts and mixed/unknown configuration descriptions against its runs.
6. Use the voice-tour transcript and Ask Buddy to navigate to real controls. Test capture only with a directory and account you intend to upload to; revoke the device afterward.
7. Review the account/admin proposal separately. No new signup, MFA, suspension or owner-console behavior should be assumed to exist yet.

[Structured results and hashes of private local evidence](EIGHT_SOL_PLATFORM_AUDIT.json). Credentials, provider balances, private prompts and recovery material are excluded.
