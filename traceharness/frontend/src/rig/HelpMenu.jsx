/* Rig · HelpMenu.jsx — the "?" in the pane head: Guide me through this page, the tour, Learn (which
   holds the reading guide and reference materials), Ask Buddy, the shortcut sheet and the voice tour.
   The list is fixed to the window under its button, so nothing clips it. */
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './ui'

const cx = (...a) => a.filter(Boolean).join(' ')

/** The Help items, shared by the sidebar menu and the phone's More menu. */
export function helpItems({ onTour, onLearn, learnDesc, onKeys, onVoice, onPageGuide, onBuddy }) {
  return [
    onPageGuide && { id: 'page', label: 'Guide me through this page', desc: 'A few steps over the parts of this page; you stay on it.', el: 'guide-me', run: onPageGuide },
    { id: 'tour', label: 'Take the tour', desc: 'Seven steps around the whole console, page by page.', run: onTour },
    onLearn && { id: 'learn', label: 'Learn', desc: learnDesc, run: onLearn },
    onBuddy && { id: 'buddy', label: 'Ask Buddy', desc: 'Ask a question about the data in front of you.', hint: 'J', el: 'buddy-launcher', run: onBuddy },
    { id: 'keys', label: 'Keyboard shortcuts', desc: 'Every key the console answers to.', hint: '?', run: onKeys },
    { id: 'voice', label: 'Voice tour', desc: 'Five narrated chapters, played over the real pages.', run: onVoice },
  ].filter(Boolean)
}

export default function HelpMenu({ items, on }) {
  const [open, setOpen] = useState(null)   // { left, bottom } while open
  const root = useRef(null), button = useRef(null), list = useRef(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const first = list.current && list.current.querySelector('[role="menuitem"]')
    if (first) first.focus()
    const off = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(null) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  const toggle = () => {
    if (open) { setOpen(null); return }
    const r = button.current.getBoundingClientRect()
    const w = window.innerWidth || 0
    setOpen({ left: Math.max(8, Math.min(r.left, w - 312)), top: r.bottom + 4 })
  }
  const close = () => { setOpen(null); button.current?.focus() }
  const choose = (it, e) => { close(); it.run(e) }
  const onKeyDown = (e) => {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
    if (e.key === 'Tab') { setOpen(null); return }
    const its = [...list.current.querySelectorAll('[role="menuitem"]')]
    const i = its.indexOf(document.activeElement)
    const n = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? its.length - 1 : null
    if (n == null) return
    e.preventDefault()
    its[(n + its.length) % its.length].focus()
  }
  return (
    <div className="rg-help" ref={root} onKeyDown={onKeyDown}>
      {/* on a Learn page (it lives in Help) a quiet mark, not the pressed fill, which reads as a control left on */}
      <button type="button" ref={button} className={cx('rg-tbtn', on && 'here')} data-el="nav-help" data-tour="help" aria-label="Help" aria-haspopup="menu"
        aria-expanded={!!open} aria-controls={open ? id : undefined} aria-current={on ? 'page' : undefined} data-hint={`Help: guide me, tour, Learn, Buddy, shortcuts${on ? ' · Learn is open (it lives in Help)' : ''}`} onClick={toggle}>
        <Icon name="q" size={16} />
      </button>
      {open && (
        <div className="rg-help-m" role="menu" id={id} aria-label="Help" ref={list} style={{ '--rig-help-left': `${open.left}px`, '--rig-help-top': `${open.top}px` }}>
          {items.map((it) => (
            <button key={it.id} type="button" role="menuitem" className="rg-help-it" data-el={it.el || `help-${it.id}`} aria-label={it.label} aria-describedby={it.desc ? `${id}-${it.id}` : undefined} onClick={(e) => choose(it, e)}>
              <span className="rg-grow rg-help-l"><span>{it.label}</span>{it.desc && <span className="rg-help-d" id={`${id}-${it.id}`}>{it.desc}</span>}</span>{it.hint && <span className="rg-kbd" aria-hidden="true">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
