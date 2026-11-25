/* Rig · views/start/lists.jsx — the lower half of Home: three ways to start, each with a small drawing from
   the Learn article that explains it (FigurePreview, the drawings of the Learn index's cards); the six newest datasets
   as cards with their models' colours, kind, one line, counts and pass rate; the closing band; the footer line. */
import { IS_STATIC } from '../../../api'
import { makeSpec } from '../../route'
import { fmt } from '../../data'
import { useRig } from '../../context'
import { Go, Icon, Wb } from '../../ui'
import { RateWithCI } from '../../RateWithCI'
import { EntityDot } from '../../EntityDot'
import { datasetName } from '../../datasetInfo'
import { HOME_VS, sortRows } from '../home-sort'
import { ARTICLES } from '../../learn/articles'
import { LEARN_HOME, glossarySpec } from '../../learn/routes'
import { canSee } from '../../learn/gate'
import { FigurePreview } from '../../learn/figures'
import { KindTag } from './hero'
import { sourceCount } from './model'

const { int, plural } = fmt
const SHOWN = 6
/** Model dots a dataset card shows before "+n". */
const DOTS = 8
const figure = (id) => ARTICLES.flatMap((a) => a.figures || []).find((f) => f.id === id) || null

export function StartCards({ dir }) {
  const cards = [
    dir && { el: 'start-runs', spec: makeSpec('tasks', dir), title: 'Look at runs', where: 'Tasks › all runs, step by step', body: 'Pick a task and see every run of it side by side, step by step.', icon: 'tasks', fig: 'a6-paths' },
    dir && { el: 'start-compare', spec: makeSpec('an', dir, 'delta'), title: 'Compare harnesses', where: 'Analysis › Comparison', body: 'Each harness against the baseline on the same tasks, with its 95% interval.', icon: 'chart', fig: 'a7-forest' },
    { el: 'start-make', spec: 'harnesses', title: 'Make a harness', where: 'Harnesses › One run', body: 'Choose a harness, a model and a task, and run it once; the mock model is free.', icon: 'sliders', fig: 'a10-wizard' },
  ].filter(Boolean)
  return (
    <section className="rg-start-blk" aria-labelledby="rg-start-cards-h">
      <p className="rg-start-kick">Where to start</p>
      <h2 id="rg-start-cards-h" className="rg-start-h2">Start here</h2>
      <div className="rg-start-cards" data-el="start-cards">{cards.map((c, i) => (
        <Go key={c.el} link spec={c.spec} className="rg-start-card" el={c.el} label={`${c.title}: ${c.body} ${c.where}`}>
          <span className="fig"><FigurePreview fig={figure(c.fig)} /></span>
          <span className="txt">
            <span className="top"><span className="no" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><Icon name={c.icon} size={16} /><b>{c.title}</b></span>
            <span className="body">{c.body}</span>
            <span className="where">{c.where}<Icon name="right" size={12} /></span>
          </span>
        </Go>
      ))}</div>
    </section>
  )
}

export function DatasetCards({ rows }) {
  const newest = sortRows(rows, HOME_VS.sort, HOME_VS.dir).slice(0, SHOWN)
  return (
    <section className="rg-start-blk" data-el="start-datasets" aria-labelledby="rg-start-ds-h">
      <p className="rg-start-kick">On this machine</p>
      <h2 id="rg-start-ds-h" className="rg-start-h2">Datasets <span className="n">newest first</span></h2>
      <ul className="rg-start-dl">{newest.map((r) => {
        const models = r.models || []
        return (
          <li key={r.name}><Go link spec={makeSpec('ds', r.name)} className="rg-start-ds" el="start-dataset" label={`Open ${datasetName(r)}${datasetName(r) !== r.name ? ` (${r.name})` : ''}`}>
            <span className="nm"><b><Wb>{datasetName(r)}</Wb></b><KindTag row={r} /></span>
            <span className="desc">{r.summary || 'No description yet'}</span>
            <span className="meta">
              <span className="dots" data-el="start-dataset-models">{models.slice(0, DOTS).map((m) => <EntityDot key={m} kind="model" name={m} />)}{models.length > DOTS && <span className="more">+{models.length - DOTS}</span>}</span>
              <span className="c">{plural(models.length, 'model')} · {int(r.runs)} {r.runs === 1 ? 'run' : 'runs'} · {plural((r.tasks || []).length, 'task')}</span>
            </span>
            <span className="rate">{r.pass_rate == null ? <span className="rg-mute">not graded</span> : <RateWithCI rate={r.pass_rate} ci={r.pass_ci95} n={r.graded} hint={false} />}</span>
          </Go></li>
        )
      })}</ul>
      <Go link spec="home" className="rg-tlink rg-start-all" el="start-all-datasets">All {plural(rows.length, 'dataset')} →</Go>
    </section>
  )
}

/** The closing band: what Learn holds, counted from the articles, and the way in. */
export function Closing() {
  const s = sourceCount(ARTICLES)
  return (
    <section className="rg-start-band rg-start-close" data-el="start-close" aria-labelledby="rg-start-close-h">
      <div className="rg-start-in">
        <p className="rg-start-kick" data-el="start-close-count">{ARTICLES.length} articles · {s.n} sources, {s.checked === s.n ? 'each checked' : `${s.checked} checked`}</p>
        <h2 id="rg-start-close-h" className="rg-start-big">Learn to <b>read a run</b>, step by step.</h2>
        <Go link spec={LEARN_HOME} className="rg-btn rg-start-go" el="start-close-learn">Open Learn<Icon name="arrowr" size={14} /></Go>
      </div>
    </section>
  )
}

export function Footer() {
  const { lab } = useRig()
  const links = [
    ['Learn', LEARN_HOME, 'start-foot-learn'],
    canSee('glossary', lab) && ['Glossary', glossarySpec(), 'start-foot-glossary'],
    ['Datasets', 'home', 'start-foot-datasets'],
  ].filter(Boolean)
  return (
    <footer className="rg-start-foot" data-el="start-foot">
      <div className="rg-start-in">
        <p className="rg-start-dots">
          <span>TraceHarness</span><span>{IS_STATIC ? 'Snapshot' : 'Local workspace'}</span>
          {links.map(([word, spec, el]) => <Go key={el} link spec={spec} className="rg-tlink" el={el}>{word}</Go>)}
        </p>
      </div>
    </footer>
  )
}
