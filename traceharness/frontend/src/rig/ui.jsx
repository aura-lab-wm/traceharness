/* ====================================================================================
   Rig · ui.jsx — shared primitives. Views compose these; they never restyle them.
   Every class is `rg-*` (see rig.css). Props are documented on each export.
   ==================================================================================== */
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IS_STATIC, notInExportText } from '../api'
import { useRig, usePane } from './context'
import { below } from './displayClasses'
import { makeSpec, withChain, parseSpec } from './route'
import { useCaseFile, togglePin } from './caseFile'
import { useDatasets, useDataset, useOutcomes, verdict, short, fmt, isFailureMode, resolveCondition } from './data'
import { QUESTION_META } from './answers'

/* Responsive building blocks (Split, PageHeader, Toolbar, Card, TableScroll, Tabs, ActionBar, Menu, Kpis,
   Id, PanelState, Skeleton, Field, Modal, ScrollX, useSize) live in primitives.jsx and are part of this
   module's surface: views import everything from '../ui'. */
export * from './primitives'
export { StatusIcon } from './StatusIcon'
export { EntityDot, EntityName } from './EntityDot'
import { ScrollX } from './primitives'
import { figureParts } from './truth'
import { Term } from './Term'
import { HarnessName } from './HarnessName'
import { EntityName } from './EntityDot'
import { StatusIcon } from './StatusIcon'
import { statusOf } from './status'

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'
const cx = (...a) => a.filter(Boolean).join(' ')

/* ---------------------------------------------------------------- icons */
const IC = {
  data: <><path d="M4 5h16M4 12h16M4 19h16" /><path d="M8 3v4M14 10v4M10 17v4" /></>,
  db: <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" /><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" /><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" /></>,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15" /></>,
  updown: <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />,
  an: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  traj: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  src: <><path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" /><path d="M4 14.5v5h16v-5" /></>,
  sent: <><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /><path d="M12 8v5M12 16v.01" /></>,
  canvas: <><rect x="3" y="3" width="7" height="6" /><rect x="14" y="15" width="7" height="6" /><rect x="14" y="3" width="7" height="6" /><path d="M10 6h4M17.5 9v6" /></>,
  set: <><circle cx="12" cy="12" r="2.8" /><path d="M10.3 3h3.4l.6 2.6 1.9 1.1 2.5-.8 1.7 2.9-2 1.8v2.2l2 1.8-1.7 2.9-2.5-.8-1.9 1.1-.6 2.6h-3.4l-.6-2.6-1.9-1.1-2.5.8-1.7-2.9 2-1.8v-2.2l-2-1.8 1.7-2.9 2.5.8 1.9-1.1z" /></>,
  guide: <><path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z" /><path d="M20 4h-4a2 2 0 0 0-2 2" /><path d="M20 4v14h-6" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  split: <><rect x="3" y="4" width="18" height="16" /><path d="M12 4v16" /></>,
  max: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  unmax: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  buddy: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  sys: <><rect x="3" y="4" width="18" height="12" /><path d="M8 20h8M12 16v4" /></>,
  tabs: <><rect x="3" y="6" width="18" height="14" /><path d="M3 10h18M8 6V3h13v13h-3" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  chev: <path d="M6 9l6 6 6-6" />,
  up: <path d="M6 15l6-6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  ext: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  cap: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  log: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />,
  pin: <><path d="M12 17v5" /><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" /></>,
  case: <><rect x="3" y="7" width="18" height="13" /><path d="M9 7V4h6v3M3 12h18" /></>,
  q: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17v.01" /></>,
  down: <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />,
  fork: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><path d="M6 7v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 13v4" /></>,
  cmp: <><rect x="3" y="4" width="7" height="16" /><rect x="14" y="4" width="7" height="16" /></>,
  pkg: <><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  contrast: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M12 7h4.5M12 11h6.5M12 15h5.5" /></>,
  contrastl: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M12 7H7.5M12 11H5.5M12 15H6.5" /></>,
  /* Studio Graphite set, 24px grid, round caps */
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  home: <><path d="m3 10.5 9-7.5 9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" /></>,
  tasks: <><path d="m3 7 2 2 4-4" /><path d="m3 17 2 2 4-4" /><path d="M13 6h8M13 12h8M13 18h8" /></>,
  pulse: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  chart: <><path d="M3 3v18h18" /><path d="M18 17V9M13 17V5M8 17v-3" /></>,
  layout: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  sliders: <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />,
  shield: <path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  plus: <path d="M5 12h14M12 5v14" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  chevrons: <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />,
  chevl: <path d="m15 18-6-6 6-6" />,
  chevd: <path d="m6 9 6 6 6-6" />,
  sortd: <path d="M12 5v14M19 12l-7 7-7-7" />,
  sortu: <path d="M12 19V5M5 12l7-7 7 7" />,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" /></>,
  play: <path d="M7 4v16l13-8z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  wrench: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />,
  scissors: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.1 8.1 12 12M20 4 8.1 15.9M14.8 14.8 20 20" /></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  alert: <><path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3" /><path d="M12 9v4M12 17h.01" /></>,
  flag: <path d="M4 22V4M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1" />,
  grade: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="m9 12 2 2 4-4" /></>,
  arrowr: <path d="M5 12h14M13 6l6 6-6 6" />,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  mark: <path d="M3 17l5-6 4 3 4-7 5 5" />,
  compare: <><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 18H8a2 2 0 0 1-2-2V9" /></>,
  chevr: <path d="m9 18 6-6-6-6" />,
  agent: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
}
/** <Icon name="search" size={16}/> — stroke icon, aria-hidden. */
export function Icon({ name, size = 18 }) {
  return <svg className="rg-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{IC[name] || null}</svg>
}
/** <Kbd>{MOD} K</Kbd> */
export function Kbd({ children }) { return <span className="rg-kbd">{children}</span> }
/** <Wb>{id}</Wb> — a long identifier (a folder, a harness, a task id) may wrap after "_", "/" or "+" as well as at its
 *  hyphens, never inside a word (nor inside a version such as 2.4.x): a <wbr> after each of those marks. The text
 *  itself is unchanged. */
export function Wb({ children }) {
  const parts = String(children ?? '').split(/(?<=[_/+])(?=.)/)
  return parts.length < 2 ? parts[0] : parts.map((p, i) => <Fragment key={i}>{i > 0 && <wbr />}{p}</Fragment>)
}

