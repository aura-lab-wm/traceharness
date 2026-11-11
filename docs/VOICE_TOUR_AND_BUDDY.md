# First-visit voice tour and Buddy workflow guide

Open **https://traceharness.dev/app**. Members who have not acknowledged this tour are offered it on their first visit after this release. If someone has already started interacting while the preference loads, the tour does not interrupt them. **Voice tour** remains in the titlebar for replay at any time. This is the real exported React member workbench; `/app/shallow` remains its separate plain-JavaScript companion.

## A narrated introduction with an equivalent transcript

The five chapters total approximately two minutes:

1. Recorded evidence: datasets, analysis and trajectories.
2. The whole harness: stock versus native runtimes, full JSON and immutable recorded manifests.
3. Bounded experiments: captures, compatible model/task selection, review, freeze and explicit Start.
4. Honest results: execution versus grade, reported/unknown costs and artifact inspection.
5. Ask Buddy: documented workflows and real controls.

Each chapter has a complete transcript. **Play narration** is explicit; there is no autoplay or microphone request. Pause, chapter changes, closing the tour and moving the document to the background stop playback. Delayed playback promises cannot mark a later chapter as playing. **Show me this workflow** opens the relevant workbench controls; it never applies a draft, saves a prompt or starts execution.

The audio is prerecorded MP3, bundled in the snapshot as data URLs. No third-party speech service or device-specific browser voice is required. Source transcripts and the generated recording hashes/durations are in `traceharness/frontend/src/rig/tutorial/lessons.json` and `narration.json`. The five recordings were generated from those exact transcripts with the installed macOS Samantha voice, then encoded with ffmpeg to mono MP3, 24 kHz / 48 kbps. No user text or recording evidence is narrated.

Escape dismisses the native modal, focus is contained while open and returns to the opener afterward. Buttons are at least 44px high. Chapters become a horizontally scrollable strip on narrow screens; the transcript remains in the document flow. Both workbench themes are supported.

## Ask Buddy how to use the platform

The hosted **Ask Buddy** panel now has a local workflow guide. Type a question and choose **Show me how**, or browse its workflow topics. For example:

- “How do I edit the full harness JSON?” → numbered steps, **Open Harnesses**, expansion of the actual JSON editor and a temporary focus outline.
- “Can I schedule tasks across several models?” → current runner availability, matrix prerequisites and the actual experiment controls.
- “Show me the family matrix” → recorded analysis for the selected dataset, without losing its identity.
- “Can I nuke all prompts?” → supported native fragment interventions and their coverage limits.
- “Can I watch a local directory?” → the local runner boundary and loopback command, without launching anything.
- An unrecognized action → an explicit lack of a reliable match, with supported topics to choose from.

Topics cover matrix scheduling, whole JSON, native fragments, cancel/resume, registered tasks, compatible models/OpenRouter, grades/costs, saves/drafts, forks, artifacts/exports, recorded analysis, local import/capture, harness selection, Case file pins and privacy/Buddy boundaries. Specific workflow names take precedence over shared nouns: the recorded **Family matrix** must not route to the experiment matrix.

This is a curated expert-system workflow guide, **not a model-generated interpretation of your runs**. Matching happens in the browser. Questions are not sent to OpenRouter or another model provider, saved in account records or included in the narration. Execution-related topics read the owner-bound runner catalog; unavailable or unconfirmed service state is labelled, and **Recheck runner** is explicit. Compatible availability still requires review of the exact configuration before Start.

All destinations come from the registered workflow catalog. The navigation callback rejects arbitrary target objects. Dataset arguments use the workbench's route encoder. Guidance can open tabs, expand an existing read-only panel and focus its controls; it does not call save, launch, cancel, credential or import endpoints. A help question cannot authorize a charged operation.

The existing model-backed evidence assistant remains separate in the local workbench, with its previous evidence allowlist, key requirement and explicit sharing consent. Hosted navigation guidance does not change that privacy boundary. Phone dock tabs were also repaired: active labels stay readable, inactive tabs retain accessible names and touch targets, and the tab strip scrolls rather than jamming labels together.

## Remembering the first visit

Closing, finishing or choosing a workflow acknowledges the introduction; it does not claim that every chapter was heard. The authenticated `/api/onboarding` endpoint stores one monotonic seen flag in the existing KV binding under an account-derived scope. It accepts no caller-selected account, prompt, question, credential or arbitrary value. Reads and writes pass the session/Origin gate; writes also require the page's member scope. A stale-account tab receives 409. No database migration or service-role operation is involved.

A browser hint uses that same member scope. It prevents repeated interruption during propagation or a failed acknowledgement without importing a previous visitor's preference. Account storage errors are visible and do not block the workbench. **Remember tour dismissal** explicitly retries the acknowledgement. Reopening the tour does not reset the account flag.

