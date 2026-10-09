# Permissions implementation log

Owner programme: 9 October 2026. Starting commit: `12772c3` on `main`.
Local execution only. Push is deferred until the final full suite passes. Each phase must pass typecheck, offline build, DB, API, UI and loopback H1 gates before the next begins. No owner testing between phases.

## Working database preservation

Before any new migration: native PostgreSQL custom-format `pg_dump` saved to `.local/backups/permissions-before-20261009/sena_hub_local.dump` (6,297,298 bytes). Ignored baseline metadata is alongside it. Baseline: BNA7 exists once in `staging.rem_projects`; eight existing Hub accounts. BNA7 is staged REM source data, not an existing Hub project draft. Working cluster: `.local/postgres`. Test databases are separate disposable clusters. Checkpoint verification after Phases A/0 passed on 9 October 2026: BNA7 still present; the exact eight pre-existing account IDs are intact; 279 staged REM projects and four Hub projects remain. No working migration was applied. PostgreSQL/API/admin were restarted; health, home and Accounts returned HTTP 200, and the demo admin remained ACTIVE. Repeat this verification after subsequent working migrations.

## Phase status

| Phase | Status | Commit | API / UI / DB / H1 gates |
|---|---|---|---|
| A — responsive sidebar | Passed | `72c262f` | Typecheck/build passed; API 1,444 passed + 11 skipped; DB 51 reported checks + 7 Node cases; H1 11 + 38 passed; UI 213 passed (208 → 213); sidebar rerun 13 passed |
| 0 — baseline manifests | Passed | `08267d3` | Typecheck/build passed; API 1,444 → 1,495 (+11 unchanged skips); DB 51 + 7 and 1,040 SQL probes passed; H1 11 + 38 passed; UI 213 → 213 passed |
| 1 — foundations | Passed | This phase commit (hash recorded by Phase 2) | Typecheck/build passed; API 1,495 → 1,527 (+11 unchanged skips); UI 213 → 214; DB 51 + 7 plus foundation SQL probes; H1 11 + 38 |
| 2 — content core | Not started | — | — |
| 3 — publication and knowledge | Not started | — | — |
| 4 — registry | Not started | — | — |
| 5 — finance, operations, archive | Not started | — | — |
| 6 — shared and residual authority | Not started | — | — |
| C — account grid and feature onboarding | Not started | — | — |
| UAT — synthetic personas and owner pack | Not started | — | — |

Counts are recorded from executed gates, not inferred from the prior report. Previously reported baseline: API 1,444 passed / 11 skipped, UI 208 passed, H1 11 protocol + 38 browser; Phase A measured DB count: 51 reported checks plus 7 Node cases.

## Phase A

Implemented desktop expanded/64px rail with guarded browser persistence, tablet rail with native modal overlay, unchanged mobile drawer, focus/hover labels, rail count badges, assistant icon entry and removal of sidebar footer text. Saved group state now takes precedence over the active page; collapsed active groups are marked. No sidebar transitions.

### Decisions taken for owner review

- Tablet overlays close on viewport changes and are not persisted open; a fresh tablet page defaults to the rail. Desktop collapse preference is persisted independently.
- Use the existing native dialog for the tablet overlay, including focus containment and Escape. No new dependencies.
- Tooltips supplement explicit accessible names; counts remain available to screen readers.

### Validation / deviations

Typecheck passed. Automated sidebar cases added for persistence, active-group collapse, keyboard tooltips, badges, tablet focus return and outside close, and 1280/1024/400px page overflow. API passed: 1,444 + 11 pre-existing opt-in skips (289.42s); DB passed: 51 reported SQL/concurrency checks + 7 Node cases; loopback H1 passed: 11 protocol + 38 browser. UI 213 passed (208 → 213); sidebar rerun 13 passed. Offline build uses the documented `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` hook and `--webpack`; default Turbopack cannot resolve that existing mock and was not used for the successful gate. No migrations applied to the working database.

## Conversion report

The Phase 0 action manifest is frozen. Phase 1 has copied the templates and introduced the manage-users flag; domain migrations remain ahead. The detailed differences and owner answers below distinguish accepted changes from the superseded proposal to restrict published consumer feeds.

