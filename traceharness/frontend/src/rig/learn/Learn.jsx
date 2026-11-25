/* Rig · learn/Learn.jsx — Help › Learn: the Learn index (LearnHome.jsx), the articles as reading pages
   (Article.jsx), the glossary and, with Student Lab on, the Reading guide and Reference materials. Registered
   through the existing `guide` and `package` kinds (views/workspace.jsx); routes.js has the address grammar. */
import { Fragment, useEffect, useState } from 'react'
import { useRig } from '../context'
import { Go, PageHeader, SearchBox, Empty } from '../ui'
import { ARTICLES } from './articles'
import { buildGlossary, filterGlossary, LEARN_SOURCE } from './glossary'
import { learnPage, LEARN_HOME, articleSpec, glossarySpec } from './routes'
import { NAV_ALIASES, aliasSpec } from '../navTree'
import { Prose } from './Prose'
import { LearnFrame } from './LearnNav'
import { LearnHome } from './LearnHome'
import { Article } from './Article'
import './learn.css'
import './figures/figures.css'

export { LearnFrame }
const cx = (...a) => a.filter(Boolean).join(' ')
const GLOSSARY = buildGlossary(ARTICLES)

/* ================================================================ glossary */
function GlossaryPage({ term }) {
  const [q, setQ] = useState('')
  const rows = filterGlossary(GLOSSARY, q)
  useEffect(() => {
    if (!term) return undefined
    const land = () => {
      const el = document.getElementById(`glossary-${term}`)
      if (!el) return
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
      el.focus({ preventScroll: true })
    }
    // Opening a tab scrolls the page back to the top one frame later (RigApp openTab), so land again two frames on.
    const raf = window.requestAnimationFrame ? (f) => window.requestAnimationFrame(f) : (f) => setTimeout(f, 16)
    const caf = window.cancelAnimationFrame ? (h) => window.cancelAnimationFrame(h) : (h) => clearTimeout(h)
    let second = null
    const first = raf(() => { second = raf(land) })
    land()
    return () => { caf(first); if (second != null) caf(second) }
  }, [term])
  return (
    <div className="rg-dpad rg-learn-doc">
      <PageHeader title="Glossary" subtitle="Every term the articles and the pages use, one plain sentence each, with the articles that explain it." />
      <div className="rg-learn-gfind" data-tour="glossary-filter"><SearchBox value={q} onChange={setQ} placeholder="Filter the glossary" /><span className="rg-small rg-mute" role="status">{rows.length} of {GLOSSARY.length} terms</span></div>
      {rows.length ? (
        <dl className="rg-learn-gl">{rows.map((e) => (
          <div key={e.slug} id={`glossary-${e.slug}`} data-el="glossary-row" tabIndex={e.slug === term ? -1 : undefined} className={cx(e.slug === term && 'on')} aria-current={e.slug === term ? 'true' : undefined}>
            <dt><Prose text={e.term} />{e.names.some((n) => !e.term.includes(n)) && <span className="rg-mute"> · in the articles: {e.names.filter((n) => !e.term.includes(n)).join(', ')}</span>}{e.aka.length > 0 && <span className="rg-mute"> · also: {e.aka.join(', ')}</span>}</dt>
            {e.meaning && <dd><Prose text={e.meaning} />{e.source && e.source !== LEARN_SOURCE && <> <span className="rg-mute" data-hint={e.sourceHint}>({e.source})</span></>}</dd>}
            {e.articles.length > 0 && <dd className="rg-learn-more">Learn more: {e.articles.map((a, i) => <Fragment key={a.id}>{i ? ' · ' : ''}<Go link replace spec={articleSpec(a.id)} className="rg-tlink">{a.title}</Go></Fragment>)}</dd>}
          </div>
        ))}</dl>
      ) : <Empty title={`No term matches “${q}”.`} actions={[{ label: 'Clear the filter', onClick: () => setQ('') }]} />}
      <PageNames q={q} />
    </div>
  )
}

/** Old and other names of pages (navTree.js): no name is retired, so each still finds its page. */
function PageNames({ q }) {
  const { condition } = useRig()
  const dir = condition && condition.dir
  const query = String(q || '').trim().toLowerCase()
  const rows = NAV_ALIASES.filter((a) => !query || [a.old, a.now, a.why].some((t) => t.toLowerCase().includes(query)))
  return (
    <section className="rg-learn-small" aria-labelledby="glossary-names" data-el="glossary-names">
      <h2 id="glossary-names">Page names, old and new</h2>
      <p className="rg-small rg-mute" data-el="glossary-alias-count">{rows.length} of {NAV_ALIASES.length} page names</p>
      {rows.length > 0 && <dl className="rg-learn-gl">{rows.map((a) => {
        const spec = aliasSpec(a, dir, condition)
        return (
          <div key={a.old} data-el="glossary-alias">
            <dt>{a.old} → {a.now}</dt>
            <dd>{a.why}.{spec && <> <Go link spec={spec} className="rg-tlink">Open {a.now}</Go></>}</dd>
          </div>
        )
      })}</dl>}
    </section>
  )
}

/* ================================================================ registration helpers */
/** The `guide` view: the Reading guide (its own component, passed in) or a Learn page. */
export function LearnPage({ args, readingGuide: Guide }) {
  const p = learnPage(args)
  if (p.page === 'guide') return <LearnFrame current="guide"><Guide /></LearnFrame>
  if (p.page === 'learn') return <LearnHome />
  if (p.page === 'glossary') return <LearnFrame current="glossary"><GlossaryPage term={p.term} /></LearnFrame>
  if (p.page === 'article') return <Article key={p.article.id} article={p.article} />
  return (
    <LearnFrame current={null}>
      <div className="rg-dpad rg-learn-doc"><Empty title={`No Learn page is called ${p.id}.`} actions={[{ label: 'All of Learn', spec: LEARN_HOME, primary: true }]} /></div>
    </LearnFrame>
  )
}

/** Tab title and breadcrumb of a Learn page; null for the bare guide, which keeps its own. */
export function learnTitle(args) {
  const p = learnPage(args)
  return p.page === 'guide' ? null : p.page === 'article' ? p.article.title : p.page === 'glossary' ? 'Glossary' : 'Learn'
}
export function learnCrumbs(args) {
  const p = learnPage(args)
  if (p.page === 'guide') return null
  if (p.page === 'learn') return [['Learn']]
  return [['Learn', LEARN_HOME], [learnTitle(args)]]
}
/** ⌘K entries: Learn and the glossary, and each article when searched for. */
export function learnPalette() {
  return [
    { title: 'Learn', detail: 'articles with quizzes, and the glossary', spec: LEARN_HOME, keywords: 'help learn articles quiz glossary' },
    { title: 'Glossary', detail: 'Learn · every term, with its articles', spec: glossarySpec(), keywords: 'glossary terms definitions words', pick: false },
    ...ARTICLES.map((a) => ({ title: a.title, detail: `Learn ${a.number} · ${a.question}`, spec: articleSpec(a.id), keywords: `learn article ${a.glossary_terms.join(' ')}`, pick: false })),
  ]
}
