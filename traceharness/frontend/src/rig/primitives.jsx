/* ====================================================================================
   Rig · primitives.jsx — responsive building blocks (UI contract v1). Styles: primitives.css.
   Re-exported by ui.jsx, so a view writes  import { Split, Toolbar, TableScroll } from '../ui'.
   Layout answers to the CONTAINER the component sits in (a pane, a panel, a dialog), never to
   the viewport. Every class is `rg-*`; every value is a --rig-* token.
   ==================================================================================== */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRig, usePane } from './context'
import './primitives.css'
import { StatusIcon } from './StatusIcon'
import { makeSpec } from './route'
import { findRunCached } from './data'
import { pageArticles } from './learn/page-links'
import { canSee } from './learn/gate'

const cx = (...a) => a.filter(Boolean).join(' ')

/* ---------------------------------------------------------------- measuring */
/** useSize(ref) -> { width, height } of the element in CSS px, kept current with a
 *  ResizeObserver. For a chart that needs pixel dimensions: draw from this, never from
 *  window.innerWidth. { width: 0, height: 0 } until measured and where there is no observer. */
export function useSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }))
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/* ---------------------------------------------------------------- layout */
/** <Split side={<nav/>} sideWidth="280px" collapse="sm|md|lg" end? even? flush? sideLabel?>main</Split>
 *  Side + main. Stacks to one column when its container is narrower than 640 / 900 (default) /
 *  1200px, so neither pane drops under ~320px. `end` puts the side on the right (and after the
 *  main content when stacked); `even` makes two equal panes; `scroll` makes the side pane exactly as tall
 *  as the main one (top and bottom aligned) and scrolls it inside, for a long list beside a short card;
 *  `follow` is the reverse: the SIDE pane sets the row height and the main pane (a Panel holding a table) takes exactly that height, its table
 *  showing as many rows as fit and scrolling the rest, so a short side never leaves a gap and a long table never leaves one beside it. */
export function Split({ side, children, sideWidth, collapse = 'md', end, even, flush, scroll, follow, sideLabel, className, el }) {
  const aside = <aside className="rg-split-side" aria-label={sideLabel}>{side}</aside>
  return (
    <div className={cx('rg-split', collapse === 'sm' && 'rg-split-sm', collapse === 'lg' && 'rg-split-lg', end && 'rg-split-end', even && 'rg-split-even', scroll && 'rg-split-scroll', follow && 'rg-split-follow', flush && 'rg-split-flush', className)}
      style={sideWidth ? { '--rig-side': sideWidth } : undefined} data-el={el} data-panes>
      {!end && aside}<div className="rg-split-main">{children}</div>{end && aside}
    </div>
  )
}
/** <PageHeader title subtitle? context? primary? secondary? more? actions? eyebrow? meta? lede? level={1|2} el?>extra</PageHeader>
 *  The one page header. `title` is the H1 and matches the page-list or palette label that opened the
 *  page; the one-line `subtitle` (the page's question) sits under it, then `context` (the Asking line
 *  on a data page). Actions sit top-right: `secondary` outline buttons and any `actions` node, a More
 *  menu holding `more`, and at most one filled `primary` action last. An action is
 *  {label, onClick?, spec?, href?, el?, disabled?, title?}; falsy entries are skipped.
 *  Title block and actions share one line while they fit; otherwise the actions wrap UNDER the
 *  title (it keeps a 20rem basis and is never squeezed). level 2 is a section header (h2).
 *  A level-1 header carries data-tour="page-header": the first-visit tour points at it. Under its title it
 *  says the page's 0.6.0 name when the page has one (the pane's `also`, navTree.alsoCalled), and the page's help
 *  line (PageHelp): the Learn articles that explain it. */
