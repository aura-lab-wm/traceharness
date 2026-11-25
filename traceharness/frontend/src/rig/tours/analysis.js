/* Rig · tours/analysis.js — the page tours of Analysis: Questions, a question, the runs behind an answer, the Family
   matrix, Comparison, Experiment, Outcomes, Judge & integrity, Tokens, Trajectory features, Report, Run setup and the
   Sentinel. PURE. Each walks its page top to bottom (pageTours.js says how a step is written). */
import { HEAD, when } from './words'

const EMPTY = (sel) => `${sel} [data-el="empty-state"]`

export const ANALYSIS_TOURS = {
  questions: [
    { id: 'head', title: 'Questions', spots: [['[data-el="questions-head"]']], body: 'Nine questions about this dataset; each card answers from its recorded runs, or says why it cannot.' },
    { id: 'ask', title: 'Asked of', spots: [['[data-el="ask-bar"]']], body: 'The cell the answers are about. Change switches the model, harness or oracle.' },
    { id: 'stack', title: 'The questions', spots: [['[data-el="answers-toggle"], [data-el="question-stack"]']], body: 'Show answers adds each card\'s sentence. After the tour, open a card for its answer, figure and runs.' },
  ],
  question: [
    { id: 'ask', title: 'The question', spots: [['.rg-q-ask, [data-el="ask-bar"]']], body: 'The question, and the cell it is asked of. Change switches it.' },
    // a dataset that cannot answer it says why and where to ask instead: that is the answer part then
    { id: 'answer', title: 'The answer', spots: [['[data-el="answer-verdict"], [data-el="answer"], [data-el~="question-unanswered"]']],
      body: ({ q }) => (q.has('[data-el="answer"]') ? 'The number, what it counts and its scope, in one sentence.' : 'Why this dataset cannot answer it, and the datasets or steps that can.') },
    { id: 'figure', title: 'The figure', loaded: '[data-el~="question-unanswered"]', spots: [['[data-el="question-figure"]']], body: 'Where the number comes from. Pin keeps it in the case file.' },
    { id: 'runs', title: 'The runs behind it', loaded: '[data-el="descriptive-disclaimer"], [data-el~="question-unanswered"]', spots: [['[data-el="show-me-the-runs"]']], body: 'Lists every run behind the answer.' },
    { id: 'disclaimer', title: 'What it is not', loaded: '[data-el~="question-unanswered"]', spots: [['[data-el="descriptive-disclaimer"]']], body: 'Descriptive, not causal; unknown grades never count as failures.' },
  ],
  answerRuns: [
    { id: 'head', title: 'The runs behind an answer', spots: [['[data-el="question-runs-head"]']], body: 'The runs a question’s answer counts, in order, under the task and cell named in the title.' },
    { id: 'filter', title: 'Narrow', loaded: '[data-el="question-runs"]', spots: [['[data-el="failure-mode-filter"]']], body: 'All, the failed runs, or one way of failing.' },
    { id: 'table', title: 'One row per run', spots: [['[data-el="question-runs"]']], body: 'Its grade, task, model and harness, run number, model calls, tokens and how it failed. A run opens its page; Pin keeps it in the case file.' },
  ],
  family: [
    { id: 'answer', title: 'Family matrix', spots: [['[data-el="family-answer"], [data-el="family-answer"] + [data-el="about-view"]']], body: 'The highest and the lowest cell; the (i) says how cells are counted.' },
    { id: 'kpis', title: 'Three numbers', loaded: '[data-el="family-matrix"]', spots: [['[data-el="family-kpis"]']], body: 'How many conditions are measured, the spread from the lowest to the highest, and the median.' },
    { id: 'matrix', title: 'Model × harness', spots: [['[data-el="family-matrix"]']], body: 'pass@1 of every model under every harness; Inspect a harness shows one column. After the tour, select a cell for its evidence.' },
    { id: 'inspector', title: 'The inspector', loaded: '[data-el="family-matrix"]', spots: [['[data-el="inspector"]']], body: 'The selected cell: its interval, sample, paired change and runs.' },
  ],
  delta: [
    { id: 'answer', title: 'Comparison', loaded: '[data-el="delta-matrix"]', spots: [['[data-el="delta-answer"], [data-el="delta-answer"] + [data-el="about-view"]']], body: 'How many harnesses separate from the baseline, and the largest change; the (i) says how runs are paired.' },
    { id: 'kpis', title: 'Three numbers', loaded: '[data-el="delta-matrix"]', spots: [['[data-el="delta-kpis"]']], body: 'Contrasts above and below the baseline, and how many tasks each one pairs.' },
    { id: 'matrix', title: 'Each harness against the baseline', spots: [['[data-el="delta-matrix"]']],
      body: ({ q }) => (q.has(EMPTY('[data-el="delta-matrix"]')) ? 'Why nothing can be compared here, and where to look instead.'
        : 'The change in pass@1 of each model under each harness, paired by task; ◆ marks one that separates. The better and worse counts are its tasks.') },
    { id: 'variance', title: 'What carries the spread', loaded: '[data-el="delta-matrix"]', spots: [['[data-el="variance-decomposition"]']], body: 'How much of the spread between passing and failing runs each factor carries, with its interval.' },
  ],
  fit: [
    { id: 'answer', title: 'Experiment', loaded: '[data-el="two-factor-fit"]', spots: [['[data-el="fit-answer"], [data-el="fit-answer"] + [data-el="about-view"]']], body: 'Whether the model or the harness moves this dataset more, in one sentence; the (i) says how it is fit.' },
    { id: 'hold', title: 'Hold a factor', loaded: '[data-el="cell-grid-ci"]', spots: [['[data-el="hold-factors"]']], body: 'The menus fix a model or a task, and the fit is taken over the rest.' },
    { id: 'fit', title: 'Model and harness', spots: [['[data-el="two-factor-fit"]']],
      body: ({ q }) => (q.has(EMPTY('[data-el="two-factor-fit"]')) ? 'Why no two-factor fit can be made here, and what it would need.'
        : 'The spread of each factor and its share of the variance, side by side.') },
    { id: 'grid', title: 'Condition grid', spots: [['[data-el="cell-grid-ci"]']], body: 'pass@1 of every condition with its 95% interval.' },
    { id: 'pairs', title: 'Pairwise contrasts', loaded: '[data-el="cell-grid-ci"]', spots: [['[data-el="pairwise-contrasts"]']], body: 'Each pair of harnesses within a model, and which pairs separate.' },
  ],
  outcomes: [
    { id: 'answer', title: 'Outcomes', spots: [['[data-el="outcomes-answer"]']], body: 'pass@1 of this cell with its 95% interval, in one sentence.' },
    { id: 'kpis', title: 'Four numbers', spots: [['[data-el="outcomes-headline"], [data-el="pass-k"], [data-el="flip-rate"], [data-el="strengthened-delta"]']], body: 'pass@1, pass^3 (three passes in a row), the flip rate, and pass@1 under the strengthened oracle. After the tour, hover a dotted word for its meaning.' },
    { id: 'counted', title: 'How they are counted', spots: [['[data-el="outcomes-counted"]']], body: 'Opens with a click: pooled against per-task rates, and which tasks count.' },
    { id: 'repeats', title: 'Per task', spots: [['[data-el="per-task-repeats"]']], body: 'One row per task, one mark per run in order: a task that flips shows both outcomes.' },
    { id: 'ladder', title: 'Retries against consistency', spots: [['[data-el="passk-ladder"]']], body: 'pass@k and pass^k as k grows. Chart or Table switches the view.' },
  ],
  judge: [
    { id: 'answer', title: 'Judge & integrity', spots: [['[data-el="judge-answer"]']], body: 'The two oracles in one sentence: what the stricter one changes, or why they cannot be compared.' },
    { id: 'oracles', title: 'Oracle comparison', spots: [['[data-el="oracle-comparison"]']],
      body: ({ q }) => (q.has(EMPTY('[data-el="oracle-comparison"]')) ? 'Only one oracle graded these runs, so there is no second grade to compare.' : 'Hidden against strengthened grades, run by run, and how far they agree.') },
    { id: 'flags', title: 'Integrity flags', spots: [['[data-el="integrity-flags"]']], body: 'The flags still open: contamination probes and over-claiming, each with its evidence.' },
    { id: 'tasks', title: 'Per task', spots: [['[data-el~="per-task-oracle"]']], body: 'Each task’s pass@1 under both oracles, with the probe tasks marked.' },
    { id: 'llm', title: 'LLM as judge', spots: [['[data-el="llm-judge"]']],
      body: ({ q }) => `The same patches scored by a model judge, checked against the oracles.${when(q, EMPTY('[data-el="llm-judge"]'), ' No report yet: running the judge needs the lab’s server key.')}` },
  ],
  tokens: [
    { id: 'head', title: 'Tokens', spots: [[HEAD]], body: 'Where the tokens go, for the cell in focus. Change switches the model and harness.' },
    { id: 'answer', title: 'The answer', spots: [['[data-el="tokens-answer"], [data-el="tokens-answer"] + [data-el="about-view"]']], body: 'The key numbers in one sentence; its (i) says how they are counted.' },
    { id: 'stats', title: 'Five numbers', spots: [['[data-el="token-stats"]']], body: 'Re-read, generated, cached, computed, and the costliest tenth of runs.' },
    { id: 'phase', title: 'By phase', spots: [['[data-el="token-views"], [data-el="tokens-by-phase"]']], body: 'Each phase with its share of tool calls and tokens. The tabs switch to Context growth and Token spread.' },
    { id: 'spread', title: 'Token spread', reveal: '#rg-tok-sec-spread', spots: [['[data-el="token-spread"]']], body: 'Tasks whose runs differ most in tokens. A task name opens its runs side by side.' },
  ],
  features: [
    { id: 'answer', title: 'Trajectory features', spots: [['[data-el="features-answer"]']], body: 'How many different action sequences the runs take, and the most common, in one sentence.' },
    { id: 'sequences', title: 'Action sequences', spots: [['[data-el="action-sequences"]']], body: 'Each sequence as one letter per action (the key is above it), with its runs, pass rate and interval.' },
    { id: 'divergence', title: 'Where runs diverge', spots: [['[data-el="divergence"]']], body: 'For each task, the first step where its runs part ways, and what they did there.' },
    { id: 'query', title: 'Query the actions', spots: [['[data-el="action-query"]']], body: 'A regular expression over each run’s actions; the presets are ready-made ones, and the result sets the matching runs against the rest.' },
    { id: 'note', title: 'More features', loaded: '[data-el="action-query"]', spots: [['[data-el="features-swe-note"]']], body: 'Where yes/no habits are ranked too: a SWE-agent dataset, and its sample.' },
  ],
  report: [
    { id: 'bar', title: 'Report card', spots: [['[data-tour="report-actions"]']], body: 'A card written from the runs on disk, ready to share: Export .md or .json, or Pin it.' },
    { id: 'answer', title: 'The headline', spots: [['[data-el="report-answer"]']], body: 'What the dataset shows, in one sentence.' },
    { id: 'context', title: 'The dataset', loaded: '[data-el="report-claims"]', spots: [['[data-tour="report-context"]']], body: 'The runs behind the card and the conditions they cover.' },
    { id: 'claims', title: 'Claims and caveats', spots: [['[data-el="report-claims"]']], body: 'Each claim the data supports, with the caveat that goes with it.' },
    { id: 'provenance', title: 'Provenance', spots: [['[data-el="report-provenance"]']], body: 'Where every number comes from: the folder, the runs and the conditions.' },
  ],
  setup: [
    { id: 'head', title: 'Run setup', spots: [[HEAD]], body: 'Plan many runs at once: models × harnesses × tasks × runs per task.' },
    { id: 'answer', title: 'The answer', spots: [['[data-el="setup-answer"]']], body: 'What this setup is and what it can detect, or what is missing.' },
    { id: 'estimate', title: 'Estimate and launch', spots: [['[data-el="run-estimate"]']],
      body: ({ q }) => `Runs, cost, wall time and the smallest difference it can detect.${q.has('[data-el="launch-runs"]') ? ' Launch asks for a second click.' : ''}` },
    { id: 'choose', title: 'Change the plan', reveal: '[data-el="setup-plan"]', spots: [['[data-el="setup-plan"]']], body: 'The models, harnesses and tasks to tick, and runs per task. The harness is the variable.' },
  ],
  sentinel: [
    { id: 'kpis', title: 'Sentinel', spots: [['[data-el="sentinel-kpis"], [data-el="sentinel"] [data-el="empty-state"]']],
      body: ({ q }) => `An early warning: it scores a run at every step and can block a bad submit. ${q.has('[data-el="sentinel-kpis"]') ? 'How well it ranks runs that fail, with its interval.' : 'No model is trained yet; the command trains one from recorded runs.'}` },
    { id: 'threshold', title: 'Operating point', loaded: '[data-el="sentinel-leaderboard"]', spots: [['[data-el="sentinel-threshold"]']], body: 'The score above which a submit is blocked: bad submits caught, good ones blocked, and how early it warns.' },
    { id: 'features', title: 'What it weighs', loaded: '[data-el="sentinel-leaderboard"]', spots: [['[data-el="sentinel-features"]']], body: 'The features of a partial run and how much each one counts.' },
    { id: 'board', title: 'Trained sentinels', spots: [['[data-el="sentinel-leaderboard"]']], body: 'Each trained model with its scores; the active one is marked.' },
    { id: 'plugins', title: 'Detectors', spots: [['[data-el="sentinel-plugins"]']], body: 'What the Sentinel checks at every step: the built-in detectors and the plugin rules.' },
    { id: 'test', title: 'Test a rule', loaded: '[data-el="sentinel-plugins"]', spots: [['[data-el="sentinel-test-rule"]']], body: 'A rule plugin with the feature values you set, and whether it fires.' },
  ],
}
