/* Rig · learn/figures/kinds/import-pipeline.jsx — the ways runs reach a dataset folder (article 03, figure 1).
   Four ways in on the left: the three imports go through an adapter, the runner writes its ledger directly; every way
   ends in the same folder. The path of the way picked flows (dashed lines that run four times); the others stay
   still. Under the drawing, the picked way step by step, with the real numbers where a bundled dataset came that way:
   the SWE-rebench import (its provenance.json and 2,174 ledgers) and the runner (study_v04's 3,240 ledgers). Below
   600 px the ways stack on the left and the stages on the right, one under the other. */
import { useState } from 'react'
import { FigureCard, FigTable } from '../FigureCard'
import { fmt } from '../math'
import { useReveal, useWidth } from '../../motion'
import { cx, onKeyPress } from './figs-a-parts'
import './import-pipeline.css'

export const WAYS = Object.freeze([
  { id: 'files', name: 'Import files', sub: 'your session files', short: 'session files', adapter: true },
  { id: 'sample', name: 'Public sample', sub: 'a Hugging Face dataset', short: 'Hugging Face', adapter: true },
  { id: 'capture', name: 'Session capture', sub: 'local agent sessions', short: 'your sessions', adapter: true },
  { id: 'runner', name: 'The runner', sub: 'an agent at work', short: 'agent at work', adapter: false },
])
/** A way's subtitle: its short one when its box is too narrow for the long one (12 px words, about 6.4 px a letter). */
export const waySub = (x, b) => (x.sub.length * 6.4 + 20 <= b.w ? x.sub : x.short)
const SPANS = ['chat', 'execute_tool', 'edit', 'grade']
const FILES = ['index.jsonl', 'provenance.json', 'run/ledger.jsonl', 'run/patch.diff']
const BOX_H = 46

/** The boxes and their places: the four ways in, then adapter, ledger and folder. PURE. */
export function pipeLayout(w) {
  if (w >= 600) {
    const iw = Math.round(Math.min(170, Math.max(128, w * 0.25)))
    const gx = Math.round(Math.max(28, w * 0.055))
    const rest = w - iw - 3 * gx
    const [aw, lw] = [Math.round(rest * 0.27), Math.round(rest * 0.33)]
    const fw = rest - aw - lw
    const ways = WAYS.map((x, i) => ({ id: x.id, x: 0, y: i * (BOX_H + 10), w: iw, h: BOX_H }))
    const h = 4 * BOX_H + 30
    const ax = iw + gx
    const adapter = { id: 'adapter', x: ax, y: (ways[0].y + ways[2].y + BOX_H) / 2 - 30, w: aw, h: 60 }
    const ledger = { id: 'ledger', x: ax + aw + gx, y: h / 2 - 66, w: lw, h: 120 }
    const folder = { id: 'folder', x: ledger.x + lw + gx, y: h / 2 - 66, w: fw, h: 120 }
    return { dir: 'h', w, h: h + 2, ways, adapter, ledger, folder }
  }
  // a phone: the four ways stacked on the left, the stages stacked on the right, so no line passes behind a box
  const iw = Math.round(w * 0.47)
  const ways = WAYS.map((x, i) => ({ id: x.id, x: 0, y: i * (BOX_H + 10), w: iw, h: BOX_H }))
  const sx = Math.round(w * 0.55), sw = w - sx
  const adapter = { id: 'adapter', x: sx, y: (ways[0].y + ways[2].y + BOX_H) / 2 - 26, w: sw, h: 52 }
  const ledger = { id: 'ledger', x: sx, y: adapter.y + adapter.h + 28, w: sw, h: 104 }
  const folder = { id: 'folder', x: sx, y: ledger.y + ledger.h + 28, w: sw, h: 104 }
  return { dir: 'v', w, h: folder.y + folder.h + 2, ways, adapter, ledger, folder }
}

