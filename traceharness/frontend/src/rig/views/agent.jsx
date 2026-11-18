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
import { CopyCmd, Empty, Note, Tag } from '../ui'
import './dock.css'
import './agent.css'

const LEVEL_TONE = { read: undefined, write: 'amb', spend: 'red' }
const TARGET_ORDER = ['dataset', 'run_id', 'job_id', 'experiment_id', 'harness', 'model', 'task', 'path_name']

/** A POSIX-shell-quoted argument (the lab path may hold spaces or quotes). */
const shq = (s) => (/^[A-Za-z0-9_./:@%+=-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`)

const clock = (t) => (typeof t === 'number' ? new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
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

function SessionLine({ status }) {
  const s = status && status.session
  if (!s) return <p className="rg-small rg-mute" data-el="agent-session">No agent has connected to this console yet.</p>
  const levels = Array.isArray(s.levels) ? s.levels : []
  return (
    <p className="rg-small rg-dim" data-el="agent-session">
      Last connector: {Array.isArray(s.domains) ? s.domains.join(', ') : ''} · {levels.join(', ') || 'read'}
      {levels.includes('spend') && typeof s.budget_usd === 'number' ? ` · budget ${money(s.budget_usd)}` : ''}
      {typeof s.tools === 'number' ? ` · ${s.tools} tools` : ''} · {ago(s.at)}
    </p>
  )
}

function CallRow({ c }) {
  const targets = c.targets && typeof c.targets === 'object' ? c.targets : {}
  const shown = TARGET_ORDER.filter((k) => typeof targets[k] === 'string').map((k) => targets[k])
  return (
    <li className={c.ok ? 'rg-agent-call' : 'rg-agent-call err'} data-el="agent-call">
      <span className="rg-mono rg-small rg-mute">{clock(c.at)}</span>
      <span className="rg-agent-tool rg-mono">{String(c.tool || '')}</span>
      {c.level && c.level !== 'read' && <Tag tone={LEVEL_TONE[c.level]} nc>{String(c.level)}</Tag>}
      {shown.length > 0 && <span className="rg-small rg-dim rg-agent-targets">{shown.join(' · ')}</span>}
      <span className="rg-grow" />
      {typeof c.reserved_usd === 'number' && <span className="rg-small rg-mono">{money(c.reserved_usd)}</span>}
      <span className="rg-small rg-mute rg-mono">{typeof c.ms === 'number' ? `${c.ms} ms` : ''}</span>
      {!c.ok && c.error && <span className="rg-agent-error rg-small">{String(c.error)}</span>}
    </li>
  )
}

function AgentDock() {
  const status = useApi(MODE === 'local' ? '/agent/status' : null, { poll: 5000 })
  const calls = useApi(MODE === 'local' ? '/agent/calls?limit=60' : null, { poll: 3000 })
  if (MODE !== 'local') {
    return (
      <div className="rg-ws-dock" data-el="agent-dock">
        <p className="rg-small rg-dim">Agent calls are recorded by a running local console, when an agent works through <span className="rg-mono">traceharness mcp</span>. This snapshot has none.</p>
      </div>
    )
  }
  const st = status.data || null
  const rows = calls.data && Array.isArray(calls.data.calls) ? calls.data.calls : []
  const total = calls.data && typeof calls.data.total === 'number' ? calls.data.total : rows.length
  return (
    <div className="rg-ws-dock" data-el="agent-dock">
      <div className="rg-row rg-wrap rg-ws-dockh">
        <span className={st && st.active ? 'rg-ws-dot on' : 'rg-ws-dot'} />
        <b>{st && st.active ? 'An agent is working here' : 'No agent active'}</b>
        <span className="rg-small rg-mute">{total} {total === 1 ? 'call' : 'calls'} recorded · last {ago(st && st.last_call_at)}</span>
      </div>
      <SessionLine status={st} />
      {(status.error || calls.error) && !rows.length
        ? <Note tone="amb" el="agent-unreadable"><div>The console did not answer with its agent record. Reload this tab after updating the console.</div></Note>
        : !calls.data
          ? <p className="rg-small rg-mute" data-el="agent-loading">Reading the agent record…</p>
          : rows.length === 0
          ? <Empty title="No agent calls yet.">
              <p className="rg-small rg-dim">Add the connector to an agent; Settings, Connect an agent, has the commands.</p>
              <CopyCmd cmd={connectCommands(null).claude} />
            </Empty>
          : <ol className="rg-agent-calls" aria-label="Agent calls, newest first">{rows.map((c, i) => <CallRow key={`${c.at}-${i}`} c={c} />)}</ol>}
    </div>
  )
}

/** Settings: how to connect an agent, what each level allows, and the last connector's report. */
export function AgentConnect() {
  const settings = useApi(MODE === 'local' ? '/settings' : null)
  const status = useApi(MODE === 'local' ? '/agent/status' : null, { poll: 10000 })
  const lab = settings.data && typeof settings.data.lab_root === 'string' ? settings.data.lab_root : null
  const cmd = connectCommands(lab)
  return (
    <section className="rg-ws-sec" data-el="agent-connect" aria-label="Connect an agent">
      <div className="rg-ws-sech"><h2>Connect an agent</h2><span className="rg-ws-meta">MCP</span></div>
      <p className="rg-ws-lead">Claude Code, Codex or any MCP client can read the datasets, run the analyses and start runs in this console through <span className="rg-mono">traceharness mcp</span>. Every call shows in the Agent panel.</p>
      {MODE !== 'local'
        ? <p className="rg-small rg-dim">The connector works with a running local console, not with this snapshot.</p>
        : <>
            <CopyCmd label="Claude Code" cmd={cmd.claude} />
            <div className="rg-agent-codex"><span className="rg-small rg-dim">Codex (<span className="rg-mono">~/.codex/config.toml</span>)</span><pre className="rg-mono rg-small">{cmd.codex}</pre></div>
            <ul className="rg-small rg-dim rg-agent-levels">
              <li><b>Read</b> (the default): datasets, runs, trajectories, every analysis, the runner&apos;s catalog. Nothing changes, nothing is spent.</li>
              <li><b><span className="rg-mono">--allow-writes</span></b>: mock sweeps, imports, decisions on paused runs, cancellations. Free, but changes files in this lab.</li>
              <li><b><span className="rg-mono">--allow-spend --budget 2</span></b>: runs with real models through the key in Settings. Each paid call states its cap, and the session stops at the budget.</li>
            </ul>
            <p className="rg-small rg-mute">The key is never sent to the agent. Install the connector once with <span className="rg-mono rg-agent-cmd">python3 -m pip install -e &apos;.[mcp]&apos;</span>.</p>
            <SessionLine status={status.data} />
          </>}
    </section>
  )
}

export const docks = {
  agent: { label: 'Agent', icon: 'agent', order: 35, side: true, render: AgentDock },
}
