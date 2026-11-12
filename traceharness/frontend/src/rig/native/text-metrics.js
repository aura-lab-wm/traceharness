// Exact sizes and one labelled estimate for native prompt text. Pure functions:
// no DOM, no network, no storage. The Python mirror is
// traceharness/runner_service/native_prompt_tools.py; both are held to
// test/native-golden/metrics.json.

/** Name of the token estimator. Show it wherever an estimate is shown. */
export const TOKEN_ESTIMATOR = 'chars-div-3.9-v1'

const encoder = new TextEncoder()

/** Exact UTF-8 size. A lone surrogate counts three bytes, as in the Python mirror. */
export function utf8Bytes(text) {
  let ascii = true
  for (let index = 0; index < text.length; index++) if (text.charCodeAt(index) > 127) { ascii = false; break }
  return ascii ? text.length : encoder.encode(text).length
}

/** Unicode code points. A surrogate pair is one, a lone surrogate is one. */
export function codePoints(text) {
  let count = 0
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) index++
    }
    count++
  }
  return count
}

/** '' has no line; otherwise the number of line feeds plus one. */
export function lineCount(text) {
  if (!text) return 0
  let count = 1
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) count++
  return count
}

const isAsciiSpace = (unit) => unit === 32 || unit >= 9 && unit <= 13

/** The text without ASCII whitespace (space, tab, LF, VT, FF, CR) at either end. */
export function stripAsciiWhitespace(text) {
  let start = 0, end = text.length
  while (start < end && isAsciiSpace(text.charCodeAt(start))) start++
  while (end > start && isAsciiSpace(text.charCodeAt(end - 1))) end--
  return start === 0 && end === text.length ? text : text.slice(start, end)
}

/**
 * An ESTIMATE, never a measurement: code points of the trimmed text divided by 3.9.
 * It is agent-patcher's formula with the whitespace set pinned to ASCII so that the
 * browser and the CLI agree. Billed tokens come only from a run's reported usage.
 */
export function estimateTokens(text) {
  const count = codePoints(stripAsciiWhitespace(text))
  return count === 0 ? 0 : Math.max(1, Math.floor((10 * count + 38) / 39))
}

/** bytes, code_points and lines are exact; est_tokens is the estimate above. */
export function textMetrics(text) {
  return { bytes: utf8Bytes(text), code_points: codePoints(text), lines: lineCount(text), est_tokens: estimateTokens(text) }
}