/** The lines: [from, to, entry share along the target's edge], each tagged with the ways it carries. PURE. */
export function pipeLinks(lay) {
  const imports = lay.ways.filter((b) => WAYS.find((x) => x.id === b.id).adapter)
  const runner = lay.ways.find((b) => b.id === 'runner')
  // on a phone the ways still enter from the side; the stages follow one another downwards
  const down = lay.dir === 'v' ? 'v' : 'h'
  return [
    ...imports.map((b, i) => ({ from: b, to: lay.adapter, at: 0.25 + (0.5 * i) / (imports.length - 1), ways: [b.id], dir: 'h' })),
    { from: lay.adapter, to: lay.ledger, at: down === 'v' ? 0.5 : 0.38, ways: imports.map((b) => b.id), dir: down },
    { from: runner, to: lay.ledger, at: down === 'v' ? 0.6 : 0.82, ways: ['runner'], dir: 'h' },
    { from: lay.ledger, to: lay.folder, at: 0.5, ways: WAYS.map((x) => x.id), dir: down },
  ]
}

const curve = (dir, a, b, at) => {
  if (dir === 'h') {
    const [x0, y0, x1, y1] = [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h * at]
    const m = (x1 - x0) / 2
    return `M${x0},${y0} C${x0 + m},${y0} ${x1 - m},${y1} ${x1},${y1}`
  }
  const [x0, y0, x1, y1] = [a.x + a.w / 2, a.y + a.h, b.x + b.w * at, b.y]
  const m = (y1 - y0) / 2
  return `M${x0},${y0} C${x0},${y0 + m} ${x1},${y1 - m} ${x1},${y1}`
}

/** The picked way, step by step, in words and with its dataset's numbers. PURE. */
export function waySteps(way, d) {
  const imp = d.import, run = d.runner
  const spans = (s) => SPANS.map((k) => `${fmt.int(s[k] || 0)} ${k}`).join(', ')
  if (way === 'sample') {
    return [
      ['Source', `${imp.source}, revision ${imp.revision}, ${imp.licence}, fetched ${imp.fetched}: ${fmt.int(imp.source_runs)} runs of ${fmt.int(imp.source_tasks)} tasks.`],
      ['Draw', `${fmt.int(imp.drawn_tasks)} tasks with seed ${imp.seed}, from the ${fmt.int(imp.tasks_3plus)} that have at least 3 runs, and every run of each: ${fmt.int(imp.selected)} runs.`],
      ['Adapter', `The ${imp.adapter} adapter wrote ${fmt.int(imp.written)} runs and skipped ${fmt.int(imp.skipped)}, each skip named with its reason in the provenance record.`],
      ['Ledger', `One span per action: ${spans(imp.spans)} spans over the ${fmt.int(imp.runs)} runs.`],
      ['Folder', `data/runs/${imp.dataset}: index.jsonl (${fmt.int(imp.runs)} rows), provenance.json, and a folder per run with ${Object.keys(imp.files).join(', ')}.`],
    ]
  }
  if (way === 'runner') {
    return [
      ['Run', `${run.models} models x ${run.harnesses} harnesses x ${run.tasks} tasks x ${run.repeats} runs: ${fmt.int(run.runs)} runs.`],
      ['No adapter', 'The runner writes each span as the agent works, so nothing needs converting.'],
      ['Ledger', `${spans(run.spans)} spans over the ${fmt.int(run.runs)} runs.`],
      ['Folder', `data/runs/${run.dataset}: index.jsonl (${fmt.int(run.runs)} rows) and a folder per run with the same files. No provenance.json: the runs were made here.`],
    ]
  }
  if (way === 'files') {
    return [
      ['Source', 'A session file, or a folder of them, that your own agent saved.'],
      ['Adapter', 'Pick the converter for that tool\'s format, or let TraceHarness detect it. Inspect shows what it found before anything is written.'],
      ['Ledger', 'Each session becomes one run, one span per action; what the file lacks is marked unknown.'],
      ['Folder', 'A dataset folder like any other, with a provenance record beside it.'],
    ]
  }
  return [
    ['Source', 'Your own coding-agent sessions on this computer.'],
    ['Adapter', 'Each session file is read back as a run by the importer for its agent.'],
    ['Ledger', 'The same spans as any import.'],
    ['Folder', 'Private: hidden from every listing and left out of every export.'],
  ]
}

