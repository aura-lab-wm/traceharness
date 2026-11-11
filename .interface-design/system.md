# Recorded configuration inspection

TraceHarness is a research workbench. Readers must distinguish a current draft, a recorded configuration, an importer reconstruction and a frozen hosted-run manifest.

Reuse the existing rig palette and spacing tokens. Surfaces are `--rig-panel` and `--rig-panel2`, separated with `--rig-line` borders. Use `--rig-text`, `--rig-dim` and `--rig-mute` for hierarchy, `--rig-sel`/`--rig-sel-t` for the selected document and `--rig-amb` for redaction or uncertainty. Do not introduce decorative colors or shadows.

The shared `HarnessJson` panel is used in the composer, hosted results, family inspector, run/task ledgers and earlier authoring views. Place the source above the title, then the run/snapshot identity and complete document controls. Documents represent separate source objects; do not merge a current preset into historical evidence.

Use the existing IBM Plex sans and mono tokens. JSON uses 12px mono with 1.7 line height, 2-space indentation and 4px-based rig spacing. Wrap by default and retain all source text in an independently scrollable region. Desktop controls have a 36px minimum height; small-container controls have a 44px minimum height. Copy and Download always apply to the selected document. Missing, loading and failed data disable export instead of substituting defaults.


# Workflow guidance and narration

Keep navigation guidance distinct from model interpretation of recorded evidence. Buddy matches documented workflows in the browser, labels prerequisites, checks the live runner catalog for execution questions, and offers only registered navigation targets. It never executes an action on behalf of a help question.

The narrated tour uses the same Plex type and rig tokens, a 4px spacing scale, a two-column chapter/document layout on wide screens and a single-column layout with a horizontally scrollable chapter strip on phones. Buttons are at least 44px high. Complete transcripts accompany each recording. Narration begins only on Play, stops on chapter change/close/background, and stale playback promises cannot affect a newer chapter. Native modal semantics contain focus; dismissal restores its opener.

Use account-scoped first-use acknowledgement with a scoped local hint; failures remain explicit and never block the workbench. Reopening the tour is always available. Spotlight only existing controls and expand their read-only panels; do not change draft settings to demonstrate a workflow.
