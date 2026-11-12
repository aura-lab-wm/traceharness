# Account and execution release verification

Fresh production execution is now verified for four native Codex jobs on the unchanged v17 runner. The account/security page and staged administrator console are live. The complete proposed account platform is **not finished**: its production database migration and additional lifecycle enforcement are not active.

## What passed in production

- Four jobs used native Codex 0.167.1, `openai/gpt-5.1-codex-mini`, and the pinned `requests-unicode-length` task. All four completed and independently graded passed. Reported model cost was **$0.03564640**, with no unknown costs among these four jobs. Historical unknown charges remain unresolved.
- The final edited job verified exactly one binary prompt replacement and observed that replacement in all eight model requests. The corresponding baseline observed the original fragment in all eight requests. The treatment was selected adaptively after an earlier conditional fragment was not emitted. This is mechanism and execution evidence, not a performance-gain estimate. See the [full execution receipt](RUNNER_V17_EXECUTION_VERIFICATION_2026_11_12.md).
- A real owner password session received HTTP 200 from `/app/account`, `/app/admin`, `/api/account`, and `/api/account/security`. The identity came from the caller's existing database profile; factor metadata came from Supabase Auth. No JWT, password, refresh credential or factor secret appears in evidence reports.
- Logged-out `/app`, `/app/shallow`, `/link`, `/app/account`, and `/app/admin` returned 302 `/login`. Anonymous API requests, including hostile-Origin requests, returned exactly `401 {"error":"Sign in required."}` without `Access-Control-Allow-Origin`. Signed-in hostile-Origin requests to all six tested account/admin surfaces returned 403.
- `/api/admin/accounts` and `/api/admin/audit` returned **503**, correctly reflecting the missing migration. These are unavailable services, not empty datasets or a passed administration test.
- Native Chrome displayed the real account identity/security metadata, administrator Overview, existing read-only Access requests, and explicit migration-unavailable People/Audit states. After KV publication, clicking Account in the full workbench opened the real account page, including its Administration link. No MFA enrollment, invitation, profile edit or role change was performed in production.

## Implementation and local checks

The account pages are small independent Worker responses, approximately 20 KB each. They do not load the full recorded-analysis corpus. Account navigation from the workbench, plain editor and capture pages points to `/app/account`.

The reviewed database candidates implement member-JWT authority, versioned profile editing with atomic audit, bounded directory/audit pagination, and a separate invitation approval/outbox path. Exact-target approval binds actor, browser session, factor, provider challenge, request UUID, request version and actor revision. It requires a recent provider-verified TOTP event; token refresh time is insufficient. A random one-use action proof is stored only as a SHA-256 digest. Recipient or authority changes invalidate an old proof. Invitation intent, provider acceptance, delivery failure and uncertain acknowledgement remain distinct states; an uncertain send does not automatically resend.

The Worker rejects malformed, expired or implausibly future proof receipts before reporting success. Optional authenticator setup uses the existing member session; verified-factor removal and lost-factor recovery are unavailable. The browser sign-out endpoint now explicitly asks the provider for `scope=local`, matching the UI. The existing host-only HttpOnly/Secure/SameSite=Lax cookie contract is preserved.

Verification:

| Check | Result | Scope |
| --- | --- | --- |
| Worker tests | 350 passed; no skips | Mocked network contracts, authorization, UI behavior, integration and streaming |
| PostgreSQL tests | 15 passed | Isolated local cluster, no TCP listener or production credentials |
| Runner tests | 316 passed, 554 subtests; 9 skips | Local source, including fresh-process import regression |
| Frontend | Lint/build passed; 6 member-shell DOM tests; 2 freshness checks | Account navigation source and generated bundle |
| Wheel parity | 135 files checked; zero mismatches | Clean archive of public commit `fed5aafc28c690bef38f35775529d0fdb1fe3f00` |
| Snapshot preservation | Exact corpus/bootstrap/CSS and five audio chapters retained | Only Account href and derived build stamp changed |

The runner's local package import now resolves `create_app` lazily, avoiding loading FastAPI/controller routes in a spawned provider transport process. The regression failed before the change and passed after it. This source change is committed and pushed but **not deployed to the v17 runner**; it cannot explain the production timings. Existing Worker timeout tests were also repaired to synchronize on actual fetch/read entry instead of assuming a fixed number of event-loop turns. Runtime deadlines and timeout/privacy assertions were retained.

During this Chrome review, the full workbench briefly showed a 1.1 GB high-memory tab indicator. This is a single browser observation with other tabs open, not an isolated benchmark or a memory-leak diagnosis. The account release preserves the full corpus exactly; it does not establish that the workbench's memory or startup costs are ready for larger-scale use.

## Published identities

- Public source and navigation: `fed5aafc28c690bef38f35775529d0fdb1fe3f00`, pushed to `aura-lab-wm/traceharness` main.
- Site source: `36daaf22db15ce1b4d21c4e68d7dca0690e17ee1`, local only.
- Final Worker: `c04d2338-5253-4fb4-893c-4e794b64d1ee`; deploy exit 0. The initial staged release `7aff4ea7-6ac6-43a3-9257-e5c8414f066a` was superseded to correct legacy-admin navigation discovered in live Chrome.
- KV file: `app-account-reviewed.html.gz`, 16,433,023 bytes, SHA-256 `24a34ae781ac80c67022c4478cf0ff998bc18b7a486a32c9a5821cb7ff8b3987`; upload exit 0.
- Real-member readback matched HTML SHA-256 `c2cffa046fa6c52c4e5aa67a9f0d319be8ddbcd828a145200271ebce05c8a7b2` after removing the expected member/capture injections.
- No zone routes, apex Worker attachment, Durable Objects, provider keys, production SQL or privileged account flags were changed. Temporary deployment configuration was removed after each operation.

## Remaining work and manual checks

The Supabase management connection for project `gclowkdcyvyhgbsfcyqk` is unavailable in this session. Before applying the candidate migrations, inspect the actual schema, grants, policies, signup trigger and callback/template configuration, then reconcile the reviewed migration with that inventory. Do not run it against another project or enable flags merely because local tests passed.

Profile editing, the directory/audit APIs and invitation activation remain unavailable in production. General session inventory/revocation, refresh-session management, role changes with last-owner protection, suspension across Worker/RLS/capture/runner access, and lost-factor recovery remain unfinished. Two-member production isolation, invitation delivery/acceptance, fresh production MFA action approval, recovery and capacity are **UNVERIFIED**. No performance improvement is established by the four execution trials.

To review the shipped surface, sign in and open Account from the workbench. Verify the identity, verification and security metadata; follow Administration to Overview and Access. People/Audit must show an unavailable message until migration, rather than a zero count. Open the workbench again and inspect the new runs' manifest, prompt-application, observation and grade artifacts. Do not treat an edited binary alone as proof that the model received the edited prompt.

Private deployment logs, exact artifact manifests and sanitized HTTP evidence are retained in `TraceHarness-accounts-execution-2026-11-12` under the operator's Documents directory. Database rollout prerequisites and tests are recorded in the site's `auth/ACCOUNT_BACKEND_ROLLOUT.md`.
