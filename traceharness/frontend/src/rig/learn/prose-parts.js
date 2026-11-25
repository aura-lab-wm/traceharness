/* Rig · learn/prose-parts.js — splits article prose into what the page draws differently. PURE.
   **bold** (an "In short" key claim), inline code (codeParts: ids, file names, pass^k) and a citation mark [n]
   placed right after the phrase a source backs (a source's `cited_at`). Joining every non-mark part's t gives the
   text back without the ** markers. */
import { codeParts } from './articles'

/** proseParts(text, [{ phrase, n }]) -> [{ t, code, bold? } | { cite: n }] */
export function proseParts(text, cites = []) {
  const s = String(text ?? '')
  // where each mark goes: the end of the first occurrence of its phrase (in the text without the ** markers)
  const plain = s.replace(/\*\*/g, '')
  const marks = cites.map((c) => ({ n: c.n, at: c.phrase ? plain.indexOf(c.phrase) : -1, len: c.phrase ? c.phrase.length : 0 }))
    .filter((m) => m.at >= 0).map((m) => ({ n: m.n, end: m.at + m.len })).sort((a, b) => a.end - b.end)
  // bold runs, as [start, end) in the plain text
  const runs = []
  let bold = false, pos = 0
  for (const piece of s.split('**')) {
    if (piece) runs.push({ t: piece, bold, start: pos })
    pos += piece.length
    bold = !bold
  }
  const out = []
  for (const r of runs) {
    let at = 0
    const cuts = marks.filter((m) => m.end > r.start && m.end <= r.start + r.t.length)
    for (const m of cuts) {
      push(out, r.t.slice(at, m.end - r.start), r.bold)
      out.push({ cite: m.n })
      at = m.end - r.start
    }
    push(out, r.t.slice(at), r.bold)
  }
  return out
}

function push(out, t, bold) {
  if (!t) return
  for (const p of codeParts(t)) out.push(bold ? { ...p, bold: true } : p)
}
