/* The console's side of "Hugging Face as a source" (package H2).

   GET  /api/hf/catalog          the curated catalog: also in an export (the key is /hf/catalog)
   GET  /api/hf/preview?dataset= size, columns, first rows, license, gated, revision (local console only)
   POST /api/hf/import           {dataset, config?, split?, n, seed, name?} -> a background job whose progress
                                 and result are on GET /api/import/status (local console only)

   The checks here mirror the server's (catalog/hf_fetch.py, catalog/hf_import.py): a form never sends what
   the server would refuse, and the server checks again. Pure helpers are exported for the tests. */
import { api } from './api'

export const MAX_ROWS = 2000
export const DEFAULT_ROWS = 200
const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const RESULTS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export const isDatasetId = (s) => typeof s === 'string' && !s.includes('..') && DATASET_ID.test(s)
export const isResultsName = (s) => typeof s === 'string' && !s.includes('..') && RESULTS_NAME.test(s)

/** The default results directory of a dataset: hf_<owner>_<name>, filesystem-safe (as the server names it). */
export const defaultName = (id) => 'hf_' + String(id).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120)
/** What the name field keeps while typing: the characters a results directory name may contain. */
export const cleanName = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '')
/** A row count the form may send: a whole number from 1 to 2,000. */
export const clampRows = (v) => Math.max(1, Math.min(MAX_ROWS, Math.trunc(Number(v)) || DEFAULT_ROWS))
export const licenseText = (license) => (license ? String(license) : 'license not stated')

/** The catalog's recorded-run datasets: the ones whose rows can be imported as runs. */
export const trajectoryDatasets = (catalog) => ((catalog && catalog.datasets) || []).filter((d) => d.kind === 'trajectories')

export const previewPath = (id) => '/hf/preview?dataset=' + encodeURIComponent(id)

export function hfPreview(id) {
  if (!isDatasetId(id)) return Promise.reject(new Error('That is not a Hugging Face dataset id (owner/name).'))
  return api(previewPath(id))
}

/** Start an import. Resolves {status, results_dir, source}; rejects with the server's sentence. */
export function hfImport({ dataset, config, split, n, seed, name }) {
  if (!isDatasetId(dataset)) return Promise.reject(new Error('That is not a Hugging Face dataset id (owner/name).'))
  if (name && !isResultsName(name)) return Promise.reject(new Error('The name may use letters, digits, ".", "_" and "-" only.'))
  const body = { dataset, n: clampRows(n), seed: Math.trunc(Number(seed)) || 0 }
  if (config) body.config = config
  if (split) body.split = split
  if (name) body.name = name
  return api('/hf/import', { method: 'POST', body })
}
