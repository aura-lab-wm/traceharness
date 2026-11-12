import { checkedNativeProfile } from '../native-prompts-contract'

export const stableJSON = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
const hasControls = (value) => [...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)
/**
 * A key shape the Worker (noToken: any "sk-" key, JavaScript \b) or the runner (has_secret:
 * provider keys) refuses in a plan name or an arm label. Checked here so the member sees why
 * before the Worker answers "Invalid experiment variant.".
 */
export const hasCredentialShape = (value) => typeof value === 'string' && (/\bsk-(?:or-)?[A-Za-z0-9_-]{10,}\b/.test(value) || /sk-or-v\d+-[A-Za-z0-9_-]{16,}/.test(value))
export const VARIANT_CREDENTIAL_ISSUE = 'Remove provider credentials from the variant name.'
export function captureArm(arms, label, configuration) {
  if (!label.trim() || label.length > 80 || hasControls(label)) throw new Error('Name this variant with 1–80 printable characters.')
  if (hasCredentialShape(label)) throw new Error(VARIANT_CREDENTIAL_ISSUE)
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
  if (hasCredentialShape(name)) throw new Error('Remove provider credentials from the experiment name.')
  if (arms.some((arm) => hasCredentialShape(arm?.label))) throw new Error(VARIANT_CREDENTIAL_ISSUE)
  if (!/^\d+$/.test(String(seed)) || !Number.isSafeInteger(Number(seed)) || Number(seed) > 4294967295) throw new Error('Use an integer schedule seed from 0 to 4294967295.')
  if (!/^\d+$/.test(String(repeats)) || Number(repeats) < 1 || Number(repeats) > 10) throw new Error('Use 1–10 paired repetitions.')
  if (arms.length < 2 || arms.length > 8 || arms.length * Number(repeats) > 64) throw new Error('Capture 2–8 variants and plan at most 64 trials.')
  return { version: 1, name: name.trim(), seed: Number(seed), repeats: Number(repeats), arms }
}
const versionTwo = (configuration) => {
  if (configuration?.version !== 2) throw new Error('Enable a native prompt profile before capturing a variant.')
  return checkedNativeProfile(configuration.native_prompt_profile, configuration.runtime_id)
}
const withProfile = (configuration, profile, patch) => ({ ...JSON.parse(JSON.stringify(configuration)), native_prompt_profile: { ...profile, ...patch } })
/** The same configuration with the inventory baseline: same pins, default keep, no overrides. */
export function baselineConfiguration(configuration) {
  return withProfile(configuration, versionTwo(configuration), { default_action: 'keep', overrides: [] })
}
/**
 * The standard experiment, built correctly by construction: the baseline as the reference arm
 * and the current profile as the variant, optionally with an all-disabled arm. Arm identities
 * are fixed words, so the same plan content and seed always give the same schedule.
 * An unedited profile yields two identical arms: an A/A control, which the caller must label.
 */
export function pairAgainstBaseline(configuration, label, options = {}) {
  const profile = versionTwo(configuration)
  const name = typeof label === 'string' ? label.trim() : ''
  if (!name || name.length > 80 || hasControls(name)) throw new Error('Name this variant with 1–80 printable characters.')
  if (hasCredentialShape(name)) throw new Error(VARIANT_CREDENTIAL_ISSUE)
  if (['Baseline (no edits)', 'All patchable disabled'].includes(name)) throw new Error('Give each variant a different name.')
  const arms = [{ id: 'arm-baseline', label: 'Baseline (no edits)', configuration: baselineConfiguration(configuration) },
    { id: 'arm-profile', label: name, configuration: withProfile(configuration, profile, {}) }]
  if (options.includeNoneIncluded) arms.push({ id: 'arm-none-included', label: 'All patchable disabled', configuration: withProfile(configuration, profile, { default_action: 'disable', overrides: [] }) })
  return arms
}
/** Move one arm to the front. The runner always takes the first arm as the reference. */
export function makeReference(arms, armId) {
  const chosen = arms.find((arm) => arm.id === armId)
  if (!chosen) throw new Error('Choose a captured variant as the reference.')
  return [chosen, ...arms.filter((arm) => arm !== chosen)]
}
/** What an arm's profile does, from the profile alone. `is_baseline`: default keep and every override keeps. */
export function armProfileSummary(arm) {
  const profile = arm?.configuration?.native_prompt_profile
  const overrides = Array.isArray(profile?.overrides) ? profile.overrides : []
  const count = (action) => overrides.filter((row) => row?.action === action).length
  const summary = { default_action: profile?.default_action === 'disable' ? 'disable' : 'keep', overrides: overrides.length, replace: count('replace'), disable: count('disable'), keep: count('keep') }
  return { ...summary, is_baseline: summary.default_action === 'keep' && summary.replace === 0 && summary.disable === 0 }
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