export function waySay(way, d) {
  const imp = d.import
  if (way === 'sample') return `Public sample: ${fmt.int(imp.source_runs)} source runs → ${fmt.int(imp.drawn_tasks)} tasks drawn → ${fmt.int(imp.selected)} runs read → ${fmt.int(imp.written)} written, ${fmt.int(imp.skipped)} skipped.`
  if (way === 'runner') return `The runner: ${fmt.int(d.runner.runs)} runs written as the agents worked, with no adapter between, into the same folder shape.`
  if (way === 'files') return 'Import files: an adapter turns each session file into one run. Check one run before you import a hundred.'
  return 'Session capture: your own sessions, read back as runs, and kept private to this computer.'
}

function Box({ b, name, sub, lines, cls, i, extra }) {
  return (
    <g className={cx('rg-pipe-box', cls)} style={{ '--rig-fig-i': i }} {...extra}>
      <rect className="frame" x={b.x} y={b.y} width={b.w} height={b.h} rx="6" />
      <text className="t" x={b.x + 10} y={b.y + 19}>{name}</text>
      {sub && <text className="s" x={b.x + 10} y={b.y + 35}>{sub}</text>}
      {lines && lines.map(([words, tone, dim], k) => (
        <g key={words} className={cx('ln', dim && 'dim')} style={{ '--rig-fig-i': i + k / 2 + 1 }}>
          <rect className={cx('tick', tone)} x={b.x + 8} y={b.y + 34 + k * 17} width="4" height="11" rx="1" />
          <text className="m" x={b.x + 16} y={b.y + 43 + k * 17}>{words}</text>
        </g>
      ))}
    </g>
  )
}

function Pipe({ way, onWay, w, seen }) {
  const lay = pipeLayout(w)
  const links = pipeLinks(lay)
  const picked = WAYS.find((x) => x.id === way)
  return (
    <svg className={cx('rg-pipe-svg', seen && 'seen')} viewBox={`0 0 ${w} ${lay.h}`} width={w} height={lay.h} role="group"
      aria-label={`Four ways in: ${WAYS.map((x) => x.name).join(', ')}. The imports go through an adapter, the runner does not; all end in a ledger and a dataset folder. Shown: ${picked.name}.`}>
      {links.map((l) => {
        const on = l.ways.includes(way)
        return <path key={`${l.from.id}-${l.to.id}`} className={cx('rg-pipe-link', on ? 'on' : 'off')} d={curve(l.dir, l.from, l.to, l.at)} />
      })}
      {lay.ways.map((b, i) => {
        const x = WAYS[i]
        const on = x.id === way
        const go = () => { if (!on) onWay(x.id) }
        return (
          <Box key={x.id} b={b} i={i} name={x.name} sub={waySub(x, b)} cls={cx('way', on && 'on')}
            extra={{ role: 'button', tabIndex: 0, 'data-el': 'fig-way', 'data-way': x.id, 'aria-pressed': on, 'aria-disabled': on || undefined,
              'data-hint': on ? `${x.name} · shown` : `Follow ${x.name[0].toLowerCase()}${x.name.slice(1)}`,
              'aria-label': `${x.name}, ${x.sub}${on ? ': shown' : ': press to follow this way'}`, onClick: go, onKeyDown: onKeyPress(go) }} />
        )
      })}
      <Box b={lay.adapter} i={4} name="Adapter" sub={picked.adapter ? (way === 'sample' ? 'messages' : 'a converter') : 'not needed'} cls={cx('stage', !picked.adapter && 'skip')} />
      <Box b={lay.ledger} i={5} name="Ledger" lines={SPANS.map((s) => [s, s.replace('_', '-')])} cls="stage" />
      <Box b={lay.folder} i={6} name="Dataset folder" lines={FILES.map((f) => [f, 'file', f === 'provenance.json' && !picked.adapter])} cls="stage" />
    </svg>
  )
}

