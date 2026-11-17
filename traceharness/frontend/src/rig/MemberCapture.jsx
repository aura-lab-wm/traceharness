/* ====================================================================================
   Rig · MemberCapture.jsx — Capture computers, inside the member console (SPEC §5 WP2).

   Rendered by the capture view in member mode only. It manages what the Worker's own page
   (/app/capture) manages, through the same hosted routes (member-capture-api.js): the computers
   connected to the account (revoke one) and the sessions they uploaded (open one, delete one).
   It never starts a capture, and nothing it reads is kept: every answer lives in this component's
   state and goes when the tab closes. Ledger and summary text are drawn as text, never as markup.
   A revoke or a delete is sent only after its confirmation step.
   ==================================================================================== */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { listTokens, revokeToken, listRuns, getRun, deleteRun } from '../member-capture-api'
import { LABELS } from '../shared/index.js'
import { PageHeader, Note, ConfirmAction, CopyCmd, TableScroll } from './ui'

const LEDGER_LINES = 200
const SUMMARY_KEYS = 40
export const CAPTURE_BOUNDARY = 'Sessions are uploaded only by a computer you connected. This page never starts a capture, and uploaded sessions are never part of an export.'

const when = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '—')
function size(n) {
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
const lineOf = (entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))

/** What to tell the member about a failed request: 401 → sign in again; an account change → the
 *  server's sentence with the Account link; anything else → the server's own error. */
function problemOf(error) {
  if (error && error.status === 401) return { text: 'Sign in again to manage capture.', href: '/login', link: 'Sign in' }
  const text = String((error && error.message) || 'The request failed. Try again.')
  if (error && error.status === 409 && /account changed/i.test(text)) return { text, href: '/app/account', link: LABELS.account }
  return { text }
}
function Problem({ error, el }) {
  if (!error) return null
  const p = problemOf(error)
  return (
    <div className="rg-ws-err" role="alert" data-el={el}>
      <p>{p.text}</p>
      {p.href && <p><a className="rg-btn" href={p.href}>{p.link}</a></p>}
    </div>
  )
}

/** One cursor-paged list (`key`: tokens | runs). Previous returns along the cursors already seen. */
function usePagedList(fetchPage, key) {
  const [state, setState] = useState({ rows: null, cursor: null, previous: [], next: null, loading: true, error: null })
  const latest = useRef(state)
  latest.current = state
  const pending = useRef(null)
  const load = useCallback((cursor, previous) => {
    if (pending.current) pending.current.abort()
    const controller = new AbortController()
    pending.current = controller
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchPage(cursor, { signal: controller.signal }).then(
      (data) => {
        if (pending.current !== controller) return
        setState({ rows: data[key], cursor, previous, next: data.has_more ? data.next_cursor : null, loading: false, error: null })
      },
      (error) => {
        if (pending.current !== controller || error.code === 'aborted') return
        setState((s) => ({ ...s, loading: false, error }))
      },
    )
  }, [fetchPage, key])
  useEffect(() => {
    load(null, [])
    return () => { if (pending.current) pending.current.abort() }
  }, [load])
  const reload = () => load(latest.current.cursor, latest.current.previous)
  const nextPage = () => { const s = latest.current; if (s.next && !s.loading) load(s.next, [...s.previous, s.cursor]) }
  const previousPage = () => { const s = latest.current; if (s.previous.length && !s.loading) load(s.previous[s.previous.length - 1], s.previous.slice(0, -1)) }
  return { ...state, reload, nextPage, previousPage }
}

function Pager({ list, noun }) {
  if (!list.previous.length && !list.next) return null
  return (
    <div className="rg-row rg-wrap" role="group" aria-label={`${noun} pages`}>
      <button type="button" className="rg-btn ghost" disabled={list.loading || !list.previous.length} onClick={list.previousPage}>Previous {noun}</button>
      <button type="button" className="rg-btn ghost" disabled={list.loading || !list.next} onClick={list.nextPage}>Next {noun}</button>
      <span className="rg-small rg-mute">Page {list.previous.length + 1}</span>
    </div>
  )
}

function Section({ title, el, children }) {
  return (
    <section className="rg-ws-sec" data-el={el} aria-label={title}>
      <div className="rg-ws-sech"><h2>{title}</h2></div>
      {children}
    </section>
  )
}

