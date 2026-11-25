/* Rig · Inspector.jsx — the analysis page layout and its inspector, and the "i" help mark.

   <AnalysisLayout inspector={{ title, sub?, body }} | null wide? onInspect? el?>document</AnalysisLayout>
   The inspector shows the evidence of what is selected (a matrix cell, a column). It opens when something
   is selected (hash sel=, so a link reopens it) and closes with its ✕ or Esc. Where it goes depends on
   the room the document has, never on the window:
     column     300px beside the document, when the document keeps at least 1040px (and `wide`, the
                width a wide table needs, still fits beside it)
     slide-over 360px over the right of the pane, when that leaves at least 480px of document
     sheet      a bottom sheet, up to 60% of the pane's height
   An overlay takes the focus when it opens and gives it back when it closes. `i` opens it on the
   page's default selection (`onInspect`) or closes it. */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRig, usePane } from './context'
import { Icon, useSize } from './ui'
import { HoverCard } from './HoverCard'
import './inspector.css'

const cx = (...a) => a.filter(Boolean).join(' ')
export const COLUMN_W = 300, SLIDE_W = 360, DOC_MIN = 480, COLUMN_DOC_MIN = 1040

/** Which form the inspector takes beside a document `width` px wide (0: not measured yet). */
export function inspectorMode(width, wide = 0) {
  if (!width) return 'slide-over'
  if (width - COLUMN_W >= Math.max(COLUMN_DOC_MIN, wide)) return 'column'
  if (width - SLIDE_W >= DOC_MIN) return 'slide-over'
  return 'sheet'
}

function Frame({ mode, title, sub, onClose, children }) {
  const ref = useRef(null)
  const inside = useRef(false)
  useEffect(() => {
    if (mode === 'column') return undefined
    const opener = document.activeElement
    const node = ref.current
    if (node) node.focus({ preventScroll: true })
    return () => { if (inside.current && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true }) }
  }, [mode])
  return (
    <aside className={cx('rg-insp', `rg-insp-${mode}`)} data-el="inspector" data-mode={mode} aria-label="Inspector" tabIndex={-1} ref={ref}
      onFocus={() => { inside.current = true }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) inside.current = false }}>
      <header className="rg-insp-h">
        <div className="rg-insp-ht"><h2 className="rg-insp-t">{title}</h2>{sub && <p className="rg-insp-s">{sub}</p>}</div>
        <button type="button" className="rg-btn ghost ico" data-el="inspector-close" aria-label="Close inspector" data-hint="Close (Esc)" onClick={onClose}><Icon name="x" size={14} /></button>
      </header>
      <div className="rg-insp-b">{children}</div>
    </aside>
  )
}

export function AnalysisLayout({ inspector, wide = 0, onInspect, el, children }) {
  const { select } = useRig()
  const { focused, el: paneEl } = usePane()
  const ref = useRef(null)
  const { width } = useSize(ref)
  const mode = inspectorMode(width, wide)
  const open = !!inspector && focused
  const inspect = useRef(onInspect)
  inspect.current = onInspect
  useEffect(() => {
    if (!focused) return undefined
    const on = () => { if (inspect.current) inspect.current() }
    window.addEventListener('rig:inspect', on)
    return () => window.removeEventListener('rig:inspect', on)
  }, [focused])
  const frame = open ? <Frame mode={mode} title={inspector.title} sub={inspector.sub} onClose={() => select(null)}>{inspector.body}</Frame> : null
  return (
    <div className={cx('rg-al', open && mode === 'column' && 'rg-al-col')} ref={ref} data-el={el} data-insp={open ? mode : undefined}>
      <div className="rg-al-doc">{children}</div>
      {open && mode === 'column' && frame}
      {open && mode !== 'column' && (paneEl ? createPortal(frame, paneEl) : frame)}
    </div>
  )
}

/** <InspectorGroup title>rows</InspectorGroup> and <InspectorRow label value sub?/> — the inspector's
 *  labelled groups ("The cell you selected", "Paired change vs baseline"). */
export function InspectorGroup({ title, el, children }) {
  return <section className="rg-insp-g" data-el={el} aria-label={title}><h3 className="rg-insp-gt">{title}</h3>{children}</section>
}
export function InspectorRow({ label, value, sub, el, fact }) {
  return (
    <div className="rg-insp-r" data-el={el}>
      <span className="rg-insp-k">{label}</span>
      <span className="rg-insp-v" data-fact={fact}>{value == null || value === '' ? '—' : value}</span>
      {sub && <span className="rg-insp-sub">{sub}</span>}
    </div>
  )
}

/** <InfoTip label>explanation</InfoTip> — the "i" beside a label or a number: a HoverCard (HoverCard.jsx)
 *  that the hover shows and a click pins open (a second click, Esc or a press elsewhere closes it). The words
 *  stay in the document while it is closed, so screen readers reach them (they describe the button). */
export function InfoTip({ label = 'About this', el, children }) {
  return (
    <HoverCard className="rg-info" el={el} toggle content={<div className="rg-info-pop">{children}</div>}>
      <button type="button" className="rg-info-b" aria-label={label}><Icon name="info" size={14} /></button>
    </HoverCard>
  )
}
