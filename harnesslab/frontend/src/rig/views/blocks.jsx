/* Rig · views/blocks.jsx — build a harness from blocks and run it.
   A live model needs a key typed into this page. The key stays in component
   state and is sent only on Run. It is not written into the tab store. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api, IS_MEMBER } from '../../api'
import { requireStored } from '../../member-api'
import { Btn, Empty, ErrorState, Go, Loading, Note, Tag } from '../ui'
import { EvidenceOrigin, evidenceOrigin, withEvidenceOrigin } from '../shallowEvidence'
import { blocksFromHarness, readDraft, wizardBlocks, writeDraft } from './shallow-drafts'

const TYPE_LABEL = {
  prompt: 'Prompt',
  tools: 'Tools',
  policy: 'Permission',
  context: 'Context',
  stop: 'Stop',
  sampling: 'Sampling',
  listing: 'File list',
}

const CUSTOMIZE_TYPES = ['prompt', 'tools', 'policy', 'context', 'stop', 'sampling', 'listing']

function fresh(type, tools) {
  if (type === 'prompt') return { type, text: 'You are an autonomous software engineer. Inspect, edit, verify, then call submit.' }
  if (type === 'tools') return { type, names: ['list_files', 'read_file', 'edit_file', 'run_tests', 'submit'] }
  if (type === 'policy') return { type, mode: 'strict' }
  if (type === 'context') return { type, window: 0, observation_chars: 6000 }
  if (type === 'stop') return { type, max_steps: 12, max_total_tokens: 400000 }
  if (type === 'sampling') return { type, temperature: 0, max_tokens_per_call: 2048 }
  return { type, include: true, _tools: tools }
}

function readCustomizeBlocks(tools, restoreDraft = true) {
  const stored = (restoreDraft && readDraft('customize-draft')) || readDraft('customize') || (IS_MEMBER ? wizardBlocks() : null)
  const usable = Array.isArray(stored) && stored.every((block) => (
    block && typeof block === 'object' && !Array.isArray(block) && typeof block.type === 'string'
  ))
  if (!usable) return CUSTOMIZE_TYPES.map((type) => fresh(type, tools))
  return stored.map((block) => ({
    ...block,
    names: Array.isArray(block.names) ? block.names.filter((name) => typeof name === 'string') : block.names,
  }))
}

function BlockCard({ block, index, count, tools, onChange, onMove, onRemove }) {
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
    <article className="rg-pnl" data-el="harness-block">
      <div className="rg-pnl-h">
        <span className="rg-lbl">{index + 1} · {TYPE_LABEL[block.type] || block.type}</span>
        <span className="rg-row">
          <button ref={(node) => { moveButtons.current.up = node }} type="button" className="rg-btn ghost" disabled={index === 0} onClick={() => { focusAfterMove.current = 'up'; onMove(index, -1) }} aria-label="Move block up">Up</button>
          <button ref={(node) => { moveButtons.current.down = node }} type="button" className="rg-btn ghost" disabled={index === count - 1} onClick={() => { focusAfterMove.current = 'down'; onMove(index, 1) }} aria-label="Move block down">Down</button>
          {!IS_MEMBER && <button type="button" className="rg-btn ghost" onClick={() => onRemove(index)}>Remove</button>}
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
  const customize = IS_MEMBER || (Array.isArray(args) && args[0] === 'customize')
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
  const [library, setLibrary] = useState([])
  const [selected, setSelected] = useState('')
  const [libraryQuery, setLibraryQuery] = useState('')
  const [unconfirmed, setUnconfirmed] = useState([])
  const [saved, setSaved] = useState('')
  const [storageError, setStorageError] = useState('')
  const [revision, setRevision] = useState(0)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [restored, setRestored] = useState(() => readDraft('customize-draft') !== null)
  const [accountLoaded, setAccountLoaded] = useState(!IS_MEMBER)
  const blockKeys = useRef(new WeakMap())
  const nextBlockKey = useRef(0)
  const blockKey = (block) => {
    if (!blockKeys.current.has(block)) blockKeys.current.set(block, ++nextBlockKey.current)
    return blockKeys.current.get(block)
  }

  useEffect(() => {
    let live = true
    setLoadError(null)
    if (IS_MEMBER) setAccountLoaded(false)
    const loads = IS_MEMBER ? [api('/shallow/catalog'), api('/shallow/harnesses')]
      : customize ? [api('/blocks/palette')] : [api('/blocks/catalog'), api('/blocks/palette')]
    Promise.all(loads).then((rows) => {
      if (!live) return
      if (IS_MEMBER) {
        const names = [...new Set(rows[0].harnesses.flatMap((row) => row.tools))]
        setTools(names)
        setTypes(CUSTOMIZE_TYPES)
        setBlocks(readCustomizeBlocks(names))
        setLibrary(rows[1].harnesses.filter((row) => row.lane === 'minimal'))
        setUnconfirmed(rows[1].unconfirmed || [])
        setAccountLoaded(rows[1].loaded === true)
        return
      }
      const pal = customize ? rows[0] : rows[1]
      if (!customize) setCatalog(rows[0].harnesses)
      setTools(pal.tools)
      setTypes(pal.types)
      if (!customize) {
        setBlocks(pal.blank)
        return
      }
      setBlocks(readCustomizeBlocks(pal.tools))
    }).catch((e) => { if (live) setLoadError(e) })
    return () => { live = false }
  }, [customize, revision])

  useEffect(() => {
    if (customize && blocks) setStorageError(writeDraft('customize-draft', blocks))
    setSaved('')
  }, [customize, blocks])

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
  function resetToWizard() {
    setBlocks(readCustomizeBlocks(tools, false))
    setPreset('')
    setJob(null)
    setError('')
    setRestored(false)
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
    const controller = new AbortController()
    setCompiled(null)
    const body = { blocks }
    if (preset && !customize) body.preset_id = preset
    const compile = () => api(IS_MEMBER ? '/shallow/compile' : '/blocks/compile', { method: 'POST', body, signal: controller.signal })
      .then((res) => { if (!cancel) setCompiled(res) })
      .catch((e) => { if (!cancel) setCompiled({ ok: false, errors: [String(e.message || e)], warnings: [] }) })
    const timer = IS_MEMBER ? setTimeout(compile, 180) : null
    if (!IS_MEMBER) compile()
    return () => { cancel = true; clearTimeout(timer); controller.abort() }
  }, [blocks, preset, customize, previewRevision])

  const liveModel = model !== 'mock' && !model.startsWith('mock')
  const missingKey = liveModel && !key.trim()
  const stackBroken = compiled && compiled.ok === false

  async function save() {
    if (!accountLoaded) return
    setBusy(true); setError(''); setSaved('')
    try {
      const result = requireStored(await api('/shallow/wizard', { method: 'POST', body: { blocks } }))
      setCompiled(result)
      setLibrary((cur) => [result.harness, ...cur.filter((row) => row.id !== result.harness.id)])
      setUnconfirmed((cur) => cur.filter((id) => id !== result.harness.id))
      setSelected(result.harness.id)
      setLibraryQuery('')
      setRestored(false)
      setSaved(`Saved ${result.harness.id} to your account.`)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function reopen() {
    setBusy(true); setError(''); setSaved('')
    try {
      const result = await api(`/shallow/harnesses/${encodeURIComponent(selected)}`)
      setBlocks(blocksFromHarness(result.harness))
      setPreset('')
      setRestored(false)
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

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

  if (loadError) return <><ErrorState error={loadError} what="The harness builder" onRetry={() => setRevision((n) => n + 1)} />{IS_MEMBER && <p><a href="/login">Account</a> · Sign back into the original account to keep working on its draft.</p>}</>
  if (!blocks) return <Loading label="Reading the harness catalog…" />
  const query = libraryQuery.trim().toLowerCase()
  const filteredLibrary = library.filter((row) => [row.id, row.prompt, row.policy, ...(row.tools || [])].join(' ').toLowerCase().includes(query))

  return (
    <div className="rg-dpad">
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">{IS_MEMBER ? 'Shallow · customize' : 'Runner · blocks'}</div>
          <h1>{customize ? 'Customize minimal harness' : 'Build a harness'}</h1>
          <p>{IS_MEMBER ? 'Edit the seven wizard blocks and save the harness to your account. MCP stays off. Previewing and saving do not run a model.' : 'Start from a common harness, or stack the blocks yourself. This lab runs the stack. A live model uses a key you paste here. The key is not saved.'}</p>
          {customize && (
            <div className="rg-row rg-wrap" data-el="minimal-customize-nav">
              <Go spec={withEvidenceOrigin('shallowWizard', evidenceOrigin(args))} className="rg-btn" el="back-to-wizard">Back to Minimal Wizard</Go>
              <button type="button" className="rg-btn" disabled={busy} data-el="reset-wizard-answers" onClick={resetToWizard}>Reset to Wizard Answers</button>
            </div>
          )}
        </div>
      </div>
      <EvidenceOrigin args={args} />
      {storageError && <p role="alert">{storageError}</p>}
      {IS_MEMBER && <div className="rg-pnl rg-pnl-b rg-col" data-el="member-harness-library">
        <label className="rg-fld">Find a saved harness
          <input type="search" className="rg-inp" value={libraryQuery} disabled={busy} onChange={(event) => { setLibraryQuery(event.target.value); setSelected('') }} placeholder="Prompt, content ID, tool, or policy" />
        </label>
        <p className="rg-small">Showing {filteredLibrary.length} of {library.length} saved minimal harnesses.</p>
        <label className="rg-fld">Saved minimal harnesses
          <select className="rg-selc" value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy}>
            <option value="">{filteredLibrary.length ? 'Choose a saved harness' : library.length ? 'No saved harness matches this search' : 'No minimal harnesses saved yet'}</option>
            {filteredLibrary.map((row) => <option key={row.id} value={row.id}>{(row.prompt || '').replace(/\s+/g, ' ').slice(0, 80)} · {row.policy} · {row.max_steps} steps · {row.id}{unconfirmed.includes(row.id) ? ' · storage unconfirmed' : ''}</option>)}
          </select>
        </label>
        <button type="button" className="rg-btn" disabled={!selected || busy} onClick={reopen}>Open selected harness</button>
        <p className="rg-small">Opening a saved harness replaces the draft shown below. Drafts stay in this workbench tab; the plain editor shares confirmed account saves only.</p>
        {unconfirmed.length > 0 && <p role="alert">Account storage has not confirmed every listed harness. Save again before relying on another browser or session.</p>}
      </div>}
      {IS_MEMBER && !accountLoaded && <p role="alert">Your saved account data has not loaded. Saving is unavailable. <button type="button" className="rg-btn" onClick={() => setRevision((n) => n + 1)}>Retry account data</button> <a href="/login">Account</a></p>}
      {IS_MEMBER && restored && <p role="status" className="rg-small">Restored the editor draft from this tab. Use Save to confirm it in your account, or Reset to Wizard Answers to discard these edits.</p>}
      {!customize && <div className="rg-row rg-wrap" data-el="harness-catalog">
        {(catalog || []).map((row) => (
          <button type="button" key={row.id} className={preset === row.id ? 'rg-btn pri' : 'rg-btn'} onClick={() => loadPreset(row.id)}>
            {row.name}
          </button>
        ))}
        <button type="button" className="rg-btn" onClick={() => { setPreset(''); setBasis(''); setModel('mock'); setJob(null) }}>Blank stack</button>
      </div>}
      {preset && basis && <Note>{basis}{catalog.find((r) => r.id === preset)?.same_loop_as?.length ? ` Same loop as ${catalog.find((r) => r.id === preset).same_loop_as.join(', ')}.` : ''}</Note>}
      <fieldset className="rg-col" disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {blocks.map((block, i) => (
          <BlockCard key={blockKey(block)} block={block} index={i} count={blocks.length} tools={tools} onChange={onChange} onMove={onMove} onRemove={onRemove} />
        ))}
        {blocks.length === 0 && <Empty title="No blocks yet.">Add a block, or start from a common harness.</Empty>}
      </fieldset>
      <div className="rg-row rg-wrap">
        {!IS_MEMBER && <label className="rg-fld">Add a block
          <select className="rg-selc" value="" disabled={busy} onChange={(e) => { if (e.target.value) { setBlocks((cur) => cur.concat([fresh(e.target.value, tools)])); setPreset('') } }}>
            <option value="">Choose</option>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
          </select>
        </label>}
        {!IS_MEMBER && <><label className="rg-fld">Model
          <input className="rg-inp" value={model} onChange={(e) => { setModel(e.target.value); setBasis('') }} spellCheck={false} />
        </label>
        <label className="rg-fld">Task
          <input className="rg-inp" value={task} onChange={(e) => setTask(e.target.value)} spellCheck={false} />
        </label>
        <label className="rg-fld">Your LLM key
          <input className="rg-inp" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={liveModel ? 'required for this model' : 'not used for mock'} />
        </label></>}
      </div>
      {IS_MEMBER ? <div className="rg-col">
        <button type="button" className="rg-btn pri" disabled={!accountLoaded || busy || !compiled?.ok} onClick={save}>{busy ? 'Saving…' : 'Save minimal harness'}</button>
        {compiled?.ok && <p className="rg-small">Cell {compiled.harness.id}</p>}
        {saved && <p role="status">{saved}</p>}
        <p className="rg-small">To execute a harness locally, start <code>python -m harnesslab --host 127.0.0.1 --port 8742</code> and open <a href="http://127.0.0.1:8742" target="_blank" rel="noreferrer">the local app</a>.</p>
      </div> : <div className="rg-row rg-wrap">
        <Btn className="pri" disabled={busy || !blocks.length || missingKey || stackBroken} why={missingKey ? 'Paste your own LLM key. The lab does not keep one for you.' : (stackBroken ? (compiled.errors || []).join(' ') : '')} onClick={run} data-el="harness-run">
          {busy ? 'Running…' : 'Run'}
        </Btn>
        {model === 'mock' && <Tag tone="dash">mock · no key</Tag>}
        {compiled && compiled.ok && <span className="rg-small rg-dim">Cell {customize ? `min_${compiled.hash}` : compiled.harness.id}</span>}
      </div>}
      {compiled && compiled.ok === false && <Note tone="bad"><span role="alert">{(compiled.errors || []).join(' ')}{IS_MEMBER && (compiled.errors || []).some((message) => message.includes('account changed')) && <> <a href="/login">Account</a></>}</span>{IS_MEMBER && <button type="button" className="rg-btn" onClick={() => setPreviewRevision((n) => n + 1)}>Retry preview</button>}</Note>}
      {compiled && (compiled.warnings || []).length > 0 && compiled.ok && (compiled.warnings || []).map((w) => <p key={w} className="rg-small">{w}</p>)}
      {error && <Note tone="bad" el="harness-error"><span role="alert">{error}{IS_MEMBER && error.includes('account changed') && <> <a href="/login">Account</a></>}</span></Note>}
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
    title: (args = []) => IS_MEMBER || args[0] === 'customize' ? 'Customize minimal harness' : 'Build a harness',
    crumbs: (args = []) => [
      ['Harnesses', withEvidenceOrigin('shallowCards', evidenceOrigin(args))],
      ...(IS_MEMBER || args[0] === 'customize' ? [['Minimal', withEvidenceOrigin('shallowWizard', evidenceOrigin(args))], ['Customize']] : [['Build']]),
    ],
    render: Blocks,
    palette: () => [{ title: 'Build a harness', detail: 'stack blocks and run them', spec: 'blocks', keywords: 'claude codex harness' }],
  },
}
