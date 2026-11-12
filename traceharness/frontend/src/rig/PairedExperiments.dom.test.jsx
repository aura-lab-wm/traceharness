// @vitest-environment jsdom
// Explicit UI fixtures; provider-backed execution is verified separately.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PairedExperiments } from './PairedExperiments'
import { baselineProfile } from '../native-prompts-contract'
import { experimentFixture, nativeInventoryFixture } from '../../test/native-prompts-fixture'
import { clearPairing, pendingPairing, requestPairing } from './native/ui/pairing-bus'
import { runnerRequest } from '../runner-api'
vi.mock('../runner-api', () => ({ runnerRequest: vi.fn() }))
const configuration = () => ({ version: 2, runtime_id: 'native-claude-code', model_id: 'fixture/model', task_id: 'fixture/task', prompt: '', prompt_mode: 'append', harness: {}, limits: { max_steps: 5, wall_time_seconds: 30, max_cost_usd: 1 }, native_prompt_profile: baselineProfile(nativeInventoryFixture()) })
const exp = () => ({ id: 'a'.repeat(48), status: 'ready', plan_sha256: 'b'.repeat(64), plan: { name: 'Fixture comparison', arms: [{ id: 'control', label: 'Reference' }, { id: 'variant', label: 'Variant' }] }, trial_count: 0, maximum_cost_usd: 2, issues: [], trials: [], summary: { finalized_trials: 0, pending_trials: 0, active_trials: 0, confirmed_cost_usd: 0, cost_unknown_trials: 0, comparisons: [] } })
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  runnerRequest.mockImplementation(async (path) => {
    if (path === '/experiments') return { experiments: [] }
    throw new Error('Unexpected fixture request')
  })
})
afterEach(() => { cleanup(); clearPairing(); localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals() })
async function open() { fireEvent.click(screen.getByText('Compare prompt variants')); await screen.findByLabelText('Variant name') }
async function captureTwo() {
  fireEvent.click(screen.getByRole('button', { name: 'Capture current variant' }))
  fireEvent.click(screen.getByRole('button', { name: 'Capture current variant' }))
}
function reviewed(plan) { return { ok: true, issues: [], plan: { arms: plan.arms, schedule: plan.arms.map((arm, i) => ({ id: 'fixture-' + i, repeat: 1, arm_id: arm.id })) }, plan_sha256: 'b'.repeat(64), maximum_cost_usd: 2, trial_count: 2 } }
it('reviews and freezes a captured plan without connecting credentials or launching jobs', async () => {
  runnerRequest.mockImplementation(async (path, options) => path === '/experiments/preflight' ? reviewed(options.body.plan) : path === '/experiments' && options?.method === 'POST' ? { experiment: exp() } : { experiments: [] })
  render(<PairedExperiments configuration={configuration()} available lease={{ current: false }} />)
  await open(); await captureTwo()
  fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }))
  await screen.findByText('2 planned trials · maximum $2')
  fireEvent.click(screen.getByRole('button', { name: 'Freeze experiment' }))
  await screen.findByLabelText('Experiment results')
  expect(screen.getByRole('button', { name: 'Start experiment' }).disabled).toBe(true)
  expect(runnerRequest.mock.calls.some(([path]) => path.includes('/credentials') || path.includes('/jobs') || path.endsWith('/start'))).toBe(false)
  const body = runnerRequest.mock.calls.find(([path, options]) => path === '/experiments' && options?.method === 'POST')[1].body
  expect(body.plan.arms).toHaveLength(2)
  expect(Object.keys(body).sort()).toEqual(['idempotency_key', 'plan', 'plan_sha256'])
})
it('refuses a key-shaped arm name before review (review m5)', async () => {
  render(<PairedExperiments configuration={configuration()} available lease={{ current: false }} />)
  await open(); await captureTwo()
  fireEvent.change(screen.getByLabelText('Name of arm 2'), { target: { value: 'sk-abcdefghijklmnop' } })
  expect(await screen.findByText('Remove provider credentials from the variant name.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Review experiment' }).disabled).toBe(true)
  expect(runnerRequest.mock.calls.some(([path]) => path === '/experiments/preflight')).toBe(false)
})
it('invalidates a reviewed plan after schedule changes', async () => {
  runnerRequest.mockImplementation(async (path, options) => path === '/experiments/preflight' ? reviewed(options.body.plan) : { experiments: [] })
  render(<PairedExperiments configuration={configuration()} available lease={{ current: false }} />)
  await open(); await captureTwo(); fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }))
  await screen.findByText('2 planned trials · maximum $2')
  fireEvent.change(screen.getByLabelText('Schedule seed'), { target: { value: '42' } })
  expect(screen.getByRole('button', { name: 'Freeze experiment' }).disabled).toBe(true)
  expect(screen.queryByLabelText('Experiment review')).toBeNull()
})
it('retains a connection lease after an uncertain start and never retries automatically', async () => {
  const lease = { current: false }, record = exp()
  runnerRequest.mockImplementation(async (path) => {
    if (path.endsWith('/start')) throw new Error('Outcome unconfirmed')
    return path === '/experiments' ? { experiments: [record] } : { experiment: record }
  })
  render(<PairedExperiments configuration={configuration()} available credential={{ credential_id: 'c'.repeat(48) }} lease={lease} />)
  await open(); fireEvent.click(await screen.findByRole('button', { name: /aaaaaaaa · ready/ }))
  await screen.findByLabelText('Experiment results')
  fireEvent.click(screen.getByRole('button', { name: 'Start experiment' }))
  await screen.findByText('Outcome unconfirmed')
  expect(lease.current).toBe(true)
  expect(runnerRequest.mock.calls.filter(([path]) => path.endsWith('/start'))).toHaveLength(1)
})
it('shows failed and ungraded outcomes with unknown costs without inventing a performance win', async () => {
  const record = exp(); record.status = 'completed'; record.trial_count = 2
  record.trials = [{ id: 'one', repeat: 1, arm_id: 'control', status: 'failed', issues: ['Budget reservation refused'], job: { grade: 'ungraded', usage: {}, issues: ['Model transport outcome is uncertain.'] } }, { id: 'two', repeat: 1, arm_id: 'variant', status: 'succeeded', issues: [], job: { grade: 'passed', usage: { cost_usd: .1 } } }]
  record.summary = { ...record.summary, finalized_trials: 2, cost_unknown_trials: 1, confirmed_cost_usd: .1, comparisons: [{ arm_id: 'variant', planned_pairs: 1, graded_pairs: 0, variant_only_pass: 0, control_only_pass: 0, incomplete_pairs: 1 }] }
  runnerRequest.mockImplementation(async (path) => path === '/experiments' ? { experiments: [record] } : { experiment: record })
  render(<PairedExperiments configuration={configuration()} available lease={{ current: false }} />)
  await open(); fireEvent.click(await screen.findByRole('button', { name: /aaaaaaaa · completed/ }))
  await screen.findByText('Budget reservation refused')
  expect(screen.getByText('Model transport outcome is uncertain.')).toBeTruthy()
  // Ported: unknown cost reads "cost not reported" in the trial matrix (was "Unconfirmed" in the flat table); never 0.
  const matrix = screen.getByRole('region', { name: 'Trials by repetition and arm' })
  expect(matrix.querySelector('[data-label="Reference"]').textContent).toContain('cost not reported')
  expect(matrix.querySelector('[data-label="Variant"]').textContent).toContain('$0.1')
  expect(screen.getByText(/1 trial with unconfirmed cost/)).toBeTruthy()
  expect(screen.getByText(/0\/1 graded pairs/)).toBeTruthy()
  expect(screen.getByText(/do not establish a general performance improvement/)).toBeTruthy()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start experiment' }).disabled).toBe(true))
})

