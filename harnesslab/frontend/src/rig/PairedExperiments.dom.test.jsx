// @vitest-environment jsdom
// Explicit UI fixtures; provider-backed execution is verified separately.
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PairedExperiments } from './PairedExperiments'
import { baselineProfile } from '../native-prompts-contract'
import { nativeInventoryFixture } from '../../test/native-prompts-fixture'
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
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })
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
  expect(screen.getByText('Unconfirmed')).toBeTruthy()
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
