/* Door 2. Six questions, recommended answer first. MCP stays off. */
import { useEffect, useState } from 'react'
import { Go } from '../ui'
import { QUESTIONS, blocksFromAnswers } from './shallow-data.js'

const STORAGE = "traceharness.shallow.customize"
const INITIAL = Object.fromEntries(QUESTIONS.map((row) => [row.id, row.recommended]))

function ShallowWizard() {
  const [answers, setAnswers] = useState(INITIAL)
  const blocks = blocksFromAnswers(answers)
  const tools = blocks.find((block) => block.type === "tools")
  const policy = blocks.find((block) => block.type === "policy")
  const context = blocks.find((block) => block.type === "context")
  const stop = blocks.find((block) => block.type === "stop")
  const matches = QUESTIONS.every((row) => answers[row.id] === INITIAL[row.id])
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE, JSON.stringify(blocksFromAnswers(answers))) } catch { /* private mode */ }
  }, [answers])
  return (
    <div className="rg-dpad" data-el="shallow-wizard">
      <div className="rg-dh">
        <div className="t">
          <div className="rg-eyebrow">Shallow · minimal</div>
          <h1>Minimal harness</h1>
          <p>Six questions. The recommended answer is already selected. This lane stays off the six-card comparison and off the vendor ladder. MCP is off.</p>
        </div>
      </div>
      <div className="rg-col">
        {QUESTIONS.map((row) => (
          <fieldset key={row.id} className="rg-pnl" data-question={row.id}>
            <div className="rg-pnl-h"><b>{row.prompt}</b></div>
            <div className="rg-pnl-b rg-col">
              {row.options.map(([value, label]) => (
                <label key={value} className="rg-row" data-mcp={row.id === "mcp" ? "none" : undefined}>
                  <input
                    type="radio"
                    name={row.id}
                    value={value}
                    checked={answers[row.id] === value}
                    onChange={() => {
                      if (row.id === "mcp" && value !== "none") return
                      setAnswers((cur) => ({ ...cur, [row.id]: value }))
                    }}
                  />
                  <span>{label}{value === row.recommended ? " Recommended." : ""}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="rg-small" data-el="wizard-summary">Tools {tools.names.join(", ")}. Policy {policy.mode}. History window {context.window}. Stop {stop.max_steps} steps. {matches ? "Matches min_099dc52e693e." : "The selection diverges from the recommended cell."}</p>
      {matches ? null : <button type="button" className="rg-btn" onClick={() => setAnswers(INITIAL)}>Reset to recommended</button>}
      <p className="rg-small">Network, privilege, secret access, and path escape are not a choice. They stay blocked.</p>
      <Go spec="blocks:customize" className="rg-btn pri" el="customize-spec">Customize</Go>
    </div>
  )
}

export const views = {
  shallowWizard: {
    tag: "min",
    title: () => "Minimal harness",
    render: ShallowWizard,
    palette: () => [{ title: "Minimal harness", detail: "six questions, recommended answers", spec: "shallowWizard" }],
  },
}
