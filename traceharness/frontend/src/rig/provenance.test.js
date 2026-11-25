import { describe, expect, it } from 'vitest'
import { SWE_SOURCE, oracleLabel, suiteLabel } from './provenance'

describe('oracle labels', () => {
  it('name the oracle, never a suite; imported SWE-agent runs keep their source labels', () => {
    const own = [{ provider: 'local' }], swe = [{ provider: SWE_SOURCE }]
    for (const o of ['visible', 'hidden', 'strengthened']) {
      expect(suiteLabel(own, o)).toBe(`${o} oracle`)
      expect(oracleLabel(own, o)).toBe(`${o} oracle`)
    }
    expect(oracleLabel(swe, 'hidden')).toBe('SWE-bench evaluation label')
  })
})
