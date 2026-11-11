// Fabricated content confined to tests. This is not a native extraction or receipt.
import { createHash } from 'node:crypto'

export const testDigest = (text) => createHash('sha256').update(text).digest('hex')
export function nativeInventoryFixture() {
  const row = (id, title, className, body, capability = 'patchable', placeholders = []) => ({
    id, title, class_name: className, class_source: 'Fixture classifier, not a measured effect', source_layer: 'embedded-native-fragment',
    capability, baseline_utf8: body, baseline_sha256: testDigest(body), occurrence_count: 1, required_placeholders: placeholders,
  })
  return { schema_version: 1, runtime_id: 'native-claude-code', runtime_version: 'fixture', image_digest: 'sha256:' + 'a'.repeat(64),
    binary_sha256: 'b'.repeat(64), inventory_sha256: 'c'.repeat(64), taxonomy_sha256: 'd'.repeat(64), materializer_sha256: 'e'.repeat(64),
    blocks: [
      row('first', 'First fixture prompt', 'Testing', 'First exact baseline λ🙂'),
      row('second', 'Second fixture prompt', 'Testing', 'Second exact baseline'),
      row('third', 'Template fixture prompt', 'Planning', 'Before ${TH_PROMPT_EXPR_0} after ${TH_PROMPT_EXPR_1}', 'patchable', ['${TH_PROMPT_EXPR_0}', '${TH_PROMPT_EXPR_1}']),
      row('observed', 'Observed fixture component', 'Planning', 'Observed fixture text', 'observed-only'),
    ] }
}
export function nativeRuntimeFixture(inventory = nativeInventoryFixture(), execution = true) {
  return { id: inventory.runtime_id, name: 'Claude Code', kind: 'native', available: true, version: inventory.runtime_version, prompt_mode: 'append', model_ids: ['fixture/model-a'],
    native_prompts: { available: true, execution_available: execution, mode: 'embedded', inventory_sha256: inventory.inventory_sha256, reason: execution ? '' : 'Application receipt unavailable in this fixture.' } }
}
export function nativeResponseFixture(inventory = nativeInventoryFixture(), execution = true) {
  return { version: 1, available: true, execution_available: execution, reason: execution ? '' : 'Application receipt unavailable in this fixture.', inventory }
}
