import { useEffect, useState } from 'react'
import { useRig } from './context'
import { IS_MEMBER } from '../member-api'
import { runnerRequest, runnerCatalog } from '../runner-api'
import { GUIDE_TOPICS, guidanceFor } from './guidance'
import './getting-started.css'

export default function NavigationBuddy({ ctx = {} }) {
  const rig = useRig()
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState(null)
  const [asked, setAsked] = useState(false)
  const [catalog, setCatalog] = useState(null), [catalogState, setCatalogState] = useState('unknown'), [revision, setRevision] = useState(0)
  const executionTopic = IS_MEMBER && ['matrix', 'native', 'cancel', 'tasks', 'model', 'billing', 'harness'].includes(answer?.id)
  useEffect(() => {
    if (!executionTopic) return
    const controller = new AbortController(); let live = true
    setCatalog(null); setCatalogState('loading')
    runnerRequest('/catalog', { signal: controller.signal }).then(data => {
      if (!live) return
      setCatalog(runnerCatalog(data)); setCatalogState('checked')
    }).catch(() => { if (live) setCatalogState('unknown') })
    return () => { live = false; controller.abort() }
  }, [executionTopic, revision])
  const show = topic => { setAnswer(topic); setAsked(true) }
  return <section className="rg-guide" aria-label="TraceHarness navigation help">
    <span className="rg-guide-eyebrow">BUDDY / WORKFLOW GUIDE</span>
    <h2>What would you like to do?</h2>
    <p className="rg-small rg-dim">Ask how, check what is supported, or choose a workflow. Guidance stays in this browser; no model calls or charges.</p>
    <form onSubmit={event => { event.preventDefault(); show(guidanceFor(question)) }}>
      <label className="rg-fld"><span>Your question</span><textarea className="rg-inp" rows={3} maxLength={1000} aria-label="Ask Buddy how to use TraceHarness" placeholder="How do I edit the full harness JSON?" value={question} onChange={event => setQuestion(event.target.value)} /></label>
      <button type="submit" className="rg-btn pri" disabled={!question.trim()}>Show me how</button>
    </form>
    {asked && <section className="rg-guide-answer" aria-label="Buddy guidance" aria-live="polite">
      {answer ? <>
        <span className="rg-guide-eyebrow">{answer.local ? 'REQUIRES THE LOCAL WORKBENCH' : 'DOCUMENTED WORKFLOW · CHECK PREREQUISITES'}</span>
        <h3>{answer.title}</h3>
        {executionTopic && <section className="rg-guide-note" aria-label="Live runner check" aria-live="polite">
          {catalogState === 'loading' ? <p>Checking the current runner catalog…</p>
            : catalogState !== 'checked' ? <p>Runner availability is unconfirmed. The steps below describe the workflow; they do not confirm this configuration can run.</p>
              : !catalog.execution_available ? <p>Hosted execution is unavailable right now. You can still inspect configurations. Recheck the service before dispatch.</p>
                : <p>Hosted runner connected · {catalog.runtimes.filter(r => r.available).length} runtimes · {catalog.models.length} models · {catalog.tasks.filter(t => t.ready).length} registered ready tasks. Check the exact runtime/model/task pair and obtain fresh review before starting.</p>}
          <button type="button" className="rg-btn" disabled={catalogState === 'loading'} onClick={() => setRevision(value => value + 1)}>Recheck runner</button>
        </section>}
        <ol>{answer.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <p className="rg-guide-note">{answer.note}</p>
        <button type="button" className="rg-btn" onClick={() => rig.showGuidance?.(answer, ctx)}>{answer.label}</button>
      </> : <><h3>I can’t reliably map that to a supported workflow.</h3><p>Choose a topic below or ask about a specific control. I won’t claim an unlisted action is available.</p></>}
    </section>}
    <details className="rg-guide-topics" open={!asked}><summary>Browse supported workflows</summary><div>{GUIDE_TOPICS.map(topic => <button type="button" className="rg-btn" key={topic.id} onClick={() => show(topic)}>{topic.title}</button>)}</div></details>
  </section>
}