export function PageHeader({ eyebrow, title, subtitle, context, meta, lede, primary, secondary, more, moreLabel = 'More', actions, level = 1, el, children }) {
  const { also } = usePane()
  const H = level === 2 ? 'h2' : 'h1'
  const outline = (secondary || []).filter(Boolean)
  const extra = (more || []).filter(Boolean)
  const acts = actions || outline.length > 0 || extra.length > 0 || primary
  return (
    <header className={cx('rg-ph', level === 2 && 'rg-ph-sec')} data-el={el} data-tour={level === 2 ? undefined : 'page-header'}>
      <div className="rg-ph-main">
        {eyebrow && <div className="rg-eyebrow">{eyebrow}</div>}
        <H className="rg-ph-title">{title}</H>
        {subtitle && <p className="rg-ph-sub">{subtitle}</p>}
        {level !== 2 && also && also.length > 0 && <p className="rg-ph-also" data-el="also-called">Also called {also.join(' · ')} in the handout and guides</p>}
        {context && <div className="rg-ph-ctx">{context}</div>}
        {meta && <div className="rg-ph-meta">{meta}</div>}
        {lede && <p className="rg-ph-lede">{lede}</p>}
        {level !== 2 && <PageHelp />}
        {children}
      </div>
      {acts && (
        <div className="rg-ph-actions">
          {outline.map((a, i) => <Action key={i} a={{ ...a, primary: false }} />)}
          {actions}
          {extra.length > 0 && <Menu label={moreLabel} items={extra} el="page-more" />}
          {primary && <Action a={{ ...primary, primary: true }} />}
        </div>
      )}
    </header>
  )
}
/** <PageHelp/> — the help line under a page's title: "Learn: <article> · <article>", the articles that explain the
 *  page (learn/page-links.js; an article not written yet is left out). The page's tour is the Tour button at the top
 *  right of the top bar (TourButton.jsx), on every page. A level-1 PageHeader draws it; a page with a header of its
 *  own (the run page, a question) draws it there. Nothing outside a pane, or where there is no article. */
export function PageHelp() {
  const { spec } = usePane()
  const { datasets, lab, openTab } = useRig()
  if (!spec) return null
  const originOf = (dir) => ((datasets || []).find((r) => r.name === dir) || {}).origin || null
  const runDir = (id) => (findRunCached(id) || {}).ds || null
  const links = canSee('articles', lab) ? pageArticles(spec, { originOf, runDir }) : []
  if (!links.length) return null
  return (
    <div className="rg-ph-help" data-el="page-help">
      {links.length > 0 && (
        <p className="rg-ph-learn" data-el="page-learn"><span className="rg-ph-learn-k">Learn:</span>{' '}
          {links.map((a, i) => {
            const to = makeSpec('guide', a.id)
            // a plain click opens the article as a tab, ⌘/Ctrl-click beside; a middle or shift click is the browser's
            const open = (e) => { if (e.button !== 0 || e.shiftKey || e.altKey) return; e.preventDefault(); openTab(to, { side: e.metaKey || e.ctrlKey }) }
            return <span key={a.id}>{i ? ' · ' : ''}<a href={`#/rig/${to}`} className="rg-tlink" data-spec={to} onClick={open}>{a.title}</a></span>
          })}</p>
      )}
    </div>
  )
}
/** <Toolbar label end={<…/>} twoUp? el?>controls</Toolbar> — a wrapping row of filters. Give the
 *  search box className="rg-toolbar-grow". Below 480px of container every field takes the full
 *  width (`twoUp`: selects go two per row). `end` is pushed to the right edge while it fits. */
export function Toolbar({ label, end, twoUp, className, el, tour, children }) {
  return (
    <div className={cx('rg-toolbar', twoUp && 'rg-toolbar-2up', className)} role="group" aria-label={label} data-el={el} data-tour={tour}>
      {children}{end && <div className="rg-toolbar-end">{end}</div>}
    </div>
  )
}
/** <Card title? meta? actions? footer? flush? as="section" label? el?>body</Card> — one bordered
 *  surface with consistent padding (24px, 16px in a narrow container). Do not nest cards: a second
 *  level is <div className="rg-card-sub"> (tint, no border). */
export function Card({ title, meta, actions, footer, flush, as: As = 'section', label, className, el, id, children }) {
  return (
    <As className={cx('rg-card', className)} data-el={el} id={id} aria-label={label || (typeof title === 'string' ? title : undefined)}>
      {(title || actions) && (
        <div className="rg-card-h">
          <h3 className="rg-card-t">{title}</h3>
          {meta && <span className="rg-card-meta">{meta}</span>}
          {actions && <div className="rg-card-acts">{actions}</div>}
        </div>
      )}
      <div className={cx('rg-card-b', flush && 'rg-flush')}>{children}</div>
      {footer && <div className="rg-card-f">{footer}</div>}
    </As>
  )
}

/* ---------------------------------------------------------------- scrolling */
/** <ScrollX label? focusable? className? el?>wide content</ScrollX> — a horizontal scroller that
 *  fades the edge(s) where more content lies (data-start / data-end), so a strip that scrolls
 *  says so. `focusable` + `label` make the region reachable by keyboard (use it when the content
 *  has no focusable child, e.g. a table). */
