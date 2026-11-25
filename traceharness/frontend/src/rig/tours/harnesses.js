/* Rig · tours/harnesses.js — the page tours of Harnesses: One run, Experiments, Recent runs, Configuration file,
   Saved versions, One run with Advanced settings, Minimal harness, Fixed harnesses, Build a harness and One prompt,
   six shells. PURE. Each walks its page top to bottom (pageTours.js says how a step is written). */
import { HEAD, when } from './words'

const VIEWS = { id: 'views', title: 'Views', spots: [['[data-el="harness-views"]']], body: 'One run, Experiments, Saved versions, Configuration file and Recent runs: one job each.' }
// on a phone the three lists fold into a summary with Edit selections
const PICK = { id: 'pick', title: 'Harness, model, task', spots: [['.rg-composer-selectors, .rg-composer-setup-summary']],
  body: ({ q }) => (q.has('.rg-composer-setup-summary') ? 'Three choices make a run. After the tour, Edit selections opens their lists.' : 'Three choices make a run. After the tour, pick each from its list.') }
const PROMPT = { id: 'prompt', title: 'Standing prompt', spots: [['[data-el="prompt-editor"]']],
  body: ({ q }) => `What the agent is told first. Edit prompt opens it${q.exists('[data-el="guide-me-questions"]') ? ', with Answer 6 questions and Advanced settings' : ''}.` }
const REVIEW = { id: 'review', title: 'Run configuration', spots: [['.rg-composer-review']],
  body: ({ q }) => `What will run. Review run checks it before anything starts.${q.has('[data-el="run-why"]') ? ' Before this can run lists what is missing.' : ''}` }
const CURRENT = { id: 'current', title: 'Current setup', spots: [['[data-el="current-setup"]']], body: 'The harness, model and task open now; Change it in One run goes back to them.' }
const RUNNER = '[data-el="experiments-unavailable"]'

