// @vitest-environment jsdom
// Fabricated experiments only (test/native-prompts-fixture.js); no runner, provider or artifact is real.
import { createHash, webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ResultsMatrix, readableExperiment, unplacedTrials } from './ResultsMatrix'
import { EXPERIMENT_CAVEATS, experimentCsv, experimentOutcomes } from '../experiment-stats'
import { experimentFixture } from '../../../../test/native-prompts-fixture'
import { runnerRequest } from '../../../runner-api'

vi.mock('../../../runner-api', async (original) => ({ ...(await original()), runnerRequest: vi.fn() }))
beforeEach(() => { vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

const MIXED = ['pass', 'fail', 'ungraded', 'refused', 'cancelled', 'pass-no-cost', 'pending']
const table = (name) => screen.getByRole('region', { name }).querySelector('table')
const cellText = (row, label) => row.querySelector(`[data-label="${label}"]`).textContent

describe('ResultsMatrix', () => {
  it('shows every outcome of every arm, and the counts add up to the planned trials', () => {
    const experiment = experimentFixture({ repeats: 4, arms: 3, outcomes: MIXED })
    render(<ResultsMatrix experiment={experiment} />)
    const rows = [...table('Outcomes per arm').querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(3)
    const outcomes = experimentOutcomes(experiment)
    rows.forEach((row, index) => {
      const arm = outcomes.arms[index]
      const sum = ['Passed', 'Failed', 'Ungraded or grading error', 'Refused', 'Cancelled', 'Needs attention', 'Not finished'].reduce((total, label) => total + Number(cellText(row, label)), 0)
      expect(Number(cellText(row, 'Planned'))).toBe(4)
      expect(sum).toBe(4)
      expect(cellText(row, 'Pass rate')).toContain(`${arm.passed} of 4 planned`)
    })
    expect(rows[0].querySelector('th').textContent).toContain('reference · baseline')
    expect(rows[1].querySelector('th').textContent).toContain('variant · edited')
    // the matrix holds every scheduled trial, with words for every state
    const matrix = table('Trials by repetition and arm')
    expect(matrix.querySelectorAll('tbody tr')).toHaveLength(4)
    expect(matrix.querySelectorAll('tbody td')).toHaveLength(experiment.trials.length)
    for (const word of ['passed', 'failed', 'ungraded or grading error', 'refused', 'cancelled', 'not finished']) expect(within(matrix).getAllByText(word).length).toBeGreaterThan(0)
    expect(within(matrix).getAllByText('cost not reported').length).toBeGreaterThan(0)
    expect(within(matrix).getAllByText(/^ran \d+(st|nd|rd|th)$/)).toHaveLength(experiment.trials.filter((trial) => Number.isSafeInteger(trial.index)).length)
    expect(screen.getAllByText('Runner refused this scheduled trial before submission.').length).toBeGreaterThan(0)
  })

  it('prints all pair counts, the exact probability and the smallest reachable p, and every caveat', () => {
    const experiment = experimentFixture({ repeats: 3, arms: 2, outcomes: ['pass', 'fail'] })
    render(<ResultsMatrix experiment={experiment} />)
    const comparison = screen.getByRole('article', { name: 'Lean tools against the reference' })
    const row = experimentOutcomes(experiment).comparisons[0]
    expect(within(comparison).getByText(`${row.graded_pairs}/${row.planned_pairs} graded pairs · ${row.incomplete_pairs} incomplete`)).toBeTruthy()
    for (const label of ['Both pass', 'Both fail', 'Reference only passed', 'Variant only passed', 'Incomplete pairs', 'Discordant pairs', 'Exact two-sided McNemar probability']) expect(within(comparison).getByText(label)).toBeTruthy()
    if (row.discordant) expect(within(comparison).getByText(/smallest reachable p is/).textContent).toContain('fewer than six discordant pairs cannot go below 0.05')
    else expect(within(comparison).getByText('With no discordant pair these trials do not separate the arms.')).toBeTruthy()
    for (const caveat of EXPERIMENT_CAVEATS) expect(screen.getByText(caveat)).toBeTruthy()
    expect(screen.getByText(/do not establish a general performance improvement/)).toBeTruthy()
    // nothing ranks the arms
    expect(document.body.textContent).not.toMatch(/winner|better|significant|improved/i)
  })

  it('states the runner’s counts and a recount when they disagree', () => {
    const experiment = experimentFixture({ repeats: 2, arms: 2, outcomes: ['pass'] })
    experiment.summary.comparisons[0] = { ...experiment.summary.comparisons[0], both_pass: 0, variant_only_pass: 2 }
    render(<ResultsMatrix experiment={experiment} />)
    expect(screen.getByText(/Pair counts are the runner’s. A recount of the trials above differs/).textContent).toContain('2 both pass')
  })

  it('reports measured usage as reported of planned, never as zero', () => {
    const experiment = experimentFixture({ repeats: 2, arms: 2, outcomes: ['pass-no-cost', 'pass'] })
    render(<ResultsMatrix experiment={experiment} />)
    const usage = table('Measured usage per arm')
    const cost = [...usage.querySelectorAll('tbody tr')].find((row) => row.querySelector('th').textContent === 'Baseline (no edits) · Reported cost')
    const outcomes = experimentOutcomes(experiment)
    expect(cellText(cost, 'Reported')).toBe(`${outcomes.arms[0].usage.cost_usd.reported} of 2`)
    expect(screen.getByRole('region', { name: 'Paired usage differences' })).toBeTruthy()
  })

  it('reads a record without plan.repeats by its trials, and lists trials the plan cannot place', () => {
    const experiment = experimentFixture({ repeats: 2, arms: 2 })
    delete experiment.plan.repeats
    experiment.trials.push({ ...experiment.trials[0], id: 'f'.repeat(48), arm_id: 'arm-unknown' })
    const readable = readableExperiment(experiment)
    expect(readable.plan.repeats).toBe(2)
    expect(unplacedTrials(readable)).toHaveLength(1)
    render(<ResultsMatrix experiment={experiment} />)
    expect(screen.getByRole('alert').textContent).toContain('1 trial do not fit the frozen plan')
  })

  it('loads evidence only on request, through the digest check, and says what absence means', async () => {
    const experiment = experimentFixture({ repeats: 1, arms: 2, outcomes: ['pass'] })
    const trial = experiment.trials.find((row) => row.arm_id === 'arm-profile')
    const files = {
      'native-prompt-application.json': { readback_verified: true, changed_blocks: [{ block_id: 'first' }], changed_source_occurrences: 1 },
      'native-prompt-observations.json': { request_count: 3, requests_truncated: false, requests: [], dynamic_blocks_unverified: 1, short_literals_not_matched: 0 },
    }
    for (const artifact of trial.job.artifacts) {
      if (!files[artifact.name]) continue
      const raw = Buffer.from(JSON.stringify(files[artifact.name]))
      Object.assign(artifact, { bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') })
      files[artifact.name] = { name: artifact.name, bytes: raw.length, sha256: artifact.sha256, encoding: 'base64', content: raw.toString('base64') }
    }
    runnerRequest.mockImplementation(async (path) => files[path.split('/').pop()])
    render(<ResultsMatrix experiment={experiment} />)
    expect(runnerRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Load evidence for Lean tools, repetition 1' }))
    const panel = await screen.findByLabelText('Run evidence')
    expect(runnerRequest.mock.calls.map(([path]) => path).sort()).toEqual(['native-prompt-application.json', 'native-prompt-observations.json'].map((name) => '/jobs/' + trial.job_id + '/artifacts/' + name))
    expect(within(panel).getByText('Read-back verified').nextSibling.textContent).toBe('yes')
    expect(within(panel).getByText('Absence of a match does not prove a fragment was disabled.')).toBeTruthy()
  })

  it('shows the integrity failure and no data when an artifact digest does not match', async () => {
    const experiment = experimentFixture({ repeats: 1, arms: 2, outcomes: ['pass'] })
    runnerRequest.mockImplementation(async (path) => ({ name: path.split('/').pop(), bytes: 2, sha256: '0'.repeat(64), encoding: 'base64', content: 'e30=' }))
    render(<ResultsMatrix experiment={experiment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load evidence for Lean tools, repetition 1' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Artifact integrity could not be verified. No file was downloaded.'))
    expect(screen.queryByLabelText('Run evidence')).toBeNull()
  })

  it('says evidence is no longer retained when the runner no longer has it', async () => {
    const experiment = experimentFixture({ repeats: 1, arms: 2, outcomes: ['pass'] })
    runnerRequest.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }))
    render(<ResultsMatrix experiment={experiment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Load evidence for Baseline (no edits), repetition 1' }))
    expect(await screen.findByText('Evidence no longer retained.')).toBeTruthy()
  })

  it('exports exactly one CSV row per scheduled trial', () => {
    const experiment = experimentFixture({ repeats: 3, arms: 3, outcomes: MIXED })
    const lines = experimentCsv(experiment).trimEnd().split('\r\n')
    expect(lines).toHaveLength(1 + experiment.trial_count)
  })
})