export function ScrollX({ label, focusable, className, style, el, children }) {
  const view = useRef(null)
  const [edge, setEdge] = useState({ start: false, end: false })
  const measure = useCallback(() => {
    const v = view.current
    if (!v) return
    const max = v.scrollWidth - v.clientWidth
    const start = v.scrollLeft > 1, end = v.scrollLeft < max - 1
    setEdge((e) => (e.start === start && e.end === end ? e : { start, end }))
  }, [])
  useEffect(() => {
    measure()
    const v = view.current
    if (!v || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(v)
    for (const child of v.children) ro.observe(child)
    return () => ro.disconnect()
  }, [measure, children])
  const scrolls = edge.start || edge.end
  return (
    <div className={cx('rg-scrollx', className)} style={style} data-start={edge.start ? '' : undefined} data-end={edge.end ? '' : undefined} data-el={el}>
      <div className="rg-scrollx-v" ref={view} onScroll={measure} role={focusable && label ? 'region' : undefined} aria-label={focusable ? label : undefined} tabIndex={focusable && scrolls ? 0 : undefined}>{children}</div>
    </div>
  )
}
/** <TableScroll label stickyCol? maxHeight? el?><table className="rg-tbl">…</table></TableScroll>
 *  The standard home of a wide table: it scrolls inside its own box (both axes when `maxHeight`
 *  is set), the header row stays on top, the first column stays on the left, and the far edge
 *  fades while columns are hidden. `label` names the region for keyboard and screen-reader users. */
export function TableScroll({ label, stickyCol = true, maxHeight, className, el, children }) {
  return (
    <ScrollX label={label} focusable className={cx('rg-tscroll', stickyCol && 'rg-sticky-col', className)} el={el}
      style={maxHeight ? { '--rig-max-h': typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight } : undefined}>{children}</ScrollX>
  )
}
/** <Tabs tabs={[[value, label, count?], …]} value onChange label idBase? el?/> — a tab strip that
 *  scrolls sideways (with edge fades) when it does not fit. Arrow keys, Home and End move the
 *  selection; the selected tab is kept in view. Pair with role="tabpanel" aria-labelledby. */
export function Tabs({ tabs, value, onChange, label, idBase, el }) {
  const list = useRef(null)
  // the selected tab is kept in view by scrolling the strip sideways only: scrollIntoView would also
  // scroll the page, so a strip below the fold dragged the page down when it opened
  useEffect(() => {
    const strip = list.current && list.current.parentElement
    const cur = list.current && list.current.querySelector('[aria-selected="true"]')
    if (!strip || !cur) return
    const s = strip.getBoundingClientRect(), r = cur.getBoundingClientRect()
    if (r.left < s.left) strip.scrollLeft -= s.left - r.left
    else if (r.right > s.right) strip.scrollLeft += r.right - s.right
  }, [value])
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t[0] === value)
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (n == null) return
    e.preventDefault()
    const next = (n + tabs.length) % tabs.length
    onChange(tabs[next][0])
    const node = list.current && list.current.querySelectorAll('[role="tab"]')[next]
    if (node) node.focus()
  }
  return (
    <ScrollX el={el}>
      <div className="rg-tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
        {tabs.map(([v, l, n]) => (
          <button key={v} type="button" role="tab" id={idBase ? `${idBase}-${v}` : undefined} className="rg-tabs-tab" aria-selected={v === value} tabIndex={v === value ? 0 : -1} onClick={() => onChange(v)}>
            {l}{n != null && <span className="rg-tabs-n">{n}</span>}
          </button>
        ))}
      </div>
    </ScrollX>
  )
}

