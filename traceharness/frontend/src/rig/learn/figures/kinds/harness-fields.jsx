/* Rig · learn/figures/kinds/harness-fields.jsx — one harness, field by field (article 09, figure 1).
   Every field of a harness as study_v04 recorded it (the run's invoke_agent span), drawn as a frame around the
   model, which is the one part not in it. Each tab is a harness; the field that differs from baseline is marked
   with its baseline value. Under the card: what the harness did for the two named models, passing runs of 120 and
   mean tokens a run, each against baseline. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { useReveal } from '../../motion'
import { Snake, cx, int } from './b-parts'

const show = (k, v) => {
  if (k === 'context_window') return v ? `last ${v} tool outputs kept` : 'full history'
  if (k === 'no_action_retries') return v ? `nudge, at most ${v} times` : 'the run ends'
  if (k === 'include_file_listing') return v ? 'yes' : 'no'
  if (k === 'policy') return v
  if (typeof v === 'number') return int(v)
  return String(v)
}
/** [field, what it is, side]: the article's list, in its order; side puts it left or right of the model. */
const FIELDS = [
  ['tools', 'which tools exist', 'l'], ['policy', 'what they may do', 'r'],
  ['context_window', 'how much conversation is kept', 'l'], ['observation_chars', 'characters kept of a tool output', 'l'],
  ['max_steps', 'model calls a run may make', 'r'], ['max_total_tokens', 'tokens a run may use', 'r'], ['max_tokens_per_call', 'tokens one reply may use', 'r'],
  ['no_action_retries', 'when a reply calls no tool', 'l'], ['temperature', 'chance in each word picked', 'r'], ['include_file_listing', 'file list in the first message', 'l'],
]
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const changedFields = (h, base) => ['system_prompt', ...FIELDS.map(([k]) => k)].filter((k) => !same(h.recorded[k], base.recorded[k]))

/** "tight_budget differs from baseline in one field: max_steps 20 → 6. Hash 89927e6aab4b." */
export function sayHarness(h, base) {
  if (h.id === base.id) return `${h.id}: the harness the others are compared with. Hash ${h.hash}.`
  const ch = changedFields(h, base)
  const what = ch.map((k) => `${k} ${show(k, base.recorded[k])} → ${show(k, h.recorded[k])}`).join('; ')
  return `${h.id} differs from baseline in ${ch.length === 1 ? 'one field' : `${ch.length} fields`}: ${what}. Hash ${h.hash}.`
}

function Field({ k, what, h, base, i }) {
  const v = h.recorded[k]
  const changed = !same(v, base.recorded[k])
  return (
    <li className={cx('rg-gh-field', changed && 'changed')} data-field={k} style={{ '--rig-fig-i': i }}>
      <code><Snake name={k} /></code>
      {k === 'tools' ? <span className="rg-gh-chips">{v.map((t) => <i key={t}>{t}</i>)}</span> : <b>{show(k, v)}</b>}
      <small>{what}{changed && <> · baseline: {show(k, base.recorded[k])}</>}</small>
    </li>
  )
}

function Card({ h, base }) {
  const side = (s) => FIELDS.map((f, i) => [...f, i]).filter((f) => f[2] === s)
  const prompt = h.recorded.system_prompt
  const pChanged = !same(prompt, base.recorded.system_prompt)
  return (
    <div className="rg-gh-harness" aria-label={`The harness ${h.id}, field by field`}>
      <p className="rg-gh-hk"><b>harness · {h.id}</b><span>hash {h.hash}</span></p>
      <div className={cx('rg-gh-field', 'prompt', pChanged && 'changed')} data-field="system_prompt">
        <code>system_prompt</code><q>{prompt.split('\n')[0]}</q><small>{prompt.length} characters, {prompt.split('\n').length} lines</small>
      </div>
      <div className="rg-gh-hgrid">
        <ul className="l">{side('l').map(([k, what, , i]) => <Field key={`${h.id}-${k}`} k={k} what={what} h={h} base={base} i={i} />)}</ul>
        <div className="rg-gh-model"><b>the model</b><span>not part of the harness: the same model runs under every tab</span></div>
        <ul className="r">{side('r').map(([k, what, , i]) => <Field key={`${h.id}-${k}`} k={k} what={what} h={h} base={base} i={i} />)}</ul>
      </div>
    </div>
  )
}

