// Local integrity/transport fixtures, never a deployed artifact or provider call.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { decodeRunnerArtifact, runnerRequest } from './runner-api'

const fixture = () => {
  const raw = Buffer.from('--- a/source.py\n+++ b/source.py\n+print("réel")\n')
  const expected = { name: 'patch.diff', bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') }
  return { raw, expected, data: { ...expected, encoding: 'base64', content: raw.toString('base64') } }
}

describe('downloaded runner artifact integrity', () => {
  it('verifies the advertised digest and exact byte count before releasing bytes', async () => {
    const { raw, expected, data } = fixture()
    expect(Buffer.from(await decodeRunnerArtifact(data, expected))).toEqual(raw)
  })

  it.each([
    (data) => { data.content = Buffer.from('tampered').toString('base64') },
    (data) => { data.bytes++ },
    (data) => { data.name = 'grade.json' },
    (data) => { data.name = '../secret.txt' },
    (data) => { data.sha256 = 'a'.repeat(64) },
    (data) => { data.encoding = 'html' },
    (data) => { data.content = '<script>alert(1)</script>' },
    (data) => { data.content += '\n' },
    (data) => { data.bytes = 1024 * 1024 + 1 },
  ])('refuses altered or malformed content without returning bytes', async (mutate) => {
    const { expected, data } = fixture(); mutate(data)
    await expect(decodeRunnerArtifact(data, expected)).rejects.toThrow('integrity could not be verified')
  })

  it('does not accept an unadvertised digest even when the downloaded bytes hash correctly', async () => {
    const { expected, data } = fixture()
    expected.sha256 = '0'.repeat(64)
    await expect(decodeRunnerArtifact(data, expected)).rejects.toThrow('integrity could not be verified')
  })

  it.each(['../secret', '%2e%2e%2fsecret', 'trace.html', 'patch.diff?source=other', 'patch.diff/extra'])('blocks unsupported artifact paths %s before fetching', async (name) => {
    await expect(runnerRequest('/jobs/' + 'a'.repeat(48) + '/artifacts/' + name)).rejects.toThrow('not supported')
  })
})