it('clears a refused start lease only after confirmed history and preserves other active work', async () => {
  const lease = { current: false }, record = exp()
  runnerRequest.mockImplementation(async (path) => {
    if (path.endsWith('/start')) throw Object.assign(new Error('Start refused'), { status: 409 })
    return path === '/experiments' ? { experiments: [record] } : { experiment: record }
  })
  render(<PairedExperiments configuration={configuration()} available credential={{ credential_id: 'c'.repeat(48) }} lease={lease} />)
  await open(); fireEvent.click(await screen.findByRole('button', { name: /aaaaaaaa · ready/ }))
  await screen.findByLabelText('Experiment results')
  fireEvent.click(screen.getByRole('button', { name: 'Start experiment' }))
  await screen.findByText('Start refused')
  expect(lease.current).toBe(false)
  const other = { ...record, id: 'd'.repeat(48), status: 'running' }
  runnerRequest.mockImplementation(async (path) => {
    if (path.endsWith('/start')) throw Object.assign(new Error('Other work active'), { status: 429 })
    return { experiments: [record, other] }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Start experiment' }))
  await screen.findByText('Other work active')
  expect(lease.current).toBe(true)
})

it('clears the connection lease after confirmed terminal cancellation', async () => {
  const lease = { current: true }, record = { ...exp(), status: 'running' }
  runnerRequest.mockImplementation(async (path) => path.endsWith('/cancel') ? { experiment: { ...record, status: 'cancelled' } } : path === '/experiments' ? { experiments: [record] } : { experiment: record })
  render(<PairedExperiments configuration={configuration()} available lease={lease} />)
  await open(); fireEvent.click(await screen.findByRole('button', { name: /aaaaaaaa · running/ }))
  await screen.findByLabelText('Experiment results')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel experiment' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel experiment' }).disabled).toBe(true))
  expect(lease.current).toBe(false)
})

