/* Rig · Term.jsx — a glossary word where it appears.

   <Term slug="flip">flip</Term>
     The word keeps its place in the sentence with a dotted underline. Its HoverCard gives the Learn
     glossary's one sentence (learn/glossary.js termMeaning) and "Learn more →": straight to the first
     article the glossary row names, else to the glossary entry itself (#/rig/guide:glossary:<slug>, which
     Learn scrolls to and marks). With an article, the glossary entry stays one click away in the card. The
     word itself is a link to the glossary entry, so the keyboard reaches it too (focus opens the card, Enter
     follows the link). A first tap pins the card instead of leaving the page. A slug with no sentence draws
     the word as it was. */
import { useRef } from 'react'
import { useRig } from './context'
import { HoverCard } from './HoverCard'
import { termMeaning } from './learn/glossary'
import { articleSpec, glossarySpec } from './learn/routes'
import { canSee } from './learn/gate'

export function Term({ slug, children }) {
  const { openTab, lab } = useRig()
  const touch = useRef(false)
  const e = termMeaning(slug)
  if (!e || !e.meaning) return children
  const spec = glossarySpec(slug)
  const listed = canSee('glossary', lab)
  const article = canSee('articles', lab) && e.articles && e.articles[0] ? articleSpec(e.articles[0].id) : null
  // a plain click opens the entry as a tab, ⌘/Ctrl-click beside; a middle or shift click is the browser's
  const goTo = (to) => (ev) => {
    if (ev.button !== 0 || ev.shiftKey || ev.altKey) return
    ev.preventDefault()
    openTab(to, { side: ev.metaKey || ev.ctrlKey })
  }
  const go = goTo(spec)
  const more = article || (listed ? spec : null)
  const card = (
    <span className="rg-term-card">
      <b>{e.term}</b>: {e.meaning}.
      {more && <> <a href={`#/rig/${more}`} className="rg-tlink" onClick={goTo(more)} data-hint={article ? e.articles[0].title : undefined}>Learn more →</a></>}
      {article && listed && <> · <a href={`#/rig/${spec}`} className="rg-tlink" onClick={go}>glossary</a></>}
    </span>
  )
  return (
    <HoverCard portal className="rg-term-hc" content={card}>
      <a href={`#/rig/${spec}`} className="rg-term" data-term={slug}
        onPointerDown={(ev) => { touch.current = ev.pointerType === 'touch' }}
        onClick={(ev) => {
          const tapped = touch.current
          touch.current = false
          if (tapped) { ev.preventDefault(); return }   // the hover card pins; its Learn more leaves the page
          go(ev)
        }}>{children}</a>
    </HoverCard>
  )
}