/* ---------------------------------------------------------------- verdicts & bars */
const VWORD = { true: 'Pass', false: 'Fail', null: 'Ungraded' }
/** <Verdict v={true|false|null}/> — the status shape (StatusIcon), named Pass / Fail / Ungraded.
 *  Unknown is never drawn as a failure. */
export function Verdict({ v }) {
  const k = v === true ? 'p' : v === false ? 'f' : 'u'
  return <StatusIcon status={v === true || v === false ? v : null} label={VWORD[String(v === true ? true : v === false ? false : null)]} className={`rg-v ${k}`} />
}
/** <VerdictText v words={['Pass','Fail','Ungraded']}/> — the outcome words with their shape, one form everywhere */
export function VerdictText({ v, words = ['Pass', 'Fail', 'Ungraded'] }) {
  const k = v === true ? 'p' : v === false ? 'f' : 'u'
  return <span className={`rg-vt ${k}`}><StatusIcon status={v === true || v === false ? v : null} decorative />{v === true ? words[0] : v === false ? words[1] : words[2]}</span>
}
/** <OutcomeText word/> — an outcome word (Pass, Fail, Cut off, Ungraded) with its shape. */
export function OutcomeText({ word, className, el, tip }) {
  const s = statusOf(word)
  return <span className={cx('rg-vt', s === 'pass' ? 'p' : s === 'ungraded' ? 'u' : 'f', className)} data-el={el} data-hint={tip}><StatusIcon status={s} decorative />{word}</span>
}
/** <OutcomeBar p f u tall?/> — stacked pass / fail / unknown(hatched). */
export function OutcomeBar({ p = 0, f = 0, u = 0, tall = false }) {
  const n = p + f + u || 1
  return (
    <div className={cx('rg-obar', tall && 'tall')} role="img" aria-label={`${p} pass, ${f} fail, ${u} unknown`}>
      <i className="p" style={{ width: `${(p / n) * 100}%` }} /><i className="f" style={{ width: `${(f / n) * 100}%` }} /><i className="u" style={{ width: `${(u / n) * 100}%` }} />
    </div>
  )
}
/** <CiBar lo hi pt min=0 max=1 zero?/> — interval with point estimate; `zero` draws a reference tick. */
export function CiBar({ lo, hi, pt, min = 0, max = 1, zero }) {
  const X = (v) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100)).toFixed(2)}%`
  if (lo == null || hi == null) return <div className="rg-cibar" role="img" aria-label="no interval" />
  return (
    <div className="rg-cibar" role="img" aria-label={`95% CI ${fmt.pct(lo)} to ${fmt.pct(hi)}`}>
      {zero != null && <span className="z" style={{ left: X(zero) }} />}
      <span className="ci" style={{ left: X(lo), width: `calc(${X(hi)} - ${X(lo)})` }} />
      {pt != null && <span className="pt" style={{ left: `calc(${X(pt)} - 1px)` }} />}
    </div>
  )
}
/** <HBar label value max fmt/> — one labelled horizontal bar (value/max), value text right. */
export function HBar({ label, value, max = 1, text, tone }) {
  const w = value == null || !max ? 0 : Math.max(0, Math.min(1, value / max)) * 100
  return (
    <div className="rg-hb">
      <span className="nm" data-hint={String(label)}>{label}</span>
      <span className="bt"><i className={tone || ''} style={{ width: `${w}%` }} /></span>
      <span className="vl">{text ?? (value == null ? '—' : String(value))}</span>
    </div>
  )
}

/* ---------------------------------------------------------------- containers */
/** <Panel label meta? el? flush? id?>…</Panel> — hairline panel with a header strip. */
export function Panel({ label, meta, el, tour, flush, id, className, children, actions }) {
  return (
    <section className={cx('rg-pnl', className)} data-el={el} data-tour={tour} id={id} aria-label={typeof label === 'string' ? label : undefined}>
      <div className="rg-pnl-h"><span className="rg-lbl">{label}</span>{(meta || actions) && <span className="meta">{meta}{actions}</span>}</div>
      <div className={cx('rg-pnl-b', flush && 'flush')}>{children}</div>
    </section>
  )
}
/** <Stat label el?>…</Stat> — one cell of a `.rg-stats` row. */
export function Stat({ label, el, children, className }) {
  return <div className={cx('rg-stat', className)} data-el={el}><span className="rg-lbl">{label}</span>{children}</div>
}
/** <Tag tone="sky|red|acc|amb|dash" nc? tip?>…</Tag> — nc = no caps. acc = accent/selection, amb = caution.
 *  `tip` is its hover card (HoverCard.jsx), never a native title. */
export function Tag({ tone, nc, tip, children, el }) {
  const text = typeof children === 'string' || typeof children === 'number'
  return <span className={cx('rg-tag', tone, nc && 'nc')} data-hint={tip} data-el={el}>{text ? <span className="rg-ell">{children}</span> : children}</span>
}
/** <Note tone="acc|amb|red|sky">…</Note> */
export function Note({ tone, children, el }) { return <div className={cx('rg-note', tone)} data-el={el}>{children}</div> }

/** <Seg options={[[value,label],…]|[value,…]} value onChange label el/> — segmented control. */
export function Seg({ options, value, onChange, label, el }) {
  return (
    <div className="rg-seg" role="group" aria-label={label} data-el={el}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o]
        return <button type="button" key={v} className={v === value ? 'on' : ''} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      })}
    </div>
  )
}
/** <SearchBox value onChange placeholder el id?/> — `/` focuses the first one in the focused doc. */
export function SearchBox({ value, onChange, placeholder, el, id }) {
  return (
    <label className="rg-search" data-el={el}>
      <span className="sr-only">{placeholder}</span><Icon name="search" size={14} />
      <input className="rg-inp" id={id} type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
      <Kbd>/</Kbd>
    </label>
  )
}
/** <Switch checked onChange label el/> — role=switch. */
export function Switch({ checked, onChange, label, el }) {
  return <button type="button" role="switch" aria-checked={!!checked} className="rg-sw" data-el={el} onClick={() => onChange(!checked)}><span className="rg-sw-tr" /><span>{label}</span></button>
}

/* ---------------------------------------------------------------- navigation */
/** <Go spec side? className? tip? el?>label</Go> — opens a tab. ⌘/Ctrl-click opens it to the side.
 *  `tip` is its hover card (HoverCard.jsx), never a native title.
 *  An entity name (.rg-elink) or a row marked `link` is a real <a href>: it can be copied or opened in a
 *  new browser tab, and a plain click still opens the page as a tab. Other Go controls stay buttons (their
 *  role is part of the views' tested contracts). */
const LINKISH = /(^|\s)rg-elink(\s|$)/
/** A Go to the page already in view is inert: same element and words, `aria-current="page"`, no action, and
 *  its hint says so ("You are here", or `hereTip`). `hereLabel` replaces the words while it is (e.g. "In
 *  focus" for an icon-only control). `current` forces it. Opening to the side is never "here". */
export function Go({ spec, side, className, children, tip, el, chain, replace, label, current, tour, link, hereLabel, hereTip }) {
  const { openTab, oracle, isHere } = useRig()
  const { pi } = usePane()
  const target = chain !== undefined && spec != null ? withChain(spec, chain) : spec
  const here = !side && (!!current || (typeof isHere === 'function' && isHere(target, pi)))
  const shownKids = here && hereLabel != null ? hereLabel : children
  const hint = here ? hereTip || (tip ? `${tip} · you are here` : 'You are here') : tip
  if (link || LINKISH.test(className || '')) {
    const onClick = (e) => {
      if (e.button !== 0 || e.shiftKey || e.altKey) return   // a middle or shift click is the browser's
      e.preventDefault()
      if (here && !(e.metaKey || e.ctrlKey)) return
      openTab(spec, { side: !!(side || e.metaKey || e.ctrlKey), chain, replace })
    }
    return (
      <a href={`#/rig/${spec}${oracle && oracle !== 'hidden' ? `?o=${oracle}` : ''}`} className={className || 'rg-elink'} data-hint={hint} aria-label={label} aria-current={here ? 'page' : undefined}
        aria-disabled={here || undefined} data-here={here ? '' : undefined} data-el={el} data-tour={tour} data-spec={spec} onClick={onClick}>{shownKids}</a>
    )
  }
  if (here) {
    return (
      <button type="button" className={className || 'rg-go'} data-hint={hint} aria-label={label} aria-current="page" aria-disabled="true" data-here="" data-el={el} data-tour={tour} data-spec={spec}
        onClick={(e) => { e.preventDefault(); if (e.metaKey || e.ctrlKey) openTab(spec, { side: true, chain }) }}>{shownKids}</button>
    )
  }
  return (
    <button type="button" className={className || 'rg-go'} data-hint={tip} aria-label={label} data-el={el} data-tour={tour} data-spec={spec}
      onClick={(e) => { e.preventDefault(); openTab(spec, { side: side || e.metaKey || e.ctrlKey, chain, replace }) }}>{children}</button>
  )
}
/** <NumberChips items={[{ n, word, spec?, hint?, el? }]} el? label? tail? words? hint?/> — a page's key counts as chips
 *  under its title: the number in bold, its word after it; a chip with a `spec` opens that page. `tail` closes
 *  the line ("on this machine"). `words` is the sentence the chips stand for: a screen reader reads it instead of the
 *  chips, and the line shows it on hover (`hint`, its plain text), so no word of it is lost. Chips that open a page are
 *  never hidden from a screen reader: a line with `words` holds figures only. */
