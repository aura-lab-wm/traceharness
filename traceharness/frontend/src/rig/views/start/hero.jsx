/* Rig · views/start/hero.jsx — Home's hero band: the page's name as a small label, the line that says what
   TraceHarness shows, what it is for, the counts on this machine as one line of links, the two ways in (Datasets, Learn),
   the search with three questions, and beside them the facts of the dataset in focus. The band draws with the dark
   token set (start.css .rg-start-band). Every figure is the dataset library's own (/api/overview). */
import { IS_STATIC } from '../../../api'
import { makeSpec } from '../../route'
import { fmt, short } from '../../data'
import { useRig } from '../../context'
import { Go, Icon, Kbd, MOD, NumberChips, PageHelp } from '../../ui'
import { RateWithCI } from '../../RateWithCI'
import { EntityName } from '../../EntityDot'
import { KINDS, datasetName } from '../../datasetInfo'
import { QUESTIONS } from '../../answers'
import { LEARN_HOME, articleSpec } from '../../learn/routes'
import { canSee } from '../../learn/gate'

const { int, plural } = fmt
/** The three questions under the search, in this order. */
const ASK = ['outcomes', 'grader', 'variable']
/** The article the headline's accent word opens. */
const WASTE = 'phases-and-wasted-work'
/** Names a fact shows before "+ n more". */
const NAMED = 3

export function KindTag({ row }) {
  const k = KINDS[row.origin] || KINDS.recorded
  return <span className="rg-tag dash rg-home-kind" data-el="dataset-kind" data-kind={row.origin}><span className={`rg-kdot rg-kdot-${k.dot}`} aria-hidden="true" />{k.short}</span>
}

function Search({ dir, row }) {
  const { setPalette } = useRig()
  const qs = ASK.map((id) => QUESTIONS.find((q) => q.id === id)).filter(Boolean)
  return (
    <section className="rg-start-find" aria-label="Search">
      <button type="button" className="rg-start-search" data-el="start-search" aria-haspopup="dialog" aria-label="Search runs, tasks, models and pages (opens the command palette)"
        onClick={() => setPalette(true)}>
        <Icon name="search" size={16} /><span className="rg-start-ph">Search runs, tasks, models…</span><Kbd>{MOD === '⌘' ? '⌘K' : 'Ctrl K'}</Kbd>
      </button>
      {dir && (
        <p className="rg-start-qs" data-el="start-questions">
          <span className="lbl">Ask {datasetName(row) || dir}:</span>
          {qs.map((q, i) => <span key={q.id} className="q"><Go link spec={makeSpec('q', dir, q.id)} className="rg-tlink">{q.q()}</Go>{i < qs.length - 1 && <span className="sep" aria-hidden="true">·</span>}</span>)}
        </p>
      )}
    </section>
  )
}

/** A few names with their marks, then "+ n more"; the words a screen reader hears are the count and the names. */
function Names({ kind, list }) {
  const shown = list.slice(0, NAMED)
  return (
    <span className="rg-start-names">
      {shown.map((m, i) => <span key={m} className="nm">{i > 0 && <span className="sr-only">, </span>}<EntityName kind={kind} id={m} name={short(m)} /></span>)}
      {list.length > NAMED && <span className="more">+ {list.length - NAMED} more</span>}
    </span>
  )
}

