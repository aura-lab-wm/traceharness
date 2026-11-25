/* Rig · Collection.jsx — the left list (navTree.js): seven places, with the dataset picker under Datasets. A section
   shows its pages while one of them is open; folded (⌘B) the list is a 56px rail of icons. */
import { useEffect, useRef, useState } from 'react'
import { fmt } from './data'
import { useRig } from './context'
import { Icon, Wb } from './ui'
import { navModel } from './navTree'
import { KINDS, datasetName, groupDatasets } from './datasetInfo'
import { DatasetOption } from './DatasetOption'
import { Term } from './Term'

const cx = (...a) => a.filter(Boolean).join(' ')
const GROUPS_KEY = 'rig.nav.groups'
const readGroups = () => { try { const v = JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
const writeGroups = (v) => { try { localStorage.setItem(GROUPS_KEY, JSON.stringify(v)) } catch { /* this visit only */ } }

/** One row of the left list. A row that would open the page in view is inert ("you are here": no action;
 *  Ctrl/⌘-click still opens it to the side), and the page's own row is marked aria-current="page"; a row that is
 *  only the place holding the page in view (Runs, on a run) is marked "location" and still opens its page. */
export function RailButton({ spec, icon, label, on, has, el, tour, add, kid, link, note, onGo, waiting }) {
  const { isHere } = useRig()
  const here = !!spec && !waiting && !!isHere && isHere(spec)
  return (
    <button type="button" className={cx('rg-nav-it', on && 'on', has && 'cur', add && 'rg-nav-add', kid && 'rg-nav-kid', waiting && 'rg-nav-wait')} aria-label={label}
      aria-current={on ? (here ? 'page' : 'location') : undefined} aria-disabled={here || undefined} data-here={here ? '' : undefined} data-el={el} data-tour={tour}
      data-hint={here ? `${label} · you are here` : note || undefined} disabled={waiting || undefined}
      onClick={(e) => { const side = e.metaKey || e.ctrlKey; if (here && !side) return; onGo(spec, { side }) }}>
      {icon && <Icon name={icon} size={16} />}
      <span className="lbl">{label}</span>{link && <span className="rg-nav-ext" aria-hidden="true"><Icon name="ext" size={12} /></span>}<span className="tip">{label}</span>
    </button>
  )
}

/** The logo: the "traceharness." wordmark, or "t." where only a square fits. */
export function BrandMark({ short: sq }) {
  return <span className="rg-mark" aria-hidden="true">{sq ? 't' : 'traceharness'}<span className="rg-mark-dot">.</span></span>
}

/** Where the picker's layer starts inside the phone sheet, in px from the sheet's top: just under its button,
 *  never above the sheet's header and never lower than 45% of the sheet, so the list always has room. */
export function sheetMenuTop(sheet, button, headerBottom) {
  const top = button.bottom - sheet.top + 4
  return Math.round(Math.max(headerBottom - sheet.top, Math.min(sheet.height * 0.45, top)))
}
function placeInSheet(root) {
  const sheet = root && root.closest('.rg-sheet')
  const button = root && root.querySelector('.rg-dsw-b')
  if (!sheet || !button) return null
  const head = sheet.querySelector('.rg-sheet-h')
  return sheetMenuTop(sheet.getBoundingClientRect(), button.getBoundingClientRect(), head ? head.getBoundingClientRect().bottom : 0)
}

/** The dataset in focus; its menu lists every dataset grouped by kind, each saying what it is
 *  (DatasetOption), with one line on what a dataset is; "All datasets" opens the library. ↑ ↓ Home End move
 *  between the options, Esc closes. In the phone sheet (`inSheet`) the menu is a layer of the sheet itself,
 *  under its button down to the sheet's foot, so the sheet's header and scroll never cover it. */
export function DatasetSwitch({ condition, datasets, waiting, inSheet = false }) {
  const rig = useRig()
  const [open, setOpen] = useState(false)
  const [sheetTop, setSheetTop] = useState(null)
  const ref = useRef(null)
  const dir = condition && condition.dir
  // the dataset of the page in view: choosing it again changes nothing ("in focus"); from a page about no
  // dataset (Datasets, Add data) choosing it opens it
  const focused = rig.focusCtx && rig.focusCtx.dir === dir ? dir : null
  const row = datasets.find((r) => r.name === dir)
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true) }
  }, [open])
  // while the library loads, the switch keeps its place (a blank of its own size), so nothing below it moves
  if (!datasets.length) return waiting ? <div className="rg-dsw rg-dsw-wait" data-wait="" aria-hidden="true"><span className="rg-dsw-b"><span className="rg-dsw-t"><b className="rg-skel-cap">Loading datasets…</b><small className="rg-skel">&nbsp;</small></span></span></div> : null
  const name = row ? datasetName(row) : dir
  const kind = row ? KINDS[row.origin] || KINDS.recorded : null
  const under = !row ? fmt.plural(datasets.length, 'dataset') : name !== row.name ? `${row.name} · ${kind.label}` : `${kind.label} · ${fmt.int(row.runs)} ${row.runs === 1 ? 'run' : 'runs'}`
  const move = (e) => {
    const opts = [...ref.current.querySelectorAll('[role="option"]')]
    const i = opts.indexOf(document.activeElement)
    const to = { ArrowDown: Math.min(opts.length - 1, i + 1), ArrowUp: Math.max(0, i - 1), Home: 0, End: opts.length - 1 }[e.key]
    if (to == null || !opts.length) return
    e.preventDefault(); opts[to].focus()
  }
  return (
    <div className={cx('rg-dsw', inSheet && 'rg-dsw-insheet')} ref={ref} data-el="dataset-switch">
      <button type="button" className="rg-dsw-b" data-tour="status-context" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`TraceHarness, dataset ${row && name !== row.name ? `${name} (${row.name})` : dir || 'none'}. Switch dataset`}
        onClick={() => { if (!open && inSheet) setSheetTop(placeInSheet(ref.current)); setOpen(!open) }}>
        <span className="rg-dsw-t"><b>{name || 'Choose a dataset'}</b><small><Wb>{under}</Wb></small></span>
        <Icon name="chevrons" size={14} />
      </button>
      {open && (
        <div className={cx('rg-dsw-m', inSheet && 'in-sheet')} style={inSheet && sheetTop != null ? { top: `${sheetTop}px` } : undefined} onKeyDown={move}>
          <p className="rg-dsw-what" data-el="what-is-a-dataset">What is a <Term slug="dataset">dataset</Term>? One folder of runs under data/runs.</p>
          <div role="listbox" aria-label="Datasets" className="rg-dsw-l">
            {groupDatasets(datasets).map((g) => (
              <div key={g.kind} role="group" aria-label={`${g.label} · ${g.count}`} className="rg-dsw-g">
                <span className="rg-dsw-gh" aria-hidden="true"><span className={`rg-kdot rg-kdot-${KINDS[g.kind].dot}`} />{g.label}<span className="rg-dsw-gn">{g.count}</span></span>
                <span className="rg-dsw-gw" aria-hidden="true">{KINDS[g.kind].what}</span>
                {g.rows.map((r) => (
                  <button key={r.name} type="button" role="option" aria-selected={r.name === dir} className={cx('rg-dsw-o', r.name === dir && 'on')}
                    aria-label={`${datasetName(r)}${datasetName(r) !== r.name ? `, folder ${r.name}` : ''}, ${(KINDS[r.origin] || KINDS.recorded).label}`}
                    aria-disabled={r.name === focused || undefined} data-here={r.name === focused ? '' : undefined} data-hint={r.name === focused ? `${datasetName(r)} · in focus` : undefined}
                    onClick={() => { setOpen(false); if (r.name !== focused) rig.setCondition({ dir: r.name }) }}>
                    <DatasetOption row={r} badge={false} />
                  </button>
                ))}
              </div>
            ))}
          </div>
          {rig.isHere('home')
            ? <button type="button" className="rg-dsw-o all" data-el="nav-datasets" aria-current="page" aria-disabled="true" data-here="" data-hint="All datasets · you are here" onClick={() => setOpen(false)}>All datasets<Icon name="right" size={13} /></button>
            : <button type="button" className="rg-dsw-o all" data-el="nav-datasets" onClick={() => { setOpen(false); rig.openTab('home') }}>All datasets<Icon name="right" size={13} /></button>}
        </div>
      )}
    </div>
  )
}

