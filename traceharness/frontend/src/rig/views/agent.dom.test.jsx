// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../../test/rig-testing'
import { connectCommands } from './agent.jsx'

afterEach(resetRig)

const NOW = Date.now() / 1000
const status = {
  session: { session: 'mcp-1234567890abcdef', client: '', connector_version: '0.6.0', domains: ['data', 'analysis', 'runner'],
    levels: ['read', 'write', 'spend'], budget_usd: 2, tools: 54, at: NOW - 30 },
  calls: 3, last_call_at: NOW - 5, active: true,
}
const calls = { total: 3, calls: [
  { session: 'mcp-1234567890abcdef', tool: 'runner_job_start', level: 'spend', ok: true, ms: 840, reserved_usd: 0.05,
    targets: { model: 'openai/gpt-5.1-codex-mini', task: 't01_slugify' }, at: NOW - 5 },
  { session: 'mcp-1234567890abcdef', tool: 'runs_list', level: 'read', ok: false, ms: 3,
    targets: { dataset: 'no_such' }, error: 'no results dir no_such (HTTP 404)', at: NOW - 20 },
  { session: 'mcp-1234567890abcdef', tool: 'datasets_list', level: 'read', ok: true, ms: 12, targets: {}, at: NOW - 25 },
] }
const primed = (extra = {}) => ({ ...rigFixture(), '/agent/status': status, '/agent/calls?limit=60': calls, ...extra })

describe('Agent panel', () => {
  it('lists the calls newest first with level, targets, cost and the console\'s error sentence', () => {
    renderRig('#/rig/?dock=agent', { data: primed() })
    const dock = document.querySelector('[data-el="agent-dock"]')
    expect(dock.textContent).toContain('An agent is working here')
    expect(dock.textContent).toContain('3 calls recorded')
    const rows = [...dock.querySelectorAll('[data-el="agent-call"]')]
    expect(rows.map((r) => r.querySelector('.rg-agent-tool').textContent)).toEqual(['runner_job_start', 'runs_list', 'datasets_list'])
    expect(rows[0].textContent).toContain('spend')
    expect(rows[0].textContent).toContain('openai/gpt-5.1-codex-mini · t01_slugify')
    expect(rows[0].textContent).toContain('$0.05')
    expect(rows[1].className).toContain('err')
    expect(rows[1].textContent).toContain('no results dir no_such (HTTP 404)')
    expect(document.querySelector('[data-el="agent-session"]').textContent).toContain('budget $2.00')
  })

  it('with no calls yet, says so and gives the command to connect', () => {
    renderRig('#/rig/?dock=agent', { data: primed({ '/agent/status': { session: null, calls: 0, last_call_at: null, active: false },
      '/agent/calls?limit=60': { total: 0, calls: [] } }) })
    expect(screen.getByText('No agent calls yet.')).toBeTruthy()
    expect(document.querySelector('[data-el="agent-dock"] [data-el="copy-command"]').textContent).toContain('claude mcp add traceharness -- traceharness mcp')
  })

  it('an older console without the record says what to do, not a crash', async () => {
    renderRig('#/rig/?dock=agent')
    expect(document.querySelector('[data-el="agent-loading"]')).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[data-el="agent-unreadable"]')).toBeTruthy())
    expect(document.querySelector('[data-el="view-crash"]')).toBeNull()
  })
})

describe('Connect an agent (Settings)', () => {
  it('shows the commands for this lab and what each level allows', () => {
    renderRig('#/rig/settings', { data: primed({ '/settings': { lab_root: '/Users/me/my lab', key_present: true } }) })
    const sec = document.querySelector('[data-el="agent-connect"]')
    expect(sec).toBeTruthy()
    expect(sec.textContent).toContain("claude mcp add traceharness -- traceharness mcp --lab '/Users/me/my lab'")
    expect(sec.textContent).toContain('args = ["mcp", "--lab", "/Users/me/my lab"]')
    expect(sec.textContent).toContain('--allow-writes')
    expect(sec.textContent).toContain('--allow-spend --budget 2')
    expect(sec.textContent).toContain('The key is never sent to the agent.')
    expect(sec.textContent).not.toContain('sk-or-')
  })

  it('quotes a lab path for the shell and leaves a plain one as it is', () => {
    expect(connectCommands('/srv/lab').claude).toBe('claude mcp add traceharness -- traceharness mcp --lab /srv/lab')
    expect(connectCommands("/tmp/it's").claude).toBe("claude mcp add traceharness -- traceharness mcp --lab '/tmp/it'\\''s'")
    expect(connectCommands(null).claude).toBe('claude mcp add traceharness -- traceharness mcp')
  })
})
