/* ====================================================================================
   Rig · views/recommend.jsx — "Which benchmark?": one pick, one runner-up and one "not this",
   chosen by a visible rule table (traceharness/catalog/recommend_rules.json).

   A short form of the parameters, then GET /api/recommend. Three cards (Recommended, Runner-up,
   Not this), each with the dataset, the subset, the estimate and the reasons a person can check;
   a "Why these three" table straight from `considered` (every dataset, its score, the rules that
   fired); the sizing arithmetic; and "Copy method paragraph" / "Download JSON".

   The recommender reads the lab's own recorded runs, so in an export or the member console the
   view shows the "not available here" note (capability run.local) and asks for nothing.
   Everything the server sends is rendered as text, never as markup.
   ==================================================================================== */
import { useMemo, useState } from 'react'
import { can } from '../../environment'
import { Unavailable } from '../unavailable'
import { useApi } from '../data'
import { downloadText } from '../caseFile'
import { ErrorState, Loading, PageHeader, Seg, TableScroll, Tag, toast } from '../ui'
import './recommend.css'

const cx = (...a) => a.filter(Boolean).join(' ')
const CUTOFF = /^\d{4}-(0[1-9]|1[0-2])$/
const DEFAULTS = { goal: 'run', model: '', cutoff: '', budget: '', hours: '', languages: 'python', where: 'laptop', comparePublic: false, licenseRequired: false, detect: '10' }
const HUB = /^https:\/\/huggingface\.co\//

/** The form as a validated query string, or { error }. Empty optional fields are left out. */
export function buildQuery(f) {
  const q = new URLSearchParams()
  q.set('goal', f.goal)
  q.set('where', f.where)
  const langs = f.languages.split(',').map((s) => s.trim()).filter(Boolean)
  if (langs.length > 20 || langs.some((l) => l.length > 40)) return { error: 'Languages: up to 20 short names, separated by commas.' }
  if (langs.length) q.set('languages', langs.join(','))   // blank: not named, the server assumes python
  if (f.model.trim()) {
    if (f.model.trim().length > 200) return { error: 'Model: at most 200 characters.' }
    q.set('model', f.model.trim())
  }
  if (f.cutoff.trim()) {
    if (!CUTOFF.test(f.cutoff.trim())) return { error: 'Model cutoff: write it as YYYY-MM, for example 2026-03.' }
    q.set('model_cutoff', f.cutoff.trim())
  }
  for (const [key, field, label, min] of [['budget_usd', 'budget', 'Budget', 0], ['hours', 'hours', 'Hours', 0]]) {
    const raw = String(f[field]).trim()
    if (!raw) continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n < min || (field === 'hours' && n === 0)) return { error: `${label}: a ${field === 'hours' ? 'positive' : 'non-negative'} number.` }
    q.set(key, String(n))
  }
  const d = Number(f.detect)
  if (!String(f.detect).trim() || !Number.isFinite(d) || d <= 0 || d > 100) return { error: 'Difference to detect: a number of points above 0 and up to 100.' }
  q.set('detect_points', String(d))
  if (f.comparePublic) q.set('compare_public', 'true')
  if (f.licenseRequired) q.set('license_required', 'true')
  return { query: q.toString() }
}

const hoursText = (h) => (h == null ? 'unknown' : `${h.toFixed(2)} h`)
const usd = (x) => (x == null ? 'unknown' : `$${x.toFixed(2)}`)

/** The estimate is always an object { known, basis, cost_usd, hours, runs, text }. Unknown says why; it never shows a figure. */
function Estimate({ est }) {
  if (!est.known) {
    return <p className="rg-rec-est" data-el="rec-estimate" data-known="false">{est.basis === 'unknown' ? `Estimate unknown. ${est.text}` : est.text}</p>
  }
  return (
    <p className="rg-rec-est" data-el="rec-estimate" data-known="true">
      <b>{usd(est.cost_usd)}</b> and <b>{hoursText(est.hours)}</b> for both conditions, from {est.runs} recorded runs on this dataset.
      <span className="rg-rec-calc">{est.arithmetic}</span>
    </p>
  )
}