export function NumberChips({ items, el, label, tail, words, hint, className }) {
  const chips = items.filter(Boolean).map((it, i) => {
    const inner = <><b>{it.n}</b>{it.word ? ` ${it.word}` : ''}</>
    return it.spec && !words
      ? <Go key={i} link spec={it.spec} className="rg-num-chip" tip={it.hint} el={it.el}>{inner}</Go>
      : <span key={i} className="rg-num-chip" data-hint={words ? undefined : it.hint} data-el={it.el}>{inner}</span>
  })
  const end = tail && <span className="rg-nums-t">{tail}</span>
  return (
    <div className={cx('rg-nums', className)} role={words ? undefined : 'group'} aria-label={words ? undefined : label} data-el={el} data-hint={words ? hint : undefined}>
      {words ? <><span className="sr-only">{words}</span><span className="rg-nums-in" aria-hidden="true">{chips}{end}</span></> : <>{chips}{end}</>}
    </div>
  )
}
/** <Figures text/> — a finding sentence with its key figures (6.0×, 2.73M, 98.6%) in bold (truth.figureParts). */
export function Figures({ text }) {
  return figureParts(text).map((p, i) => (p.fig ? <b key={i}>{p.t}</b> : p.t))
}
/** <EntityLink spec>name</EntityLink> — the name of a dataset, task, run, harness or model that opens its
 *  page: bold, in the text colour, underlined on hover (rig.css .rg-elink). */
export function EntityLink({ className, ...rest }) {
  return <Go {...rest} link className={cx('rg-elink', className)} />
}

/* ---------------------------------------------------------------- states */
/** <Loading label/> — a quiet placeholder shaped like a document; figures never render before
 *  their denominators arrive. `label` says what is being read (e.g. "Reading /api/overview…"). */
export function Loading({ label = 'Loading…' }) {
  return (
    <div className="rg-state rg-loading" data-el="loading-state" aria-busy="true" role="status">
      <div className="rg-row rg-loading-l"><span className="rg-pulse" aria-hidden="true" /><span>{label}</span></div>
      <div className="rg-skel" style={{ height: 22, width: '36%' }} />
      <div className="rg-skel" style={{ height: 12, width: '58%' }} /><div className="rg-skel" style={{ height: 12, width: '44%' }} />
      <div className="rg-skel" style={{ height: 96, marginTop: 8 }} />
    </div>
  )
}
/** Plain-words reading of a failed request: what failed and the likely reason. */
export function errorWords(error) {
  const msg = String(error && error.message ? error.message : error || 'unknown error')
  if (/failed to fetch|networkerror|load failed|econnrefused|network request failed/i.test(msg)) return { msg, why: 'The backend did not answer. Is it running (python -m traceharness)? This page fills in by itself as soon as it answers again.' }
  if (/\b404\b|not found/i.test(msg)) return { msg, why: 'The backend does not know this path — the dataset or run may have been moved or renamed.' }
  if (/\b5\d\d\b|internal server error/i.test(msg)) return { msg, why: 'The backend hit an error computing this. Retrying may help; the server log has the details.' }
  return { msg, why: null }
}
/** <ErrorState error onRetry? what?/> — a failed request shows nothing in its place: no zeros.
 *  DEAD-END RULE: names what failed in plain words, offers Retry (when possible) and a way back. */
