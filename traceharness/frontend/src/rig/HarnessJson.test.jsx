// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HarnessJson, RecordedHarnessJson } from './HarnessJson'
import { prepareHarnessJSON, recordedHarnessSnapshot } from './harness-json'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const doc = (value) => [{ id: 'harness', label: 'Configuration file', value, filename: 'harness.json' }]
const open = () => fireEvent.click(screen.getByRole('button', { name: 'View JSON' }))
const source = () => screen.getByRole('textbox', { name: 'Harness JSON source' })

it('shows and copies complete JSON, preserving long Unicode prompts, nested extensions and signed zero', async () => {
  const value = { system_prompt: 'Classroom λ🙂\n'.repeat(1000) + 'THE LAST LINE', tools: [], temperature: -0, future: { retries: 0, enabled: false, unset: null } }
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<HarnessJson source="Recorded ledger" documents={doc(value)} />)
  open()
  const parsed = JSON.parse(source().textContent)
  expect(parsed.system_prompt).toBe(value.system_prompt)
  expect(Object.is(parsed.temperature, -0)).toBe(true)
  expect(parsed.future).toEqual({ retries: 0, enabled: false, unset: null })
  expect(source().getAttribute('aria-readonly')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
  await screen.findByText('JSON copied.')
  expect(JSON.parse(writeText.mock.calls[0][0]).system_prompt).toBe(value.system_prompt)
})

it('downloads the complete displayed document instead of a summary or another selected snapshot', async () => {
  const created = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { created.push(blob); return 'blob:fixture' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const clicks = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks.push(this.download) })
  render(<HarnessJson documents={[...doc({ tools: ['read_file'] }), { id: 'runtime', label: 'Runtime settings', value: { version: 'pinned-version', custom: { x: 2 } }, filename: 'runtime.json' }]} />)
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Runtime settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }))
  expect(clicks).toEqual(['runtime.json'])
  expect(created[0].type).toBe('application/json;charset=utf-8')
  const downloaded=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(created[0])})
  expect(JSON.parse(downloaded)).toEqual({ version: 'pinned-version', custom: { x: 2 } })
  expect(JSON.parse(source().textContent)).toEqual({ version: 'pinned-version', custom: { x: 2 } })
})

it('redacts credential fields and credential-shaped prompt text without dropping other fields or mutating the snapshot', () => {
  const secret = 'sk-or-v1-' + 'x'.repeat(40)
  const value = { tools: ['read_file'], max_total_tokens: 42, configuration: { API_KEY: secret, password: 'private-password' }, system_prompt: `A literal ${secret} followed by normal instructions.` }
  const before = JSON.stringify(value)
  render(<HarnessJson documents={doc(value)} />); open()
  const text = source().textContent
  expect(text).not.toContain(secret)
  expect(text).not.toContain('private-password')
  expect(JSON.parse(text).configuration).toEqual({ API_KEY: '[REDACTED]', password: '[REDACTED]' })
  expect(JSON.parse(text).max_total_tokens).toBe(42)
  expect(screen.getByText(/Credential-shaped values were redacted/)).toBeTruthy()
  expect(JSON.stringify(value)).toBe(before)
})

it('does not turn empty or missing recordings into today’s presets, and disables exports while loading or failed', () => {
  const { rerender } = render(<HarnessJson documents={doc(null)} />)
  expect(screen.getByRole('button', { name: 'Copy JSON' }).disabled).toBe(true)
  expect(screen.getByText(/No harness JSON was recorded/)).toBeTruthy()
  rerender(<HarnessJson documents={doc({})} />); open()
  expect(JSON.parse(source().textContent)).toEqual({})
  rerender(<HarnessJson documents={doc({ max_steps: 20 })} loading />)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByRole('button', { name: 'Download JSON' }).disabled).toBe(true)
  rerender(<HarnessJson documents={doc({ max_steps: 20 })} error="failure" />)
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('rejects non-JSON numeric values and cycles instead of silently exporting a different configuration', () => {
  const cyclic = {}; cyclic.self = cyclic
  for (const value of [{ temperature: NaN }, { temperature: Infinity }, cyclic]) expect(() => prepareHarnessJSON(value)).toThrow(/JSON/)
})

it('renders untrusted prompt markup as text, not executable HTML', () => {
  const { container } = render(<HarnessJson documents={doc({ system_prompt: '</pre><img src=x onerror="alert(1)"><script>alert(1)</script>' })} />)
  open()
  expect(source().textContent).toContain('<script>')
  expect(container.querySelector('img,script')).toBeNull()
})

it('does not report a stale clipboard request as copying a newly selected document', async () => {
  let done
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise((resolve) => { done = resolve }) } })
  const { rerender } = render(<HarnessJson documents={doc({ id: 'old' })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }))
  rerender(<HarnessJson documents={doc({ id: 'new' })} />)
  await act(async () => done())
  expect(screen.queryByText('JSON copied.')).toBeNull()
})

it('keeps a selected run’s configuration independent of the preset and rejects another run’s recording', () => {
  const run = { id: 'run-one', raw: { provider: 'import:codex' } }
  const detail = { summary: { run_id: 'run-one' }, spans: [{ span: 'invoke_agent', status: 'start', harness: { observed_config: { native: true }, future: 9 } }] }
  expect(recordedHarnessSnapshot(run, detail)).toMatchObject({ config: { observed_config: { native: true }, future: 9 }, source: 'Importer reconstruction' })
  const { rerender } = render(<RecordedHarnessJson run={run} detail={detail} />);open()
  expect(JSON.parse(source().textContent).future).toBe(9)
  rerender(<RecordedHarnessJson run={{ id: 'different' }} detail={detail} />)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText('Recording identity mismatch')).toBeTruthy()
})

it.each(['nebius','imported','SWE-bench/experiments'])('labels %s source settings as a reconstruction rather than original recorded runtime settings', provider => {
 const snapshot=recordedHarnessSnapshot({id:'r',raw:{provider}},{spans:[{span:'invoke_agent',status:'start',harness:{max_steps:2}}]})
 expect(snapshot.source).toBe('Importer reconstruction')
})
it('tolerates malformed provider metadata and marks missing configuration provenance unknown', () => {
 expect(recordedHarnessSnapshot({id:'r',raw:{provider:42}},{spans:[{span:'invoke_agent',status:'start',harness:{}}]}).config).toEqual({})
 expect(recordedHarnessSnapshot({id:'r'},{spans:[]}).source).toBe('Source not recorded')
})
it('redacts generic token and key credential fields while retaining token-budget settings', () => {
 const file=JSON.parse(prepareHarnessJSON({token:'private-token',key:'private-key',max_tokens_per_call:123}).json)
 expect(file).toEqual({token:'[REDACTED]',key:'[REDACTED]',max_tokens_per_call:123})
})
