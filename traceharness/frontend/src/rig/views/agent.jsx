/* ====================================================================================
   Rig · views/agent.jsx — what agents did through `traceharness mcp`
   (docs/superpowers/specs/2026-11-18-mcp-connector-design.md, decision 8).

     dock  agent           side panel: the connector's last report and its calls, newest first
     AgentConnect          Settings section "Connect an agent": the commands that add the connector
                           to Claude Code and Codex, what each flag allows, and the last report

   Reads GET /api/agent/status and GET /api/agent/calls (backend/agent_api.py) in local mode, every few
   seconds. A record holds names and ids only (tool, level, dataset / run / job it touched, ok or the
   console's error sentence, milliseconds, cost reserved): every value is drawn as text. A static
   export has no agent calls, and says so.
   ==================================================================================== */
import { MODE } from '../../environment'
import { useApi } from '../data'
import { CopyCmd, Empty, Go, Note, Tag } from '../ui'
import './dock.css'
import './agent.css'

// amber marks the level that can cost money; red stays for calls that failed
const LEVEL_TONE = { read: 'dash', write: undefined, spend: 'amb' }
const TARGET_ORDER = ['dataset', 'run_id', 'job_id', 'experiment_id', 'harness', 'model', 'task', 'path_name']

/** A POSIX-shell-quoted argument (the lab path may hold spaces or quotes). */
const shq = (s) => (/^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)