function Card({ label, tone, card, el }) {
  if (!card) {
    return (
      <section className={cx('rg-rec-card', tone)} data-el={el} aria-label={label}>
        <div className="rg-rec-kicker">{label}</div>
        <p className="rg-rec-none">None. {label === 'Recommended' ? 'No dataset in the catalog satisfies every requirement.' : 'No other dataset is left to name.'}</p>
      </section>
    )
  }
  const sub = card.subset
  return (
    <section className={cx('rg-rec-card', tone)} data-el={el} aria-label={`${label}: ${card.title}`}>
      <div className="rg-rec-kicker">{label}<span className="rg-rec-score">{card.excluded ? 'excluded' : `score ${card.score}`}</span></div>
      <h2 className="rg-rec-title">{card.title}</h2>
      <div className="rg-rec-id rg-mono">{card.id}{card.url && HUB.test(card.url) && <> · <a href={card.url} target="_blank" rel="noopener noreferrer">Hugging Face</a></>}</div>
      <p className="rg-rec-sub" data-el="rec-subset">
        Subset: <b>{sub.rows}</b> rows x <b>{sub.repeats}</b> repeat{sub.repeats === 1 ? '' : 's'}
        {sub.of_rows != null ? ` of ${sub.of_rows}` : ' (dataset size unknown)'}
        {sub.demoted && <> <Tag tone="amb">smaller than the sizing asks for</Tag></>}
      </p>
      <Estimate est={card.estimate} />
      {card.command && (
        <p className="rg-rec-import" data-el="rec-import">
          Import it: <code className="rg-mono rg-rec-cmd">{card.command}</code>
          {typeof card.sources_view === 'string' && card.sources_view.startsWith('#/rig/') && <> · <a href={card.sources_view}>Open the Sources view</a></>}
          {card.import_note && <span className="rg-rec-calc" data-el="rec-import-note">{card.import_note}</span>}
        </p>
      )}
      <h3 className="rg-rec-h">Reasons</h3>
      <ul className="rg-rec-reasons" data-el="rec-reasons">
        {card.reasons.length === 0 && <li className="rg-rec-why">No rule fired for this dataset.</li>}
        {card.reasons.map((r) => (
          <li key={r.rule} className="rg-rec-why">
            <span className={cx('rg-rec-w', r.weight > 0 ? 'pos' : r.weight < 0 ? 'neg' : 'zero')}>{r.weight > 0 ? `+${r.weight}` : r.weight}</span>
            <span><span className="rg-mono rg-rec-rule">{r.rule}</span> {r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Form({ value, onSubmit, error, busy }) {
  const [f, setF] = useState(value)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  return (
    <form className="rg-rec-form" data-el="rec-form" onSubmit={(e) => { e.preventDefault(); onSubmit(f) }} aria-label="Benchmark requirements">
      <div className="rg-field rg-rec-goal">
        <span className="rg-field-l">Goal</span>
        <Seg label="Goal" value={f.goal} onChange={(v) => setF((s) => ({ ...s, goal: v }))}
          options={[['run', 'Run tasks (what to run)'], ['analyse', 'Analyse recorded runs (what to analyse)']]} />
      </div>
      <label className="rg-field"><span className="rg-field-l">Model (optional)</span>
        <input className="rg-inp" value={f.model} onChange={set('model')} spellCheck={false} autoComplete="off" placeholder="e.g. openai/gpt-5.6-luna" /></label>
      <label className="rg-field"><span className="rg-field-l">Model cutoff (YYYY-MM)</span>
        <input className="rg-inp" value={f.cutoff} onChange={set('cutoff')} spellCheck={false} autoComplete="off" placeholder="e.g. 2026-03" /></label>
      <label className="rg-field"><span className="rg-field-l">Budget (US dollars)</span>
        <input className="rg-inp" inputMode="decimal" value={f.budget} onChange={set('budget')} placeholder="e.g. 50" /></label>
      <label className="rg-field"><span className="rg-field-l">Hours available</span>
        <input className="rg-inp" inputMode="decimal" value={f.hours} onChange={set('hours')} placeholder="e.g. 4" /></label>
      <label className="rg-field"><span className="rg-field-l">Languages (comma separated)</span>
        <input className="rg-inp" value={f.languages} onChange={set('languages')} spellCheck={false} placeholder="python" /></label>
      <label className="rg-field"><span className="rg-field-l">Where it runs</span>
        <select className="rg-selc" value={f.where} onChange={set('where')}><option value="laptop">Laptop</option><option value="runner">Runner</option></select></label>
      <label className="rg-field"><span className="rg-field-l">Difference to detect (points)</span>
        <input className="rg-inp" inputMode="decimal" value={f.detect} onChange={set('detect')} /></label>
      <div className="rg-rec-checks">
        <label className="rg-rec-check"><input type="checkbox" checked={f.comparePublic} onChange={set('comparePublic')} /> Compare with public results</label>
        <label className="rg-rec-check"><input type="checkbox" checked={f.licenseRequired} onChange={set('licenseRequired')} /> Require a stated license</label>
      </div>
      <div className="rg-rec-go">
        <button type="submit" className="rg-btn pri" disabled={busy}>Recommend</button>
        {error && <span className="rg-field-e" role="alert" data-el="rec-form-error">{error}</span>}
      </div>
    </form>
  )
}

function Table({ result }) {
  const calls = { [result.pick && result.pick.id]: 'Recommended', [result.runner_up && result.runner_up.id]: 'Runner-up', [result.not_this && result.not_this.id]: 'Not this' }
  return (
    <section className="rg-rec-sec" data-el="rec-table">
      <h2 className="rg-rec-h2">Why these three</h2>
      <p className="rg-rec-lead">Every dataset in the catalog, best first. A rule marked as excluding removes a dataset from the pick; the others add or subtract their points.</p>
      <TableScroll label="Every dataset considered">
        <table className="rg-tbl">
          <thead><tr><th>Dataset</th><th>Call</th><th>Kind</th><th className="rg-num">Score</th><th>Rules that fired</th></tr></thead>
          <tbody>
            {result.considered.map((c) => (
              <tr key={c.id} className={cx(c.excluded && 'rg-rec-ex')}>
                <td><b>{c.title}</b><div className="rg-mono rg-rec-sm">{c.id}</div></td>
                <td>{calls[c.id] || ''}</td>
                <td>{c.kind}</td>
                <td className="rg-num">{c.excluded ? 'excluded' : c.score}</td>
                <td>{c.rules.length === 0 ? <span className="rg-rec-sm">none</span> : c.rules.map((r) => (
                  <span key={r.rule} className={cx('rg-rec-chip', r.weight > 0 ? 'pos' : r.weight < 0 ? 'neg' : 'zero')} title={r.text}>{r.rule} {r.weight > 0 ? `+${r.weight}` : r.weight}</span>))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </section>
  )
}

function Result({ data }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.method); toast('Method paragraph copied') } catch { toast('Copy failed: select the text instead') }
  }
  const adv = data.size_advice
  return (
    <>
      <div className="rg-rec-cards" data-el="rec-cards">
        <Card label="Recommended" tone="pick" card={data.pick} el="rec-pick" />
        <Card label="Runner-up" tone="second" card={data.runner_up} el="rec-runner-up" />
        <Card label="Not this" tone="not" card={data.not_this} el="rec-not-this" />
      </div>
      <section className="rg-rec-sec" data-el="rec-sizing">
        <h2 className="rg-rec-h2">Sizing</h2>
        <p className="rg-rec-lead">To detect {adv.detect_points} points between two conditions: <b>{adv.tasks}</b> tasks x <b>{adv.repeats}</b> repeat{adv.repeats === 1 ? '' : 's'}.</p>
        <p className="rg-rec-calc rg-mono">{adv.arithmetic}</p>
        <p className="rg-rec-sm">Baseline {adv.baseline_pass_rate.toFixed(2)}: {adv.baseline_basis}. Repeats: {adv.repeats_reason}.</p>
      </section>
      <Table result={data} />
      <section className="rg-rec-sec" data-el="rec-method">
        <div className="rg-rec-bar"><h2 className="rg-rec-h2">Method paragraph</h2>
          <div className="rg-cluster">
            <button type="button" className="rg-btn" onClick={copy}>Copy method paragraph</button>
            <button type="button" className="rg-btn" onClick={() => downloadText('benchmark-recommendation.json', JSON.stringify(data, null, 2), 'application/json')}>Download JSON</button>
          </div>
        </div>
        <p className="rg-rec-method" data-el="rec-method-text">{data.method}</p>
        <p className="rg-rec-sm">Rules version {data.rules_version}; catalog refreshed {data.catalog_refreshed || 'unknown'}. Every sentence above comes from a rule that fired.</p>
      </section>
    </>
  )
}

function Recommend() {
  const [form, setForm] = useState(DEFAULTS)
  const initial = useMemo(() => buildQuery(DEFAULTS).query, [])
  const [query, setQuery] = useState(initial)
  const [error, setError] = useState('')
  const res = useApi(can('run.local') ? `/recommend?${query}` : null)
  const submit = (f) => {
    const q = buildQuery(f)
    if (q.error) { setError(q.error); return }
    setError(''); setForm(f); setQuery(q.query)
  }
  return (
    <div className="rg-dpad rg-rec" data-el="recommend">
      <PageHeader eyebrow="Tools" title="Which benchmark?"
        lede="One pick, one runner-up and one to avoid, chosen by a visible rule table from the Hugging Face catalog and this lab's own recorded runs." />
      <Unavailable capability="run.local" what="The benchmark recommender" />
      {can('run.local') && (
        <>
          <Form value={form} onSubmit={submit} error={error} busy={res.loading} />
          {res.loading && !res.data && <Loading label="Choosing…" />}
          {res.error && <ErrorState error={res.error} onRetry={res.reload} what="The recommendation" />}
          {res.data && <Result data={res.data} />}
        </>
      )}
    </div>
  )
}

export const views = {
  recommend: { tag: 'rec', title: () => 'Which benchmark?', render: Recommend, crumbs: () => [['which benchmark?']], outsideGuided: () => true,
    palette: () => [{ title: 'Which benchmark?', detail: 'a pick, a runner-up and a "not this" from a visible rule table', spec: 'recommend', keywords: 'recommend choose benchmark dataset swe-bench' }] },
}
