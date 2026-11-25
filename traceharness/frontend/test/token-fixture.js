/* Token views — fixtures in the shape of GET /results/<dir>/tokens, /tokens/tasks and
   /tokens/task/<task>. Every number is made up; they only have to add up the way the
   routes say they do (totals = sum of the phases, a run's total = its last cumulative point).

   tok3Data() is a one-model, one-harness dataset "tok3": 4 tasks × 3 repeats = 12 runs,
   merged onto rigFixture() so the shell has its usual "mini" dataset too. */
import { rigFixture } from './rig-testing'

export const TOK = 'tok3'
export const TM = 'acme/coder-9b', TH = 'agentic'
export const TASKS = ['proj__proj-101', 'proj__proj-102', 'proj__proj-103', 'proj__proj-104']
export const rid = (t, rep) => `20260201-000000-b0${TASKS.indexOf(t)}${rep}00`

/** [[call, cumulative tokens]] for a run whose prompt starts at `base` and grows by `step` a call. */
export function curve(n, base = 1500, step = 950, gen = 400) {
  const out = []
  let cum = 0
  for (let k = 1; k <= n; k++) { cum += base + step * (k - 1) + gen; out.push([k, cum]) }
  return out
}
const promptOf = (n, base = 1500, step = 950) => n * base + (step * n * (n - 1)) / 2

/* calls per repeat, by task; proj-101 is the one whose runs differ most */
const CALLS = { 'proj__proj-101': [22, 50, 31], 'proj__proj-102': [30, 38, 33], 'proj__proj-103': [18, 34, 25], 'proj__proj-104': [40, 42, 44] }
const PASS = { 'proj__proj-101': [true, true, true], 'proj__proj-102': [true, false, true], 'proj__proj-103': [true, true, false], 'proj__proj-104': [false, false, false] }

function tokRun(t, rep) {
  const n = CALLS[t][rep]
  const prompt = promptOf(n), generated = 400 * n
  return {
    run_id: rid(t, rep), task_id: t, harness_id: TH, model: TM, repeat_index: rep, provider: 'mini_swe_jsonl',
    exit_reason: 'submitted', steps: n, tool_calls: n, edits: 1, boundary_events: 0, boundary_kinds: [], tests_run_by_agent: 2, ran_tests_before_submit: true,
    input_tokens: prompt, output_tokens: generated, cache_read_tokens: Math.round(prompt * 0.97), cost_usd: null, wall_ms: 1000 * n,
    visible_pass: null, hidden_pass: PASS[t][rep], strong_pass: null, error: '',
  }
}
export const tokRuns = () => TASKS.flatMap((t) => [0, 1, 2].map((rep) => tokRun(t, rep)))

export function tokensFixture() {
  return {
    n_runs: 12, n_tasks: 4,
    totals: { prompt: 9640000, generated: 212000, cached: 9350800, computed: 501200 },
    shares: { prompt_of_total: 0.9785, cached_of_prompt: 0.97, reasoning_of_generated_chars: 0.88 },
    by_phase: [
      { phase: 'test', calls: 90, generated: 25000, prompt_read: 2500000, output_chars: 50000 },
      { phase: 'explore', calls: 300, generated: 104000, prompt_read: 4100000, output_chars: 410000 },
      { phase: 'reproduce', calls: 110, generated: 52000, prompt_read: 2000000, output_chars: 60000 },
      { phase: 'edit', calls: 30, generated: 15000, prompt_read: 600000, output_chars: 9000 },
      { phase: 'env', calls: 12, generated: 6000, prompt_read: 140000, output_chars: 3000 },
      { phase: 'submit', calls: 12, generated: 8000, prompt_read: 300000, output_chars: 0 },
      { phase: 'other', calls: 4, generated: 2000, prompt_read: 0, output_chars: 400 },
    ],
    context_growth: Array.from({ length: 40 }, (_, i) => {
      const k = i + 1, m = 1500 + 950 * i
      return { call_index: k, n_runs: k <= 22 ? 12 : k <= 31 ? 8 : 4, p25: Math.round(m * 0.85), median: m, p75: Math.round(m * 1.2) }
    }),
    top_decile_share: 0.31, n_runs_ungraded: 0, n_tasks_ungraded: 0,
    unknown: [],
  }
}

/** A dataset whose source records no cache hits, thinking or phases. */
export function unknownTokens() {
  return {
    n_runs: 4, n_tasks: 2,
    totals: { prompt: 52000, generated: 4100, cached: null, computed: null },
    shares: { prompt_of_total: 0.927, cached_of_prompt: null, reasoning_of_generated_chars: null },
    by_phase: [], context_growth: [{ call_index: 1, n_runs: 4, p25: 800, median: 900, p75: 1000 }, { call_index: 2, n_runs: 4, p25: 1500, median: 1700, p75: 1900 }],
    top_decile_share: 0.4, unknown: ['cached', 'reasoning', 'phase', 'duration'],
  }
}

