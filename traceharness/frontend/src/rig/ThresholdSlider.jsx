/* Rig · ThresholdSlider.jsx — a slider over a few fixed points (Sentinel's evaluated operating points).

   * The thumb follows the pointer continuously (the range runs in hundredths of a point), so a drag is
     smooth even with four points; the value of the nearest point rides beside the thumb while it moves.
   * Letting go snaps to the nearest point: the thumb glides there (150 ms; none under reduced motion).
   * ← → ↑ ↓ step one point, Page Up / Page Down too, Home / End go to the ends.
   * While dragging only `onPreview(k)` fires, and only when the nearest point changes; `onCommit(k)` fires
     once, on release or on a key, so the page behind does its heavy work once. Styles: ThresholdSlider.css. */
import { useEffect, useRef, useState } from 'react'
import './ThresholdSlider.css'

const UNIT = 100

/** The point nearest to a fine position, held to the ends. */
export function nearestPoint(pos, count) {
  const last = Math.max(0, count - 1)
  return Math.max(0, Math.min(last, Math.round(pos / UNIT)))
}
/** The point a key moves to, or null for a key the slider does not use. */
export function keyStep(key, index, count) {
  const last = Math.max(0, count - 1)
  const to = key === 'ArrowRight' || key === 'ArrowUp' || key === 'PageUp' ? index + 1
    : key === 'ArrowLeft' || key === 'ArrowDown' || key === 'PageDown' ? index - 1
      : key === 'Home' ? 0 : key === 'End' ? last : null
  return to == null ? null : Math.max(0, Math.min(last, to))
}

export function ThresholdSlider({ points, index, onPreview, onCommit, label, format = String, el }) {
  const count = points.length
  const last = Math.max(0, count - 1)
  const [pos, setPos] = useState(null)       // fine position while a pointer drags; null = resting on `index`
  const posRef = useRef(null)
  const previewed = useRef(index)
  const near = pos == null ? index : nearestPoint(pos, count)
  const release = useRef(() => {})
  release.current = () => {
    const v = posRef.current
    if (v == null) return
    posRef.current = null
    setPos(null)
    const k = nearestPoint(v, count)
    previewed.current = k
    onCommit(k)
  }
  const dragging = pos != null
  useEffect(() => {
    if (!dragging) return undefined
    const up = () => release.current()
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [dragging])
  const onInput = (e) => {
    const v = Number(e.target.value)
    posRef.current = v
    setPos(v)
    const k = nearestPoint(v, count)
    if (k !== previewed.current) { previewed.current = k; if (onPreview) onPreview(k) }
  }
  const onKeyDown = (e) => {
    const k = keyStep(e.key, near, count)
    if (k == null) return
    e.preventDefault()
    posRef.current = null
    setPos(null)
    previewed.current = k
    if (k !== index) onCommit(k)
  }
  const at = last ? (pos ?? index * UNIT) / (last * UNIT) : 0
  return (
    <div className={['rg-thr', dragging && 'drag'].filter(Boolean).join(' ')} style={{ '--rig-thr-p': at }} data-el={el}>
      <div className="rg-thr-track" aria-hidden="true"><i className="rg-thr-fill on" /></div>
      <div className="rg-thr-ticks" aria-hidden="true">{points.map((p, k) => <i key={k} className={k === near ? 'on' : undefined} style={{ '--rig-thr-k': last ? k / last : 0 }} />)}</div>
      <span className="rg-thr-thumb on" aria-hidden="true" />
      <span className="rg-thr-tip" aria-hidden="true">{format(points[near])}</span>
      <input type="range" className="rg-thr-in" min={0} max={last * UNIT} step={1} value={pos ?? index * UNIT} aria-label={label} aria-valuetext={format(points[near])}
        onChange={onInput} onKeyDown={onKeyDown} onBlur={() => release.current()} />
    </div>
  )
}