/** A run's ledger that did not arrive. In a static export that only means the run was left out of the
 *  file, so it says so and offers no Retry (nothing can be fetched); on a live console it is an error. */
export function LedgerError({ det, run, what, title = notInExportText(run.ds) }) {
  if (IS_STATIC) return <Empty title={title} el="not-in-export" actions={[{ label: 'Back to datasets', spec: 'home', primary: true }]}>The console that wrote this export can open it.</Empty>
  return <ErrorState error={det.error} onRetry={det.reload} what={what} />
}
export function ErrorState({ error, onRetry, what = 'This document' }) {
  const { msg, why } = errorWords(error)
  return (
    <div className="rg-state rg-errstate" data-el="error-state" role="alert">
      <div className="rg-empty-t"><StatusIcon status="error" decorative /><b>{what} did not load.</b></div>
      <p className="rg-empty-why">{why || 'The request failed.'} Nothing is shown in its place — no partial numbers, no zeros.</p>
      <p className="rg-errstate-msg"><span className="rg-mute">Error · </span><span className="rg-mono">{msg}</span></p>
      <NextSteps actions={[onRetry && { label: 'Retry', onClick: onRetry, primary: true }, { label: 'Back to datasets', spec: 'home' }]} />
    </div>
  )
}
/** <Empty title actions? el? about?>why it is empty</Empty>
 *  DEAD-END RULE: an empty state says why it is empty AND offers at least one way forward.
 *  `actions`: [{label, spec?, onClick?, href?, copy?, primary?}] — see NextSteps.
 *  `about` (optional): longer explanation, tucked behind an "About this" disclosure.
 *  `more` (optional): extra nodes rendered after the actions (e.g. ways forward that load). */
export function Empty({ title, children, actions, el = 'empty-state', about, more }) {
  return (
    <div className="rg-empty" data-el={el}>
      <div className="rg-empty-t"><Verdict v={null} /><b>{title}</b></div>
      {children && <div className="rg-empty-why">{children}</div>}
      {actions && actions.filter(Boolean).length > 0 && <NextSteps actions={actions} />}
      {more}
      {about && <About>{about}</About>}
    </div>
  )
}
/** <NextSteps actions/> — a row of ways forward. Used by Empty and anywhere a flow ends.
 *  Each action: {label, spec} opens a tab · {label, onClick} runs a function · {label, href}
 *  follows a link · {copy: 'python -m …', label?} shows a copyable terminal command.
 *  `primary` marks the one main action. Falsy entries are skipped. */
export function NextSteps({ actions }) {
  return (
    <div className="rg-next" data-el="next-steps">
      {actions.filter(Boolean).map((a, i) => a.copy ? <CopyCmd key={i} cmd={a.copy} label={a.label} />
        : a.spec ? <Go key={i} spec={a.spec} side={a.side} replace={a.replace} className={cx('rg-btn', a.primary && 'pri')} tip={a.title}>{a.label}</Go>
          : a.href ? <a key={i} href={a.href} className={cx('rg-btn', a.primary && 'pri')}>{a.label}</a>
            : <button key={i} type="button" className={cx('rg-btn', a.primary && 'pri')} onClick={a.onClick} disabled={a.disabled || undefined} data-hint={a.title}>{a.label}</button>)}
    </div>
  )
}
/** <CopyCmd cmd label?/> — a terminal command with a Copy button, for when the only way
 *  forward is the terminal. The command stays selectable text either way. */
export function CopyCmd({ cmd, label }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    let ok = false
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(cmd); ok = true } } catch { ok = false }
    setDone(ok)
    toast(ok ? 'Copied the command — paste it in a terminal' : 'Copy is blocked here — select the command and copy it by hand')
  }
  return (
    <span className="rg-copy" data-el="copy-command">
      {label && <span className="rg-copy-l">{label}</span>}
      <code className="rg-copy-c">{cmd}</code>
      <button type="button" className="rg-btn ghost rg-copy-b" onClick={copy} aria-label={`Copy command: ${cmd}`}>{done ? 'Copied' : 'Copy'}</button>
    </span>
  )
}
/** <About summary?>longer explanation</About> — explanatory copy longer than ~2 lines lives
 *  behind this disclosure so the view leads with the answer or the action. */
export function About({ summary = 'About this', children, el }) {
  return <details className="rg-about" data-el={el}><summary>{summary}</summary><div className="rg-about-b">{children}</div></details>
}
/** <Why id?>reason</Why> — the visible reason a control is disabled (DEAD-END RULE: a disabled
 *  control always says why, and what to do to enable it). Pair with aria-describedby. */
export function Why({ id, children }) {
  return <span className="rg-why" id={id} data-el="disabled-reason">{children}</span>
}
let _why = 0
/** <Btn disabled why onClick …>label</Btn> — a button that, when disabled, shows its reason. */
export function Btn({ disabled, why, className, children, tip, ...rest }) {
  const [id] = useState(() => 'rg-why-' + (++_why))
  return (
    <span className="rg-btnwrap">
      <button type="button" className={cx('rg-btn', className)} disabled={disabled} aria-describedby={disabled && why ? id : undefined} data-hint={tip} {...rest}>{children}</button>
      {disabled && why && <Why id={id}>{why}</Why>}
    </span>
  )
}
/* Kinds whose first argument is a dataset directory (route.js grammar). */
const DIR_KINDS = ['ds', 'q', 'an', 'field', 'tasks', 'task']
function editDistance(a, b) {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 6) return 99
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}
/** Dataset names close to `name` (substring either way, or a few typos away), best first. */
export function similarDatasets(name, names) {
  const q = String(name || '').toLowerCase()
  if (!q) return []
  return names.map((n) => {
    const l = n.toLowerCase()
    const d = l === q ? 99 : l.includes(q) || q.includes(l) ? 0 : editDistance(q, l)
    return [n, d]
  }).filter(([, d]) => d <= Math.max(2, Math.floor(q.length / 4))).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([n]) => n)
}
/** <NotFound spec detail?/> — the not-found document. Never a crash; never a dead end: it
 *  offers search, the library, a near-miss dataset when the link names one, and closing the tab. */