/** The children of a section, under their group names (Which setup wins, Run, Make a harness…). */
function Kids({ section, rows, onGo }) {
  const groups = []
  for (const c of rows) {
    const g = c.group || ''
    if (!groups.length || groups[groups.length - 1].name !== g) groups.push({ name: g, rows: [] })
    groups[groups.length - 1].rows.push(c)
  }
  const button = (c) => <RailButton key={c.id} kid label={c.label} spec={c.spec} on={c.on} el={c.el} tour={c.tour} link={c.link} onGo={onGo} waiting={c.wait}
    note={c.link ? `${c.label} · opens Analysis › ${c.label}` : undefined} />
  return (
    <div className="rg-nav-kids" role="group" aria-label={`${section.label} pages`} data-kids={section.id}>
      {groups.map((g) => (g.name
        ? <div key={g.name} className="rg-nav-kg" role="group" aria-label={g.name}><span className="rg-nav-kgl" aria-hidden="true">{g.name}</span>{g.rows.map(button)}</div>
        : g.rows.map(button)))}
    </div>
  )
}

// the narrow list is 76 px wide: a folder name wraps after its underscores ("study_" over "v04") instead of being cut
function breakAfterUnderscores(name) {
  return name.split('_').flatMap((part, i, parts) => (i < parts.length - 1 ? [`${part}_`, <wbr key={i} />] : [part]))
}

