/* ====================================================================================
   Rig · RigApp.jsx — the workbench shell at #/rig, TraceHarness's one UI (ported from the Rig prototype:
   directions/rig/src/00_core.js, 90_boot.js, shell.html, style.css).

   The Collection on the app ground (Collection.jsx: the logo, the dataset with its condition and oracle,
   the dataset's pages 01–12, the tools; Help, Settings) · ONE rounded main panel with one or two panes of document tabs (split with
   Ctrl/⌘-\); each pane's head carries its breadcrumb or tabs and the page's actions, and the
   right-hand pane's head the console's controls (search, Buddy, split, maximize, theme) ·
   bottom dock (Buddy / Case file) and a right-hand panel (Event log /
   Capture watcher: docks registered with `side: true`) ·
   a quiet status bar (connection, running jobs, runs waiting, a new version) · command
   palette (⌘K / Ctrl-K; ↑↓ ↵, ⌘↵ opens to the side) · the first-visit tour (Tour.jsx) · phone layout (single tab, switcher
   sheet, full-screen palette, dock as bottom sheet) · theme scoped to the Rig root ·
   maximize (Ctrl/⌘-Shift-Enter, or double-click a tab): rail and status bar fold away, the
   focused pane takes the window, and the browser goes full screen where it allows it.

   The hash is the state (route.js). Views are looked up in the registry by kind. Views talk to
   the shell only through useRig() (context.js). Nothing here writes to the backend.
   ==================================================================================== */
import { DISPLAY_CLASSES, up, below } from './displayClasses'
import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { IS_STATIC } from '../api'
import { parseHash, toHash, parseSpec, makeSpec, withChain, specKind, isRigHash, makeSel, parseSel, SUITES } from './route'
import { RigContext, PaneContext, useRig } from './context'
import Collection, { BrandMark, DatasetSwitch } from './Collection'
import { navModel, alsoCalled } from './navTree'
import { getView, listDocks } from './registry'
import { useApi, paths, useOverview, useJobs, useCacheVersion, useConnection, normOverview, peek, findRunCached, resolveCondition, short } from './data'
import { useCaseFile } from './caseFile'
import { useBuildWatch } from './buildWatch'
import { evidenceOrigin } from './shallowEvidence'
import { mountKey, canonSpec, pageKey } from './harnessViews'
import { noteVisit } from './recent'
import { ensureEntry, nextEntryId, setCurrentEntry, currentEntry, noteScroll, recallEntry, recallTab, quiet, scrollKey, saveScrolls, restoreScrolls } from './navMemory'
import GettingStarted from './GettingStarted'
import HelpMenu, { helpItems } from './HelpMenu'
import { LEARN_HOME } from './learn/routes'
import { learnHelpDesc } from './learn/gate'
import Tour, { PAGE_TOURS, GENERAL_PAGE_TOUR, pageTourKey } from './Tour'
import TourButton, { useTourPulse } from './TourButton'
import TourOffer from './TourOffer'
import { HintLayer } from './HoverCard'
import { GUIDE_TOPICS, guideDestination } from './guidance'
import { usePausedCount } from './PausePanel.jsx'
import { THEME_KEY, CVD_KEY, readTheme, writeTheme, nextTheme, resolveTheme, THEME_NAMES, readCvd, writeCvd, readDataset, writeDataset, readTourDone, writeTourDone } from './prefs'
import Palette from './PaletteDialog'
import { harnessNote, modelLine } from './datasetInfo'
import { EntityName } from './EntityDot'
import { harnessLine } from './HarnessName'
import { Icon, Kbd, MOD, NotFound, EvidenceChain, Toaster, toast as showToast, Seg, NextSteps, Menu, ScrollX, Modal, useSize, StatusIcon } from './ui'

const cx = (...a) => a.filter(Boolean).join(' ')
import './rig.css'
import './palette.css'
import './feel.css'

const LAB_KEY = 'hs.studentLab'
const NAV_KEY = 'rig.nav'
const DOCKW_KEY = 'rig.dockW'
/* The sidebar opens with labels on a laptop or wider; the reader's own choice wins after that. */
const readNav = () => { try { const v = localStorage.getItem(NAV_KEY); if (v === 'open' || v === 'closed') return v === 'open' } catch { /* blocked */ } return typeof window === 'undefined' || window.innerWidth >= DISPLAY_CLASSES.laptop }
const writeNav = (open) => { try { localStorage.setItem(NAV_KEY, open ? 'open' : 'closed') } catch { /* this visit only */ } }
const DOCK_MIN = 320, DOCK_DEFAULT = 420
const clampDock = (w) => Math.round(Math.max(DOCK_MIN, Math.min(w, (typeof window !== 'undefined' ? window.innerWidth : 1600) * 0.6)))
const readDockW = () => { try { const n = Number(localStorage.getItem(DOCKW_KEY)); return Number.isFinite(n) && n > 0 ? n : DOCK_DEFAULT } catch { return DOCK_DEFAULT } }
const readLab = () => { try { return localStorage.getItem(LAB_KEY) === 'on' } catch { return false } }
const writeLab = (on) => { try { localStorage.setItem(LAB_KEY, on ? 'on' : 'off'); return true } catch { return false } }
const validTheme = (t) => (THEME_NAMES[t] ? t : 'light')
const mq = (q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null)

function useMedia(query) {
  const [on, setOn] = useState(() => !!(mq(query) && mq(query).matches))
  useEffect(() => {
    const m = mq(query); if (!m) return
    const f = () => setOn(m.matches)
    f()
    if (m.addEventListener) m.addEventListener('change', f)
    else m.addListener(f)
    return () => (m.removeEventListener ? m.removeEventListener('change', f) : m.removeListener(f))
  }, [query])
  return on
}

/* ---------------------------------------------------------------- per-tab helpers */
const env = () => {
  const ov = peek('/overview')
  const n = ov ? normOverview(ov) : null
  return { peek, findRun: findRunCached, dataset: (dir) => (n ? n.results.find((r) => r.name === dir) || null : null), datasets: n ? n.results : [] }
}
function tabInfo(spec) {
  const { kind, args } = parseSpec(spec)
  const def = getView(kind)
  if (!def) return { title: 'not found', tag: '404', def: null, kind, args }
  let title = kind
  try { title = def.title ? def.title(args, env()) : kind } catch { title = kind }
  return { title: title || kind, tag: def.tag || kind, def, kind, args }
}
/** The chain a tab carries: explicit `~q:` suffix, or implied by a q:<dir>:<qid> spec. */
function chainOf(spec) {
  const { kind, args, chain } = parseSpec(spec)
  if (chain) return chain
  if (kind === 'q' && args[0] && args[1]) return { dir: args[0], qid: args[1] }
  return null
}
/** Pages that show one condition of a dataset, and where their model is. */
const COND_KINDS = { ds: 1, an: 2, tasks: 1 }
/** The dataset page a condition page belongs to (ds:<dir>, an:<dir>:<view>, tasks:<dir>), or null. */
function condKey(spec) {
  const { kind, args } = parseSpec(spec)
  if (COND_KINDS[kind] == null || !args[0]) return null
  return kind === 'an' ? `an:${args[0]}:${args[1] || 'family'}` : `${kind}:${args[0]}`
}
/** The same, for a link that names no condition (ds:<dir>): it means any open condition of that page. */
function bareKey(spec) {
  const { kind, args } = parseSpec(spec)
  const at = COND_KINDS[kind]
  return at == null || !args[0] || args[at] ? null : condKey(spec)
}
function chainStep(spec) {
  const { kind, args } = parseSpec(spec)
  if (kind === 'q') return args[2] === 'figure' ? 'figure' : args[2] === 'runs' ? 'runs' : 'answer'
  if (kind === 'run') return 'run'
  if (kind === 'span') return 'event'
  return null
}

class Boundary extends Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(e) { if (typeof console !== 'undefined') console.warn('[rig] view crashed:', e && e.message) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="rg-state rg-errstate" data-el="view-crash" role="alert">
        <div className="rg-empty-t"><StatusIcon status="error" decorative /><b>This view failed while drawing.</b></div>
        <p className="rg-empty-why">The document hit an error while rendering, so nothing is shown in its place. Retry, or go back to the datasets; the rest of the workbench still works.</p>
        <p className="rg-errstate-msg"><span className="rg-mute">Error · </span><span className="rg-mono">{String(this.state.error.message || this.state.error)}</span> <span className="rg-mute rg-mono">({this.props.spec})</span></p>
        <NextSteps actions={[{ label: 'Retry', onClick: () => this.setState({ error: null }), primary: true }, this.props.onBack && { label: 'Back to datasets', onClick: this.props.onBack }]} />
      </div>
    )
  }
}


