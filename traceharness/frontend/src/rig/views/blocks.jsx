/* Rig · views/blocks.jsx — build a harness from blocks and run it.
   A live model needs a key typed into this page. The key stays in component
   state and is sent only on Run. It is not written into the tab store.
   Build keeps its own editor (blocks can be added and removed) and its own launcher. Customize
   (blocks:customize, the Minimal harness's way on) opens One run › Advanced settings, the one editor
   of the seven blocks. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { HarnessJson } from '../HarnessJson'
import { Btn, Empty, ErrorState, Icon, Loading, Note, PageHeader, Tag } from '../ui'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { blocksFromHarness } from './shallow-drafts'
import { HarnessNav, HarnessSummary, NumericField, focusWorkspaceSection } from '../harnessWorkspace'
import { NUMBER_FIELDS, fieldIssues } from '../harnessFields'
import { HarnessComposer } from './harness-composer'
import './blocks.css'
import { standInName } from '../harnessNames'

const TYPE_LABEL = {
  prompt: 'Prompt',
  tools: 'Tools',
  policy: 'Permission',
  context: 'Context',
  stop: 'Stop',
  sampling: 'Sampling',
  listing: 'File list',
}

function fresh(type, tools) {
  if (type === 'prompt') return { type, text: 'You are an autonomous software engineer. Inspect, edit, verify, then call submit.' }
  if (type === 'tools') return { type, names: ['list_files', 'read_file', 'edit_file', 'run_tests', 'submit'] }
  if (type === 'policy') return { type, mode: 'strict' }
  if (type === 'context') return { type, window: 0, observation_chars: 6000 }
  if (type === 'stop') return { type, max_steps: 12, max_total_tokens: 400000 }
  if (type === 'sampling') return { type, temperature: 0, max_tokens_per_call: 2048 }
  return { type, include: true, _tools: tools }
}

export function BlockCard({ block, index, number = index + 1, count, tools, onChange, onMove, onRemove, allowRemove = true, first = index === 0, last = index === count - 1 }) {
  const set = (patch) => onChange(index, { ...block, ...patch })
  const moveButtons = useRef({})
  const focusAfterMove = useRef(null)
  useLayoutEffect(() => {
    const direction = focusAfterMove.current
    if (!direction) return
    const requested = moveButtons.current[direction]
    const target = requested?.disabled ? moveButtons.current[direction === 'up' ? 'down' : 'up'] : requested
    target?.focus()
    focusAfterMove.current = null
  }, [index])
  return (
    <article className="rg-pnl" data-el="harness-block" data-block-type={block.type}>
      <div className="rg-pnl-h rg-blk-h">
        <span className="rg-lbl rg-blk-t">{number == null ? '' : `${number} · `}{TYPE_LABEL[block.type] || block.type}</span>
        <span className="rg-blk-acts">
          <button ref={(node) => { moveButtons.current.up = node }} type="button" className="rg-btn ghost rg-blk-ico" disabled={first} onClick={() => { focusAfterMove.current = 'up'; onMove(index, -1) }} aria-label="Move block up" data-hint={first ? 'First block' : 'Move up'}><Icon name="up" size={16} /></button>
          <button ref={(node) => { moveButtons.current.down = node }} type="button" className="rg-btn ghost rg-blk-ico" disabled={last} onClick={() => { focusAfterMove.current = 'down'; onMove(index, 1) }} aria-label="Move block down" data-hint={last ? 'Last block' : 'Move down'}><Icon name="chev" size={16} /></button>
          {allowRemove && <button type="button" className="rg-btn ghost rg-blk-ico rg-blk-rm" onClick={() => onRemove(index)} aria-label="Remove" data-hint="Remove block"><Icon name="x" size={16} /></button>}
        </span>
      </div>
      <div className="rg-pnl-b rg-col">
        {block.type === 'prompt' && (
          <label className="rg-fld">Prompt
            <textarea className="rg-inp" rows={5} value={block.text || ''} onChange={(e) => set({ text: e.target.value })} />
          </label>
        )}
        {block.type === 'tools' && (
          <div className="rg-row rg-wrap" role="group" aria-label="Tools">
            {tools.map((name) => (
              <label key={name} className="rg-row rg-blk-opt">
                <input type="checkbox" checked={(block.names || []).includes(name)} onChange={(e) => {
                  const cur = new Set(block.names || [])
                  if (e.target.checked) cur.add(name)
                  else cur.delete(name)
                  set({ names: tools.filter((t) => cur.has(t)) })
                }} />
                <span>{name}</span>
              </label>
            ))}
          </div>
        )}
        {block.type === 'policy' && (
          <label className="rg-fld">Mode
            <select className="rg-selc" value={block.mode} onChange={(e) => set({ mode: e.target.value })}>
              <option value="strict">strict — block a flagged command</option>
              <option value="permissive">permissive — record it and let some through</option>
            </select>
          </label>
        )}
        {NUMBER_FIELDS[block.type] && <div className="rg-row rg-wrap">
          {NUMBER_FIELDS[block.type].map((field) => <NumericField key={field.key} field={field} value={block[field.key]} onChange={(value) => set({ [field.key]: value })} />)}
        </div>}
        {block.type === 'listing' && (
          <label className="rg-row rg-blk-opt">
            <input type="checkbox" checked={!!block.include} onChange={(e) => set({ include: e.target.checked })} />
            <span>Show the repository file list in the first message</span>
          </label>
        )}
      </div>
    </article>
  )
}

function Blocks({ args } = {}) {
  const summaryRef = useRef(null)
  const editorRef = useRef(null)
  const [catalog, setCatalog] = useState(null)
  const [tools, setTools] = useState([])
  const [types, setTypes] = useState([])
  const [blocks, setBlocks] = useState(null)
  const [blank, setBlank] = useState([])
  const [cleared, setCleared] = useState(null)
  const [preset, setPreset] = useState('')
  const [model, setModel] = useState('mock')
  const [basis, setBasis] = useState('')
  const [task, setTask] = useState('t01_slugify')
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [compiled, setCompiled] = useState(null)
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [revision, setRevision] = useState(0)
  const blockKeys = useRef(new WeakMap())
  const nextBlockKey = useRef(0)
  const blockKey = (block) => {
    if (!blockKeys.current.has(block)) blockKeys.current.set(block, ++nextBlockKey.current)
    return blockKeys.current.get(block)
  }

  useEffect(() => {
    let live = true
    setLoadError(null)
    Promise.all([api('/blocks/catalog'), api('/blocks/palette')]).then(([cat, pal]) => {
      if (!live) return
      setCatalog(cat.harnesses)
      setTools(pal.tools)
      setTypes(pal.types)
      setBlank(pal.blank || [])
      setBlocks(pal.blank)
    }).catch((e) => { if (live) setLoadError(e) })
    return () => { live = false }
  }, [revision])
  // the "back to blank" note belongs to the stack it describes; any later edit clears it
  useEffect(() => { setCleared((note) => (note && blocks !== note.blocks ? null : note)) }, [blocks])

  function blankStack() {
    const next = blank.map((b) => ({ ...b, names: b.names ? [...b.names] : b.names }))
    setBlocks(next)
    setPreset(''); setBasis(''); setModel('mock'); setJob(null); setError('')
    setCleared({ blocks: next, text: `Back to the blank stack: the ${next.length} default blocks, no preset, model mock.` })
  }

  function loadPreset(id) {
    const row = (catalog || []).find((r) => r.id === id)
    if (!row) return
    setPreset(id)
    setBlocks(row.blocks.map((b) => ({ ...b, names: b.names ? [...b.names] : b.names })))
    setModel(row.default_model)
    setBasis(row.default_basis)
    setJob(null)
    setError('')
  }

  function onChange(index, next) {
    setBlocks((cur) => cur.map((b, i) => {
      if (i !== index) return b
      blockKeys.current.set(next, blockKey(b))
      return next
    }))
    setPreset('')
  }
  function onMove(index, dir) {
    setBlocks((cur) => {
      const next = cur.slice()
      const j = index + dir
      if (j < 0 || j >= next.length) return cur
      const [item] = next.splice(index, 1)
      next.splice(j, 0, item)
      return next
    })
  }
  function onRemove(index) {
    setBlocks((cur) => cur.filter((_, i) => i !== index))
    setPreset('')
  }

  useEffect(() => {
    if (!blocks || !blocks.length) {
      setCompiled(null)
      return
    }
    const issues = fieldIssues(blocks)
    if (issues.length) {
      setCompiled({ ok: false, errors: issues, warnings: [] })
      return
    }
    let cancel = false
    const controller = new AbortController()
    setCompiled(null)
    const body = { blocks }
    if (preset) body.preset_id = preset
    api('/blocks/compile', { method: 'POST', body, signal: controller.signal })
      .then((res) => { if (!cancel) setCompiled(res) })
      .catch((e) => { if (!cancel) setCompiled({ ok: false, errors: [String(e.message || e)], warnings: [] }) })
    return () => { cancel = true; controller.abort() }
  }, [blocks, preset])

  const liveModel = model !== 'mock' && !model.startsWith('mock')
  const missingKey = liveModel && !key.trim()
  const stackBroken = !compiled?.ok || (blocks && fieldIssues(blocks).length > 0)

  async function run() {
    setBusy(true)
    setError('')
    setJob(null)
    try {
      const body = { blocks, model, task, repeats: 1 }
      if (preset) body.preset_id = preset
      if (key.trim()) body.api_key = key.trim()
      const res = await api('/blocks/run', { method: 'POST', body })
      setJob(res)
      setKey('')
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <><ErrorState error={loadError} what="The harness builder" onRetry={() => setRevision((n) => n + 1)} /></>
  if (!blocks) return <Loading label="Reading the harness catalog…" />

  return (
    <div className="rg-dpad rg-harness" data-el="harness-builder">
      <HarnessNav active="custom" args={args} />
      <PageHeader title="Build a harness"
        subtitle="Start from a common harness, or stack the blocks yourself."
        lede="This lab runs the stack. A live model uses a key you paste here. The key is not saved." />
      <EvidenceOrigin args={args} />
      <div className="rg-row rg-wrap" data-el="harness-catalog" role="group" aria-labelledby="rg-blk-presets">
        <span className="rg-small rg-dim" id="rg-blk-presets">Start from a preset:</span>
        {(catalog || []).map((row) => (
          <button type="button" key={row.id} className={preset === row.id ? 'rg-btn pri' : 'rg-btn'} aria-pressed={preset === row.id} onClick={() => loadPreset(row.id)}>
            {standInName(row.name)}
          </button>
        ))}
        <span className="rg-small rg-dim">or</span>
        <button type="button" className="rg-btn" data-el="blank-stack" onClick={blankStack}>Blank stack</button>
        {cleared && <span className="rg-small" role="status" data-el="blank-stack-done">{cleared.text}</span>}
      </div>
      <p className="rg-small rg-mute" data-el="copy-not-app">The presets are TraceHarness copies of each app's loop. Your installed apps run from One run (“— your installed app”).</p>
      {preset && basis && <Note>{basis}{catalog.find((r) => r.id === preset)?.same_loop_as?.length ? ` Same loop as ${catalog.find((r) => r.id === preset).same_loop_as.join(', ')}.` : ''}</Note>}
      <div className="rg-harness-layout" data-panes>
      <div>
      <fieldset ref={editorRef} tabIndex={-1} className="rg-harness-blocks rg-blk-fs" aria-label="Harness blocks" data-tour="harness-blocks" disabled={busy}>
        {blocks.map((block, i) => (
          <BlockCard key={blockKey(block)} block={block} index={i} count={blocks.length} tools={tools} onChange={onChange} onMove={onMove} onRemove={onRemove} />
        ))}
        {blocks.length === 0 && <Empty title="No blocks yet.">Add a block, or start from a common harness.</Empty>}
      </fieldset>
      <div className="rg-row rg-wrap">
        <label className="rg-fld">Add a block
          <select className="rg-selc" value="" disabled={busy} onChange={(e) => { if (e.target.value) { setBlocks((cur) => cur.concat([fresh(e.target.value, tools)])); setPreset('') } }}>
            <option value="">Choose</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
          </select>
        </label>
        <label className="rg-fld">Model
          <input className="rg-inp" value={model} onChange={(e) => { setModel(e.target.value); setBasis('') }} spellCheck={false} />
        </label>
        <label className="rg-fld">Task
          <input className="rg-inp" value={task} onChange={(e) => setTask(e.target.value)} spellCheck={false} />
        </label>
        <label className="rg-fld">Your LLM key
          <input className="rg-inp" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={liveModel ? 'required for this model' : 'not used for mock'} />
        </label>
      </div>
      </div>
      <HarnessSummary blocks={compiled?.ok && compiled.harness ? blocksFromHarness(compiled.harness) : blocks} headingRef={summaryRef} title="Configuration preview">
      <button type="button" className="rg-btn" onClick={() => focusWorkspaceSection(editorRef)}>Back to blocks</button>
      {!compiled && blocks.length > 0 && <p role="status" className="rg-small">Checking configuration…</p>}
      <div className="rg-row rg-wrap">
        <Btn className="pri" disabled={busy || !blocks.length || missingKey || stackBroken} why={missingKey ? 'Paste your own LLM key. The lab does not keep one for you.' : (stackBroken ? (compiled?.errors || ['Checking configuration…']).join(' ') : '')} onClick={run} data-el="harness-run">
          {busy ? 'Running…' : 'Run'}
        </Btn>
        {model === 'mock' && <Tag tone="dash">mock · no key</Tag>}
        {compiled && compiled.ok && <span className="rg-small rg-dim">Cell {compiled.harness.id}</span>}
      </div>
      {compiled && compiled.ok === false && <Note tone="bad"><span role="alert">{(compiled.errors || []).join(' ')}</span></Note>}
      {compiled && (compiled.warnings || []).length > 0 && compiled.ok && (compiled.warnings || []).map((w) => <p key={w} className="rg-harness-warning">{w}</p>)}
      {error && <Note tone="bad" el="harness-error"><span role="alert">{error}</span></Note>}
      {job && (
        <div className="rg-pnl" data-el="harness-job">
          <div className="rg-pnl-h"><span className="rg-lbl">Run</span><span className="meta">{job.job.status}</span></div>
          <div className="rg-pnl-b rg-col">
            <p>Harness <b>{job.harness_id}</b> · model {job.model} · task {job.task}</p>
            <p className="rg-small rg-dim">Results directory {job.job.out}. The key from this run is not in this response.</p>
            {(job.warnings || []).map((w) => <p key={w} className="rg-small">{w}</p>)}
          </div>
        </div>
      )}
      <HarnessJson source="Current block draft" description="Every block and setting in this stack, with the compiled harness when valid."
        documents={[{ id: 'blocks', label: 'Block configuration', value: { blocks }, filename: 'harness-blocks.json' }, { id: 'compiled', label: 'Compiled harness', value: compiled?.ok ? compiled.harness : null, filename: 'compiled-harness.json' }]} />
      </HarnessSummary>
      </div>
    </div>
  )
}

/** blocks:customize is One run with Advanced settings open (the Customize page folded into it); a bare
 *  blocks is Build. */
function BlocksView({ args = [] }) {
  return Array.isArray(args) && args[0] === 'customize' ? <HarnessComposer args={args} /> : <Blocks args={args} />
}

export const views = {
  blocks: {
    tag: 'build',
    title: (args = []) => args[0] === 'customize' ? 'Harnesses' : 'Build a harness',
    crumbs: (args = []) => [
      ['Harnesses', withEvidenceOrigin('harnesses', evidenceOrigin(args))],
      ...(args[0] === 'customize' ? [['One run'], ['Advanced settings']] : [['Build a harness']]),
    ],
    render: BlocksView,
    palette: () => [{ title: 'Build a harness', detail: 'stack blocks and run them', spec: 'blocks', keywords: 'claude codex harness' }],
  },
}