export function NotFound({ spec, detail }) {
  const { setPalette, state, closeTab } = useRig()
  const what = String(spec || '').split('~')[0]
  const { kind, args } = parseSpec(what)
  const names = (useDatasets().data || []).map((r) => r.name)
  const near = DIR_KINDS.includes(kind) && args[0] && !names.includes(args[0]) ? similarDatasets(args[0], names) : []
  let at = null
  ;((state && state.panes) || []).forEach((p, pi) => { const i = p.tabs.indexOf(spec); if (i >= 0 && !at) at = [pi, i] })
  return (
    <div className="rg-dpad"><div className="rg-state-doc" data-el="not-found">
      <div className="rg-eyebrow">Not found · <span className="rg-mono">{what}</span></div>
      <h2>Nothing in the loaded data answers to <span className="rg-mono">{what.split(':').slice(1).join(':') || what}</span>.</h2>
      <p className="rg-empty-why">{detail || 'The link may name a dataset, run or view that is not in data/runs on this machine.'}</p>
      {near.length > 0 && <div className="rg-col rg-state-near"><span className="rg-lbl">Did you mean</span>
        <NextSteps actions={near.map((n) => ({ label: makeSpec(kind, n, ...args.slice(1)), spec: makeSpec(kind, n, ...args.slice(1)), primary: true }))} /></div>}
      <NextSteps actions={[
        { label: <>Search everything <Kbd>{MOD} K</Kbd></>, onClick: () => setPalette(true), primary: !near.length },
        { label: 'Datasets', spec: 'home' },
        at && { label: 'Close this tab', onClick: () => closeTab(at[0], at[1]) },
      ]} />
    </div></div>
  )
}

/* ---------------------------------------------------------------- confirm step for writes */
/** <ConfirmAction label confirmLabel? detail? onConfirm disabled? danger?/> — every write
 *  (launch, import, capture control, key save) goes through an explicit second click. */
/** `quiet` draws the first button plain (the page's filled button is a safer step); the confirming one stays filled. */
export function ConfirmAction({ label, confirmLabel = 'Confirm', detail, onConfirm, disabled, danger, quiet, el, why, busy: working }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [id] = useState(() => 'rg-why-' + (++_why))
  if (!armed) return (
    <span className="rg-btnwrap">
      <button type="button" className={cx('rg-btn', danger ? 'warn' : !quiet && 'pri')} disabled={disabled} aria-busy={working || undefined} data-el={el} aria-describedby={disabled && why ? id : undefined} onClick={() => setArmed(true)}>{label}</button>
      {disabled && why && <Why id={id}>{why}</Why>}
    </span>
  )
  return (
    <span className="rg-confirm" role="group" aria-label={`Confirm: ${label}`} data-el={el}>
      {detail && <span className="rg-small rg-dim">{detail}</span>}
      <button type="button" className={cx('rg-btn', danger ? 'warn' : 'pri')} disabled={busy} aria-busy={busy || undefined}
        onClick={async () => { setBusy(true); try { await onConfirm() } finally { setBusy(false); setArmed(false) } }}>{busy ? 'Working…' : confirmLabel}</button>
      <button type="button" className="rg-btn ghost" disabled={busy} onClick={() => setArmed(false)}>Cancel</button>
    </span>
  )
}

/* ---------------------------------------------------------------- failure modes */
const SHORT_MODE = { cutoff_no_patch: 'cut off', step_limit_no_patch: 'step limit', no_patch: 'no patch', wrong_patch: 'wrong patch', harness_error: 'harness error', strengthened_only: 'strengthened only' }
const STRONG_ONLY = { id: 'strengthened_only', label: 'strengthened only', meaning: 'Passed the hidden oracle; failed the extra cases of the strengthened oracle.' }
/* The console's own words for each mode. /api/outcomes still says "suite"; these win, so no label or
   tooltip says "hidden suite", whichever oracle is chosen. */
const MODE_MEANING = {
  harness_error: () => "The run recorded an error; the failure may not be the agent's.",
  cutoff_no_patch: () => 'The last model reply hit the per-call output limit (finish_reason "length") with no tool call; the harness ended the run before any edit, so the oracle ran on the original code.',
  step_limit_no_patch: () => 'The run used all its steps without producing a patch.',
  no_patch: () => 'The run ended without producing a patch, so the oracle ran on the original code.',
  wrong_patch: (o) => `The agent produced a patch and the ${o} oracle failed on it.`,
  strengthened_only: () => STRONG_ONLY.meaning,
}
/** { label, meaning } of a failure mode in the console's words: `meta` is /api/outcomes' entry. */
export function modeWords(mode, meta, oracle = 'hidden') {
  const label = (meta && meta.label) || SHORT_MODE[mode] || String(mode || '').replace(/_/g, ' ')
  const own = MODE_MEANING[mode]
  const meaning = own ? own(oracle) : String((meta && meta.meaning) || '').replace(/\bsuites?\b/g, (w) => (w === 'suite' ? 'oracle' : 'oracles'))
  return { label: mode === 'strengthened_only' ? STRONG_ONLY.label : label, meaning }
}
/** The mode a failed run shows under a suite, or null. Modes are hidden-suite modes from
 *  /api/outcomes; under `strengthened` a hidden pass that fails the strengthened suite is
 *  'strengthened_only'. A run that did not fail under `oracle` has no failure mode. */
export function failureModeOf(run, oracle = 'hidden') {
  if (!run || verdict(run, oracle) !== false) return null
  if (isFailureMode(run.mode)) return run.mode
  if (oracle === 'strengthened' && run.hid === true && run.str === false) return 'strengthened_only'
  return null
}
/** The one outcome word of a run under an oracle, used on every page: Pass, Fail, Cut off (a fail
 *  that ended at the output limit before any patch) or Ungraded. */
