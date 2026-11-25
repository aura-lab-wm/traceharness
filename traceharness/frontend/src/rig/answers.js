/* ====================================================================================
   Rig · answers.js — the pre-answered questions (from the Inquiry prototype). PURE.

   Every answer is arithmetic over live API payloads; nothing is typed in. A question whose
   payload is missing or cannot support an answer returns { unanswered: <reason> } and the UI
   says so, rather than estimating.

   QUESTIONS[i] = { id, short, needs: [resource…], q(c) -> question text,
                    answer(input) -> Answer | { unanswered } }
   input = { dir, row, cond: {model, harness}, oracle, runs, metrics, experiment, oracleData,
             integrity, sentinel, report, outcomes }        (any resource may be null = not loaded)
   Answer = { verdict?: [string | {mark} | {term, text}],        // one plain-words line said first (variable, grader)
              sentence: [string | {mark}], num, numOf, numLabel, short,   // numOf: what `num` is of, in words
              scope,                                         // which runs, in words (scope.js): "this cell: …", "pooled: …"
              of?,                                           // those runs when they are not the cell in focus nor the dataset
                                                             // pooled: { harness, models } (one harness, every model) or
                                                             // { model, harness } (another cell); the Asking line says it
              runs: { title, test(run) -> bool },           // "show me the runs"
              fig: {...}                                     // payload for the figure renderer
              note? }                                        // honesty caveat shown under the answer
   ==================================================================================== */
import { oracleChanges } from './provenance'
import { short, sfx, tally, verdict, isFailureMode, fmt, conditionRuns } from './data'
import { scopeWords } from './scope'

const { pct, pp, int, plural, rate, share } = fmt
/** The dataset pooled (every model and harness of `row`), or this cell (`cond`), in words. */
const pooledOf = (row) => (row ? scopeWords({ kind: 'pooled', models: (row.models || []).length, harnesses: (row.harnesses || []).length }) : 'pooled: every run')
const cellOf = (cond) => scopeWords({ kind: 'cell', model: cond && cond.model, harness: cond && cond.harness })
const humanReason = (r) => String(r || 'not computed').replace(/_/g, ' ').replace(/\blevels a\b/, 'models').replace(/\blevels b\b/, 'harnesses')

const MODE_PHRASE = {
  cutoff_no_patch: 'cut off at the per-call output limit before any edit',
  wrong_patch: 'a patch the hidden oracle then failed',
  step_limit_no_patch: 'out of steps before producing any patch',
  no_patch: 'ended without producing a patch',
  harness_error: 'harness errors (the failure may not be the agent’s)',
}

/** The dataset a training source names: "data/runs/llma4se_live/" and "llma4se_live" are both llma4se_live. */
/** A run's calls in the unit they were recorded in: its model calls (from its ledger, via /outcomes) when known,
 *  else its tool calls, named as such. An importer writes one index step per tool call, so `steps` is not used. */
export function callsOf(run) {
  if (Number.isInteger(run && run.modelCalls)) return { n: run.modelCalls, unit: 'model call' }
  return { n: Number.isInteger(run && run.tools) ? run.tools : null, unit: 'tool call' }
}

