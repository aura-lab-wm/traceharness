/* Same prompt on all six. Shells stay put. No request and no key. */
import { useState } from 'react'
import { CARDS } from './shallow-data.js'

function clipUtf8(text, capBytes) {
  const raw = new TextEncoder().encode(text)
  let cap = Number(capBytes)
  if (!Number.isFinite(cap) || cap < 0) cap = 0
  cap = Math.floor(cap)
  if (raw.length <= cap) return text
  const dec = new TextDecoder("utf-8", { fatal: true })
  let end = cap
  while (end > 0) {
    try { return dec.decode(raw.slice(0, end)) } catch { end -= 1 }
  }
  return ""
}

function ShallowApply() {
  const [prompt, setPrompt] = useState(CARDS[0].prompt)
  const [applied, setApplied] = useState(CARDS[0].prompt)
  return (
    <div className="rg-dpad" data-el="shallow-apply">
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">Shallow · same change</div>
          <h1>One prompt, six shells</h1>
          <p>The prompt is the only thing this change edits. Each harness keeps its own tools, permission rule, stop, and byte cap. These cells stay off the vendor ladder.</p>
        </div>
      </div>
      <label className="rg-fld">Prompt applied to all six
        <textarea className="rg-inp" value={prompt} onChange={(e) => setPrompt(e.target.value)} spellCheck={false} />
      </label>
      <button type="button" className="rg-btn pri" onClick={() => setApplied(prompt)}>Apply to all six</button>
      {prompt !== applied ? <p className="rg-small">Unapplied edits</p> : null}
      <div className="rg-col">
        {CARDS.map((row) => {
          const shown = clipUtf8(applied, row.cap_bytes)
          const used = new TextEncoder().encode(shown).length
          const clipped = shown !== applied
          return (
            <article key={row.id} className="rg-pnl" data-el="apply-shell" data-agent={row.id}>
              <div className="rg-pnl-h"><b>{row.name}</b><span className="meta">{used} / {row.cap_bytes} bytes · {row.max_steps} steps · {row.policy}{clipped ? " · clipped" : ""}</span></div>
              <div className="rg-pnl-b rg-col">
                <p className="rg-small">{row.tools.join(" · ")}</p>
                <p className="rg-small">{shown}</p>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export const views = {
  shallowApply: {
    tag: "same",
    title: () => "One prompt, six shells",
    render: ShallowApply,
    palette: () => [{ title: "Same prompt on six harnesses", detail: "tools and caps stay", spec: "shallowApply" }],
  },
}
