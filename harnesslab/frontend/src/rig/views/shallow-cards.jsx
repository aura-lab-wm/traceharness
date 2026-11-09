/* Door 1. Six fixed cards. No request, no key, no storage. */
import { useState } from 'react'
import { CARDS, PERMISSION } from './shallow-data.js'

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
        {CARDS.map((row) => (
          <article key={row.id} className="rg-pnl" data-agent={row.id}>
            <div className="rg-pnl-h"><b>{row.name}</b><span className="meta">{row.cap_bytes} bytes · {row.max_steps} steps</span></div>
            <div className="rg-pnl-b rg-col">
              <p className="rg-small">{row.tools.join(" · ")}</p>
              <p className="rg-small">{PERMISSION}</p>
              <label className="rg-fld">Standing prompt
                <textarea className="rg-inp" value={prompts[row.id]} onChange={(e) => setPrompts((cur) => ({ ...cur, [row.id]: e.target.value }))} spellCheck={false} />
              </label>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export const views = {
  shallowCards: {
    tag: "six",
    title: () => "Fixed harnesses",
    render: ShallowCards,
    palette: () => [{ title: "Fixed harnesses", detail: "six shallow stand-ins", spec: "shallowCards", keywords: "claude codex qwen kimi grok" }],
  },
}
