/* Rig · learn/quiz.js — checks one quiz answer in the page. PURE. */

const MESSAGES = {
  unanswered: 'Pick an answer first.',
  right: 'Correct.',
  wrong: 'Not quite. The marked option is the answer.',
}

/** checkAnswer({ options, answer }, picked) -> { status, answer, message }. `picked` is the chosen
 *  option's index (a number or its string); anything else counts as no choice yet. */
export function checkAnswer(question, picked) {
  const n = picked == null || picked === '' ? NaN : Number(picked)
  const chosen = Number.isInteger(n) && n >= 0 && n < question.options.length
  const status = !chosen ? 'unanswered' : n === question.answer ? 'right' : 'wrong'
  return { status, answer: question.answer, message: MESSAGES[status] }
}

/** quizScore([status per question, null before its first check]) -> { right, checked, total, done }.
 *  A check with no choice ('unanswered') is not an answer. */
export function quizScore(statuses) {
  const checked = statuses.filter((s) => s === 'right' || s === 'wrong').length
  const right = statuses.filter((s) => s === 'right').length
  return { right, checked, total: statuses.length, done: statuses.length > 0 && checked === statuses.length }
}
