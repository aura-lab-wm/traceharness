/* Rig · views/blocks.jsx — build a harness from blocks and run it.
   A live model needs a key typed into this page. The key stays in component
   state and is sent only on Run. It is not written into the tab store. */
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Btn, Empty, ErrorState, Loading, Note, Tag } from '../ui'

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

function BlockCard({ block, index, count, tools, onChange, onMove, onRemove }) {
  const set = (patch) => onChange(index, { ...block, ...patch })
  return (
    <article className="rg-pnl" data-el="harness-block">
      <div className="rg-pnl-h">
        <span className="rg-lbl">{index + 1} · {TYPE_LABEL[block.type] || block.type}</span>
        <span className="rg-row">
          <button type="button" className="rg-btn ghost" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label="Move block up">Up</button>
          <button type="button" className="rg-btn ghost" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label="Move block down">Down</button>
          <button type="button" className="rg-btn ghost" onClick={() => onRemove(index)}>Remove</button>
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
              <label key={name} className="rg-row" style={{ gap: 6 }}>
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
        {block.type === 'context' && (
          <div className="rg-row rg-wrap">
            <label className="rg-fld">Last observations kept (0 = full history)
              <input className="rg-inp" type="number" min={0} max={100} value={block.window} onChange={(e) => set({ window: Number(e.target.value) })} />
            </label>
            <label className="rg-fld">Observation characters
              <input className="rg-inp" type="number" min={200} max={50000} value={block.observation_chars} onChange={(e) => set({ observation_chars: Number(e.target.value) })} />
            </label>
          </div>
        )}
        {block.type === 'stop' && (
          <div className="rg-row rg-wrap">
            <label className="rg-fld">Step cap
              <input className="rg-inp" type="number" min={1} max={200} value={block.max_steps} onChange={(e) => set({ max_steps: Number(e.target.value) })} />
            </label>
            <label className="rg-fld">Token cap
              <input className="rg-inp" type="number" min={1000} max={2000000} value={block.max_total_tokens} onChange={(e) => set({ max_total_tokens: Number(e.target.value) })} />
            </label>
          </div>
        )}
        {block.type === 'sampling' && (
          <div className="rg-row rg-wrap">
            <label className="rg-fld">Temperature
              <input className="rg-inp" type="number" min={0} max={2} step={0.1} value={block.temperature} onChange={(e) => set({ temperature: Number(e.target.value) })} />
            </label>
            <label className="rg-fld">Tokens per call
              <input className="rg-inp" type="number" min={16} max={32000} value={block.max_tokens_per_call} onChange={(e) => set({ max_tokens_per_call: Number(e.target.value) })} />
            </label>
          </div>
        )}
        {block.type === 'listing' && (
          <label className="rg-row" style={{ gap: 6 }}>
            <input type="checkbox" checked={!!block.include} onChange={(e) => set({ include: e.target.checked })} />
            <span>Show the repository file list in the first message</span>
          </label>
        )}
      </div>
    </article>
  )
}

