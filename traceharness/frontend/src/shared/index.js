/* The shared sources (SPEC 4.1), compiled into the console: the one port, the limits, the canonical
   words, the datasets and the draft keys. shared-sources.json is generated from the Python package
   (python -m traceharness.shared.generate) and is byte-identical to the copy the site vendors, so
   these values are the same in every mode and on traceharness.dev. Never edit the JSON by hand.
   The import attribute keeps this module loadable in plain Node as well as in the bundler: the
   site's runner contract checks import member-api.js from this folder without building it. */
import data from './shared-sources.json' with { type: 'json' }

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

export const SHARED = deepFreeze(data)
/** The local console's port. */
export const PORT = SHARED.port
/** { command, url, port }: how to start the local console and where it answers. */
export const LOCAL_APP = SHARED.local_app
/** { prompt_max_bytes, runner_prompt_max_bytes, run: { name: [lowest, highest] } } */
export const LIMITS = SHARED.limits
/** The canonical words: LABELS.plain_editor, LABELS.capture_member, ... */
export const LABELS = SHARED.glossary.labels
/** [{ phrase, use, scope }]: phrases no screen may say. */
export const RETIRED = SHARED.glossary.retired
/** { hosted: [...], school: [...] } */
export const DATASETS = SHARED.datasets
/** { prefix_member, prefix_local, names }: sessionStorage draft keys (SPEC 4.5). */
export const DRAFTS = SHARED.drafts
export const SHARED_SHA256 = SHARED.content_sha256