/* ================================================================ the shell */
export default function RigApp() {
  const [route, setRoute] = useState(() => parseHash(typeof location !== 'undefined' ? location.hash : ''))
  const routeRef = useRef(route)
  routeRef.current = route
  const [lab, setLabState] = useState(readLab)
  const [themePref, setThemePref] = useState(readTheme)
  const [cvd, setCvdState] = useState(readCvd)
  const [lastFocus, setLastFocus] = useState(readDataset)   // the dataset in focus last: this visit, else the last one
  const [pop, setPop] = useState(null)          // { id: 'cond'|'oracle', left } | null
  const [keysOpen, setKeysOpen] = useState(false)   // the ? shortcut sheet (not deep-linked)
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [tour, setTour] = useState(null)        // { step, saved: route state to restore } while the tour runs
  const tourRef = useRef(tour)
  tourRef.current = tour
  const [guideTarget, setGuideTarget] = useState(null)
  const [navOpen, setNavOpenState] = useState(readNav)
  const navOpenRef = useRef(navOpen)
  navOpenRef.current = navOpen
  const setNavOpen = useCallback((open) => { setNavOpenState(open); writeNav(open) }, [])
  const [dockW, setDockWState] = useState(readDockW)
  const setDockW = useCallback((w) => { const v = clampDock(w); setDockWState(v); try { localStorage.setItem(DOCKW_KEY, String(v)) } catch { /* this visit only */ } }, [])
  const isMobile = useMedia(below('tablet'))
  // 761–1099px: the opened sidebar lies over the document instead of taking 224px from it
  const navOverlay = useMedia(`${up('tablet')} and ${below('tablet-wide')}`)
  const prefersLight = useMedia('(prefers-color-scheme: light)')
  const prefersMore = useMedia('(prefers-contrast: more)')
  const workRef = useRef(null)
  const workW = useSize(workRef).width
  const ov = useOverview()
  const jobs = useJobs()
  const waiting = usePausedCount(jobs.data.running > 0)   // an idle console asks nothing; a run started from a terminal is on the Waiting tab
  const caseItems = useCaseFile()
  const cacheV = useCacheVersion()   // titles and ctx() read the cache synchronously
  const online = useConnection()
  const build = useBuildWatch()
  const wasOnline = useRef(true)
  useEffect(() => {
    if (online && !wasOnline.current) showToast('Reconnected to the local server — refreshed what had failed')
    wasOnline.current = online
  }, [online])

  /* ---- hash <-> state. Each entry the shell pushes carries an id (navMemory.js): the scroll of the page it
     leaves is kept under the old entry, and Back or Forward put it back. */
  const commit = useCallback((next, replace = false) => {
    const h = toHash(next)
    if (location.hash !== h) {
      try {
        if (replace) history.replaceState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), rig: currentEntry() }, '', h)
        else { saveScrolls(); const id = nextEntryId(); history.pushState({ rig: id }, '', h); setCurrentEntry(id) }
      } catch { location.hash = h }
    }
    routeRef.current = next
    setRoute(next)
  }, [])
  const restoreAt = useRef(null)   // the entry whose scroll to put back once its route is drawn (Back, Forward)
  const scrollPlan = useRef(null)  // where the page openTab or focusTab just showed goes: { pi, back: {top}|null (the top) }
  useEffect(() => {
    ensureEntry()
    const on = () => {
      if (!isRigHash(location.hash)) return
      const s = parseHash(location.hash)
      saveScrolls()   // the page still drawn belongs to the entry being left: keep where it was, for Forward
      restoreAt.current = ensureEntry()
      quiet(1500)
      routeRef.current = s; setRoute(s)
    }
    window.addEventListener('popstate', on)
    window.addEventListener('hashchange', on)
    // every scroll of a drawn document is remembered for the entry in view (and for its tab)
    const onScroll = (e) => {
      const t = e.target
      if (t === document || t === document.documentElement) {
        const d = document.getElementById('rig-doc-main')
        if (d) noteScroll(scrollKey(d), d.scrollTop, window.scrollY)
      } else if (t && t.classList && t.classList.contains('rg-doc') && t.dataset.spec != null) noteScroll(scrollKey(t), t.scrollTop, window.scrollY)
    }
    document.addEventListener('scroll', onScroll, true)
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); document.removeEventListener('scroll', onScroll, true) }
  }, [])
  useLayoutEffect(() => {
    const plan = scrollPlan.current
    scrollPlan.current = null
    if (plan) {
      const d = document.querySelector(`.rg-doc[data-doc="${plan.pi}"]`)
      if (d) { quiet(200); d.scrollTop = plan.back ? plan.back.top : 0 }
      if (!plan.back && window.scrollY > 0 && typeof window.scrollTo === 'function') window.scrollTo(0, 0)
    }
    const entry = restoreAt.current
    if (entry == null) return
    restoreAt.current = null
    restoreScrolls((el) => recallEntry(entry, scrollKey(el)))
  }, [route])
  // one-shot `lab=1|0` in a link: apply, persist, drop from the hash
  useEffect(() => {
    if (route.lab == null) return
    writeLab(route.lab); setLabState(route.lab)
    commit({ ...route, lab: null }, true)
  }, [route.lab]) // eslint-disable-line react-hooks/exhaustive-deps
  // another tab's Settings may flip Student Lab, the theme or the status colours
  useEffect(() => {
    const on = (e) => { if (e.key === LAB_KEY) setLabState(readLab()); if (e.key === THEME_KEY) setThemePref(readTheme()); if (e.key === CVD_KEY) setCvdState(readCvd()) }
    window.addEventListener('storage', on)
    return () => window.removeEventListener('storage', on)
  }, [])

  const pref = route.theme || themePref
  const theme = resolveTheme(pref, { light: prefersLight, more: prefersMore })

  /* ---- panes */
  const panes = route.panes
  const focus = Math.min(route.focus, panes.length - 1)
  const curPane = panes[focus] || panes[0]
  const curSpec = curPane.tabs[curPane.active]
  const curSpecRef = useRef(curSpec)
  curSpecRef.current = curSpec

  // the condition a dataset page shows when its link names none (a bare ds:<dir>); set once conditionFor exists
  const resolveRef = useRef(() => null)
  const openTab = useCallback((spec, opt = {}) => {
    const s0 = routeRef.current
    let target = String(spec)
    const cur = s0.panes[s0.focus] || s0.panes[0]
    const from = cur.tabs[cur.active]
    if (opt.chain !== undefined) target = withChain(target, opt.chain)
    else if (['run', 'span'].includes(specKind(target)) && !target.includes('~')) {
      const ch = chainOf(from)
      if (ch) target = withChain(target, ch)
    }
    const side = !!opt.side && !(typeof window !== 'undefined' && window.innerWidth < DISPLAY_CLASSES.tablet)
    const resolve = resolveRef.current
    const same = (a, b) => canonSpec(a, resolve) === canonSpec(b, resolve)
    setPop(null)
    // you are here: the page in view, asked for again, changes nothing (no history entry; the scroll, the
    // selection and the focus stay). Only a palette or the document sheet it was picked from closes.
    if (!side && same(target, from)) {
      if (s0.pal || s0.sheet) commit({ ...s0, pal: false, sheet: null }, true)
      return
    }
    const st = { ...s0, panes: s0.panes.map((p) => ({ ...p, tabs: [...p.tabs] })), pal: false, sheet: null, sel: null }
    if (side) {
      if (st.panes.length < 2) st.panes.push({ tabs: [], active: 0 })
      st.focus = st.focus === 0 ? 1 : 0
    }
    const p = st.panes[st.focus]
    const shown = p.tabs[p.active]
    const key = pageKey(target, resolve)
    // the page already open: the tab showing exactly this, else the tab in view when it holds this page
    // (a step, a facet, a view of it), else any tab holding this page; a dataset link that names no
    // condition (ds:<dir>) is any open tab of that dataset's page
    let i = p.tabs.findIndex((t) => same(t, target))
    if (i < 0 && shown != null && pageKey(shown, resolve) === key) i = p.active
    if (i < 0) i = p.tabs.findIndex((t) => pageKey(t, resolve) === key)
    if (i < 0) { const b = bareKey(target); if (b) i = p.tabs.findIndex((t) => condKey(t) === b) }
    if (i >= 0) { if (!same(p.tabs[i], target) && !bareKey(target)) p.tabs[i] = target }
    else if (opt.replace && p.tabs.length) { p.tabs[p.active] = target; i = p.active }
    else if (!p.tabs.length) { p.tabs.push(target); i = 0 }
    else { p.tabs.splice(p.active + 1, 0, target); i = p.active + 1 }
    // the page in view stays mounted (a step, a run of the task, an evidence tab, an event): its
    // selection, scroll and focus stay
    const stays = !side && i === p.active && shown != null && mountKey(p.tabs[i]) === mountKey(shown)
    const wasOpen = !stays && i !== p.active && s0.panes[st.focus] && s0.panes[st.focus].tabs.includes(p.tabs[i])
    p.active = i
    // `keepSel`: another run of the same condition keeps its Run facts panel open (RunPage's run numbers)
    if (stays || opt.keepSel) st.sel = s0.sel
    // a switch inside one document (a step, another run of the task, a tab of the page) rewrites the
    // history entry, so Back leaves the document instead of replaying every step
    // a new page opens at the top; a tab already open comes back where it was left. It is done as the page is
    // drawn, before the page's own effects, so a page that scrolls itself (a question's figure) wins.
    if (!stays) scrollPlan.current = { pi: st.focus, back: wasOpen ? recallTab(`${st.focus}|${mountKey(p.tabs[i])}`) : null }
    commit(st, opt.history === 'replace')
  }, [commit])
  /** Switch the focused tab in place: a step, another run, a tab of the page. One history entry for all. */
  const replaceTab = useCallback((spec) => openTab(spec, { replace: true, history: 'replace' }), [openTab])
  /** Rewrite an open tab's spec in place: a page's own selections (viewState.js). Only pane `pi` (the pane
   *  the page is drawn in; by default the focused one): the same page in the other pane keeps its own. The
   *  history entry is rewritten, the selection and the scroll stay. */
  const rewriteTab = useCallback((from, to, pi) => {
    const s0 = routeRef.current
    const at = Number.isInteger(pi) && s0.panes[pi] ? pi : s0.focus
    if (from === to || !(s0.panes[at] && s0.panes[at].tabs.includes(from))) return
    commit({ ...s0, panes: s0.panes.map((p, k) => (k === at ? { ...p, tabs: p.tabs.map((t) => (t === from ? to : t)) } : p)) }, true)
  }, [commit])
  /** Leave the focused tab for `spec`: an open tab of that document (`same(tab)`) takes the focus and the
   *  focused tab closes; with none open, the focused tab becomes `spec`. One history entry, so Back returns. */
  const leaveTo = useCallback((spec, same = (t) => t === spec) => {
    const s0 = routeRef.current
    const st = { ...s0, panes: s0.panes.map((p) => ({ ...p, tabs: [...p.tabs] })), sel: null, sheet: null }
    const p = st.panes[st.focus]
    if (!p) return
    const cur = p.active
    const j = p.tabs.findIndex((t, k) => k !== cur && same(t))
    if (j < 0) p.tabs[cur] = spec
    else { p.tabs.splice(cur, 1); p.active = j > cur ? j - 1 : j }
    commit(st)
  }, [commit])
  const closeTab = useCallback((pi, i) => {
    const s0 = routeRef.current
    const st = { ...s0, panes: s0.panes.map((p) => ({ ...p, tabs: [...p.tabs] })), sheet: null, sel: null }
    const p = st.panes[pi]; if (!p) return
    p.tabs.splice(i, 1)
    if (p.active >= p.tabs.length) p.active = p.tabs.length - 1
    else if (i < p.active) p.active--
    if (!p.tabs.length) {
      if (st.panes.length > 1) { st.panes.splice(pi, 1); st.focus = 0 } else { p.tabs = ['start']; p.active = 0 }   // no tab open: Home
    }
    st.focus = Math.min(st.focus, st.panes.length - 1)
    commit(st)
  }, [commit])
  const focusTab = useCallback((pi, i, opt = {}) => {
    const s0 = routeRef.current
    const same = s0.focus === pi && (s0.panes[pi] || {}).active === i
    const st = { ...s0, panes: s0.panes.map((p, k) => (k === pi ? { ...p, active: i } : p)), focus: pi, sheet: null, sel: same ? s0.sel : null }
    // another tab of the pane comes back where it was left
    const tab = (s0.panes[pi] || {}).active === i ? null : (st.panes[pi] || {}).tabs[i]
    if (tab) scrollPlan.current = { pi, back: recallTab(`${pi}|${mountKey(tab)}`) }
    // the pane under a press takes the focus without an entry of its own (the press itself may make one)
    commit(st, !!opt.quiet)
  }, [commit])
  const toggleSplit = useCallback(() => {
    const s0 = routeRef.current
    const st = { ...s0, panes: s0.panes.map((p) => ({ ...p, tabs: [...p.tabs] })), sel: null }
    if (st.panes.length > 1) {
      const b = st.panes.pop(); const a = st.panes[0]
      for (const t of b.tabs) if (!a.tabs.includes(t)) a.tabs.push(t)
      st.focus = 0
    } else {
      const a = st.panes[0]
      st.panes.push({ tabs: [a.tabs[a.active]], active: 0 }); st.focus = 1
    }
    commit(st)
  }, [commit])
  const setDock = useCallback((id) => commit({ ...routeRef.current, dock: id || null }, true), [commit])
  const toggleDock = useCallback((id) => commit({ ...routeRef.current, dock: routeRef.current.dock === id ? null : id }, true), [commit])
  const setPalette = useCallback((on) => commit({ ...routeRef.current, pal: !!on, sheet: null }, true), [commit])
  const setSheet = useCallback((v) => commit({ ...routeRef.current, sheet: v, pal: false }, true), [commit])
  // the selection of the focused tab lives in the hash (sel=), so a link reopens the same evidence
  const select = useCallback((kind, ...args) => {
    const s0 = routeRef.current
    const sel = kind ? makeSel(kind, ...args) : null
    if (sel !== s0.sel) commit({ ...s0, sel }, true)
  }, [commit])
  const conditionRef = useRef(null)
  const showGuidance = useCallback((topic, context = {}) => {
    if (!GUIDE_TOPICS.includes(topic)) return
    // a page about no dataset (Datasets, Add data) guides to the dataset in focus last, as the left list does
    const destination = guideDestination(topic, context && context.dir ? context : conditionRef.current || {})
    if (destination) openTab(destination)
    if (['buddy', 'case'].includes(topic.destination)) setDock(topic.destination)
    setGuideTarget(topic.target ? { selector: topic.target } : null)
  }, [openTab, setDock])
  useEffect(() => {
    if (!guideTarget) return
    let target, previousIndex, restoreTimer
    const observer = new MutationObserver(reveal)
    function reveal() {
      const root = document.querySelector('.rg-pane.focus') || document.getElementById('rig-doc-main')
      const found = root?.querySelector(guideTarget.selector)
      if (!found) return
      observer.disconnect(); target = found
      for (let node = target; node && node !== root; node = node.parentElement) {
        if (node.tagName === 'DETAILS' && !node.open) node.open = true
      }
      previousIndex = target.getAttribute('tabindex'); target.setAttribute('tabindex', '-1')
      target.setAttribute('data-guide-spotlight', 'true')
      target.scrollIntoView?.({ block: 'center', behavior: 'auto' }); target.focus({ preventScroll: true })
      restoreTimer = setTimeout(() => target?.removeAttribute('data-guide-spotlight'), 6000)
    }
    observer.observe(document.getElementById('rig-doc-main') || document.body, { childList: true, subtree: true })
    reveal()
    const timeout = setTimeout(() => observer.disconnect(), 6000)
    return () => {
      observer.disconnect(); clearTimeout(timeout); clearTimeout(restoreTimer)
      if (target) { target.removeAttribute('data-guide-spotlight'); if (previousIndex === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', previousIndex) }
    }
  }, [guideTarget, curSpec])
  const setOracle = useCallback((o) => { if (SUITES.includes(o)) commit({ ...routeRef.current, oracle: o }) }, [commit])
  const setLab = useCallback((on) => {
    const ok = writeLab(on); setLabState(on)
    showToast(ok ? `Student Lab ${on ? 'on' : 'off'}` : `Student Lab ${on ? 'on' : 'off'} for this visit only — browser storage is unavailable`)
  }, [])
  // Maximize is in-app first (hash max=1, so it survives a reload); browser full screen is a
  // bonus taken only on a user gesture, and leaving it (the browser's own Esc) leaves maximize.
  const ownFullscreen = useRef(false)
  const setMax = useCallback((on) => {
    const s0 = routeRef.current
    if (!!s0.max === !!on) return
    commit({ ...s0, max: !!on }, true)
    try {
      if (on && document.fullscreenEnabled && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        const p = document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        ownFullscreen.current = true
        if (p && p.catch) p.catch(() => { ownFullscreen.current = false })
      } else if (!on && ownFullscreen.current && document.fullscreenElement && document.exitFullscreen) {
        ownFullscreen.current = false
        const p = document.exitFullscreen(); if (p && p.catch) p.catch(() => {})
      }
    } catch { ownFullscreen.current = false }
  }, [commit])
  const toggleMax = useCallback(() => setMax(!routeRef.current.max), [setMax])
  useEffect(() => {
    const on = () => { if (!document.fullscreenElement && ownFullscreen.current) { ownFullscreen.current = false; if (routeRef.current.max) commit({ ...routeRef.current, max: false }, true) } }
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [commit])
  const setTheme = useCallback((t) => { writeTheme(t); setThemePref(validTheme(t)); if (routeRef.current.theme) commit({ ...routeRef.current, theme: null }, true) }, [commit])
  const cycleTheme = useCallback(() => setTheme(nextTheme(pref)), [setTheme, pref])
  const setCvd = useCallback((on) => {
    const ok = writeCvd(on); setCvdState(!!on)
    showToast(`Colour-blind safe status colours ${on ? 'on' : 'off'}${ok ? '' : ' for this visit only — browser storage is unavailable'}`)
  }, [])

  /* ---- the site tour: each step shows one page; the reader's own layout comes back at the end. A first
     visit only offers it (TourOffer), so a deep link opens its own page. A page tour ("Guide me through
     this page") walks the page in view and never navigates. */
  const [offer, setOffer] = useState(() => !readTourDone())
  const startTour = useCallback(() => {
    setPop(null); setKeysOpen(false); setVoiceOpen(false); setOffer(false)
    setTour({ step: 0, saved: { ...routeRef.current, pal: false, sheet: null } })
  }, [])
  // from Help or ⌘K (an event or nothing) the page in focus; from a page's "Tour this page" chip, that page's spec
  const startPageTour = useCallback((spec) => {
    setPop(null); setKeysOpen(false); setVoiceOpen(false); setOffer(false)
    const key = pageTourKey(typeof spec === 'string' ? spec : curSpecRef.current)
    setTour({ step: 0, page: key || 'general' })
  }, [])
  const dismissOffer = useCallback(() => { writeTourDone(); setOffer(false) }, [])
  const tourGo = useCallback((spec) => {
    commit({ ...routeRef.current, panes: [{ tabs: [spec], active: 0 }], focus: 0, dock: null, pal: false, sheet: null, max: false }, true)
  }, [commit])
  const endTour = useCallback(() => {
    const t = tourRef.current
    if (!t || !t.page) writeTourDone()
    const saved = t && t.saved
    setTour(null)
    if (saved) commit(saved, true)
  }, [commit])

  /* ---- condition */
  const datasets = ov.data ? ov.data.results : []
  const rowOf = useCallback((dir) => datasets.find((r) => r.name === dir) || null, [datasets])
  const conditionFor = useCallback((dir) => {
    const row = rowOf(dir)
    const mem = route.cond && route.cond.dir === dir ? route.cond : null
    return row ? resolveCondition(row, mem && mem.model, mem && mem.harness) : { dir, model: null, harness: null }
  }, [rowOf, route.cond])
  resolveRef.current = conditionFor
  const ctxOf = useCallback((spec) => {
    const { kind, args } = parseSpec(spec)
    const source = ['harnesses', 'shallowCards', 'shallowWizard', 'shallowApply', 'blocks'].includes(kind) ? evidenceOrigin(args) : null
    const contextSpec = source ? parseSpec(source) : { kind, args }
    const def = getView(contextSpec.kind)
    let raw = {}
    try { raw = (def && def.ctx && def.ctx(contextSpec.args, env())) || {} } catch { raw = {} }
    if (!raw.dir) return raw
    const row = rowOf(raw.dir)
    if (!row) return raw
    if (raw.model || raw.harness) { const c = resolveCondition(row, raw.model, raw.harness); return { ...raw, ...c } }
    return { ...raw, ...conditionFor(raw.dir) }
  }, [rowOf, conditionFor])
  const focusCtx = useMemo(() => ctxOf(curSpec), [ctxOf, curSpec, cacheV]) // eslint-disable-line react-hooks/exhaustive-deps
  // Event log and Capture watcher are side panels: they follow the document, so they sit beside it.
  const sideDock = !!(route.dock && (listDocks().find((d) => d.id === route.dock) || {}).side)
  const biggest = [...datasets].sort((a, b) => (a.kind === b.kind ? b.runs - a.runs : a.kind === 'recorded' ? -1 : 1))[0]
  // a tab about a dataset that is not in the library (a not-found tab) does not set the condition
  const focusDir = focusCtx.dir && (!ov.data || rowOf(focusCtx.dir)) ? focusCtx.dir : null
  // a page about no dataset (Add data, Settings, Help) keeps the dataset that was in focus last — this
  // visit, else the last one — while it is still in the library; only then the biggest one
  const condDir = route.cond && route.cond.dir
  const [seenCond, setSeenCond] = useState(condDir)
  if (condDir !== seenCond) { setSeenCond(condDir); if (condDir) setLastFocus(condDir) }
  if (focusDir && focusDir !== lastFocus) setLastFocus(focusDir)
  const lastDir = lastFocus && rowOf(lastFocus) ? lastFocus : null
  const fallbackDir = focusDir || lastDir || condDir || (biggest && biggest.name) || null
  const condition = focusDir ? { dir: focusDir, model: focusCtx.model, harness: focusCtx.harness } : (fallbackDir ? conditionFor(fallbackDir) : null)
  const conditionDir = condition && rowOf(condition.dir) ? condition.dir : null
  conditionRef.current = conditionDir ? condition : null
  useEffect(() => { if (conditionDir) writeDataset(conditionDir) }, [conditionDir])
  // Home's "Pick up where you left off": the last dataset, task and run opened in this browser (recent.js)
  const visitDir = focusCtx.dir || null, visitTask = focusCtx.task || null, visitRun = focusCtx.run || null
  useEffect(() => {
    try { noteVisit(localStorage, curSpec, { dir: visitDir, task: visitTask, run: visitRun }) } catch { /* no storage: nothing is remembered */ }
  }, [curSpec, visitDir, visitTask, visitRun])

  const setCondition = useCallback((ch) => {
    const s0 = routeRef.current
    const p0 = s0.panes[s0.focus] || s0.panes[0]
    const spec = p0.tabs[p0.active]
    const cur = ctxOf(spec)
    const dir = ch.dir || cur.dir || fallbackDir
    const row = rowOf(dir)
    if (!row) return
    const same = dir === cur.dir
    const c = resolveCondition(row, ch.model || (same ? cur.model : null), ch.harness || (same ? cur.harness : null))
    const st = { ...s0, cond: { dir: c.dir, model: c.model, harness: c.harness }, panes: s0.panes.map((p) => ({ ...p, tabs: [...p.tabs] })) }
    const { kind, args, chain } = parseSpec(spec)
    const def = getView(kind)
    let next = null
    try { next = def && def.retarget ? def.retarget(args, c) : null } catch { next = null }
    setPop(null)
    // the condition in focus, chosen again: nothing changes, no history entry
    const unchanged = same && c.model === cur.model && c.harness === cur.harness
    if (unchanged && (!next || canonSpec(withChain(next, chain), conditionFor) === canonSpec(spec, conditionFor))) return
    if (next && next !== spec.split('~')[0]) {
      const pane = st.panes[st.focus]
      const target = withChain(next, chain)
      const dup = pane.tabs.indexOf(target)
      if (dup >= 0 && dup !== pane.active) { pane.tabs.splice(pane.active, 1); pane.active = pane.tabs.indexOf(target) } else pane.tabs[pane.active] = target
      commit(st)
    } else if (!next && !same && !(def && def.retarget)) {
      commit(st, true)
      openTab(makeSpec('ds', c.dir, short(c.model), c.harness))
    } else commit(st, true)   // the page stays as it is (a page whose condition is not in its address): only c= changes
  }, [ctxOf, rowOf, fallbackDir, commit, openTab, conditionFor])

  /** Open the oracle menu (the one oracle control) or the condition menu from anywhere: beside a sidebar
   *  item, else under `anchor` (the Asking… line). A second press on the same sidebar item closes it. */
  const openPopAt = useCallback((id, anchor) => {
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null
    const inRail = !!(anchor && anchor.closest && anchor.closest('.rg-rail'))
    setPop(!r ? { id, left: 8 } : inRail ? { id, left: r.right + 8, top: r.top } : { id, left: r.left, top: r.bottom + 4 })
  }, [])
  // model, harness and oracle are changed in one menu, the scope line's Change; a run page, whose model and
  // harness are fixed, offers the oracle alone
  const openOracle = useCallback((anchor) => openPopAt('oracle', anchor), [openPopAt])
  const openCondition = useCallback((anchor) => openPopAt('scope', anchor), [openPopAt])
  const togglePop = useCallback((id, anchor) => { if (pop && pop.id === id) setPop(null); else openPopAt(id, anchor) }, [pop, openPopAt])

  // a view's crumbs can read its own state (a run's step panel open or closed); it asks for them to be drawn again
  const [crumbTick, setCrumbTick] = useState(0)
  const bumpCrumbs = useCallback(() => setCrumbTick((x) => x + 1), [])
  /** Is `spec` the page drawn in pane `pi` (the focused pane by default), as it is shown now? A control that
   *  would open it renders inert and says "you are here" (ui.jsx Go, the left list, the evidence chain). */
  const isHere = useCallback((spec, pi) => {
    if (spec == null) return false
    const p = route.panes[Number.isInteger(pi) && route.panes[pi] ? pi : Math.min(route.focus, route.panes.length - 1)]
    if (!p) return false
    const shown = p.tabs[p.active]
    // a run or event link opened from a chained tab inherits the chain (openTab), so it is compared with it
    let s = String(spec)
    if (['run', 'span'].includes(specKind(s)) && !s.includes('~')) { const ch = chainOf(shown); if (ch) s = withChain(s, ch) }
    return canonSpec(s, conditionFor) === canonSpec(shown, conditionFor)
  }, [route, conditionFor])
  const rig = useMemo(() => ({
    isHere,
    state: route, openTab, replaceTab, leaveTo, closeTab, focusTab, toggleSplit, maximized: !!route.max, setMax, toggleMax, setDock, toggleDock, setPalette,
    oracle: route.oracle, setOracle, openOracle, openCondition, condition, conditionFor, setCondition,
    lab, setLab, theme, themePref: pref, setTheme, cvd, setCvd, isMobile, focusCtx, toast: showToast, datasets, showGuidance, startTour, startPageTour,
    selection: parseSel(route.sel), select,
    rewriteTab, bumpCrumbs, crumbTick,
  }), [isHere, crumbTick, bumpCrumbs, route, openTab, replaceTab, rewriteTab, leaveTo, closeTab, focusTab, toggleSplit, setMax, toggleMax, setDock, toggleDock, setPalette, setOracle, openOracle, openCondition, condition, conditionFor, setCondition, lab, setLab, theme, pref, setTheme, cvd, setCvd, isMobile, focusCtx, datasets, showGuidance, startTour, startPageTour, select])

  /* ---- keyboard */
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      const s = routeRef.current
      const k = (e.key || '').toLowerCase()
      const typing = [e.target, document.activeElement].some((el) => el && typeof el.closest === 'function' && el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))
      if (e.isComposing || tourRef.current) return   // the tour handles its own keys
      if (mod && k === 'k') { e.preventDefault(); setPalette(!s.pal); return }
      if (s.pal) return   // the palette handles its own keys
      if (keysOpen) { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); setKeysOpen(false) } return }
      if (mod && k === 'j') { e.preventDefault(); toggleDock('buddy'); return }
      if (mod && e.key === '\\') { e.preventDefault(); toggleSplit(); return }
      if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); toggleMax(); return }
      if (mod && !e.shiftKey && k === 'b' && !typing) { e.preventDefault(); setNavOpenState((o) => { writeNav(!o); return !o }); return }
      if (!typing && e.altKey && k === 'w') { e.preventDefault(); const p = s.panes[s.focus]; closeTab(s.focus, p.active); return }
      if (!typing && e.altKey && (e.key === ']' || e.key === '[')) {
        e.preventDefault(); const p = s.panes[s.focus]
        focusTab(s.focus, (p.active + (e.key === ']' ? 1 : -1) + p.tabs.length) % p.tabs.length); return
      }
      if (e.key === 'Escape') {
        if (pop) { setPop(null); return }
        // a selection the page cannot show is dropped without spending the Esc on it
        if (s.sel) { const shown = document.querySelector('[data-el~="inspector"]:not([hidden])'); select(null); if (shown) return }
        if (navOverlay && navOpenRef.current) { setNavOpen(false); return }
        if (s.sheet) { setSheet(null); return }
        if (s.dock) { setDock(null); return }
        if (s.max) { setMax(false); return }
        // nothing left open: the page itself may step back (a run returns to its task)
        if (!typing) window.dispatchEvent(new CustomEvent('rig:escape'))
        return
      }
      if (!typing && e.key === '?') { e.preventDefault(); setKeysOpen(true); return }
      if (!typing && !mod && !e.altKey && e.key === 'i') {
        e.preventDefault()
        if (s.sel && document.querySelector('[data-el~="inspector"]:not([hidden])')) select(null)
        else window.dispatchEvent(new CustomEvent('rig:inspect'))
        return
      }
      if (!typing && e.key === '/') {
        const i = document.querySelector('#rig-doc-main input[type=search]')
        if (i) { e.preventDefault(); i.focus() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPalette, toggleDock, toggleSplit, toggleMax, setMax, closeTab, focusTab, setDock, setSheet, select, pop, keysOpen, navOverlay, setNavOpen])

  useEffect(() => {
    const t = tabInfo(curSpec).title
    document.title = `${t} · TraceHarness`
  })
  // A new page opened from a control that left with the old page (a link, a button, the palette) would drop the
  // focus to the top of the window, 14–28 Tabs from where the reader was: it lands on the new page's title (or the
  // document, while the page loads). A control that is still on screen (a page-list row) keeps it.
  const docId = mountKey(curSpec)
  const shownDoc = useRef(docId)
  // inside the same page (a step, a facet, a run of the task) the focus stays where the reader was; if the control
  // pressed went away with what it showed (a crumb, a closed panel) it lands on the document, not the window
  const pressedRef = useRef(null)
  useEffect(() => {
    const on = (e) => { const t = e.target; pressedRef.current = t && t.closest && t.closest('.rig') ? t : null }
    document.addEventListener('focusin', on)
    return () => document.removeEventListener('focusin', on)
  }, [])
  useEffect(() => {
    if (shownDoc.current !== docId) return
    const a = document.activeElement, was = pressedRef.current
    if ((a && a !== document.body) || !was || was.isConnected) return
    const doc = document.getElementById('rig-doc-main')
    if (doc) doc.focus({ preventScroll: true })
  }, [route]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (shownDoc.current === docId) return
    shownDoc.current = docId
    const a = document.activeElement
    if (a && a !== document.body && a.isConnected) return
    const doc = document.getElementById('rig-doc-main')
    if (!doc) return
    const h = doc.querySelector('h1')
    if (h && !h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1')
    ;(h || doc).focus({ preventScroll: true })
  }, [docId])

  const nTabs = panes.reduce((a, p) => a + p.tabs.length, 0)
  /* The status bar's connection item: the dot is always drawn; the words leave below 1280px of bar and
     are repeated, with everything else the bar hides, in the status popover the item opens. */
  const connection = IS_STATIC ? { dot: <span className="rg-dot off" />, label: 'read-only snapshot', words: <span data-el="read-only-export-state">read-only snapshot</span> }
    : ov.error || !online ? { dot: <span className="rg-dot warn" />, label: 'backend unreachable · retrying', words: <span data-el="backend-down">backend unreachable · retrying</span> }
    : ov.data ? { dot: <span className="rg-dot" />, label: 'local workspace · connected', words: 'local workspace · connected', ok: true } : { dot: <span className="rg-dot off" />, label: 'connecting…', words: 'connecting…', connecting: true }
  const jobsWords = `${jobs.data.running} ${jobs.data.running === 1 ? 'run' : 'runs'} in progress`
  const curInfo = tabInfo(curSpec)
  // the destinations for the palette and the phone's Go to list; the Collection draws the page outline
  const kind = specKind(curSpec)
  const rail = railItems(kind, fallbackDir, condition, { open: true, args: parseSpec(curSpec).args })
  // the console's controls sit in the head of the right-hand pane, or of the one pane that is drawn
  const clusterPane = route.max || isMobile || (workW > 0 && workW < 960) ? focus : panes.length - 1
  const side = (e) => !!e && (e.metaKey || e.ctrlKey)
  const help = helpItems({
    onTour: startTour,
    onLearn: (e) => openTab(LEARN_HOME, { side: side(e) }),
    learnDesc: learnHelpDesc(lab),
    onKeys: () => setKeysOpen(true),
    onVoice: () => setVoiceOpen(true),
    onPageGuide: startPageTour,
    onBuddy: () => setDock('buddy'),   // Ask Buddy opens Buddy; ⌘J is the toggle
  })
  const go = useCallback((spec, opt = {}) => openTab(spec, opt.side ? { side: true } : { replace: true }), [openTab])

  return (
    <RigContext.Provider value={rig}>
      <div className={cx('rig', sideDock && 'has-side')} data-rig-theme={theme} data-rig-cvd={cvd ? '1' : undefined} data-rig-mobile={isMobile ? '1' : undefined} data-rig-max={route.max && !isMobile ? '1' : undefined} data-rig-nav={navOpen ? 'open' : 'closed'} style={{ '--rig-dock-w': `${dockW}px` }}>
        <a className="rg-skip" href="#rig-doc-main" data-el="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('rig-doc-main')?.focus() }}>Skip to document</a>
        {/* tablet: the opened sidebar overlays the document; choosing a destination closes it */}
        {navOpen && navOverlay && <div className="rg-nav-scrim" aria-hidden="true" onClick={() => setNavOpen(false)} />}
        <Collection kind={kind} args={parseSpec(curSpec).args} condition={conditionDir ? condition : null} datasets={datasets} navOpen={navOpen} setNavOpen={setNavOpen}
          navOverlay={navOverlay} onGo={go} waiting={!ov.data && !ov.error} pendingDir={focusCtx.dir || null} />

        <main className="rg-work" id="rig-work" data-panes ref={workRef}>
          {panes.map((p, pi) => {
            const o = panes.length > 1 ? panes[pi ? 0 : 1] : null
            return <Pane key={pi} pi={pi} pane={p} focused={pi === focus} nPanes={panes.length} lab={lab} onDocs={() => setSheet(route.sheet ? null : 'tabs')}
              controls={pi === clusterPane ? <Controls tourKey={pageTourKey(curSpec)} pref={pref} nTabs={nTabs} curTitle={curInfo.title} split={panes.length > 1} help={help} cycleTheme={cycleTheme} onSheet={() => setSheet(route.sheet ? null : 'tabs')} caseCount={caseItems.length}
                pill={<StatusPill connection={connection} jobsWords={!IS_STATIC && jobs.data.running > 0 ? jobsWords : null} waiting={IS_STATIC ? 0 : waiting} stale={build.stale} lab={lab} pop={pop} onPop={togglePop} />}
                navOpen={navOpen} setNavOpen={setNavOpen} helpOn={kind === 'guide' || kind === 'package'} /> : null}
              other={o && o.tabs.length ? { pi: pi ? 0 : 1, active: o.active, title: tabInfo(o.tabs[o.active]).title } : null} />
          })}
        </main>

        {/* tablet and phone: the panel is a drawer or a sheet over the document; the scrim closes it */}
        {route.dock && (isMobile || navOverlay) && <div className="rg-dock-scrim" aria-hidden="true" onClick={() => setDock(null)} />}
        {route.dock && <Dock dock={route.dock} side={sideDock} setDock={setDock} ctx={focusCtx} onBack={() => openTab('home')} caseCount={caseItems.length} width={dockW} setWidth={setDockW} />}


        {pop && <StatusPop pop={pop} setPop={setPop} close={() => setPop(null)} condition={condition} rowOf={rowOf} connection={connection} jobsWords={!IS_STATIC && jobs.data.running > 0 ? jobsWords : null} stale={build.stale} />}
        {route.pal && <Palette close={() => setPalette(false)} datasets={datasets} condition={condition} onKeys={() => setKeysOpen(true)} onTour={startTour} onVoice={() => setVoiceOpen(true)} env={env} railItems={railItems} />}
        {keysOpen && <KeySheet close={() => setKeysOpen(false)} />}
        {route.sheet === 'tabs' && <TabSheet panes={panes} focus={focus} close={() => setSheet(null)} rail={rail} help={help} condition={conditionDir ? condition : null} datasets={datasets} />}
        <GettingStarted open={voiceOpen} onClose={() => setVoiceOpen(false)} onGuide={(topic) => showGuidance(topic, focusCtx)} />
        {tour && <Tour step={tour.step} onStep={(n) => setTour((t) => (t ? { ...t, step: n } : t))} onClose={endTour} go={tourGo}
          steps={tour.page ? PAGE_TOURS[tour.page] || GENERAL_PAGE_TOUR : undefined} page={tour.page || null} here={curSpec}
          ctx={condition ? { dir: condition.dir, model: condition.model, harness: condition.harness } : {}} />}
        {offer && !tour && <TourOffer onStart={startTour} onDismiss={dismissOffer} />}
        <Toaster />
        <HintLayer />
      </div>
    </RigContext.Provider>
  )
}

