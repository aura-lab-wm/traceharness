/* ====================================================================================
   Rig · PausePanel.jsx — runs that are waiting for a person (core/pause.py).

   A harness with `pause` set stops before a step's tool calls and waits on a decision. This file is
   the console's side of that: the list (GET /api/paused, polled) and one panel per waiting run
   with the pending call(s), the reason, and the five decisions the backend takes:

     Approve · Deny (note) · Edit args (one call) · Inject message · Abort

   The decision is POST /api/runs/<dir>/<run_id>/decision. When the server answers on a non-loopback
   host it also wants its per-process token (printed at startup) in X-Pause-Token; the panel asks for
   it once and keeps it in sessionStorage only.

   A pending command is shown as TEXT, never interpreted, and with terminal control and bidi
   characters stripped (cleanText) so what a reviewer reads is what will run.
   ==================================================================================== */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, IS_STATIC } from '../api'
import { ConfirmAction, Empty, Note, Tag } from './ui'
import './PausePanel.css'

const cx = (...a) => a.filter(Boolean).join(' ')
export const TOKEN_KEY = 'traceharness.pauseToken'
export const POLL_MS = 2000

// C0/C1 controls (ESC of an ANSI sequence included) and the bidi formatting set, but not LF or TAB.
// eslint-disable-next-line no-control-regex
const STRIP = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const LINE_BREAKS = /\r\n?|\u2028|\u2029/g
/** Text safe to show: terminal control characters and bidi overrides removed; CR, CRLF, U+2028 and U+2029 become a line break. */
export function cleanText(s) {
  return String(s == null ? '' : s).replace(LINE_BREAKS, '\n').replace(STRIP, '')
}

/** What a pending call's arguments look like on screen: one `key: value` block per argument. */
export function argLines(args) {
  return Object.entries(args && typeof args === 'object' ? args : {}).map(([k, v]) => [cleanText(k), cleanText(typeof v === 'string' ? v : JSON.stringify(v))])
}

/** The decision body for one of the five controls, or { error } when the input cannot be sent. */
export function decisionBody(kind, { note = '', call = 0, argsText = '', message = '', step } = {}) {
  const body = { decision: kind }
  if (step != null) body.step = step
  if (note.trim()) body.note = note.trim()
  if (kind === 'deny' && call != null && call !== 'all') body.call = Number(call)
  if (kind === 'edit') {
    let parsed
    try { parsed = JSON.parse(argsText) } catch (e) { return { error: `The arguments are not valid JSON: ${e.message}` } }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'The arguments must be a JSON object, like {"command": "ls"}.' }
    body.call = Number(call)
    body.args = parsed
  }
  if (kind === 'inject') {
    if (!message.trim()) return { error: 'Write the message to send to the agent.' }
    body.message = message
  }
  return { body }
}

const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || '' } catch { return '' } }
const saveToken = (t) => { try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY) } catch { /* private mode: the token stays in memory */ } }

/** The waiting runs, polled. { runs, config, error, reload, token, setToken }. Nothing is requested on a static export. */
export function usePausedRuns(enabled = true, poll = POLL_MS) {
  const off = !enabled || IS_STATIC
  const [state, set] = useState({ runs: [], config: null, error: null, loaded: false })
  const [token, setTokenState] = useState(readToken)
  const setToken = useCallback((t) => { saveToken(t); setTokenState(t) }, [])
  const cfg = useRef(null)                            // whether a token is wanted is a property of the process: asked once
  const load = useCallback(async () => {
    if (off) return
    try {
      const config = cfg.current || (cfg.current = await api('/pause/config'))
      const headers = config.token_required && token ? { [config.header || 'X-Pause-Token']: token } : {}
      if (config.token_required && !token) { set({ runs: [], config, error: null, loaded: true }); return }
      const runs = await api('/paused', { headers })
      set({ runs: Array.isArray(runs) ? runs : [], config, error: null, loaded: true })
    } catch (error) {
      set((s) => ({ ...s, error, loaded: true }))
    }
  }, [off, token])
  useEffect(() => {
    if (off) return undefined
    load()
    const t = setInterval(load, poll)
    return () => clearInterval(t)
  }, [off, load, poll])
  return { ...state, reload: load, token, setToken, off }
}

