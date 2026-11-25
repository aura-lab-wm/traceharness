/* Rig · tours/places.js — the page tours of Home, Datasets, the Map, a dataset's Overview and Settings. PURE.
   Each tour walks its page top to bottom (pageTours.js says how a step is written). */
import { HEAD, unrecorded, when } from './words'

export const PLACE_TOURS = {
  start: [
    { id: 'head', title: 'Home', spots: [['[data-el="start-head"]']],
      body: ({ q }) => `What TraceHarness is for. Each count opens the datasets sorted by it; search (⌘K) finds any dataset, task, run or page.${when(q, '[data-el="start-questions"]', ' The questions open their answers.')}` },
    { id: 'facts', title: 'In focus', spots: [['[data-el="start-facts"]']], body: 'The dataset every page reads now. Each underlined name opens its page.' },
    { id: 'run', title: 'A run, phase by phase', spots: [['[data-el="start-run"]']],
      body: 'A real run in five phases; the dashed line is the fix, hatched is work after it. After the tour, pick a phase to see its calls.' },
    { id: 'here', title: 'You are here', spots: [['[data-el="start-you-are-here"]']],
      body: ({ q }) => `Learn's articles, filled as you read them here; each square opens one.${when(q, '[data-el="start-recent"]', ' Beside them, what you opened last.')}` },
    { id: 'cards', title: 'Three ways to start', spots: [['[data-el="start-cards"]']], body: 'See runs step by step, compare harnesses, or make one and run it.' },
    { id: 'datasets', title: 'Datasets', spots: [['[data-el="start-datasets"]']], body: 'The newest datasets; each opens its Overview.' },
  ],
  home: [
    { id: 'head', title: 'Datasets', spots: [['[data-el="home-head"]']], body: 'Every dataset on this computer. Add data, at the right, brings in your own runs: files, a public sample or sessions recorded here.' },
    { id: 'find', title: 'Find a dataset', spots: [['[data-el="dataset-search"], [data-el="dataset-filter"]']], body: 'The filter box and the chips narrow the list by name, model, harness or kind; the counts follow.' },
    { id: 'open', title: 'One row per dataset', spots: [['[data-el="dataset-list"] tbody tr:first-child']], body: 'Its kind, runs, tasks, models, harnesses, pass rate and last update. A name opens its Overview; ⌘ or Ctrl-click opens it beside this page.' },
    { id: 'more', title: 'Two folded notes', spots: [['[data-el~="harness-workflow"], [data-el="dataset-kind-about"]']], body: 'Three ways to design a harness from the evidence, and what recorded and mock datasets are. Each opens with a click.' },
  ],
  canvas: [
    { id: 'tools', title: 'The Map', spots: [['[data-tour="canvas-tools"]']], body: 'Datasets, models and conditions as one tree. + Note adds a note; −, +, fit and 1:1 zoom; the last count is the runs running now.' },
    { id: 'map', title: 'Three columns', spots: [['[data-tour="canvas-map"] .rg-ws-col']], body: ({ q }) => `Datasets, then the models of the selected one, then its conditions: that model under each harness, with pass@1${/[+−]\d[\d.]*pp/.test(q.text('[data-tour="canvas-map"]')) ? ' and its paired change against the baseline on the wires' : ''}. A click on a node selects it; a double click opens its page.` },
    { id: 'detail', title: 'The selected condition', spots: [['[data-el="canvas-detail"]']],
      body: ({ q }) => (q.has('[data-el="canvas-detail"] [data-el="empty-state"]') ? 'No condition is selected for this dataset; its buttons open the dataset or pick another.'
        : `Its runs, pass@1, pass^3, flip rate and cost per run${/paired Δ/.test(q.text('[data-el="canvas-detail"]')) ? ', its paired change against the baseline,' : ''} and buttons to open its runs, plan more or wire a comparison.`) },
  ],
  ds: [
    { id: 'head', title: 'Overview', spots: [['[data-el="dataset-head"]']], body: 'The scope of every number here: model, harness and the grading oracle. Change switches them everywhere; Explore the tasks lists every task.' },
    { id: 'stats', title: 'In numbers', spots: [['[data-el="overview-stats"]']],
      body: ({ q }) => `pass@1 of this cell${when(q, '[data-el="dataset-pass1"]', ' and of the whole dataset')}, tasks with mixed runs, tokens per run and runs whose visible and hidden grades differ.${unrecorded(q, '[data-el="overview-stats"]')}` },
    { id: 'findings', title: 'Findings', spots: [['[data-el="findings"]']], body: 'The most telling answers, problems first. Each row opens the runs behind it.' },
    { id: 'next', title: 'Where to look next', spots: [['[data-el="where-to-look-next"]']], body: 'Tasks of this cell, worst first; a task opens all its runs. The folded lines hold the rest.' },
    { id: 'models', title: 'Model performance', spots: [['[data-el="model-performance-table"]']], body: 'Each model under this harness, and its pass rate.' },
    { id: 'fails', title: 'How runs fail', spots: [['[data-el="failure-mode-summary"]']], body: 'How failed runs failed, here and in the whole dataset; a click opens it.' },
  ],
  settings: [
    { id: 'head', title: 'Settings', spots: [[HEAD]], body: 'What this console keeps, and the keys it can use. A key is needed only for Buddy and for live models.' },
    { id: 'look', title: 'Appearance', spots: [['[data-el="appearance"]']], body: 'The theme and colour-blind safe colours, for this browser.' },
    { id: 'paths', title: 'Paths in use', spots: [['[data-el="paths-in-use"]']], body: 'The folders and the address the server uses.' },
    { id: 'keys', title: 'Keys', spots: [['[data-el="buddy-settings"], [data-el="lab-key"]']], body: 'Buddy’s key, held in this browser, and the lab’s key, held by the server for live models and the judge. Each says whether it is set.' },
    { id: 'learning', title: 'Learning', spots: [['[data-el="student-lab-toggle"], [data-el="narrator-key"]']], body: 'Student Lab turns on the reading guide and lessons; the narrator’s key, held in this browser, calls a model from this page only.' },
    { id: 'agent', title: 'Agents and this console', spots: [['[data-el="agent-connect"], [data-el="about-console"]']], body: 'The commands that let Claude Code, Codex or any MCP client read the datasets, and the version of this console.' },
  ],
}
