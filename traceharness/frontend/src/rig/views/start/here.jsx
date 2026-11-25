/* Rig · views/start/here.jsx — Home's "You are here" panel, drawn with the dark token set: on the left
   "Pick up where you left off", the last dataset, task and run this browser opened that are still in the library
   (recent.js; the side is left out when there is none); on the right Learn as one square per article, read ones in
   the pass colour, the next one in the accent, numbered, the five parts under them, each part opening its first
   article not read, then Continue. */
import { fmt, sfx } from '../../data'
import { useRig } from '../../context'
import { Go, Icon, Wb } from '../../ui'
import { datasetName } from '../../datasetInfo'
import { readRecent } from '../../recent'
import { ARTICLES, PARTS } from '../../learn/articles'
import { articleSpec, LEARN_HOME } from '../../learn/routes'
import { browserStorage, readIds } from '../../learn/reading'
import { canSee } from '../../learn/gate'
import { learnStrip } from './model'

const cx = (...a) => a.filter(Boolean).join(' ')
const { plural } = fmt
const storage = () => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }
const KIND = { ds: 'Dataset', task: 'Task', run: 'Run' }
const STATE_WORD = { read: 'read', next: 'next to read', todo: 'not read yet' }

/** The last dataset, task and run this browser opened, still in the library; [] when there is none. */
export function recentRows(rows) {
  const here = new Set(rows.map((r) => r.name))
  return readRecent(storage()).filter((e) => (e.kind === 'run' ? !e.dir || here.has(e.dir) : e.dir && here.has(e.dir)))
}

function Recent({ list, rows }) {
  const byName = new Map(rows.map((r) => [r.name, r]))
  return (
    <section className="rg-start-recent" data-el="start-recent" aria-labelledby="rg-start-recent-h">
      <h2 id="rg-start-recent-h" className="rg-start-h">Pick up where you left off</h2>
      <ul className="rg-start-rl">{list.map((e) => {
        const ds = e.dir ? byName.get(e.dir) : null
        // a run by the console's 6-character id (its whole id is in the link's name)
        const name = e.kind === 'ds' ? (ds ? datasetName(ds) : e.dir) : e.kind === 'task' ? e.task || e.spec.split(':')[4] : sfx(e.run || e.spec.slice(4))
        const where = e.kind === 'ds' ? (ds && datasetName(ds) !== ds.name ? ds.name : null) : [e.kind === 'run' && e.task, e.dir].filter(Boolean).join(' · ')
        return (
          <li key={e.kind}><Go link spec={e.spec} className="rg-start-row" el="start-recent-row" label={`${KIND[e.kind]} ${e.kind === 'run' ? e.run || e.spec.slice(4) : name}${where ? `, ${where}` : ''}`}>
            <span className="k">{KIND[e.kind]}</span>
            <span className="t"><b className={cx(e.kind !== 'ds' && 'rg-mono')}><Wb>{name}</Wb></b>{where && <span className="w">{where}</span>}</span>
            <Icon name="right" size={14} />
          </Go></li>
        )
      })}</ul>
    </section>
  )
}

function Learn() {
  const { lab } = useRig()
  if (!canSee('articles', lab)) {
    return (
      <section className="rg-start-learn" data-el="start-learn" aria-labelledby="rg-start-learn-h">
        <h2 id="rg-start-learn-h" className="rg-start-h">Learn</h2>
        <Go link spec={LEARN_HOME} className="rg-tlink" el="start-learn-home">Open Learn →</Go>
      </section>
    )
  }
  const read = readIds(browserStorage()).filter((id) => ARTICLES.some((a) => a.id === id))
  const next = ARTICLES.find((a) => !read.includes(a.id))
  const start = next || ARTICLES[0]
  const word = !read.length ? 'Start with' : next ? 'Continue with' : 'Read again from'
  return (
    <section className="rg-start-learn" data-el="start-learn" aria-labelledby="rg-start-learn-h">
      <h2 id="rg-start-learn-h" className="rg-start-h">Learn <span className="n" data-el="start-learn-count">{read.length} of {ARTICLES.length} read</span></h2>
      <ol className="rg-start-parts">{learnStrip(ARTICLES, PARTS, read).map(({ part, done, opens, items }) => (
        <li key={part.id} className="rg-start-pg">
          <ol className="rg-start-sq">{items.map(({ a, state }) => (
            <li key={a.id}><Go link spec={articleSpec(a.id)} className={cx('rg-start-sqb', state)} el="start-learn-article" tip={`${a.number}. ${a.title}`}
              label={`Article ${a.number}, ${a.title}: ${STATE_WORD[state]}`}><span aria-hidden="true">{a.number}</span></Go></li>
          ))}</ol>
          <Go link spec={articleSpec(opens.id)} className="rg-start-part" el="start-learn-part" tip={`${opens.number}. ${opens.title}`}
            label={`Part ${part.id}, ${part.title}: ${done} of ${plural(items.length, 'article')} read. Opens ${opens.number}. ${opens.title}`}>
            <span className="pt">{part.title}</span><span className="pm">{done} of {items.length} read</span>
          </Go>
        </li>
      ))}</ol>
      <Go link spec={articleSpec(start.id)} className="rg-btn rg-start-cont" el="start-learn-continue">{word} {start.number}. {start.title}<Icon name="arrowr" size={14} /></Go>
    </section>
  )
}

/** The dark "You are here" panel. */
export function YouAreHere({ rows }) {
  const list = recentRows(rows)
  return (
    <section className="rg-start-sec" aria-label="You are here">
      <div className="rg-start-in">
        <div className={cx('rg-start-band rg-start-here', !list.length && 'solo')} data-el="start-you-are-here">
          <p className="rg-start-kick">You are here</p>
          <div className="rg-start-hereg">
            {list.length > 0 && <Recent list={list} rows={rows} />}
            <Learn />
          </div>
        </div>
      </div>
    </section>
  )
}
