/* Rig · learn/ArticleParts.jsx — the parts of an article after its sections: the worked example, Try it (numbered
   step cards, each with a real button to its page), the quiz (question cards with a running score), the sources
   (numbered, the target of the [n] marks), the glossary terms and See also. */
import { Fragment, useId, useState } from 'react'
import { useRig } from '../context'
import { Go, Icon, Kbd, MOD, Note, Tag, flashJumped } from '../ui'
import { articleById } from './articles'
import { entryFor } from './glossary'
import { articleSpec, glossarySpec, linkLabel, stepDatasets } from './routes'
import { checkAnswer, quizScore } from './quiz'
import { Prose } from './Prose'
import { useReveal } from './motion'

const cx = (...a) => a.filter(Boolean).join(' ')
const SAMPLE = 'sources:sample'
const LETTERS = 'ABCDEFGH'

/** The datasets on this computer, or null while they are not known yet (then every step links). */
export function useHere() {
  const { datasets } = useRig()
  return datasets && datasets.length ? new Set(datasets.map((d) => d.name)) : null
}

/** Bring one part of the article into view and mark it (ui.jsx flashJumped), so the press is seen even when the
 *  part was already in view: no hash link, the hash is the route. A section is marked by its heading. */
export function jumpTo(id) {
  const el = document.getElementById(id)
  if (!el) return
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' })
  if (typeof el.focus === 'function') el.focus({ preventScroll: true })
  flashJumped((el.matches('section') && el.querySelector(':scope > h2')) || el)
}

/** A part of the page that fades and rises once as it first scrolls into view. */
export function Reveal({ as: Tagname = 'section', className, children, ...rest }) {
  const r = useReveal()
  return <Tagname ref={r.ref} className={className} {...rest}>{children}</Tagname>
}

export function Body({ items }) {
  return items.map((b, i) => (typeof b === 'string' ? <p key={i}><Prose text={b} /></p>
    : b.olist ? <ol key={i}>{b.olist.map((x, j) => <li key={j}><Prose text={x} /></li>)}</ol>
      : b.tags ? <ul key={i} data-el="learn-tags">{b.tags.map(([t, x]) => <li key={t}><code className="rg-learn-code">{t}</code>: <Prose text={x} /></li>)}</ul>
        : <ul key={i}>{b.list.map((x, j) => <li key={j}><Prose text={x} /></li>)}</ul>))
}

function Missing({ names }) {
  if (!names.length) return null
  return (
    <Note tone="amb" el="learn-missing"><div>{names.map((n, i) => <Fragment key={n}>{i ? ', ' : ''}<code className="rg-learn-code">{n}</code></Fragment>)} {names.length === 1 ? 'is' : 'are'} not on this computer, so the steps on it are not links. Add it in <Go link spec={SAMPLE} className="rg-tlink">Add data › Public sample</Go>.</div></Note>
  )
}

/** The step whose page a step without its own link stays on (1-based), or null. */
const openedBy = (links, i) => { for (let j = i - 1; j >= 0; j--) if (links[j]) return j + 1; return null }

/** Numbered step cards; one that opens a page ends with a button to it, one that stays on a page says which. */
export function Steps({ steps, links, first, here }) {
  const ds = stepDatasets(links, first)
  return (
    <>
      <Missing names={here ? [...new Set(ds)].filter((n) => !here.has(n)) : []} />
      <ol className="rg-learn-steps">
        {steps.map((s, i) => (
          <li key={i}><span className="rg-learn-stept"><Prose text={s} /></span>
            {links[i] && (!here || here.has(ds[i])) && <Go link spec={links[i]} className="rg-btn rg-learn-go" tip={links[i]}>{linkLabel(links[i])}</Go>}
            {!links[i] && openedBy(links, i) && <span className="rg-mute rg-small rg-learn-same" data-el="learn-step-same">on the page from step {openedBy(links, i)}</span>}
          </li>
        ))}
      </ol>
    </>
  )
}

