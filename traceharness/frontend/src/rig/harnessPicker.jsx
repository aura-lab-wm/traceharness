import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

// A searchable single-choice control. Display text never replaces the caller's stable ID.
export function HarnessPicker({ label, value, options = [], onChange, placeholder = 'Choose an option', searchPlaceholder, emptyMessage = 'No matching options', disabled = false, loading = false, hint, step }) {
  const id = useId()
  const root = useRef(null)
  const input = useRef(null)
  const control = useRef(null)
  const popup = useRef(null)
  const list = useRef(null)
  const pointerGesture = useRef(null)
  const [pointerOptions, setPointerOptions] = useState(null)
  const releasePointer = useCallback(() => {
    pointerGesture.current = null
    setPointerOptions(null)
  }, [])
  // Catalog updates must not move a pressed row before the browser dispatches click.
  const displayOptions = pointerOptions || options
  // Hover must not move a partially visible row away from the next click.
  // State also re-enables keyboard scrolling when the active ID stays the same.
  const [scrollActive, setScrollActive] = useState(true)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeValue, setActiveValue] = useState(null)
  const [placement, setPlacement] = useState(null)
  const selected = options.find((option) => option.value === value)
  const groups = useMemo(() => {
    const result = new Map()
    const term = query.trim().toLocaleLowerCase()
    for (const option of displayOptions) {
      if (term && ![option.label, option.value, option.description, option.meta, option.group].filter(Boolean).join(' ').toLocaleLowerCase().includes(term)) continue
      const group = option.group || ''
      if (!result.has(group)) result.set(group, [])
      result.get(group).push(option)
    }
    return [...result.entries()]
  }, [displayOptions, query])
  const visible = groups.flatMap(([, rows]) => rows)
  const enabled = visible.filter((option) => !option.disabled)
  const active = enabled.find((option) => option.value === activeValue) || enabled[0]
  const activeIndex = active ? visible.indexOf(active) : -1
  const shown = open && !disabled

  useEffect(() => { if (disabled) { setOpen(false); setQuery('') } }, [disabled])
  useEffect(() => {
    if (!shown) return
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [shown])
  useEffect(() => {
    if (!shown) { releasePointer(); return }
    const end = (event) => {
      const gesture = pointerGesture.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      // Keep the snapshot through click, which follows pointerup. A release elsewhere
      // cannot click the pressed row; touch scrolling instead produces pointercancel.
      if (event.type === 'pointercancel' || !gesture.element.contains(event.target)) releasePointer()
    }
    document.addEventListener('pointerup', end)
    document.addEventListener('pointercancel', end)
    document.addEventListener('click', releasePointer)
    window.addEventListener('blur', releasePointer)
    return () => {
      pointerGesture.current = null
      document.removeEventListener('pointerup', end)
      document.removeEventListener('pointercancel', end)
      document.removeEventListener('click', releasePointer)
      window.removeEventListener('blur', releasePointer)
    }
  }, [shown, releasePointer])
  useLayoutEffect(() => {
    if (!shown || !placement || activeIndex < 0 || !list.current || !scrollActive) return
    const option = document.getElementById(`${id}-option-${activeIndex}`)?.getBoundingClientRect()
    const bounds = list.current.getBoundingClientRect()
    if (!option) return
    if (option.top < bounds.top) list.current.scrollTop -= bounds.top - option.top
    else if (option.bottom > bounds.bottom) list.current.scrollTop += option.bottom - bounds.bottom
  }, [shown, activeIndex, id, query, placement, scrollActive])
  useLayoutEffect(() => {
    if (!shown) return
    const viewport = window.visualViewport
    const update = (event) => {
      if (event?.type === 'scroll' && popup.current?.contains(event.target)) return
      if (!root.current || !control.current) return
      const origin = root.current.getBoundingClientRect()
      const anchor = control.current.getBoundingClientRect()
      let top = viewport?.offsetTop || 0
      let bottom = top + (viewport?.height || window.innerHeight)
      // The workbench scrollport can end above the browser's viewport (status bar/dock).
      for (let parent = root.current.parentElement; parent; parent = parent.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue
        const bounds = parent.getBoundingClientRect()
        if (!bounds.height) continue
        top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom)
      }
      if (anchor.height && (anchor.bottom <= top || anchor.top >= bottom)) { setOpen(false); return }
      const below = Math.max(0, bottom - anchor.bottom - 16)
      const above = Math.max(0, anchor.top - top - 16)
      const upward = below < 240 && above > below
      const next = { side: upward ? 'above' : 'below', anchorWidth: anchor.width, maxHeight: Math.min(460, upward ? above : below),
        top: upward ? undefined : anchor.bottom - origin.top + 8,
        bottom: upward ? origin.bottom - anchor.top + 8 : undefined }
      setPlacement((old) => old && Object.keys(next).every((key) => old[key] === next[key]) ? old : next)
    }
    update()
    // Absolute popup dimensions depend on the anchor and its clipping ancestors,
    // which can resize without a window resize or scroll. Never observe the popup
    // itself: changing its maxHeight must not feed back into observation.
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => update()) : null
    for (let element = root.current; element; element = element.parentElement) resizeObserver?.observe(element)
    if (control.current) resizeObserver?.observe(control.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [shown])

  function expand() {
    if (disabled || shown) return
    setScrollActive(true)
    setQuery(''); setActiveValue(value); setOpen(true)
  }
  function choose(option) {
    const current = option && options.find((row) => row.value === option.value)
    if (!current || option.disabled || current.disabled || disabled) return
    onChange(current.value)
    setOpen(false); setQuery('')
    input.current?.focus()
  }
  function keydown(event) {
    if (event.nativeEvent?.isComposing) return
    releasePointer()
    if (event.key === 'Escape' && shown) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); setQuery(''); return
    }
    if (event.key === 'Tab') { setOpen(false); setQuery(''); return }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (shown) choose(active)
      else expand()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !shown && ['Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!shown) { expand(); return }
    if (!enabled.length) return
    setScrollActive(true)
    const current = enabled.findIndex((option) => option.value === active?.value)
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
    setActiveValue(enabled[index].value)
  }

  return <div ref={root} className={`rg-fld rg-harness-picker${shown ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery('') }
  }}>
    <label id={`${id}-label`} className="rg-composer-step" htmlFor={`${id}-input`}>{step && <span aria-hidden="true">{step} · </span>}{label}</label>
    <div ref={control} className="rg-harness-picker-control">
      <input ref={input} id={`${id}-input`} role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={shown} aria-haspopup="listbox"
        aria-controls={shown ? `${id}-list` : undefined} aria-activedescendant={shown && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined} aria-busy={loading || undefined} disabled={disabled}
        autoComplete="off" spellCheck={false} value={shown ? query : selected?.label || value || ''}
        placeholder={shown ? searchPlaceholder || `Search ${label.toLowerCase()}` : loading ? 'Loading…' : placeholder}
        onFocus={(event) => event.currentTarget.select()} onClick={expand} onKeyDown={keydown} onChange={(event) => { setScrollActive(true); setOpen(true); setQuery(event.target.value); setActiveValue(null) }} />
      <button type="button" className="rg-harness-picker-toggle" tabIndex={-1} aria-label={`${shown ? 'Close' : 'Show'} ${label.toLowerCase()} options`} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={() => { if (shown) setOpen(false); else expand(); input.current?.focus() }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
    {hint && <small id={`${id}-hint`} className="rg-harness-picker-hint">{hint}</small>}
    {shown && <div ref={popup} className="rg-harness-picker-popup" data-placement={placement?.side}
      style={{ top: placement?.top ?? 'auto', bottom: placement?.bottom ?? 'auto', maxHeight: placement?.maxHeight, visibility: placement ? undefined : 'hidden' }}>
      <div className="rg-harness-picker-resultline" aria-live="polite">{loading ? 'Loading choices…' : `${visible.length} ${visible.length === 1 ? 'choice' : 'choices'}`}<span aria-hidden="true">↑ ↓ navigate · Enter select</span></div>
      <div ref={list} id={`${id}-list`} role="listbox" aria-label={`${label} options`} className="rg-harness-picker-list">
        {groups.map(([group, rows]) => <div key={group} role={group ? 'group' : undefined} aria-label={group || undefined}>
          {group && <div className="rg-harness-picker-group" aria-hidden="true">{group}</div>}
          {rows.map((option) => {
            const index = visible.indexOf(option)
            const details = [option.description && `${id}-description-${index}`, option.meta && `${id}-meta-${index}`, option.status && `${id}-status-${index}`].filter(Boolean).join(' ')
            return <div key={option.value} id={`${id}-option-${index}`} role="option" aria-label={option.label} aria-describedby={details || undefined} aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
              className={`rg-harness-picker-option${active?.value === option.value ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
              onPointerDown={(event) => {
                if (event.button !== 0 || event.isPrimary === false || option.disabled || disabled) return
                pointerGesture.current = { pointerId: event.pointerId, value: option.value, element: event.currentTarget }
                setPointerOptions(displayOptions); setScrollActive(false)
              }}
              onMouseDown={(event) => event.preventDefault()} onMouseMove={() => { if (!option.disabled) { setScrollActive(false); setActiveValue(option.value) } }} onClick={() => {
                if (!pointerGesture.current || pointerGesture.current.value === option.value) choose(option)
                releasePointer()
              }}>
              <span className="rg-harness-picker-option-copy"><strong>{option.label}</strong>{option.description && <span id={`${id}-description-${index}`}>{option.description}</span>}{option.meta && <small id={`${id}-meta-${index}`}>{option.meta}</small>}</span>
              <span className="rg-harness-picker-option-trailing">{option.status && <small id={`${id}-status-${index}`}>{option.status}</small>}{option.value === value && <span className="rg-harness-picker-check" aria-hidden="true">✓</span>}</span>
            </div>
          })}
        </div>)}
        {!visible.length && <div className="rg-harness-picker-empty">{loading ? 'Loading choices…' : emptyMessage}{query && <span>Try a different name or identifier.</span>}</div>}
      </div>
    </div>}
  </div>
}
