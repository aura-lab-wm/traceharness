/* Rig · learn/glossary.js — the Learn glossary. PURE apart from the bundled articles.
   Rows: the student guide's glossary (docs/STUDENT_GUIDE.md section 16, word for word; learn.test.js checks it)
   plus every article term. A term the guide defines under another name folds into that row (ALIASES); the rest
   take their article's sentence (ARTICLE_MEANINGS) or one of their own (LEARN_TERMS), so no row is empty. */
import { ARTICLES } from './articles'

/** The credit a reader sees, in plain words; the file it names stays in the credit's hover hint. */
export const GUIDE_SOURCE = 'student guide, section 16'
export const GUIDE_FILE = 'docs/STUDENT_GUIDE.md, section 16'
export const GUIDE_TERMS = [
  { term: 'agent', meaning: 'a language model that acts through tools (read, edit, run tests, submit)' },
  { term: 'harness', meaning: 'everything around the model: tools, policy, context rule, budgets, prompt, temperature' },
  { term: 'cell', meaning: 'one model under one harness' },
  { term: 'task / probe', meaning: 'one repository with an issue; a probe is a task with a built-in trap' },
  { term: 'run / attempt / repeat', meaning: 'one agent episode on one task; repeats are runs of the same cell and task' },
  { term: 'ledger', meaning: 'the per-run record of every consequential action (ledger.jsonl)' },
  { term: 'span', meaning: 'one line of the ledger' },
  { term: 'oracle / test suite', meaning: 'what decides pass or fail: visible, hidden (default) or strengthened' },
  { term: 'boundary event', meaning: 'an action the policy flagged: destructive, network, secret, test tampering…' },
  { term: 'mock', meaning: 'a scripted fake agent with designed failure rates, for offline, reproducible work' },
  { term: 'sentinel', meaning: 'an early-warning model that scores a run while it is happening and can block a bad submit' },
  { term: 'pass@k / pass^k', meaning: 'at least one of k passes / all k pass' },
  { term: 'flip', meaning: 'a task whose outcome changes across repeats of the same cell' },
  { term: 'paired Δ', meaning: 'a difference computed task by task between two cells' },
  { term: 'cut off', meaning: 'a reply that stopped at the per-call output limit (finish_reason: length)' },
]

/** Words of the app itself that neither the guide nor an article defines; the picker that uses one says it
 *  in the same words (datasetInfo.WHAT_IS_A_DATASET). */
export const APP_SOURCE = 'TraceHarness app'
export const APP_TERMS = [
  { term: 'dataset', meaning: 'one folder of runs under data/runs: some models under some harnesses on some tasks, every run kept with its steps and grades' },
  // the words of an analysis answer's verdict line (answers.js variableVerdict, graderVerdict)
  { term: 'contrast', meaning: 'one comparison of two harnesses for the same model, task by task; it separates from zero when its 95% interval leaves zero out' },
  { term: 'share of variance', meaning: 'how much of the spread between passing and failing runs one factor (the model, the harness, or the two together) accounts for' },
  { term: '\u03ba (kappa)', meaning: 'how far two graders agree beyond what chance alone would give: 1 is full agreement, 0 is no better than chance' },
  // the words of the harness pages and the narrated tour (tutorial/lessons.json), and the contract's name for capture
  { term: 'stand-in', meaning: 'TraceHarness\'s own copy of how a known app drives its model (its prompt and tools), run by TraceHarness\'s engine instead of the app; listed, for example, as Claude Code (TraceHarness copy) under Fixed harnesses, and you can change one field and run again' },
  { term: 'native agent', meaning: 'the installed app itself (Claude Code, Codex and so on), run or recorded by TraceHarness; it shows what the real product did, but its insides cannot be changed; One run lists it under Native agents' },
  { term: 'grader', meaning: 'what decides whether a run passes: an oracle (a test suite: visible, hidden or strengthened) or an LLM judge checked against the suites; Analysis › Judge & integrity compares them' },
  { term: 'family', meaning: 'the model × harness cells of one dataset taken together; Analysis › Family matrix shows every cell\'s pass@1 side by side' },
  { term: 'Session capture', meaning: 'recording your own coding-agent sessions (Claude Code, Codex, Cursor and others) on this computer and reading them back as runs; private and never exported; find it at Add data › Session capture' },
]