export const sourceDataset = (src) => String(src || '').split(/[\\/]/).filter(Boolean).pop() || ''
/** Which sentinel model was trained on `dir` (meta.sources, bare names or paths), preferring the active one. */
export function sentinelFor(sentinel, dir) {
  if (!sentinel || !Array.isArray(sentinel.models)) return null
  const trained = sentinel.models.filter((m) => ((m.meta && m.meta.sources) || []).some((src) => sourceDataset(src) === dir))
  return trained.find((m) => m.name === sentinel.active) || trained[0] || null
}
export function operatingPoint(model, threshold) {
  const ops = (model && model.meta && model.meta.operating_points) || []
  if (!ops.length) return null
  return ops.find((o) => Math.abs(o.threshold - threshold) < 1e-9) || [...ops].sort((a, b) => Math.abs(a.threshold - threshold) - Math.abs(b.threshold - threshold))[0]
}
/** Repeats per task, per model: min over that model's (harness, task) slots. */
export function repeatsPlan(runs) {
  if (!runs || !runs.length) return null
  const slots = new Map()
  for (const r of runs) { const k = `${r.model}|${r.harness}|${r.task}`; slots.set(k, (slots.get(k) || 0) + 1) }
  const byModel = new Map()
  for (const [k, n] of slots) { const m = k.split('|')[0]; byModel.set(m, Math.min(byModel.get(m) ?? Infinity, n)) }
  const models = [...byModel].map(([m, reps]) => ({ m, reps })).sort((a, b) => a.reps - b.reps || a.m.localeCompare(b.m))
  const max = Math.max(...models.map((x) => x.reps))
  return { models, low: models[0], max, even: models[0].reps === max }
}
/** Tasks under one condition with their repeats in order and a pass/fail tally. */
export function taskStrips(condRuns, oracle) {
  const by = new Map()
  for (const r of condRuns) { if (!by.has(r.task)) by.set(r.task, []); by.get(r.task).push(r) }
  return [...by].map(([task, list]) => {
    const rs = [...list].sort((a, b) => a.rep - b.rep || a.id.localeCompare(b.id))
    const t = tally(rs, oracle)
    return { task, runs: rs, ...t, mixed: t.p > 0 && t.f > 0 }
  }).sort((a, b) => a.task.localeCompare(b.task))
}

/* A failure under the visible or strengthened oracle: its recorded mode when the ledger has one,
   'strengthened_only' for a hidden pass that fails the extra strengthened cases, else 'not_recorded'. */
const EXTRA_MODES = [
  { id: 'strengthened_only', label: 'strengthened only', meaning: 'Passed the hidden oracle; failed the extra cases of the strengthened oracle.' },
  { id: 'not_recorded', label: 'how it failed: not recorded', meaning: 'Failed under this oracle; the ledger does not record how it failed.' },
]
function modeUnder(run, oracle) {
  if (verdict(run, oracle) !== false) return null
  if (isFailureMode(run.mode)) return run.mode
  return oracle === 'strengthened' && run.hid === true && run.str === false ? 'strengthened_only' : 'not_recorded'
}
/** "How do runs fail?" under the visible or strengthened oracle, counted from the runs it grades. */
export function failuresUnder(runs, outcomes, cond, oracle, row = null) {
  const counts = {}
  let failures = 0, ungraded = 0
  for (const r of runs) {
    const v = verdict(r, oracle)
    if (v == null) ungraded++
    else if (v === false) { failures++; const m = modeUnder(r, oracle); counts[m] = (counts[m] || 0) + 1 }
  }
  if (!failures) return { unanswered: `No run in this dataset failed the ${oracle} oracle${ungraded ? ` (${ungraded} are ungraded, which is not failure)` : ''}.` }
  const fails = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const modes = [...(outcomes.modes || []), ...EXTRA_MODES]
  const [topMode, topN] = fails[0]
  const meta = modes.find((m) => m.id === topMode) || { label: topMode }
  const condCounts = {}
  for (const r of conditionRuns(runs, cond.model, cond.harness)) { const m = modeUnder(r, oracle); if (m) condCounts[m] = (condCounts[m] || 0) + 1 }
  return {
    sentence: [{ mark: `${int(topN)} of ${int(failures)} failures` }, ` under the ${oracle} oracle were ${MODE_PHRASE[topMode] || meta.label}.`],
    num: share(topN / failures), numOf: `of ${int(failures)} failures`, numLabel: `${meta.label} · ${int(failures)} failures of ${int(runs.length)} runs · ${oracle} oracle`, scope: pooledOf(row),
    short: `${int(topN)} of ${int(failures)} failures: ${meta.label}`,
    note: `${ungraded ? `${int(ungraded)} ungraded runs are unknown, not failures. ` : ''}Failures are graded by the ${oracle} oracle; each mode is read from the run's ledger by /api/outcomes, and describes how a run stopped, not why the task was hard.`,
    fig: { kind: 'modes', fails, failures, modes, condCounts, cond, condFailures: Object.values(condCounts).reduce((a, v) => a + v, 0) },
    runs: { title: `Runs that failed the ${oracle} oracle as “${meta.label}”`, test: (r) => modeUnder(r, oracle) === topMode },
  }
}

