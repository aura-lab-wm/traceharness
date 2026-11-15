import { describe, expect, test } from 'vitest'
import fixture from './align.fixture.json'
import { alignSteps, canonArgs, canonValue, compareLedgers, divergence, stepsOf } from './align.js'

/* Parity with traceharness/backend/fork.py. The fixture holds real recorded ledgers (trimmed) and the
   divergence indices the backend computes for them; regenerate it with scripts/align_parity_fixture.py. */
describe('parity with the backend comparator', () => {
  test.each(fixture.pairs.map((p) => [p.name, p]))('%s', (_n, p) => {
    const sa = stepsOf(p.spans_a), sb = stepsOf(p.spans_b)
    const d = divergence(sa, sb)
    expect({ n_a: sa.length, n_b: sb.length, tool: d.tool, effect: d.effect, text: d.text }).toEqual({
      n_a: p.expected.n_a, n_b: p.expected.n_b, tool: p.expected.tool, effect: p.expected.effect, text: p.expected.text,
    })
    expect(sa.map((s) => s.key)).toEqual(p.expected.keys_a)
    expect(sb.map((s) => s.key)).toEqual(p.expected.keys_b)
  })
  test('the fixture covers every divergence level', () => {
    const e = fixture.pairs.map((p) => p.expected)
    expect(e.some((x) => x.tool === null && x.effect === null && x.text === null)).toBe(true)
    expect(e.some((x) => x.tool !== null && x.tool === x.effect)).toBe(true)
    expect(e.some((x) => x.tool === null && x.effect !== null)).toBe(true)
    expect(e.some((x) => x.tool === null && x.effect === null && x.text !== null)).toBe(true)
  })
})

describe('canonical arguments (fork.py canon_args)', () => {
  test('key order, whitespace and run ids do not matter; paths do', () => {
    expect(canonArgs({ b: 1, a: 'x  y' })).toBe(canonArgs({ a: 'x y', b: 1 }))
    expect(canonArgs({ path: 'a.py' })).not.toBe(canonArgs({ path: 'b.py' }))
    expect(canonArgs({ run_id: 'r1', path: 'a.py' })).toBe('path=a.py')
    expect(canonValue('/tmp/x1/y and 20260903-001456-0b14a6 and deadbeef01')).toBe('<tmp> and <id> and <id>')
  })
  test('non-string values render as sorted JSON the way Python writes it', () => {
    expect(canonValue({ z: [1, 'a'], a: null, m: true })).toBe('{"a": null, "m": true, "z": [1, "a"]}')
  })
})

const chat = (step, seq, text = '') => ({ span: 'chat', step, seq, text })
const tool = (seq, name, args, extra = {}) => ({ span: 'execute_tool', seq, 'gen_ai.tool.name': name, args, ...extra })

describe('the view', () => {
  test('same tool, different path is a divergence (the old name-only rule called it "same")', () => {
    const a = [chat(0, 0), tool(1, 'read_file', { path: 'a.py' }), chat(1, 2), tool(3, 'submit', {})]
    const b = [chat(0, 0), tool(1, 'read_file', { path: 'b.py' }), chat(1, 2), tool(3, 'submit', {})]
    const c = compareLedgers(a, b)
    expect(c.fork).toBe(0)
    expect(c.level).toBe('action')
    expect(c.rows.map((r) => r.state)).toEqual(['changed', 'same'])
  })
  test('one inserted step does not mark every later row as diverged', () => {
    const a = [chat(0, 0), tool(1, 'list_files', {}), chat(1, 2), tool(3, 'run_tests', {}), chat(2, 4), tool(5, 'submit', {})]
    const b = [chat(0, 0), tool(1, 'list_files', {}), chat(1, 2), tool(3, 'read_file', { path: 'x.py' }), chat(2, 4), tool(5, 'run_tests', {}), chat(3, 6), tool(7, 'submit', {})]
    const c = compareLedgers(a, b)
    expect(c.rows.map((r) => r.state)).toEqual(['same', 'b-only', 'same', 'same'])
    expect(c.rows[1].a).toBe(null)
    expect(c.fork).toBe(1)
  })
  test('same action, different outcome is reported as the outcome level', () => {
    const a = [chat(0, 0), tool(1, 'run_tests', {}, { status: 'ok', tests_passed: true })]
    const b = [chat(0, 0), tool(1, 'run_tests', {}, { status: 'ok', tests_passed: false })]
    const c = compareLedgers(a, b)
    expect(c.level).toBe('outcome')
    expect(c.rows[0].state).toBe('effect')
  })
  test('only the reply text differing is its own level; identical runs have none', () => {
    const a = [chat(0, 0, 'hello'), tool(1, 'submit', {})]
    expect(compareLedgers(a, [chat(0, 0, 'hi there'), tool(1, 'submit', {})]).level).toBe('reply')
    expect(compareLedgers(a, a).level).toBe(null)
  })
  test('a run that ends early shows the rest as A-only', () => {
    const a = [chat(0, 0), tool(1, 'list_files', {}), chat(1, 2), tool(3, 'submit', {})]
    const c = compareLedgers(a, a.slice(0, 2))
    expect(c.rows.map((r) => r.state)).toEqual(['same', 'a-only'])
    expect(alignSteps([], []).length).toBe(0)
  })
})

describe('what differs', () => {
  test('names the arguments that differ when both runs called the same tool', () => {
    const a = [chat(0, 0), tool(1, 'write_file', { path: 'x.py', content: 'a' })]
    const b = [chat(0, 0), tool(1, 'write_file', { path: 'x.py', content: 'b' })]
    expect(compareLedgers(a, b).argDiff).toEqual({ tool: 'write_file', keys: ['content'] })
    expect(compareLedgers(a, a).argDiff).toBe(null)
  })
})
