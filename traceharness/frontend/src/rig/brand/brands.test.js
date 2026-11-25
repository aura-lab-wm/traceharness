/* Which logo goes beside a name (brands.js), and the files brand.css draws them from. Names are invented in the
   shapes real names take (a provider prefix, a version, a size), so no dataset's names are pinned here. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BRANDS, brandOf, brandsOf, brandKey, sourceBrandOf } from './brands'

const DIR = fileURLToPath(new URL('./', import.meta.url))
const svgs = readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort()
const css = readFileSync(new URL('./brand.css', import.meta.url), 'utf8')

describe('brandOf: models', () => {
  const cases = [
    ['google/gemini-9.1-flash-test', 'gemini'], ['gemini-9-pro', 'gemini'],
    ['openai/gpt-9-mini', 'openai'], ['gpt-9o', 'openai'], ['chatgpt-9o-latest', 'openai'], ['openai/o9-mini', 'openai'],
    ['qwen/qwen9.9-7b', 'qwen'], ['Qwen/Qwen9-Coder-1B-Instruct', 'qwen'], ['dashscope/qwen9-plus', 'qwen'],
    ['anthropic/claude-sonnet-9-9', 'claude'], ['claude-haiku-9.5', 'claude'], ['claude-opus-9', 'claude'], ['sonnet-9.1', 'claude'],
    ['minimax/MiniMax-M9', 'minimax'], ['deepseek/deepseek-v9', 'deepseek'],
    ['meta-llama/Llama-9-8B-Instruct', 'meta'], ['swe-agent-llama-9b', 'meta'], ['codellama-9b', 'meta'],
    ['mistralai/devstral-small-9', 'mistral'], ['mixtral-9x7b', 'mistral'],
    ['moonshotai/kimi-k9', 'kimi'], ['x-ai/grok-9', 'grok'],
  ]
  for (const [name, want] of cases) it(`${name} → ${want}`, () => expect(brandOf('model', name)).toBe(want))

  it('mock models, "unknown" and empty names get no logo', () => {
    for (const n of ['mock', 'mock-b', 'mock-weak', 'acme/mock-gpt-9', 'unknown', 'Unknown', '', '  ', null, undefined]) expect(brandOf('model', n)).toBeNull()
  })
  it('a name no rule claims gets no logo, and a word only counts where it starts a word', () => {
    for (const n of ['acme/alpha-1', 'beta-2', 'ollama/zeta-9', 'swellama-9b', 'opus-mt-en-de', 'mockingbird-9', 'notgpt-9', 'agemini-9']) expect(brandOf('model', n)).toBeNull()
  })
  it('a harness name is not read as a model and a model name not as a harness', () => {
    expect(brandOf('model', 'claude-code@9.x')).toBe('claude')
    expect(brandOf('harness', 'claude-sonnet-9')).toBeNull()
    expect(brandOf('harness', 'gemini-9-flash')).toBeNull()
  })
})

describe('brandOf: harnesses, agents and importers', () => {
  const cases = [
    ['claude-code@9.x', 'claudecode'], ['claude-code-skills9', 'claudecode'], ['claude_code', 'claudecode'], ['Claude Code', 'claudecode'],
    ['Claude Code — TraceHarness copy', 'claudecode'], ['native-claude-code', 'claudecode'],
    ['codex', 'codex'], ['Codex CLI', 'codex'], ['native-codex', 'codex'],
    ['mini-swe-agent-graph9', 'minisweagent'], ['mini_swe_agent', 'minisweagent'], ['mini_swe_jsonl', 'minisweagent'],
    ['swe-agent', 'sweagent'], ['swe_agent', 'sweagent'], ['SWE-agent', 'sweagent'],
    ['openhands', 'openhands'], ['OpenHands', 'openhands'],
    ['cursor', 'cursor'], ['copilot_cli', 'copilot'], ['github-copilot', 'copilot'],
    ['agy', 'antigravity'], ['Antigravity', 'antigravity'], ['kimi_code', 'kimi'], ['Kimi', 'kimi'],
    ['qwen_code', 'qwen'], ['Qwen Code', 'qwen'], ['grok', 'grok'],
  ]
  for (const [name, want] of cases) it(`${name} → ${want}`, () => expect(brandOf('harness', name)).toBe(want))

  it('"agent" reads names the way "harness" does', () => {
    for (const [name] of cases) expect(brandOf('agent', name)).toBe(brandOf('harness', name))
  })
  it('harness settings, the lab\'s own engine and importers with no open mark get no logo', () => {
    for (const n of ['baseline', 'baseline+sentinel', 'no_test_tool', 'permissive', 'terse_prompt', 'tight_budget', 'short_context',
      'Custom TraceHarness harness', 'TraceHarness engine', 'aider', 'muse', 'zcode', 'inspect', 'trajectory', 'strategy-9', 'mock']) expect(brandOf('harness', n)).toBeNull()
  })
  it('a harness named after the format it was imported from is not an agent: no Hugging Face logo on it (its dataset\'s source line says Hugging Face)', () => {
    expect(brandOf('harness', 'huggingface-messages')).toBeNull()
    expect(brandOf('source', 'huggingface-messages')).toBe('huggingface')
  })
})

describe('brandOf: sources and public datasets', () => {
  it('SWE-bench and its own sets; not another team\'s benchmark that borrows the name', () => {
    for (const n of ['SWE-bench', 'SWE-bench Verified', 'swe-bench_lite', 'princeton-nlp/SWE-bench_Verified', 'the SWE-bench Verified tasks', 'SWE-bench/SWE-smith-trajectories']) expect(brandOf('source', n)).toBe('swebench')
    for (const n of ['Multi-SWE-bench', 'ByteDance-Seed/Multi-SWE-bench_trajs', 'SWE-bench Pro', 'swe-bench-java', 'SWE-rebench', 'SWE-bench+']) expect(brandOf('source', n)).toBeNull()
  })
  it('Hugging Face by its name or its address', () => {
    for (const n of ['Hugging Face', 'huggingface', 'https://huggingface.co/datasets/acme/runs-9', 'hf:acme/runs-9']) expect(brandOf('source', n)).toBe('huggingface')
    for (const n of ['acme/runs-9', 'https://example.org/hf', 'github']) expect(brandOf('source', n)).toBeNull()
  })
  it('a dataset id: the agent it names, else where it comes from, else none', () => {
    expect(brandOf('dataset', 'acme/SWE-agent-trajectories')).toBe('sweagent')
    expect(brandOf('dataset', 'acme/SWE-rebench-openhands-trajectories')).toBe('openhands')
    expect(brandOf('dataset', 'SWE-bench/SWE-smith-trajectories')).toBe('swebench')
    for (const n of ['ByteDance-Seed/Multi-SWE-bench_trajs', 'acme/SWE-chat', 'acme/traceharness-runs']) expect(brandOf('dataset', n)).toBeNull()
  })
  it('an unknown kind matches nothing', () => expect(brandOf('planet', 'gemini-9')).toBeNull())
})

describe('sourceBrandOf', () => {
  it('a dataset fetched from Hugging Face, by its recorded address; nothing else counts', () => {
    expect(sourceBrandOf({ url: 'https://huggingface.co/datasets/acme/runs-9', dataset: 'acme/runs-9' })).toBe('huggingface')
    for (const s of [{ doc: 'README.md › Included datasets' }, { dataset: 'acme/huggingface-runs' }, { url: 'https://example.org/x' }, {}, null, 'huggingface', undefined]) expect(sourceBrandOf(s)).toBeNull()
  })
})

describe('brandsOf, brandKey', () => {
  it('the distinct brands of a list, first seen first; names with none are skipped', () => {
    expect(brandsOf('model', ['google/gemini-9-flash', 'acme/alpha-1', 'openai/gpt-9', 'gemini-9-pro', 'mock', 'qwen/qwen9-1b'])).toEqual(['gemini', 'openai', 'qwen'])
    expect(brandsOf('model', null)).toEqual([])
  })
  it('lower case, "_" and spaces read as "-"', () => expect(brandKey(' Claude_Code  CLI ')).toBe('claude-code-cli'))
})

/* ------------------------------------------------------------------ the files */
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
const hex6 = (h) => (h.length === 4 ? '#' + h.slice(1).split('').map((x) => x + x).join('') : h)
const lum = (h) => { const n = parseInt(hex6(h).slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const index = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
const tok = (name) => index.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))[1]
const GRAPHITE = ['bg', 'panel'].map((g) => tok(`rig-${g}-d`))
/** The colour a colour mark is mostly drawn in (fills and gradient stops, the most used first). */
function mainColour(svg) {
  const named = { gold: '#ffd700', white: '#ffffff', black: '#000000' }
  const seen = {}
  for (const m of svg.matchAll(/(?:fill|stop-color)[=:]"?\s*(#[0-9a-fA-F]{3,6}\b|gold|white|black)/g)) { const c = (named[m[1]] || m[1]).toLowerCase(); seen[c] = (seen[c] || 0) + 1 }
  return Object.entries(seen).sort((a, b) => b[1] - a[1])[0][0]
}
/** The files brand.css names for a brand: { color, mono } (paths relative to this folder). */
function filesOf(id) {
  const rule = css.match(new RegExp(`\\[data-brand="${id}"\\]\\{([^}]*)\\}`))
  if (!rule) return null
  const pick = (v) => (rule[1].match(new RegExp(`--rg-logo-${v}:url\\(\\./([^)]+)\\)`)) || [])[1]
  return { color: pick('c'), mono: pick('m') }
}

describe('the logo files', () => {
  it('every brand has its files in brand.css, and the files exist: a colour or own drawing, and a one-colour version unless it is "art"', () => {
    for (const [id, b] of Object.entries(BRANDS)) {
      const f = filesOf(id)
      expect(f, id).not.toBeNull()
      if (b.ink !== 'mono') expect(svgs, id).toContain(f.color)
      if (b.ink !== 'art') expect(svgs, id).toContain(f.mono)
    }
  })
  it('only the files a brand uses were copied in', () => {
    const used = new Set(Object.keys(BRANDS).flatMap((id) => Object.values(filesOf(id)).filter(Boolean)))
    expect(svgs.filter((f) => !used.has(f))).toEqual([])
  })
  it('every file is a plain drawing: no script, no handler, no link out, no embedded page or picture', () => {
    for (const f of svgs) {
      const s = readFileSync(DIR + f, 'utf8')
      expect(s, f).toMatch(/^<svg\b[^>]*viewBox="/)
      expect(s, f).not.toMatch(/<script|<foreignObject|<image|\bon[a-z]+\s*=|(?:xlink:)?href="(?!#)/i)
    }
  })
  it('a one-colour file draws in currentColor, so it takes the text\'s ink', () => {
    for (const [id, b] of Object.entries(BRANDS)) if (b.ink !== 'art') expect(readFileSync(DIR + filesOf(id).mono, 'utf8'), id).toMatch(/fill="currentColor"/)
  })
  it('a mark drawn in its own colours on Graphite reaches 3:1 there; one that would not is drawn in the text\'s ink instead', () => {
    for (const [id, b] of Object.entries(BRANDS)) {
      if (b.ink !== 'color' && b.ink !== 'dark-mono') continue
      const c = mainColour(readFileSync(DIR + filesOf(id).color, 'utf8'))
      const worst = Math.min(...GRAPHITE.map((g) => ratio(c, g)))
      if (b.ink === 'color') expect(worst, `${id} ${c}`).toBeGreaterThanOrEqual(3)
      else expect(worst, `${id} ${c}: dark-mono only where its colour is under 3:1`).toBeLessThan(3)
    }
  })
  it('the theme rules: one-colour marks in the text\'s ink always, dark-mono ones on Graphite, all but "art" in both High contrast themes', () => {
    const mono = css.match(/([^{}]+)\{\s*background:currentColor;-webkit-mask:var\(--rg-logo-m\)[^}]*mask:var\(--rg-logo-m\)/)
    expect(mono).not.toBeNull()
    const sel = mono[1].split(',').map((x) => x.trim()).filter((x) => !x.startsWith('/*'))
    expect(sel).toEqual(expect.arrayContaining(['.rig .rg-logo[data-ink="mono"]', '.rig[data-rig-theme="dark"] .rg-logo[data-ink="dark-mono"]',
      '.rig[data-rig-theme="contrast"] .rg-logo:not([data-ink="art"])', '.rig[data-rig-theme="contrast-light"] .rg-logo:not([data-ink="art"])']))
    expect(sel).toHaveLength(4)
    // otherwise a mark is its own colour file
    expect(css).toMatch(/\.rig \.rg-logo\{[^}]*background:var\(--rg-logo-c\) center\/contain no-repeat\}/)
  })
  it('the third-party note names every file and its source and licence', () => {
    const note = readFileSync(new URL('./LICENSE-THIRD-PARTY', import.meta.url), 'utf8')
    for (const f of svgs) expect(note, f).toContain(f)
    expect(note).toMatch(/MIT License/)
    expect(note).toMatch(/lobehub\/lobe-icons/)
  })
})

describe('the room a logo takes', () => {
  it('a picker option whose name wraps leaves no word alone on its last line', () => {
    expect(css).toMatch(/\.rig \.rg-harness-picker-option-copy>strong:has\(\.rg-logo-n\)\{text-wrap:pretty\}/)
  })
  it('a matrix row head with a logo gives back its right padding, so the logo does not widen the grid', () => {
    const an = readFileSync(new URL('../views/analysis.css', import.meta.url), 'utf8')
    expect(an).toMatch(/\.rg-an-mx td\.rh:has\(\.rg-logo\)\{padding-right:var\(--rig-s2\)\}/)
  })
})

describe('the class names', () => {
  it('no other stylesheet styles the logo classes (the app\'s own .rg-brand mark is a different thing); asking :has(.rg-logo) is fine', () => {
    const SRC = fileURLToPath(new URL('../../', import.meta.url))
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(d + e.name + '/') : e.name.endsWith('.css') ? [d + e.name] : []))
    const clash = walk(SRC).filter((f) => !f.startsWith(DIR) && /\.rg-logo(?:s|-n|-src)?(?=[\s{,:[.>+~])/.test(readFileSync(f, 'utf8')))
    expect(clash).toEqual([])
    expect(css).not.toMatch(/\.rg-brand(?![\w-])/)
  })
})
