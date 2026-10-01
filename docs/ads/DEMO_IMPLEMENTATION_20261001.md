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

## Task 1 — question remarks: design before code

Use one versioned JSON catalog inside the API package, containing English table-row
fields and Thai question/default/owner/screen labels. A Python sync command writes
the question rows in OPEN_QUESTIONS and its `--check` mode rejects drift or missing
IDs. Runtime code reads the catalog, not Markdown. Changing a question never changes
an approval setting or permission. Q9–Q12 are resolved; Q18/Q20 are owner-deferred;
neither group appears among pending questions or inline remarks.

`GET /v1/admin/questions` returns only pending Thai presentation fields to editor,
publisher, viewer, online_staff and admin. These are policy questions, with no
financial records or personal data. Agency/service_consumer and anonymous callers
are denied. Financial/content screens retain their own separate authorization.

The `/questions` staff page groups entries by P'Note, Finance, DPO, Media, Marketing
and IT, with Thai group labels and affected-screen links. One shared `PendingQuestion`
badge opens an accessible explanation popover with ID, default and accountable owner.
Reuse the existing semantic colors, `hub-pop`/motion.css tokens, keyboard focus,
Escape/dismissal behavior and reduced-motion override. No animation dependency or
new timing is introduced. Existing registry approval banners remain unchanged.

Task 1 checks cover catalog/document consistency, five allowed roles, denied roles,
deferred/resolved exclusion, links, Thai labels, keyboard/focus and reduced motion.
Q39 records the staff policy-page default for review; no new database table is needed.

Implementation: 39 catalog entries, 33 pending; Q2 appears beside the existing
registry banner and Q24 beside finance content. All five staff personas can use the
questions page; financial records remain denied to residential-only roles. The
catalog's English rows retain policy detail while Thai remarks explain the demo
default. `npm.cmd run sync:questions` renders reviewed catalog changes into this
document's companion OPEN_QUESTIONS; `check:questions` and API pytest detect drift.

| Task 1 command | Actual result |
|---|---|
| `npm.cmd run typecheck --prefix apps/admin` | Exit 0, `tsc --noEmit` |
| `npm.cmd run build --prefix apps/admin` | Exit 0; `/questions` included; existing Google Sans fallback-metrics warning |
| `npm.cmd run test:db` | Exit 0; SQL/RLS/concurrency checks passed; frozen fixtures `pass 2`, `fail 0` |
| `uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests` | `736 passed, 2 warnings in 82.24s` |
| `PLAYWRIGHT_CHANNEL=msedge npm.cmd run test:ui` | `80 passed (4.8m)`; exit 0 |
| `npm.cmd run check:questions` | `Question catalog/document rows agree: 39 IDs` |

The first focused Edge run returned `1 failed, 6 passed (12.7s)`: an alert selector
also matched Next's hidden route announcer. The assertion now scopes the question
page. The first full API run returned `1 failed, 735 passed`: the new assertion
expected the literal word `false` in a Thai explanation after that wording was
simplified. It now verifies the false setting in the English policy and the explicit
production-issuing block in Thai. The passing API rerun is recorded above. Neither
fix changed an approval or domain permission. Inspected desktop questions and
popover screenshots; the Thai text and controls were readable in those samples.
