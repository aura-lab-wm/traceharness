import { describe, expect, it } from 'vitest'
import { TOKEN_ESTIMATOR, codePoints, estimateTokens, lineCount, stripAsciiWhitespace, textMetrics, utf8Bytes } from './text-metrics'

describe('text metrics', () => {
  it('counts exact UTF-8 bytes, code points and lines', () => {
    expect(textMetrics('')).toEqual({ bytes: 0, code_points: 0, lines: 0, est_tokens: 0 })
    expect(textMetrics('abc')).toEqual({ bytes: 3, code_points: 3, lines: 1, est_tokens: 1 })
    expect(textMetrics('a\nb\n')).toMatchObject({ bytes: 4, lines: 3 })
    expect(utf8Bytes('λ')).toBe(2)
    expect(utf8Bytes('漢字')).toBe(6)
    expect([utf8Bytes('🙂'), codePoints('🙂')]).toEqual([4, 1])
    expect([utf8Bytes('é'), codePoints('é')]).toEqual([3, 2])
    expect([utf8Bytes('👩‍💻'), codePoints('👩‍💻')]).toEqual([11, 3])
    expect(utf8Bytes(new TextDecoder().decode(new Uint8Array([0xf0, 0x9f, 0x99, 0x82, 0x41])))).toBe(5)
    expect(lineCount('one')).toBe(1)
    expect(lineCount('\n')).toBe(2)
  })

  it('counts a lone surrogate as one code point and three bytes, like the Python mirror', () => {
    expect([utf8Bytes('\ud800'), codePoints('\ud800'), codePoints('\ud800a'), codePoints('\udc00\ud800')]).toEqual([3, 1, 2, 2])
  })

  it('estimates tokens with the pinned formula and never from untrimmed whitespace', () => {
    expect(TOKEN_ESTIMATOR).toBe('chars-div-3.9-v1')
    expect([0, 1, 4, 39, 40, 200, 2000].map((size) => estimateTokens('x'.repeat(size)))).toEqual([0, 1, 2, 10, 11, 52, 513])
    expect(estimateTokens(' \t\n\r\f\v')).toBe(0)
    expect(estimateTokens('  hello  \n')).toBe(estimateTokens('hello'))
    // Only ASCII whitespace is trimmed: a no-break space is content in both languages.
    expect(estimateTokens(' ')).toBe(1)
    expect(stripAsciiWhitespace('  x  ')).toBe('  x  ')
    expect(stripAsciiWhitespace(' \n x y \t')).toBe('x y')
    expect(estimateTokens('🙂'.repeat(39))).toBe(10)
  })
})