export function spreadFixture() {
  const row = (t, spread, min, solved) => {
    const max = spread == null ? null : Math.round(min * spread)
    const totals = spread == null ? [null, null, null] : [min, max, Math.round((min + max) / 2)]
    return {
      task_id: t, runs: [0, 1, 2].map((r) => ({ run_id: rid(t, r), repeat_index: r, total: totals[r], solved: PASS[t][r] })),
      spread, min_total: min, max_total: max, solved, n_runs: 3,
    }
  }
  return {
    tasks: [row('proj__proj-101', 4.82, 261250, 3), row('proj__proj-103', 2.4, 180000, 2), row('proj__proj-102', 1.5, 420000, 2), row('proj__proj-104', 1.1, 800000, 0)],
    median_spread: 1.95, n_spread: 4, n_2x: 2, n_5x: 0, share_2x: 0.5, share_5x: 0, n_runs_ungraded: 0, n_tasks_ungraded: 0,
  }
}

/** The 3-run comparison of one task; `byPhase` false drops the phase split (a source without phases: {}). */
export function taskTokensFixture(t = 'proj__proj-101', { byPhase = true } = {}) {
  const split = (tot, w) => Object.fromEntries(Object.entries(w).map(([p, s]) => [p, Math.round(tot * s)]))
  const W = [{ explore: 0.55, reproduce: 0.18, test: 0.17, edit: 0.05, submit: 0.05 }, { explore: 0.48, reproduce: 0.24, test: 0.2, edit: 0.04, env: 0.02, submit: 0.02 }, { explore: 0.5, reproduce: 0.2, test: 0.2, edit: 0.05, submit: 0.05 }]
  const runs = [0, 1, 2].map((rep) => {
    const n = CALLS[t][rep], cum = curve(n), prompt = promptOf(n), generated = 400 * n
    return { run_id: rid(t, rep), repeat_index: rep, hidden_pass: PASS[t][rep], calls: n, prompt, generated, cached: Math.round(prompt * 0.97), total: prompt + generated, by_phase: byPhase ? split(prompt + generated, W[rep]) : {}, cumulative: cum }
  })
  const tot = runs.map((r) => r.total)
  const lo = runs[tot.indexOf(Math.min(...tot))], hi = runs[tot.indexOf(Math.max(...tot))]
  // every run follows the same curve, so the costlier never pulls ahead while the cheaper is running
  const end = lo.calls, atEnd = hi.cumulative[Math.min(end, hi.calls) - 1][1]
  return {
    task_id: t, runs, spread: Math.max(...tot) / Math.min(...tot), cheapest_run: lo.run_id, costliest_run: hi.run_id,
    diverge_call: null, diverges: hi.total >= 1.25 * lo.total ? 'after_cheaper_run_ended' : 'never',
    cheaper_run_last_call: end, costlier_at_cheaper_end: atEnd, costlier_ratio_at_cheaper_end: atEnd / lo.total,
    gap_by_phase: byPhase ? { explore: 0.42, reproduce: 0.27, test: 0.2, edit: 0.05, env: 0.03, submit: 0.03 } : {},
  }
}

export function tok3Data(extra = {}) {
  const f = rigFixture()
  const runs = tokRuns()
  f['/overview'] = { ...f['/overview'], results: [...f['/overview'].results, { name: TOK, runs: 12, harnesses: [TH], models: [TM], tasks: TASKS, pass_rate: 7 / 12, updated: '2026-02-01T00:00:00Z' }] }
  return {
    ...f,
    [`/results/${TOK}/runs`]: runs,
    // the analysis shell reads /metrics for the figures beside the Asking sentence
    [`/results/${TOK}/metrics`]: { cells: [], comparison: {}, sentinel_pairs: [] },
    [`/outcomes/${TOK}`]: { runs: Object.fromEntries(runs.map((r) => [r.run_id, { mode: r.hidden_pass ? 'passed' : 'wrong_patch', ledger: true }])), counts: { passed: 7, wrong_patch: 5 }, modes: [{ id: 'passed', label: 'passed', meaning: 'The hidden suite passed.' }, { id: 'wrong_patch', label: 'wrong patch', meaning: 'The hidden suite failed on the patch.' }] },
    [`/results/${TOK}/tokens`]: tokensFixture(),
    [`/results/${TOK}/tokens/tasks`]: spreadFixture(),
    [`/results/${TOK}/tokens/task/proj__proj-101`]: taskTokensFixture(),
    ...extra,
  }
}
