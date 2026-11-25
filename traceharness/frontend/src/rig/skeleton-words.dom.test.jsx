// @vitest-environment jsdom
/* Loading says what it waits for: every placeholder carries a line in words
   ("Loading findings… reading 16 runs"). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { renderRig, resetRig, rigFixture } from '../../test/rig-testing'
import { tok3Data, TOK } from '../../test/token-fixture'
import { Skeleton, waitWords } from './primitives'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

afterEach(() => { cleanup(); resetRig() })

/** Every skeleton bar on the page belongs to a waiting region that says, in words, what it waits for. */
function bareSkeletons(root = document) {
  const bare = []
  for (const s of root.querySelectorAll('.rg-skel')) {
    const holder = s.closest('[data-wait], .rg-skel-stack, .rg-loading') || s
    const words = (holder.querySelector('.rg-skel-cap, .rg-loading-l') || {}).textContent || ''
    if (!words.trim()) bare.push(s.className)
  }
  return bare
}
const hang = () => vi.fn(() => new Promise(() => {}))

describe('waitWords', () => {
  it('names what loads and, when known, how much it reads', () => {
    expect(waitWords('Loading findings', 'reading 1,500 runs')).toBe('Loading findings… reading 1,500 runs')
    expect(waitWords('Loading findings')).toBe('Loading findings…')
    expect(waitWords('Reading /api/overview…')).toBe('Reading /api/overview…')
  })
})

describe('Skeleton', () => {
  it('lines carry their words under one busy status', () => {
    render(<Skeleton lines={4} label="Loading runs" detail="reading 16 runs" />)
    const st = screen.getByRole('status', { name: 'Loading runs' })
    expect(st.querySelector('.rg-skel-cap').textContent).toBe('Loading runs… reading 16 runs')
    expect(st.querySelectorAll('.rg-skel.rg-skel-line')).toHaveLength(4)
  })
  it('a block carries its words inside it', () => {
    const { container } = render(<Skeleton height={96} label="Running the query" />)
    expect(container.firstChild.className).toBe('rg-skel')
    expect(container.firstChild.textContent).toBe('Running the query…')
    expect(bareSkeletons(container)).toEqual([])
  })
})

describe('the slow waits say what they wait for', () => {
  it('the Overview findings: their rows keep their places under "Loading findings… reading N runs"', async () => {
    const data = rigFixture()
    delete data['/results/mini/metrics']
    renderRig('#/rig/ds:mini:alpha-1:baseline', { data, fetchImpl: hang() })
    await act(async () => {})
    const f = document.querySelector('[data-el="findings"]')
    expect(f.querySelectorAll('.rg-ds-find-wait')).toHaveLength(3)
    expect(f.querySelector('.rg-skel-cap').textContent).toBe('Loading findings… reading 16 runs')
    expect(bareSkeletons()).toEqual([])
  })
  it('the task page token comparison names the runs it reads', async () => {
    const data = tok3Data()
    for (const k of Object.keys(data)) if (/\/tokens\/task/.test(k) || /tokens\?.*task=/.test(k)) delete data[k]
    renderRig(`#/rig/task:${TOK}:acme%2Fcoder-9b:agentic:proj__proj-101`, { data, fetchImpl: hang() })
    await act(async () => {})
    const cap = [...document.querySelectorAll('.rg-skel-cap')].map((x) => x.textContent)
    expect(cap).toContain('Loading the token comparison… reading 3 runs')
    expect(bareSkeletons()).toEqual([])
  })
  it('no page of the fixtures draws a skeleton without words while everything loads', async () => {
    for (const hash of ['#/rig/home', '#/rig/ds:mini:alpha-1:baseline', '#/rig/an:mini:outcomes', `#/rig/an:${TOK}:tokens`, '#/rig/q:mini', '#/rig/settings']) {
      resetRig()
      renderRig(hash, { data: {}, fetchImpl: hang() })
      await act(async () => {})
      expect(bareSkeletons(), hash).toEqual([])
    }
  })
})

describe('a new skeleton cannot come without words', () => {
  // a bar drawn by hand (className rg-skel) belongs in a data-wait region that also holds its words;
  // Skeleton (primitives.jsx) and Loading (ui.jsx) carry theirs
  const RIG = fileURLToPath(import.meta.url).replace(/[^/]+$/, '')
  const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : /\.jsx?$/.test(f) && !/\.test\./.test(f) ? [join(d, f)] : []))
  it('every file that draws a skeleton bar by hand marks its waiting region and writes its words', () => {
    const bad = files(RIG).filter((f) => !/\/(primitives|ui)\.jsx$/.test(f)).filter((f) => {
      const t = readFileSync(f, 'utf8')
      return /className=["'{`][^"'}`]*\brg-skel\b(?!-)/.test(t) && !(/data-wait/.test(t) && /rg-skel-cap|waitWords|PanelState/.test(t))
    }).map((f) => f.slice(RIG.length))
    expect(bad).toEqual([])
  })
})
