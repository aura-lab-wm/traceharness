import { checkedNativeProfile } from '../native-prompts-contract'

export const stableJSON = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
const hasControls = (value) => [...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)
export function captureArm(arms, label, configuration) {
  if (!label.trim() || label.length > 80 || hasControls(label)) throw new Error('Name this variant with 1–80 printable characters.')
  if (arms.length >= 8) throw new Error('An experiment supports at most eight variants.')
  if (configuration.version !== 2) throw new Error('Enable a native prompt profile before capturing a variant.')
  checkedNativeProfile(configuration.native_prompt_profile, configuration.runtime_id)
  const cohort = ({ native_prompt_profile: profile, ...rest }) => ({ ...rest, pins: Object.fromEntries(Object.entries(profile).filter(([key]) => !['default_action', 'overrides'].includes(key))) })
  if (arms.length && stableJSON(cohort(arms[0].configuration)) !== stableJSON(cohort(configuration))) throw new Error('Keep runtime, model, task, additional instructions, limits and inventory identical. Only the native profile may differ.')
  if (arms.some((arm) => arm.label === label.trim())) throw new Error('Give each variant a different name.')
  return [...arms, { id: 'arm-' + crypto.randomUUID(), label: label.trim(), configuration: JSON.parse(JSON.stringify(configuration)) }]
}
export function experimentDraft(name, seed, repeats, arms) {
  if (!name.trim() || name.length > 120 || hasControls(name)) throw new Error('Name the experiment with 1–120 printable characters.')
  if (!/^\d+$/.test(String(seed)) || !Number.isSafeInteger(Number(seed)) || Number(seed) > 4294967295) throw new Error('Use an integer schedule seed from 0 to 4294967295.')
  if (!/^\d+$/.test(String(repeats)) || Number(repeats) < 1 || Number(repeats) > 10) throw new Error('Use 1–10 paired repetitions.')
  if (arms.length < 2 || arms.length > 8 || arms.length * Number(repeats) > 64) throw new Error('Capture 2–8 variants and plan at most 64 trials.')
  return { version: 1, name: name.trim(), seed: Number(seed), repeats: Number(repeats), arms }
}
const statuses = new Set(['ready', 'running', 'paused', 'cancelling', 'completed', 'cancelled', 'needs_attention'])
export const experimentActive = (value) => ['running', 'cancelling'].includes(value?.status)
export function checkedExperiment(value, expectedId) {
  if (expectedId && value?.id !== expectedId) throw new Error('The runner returned a different experiment. Refresh its saved identity.')
  if (!value || !/^[a-f0-9]{48}$/.test(value.id) || !statuses.has(value.status) || !/^[a-f0-9]{64}$/.test(value.plan_sha256)
    || !value.plan || !Array.isArray(value.trials) || value.trials.length !== value.trial_count || value.trial_count > 64
    || !Number.isFinite(value.maximum_cost_usd) || !Array.isArray(value.issues) || !value.summary) throw new Error('The experiment response is incomplete. Refresh before taking another action.')
  return value
}
