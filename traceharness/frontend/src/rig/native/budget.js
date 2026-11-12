// Sizes of a profile against the deployed contract limits. Every number is one of two
// kinds and callers must label it so: EXACT (bytes, counts) or ESTIMATE (token estimate,
// manifest and plan sizes before runner review). Nothing here is a measurement: measured
// input tokens exist only in a finished run's reported usage.
//
// The sums cover the patchable fragments of the inventory. A single model request
// contains only some of them, so a sum is not the size of any request.
//
// Estimates, fixed so the browser and the CLI agree:
//   manifest_bytes        = profile_bytes + utf8(JSON string of the prompt) + 2048
//   paired_plan_bytes     = 2 * manifest_bytes + 2 * (utf8(JSON string of the prompt) + 2748) + 4096
//   frozen_bytes_estimate = draft_bytes + sum over arms (utf8(JSON of its configuration) + 2048) + 200 * trials + 512
import { LIMITS, profileBytes } from './profile-model'
import { baselineMetrics } from './search'
import { TOKEN_ESTIMATOR, estimateTokens, utf8Bytes } from './text-metrics'

/** 'near' from 80 % of the limit, 'over' above the limit. */
export function limitState(used, max) {
  return used > max ? 'over' : used * 5 >= max * 4 ? 'near' : 'ok'
}

const promptJsonBytes = (prompt) => utf8Bytes(JSON.stringify(typeof prompt === 'string' ? prompt : ''))

/** ESTIMATE of the run manifest size for a canonical profile of `profileSize` bytes. */
export function manifestBytesEstimate(profileSize, prompt = '') {
  return profileSize + promptJsonBytes(prompt) + 2048
}

/** ESTIMATE of a frozen two-arm plan: this profile against the baseline. */
export function pairedPlanBytesEstimate(profileSize, prompt = '') {
  return 2 * manifestBytesEstimate(profileSize, prompt) + 2 * (promptJsonBytes(prompt) + 2748) + 4096
}

/**
 * Claude Code: a disabled fragment contributes no text. Codex: a disabled or shortened
 * fragment keeps its span (the rest is spaces), so its bytes count as unchanged and its
 * tokens are NOT estimated: it is counted in `estimate.not_estimated_blocks` and enters
 * both token sums with its baseline estimate, so that no saving is claimed for padding.
 */
export function profileBudget(profile, inventory, context = {}) {
  const codex = inventory.runtime_id === 'native-codex'
  const metrics = baselineMetrics(inventory)
  const overrides = new Map(profile.overrides.map((row) => [row.block_id, row]))
  const exact = { baseline_bytes: 0, effective_bytes: 0, delta_bytes: 0, profile_bytes: profileBytes(profile), overrides: profile.overrides.length, keep: 0, replace: 0, disable: 0 }
  const estimate = { baseline_tokens: 0, effective_tokens: 0, delta_tokens: 0, not_estimated_blocks: 0 }
  const classes = new Map()
  inventory.blocks.forEach((block, index) => {
    let entry = classes.get(block.class_name)
    if (!entry) {
      entry = { class_name: block.class_name, blocks: 0, patchable: 0, keep: 0, replace: 0, disable: 0, baseline_bytes: 0, effective_bytes: 0, baseline_tokens: 0, effective_tokens: 0 }
      classes.set(block.class_name, entry)
    }
    entry.blocks++
    if (block.capability !== 'patchable') return
    const baseline = metrics[index], override = overrides.get(block.id)
    const action = override?.action || profile.default_action
    let bytes = baseline.bytes, tokens = baseline.est_tokens
    if (action === 'replace') {
      const size = utf8Bytes(override.replacement_utf8)
      if (codex && size < baseline.bytes) estimate.not_estimated_blocks++
      else { tokens = estimateTokens(override.replacement_utf8); if (!codex) bytes = size }
    } else if (action === 'disable') {
      if (codex) estimate.not_estimated_blocks++
      else { bytes = 0; tokens = 0 }
    }
    entry.patchable++
    entry[action]++
    exact[action]++
    entry.baseline_bytes += baseline.bytes; entry.effective_bytes += bytes; entry.baseline_tokens += baseline.est_tokens; entry.effective_tokens += tokens
    exact.baseline_bytes += baseline.bytes; exact.effective_bytes += bytes; estimate.baseline_tokens += baseline.est_tokens; estimate.effective_tokens += tokens
  })
  exact.delta_bytes = exact.effective_bytes - exact.baseline_bytes
  estimate.delta_tokens = estimate.effective_tokens - estimate.baseline_tokens
  const manifest = manifestBytesEstimate(exact.profile_bytes, context.prompt), plan = pairedPlanBytesEstimate(exact.profile_bytes, context.prompt)
  const meter = (id, used, max, kind) => ({ id, used, max, kind, state: limitState(used, max) })
  return { estimator: TOKEN_ESTIMATOR, exact, estimate,
    limits: [meter('overrides', exact.overrides, LIMITS.overrides, 'exact'), meter('profile_bytes', exact.profile_bytes, LIMITS.profile_bytes, 'exact'),
      meter('manifest_bytes', manifest, LIMITS.manifest_bytes, 'estimate'), meter('paired_plan_bytes', plan, LIMITS.plan_bytes, 'estimate')],
    by_class: [...classes.values()] }
}

/**
 * Sizes of a draft paired plan. `draft_bytes` is exact for the JSON this browser would
 * send; `frozen_bytes_estimate` is an ESTIMATE of the plan after runner review, which
 * stores every arm's profile twice. `maximum_cost_usd` is the sum of per-trial caps, a
 * worst case and not a forecast.
 */
export function planBudget(plan) {
  const draft = utf8Bytes(JSON.stringify(plan))
  const trials = plan.arms.length * plan.repeats
  let frozen = draft + 200 * trials + 512, cost = 0
  for (const arm of plan.arms) {
    frozen += utf8Bytes(JSON.stringify(arm.configuration)) + 2048
    cost += Number(arm.configuration?.limits?.max_cost_usd) || 0
  }
  return { draft_bytes: draft, frozen_bytes_estimate: frozen, max: LIMITS.plan_bytes, state: limitState(frozen, LIMITS.plan_bytes), maximum_cost_usd: cost * plan.repeats, trials }
}