const edited = () => {
  const value = configuration(), inventory = nativeInventoryFixture()
  value.native_prompt_profile = { ...value.native_prompt_profile, overrides: [{ block_id: 'first', baseline_sha256: inventory.blocks[0].baseline_sha256, action: 'disable' }] }
  return value
}

it('pairs the current profile against its baseline in one click, as the reference, without duplicating arms', async () => {
  runnerRequest.mockImplementation(async (path, options) => path === '/experiments/preflight' ? reviewed(options.body.plan) : { experiments: [] })
  render(<PairedExperiments configuration={edited()} available lease={{ current: false }} />)
  await open()
  const pair = screen.getByRole('button', { name: 'Pair current profile against baseline' })
  fireEvent.click(pair); fireEvent.click(pair)
  const arms = screen.getByRole('list', { name: 'Captured variants' }).querySelectorAll(':scope > li')
  expect(arms).toHaveLength(2)
  expect(screen.getByRole('textbox', { name: 'Name of arm 1' }).value).toBe('Baseline (no edits)')
  expect(arms[0].textContent).toContain('reference · baseline')
  expect(arms[1].textContent).toContain('variant · edited')
  expect(screen.getByRole('textbox', { name: 'Name of arm 2' }).value).toMatch(/^Profile [a-f0-9]{12}$/)
  fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }))
  await screen.findByText('2 planned trials · maximum $2')
  const plan = runnerRequest.mock.calls.find(([path]) => path === '/experiments/preflight')[1].body.plan
  expect(plan.arms.map((arm) => arm.id)).toEqual(['arm-baseline', 'arm-profile'])
  expect(plan.arms[0].configuration.native_prompt_profile).toEqual(baselineProfile(nativeInventoryFixture()))
  const { native_prompt_profile: a, ...fixedA } = plan.arms[0].configuration, { native_prompt_profile: b, ...fixedB } = plan.arms[1].configuration
  expect(fixedA).toEqual(fixedB)
  expect(Object.fromEntries(Object.entries(a).filter(([key]) => !['default_action', 'overrides'].includes(key)))).toEqual(Object.fromEntries(Object.entries(b).filter(([key]) => !['default_action', 'overrides'].includes(key))))
})

it('labels an unedited pairing as an A/A control and offers the all-disabled arm', async () => {
  render(<PairedExperiments configuration={configuration()} available lease={{ current: false }} />)
  await open()
  fireEvent.click(screen.getByLabelText('Add an arm with all patchable prompts disabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Pair current profile against baseline' }))
  expect(screen.getByRole('textbox', { name: 'Name of arm 2' }).value).toBe('A/A control (no edits)')
  expect(screen.getByRole('textbox', { name: 'Name of arm 3' }).value).toBe('All patchable disabled')
  expect(screen.getAllByText(/A\/A control: it measures run-to-run variation/).length).toBeGreaterThan(0)
})

it('names why pairing is unavailable instead of failing silently', async () => {
  const { rerender } = render(<PairedExperiments configuration={{ ...configuration(), model_id: '' }} available lease={{ current: false }} />)
  await open()
  expect(screen.getByRole('button', { name: 'Pair current profile against baseline' }).disabled).toBe(true)
  expect(screen.getByText('Select a model before capturing variants.')).toBeTruthy()
  rerender(<PairedExperiments configuration={{ version: 1 }} available lease={{ current: false }} />)
  expect(screen.getByText('Enable a native prompt profile to capture variants.')).toBeTruthy()
})