/* ---------------------------------------------------------------- actions */
function Action({ a, menu, className, onDone }) {
  const { openTab } = useRig()
  const cls = menu ? cx('rg-menu-it', a.danger && 'rg-danger') : cx('rg-btn', a.primary && 'pri', a.danger && 'warn', className)
  const role = menu ? 'menuitem' : undefined
  if (a.href) return <a href={a.href} className={cls} role={role} data-hint={a.title} onClick={() => onDone && onDone(true)}>{a.label}</a>
  return (
    <button type="button" className={cls} role={role} data-hint={a.title} disabled={a.disabled} aria-pressed={a.pressed} aria-describedby={a.describedBy} data-el={a.el}
      onClick={(e) => { if (a.spec) openTab(a.spec, { side: e.metaKey || e.ctrlKey }); else if (a.onClick) a.onClick(e); if (onDone) onDone(!!a.spec) }}>{a.label}</button>
  )
}
/** <Menu label="More" items={[{label, onClick?, spec?, href?, disabled?, danger?, title?}]} align="end|start"/>
 *  A button that opens a list of actions, the focus on its first item (as Help does). Esc and a click outside
 *  close it and return focus to the button; so does an item that stays on this page (Theme); an item that opens
 *  a page leaves the focus to that page. ↑ ↓ move between items. Items are rendered only while it is open. Falsy items are
 *  skipped; with no item it renders nothing.
 *  Optional: `buttonLabel` (the trigger's accessible name, for an icon-only `label`), `buttonClassName`
 *  (default "rg-btn"; the shell passes its own ghost button classes), `caret={false}` (no ▾). */
