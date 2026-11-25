/* Rig · learn/Prose.jsx — article text as the page draws it: inline code in mono, **key claims** in bold and a
   numbered citation mark [n] after the phrase a source backs. An article provides its sources through
   CiteContext; text outside an article (the glossary, a hover card) draws no marks. */
import { createContext, useContext } from 'react'
import { proseParts } from './prose-parts'

/** { sources: [{ n, title, phrases }], jump(n) } for the article on the page, or null. */
export const CiteContext = createContext(null)

/** The mark: a superscript [n] that brings source n into view and marks it. */
export function CiteMark({ n }) {
  const c = useContext(CiteContext)
  const src = c && c.sources.find((s) => s.n === n)
  return (
    <sup className="rg-cite">
      <button type="button" className="rg-cite-b rg-hit" data-el="learn-cite" data-hint={src ? `Source ${n}: ${src.title}` : `Source ${n}`}
        aria-label={src ? `Source ${n}: ${src.title}` : `Source ${n}`} onClick={() => c && c.jump(n)}>[{n}]</button>
    </sup>
  )
}

export function Prose({ text }) {
  const c = useContext(CiteContext)
  const cites = c ? c.sources.flatMap((s) => s.phrases.map((phrase) => ({ phrase, n: s.n }))) : []
  return proseParts(text, cites).map((p, i) => {
    if (p.cite) return <CiteMark key={i} n={p.cite} />
    const words = p.code ? <code key={i} className="rg-learn-code">{p.t}</code> : p.t
    return p.bold ? <b key={i}>{words}</b> : words
  })
}