it('takes a workbench pairing request once its own configuration carries that profile, opens and focuses the arms', async () => {
  const value = edited()
  const { rerender } = render(<PairedExperiments configuration={configuration()} available disabled lease={{ current: false }} />)
  requestPairing({ profile: value.native_prompt_profile, label: 'Lean tools' })
  expect(await screen.findByText(/A pairing request from the Native Prompts workbench is waiting/)).toBeTruthy()
  rerender(<PairedExperiments configuration={value} available disabled lease={{ current: false }} />)
  expect(pendingPairing()).not.toBeNull()
  rerender(<PairedExperiments configuration={value} available lease={{ current: false }} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name of arm 2' }).value).toBe('Lean tools'))
  expect(pendingPairing()).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Arms' }))
  expect(screen.getByText(/Arms prepared from the Native Prompts workbench/)).toBeTruthy()
})

it('makes any arm the reference and invalidates the review', async () => {
  runnerRequest.mockImplementation(async (path, options) => path === '/experiments/preflight' ? reviewed(options.body.plan) : { experiments: [] })
  render(<PairedExperiments configuration={edited()} available lease={{ current: false }} />)
  await open()
  fireEvent.click(screen.getByRole('button', { name: 'Pair current profile against baseline' }))
  fireEvent.click(screen.getByRole('button', { name: 'Review experiment' }))
  await screen.findByLabelText('Experiment review')
  const second = screen.getByRole('textbox', { name: 'Name of arm 2' }).value
  fireEvent.click(screen.getByRole('button', { name: 'Make ' + second + ' the reference' }))
  expect(screen.getByRole('textbox', { name: 'Name of arm 1' }).value).toBe(second)
  expect(screen.getByRole('list', { name: 'Captured variants' }).firstElementChild.textContent).toContain('reference · edited')
  expect(screen.queryByLabelText('Experiment review')).toBeNull()
})

it('shows saved experiments with the remembered name and date, and every outcome of an opened one', async () => {
  const record = experimentFixture({ repeats: 2, arms: 2, outcomes: ['pass', 'fail', 'ungraded', 'cancelled'] })
  runnerRequest.mockImplementation(async (path) => path === '/experiments' ? { experiments: [{ id: record.id, status: record.status, trial_count: record.trial_count, created_at: record.created_at }] } : { experiment: record })
  render(<PairedExperiments configuration={configuration()} available lease={{ current: false }} />)
  await open()
  const row = await screen.findByRole('button', { name: /name not loaded · [a-f0-9]{8} · / })
  expect(row.textContent).not.toContain('date not reported')
  fireEvent.click(row)
  await screen.findByLabelText('Experiment results')
  await screen.findByRole('button', { name: /^Fixture paired experiment · / })
  const outcomes = screen.getByRole('region', { name: 'Outcomes per arm' })
  expect(outcomes.querySelectorAll('tbody tr')).toHaveLength(2)
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Export Markdown' })).toBeTruthy()
})

it('exports CSV with one row per trial and Markdown with the caveats', async () => {
  const record = experimentFixture({ repeats: 2, arms: 2, outcomes: ['pass', 'fail', 'refused'] })
  runnerRequest.mockImplementation(async (path) => path === '/experiments' ? { experiments: [{ id: record.id, status: record.status, trial_count: record.trial_count }] } : { experiment: record })
  const blobs = []
  vi.stubGlobal('URL', { ...URL, createObjectURL: (blob) => { blobs.push(blob); return 'blob:fixture' }, revokeObjectURL: () => {} })
  render(<PairedExperiments configuration={configuration()} available lease={{ current: false }} />)
  await open()
  fireEvent.click(await screen.findByRole('button', { name: /[a-f0-9]{8} · / }))
  await screen.findByLabelText('Experiment results')
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
  fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }))
  const [csv, markdown] = await Promise.all(blobs.map((blob) => blob.text()))
  expect(csv.trimEnd().split('\r\n')).toHaveLength(1 + record.trial_count)
  expect(markdown).toContain('## Caveats')
  expect(markdown).toContain('does not show that an intervention improves task performance')
})