/** Words the articles and the pages use that the guide does not define: one plain sentence each (Learn's own). */
export const LEARN_SOURCE = 'TraceHarness Learn'
export const LEARN_TERMS = [
  // reading a run
  { term: 'trajectory', meaning: 'the full record of one run, in order: every message sent to the model, every reply, every tool call and every tool output' },
  { term: 'step', meaning: 'in TraceHarness, one model call: one request to the model and its reply, shown with the tool that reply asked for' },
  { term: 'model call', meaning: 'one request sent to the model and the reply that came back; an imported run that counts steps its own way is shown in model calls' },
  { term: 'tool call', meaning: 'one action a reply asks for, such as read_file, edit_file, run_tests, a shell command or submit, with what the tool returned' },
  { term: 'phase', meaning: 'the tag TraceHarness puts on each tool call (explore, reproduce, edit, test, lookup, env, submit or other), set by fixed rules over the tool or command' },
  { term: 'recorded path', meaning: 'a run written as one letter per tool call, for example RETS for read, edit, test and submit, so the runs of a task can be lined up' },
  { term: 'lane', meaning: 'one run drawn as one column of a task\u2019s all-runs view, step by step, so several runs can be read side by side' },
  { term: 'after the fix', meaning: 'the model calls after the one that wrote the fix, which is the last edit to a file of the final patch that existed before the run, with calls that only submit left out' },
  { term: 'first lookup', meaning: 'the first tool call tagged lookup, meaning a fetch from an outside host; the run page marks it, or says no lookup when there was none' },
  { term: 'observation masking', meaning: 'hiding old tool outputs from later model calls, so the conversation the model re-reads stays short' },
  { term: 'exit reason', meaning: 'why a run stopped: submitted, no_action, max_steps, budget_exceeded, sentinel_abort, error, or unknown when the source did not record it' },
  // grades and outcomes
  { term: 'outcome', meaning: 'the one label a run carries after grading, such as passed, wrong patch, no patch or ungraded; it is kept apart from how the run ended' },
  { term: 'wrong patch', meaning: 'a failed run that changed code while the tests still fail, the only label that says the fix itself was wrong' },
  { term: 'no patch', meaning: 'a failed run that ended without any edit, for a reason other than a cut-off reply or the step limit' },
  { term: 'cut off, no patch', meaning: 'a failed run whose last reply hit the per-call output limit without calling a tool, before any edit was made' },
  { term: 'step limit, no patch', meaning: 'a failed run that used up its steps before it made any edit' },
  { term: 'harness error', meaning: 'a run in which the harness itself failed, so the run says nothing about the agent and stays out of claims about it' },
  { term: 'ungraded', meaning: 'a run with no recorded grade; it is left out of pass rates and never counted as a fail' },
  { term: 'known / unknown', meaning: 'known is the graded runs that passed of all graded runs, written like 75 / 120 known, and unknown is the count of runs with no grade' },
  { term: 'visible tests', meaning: 'the tests the agent can see and run during its run; a pass on them shows what the agent believed, not its grade' },
  { term: 'hidden tests', meaning: 'the default grade of the lab\u2019s own tasks: tests the agent never sees, run on its final code after the run' },
  { term: 'strengthened', meaning: 'the third suite of the lab\u2019s own tasks, the hidden tests plus extra ones that catch weak fixes, so it can only lower a pass rate' },
  { term: 'patch', meaning: 'the change a run made to the code, written as a diff: the lines removed and the lines added, file by file' },
  { term: 'FAIL_TO_PASS', meaning: 'tests from the real fix that fail on the old code and pass on the fixed code, so they check that the issue is gone' },
  { term: 'PASS_TO_PASS', meaning: 'tests that pass both before and after the real fix, so they check that nothing else broke' },
  { term: 'resolved / unresolved', meaning: 'SWE-bench\u2019s verdicts: resolved means the required tests all passed on the patch, and unresolved means they ran and did not' },
  { term: 'Docker container', meaning: 'a packaged copy of an operating system, a Python version and the libraries one project needs, so every patch is tested the same way' },
  { term: 'evaluation harness', meaning: 'the program that grades a finished patch by running tests in a container, not the agent harness that ran the agent' },
  { term: 'underspecified issue', meaning: 'an issue that does not say clearly enough what should change, so a right fix cannot be told from a wrong one' },
  { term: 'solution leak', meaning: 'a task whose issue text, comments or repository history already hold the fix, so an agent can copy it instead of working it out' },
  { term: 'test tampering', meaning: 'an edit to the tests instead of the code, such as deleting or loosening a failing test; the policy flags it as a boundary event' },
  { term: 'reward hacking', meaning: 'getting a high score by exploiting the grader or the task setup instead of doing the task' },
  // benchmarks and tools
  { term: 'SWE-bench Verified', meaning: 'a 500-task subset of SWE-bench that professional developers screened, leaving out unclear issues and unfair tests' },
  { term: 'OpenRouter', meaning: 'a paid service that passes requests on to many model providers through one interface; study_v04 was collected through it' },
  { term: 'OpenHands', meaning: 'an open-source agent harness for coding tasks; the public SWE-rebench runs in TraceHarness are OpenHands runs' },
  { term: 'SWE-agent', meaning: 'an agent harness (Yang et al., 2024) that gives the model its own commands for viewing and editing files' },
  { term: 'dataset card', meaning: 'the page beside a Hugging Face dataset that says what it holds, where it came from, its licence and how to cite it' },
  { term: 'import', meaning: 'turning another tool\u2019s session files or a public dataset into TraceHarness runs, each with a ledger, a patch and a summary' },
  { term: 'provenance', meaning: 'the record an import writes beside a dataset: its source, revision, licence, how rows were chosen and which rows were skipped' },
  { term: 'usage recorded', meaning: 'how many runs of a dataset carry token counts from their source, out of all its runs; the others show tokens as unknown' },
  // harnesses and runs
  { term: 'system prompt', meaning: 'the standing instructions a harness sends at the start of every conversation, before the task' },
  { term: 'permission policy', meaning: 'the harness rule for flagged actions such as destructive commands or test edits: strict blocks them, permissive records them and lets some through' },
  { term: 'context window', meaning: 'the most tokens a model can read in one request; the harness decides how much of the conversation it keeps' },
  { term: 'step limit', meaning: 'the most steps a harness lets one run take; a run that reaches it ends with exit reason max_steps' },
  { term: 'engine', meaning: 'the program that runs the agent loop: TraceHarness\u2019s own engine, or an installed app run as a native agent' },
  { term: 'minimal harness', meaning: 'a small harness built from six answers on the Minimal harness page: its tools, its policy, a verify line, its history and its step cap' },
  { term: 'operating point', meaning: 'the Sentinel score above which the submit is blocked; a lower one catches more bad submits and blocks more good ones' },
  { term: 'calibration', meaning: 'how well a score\u2019s value matches how often the thing happens, so that runs scored 0.7 go bad about 7 times in 10' },
  { term: 'AUC', meaning: 'the chance that a score ranks a randomly picked bad run above a randomly picked good one: 0.5 is a coin flip and 1 is perfect' },
  // comparing and reporting
  { term: 'token', meaning: 'the unit providers count text in: a short piece of text about the size of a word or part of one' },
  { term: 'temperature', meaning: 'a model setting for how much chance goes into each token it picks; at 0 it takes the most likely one, yet hosted runs can still differ' },
  { term: 'prompt (input) tokens', meaning: 'everything sent to the model in one request, including the whole conversation so far' },
  { term: 'generated (output) tokens', meaning: 'what the model wrote back in one reply, including any hidden reasoning it was billed for' },
  { term: 'context growth', meaning: 'how the prompt gets longer at each model call of a run, because every request sends the whole conversation again' },
  { term: 'pass@1', meaning: 'how often a single run passes: TraceHarness takes each task\u2019s pass rate and averages it over the tasks' },
  { term: 'pooled', meaning: 'a pass rate taken as passing runs over all graded runs, so a task with more runs weighs more than a task with fewer' },
  { term: 'spread', meaning: 'how far apart a task\u2019s runs are, such as its longest run\u2019s steps divided by its shortest; it grows as runs are added' },
  { term: 'eligible', meaning: 'a task with at least two graded runs under the chosen oracle, so it can show a flip; the flip rate counts only these tasks' },
  { term: 'condition', meaning: 'one model under one harness, the same as a cell; the Family matrix and the Experiment pages call it a condition' },
  { term: 'arm', meaning: 'one side of a planned comparison, the runs of one condition; Run setup gives the smallest difference it can detect per arm' },
  { term: 'paired comparison', meaning: 'a difference taken task by task between two setups on the same tasks and then averaged, so task difficulty cancels out' },
  { term: 'interval (95% bootstrap over tasks)', meaning: 'the range put on a difference by redrawing the set of tasks many times and seeing how far the average moves' },
  { term: 'separates / covers 0', meaning: 'separates means a difference\u2019s whole 95% interval sits on one side of zero, and covers 0 means zero is inside it' },
  { term: 'interaction', meaning: 'an effect of one factor that depends on another, for example a harness change that helps one model and not another' },
  { term: 'two-factor fit', meaning: 'the Experiment page\u2019s fit of model and harness together, which gives each, and the two together, a share of the variance' },
  { term: 'power', meaning: 'the chance that an experiment detects a difference of a given size when that difference is real; 80% is the usual target' },
  { term: 'smallest detectable difference', meaning: 'the smallest true difference a planned number of runs would detect with the chosen power, here 80% at the 5% level' },
]

