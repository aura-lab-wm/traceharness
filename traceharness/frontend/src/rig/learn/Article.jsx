/* Rig · learn/Article.jsx — one Learn article as a reading page.
   A thin progress bar; the picker and previous / next; a tinted hero (part, title, question, kind, minutes, the date
   the sources were checked, what to read first); then a centred 700 px column (17 / 27 text) with "In short", the
   numbered sections and their figures, the worked example, Try it, the quiz and the numbered sources. "On this
   page" follows the reader in the right gutter of a wide page. The article is marked read in this browser once the
   reader is near its end (reading.js). */
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { Go, PageHeader } from '../ui'
import { ARTICLES, figuresAfter, neighbours, readingMinutes } from './articles'
import { buildGlossary } from './glossary'
import { articleSpec, glossarySpec } from './routes'
import { READ_AT, browserStorage, markRead } from './reading'
import { CiteContext } from './Prose'
import { Figure } from './figures'
import { Body, Quiz, Reveal, SeeAlso, Sources, Terms, TryIt, WorkedExample, jumpTo, useHere } from './ArticleParts'
import { Contents, InShort, Prerequisites, Progress, ReadTop, useReadingFrame } from './ArticleChrome'

const GLOSSARY = buildGlossary(ARTICLES)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** 2026-03-09 -> 9 March 2026 (the same words in every locale). */
const longDate = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return MONTHS[m - 1] ? `${d} ${MONTHS[m - 1]} ${y}` : String(iso) }
export const KIND_WORD = { 'how-to': 'How-to', concept: 'Concept' }

export function Article({ article }) {
  const here = useHere()
  const ref = useRef(null)
  const at = (k) => `learn-${article.id}-${k}`
  const contents = [...article.sections.map((s, i) => ({ id: at(`s${i}`), label: s.heading, sec: true })),
    { id: at('example'), label: 'Worked example' }, { id: at('try'), label: 'Try it' }, { id: at('quiz'), label: 'Quiz' }, { id: at('sources'), label: 'Sources' }]
  const { progress, active, scrolled } = useReadingFrame(ref, contents.map((c) => c.id))
  const marked = useRef(false)
  useEffect(() => {
    if (marked.current || !scrolled || progress < READ_AT) return
    marked.current = true
    markRead(browserStorage(), article.id)
  }, [progress, scrolled, article.id])
  const cites = useMemo(() => ({
    sources: article.sources.map((s, i) => ({ n: i + 1, title: s.title, phrases: s.cited_at || [] })),
    jump: (n) => jumpTo(`learn-${article.id}-src-${n}`),
  }), [article])
  // figures are numbered in page order
  let fig = 0
  const { prev, next } = neighbours(article.id)
  return (
    <CiteContext.Provider value={cites}>
      <article ref={ref} className="rg-read" data-el="learn-article">
        <Progress value={progress} />
        <ReadTop article={article} />
        <header className="rg-read-hero" data-el="learn-hero">
          <div className="rg-read-heroin">
            <PageHeader eyebrow={`Learn · Part ${article.part} · ${article.number} of ${ARTICLES.length}`} title={article.title} subtitle={article.question} />
            <p className="rg-read-byline" data-el="learn-byline">
              <span className="rg-read-kind">{KIND_WORD[article.kind]}</span><span className="rg-read-dot"> · </span>
              <span>about {readingMinutes(article)} min read</span><span className="rg-read-dot"> · </span>
              <span>Sources checked {longDate(article.checked)}</span>
            </p>
            <Prerequisites pre={article.prerequisites} />
          </div>
        </header>
        <div className="rg-read-grid">
          <Contents items={contents} active={active} onPick={jumpTo} />
          <div className="rg-read-col">
            <InShort article={article} onQuiz={() => jumpTo(at('quiz'))} />
            {article.sections.map((s, i) => (
              <Fragment key={i}>
                <Reveal id={at(`s${i}`)} tabIndex={-1} className="rg-learn-sec"><h2>{s.heading}</h2><Body items={s.body} /></Reveal>
                {figuresAfter(article, i).map((f) => <Figure key={f.id} fig={f} n={++fig} />)}
              </Fragment>
            ))}
            <WorkedExample we={article.worked_example} here={here} anchor={at('example')} />
            <TryIt t={article.try_it} first={article.worked_example.dataset.name} here={here} anchor={at('try')} />
            <Quiz article={article} anchor={at('quiz')} />
            <Sources sources={article.sources} anchor={at('sources')} idBase={`learn-${article.id}`} />
            <Terms terms={article.glossary_terms} glossary={GLOSSARY} />
            <SeeAlso items={article.see_also} />
            <nav className="rg-learn-pn" aria-label="Previous and next article">
              {prev ? <Go link replace spec={articleSpec(prev.id)} className="rg-learn-row" el="learn-prev"><span className="rg-learn-rowt"><span>Previous</span><b>{prev.title}</b></span></Go> : <span />}
              {next ? <Go link replace spec={articleSpec(next.id)} className="rg-learn-row rg-learn-next" el="learn-next"><span className="rg-learn-rowt"><span>Next</span><b>{next.title}</b></span></Go> : <Go link replace spec={glossarySpec()} className="rg-learn-row rg-learn-next"><span className="rg-learn-rowt"><span>Next</span><b>Glossary</b></span></Go>}
            </nav>
          </div>
        </div>
      </article>
    </CiteContext.Provider>
  )
}