export function outcomeWord(run, oracle = 'hidden') {
  const v = verdict(run, oracle)
  if (v === true) return 'Pass'
  if (v === false) return failureModeOf(run, oracle) === 'cutoff_no_patch' ? 'Cut off' : 'Fail'
  return 'Ungraded'
}
export const OUTCOME_GLYPH = { Pass: '✓', Fail: '×', 'Cut off': '×', Ungraded: '?' }
/** Counts by outcome word: p Pass, f Fail (not cut off), c Cut off, u Ungraded. */
export function outcomeTally(list, oracle = 'hidden') {
  const t = { p: 0, f: 0, c: 0, u: 0 }
  for (const r of list || []) { const w = outcomeWord(r, oracle); t[w === 'Pass' ? 'p' : w === 'Fail' ? 'f' : w === 'Cut off' ? 'c' : 'u']++ }
  return t
}
/** <OutcomePill run oracle/> — the run's outcome word in a tinted pill with its status shape. */
export function OutcomePill({ run, oracle, el }) {
  const w = outcomeWord(run, oracle)
  const tone = w === 'Pass' ? 'sky' : w === 'Ungraded' ? 'dash' : 'red'
  return <span className={cx('rg-tag', tone, 'rg-opill')} data-el={el} data-hint={`Graded by the ${oracle} oracle`}><StatusIcon status={statusOf(w)} size={13} decorative />{w}</span>
}
/** <FailureChip run oracle?/> or <FailureChip mode dir/> — "cut off · no patch" etc.
 *  Renders nothing for a pass or an unknown grade (except the human-intervened mark). Tooltip + aria carry the mode's meaning. */
export function FailureChip({ run, mode, dir, oracle }) {
  const rig = useRig()
  const o = oracle || rig.oracle
  const m = mode || failureModeOf(run, o)
  const out = useOutcomes(m && m !== 'strengthened_only' ? dir || (run && run.ds) : null)
  const human = run && run.human ? <HumanChip run={run} /> : null
  if (!m || !isFailureMode(m)) return human
  const meta = modeWords(m, m === 'strengthened_only' ? STRONG_ONLY : out.data && out.data.byId[m], o)
  // role img: a span's aria-label is dropped by screen readers; the chip's words and meaning are one label
  return <>{human}<span className={cx('rg-fchip', m === 'wrong_patch' || m === 'strengthened_only' ? 'wp' : m === 'harness_error' ? 'he' : 'np')} role="img" data-hint={meta.meaning} aria-label={`${meta.label}${meta.meaning ? ': ' + meta.meaning : ''}`} data-mode={m}>{meta.label}</span></>
}
/** <HumanChip run/> — a person steered this run, so it is not an unattended measurement. Drawn beside every verdict
 *  (FailureChip carries it), because a pass that a reviewer edited must not read as the model's own. */
export function HumanChip({ run }) {
  if (!run || !run.human) return null
  const n = run.humanN || 1
  return <span className="rg-fchip he" role="img" data-el="human-intervened" data-hint="A person approved, denied, edited, redirected or stopped this run, so aggregate statistics leave it out unless you opt in." aria-label={`human-intervened: ${n} decision${n === 1 ? '' : 's'}`}>human-intervened{n > 1 ? ` ×${n}` : ''}</span>
}
/** Summary of failure modes over runs: "3 failed: 3 cut off", "2 failed; how they failed: not recorded" (null when
 *  none failed). */
