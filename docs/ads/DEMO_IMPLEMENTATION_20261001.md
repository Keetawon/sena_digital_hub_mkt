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

## Task 3 — residential demo: design before code

Task 2 was pushed as `259f1e5`. The next slice follows
[doc 26](../26-residential-demo-and-atomic-release.md): per-project structured
promotions with read-time expiry, one transactional brand/project/model/promotion
release and guarded whole-release rollback, and gap-only synthetic HYABC/FLEXI
content with visible field provenance. Q40/Q41 record the local review and release
defaults; real legal approval and consumer deployment remain separate decisions.

Implementation adds `/promotions` and `/releases`, per-project review-bound
promotion snapshots and read-time expiry, and an atomic release history. Models
remain part of their project snapshot. Normal editorial publication remains strict;
the explicit local demo mode uses a seeder-owned synthetic asset/model selection.
The seed preserves HYABC's two unapproved original assets and thirteen suggested
source models, fills only empty marketing fields and labels each introduced field.
`npm.cmd run dev:residential-demo` is the local residential seed step; Task 6 will
compose it into the complete demo. Q40/Q41 capture these defaults; the catalog now
has 41 entries and still omits owner-deferred Q18/Q20 from the presentation page.

Preliminary checks (not the final Task 3 gate): promotion API, seed unit checks and
question tests returned `91 passed, 1 skipped, 2 warnings in 8.34s`; the opt-in seed
database check was deliberately skipped until migration 0021 is ready. The first
admin build exited 0 with the existing Google Sans fallback-metrics warning.

Migration 0021 was first rehearsed inside a rollback-only transaction. That caught
one ambiguous `payload` reference in promotion readiness, fixed before application.
The final rehearsal passed schema, SQL/RLS cases, HYABC seed/replay, complete demo
release and rollback. Only then was 0021 applied; no forward correction migration
was needed. The persisted seed returned `SEEDED` twice, with eight introduced field
paths initially and none on replay. The integration check verifies original model
records, bindings and asset rights remain identical and saved user edits survive.

The mixed SQL release case includes brand, project with model edits and two
promotions. One invalid member leaves all prior pointers/history intact. Successful
publication includes the model draft; rollback restores all previous snapshots
without rewriting the draft, and rejects later independent publication. Concurrent
releases and a draft edit racing publication both reject the stale operation.

Final Task 3 verification:

| Command | Actual result |
|---|---|
| `npm.cmd run typecheck --prefix apps/admin` | Exit 0, `tsc --noEmit` |
| `npm.cmd run build --prefix apps/admin` | Exit 0; `/promotions` and `/releases` built; existing Google Sans fallback-metrics warning |
| `npm.cmd run test:db` | Exit 0; all previous SQL/RLS and concurrency checks, mixed residential release/rollback, two new concurrency cases and frozen fixture checks passed (`pass 2`, `fail 0`) |
| API pytest with `HUB_ACTUALS_IMPORT_TEST=1` and `HUB_PROMOTIONS_TEST=1` | `924 passed, 2 warnings in 80.29s (0:01:20)` |
| `PLAYWRIGHT_CHANNEL=msedge npm.cmd run test:ui` | `101 passed (5.4m)`, exit 0 |

The focused Edge suite passed eleven tests. An earlier focused attempt overlapped
the server restart and reported eight connection refusals plus one pass; it was
rerun once the server was ready. Desktop and 390px screenshots of the real seeded
pages were inspected; there is no horizontal page overflow. The approval-setting
query still returns `sena_h_approved=false`.

## Task 4 — private synthetic document archive

Task 3 was pushed as `dba493f`. The design-before-code note is doc 21 section 12.
Migration 0022 adds private hash/version receipts, leased worker jobs, immutable
extraction and review records, a separate P2 handoff receipt, memo-only snippets
and restricted access audits. It was rehearsed with the complete SQL suite inside
a rollback before persistent application. The rehearsal caught a grant loop that
included indexes; that was fixed before application. Applied migration SHA-256:
`663a91a24af0a01cb8e95625161c1d226e69ef86174c6d3d04b7195af0800966`.

The `/ads/archive` UI accepts known synthetic fixtures only. Online staff and admin
can inspect source versions/pages, compare original OCR with corrected values,
confirm transcription and separately create/link a P2 record. Admin controls legal
holds. Every read/download is audited; no storage key enters the browser JSON.
Statements cannot enter the restricted memo index or any other retrieval surface.
P2 handoff leaves memo/cost review separate and preserves the owner-deferred LINE
OA bucket. Alias spelling must be explicitly approved before linking a memo.

`dev:document-demo` installs three deterministic source fixtures and queues two
initial documents. The first worker drain produced one text-layer memo DRAFT and
one five-page OCR statement DRAFT with ten occurrences; replay returned the same
document IDs and the next drain returned `IDLE`. The statement total is THB
4,812.00, including a negative refund and three identical CHANNEL occurrences.
All observed amounts, dates and page counts matched the independent source fixture.
An OCR descriptor error was retained and flagged; balanced totals cannot bypass
row-by-row checks. The worker never reads the validation ground truth.

The real local OCR test returned `7 passed in 5.67s`. Windows.Media.Ocr on this
workstation supplies English recognition and word boxes, with no per-field
confidence score. Thai OCR, production document variability and the broader
engine benchmark remain Q30; these synthetic checks are not those evaluations.
Fixture rendering depends on the installed font, so each host registers its own
generated byte hashes. No external OCR/model call, real upload or R2 provisioning
occurred. Q1/Q7/Q21/Q22/Q23/Q29/Q30 link to the archive; Q18/Q20 remain excluded.

