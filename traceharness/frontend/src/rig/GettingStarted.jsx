import { useEffect, useRef, useState } from 'react'
import { GUIDE_TOPICS } from './guidance'
import { ScrollX } from './ui'
import { termMeaning } from './learn/glossary'
import lessons from './tutorial/lessons.json'
import evidence from './tutorial/evidence.mp3?inline'
import harness from './tutorial/harness.mp3?inline'
import dispatch from './tutorial/dispatch.mp3?inline'
import results from './tutorial/results.mp3?inline'
import buddy from './tutorial/buddy.mp3?inline'
import './getting-started.css'

const recordings = { evidence, harness, dispatch, results, buddy }
/** The glossary words each chapter's narration uses, defined beside its transcript (stand-in, native agent…). */
const WORDS = { evidence: ['harness', 'family'], harness: ['harness', 'stand-in', 'native-agent'], dispatch: ['cell'], results: [], buddy: [] }
const wordsOf = (id) => (WORDS[id] || []).map(termMeaning).filter((e) => e && e.meaning)
/** The narrated tour, opened from Help › Voice tour (and the phone's More menu). */
export default function GettingStarted({ open, onClose, onGuide }) {
  if (!open) return null
  return <VoiceTour onClose={onClose} onGuide={topic => { onClose(); onGuide(topic) }} />
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
  // the chapter in view, chosen again, keeps playing
  const select = index => { if (index === chapter) return; playback.current++; audio.current?.pause(); setPlaying(false); setAudioError(false); setChapter(index) }
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
      <div className="rg-tour-head"><h2 id="traceharness-tour-title" className="rg-modal-t" ref={title} tabIndex={-1}>Find your way around TraceHarness</h2><p>Five short chapters. Read, listen, or jump to the controls.</p></div>
      <button type="button" className="rg-btn ghost rg-tour-x" aria-label="Close voice tour" onClick={onClose}>×</button>
    </header>
    <div className="rg-modal-b rg-tour-b" ref={body}>
      <div className="rg-tour-layout">
        <ScrollX className="rg-tour-chapters"><nav aria-label="Tour chapters" ref={nav}>{lessons.map((item, index) => <button type="button" key={item.id} aria-current={index === chapter ? 'step' : undefined} aria-disabled={index === chapter || undefined} data-here={index === chapter ? '' : undefined} data-hint={index === chapter ? `Chapter ${index + 1} · you are here` : undefined} onClick={() => select(index)}><span className="n">{String(index + 1).padStart(2, '0')}</span><span className="t">{item.title}</span></button>)}</nav></ScrollX>
        <section className="rg-tour-lesson"><span className="rg-guide-eyebrow">Chapter {chapter + 1} of {lessons.length}</span><h3>{lesson.title}</h3>
          <audio key={lesson.id} ref={audio} src={recordings[lesson.id]} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setAudioError(true)} aria-label={'Narration: ' + lesson.title} />
          <div className="rg-tour-player"><button type="button" className="rg-btn" onClick={play}>{playing ? 'Pause narration' : 'Play narration'}</button><span>Recorded voice · audio starts only when you press Play</span></div>
          {audioError && <p className="rg-tour-alert" role="status">Audio could not play. The complete transcript is available below.</p>}
          <section className="rg-tour-transcript" aria-label="Narration transcript"><p>{lesson.transcript}</p></section>
          {wordsOf(lesson.id).length > 0 && <section className="rg-tour-words" aria-label="Words used here"><dl>{wordsOf(lesson.id).map((e) => <div key={e.slug}><dt>{e.term}</dt><dd>{e.meaning}.</dd></div>)}</dl></section>}
          <button type="button" className="rg-btn" onClick={() => onGuide(GUIDE_TOPICS.find(topic => topic.id === lesson.topic))}>Show me this workflow →</button>
        </section>
      </div>
    </div>
    <footer className="rg-modal-f rg-tour-f"><button type="button" className="rg-btn ghost" onClick={onClose}>Explore on my own</button><div className="rg-tour-steps"><button type="button" className="rg-btn" disabled={chapter === 0} onClick={() => select(chapter - 1)}>Back</button><button type="button" className="rg-btn pri" onClick={() => last ? onClose() : select(chapter + 1)}>{last ? 'Finish tour' : 'Next chapter'}</button></div></footer>
  </dialog>
}
