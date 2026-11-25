/* Rig · entityColor.js — one colour per model and one per harness, the same on every page and in every theme. PURE.

   A name's tone is a slot in a small palette of tokens (rig.css --rig-em-<n> for models, --rig-eh-<n> for harnesses,
   each an existing chart token, so every theme draws its own version). The slot is a hash of the name; only when two
   names of one dataset would share a slot does one of them take the next free one. The datasets are read biggest
   first and names in alphabetical order, so the same library gives the same tones whatever order it arrives in.
   A model is named without its provider (acme/alpha-1 and alpha-1 are one model); a harness by its whole name. */

export const MODEL_TONES = 8
export const HARNESS_TONES = 9
const SIZE = { model: MODEL_TONES, harness: HARNESS_TONES }

/** The name a tone is kept under: a model without its provider, lower case; a harness lower case. */
export function entityKey(kind, name) {
  const s = String(name ?? '').trim().toLowerCase()
  return kind === 'model' && s.includes('/') ? s.split('/').slice(1).join('/') : s
}

/** FNV-1a over the name, folded into 1..n. */
export function hashSlot(key, n) {
  let h = 0x811c9dc5
  const s = String(key ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % n) + 1
}

/** The first slot from `start` that `used` does not hold, wrapping round; `start` when every slot is taken. */
function freeSlot(start, used, n) {
  for (let k = 0; k < n; k++) {
    const s = ((start - 1 + k) % n) + 1
    if (!used.has(s)) return s
  }
  return start
}

function assign(rows, kind, field) {
  const n = SIZE[kind]
  const tones = new Map()
  const lists = rows.map((r) => [...new Set((Array.isArray(r && r[field]) ? r[field] : []).map((x) => entityKey(kind, x)).filter(Boolean))].sort())
  // the dataset with the most names first: it is the hardest to keep apart
  const order = lists.map((l, i) => [l, String((rows[i] && rows[i].name) || '')]).sort((a, b) => b[0].length - a[0].length || a[1].localeCompare(b[1]))
  for (const [names] of order) {
    const used = new Set(names.filter((k) => tones.has(k)).map((k) => tones.get(k)))
    for (const k of names) {
      if (tones.has(k)) continue
      const s = freeSlot(hashSlot(k, n), used, n)
      tones.set(k, s)
      used.add(s)
    }
  }
  return tones
}

/** { model: Map<key, slot>, harness: Map<key, slot> } for a dataset library (rows with models[] and harnesses[]). */
export function buildEntityTones(rows) {
  const list = Array.isArray(rows) ? rows : []
  return { model: assign(list, 'model', 'models'), harness: assign(list, 'harness', 'harnesses') }
}

/** The slot (1-based) of a model or harness: from the library's tones, else its own hash slot. */
export function toneOf(tones, kind, name) {
  const k = entityKey(kind, name)
  const hit = tones && tones[kind] && tones[kind].get(k)
  return hit || hashSlot(k, SIZE[kind] || MODEL_TONES)
}

/** The token a slot draws with. */
export const toneVar = (kind, slot) => `var(--rig-${kind === 'harness' ? 'eh' : 'em'}-${slot})`