/** The facts of the dataset in focus, each a link to the page that holds it. */
function Facts({ dir, row }) {
  const models = row.models || [], harnesses = row.harnesses || [], tasks = row.tasks || []
  const graded = row.pass_rate != null
  return (
    <aside className="rg-start-facts" data-el="start-facts" aria-label={`The dataset in focus: ${datasetName(row)}`}>
      <p className="rg-start-kick" aria-hidden="true">In focus</p>
      <dl>
        <div><dt>Dataset</dt><dd><Go link spec={makeSpec('ds', dir)} className="rg-tlink rg-start-fv" el="start-fact-dataset">{datasetName(row)}</Go> <KindTag row={row} /></dd></div>
        <div><dt>Models</dt><dd><Go link spec={makeSpec('an', dir, 'family')} className="rg-start-fl" el="start-fact-models" tip="Every model under every harness: Family matrix"
          label={`${plural(models.length, 'model')}: ${models.map(short).join(', ')}. Opens the Family matrix`}><b>{models.length}</b><Names kind="model" list={models} /></Go></dd></div>
        <div><dt>Harnesses</dt><dd><Go link spec={makeSpec('an', dir, 'delta')} className="rg-start-fl" el="start-fact-harnesses" tip="Each harness against the baseline: Comparison"
          label={`${plural(harnesses.length, 'harness', 'harnesses')}: ${harnesses.join(', ')}. Opens Comparison`}><b>{harnesses.length}</b><Names kind="harness" list={harnesses} /></Go></dd></div>
        <div><dt>Tasks · runs</dt><dd><Go link spec={makeSpec('tasks', dir)} className="rg-tlink" el="start-fact-tasks">{plural(tasks.length, 'task')}</Go>
          <span className="sep" aria-hidden="true"> · </span><Go link spec={makeSpec('field', dir)} className="rg-tlink" el="start-fact-runs">{int(row.runs || 0)} {row.runs === 1 ? 'run' : 'runs'}</Go></dd></div>
        <div><dt>Pass rate</dt><dd>{graded ? <RateWithCI rate={row.pass_rate} ci={row.pass_ci95} n={row.graded} /> : <span className="rg-mute">not graded</span>}</dd></div>
        <div><dt>Graded by</dt><dd>{graded
          ? <Go link spec={makeSpec('q', dir, 'grader')} className="rg-tlink" el="start-fact-grader" tip="Can I trust the oracle?">the hidden oracle</Go>
          : <span className="rg-mute">no grade recorded</span>}</dd></div>
      </dl>
    </aside>
  )
}

/** The hero: a headline with one bold word and one accent word, then the ways in. */
export function Hero({ counts, dir, row }) {
  const { lab } = useRig()
  return (
    <section className="rg-start-band rg-start-hero" aria-labelledby="rg-start-title">
      <div className={`rg-start-in rg-start-herog${row ? '' : ' solo'}`}>
        <header className="rg-start-head" data-el="start-head" data-tour="page-header">
          <div className="rg-start-pills">
            <div className="rg-start-pill"><span className="rg-mark-dot" aria-hidden="true">●</span><h1 id="rg-start-title">Home</h1></div>
            <span className="rg-start-pill dim">{IS_STATIC ? 'Snapshot' : 'Local workspace'}</span>
          </div>
          <p className="rg-start-hl" data-el="start-headline">See <b>what</b> your coding agent did, and where it {canSee('articles', lab)
            ? <Go link spec={articleSpec(WASTE)} className="rg-start-acc" el="start-headline-learn" tip="Read: Phases and wasted work">wasted</Go>
            : <em>wasted</em>} effort.</p>
          <p className="rg-start-lede" data-el="start-what">TraceHarness is for measuring coding agents: read what each run did, compare harnesses fairly, and try a harness of your own.</p>
          <NumberChips el="start-numbers" label="On this machine" className="rg-start-meta" items={counts.map((c) => ({ n: int(c.n), word: c.word, spec: c.spec, hint: c.hint }))}
            tail={IS_STATIC ? 'in this snapshot' : 'on this machine'} />
          <div className="rg-start-acts">
            <Go link spec="home" className="rg-btn rg-start-go" el="start-open-dataset">Open a dataset<Icon name="arrowr" size={14} /></Go>
            <Go link spec={LEARN_HOME} className="rg-btn rg-start-out" el="start-open-learn">Learn</Go>
            <PageHelp />
          </div>
          <Search dir={dir} row={row} />
        </header>
        {row && <Facts dir={dir} row={row} />}
      </div>
    </section>
  )
}
