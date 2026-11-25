/* Rig · analysis-info.jsx — what the (i) after each analysis panel title says: the exact definition
   or formula of the panel's figures, read from the code that computes them (named at the end of each
   card), never a paraphrase of what it might mean. */

const Src = ({ children }) => <p className="rg-info-src">Computed in <span className="rg-mono">{children}</span>.</p>

/* ---- Outcomes */
export const LADDER_INFO = <>
  <p>For one task with <i>c</i> passes among <i>n</i> graded runs:</p>
  <p><b>pass@k</b> = 1 − C(n − c, k) ÷ C(n, k), or 1 when n − c &lt; k: the chance that at least one of k runs drawn from its runs passes (Chen et al. 2021).</p>
  <p><b>pass^k</b> = C(c, k) ÷ C(n, k), or 0 when c &lt; k: the chance that all k pass (Yao et al. 2024).</p>
  <p>Each is the mean over the tasks with at least k graded runs, graded by the hidden oracle. At k = 1 both are pass@1.</p>
  <Src>core/analysis.py · pass_at_k, pass_pow_k, aggregate</Src>
</>
export const PER_TASK_INFO = (oracle) => <>
  <p>One row per task; one mark per run, in the order the runs were recorded.</p>
  <p><b>pass / known</b> = runs that pass ÷ runs with a {oracle}-oracle grade. <b>?</b> counts the ungraded runs, which are never a Fail.</p>
  <p>A task <b>flips</b> when its known grades hold both a Pass and a Fail. Flip rate = tasks that flip ÷ tasks with at least two known grades.</p>
  <Src>data.js · tally, repeatEvidence</Src>
</>

/* ---- Tokens */
export const PHASE_INFO = <>
  <p>A model call takes the phase of the tool calls it made, read from each shell command; a call with no tool call is <span className="rg-mono">no_tool_call</span>. A call with several tool calls splits its tokens evenly between them.</p>
  <p>Re-read counts the prompt tokens read at a phase's calls; bars are scaled within each column.</p>
  <p><b>tool calls · % of all</b> = a phase’s tool calls ÷ all tool calls (no_tool_call left out). <b>generated</b> = tokens the model wrote at that phase’s calls; <b>re-read</b> = prompt tokens sent at them; each share is of the column’s total.</p>
  <p><b>tool output</b> = characters the tools returned; it stays unknown when the recording does not keep them.</p>
  <Src>core/tokens.py · dataset_tokens; token-model.js · phaseTable</Src>
</>
export const GROWTH_INFO = <>
  <p>At call k: the 25th percentile, median and 75th percentile of the prompt tokens sent at call k, over the runs that reached call k. A run with any call of unknown size is left out.</p>
  <p>A call index is drawn only when at least 50 runs reach it, or 10% of the runs, whichever is fewer.</p>
  <Src>core/tokens.py · context_growth</Src>
</>
export const SPREAD_INFO = <>
  <p><b>spread</b> = the costliest run’s tokens ÷ the cheapest run’s tokens, over one task’s runs whose totals are known (prompt + generated over every call); a task needs two such runs.</p>
  <p>The line above gives the median spread over tasks and how many reach 2× and 5×. <b>solved</b> = runs graded Pass ÷ runs of the task.</p>
  <Src>core/tokens.py · task_spreads</Src>
</>

/* ---- Family matrix */
export const MATRIX_INFO = (oracle) => <>
  <p><b>Cell</b> = runs that pass ÷ runs with a {oracle}-oracle grade, for one model under one harness. Ungraded runs are left out and counted beside the rate.</p>
  <p><b>Band</b> = the hidden oracle’s 95% interval from <span className="rg-mono">/metrics</span>: a percentile bootstrap (2,000 draws) over tasks of each task’s own pass rate. <b>Tick</b> = the cell’s rate. <b>Tint</b> grows from 50% (none) to 100%.</p>
  <Src>data.js · tally; core/analysis.py · bootstrap_ci</Src>
</>

/* ---- Comparison */
export const DELTA_INFO = (base) => <>
  <p><b>Δ</b> = the mean, over the tasks run under both, of (a task’s pass rate under the harness − its pass rate under <span className="rg-mono">{base}</span>), same model, hidden oracle.</p>
  <p><b>95% interval</b> = a percentile bootstrap over those tasks (5,000 draws), paired by task. A contrast <b>separates</b> when its interval leaves out 0.</p>
  <Src>core/analysis.py · paired_bootstrap</Src>
</>
export const VARIANCE_INFO = <>
  <p>A run’s outcome is 1 (pass) or 0. The total sum of squares around the mean splits into model, harness, model × harness, task (the block), condition × task and runs (within a condition and task).</p>
  <p><b>share</b> = a term’s sum of squares ÷ the total. The interval is a percentile bootstrap over tasks (400 draws).</p>
  <Src>core/analysis.py · factorial, factorial_ci</Src>
</>