## Resume

Phases A, 0 and 1 are complete. Resume Phase 2 content core. Migration 46 is applied to the backed-up working local database, with BNA7 and every existing account field verified intact. Do not push until the final full programme gates pass. Restore the preserved working services after tests.

Phase A full UI gate: 213 passed in 6.5 minutes, no skips/retries/failures. All 13 sidebar cases passed. Screenshot review prompted an explicit overlay-visible wait; the focused sidebar rerun passed all 13 cases in 19.2 seconds. Artifacts: `artifacts/permissions/sidebar-{1280,1024,400}.png`, `sidebar-rail-1280.png`, `sidebar-overlay-1024.png`. No authorization SQL changed in this phase, so permission-specific DB deny additions start with the permissions phases.


## Phase 0 — baseline manifests

Recorded the 9 October decisions in docs/34 §10. Route manifest: 200 concrete method/path pairs plus ten H1 fallback method/path patterns. Entry probes use real Hub account lookup, eight synthetic personas (six roles, consumer and the second agency), all four statuses and forged role/agency claims. They stop before domain handlers; this measures the entry ceiling, while the existing domain suites and new direct SQL probes cover the DB boundary. Do not describe the route-entry probes as full mutation acceptance.

Read-only catalog inspection on the verified disposable cluster through `hub_runtime` (NOSUPERUSER, NOBYPASSRLS): 223 functions, including 134 SECURITY DEFINER functions; 164 policies; 119 tables/views. Fifteen existing tables lack RLS, including staging reference sources, the progress cache/dirty queue, asset-role vocabulary and generic audit history. These are explicit migration/coverage work, not an assertion that all current tables are protected by RLS.

### Conversion differences identified for owner review

- Publisher loses project editing/model review through API/DB as required by content E/A separation; this also removes project draft proposals from the assistant. The earlier report called this an API-versus-UI difference; it is not safe to assume the database already denies every edit.
- **Superseded by the owner on 9 October:** published consumer payloads remain available to every ACTIVE internal account irrespective of boxes. Existing agency/external boundaries are preserved. No published-feed narrowing is part of conversion; hidden-tab restrictions apply to management, draft and internal data.
- Admin loses direct Hub-role execution of registry approval-switch/cancellation stewardship. This is explicitly operator-only under the new decision; it is not a manage-users power.
- Global asset lists and bytes must narrow to authorized bindings (with a bounded upload/review workflow for new files). Old global asset visibility is not a grandfathered bypass. Exact affected endpoints and uploader handling will be recorded in Phase 2.
- Templates otherwise preserve the intended baseline work, with named specials preserving operational distinctions. Further differences must be added before enabling their phase.

### Decisions taken for owner review

- Checked permission manifests are maintained test contracts; raw catalog captures, logs, screenshots and DB dumps stay ignored. No account data is included in a manifest.
- Tests verify the disposable directory and marker on the same operator connection before fixture setup AND cleanup. Automatic review rejected the first draft's ambiguous fixed-port setup; it was never written or executed. The revised fixture includes these checks explicitly.
- The full regression API command always collects the API directory; targeted probes must use `-k` rather than adding a file path alone.


Phase 0 interim validation: all 33 route-manifest/persona-state cases passed (6,400 method/path entry probes), alongside the full API suite: 1,477 passed, 11 existing opt-in skips. The baseline now explicitly records schema USAGE as well as relation/function grants: revoked staging schema access makes several residual table grants unusable. Catalog comparison passed after normalizing PostgreSQL internal `char` and role-array driver representations. Direct SQL baseline probes and final phase gates are still in progress.


### Existing opt-in API skips

These 11 cases were skipped by the existing full-suite configuration; no new baseline test is skipped. H1 has its separately executed browser/DB simulation. No flaky retry was used in Phase A.

