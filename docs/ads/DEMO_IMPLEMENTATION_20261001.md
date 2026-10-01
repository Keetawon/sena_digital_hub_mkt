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

## Task 2 — P3 TEST read-back: design before code

Consume the verified four-mart DW TEST package, not a new ledger ingestion. Freeze
its original manifest/arrays as contract fixtures; validate hashes, ordered schemas,
counts, keys, exact decimals, temporal provenance and cross-relation references before
an explicit local apply. Migration `202610010016_ads_actuals.sql` adds forced-RLS
staging generations, an atomic current-generation pointer and separate audited
finding/follow-up workflow. Exact replay is a no-op; conflicting/partial deliveries
cannot replace the last good generation. The importer has no DW write connection.

The staff actuals, document tracker and C5/C6 queue use caller permissions. Read
document references from existing P2 records; never re-key them, infer a deadline,
auto-verify a document or recompute a DW finding in Hub. Follow-up copies are logged
as COPIED only after clipboard success. Explicit actions link to P2 assignment and
correction flows. A newer complete failing generation reopens a resolved finding;
failed refreshes and replay do not. Budgets, platform media, card cash and monthly
recognition remain separate. Nullable/evaluation-unavailable facts remain unknown.

Use the existing `PendingQuestion` component for Q24–Q28 and current motion tokens.
Agencies and residential-only roles retain financial denial. Future synthetic DW
dates are labelled `ข้อมูลตัวอย่าง`, never described as fresh real observations.
LINE OA remains a single unattributed CHANNEL bucket with no matching screen.
The approved TEST adapter differences and operating defaults are recorded in doc 25 §13.

Implemented three Thai staff screens with the shared motion primitives, filters,
deep-linked details, reference-derived document follow-ups and a C5/C6 workflow.
The ten new browser cases include real API/proxy read-through, denied roles,
unknown metrics, distinct cost bases, clipboard failure and reduced-motion/mobile.
The importer preserves the DW package's original bytes; it has no DW credentials or
write path. Owner-identified producer commit is
`ec2a182c436783adb0a641479357b792ab97523f`.

| Frozen relation | Rows | Columns |
|---|---:|---:|
| `dim_media_line` | 13 | 38 |
| `bridge_native_campaign_media_line` | 17 | 38 |
| `fact_media_line_monthly` | 8 | 35 |
| `fact_marketing_ops_finding` | 73 | 36 |
| Total | 111 | 147 |

The verified package fingerprint is
`690bc3b2a1135eba88a15c66d1eb98784bf1019c24cb4647f5ca544b35108e77`.
The operator dry run returned `VALIDATED_DRY_RUN`, apply returned `APPLIED`, and an
exact replay returned `NOOP`, retaining snapshot
`4e7f2eaf-8807-4f39-9aa0-b4750d37211f`. The separately enabled database importer test
proved conflicting replay and failed row insertion quarantine with no partial
publication. Its own source/workflow changes rolled back.

Migrations 0016–0020 preserve their applied checksums. Forward fixes keep admin's
existing staging namespace denial, deduplicate component document requirements,
reopen recurrences across an intervening unknown evaluation and mark source changes
as requiring refresh. The private change check reads only audit table/write-time
columns, returns a boolean and never exposes audit records. No P1/P2 behavior,
grammar, issued name, old fifteen-view fixture or approval setting changed.

Resolved failures during verification: the first migration attempt had a SQL alias
syntax error; importer integration then exposed missing namespace access. The first
full database check caught the attempted grant violating the existing brand ACL
invariant, so the intake functions moved into `ads` and that grant was revoked.
Rollback-only preflights verified the later SQL fixes before applying them. Two API
test assertions were corrected to expect SQL-owned owner resolution rather than
client owner IDs. The first focused Edge run had two selector failures; its rerun
passed all ten. The first full Edge run returned `1 failed, 89 passed (4.9m)` because
an existing P2 status assertion matched both a definition and a table cell; the
assertion now selects the exact definition. This is a test-only P2 file change.

Desktop and 390px screenshots of the actual loaded read-back were inspected after
motion settled; the narrow layout had no horizontal page overflow. Synthetic
coverage years remain visibly labelled. Per the addendum, Task 6 must select its
coherent demo-seed months for presentation, without altering the frozen DW dates.

Final Task 2 verification on this workstation:

| Command | Actual result |
|---|---|
| `npm.cmd run typecheck --prefix apps/admin` | Exit 0, `tsc --noEmit` |
| `npm.cmd run build --prefix apps/admin` | Exit 0; three P3 routes built; existing Google Sans fallback-metrics warning |
| `npm.cmd run test:db` | Exit 0 through migration 0020; all existing SQL/RLS checks, new P3 workflow/reference checks and three P3 concurrency scenarios passed; frozen export tests `pass 2`, `fail 0` |
| `uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests` | `851 passed, 2 warnings in 94.15s`; `HUB_ACTUALS_IMPORT_TEST=1` enabled the real rollback importer test |
| `PLAYWRIGHT_CHANNEL=msedge npm.cmd run test:ui` | `90 passed (4.9m)`, exit 0 |

`check:questions` reports 39 matching IDs. Original DW/Hub package byte comparison
and all ordered-column/hash/count checks passed again after implementation.
The local approval-setting query confirmed `sena_h_approved=false`. No DW writes,
hosted provisioning, real data or external source-system access occurred.