KV reads in another network location can lag a write by up to roughly 60 seconds; a different region may briefly offer the tour again. This preference is not an authorization decision. See [Cloudflare's KV consistency notes](https://developers.cloudflare.com/kv/api/read-key-value-pairs/).

## Manual acceptance checks

1. In a member account that has not acknowledged this release's tour, open `/app`: expect the introduction, with audio paused. Existing members also see it once after rollout. Do not reset another account's state to force this check.
2. Read and play every chapter. Test pause, Next/Back, chapter selection, end/replay, Escape and backgrounding the tab. The transcript must match the recording; no private prompt or question should enter the audio.
3. Choose **Show me this workflow** from the JSON and Buddy chapters. Confirm the actual JSON panel or Buddy guide opens and that no draft setting changes.
4. Skip/finish, reload, then sign in from a fresh browser context: the account acknowledgement should suppress automatic display. Replay with **Voice tour** and confirm that it starts paused.
5. Ask the six questions above and several paraphrases. Check the numbered instructions, active dataset, exact destination, expanded panels and focus outline. Unsupported requests must not fabricate a capability.
6. For dispatch/model/task questions, inspect the live availability label, recheck it and compare it with Harnesses. No credentials are needed to read this catalog. An unavailable/invalid response must not appear as ready to execute.
7. Inspect the browser network while using help: no model-provider requests, saved-question payloads, job submission or credential writes. The tour acknowledgement is the only account write introduced by this flow.
8. Check 320, 390, 768 and 1440px widths, both themes, keyboard focus and screen-reader names. Buddy tabs must stay readable and operable on phones.
9. Logged out, `/app`, `/app/shallow` and `/link` must redirect to `/login`. Anonymous API requests, including `/api/onboarding`, must return exact 401 `{"error":"Sign in required."}` without ACAO, including hostile Origin. Signed-in hostile Origin remains 403 and a mismatched member scope remains 409.
10. Simulate a preference service/storage failure: show the unconfirmed state, retain access to the workbench and offer retry. A later acknowledgement must never reset another account's preference.

For a bug report include the question/topic, exact steps, expected/actual behavior, URL, browser/viewport/theme and whether audio was playing. Include a screenshot or sanitized network status when useful. Never send passwords, keys, cookies or JWTs.

## Verification

Current release receipts are recorded in [VOICE_TOUR_VERIFICATION.json](VOICE_TOUR_VERIFICATION.json). Candidate checks replace only the HTML document and simulate the acknowledgement response so the real first-use flag remains untouched until the published-page check. Authentication, catalog and other reads use production. The final live check uses the published document and real account storage, followed by a fresh authenticated browser context.

The frontend and Worker suites are local contract/interaction tests; their results are not evidence of a live PostgreSQL save or a paid model run. This release submits no paid trial. Existing execution cohorts are described separately in [Execution verification](EXECUTION_PERFORMANCE.md).

Only headless Chromium is used for the browser proof. Hardware speaker output, Safari/Firefox behavior, human listening quality, another physical member account and every storage/provider failure permutation are **UNVERIFIED** by that proof. MP3 decoding, non-silent audio, browser playback advancement, UI navigation, ownership refusal, account acknowledgement and fresh-browser persistence have distinct checks in the receipt.


## Published release receipt — 11 November 2026

- Public implementation: `eb7a246`; site gateway commit (local only): `06484eb`.
- **1,081 frontend tests, 198 Worker tests and two build/source consistency tests passed.** The 24 focused tour/guidance tests cover first visit, guarded navigation, unsupported intents, delayed playback, account failure, focus and live-catalog refusal. Existing Node/local-storage and unrelated lint warnings remain recorded; the bundle retains its size warning.
- **41 live anonymous curl checks passed**, using `traceharness-proof`, zero redirects, exact API 401 bodies and no ACAO. Signed-in hostile Origin returned 403; stale-account acknowledgement returned 409.
- The exact candidate passed real-member browser checks with only its tour acknowledgement simulated. The published page then passed the same checks using actual account storage: first-use offer, no autoplay, all five audio chapters advancing, pause/chapter changes, real JSON/matrix destinations and focus, production catalog, unknown/local-only questions, both themes, 320/390/768/1440px layouts, mobile panel tabs, Escape/replay and reload. A fresh authenticated browser with empty local storage confirmed durable account acknowledgement. **Zero jobs were created** and no model inference was invoked by the guide.
- Five full MP3 files decode and contain non-silent audio; their transcript and recording hashes match. Browser playback was measured separately from offline decoding. Physical speaker listening was not performed.
- Published decompressed HTML SHA-256: `cccac52e3b7bf80b5bbef48627fe2ee9acc5ff3bfbdb1d5840082a1d880aa888`.
- Uploaded `app-voice-guide-v3.html.gz`: **15,295,294 bytes**, SHA-256 `16a78ba26a46b20bf1f11bb1f4c10c9119d82c132c1a5503481caa1c704e65d2`; upload exit **0**. The opaque recorded payload remains identical: eight datasets / 3,453 rows. The total compressed snapshot stays below the existing 16 MiB streaming bound.
- Worker version **`5ff30c89-62aa-4c90-ba78-b37a24ef4bf4`**, deploy exit **0**. Existing zone routes were retained; no Durable Object, migration, workers.dev target, apex attachment, database policy or runner image changed. The ephemeral config was deleted.

Last ten Worker deployment log lines (including blank lines):

```text
Worker Startup Time: 5 ms
Your Worker has access to the following bindings:
Binding                                                  Resource
env.SNAPSHOT (8a74dd2fba124b1a8d82e6eeff5ba3ae)          KV Namespace
env.ADMIN_EMAILS ("amastropaolo@wm.edu")                 Environment Variable

Uploaded traceharness-platform (2.54 sec)
No deploy targets for traceharness-platform (0.74 sec)
Current Version ID: 5ff30c89-62aa-4c90-ba78-b37a24ef4bf4

```

The KV upload log tail and complete machine-readable receipts are in [VOICE_TOUR_VERIFICATION.json](VOICE_TOUR_VERIFICATION.json).