export function WorkedExample({ we, here, anchor }) {
  const id = useId()
  return (
    <Reveal id={anchor} tabIndex={-1} className="rg-card rg-learn-card rg-learn-we" data-el="learn-example" aria-labelledby={id}>
      <h2 id={id}>Worked example: <Prose text={we.title} /></h2>
      <p className="rg-learn-meta">Dataset <code className="rg-learn-code">{we.dataset.name}</code>. <Prose text={we.dataset.what} />{we.dataset.credit && <span className="rg-mute"> <Prose text={we.dataset.credit} /></span>}</p>
      {we.dataset2 && <p className="rg-learn-meta" data-el="learn-dataset2">Second dataset <code className="rg-learn-code">{we.dataset2.name}</code>. <Prose text={we.dataset2.what} />{we.dataset2.credit && <span className="rg-mute"> <Prose text={we.dataset2.credit} /></span>}</p>}
      <p className="rg-lbl">To open it</p>
      <Steps steps={we.open} links={we.links} first={we.dataset.name} here={here} />
      <Body items={we.body} />
    </Reveal>
  )
}

export function TryIt({ t, first, here, anchor }) {
  const { isMobile } = useRig()
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <Reveal id={anchor} tabIndex={-1} className="rg-card rg-learn-card rg-learn-try" data-el="learn-try" aria-labelledby={`${id}-h`}>
      <p className="rg-read-kick">Your turn</p>
      <h2 id={`${id}-h`}>Try it in TraceHarness</h2>
      <p className="rg-learn-meta">Each step opens its page in a new tab{isMobile ? '' : <>; <Kbd>{MOD} click</Kbd> opens it beside this article</>}.</p>
      <Steps steps={t.clicks} links={t.links} first={first} here={here} />
      <div className="rg-learn-askbox">
        <p className="rg-learn-ask"><b>Question.</b> <Prose text={t.question} /></p>
        <button type="button" className="rg-btn" aria-expanded={open} aria-controls={open ? `${id}-a` : undefined} onClick={() => setOpen(!open)}>{open ? 'Hide answer' : 'Show answer'}</button>
        {open && (
          <div id={`${id}-a`} className="rg-learn-ans">
            <p><Prose text={t.answer} /></p>
            {t.answer_measured_from && <p className="rg-learn-how"><b>How this was measured.</b> <Prose text={t.answer_measured_from} /></p>}
          </div>
        )}
      </div>
    </Reveal>
  )
}

function Question({ q, i, n, name, onResult }) {
  const [picked, setPicked] = useState(null)
  const [result, setResult] = useState(null)
  const shown = result && result.status !== 'unanswered'
  const mark = (k) => (!shown ? undefined : k === q.answer ? 'answer' : k === picked ? 'wrong' : undefined)
  const check = () => { const r = checkAnswer(q, picked); setResult(r); onResult(r.status) }
  return (
    <fieldset className="rg-learn-q" data-state={shown ? result.status : undefined}>
      <legend><span className="rg-learn-qn">Question {i + 1} of {n}</span><Prose text={q.q} /></legend>
      <div className="rg-learn-opts">
        {q.options.map((o, k) => (
          <label key={k} className="rg-learn-opt" data-mark={mark(k)}>
            <input type="radio" name={name} value={k} checked={picked === k} onChange={() => { setPicked(k); setResult(null); onResult(null) }} />
            <span className="rg-learn-optk" aria-hidden="true">{LETTERS[k]}</span>
            <span className="rg-learn-optt"><Prose text={o} /></span>
            {mark(k) && <span className={mark(k) === 'answer' ? 'rg-sky' : 'rg-red'} aria-hidden="true">{mark(k) === 'answer' ? '✓' : '×'}</span>}
          </label>
        ))}
      </div>
      <div className="rg-learn-qact">
        <button type="button" className="rg-btn" onClick={check}>Check</button>
        <p role="status" className={cx('rg-learn-fb', result && result.status)}>{result ? result.message : ''}</p>
      </div>
      {shown && <p className="rg-learn-why"><span className="sr-only">The answer is: {q.options[q.answer]}. </span><Prose text={q.why} /></p>}
    </fieldset>
  )
}

