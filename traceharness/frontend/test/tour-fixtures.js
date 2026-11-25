/* ====================================================================================
   tour-fixtures.js — the extra data a few pages need before a page-tour walk can check their parts
   (tours.dom.test.jsx). NOT imported by app code. Invented values only, in the shapes the
   pages' own tests use (analysis, workspace, recommend and harness-home tests).
   ==================================================================================== */
import { rigFixture, MINI } from './rig-testing'
import { blocksFromAnswers } from '../src/rig/views/shallow-data'

const M1 = 'acme/alpha-1'

/** mini with the comparisons, the action patterns and the per-model report the analysis pages ask for. */
export function analysisData() {
  const f = rigFixture()
  f[`/results/${MINI}/comparisons?baseline=baseline`] = { baseline: 'baseline', comparisons: {
    [M1]: { terse: { n_tasks: 2, mean_diff: 0.25, ci95: [-0.1, 0.5], per_task: { t1: 0, t2: 0.5 } } },
    'acme/beta-2': { terse: { n_tasks: 2, mean_diff: 0.5, ci95: [0.25, 0.75], per_task: { t1: 0, t2: 1 } } } } }
  f[`/results/${MINI}/patterns?harness=baseline`] = {
    n_runs: 8, n_pass: 5, n_fail: 3, alphabet: [],
    sequences: [{ sequence: 'LRTWTS', n: 6, graded: 6, pass_rate: 4 / 6, ci95: [0.3, 0.9], mean_steps: 6, example: 'r-9' }, { sequence: 'LRWS', n: 2, graded: 2, pass_rate: 0.5, ci95: [0.1, 0.9], mean_steps: 4, example: 'r-8' }],
    divergence: [{ task: 't1', runs: 4, diverge_at: 2, common_prefix: 'LR', distinct_sequences: 2, pass_rate: 0.75, branches: [['T', 3], ['W', 1]] }],
  }
  f[`/real/${MINI}/analysis`] = { error: 'no real_features.jsonl in this directory' }   // a lab dataset: no SWE-agent features
  const base = f[`/results/${MINI}/report?harness=baseline`]
  f[`/results/${MINI}/report?harness=baseline&model=${encodeURIComponent(M1)}`] = base
  return f
}

/** mini with a trained Sentinel model and its detectors. */
export function sentinelData() {
  return { ...rigFixture(), '/../openapi.json': { paths: {} },
    '/sentinel': {
      active: 'mini_model', default_config: { threshold: 0.6 },
      model: { names: ['n_edits', 'no_test_yet'], w: [-0.4, 1.2], b: -1.1, meta: {
        trained: true, name: 'mini_model', n_runs: 16, n_examples: 60, folds: 5, fail_rate: 0.25, trained_at: '2026-01-03T00:00:00Z', harness_filter: 'baseline',
        auc_all_prefixes: 0.81, auc_run_weighted: 0.7, auc_ci: { any_prefix: [0.6, 0.9], bootstrap: 200 }, auc_baselines: { rules_only: 0.66, prior: 0.6 }, ece: 0.12,
        oracle_invisible_failure_share: 0.5, oracle_invisible: { n_fail: 4, invisible: 2 },
        auc_by_prefix: [{ bucket: '0-50%', auc: 0.6 }, { bucket: '50-100%', auc: 0.9 }],
        calibration: [{ bin: '0.0-0.5', n: 40, fail_rate: 0.1 }, { bin: '0.5-1.0', n: 20, fail_rate: 0.5 }],
        operating_points: [{ threshold: 0.5, recall: 0.75, false_alarm: 0.3, mean_lead_steps: 2 }, { threshold: 0.6, recall: 0.5, false_alarm: 0.1, mean_lead_steps: 1.5 }] } },
      models: [{ name: 'mini_model', active: true, meta: { n_runs: 16, auc_all_prefixes: 0.81, auc_run_weighted: 0.7 } }],
    },
    '/sentinel/plugins': { dir: '/lab/plugins', n_builtin: 1, n_plugin: 1, errors: [], detectors: [
      { id: 'submit_without_verify', source: 'builtin', label: 'Submitting without re-running tests', severity: 'high', why: 'Edited after the last test.', nudge: 'Run the tests.' },
      { id: 'streak', source: 'rule', file: 'streak.rule.json', label: 'Two edits since the test', severity: 'medium', why: 'Stacked edits.', when: 'edits_since_test >= 2 and steps_frac > 0.5', enabled: true }] },
  }
}