/* ---------------------------------------------------------------- rail */
/** The left list's places as a flat list: the seven sections, then the pages under them (navTree.js),
 *  then Settings. The palette's "Go to" group and the phone's Go to sheet read it. `open` limits the
 *  pages to the sections the list has open (the phone sheet); without it every page is listed. */
export function railItems(kind, dir, condition, { open = false, args = [] } = {}) {
  const model = navModel({ kind, args, dir, condition })
  const items = []
  for (const s of model.sections) {
    // the page's own row is marked; the place that holds it is only drawn open, as in the left list
    items.push({ group: s.label, label: s.label, spec: s.spec, icon: s.icon, el: s.el, tour: s.tour, on: s.on, section: true })
    if (open && !s.open) continue
    for (const c of s.children) if (!c.link) items.push({ group: s.label, label: c.label, spec: c.spec, icon: null, el: c.el, on: c.on, parent: s.label })
  }
  const bottom = [{ group: null, label: 'Settings', spec: 'settings', icon: 'gear', el: 'nav-settings', on: kind === 'settings' }]
  return { items, bottom }
}
/** The console's own controls, at the right of a pane head: the phone's mark and document switcher, search
 *  (the command palette), Tour (a tour of the page in focus), Help, and one menu for the rest. */
function Controls({ tourKey, pref, nTabs, curTitle, split, help, cycleTheme, onSheet, caseCount, pill, navOpen, setNavOpen, helpOn }) {
  const rig = useRig()
  const route = rig.state
  const next = nextTheme(pref)
  const pulse = useTourPulse(tourKey)
  const startTour = () => rig.startPageTour()
  return (
    <div className="rg-gcl">
      <button type="button" className="rg-tbtn rg-brand-m" aria-label="TraceHarness home" aria-disabled={rig.isHere('home') || undefined} data-here={rig.isHere('home') ? '' : undefined} data-hint={rig.isHere('home') ? 'Datasets · you are here' : undefined} onClick={() => rig.openTab('home')}><BrandMark short /></button>
      <button type="button" className="rg-mtab" aria-label={`Switch document (${nTabs} open)`} onClick={onSheet}><Icon name="tabs" size={16} /><span className="tt">{curTitle}</span><span className="n">{nTabs}</span></button>
      {pill}
      <button type="button" className="rg-cmd" data-tour="palette" aria-label="Open command palette" onClick={() => rig.setPalette(true)}><Icon name="search" size={14} /><span className="rg-cmd-ph">Search runs, tasks, models…</span><span className="rg-cmd-k"><Kbd>{MOD === '⌘' ? '⌘K' : 'Ctrl K'}</Kbd></span></button>
      {!rig.isMobile && <TourButton pulse={pulse} onStart={startTour} />}
      <HelpMenu items={help} on={helpOn} />
      {/* the panels, then theme, colour-blind colours, split, maximize, Student Lab, the page list and Settings */}
      <Menu className="rg-tb-more" label={<><Icon name="more" size={16} />{caseCount > 0 && <span className="rg-tbtn-n" aria-hidden="true">{caseCount}</span>}</>} buttonLabel="More actions" buttonClassName={rig.isMobile && pulse ? 'rg-tbtn pulse' : 'rg-tbtn'} caret={false} items={[
        // a phone: Tour is the menu's first item (the bar keeps the document switcher's title)
        rig.isMobile && { label: <><Icon name="play" size={12} /> Tour this page</>, onClick: startTour, el: 'tour-this-page', title: 'A guided tour of this page' },
        ...listDocks().map((d) => ({ label: `${d.label}${d.id === 'case' && caseCount > 0 ? ` (${caseCount} pinned)` : ''}`, onClick: () => rig.toggleDock(d.id), pressed: route.dock === d.id, el: d.id === 'buddy' ? 'dock-buddy' : `dock-${d.id}`, title: `${route.dock === d.id ? 'Hide' : 'Show'} ${d.label}${d.id === 'buddy' ? ` (${MOD}+J)` : ''}` })),
        { label: `Theme: ${THEME_NAMES[pref]} · switch to ${THEME_NAMES[next]}`, onClick: cycleTheme, el: 'appearance' },
        { label: `Colour-blind safe colours: ${rig.cvd ? 'on' : 'off'}`, onClick: () => rig.setCvd(!rig.cvd), pressed: !!rig.cvd },
        { label: split ? 'Close split view' : 'Split view', onClick: rig.toggleSplit, pressed: split, title: `${MOD}+\\`, el: 'split' },
        { label: route.max ? 'Restore layout' : 'Maximize document', onClick: rig.toggleMax, pressed: !!route.max, title: `${MOD}+Shift+Enter`, el: 'maximize' },
        { label: `Student Lab: ${rig.lab ? 'on' : 'off'}`, onClick: () => rig.setLab(!rig.lab), pressed: !!rig.lab, el: 'student-lab-menu' },
        { label: navOpen ? 'Collapse the page list' : 'Expand the page list', onClick: () => setNavOpen(!navOpen), title: `${MOD}+B` },
        rig.isHere('settings') ? { label: 'Settings', el: 'nav-settings', disabled: true, title: 'Settings · you are here' } : { label: 'Settings', spec: 'settings', el: 'nav-settings' },
      ]} />
    </div>
  )
}
/** The connection as a dot in the pane head; it speaks only when something is not normal: the backend is
 *  unreachable, connecting, a read-only snapshot, runs in progress, a run waits, a new version, Student Lab.
 *  A click opens the workspace popover, which lists the dataset, condition, oracle and the rest. */