- `apps/api/tests/test_actuals_import.py::test_real_import_replay_conflict_and_failed_rows_preserve_last_good`
- `apps/api/tests/test_archive_db.py::test_archive_review_application_evidence_versions_and_private_access`
- `apps/api/tests/test_assistant_db.py::test_assistant_http_citations_generated_proposal_and_explicit_save`
- `apps/api/tests/test_assistant_model.py::test_sdk_reads_fictional_project_through_real_caller_rls_without_egress`
- `apps/api/tests/test_assistant_tools_db.py::test_all_thirteen_readers_real_rls_exact_evidence_and_domain_boundaries`
- `apps/api/tests/test_demo_finance.py::test_finance_seed_real_controls_replay_preserved_edits_and_complete_snapshot`
- `apps/api/tests/test_document_worker.py::test_real_local_image_ocr_preserves_all_occurrences_and_exact_money`
- `apps/api/tests/test_hosted_h1.py::test_disposable_managed_simulation_end_to_end`
- `apps/api/tests/test_hub_demo.py::test_complete_business_seed_replay_rolls_back_and_preserves_document_work`
- `apps/api/tests/test_promotions_db.py::test_real_promotion_snapshots_approvals_atomic_release_and_stale_rollback`
- `apps/api/tests/test_residential_seed.py::test_seed_replay_preserves_originals_and_user_edits`


Phase 0 final API gate: 1,495 passed / 11 unchanged skips (309.55s), including 34 route coverage/authentication/persona-state cases and 17 DB baseline cases. The revised positive Project RPC probe was rerun: all 17 DB cases passed (8.31s). Typecheck, offline webpack build, the 51 DB checks + 7 Node cases, and H1 11 protocol + 38 browser tests passed. UI gate is running; do not start Phase 1 until it passes.


Phase 0 complete: full UI 213 passed (6.7m), no skips or retries. All six gates passed. Final source adds 51 API test cases (34 route/identity cases + 17 DB cases); 6,600 route probes include anonymous requests, and 1,040 direct SQL entry probes cover eight personas. No application authorization or migrations changed in Phase 0. No hosted request, email or external-system write occurred.


## Session checkpoint after Phase 0

A is `72c262f`. Phase 0 is the commit containing this entry (subject `test: freeze permission baseline and owner decisions (phase 0)`); its literal hash is recorded in the session report and will be copied into the table by Phase 1, avoiding an impossible self-referential commit hash. No push has been made. No permission storage/enforcement, account grid, onboarding or final UAT pack is implemented yet. **Resume Phase 1**, then continue 2–6, C and UAT with all gates per phase. Do not request intermediate owner testing.

Working services have been restored directly from the preserved `.local/postgres` cluster, without a seed/migration runner. API and admin listen on `127.0.0.1:8000` and `127.0.0.1:3000`; PostgreSQL on `127.0.0.1:55432`. Stop these with the owner's existing authorization before disposable gates, preserving this cluster. The current local app contains the completed sidebar; it is not the final permissions UAT build. Ignored proof: `.local/permissions-gates/checkpoint-working-verification.json`. Backup remains `.local/backups/permissions-before-20261009/sena_hub_local.dump`.


## Phase 1 — foundations

Resume verified: `08267d3` exists and was HEAD on main; the working tree was clean before this phase. The five owner checkpoint answers are recorded in docs/34. Tab permission edits remain locked until their complete DB boundary is migrated; no UI-only restriction is advertised. All six phase gates passed.


### Phase 1 implementation and decisions taken for owner review

Migration 46 adds the 12-tab permission catalog, six versioned templates, per-account permission rows, permission events, and the separate `can_manage_users` flag. Permission tables use FORCE RLS with an explicit migration-owner policy; application roles have no direct table grants. Restricted SECURITY DEFINER helpers have a fixed search path and no PUBLIC execution. Unknown/malformed actors, unknown tabs/actions, missing rows and inactive accounts deny. Agency capability checks use the account's canonical, ACTIVE, date-valid vocabulary entry; caller agency claims are not used.

The API's existing identity lookup now returns a bounded capabilities projection, using the already-loaded account row rather than another account lookup per checkbox. Published consumer eligibility is separate from internal tab View. No cache is introduced. New admin-only catalog/save endpoints have proxy/H1 allowlist entries and explicit route-manifest additions. Historical Phase 0 manifests remain unchanged; tests declare the exact new catalog objects separately.

