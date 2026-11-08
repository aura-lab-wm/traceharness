# Block harness

A harness in this lab is the loop around a model: the prompt, the tools, the
permission policy, how much history the model sees, and when the loop stops.
The block builder lets a person stack those decisions and run the stack.

## Common harnesses

The catalog is `harnesslab/core/blocks.py`. Each row is a preset of that loop,
not a copy of the vendor program.

| Id | Name | What the preset changes | Default model |
|---|---|---|---|
| claude_code | Claude Code | Full tools, strict policy, 40 steps | anthropic/claude-sonnet-5, from the captured session |
| codex | Codex | Full tools, strict policy, 30 steps | openai/gpt-5.6-luna, curated list |
| gemini_cli | Gemini CLI | Same loop shape as Codex | google/gemini-3.8-flash, curated list |
| qwen_code | Qwen Code | Same loop shape as Codex | qwen/qwen3.8-27b, curated list |
| cursor | Cursor | Same loop shape as Codex | anthropic/claude-haiku-4.5, curated list |
| openhands | OpenHands | Full tools, strict policy, 50 steps | openai/gpt-5.6-luna, curated list |
| swe_agent | SWE-agent | Last five observations kept | qwen/qwen3.8-27b, curated list |
| aider | Aider | No shell tool | openai/gpt-5.6-luna, curated list |
| cline | Cline | Full tools, strict policy, 30 steps | anthropic/claude-sonnet-5 |

`ayg` is not a harness name in this repository, and it is not on the public
lists checked while this was written (Claude Code, Codex, Gemini CLI, Cursor,
Qwen Code, OpenHands, SWE-agent, Aider, Cline). It has no preset.

Two presets that set the same knobs are the same measurement cell. The catalog
says so in `same_loop_as`. The model is chosen per run and is not part of the
cell hash.

## Run

`POST /api/blocks/run` compiles the stack to a `built_<hash>` harness and
starts one job. `mock` runs offline. Any other model needs `api_key` in that
request, or a key already given to this process. The response never includes
the key. A request whose `Origin` is another site is rejected by the existing
host guard.

The page is `#/rig/blocks`.