function StatusPill({ connection, jobsWords, waiting, stale, lab, pop, onPop }) {
  const rig = useRig()
  // the first moments of a visit are not news: "connecting…" speaks only once the server has failed to answer
  const speaks = (!connection.ok && !connection.connecting) || !!jobsWords || waiting > 0 || stale || lab
  // all normal: a quiet dot, nothing to press (everything its menu lists has a home of its own)
  if (!speaks) {
    return (
      <span className="rg-pill" data-el="status-pill" role="status">
        <span className="rg-pill-b ok" data-el="runtime-status" data-hint={`Workspace status: ${connection.label}`}>{connection.dot}<span className="sr-only">{connection.label}</span></span>
      </span>
    )
  }
  return (
    <span className="rg-pill speaks" data-el="status-pill" role="status">
      <button type="button" className={cx('rg-pill-b', connection.ok && 'ok')} data-el="runtime-status" data-pop="status" aria-haspopup="dialog" aria-expanded={!!pop && pop.id === 'status'}
        aria-label={`Workspace status: ${connection.label}`} data-hint={`Workspace status: ${connection.label}`} onClick={(e) => onPop('status', e.currentTarget)}>
        {connection.dot}{!connection.ok && <span className="rg-pill-t">{connection.words}</span>}
      </button>
      {jobsWords && <span className="rg-pill-t">{jobsWords}</span>}
      {waiting > 0 && <button type="button" className="rg-pill-a" data-el="waiting-for-you" data-hint="A run is waiting for your decision" onClick={() => rig.openTab('paused')}>{waiting} {waiting === 1 ? 'run waits' : 'runs wait'} for you</button>}
      {stale && <button type="button" className="rg-pill-a" data-el="update-ready" data-hint="TraceHarness was rebuilt on the server. Reload to use it (your tabs are kept)." onClick={() => location.reload()}>New version ready · reload</button>}
      {lab && (rig.isHere('guide')
        // on the reading guide the pill is the page you are on: inert, like every "you are here" control
        ? <button type="button" className="rg-pill-a" data-el="guided-indicator" aria-current="page" aria-disabled="true" data-here="" data-hint="The reading guide · you are here">Guided analysis on</button>
        : <button type="button" className="rg-pill-a" data-el="guided-indicator" onClick={() => rig.openTab('guide')}>Guided analysis on</button>)}
    </span>
  )
}
/* ---------------------------------------------------------------- pane */
/** A crumb that names data (a dataset in the library, or a run or task id: an underscore, a digit, a slash
 *  or a colon and no space) is set in mono and kept as written; a word crumb gets a capital, so every page
 *  reads "dataset › Section › item" whatever case its view wrote. */
