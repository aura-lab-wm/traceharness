/* ====================================================================================
   Rig · context.js — the shell's React context. Views reach the shell ONLY through useRig().

   useRig() returns (full list in /home/claude/rigspec/CONTRACT.md):
     state                      parsed route state (route.js parseHash shape)
     openTab(spec, opts?)       opts: { side: bool (open in the other pane), replace: bool
                                (replace the active tab), chain: {dir,qid}|null (evidence chain;
                                default: a run:/span: tab opened from a chained tab inherits it) }
     replaceTab(spec)           closeTab(pane, i)      focusTab(pane, i)
     rewriteTab(from, to, pane?) rewrites an open tab's spec in place, in one pane (default: the focused
                                one): a page's selections (viewState.js)
     isHere(spec, pane?)        true when spec is the page drawn in that pane as it is shown now (the
                                shell's "you are here": a control that would open it renders inert)
     setDock(id|null)           toggleDock(id)         setPalette(bool)
     maximized                  bool: rail/status bar folded, focused pane only (hash max=1)
     setMax(bool)               toggleMax()            (browser full screen follows on a gesture)
     oracle                     'visible'|'hidden'|'strengthened'       setOracle(oracle)
     openOracle()               opens the status bar's oracle menu (the one oracle control)
     condition                  {dir, model, harness} of the focused tab (resolved) | null; with no
                                dataset tab in focus, the dataset last in focus (stored as 'rig.dataset')
     conditionFor(dir)          {dir, model, harness} remembered for dir, else the default
     setCondition({dir?, model?, harness?})   drives status bar, Asking… sentence and the
                                focused tab (via its view's retarget)
     lab / setLab(bool)         Student Lab (stored as 'hs.studentLab')
     theme ('dark'|'light'|'contrast')    themePref ('dark'|'light'|'contrast'|'system')
                                setTheme(pref) (stored as 'rig.theme'); dark is Graphite, light is
                                Paper, contrast is High contrast
     cvd / setCvd(bool)         colour-blind safe status colours (stored as 'rig.cvd', applied as
                                data-rig-cvd="1": Pass blue, Fail orange)
     startTour()                replays the first-visit tour (Help › Take the tour)
     isMobile                   true at <= 760px
     focusCtx                   ctx() of the focused tab, condition filled in
     selection                  {kind, args} selected in the focused tab (hash sel=), or null
     select(kind, ...args)      select something (null kind clears); the inspector opens on it
     openCondition(anchor)      opens the model × harness menu under `anchor`
     toast(message)             transient status line
   useTabState(spec, key, init) per-tab UI state (search boxes, filters, pages) that survives
                                switching tabs but is NOT deep-linked.
   usePane()                  { pi, focused, el } of the pane a view is drawn in (el: the pane node,
                                where the inspector slides over)
   ==================================================================================== */
import { createContext, useCallback, useContext, useState } from 'react'

export const RigContext = createContext(null)
export const PaneContext = createContext({ pi: 0, focused: true, el: null })
export function usePane() { return useContext(PaneContext) }

const FALLBACK = {
  state: null, openTab: () => {}, replaceTab: () => {}, closeTab: () => {}, focusTab: () => {}, rewriteTab: () => {}, isHere: () => false,
  maximized: false, setMax: () => {}, toggleMax: () => {},
  setDock: () => {}, toggleDock: () => {}, setPalette: () => {}, oracle: 'hidden', setOracle: () => {}, openOracle: () => {},
  condition: null, conditionFor: (dir) => ({ dir, model: null, harness: null }), setCondition: () => {},
  lab: false, setLab: () => {}, theme: 'dark', themePref: 'dark', setTheme: () => {}, cvd: false, setCvd: () => {}, isMobile: false,
  focusCtx: {}, toast: () => {}, startTour: () => {}, selection: null, select: () => {}, openCondition: () => {}, bumpCrumbs: () => {},
}

export function useRig() { return useContext(RigContext) || FALLBACK }

const tabStore = new Map()
export function useTabState(spec, key, init) {
  const k = spec + '\u0000' + key
  const read = () => (tabStore.has(k) ? tabStore.get(k) : typeof init === 'function' ? init() : init)
  const [st, setSt] = useState(() => ({ k, v: read() }))
  // a page that stays mounted while its key changes (another event of a ledger, another run of a task) shows
  // the state kept under the new key, not the old one's
  let v = st.v
  if (st.k !== k) { v = read(); setSt({ k, v }) }
  const set = useCallback((next) => {
    setSt((prev) => {
      const cur = prev.k === k ? prev.v : (tabStore.has(k) ? tabStore.get(k) : typeof init === 'function' ? init() : init)
      const val = typeof next === 'function' ? next(cur) : next
      tabStore.set(k, val)
      return { k, v: val }
    })
  }, [k]) // eslint-disable-line react-hooks/exhaustive-deps
  return [v, set]
}
export function resetTabState() { tabStore.clear() }
/** A tab's state outside React (a view's crumbs read whether its step panel is open). */
export const peekTabState = (spec, key) => tabStore.get(spec + '\u0000' + key)