export const HARNESS_TOURS = {
  harnesses: [
    { id: 'head', title: 'Harnesses', spots: [[HEAD]], body: 'Make a harness and run it on one task. The line under the title says whether the runner is ready.' },
    VIEWS, PICK, PROMPT, REVIEW,
    { id: 'json', title: 'Configuration JSON', spots: [['[data-el="edit-configuration-json"]']], body: 'The run’s configuration as JSON; it opens with a click.' },
  ],
  hExperiments: [
    { id: 'head', title: 'Experiments', spots: [[HEAD]], body: 'Many runs at once: harnesses × models × tasks, or prompt variants paired task by task.' },
    VIEWS, CURRENT,
    { id: 'matrix', title: 'Experiment matrix', spots: [['[data-tour="experiment-matrix"]']],
      body: ({ q }) => `The harnesses, models and tasks to cross, 1 to 64 arms, reviewed before anything starts.${when(q, `[data-tour="experiment-matrix"] ${RUNNER}`, ' It needs the local runner, not set up here.')}` },
    { id: 'paired', title: 'Paired experiments', spots: [['[data-tour="paired-experiments"]']], body: 'Prompt variants of one native harness: arms, schedule, review and freeze, run and results, and saved experiments.' },
  ],
  hRuns: [
    { id: 'head', title: 'Recent runs', spots: [[HEAD]], body: 'The runs started from this workspace.' },
    VIEWS,
    { id: 'list', title: 'The list', spots: [['[data-tour="recent-runs"]']], body: 'The runs started here in this server session, each also kept in Datasets; Refresh runs reads the list again.' },
  ],
  hFile: [
    { id: 'head', title: 'Configuration file', spots: [[HEAD]], body: 'The current harness as one file.' },
    VIEWS,
    { id: 'editor', title: 'Edit the JSON', spots: [['[data-tour="json-editor"]']], body: 'The whole current configuration as JSON. Apply (Ctrl+Enter, ⌘+Enter on a Mac) puts an edit into the harness.' },
    { id: 'full', title: 'Full harness JSON', spots: [['[data-el="harness-json"]']], body: 'The configuration with its runtime settings, to view, copy or download.' },
  ],
  hVersions: [
    { id: 'head', title: 'Saved versions', spots: [[HEAD]], body: 'Where versions of a harness are kept: four places, numbered.' },
    VIEWS, CURRENT,
    { id: 'tab', title: 'Checkpoints in this tab', spots: [['[data-tour="store-checkpoints"]']], body: 'Named versions of the configuration, kept while this tab is open.' },
    { id: 'file', title: 'A file', spots: [['[data-tour="store-file"]']], body: 'Export the harness to a file anywhere, or import one back.' },
    { id: 'kept', title: 'On this computer', spots: [['[data-tour="store-library"], [data-tour="store-ids"]']], body: 'The library of saved harnesses on this computer, and the minimal harnesses kept by ID.' },
  ],
  customize: [
    VIEWS, PICK, PROMPT,
    { id: 'advanced', title: 'Advanced settings', spots: [['[data-tour="advanced-settings"]']], body: 'The blocks of this harness: tools, permission, context, stop, sampling and file list.' },
    { id: 'library', title: 'Your saved harnesses', loaded: '[data-tour="advanced-settings"]', spots: [['[data-el="member-harness-library"]']], body: 'Harnesses saved on this computer; each opens here.' },
    REVIEW,
  ],
  minimal: [
    { id: 'head', title: 'Minimal harness', spots: [[`${HEAD}, [data-el="wizard-difference"]`]], body: 'A new harness from six answers. Guide me in One run asks the same questions of the harness you have open.' },
    { id: 'answers', title: 'Six questions', spots: [['[data-tour="wizard-answers"]']], body: 'What it may touch, dangerous commands, verifying before submit, history, when it stops, and MCP; each marks its recommended answer.' },
    { id: 'config', title: 'Your configuration', spots: [['[data-tour="harness-summary"]']], body: 'The harness the answers make: its tools and settings, and its full JSON. Review configuration, above the questions, jumps here.' },
    { id: 'customize', title: 'Go further', spots: [['[data-el="customize-spec"], [data-el="wizard-summary"]']], body: 'Customize in Advanced settings carries it to One run; the line says whether it matches the recommended harness.' },
  ],
  fixed: [
    { id: 'head', title: 'Fixed harnesses', spots: [[`${HEAD}, [data-el="copy-not-app"]`]], body: 'Six TraceHarness copies of coding apps’ prompts and tools. Only the standing prompt is yours to edit.' },
    { id: 'tools', title: 'Six shells and the rules', spots: [['[data-tour="harness-toolbar"], [data-tour="harness-rules"]']], body: 'Preview one prompt across six shells; Permissions and saving says what stays fixed and where your edits are kept.' },
    { id: 'card', title: 'One card per app', spots: [['[data-tour="harness-grid"] > :first-child']], body: 'Its steps and policy, tools, the standing prompt with its byte budget, and its full JSON.' },
  ],
  build: [
    { id: 'head', title: 'Build a harness', spots: [[HEAD]], body: 'Start from a common harness, or stack the blocks yourself. A live model uses a key you paste here; it is not saved.' },
    { id: 'presets', title: 'Presets', spots: [['[data-el="harness-catalog"], [data-el="harness-catalog"] + [data-el="copy-not-app"]']], body: 'TraceHarness copies of each app’s loop; one sets every block below.' },
    { id: 'preview', title: 'Configuration preview', spots: [['[data-tour="harness-summary"]']], body: 'The harness the blocks make: its tools, Run, and its full JSON.' },
    { id: 'blocks', title: 'Seven blocks', spots: [['[data-tour="harness-blocks"]']], body: 'Prompt, tools, permission, context, stop, sampling and the file list, one panel each.' },
  ],
  six: [
    { id: 'head', title: 'One prompt, six shells', spots: [[HEAD]], body: 'One prompt in all six fixed harnesses; each keeps its own tools, permission rule, stop and byte cap. A preview: nothing is saved.' },
    { id: 'prompt', title: 'The prompt', spots: [['[data-tour="apply-prompt"]']], body: 'The prompt to try in every shell.' },
    { id: 'apply', title: 'Apply', spots: [['[data-tour="harness-toolbar"]']], body: 'Apply to all six puts it in every card; the line beside it says what changed.' },
    { id: 'card', title: 'Each shell', spots: [['[data-el="apply-shell"]:first-child']], body: 'The prompt in one shell: whether it fits the byte cap, its tools and its steps.' },
    { id: 'save', title: 'Keep a prompt', spots: [['[data-tour="apply-save"]']], body: 'Fixed harnesses is where a prompt is saved, one card at a time.' },
  ],
}
