import { describe, expect, it } from 'vitest'
import { isolationLabel } from './isolation'

describe('isolationLabel', () => {
  it('names gVisor and Docker, and says nothing for an older manifest', () => {
    expect(isolationLabel({ isolation_runtime: 'runsc' })).toBe('Isolation: gVisor')
    expect(isolationLabel({ isolation_runtime: 'runc' })).toBe('Isolation: Docker')
    for (const manifest of [null, undefined, {}, { isolation_runtime: 'kata-runtime' }, { isolation_runtime: 7 }]) expect(isolationLabel(manifest)).toBe('')
  })
})
