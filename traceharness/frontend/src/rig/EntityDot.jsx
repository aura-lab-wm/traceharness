/* Rig · EntityDot.jsx — the colour of a model (a filled dot) or a harness (a ring) beside its name, the same on every
   page (entityColor.js), then its logo when a rule names one (brand/brands.js: Qwen, Claude Code …). Decorative: the
   name beside them says what it is. `useEntityTones()` gives the library's tones for a chart that draws its series
   in them. */
import { Fragment } from 'react'
import { useOverview } from './data'
import { buildEntityTones, toneOf, toneVar } from './entityColor'
import { BrandMark } from './brand/BrandMark'
import './entity.css'

const byLibrary = new WeakMap()
/** The tones of the dataset library in the cache (computed once per overview), or null before it has loaded. */
export function tonesOf(ov) {
  if (!ov || typeof ov !== 'object') return null
  if (!byLibrary.has(ov)) byLibrary.set(ov, buildEntityTones(ov.results))
  return byLibrary.get(ov)
}
export function useEntityTones() { return tonesOf(useOverview().data) }

/** { slot, token, tone } of a name: the token to draw with and its short id (em-3, eh-7). */
export function entityTone(tones, kind, name) {
  const slot = toneOf(tones, kind, name)
  return { slot, token: toneVar(kind, slot), tone: `${kind === 'harness' ? 'eh' : 'em'}-${slot}` }
}

/** <EntityDot kind="model"|"harness" name/> — the dot or ring, and the logo after it (none for a name no rule claims). */
export function EntityDot({ kind, name }) {
  const tones = useEntityTones()
  if (name == null || name === '') return null
  const t = entityTone(tones, kind, name)
  return (
    <>
      <i className={`rg-ent ${kind === 'harness' ? 'h' : 'm'}`} style={{ '--rig-ent': t.token }} data-tone={t.tone} data-name={name} aria-hidden="true" />
      <BrandMark kind={kind} name={name} />
    </>
  )
}

/** <EntityName kind id? name/> — a name with its mark. The mark is held to the name's first part (up to its first
 *  hyphen, underscore, slash or plus), so it never ends a line alone, and the rest of the name still wraps where it can.
 *  `id` is what the tone is keyed by (a model with
 *  its provider), `name` what is shown. */
export function EntityName({ kind, id, name }) {
  const text = String(name ?? id ?? '')
  const [head, ...tail] = text.split(/(?<=[-_/+])(?=.)/)
  return (
    <>
      <span className="rg-ent-n"><EntityDot kind={kind} name={id ?? name} />{head}</span>
      {tail.map((t, i) => <Fragment key={i}><wbr />{t}</Fragment>)}
    </>
  )
}
