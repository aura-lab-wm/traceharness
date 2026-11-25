/* Rig · brand/brands.js — which logo goes beside a name. PURE: a name in, a brand id (or null) out.

   A logo is matched by a rule on the name, never guessed: a name no rule claims gets none, and so do mock models
   and "unknown" (they keep their plain mark). Names are read in lower case with "_" and spaces as "-", so
   claude_code, "Claude Code" and claude-code are one name. A word counts only where it starts a word: "ollama"
   is not Llama, "swellama" is not either, "opus-mt" is not Claude.

   kinds   model    a model (gemini-2.5-flash, anthropic/claude-sonnet-4-6, Qwen/Qwen3-Coder-480B)
           harness  a harness, an agent or an importer (claude-code@2.1.x, mini_swe_agent, Codex CLI, copilot_cli)
           source   where runs come from (a Hugging Face link, SWE-bench Verified)
           dataset  a public dataset's id (nebius/SWE-agent-trajectories): the agent it names, else its source

   ink     how brand.css draws the mark (the files are in this folder, see LICENSE-THIRD-PARTY):
           color      its own colours on Paper and Graphite; the text's ink in both High contrast themes
           dark-mono  its own colours on Paper; the text's ink on Graphite, where its colour is under 3:1
           mono       the text's ink everywhere (a one-colour mark)
           art        its own drawing everywhere (it brings its own tile; there is no one-colour version) */

export const BRANDS = {
  claude: { label: 'Claude', ink: 'color' },
  claudecode: { label: 'Claude Code', ink: 'color' },
  openai: { label: 'OpenAI', ink: 'mono' },
  codex: { label: 'OpenAI Codex', ink: 'mono' },
  gemini: { label: 'Google Gemini', ink: 'color' },
  qwen: { label: 'Qwen', ink: 'dark-mono' },
  minimax: { label: 'MiniMax', ink: 'color' },
  deepseek: { label: 'DeepSeek', ink: 'color' },
  meta: { label: 'Meta Llama', ink: 'color' },
  mistral: { label: 'Mistral AI', ink: 'color' },
  kimi: { label: 'Kimi', ink: 'mono' },
  grok: { label: 'Grok', ink: 'mono' },
  huggingface: { label: 'Hugging Face', ink: 'color' },
  openhands: { label: 'OpenHands', ink: 'dark-mono' },
  sweagent: { label: 'SWE-agent', ink: 'art' },
  minisweagent: { label: 'mini-SWE-agent', ink: 'art' },
  swebench: { label: 'SWE-bench', ink: 'art' },
  cursor: { label: 'Cursor', ink: 'mono' },
  copilot: { label: 'GitHub Copilot', ink: 'mono' },
  antigravity: { label: 'Google Antigravity', ink: 'color' },
}

// a word that starts a word: not after a letter (digits, "-", "/", "." and the start are fine)
const W = (body, end = '(?![a-z])') => new RegExp(`(?<![a-z])(?:${body})${end}`)
const ANY = '' // the word may run on (qwen3, deepseek-v3, mistral-large)

/** Names that never get a logo, whatever else they say ("unknown" has none because no rule claims it). */
const NONE = [W('mock')]

/** First rule that matches wins. */
const RULES = {
  model: [
    ['claude', [W('claude'), /^anthropic\//, W('opus|sonnet|haiku', '-?\\d')]],
    ['openai', [W('(?:chat)?gpt'), /^openai\//]],
    ['gemini', [W('gemini')]],
    ['qwen', [W('qwen', ANY)]],
    ['minimax', [W('minimax', ANY)]],
    ['deepseek', [W('deepseek', ANY)]],
    ['meta', [W('(?:code)?llama'), /^meta-llama\//]],
    ['mistral', [W('mistral|mixtral|codestral|devstral|magistral|ministral', ANY)]],
    ['kimi', [W('kimi'), /^moonshot(?:ai)?\//]],
    ['grok', [W('grok')]],
  ],
  harness: [
    ['claudecode', [W('claude-?code')]],
    // before swe-agent: mini-swe-agent has a mark of its own
    ['minisweagent', [W('mini-?swe')]],
    ['sweagent', [W('swe-?agent')]],
    ['openhands', [W('open-?hands')]],
    ['codex', [W('codex')]],
    ['cursor', [W('cursor')]],
    ['copilot', [W('(?:github-)?copilot')]],
    ['antigravity', [W('antigravity|agy')]],
    ['kimi', [W('kimi')]],
    ['qwen', [W('qwen')]],
    ['grok', [W('grok')]],
  ],
  source: [
    // SWE-bench itself and its own sets (Verified, Lite, Multimodal); not another team's benchmark that borrows the
    // name (Multi-SWE-bench, SWE-bench Pro, SWE-bench-java) and not SWE-rebench
    ['swebench', [/(?<![a-z])(?<!multi-)swe-?bench(?![a-z+]|-(?:pro|java)(?![a-z]))/]],
    ['huggingface', [W('hugging-?face'), /^hf:/]],
  ],
}

/** The name as the rules read it. */
export function brandKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function match(kind, key) {
  for (const [id, tests] of RULES[kind] || []) if (tests.some((re) => re.test(key))) return id
  return null
}

/** The brand id of a name of this kind, or null (no rule claims it, a mock model, "unknown", an empty name). */
export function brandOf(kind, name) {
  const key = brandKey(name)
  if (!key || NONE.some((re) => re.test(key))) return null
  if (kind === 'agent') return match('harness', key)
  if (kind === 'dataset') return match('harness', key) || match('source', key)
  return match(kind, key)
}

/** The distinct brands of a list of names, in the order they first appear (a dataset's models). */
export function brandsOf(kind, names) {
  const out = []
  for (const n of Array.isArray(names) ? names : []) {
    const id = brandOf(kind, n)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** The brand of where a dataset's runs were fetched from (its recorded source address), or null. */
export function sourceBrandOf(source) {
  return source && typeof source === 'object' ? brandOf('source', source.url) : null
}
