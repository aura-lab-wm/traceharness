/* Rig · learn/figures/kinds/label-flow.jsx — how runs ended, whether they left a patch, and their label (article 02,
   figure 1). Three columns: the exit reason, whether a patch was left in the workspace, and the outcome label. Each band
   is one path (exit reason, patch, label), as thick as its runs and coloured by its label, so pass and fail can be
   followed across. The bands draw left to right once and dashes run along them three times. A node, pressed, follows
   its runs (the rest dim) and the readout says where they went; pressed again, it lets go. Tabs: study_v04's 120 runs and
   SWE-rebench's 2,174. The Table view is the exit reason by label table. */
import { useMemo, useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt } from '../math'
import { useReveal, useWidth } from '../../motion'
import { LABELS, labelOf, cx, useSvgId, onKeyPress } from './figs-a-parts'
import './label-flow.css'

const EXITS = ['submitted', 'no_action', 'max_steps', 'budget_exceeded', 'sentinel_abort', 'error', 'unknown']
const PATCH = [['true', 'left a patch'], ['false', 'left none']]
const HEADS = ['How it ended', 'Patch left?', 'Outcome label']
const SETS = { study_v04: 'study_v04', swe_rebench_openhands_qwen3coder: 'SWE-rebench' }
const H = 288, TOP = 30, NODE_W = 10, CH = 7.4
/** Below this width the flow runs top to bottom, V_LEN tall. */
const VERTICAL_BELOW = 520, V_LEN = 400
const keyOf = [(p) => p[0], (p) => String(p[1]), (p) => p[2]]
const rank = (list, k) => { const i = list.indexOf(k); return i < 0 ? list.length : i }
const LABEL_IDS = LABELS.map((l) => l.id)

/** A node's words: an exit reason as recorded, the patch column in words, a label in the article's words. */
export const nodeWord = (c, k) => (c === 0 ? k : c === 1 ? PATCH.find(([v]) => v === k)[1] : labelOf(k).word)
const sum = (ps) => ps.reduce((s, p) => s + p[3], 0)
const add = (xs) => xs.reduce((s, x) => s + x, 0)

/** The columns of a set of paths [[exit, patch, label, runs]]: [[{c, k, n}]], each in reading order. */
export function flowColumns(paths) {
  const present = (c, order) => [...new Set(paths.map(keyOf[c]))].sort((a, b) => rank(order, a) - rank(order, b) || a.localeCompare(b))
  return [present(0, EXITS), present(1, PATCH.map(([v]) => v)), present(2, LABEL_IDS)]
    .map((ks, c) => ks.map((k) => ({ c, k, n: sum(paths.filter((p) => keyOf[c](p) === k)) })))
}

/** Where everything goes: node slots and bars, and each path's band in each column. PURE. */
export function flowLayout(paths, { w, h = H, top = TOP, gap = 10, slot = 34, nodeW = NODE_W, left, right }) {
  const cols = flowColumns(paths)
  const avail = h - top - 4
  // one scale for all three columns: a node is n * s tall, and its slot (the room for its two-line label) at least `slot`
  const scaleOf = (nodes) => {
    let s = (avail - gap * (nodes.length - 1)) / add(nodes.map((x) => x.n))
    for (let i = 0; i < 4; i++) {
      const small = nodes.filter((x) => x.n * s < slot)
      const big = nodes.filter((x) => x.n * s >= slot)
      if (!big.length) break
      s = (avail - gap * (nodes.length - 1) - slot * small.length) / add(big.map((x) => x.n))
    }
    return s
  }
  const s = Math.min(...cols.map(scaleOf))
  const L = left ?? Math.ceil(Math.max(...cols[0].map((x) => Math.max(x.k.length, fmt.int(x.n).length))) * CH) + 8
  const R = right ?? Math.ceil(Math.max(...cols[2].map((x) => Math.max(nodeWord(2, x.k).length, fmt.int(x.n).length))) * CH) + 8
  const xs = [L, 0, w - R - nodeW]
  xs[1] = Math.round((xs[0] + xs[2]) / 2)
  const thick = (n) => Math.max(1.2, n * s)
  const nodes = cols.map((list, c) => {
    let y = top
    return list.map((x) => {
      const bar = add(paths.filter((p) => keyOf[c](p) === x.k).map((p) => thick(p[3])))
      const room = Math.max(bar, slot)
      const node = { ...x, x: xs[c], slotY: y, slotH: room, y: y + (room - bar) / 2, h: bar }
      y += room + gap
      return node
    })
  })
  // each path's place in each column: stacked inside its node, in an order that keeps crossings few
  const order = [
    (a, b) => rank(PATCH.map(([v]) => v), String(a[1])) - rank(PATCH.map(([v]) => v), String(b[1])) || rank(LABEL_IDS, a[2]) - rank(LABEL_IDS, b[2]),
    (a, b) => rank(LABEL_IDS, a[2]) - rank(LABEL_IDS, b[2]) || rank(EXITS, a[0]) - rank(EXITS, b[0]),
    (a, b) => rank(EXITS, a[0]) - rank(EXITS, b[0]) || rank(PATCH.map(([v]) => v), String(a[1])) - rank(PATCH.map(([v]) => v), String(b[1])),
  ]
  const at = paths.map(() => [null, null, null])
  nodes.forEach((list, c) => list.forEach((node) => {
    let y = node.y
    paths.map((p, i) => [p, i]).filter(([p]) => keyOf[c](p) === node.k).sort(([a], [b]) => order[c](a, b))
      .forEach(([p, i]) => { at[i][c] = [y, y + thick(p[3])]; y += thick(p[3]) })
  }))
  const bands = paths.map((p, i) => ({ path: p, at: at[i], t: thick(p[3]) }))
  return { nodes, bands, xs, L, R, s }
}

