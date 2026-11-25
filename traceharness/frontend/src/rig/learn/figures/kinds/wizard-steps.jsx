/* Rig · learn/figures/kinds/wizard-steps.jsx — six answers build the harness (article 10, figure 1).
   The six questions of Minimal harness, one at a time (QUESTIONS and blocksFromAnswers are the page's own, from
   views/shallow-data.js), beside the harness card they build: a row fills in as its question is answered. Play
   answers the questions still open with the recommended answer, once, and ends on the review, which names the cell
   the page would save (computed by traceharness.shallow.wizard for every combination, in the data file). For the
   step cap, recorded runs of study_v04 show what 20 against 6 steps did. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { useReveal } from '../../motion'
import { QUESTIONS, RECOMMENDED_ANSWERS, blocksFromAnswers } from '../../../views/shallow-data.js'
import { Pick, StepControls, cx, int, useSteps } from './b-parts'

const REVIEW = QUESTIONS.length
const ALWAYS = 'network, privilege escalation, secret access, leaving the workspace'
const optionWords = (q, v) => (q.options.find(([o]) => o === v) || [])[1] || v

/** The card's rows, one per question: [question id, name, what the answer sets]. */
function rows(answers) {
  const b = Object.fromEntries(blocksFromAnswers({ ...RECOMMENDED_ANSWERS, ...answers }).map((x) => [x.type, x]))
  return [
    ['touch', 'Tools', b.tools.names],
    ['dangerous', 'Permission', b.policy.mode],
    ['verify', 'Prompt', answers.verify === 'no' ? 'no verify sentence' : 'asks the agent to verify before submit'],
    ['history', 'History', b.context.window ? `the last ${b.context.window} observations` : 'full history'],
    ['stop', 'Step cap', `${b.stop.max_steps} steps`],
    ['mcp', 'MCP', 'none: no outside tools'],
  ]
}

function Card({ answers, at }) {
  return (
    <div className="rg-gh-wcard" data-el="fig-wizard-card">
      <p className="rg-gh-hk"><b>Your configuration</b><span>{Object.keys(answers).length} of {QUESTIONS.length} answered</span></p>
      <dl>
        {rows(answers).map(([id, name, v], i) => {
          const done = id in answers
          return (
            <div key={id} data-row={id} className={cx('rg-gh-wrow', done ? 'done' : 'todo', i === at && 'now')}>
              <dt>{name}</dt>
              <dd key={done ? String(v) : 'todo'}>{!done ? '—' : Array.isArray(v) ? <span className="rg-gh-chips">{v.map((t) => <i key={t}>{t}</i>)}</span> : v}</dd>
            </div>
          )
        })}
        <div className="rg-gh-wrow rg-gh-wfix"><dt>Temperature</dt><dd>0</dd></div>
        <div className="rg-gh-wrow rg-gh-wfix"><dt>Always blocked</dt><dd>{ALWAYS}</dd></div>
      </dl>
    </div>
  )
}

/** What recorded runs did with a step cap like the one answered. */
function Evidence({ stop, cap }) {
  if (!stop) return null
  const [g, l] = cap
  const say = {
    steps_6: <>In study_v04, <code>tight_budget</code> cut <code>max_steps</code> from 20 to 6: {g.model} passed <b>{g.tight_budget.pass} of {g.tight_budget.runs}</b> against {g.baseline.pass} of {g.baseline.runs}, and runs cut at the limit went from {g.baseline.max_steps} to {g.tight_budget.max_steps}. {l.model} passed {l.tight_budget.pass} against {l.baseline.pass}.</>,
    steps_20: <>20 steps is study_v04's <code>baseline</code>: {g.model} passed {g.baseline.pass} of {g.baseline.runs} with {int(g.baseline.mean_tokens)} tokens a run, {l.model} {l.baseline.pass} with {int(l.baseline.mean_tokens)}.</>,
    steps_12: <>study_v04 ran 20 steps (<code>baseline</code>) and 6 (<code>tight_budget</code>), not 12: {g.model} passed {g.baseline.pass} and {g.tight_budget.pass} of {g.baseline.runs}.</>,
  }[stop]
  return <p className="rg-gh-evidence" data-el="fig-cap-evidence"><b>In recorded runs</b> {say}</p>
}

function Cell({ d, answers }) {
  const filled = { ...RECOMMENDED_ANSWERS, ...answers }
  const c = d.ids[d.order.map((k) => filled[k]).join('|')]
  const rec = d.ids[d.order.map((k) => RECOMMENDED_ANSWERS[k]).join('|')]
  const open = QUESTIONS.filter((q) => !(q.id in answers)).length
  return (
    <div className="rg-gh-cell" data-el="fig-cell">
      <p><span>Cell</span> <code>{c.id}</code></p>
      <p className="rg-gh-dsub">{c.id === rec.id ? 'Matches the recommended cell.' : 'Differs from the recommended cell.'}{open ? ` ${open} unanswered ${open === 1 ? 'question takes' : 'questions take'} the recommended answer.` : ''} Saving it runs no model.</p>
      {c.warnings.map((x) => <p key={x} className="rg-gh-warn">{x}</p>)}
    </div>
  )
}