/** Build a harness reads its palette and presets straight from the server: { data, fetchImpl } with both. */
export function blocksData() {
  const answers = {
    '/api/blocks/palette': { tools: ['list_files', 'read_file', 'edit_file', 'run_tests', 'bash', 'submit'], types: ['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing'], blank: blocksFromAnswers() },
    '/api/blocks/catalog': { harnesses: [{ id: 'claude_code', name: 'Claude Code', default_model: 'mock', default_basis: 'x', blocks: blocksFromAnswers() }] },
    '/api/blocks/compile': { ok: true, hash: 'abc', warnings: [], harness: { id: 'blk_abc' } },
  }
  const fetchImpl = async (url) => {
    const body = answers[String(url)]
    return { ok: !!body, status: body ? 200 : 404, statusText: body ? 'OK' : 'Not Found', headers: { get: () => 'application/json' }, json: async () => body || { detail: 'not primed' } }
  }
  return { data: rigFixture(), fetchImpl }
}

const SETTINGS = { key_present: true, key_hint: 'sk-or-v…abcd', base_url: 'https://openrouter.ai/api/v1', lab_root: '/lab', results_root: '/lab/data/runs', harness_dir: '/lab/harnesses', task_dir: '/lab/tasks', results: [MINI, 'mock_ctl'], harnesses: ['baseline', 'terse'] }
/** mini with a capture watcher that has indexed sessions. */
export function captureData() {
  return { ...rigFixture(), '/settings': SETTINGS,
    'private:/capture/status': {
      runs_indexed: 12, open_runs: 1, open: [{ run_id: 'cap-open-1', task_id: 'fix the parser', steps: 7, last_ts: '2026-09-01T10:00:00Z' }],
      totals: { input_tokens: 120000, output_tokens: 8000, cost_usd: 1.5, unmeasured_runs: 2 },
      adapters: ['claude_code', 'codex'], sniffer: { state: 'idle', roots: 2, interval_s: 60, errors: 0, debris: 0, debris_checked_at: 0 },
      cursors: { sources: 2, seeded: 0 }, control: { paused: false } },
    'private:/capture/runs?limit=25': { rows: [{ run_id: 'cap-1', task_id: 'rename a flag', model: 'anthropic/claude-x', steps: 9, cost_usd: 0.12, exit_reason: 'submitted' }], total: 12 },
    'private:/capture/relations': { relations: {} } }
}

const pick = (id, title, extra = {}) => ({
  id, title, url: `https://huggingface.co/datasets/${id}`, score: 7, excluded: false,
  subset: { rows: 120, repeats: 1, of_rows: 500, demoted: false },
  estimate: { known: true, basis: 'dataset', runs: 5, hours: 2400 / 3600, cost_usd: 2.4, text: 'About $2.40 and 0.67 h, from 5 recorded runs on a/alpha.', arithmetic: '120 tasks x 1 repeats' },
  reasons: [{ rule: 'after-cutoff', text: 'All tasks are dated after the cutoff.', weight: 20, method: 'm' }], size_advice: {}, ...extra,
})
/** mini with an answer from the benchmark recommender. */
export function recommendData() {
  return { ...rigFixture(), '/recommend?goal=run&where=laptop&languages=python&detect_points=10': {
    rules_version: 1, catalog_refreshed: '2026-11-16', method: 'We selected Alpha (a/alpha) as the task set because it is new.', params: {},
    pick: pick('a/alpha', 'Alpha'), runner_up: pick('b/beta', 'Beta', { score: 3 }), not_this: pick('c/gamma', 'Gamma', { score: -150, excluded: true }),
    size_advice: { detect_points: 10, alpha: 0.05, power: 0.8, tasks: 120, repeats: 1, baseline_pass_rate: 0.5, baseline_basis: 'assumed', repeats_reason: 'one run per task', arithmetic: 'n = 385 runs per condition' },
    considered: [{ id: 'a/alpha', title: 'Alpha', kind: 'benchmark', score: 7, excluded: false, rules: [] }, { id: 'c/gamma', title: 'Gamma', kind: 'benchmark', score: -150, excluded: true, rules: [] }],
  } }
}