Decisions during the staged rollout:

- All 12 tabs remain `LEGACY_LOCKED`; application saves that change their boxes are rejected at the DB. A migration cannot mark an unguarded tab MIGRATED or DISABLED without explicitly declaring its complete guard coverage. Domain guard activation belongs to Phases 2–6. Operator-only fixture mutations test helper/projection revocation; they are not claimed as completed domain-route enforcement.
- The manage-users flag immediately narrows account administration. The legacy admin role remains its additional ceiling during this phase; granting that flag to another legacy role is refused until the account/base-role migration. Revoking it does not remove the account's data permissions. Self/stale checks and the account-decision advisory lock protect flag saves and concurrent removals.
- Existing explicit role decisions still copy the newly chosen legacy template and ceiling, keeping current approval/invite workflows usable. A permission save never changes that ceiling. Later checkbox/template workflows will replace this compatibility path; no editable checkbox can currently widen an unmigrated group.
- Operator bootstrap uses the flag and writes a permission audit event. Rejected-request retention anonymises identifiers in the new audit table and removes inert grants after 90 days, alongside the existing personal-field purge.
- No new UI controls are offered in this phase. One browser regression verifies the capabilities/catalog projection through the actual Next proxy. The account grid and navigation adoption remain Phase C.

Conversion in this phase: every existing role receives its specified template copy, existing admins receive the flag, external/consumer accounts gain no internal capability. Domain entry ceilings remain unchanged. Publisher project draft editing and registry stewardship removal activate in their respective later phases; both are owner-accepted. Published consumer feeds remain unchanged as the owner instructed.

Validation: focused foundation SQL/API checks passed after correcting two test harness issues (consumer has no Hub schema USAGE; pg_has_role requires an explicit OID cast). Typecheck, offline webpack build and the DB suite passed. The initial H1 protocol gate caught its fixed 45-migration expectation; it now explicitly expects migration 46. No flaky retry has been used.

### Phase 1 final gates and working database

- API: **1,527 passed, 11 unchanged opt-in skips** (245.56s), versus 1,495. All 32 new foundation cases passed: runtime ACL/SD checks, template/projection equivalence, missing/invalid actors and capabilities, constraints, revocation, locked saves, self/stale/concurrent flag changes, new-tab default denial and audit retention. The existing 1,040 SQL entry probes remain green; two new route entries extend the route/identity manifest to 202 concrete routes and 6,666 entry probes.
- UI: **214 passed** (5.5m), versus 213; no skips or retries. New projection/catalog browser test passes through the real Next proxy. All sidebar and prior account flows remain green.
- DB: **51 reported SQL/concurrency checks + 7 Node cases passed**, unchanged. The foundation's real non-superuser SQL cases run in the API suite. Phase 1 has no claim of completed per-domain checkbox enforcement.
- Local H1: **11 protocol + 38 browser tests passed**, unchanged. All 46 migrations also applied as the simulation's non-superuser migration owner. No hosted connection or email was made.
- Typecheck and offline webpack production build passed. Logs: `.local/permissions-gates/phase1-{typecheck,build,db,api,ui,h1}.log`.

Before applying migration 46 to the working cluster, a fresh custom-format dump was created at `.local/backups/permissions-phase1-2026-10-09T05-25-05-749Z/sena_hub_local.dump` (6,297,298 bytes). The guarded operation verified the actual `.local/postgres` directory, applied only migration 46 transactionally with its history entry, and compared every old account field before committing. Verified afterward: **BNA7 = 1 staged row; all eight original accounts and all their pre-existing fields unchanged; 279 staged REM projects; four Hub projects**. The existing admin retains its flag. Proof: `.local/permissions-gates/phase1-working-verification.json`. No seed runner or external-system write was used.

Phase 1 commit subject: `feat: add guarded permission foundations (phase 1)`. Its literal hash will be recorded by Phase 2 to avoid a self-referential hash. Next phase: **2 — content core**. Permission boxes are still locked; do not hand this checkpoint to the owner as the final UAT build. No push yet.
