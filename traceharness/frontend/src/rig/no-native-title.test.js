import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { parseAst } from 'vite'

/* No native title in the rig. The browser's title tooltip waits about a second, is
   unstyled, never shows on keyboard focus or a tap, and covers what it explains. Hover help in the rig is
   the HoverCard: data-hint="…" on any element (HintLayer) or <HoverCard> around a trigger.

   The rule reads every source file under src/rig with the bundler's own parser:
   1. no lowercase JSX element (a DOM node) may carry a `title` attribute;
   2. a component may take a `title` only when it draws that title as visible text (a heading, a label):
      the ones in HEADINGS. A component that turned it into a tooltip takes `tip` instead (Go, Tag,
      KpiStat, Btn), so a new `<Go title=…>` fails here rather than slipping back into a native title. */

const RIG = fileURLToPath(new URL('./', import.meta.url))
export const HEADINGS = new Set([
  'Callout', 'Card', 'Empty', 'Frame', 'Group', 'HarnessJson', 'HarnessSummary', 'Head', 'InspectorGroup', 'LedgerError',
  'Missing', 'Modal', 'NoDataYet', 'PageHeader', 'Panel', 'PanelState', 'RunSide', 'Sec', 'SlotSec',
])

function sources(dir = RIG) {
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.jsx?$/.test(f) && !/\.test\.jsx?$/.test(f)) out.push(p)
  }
  return out.sort()
}
const nameOf = (n) => (n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? `${nameOf(n.object)}.${n.property.name}` : n.type === 'JSXNamespacedName' ? `${n.namespace.name}:${n.name.name}` : '?')

/** Every `title` attribute in a source text: { line, element, native }. */
export function titleAttributes(text) {
  const out = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.type === 'JSXOpeningElement') {
      const element = nameOf(n.name)
      for (const a of n.attributes) {
        if (a.type === 'JSXAttribute' && a.name && a.name.name === 'title') {
          out.push({ line: text.slice(0, a.start).split('\n').length, element, native: /^[a-z]/.test(element) })
        }
      }
    }
    for (const k of Object.keys(n)) if (k !== 'start' && k !== 'end') walk(n[k])
  }
  walk(parseAst(text, { lang: 'jsx' }))
  return out
}

describe('the rule itself', () => {
  it('finds a title on a DOM element and on a component, and nothing else', () => {
    const found = titleAttributes('const a = <div className="x"><span title="t">x</span><Go spec="s" title={y} /><Sec title="H" /><b data-hint="ok" /></div>\nconst o = { title: "not jsx" }')
    expect(found).toEqual([
      { line: 1, element: 'span', native: true },
      { line: 1, element: 'Go', native: false },
      { line: 1, element: 'Sec', native: false },
    ])
  })
})

describe('no native title in the rig', () => {
  const files = sources()
  it('reads every rig source file', () => {
    expect(files.length).toBeGreaterThan(80)
  })
  it('no DOM element carries a title attribute, and only heading components take a title', () => {
    const bad = []
    for (const f of files) {
      for (const t of titleAttributes(readFileSync(f, 'utf8'))) {
        if (t.native || !HEADINGS.has(t.element)) bad.push(`${relative(RIG, f)}:${t.line} <${t.element} title=…>`)
      }
    }
    expect(bad, 'use data-hint="…" (or a `tip` prop) for hover help; a title is for visible headings only').toEqual([])
  })
})