const secondsLeft = (deadline, now) => (typeof deadline === 'number' ? Math.max(0, Math.round(deadline - now / 1000)) : null)
const clock = (s) => (s == null ? '—' : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`)

/** One waiting run: why it stopped, the call(s) it is about to make, and the five decisions. */
export function PausePanel({ run, config, token, onDecided, now: nowProp }) {
  const calls = Array.isArray(run.pending) ? run.pending : []
  const [now, setNow] = useState(nowProp ?? Date.now())
  useEffect(() => { if (nowProp != null) return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [nowProp])
  const [mode, setMode] = useState(null)               // null | 'deny' | 'edit' | 'inject'
  const [call, setCall] = useState(0)             // the call an edit applies to
  const [denyCall, setDenyCall] = useState('all')   // the call a deny applies to
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [argsText, setArgsText] = useState(() => JSON.stringify(Object.fromEntries(argLines(calls[0] && calls[0].arguments)), null, 2))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(null)              // { kind, step }: what was sent for which pause
  const done = sent && sent.step === run.step ? sent.kind : null   // a later pause of the same run gets fresh buttons
  const left = secondsLeft(run.deadline_ts, now)
  const url = `/runs/${encodeURIComponent(run.dir)}/${encodeURIComponent(run.run_id)}/decision`

  const pickCall = (i) => { setCall(i); setArgsText(JSON.stringify(Object.fromEntries(argLines(calls[i] && calls[i].arguments)), null, 2)) }
  const send = async (kind) => {
    const { body, error } = decisionBody(kind, { note, call: kind === 'deny' ? denyCall : call, argsText, message, step: run.step })
    if (error) { setErr(error); return }
    setBusy(true); setErr(null)
    try {
      const headers = config && config.token_required && token ? { [config.header || 'X-Pause-Token']: token } : {}
      await api(url, { method: 'POST', body, headers })
      setSent({ kind, step: run.step })
      if (onDecided) onDecided(kind)
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <section className="rg-pause" data-el="pause-panel" data-run={run.run_id} aria-label={`Run ${run.run_id} is waiting for a decision`}>
      <header className="rg-pause-h">
        <span className="rg-pulse" aria-hidden="true" />
        <b className="rg-mono">WAITING FOR YOU</b>
        <span className="rg-hash rg-small rg-pause-id">{run.dir}/{run.run_id}</span>
        <span className="rg-grow" />
        <span className="rg-small rg-mute" role="timer">{left == null ? '' : `${clock(left)} left · then ${run.on_timeout || 'abort'}`}</span>
      </header>
      <p className="rg-small rg-pause-sub">{run.task_id} · {run.harness_id} · model call {run.step}{run.model ? ` · ${run.model}` : ''}</p>
      <ul className="rg-pause-why" aria-label="Why it stopped">{(run.reason || []).map((r, i) => <li key={i}><Tag nc>{cleanText(r)}</Tag></li>)}</ul>
      {calls.length === 0
        ? <p className="rg-small rg-mute">No tool call is pending: the harness stops at this step before the agent acts.</p>
        : <ol className="rg-pause-calls" aria-label="Pending tool calls">{calls.map((c, i) => (
          <li key={i} className={cx('rg-pause-call', i === call && mode === 'edit' && 'on')} data-el="pending-call">
            <div className="rg-row rg-wrap"><span className="rg-mono rg-small rg-mute">[{c.index ?? i}]</span><b className="rg-mono">{cleanText(c.name)}</b></div>
            <dl className="rg-pause-args">{argLines(c.arguments).map(([k, v]) => <div key={k}><dt>{k}</dt><dd><pre>{v}</pre></dd></div>)}</dl>
          </li>))}
        </ol>}

      {done ? <Note tone="acc" el="pause-done"><div><b>Sent: {done}.</b> The run records it as an intervention and carries on.</div></Note> : <>
        <div className="rg-pause-acts" role="group" aria-label="Decide">
          <button type="button" className="rg-btn pri" disabled={busy} onClick={() => send('approve')} data-el="pause-approve">Approve</button>
          <button type="button" className={cx('rg-btn', mode === 'deny' && 'on')} disabled={busy} aria-pressed={mode === 'deny'} onClick={() => setMode(mode === 'deny' ? null : 'deny')} data-el="pause-deny">Deny</button>
          <button type="button" className={cx('rg-btn', mode === 'edit' && 'on')} disabled={busy || !calls.length} aria-pressed={mode === 'edit'} onClick={() => setMode(mode === 'edit' ? null : 'edit')} data-el="pause-edit">Edit args</button>
          <button type="button" className={cx('rg-btn', mode === 'inject' && 'on')} disabled={busy} aria-pressed={mode === 'inject'} onClick={() => setMode(mode === 'inject' ? null : 'inject')} data-el="pause-inject">Inject message</button>
          <ConfirmAction label="Abort run" confirmLabel="Abort the run" danger el="pause-abort" detail="Ends the run now (exit human_abort)." onConfirm={() => send('abort')} />
        </div>
        {mode === 'deny' && <div className="rg-pause-form">
          <label className="rg-fld">Note for the agent and the record<textarea className="rg-inp" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not?" data-el="pause-note" /></label>
          {calls.length > 1 && <label className="rg-fld">Which call<select className="rg-selc" value={denyCall} onChange={(e) => setDenyCall(e.target.value === 'all' ? 'all' : Number(e.target.value))}><option value="all">all of them</option>{calls.map((c, i) => <option key={i} value={i}>[{i}] {cleanText(c.name)}</option>)}</select></label>}
          <button type="button" className="rg-btn pri" disabled={busy} onClick={() => send('deny')} data-el="pause-deny-send">Deny and tell the agent</button>
        </div>}
        {mode === 'edit' && <div className="rg-pause-form">
          {calls.length > 1 && <label className="rg-fld">Which call<select className="rg-selc" value={call} onChange={(e) => pickCall(Number(e.target.value))}>{calls.map((c, i) => <option key={i} value={i}>[{i}] {cleanText(c.name)}</option>)}</select></label>}
          <label className="rg-fld">New arguments (JSON)<textarea className="rg-inp rg-mono" rows={5} spellCheck={false} value={argsText} onChange={(e) => setArgsText(e.target.value)} data-el="pause-args" /></label>
          <p className="rg-tiny rg-mute">The edited call still goes through the same permission policy as the agent&apos;s own calls; it can be blocked.</p>
          <button type="button" className="rg-btn pri" disabled={busy} onClick={() => send('edit')} data-el="pause-edit-send">Run with these arguments</button>
        </div>}
        {mode === 'inject' && <div className="rg-pause-form">
          <label className="rg-fld">Message to the agent<textarea className="rg-inp" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Instead of that, look at…" data-el="pause-message" /></label>
          <p className="rg-tiny rg-mute">The pending call(s) run as asked; the message is added after their results, before the next model call.</p>
          <button type="button" className="rg-btn pri" disabled={busy} onClick={() => send('inject')} data-el="pause-inject-send">Approve and send the message</button>
        </div>}
        {err && <Note tone="red" el="pause-error"><div role="alert">{err}</div></Note>}
      </>}
    </section>
  )
}

/** Every waiting run, or nothing when none waits. `quiet` renders nothing at all when there is none (a banner use). */
export function PausedRuns({ quiet = false }) {
  const p = usePausedRuns()
  const [draft, setDraft] = useState('')
  if (p.off) return null
  const needToken = p.config && p.config.token_required && !p.token
  if (needToken) {
    return (
      <Note tone="amb" el="pause-token"><div>
        <b>This server answers on a non-loopback host, so decisions need its pause token.</b> It was printed when the server started.
        <form className="rg-row rg-wrap rg-pause-tok" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) p.setToken(draft.trim()) }}>
          <input className="rg-inp rg-mono" type="password" autoComplete="off" aria-label="Pause token" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="rg-btn pri">Use token</button>
        </form></div></Note>
    )
  }
  // a token the server refused (403) is said, with a way to type it again, never as "nothing is waiting"
  const refused = p.error && /\b40[13]\b|forbidden|unauthori[sz]ed|token/i.test(String(p.error.message || p.error))
  if (refused && p.token) {
    return (
      <Note tone="red" el="pause-token-refused"><div role="alert">
        <b>The server refused the pause token.</b> It answered: <span className="rg-mono">{String(p.error.message || p.error)}</span>. Runs that wait for you cannot be listed until the token matches the one it printed when it started.
        <div className="rg-row rg-wrap rg-pause-tok"><button type="button" className="rg-btn pri" onClick={() => { setDraft(''); p.setToken('') }}>Change token</button></div>
      </div></Note>
    )
  }
  if (!p.runs.length) {
    if (quiet) return null
    return <Empty title="No run is waiting for you." el="paused-empty">A harness with <span className="rg-mono">pause</span> set stops before a tool call and waits here, and for <span className="rg-mono">traceharness decide</span> in a terminal.</Empty>
  }
  // keyed by run AND pause step: when a run stops again later, its card starts fresh (no stale "Sent", no old draft)
  return <div className="rg-pause-list" data-el="paused-runs">{p.runs.map((r) => <PausePanel key={`${r.dir}/${r.run_id}/${r.step}`} run={r} config={p.config} token={p.token} onDecided={() => setTimeout(p.reload, 600)} />)}</div>
}

/** How many runs wait, for the status bar. Asks only while `enabled` (the shell passes "a job is running", so an idle
 *  console makes no request); 0 when nothing is requested (static, member, or no token yet). */
export function usePausedCount(enabled = true) {
  const p = usePausedRuns(enabled, 5000)
  return useMemo(() => p.runs.length, [p.runs])
}