const clock = (t) => (typeof t === 'number' ? new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '')
const ago = (t) => {
  if (typeof t !== 'number') return 'never'
  const s = Math.max(0, Math.round(Date.now() / 1000 - t))
  return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`
}
const money = (v) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '')

/** The commands that add the connector to an agent, for this lab. */
export function connectCommands(labRoot) {
  const lab = labRoot ? ` --lab ${shq(labRoot)}` : ''
  return {
    claude: `claude mcp add traceharness -- traceharness mcp${lab}`,
    codex: `[mcp_servers.traceharness]\ncommand = "traceharness"\nargs = [${['mcp', ...(labRoot ? ['--lab', labRoot] : [])].map((a) => JSON.stringify(a)).join(', ')}]`,
  }
}

const Level = ({ level }) => <Tag tone={LEVEL_TONE[level]} nc>{String(level)}</Tag>

/** The connector's last report: its domains, levels, budget and when it attached. */
function SessionFacts({ status }) {
  const s = status && status.session
  if (!s) return <p className="rg-small rg-mute" data-el="agent-session">No agent has connected to this console yet.</p>
  const levels = Array.isArray(s.levels) && s.levels.length ? s.levels : ['read']
  return (
    <dl className="rg-kv rg-agent-kv" data-el="agent-session">
      <dt>Domains</dt><dd>{Array.isArray(s.domains) && s.domains.length ? s.domains.join(', ') : 'all'}{typeof s.tools === 'number' ? ` · ${s.tools} tools` : ''}</dd>
      <dt>Levels</dt>
      <dd className="rg-agent-lv">
        {levels.map((l) => <Level key={l} level={l} />)}
        {levels.includes('spend') && typeof s.budget_usd === 'number' && <span className="rg-mute">budget {money(s.budget_usd)}</span>}
      </dd>
      <dt>Connected</dt><dd>{ago(s.at)}</dd>
    </dl>
  )
}

/** One call: the tool, a pill when it could change files or spend (read is the default and stays
 *  quiet), the amount it reserved, what it touched, and the console's reason when it failed. */
function CallRow({ c, sameAs }) {
  const targets = c.targets && typeof c.targets === 'object' ? c.targets : {}
  const shown = TARGET_ORDER.filter((k) => typeof targets[k] === 'string').map((k) => targets[k])
  return (
    <tr className={c.ok ? 'rg-agent-call' : 'rg-agent-call err'} data-el="agent-call">
      <td className="rg-agent-at">{clock(c.at)}</td>
      <td>
        <div className="rg-agent-what">
          <span className="rg-agent-line">
            <span className="rg-agent-tool">{String(c.tool || '')}</span>
            {c.level && c.level !== 'read' && <Level level={c.level} />}
            {typeof c.reserved_usd === 'number' && <span className="rg-agent-cost">{money(c.reserved_usd)}</span>}
          </span>
          {shown.length > 0 && <span className="rg-agent-targets">{shown.join(' · ')}</span>}
          {!c.ok && c.error && (sameAs != null
            // the same sentence as a newer failed call above: said once, this row points back to it
            ? <span className="rg-agent-again" data-el="agent-error-again" data-hint={String(c.error)}>{sameAs === 'above' ? 'Same error as above' : `Same error as at ${clock(sameAs)}`}<span className="sr-only">: {String(c.error)}</span></span>
            : <span className="rg-agent-error">{String(c.error)}</span>)}
        </div>
      </td>
      <td className="rg-num rg-agent-ms">{typeof c.ms === 'number' ? `${c.ms} ms` : ''}</td>
    </tr>
  )
}

function CallTable({ rows }) {
  // an error sentence is written out at its newest call; older calls that failed the same way point back to it
  const first = new Map()
  const sameAs = rows.map((c) => {
    if (c.ok || !c.error) return null
    const k = String(c.error)
    if (first.has(k)) return first.get(k)
    first.set(k, typeof c.at === 'number' ? c.at : 'above')
    return null
  })
  return (
    <div className="rg-tblwrap">
      <table className="rg-tbl rg-agent-tbl" aria-label="Agent calls, newest first">
        <thead><tr><th scope="col">Time</th><th scope="col">Tool</th><th scope="col" className="rg-num">Took</th></tr></thead>
        <tbody>{rows.map((c, i) => <CallRow key={`${c.at}-${i}`} c={c} sameAs={sameAs[i]} />)}</tbody>
      </table>
    </div>
  )
}

function AgentDock() {
  const status = useApi(MODE === 'local' ? '/agent/status' : null, { poll: 5000 })
  const calls = useApi(MODE === 'local' ? '/agent/calls?limit=60' : null, { poll: 3000 })
  if (MODE !== 'local') {
    return (
      <div className="rg-agent" data-el="agent-dock">
        <p className="rg-small rg-dim">Agent calls are recorded by a running local console, when an agent works through <span className="rg-mono">traceharness mcp</span>. This snapshot has none.</p>
      </div>
    )
  }
  const st = status.data || null
  const active = !!(st && st.active)
  const rows = calls.data && Array.isArray(calls.data.calls) ? calls.data.calls : []
  const total = calls.data && typeof calls.data.total === 'number' ? calls.data.total : rows.length
  return (
    <div className="rg-agent" data-el="agent-dock">
      <div className="rg-agent-head">
        <span className={active ? 'rg-agent-dot on' : 'rg-agent-dot'} aria-hidden="true" />
        <b>{active ? 'An agent is working here' : 'No agent active'}</b>
        <span className="rg-grow" />
        <span className="rg-agent-count">{total} {total === 1 ? 'call' : 'calls'} recorded · last {ago(st && st.last_call_at)}</span>
      </div>
      <SessionFacts status={st} />
      {(status.error || calls.error) && !rows.length
        ? <Note tone="amb" el="agent-unreadable"><div>The console did not answer with its agent record. Reload this tab after updating the console.</div></Note>
        : !calls.data
          ? <p className="rg-small rg-mute" data-el="agent-loading">Reading the agent record…</p>
          : rows.length === 0
          ? <Empty title="No agent calls yet.">
              <p className="rg-small rg-dim">Add the connector to an agent; <Go spec="settings" className="rg-tlink">Settings, Connect an agent</Go> has the commands for this lab.</p>
              <CopyCmd cmd={connectCommands(null).claude} />
            </Empty>
          : <CallTable rows={rows} />}
    </div>
  )
}

const LEVELS = [
  ['read', <span key="f" className="rg-mute">none (default)</span>, "Read datasets, runs, trajectories, every analysis and the runner's catalog. Nothing changes, nothing is spent."],
  ['write', <span key="f" className="rg-mono">--allow-writes</span>, 'Also mock sweeps, imports, decisions on paused runs and cancellations. Free, but they change files in this lab.'],
  ['spend', <span key="f" className="rg-mono">--allow-spend --budget 2</span>, 'Also runs with real models through the key in Settings. Each paid call states its cap; the session stops at the budget.'],
]

/** Settings: how to connect an agent, what each level allows, and the last connector's report. */
export function AgentConnect() {
  const settings = useApi(MODE === 'local' ? '/settings' : null)
  const status = useApi(MODE === 'local' ? '/agent/status' : null, { poll: 10000 })
  const lab = settings.data && typeof settings.data.lab_root === 'string' ? settings.data.lab_root : null
  const cmd = connectCommands(lab)
  const st = status.data || null
  const meta = st && st.active ? <Tag tone="sky">agent active</Tag> : st && st.session ? <Tag tone="dash">idle</Tag> : <Tag tone="dash">not connected</Tag>
  return (
    <section className="rg-ws-sec" data-el="agent-connect" aria-label="Connect an agent">
      <div className="rg-ws-sech"><h2>Connect an agent</h2>{MODE === 'local' && <span className="rg-ws-meta">{meta}</span>}</div>
      <p className="rg-ws-lead">Claude Code, Codex or any MCP client can read the datasets, run the analyses and start runs in this console through <span className="rg-mono">traceharness mcp</span>. Every call shows in the Agent panel.</p>
      {MODE !== 'local'
        ? <p className="rg-small rg-dim">The connector works with a running local console, not with this snapshot.</p>
        : <>
            <div className="rg-agent-cmds">
              <CopyCmd label="Claude Code" cmd={cmd.claude} />
              <div className="rg-agent-codex"><span className="rg-copy-l">Codex, in <span className="rg-mono">~/.codex/config.toml</span></span><pre className="rg-pre">{cmd.codex}</pre></div>
            </div>
            <div className="rg-tblwrap">
              <table className="rg-tbl rg-agent-levels" aria-label="What each level allows">
                <thead><tr><th scope="col">Level</th><th scope="col">Flag</th><th scope="col">The agent may</th></tr></thead>
                <tbody>{LEVELS.map(([l, flag, what]) => <tr key={l}><td><Level level={l} /></td><td className="rg-agent-flag">{flag}</td><td>{what}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="rg-small rg-mute">The key is never sent to the agent. Install the connector once with <span className="rg-mono rg-agent-cmd">python3 -m pip install -e &apos;.[mcp]&apos;</span>.</p>
            <h3 className="rg-ws-h3">Last connector</h3>
            <SessionFacts status={st} />
          </>}
    </section>
  )
}

export const docks = {
  agent: { label: 'Agent', icon: 'agent', order: 35, side: true, render: AgentDock },
}
