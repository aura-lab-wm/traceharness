import { expect, it } from 'vitest'
import { createExperimentConnectionLease } from './experiment-connection-lease'

it('keeps an uncertain matrix start held when the paired view finishes an older history read', () => {
  const lease = createExperimentConnectionLease()
  lease.reserve('matrix-start')
  lease.current = true
  lease.current = false // unrelated view observed no active experiment before Start
  expect(lease.current).toBe(true)
  lease.release('matrix-start') // definite start refusal, reconciled explicitly
  expect(lease.current).toBe(false)
})
it('retains an acknowledged active experiment until that exact experiment is reconciled', () => {
  const lease = createExperimentConnectionLease()
  lease.reserve('first')
  lease.confirm({ id: 'first', status: 'running' })
  lease.current = false // late, pre-start history cannot release an active connection
  lease.confirm({ id: 'other', status: 'ready' })
  expect(lease.current).toBe(true)
  lease.confirm({ id: 'first', status: 'completed' })
  expect(lease.current).toBe(false)
})
it('keeps overlapping starts independent and retains unrelated active history', () => {
  const lease = createExperimentConnectionLease()
  lease.reserve('matrix'); lease.reserve('paired')
  lease.release('matrix'); lease.current = false
  expect(lease.current).toBe(true)
  lease.confirm({ id: 'paired', status: 'paused' })
  expect(lease.current).toBe(false)
  lease.current = true
  lease.confirm({ id: 'unrelated', status: 'cancelled' })
  expect(lease.current).toBe(true)
  lease.current = false
  expect(lease.current).toBe(false)
})
