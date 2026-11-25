/* Rig · learn/ArticleChrome.jsx — what frames an article's text: the reading-progress bar, the "All articles"
   picker with previous / next, the hero's prerequisite chips, the "In short" card, and "On this page" (a rail that
   follows the reader on a wide page, a "Contents" button under the hero on a narrow one). */
import { useEffect, useId, useRef, useState } from 'react'
import { Go, Icon } from '../ui'
import { ARTICLES, PARTS, articleById, neighbours } from './articles'
import { articleSpec, glossarySpec } from './routes'
import { activeSection, readingProgress } from './reading'
import { LearnNav } from './LearnNav'
import { Prose } from './Prose'

const cx = (...a) => a.filter(Boolean).join(' ')
/** Where the reader is: the line a section's top must pass to count as the one being read (share of the view). */
const READING_LINE = 0.3

/** { progress 0..1, active index into ids or -1, scrolled }, from the scroll of the article's document. scrolled
 *  turns true at the reader's first scroll: an article opened from the end of another can be measured at the old
 *  scroll position for a frame, and that must not count as reading it. */
export function useReadingFrame(ref, ids) {
  const [frame, setFrame] = useState({ progress: 0, active: -1, scrolled: false })
  const key = ids.join('|')
  useEffect(() => {
    const el = ref.current
    const scroller = el && el.closest('.rg-doc')
    if (!scroller) return undefined
    let scrolled = false
    const measure = () => {
      const sr = scroller.getBoundingClientRect()
      const view = scroller.clientHeight
      const tops = key.split('|').map((id) => { const s = document.getElementById(id); return s ? s.getBoundingClientRect().top - sr.top : null })
      const ar = el.getBoundingClientRect()
      const progress = readingProgress({ scrollTop: scroller.scrollTop, offsetTop: scroller.scrollTop + (ar.top - sr.top), height: ar.height, viewport: view })
      const next = { progress: Math.round(progress * 100) / 100, active: activeSection(tops, view * READING_LINE), scrolled }
      setFrame((f) => (f.progress === next.progress && f.active === next.active && f.scrolled === next.scrolled ? f : next))
    }
    const onScroll = () => { scrolled = true; measure() }
    measure()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', measure)
    return () => { scroller.removeEventListener('scroll', onScroll); window.removeEventListener('resize', measure) }
  }, [ref, key])
  return frame
}

/** The thin bar at the top of the article: how much of it has been read. */
export function Progress({ value }) {
  const pct = Math.round(value * 100)
  return (
    <div className="rg-read-progress" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} data-el="learn-progress">
      <i style={{ transform: `scaleX(${value})` }} />
    </div>
  )
}

/** "All articles ▾": every Learn page in a panel that opens under the button; Escape or a click outside closes it. */
function Picker({ current }) {
  const [open, setOpen] = useState(false)
  const btn = useRef(null)
  const box = useRef(null)
  const id = useId()
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [open])
  const close = () => { setOpen(false); if (btn.current) btn.current.focus() }
  return (
    <div ref={box} className="rg-read-pick" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); close() } }}>
      <button ref={btn} type="button" className="rg-btn rg-read-pickb" aria-expanded={open} aria-controls={id} data-el="learn-picker" onClick={() => setOpen(!open)}>
        <Icon name="list" size={14} />All articles<Icon name="chevd" size={12} />
      </button>
      <div id={id} className="rg-read-pop" hidden={!open} onClick={(e) => { if (e.target.closest('a[data-spec]:not([aria-disabled])')) setOpen(false) }}>
        <LearnNav current={current.id} />
      </div>
    </div>
  )
}

