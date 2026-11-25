/* Rig · landed.js — what replaces a wait fades in; a page reached by navigation does not.
   feel.css draws .rg-landed as one rg-fade-in. Only a page that replaces its document's loading state fades, so a
   page that draws in two steps (the run page's step band lands after its head) lands under the fade, and a page
   reached with its data in hand is just there. */
import { useEffect, useState } from 'react'

/** The placeholders a page column shows while it waits (Loading, Skeleton, a busy PanelState). */
const WAIT = ':scope > :is(.rg-loading,.rg-skel-stack,.rg-pstate[aria-busy="true"])'

/** True when this component first rendered while waiting and `ready` has since turned true: the
 *  content in front of the reader replaced a placeholder. Content that was ready at once never fades. */
export function useLandedFlag(ready) {
  const [waited] = useState(!ready)
  return !!ready && waited
}

const DOC_WAIT = '.rg-loading,.rg-state,.rg-skel-stack'
/** One watcher for every document pane (.rg-doc): when its loading state is replaced, the new page fades in once. */
export function watchDocuments(root) {
  if (!root || typeof MutationObserver === 'undefined') return () => {}
  // React removes the loading state and adds the page in separate records: a document that has shown a
  // loading state is remembered until a page lands in it
  const waited = new WeakSet()
  const isWait = (n) => n.nodeType === 1 && n.matches(DOC_WAIT)
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      const doc = r.target
      if (!doc.classList || !doc.classList.contains('rg-doc')) continue
      if ([...r.addedNodes].some(isWait) || [...r.removedNodes].some(isWait)) waited.add(doc)
      const pages = [...r.addedNodes].filter((n) => n.nodeType === 1 && !isWait(n))
      if (!pages.length || !waited.has(doc)) continue
      waited.delete(doc)
      for (const n of pages) n.classList.add('rg-landed')
    }
  })
  mo.observe(root, { childList: true, subtree: true })
  return () => mo.disconnect()
}
if (typeof document !== 'undefined' && document.body) watchDocuments(document.body)

/** Watch a page column: when its direct children stop including a placeholder, the children that replaced it
 *  take .rg-landed once. A column rendered with its data already in hand never changes, so nothing fades. */
export function useLanded(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof MutationObserver === 'undefined') return undefined
    let waited = !!el.querySelector(WAIT)
    const mo = new MutationObserver(() => {
      const waiting = !!el.querySelector(WAIT)
      if (waiting) { waited = true; return }
      if (!waited) return
      waited = false
      for (const c of el.children) if (!c.matches('.rg-ph,.rg-demo,.rg-prov')) c.classList.add('rg-landed')
    })
    mo.observe(el, { childList: true })
    return () => mo.disconnect()
  }, [ref])
}
