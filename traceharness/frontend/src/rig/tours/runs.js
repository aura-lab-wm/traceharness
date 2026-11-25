/* Rig · tours/runs.js — the page tours of Tasks, a task, all its runs step by step, Runs, a run, one event, Compare,
   Fork and the paused runs. PURE. Each walks its page top to bottom (pageTours.js says how a step is written). */
import { HEAD, jumpWords, unrecorded, when } from './words'

export const RUN_TOURS = {
  tasks: [
    { id: 'head', title: 'Tasks', spots: [[HEAD]], body: 'Every task of this dataset under the cell in the Asking line; Change switches it. The line under it counts the tasks that pass every run, flip, or never pass.' },
    { id: 'failed', title: 'How runs failed', spots: [['[data-el="tasks-failed"]']], body: 'The failed runs of this cell by how they failed.' },
    { id: 'filters', title: 'Narrow and sort', spots: [['[data-el="task-quick-filters"], [data-el="task-search"], [data-el="task-sort"]']], body: 'Chips, search, probe and failure filters narrow the list; Sort orders it, by largest spread too.' },
    { id: 'table', title: 'One row per task', spots: [['[data-el="task-outcome-table"]']],
      body: ({ q }) => `One box per run, coloured by outcome (the key is on top). A task name opens all its runs.${when(q, '[data-el="task-pages"]', ' The buttons under it page through the rest.')}` },
    { id: 'coverage', title: 'Which tasks count', spots: [['[data-el="repeat-coverage"]']], body: 'How many tasks have the two graded runs a flip needs.' },
  ],
  task: [
    { id: 'head', title: 'One task', spots: [['[data-el="task-heading"]']],
      body: ({ q }) => `The task, the cell its runs share${when(q, '[data-el="task-heading"] [data-el="failure-summary"]', ', and how they failed')}. The task button lists the cell’s other tasks.` },
    { id: 'runs', title: 'Its runs', spots: [['[data-el="attempt-strip"]']], body: 'One chip per run: outcome, model calls, tokens. After the tour, click one to select it.' },
    { id: 'axis', title: 'All runs on one axis', loaded: '[data-el="run-axis-row"]',
      spots: [['[data-el="run-axis"] .rg-traj-axis-h, [data-el="run-axis-row"]:nth-child(-n+3)']],
      body: ({ q }) => `Each run call by call, coloured by phase.${q.has('[data-el="run-axis"] [data-el="fix-marker"]') ? ' A dashed line marks the fix (a failed run’s last edit); hatched calls follow.' : ''}${q.has('[data-el="run-axis"] [data-el="lookup-tick"]') ? ' A tick marks the first lookup.' : ''} Step by step (all runs) lines them up.` },
    { id: 'tokens', title: 'Tokens', spots: [['[data-el="task-spread"], [data-el="task-tokens-line"]']],
      body: ({ q }) => (/not recorded/.test(q.text('[data-el="task-tokens-line"]')) ? 'Tokens are not recorded for these runs; below, each run’s model calls.'
        : `${/× the tokens/.test(q.text('[data-el="task-tokens-line"]')) ? 'The sentence names the costliest and cheapest run; below' : 'Below'}, each run's tokens by phase.`) },
    { id: 'run', title: 'The selected run', spots: [['[data-el="run-summary"]']],
      body: ({ q }) => `Its outcome and actions (Open run, Design a harness, Pin)${when(q, '[data-el="run-summary"] [data-el="failure-finding"]', ', then how it failed')}.` },
    { id: 'evidence', title: 'Its evidence', spots: [['[data-el="inv-tabs"]']], body: 'Tabs: findings, timeline, patch, messages, raw record.' },
  ],
  lanes: [
    { id: 'head', title: 'All runs, step by step', spots: [['[data-el="lanes-heading"]']], body: 'Every run of this task side by side. The task goes back to its page.' },
    { id: 'rule', title: 'How to read it', spots: [['[data-el="lanes-rule"]']], body: 'One lane per run; row k is step k of every run. Colours are phases, letters tool kinds. After the tour, j/k move in a lane, ←/→ across.' },
    // the first lane drawn (with many runs the view picks three, numbered by run, so it is not always lane 1)
    { id: 'lane', title: 'A lane', spots: [['.rg-ln-heads > [data-el="lane-head"]:first-child']],
      body: ({ q }) => `Outcome, model calls and tokens${/after|calls/.test(q.text('[data-el="lane-head"] [data-el="lane-after"]')) ? ', and the calls after the fix (hatched)' : ''}. After the tour, click its bar to open that step.` },
    { id: 'split', title: 'Where they part', loaded: '[data-el="lane-head"] [data-el="phase-band"]', spots: [['[data-el="lanes-split"]']], body: 'The first step where the runs stop doing the same thing.' },
  ],
  field: [
    { id: 'head', title: 'Runs', spots: [[HEAD]], body: 'Every run of this dataset, with how many there are.' },
    { id: 'filters', title: 'Filter', spots: [['[data-el="field-search"], [data-el="outcome-filter"], [data-el="failure-mode-filter"]']], body: 'The search box finds a run id, task, model, harness or exit; the menus pick a model or harness; the chips filter by outcome and by how runs failed.' },
    { id: 'totals', title: 'In scope', spots: [['[data-el="field-totals"]']],
      body: ({ q }) => `Pass, Fail, Cut off and Ungraded counts, and mean tokens.${unrecorded(q, '[data-el="field-totals"]')}` },
    { id: 'table', title: 'One row per run', spots: [['[data-el="field-run-list"] table']], body: 'A run id opens the run; a task name opens all its runs.' },
  ],
  run: [
    { id: 'head', title: 'A run', spots: [['[data-el="run-heading"] .rg-run-top, [data-el="run-meta"]']],
      body: ({ q }) => `Task, outcome, model, harness and which run this is.${q.has('[data-el="compare-primary"]') ? ' Compare puts it beside another run.' : ''}` },
    { id: 'numbers', title: 'Its numbers', spots: [['[data-el="run-numbers"]']],
      body: ({ q }) => `Steps or model calls, tokens, cost, wall time${q.has('[data-el="run-after-fix"]') ? ', work after the fix' : ''}.${unrecorded(q, '[data-el="run-numbers"]')}` },
    { id: 'band', title: 'Step by step', spots: [['[data-el="run-band"]']],
      // the marker is the fix, or a failed run's last edit: said in the words of its own button
      body: ({ q }) => `Every step coloured by phase.${q.has('[data-el="run-band"] [data-el="fix-marker"]') ? ` The dashed line marks ${jumpWords(q) || 'the fix'}; hatched steps follow.` : ''}${q.has('[data-el="jump-to-fix"]') ? ` “Jump to ${jumpWords(q)}” opens that step.` : ''}${when(q, '[data-el="run-heading"] [data-el="failure-finding"]', ' Under it, how it failed.')}` },
    { id: 'steps', title: 'Steps', spots: [['.rg-cx-stepcol']], body: 'One row per step, grouped between edits; above it, a step finder and layers. After the tour, click one to open it.' },
    { id: 'detail', title: 'The selected step', spots: [['[data-el="step-detail"]', '.rg-cx-st.cur']], body: 'Its reply, what its tool returned, then what the model was sent.' },
    { id: 'record', title: 'The harness it ran', spots: [['[data-el="harness-json"]']], body: 'Its harness configuration as JSON, to view, copy or download.' },
  ],
  span: [
    { id: 'head', title: 'One event', spots: [['[data-el="span-heading"] .rg-ph-main']], body: 'An event of a run: the step it belongs to, the run, and where it sits in the run’s ledger.' },
    { id: 'numbers', title: 'Its numbers', loaded: '[data-el="span-detail"]', spots: [['[data-el="span-numbers"]']],
      body: ({ q }) => `${/Tokens/.test(q.text('[data-el="span-numbers"]')) ? 'Tokens in and out, cost, duration and why the reply ended.' : 'The tool, its status and how long it took.'}${unrecorded(q, '[data-el="span-numbers"]')}` },
    { id: 'actions', title: 'Move and keep', spots: [['[data-el="step-actions"]']], body: 'Buttons to the steps and events around it, to design a harness from it, and to pin it to the case file.' },
    { id: 'detail', title: 'The event', spots: [['[data-el="span-detail"]']], body: 'Which kinds of event this ledger holds, then everything this one recorded.' },
    { id: 'events', title: 'All events', spots: [['[data-tour="span-events"]']], body: 'Every event of the run in order; the marked row is this one, and any other opens in its place.' },
  ],
  cmp: [
    { id: 'head', title: 'Two runs', spots: [['[data-el="cmp-heading"]']], body: 'Two runs of one task; the line under the title names both.' },
    { id: 'pair', title: 'Pair class', spots: [['[data-el="pair-class"]']], body: 'How the two runs are related; its (i) explains each class.' },
    { id: 'heads', title: 'A and B', spots: [['[data-el="pair-headers"]']], body: 'Each run\'s outcome and numbers, A left, B right.' },
    { id: 'tabs', title: 'Steps or patches', spots: [['[data-el="cmp-tabs"]']], body: 'Aligned steps lines the runs up; Patch diff shows both patches.' },
    { id: 'divergence', title: 'First divergence', loaded: '[data-el="cmp-tabs"]', spots: [['[data-el="divergence"]']], body: 'The first step where the runs differ, and how.' },
  ],
  cmpPick: [
    { id: 'head', title: 'Compare two runs', spots: [[HEAD]], body: 'Two runs side by side, from the runs pinned in your case file: where their recorded actions first differ.' },
    { id: 'pick', title: 'The pair', spots: [['[data-tour="pair-pick"], [data-el="pair-class"] [data-el="empty-state"]']],
      body: ({ q }) => (q.has('[data-tour="pair-pick"]') ? 'Your pinned runs: with two ticked, Compare opens them side by side.'
        : 'No run is pinned yet. Its buttons open every run of the dataset and the case file; any run page also has a Compare button.') },
  ],
  fork: [
    { id: 'head', title: 'Fork a run', spots: [['[data-el="fork-step"] > .rg-traj-stack-s']], body: 'A proposed tool, not built yet: change one event of a run and run the rest live. Nothing here runs or is sent anywhere.' },
    { id: 'events', title: 'Pick the event', spots: [['[data-tour="fork-events"]']], body: 'The run’s events: the one marked edit here would change, and the ones after it would be dropped.' },
    { id: 'change', title: 'The change', spots: [['[data-tour="fork-change"]']], body: 'The event as recorded, the change (tool, arguments, drop or a new step), the harness, model and runs to continue with.' },
    { id: 'unavailable', title: 'What runs instead', spots: [['[data-el="fork-unavailable"]']], body: 'Why it cannot run yet, and the closest real steps: compare with another run, plan new runs, or open the event.' },
  ],
  paused: [
    { id: 'head', title: 'Runs waiting for you', spots: [[HEAD]], body: 'Runs that a harness with pause has stopped before a tool call.' },
    { id: 'what', title: 'What you can do', spots: [['[data-tour="paused-lede"]']], body: 'For each: approve, deny, edit one call’s arguments, send the agent a message, or stop the run.' },
    { id: 'list', title: 'Waiting now', spots: [['[data-el="paused-runs"], [data-el="paused-empty"]']],
      body: ({ q }) => (q.has('[data-el="paused-runs"]') ? 'Each paused run with its pending calls and the buttons that decide them.' : 'No run is waiting now; a paused run shows up here.') },
  ],
}
