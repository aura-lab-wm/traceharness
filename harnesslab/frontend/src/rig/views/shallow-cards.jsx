/* Door 1. Six fixed cards. No request, no key, no storage. */
import { useState } from 'react'
import { CARDS, PERMISSION } from './shallow-data.js'

function utf8Size(text) {
  return new TextEncoder().encode(text).length
}

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

function ShallowCards() {
  const [prompts, setPrompts] = useState(() => Object.fromEntries(CARDS.map((row) => [row.id, row.prompt])))
  return (
    <div className="rg-dpad" data-el="shallow-cards">
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">Shallow · fixed</div>
          <h1>Fixed harnesses</h1>
          <p>Six stand-ins. A change on one card edits that prompt. The tool shell, the permission rule, the step cap, and the byte cap stay on the harness. Nothing on this screen is saved, and nothing here calls a model.</p>
        </div>
      </div>
      <div className="rg-col">
        {CARDS.map((row) => {
          const value = prompts[row.id]
          const used = utf8Size(value)
          const clipped = clipUtf8(value, row.cap_bytes)
          const dropsVerify = !clipped.includes("verify") || !clipped.includes("modify the tests")
          return (
            <article key={row.id} className="rg-pnl" data-agent={row.id}>
              <div className="rg-pnl-h"><b>{row.name}</b><span className="meta">{used} / {row.cap_bytes} bytes · {row.max_steps} steps</span></div>
              <div className="rg-pnl-b rg-col">
                <p className="rg-small">{row.tools.join(" · ")}</p>
                <p className="rg-small">{PERMISSION}</p>
                {used > row.cap_bytes || dropsVerify ? <p className="rg-small">This prompt is over the byte cap, or the clipped text drops verify and modify the tests.</p> : null}
                <label className="rg-fld">Standing prompt
                  <textarea className="rg-inp" value={value} onChange={(e) => setPrompts((cur) => ({ ...cur, [row.id]: e.target.value }))} spellCheck={false} />
                </label>
                {value !== row.prompt ? <button type="button" className="rg-btn" onClick={() => setPrompts((cur) => ({ ...cur, [row.id]: row.prompt }))}>Reset prompt</button> : null}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

export const views = {
  shallowCards: {
    tag: "six",
    title: () => "Fixed harnesses",
    render: ShallowCards,
    palette: () => [{ title: "Fixed harnesses", detail: "six shallow stand-ins", spec: "shallowCards", keywords: "claude codex qwen kimi grok agy antigravity" }],
  },
}