/* ------------------------------------------------------------------ verdicts
   One plain-words line said first on an answer's page, from the same numbers as the answer. Parts are strings,
   { mark } (bold) and { term, text } (a glossary word, Term.jsx). */
const term = (slug, text) => ({ term: slug, text })
/** The parts as plain text. */
export const plainParts = (parts) => (parts || []).map((p) => (typeof p === 'string' ? p : p.mark ?? p.text ?? '')).join('')

/** "Which variable moves success here?" — said harness first (TraceHarness asks about harnesses): does the harness change
 *  the pass rate, then which factor carries more of the variance. "Yes" only when more comparisons separate from zero
 *  than twice what chance alone would give (`expected`, the /experiment multiplicity; 5% of them when not given). */
export function variableVerdict(f, nSep, nAll, expected = null) {
  const harnessLeads = f.leading_factor === 'harness'
  const m = share(f.model.share), h = share(f.harness.share)
  const chance = expected != null ? expected : 0.05 * nAll
  const clear = nSep > 0 && nSep > 2 * chance
  const head = !nAll
    ? ['Too few shared tasks to compare harnesses: no two harnesses share two tasks for one model']
    : clear ? ['Yes, the harness changes the pass rate: in ', { mark: `${nSep} of ${nAll}` }, ' ', term('contrast', 'comparisons')]
      : nSep > 0 ? ['Not clearly: ', { mark: `${nSep} of ${nAll}` }, ' ', term('contrast', 'comparisons'), ` separate from zero, and about ${fmt.fx(chance, 1)} would by chance alone`]
        : ['No clear harness effect: none of ', { mark: String(nAll) }, ' ', term('contrast', 'comparisons'), ' separates from zero']
  const tail = harnessLeads && clear
    ? [', and it matters more than the model: ', { mark: h }, ' of the ', term('share-of-variance', 'variance'), ` against the model\u2019s ${m}.`]
    : harnessLeads
      ? ['. The harness still carries more of the ', term('share-of-variance', 'variance'), ': ', { mark: h }, ` against the model\u2019s ${m}.`]
      : ['. The model matters more: ', { mark: m }, ' of the ', term('share-of-variance', 'variance'), ` against the harness\u2019s ${h}.`]
  return [...head, ...tail]
}

/** "Can I trust the oracle?" — Yes / Mostly / Partly / Not on its own by κ (0.8, 0.6, 0.4), then what the stricter
 *  grader does to the pass rate: lowers it, raises it, or never changes a grade. */
export function graderVerdict(o, change) {
  const k = o.kappa
  const word = k >= 0.8 ? 'Yes' : k >= 0.6 ? 'Mostly' : k >= 0.4 ? 'Partly' : 'Not on its own'
  const pts = (x) => `${(x * 100).toFixed(1)} points`
  const agree = k >= 0.6 ? 'the two grades agree well beyond chance' : k >= 0.4 ? 'the two grades agree only moderately beyond chance' : 'the two grades agree little beyond chance'
  const what = !change ? ['the stricter grader changes the pass rate by ', { mark: pts(o.rate_b.rate - o.rate_a.rate) }]
    : !change.loss && !change.gain ? ['the stricter grader never changes a grade']
      : [...(change.loss ? ['the stricter grader lowers the pass rate by ', { mark: pts(change.loss) }] : ['the stricter grader never lowers the pass rate']),
        change.gain ? ` and raises it by ${pts(change.gain)}` : change.loss ? ' and never raises it' : '']
  return [`${word}: `, ...what, ' (', term('kappa', '\u03ba'), ` ${fmt.fx(k)}: ${agree}).`]
}