function WizardSteps({ fig, n, d }) {
  const reveal = useReveal()
  const [answers, setAnswers] = useState({})
  const answer = (id, v) => setAnswers((a) => ({ ...a, [id]: v }))
  const [s, act] = useSteps(REVIEW + 1, reveal, { onTick: (at) => { const q = QUESTIONS[at]; if (q) setAnswers((a) => (q.id in a ? a : { ...a, [q.id]: q.recommended })) } })
  const q = QUESTIONS[s.at]
  const chart = (
    <div className="rg-gh-wiz">
      <ol className="rg-gh-wnav" aria-label={`Figure ${n}: questions`}>
        {[...QUESTIONS, { id: 'review', prompt: 'Review' }].map((x, i) => {
          const here = i === s.at
          return (
            <li key={x.id}><button type="button" className={cx('rg-gh-wdot', here && 'on', x.id in answers && 'done')} aria-current={here ? 'step' : undefined} aria-disabled={here || undefined}
              data-hint={here ? `${x.prompt} · shown` : x.prompt} onClick={() => { if (!here) act({ type: 'go', at: i }) }}>{i < REVIEW ? String(i + 1).padStart(2, '0') : '✓'}</button></li>
          )
        })}
      </ol>
      {q ? (
        <div className="rg-gh-q" key={q.id}>
          <p className="rg-gh-k">Question {s.at + 1} of {QUESTIONS.length}</p>
          <p className="rg-gh-qp">{q.prompt}</p>
          <Pick label={q.prompt} el="fig-answers" className="rg-gh-opts" value={answers[q.id]} onPick={(v) => { answer(q.id, v); act({ type: 'next' }) }}
            options={q.options.map(([v, words]) => [v, <>{words}{v === q.recommended && <small> Recommended</small>}</>, `Answer: ${words}`, words])} />
        </div>
      ) : (
        <div className="rg-gh-q" key="review"><p className="rg-gh-k">Review configuration</p><Cell d={d} answers={answers} /></div>
      )}
      <Evidence stop={answers.stop} cap={d.step_cap} />
    </div>
  )
  const filled = { ...RECOMMENDED_ANSWERS, ...answers }
  return (
    <FigureCard fig={fig} n={n} reveal={reveal} chart={chart} aside={<Card answers={answers} at={s.at} />}
      controls={<StepControls s={s} act={act} pos={q ? `Question ${s.at + 1} of ${QUESTIONS.length}` : 'Review'} nextWords="Next question" playWords="Play the recommended answers" />}
      readout={q ? `Question ${s.at + 1}: ${q.prompt} ${q.id in answers ? `Answered: ${optionWords(q, answers[q.id])}` : `Recommended: ${optionWords(q, q.recommended)}`}`
        : `Review: ${rows(filled).map(([, name, v]) => `${name.toLowerCase()} ${Array.isArray(v) ? v.join(', ') : v}`).join('; ')}; temperature 0.`}
      table={<FigTable caption={`Figure ${n} as a table`} cols={['Question', 'Your answer', 'Recommended', 'What it sets']}
        rows={QUESTIONS.map((x, i) => [x.prompt, x.id in answers ? optionWords(x, answers[x.id]) : 'not answered', optionWords(x, x.recommended), [].concat(rows(filled)[i][2]).join(', ')])} />} />
  )
}

function Preview() {
  return (
    <g className="rg-prev-ink">
      {[0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={14 + i * 9} cy="10" r="3" className={i < 4 ? 'acc' : ''} />)}
      {[0, 1, 2, 3].map((i) => <rect key={i} x="66" y={6 + i * 11} width="44" height="7" rx="1.5" className={i < 3 ? 'acc' : ''} />)}
      {[0, 1, 2].map((i) => <rect key={i} x="10" y={22 + i * 10} width="46" height="6" rx="1.5" />)}
    </g>
  )
}

export function headlines(d) {
  const rec = d.ids[d.order.map((k) => RECOMMENDED_ANSWERS[k]).join('|')]
  const out = { rec_id: rec.id }
  d.step_cap.forEach((c, i) => {
    out[`pass_base_${i}`] = `${c.baseline.pass} of ${c.baseline.runs}`
    out[`pass_tight_${i}`] = `${c.tight_budget.pass} of ${c.tight_budget.runs}`
    out[`cut_${i}`] = `${c.baseline.max_steps} to ${c.tight_budget.max_steps}`
  })
  return out
}

export const KINDS = { wizard_steps: { Figure: WizardSteps, Preview, headlines } }
