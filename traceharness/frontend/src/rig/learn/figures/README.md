# Learn figures

Every figure in a Learn article is drawn from real numbers, inside one frame: the `FigureCard`.
Two figures show how a finished one looks:

- `kinds/run-steps.jsx`: a step-through, with Play, Back and Next.
- `kinds/pass-k.jsx`: a chart with tabs, a slider and a Table view.

## Add a figure in four steps

1. **Precompute its data.** Add a `build_<id>(runs_dir, date)` function to `scripts/learn_figures.py` and register it in
   `FIGURES`. It returns a small dict that starts with
   `"provenance": _prov(<dataset>, <filter in words>, <rows read>, date)`. Then run:

   ```
   ~/traceharness-clean/.venv/bin/python -I scripts/learn_figures.py --runs <dir holding the datasets> --only <id>
   ```

   A worktree's `data/runs` does not hold the two datasets; on this machine they are in `~/traceharness-study/data/runs`
   (read them, never write there). This writes `figures/data/<id>.json`. The script reads only `study_v04` and
   `swe_rebench_openhands_qwen3coder` (`ALLOWED`) and refuses any other name. Keep each file small: a few KB,
   holding the raw rows the page recomputes from (per-task counts, steps), not whole runs.

2. **Draw it.** Add `kinds/<kind>.jsx` exporting
   `KINDS = { <kind>: { Figure, Preview, headlines } }`, and add its one import line to `KIND_MODULES` in `index.jsx`.
   A static import is needed: `tests_agentlab/test_no_dead_surface.py` follows imports to find every `.jsx`. The data
   folder is read whole, so a data file needs no list.
   - `Figure({ fig, n, d })` returns a `<FigureCard>` (see below). `d` is the JSON.
   - `Preview({ fig, d })` draws inside a 120 × 56 viewBox. It is the small drawing on the article's card in the Learn index.
   - `headlines(d)` returns `{ key: 'as written' }`: the numbers the figure leads with, formatted the way the article
     writes them (`math.js fmt`).

3. **Place it in the article JSON**, in `figures[]`:

   ```json
   { "id": "a05-cum-tokens", "kind": "<kind>", "after_section": 1, "data_file": "a05-cum-tokens",
     "title": "Short title on the card",
     "caption": "What it shows, with the numbers the text quotes.",
     "data_note": "study_v04, 2 runs",
     "after": { "source": 2, "figure": 3 },
     "headline": [{ "key": "total_0", "as_written": "3,950" }] }
   ```

   - `after_section` is the index of the section the figure follows.
   - `after` is optional. It credits a source whose figure this one redraws: "after Figure 3 of <source 2> [2]". Use
     it only once you have opened that figure and checked its number.
   - An article may also have `in_short`: 3 sentences, each 30 words or fewer, with the key claim in `**bold**`.

4. **Run the tests.** `figures-data.test.js` checks that:
   - every kind has a drawing and every `data_file` exists;
   - every data file names its dataset, filter, date and script;
   - every `headline` matches what `headlines(d)` draws **and** appears in the article's text.

   Add a "precomputed and recomputed agree" case for your data when the page recomputes anything.

## FigureCard

```jsx
<FigureCard fig={fig} n={n} reveal={useReveal()}
  tabs={[[0, 'Run 1'], [1, 'Run 2']]} tab={tab} onTab={setTab}            // optional: which data
  legend={[{ label: 'tokens in', tone: 'in' }]}                           // chips; tones are in figures.css
  chart={<div ref={boxRef}><svg …/></div>}                                // the drawing
  aside={<Detail/>}                                                       // optional: beside the chart; under it below 600 px
  controls={<label className="rg-lfig-slider">…</label>}                  // Play / Step, sliders
  readout="k = 3: pass@3 57.0% …"                                         // one live line saying what is shown
  table={<FigTable caption cols={[…]} rows={[[…]]} tall?/>} />           // gives the Chart / Table toggle
```

- **Chart / Table.** Pass `table` and the card shows a Chart / Table toggle. Every chart has one, so no number is
  hidden in a drawing. `FigTable` scrolls inside the card; with `tall` it is at most 20rem high.
- **Size.** Measure the drawing with `const [boxRef, w] = useWidth(560)` (`../motion.js`) and draw an SVG whose
  `viewBox` is `0 0 w H`. Its words then stay at 12 px or more on a phone, and the card stacks below 600 px
  (`@container rglfig`).
- **Colour.** Use tokens only. Series are `--rig-ser1…3` (blue, the factor) and `--rig-ser4…6` (grey). Pass and fail
  are `--rig-sky` and `--rig-red`. A caution is `--rig-amb`. The accent `--rig-sel` marks selection only (the tests
  enforce this).
- **Motion.** Use `useReveal()`: the card fades and rises once when it first scrolls into view.
  - `reveal.seen` turns true at that moment. Use it to grow bars or draw lines once, with transitions on
    `--rig-dur-*` and `--rig-ease`.
  - `reveal.scrolled` is true only when the figure came into view by scrolling with motion allowed. A step-through
    may play once on it.
  - Nothing loops. Under `prefers-reduced-motion` nothing moves (rig.css), and `seen` is true at once.
- **Play / Step.** Use the `stepper` reducer (`stepper.js`). Play goes through the steps once and stops on the last;
  any step press pauses. A control that would do nothing (Back on step 1, the step already shown) stays visible, is
  `aria-disabled`, and its `data-hint` says why.

## Files

| file | what |
|---|---|
| `index.jsx` | `Figure` (picks the kind), `FigurePreview`, the kind and data registries |
| `FigureCard.jsx` | the frame, `FigTable` |
| `math.js` | pass@k / pass^k (as `core/analysis.py`), spread, median, `fmt`, `linear`, `ticks` |
| `stats.js` | the arithmetic of the figures of articles 11 to 14: Run setup's detectable difference, `analysis.factorial` from pass counts, paired task differences, a trade curve's area |
| `stepper.js` | Play / Pause / Step |
| `kinds/*.jsx` | one file per kind; `legacy.jsx` holds the first eight, drawn from numbers in the article |
| `kinds/*.css` | a kind's own styles, imported by its `.jsx` (the kinds of articles 11 to 14) |
| `data/*.json` | written by `scripts/learn_figures.py`; never edit by hand |
| `figures.css` | the card and every kind |