export function failureSummary(runs, oracle = 'hidden') {
  const failed = (runs || []).filter((r) => verdict(r, oracle) === false)
  if (!failed.length) return null
  const counts = {}
  let unexplained = 0
  for (const r of failed) { const m = failureModeOf(r, oracle); if (m) counts[m] = (counts[m] || 0) + 1; else unexplained++ }
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${fmt.int(n)} ${SHORT_MODE[m] || m.replace(/_/g, ' ')}`)
  if (!unexplained) return `${fmt.int(failed.length)} failed: ${parts.join(', ')}`
  const how = unexplained === failed.length ? `how ${failed.length === 1 ? 'it' : 'they'} failed: not recorded` : `how ${fmt.int(unexplained)} failed: not recorded`
  return parts.length ? `${fmt.int(failed.length)} failed: ${parts.join(', ')}; ${how}` : `${fmt.int(failed.length)} failed; ${how}`
}
/** <FailureSummary runs/> */
export function FailureSummary({ runs }) {
  const { oracle } = useRig()
  const s = failureSummary(runs, oracle)
  return s ? <span className="rg-small rg-red-t" data-el="failure-summary">{s}</span> : null
}

/* ---------------------------------------------------------------- pin to case file */
/** <PinButton item={{id, kind, label, spec, …}} compact?/> — toggles the item in the case file. */
export function PinButton({ item, compact }) {
  const items = useCaseFile()
  const on = items.some((x) => x.id === item.id)
  const { toast, setDock } = useRig()
  return (
    <button type="button" className={cx('rg-pin', on && 'on', compact && 'cmp')} aria-pressed={on} data-hint={on ? 'Unpin from case file' : 'Pin to case file'}
      aria-label={`${on ? 'Unpin' : 'Pin'} ${item.label}`}
      onClick={(e) => { e.stopPropagation(); togglePin(item); toast(on ? `Unpinned ${item.label}` : `Pinned ${item.label} to the case file`, on ? null : { label: 'Open case file', onClick: () => setDock('case') }) }}>
      <Icon name="pin" size={13} />{!compact && <span>{on ? 'Pinned' : 'Pin'}</span>}
    </button>
  )
}

/* ---------------------------------------------------------------- Asking… sentence */
/** The ▾ of a bracket or an oracle button, drawn as an icon. */
export function Caret() { return <span className="rg-brk-c" aria-hidden="true"><Icon name="chevd" size={12} /></span> }
/** <AskingSentence dir model? harness? plain? pooled?/> — the scope line: "Asking <dataset> about <model> under
 *  <harness>, graded by the <oracle> oracle." as plain text, then one Change menu for model, harness and
 *  oracle (the dataset is switched in the page list). `plain` drops the Change (a run has one condition).
 *  `pooled` ("all 3 models × 9 harnesses"): the answer below pools them, so the line says that scope instead. */
export function AskingSentence({ dir, model, harness, plain, pooled }) {
  const { oracle, openCondition, conditionFor } = useRig()
  const row = useDataset(dir).data
  const c = row ? resolveCondition(row, model || conditionFor(dir).model, harness || conditionFor(dir).harness) : null
  if (!row || !c) return null
  return (
    <p className="rg-asking" data-el="asking-sentence condition-picker">
      <span className="rg-asking-s">Asking <b className="rg-mono">{dir}</b> about {pooled ? <><b>{pooled}</b>, pooled</> : <><b className="rg-mono"><EntityName kind="model" id={c.model} name={short(c.model)} /></b> under <HarnessName id={c.harness} dir={dir}><b className="rg-mono"><EntityName kind="harness" name={c.harness} /></b></HarnessName></>}, graded by the <Term slug="oracle-test-suite">{oracle} oracle</Term>.</span>
      {!plain && <button type="button" className="rg-asking-chg" data-el="harness-oracle-picker scope-change" data-pop="scope" data-tour="status-context" aria-haspopup="dialog"
        aria-label="Change model, harness or oracle" data-hint="Change the model, harness or oracle" onClick={(e) => openCondition && openCondition(e.currentTarget)}>Change<Caret /></button>}
    </p>
  )
}

/* ---------------------------------------------------------------- demo data and empty states */
/** <NoDataYet title? actions?>why</NoDataYet> — the empty state of a page that needs runs: says
 *  what to do next and links to Add data first, then any extra `actions` (NextSteps shape). */
export function NoDataYet({ title = 'No runs here yet.', actions = [], el = 'empty-state', children }) {
  return (
    <Empty title={title} el={el} actions={[{ label: 'Add data', spec: 'sources', primary: true }, ...actions]}>
      {children || 'Import a results folder, download a public sample or capture your own sessions, then come back here.'}
    </Empty>
  )
}

/* ---------------------------------------------------------------- evidence chain */
/** Where the answer drawn in pane `paneEl` stands with its figure: 'figure' (drawn, #rg-q-figure), 'none' (the
 *  question is not answered here) or 'wait' (still answering). Read from the page itself, so the chain in the
 *  pane's head follows the document under it. */
function useFigureState(paneEl, on) {
  const [state, setState] = useState('wait')
  useEffect(() => {
    if (!on || !paneEl) return undefined
    // anything else (an error, an empty page) keeps the old link: 'other'
    const read = () => setState(paneEl.querySelector('#rg-q-figure') ? 'figure' : paneEl.querySelector('[data-el~="question-unanswered"]') ? 'none'
      : paneEl.querySelector('.rg-doc [aria-busy="true"], .rg-doc .rg-skel') ? 'wait' : 'other')
    read()
    if (typeof MutationObserver === 'undefined') return undefined
    // read once per frame at most: the pane can change every frame (a replay)
    let frame = null
    const later = () => { if (frame == null) frame = requestAnimationFrame(() => { frame = null; read() }) }
    const watch = new MutationObserver(later)
    watch.observe(paneEl, { childList: true, subtree: true })
    return () => { watch.disconnect(); if (frame != null) cancelAnimationFrame(frame) }
  }, [on, paneEl])
  return on ? state : null
}
/** A section a jump just brought into view flashes once (data-state="jumped", rig.css), so the press is seen even
 *  when the section was in view already. */
export function flashJumped(el) {
  if (!el) return
  const st = el.getAttribute('data-state')
  if (st && st !== 'jumped') return   // a state of its own wins over the flash
  el.removeAttribute('data-state')
  void el.offsetWidth
  el.setAttribute('data-state', 'jumped')
  // the mark stays until the next press elsewhere: a jump to a section already in view only flashed, and the
  // flash was gone in a second (and never drawn under reduced motion)
  const doc = el.ownerDocument
  const clear = () => {
    if (el.getAttribute('data-state') === 'jumped') el.removeAttribute('data-state')
    doc.removeEventListener('pointerdown', clear, true)
    doc.removeEventListener('keydown', clear, true)
  }
  setTimeout(() => { doc.addEventListener('pointerdown', clear, true); doc.addEventListener('keydown', clear, true) }, 0)
}
const FIGURE_WHY = { none: 'No figure: this question is not answered here', wait: 'No figure yet: the answer is still loading' }
/** <EvidenceChain dir qid runId? seq? step="answer|figure|runs|run|event" count?/> —
 *  Answer → Figure → Runs → Run → Event. Each reachable step is a link (deep-linkable spec);
 *  unreachable steps are shown disabled with the reason as a tooltip. On the answer page the figure is further
 *  down the same page, so Figure jumps to it in place (a new tab would be this page again); with no figure there
 *  it is inert and says why. */
export function EvidenceChain({ dir, qid, runId, seq, step, count, runLabel }) {
  const { openTab, isHere = () => false } = useRig()
  const { pi, el: paneEl } = usePane()
  const chain = { dir, qid }
  const meta = QUESTION_META[qid]
  const figure = useFigureState(paneEl, step === 'answer')
  const steps = [
    ['answer', 'Answer', makeSpec('q', dir, qid), meta ? meta.short : qid],
    ['figure', 'Figure', makeSpec('q', dir, qid, 'figure'), null],
    ['runs', 'Runs', makeSpec('q', dir, qid, 'runs'), count != null ? fmt.int(count) : null],
    ['run', 'Run', runId ? withChain(makeSpec('run', runId), chain) : null, runLabel || (runId ? String(runId).slice(-6) : null)],
    ['event', 'Event', runId && seq != null ? withChain(makeSpec('span', runId, seq), chain) : null, seq != null ? '#' + seq : null],
  ]
  const jump = (e, spec) => {
    if (e.metaKey || e.ctrlKey) { openTab(spec, { side: true }); return }
    const fig = paneEl && paneEl.querySelector('#rg-q-figure')
    if (!fig) return
    fig.scrollIntoView({ block: 'start' })
    fig.focus({ preventScroll: true })
    flashJumped(fig)
  }
  return (
    <ScrollX className="rg-chain-s">
    <ol className="rg-chain" aria-label="Evidence chain" data-el="evidence-chain">
      {steps.map(([k, l, spec, em], i) => (
        <li key={k}>
          {spec && (step === k || isHere(spec, pi))
            // the step you are on: its words stay, it does nothing (Ctrl/⌘-click still opens it to the side)
            ? <button type="button" aria-current="step" aria-disabled="true" data-here="" data-hint={`${l} · you are here`} onClick={(e) => { if (e.metaKey || e.ctrlKey) openTab(spec, { side: true }) }}><b>{i + 1}</b>{l}{em && <em>{em}</em>}</button>
            : k === 'figure' && figure === 'figure'
              ? <button type="button" aria-label={`${i + 1} ${l}: jump to the figure on this page`} data-hint="Jump to the figure on this page" onClick={(e) => jump(e, spec)}><b>{i + 1}</b>{l}</button>
              : k === 'figure' && FIGURE_WHY[figure]
                ? <button type="button" className="off" aria-disabled="true" data-hint={FIGURE_WHY[figure]}><b>{i + 1}</b>{l}</button>
                : spec
                  ? <button type="button" onClick={(e) => openTab(spec, { side: e.metaKey || e.ctrlKey })}><b>{i + 1}</b>{l}{em && <em>{em}</em>}</button>
                  : <span className="off" data-hint={k === 'event' ? 'Open a run, then an event, to reach this step' : 'Open one of the runs to reach this step'}><b>{i + 1}</b>{l}</span>}
        </li>
      ))}
    </ol>
    </ScrollX>
  )
}

/* ---------------------------------------------------------------- refreshed */
/** refreshedWords({ verb?, what, changed, at }, now?) — what a Refresh button says after it acted:
 *  "Refreshed · 3 runs · just now", with "nothing changed" before the time when the answer came back the same. */
export function refreshedWords({ verb = 'Refreshed', what, changed, at }, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  const ago = s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 3600)} h ago`
  return [verb, what, changed === false ? 'nothing changed' : null, ago].filter(Boolean).join(' · ')
}
/** const [note, refreshed] = useRefreshed(verb?) — the state of a Refresh button's answer. refreshed.begin(before)
 *  when it is pressed (`before`: a string that changes when what it lists changes); refreshed.done(after, what) when
 *  the answer arrives (`what`: "3 runs"); refreshed.fail() when there was none (the page's error says why). A load
 *  the button did not ask for changes nothing. */
