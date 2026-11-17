import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { DATASETS, DRAFTS, LABELS, LIMITS, LOCAL_APP, PORT, RETIRED, SHARED, SHARED_SHA256 } from './index.js'
import { DISPLAY_CLASSES } from '../rig/displayClasses.js'
import { CARDS, QUESTIONS, RECOMMENDED_ANSWERS } from '../rig/views/shallow-data.js'

/* Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False). */
const canonical = (value) => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  }
  return JSON.stringify(value)
}

describe('the shared sources compiled into the console', () => {
  it('names one port, and the local console command uses it', () => {
    expect(PORT).toBe(8765)
    expect(LOCAL_APP.port).toBe(PORT)
    expect(LOCAL_APP.url).toBe(`http://127.0.0.1:${PORT}`)
    expect(LOCAL_APP.command).toBe(`python -m traceharness --host 127.0.0.1 --port ${PORT}`)
  })

  it('has the same ten display classes as rig/displayClasses.js', () => {
    expect(SHARED.display_classes).toEqual({ ...DISPLAY_CLASSES })
  })

  it('has the same fixed harnesses, questions and recommended answers as rig/views/shallow-data.js', () => {
    const keep = ({ id, name, cap_bytes, max_steps, tools, policy, prompt }) => ({ id, name, cap_bytes, max_steps, tools, policy, prompt })
    expect(SHARED.shallow.agents).toEqual(CARDS.map(keep))
    expect(SHARED.shallow.questions).toEqual(QUESTIONS)
    expect(SHARED.shallow.recommended).toEqual(RECOMMENDED_ANSWERS)
  })

  it('exports frozen values, and its hash is the hash of its content', () => {
    for (const value of [SHARED, LIMITS, LIMITS.run, LABELS, RETIRED, RETIRED[0], DATASETS, DRAFTS, LOCAL_APP]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
    expect(LIMITS.prompt_max_bytes).toBe(20000)
    expect(LABELS.plain_editor).toBe('Plain harness editor')
    expect(RETIRED.map((r) => r.phrase)).toContain('8742')
    const body = Object.fromEntries(Object.entries(SHARED).filter(([k]) => k !== 'content_sha256'))
    expect(SHARED_SHA256).toBe(createHash('sha256').update(canonical(body), 'utf8').digest('hex'))
  })

  // Node tooling may import json.js straight from this folder, outside any bundler, so every module
  // it pulls in must load there too.
  it('loads in plain Node, outside a bundler', () => {
    const file = fileURLToPath(new URL('../json.js', import.meta.url))
    const code = `const m = await import(${JSON.stringify(pathToFileURL(file).href)}); if (typeof m.encodeJSON !== 'function') process.exit(3)`
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })
    expect(out.status, out.stderr).toBe(0)
  })
})