Focused API checks returned `45 passed, 2 warnings in 7.84s`; the opt-in real
rollback integration returned `1 passed, 2 warnings in 1.12s`, and verified all
tracked table counts were restored. Focused Edge checks returned `10 passed
(16.7s)`. Full API verification with all four integration/OCR flags returned
`977 passed, 2 warnings in 148.07s (0:02:28)`. The full database command exited 0,
including three new archive concurrency cases and frozen fixtures (`pass 2`,
`fail 0`). Typecheck/build exited 0; the existing Google Sans fallback warning
remains. Full browser verification is recorded below when complete.

Real-source visual review caught a P2 collection-envelope mismatch and global
frame headers blocking the memo preview, fixed with a real-response regression
and a UUID-scoped same-origin archive PDF exception. The first full Edge run
returned `111 passed (5.7m)` before these visual fixes. A rebuilt memo renders
correctly, but Edge's sandboxed image-only PDF remains blank. Statement preview
therefore uses an authenticated exact-source raster endpoint, while preserving the
PDF sandbox and separate original download. Pixel comparison tests verify source
pages 1, 3 and 5 are identical, and reject unsupported rotation/composition rather
than misrepresenting a partial page. The expanded worker/storage/OCR suite returned
`8 passed in 7.04s`. The final browser run includes the real-source regression.

The intermediate full run returned `112 passed (5.5m)`. After the statement-image
fix, the focused API checks returned `48 passed, 2 warnings in 11.89s`, real
rollback integration `1 passed, 2 warnings in 2.45s`, and focused Edge checks
`12 passed (19.8s)`. The final typecheck/build exited 0. Desktop and 390px source
previews were inspected again: memo text and statement page 5 are visibly rendered,
with no JavaScript errors or horizontal overflow. The card now uses the available
desktop width for the dense Thai review table. Generated screenshots stay ignored.

Final Task 4 verification: typecheck and production build exited 0; the complete
database suite exited 0, including all three archive concurrency cases and frozen
fixture checks (`pass 2`, `fail 0`). API pytest with all four opt-in integration/OCR
flags returned `981 passed, 2 warnings in 168.42s (0:02:48)`. Edge returned
`113 passed (5.7m)`. The 41 question IDs agree between the catalog and this decision
register, and `sena_h_approved` remains false. No live external service was called.

## Task 5 — staff assistant and grouped navigation

Task 4 was pushed as `ccea0e6`. The before-code assistant note is doc 22 section
6.8; the owner subsequently requested grouped sidebar navigation in the same next
commit without a separate design note. This replaces the finance divider and
single workspace label, retaining role visibility and using existing motion tokens.

The locked API environment installs `openai-agents==0.22.3`. One SDK agent exposes
thirteen typed read-only readers; each opens a short caller-RLS transaction.
The model selects run-owned fact IDs and the server renders values and citations.
Current source versions, promotion eligibility and caller identity are checked
before answer delivery and again when citations are opened. No raw prompts or
documents are recorded in run audits. Statements are excluded from retrieval.

V2 has a separate local SDK proposal tool, visible diff and explicit once-only
confirmation through normal draft functions. It can edit only the three existing
synthetic text paths documented in Q43. The local fake proposal deliberately adds
a sample-content label; it is not evidence of live-model copywriting quality.
Other locales, source markers and publication pointers remain unchanged.

Migration 0023 was rehearsed with SQL/RLS assertions inside a rollback before
application. SHA-256: `8cd7bb7ca78de9e901b052a408d607ca3fe2bea2493105423d067c41e1068f15`.
The full database command then exited 0, including both new concurrency cases:
same-proposal confirmation applies once; different stale proposals cannot overwrite
a confirmed draft. Frozen DW fixture checks remained `pass 2`, `fail 0`.

The fictional assistant seed returned the same project on replay without mutation.
The SDK suite returned `33 passed in 4.05s`, including all thirteen real typed tool
schemas, a real caller-RLS project read and a simulated provider boundary check.
The latter uses a test double, not the OpenAI API. The real provider check has not
run; no external request or deployment is part of these verification results.
Q36/Q38 and new Q42–Q44 explain the egress, model, retrieval, draft and temporal
defaults. Q18/Q20 remain owner-deferred and absent from the questions page.

Final admin typecheck and production build exited 0; the existing Google Sans
fallback-metrics warning remains. The full database command exited 0, including
SQL/RLS assertions, both assistant concurrency cases and frozen DW fixture checks
(`pass 2`, `fail 0`). Full API pytest with all five opt-in integration/OCR flags
returned `1041 passed, 1 warning in 188.73s (0:03:08)`.

The real thirteen-reader integration returned `1 passed in 1.43s`: every reader
returned nonempty caller-RLS data and all fixture changes were rolled back. The
HTTP proposal/citation integration returned `1 passed in 5.37s`, covering explicit
confirmation, replay, stale drafts and actor ownership with rollback verification.
Focused assistant/navigation Edge checks returned `19 passed (39.0s)`.

Desktop and 390px visual review found and fixed sidebar-trigger contrast and
mixed-source demo provenance. Sample badges now identify individual synthetic
fields without relabelling original REM identifiers. Exact-version source links
returned HTTP 200; inspected screens had no horizontal overflow or JavaScript
errors. The 44 question IDs agree between catalog and documentation, and
`sena_h_approved` remains false. A presence-only check found no configured OpenAI
API key; no real provider request or live-model quality evaluation was run.

The first complete Edge run returned `1 failed, 128 passed (6.1m)`: the existing
questions-page test still located the removed one-off navigation label. The test
now checks the named current question link in the shared menu and explicitly
checks financial links are absent for residential-only roles. This change does
not alter application permissions. The complete rerun is recorded below.

Final Edge verification returned `129 passed (6.2m)`, exit 0, including the
questions-page regression and the grouped-sidebar accessibility cases. All five
required Task 5 commands passed before commit.