/** Page names of TraceHarness 0.6.0 that HANDOUT.md and the guides still use: what each is called now and where it is. */
export const OLD_SOURCE = '0.6.0 name, in the handout and guides'
export const OLD_NAMES = [
  { term: 'Trajectories', meaning: 'the 0.6.0 page of every run; it is now two pages, Tasks (one row per task, a box per run) and Runs (every run in one list); find it in the page list under Tasks or Runs' },
  { term: 'Sources & capture', meaning: 'the 0.6.0 page that brings runs in; now called Add data; find it in the page list under Add data, with its tabs Import files, Public sample, Session capture and Results on disk' },
  { term: 'Download a public sample', meaning: 'the 0.6.0 section of Sources & capture; now the Public sample tab; find it at Add data › Public sample' },
  { term: 'Load trajectories', meaning: 'the 0.6.0 button on Datasets that opened Sources & capture; now called Add data; find it in the page list under Add data' },
  { term: 'status bar', meaning: 'the 0.6.0 bar along the bottom of the window; its parts now live elsewhere, so find it in three places: the Asking line under each page title (its Change menu sets the model, harness and oracle), More actions (⋯) for the panels Buddy, Event log, Capture watcher and Case file, and the dot at the top right for the connection' },
]

/** another name -> the row that defines it (a guide, app or Learn row); its slug opens that row too */
export const ALIASES = {
  oracle: 'oracle / test suite',
  run: 'run / attempt / repeat',
  repeat: 'run / attempt / repeat',
  'pass@k': 'pass@k / pass^k',
  'pass^k': 'pass@k / pass^k',
  'harness (scaffold)': 'harness',
  'flip rate': 'flip',
  probe: 'task / probe',
  kappa: '\u03ba (kappa)',
  'step (one model call)': 'step',
  'phase (explore, reproduce, edit, test, lookup, env, submit, other)': 'phase',
  'work after the fix': 'after the fix',
  'ungraded (unknown)': 'ungraded',
  resolved: 'resolved / unresolved',
  'visible / hidden / strengthened tests': 'oracle / test suite',
  'visible / hidden tests': 'oracle / test suite',
  'pooled vs task-averaged pass@1': 'pooled',
  'strengthened tests': 'strengthened',
  'boundary events': 'boundary event',
  'minimum detectable effect': 'smallest detectable difference',
}