/** A point on the flow: along it (column to column) and across it. Left to right, or top to bottom on a phone. */
const pointer = (vertical) => (along, across) => (vertical ? `${across},${along}` : `${along},${across}`)
const ribbon = (P, x0, [a0, b0], x1, [a1, b1]) => {
  const m = (x0 + x1) / 2
  return `M${P(x0, a0)} C${P(m, a0)} ${P(m, a1)} ${P(x1, a1)} L${P(x1, b1)} C${P(m, b1)} ${P(m, b0)} ${P(x0, b0)} Z`
}
const mid = ([a, b]) => (a + b) / 2
/** The centre line of a band, from the first column through the second to the third. */
const spine = (P, xs, at, nw) => {
  const seg = (x0, y0, x1, y1) => { const m = (x0 + x1) / 2; return `C${P(m, y0)} ${P(m, y1)} ${P(x1, y1)}` }
  return `M${P(xs[0] + nw, mid(at[0]))} ${seg(xs[0] + nw, mid(at[0]), xs[1], mid(at[1]))} L${P(xs[1] + nw, mid(at[1]))} ${seg(xs[1] + nw, mid(at[1]), xs[2], mid(at[2]))}`
}
/** A label in lines of at most `max` characters, broken between words. */
export function wrapWords(text, max = 10) {
  const lines = []
  for (const word of String(text).split(' ')) {
    const last = lines[lines.length - 1]
    if (last != null && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
  }
  return lines
}

const counts = (ps, c) => flowColumns(ps)[c].map((x) => `${fmt.int(x.n)} ${nodeWord(c, x.k)}`).join(', ')

/** The readout: the whole set, or where the runs of one node went. PURE. */
export function flowSay(set, sel) {
  const name = SETS[set.dataset] || set.dataset
  const ps = set.paths
  if (!sel) return `${name}: ${fmt.int(set.runs)} runs. ${counts(ps, 0)}; ${counts(ps, 2)}. Press an ending, a patch or a label to follow its runs.`
  const mine = ps.filter((p) => keyOf[sel.c](p) === sel.k)
  const n = fmt.int(sum(mine))
  if (sel.c === 0) {
    const parts = PATCH.map(([v, words]) => [words, mine.filter((p) => String(p[1]) === v)]).filter(([, x]) => x.length)
      .map(([words, x]) => `${fmt.int(sum(x))} ${words}: ${counts(x, 2)}`)
    return `${sel.k}: ${n} runs. ${parts.join('. ')}.`
  }
  if (sel.c === 1) {
    const graded = sel.k === 'true' ? 'graded on that patch' : 'graded on the original code'
    return `${nodeWord(1, sel.k)[0].toUpperCase()}${nodeWord(1, sel.k).slice(1)}: ${n} runs, ${graded}: ${counts(mine, 2)}. They ended ${counts(mine, 0)}.`
  }
  const patches = flowColumns(mine)[1]
  const how = patches.length === 1 ? `all ${nodeWord(1, patches[0].k)}` : counts(mine, 1)
  return `${labelOf(sel.k).word}: ${n} runs, ${how}. They ended ${counts(mine, 0)}.`
}

const LINE = 15
/** A node's label: where it sits and its lines, beside the node (left to right) or above / below it (top to bottom). */
function nodeLabel(nd, vertical) {
  const word = nodeWord(nd.c, nd.k)
  const count = `${fmt.int(nd.n)} ${nd.n === 1 ? 'run' : 'runs'}`
  const across = nd.slotY + nd.slotH / 2
  if (!vertical) {
    const lines = [word, count]
    const x = nd.c === 0 ? nd.x - 6 : nd.x + NODE_W + 6
    return { lines, x, y: across - 2, anchor: nd.c === 0 ? 'end' : 'start', pill: nd.c === 1 && { x: x - 5, y: across - 16, w: Math.max(word.length, 8) * CH + 6, h: 36 } }
  }
  const lines = [...wrapWords(word), count]
  const height = lines.length * LINE
  const y = nd.c === 0 ? nd.x - 8 - height + LINE - 3 : nd.c === 2 ? nd.x + NODE_W + LINE + 2 : nd.x + NODE_W / 2 - height / 2 + LINE - 4
  const wide = Math.max(...lines.map((l) => l.length)) * CH + 10
  return { lines, x: across, y, anchor: 'middle', pill: nd.c === 1 && { x: across - wide / 2, y: y - LINE + 2, w: wide, h: height + 4 } }
}

/** The flow top to bottom in a drawing `w` wide: each label slot as wide as the width allows (78 px at most). PURE. */
export function verticalLayout(paths, w) {
  const most = Math.max(...flowColumns(paths).map((col) => col.length))
  const slot = Math.min(78, Math.floor((w - 6 * (most - 1)) / most))
  // 4 px to spare: a band of a run or two keeps a visible thickness, a little more than its share
  return flowLayout(paths, { w: V_LEN, h: w, top: 0, gap: 6, slot, left: 44, right: 64 })
}

function Flow({ set, w, seen, sel, onSel }) {
  const clip = useSvgId('flow')
  const vertical = w < VERTICAL_BELOW
  // top to bottom, the flow runs down the page: its length is the drawing's height and its breadth the width
  const lay = useMemo(() => (vertical ? verticalLayout(set.paths, w) : flowLayout(set.paths, { w })), [set, w, vertical])
  const { nodes, bands, xs } = lay
  const [W, Hh] = vertical ? [w, V_LEN] : [w, H]
  const P = pointer(vertical)
  const on = (p) => !sel || keyOf[sel.c](p) === sel.k
  const rect = (along, across, len, breadth) => (vertical ? { x: across, y: along, width: breadth, height: len } : { x: along, y: across, width: len, height: breadth })
  return (
    <svg className={cx('rg-flow-svg', seen && 'seen', sel && 'picked', vertical && 'vertical')} viewBox={`0 0 ${W} ${Hh}`} width={W} height={Hh} role="group"
      aria-label={`${fmt.int(set.runs)} runs from exit reason to label: ${bands.map((b) => `${fmt.int(b.path[3])} ${b.path[0]}, ${nodeWord(1, String(b.path[1]))}, ${labelOf(b.path[2]).word}`).join('; ')}`}>
      <defs><clipPath id={clip}><rect className="rg-flow-grow" x="0" y="0" width={W} height={Hh} /></clipPath></defs>
      {!vertical && HEADS.map((t, c) => <text key={t} className="rg-flow-head" x={c === 0 ? 0 : c === 2 ? w : xs[1] + NODE_W / 2} y="12" textAnchor={['start', 'middle', 'end'][c]}>{t}</text>)}
      <g clipPath={`url(#${clip})`}>
        {bands.map((b) => (
          <g key={b.path.slice(0, 3).join('|')} className={cx('rg-flow-band', `fa-${labelOf(b.path[2]).tone}`, on(b.path) ? 'on' : 'off')}>
            <path className="band" d={ribbon(P, xs[0] + NODE_W, b.at[0], xs[1], b.at[1])} />
            <rect className="band" {...rect(xs[1], b.at[1][0], NODE_W, b.t)} />
            <path className="band" d={ribbon(P, xs[1] + NODE_W, b.at[1], xs[2], b.at[2])} />
            <path className="dash" d={spine(P, xs, b.at, NODE_W)} style={{ strokeWidth: Math.min(2, Math.max(1, b.t / 3)) }} />
          </g>
        ))}
      </g>
      {nodes.flat().map((nd) => {
        const picked = Boolean(sel && sel.c === nd.c && sel.k === nd.k)
        const word = nodeWord(nd.c, nd.k)
        const lab = nodeLabel(nd, vertical)
        const reach = vertical ? (nd.c === 0 ? [0, nd.x + NODE_W] : nd.c === 2 ? [nd.x, V_LEN] : [lab.pill.y, lab.pill.y + lab.pill.h])
          : nd.c === 0 ? [0, nd.x + NODE_W] : nd.c === 2 ? [nd.x, w] : [nd.x - 4, lab.pill.x + lab.pill.w]
        const go = () => onSel(picked ? null : { c: nd.c, k: nd.k })
        return (
          <g key={`${nd.c}${nd.k}`} className={cx('rg-flow-node', picked && 'on')} role="button" tabIndex={0} data-el="fig-flow-node" data-key={`${nd.c}:${nd.k}`}
            aria-pressed={picked} aria-label={`${word}: ${fmt.int(nd.n)} runs. ${picked ? 'Followed; press to show all runs' : 'Press to follow its runs'}`}
            onClick={go} onKeyDown={onKeyPress(go)}>
            <rect className="hit" {...rect(reach[0], nd.slotY - 3, reach[1] - reach[0], nd.slotH + 6)} rx="4" />
            <rect className="node" {...rect(nd.x, nd.y, NODE_W, Math.max(2, nd.h))} rx="1.5" />
            {lab.pill && <rect className="pill" x={lab.pill.x} y={lab.pill.y} width={lab.pill.w} height={lab.pill.h} rx="5" />}
            {lab.lines.map((line, i) => (
              <text key={i} className={i === lab.lines.length - 1 ? 'cnt' : 'lab'} x={lab.x} y={lab.y + (vertical ? i * LINE : i * 15)} textAnchor={lab.anchor}>{line}</text>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

/** The exit reason by label table (rows: exit reasons and the total; columns: labels and the total). */
export function flowTable(set) {
  const cols = flowColumns(set.paths)
  const cell = (e, l) => sum(set.paths.filter((p) => (e == null || p[0] === e) && (l == null || p[2] === l)))
  return {
    cols: ['Exit reason', ...cols[2].map((x) => labelOf(x.k).word), 'total'],
    rows: [...cols[0].map((x) => [x.k, ...cols[2].map((l) => fmt.int(cell(x.k, l.k))), fmt.int(x.n)]),
      ['total', ...cols[2].map((l) => fmt.int(l.n)), fmt.int(set.runs)]],
  }
}

function LabelFlow({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [tab, setTab] = useState(0)
  const [sel, setSel] = useState(null)
  const set = d.sets[tab]
  const t = flowTable(set)
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      tabs={d.sets.map((s, i) => [i, `${SETS[s.dataset] || s.dataset} · ${fmt.int(s.runs)} runs`])} tab={tab} onTab={(i) => { setTab(i); setSel(null) }}
      legend={flowColumns(set.paths)[2].map((x) => ({ label: labelOf(x.k).word, tone: `fa-${labelOf(x.k).tone}` }))}
      chart={<div ref={boxRef}><Flow set={set} w={w} seen={reveal.seen} sel={sel} onSel={setSel} />
        <p className="rg-lfig-axisname">{w < VERTICAL_BELOW && `${HEADS.join(' ↓ ')} · `}a band: runs that share an ending, a patch and a label; its thickness is their number</p></div>}
      readout={flowSay(set, sel)}
      table={<FigTable caption={`Figure ${n} as a table: ${SETS[set.dataset] || set.dataset}, exit reason by outcome label`} cols={t.cols} rows={t.rows} />} />
  )
}

function Preview({ d }) {
  const { bands, xs } = flowLayout(d.sets[0].paths, { w: 120, h: 56, top: 4, gap: 3, slot: 0, nodeW: 3, left: 8, right: 8 })
  const P = pointer(false)
  return (
    <g>{bands.map((b) => (
      <path key={b.path.slice(0, 3).join('|')} className={`rg-prev-fa-${labelOf(b.path[2]).tone}`} d={`${ribbon(P, xs[0] + 3, b.at[0], xs[1], b.at[1])} ${ribbon(P, xs[1] + 3, b.at[1], xs[2], b.at[2])}`} />
    ))}{[0, 1, 2].map((c) => <rect key={c} className="rg-prev-fa-node" x={xs[c]} y="4" width="3" height="48" rx="1" />)}</g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const out = {}
  d.sets.forEach((set, j) => {
    const [exits, , labels] = flowColumns(set.paths)
    out[`runs_${j}`] = fmt.int(set.runs)
    for (const x of exits) {
      const mine = set.paths.filter((p) => p[0] === x.k)
      out[`exit_${j}_${x.k}`] = fmt.int(x.n)
      out[`edited_${j}_${x.k}`] = fmt.int(sum(mine.filter((p) => p[1])))
      out[`passed_${j}_${x.k}`] = `${fmt.int(sum(mine.filter((p) => p[2] === 'passed')))} of the ${fmt.int(x.n)}`
    }
    for (const x of labels) out[`label_${j}_${x.k}`] = fmt.int(x.n)
  })
  return out
}

export const KINDS = { label_flow: { Figure: LabelFlow, Preview, headlines } }
