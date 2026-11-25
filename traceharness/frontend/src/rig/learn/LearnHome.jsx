/* Rig · learn/LearnHome.jsx — Learn as a course page: a hero with where the reader is (read in this browser, and
   the next article to read), then the reading path in its five parts, one card per article with a small drawing
   from its first figure, its kind, its minutes and whether it has been read. The glossary, the Student Lab guides
   and the example datasets follow. */
import { useRig } from '../context'
import { Go, Icon, PageHeader } from '../ui'
import { ARTICLES, PARTS, readingMinutes } from './articles'
import { buildGlossary } from './glossary'
import { articleSpec, glossarySpec, specDataset } from './routes'
import { canSee } from './gate'
import { browserStorage, readIds } from './reading'
import { FigurePreview } from './figures'
import { GUIDES } from './LearnNav'
import { KIND_WORD } from './Article'
import { useHere } from './ArticleParts'

const cx = (...a) => a.filter(Boolean).join(' ')
const GLOSSARY = buildGlossary(ARTICLES)
const SAMPLE = 'sources:sample'
/** The datasets the examples and challenges use, in the order the articles first name them. */
const EXAMPLE_DATASETS = [...new Set(ARTICLES.flatMap((a) => [a.worked_example.dataset.name, ...[...a.worked_example.links, ...a.try_it.links].map((s) => s && specDataset(s))]).filter(Boolean))]
/** The figure an article's card draws from: its first in page order. */
const firstFigure = (a) => [...(a.figures || [])].sort((x, y) => x.after_section - y.after_section)[0] || null

function Row({ spec, name, sub }) {
  return <li><Go link replace spec={spec} className="rg-learn-row"><span className="rg-learn-rowt"><b>{name}</b><span>{sub}</span></span><span className="rg-learn-rowgo" aria-hidden="true"><Icon name="right" size={14} /></span></Go></li>
}

function Tile({ a, read }) {
  return (
    <li>
      <Go link replace spec={articleSpec(a.id)} className={cx('rg-learn-row rg-learn-tile', read && 'read')}>
        <span className="rg-learn-tilefig"><FigurePreview fig={firstFigure(a)} /></span>
        <span className="rg-learn-tileb">
          <span className="rg-learn-tilek"><span className="n">{a.number}</span><span className={cx('rg-learn-kind', a.kind)}>{KIND_WORD[a.kind]}</span></span>
          <b className="rg-learn-tilet">{a.title}</b>
          <span className="rg-learn-tileq">{a.question}</span>
          <span className="rg-learn-tilem"><span>{readingMinutes(a)} min</span>
            <span className={cx('rg-learn-readm', read && 'on')} data-el="learn-read">{read ? 'Read' : 'Not read yet'}</span></span>
        </span>
        <span className="rg-learn-rowgo" aria-hidden="true"><Icon name="right" size={14} /></span>
      </Go>
    </li>
  )
}

export function LearnHome() {
  const { lab } = useRig()
  const here = useHere()
  const guides = GUIDES.filter(([k]) => canSee(k, lab))
  const read = readIds(browserStorage()).filter((id) => ARTICLES.some((a) => a.id === id))
  const nextUp = ARTICLES.find((a) => !read.includes(a.id))
  const start = nextUp || ARTICLES[0]
  const startWord = !read.length ? 'Start with' : nextUp ? 'Continue with' : 'Read again from'
  return (
    <div className="rg-learn-home">
      <header className="rg-read-hero rg-learn-homehero" data-el="learn-hero">
        <div className="rg-read-heroin">
          <PageHeader title="Learn" subtitle={`${ARTICLES.length} articles in ${PARTS.length} parts, from reading one run to reporting a comparison.`} />
          <p className="rg-learn-lede">Each article answers one question with an explanation, a worked example on bundled data, a challenge to try here, a three-question quiz and its sources. Two are how-tos: they walk you through a task step by step.</p>
          {canSee('articles', lab) && (
            <div className="rg-learn-start">
              <Go link replace spec={articleSpec(start.id)} className="rg-btn pri rg-learn-startb" el="learn-continue">{startWord} {start.number}. {start.title}<Icon name="arrowr" size={14} /></Go>
              <span className="rg-learn-count">
                <span className="rg-learn-ticks" aria-hidden="true">{ARTICLES.map((a) => <i key={a.id} className={cx(read.includes(a.id) && 'on')} />)}</span>
                <span data-el="learn-read-count">{read.length} of {ARTICLES.length} read in this browser</span>
              </span>
            </div>
          )}
        </div>
      </header>
      <div className="rg-learn-homebody">
        <div data-el="learn-index" className="rg-learn-index">
          {canSee('articles', lab) && <>
            <p className="rg-lbl rg-learn-path">Suggested reading path</p>
            {PARTS.map((p) => {
              const arts = ARTICLES.filter((a) => a.part === p.id)
              return (
                <section key={p.id} className="rg-learn-part" data-el="learn-part" aria-labelledby={`learn-part-${p.id}`}>
                  <div className="rg-learn-parth">
                    <span className="rg-learn-partn" aria-hidden="true">{p.id}</span>
                    <div>
                      <h2 id={`learn-part-${p.id}`} className="rg-learn-h">Part {p.id}. {p.title}</h2>
                      <p className="rg-learn-partb">{p.blurb} <span className="rg-mute">{arts.length} articles · {arts.reduce((m, a) => m + readingMinutes(a), 0)} min</span></p>
                    </div>
                  </div>
                  <ol className="rg-learn-tiles">{arts.map((a) => <Tile key={a.id} a={a} read={read.includes(a.id)} />)}</ol>
                </section>
              )
            })}
          </>}
          {canSee('glossary', lab) && <ul><Row spec={glossarySpec()} name="Glossary" sub={`${GLOSSARY.length} terms, one plain sentence each, with the articles that use them.`} /></ul>}
          {guides.length > 0 && <><h2 className="rg-learn-h">Student Lab</h2><ul>{guides.map(([k, title, sub]) => <Row key={k} spec={k} name={title} sub={sub} />)}</ul></>}
        </div>
        {here && canSee('articles', lab) && (
          <section data-el="learn-datasets" className="rg-learn-small" aria-label="The example datasets">
            <h2 className="rg-learn-h">The example datasets</h2>
            <ul>{EXAMPLE_DATASETS.map((n) => <li key={n}><code className="rg-learn-code">{n}</code> — {here.has(n) ? 'on this computer' : 'not on this computer'}</li>)}</ul>
            {EXAMPLE_DATASETS.some((n) => !here.has(n)) && <p>Steps on a dataset that is not here are shown without a link. Add one in <Go link spec={SAMPLE} className="rg-tlink">Add data › Public sample</Go>.</p>}
          </section>
        )}
      </div>
    </div>
  )
}

