/* lanes-model.js: every run of a task side by side, step by step — which lanes, where they part, the focus. */
import { describe, expect, it } from 'vitest'
import { ledgerSteps } from './views/steps'
import { pickLanes, laneKeys, laneKinds, stepFiles, firstSplit, parseFocus, focusArg, moveFocus, MAX_LANES, lanesInView, inViewWords, pickWords, splitWords } from './lanes-model'
import { stepShape } from './run-shape'

const runs = (tok) => tok.map((t, i) => ({ id: `r${i + 1}`, idx: i, tokens: t }))

describe('pickLanes', () => {
  it('six runs or fewer are all shown, in run order', () => {
    expect(MAX_LANES).toBe(6)
    expect(pickLanes(runs([5, 1, 3])).shown.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    expect(pickLanes(runs([1, 2, 3, 4, 5, 6])).rule).toBe('all')
  })
  it('more than six: the cheapest, the median and the costliest, in run order, unless all are asked for', () => {
    const p = pickLanes(runs([50, 10, 70, 30, 90, 20, 60]))
    expect(p.rule).toBe('extremes')
    expect(p.shown.map((r) => r.id)).toEqual(['r1', 'r2', 'r5'])     // 50 the median of 7, 10 cheapest, 90 costliest
    expect(p.shown.map((r) => r.role)).toEqual(['median', 'cheapest', 'costliest'])
    expect(p.hidden).toBe(4)
    expect(pickLanes(runs([50, 10, 70, 30, 90, 20, 60]), { all: true }).shown).toHaveLength(7)
  })
  it('an even count takes the lower median; runs with unknown tokens are not ranked', () => {
    // six known: 10 20 30 40 70 80, the lower median is 30 (r4)
    expect(pickLanes(runs([40, 10, null, 30, 20, 80, 70])).shown.map((r) => r.id)).toEqual(['r2', 'r4', 'r6'])
  })
  it('with fewer than three runs of known tokens the first three runs are shown', () => {
    const p = pickLanes(runs([null, null, 5, null, null, null, null]))
    expect(p.shown.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
    expect(p.rule).toBe('first')
  })
})

describe('pickLanes without tokens', () => {
  const byCalls = (calls) => calls.map((c, i) => ({ id: `r${i + 1}`, idx: i, tokens: null, calls: c }))
  it('picks by model calls when tokens are not recorded, and says so', () => {
    const p = pickLanes(byCalls([50, 10, 70, 30, 90, 20, 60]))
    expect(p.rule).toBe('calls')
    expect(p.shown.map((r) => r.id)).toEqual(['r1', 'r2', 'r5'])
    expect(p.shown.map((r) => r.role)).toEqual(['median', 'cheapest', 'costliest'])
    expect(pickWords(p, 7)).toBe('3 of 7 runs: the cheapest, the median and the costliest by model calls (tokens not recorded).')
  })
  it('says the first three when neither tokens nor model calls are recorded', () => {
    const p = pickLanes(byCalls([null, null, null, null, null, null, null]))
    expect(p.rule).toBe('first')
    expect(pickWords(p, 7)).toBe('The first 3 of 7 runs (neither tokens nor model calls recorded).')
    expect(pickWords(pickLanes(runs([50, 10, 70, 30, 90, 20, 60])), 7)).toBe('3 of 7 runs: the cheapest, the median and the costliest by tokens.')
  })
})

describe('the lanes in view', () => {
  const heads = (n, w) => Array.from({ length: n }, (_, i) => ({ lane: i + 1, left: i * w, right: (i + 1) * w }))
  it('counts the lanes wholly inside the box and the ones each side', () => {
    const v = lanesInView(heads(10, 220), { left: 0, right: 1210, overflow: true })
    expect(v).toMatchObject({ overflow: true, total: 10, shown: [1, 2, 3, 4, 5], leftN: 0, rightN: 5 })
    expect(inViewWords(v)).toBe('Showing 5 of 10 runs: Run 1 to Run 5 · 5 more, scroll →')
    const mid = lanesInView(heads(10, 220), { left: 440, right: 1650, overflow: true })
    expect(inViewWords(mid)).toBe('Showing 5 of 10 runs: Run 3 to Run 7 · 2 more ←, 3 more →')
    const end = lanesInView(heads(10, 220), { left: 1000, right: 2210, overflow: true })
    expect(inViewWords(end)).toBe('Showing 5 of 10 runs: Run 6 to Run 10 · 5 more, scroll ←')
  })
  it('says nothing when every lane fits', () => {
    const v = lanesInView(heads(3, 300), { left: 0, right: 1210, overflow: false })
    expect(v.overflow).toBe(false)
    expect(inViewWords(v)).toBe('')
  })
})

describe('where the runs part, in one statement', () => {
  it('the exact commands differing earlier is said as part of the same sentence, not against it', () => {
    expect(splitWords(1, null)).toBe('The runs part at step 1: their first steps differ in phase or files.')
    expect(splitWords(3, null)).toBe('The runs part at step 3: up to step 2 every run took the same kind of step on the same files.')
    expect(splitWords(3, 1)).toBe('The runs part at step 3: up to step 2 every run took the same kind of step on the same files; only the exact commands vary from step 1 (another flag, spacing or search on the same files).')
    expect(splitWords(2, 1)).toBe('The runs part at step 2: at step 1 every run took the same kind of step on the same files; only the exact commands vary from step 1 (another flag, spacing or search on the same files).')
  })
})

const ch = (seq) => ({ seq, span: 'chat', tool_calls: [{ name: 'bash' }] })
const sh = (seq, command) => ({ seq, span: 'execute_tool', 'gen_ai.tool.name': 'bash', args: { command } })
const run = (cmds) => ledgerSteps(cmds.flatMap((c, i) => [ch(2 * i + 1), sh(2 * i + 2, c)]))

describe('where the lanes part', () => {
  it('the first step whose action is not the same in every lane; whitespace and key order do not count', () => {
    const a = run(['ls', 'cat a.py', 'pytest'])
    const b = run(['ls ', 'cat  a.py', 'pytest -x'])
    expect(firstSplit([laneKeys(a), laneKeys(b)])).toBe(3)
  })
  it('a lane that ended counts as a different step; identical lanes never part', () => {
    expect(firstSplit([laneKeys(run(['ls', 'cat'])), laneKeys(run(['ls']))])).toBe(2)
    expect(firstSplit([laneKeys(run(['ls'])), laneKeys(run(['ls']))])).toBeNull()
    expect(firstSplit([laneKeys(run(['ls']))])).toBeNull()
  })
  it('a third lane that differs early sets the split', () => {
    expect(firstSplit([laneKeys(run(['ls', 'a', 'b'])), laneKeys(run(['ls', 'a', 'c'])), laneKeys(run(['pwd', 'a', 'b']))])).toBe(1)
  })
})

/* the substantive split: a step's phase and the files it names (laneKinds); a flag or spacing does not count */
const phased = (cmds) => ledgerSteps(cmds.flatMap(([c, p], i) => [{ ...ch(2 * i + 1), phase: p }, { ...sh(2 * i + 2, c), phase: p }]))
const kinds = (cmds) => { const st = phased(cmds); return laneKinds(st, stepShape(st)) }

describe('where the lanes part in substance', () => {
  it('ls against ls -la is the same kind of step: the runs part where a phase or a file differs', () => {
    const a = kinds([['ls /testbed', 'explore'], ['cat /testbed/pkg/a.py', 'explore'], ['sed -i s/x/y/ pkg/a.py', 'edit']])
    const b = kinds([['ls -la /testbed', 'explore'], ['cat pkg/a.py', 'explore'], ['python -m pytest -q', 'test']])
    expect(firstSplit([a, b])).toBe(3)
  })
  it('another phase on the same file parts the runs', () => {
    const a = kinds([['ls', 'explore'], ['cat tests/test_a.py', 'explore']])
    const b = kinds([['ls', 'explore'], ['python -m pytest tests/test_a.py', 'test']])
    expect(firstSplit([a, b])).toBe(2)
  })
  it('the same phase on another file parts the runs', () => {
    const a = kinds([['ls', 'explore'], ['cat pkg/a.py', 'explore']])
    const b = kinds([['ls', 'explore'], ['cat pkg/b.py', 'explore']])
    expect(firstSplit([a, b])).toBe(2)
  })
  it('a lane that ended parts the runs; same phases and files never part', () => {
    expect(firstSplit([kinds([['ls', 'explore'], ['cat a.py', 'explore']]), kinds([['ls -la', 'explore']])])).toBe(2)
    expect(firstSplit([kinds([['ls', 'explore']]), kinds([['ls -1', 'explore']])])).toBeNull()
  })
  it('the files a step names: lab tool paths and paths with an extension in a command, the working directory dropped', () => {
    const st = phased([['cd /testbed && grep -rn "def area" ./pkg/a.py pkg/b.py', 'explore']])
    expect(stepFiles(st[0])).toEqual(['pkg/a.py', 'pkg/b.py'])
    expect(stepFiles(phased([['curl -s https://pypi.org/pypi/pkg/json', 'lookup']])[0])).toEqual([])
    expect(stepFiles(phased([['curl -sO https://example.org/raw/setup.py --output=/tmp/x.py', 'lookup']])[0])).toEqual([])
    expect(stepFiles(phased([["sed -n '1,20p' /testbed/pkg/a.py", 'explore']])[0])).toEqual(['pkg/a.py'])
    expect(stepFiles(phased([["python -c 'import pkg; print(pkg.area(2))'", 'reproduce']])[0])).toEqual([])
    const tool = ledgerSteps([ch(1), { seq: 2, span: 'execute_tool', 'gen_ai.tool.name': 'read_file', args: { path: 'lru/cache.py' } }])
    expect(stepFiles(tool[0])).toEqual(['lru/cache.py'])
  })
})

describe('the focus', () => {
  it('is run n and step k in the link', () => {
    expect(parseFocus('r2s32')).toEqual({ lane: 2, step: 32 })
    expect(parseFocus('x')).toBeNull()
    expect(parseFocus('r0s3')).toBeNull()
    expect(focusArg({ lane: 3, step: 7 })).toBe('r3s7')
    expect(focusArg(null)).toBe('')
  })
  const lanes = [{ idx: 1, n: 10 }, { idx: 3, n: 4 }, { idx: 4, n: 20 }]
  it('j / k and the up and down arrows move within the lane, held at its ends', () => {
    expect(moveFocus({ lane: 1, step: 5 }, 'j', lanes)).toEqual({ lane: 1, step: 6 })
    expect(moveFocus({ lane: 1, step: 5 }, 'ArrowUp', lanes)).toEqual({ lane: 1, step: 4 })
    expect(moveFocus({ lane: 3, step: 4 }, 'ArrowDown', lanes)).toEqual({ lane: 3, step: 4 })
    expect(moveFocus({ lane: 1, step: 1 }, 'k', lanes)).toEqual({ lane: 1, step: 1 })
  })
  it('← / → go to the next shown lane at the same step, held at the shorter lane\'s last step', () => {
    expect(moveFocus({ lane: 1, step: 8 }, 'ArrowRight', lanes)).toEqual({ lane: 3, step: 4 })
    expect(moveFocus({ lane: 3, step: 4 }, 'ArrowRight', lanes)).toEqual({ lane: 4, step: 4 })
    expect(moveFocus({ lane: 4, step: 4 }, 'ArrowRight', lanes)).toEqual({ lane: 4, step: 4 })
    expect(moveFocus({ lane: 3, step: 2 }, 'ArrowLeft', lanes)).toEqual({ lane: 1, step: 2 })
  })
  it('no focus starts at step 1 of the first lane; a focus on a hidden lane starts there too', () => {
    expect(moveFocus(null, 'j', lanes)).toEqual({ lane: 1, step: 1 })
    expect(moveFocus({ lane: 2, step: 5 }, 'j', lanes)).toEqual({ lane: 1, step: 1 })
    expect(moveFocus({ lane: 1, step: 5 }, 'q', lanes)).toEqual({ lane: 1, step: 5 })
  })
})
