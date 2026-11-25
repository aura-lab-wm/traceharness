import { describe, it, expect } from 'vitest'
import { tildeHome } from './homePath'

describe('tildeHome: the home folder shown as ~, for display only', () => {
  it('shortens a macOS, Linux or Windows home', () => {
    expect(tildeHome('/Users/alice/lab/data/runs')).toBe('~/lab/data/runs')
    expect(tildeHome('/home/bob/lab')).toBe('~/lab')
    expect(tildeHome('C:\\Users\\carol\\lab')).toBe('~\\lab')
    expect(tildeHome('/Users/alice')).toBe('~')
  })
  it('leaves everything else as it is', () => {
    for (const p of ['/srv/lab', '/Users/Shared/lab', '/Users', '/usr/home/x', 'https://openrouter.ai/api/v1', '', 'lab/data']) expect(tildeHome(p)).toBe(p)
    expect(tildeHome(null)).toBe('')
    expect(tildeHome(undefined)).toBe('')
  })
})
