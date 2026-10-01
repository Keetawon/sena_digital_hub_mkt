# Demo-first implementation — 1 October 2026

Owner authorization and execution order: [PHASE1_PRIORITIES](PHASE1_PRIORITIES.md).
Each task is committed and pushed separately after its five required checks. Only
local TEST/synthetic data is used; external source systems remain read-only.
No deployment, real-document upload or production approval is implied.

## Task 0 — recorded decisions

Recorded P3.0/P4.0 approval, demo-first defaults, the expanded staff-only assistant,
confirmed draft-text proposals, hosting boundaries and Q36–Q38. Doc 22 §6 specifies
the thirteen tools, existing domain permissions, separate internal indexes, the
future published-only public boundary, SSE evidence validation and Thai golden
questions. The canonical assistant skill and Claude pointer now share that scope.

The owner's LINE OA addendum defers Q18/Q20 and removes them from the forthcoming
questions page. CHANNEL rows remain in one unattributed `LINE OA (ยังไม่แยกบัญชี)`
bucket; no OA matching-review screen is authorized for the demo. Existing P1/P2
behavior and `sena_h_approved=false` are unchanged.

Verification on this workstation:

| Command | Actual result |
|---|---|
| `npm.cmd run typecheck --prefix apps/admin` | Exit 0, `tsc --noEmit` |
| `npm.cmd run build --prefix apps/admin` | Exit 0, compiled successfully; existing Google Sans fallback-metrics warning |
| `npm.cmd run test:db` | Exit 0; role/RLS/publication/import tests and concurrency checks passed; frozen export tests `pass 2`, `fail 0` |
| `uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests` | `716 passed, 2 warnings in 72.89s` |
| `PLAYWRIGHT_CHANNEL=msedge npm.cmd run test:ui` | `73 passed (4.5m)`; exit 0 |

The first database attempt returned `ECONNREFUSED 127.0.0.1:55432`; the first API
run returned `3 failed, 713 passed` because PostgreSQL was stopped. Starting the
local server in the sandbox encountered `uv_os_get_passwd returned ENOMEM`; the
authorized local server started successfully outside the sandbox. The reruns above
are the successful results. No database reset was performed. The two API warnings
are existing Starlette/httpx and AnyIO deprecations.