function Results({ h, base, top }) {
  return (
    <div className="rg-gh-results" data-el="fig-harness-results">
      {Object.entries(h.models).map(([m, c]) => {
        const b = base.models[m]
        return (
          <div key={m} className="rg-gh-res">
            <code>{m}</code>
            <span className="row"><span className="k">passed</span><span className="track"><i style={{ '--gh-w': c.pass / c.runs }} /><em style={{ '--gh-x': b.pass / b.runs }} /></span>
              <span className="v">{c.pass} of {c.runs}{h.id !== base.id && <small> · baseline {b.pass}</small>}</span></span>
            <span className="row"><span className="k">tokens a run</span><span className="track tok"><i style={{ '--gh-w': c.mean_tokens / top }} /><em style={{ '--gh-x': b.mean_tokens / top }} /></span>
              <span className="v">{int(c.mean_tokens)}{h.id !== base.id && <small> · baseline {int(b.mean_tokens)}</small>}</span></span>
          </div>
        )
      })}
    </div>
  )
}

function HarnessFields({ fig, n, d }) {
  const reveal = useReveal()
  const [tab, setTab] = useState(d.harnesses[0].id)
  const base = d.harnesses[0]
  const h = d.harnesses.find((x) => x.id === tab)
  const top = Math.max(...d.harnesses.flatMap((x) => Object.values(x.models).map((c) => c.mean_tokens)))
  const models = Object.keys(base.models)
  const table = (
    <>
      <FigTable caption={`Figure ${n}: the fields of each harness`} cols={['Field', ...d.harnesses.map((x) => x.id)]}
        rows={[['system_prompt', ...d.harnesses.map((x) => `${x.recorded.system_prompt.length} characters`)], ...FIELDS.map(([k]) => [k, ...d.harnesses.map((x) => (k === 'tools' ? x.recorded.tools.join(', ') : show(k, x.recorded[k])))]),
          ['hash', ...d.harnesses.map((x) => x.hash)]]} />
      <FigTable caption={`Figure ${n}: passes and tokens`} cols={['Harness', ...models.flatMap((m) => [`${m} passed`, `${m} tokens a run`])]}
        rows={d.harnesses.map((x) => [x.id, ...models.flatMap((m) => [`${x.models[m].pass} of ${x.models[m].runs}`, int(x.models[m].mean_tokens)])])} />
    </>
  )
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} table={table} readout={sayHarness(h, base)}
      tabs={d.harnesses.map((x) => [x.id, x.id])} tab={tab} onTab={setTab}
      legend={[{ label: 'differs from baseline', tone: 'gh-changed' }, { label: 'this harness', tone: 'in' }, { label: 'baseline, for comparison', tone: 'gh-tick' }]}
      chart={<div className={cx('rg-gh-hwrap', reveal.seen && 'seen')}><Card h={h} base={base} /><Results h={h} base={base} top={top} /></div>} />
  )
}

function Preview() {
  return (
    <g className="rg-prev-ink">
      <rect x="10" y="6" width="100" height="8" rx="2" />
      {[0, 1, 2].map((r) => <g key={r}><rect x="10" y={18 + r * 11} width="34" height="7" rx="1.5" className={r === 1 ? 'acc' : ''} /><rect x="76" y={18 + r * 11} width="34" height="7" rx="1.5" /></g>)}
      <rect x="49" y="18" width="22" height="29" rx="3" className="acc" />
    </g>
  )
}

export function headlines(d) {
  const out = {}
  for (const h of d.harnesses) {
    out[`hash_${h.id}`] = h.hash
    Object.values(h.models).forEach((c, i) => { out[`pass_${h.id}_${i}`] = String(c.pass); out[`tokens_${h.id}_${i}`] = int(c.mean_tokens) })
  }
  return out
}

export const KINDS = { harness_fields: { Figure: HarnessFields, Preview, headlines } }
