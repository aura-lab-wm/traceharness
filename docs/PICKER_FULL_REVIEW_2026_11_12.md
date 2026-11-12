# Harness picker review — November 12, 2026

The five-reviewer investigation covered pointer/focus events, clipping and placement, test gaps, evidence quality, and composer integration. It then tested the signed-in production workbench and reproduced two separate timing defects in an isolated browser fixture using the actual picker and CSS.

## Production browser evidence

The signed-in member surface is `https://traceharness.dev/app#/rig/home+!harnesses`. The Worker serves the KV application snapshot at `/app`; the separate plain-JavaScript `/app/shallow` page is not the React workbench.

At a measured 950 × 719 viewport, the ChatGPT-in-Chrome review passed **22/22 selections**: twelve unfiltered visible-pointer selections (four harness categories, three rounds), four filtered pointer selections, four keyboard selections, and two locator retries. Every selection checked the displayed label and complete rendered configuration JSON. Repeated selections matched their first-round configurations. Harnesses stayed active and the route stayed unchanged.

The four categories were Custom TraceHarness harness, Claude Code stand-in, native Claude Code, and Codex CLI. Direct-pointer checks scrolled only the options list, reacquired clipping bounds and hit targets, and kept document scroll at zero. The two successful locator retries moved the surrounding document; no internal event trace was available. **The precise cause of the earlier historical failed automation remains UNVERIFIED.**

The existing four-trial native Codex experiment queue loaded with all four trials displaying succeeded / Passed; its first existing result also loaded with matching status. This checks presentation of recorded results. No new model execution or charge was initiated.

## Reproduced local defects

### A saved-library response can move a pressed row

A native Chrome pointer press began on the visibly rendered Claude Code stand-in description. The fixture inserted a saved-harness group 100 ms later while the pointer stayed down. The same coordinates then hit the new saved row. On release, Chrome dispatched the trusted click to the listbox (the common ancestor), so no option handler ran. The menu remained open and the selected value remained Custom. The baseline held click selected Claude correctly.

This proves a local race in the same picker source and the group insertion shape used by the composer. It does not establish that this race caused the historical production report. The injected response timing was synthetic; the pointerdown, pointerup and click were native, trusted browser events.

### Container resizing leaves stale popup bounds

With the viewport fixed at 1131 × 675 and scroll offset unchanged, the containing scrollport shrank from 480 to 330 pixels high. Its lower edge moved from 700.78 to 550.78. The open popup retained its previous bottom edge of 667, and the browser visibly clipped the lower rows. Window resize and scroll listeners cannot detect this size-only change.

A held Claude selection still succeeded in that test because its pointer coordinate was inside the new clip. A native catalog description update during a held native-Claude click also selected the correct runtime. These passing cases are separate from the two reproduced defects.

## Repairs

The picker holds its displayed options stable for an active primary pointer press, through the browser's subsequent click. It still validates the chosen stable ID against the latest catalog before committing; a removed or newly disabled option cannot be selected from the retained display. Cancellation, an outside release, window blur, menu closure and unmount release the snapshot. Keyboard behavior stays available, and the change neither selects on pointerdown nor captures the pointer or prevents native touch scrolling.

The placement calculation observes the control, picker root and clipping ancestors for size changes, in addition to existing scroll and viewport events. It does not observe the popup or its options. Closing the menu disconnects the observer; unchanged geometry retains the existing placement state.

## Test quality repair

The composer selection helper previously filtered its options and asserted the absence of an unrelated group that was not present to begin with. It now checks the selected combobox label and closure of the actual named listbox. An additional unfiltered four-category integration test checks the exported configuration identity and retained model/task without dispatching a job. DOM tests do not prove browser hit-testing or live execution.

## Security and scope

Fresh production curl checks use `User-Agent: traceharness-proof` and `--max-redirs 0`: logged-out `/app`, `/app/shallow`, and `/link` return 302 to `/login`. `/api/shallow/jobs` returns 401 with exactly `{"error":"Sign in required."}` both normally and with a hostile Origin. None exposes `Access-Control-Allow-Origin`.

This review does not verify every possible runtime/profile/model/task combination, fresh paid completion under the current runner, performance improvements, production crowd load, unknown historical charges, or the email/OAuth/PKCE callback lifecycle. The proposed account/admin system remains a separate unimplemented design. Production SQL and account policy are outside these picker repairs.

## Verification after repair

The identical native-browser held-click replay passed: the saved group arrived during the press, the pointerup and click still targeted Claude Code stand-in, and the resulting configuration selected `fixed:claude`. The source copy used by the fixture matched the repaired repository picker (SHA-256 `972e0fb1294d4d0b489571bbb6b4f9e6d55ca0b144ca29f6ac8756b2dc76d2d6`).

The timed container shrink replay also passed. After resize observation, the popup bottom was 542.78 inside the 550.78 container edge, leaving the intended eight-pixel margin. Scrolling the resized list and selecting Codex CLI returned `native:native-codex`. These are local native-browser proofs; cancellation and removed/disabled-option coverage are DOM regressions, not a physical touch-device proof.

The repaired frontend passed **1,125 tests across 66 files**, lint, production build, and both source/distribution freshness checks. Six new picker regressions cover delayed updates, removed/disabled choices, touch cancellation, abandonment/cleanup, and container-only resize. The separate composer integration adds unfiltered category coverage. The build retains the existing large-chunk warning; no speed improvement is claimed.