export default function Collection({ kind, args, condition, datasets, navOpen, setNavOpen, navOverlay, onGo, waiting = false, pendingDir = null }) {
  const [expanded, setExpanded] = useState(readGroups)
  const save = (next) => { setExpanded(next); writeGroups(next) }
  const toggle = (id, open) => save({ ...expanded, [id]: !open })
  // the dataset the address names counts from the first paint, before the library has loaded
  const dir = (condition && condition.dir) || (waiting ? pendingDir : null)
  // while the library loads the dataset pages are drawn in place but not yet pressable: they need the dataset
  const wait = !dir && waiting
  const model = navModel({ kind, args, dir, condition, expanded, waiting: wait })
  // a dataset's own places need a dataset: drawn (not yet pressable) while the library loads, absent when there is none
  const dsSections = model.sections.filter((s) => s.dataset && (dir || wait))
  const sectionIndex = (s) => model.sections.indexOf(s)
  const firstDataset = model.sections.findIndex((s) => s.dataset)
  const dsRow = dir ? datasets.find((r) => r.name === dir) : null
  const dsName = dsRow ? datasetName(dsRow) : dir
  // a section row opens its pages again, whatever the reader chose before
  const goSection = (s) => (spec, opt) => {
    if (s.children.length && expanded[s.id] === false) { const next = { ...expanded }; delete next[s.id]; save(next) }
    onGo(spec, opt)
  }
  return (
    <nav className="rg-rail" aria-label="Activity" data-tour="sidebar" onClick={navOverlay && navOpen ? (e) => { if (e.target.closest && e.target.closest('.rg-nav-it, .rg-dsw-o')) setNavOpen(false) } : undefined}>
      <div className="rg-side-top">
        <span className="rg-brand" data-el="brand" data-hint="TraceHarness"><BrandMark short={!navOpen} /></span>
      </div>
      <div className="rg-nav-g rg-tree" role="group" aria-label="Pages" data-el="analysis-nav">
        {model.sections.filter((s) => !s.dataset && sectionIndex(s) < firstDataset).map(drawSection)}
        {dsSections.length > 0 && (
          // the dataset's own pages (Overview, Tasks, Runs, Analysis) in one group under the dataset in focus
          <div className="rg-nav-ds" role="group" aria-label={`This dataset: ${dsName || 'loading'}`} data-el="nav-dataset-group">
            {navOpen
              ? <DatasetSwitch condition={condition} datasets={datasets} waiting={waiting} />
              // narrow list: the short folder name fits where the full name would be cut; the full name is its hint
              : <span className="rg-nav-ds-cap" data-el="nav-dataset-caption" data-hint={dsName ? `Dataset in focus: ${dsName}${dsName !== dir ? ` (${dir})` : ''}` : undefined}>{dir ? breakAfterUnderscores(dir) : '…'}</span>}
            {dsSections.map(drawSection)}
          </div>
        )}
        {model.sections.filter((s) => !s.dataset && sectionIndex(s) > firstDataset).map(drawSection)}
      </div>
      <span className="sp" />
    </nav>
  )
  function drawSection(s) {
          const shown = s.open ? s.children : s.children.filter((c) => c.on)
          const needsDir = s.dataset && wait
          return (
            <div key={s.id} className={cx('rg-nav-sec', s.rule && 'rule', s.open && 'open')} data-section={s.id}>
              <div className="rg-nav-row">
                <RailButton label={s.label} icon={s.icon} spec={needsDir ? null : s.spec} on={s.on} has={s.has && !s.on} el={s.el} tour={s.tour || s.el.split(' ').pop()} add={s.add} onGo={goSection(s)} waiting={needsDir} />
                {s.children.length > 0 && (
                  <button type="button" className="rg-nav-tog" aria-expanded={s.open} aria-label={`${s.open ? 'Hide' : 'Show'} the ${s.label} pages`} data-el={`nav-toggle-${s.id}`}
                    data-hint={`${s.open ? 'Hide' : 'Show'} the ${s.label} pages`} onClick={() => toggle(s.id, s.open)}>
                    <Icon name={s.open ? 'chevd' : 'right'} size={12} />
                  </button>
                )}
              </div>
              {shown.length > 0 && <Kids section={s} rows={shown} onGo={onGo} />}
            </div>
          )
  }
}