export function Menu({ label = 'More', items, align = 'end', className, el, buttonLabel, buttonClassName = 'rg-btn', caret = true }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  const id = useId()
  const list = (items || []).filter(Boolean)
  useEffect(() => {
    if (!open) return
    const first = root.current && root.current.querySelector('[role="menuitem"]:not(:disabled)')
    if (first) first.focus()
    const off = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  if (!list.length) return null
  const onKeyDown = (e) => {
    if (!open) return
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); const b = root.current && root.current.querySelector('button'); if (b) b.focus(); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const its = [...root.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
    const i = its.indexOf(document.activeElement)
    const next = its[(i + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length]
    if (next) next.focus()
  }
  return (
    <span className={cx('rg-menu', align === 'start' && 'rg-menu-start', className)} ref={root} onKeyDown={onKeyDown} data-el={el}>
      <button type="button" className={buttonClassName} aria-label={buttonLabel} data-hint={buttonLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>{label}{caret && <span className="rg-menu-caret" aria-hidden="true">▾</span>}</button>
      {open && <div className="rg-menu-list" role="menu" id={id} aria-label={buttonLabel || (typeof label === 'string' ? label : undefined)}>{list.map((a, i) => <Action key={i} a={a} menu onDone={(left) => { setOpen(false); if (!left) { const b = root.current && root.current.querySelector('button'); if (b) b.focus() } }} />)}</div>}
    </span>
  )
}
/** <ActionBar actions={[{label, onClick?, spec?, href?, primary?, danger?, disabled?, pressed?, more?, describedBy?}]} label="Actions"/>
 *  A row of buttons that collapses instead of wrapping raggedly: below 640px of container the
 *  actions marked `more` leave the row and are offered by a "More" menu. Order = priority: put
 *  the one primary action first. Falsy entries are skipped. */
export function ActionBar({ actions, label = 'Actions', moreLabel = 'More', className, el, children }) {
  const list = (actions || []).filter(Boolean)
  const extra = list.filter((a) => a.more)
  return (
    <div className={cx('rg-actbar', className)} role="group" aria-label={label} data-el={el}>
      {list.map((a, i) => <Action key={i} a={a} className={a.more ? 'rg-actbar-2' : undefined} />)}
      {children}
      {extra.length > 0 && <Menu label={moreLabel} items={extra} className="rg-actbar-more" />}
    </div>
  )
}

/* ---------------------------------------------------------------- filters, figures in a row, callouts */
/** <FilterChips label value onChange options={[{ value, label, count?, dot?: 'rec'|'mock', icon?, el? }]} el?/>
 *  A row of filter chips: dashed until chosen, then outlined in the accent. Each chip says how many rows
 *  it would show (`count`, which should follow any search); exactly one is pressed. The pressed chip is what is
 *  shown already, so it is inert and says so ("Showing all"). */
export const showingWords = (value, label) => (value === 'all' ? 'Showing all' : `Showing ${typeof label === 'string' ? label : value} only`)
export function FilterChips({ label, value, onChange, options, className, el }) {
  return (
    <div className={cx('rg-filts', className)} role="group" aria-label={label} data-el={el}>
      {options.filter(Boolean).map((o) => (
        <button key={o.value} type="button" className="rg-filt" aria-pressed={o.value === value} aria-disabled={o.value === value || undefined} data-el={o.el} disabled={o.disabled || undefined}
          data-hint={o.why || (o.value === value ? showingWords(o.value, o.label) : undefined)} onClick={() => { if (o.value !== value) onChange(o.value) }}>
          {o.dot && <span className={`rg-kdot rg-kdot-${o.dot}`} aria-hidden="true" />}
          {o.icon}{o.label}{o.count != null && <>{' '}<span className="rg-filt-n">{o.count}</span></>}
        </button>
      ))}
    </div>
  )
}
/** <KpiStrip label?><KpiStat label value unit? tone="red|sky|amb"? tip?/>…</KpiStrip> — the run header's
 *  row of figures: a small label above each mono value, hairlines between, no boxes. A missing value is
 *  an em dash, never zero. Wraps onto a second row when the container is narrow. */
export function KpiStrip({ label, className, el, children }) {
  return <dl className={cx('rg-kstrip', className)} aria-label={label} data-el={el}>{children}</dl>
}
export function KpiStat({ label, value, unit, tone, tip, el }) {
  const none = value == null || value === ''
  return (
    <div className="rg-kstat" data-el={el} data-hint={tip}>
      <dt className="rg-kstat-k">{label}</dt>
      <dd className={cx('rg-kstat-v', tone && `rg-${tone}`)}>{none ? '—' : value}{unit && !none && <span className="rg-kstat-u">{unit}</span>}</dd>
    </div>
  )
}
/** <Callout tone="red|amb|acc|sky"? icon? title action? level?>one paragraph</Callout> — a tinted glyph, a title,
 *  a short explanation and one action at the right (the run page's "How it failed"). `level` is the title's heading
 *  level (3 by default; 2 right under a page's h1). */
export function Callout({ tone, icon, title, action, el, level = 3, children }) {
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <section className={cx('rg-callout', tone && `rg-callout-${tone}`)} data-el={el} aria-label={typeof title === 'string' ? title : undefined}>
      {icon && <span className="rg-callout-g" aria-hidden="true">{icon}</span>}
      <div className="rg-callout-b">
        {title && <H className="rg-callout-t">{title}</H>}
        <div className="rg-callout-p">{children}</div>
      </div>
      {action && <div className="rg-callout-a">{action}</div>}
    </section>
  )
}

/* ---------------------------------------------------------------- figures and text */
/** <Kpis label?><Kpi label value unit? hint? lead? tone="acc|amb"/>…</Kpis> — a strip of figures
 *  that wraps to as many rows as it needs with a hairline between tiles and no empty cell.
 *  A missing value is drawn as an em dash, never as zero. `lead` marks the one large figure. */
export function Kpis({ label, className, el, tour, children }) {
  return <div className={cx('rg-kpis', className)} data-panes role="group" aria-label={label} data-el={el} data-tour={tour}>{children}</div>
}
/** `scope` names which runs the figure is of, in words under its label (scope.js: "this cell: m under h",
 *  "pooled: all 3 models × 9 harnesses"). */
export function Kpi({ label, value, unit, hint, lead, tone, el, scope, children }) {
  return (
    <div className={cx('rg-kpi', lead && 'rg-lead')} data-el={el}>
      <span className="rg-lbl">{label}</span>
      {scope && <span className="rg-scope" data-el="figure-scope">{scope}</span>}
      <span className={cx('rg-kpi-v', tone === 'acc' && 'rg-acc', tone === 'amb' && 'rg-amb')}>{value == null || value === '' ? '—' : value}{unit && value != null && value !== '' && <span className="rg-kpi-u">{unit}</span>}</span>
      {hint && <span className="rg-kpi-h">{hint}</span>}
      {children}
    </div>
  )
}
/** <Id value max={28} head={10} tail={8}/> — a run id, hash, path or model id that never overflows:
 *  one line, the whole value in `title`, and when it is longer than `max` characters the middle is
 *  replaced by an ellipsis (head…tail) while the full text stays selectable and announced. */
export function Id({ value, max = 28, head = 10, tail = 8, className, el }) {
  const s = String(value ?? '')
  const cut = s.length > max && s.length > head + tail
  return (
    <span className={cx('rg-id', className)} data-hint={s} data-el={el}>
      {cut ? <>{s.slice(0, head)}<span className="rg-id-cut"><span className="sr-only">{s.slice(head, s.length - tail)}</span></span>{s.slice(s.length - tail)}</> : s}
    </span>
  )
}

/* ---------------------------------------------------------------- states and forms */
/** <PanelState kind="empty|loading|error" title onRetry? actions? center?>one plain sentence</PanelState>
 *  The state of ONE panel, card or table (the page-level states are Empty, Loading and ErrorState
 *  in ui.jsx). Empty says why; error offers Retry; loading is announced politely. */
export function PanelState({ kind = 'empty', title, onRetry, actions, center, el, children }) {
  const busy = kind === 'loading', failed = kind === 'error'
  return (
    <div className={cx('rg-pstate', center && 'rg-center')} data-el={el || `panel-${kind}`} role={failed ? 'alert' : busy ? 'status' : undefined} aria-busy={busy || undefined}>
      <div className="rg-pstate-t">
        {busy ? <span className="rg-pulse" aria-hidden="true" /> : <StatusIcon status={failed ? 'error' : 'ungraded'} decorative />}
        <span>{title}</span>
      </div>
      {children && <div className="rg-pstate-b">{children}</div>}
      {(onRetry || actions) && <div className="rg-cluster">{onRetry && <button type="button" className="rg-btn" onClick={onRetry}>Retry</button>}{actions}</div>}
    </div>
  )
}
const SKEL_WIDTHS = ['92%', '78%', '64%', '85%']
/** "Loading findings… reading 1,500 runs": what a wait is for, then how much it reads when that is known. */
export function waitWords(label, detail) {
  const head = label.endsWith('…') ? label : `${label}…`
  return detail ? `${head} ${detail}` : head
}
/** <Skeleton lines={3} label detail?/> or <Skeleton height={96} width="100%" label/> — placeholder shaped like
 *  the content it stands for, with a line that says what it waits for (waitWords).
 *  Announced once as busy; the shimmer stops under reduced motion. */
export function Skeleton({ lines = 3, height, width, label = 'Loading', detail }) {
  const words = waitWords(label, detail)
  if (height != null) return <div className="rg-skel" style={{ height, width }} role="status" aria-busy="true" aria-label={label}><span className="rg-skel-cap">{words}</span></div>
  return (
    <div className="rg-skel-stack" role="status" aria-busy="true" aria-label={label}>
      <p className="rg-skel-cap">{words}</p>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="rg-skel rg-skel-line" style={{ width: SKEL_WIDTHS[i % SKEL_WIDTHS.length] }} />)}
    </div>
  )
}
/** <Field label htmlFor hint? error? wide?><input className="rg-inp" id=…/></Field> — label above the
 *  control, hint or error under it. Lay fields out in <div className="rg-form">: as many columns
 *  as fit at 16rem each, one column in a narrow container. `wide` spans the whole row. */
export function Field({ label, htmlFor, hint, error, wide, el, children }) {
  return (
    <div className={cx('rg-field', wide && 'rg-field-wide')} data-el={el}>
      <label className="rg-field-l" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="rg-field-e" role="alert">{error}</span> : hint ? <span className="rg-field-h">{hint}</span> : null}
    </div>
  )
}