function Connect() {
  return (
    <Section title="Connect a computer" el="member-capture-connect">
      <ol className="rg-ws-bul">
        <li><b>Install the command-line tool</b><CopyCmd cmd="pipx install git+https://github.com/aura-lab-wm/traceharness.git" /></li>
        <li><b>Sign in from your terminal</b><CopyCmd cmd="traceharness login" />
          <p className="rg-small rg-dim"><code>traceharness login</code> prints a code and the address <a href="/app/device">/app/device</a>; open it yourself and approve the code, signed in as you. If you are sent to sign in, return to <a href="/app/device">/app/device</a> afterward and enter your code.</p></li>
        <li><b>Start capturing</b><CopyCmd cmd="traceharness capture --watch --sync --path /path/to/chosen/session-directory" />
          <p className="rg-small rg-dim">Replace the path with the session directory you choose to share, or use your existing capture allow-list. The command asks for confirmation at your terminal.</p></li>
      </ol>
      <p className="rg-small"><a className="rg-tlink" href="/app/capture">Open the plain capture page</a></p>
    </Section>
  )
}

function Computers() {
  const list = usePagedList(listTokens, 'tokens')
  const [failed, setFailed] = useState(null)
  const revoke = async (id) => {
    setFailed(null)
    try { await revokeToken(id); list.reload() } catch (e) { setFailed(e) }
  }
  const rows = list.rows || []
  return (
    <Section title="Connected computers" el="member-capture-computers">
      <Problem error={list.error || failed} el="member-capture-computers-error" />
      {list.rows === null ? (list.loading ? <p className="rg-small rg-mute">Reading your computers…</p> : null)
        : rows.length === 0 ? <p className="rg-small rg-dim">{list.previous.length ? 'No computers on this page. Use Previous to return to newer records.' : 'No computer is connected yet.'}</p>
          : <div className="rg-pnl"><TableScroll label="Connected computers" stickyCol={false}><table className="rg-tbl">
            <thead><tr><th>computer</th><th>connected</th><th>last used</th><th>status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((t) => {
              const name = t.label || '(no label)'
              return (
                <tr key={t.id}>
                  <td>{name}</td>
                  <td className="rg-mono rg-small rg-nw" title={t.created_at || undefined}>{when(t.created_at)}</td>
                  <td className="rg-mono rg-small rg-nw" title={t.last_used_at || undefined}>{t.last_used_at ? when(t.last_used_at) : 'never'}</td>
                  <td>{t.revoked_at ? <span className="rg-small rg-mute" title={t.revoked_at}>revoked</span> : <span className="rg-small">active</span>}</td>
                  <td>{!t.revoked_at && <ConfirmAction label="Revoke" confirmLabel="Revoke this computer" danger el="member-capture-revoke"
                    detail={`Revoke “${name}”? This stops future uploads from that computer. Sessions already uploaded stay.`} onConfirm={() => revoke(t.id)} />}</td>
                </tr>
              )
            })}</tbody>
          </table></TableScroll></div>}
      <Pager list={list} noun="computers" />
    </Section>
  )
}

function Detail({ detail, onClose }) {
  const { id, run, loading, error } = detail
  const facts = run ? [
    ['run', run.run_id], ['source', run.source], ['computer', run.machine || '—'],
    ['captured', when(run.captured_at)], ['uploaded', when(run.uploaded_at)], ['size', `${size(run.bytes)}${run.truncated ? ' (truncated)' : ''}`],
    ...Object.entries(run.summary || {}).filter(([, v]) => v !== null && typeof v !== 'object').slice(0, SUMMARY_KEYS).map(([k, v]) => [k, String(v)]),
  ] : []
  const ledger = run && Array.isArray(run.ledger) ? run.ledger : []
  return (
    <Section title={`Session ${id}`} el="member-capture-detail">
      <Problem error={error} el="member-capture-detail-error" />
      {loading && <p className="rg-small rg-mute">Reading the session…</p>}
      {run && <>
        <dl className="rg-kv">{facts.map(([k, v], i) => <Fragment key={`${k}-${i}`}><dt>{k}</dt><dd className="rg-mono rg-break">{v}</dd></Fragment>)}</dl>
        {ledger.length > 0 && <>
          <p className="rg-small rg-mute">{ledger.length > LEDGER_LINES ? `Showing the first ${LEDGER_LINES} of ${ledger.length} ledger lines.` : `${ledger.length} ledger ${ledger.length === 1 ? 'line' : 'lines'}.`}</p>
          <pre className="rg-pre" data-el="member-capture-ledger">{ledger.slice(0, LEDGER_LINES).map(lineOf).join('\n')}</pre>
        </>}
        {ledger.length === 0 && <p className="rg-small rg-dim">This session has no ledger lines.</p>}
      </>}
      <div className="rg-row rg-wrap"><button type="button" className="rg-btn ghost" onClick={onClose}>Close</button></div>
    </Section>
  )
}

