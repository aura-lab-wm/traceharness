// The constraints already exposed by the numeric editor, shared with its feedback.
export const NUMBER_FIELDS = {
  context: [
    { key: 'window', label: 'Last observations kept (0 = full history)', min: 0, max: 100 },
    { key: 'observation_chars', label: 'Observation characters', min: 200, max: 50000 },
  ],
  stop: [
    { key: 'max_steps', label: 'Step cap', min: 1, max: 200 },
    { key: 'max_total_tokens', label: 'Token cap', min: 1000, max: 2000000 },
  ],
  sampling: [
    { key: 'temperature', label: 'Temperature', min: 0, max: 2, step: 'any' },
    { key: 'max_tokens_per_call', label: 'Tokens per call', min: 16, max: 32000 },
  ],
}

export function numberIssue(value, { min, max, step }) {
  if (value === '' || value == null) return 'Enter a value.'
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.'
  if (step !== 'any' && !Number.isInteger(value)) return 'Use a whole number.'
  if (value < min || value > max) return `Use a value from ${min} to ${max}.`
  return ''
}

export function fieldIssues(blocks) {
  return blocks.flatMap((block) => (NUMBER_FIELDS[block.type] || []).flatMap((field) => {
    const issue = numberIssue(block[field.key], field)
    return issue ? [`${field.label}: ${issue}`] : []
  }))
}
