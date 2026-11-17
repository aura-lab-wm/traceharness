# Where the catalog's curated facts come from

`traceharness/catalog/hf_datasets.json` is a curated list. The Hub states the measured fields (rows, size, splits,
license, gated, last modified); the facts below are curated or were completed by reading the dataset card
(`https://huggingface.co/datasets/<id>/raw/main/README.md`) or the data itself (datasets-server `/statistics`, which
covers every row of the split). A value is set only where a card or the data states it; otherwise the field stays
`null`. Read on 2026-11-17.

## Facts set or confirmed

| Dataset | Field | Value | Where it is stated |
|---|---|---|---|
| `SWE-bench/SWE-bench_Multilingual` | `languages` (confirmed) | c, c++, go, java, javascript, php, ruby, rust, typescript | Card: "Source code spans 9 programming languages", followed by a table of those nine with instance counts. |
| `ByteDance-Seed/Multi-SWE-bench` | `languages` (confirmed) | c, c++, go, java, javascript, rust, typescript | Card: "this framework spans 7 languages (Java, TypeScript, JavaScript, Go, Rust, C, and C++)". |
| `SWE-bench/SWE-bench_Multimodal` | `languages` (set) | javascript, typescript | Card: "every task instance here comes from a JavaScript or TypeScript repository and carries at least one image asset". |
| `SWE-bench-Live/MultiLang` | `languages` (set) | c, c#, c++, go, java, javascript, rust, typescript | Card: "Each split is task set of one language." Its eight splits are named c, cpp, go, js, rust, java, ts, cs. The card does not spell the names out; expanding cpp, js, ts and cs to C++, JavaScript, TypeScript and C# is ours. |
| `nebius/SWE-rebench-V2` | `languages` (set) | c, c#, c++, clojure, dart, elixir, go, java, javascript, julia, kotlin, lua, ocaml, php, python, r, rust, scala, swift, typescript | Card: "32,079 samples covering Python, Go, TypeScript, JavaScript, Rust, Java, PHP, Kotlin, Julia, Elixir, Scala, Swift, Dart, C, C++, C#, R, Clojure, OCaml, and Lua". Data: column `language`, `/statistics` over all 32,079 rows of `default/train`, 20 distinct values (java, dart, python, js, c, kotlin, ocaml, cpp, csharp, elixir, r, swift, lua, julia, clojure, php, rust, ts, go, scala), the same 20 languages as the card; short names expanded as above. |
| `AmazonScience/SWE-PolyBench` | `task_dates` (set) | first 2016-01-11, last 2024-10-18 | Column `created_at`, `/statistics` over all 2,110 rows of `default/test`: min 2016-01-11 17:37:29, max 2024-10-18 14:52:41 (the date part is kept). |
| `AmazonScience/SWE-PolyBench` | `languages` (confirmed) | java, javascript, python, typescript | Column `language`, same `/statistics` call: TypeScript 729, JavaScript 1017, Java 165, Python 199 (2,110 rows, no empty values). |
| `nebius/SWE-agent-trajectories` | `hf_adapter`, `hf_import` | swe_agent, default / train | `traceharness hf preview` on 2026-11-17: columns instance_id, model_name, target, trajectory, exit_status, generated_patch, eval_logs (fixture `tests_agentlab/fixtures/hf/columns.json`); config `default`, split `train` from the Hub's `/size`. One live import of 20 rows. |
| `nebius/SWE-rebench-openhands-trajectories` | `hf_adapter`, `hf_import` | messages, default / train | Same method: a `messages` column with role/content turns, `instance_id`, `resolved`; config `default`, split `train`. One live import. |
| `SWE-bench/SWE-smith-trajectories` | `hf_adapter`, `hf_import` | messages, default / tool | Same method: `messages`, `instance_id`, `resolved`, `model`, `traj_id`, `patch`; the Hub lists config `default` with splits `ticks`, `tool`, `xml`; the live import read `tool`. |

## Left null, and why

| Dataset | Field | Reason |
|---|---|---|
| `harborframework/terminal-bench-2.1`, `harborframework/terminal-bench-3.0` | `languages` | The cards describe terminal tasks and name no programming language. |
| `ByteDance-Seed/Multi-SWE-bench_trajs` | `languages` | The card (an 848-byte page) states no language; it only points to the Multi-SWE-bench leaderboard. |
| `SALT-NLP/SWE-chat` | `languages` | The card could not be read: HTTP 401, "Access to dataset SALT-NLP/SWE-chat is restricted". |
| `aura-lab-wm/traceharness-runs` | `languages` | The card names the Requests and urllib3 repositories but states no language. |
