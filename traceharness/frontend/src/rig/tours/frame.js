/* Rig · tours/frame.js — the page tours of Add data (Import files, Public sample, Session capture, Results on disk,
   Which benchmark?) and of Learn (Learn, an article, the Glossary, the Reading guide, Reference materials). PURE.
   Each walks its page top to bottom (pageTours.js says how a step is written). */
import { HEAD } from './words'

const ADD_HEAD = { id: 'head', title: 'Add data', spots: [['[data-el="add-data-head"]']], body: 'Ways to bring runs in. The line under the title is the folder they go to, and what it holds now.' }
const ADD_TABS = { id: 'tabs', title: 'Four tabs', spots: [['[data-el="add-data-tabs"]']], body: 'Import files, Public sample, Session capture and Results on disk; the count is the datasets already here.' }
const LEARN_NAV = { id: 'nav', title: 'All of Learn', spots: [['[data-el="learn-nav"]']], body: 'Every article, the glossary and the guides, one click away.' }

export const FRAME_TOURS = {
  import: [
    ADD_HEAD, ADD_TABS,
    { id: 'import', title: 'Import files', spots: [['[data-el="import-trace"] .rg-ws-sech, [data-el="import-trace"] .rg-ws-lead, [data-el="import-about"]']], body: 'Session files from another agent harness; each session becomes one run with the lab’s own ledger. About importing says what is kept.' },
    { id: 'form', title: 'Path and adapter', spots: [['[data-el="import-trace"] .rg-ws-form']], body: 'The file or folder to read, with the usual places each tool keeps its sessions, and the adapter that reads them.' },
  ],
  sample: [
    ADD_HEAD, ADD_TABS,
    { id: 'hf', title: 'Hugging Face catalog', spots: [['[data-el="hugging-face"]']], body: 'Public datasets of recorded agent runs, with their rows, licence and access; Preview shows one before it is imported.' },
    { id: 'swe', title: 'The SWE-agent sample', spots: [['[data-el="swe-agent-import"]']], body: 'A ready download of public SWE-agent runs; About the SWE-agent sample says what is in it.' },
  ],
  capture: [
    ADD_HEAD, ADD_TABS,
    { id: 'what', title: 'Session capture', spots: [['[data-el="capture-sub"], [data-tour="capture-intro"]']], body: 'Your own coding-agent sessions on this machine, read back as runs. They stay private to this machine.' },
    { id: 'watcher', title: 'The watcher', spots: [['[data-el="capture-watcher"]']], body: 'What records the sessions, its state, and its housekeeping and terminal controls.' },
  ],
  disk: [
    ADD_HEAD, ADD_TABS,
    { id: 'table', title: 'Results on disk', spots: [['[data-tour="disk-table"]']], body: 'Every dataset folder here with its runs, models and last update; its Open button opens one.' },
    { id: 'versions', title: 'Harness versions', loaded: '[data-tour="disk-table"]', spots: [['[data-el="harness-versions"]']], body: 'The harness versions of the dataset in focus: hash, runs, pass@1 and its file.' },
  ],
  recommend: [
    { id: 'head', title: 'Which benchmark?', spots: [[HEAD]], body: 'One pick, a runner-up and one to avoid, chosen by a rule table you can read.' },
    { id: 'form', title: 'Your goal', spots: [['[data-tour="rec-goal"]']], body: 'Run tasks or analyse recorded runs. The fields under it add a model, its cutoff date, a budget and hours; the picks follow.' },
    { id: 'cards', title: 'The picks', spots: [['[data-el="rec-cards"]']], body: 'Recommended, runner-up and avoid, each with its score, subset and estimate.' },
    { id: 'sizing', title: 'Sizing', spots: [['[data-el="rec-sizing"]']], body: 'How many tasks and runs detect a 10-point difference, with the formula.' },
    { id: 'table', title: 'Why these three', spots: [['[data-el="rec-table"]']], body: 'Every dataset in the catalog, best first, with the rules that add, subtract or exclude.' },
    { id: 'method', title: 'Method paragraph', spots: [['[data-el="rec-method"]']], body: 'The choice written for a paper, to copy, or as JSON.' },
  ],
  learn: [
    { id: 'hero', title: 'Learn', spots: [['[data-el="learn-hero"]']], body: 'The articles in five parts, from reading one run to reporting a comparison. The button starts or continues the reading path; the count is what you have read here.' },
    { id: 'index', title: 'The reading path', spots: [['[data-el="learn-part"]:first-of-type']], body: 'One part: what it covers, its articles and the minutes they take. The other parts follow.' },
    { id: 'datasets', title: 'Example datasets', spots: [['[data-el="learn-datasets"]']], body: 'The datasets the articles draw their examples from, and where they are.' },
  ],
  article: [
    { id: 'hero', title: 'An article', spots: [['[data-el="learn-picker"], [data-el="learn-hero"]']], body: 'Its part and place among the articles, and the question it answers. All articles and the arrows beside it move between articles.' },
    { id: 'short', title: 'In short', spots: [['[data-el="learn-in-short"], [data-el="learn-toc"]']], body: 'The answer in a few lines; On this page lists its sections.' },
    { id: 'figure', title: 'Figures', loaded: '[data-el="learn-in-short"]', spots: [['[data-el="learn-figure"]']],
      body: ({ q }) => `Figures drawn from recorded runs.${/Table/.test(q.text('[data-el="learn-figure"]')) ? ' Chart or Table switches each one.' : ''}` },
    { id: 'practice', title: 'Try it', loaded: '[data-el="learn-in-short"]', spots: [['[data-el="learn-example"], [data-el="learn-try"]']], body: 'A worked example on real data, then steps to try in TraceHarness, each opening its page.' },
    { id: 'quiz', title: 'Check yourself', loaded: '[data-el="learn-in-short"]', spots: [['[data-el="learn-quiz"]']], body: 'A short quiz, one question at a time, with the reason for each answer.' },
    { id: 'end', title: 'Sources and next', loaded: '[data-el="learn-in-short"]', spots: [['[data-el="learn-sources"], [data-el="learn-terms"], [data-el="learn-see-also"], [data-el="learn-next"]']], body: 'Its sources, the glossary terms it uses, related articles, and the next article.' },
  ],
  glossary: [
    { id: 'head', title: 'Glossary', spots: [[HEAD]], body: 'Every term the articles and pages use, one plain sentence each.' },
    { id: 'filter', title: 'Find a term', spots: [['[data-tour="glossary-filter"]']], body: 'The filter narrows the list as you type; the count follows.' },
    { id: 'term', title: 'One term', spots: [['[data-el="glossary-row"]:first-of-type']], body: 'The word, its other names, what it means, and the articles that explain it.' },
    { id: 'names', title: 'Page names, old and new', spots: [['[data-el="glossary-names"]']], body: 'Every old page name with the page it is now, and a link to it.' },
    LEARN_NAV,
  ],
  readingGuide: [
    { id: 'head', title: 'Reading guide', spots: [[HEAD]], body: 'A guided path through one dataset, from the big picture to the recorded action that changed an outcome.' },
    { id: 'lab', title: 'Student Lab', spots: [['[data-el="outside-guided-state"]']],
      body: ({ q }) => (/is off/.test(q.text('[data-el="outside-guided-state"]')) ? 'Student Lab is off: the guide reads the same, and lessons beside each run appear once it is on.' : 'Whether the lessons beside each run are on.') },
    { id: 'steps', title: 'Start here', spots: [['[data-el="start-here"]']], body: 'The steps in order; each opens its page as a document beside the guide.' },
    { id: 'more', title: 'Reference and datasets', spots: [['[data-el="next-steps"], [data-el="included-datasets"]']], body: 'The reference materials, and the datasets that come with the lab.' },
    LEARN_NAV,
  ],
  package: [
    { id: 'head', title: 'Reference materials', spots: [[HEAD]], body: 'The school replication package: what it holds and how to reproduce it from this folder.' },
    { id: 'contents', title: 'What it contains', spots: [['[data-tour="package-contents"]']], body: 'Every part of the package, from the guides to the data.' },
    { id: 'datasets', title: 'Included datasets', spots: [['[data-el="included-datasets"]']], body: 'Each dataset in the package with its runs and how it was collected.' },
    { id: 'parts', title: 'Tasks and harnesses', spots: [['[data-tour="package-tasks"], [data-tour="package-harnesses"]']], body: 'The issue of each task, and the definition of each harness.' },
    { id: 'reproduce', title: 'Reproduce', spots: [['[data-tour="package-reproduce"], [data-tour="package-excluded"]']], body: 'The commands that rebuild every number from this folder, and what was left out of the handoff.' },
    LEARN_NAV,
  ],
}