/** slug -> the sentence an article gives a term the student guide does not define (word for word). */
export const ARTICLE_MEANINGS = {
  'cached-tokens': { meaning: 'the part of the prompt served from the cache', source: 'Learn, What an agent\u2019s run costs' },
  'computed-tokens': { meaning: 'what the server had to process fresh: generated tokens plus the prompt tokens that did not come from the cache', source: 'Learn, What an agent\u2019s run costs' },
}

export const termSlug = (t) => String(t).toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-+|-+$/g, '')
const slugOf = (articleTerm) => termSlug(ALIASES[articleTerm] || articleTerm)
const ALIAS_SLUGS = Object.fromEntries(Object.entries(ALIASES).map(([from, to]) => [termSlug(from), termSlug(to)]))
/** The slug of the row a term or a slug belongs to: flip-rate -> flip, work-after-the-fix -> after-the-fix. */
export const resolveSlug = (termOrSlug) => { const s = termSlug(termOrSlug); return ALIAS_SLUGS[s] || s }

/** One row per term: { term, slug, meaning, source, names: [other names the articles use], aka: [the row's other
 *  names from ALIASES that no article uses], articles: [{ id, number, title }] }. No name is retired: an alias stays
 *  on its row and the filter finds it. */
export function buildGlossary(articles) {
  const rows = new Map()
  for (const g of GUIDE_TERMS) rows.set(termSlug(g.term), { term: g.term, slug: termSlug(g.term), meaning: g.meaning, source: GUIDE_SOURCE, sourceHint: GUIDE_FILE, names: [], articles: [] })
  for (const g of APP_TERMS) rows.set(termSlug(g.term), { term: g.term, slug: termSlug(g.term), meaning: g.meaning, source: APP_SOURCE, names: [], articles: [] })
  for (const g of LEARN_TERMS) rows.set(termSlug(g.term), { term: g.term, slug: termSlug(g.term), meaning: g.meaning, source: LEARN_SOURCE, names: [], articles: [] })
  for (const g of OLD_NAMES) rows.set(termSlug(g.term), { term: g.term, slug: termSlug(g.term), meaning: g.meaning, source: OLD_SOURCE, names: [], articles: [] })
  for (const a of articles) {
    for (const t of a.glossary_terms) {
      const slug = slugOf(t)
      const row = rows.get(slug) || { term: t, slug, meaning: null, source: null, names: [], articles: [] }
      rows.set(slug, {
        ...row,
        names: row.term === t || row.names.includes(t) ? row.names : [...row.names, t],
        articles: row.articles.some((x) => x.id === a.id) ? row.articles : [...row.articles, { id: a.id, number: a.number, title: a.title }].sort((x, y) => x.number - y.number),
      })
    }
  }
  return [...rows.values()]
    .map((r) => (r.meaning == null && ARTICLE_MEANINGS[r.slug] ? { ...r, ...ARTICLE_MEANINGS[r.slug] } : r))
    .map((r) => ({ ...r, aka: Object.keys(ALIASES).filter((from) => termSlug(ALIASES[from]) === r.slug && from !== r.term && !r.names.includes(from)) }))
    .sort((x, y) => x.term.toLowerCase().localeCompare(y.term.toLowerCase()))
}

let bundled = null
/** The glossary row of a slug or an alias's slug ({ term, meaning, slug, … }), or null; built once from the bundled
 *  articles. */
export function termMeaning(slug) {
  if (!bundled) bundled = buildGlossary(ARTICLES)
  const s = resolveSlug(slug)
  return bundled.find((e) => e.slug === s) || null
}

/** The row an article term belongs to. */
export const entryFor = (entries, articleTerm) => entries.find((e) => e.slug === slugOf(articleTerm)) || null

/** Rows whose term, other names or meaning contain the query (case-insensitive); all rows for an empty one. */
export function filterGlossary(entries, query) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => [e.term, ...e.names, ...(e.aka || []), e.meaning || ''].some((s) => s.toLowerCase().includes(q)))
}