/** An arrow to the article before or after; the first article's "previous" stays, inert, and says why. */
function Arrow({ to, dir, el }) {
  const word = dir === 'prev' ? 'Previous' : 'Next'
  const icon = <Icon name={dir === 'prev' ? 'chevl' : 'chevr'} size={16} />
  if (!to) return <button type="button" className="rg-read-arrow" aria-disabled="true" data-el={el} data-hint="This is the first article" aria-label="Previous article: none, this is the first article">{icon}</button>
  return <Go link replace spec={to.spec} className="rg-read-arrow" el={el} tip={`${word}: ${to.title}`} label={`${word}: ${to.title}`}>{icon}</Go>
}

/** The bar above the hero: the picker, where this article sits on the path, and previous / next. */
export function ReadTop({ article }) {
  const { prev, next } = neighbours(article.id)
  const part = PARTS.find((p) => p.id === article.part)
  return (
    <div className="rg-read-top">
      <Picker current={article} />
      <span className="rg-read-where">Part {article.part}: {part ? part.title : ''} · {article.number} of {ARTICLES.length}</span>
      <span className="rg-read-arrows">
        <Arrow dir="prev" el="learn-prev-top" to={prev && { spec: articleSpec(prev.id), title: prev.title }} />
        <Arrow dir="next" el="learn-next-top" to={next ? { spec: articleSpec(next.id), title: next.title } : { spec: glossarySpec(), title: 'Glossary' }} />
      </span>
    </div>
  )
}

/** "Before you start": the articles to read first as chips that open them, and anything else in plain words. */
export function Prerequisites({ pre }) {
  const read = pre.read.map(articleById).filter(Boolean)
  return (
    <div className="rg-read-pre" data-el="learn-prereq" role="group" aria-label="Before you start">
      <span className="rg-read-prek">Before you start</span>
      {read.map((a) => <Go key={a.id} link replace spec={articleSpec(a.id)} className="rg-read-chip" tip={`Read first: ${a.title}`}>{a.title}<Icon name="arrowr" size={12} /></Go>)}
      {pre.know.map((k, i) => <span key={i} className="rg-read-know"><Prose text={k} /></span>)}
    </div>
  )
}

/** The key sentences, key claims in bold; then what the reader will learn, and the way to the quiz. */
export function InShort({ article, onQuiz }) {
  const id = useId()
  return (
    <section className="rg-read-short" data-el="learn-in-short" aria-labelledby={id}>
      <h2 id={id}>In short</h2>
      {article.in_short && <ul data-el="learn-short">{article.in_short.map((s, i) => <li key={i}><Prose text={s} /></li>)}</ul>}
      <p className="rg-lbl">You will learn</p>
      <ul className="rg-read-learn">{article.what_you_learn.map((w, i) => <li key={i}><Prose text={w} /></li>)}</ul>
      <button type="button" className="rg-tlink rg-learn-toquiz" data-el="learn-to-quiz" onClick={onQuiz}>Go to the quiz ({article.quiz.length} questions)<Icon name="chevd" size={12} /></button>
    </section>
  )
}

/** On this page: one button per part; the part being read is marked. Narrow: folded under a "Contents" button. */
export function Contents({ items, active, onPick }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const pick = (it) => { setOpen(false); onPick(it.id) }
  return (
    <aside className="rg-read-rail" data-open={open ? '' : undefined}>
      <button type="button" className="rg-btn rg-read-contents" aria-expanded={open} aria-controls={id} data-el="learn-contents-toggle" onClick={() => setOpen(!open)}>
        <Icon name="list" size={14} />Contents<span className="rg-read-contentsn">{active >= 0 ? items[active].label : `${items.length} parts`}</span><Icon name="chevd" size={12} />
      </button>
      <nav id={id} className="rg-learn-toc" data-el="learn-toc" aria-label="On this page">
        <p className="rg-lbl">On this page</p>
        <ol>{items.map((it, i) => (
          <li key={it.id} className={cx(it.sec && 'sec')}>
            <button type="button" className={cx('rg-learn-tocb', i === active && 'on')} aria-current={i === active ? 'true' : undefined} onClick={() => pick(it)}>{it.label}</button>
          </li>
        ))}</ol>
      </nav>
    </aside>
  )
}
