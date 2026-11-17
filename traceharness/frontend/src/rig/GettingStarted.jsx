import { useEffect, useRef, useState } from 'react'
import { GUIDE_TOPICS } from './guidance'
import { ScrollX } from './ui'
import lessons from './tutorial/lessons.json'
import evidence from './tutorial/evidence.mp3?inline'
import harness from './tutorial/harness.mp3?inline'
import dispatch from './tutorial/dispatch.mp3?inline'
import results from './tutorial/results.mp3?inline'
import buddy from './tutorial/buddy.mp3?inline'
import './getting-started.css'

const recordings = { evidence, harness, dispatch, results, buddy }
export default function GettingStarted({ onGuide }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return <>
    <button type="button" className="rg-tbtn rg-tour-launcher" aria-label="Voice tour" title="Replay the narrated tour" onClick={() => setOpen(true)}><svg className="rg-ico" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16v-4a8 8 0 0 1 16 0v4" /><path d="M4 15h3v6H4zM17 15h3v6h-3z" /></svg><span className="lbl-d">Voice tour</span></button>
    {open && <VoiceTour onClose={close} onGuide={topic => { close(); onGuide(topic) }} />}
  </>
}

function VoiceTour({ onClose, onGuide }) {
  const [chapter, setChapter] = useState(0), [playing, setPlaying] = useState(false), [audioError, setAudioError] = useState(false)
  const dialog = useRef(null), audio = useRef(null), title = useRef(null), playback = useRef(0), body = useRef(null), nav = useRef(null)
  const lesson = lessons[chapter]
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    title.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    // A new chapter starts at its top, and its chip stays in view when the chapters are a strip.
    if (body.current) body.current.scrollTop = 0
    const current = nav.current?.querySelector('[aria-current]')
    if (typeof current?.scrollIntoView === 'function') current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [chapter])
  useEffect(() => {
    const player = audio.current
    const hidden = () => { if (document.hidden) { playback.current++; player?.pause() } }
    document.addEventListener('visibilitychange', hidden)
    return () => { playback.current++; player?.pause(); document.removeEventListener('visibilitychange', hidden) }
  }, [chapter])
  const select = index => { playback.current++; audio.current?.pause(); setPlaying(false); setAudioError(false); setChapter(index) }
  const play = async () => {
    if (playing) { audio.current?.pause(); setPlaying(false); return }
    const version = ++playback.current, player = audio.current
    try { await player.play(); if (version === playback.current && player === audio.current) { setAudioError(false); setPlaying(true) } }
    catch { if (version === playback.current && player === audio.current) { setAudioError(true); setPlaying(false) } }
  }
  const keyDown = event => {
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const buttons = [...dialog.current.querySelectorAll('button:not([disabled]), a[href]')]
    const first = buttons[0], last = buttons.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  const last = chapter === lessons.length - 1
  return <dialog ref={dialog} className="rg-modal rg-tour" aria-labelledby="traceharness-tour-title" aria-modal="true" onKeyDown={keyDown} onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="rg-modal-h rg-tour-h">
      <div className="rg-tour-head"><span className="rg-guide-eyebrow">TRACEHARNESS / FIRST STEPS</span><h2 id="traceharness-tour-title" className="rg-modal-t" ref={title} tabIndex={-1}>Find your way around TraceHarness</h2><p>Five short chapters. Read, listen, or jump to the controls.</p></div>
      <button type="button" className="rg-btn ghost rg-tour-x" aria-label="Close voice tour" onClick={onClose}>×</button>
    </header>
    <div className="rg-modal-b rg-tour-b" ref={body}>
      <div className="rg-tour-layout">
        <ScrollX className="rg-tour-chapters"><nav aria-label="Tour chapters" ref={nav}>{lessons.map((item, index) => <button type="button" key={item.id} aria-current={index === chapter ? 'step' : undefined} onClick={() => select(index)}><span className="n">{String(index + 1).padStart(2, '0')}</span><span className="t">{item.title}</span></button>)}</nav></ScrollX>
        <section className="rg-tour-lesson"><span className="rg-guide-eyebrow">CHAPTER {chapter + 1} / {lessons.length}</span><h3>{lesson.title}</h3>
          <audio key={lesson.id} ref={audio} src={recordings[lesson.id]} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setAudioError(true)} aria-label={'Narration: ' + lesson.title} />
          <div className="rg-tour-player"><button type="button" className="rg-btn" onClick={play}>{playing ? 'Pause narration' : 'Play narration'}</button><span>Recorded voice · audio starts only when you press Play</span></div>
          {audioError && <p className="rg-tour-alert" role="status">Audio could not play. The complete transcript is available below.</p>}
          <section className="rg-tour-transcript" aria-label="Narration transcript"><p>{lesson.transcript}</p></section>
          <button type="button" className="rg-btn" onClick={() => onGuide(GUIDE_TOPICS.find(topic => topic.id === lesson.topic))}>Show me this workflow →</button>
        </section>
      </div>
    </div>
    <footer className="rg-modal-f rg-tour-f"><button type="button" className="rg-btn ghost" onClick={onClose}>Explore on my own</button><div className="rg-tour-steps"><button type="button" className="rg-btn" disabled={chapter === 0} onClick={() => select(chapter - 1)}>Back</button><button type="button" className="rg-btn pri" onClick={() => last ? onClose() : select(chapter + 1)}>{last ? 'Finish tour' : 'Next chapter'}</button></div></footer>
  </dialog>
}