function Blocks({ args } = {}) {
  const customize = Array.isArray(args) && args[0] === 'customize'
  const [catalog, setCatalog] = useState(null)
  const [tools, setTools] = useState([])
  const [types, setTypes] = useState([])
  const [blocks, setBlocks] = useState(null)
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

  useEffect(() => {
    let live = true
    const loads = customize ? [api('/blocks/palette')] : [api('/blocks/catalog'), api('/blocks/palette')]
    Promise.all(loads).then((rows) => {
      if (!live) return
      const pal = customize ? rows[0] : rows[1]
      if (!customize) setCatalog(rows[0].harnesses)
      setTools(pal.tools)
      setTypes(pal.types)
      if (!customize) {
        setBlocks(pal.blank)
        return
      }
      let stored = null
      try {
        const raw = sessionStorage.getItem('traceharness.shallow.customize')
        stored = raw ? JSON.parse(raw) : null
      } catch { stored = null }
      if (Array.isArray(stored) && stored.length) setBlocks(stored)
      else setBlocks(['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing'].map((type) => fresh(type, pal.tools)))
    }).catch((e) => { if (live) setLoadError(e) })
    return () => { live = false }
  }, [customize])

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
    setBlocks((cur) => cur.map((b, i) => (i === index ? next : b)))
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
    let cancel = false
    const body = { blocks }
    if (preset && !customize) body.preset_id = preset
    api('/blocks/compile', { method: 'POST', body })
      .then((res) => { if (!cancel) setCompiled(res) })
      .catch((e) => { if (!cancel) setCompiled({ ok: false, errors: [String(e.message || e)], warnings: [] }) })
    return () => { cancel = true }
  }, [blocks, preset, customize])

  const liveModel = model !== 'mock' && !model.startsWith('mock')
  const missingKey = liveModel && !key.trim()
  const stackBroken = compiled && compiled.ok === false

  async function run() {
    setBusy(true)
    setError('')
    setJob(null)
    try {
      const body = { blocks, model, task, repeats: 1 }
      if (preset && !customize) body.preset_id = preset
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

  if (loadError) return <ErrorState error={loadError} what="The harness builder" />
  if (!blocks) return <Loading label="Reading the harness catalog…" />

  return (
    <div className="rg-dpad">
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">Runner · blocks</div>
          <h1>Build a harness</h1>
          <p>Start from a common harness, or stack the blocks yourself. This lab runs the stack. A live model uses a key you paste here. The key is not saved.</p>
        </div>
      </div>
      {!customize && <div className="rg-row rg-wrap" data-el="harness-catalog">
        {(catalog || []).map((row) => (
          <button type="button" key={row.id} className={preset === row.id ? 'rg-btn pri' : 'rg-btn'} onClick={() => loadPreset(row.id)}>
            {row.name}
          </button>
        ))}
        <button type="button" className="rg-btn" onClick={() => { setPreset(''); setBasis(''); setModel('mock'); setJob(null) }}>Blank stack</button>
      </div>}
      {preset && basis && <Note>{basis}{catalog.find((r) => r.id === preset)?.same_loop_as?.length ? ` Same loop as ${catalog.find((r) => r.id === preset).same_loop_as.join(', ')}.` : ''}</Note>}
      <div className="rg-col">
        {blocks.map((block, i) => (
          <BlockCard key={`${block.type}-${i}`} block={block} index={i} count={blocks.length} tools={tools} onChange={onChange} onMove={onMove} onRemove={onRemove} />
        ))}
        {blocks.length === 0 && <Empty title="No blocks yet.">Add a block, or start from a common harness.</Empty>}
      </div>
      <div className="rg-row rg-wrap">
        <label className="rg-fld">Add a block
          <select className="rg-selc" value="" onChange={(e) => { if (e.target.value) { setBlocks((cur) => cur.concat([fresh(e.target.value, tools)])); setPreset('') } }}>
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
      <div className="rg-row rg-wrap">
        <Btn className="pri" disabled={busy || !blocks.length || missingKey || stackBroken} why={missingKey ? 'Paste your own LLM key. The lab does not keep one for you.' : (stackBroken ? (compiled.errors || []).join(' ') : '')} onClick={run} data-el="harness-run">
          {busy ? 'Running…' : 'Run'}
        </Btn>
        {model === 'mock' && <Tag tone="dash">mock · no key</Tag>}
        {compiled && compiled.ok && <span className="rg-small rg-dim">Cell {customize ? `min_${compiled.hash}` : compiled.harness.id}</span>}
      </div>
      {compiled && compiled.ok === false && <Note tone="bad">{(compiled.errors || []).join(' ')}</Note>}
      {compiled && (compiled.warnings || []).length > 0 && compiled.ok && (compiled.warnings || []).map((w) => <p key={w} className="rg-small">{w}</p>)}
      {error && <Note tone="bad" el="harness-error">{error}</Note>}
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
    </div>
  )
}

export const views = {
  blocks: {
    tag: 'build',
    title: () => 'Build a harness',
    render: Blocks,
    palette: () => [{ title: 'Build a harness', detail: 'stack blocks and run them', spec: 'blocks', keywords: 'claude codex harness' }],
  },
}