const crumbIsId = (label, names) => typeof label === 'string' && (names.has(label) || (!/\s/.test(label) && /[_\d/:.]/.test(label)))
const crumbWords = (label) => (typeof label === 'string' && label ? label[0].toUpperCase() + label.slice(1) : label)
/* The evidence chain (Answer → Figure → Runs → Run → Event) needs about 1,100 px of pane beside the bar's own
   controls; a narrower pane (a laptop under 1366 px, a split) draws it on its own row under the bar, whole, instead of
   in a strip that scrolls sideways. */
const CHAIN_ROW_BELOW = 1100
function Pane({ pi, pane, focused, nPanes, lab, controls, other, onDocs }) {
  const rig = useRig()
  const strip = useRef(null)
  const [paneEl, setPaneEl] = useState(null)
  const [narrowHead, setNarrowHead] = useState(false)
  useEffect(() => {
    if (!paneEl || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([e]) => setNarrowHead(e.contentRect.width < CHAIN_ROW_BELOW))
    ro.observe(paneEl)
    return () => ro.disconnect()
  }, [paneEl])
  const specHere = pane.tabs[pane.active]
  const alsoKey = (() => { const p = parseSpec(specHere); return alsoCalled(p.kind, p.args).join('|') })()
  const paneCtx = useMemo(() => ({ pi, focused, el: paneEl, also: alsoKey ? alsoKey.split('|') : [], spec: specHere }), [pi, focused, paneEl, alsoKey, specHere])
  // the active tab is kept in view when the strip scrolls
  useEffect(() => {
    const t = strip.current && strip.current.querySelector('.rg-tab.act')
    if (t && typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pane.active, pane.tabs.length])
  const spec = pane.tabs[pane.active]
  const info = tabInfo(spec)
  const { def, args } = info
  const chain = parseSpec(spec).chain
  const effChain = chainOf(spec)
  const step = chainStep(spec)
  let crumbs = null
  try { crumbs = def && def.crumbs ? def.crumbs(args, env()) : null } catch { crumbs = null }
  if (!crumbs) crumbs = [[info.title]]
  let outside = false
  try { outside = !!(lab && def && def.outsideGuided && def.outsideGuided(args)) } catch { outside = false }
  const Render = def ? def.render : null
  const Actions = def && def.Actions
  const { kind } = parseSpec(spec)
  const runId = kind === 'run' || kind === 'span' ? args[0] : null
  const seq = kind === 'span' ? args[1] : null
  /* One head row per pane. It carries the breadcrumb; a split view with two or more tabs in a pane
     carries that pane's tabs instead. On one pane the other open documents are one button away (the
     documents sheet, Alt+[ and ]). Page actions, and the console's controls, sit at its right end. */
  const showTabs = nPanes > 1 && pane.tabs.length > 1 && !rig.isMobile
  const docsBtn = !showTabs && pane.tabs.length > 1 && !rig.isMobile
    ? <button type="button" className="rg-docs" data-el="open-documents" aria-label={`Open documents (${pane.tabs.length})`} data-hint={`${pane.tabs.length} pages open in this window: click to list them and switch (Alt+[ and Alt+] step through them)`} onClick={onDocs}><Icon name="tabs" size={14} /><span>{pane.tabs.length}</span></button>
    : null
  const acts = Actions ? <div className="acts rg-pane-acts"><Boundary spec={spec}><Actions spec={spec} args={args} chain={chain} pane={pi} /></Boundary></div> : null
  /* under 960px of work area only the focused pane is drawn: this brings the other one forward */
  const swapBtn = other ? <button type="button" className="rg-paneswap" data-el="pane-swap" aria-label={`Show the ${pi ? 'left' : 'right'} pane: ${other.title}`} data-hint={`Show the ${pi ? 'left' : 'right'} pane: ${other.title}`} onClick={() => rig.focusTab(other.pi, other.active)}><Icon name="cmp" size={15} /></button> : null
  // a page of the page list names its place in plain words: the list itself is the way there
  if (['home', 'ds', 'an', 'tasks', 'field'].includes(kind)) crumbs = crumbs.map(([label]) => [label])
  const mid = crumbs.slice(0, -1)
  const dsNames = new Set(env().datasets.map((d) => d.name))
  const chainBelow = !showTabs && narrowHead && !!(effChain && step)
  const trail = effChain && step
    ? <EvidenceChain dir={effChain.dir} qid={effChain.qid} step={step} runId={runId} seq={seq} />
    : (
      <nav className="rg-crumb" aria-label="Breadcrumb" data-el="breadcrumb">
        {mid.some(([, to]) => to) && (
          <span className="rg-crumb-i rg-crumb-more">
            <Menu label="…" buttonLabel="Show the path" buttonClassName="rg-crumb-l rg-crumb-mb" caret={false} align="start"
              items={mid.map(([label, to]) => ({ label: String(label), spec: to || undefined, disabled: !to }))} /></span>
        )}
        {crumbs.map(([label, to], i) => {
          const last = i === crumbs.length - 1
          const id = crumbIsId(label, dsNames)
          const text = id ? label : crumbWords(label)
          return (
            <span key={i} className={cx('rg-crumb-i', !last && 'rg-crumb-mid')}>{i > 0 && <span className="sep" aria-hidden="true"><Icon name="right" size={12} /></span>}
              {last || !to ? <span className={cx('rg-crumb-l', last && 'cur', id && 'rg-crumb-id')} data-hint={typeof label === 'string' ? label : undefined}>{text}</span>
                : rig.isHere(to, pi) ? <span className={cx('rg-crumb-l', id && 'rg-crumb-id')} aria-current="page" data-here="" data-hint={`${typeof label === 'string' ? label : 'This page'} · you are here`}>{text}</span>
                  : <button type="button" className={cx('rg-crumb-l', id && 'rg-crumb-id')} data-hint={typeof label === 'string' ? label : undefined} onClick={() => rig.openTab(to)}>{text}</button>}
            </span>
          )
        })}
      </nav>
    )
  return (
    <PaneContext.Provider value={paneCtx}>
    <div className={`rg-pane${focused ? ' focus' : ''}`} data-pane={pi} ref={setPaneEl}
      onPointerDownCapture={() => { if (!focused) rig.focusTab(pi, pane.active, { quiet: true }) }}
      onFocusCapture={() => { if (!focused) rig.focusTab(pi, pane.active, { quiet: true }) }}>
      {showTabs ? (
        <div className="rg-tabbar">
          <ScrollX className="rg-tabbar-s"><div className="rg-tabbar-l" role="tablist" aria-label={`Open documents${nPanes > 1 ? (pi ? ' (right pane)' : ' (left pane)') : ''}`} ref={strip}>
          {pane.tabs.map((t, i) => {
            const ti = tabInfo(t)
            return (
              <div key={t} className={`rg-tab${i === pane.active ? ' act' : ''}`}>
                <button type="button" className="tab-b" role="tab" aria-selected={i === pane.active} data-hint={`${t} · double-click to ${rig.maximized ? 'restore' : 'maximize'}`} onClick={() => rig.focusTab(pi, i)} onDoubleClick={() => { rig.focusTab(pi, i); rig.toggleMax() }}>
                  <span className="k">{ti.tag}</span><span className="tt">{ti.title}</span>{parseSpec(t).chain && <span className="k" data-hint="reached from a question">?</span>}
                </button>
                <button type="button" className="x" aria-label={`Close ${ti.title}`} data-hint="Close (Alt+W)" onClick={() => rig.closeTab(pi, i)}>×</button>
              </div>
            )
          })}
          </div></ScrollX>
          <div className="tb-end">{acts}{swapBtn}{controls}</div>
        </div>
      ) : (
        <div className="rg-doctb rg-panehead" onDoubleClick={(e) => { if (e.target === e.currentTarget) { rig.focusTab(pi, pane.active); rig.toggleMax() } }}>
          {chainBelow ? <span className="rg-head-sp" /> : trail}{docsBtn}
          <div className="tb-end">{acts}{swapBtn}{controls}</div>
        </div>
      )}
      {(showTabs || chainBelow) && effChain && step && <div className="rg-doctb rg-chainrow">{trail}</div>}
      {outside && (
        <div className="rg-banner lab" data-el="outside-guided-state"><b>Outside guided analysis</b>
          <span>This view is not part of the Student Lab reading guide — prediction and intervention controls are not explained here. Nothing is hidden.</span>
          <button type="button" className="rg-btn ghost" onClick={() => rig.openTab('guide')}>Back to the guide</button></div>
      )}
      <div className="rg-doc" id={focused ? 'rig-doc-main' : undefined} tabIndex={-1} data-doc={pi} data-spec={spec}>
        <Boundary key={mountKey(spec)} spec={spec} onBack={() => rig.openTab('home')}>
          {Render ? <Render spec={spec} args={args} chain={effChain} pane={pi} /> : <NotFound spec={spec} />}
        </Boundary>
      </div>
    </div>
    </PaneContext.Provider>
  )
}

/* ---------------------------------------------------------------- dock */
function Dock({ dock, side, setDock, ctx, onBack, caseCount = 0, width, setWidth }) {
  const docks = listDocks()
  const cur = docks.find((d) => d.id === dock)
  const Body = cur && cur.render
  // drag the left edge to resize; arrows do the same from the keyboard. The width is remembered.
  const startDrag = (e) => {
    if (!setWidth) return
    e.preventDefault()
    const x0 = e.clientX, w0 = width
    const move = (ev) => setWidth(w0 + (x0 - ev.clientX))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('rg-resizing') }
    document.body.classList.add('rg-resizing')
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  return (
    <section className={cx('rg-dock open', side && 'side')} id="rig-dock" aria-label={cur ? cur.label : 'Panel'}>
      {side && setWidth && <div className="rg-dock-rs" role="separator" aria-orientation="vertical" aria-label="Resize panel" aria-valuenow={width} aria-valuemin={DOCK_MIN} tabIndex={0}
        onPointerDown={startDrag} onDoubleClick={() => setWidth(DOCK_DEFAULT)}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(width + 24) } else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(width - 24) } }} />}
      <div className="rg-dock-h">
        <div className="rg-dock-tabs" role="tablist" aria-label="Panels">
          {docks.map((d) => (
            <button key={d.id} type="button" role="tab" aria-label={d.label} aria-selected={d.id === dock} className={cx('rg-dock-tab', d.id === dock && 'on')} onClick={() => setDock(d.id)} data-hint={d.label}>
              <Icon name={d.icon || 'log'} size={14} /><span className="lbl">{d.label}</span>{d.id === 'case' && caseCount > 0 && <span className="n">{caseCount}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="dt" aria-label={dock === 'buddy' ? 'Hide Buddy' : 'Close panel'} data-hint="Close (Esc)" data-el={dock === 'buddy' ? 'buddy-hide' : undefined} onClick={() => setDock(null)}><Icon name="x" size={14} /></button>
      </div>
      <div className="rg-dock-b"><Boundary key={dock} spec={`dock:${dock}`} onBack={onBack}>{Body ? <Body ctx={ctx} />
        : <div className="rg-dpad"><div className="rg-empty" data-el="empty-state"><div className="rg-empty-t"><b>No panel named “{dock}”.</b></div><p className="rg-empty-why">The link asks for a dock panel this workbench does not have.</p><NextSteps actions={listDocks().map((d) => ({ label: d.label, onClick: () => setDock(d.id) }))} /></div></div>}</Boundary></div>
    </section>
  )
}

/* ---------------------------------------------------------------- status popovers
   Anchored to their status-bar item (clamped inside the window); a bottom sheet on a phone. The
   workspace popover ('status') repeats everything the narrowed status bar hides. */
function StatusPop({ pop, setPop, close, condition, rowOf, connection, jobsWords, stale }) {
  const rig = useRig()
  const row = condition ? rowOf(condition.dir) : null
  // the recorded prices (/api/models) and the harness files, read once the scope menu is open
  const models = useApi(pop.id === 'scope' ? paths.models() : null)
  const harnessFiles = (useOverview().data || {}).harnesses
  const ref = useRef(null)
  useEffect(() => { const b = ref.current && ref.current.querySelector('button, a[href]'); if (b) b.focus() }, [pop.id])
  // no scrim: a press anywhere else closes the popover and still reaches what it was aimed at
  // (the status-bar items that open a popover toggle it themselves)
  useEffect(() => {
    const off = (e) => { const t = e.target; if (ref.current && !ref.current.contains(t) && !(t && t.closest && t.closest('[data-pop]'))) close() }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [close])
  const left = Math.max(8, Math.min(pop.left || 8, (typeof window !== 'undefined' ? window.innerWidth : 400) - 336))
  const reopen = (id) => () => setPop({ ...pop, id })
  const label = pop.id === 'status' ? 'Workspace status' : pop.id === 'oracle' ? 'Oracle' : 'Change model, harness or oracle'
  return (
    <>
      <div className={cx('rg-pop', pop.top != null && 'below')} role="dialog" aria-label={label} style={{ '--rig-pop-left': `${left}px`, ...(pop.top != null && { '--rig-pop-top': `${pop.top}px` }) }} ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}>
        {pop.id === 'status' && <>
          <div className="rg-pop-sec">
            <span className="rg-lbl">Workspace</span>
            <p className="rg-pop-st">{connection.dot}{connection.label}</p>
            {jobsWords && <p className="rg-pop-p">{jobsWords}</p>}
          </div>
          <div className="rg-pop-sec rg-pop-list">
            {condition && (() => {
              // the condition in focus, so the page it opens says what this row says
              const to = condition.model ? makeSpec('ds', condition.dir, short(condition.model), condition.harness) : makeSpec('ds', condition.dir)
              return rig.isHere(to)
                ? <span className="rg-pop-row" aria-current="page" data-here="" data-hint="You are here"><span>Dataset</span><b>{condition.dir}</b><span className="rg-mute rg-small">you are here</span></span>
                : <button type="button" className="rg-pop-row" onClick={() => { close(); rig.openTab(to, { replace: true }) }}><span>Dataset</span><b>{condition.dir}</b><Icon name="right" size={14} /></button>
            })()}
            {condition && condition.model && <button type="button" className="rg-pop-row" onClick={reopen('scope')}><span>Condition</span><b>{short(condition.model)} × {condition.harness}</b><Icon name="chev" size={14} /></button>}
            <button type="button" className="rg-pop-row" data-el="status-oracle" onClick={reopen('scope')}><span>Oracle</span><b>{rig.oracle}</b><Icon name="chev" size={14} /></button>
            <button type="button" className="rg-pop-row" onClick={() => { close(); if (rig.lab) rig.openTab('guide'); else rig.setLab(true) }}><span>Student Lab</span><b>{rig.lab ? 'on · open the guide' : 'off · turn on'}</b><Icon name="right" size={14} /></button>
            {stale && <button type="button" className="rg-pop-row" onClick={() => location.reload()}><span>Update</span><b>New version ready · reload</b><Icon name="right" size={14} /></button>}
          </div>
        </>}
        {(pop.id === 'scope' || pop.id === 'oracle') && <>
          {pop.id === 'oracle' ? null : row && condition && condition.model ? <>
            {/* each choice says what it is under it: a model its provider and recorded price, a harness its notes */}
            <div className="rg-pop-sec"><span className="rg-lbl">Model · {row.name}</span>
              <div className="rg-stack rg-stack-xs">{row.models.map((m, i) => { const line = modelLine(m, models.data); return (
                <div key={m} className="rg-pop-opt"><button type="button" className={`rg-btn opt${m === condition.model ? ' pri' : ''}`} aria-pressed={m === condition.model} aria-disabled={m === condition.model || undefined} data-here={m === condition.model ? '' : undefined} data-hint={m === condition.model ? `${short(m)} · in focus` : undefined} aria-describedby={line ? `rg-pop-m${i}` : undefined} onClick={() => { if (m !== condition.model) rig.setCondition({ dir: row.name, model: m }) }}><span className="rg-ent-line"><EntityName kind="model" name={m} /></span></button>
                  {line && <small id={`rg-pop-m${i}`} className="rg-pop-sub">{line}</small>}</div>) })}</div></div>
            <div className="rg-pop-sec"><span className="rg-lbl">Harness</span>
              <div className="rg-stack rg-stack-xs">{row.harnesses.map((h, i) => { const line = harnessLine(harnessNote(h, row, harnessFiles)); return (
                <div key={h} className="rg-pop-opt"><button type="button" className={`rg-btn opt${h === condition.harness ? ' pri' : ''}`} aria-pressed={h === condition.harness} aria-disabled={h === condition.harness || undefined} data-here={h === condition.harness ? '' : undefined} data-hint={h === condition.harness ? `${h} · in focus` : undefined} aria-describedby={line ? `rg-pop-h${i}` : undefined} onClick={() => { if (h !== condition.harness) rig.setCondition({ dir: row.name, harness: h }) }}><span className="rg-ent-line"><EntityName kind="harness" name={h} /></span></button>
                  {line && <small id={`rg-pop-h${i}`} className="rg-pop-sub">{line}</small>}</div>) })}</div></div>
          </> : <div className="rg-pop-sec"><p className="rg-pop-p">A condition is a model and a harness inside one dataset. Open a dataset to choose one.</p><button type="button" className="rg-btn" onClick={() => { close(); rig.openTab('home') }}>Datasets</button></div>}
          <div className="rg-pop-sec">
            <span className="rg-lbl">Oracle</span>
            <Seg options={SUITES} value={rig.oracle} onChange={(o) => { rig.setOracle(o); close() }} label="Oracle" />
            <p className="rg-pop-p">Grades every run on every page. A run with no grade stays <span className="rg-vt u">? Ungraded</span>, never Fail.</p>
          </div>
        </>}
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- mobile tab sheet */
function TabSheet({ panes, focus, close, rail, help, condition, datasets }) {
  const rig = useRig()
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const selected = ref.current && (ref.current.querySelector('[aria-current="page"]') || ref.current.querySelector('button'))
    if (selected) selected.focus()
    return () => { if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus() }
  }, [])
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key !== 'Tab') return
    const buttons = [...ref.current.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')]
    const first = buttons[0], last = buttons[buttons.length - 1]
    if (!first) { event.preventDefault(); return }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const all = []
  panes.forEach((p, pi) => p.tabs.forEach((t, i) => all.push([pi, i, t, pi === focus && i === p.active])))
  return (
    <>
      <div className="rg-scrim rg-scrim-sheet" onClick={close} aria-hidden="true" />
      <div className="rg-sheet" role="dialog" aria-modal="true" aria-label="Open documents" ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="grab" />
        <div className="rg-sheet-h"><span className="rg-lbl">Open documents · {all.length}</span><button type="button" className="rg-btn ghost" aria-label="Close" onClick={close}><Icon name="x" size={16} /></button></div>
        <div className="rg-sheet-b">
          {all.map(([pi, i, t, on]) => {
            const ti = tabInfo(t)
            return (
              <div key={pi + ':' + t} className="rg-sheet-row">
                <button type="button" className={`it${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined} onClick={() => rig.focusTab(pi, i)}><span className="rg-tag">{ti.tag}</span><span className="rg-grow rg-ell rg-mono">{ti.title}</span></button>
                <button type="button" className="rg-btn ghost" aria-label={`Close ${ti.title}`} onClick={() => rig.closeTab(pi, i)}>×</button>
              </div>
            )
          })}
          <div className="rg-lbl rg-sheet-gl">Go to</div>
          {/* the left list, folded into the sheet below 768px: the seven places, the pages of the open one, the dataset picker */}
          <div className="rg-sheet-dsw"><DatasetSwitch inSheet condition={condition} datasets={datasets || []} /></div>
          {/* a row replaces the page in place, as the left list does; the page you are on says so and does nothing */}
          {[...rail.items, ...rail.bottom].map((r) => { const here = rig.isHere(r.spec); return <button key={(r.parent || '') + r.label} type="button" className={`it${r.parent ? ' kid' : ''}${r.on ? ' on' : ''}`} aria-current={here ? 'page' : r.on ? 'location' : undefined} aria-disabled={here || undefined} data-here={here ? '' : undefined} data-hint={here ? `${r.label} · you are here` : undefined} data-el={r.el} onClick={() => { if (here) { close(); return } rig.openTab(r.spec, { replace: true }) }}>{r.icon ? <Icon name={r.icon} size={18} /> : <span className="rg-sheet-indent" aria-hidden="true" />}<span>{r.label}</span></button> })}
          <div className="rg-lbl rg-sheet-gl">Help</div>
          {(help || []).map((h) => <button key={h.id} type="button" className="it" onClick={(e) => { close(); h.run(e) }}><Icon name="q" size={18} /><span>{h.label}</span></button>)}
          <div className="rg-lbl rg-sheet-gl">Panels</div>
          {listDocks().map((d) => <button key={d.id} type="button" className="it" onClick={() => { close(); rig.setDock(d.id) }}><Icon name={d.icon || 'log'} size={18} /><span>{d.label}</span></button>)}
          <button type="button" className="it" onClick={() => rig.setPalette(true)}><Icon name="search" size={18} /><span>Command palette…</span></button>
        </div>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- keyboard shortcuts (?) */
const KEYS = [
  ['Find anything: dataset, task, run, page, question, setting', [MOD, 'K']],
  ['Open to the side from the palette or a link', [MOD, '↵ / click']],
  ['Ask Buddy', [MOD, 'J']],
  ['Split view on / off', [MOD, '\\']],
  ['Sidebar: collapse / expand', [MOD, 'B']],
  ['Maximize the document / restore', [MOD, 'Shift', 'Enter']],
  ['Next / previous tab', ['Alt', '] / [']],
  ['Close the tab', ['Alt', 'W']],
  ['Search inside the page', ['/']],
  ['Run page: next / previous step', ['j / k', '↓ / ↑']],
  ['Run page: next / previous run of the task', ['Shift J / Shift K']],
  ['Open or close the inspector', ['i']],
  ['Close a popover, the inspector, a panel or maximize', ['Esc']],
  ['This list', ['?']],
]
function KeySheet({ close }) {
  return (
    <Modal open onClose={close} title="Keyboard shortcuts" el="shortcuts" width="560px">
      <dl className="rg-keys-l">
        {KEYS.map(([what, keys]) => (
          <div key={what}><dt>{what}</dt><dd>{keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}</dd></div>
        ))}
      </dl>
    </Modal>
  )
}

