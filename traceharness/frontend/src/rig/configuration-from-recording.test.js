import { expect, it } from 'vitest'
import { configurationFromManifest, configurationFromRecordedHarness } from './configuration-from-recording'

const harness = () => ({ id: 'baseline', system_prompt: 'Inspect, edit, verify, and submit.', tools: ['read_file','edit_file','run_tests','submit'], policy: 'strict',
  context_window: 0, observation_chars: 6000, max_steps: 12, max_total_tokens: 400000, temperature: -0, max_tokens_per_call: 2048, include_file_listing: true, notes: 'Recorded experiment', sentinel: {} })

it('copies every supported engine setting into an editable configuration without substituting a preset', () => {
  const raw = harness(); const result = configurationFromRecordedHarness({ harness: raw, modelId: 'provider/original-model', taskId: 'original-task' })
  expect(result).toMatchObject({version:1,runtime_id:'traceharness',model_id:'provider/original-model',task_id:'original-task',prompt:raw.system_prompt,harness:{lane:'minimal'},limits:{max_steps:12}})
  expect(result.harness.blocks).toHaveLength(7)
  expect(Object.is(result.harness.blocks.find(block=>block.type==='sampling').temperature,-0)).toBe(true)
  expect(result.harness.blocks.find(block=>block.type==='context')).toMatchObject({window:0,observation_chars:6000})
  expect(raw.id).toBe('baseline')
})
it('refuses partial, unsupported or contradictory recorded settings instead of filling defaults or dropping fields', () => {
  for (const raw of [{tools:[]},{...harness(),sentinel:{enabled:true}},{...harness(),retry_strategy:'unrecorded-loop'},{...harness(),prompt:'Different prompt'}]) {
    expect(()=>configurationFromRecordedHarness({harness:raw,modelId:'provider/model',taskId:'task'})).toThrow()
  }
  const raw=harness();delete raw.temperature
  expect(()=>configurationFromRecordedHarness({harness:raw,modelId:'provider/model',taskId:'task'})).toThrow()
})
it('forks hosted native and compiled engine manifests into strict current-draft configurations', () => {
  const base={version:1,runtime_id:'native-codex',model_id:'provider/model',task_id:'registered-task',prompt:'Recorded instructions',prompt_mode:'append',harness:{},limits:{max_steps:4,wall_time_seconds:60,max_cost_usd:.1,max_output_tokens:1024}}
  expect(configurationFromManifest({...base,runtime_version:'pinned',image_digest:'sha256:'+'a'.repeat(64)})).toEqual(base)
  const engine=configurationFromRecordedHarness({harness:harness(),modelId:'provider/model',taskId:'registered-task'})
  const result=configurationFromManifest({...engine,harness:{id:'compiled-record-id',hash:'a'.repeat(12),blocks:engine.harness.blocks,configuration:harness()}})
  expect(result.harness).toEqual(engine.harness)
  expect(result.prompt).toBe(engine.prompt)
})