/* ---------------------------------------------------------------- modal and drawer */
/** <Modal open onClose title footer? drawer? width? label? el?>body</Modal> — a native modal dialog:
 *  focus is contained, Esc and a click on the backdrop close it, and focus returns to whatever
 *  opened it. Header and footer stay put while the body scrolls. Full screen on a phone.
 *  `drawer` docks it to the right edge. Renders nothing while `open` is false. */
export function Modal({ open, onClose, title, footer, drawer, width, label, el, children }) {
  const node = useRef(null)
  const id = useId()
  useEffect(() => {
    const d = node.current
    if (!open || !d) return
    const opener = document.activeElement
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal() } else d.setAttribute('open', '')
    return () => {
      if (typeof d.close === 'function' && d.open) d.close()
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus()
    }
  }, [open])
  if (!open) return null
  return (
    <dialog ref={node} className={cx('rg-modal', drawer && 'rg-drawer')} aria-labelledby={title ? id : undefined} aria-label={title ? undefined : label} data-el={el}
      style={width ? { '--rig-modal-w': width } : undefined}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose() } }}>
      <header className="rg-modal-h">
        {title ? <h2 className="rg-modal-t" id={id}>{title}</h2> : <span className="rg-grow" />}
        <button type="button" className="rg-btn ghost" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className="rg-modal-b">{children}</div>
      {footer && <footer className="rg-modal-f">{footer}</footer>}
    </dialog>
  )
}