function ImportPipeline({ fig, n, d }) {
  const reveal = useReveal()
  const [boxRef, w] = useWidth(560)
  const [way, setWay] = useState('sample')
  const steps = waySteps(way, d)
  const imp = d.import, run = d.runner
  const span = (s, k) => fmt.int(s[k] || 0)
  return (
    <FigureCard fig={fig} n={n} reveal={reveal}
      legend={[{ label: 'the way picked: its path flows', tone: 'fa-path' }, { label: 'the other ways', tone: 'fa-path-off' }]}
      chart={(
        <div ref={boxRef}>
          <Pipe way={way} onWay={setWay} w={w} seen={reveal.seen} />
          <ol className="rg-pipe-steps" data-el="fig-pipe-steps" key={way} aria-label={`${WAYS.find((x) => x.id === way).name}, step by step`}>
            {steps.map(([k, words]) => <li key={k}><b>{k}</b><span>{words}</span></li>)}
          </ol>
        </div>
      )}
      readout={waySay(way, d)}
      table={<FigTable caption={`Figure ${n} as a table: the two ways a bundled dataset came in`} cols={['', `Public sample: ${imp.dataset}`, `The runner: ${run.dataset}`]}
        rows={[
          ['source runs', fmt.int(imp.source_runs), '—'],
          ['source tasks', `${fmt.int(imp.source_tasks)} (${fmt.int(imp.tasks_3plus)} with 3+ runs)`, '—'],
          ['tasks', `${fmt.int(imp.drawn_tasks)} drawn, seed ${imp.seed}`, fmt.int(run.tasks)],
          ['runs read', fmt.int(imp.selected), '—'],
          ['runs written', fmt.int(imp.written), fmt.int(run.runs)],
          ['runs skipped', fmt.int(imp.skipped), '—'],
          ['adapter', imp.adapter, 'none'],
          ...SPANS.map((k) => [`${k} spans`, span(imp.spans, k), span(run.spans, k)]),
          ['files per run', Object.keys(imp.files).join(', '), Object.keys(run.files).join(', ')],
          ['provenance.json', `revision ${imp.revision}, ${imp.licence}, fetched ${imp.fetched}`, 'none: made here'],
        ]} />} />
  )
}

function Preview() {
  return (
    <g className="rg-prev-pipe">
      {[6, 18, 30, 42].map((y, i) => <rect key={y} className={i === 1 ? 'acc' : ''} x="4" y={y} width="26" height="9" rx="2" />)}
      {[6, 18, 30].map((y) => <path key={y} d={`M30,${y + 4.5} C40,${y + 4.5} 40,28 50,28`} />)}
      <path d="M30,46.5 C60,46.5 60,36 74,36" />
      <path d="M66,28 L74,28 M98,30 L104,30" />
      <rect x="50" y="22" width="16" height="12" rx="2" /><rect x="74" y="16" width="24" height="28" rx="2" /><rect x="104" y="16" width="12" height="28" rx="2" />
    </g>
  )
}

/** The numbers the article quotes, as this figure draws them. */
export function headlines(d) {
  const imp = d.import
  return {
    source_runs: fmt.int(imp.source_runs), source_tasks: fmt.int(imp.source_tasks), tasks_3plus: fmt.int(imp.tasks_3plus),
    drawn: fmt.int(imp.drawn_tasks), selected: fmt.int(imp.selected), written: fmt.int(imp.written), skipped: fmt.int(imp.skipped),
    runner_runs: fmt.int(d.runner.runs),
  }
}

export const KINDS = { import_pipeline: { Figure: ImportPipeline, Preview, headlines } }