function Sessions() {
  const list = usePagedList(listRuns, 'runs')
  const [failed, setFailed] = useState(null)
  const [detail, setDetail] = useState(null)
  const reading = useRef(null)
  useEffect(() => () => { if (reading.current) reading.current.abort() }, [])
  const open = (id) => {
    if (reading.current) reading.current.abort()
    const controller = new AbortController()
    reading.current = controller
    setDetail({ id, run: null, loading: true, error: null })
    getRun(id, { signal: controller.signal }).then(
      (data) => { if (reading.current === controller) setDetail({ id, run: data.run, loading: false, error: null }) },
      (error) => { if (reading.current === controller && error.code !== 'aborted') setDetail({ id, run: null, loading: false, error }) },
    )
  }
  const close = () => { if (reading.current) reading.current.abort(); reading.current = null; setDetail(null) }
  const remove = async (id) => {
    setFailed(null)
    try {
      await deleteRun(id)
      if (detail && detail.id === id) close()
      list.reload()
    } catch (e) { setFailed(e) }
  }
  const rows = list.rows || []
  return (
    <>
      <Section title="Uploaded sessions" el="member-capture-sessions">
        <Problem error={list.error || failed} el="member-capture-sessions-error" />
        {list.rows === null ? (list.loading ? <p className="rg-small rg-mute">Reading your uploaded sessions…</p> : null)
          : rows.length === 0 ? <p className="rg-small rg-dim">{list.previous.length ? 'No sessions on this page. Use Previous to return to newer records.' : 'Nothing uploaded yet.'}</p>
            : <div className="rg-pnl"><TableScroll label="Uploaded sessions" stickyCol={false}><table className="rg-tbl">
              <thead><tr><th>run id</th><th>source</th><th className="rg-num">size</th><th>computer</th><th>captured</th><th>uploaded</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.run_id} aria-current={detail && detail.id === r.run_id ? 'true' : undefined}>
                  <td className="rg-mono rg-small rg-break">{r.run_id}</td>
                  <td className="rg-mono rg-small">{r.source}</td>
                  <td className="rg-num rg-mono rg-small rg-nw">{size(r.bytes)}{r.truncated ? ' · truncated' : ''}</td>
                  <td className="rg-small">{r.machine || '—'}</td>
                  <td className="rg-mono rg-small rg-nw" title={r.captured_at || undefined}>{when(r.captured_at)}</td>
                  <td className="rg-mono rg-small rg-nw" title={r.uploaded_at || undefined}>{when(r.uploaded_at)}</td>
                  <td><div className="rg-row rg-wrap">
                    <button type="button" className="rg-btn" onClick={() => open(r.run_id)}>Open</button>
                    <ConfirmAction label="Delete" confirmLabel={`Delete ${r.run_id}`} danger el="member-capture-delete"
                      detail={`Delete uploaded session “${r.run_id}” from your account? The copy on your computer is not touched.`} onConfirm={() => remove(r.run_id)} />
                  </div></td>
                </tr>))}</tbody>
            </table></TableScroll></div>}
        <Pager list={list} noun="sessions" />
      </Section>
      {detail && <Detail detail={detail} onClose={close} />}
    </>
  )
}

/** The capture view in member mode. */
export function MemberCapture() {
  return (
    <div className="rg-dpad rg-ws rg-ws-doc" data-el="member-capture-view">
      <PageHeader eyebrow="Your account" title={LABELS.capture_member}
        lede="The computers connected to your account and the coding-agent sessions they uploaded. Recording starts on your computer, after you confirm there." />
      <Note el="member-capture-boundary"><div>{CAPTURE_BOUNDARY}</div></Note>
      <Connect />
      <Computers />
      <Sessions />
    </div>
  )
}