export function useRefreshed(verb) {
  const [note, setNote] = useState(null)
  const asked = useRef(null)
  const api = useMemo(() => ({
    begin: (before) => { asked.current = { before } },
    done: (after, what) => {
      const a = asked.current
      if (!a) return
      asked.current = null
      setNote({ verb, what, changed: a.before !== after, at: Date.now() })
    },
    fail: () => { asked.current = null; setNote(null) },
    waiting: () => !!asked.current,
  }), [verb])
  return [note, api]
}
/** <RefreshNote note el?/> — the line beside a Refresh button (useRefreshed); its "just now" ages while shown. */
export function RefreshNote({ note, el = 'refresh-note' }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!note) return undefined
    const t = setInterval(() => tick((x) => x + 1), 30000)
    return () => clearInterval(t)
  }, [note])
  if (!note) return null
  return <span className="rg-small rg-mute rg-refreshed" role="status" data-el={el}>{refreshedWords(note)}</span>
}

/* ---------------------------------------------------------------- toast */
const toastStore = { msg: null, action: null, at: null, n: 0, l: new Set() }
/* The control a hand last pressed, so a toast it set off can appear beside it. */
let pressed = { el: null, t: 0 }
if (typeof document !== 'undefined') document.addEventListener('pointerdown', (e) => { pressed = { el: e.target, t: Date.now() } }, true)
/** Where a toast goes: under the control that set it off (the one just pressed, else the focused one),
 *  or above it near the bottom of the window. null below a tablet, or with nothing to stand by: the toast
 *  then sits above the status bar. */
export function toastAnchor() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (window.matchMedia && window.matchMedia(below('tablet')).matches) return null
  const recent = pressed.el && Date.now() - pressed.t < 1500 && pressed.el.isConnected ? pressed.el : null
  const near = recent || document.activeElement
  const el = near && near.closest ? near.closest('button, a, [role="button"], [role="menuitem"], [role="option"], input, select, summary') : null
  if (!el || !el.closest('.rig') || !el.getBoundingClientRect) return null
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return null
  const x = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 336)))
  return r.bottom + 64 < window.innerHeight - 32 ? { x, y: Math.round(r.bottom + 8) } : { x, yb: Math.round(window.innerHeight - r.top + 8) }
}
/** toast(message, action?) — a transient status line. `action` = {label, onClick} adds the next
 *  step to a flow that just ended ("Pinned … · Open case file"); such a toast stays longer and
 *  holds while hovered or focused. It appears beside the control that set it off (toastAnchor). */
export function toast(msg, action) {
  toastStore.msg = msg; toastStore.action = action && action.label && action.onClick ? action : null
  try { toastStore.at = toastAnchor() } catch { toastStore.at = null }
  toastStore.n++; const pending = [...toastStore.l]; for (const f of pending) f()
}
const subToast = (f) => { toastStore.l.add(f); return () => toastStore.l.delete(f) }
/** Rendered once by RigApp. */
export function Toaster() {
  const n = useSyncExternalStore(subToast, () => toastStore.n, () => 0)
  const [show, setShow] = useState(false)
  const [hold, setHold] = useState(false)
  useEffect(() => { if (n) setShow(true) }, [n])
  useEffect(() => {
    if (!n || !show || hold) return
    const t = setTimeout(() => setShow(false), toastStore.action ? 6000 : 2400)
    return () => clearTimeout(t)
  }, [n, show, hold])
  const act = show ? toastStore.action : null
  const at = toastStore.at
  const style = at ? { '--rig-toast-x': `${at.x}px`, ...(at.y != null ? { '--rig-toast-y': `${at.y}px` } : { '--rig-toast-yb': `${at.yb}px` }) } : undefined
  return (
    <div className={cx('rg-toast', show && 'show', act && 'act', at && 'at', at && at.y == null && 'up')} style={style} role="status" aria-live="polite"
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      {show ? toastStore.msg : ''}
      {act && <button type="button" className="rg-btn rg-toast-b" onClick={() => { setShow(false); setHold(false); act.onClick() }}>{act.label}</button>}
    </div>
  )
}

/* ---------------------------------------------------------------- run helpers for lists */
/** <RunRef run/> — "c95aff" link that opens run:<id> (inherits an evidence chain). */
export function RunRef({ run, chain }) {
  if (!run) return null
  return <Go spec={chain ? withChain(makeSpec('run', run.id), chain) : makeSpec('run', run.id)} className="rg-tlink" tip={run.id}>{String(run.id).slice(-6)}</Go>
}