export const QUESTIONS = [
  {
    id: 'variable', short: 'What moves success', needs: ['experiment'],
    q: () => 'Which variable moves success here?',
    answer({ experiment: e, runs, row }) {
      if (!e) return null
      const f = e.fit || {}
      if (!f.leading_factor || !f.model || !f.harness) return { unanswered: `The two-factor fit is not computed for this dataset (${humanReason(f.reason || f.status)}).` }
      const lead = f.leading_factor, other = lead === 'model' ? 'harness' : 'model'
      const cons = (e.contrasts || []).filter((c) => c.delta != null)
      const sep = cons.filter((c) => !c.covers_zero).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      const pick = sep[0] || [...cons].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0] || null
      return {
        verdict: variableVerdict(f, sep.length, cons.length, e.multiplicity ? e.multiplicity.expected_false : null),
        sentence: ['The ', { mark: lead }, `: it carries ${share(f[lead].share)} of the outcome variance against the ${other}'s ${share(f[other].share)} (interaction ${share(f.interaction_share)}).`],
        // the question is about the harness: its share is the headline, the model's the comparison
        num: share(f.harness.share), numOf: 'of the variance, the harness', numLabel: `the harness's share of variance · the model: ${share(f.model.share)}`, scope: pooledOf(row),
        short: `the ${lead} — ${share(f[lead].share)} of variance vs ${share(f[other].share)}`,
        note: `${sep.length} of ${cons.length} comparisons separate from zero; with ${cons.length} comparisons about ${fmt.fx(e.multiplicity ? e.multiplicity.expected_false : null, 1)} would separate by chance alone. Descriptive, not causal.`,
        fig: { kind: 'variance', f, contrasts: sep.length ? sep.slice(0, 6) : cons.slice(0, 6), nSep: sep.length, nAll: cons.length },
        runs: pick && runs ? {
          title: `${short(pick.a)} under ${pick.from} vs ${pick.to} — the ${sep.length ? 'largest separating' : 'largest'} Δ (${pp(pick.delta)})`,
          test: (r) => r.model === pick.a && (r.harness === pick.from || r.harness === pick.to),
        } : null,
      }
    },
  },
  {
    id: 'grader', short: 'Trust the oracle', needs: ['oracle'],
    q: () => 'Can I trust the oracle?',
    answer({ oracleData: o, row }) {
      if (!o) return null
      if (o.kappa == null || !o.rate_a || o.rate_a.rate == null || o.rate_b.rate == null) {
        return { unanswered: o.kappa_undefined_reason === 'no_eligible_pairs'
          ? `No run carries both a hidden and a strengthened grade (${int(o.n_excluded)} excluded), so the two oracles cannot be compared.`
          : `Agreement between the oracles is undefined here (${humanReason(o.kappa_undefined_reason)}).` }
      }
      const change = oracleChanges(o)
      const net = o.rate_b.rate - o.rate_a.rate
      return {
        verdict: graderVerdict(o, change),
        sentence: change
          ? [{ mark: `${(change.loss * 100).toFixed(1)} percentage points lost` }, ` and ${(change.gain * 100).toFixed(1)} gained under the strengthened oracle; net ${pp(change.net)} (κ ${fmt.fx(o.kappa)}).`]
          : ['The strengthened oracle changes the pass rate by ', { mark: pp(net) }, ` (κ ${fmt.fx(o.kappa)}); paired transition counts are unavailable.`],
        num: pp(net), numOf: 'net, hidden → strengthened', scope: pooledOf(row), numLabel: `net change · hidden ${pct(o.rate_a.rate)} → strengthened ${pct(o.rate_b.rate)} · n = ${int(o.n_eligible)}`,
        short: change ? `${(change.loss * 100).toFixed(1)} points lost, ${(change.gain * 100).toFixed(1)} gained; net ${pp(net)}` : `Net change ${pp(net)}`,
        fig: { kind: 'oracle', o },
        runs: { title: 'Runs the hidden oracle passed and the strengthened oracle failed', test: (r) => r.hid === true && r.str === false },
      }
    },
  },
  {
    id: 'repeats', short: 'Runs disagree', needs: ['runs', 'metrics'],
    q: (c) => `Where do runs of ${short(c.model)} under ${c.harness} disagree?`,
    answer({ runs, metrics, cond, oracle }) {
      if (!runs || !metrics) return null
      const rs = conditionRuns(runs, cond.model, cond.harness)
      if (!rs.length) return { unanswered: `No runs of ${short(cond.model)} under ${cond.harness} in this dataset.` }
      const strips = taskStrips(rs, oracle)
      const eligible = strips.filter((x) => x.known >= 2)
      if (!eligible.length) return { unanswered: `Run agreement needs at least two known grades for the same task under ${short(cond.model)} · ${cond.harness} (${oracle} oracle). No task qualifies among ${plural(rs.length, 'recorded run')}.` }
      const mixed = eligible.filter((x) => x.mixed).sort((a, b) => Math.abs(a.rate - 0.5) - Math.abs(b.rate - 0.5) || a.task.localeCompare(b.task))
      const top = mixed[0]
      const unknown = strips.reduce((sum, strip) => sum + strip.u, 0)
      return {
        sentence: top
          ? [`Runs disagree on `, { mark: `${int(mixed.length)} of ${int(eligible.length)} tasks` }, ` with at least two known grades; ${top.task} is closest to a coin flip — ${int(top.p)} of ${int(top.known)} graded runs pass the ${oracle} oracle.`]
          : ['No disagreement among known grades in ', { mark: `${eligible.length} eligible ${eligible.length === 1 ? 'task' : 'tasks'}` }, ` under ${short(cond.model)} · ${cond.harness} (${oracle} oracle).`],
        num: rate(mixed.length / eligible.length),
        numOf: `of ${plural(eligible.length, 'task')} flip`,
        numLabel: `flip rate · ${oracle} oracle · eligible tasks`, scope: cellOf(cond),
        short: top ? `${top.task} — ${int(top.p)} of ${int(top.known)} graded runs pass` : 'no graded task flips among eligible tasks',
        note: `${eligible.length} of ${strips.length} tasks have at least two known grades; ${strips.length - eligible.length} excluded. ${unknown} ungraded runs are unknown, not agreement or failure.`,
        fig: { kind: 'strips', strips },
        runs: { title: top ? `${top.task} under ${short(cond.model)} · ${cond.harness}, runs in order` : `Every run of ${short(cond.model)} · ${cond.harness}`, test: (r) => r.model === cond.model && r.harness === cond.harness && (!top || r.task === top.task) },
      }
    },
  },
  {
    id: 'outcomes', short: 'How runs fail', needs: ['outcomes'],
    q: () => 'How do runs fail?',
    answer({ outcomes, runs, cond, oracle, row }) {
      if (!outcomes) return null
      // under another oracle the failures are that oracle's, counted from the runs
      if (oracle && oracle !== 'hidden') return runs ? failuresUnder(runs, outcomes, cond, oracle, row) : null
      const counts = outcomes.counts || {}
      const fails = Object.entries(counts).filter(([k, v]) => isFailureMode(k) && v > 0).sort((a, b) => b[1] - a[1])
      const failures = fails.reduce((a, [, v]) => a + v, 0)
      const total = Object.values(counts).reduce((a, v) => a + v, 0)
      if (!failures) return { unanswered: `No run in this dataset failed the hidden oracle${counts.ungraded ? ` (${counts.ungraded} are ungraded, which is not failure)` : ''}.` }
      const [topMode, topN] = fails[0]
      const meta = (outcomes.byId && outcomes.byId[topMode]) || { label: topMode }
      const inCond = runs ? conditionRuns(runs, cond.model, cond.harness) : null
      const condCounts = {}
      if (inCond) for (const r of inCond) if (isFailureMode(r.mode)) condCounts[r.mode] = (condCounts[r.mode] || 0) + 1
      return {
        sentence: [{ mark: `${int(topN)} of ${int(failures)} failures` }, ` were ${MODE_PHRASE[topMode] || meta.label}.`],
        num: share(topN / failures), numOf: `of ${int(failures)} failures`, numLabel: `${meta.label} · ${int(failures)} failures of ${int(total)} runs · hidden oracle`, scope: pooledOf(row),
        short: `${int(topN)} of ${int(failures)} failures: ${meta.label}`,
        note: `${counts.ungraded ? `${int(counts.ungraded)} ungraded runs are unknown, not failures. ` : ''}Modes are read from each run's ledger by /api/outcomes; they describe how a run stopped, not why the task was hard.`,
        fig: { kind: 'modes', fails, failures, modes: outcomes.modes || [], condCounts, cond, condFailures: Object.values(condCounts).reduce((a, v) => a + v, 0) },
        runs: { title: `Runs whose failure mode is “${meta.label}”`, test: (r) => r.mode === topMode },
      }
    },
  },
  {
    id: 'leak', short: 'Leaks into the task', needs: ['integrity'],
    q: () => 'Is anything leaking into the task?',
    answer({ integrity, row }) {
      if (!integrity) return null
      const rows = (integrity.leakage || []).filter((x) => x.patch_issue_similarity != null)
      if (!rows.length) return { unanswered: 'Patch ↔ issue overlap is not recorded for these runs (imported trajectories carry no issue text to compare).' }
      const sorted = [...rows].sort((a, b) => b.patch_issue_similarity - a.patch_issue_similarity)
      const top = sorted[0], next = sorted[1]
      const probe = top.probe && top.probe !== 'none' ? top.probe.replace(/_/g, ' ') : null
      return {
        sentence: [probe ? 'Yes, on purpose: ' : 'Possibly: ', { mark: top.task }, ` patches echo the issue text at ${share(top.patch_issue_similarity)}${next ? ` (next highest ${share(next.patch_issue_similarity)})` : ''}${probe ? ` — it is the ${probe} probe` : ''}, and it scores ${pct(top.pass1)}.`],
        num: share(top.patch_issue_similarity), numOf: 'patch ↔ issue overlap', numLabel: `patch ↔ issue overlap · ${integrity.harness || 'harness'} runs`,
        scope: integrity.harness ? scopeWords({ kind: 'harness', harness: integrity.harness, models: row ? (row.models || []).length : 1 }) : pooledOf(row),
        of: integrity.harness ? { harness: integrity.harness, models: row ? (row.models || []).length : 1 } : undefined,
        short: `${top.task} echoes the issue at ${share(top.patch_issue_similarity)}`,
        fig: { kind: 'leak', rows: sorted },
        runs: { title: `${top.task} under ${integrity.harness || 'the integrity harness'}`, test: (r) => r.task === top.task && (!integrity.harness || r.harness === integrity.harness) },
      }
    },
  },
  {
    id: 'run', short: 'One run, exactly', needs: ['runs'],
    q: () => 'What did this specific run actually do?',
    answer({ runs, cond, oracle, outcomes }) {
      if (!runs) return null
      const rs = conditionRuns(runs, cond.model, cond.harness).sort((a, b) => a.task.localeCompare(b.task) || a.rep - b.rep)
      if (!rs.length) return { unanswered: `No runs of ${short(cond.model)} under ${cond.harness} in this dataset.` }
      const run = rs.find((r) => verdict(r, oracle) === false && r.hasLedger) || rs.find((r) => verdict(r, oracle) === false) || rs[0]
      const v = verdict(run, oracle)
      const vw = v === true ? 'passed' : v === false ? 'failed' : 'have no grade'
      const mode = v === false && isFailureMode(run.mode) && outcomes && outcomes.byId && outcomes.byId[run.mode]
      const c = callsOf(run)
      return {
        sentence: [{ mark: `Run ${sfx(run.id)}` }, ` (${run.task}${run.rep != null ? `, run ${run.rep + 1}` : ''}) made ${c.n == null ? 'an unrecorded number of model calls' : plural(c.n, c.unit)} and ${run.edits == null ? 'an unrecorded number of edits' : plural(run.edits, 'edit')}, then stopped with “${run.exit}”; the ${oracle} tests ${vw}${mode ? ` — ${mode.label}` : ''}.`],
        num: c.n == null ? '—' : String(c.n), numOf: `${c.unit}s`, numLabel: `${c.unit}s · exit ${run.exit}`, scope: `${cellOf(cond)} · one run`,
        short: `run ${sfx(run.id)}: ${c.n == null ? `${c.unit}s not recorded` : plural(c.n, c.unit)}, ${run.exit}`,
        fig: { kind: 'run', run },
        run,
        runs: { title: `${run.task} under ${short(cond.model)} · ${cond.harness}`, test: (r) => r.model === cond.model && r.harness === cond.harness && r.task === run.task },
      }
    },
  },
  {
    id: 'sentinel', short: 'Early warning', needs: ['sentinel'],
    q: () => 'Would an early warning have caught the bad submits?',
    answer({ sentinel, dir, row }) {
      if (!sentinel) return null
      const m = sentinelFor(sentinel, dir)
      if (!m) {
        const act = (sentinel.models || []).find((x) => x.name === sentinel.active)
        return { unanswered: `No sentinel model was trained on ${dir}${act ? `; the active model (${act.name}) was trained on ${(act.meta.sources || []).map(sourceDataset).join(', ')}` : ''}. Its scores would not describe these runs.` }
      }
      const thr = (sentinel.default_config && sentinel.default_config.threshold) ?? 0.5
      const op = operatingPoint(m, thr)
      if (!op) return { unanswered: `The ${m.name} model carries no operating points.` }
      const h = row && (row.harnesses.includes('baseline') ? 'baseline' : row.harnesses[0])
      return {
        sentence: [`At threshold ${fmt.fx(op.threshold)} the ${m.name} warning catches `, { mark: `${rate(op.recall)} of bad submits` }, `, blocks ${rate(op.false_alarm)} of good ones, ${fmt.fx(op.mean_lead_steps, 1)} steps ahead.`],
        num: rate(op.recall), numOf: 'of bad submits caught', numLabel: `bad submits caught · trained on ${int(m.meta.n_runs)} runs (${m.name})`, scope: scopeWords({ kind: 'trained', n: m.meta.n_runs }),
        short: `${rate(op.recall)} caught, ${rate(op.false_alarm)} of good blocked`,
        note: 'Replay measures detection on these recorded trajectories. A live intervention can change later actions; its effect on outcomes requires separate measurement.',
        fig: { kind: 'sentinel', model: m, threshold: thr },
        runs: h ? { title: `${h} runs that failed the hidden oracle`, test: (r) => r.harness === h && r.hid === false } : null,
      }
    },
  },
  {
    id: 'report', short: 'What I would report', needs: ['report', 'runs'],
    q: () => 'What would I report?',
    answer({ report, runs, cond }) {
      if (!report) return null
      const card = report.card
      if (!card || !card.outcome) return { unanswered: `The report card is not available for this dataset${report.error ? ` (the endpoint answered “${report.error}”)` : ''}.` }
      const h = card.cell && card.cell.harness && card.cell.harness.id
      const n = card.cell && card.cell.runs
      const own = runs && h ? runs.filter((r) => r.harness === h && r.model === card.cell.model).length : null
      const all = runs && h ? runs.filter((r) => r.harness === h).length : null
      const models = runs && h ? new Set(runs.filter((r) => r.harness === h).map((r) => r.model)).size : null
      const pooled = card.cell.pooled_models ?? (own != null && n != null && n > own && n === all)
      const o = card.outcome
      const scope = pooled ? `all ${models} models · ${h} (pooled)` : `${short(card.cell.model)} · ${h}`
      return {
        sentence: ['pass@1 ', { mark: pct(o.pass1) }, ` [${pct(o.ci95 && o.ci95[0])}, ${pct(o.ci95 && o.ci95[1])}] over ${int(n)} ${h} runs${pooled ? `, all ${models} models pooled` : ''}; pass^3 ${pct(o.pass_pow_k && o.pass_pow_k['3'])}${pooled ? ` (pooled over ${models} models)` : ''}, strengthened ${pct(o.pass1_strong)}.`],
        num: pct(o.pass1), numOf: `per-task pass@1 · ${int(n)} runs`, numLabel: `${scope} · n = ${int(n)}`,
        scope: pooled ? scopeWords({ kind: 'harness', harness: h, models }) : scopeWords({ kind: cond && cond.model === card.cell.model && cond.harness === h ? 'cell' : 'one-cell', model: card.cell.model, harness: h }),
        of: !h ? undefined : pooled ? { harness: h, models } : { model: card.cell.model, harness: h },
        short: `pass@1 ${pct(o.pass1)} over ${int(n)} ${h} runs${pooled ? ' (all models pooled)' : ''}`,
        note: pooled ? `This card pools ${int(n)} runs across ${models} models under ${h}; it is not a single-model estimate.` : null,
        fig: { kind: 'report', card, pooled, scope },
        runs: h ? { title: `Every ${h} run behind the report card`, test: (r) => r.harness === h } : null,
      }
    },
  },
  {
    id: 'next', short: 'What to run next', needs: ['runs'],
    q: () => 'What should I run next?',
    answer({ runs, row }) {
      if (!runs) return null
      const p = repeatsPlan(runs)
      if (!p) return { unanswered: 'This dataset has no runs.' }
      if (p.even) {
        return {
          sentence: [`Every model already has ${int(p.max)} runs per task; the next informative run is a `, { mark: 'new harness or model' }, ` at the same ${int(p.max)} runs per task.`],
          num: `${int(p.max)}×`, numOf: 'runs per task', numLabel: 'runs per task in every condition', scope: pooledOf(row), short: `every condition has ${int(p.max)} runs per task — add a variable`,
          fig: { kind: 'plan', p }, runs: null,
        }
      }
      return {
        sentence: ['More runs of ', { mark: short(p.low.m) }, `: it has ${p.low.reps} per task where the others reach ${p.max}, so its intervals are the widest.`],
        num: `${int(p.low.reps)} vs ${int(p.max)}`, numOf: 'runs per task', numLabel: 'runs per task (fewest vs most)', scope: pooledOf(row),
        short: `${short(p.low.m)} has ${int(p.low.reps)} runs per task vs ${int(p.max)}`,
        fig: { kind: 'plan', p },
        runs: { title: `Every recorded run of ${short(p.low.m)}`, test: (r) => r.model === p.low.m },
      }
    },
  },
]

export const QMAP = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]))
/** id -> { short } for chain labels and palette text without computing anything. */
export const QUESTION_META = Object.fromEntries(QUESTIONS.map((q) => [q.id, { short: q.short, q: q.q }]))

/** Run one question. Returns { state: 'loading'|'unanswered'|'answered', answer?, reason? }. */
export function answerQuestion(q, input, loading = {}) {
  const pending = q.needs.filter((n) => loading[n])
  let a
  try { a = q.answer(input) } catch (e) { return { state: 'unanswered', reason: `Could not compute: ${e.message}` } }
  if (a == null) {
    const failed = q.needs.filter((n) => loading[n] === 'error')
    if (failed.length) return { state: 'unanswered', reason: `Needs ${failed.join(', ')}, which did not load.` }
    return pending.length ? { state: 'loading' } : { state: 'unanswered', reason: 'The data this answer needs is not available.' }
  }
  if (a.unanswered) return { state: 'unanswered', reason: a.unanswered }
  return { state: 'answered', answer: a }
}
