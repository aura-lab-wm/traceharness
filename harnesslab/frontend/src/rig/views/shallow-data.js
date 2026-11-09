/* Shared numbers for the three shallow screens. The signed-in page in
   traceharness-site repeats this catalog. These screens do not call a model. */
const TAIL = " When the edit is in place, verify the result with the tools you have, then call submit. Do not modify the tests. Network, privilege, secret access, and path escape stay blocked. Stay on the files the task names. Do not invent a tool. If the step cap arrives first, call submit with the edit you have and say what is still open. This copy belongs to the signed-in member. It does not read a home directory and it does not patch a local agent install."

export const PERMISSION = "Network, privilege, secret access, and path escape stay blocked. Strict policy also blocks destructive shell and test edits."

export const CARDS = [
  { id: "claude", name: "Claude Code", cap_bytes: 250000, max_steps: 20, tools: ["list_files", "read_file", "write_file", "edit_file", "run_tests", "bash", "submit"], prompt: "You are the TraceHarness stand-in for Claude Code. List the repository, read the files the task names, and edit those files. You may run the existing tests and a shell command that stays inside the repository." + TAIL },
  { id: "codex", name: "Codex", cap_bytes: 128000, max_steps: 16, tools: ["list_files", "read_file", "edit_file", "run_tests", "bash", "submit"], prompt: "You are the TraceHarness stand-in for Codex. List the repository, read the files the task names, and edit those files. You may run the existing tests and a shell command that stays inside the repository." + TAIL },
  { id: "qwen", name: "Qwen", cap_bytes: 128000, max_steps: 12, tools: ["list_files", "read_file", "edit_file", "run_tests", "submit"], prompt: "You are the TraceHarness stand-in for Qwen. List the repository, read the files the task names, and edit those files. You may run the existing tests. You have no shell." + TAIL },
  { id: "kimi", name: "Kimi", cap_bytes: 32768, max_steps: 12, tools: ["list_files", "read_file", "edit_file", "run_tests", "submit"], prompt: "You are the TraceHarness stand-in for Kimi. List the repository, read the files the task names, and edit those files. You may run the existing tests. You have no shell. Keep the edit small enough for the short prompt cap." + TAIL },
  { id: "agy", name: "Antigravity", cap_bytes: 24000, max_steps: 12, tools: ["list_files", "read_file", "edit_file", "bash", "submit"], prompt: "You are the TraceHarness stand-in for Antigravity. List the repository, read the files the task names, and edit those files. You may run a shell command that stays inside the repository. You have no separate test tool." + TAIL },
  { id: "grok", name: "Grok", cap_bytes: 10000, max_steps: 8, tools: ["list_files", "read_file", "edit_file", "submit"], prompt: "You are the TraceHarness stand-in for Grok. List the repository, read the files the task names, and edit those files. You have no shell and no test tool. Keep the edit small enough for the shortest prompt cap." + TAIL },
].map((row) => ({ ...row, policy: "strict", context_window: 0, mcp: "none", lane: "fixed", permission: PERMISSION }))

export const QUESTIONS = [
  { id: "touch", prompt: "What may it touch?", recommended: "read_edit_test", options: [["read_edit_test", "Read, edit, run tests. No shell."], ["read_only", "Read only."], ["with_shell", "Read, edit, run tests, and a shell."]] },
  { id: "dangerous", prompt: "Dangerous command?", recommended: "strict", options: [["strict", "Strict. Destructive shell and test edits stay blocked."], ["permissive", "Permissive for destructive shell and test edits only."]] },
  { id: "verify", prompt: "Verify before submit?", recommended: "yes", options: [["yes", "Yes. One sentence in the prompt."], ["no", "No extra verify sentence."]] },
  { id: "history", prompt: "How much history?", recommended: "full", options: [["full", "Full history."], ["last2", "Only the last two observations."]] },
  { id: "stop", prompt: "When does it stop?", recommended: "steps_12", options: [["steps_12", "12 steps."], ["steps_6", "6 steps."], ["steps_20", "20 steps."]] },
  { id: "mcp", prompt: "MCP?", recommended: "none", options: [["none", "None. No MCP tools are mounted."]] },
]

const VERIFY_YES = "You are a minimal TraceHarness agent. Read the repository, edit only the files the task names, and run the tests that already exist. Before you call submit, verify the edit against those tests. Do not modify the tests. Network, privilege, secret access, and path escape stay blocked."

export function blocksFromAnswers(answers) {
  const tools = {
    read_edit_test: ["list_files", "read_file", "edit_file", "run_tests", "submit"],
    read_only: ["list_files", "read_file", "submit"],
    with_shell: ["list_files", "read_file", "edit_file", "run_tests", "bash", "submit"],
  }[answers.touch]
  const prompt = answers.verify === "yes" ? VERIFY_YES : "You are a minimal TraceHarness agent. Read the repository and edit only the files the task names. Call submit when the edit is in place. Leave every test file untouched. Network, privilege, secret access, and path escape stay blocked."
  const window = answers.history === "last2" ? 2 : 0
  const steps = { steps_12: 12, steps_6: 6, steps_20: 20 }[answers.stop] || 12
  return [
    { type: "prompt", text: prompt },
    { type: "tools", names: tools },
    { type: "policy", mode: answers.dangerous },
    { type: "context", window, observation_chars: 6000 },
    { type: "stop", max_steps: steps, max_total_tokens: 400000 },
    { type: "sampling", temperature: 0, max_tokens_per_call: 2048 },
    { type: "listing", include: true },
  ]
}