/** The words of the score line. */
export function scoreLine(s) {
  if (!s.checked) return 'Check an answer to start your score.'
  return s.done ? `Score: ${s.right} of ${s.total} right.` : `Score so far: ${s.right} of ${s.checked} right, ${s.total - s.checked} to check.`
}

export function Quiz({ article, anchor }) {
  const [results, setResults] = useState(() => article.quiz.map(() => null))
  const score = quizScore(results)
  const set = (i) => (status) => setResults((r) => r.map((x, j) => (j === i ? status : x)))
  return (
    <Reveal id={anchor} className="rg-learn-quiz" data-el="learn-quiz" aria-label="Quiz" tabIndex={-1}>
      <p className="rg-read-kick">Check yourself</p>
      <h2>Quiz</h2>
      {article.quiz.map((q, i) => <Question key={i} q={q} i={i} n={article.quiz.length} name={`${article.id}-q${i}`} onResult={set(i)} />)}
      <p role="status" className={cx('rg-learn-score', score.done && 'done')} data-el="learn-quiz-score">{scoreLine(score)}</p>
    </Reveal>
  )
}

/* A source shows its authors and year, its title as the link, what the article uses it for, the quote and the
   licence. The date it was checked is the byline's. */
export function Sources({ sources, anchor, idBase }) {
  if (!sources.length) return null
  return (
    <section id={anchor} tabIndex={-1} className="rg-learn-small rg-read-srcs" data-el="learn-sources" aria-label="Sources">
      <h2>Sources</h2>
      <ol>{sources.map((s, i) => (
        <li key={i} id={`${idBase}-src-${i + 1}`} tabIndex={-1}>
          <span className="rg-read-srcn" aria-hidden="true">{i + 1}</span>
          <span className="rg-read-srcb">
            <span className="rg-read-srca">{[s.authors, s.year].filter(Boolean).join(' · ')}</span>
            {String(s.url).startsWith('https://')
              ? <a className="rg-read-srct" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}<Icon name="ext" size={12} /></a>
              : <b className="rg-read-srct">{s.title}</b>}
            <span className="rg-read-srcurl">{s.url}</span>
            <span className="rg-learn-src" data-el="learn-used-for">Used for: {s.what_we_took}</span>
            {s.quote && <span className="rg-learn-src"><span className="rg-mute">Quote:</span> “{s.quote}”</span>}
            {s.licence && <span className="rg-learn-src"><span className="rg-mute">Licence and reuse:</span> {s.licence}</span>}
          </span>
        </li>
      ))}</ol>
    </section>
  )
}

export function Terms({ terms, glossary }) {
  return (
    <section className="rg-learn-small" data-el="learn-terms" aria-label="Glossary terms used">
      <h2>Glossary terms used</h2>
      <p className="rg-learn-chips">{terms.map((t) => { const e = entryFor(glossary, t); return e ? <Go key={t} link replace spec={glossarySpec(e.slug)} className="rg-learn-chip">{t}</Go> : <span key={t} className="rg-learn-chip">{t}</span> })}</p>
    </section>
  )
}

/** Every row is a link: another article, or the page of TraceHarness where the idea is. */
export function SeeAlso({ items }) {
  return (
    <section className="rg-learn-small" data-el="learn-see-also" aria-label="See also">
      <h2>See also</h2>
      <ul>{items.map((s, i) => {
        const a = s.kind === 'article' ? articleById(s.target) : null
        return (
          <li key={i}><Tag>{a ? 'article' : 'page'}</Tag> {a ? <Go link replace spec={articleSpec(a.id)} className="rg-tlink">{a.title}</Go> : <Go link spec={s.spec} className="rg-tlink">{s.label}</Go>}{s.note && <span className="rg-mute"> (<Prose text={s.note} />)</span>}</li>
        )
      })}</ul>
    </section>
  )
}
