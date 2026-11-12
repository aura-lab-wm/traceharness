# Reviewed account approval release

The account approval interface and its guarded backend are implemented and deployed in the Worker. Production approval remains disabled: the required Supabase migrations, effective grants, enrollment callback and delivery configuration have not been verified. This release does not finish the proposed account platform.

## What changed

- Administrators can use bounded, cursor-paginated request inspection once the database exposes that capability. Request reads and approval are separate capabilities; installing the base account migration does not enable either accidentally.
- Approval freezes the fresh request UUID, revision and recipient. It requires an exact-target MFA proof and an explicit confirmation. Proofs stay in transient memory. A lost acknowledgement offers a read-only status check without retrying the approval or sending another invitation.
- The database candidate checks effective privileges, including inherited, PUBLIC and column grants. Missing dependencies leave account context readable but keep approval unavailable. Both MFA steps re-read authority, and the approval transaction independently checks readiness.
- A separate legacy-approval freeze can stop the old endpoint before it creates a provider account. The reviewed cutover removes direct authenticated request mutations only after that freeze and reconciliation of in-flight requests. The candidate transaction aborts if unexpected privileges remain.
- The delivery adapter validates the outbox identity, recipient, lease and completion acknowledgement. Provider acceptance, uncertain delivery and actual account activation remain separate outcomes. The adapter is not an automatic delivery dispatcher.
- Chrome testing caught an HTML template escape bug that raw JavaScript tests missed: a regular-expression escape emitted a NUL byte into the page. The emitted scripts now preserve the escape, and regression checks cover HTML control bytes.
- Session identity lookup now has one eight-second deadline for the provider fetch and bounded JSON body. Stalled cancellation cannot hold the request open, and a late provider response cannot authenticate a request after its deadline. Generic write/retry semantics are unchanged.
- A default-off maintenance control can refuse new launches and experiment starts/resumes before body reading or runner contact. It preserves reads, preflight, cancellation and credential revocation. It has not been activated, and it is not a complete backend drain barrier.

## Verification boundaries

| Evidence | Result | Meaning |
| --- | --- | --- |
| Final Worker suite | 398 passed, no failures or skips | Local authorization, network-contract and UI behavior tests |
| PostgreSQL suite | 22 passed | Candidate migrations and effective-role tests in an isolated local cluster; no production credentials or TCP listener |
| Native Chrome, labelled synthetic fixture | Approval and uncertain-response reconciliation passed | Local browser behavior, with external networking disabled; no real MFA, invitation or SQL mutation |
| Production anonymous page gates | `/app`, `/app/shallow`, `/link`, Account and Admin redirect to `/login` | HTTP 302; core three also checked with `curl`, `traceharness-proof` and `--max-redirs 0` |
| Production anonymous APIs | Exact sign-in-required 401, including hostile Origin | No `Access-Control-Allow-Origin` |
| Real operator session | Account/Admin pages and identity/security APIs return 200 | Existing database-profile authority and provider security metadata; no privileged action performed |
| Signed-in hostile Origin | 403 on all seven checked account/admin surfaces | Cross-origin gate retained |
| Directory, audit and new request inspection | 503 | Correctly unavailable pending migration; not an empty dataset or an administration success |
| Production runner catalog | 200; three runtimes and eight tasks listed | Authenticated catalog/read path passed; no new task execution or model charge |
| Fresh post-deployment Chrome review | UNVERIFIED | Computer-use service reported `stageManagerProcessNotRunning`; browser access host was unavailable |

No JWT, password, action proof or provider credential is included in the evidence. Production mutation was limited to normal sign-in and the authorized Worker publication. No SQL, account role, invitation, MFA factor, zone route or KV snapshot was changed.

## Publication

- Final site commit: `e86fa1b39e77af3fda6e90a114d51c3db59d8078`, local only. Approval implementation was committed separately as `341d85ee68694e3b59ceb5ed2d05b85517c72ce3`.
- Final Worker version: `1b9060c5-7bae-4bc9-9911-a64283b3c689`; deployment exit 0. Initial approval version `5d0b8fec-cefb-41f2-bc50-53febaf918b7` was superseded by the authentication-deadline and runner-pause safeguards. Both deployments kept existing variables and introduced no activation flag.
- Full workbench snapshot remains the previously reviewed `app-account-reviewed.html.gz`; no new KV upload.

Initial approval deployment, exit 0; last ten log lines:

```text
Total Upload: 400.50 KiB / gzip: 93.26 KiB
Worker Startup Time: 2 ms
Your Worker has access to the following bindings:
Binding                                                  Resource
env.SNAPSHOT (8a74dd2fba124b1a8d82e6eeff5ba3ae)          KV Namespace
env.ADMIN_EMAILS ("amastropaolo@wm.edu")                 Environment Variable

Uploaded traceharness-platform (2.66 sec)
No deploy targets for traceharness-platform (0.99 sec)
Current Version ID: 5d0b8fec-cefb-41f2-bc50-53febaf918b7
```

Final safeguard deployment, exit 0; last ten log lines:

```text
Total Upload: 402.88 KiB / gzip: 93.87 KiB
Worker Startup Time: 2 ms
Your Worker has access to the following bindings:
Binding                                                  Resource                  
env.SNAPSHOT (8a74dd2fba124b1a8d82e6eeff5ba3ae)          KV Namespace              
env.ADMIN_EMAILS ("amastropaolo@wm.edu")                 Environment Variable      

Uploaded traceharness-platform (3.80 sec)
No deploy targets for traceharness-platform (0.75 sec)
Current Version ID: 1b9060c5-7bae-4bc9-9911-a64283b3c689
```

## Remaining dependencies

The runner optimization candidate was built successfully as `registry.fly.io/traceharness-runner@sha256:5d2a22cbfe2033195cdfe5f67b516b277113dc15c4f43a1fb2a671a87ebfe7a5`. Six offline checks passed: isolated provider imports, actual spawned-process HTTP error/privacy handling, stalled-child termination, legacy factory compatibility, authenticated ASGI lifecycle and unchanged controller/executor/registry source hashes. No model requests were made by those checks.

The candidate is **not deployed**. The current runner cancels active jobs during shutdown. Checking an idle queue alone races new submissions, and running experiments can submit jobs between checks. A Worker admission pause alone also cannot establish retirement of old in-flight Worker invocations or fence trusted direct HMAC callers. A verified admission barrier and complete global job/experiment drain are required before replacing the current v17 runner. The existing four passed jobs are not evidence for this candidate image.

The Supabase management connection for project `gclowkdcyvyhgbsfcyqk` is still unavailable. Production schema/grant inspection and tracked migration must precede activation. The operator's current tested session has AAL1 and no enrolled factor, so it does not establish the exact-target MFA approval journey.

General session inventory/revocation, refresh-session management, role changes with last-owner protection, cross-plane suspension and lost-factor recovery remain unfinished. Production two-member isolation, invitation delivery/acceptance, account activation and capacity remain UNVERIFIED.

The four earlier native Codex task passes remain v17 execution evidence. They do not establish performance improvement or make historical unknown charges disappear. See [the earlier account/execution report](ACCOUNT_EXECUTION_RELEASE_2026_11_12.md) for those results.

Private HTTP receipts, full test logs and deployment receipts are retained in `TraceHarness-account-approval-2026-11-12` under the operator's Documents directory. The local site's `auth/ACCOUNT_BACKEND_ROLLOUT.md` records the exact migration and cutover sequence.
