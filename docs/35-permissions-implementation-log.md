# Permissions implementation log

Owner programme: 9 October 2026. Starting commit: `12772c3` on `main`.
Local execution only. Owner protocol update, 9 October: after each phase passes ALL its gates, commit and push that phase to origin/main as a backup checkpoint. Never push an incomplete or failing phase. Each phase must pass typecheck, offline build, DB, API, UI and loopback H1 gates before the next begins. No owner testing between phases.

## Working database preservation

Before any new migration: native PostgreSQL custom-format `pg_dump` saved to `.local/backups/permissions-before-20261009/sena_hub_local.dump` (6,297,298 bytes). Ignored baseline metadata is alongside it. Baseline: BNA7 exists once in `staging.rem_projects`; eight existing Hub accounts. BNA7 is staged REM source data, not an existing Hub project draft. Working cluster: `.local/postgres`. Test databases are separate disposable clusters. Checkpoint verification after Phases A/0 passed on 9 October 2026: BNA7 still present; the exact eight pre-existing account IDs are intact; 279 staged REM projects and four Hub projects remain. No working migration was applied. PostgreSQL/API/admin were restarted; health, home and Accounts returned HTTP 200, and the demo admin remained ACTIVE. Repeat this verification after subsequent working migrations.

## Phase status

| Phase | Status | Commit | API / UI / DB / H1 gates |
|---|---|---|---|
| A — responsive sidebar | Passed | `72c262f` | Typecheck/build passed; API 1,444 passed + 11 skipped; DB 51 reported checks + 7 Node cases; H1 11 + 38 passed; UI 213 passed (208 → 213); sidebar rerun 13 passed |
| 0 — baseline manifests | Passed | `08267d3` | Typecheck/build passed; API 1,444 → 1,495 (+11 unchanged skips); DB 51 + 7 and 1,040 SQL probes passed; H1 11 + 38 passed; UI 213 → 213 passed |
| 1 — foundations | Passed | `6261f53` | Typecheck/build passed; API 1,495 → 1,527 (+11 unchanged skips); UI 213 → 214; DB 51 + 7 plus foundation SQL probes; H1 11 + 38 |
| 2 — content core | Passed and pushed | `af64b21` | Typecheck/build passed; API 1,527 → 1,556 (+11 unchanged skips); UI 214 → 215; DB 51 + 7 → 51 + 8; H1 11 + 38 |
| 3 — publication and knowledge | Passed and pushed | `1259972` | Typecheck/build passed; API 1,556 → 1,602 (+11 unchanged skips); UI 215 → 217; DB 51 + 8; H1 11 + 38 |
| 4 — registry | Passed and pushed | `0ca0d75` | Typecheck/build passed; API 1,602 → 1,628 (+11 unchanged skips); UI 217 → 219; DB 51 + 8; H1 11 + 38 |
| 5 — finance, operations, archive | Passed and pushed | `cdc1c59` | Typecheck/build passed; API 1,628 → 1,672 (+11 unchanged skips); UI 219 → 221; DB 51 + 8; H1 11 + 38 |
| 6 — shared and residual authority | Passed; checkpoint ready | This checkpoint | Typecheck/build passed; API 1,672 → 1,766 (11 → 8 existing skips); UI 221 → 229; DB 51 + 8; H1 11 + 38 |
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

Phases A, 0, 1, 2, 3, 4 and 5 are complete. Next: **Phase 6 ? shared and residual authority**, then C and UAT. Phase 4 is pushed as `0ca0d75`; Phase 5 checkpoint subject is `feat: enforce finance and operations capabilities (phase 5)`. Record its literal hash in the next phase rather than inventing a self-referential hash here. Migration 50 is applied to the freshly backed-up working local database, with BNA7 and every existing account field verified intact. Working PostgreSQL/API/admin are restored. Push each phase only after all gates pass. All grids remain locked; this is not the final UAT build.

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

## Phase 2 resume checkpoint — investigation only

Last completed phase commit: **`6261f53`**. No Phase 2 application code, migration or tests have been changed. This checkpoint records the Phase 1 hash and Phase 2 starting state.

Read-only inspection of the working local function catalog is saved in ignored `.local/permissions-gates/phase2-hub-functions.json`. Implementation must cover the callable content RPCs and their renamed `*_before_*` helpers, progress cache projections, minimal brand references inside project payloads, and asset visibility/binding operations. Keep public consumer payloads on their existing boundary. Do not mark a tab editable until its complete DB guard coverage is proved. The next required work is migration 47/content-core guards and the direct runtime deny cases; no Phase 2 gate has run.

Working services have been restored after the completed tests: PostgreSQL `127.0.0.1:55432`, API `127.0.0.1:8000`, admin `http://127.0.0.1:3000`. Health, home and Accounts returned 200; the existing admin is ACTIVE with manage-users enabled; all 12 tab grids remain locked. Ignored proof: `.local/permissions-gates/phase1-working-services.json`. Stop these using the owner's existing permission before the next disposable gates. The app is a Phase 1 checkpoint, not the final UAT build. Continue Phase 2, then 3–6, C and UAT; no intermediate owner testing and no push until the programme's final full suite passes.

### Owner checkpoint push exception — 9 October 2026

After the Phase 1 report, the owner explicitly requested “commit & push?”. This authorizes a separate documentation checkpoint commit and pushing the completed A/0/1 commits to `origin/main` now, before the remaining programme phases. It does not authorize hosted execution, deployment, or any claim that the full permissions programme is complete. The checkpoint changes documentation only; the completed Phase 1 gates above remain the latest application validation. Subsequent phase pushes retain the original final-suite gate unless the owner directs otherwise.

## Phase 2 implementation — passed

Resume verification: HEAD and origin/main both `488664c`; main branch, clean working tree before changes. On 9 October the owner changed the delivery rule to commit and push after every phase passes all its gates. This supersedes the earlier final-programme-only push restriction; hosted execution remains blocked.

Uploader rule: an ACTIVE internal uploader with Projects Edit, Brands Edit, Knowledge Edit or Knowledge Approve may read their own non-deleted upload while it has never been bound. Knowledge Approve retains the existing rights-reviewer upload intake without granting project/brand editing; binding additionally requires the destination capability. The owner UUID and upload provenance are server-written, not supplied by the client. After its first binding, visibility follows an authorized binding; removing that binding must not restore the uploader exception. Binding also requires Edit on the destination tab, so a forged binding cannot make a hidden file visible. Existing public-consumer asset eligibility remains unchanged. The exact implementation and evidence will be recorded before the phase is enabled.


Phase 2 implementation checkpoint (not a completed phase): migration 47 introduces `hub_app`, table-backed content guards, forced core RLS, authorized asset reads/bindings, a server-written monotonic `first_bound_at`, and projected project/brand/history/cache responses. FastAPI uses an explicit content route map and the already-loaded account capabilities, then executes those routes as `hub_app`. SQL checks remain authoritative. Public consumer functions/views are unchanged.

Decisions taken for owner review during Phase 2:

- Keep all permission grids `LEGACY_LOCKED` until the release/knowledge/assistant/shared paths in later phases are guarded. The core functions already narrow permissions; the UI must not promise a completed tab boundary early.
- Preserve publisher upload intake via Knowledge Approve. Only the uploader gets the unbound-file exception; another reviewer sees it after an authorized binding. The exception never returns after any first binding, even if a binding is physically removed. Rights approval alone never grants project/brand binding.
- Historical content remains readable through projected RPCs. Hidden asset payloads are removed; a raw historical table row is denied if its embedded assets are not all readable. A Projects-only user receives a brand name and no brand logo/detail. Public website payloads stay on the existing consumer boundary.
- Upload cleanup uses a server-only bounded registration-existence function: caller RLS must not cause cleanup to delete a file whose registration committed but is no longer visible.

### Exact asset visibility rule and Phase 2 conversion

`hub.can_read_asset` requires a non-deleted asset and one of the following table-backed paths. All capability helpers require an ACTIVE internal account; neither a role claim nor an asset UUID is sufficient.

1. **Upload intake:** `provenance = 'upload'`, server-written `owner_id` equals the actor, `first_bound_at IS NULL`, and the actor still has Projects E, Brands E, Knowledge E or Knowledge A. There is no arbitrary time expiry while the file is genuinely unbound. Account suspension or removal of all those capabilities revokes this exception on the next request.
2. **Current binding:** a non-deleted binding to a non-deleted project/model/commercial type with Projects V; a non-deleted brand binding with Brands V; or a knowledge link with Knowledge V. The destination Edit capability is checked separately before creating a binding. The file must already be visible before that binding is inserted.
3. **Selected published snapshot:** a project media reference in the project's currently selected published version with Projects V; a brand asset in the currently selected brand version with Brands V; or a frozen brand asset embedded in a project's currently selected published version with Brands V. This keeps still-served media available for review and rights revocation after draft replacements. An arbitrary older, unselected version does not independently grant asset access.

`first_bound_at` is monotonic: migration 47 backfills it from current and historical binding rows and historical version references; four binding-table triggers set it on first use. Unbinding, soft deletion, or physical removal of the binding cannot restore the intake exception. Hidden assets are removed from internal detail/history/cache projections. Public-consumer eligibility remains unchanged.

A repeated upload whose checksum belongs to an inaccessible asset returns the same not-found error as an inaccessible asset; it does not disclose metadata or transfer ownership. This restrictive deduplication case may require an authorized colleague to make a legitimate binding before reuse. No new global library override is granted to administrators or rights reviewers.

Conversion activated here:

- Publisher loses the Projects E entry surface (16 mapped routes: draft creation/update/prefill, brand assignment, model add/update/review, project/model media bindings/removal, commercial-type creation/update/media binding/removal, and facilities). Some previously reached a later DB denial; the API now consistently denies them before the handler. Projects A and published consumer reads remain available. Editor/admin model review remains E, as before; this is not a new approval grant.
- Global internal asset lists, metadata, bytes/thumbnails and reuse narrow for editor, publisher, viewer and admin to the rule above. Rights review also requires asset visibility. Publisher upload intake remains possible through Knowledge A; it does not grant destination E.
- Project/brand detail, historical snapshots and progress/cache projections omit hidden-tab payloads when boxes are withdrawn. A project receives only the brand name without Brands V. The legacy template copies otherwise retain the content work verified by the baseline and domain suites.
- Registry stewardship removal remains Phase 4. Release, knowledge retrieval, assistant and export boundaries remain later-phase work; all 12 grids stay locked until complete coverage is proved. Phase 2 is not the finished permissions UAT build.

Validation so far: initial 16 direct SQL/API cases passed; expanded focused regression run **88 passed**. Typecheck and offline webpack build passed. The initial full API run found **12 failures, 1,531 passed, 11 unchanged opt-in skips**; the targeted rerun covers those fixes. An intermediate H1 candidate passed its protocol/migration/account browser checks; subsequent history/cache refinements still need the final H1 gate. DB and final full API/UI gates remain outstanding. Migration 47 has **not** been applied to the working database. No Phase 2 commit or push is allowed until every gate passes.

Later Phase 2 gate checkpoint: final DB **51 reported checks + 7 Node cases passed**; final local H1 **11 protocol + 38 browser passed**, including all 47 migrations under its non-superuser migration owner. A second full API run had 1,546 passed / five failures / 11 unchanged skips; all five were old query expectations in upload cleanup and brand history test doubles, now updated to the guarded RPCs. The first full UI run had **211 passed / four failures**: `slot upload, replacement history, safe SVG and role-locked library` and `bulk logo confirmation, role suggestions, previews and individual batch rights`, each at 1366×768 and 390×844. The logo reuse fixture now retains a legitimate binding; the audit assertion expects `hub_app` and the actual account UUID. No flaky retry or skipped new test has been used. Final full API and UI reruns are required before completing the phase.

The additional complete-route coverage check found the project→brand assignment entry missing from the new API map (its DB function was already guarded); all **52** content routes now have explicit mappings. The new ACL probe was corrected to select the non-inheriting `hub_app` role before resolving Hub relations. Review also corrected numeric version ordering in the projected history RPC; a rollback-only 105-version fixture proves descending numeric order and the 100-version bound. All **28 focused cases passed**. The final full API gate then passed **1,555 tests / 11 unchanged opt-in skips** (392.21s), versus 1,527 at Phase 1. DB and local H1 were rerun successfully against the corrected migration; final UI is still running.

The UI gate then passed **215 tests** (6.6m), with no skips/retries, completing all six gates for that candidate. A fresh working-database dump succeeded, but applying migration 47 to populated assets failed with `23502`: the old `touch` trigger would clear the NOT NULL editor UUID during the historical binding backfill, where an operator has no human actor. The transaction rolled back, including its migration-history entry. Fresh-empty-cluster gates could not expose this upgrade case. Migration 47 is still unapplied and uncommitted.

Correction: the backfill temporarily disables only the asset `touch` trigger under the migration's transactional table lock, preserving existing editor/timestamp fields. Audit remains enabled with an explicit migration reason and no human actor; the trigger and prior actor/reason settings are restored before proceeding. RLS and decision guards are not disabled. A populated synthetic rollback-only regression executes the actual backfill block and checks retained metadata, anonymous technical audit and trigger restoration. Rerun all affected gates before retrying the working upgrade, take another fresh dump, then verify BNA7/accounts and restore the services.

The next candidate passed API **1,556 / 11 unchanged skips**, UI **215**, DB and H1, including the added backfill check. Its working upgrade then rolled back with `55006`: the backfill had queued deferred cache refresh events on `hub.project_progress_dirty`, which prevented the later RLS `ALTER TABLE`. The backfill-only test did not cover that later DDL. A new isolated-cluster test, `tests/content-upgrade.test.mjs`, now applies migrations 1–46, loads the synthetic account/project/brand/asset fixtures, clears the human actor, and executes all of migration 47 through COMMIT. It reproduced the exact pending-trigger failure and passes after draining `hub.refresh_progress_at_commit` before the RLS changes, then restoring deferred behavior. It verifies unchanged accounts and asset editor metadata, bound-asset markers, restored triggers, completed cache refresh and technical audit. It is part of the DB gate (Node cases 7 → 8). Final full gates are running against this correction; migration 47 remains unapplied to the working database until a fresh verified retry succeeds.

### Phase 2 final gates and working upgrade

The corrected candidate passed every gate before the working upgrade and checkpoint commit:

- Typecheck and offline webpack production build passed; no admin application source changed after those checks.
- DB: **51 reported SQL/concurrency checks + 8 Node cases**, including the complete populated upgrade (previously 7 Node cases). Real runtime permission probes also execute in the API suite.
- API: **1,556 passed / 11 unchanged opt-in skips**, 400.79 seconds (Phase 1: 1,527). The 29 new content cases cover 52 route mappings, direct non-superuser SQL/SD denials and positive neighbors, single-bit revocation, hidden snapshots/caches, upload/binding rules, ACLs, numeric history ordering and populated backfill. Existing skipped cases are enumerated in Phase 1; no new skip or flaky retry was added.
- UI: **215 passed**, 6.9 minutes (Phase 1: 214); zero failures/skips/retries. Existing upload/logo workflows now exercise authorized bindings and account UUID audit attribution under `hub_app`.
- Local H1: **11 protocol + 38 browser cases** (30 accounts/auth + 3 account-agency + 5 outage), all passed; all 47 migrations applied under the non-superuser migration owner. No hosted request occurred.

Final logs: `.local/permissions-gates/phase2-{typecheck,build,db,api,ui,h1}.log`. Migration 47 and its profile checksum are frozen after this successful application. The only existing fixture-manifest change is the reviewed generator-source checksum; no exported dataset or generated artifact is added.

Fresh pre-upgrade dump: **`.local/backups/permissions-phase2-2026-10-09T08-56-48-451Z/sena_hub_local.dump`**, 6,327,489 bytes. The guarded helper verified `.local/postgres` on the actual connection, applied only migration 47 and its history entry in one transaction, and compared every existing account field before committing. Result: **BNA7 = 1; all 8 existing accounts and every field unchanged; 279 staged REM projects; 4 Hub projects; the active manage-users account preserved**. Proof: `.local/permissions-gates/phase2-working-verification.json`. No seeds were rerun on the working database and no upstream system was written.

Working PostgreSQL (`55432`), API (`8000`) and admin (`3000`) were restarted. Health, home, Accounts, Projects, Brands, Assets, `/v1/me` and permission catalog checks returned 200. Admin is ACTIVE with manage-users enabled; all 12 tab grids remain `LEGACY_LOCKED`. Proof: `.local/permissions-gates/phase2-working-services.json`. The two failed upgrade attempts above rolled back safely; the successful full upgrade test now prevents their recurrence.

Checkpoint commit subject: **`feat: enforce content permissions and bound asset visibility (phase 2)`**. This completed phase may be pushed under the owner's revised protocol. No Phase 3 implementation is included in this commit. Next gates must extend the current populated-upgrade coverage for any new backfill/DDL interaction.

## Phase 3 implementation

Phase 2 committed and pushed as **`af64b21`**; HEAD and origin/main matched and the tree was clean before Phase 3. Working services were then stopped using the owner's existing permission, for separate disposable gates. Migration 48 is **not applied to the working database** and this phase must not be committed/pushed before every gate passes.

Migration 48 replaces the promotion/release/knowledge role checks with table-backed capabilities and extends `hub_app` to the 20 associated API routes. It keeps the existing business validation, draft revisions, publication pointers, locks and rollback behavior. Release publish/rollback checks A for every member tab before any member write, including the synthetic demo branch. Release candidates/history omit hidden-tab members. Twenty-one publication/knowledge relations receive FORCE RLS plus restrictive capability policies; renamed private implementation functions remain uncallable by application roles.

Private knowledge preview reads now use a projected RPC: removing Projects V makes draft model-catalogue completeness unknown; current asset visibility filters frozen media references. Direct raw preview rows cannot bypass that projection. Knowledge V is checked before evidence, file, retrieval and citation paths; review remains E and rights/private-preview release remains A. The knowledge binding function must already be able to read the asset before inserting its binding. Public website feeds remain unchanged. All 12 grids stay locked pending the remaining shared boundaries.

### Decisions taken for owner review

- Promotion drafts remain editor/admin work at both API and DB; the old route registration already passed `brand_writer`, which denied publisher. The new E mapping preserves that boundary. The accepted Projects E removal remains the effective content-role conversion; there is no additional publisher promotion-draft removal.
- A Knowledge-only reader receives unknown model-catalogue completeness rather than a hidden Projects draft flag; the existing preview uses its specification handoff. Knowledge evidence/fact cards stay in their own review domain, and no account/permission rows enter retrieval.
- Release metadata remains in Releases; hidden member records/candidates are omitted. A release can only be rolled back when all member A permissions are currently present, including members omitted from a reader's view.

### Gates / current checkpoint

The complete populated-upgrade test passes through migration 48. Typecheck and offline build passed. Local H1 passed **11 protocol + 38 browser**. First focused run: 163 passed / 55 failed / one existing opt-in skip; 52 failures were older route doubles missing promotion/release capabilities, and three were the new fixture mixing manually started and asyncpg-managed transactions. Both test setups were corrected; focused rerun **103 passed / one existing skip**. The first DB attempt found older knowledge fixtures using an absent/invisible asset; fixtures now supply an owned, never-bound upload, preserving the actual unknown-stock classification assertion. DB subsequently passed **51 reported checks + 8 Node cases**.

The first full API run ended **1,590 passed / 12 failed / 11 unchanged skips**. The 12 new V-off probes attempted to retain E/A in storage, but the foundation CHECK constraint already prohibits that state. The corrected probes assert atomic rejection of that inconsistent row, verify the original capability remains, then revoke the action and V and assert SQL denial. This retains the stronger existing invariant; no application constraint was weakened. The 46 publication cases also now cover all knowledge read helpers and release candidates with V off under each real runtime role. A focused rerun and the final full API/UI gates are running. No new skip or flaky retry is used.

Corrected focused probes: **46 passed**, 47.36s. The subsequent full API gate passed **1,602 tests / 11 unchanged opt-in skips**, 434.46s. The UI gate is running against that candidate; DB/H1/typecheck/build remain passed, and migration 48 is still unapplied to the working database. Do not push this phase until UI and the preserved working upgrade are verified.

The first full UI run ended **216 passed / one failed** (6.8m). Only the new Knowledge revocation assertion failed: its generic `alert` selector matched both the visible Thai permission error and Next.js's hidden route announcer. The selector now targets the permission error text. The focused two-case rerun passed (4.0s); a complete UI rerun is required. No application behavior changed for this correction and no flaky retry or skip was introduced.

### Phase 3 final gates and working upgrade

- Typecheck and offline webpack production build passed.
- API: **1,602 passed / 11 unchanged opt-in skips**, 434.46s (Phase 2: 1,556). The 46 new cases cover the 20 mapped routes, direct real non-superuser SQL/SD denials and positive neighbors, E/A and V revocation, mixed-release publish/rollback atomicity, hidden release members, private preview projections, retrieval denial before embedding, FORCE RLS and closed helper ACLs.
- UI: **217 passed**, 6.9 minutes (Phase 2: 215); no skips or retries. Both new browser cases pass through the actual proxy. The preceding selector failure and correction are recorded above.
- DB: **51 reported SQL/concurrency checks + 8 Node cases**, unchanged. The populated upgrade now executes both migrations 47 and 48 after the synthetic 1–46 fixtures. Permission-specific SQL probes additionally run in the API suite.
- Local H1: **11 protocol + 38 browser tests passed**, unchanged, including all 48 migrations under the non-superuser migration owner. No hosted request or email occurred.

Logs: `.local/permissions-gates/phase3-{typecheck,build,db,api,ui,h1}.log`. All gates completed before the working upgrade. Migration 48 and its profile checksum are frozen after application.

Fresh pre-upgrade dump: **`.local/backups/permissions-phase3-2026-10-09T09-50-53-916Z/sena_hub_local.dump`**, 6,373,987 bytes. The guarded operation verified the actual working data directory, applied only migration 48 and its history entry transactionally, and compared every account field before committing. Result: **BNA7 = 1; all 8 existing accounts and every field unchanged; 279 staged REM projects; 4 Hub projects; the active manage-users account preserved**. Proof: `.local/permissions-gates/phase3-working-verification.json`.

Working PostgreSQL/API/admin were restored; health, home, Accounts, Projects, Brands, Assets, Promotions, Releases, Knowledge, `/v1/me` and the permission catalog returned 200. All 12 grids remain `LEGACY_LOCKED`. Proof: `.local/permissions-gates/phase3-working-services.json`. No working seed runner or upstream write was used.

Checkpoint commit subject: **`feat: enforce publication and knowledge permissions (phase 3)`**. Every gate passed; push this phase under the owner's revised protocol. No Phase 4 application changes are included. Resume at **Phase 4 — registry** after verifying the checkpoint push.

## Phase 4 implementation

Phase 3 pushed as **`1259972`**, with clean tree and matching origin/main verified before beginning. Working services were restored and checked at that checkpoint, then stopped under the owner's existing permission for separate disposable tests. Migration 49 is **not applied to the working database**; no Phase 4 commit/push is allowed before every gate passes.

Migration 49 adds table-backed Registry guards to ten API routes and the real SQL entry points, including previews, scope creation, issuance, variants and native binding. Eight existing FORCE RLS tables receive restrictive predicates alongside the old legacy/technical policies. Application roles gain no direct DML. Agency scope comes from the ACTIVE account's canonical, date-valid vocabulary code; changing either the SQL role or `app.agency_code` cannot widen it. Agency binding audit still records `AGENCY_RETURNED`. External scope remains mandatory when the caller uses `hub_app`.

### Decisions taken for owner review

- Global approval/cancellation are operator-only as accepted. Their application EXECUTE grants are removed; the operator connection is the authority and a required actor UUID supplies audit attribution only. User-management flags confer no stewardship power.
- Direct legacy-admin INSERT/UPDATE on Registry vocabulary and source scope/member tables is also removed. These are operator maintenance paths with no UI endpoint; retaining them would bypass Registry E and create a hidden grid exception. Registry E still creates valid combined scopes through the guarded function. This is an additional explicit conversion difference; imported vocab/source maintenance remains possible through the operator connection.
- Active shared scope/vocabulary references remain available to valid agencies as before; compound scopes and registration/name/binding data remain limited to their own agency. Finance/shared cross-tab projections remain Phase 5/6 work, so every grid stays `LEGACY_LOCKED`.
- The local issuance override and H1's reviewed settings-based override are preserved separately. The migration wraps each installed helper's existing body without changing its source of configuration. Pre-account H1 seeding checks configuration through its already-verified deployment-owner connection, rather than impersonating an application account that does not yet exist.

### Gates / current checkpoint

Typecheck and offline build passed. The first DB attempt passed the SQL/domain checks and stopped at the concurrency fixture's old actor-less call to Registry configuration. That setup now supplies the existing synthetic online account; no authorization exception was added. API and local H1 gates are running. Two new browser cases cover next-request Registry revocation and the fixed agency boundary. No new skip or flaky retry is intended. The working database remains at migration 48.

H1's first run exposed API startup's legacy admin-role configuration read before an account exists. A bounded `hub.registry_startup_ready()` technical RPC now returns only whether the DB-proven H1 profile has both issuance flags off. It cannot return Registry data or grant a user permission. Startup uses `hub_app`, not admin impersonation. H1 then passed **11 protocol + 38 browser**; the final ACL correction below requires its checksum rerun.

The first API command included explicit file paths but the disposable runner also supplies its full test directory, so it ran the **full suite**, not only the intended focused selection: **1,620 passed / 8 failed / 11 unchanged skips**, 462.60s. Four failures exposed one real missing helper EXECUTE grant for `hub_app` in invoker `ads.preview_scope`; four were the new invalid-agency fixture retaining the application's local role while preparing operator-only vocabulary changes. The helper grant and fixture reset are corrected. The proper `-k` focused selection is running before final full gates; no application guard was loosened and no failed phase is pushed.

The focused rerun passed **45 tests** (30.32s), covering all 26 new Registry cases, live inventory probes and both formerly failing end-to-end flows. The next DB run reached a second old concurrency fixture (`concurrent_ads_line_revision.mjs`) whose random actor UUID had no account. It now creates an ACTIVE synthetic admin-template account and removes it with normal FK cleanup afterward. The complete DB gate then passed **51 reported checks + 8 Node cases**. Final local H1 passed **11 + 38** against migration 49's final checksum.

The focused UI run first had one pass and one failure: the new agency case assumed another test had created registrations. It now creates its own KIN/COMBAY registrations through the real guarded API and asserts both the positive own row and denied other detail. Focused UI: **2 passed**, 3.7s. The final full API and UI gates are running sequentially; no further application/migration changes have been made since these successful focused gates.

Final full API gate: **1,628 passed / 11 unchanged opt-in skips**, 503.91s (Phase 3: 1,602). All 26 new Registry probes passed. The full UI gate is running; typecheck/build/DB/H1 already passed. Migration 49 remains unapplied to the working database until UI also passes and a fresh pre-upgrade dump is taken.

### Phase 4 final gates and working upgrade

- Typecheck and offline webpack production build passed.
- API: **1,628 passed / 11 unchanged opt-in skips**, 503.91s (Phase 3: 1,602). The 26 new cases cover ten exact route mappings, real non-superuser SQL reads/mutations, single-bit revocation and positive neighbors, unchanged permissive policies unable to bypass the restrictive predicates, forged role/agency settings, canonical/date-valid agency scope, next-request suspension, operator-only decisions, FORCE RLS and closed helper ACLs.
- UI: **219 passed**, 7.1 minutes (Phase 3: 217); zero failures/skips/retries. Registry revocation and independent KIN/COMBAY browser fixtures pass alongside every previous workflow.
- DB: **51 reported SQL/concurrency checks + 8 Node cases**, unchanged. Full populated upgrade now applies through migration 49; direct permission-specific SQL cases also run in the API suite.
- Local H1: **11 protocol + 38 browser cases passed**, including all 49 migrations with the non-superuser migration owner. The original local and H1 issuance mechanisms remain distinct and closed. No hosted request or email occurred.

Logs: `.local/permissions-gates/phase4-{typecheck,build,db,api,ui,h1}.log`. Migration 49 and its profile checksum are frozen after application. All gates passed before the working upgrade.

Fresh pre-upgrade dump: **`.local/backups/permissions-phase4-2026-10-09T10-30-54-008Z/sena_hub_local.dump`**, 6,409,625 bytes. The guarded operation verified the actual working directory, applied only migration 49 and its history entry in one transaction, and compared every existing account field before committing. Verified: **BNA7 = 1; all 8 existing accounts and every field unchanged; 279 staged REM projects; 4 Hub projects; the active manage-users account preserved**. Proof: `.local/permissions-gates/phase4-working-verification.json`.

Working PostgreSQL/API/admin were restored; health, home, Accounts, all migrated content routes, Registry settings/list, `/v1/me` and the catalog returned 200. Admin remains ACTIVE with manage-users enabled; all 12 grids remain `LEGACY_LOCKED`. Proof: `.local/permissions-gates/phase4-working-services.json`. No working seeds or upstream writes ran.

Checkpoint subject: **`feat: enforce registry permissions and table-backed agency scope (phase 4)`**. Push this completed phase, then resume at **Phase 5**. Only read-only Finance/Archive preparation has occurred; no Phase 5 application, migration or test changes are included here.

## Phase 5 implementation — passed

Phase 4 committed and pushed as **`0ca0d75`**; clean main verified before this phase. Migration 50 is not applied to the working database. All grids remain locked. No commit/push until every gate passes.

### Decisions taken for owner review

- Finance assignment changes, mapping closure, commitment suspension and line archival require A because they change financial applicability. Draft creation, interpretation and imports require E. Identifier/correction review and retirement use only the named special plus V.
- Statement writes require A when either the existing or requested statement is CONFIRMED; removing confirmation also requires A. An omitted status cannot evade the check. The existing Finance advisory lock protects the status lookup and mutation together.
- Archive apply always requires Archive A plus Finance E. `CARD_CREATE` additionally requires Finance A: its established atomic workflow creates a CONFIRMED statement before importing its rows. Making it a draft would quarantine the import and change the business workflow. Default admin/online templates already include both; no bypass of confirmation rules is introduced.
- User-facing operations move to table capabilities now. Worker/ETL/export credentials and shared assistant paths remain the explicit Phase 6 boundary; no account grid is unlocked before that coverage passes.


### Phase 5 gates / current checkpoint

Typecheck and offline production build passed. The first focused run was **509 passed / 10 failed / 3 existing skips** (131.02s): six expected the established `actuals_forbidden` code, now preserved; four exposed deferred financial consistency triggers executing after the command's definer context ended. The existing fixed-row `finance_invariant` trigger now runs as its existing non-login finance owner, with no caller EXECUTE grant or direct application table access.

The second focused run passed **557 / 3 failed / 3 existing skips** (192.24s). Two new fixtures omitted the required statement due date or resolved a regclass before selecting an execution role. The third exposed a real JSON-null `control_totals` case in the Actuals projection; the projection now checks the JSON type before removing financial totals. One subsequent run stopped at collection because of a quote typo in the new inventory assertion; fixed and syntax checked. These are corrections, not flaky retries or added skips.

Migration 50 explicitly guards 41 Finance dispatcher actions (including the two local import actions), 86 API routes, Archive apply's conjunction, and each Documents/Exceptions workflow. Forty-five existing relations retain FORCE RLS and receive 90 owner/restrictive policies. Only bounded RPCs are granted to the base role. Actuals cached Finance payloads are reduced in SQL when Finance V is absent; hidden cross-tab finding context and document source links are withheld. Archive search does not search hidden Finance aliases or expose its record status. Workflow owner labels come from the account table for attribution only. Archive access auditing uses the base role's insert-only RPC, without impersonating admin.

The initial H1 invocation reported all **11 protocol + 38 browser** tests passed; PowerShell's redirected native stderr nevertheless yielded a shell exit 1. The final migration checksum changed for the null fix, so H1 is rerunning with an explicit native exit code. Focused permission and full DB gates are running. The working database remains at migration 49; no working upgrade or Phase 5 push has occurred.


Focused permission rerun: **41 passed**, 42.78s. Full DB initially exposed Archive's old UUID-only SQL actor; the fixture now creates an ACTIVE online account and uses the actual seeded admin identity for legal hold. An intermediate rerun used the consumer UUID instead of the admin UUID; corrected after checking the actor catalog. Archive and Actuals concurrency fixtures now also create their own ACTIVE accounts and clean them up with normal account FK behavior. The final DB gate passed **51 reported SQL/concurrency checks + 8 Node cases**, including the populated upgrade through migration 50. Final H1 passed **11 protocol + 38 browser** with native exit code 0. Full API and UI gates are running sequentially. No working migration or Phase 5 commit/push yet.


The first full API gate was interrupted with no final result after 1,296 reported outcomes (77%); its process/session no longer existed after the owner resumed. It is **not a passed gate**. Its one reported failure was located from the unchanged 1,680-test collection order: ACTIVE online-staff in the baseline route-entry probe. Archive legal hold was historically checked inside the handler; its new early capability dependency correctly denies before that probe's stubbed handler. The expected entry result now reflects this earlier denial; effective default access does not broaden or narrow. The final full API/UI gates must restart.

A parallel read-only review found a missing shared projection: Actuals campaign bridge rows still exposed Registry binding details and Finance assignment/correction IDs when those tabs were hidden. Migration 50 and a real-runtime regression test are being extended with a bounded bridge projection. This invalidates the earlier migration checksum's DB/H1 gates; rerun them before committing. Typecheck/build remain passed because no admin source changed. Working database is still at migration 49.


Final bridge/entry focused checks passed **45 tests**, 28.60s; the complete DB rerun passed **51 reported SQL/concurrency checks + 8 Node cases** against the final migration 50 checksum. The H1 browser gate then exposed a deterministic test synchronization gap in `hosted-h1.spec.ts` (cached progress case): its second login navigation began before the asynchronous logout assigned `/login`, causing `net::ERR_ABORTED`. The trace shows logout click completion at 48,902.5 ms, the premature second navigation at 48,905 ms, and logout's competing redirect at 48,919.5 ms. The test now waits for the exact logout URL and login heading; no application change, retry, skip or arbitrary sleep. H1 is rerunning in full. API/UI remain in the sequential final pipeline.


The final API gate passed **1,672 tests / 11 unchanged opt-in skips**, 325.18s (Phase 4: 1,628). Final H1 passed **11 protocol + 38 browser tests**, native exit 0, after the synchronization correction. The first full UI command stopped before browser collection: `seed-document-demo.py` used actor UUID `…0041`, absent from the eight demo accounts. Its existing guarded synthetic seed now inserts that ACTIVE online-staff fixture only if absent, allowing the existing template trigger to establish authority; replay never reactivates or overwrites an existing account. No working seed ran. The full UI gate is now running with that corrected fixture.


### Phase 5 final gates and working upgrade

- Typecheck and offline webpack production build passed.
- API: **1,672 passed / 11 unchanged opt-in skips**, 325.18s (Phase 4: 1,628). Forty-four new cases verify all 86 route mappings, real non-superuser V/E/A/special denials and positive neighbors, statement-state guards, Archive destination conjunctions, FORCE RLS/private ACLs, next-request revocation, and hidden Finance/Registry cached projections.
- UI: **221 passed**, 5.6 minutes (Phase 4: 219), zero failures/skips/retries in the final run. Both new revocation cases traverse the real Next proxy. The earlier fixture stop and H1 navigation synchronization correction are recorded above.
- DB: **51 reported SQL/concurrency checks + 8 Node cases**, unchanged, including populated upgrade through migration 50. Permission-specific direct SQL probes also run in the API suite.
- Local H1: **11 protocol + 38 browser cases passed**, native exit 0, all 50 migrations under the non-superuser migration owner. No hosted request or real email occurred.

Logs: `.local/permissions-gates/phase5-{typecheck,build,db,api,ui,h1}.log`. All gates passed before the working upgrade. Migration 50/profile checksum are frozen after application.

Fresh pre-upgrade dump: **`.local/backups/permissions-phase5-2026-10-09T13-43-41-162Z/sena_hub_local.dump`**, 6,420,650 bytes. The guarded operation verified the actual working data directory, applied only migration 50 and its history entry transactionally, and compared every existing account field before commit. Verified **BNA7 = 1; all 8 existing accounts and every field unchanged; 279 staged REM projects; 4 Hub projects; one ACTIVE manage-users account preserved**. Proof: `.local/permissions-gates/phase5-working-verification.json`. No working seed or upstream write ran.

Working PostgreSQL/API/admin were restored. Health, home, Accounts, migrated content/Registry, Finance, Actuals, Documents, Exceptions, Archive, `/v1/me` and the permission catalog returned 200. All 12 grids remain `LEGACY_LOCKED`. Proof: `.local/permissions-gates/phase5-working-services.json`.

Checkpoint subject: **`feat: enforce finance and operations capabilities (phase 5)`**. Commit and push this passed phase, then resume at **Phase 6**. Read-only Phase 6 and C plans are prepared in ignored `.local/permissions-gates/`; no Phase 6 application or migration changes are included.


## Phase 6 implementation — passed

Phase 5 passed all gates and pushed as **`cdc1c59`**; clean main and matching origin/main verified before starting this phase. Working services were restored, backed-up migration 50 applied, BNA7 and all eight account fields preserved. Phase 6 application work now proceeds in parallel across assistant guards, residual SQL/runtime membership, and shared API/proxy coverage. No Phase 6 migrations are applied to the working database; no commit/push before all gates pass.

### Decisions taken for owner review

- Keep all 12 grids `LEGACY_LOCKED` through Phase 6. Phase C must finish capability-driven page/navigation/control rendering before general editable grids are enabled; the SQL guards and reduced runtime must already pass here. A disabled group never falls back to a legacy role.
- Exact public website payloads are available to ACTIVE internal accounts with no tab boxes. Direct agency API access remains denied. Preserve the historical **local synthetic agency public-site preview** adapter, but recheck that selected agency's real account is ACTIVE before substituting the published-only machine consumer. Inactive accounts lose that preview on the next request. This preserves the owner's external boundary without treating the adapter as internal management access.
- Finance receives only currently usable vocabulary code/label and scope UUID/code/label references when Registry is hidden. It cannot search or obtain Registry members, source snapshots, bindings or detail through this projection.
- Actuals ETL application/current pointer and Archive worker claim/heartbeat/finish become operator/worker-only. Legacy admin loses direct RPC access; no UI path used these technical operations. This is an explicit additional conversion difference.
- Existing role-specific SQL denial probes use a separate ephemeral disposable-only non-superuser login after runtime memberships are removed. Normal API/UI and base-role probes continue to use the actual `hub_runtime`, which cannot assume legacy human roles or the probe. No probe principal is provisioned in the working database or H1 deployment.

### Integration checkpoint

Typecheck and offline build passed. The first focused API run completed **344 passed / 38 failed / 3 existing opt-in skips**, 185.75s. Thirty-three failures were historical-role fixtures trying to use the newly restricted runtime; they now use the explicit disposable probe only for those historical cases. The actual base-role cases still use `hub_runtime`. One content test now asserts the stronger raw snapshot ACL denial while preserving its historical-role RLS check. The inventory check distinguishes three deliberately closed, FORCE-RLS staging/seed tables with no application policy from ordinary guarded tables. Three assistant stream failures exposed stale references to removed role constants in citation validation; those checks are removed, leaving the source-specific SQL guards authoritative.

The first local H1 run passed the **11 protocol checks and non-superuser 50→52 migration/replay checks**, then failed **11 browser cases / 19 passed** in its first browser group. These failures share an Accounts directory 403; investigation is in progress. This is not a passed H1 gate. No new skip/retry was added, no working upgrade ran, and Phase 6 remains uncommitted.

The H1 directory 403 was a real nested ACL error: the new migration-owned projection called `ads.active_vocab`, owned by `ads_registry_writer`, without an EXECUTE grant to the non-superuser migration owner. Local postgres masked it. Both bounded reference projections now use the exact ACTIVE/canonical/inclusive Bangkok-date predicate directly; no grants broadened. A synthetic regression covers active, proposed, inactive, aliased, future and expired entries. The final H1 rerun passed **11 protocol + 38 browser cases**, native exit 0, with migration 52 checksum `fb96fda73a877f021308847b8506546c54615d42c734fa07f17801ebcf6961de`.

A residual ACL audit also restored exact operator-only EXECUTE on the two Registry stewardship functions, which Phase 4 had removed from human roles. The non-superuser H1 operator reaches input validation while every application/human role remains denied. The first DB runs exposed old assistant fixtures switching SQL roles without changing their account identity, then a test-only regclass lookup requiring audit-schema usage; both fixtures are corrected. The populated assistant SQL/HTTP opt-in tests are now being exercised via an explicit `--assistant-fixtures` disposable API option. It seeds only checked-in synthetic Actuals/Archive packs. No working fixtures, real provider calls or additional authority are introduced.

Additional conversion details: assistant marketing summaries require Finance V **and** Actuals V because they include actuals; historical campaign citations whose old filter provenance was not stored conservatively require Finance V. Fixed repository question IDs remain minimal references only; hidden question content still requires Questions V. Runtime execution uses only `hub_app`; legacy NOLOGIN roles remain solely for historical compatibility probes and technical ACL inventory, with no application runtime membership.

The first full API gate with populated assistant fixtures finished **1,721 passed / 36 failed / 8 existing opt-in skips**, 383.66s. Thirty-four failures were older unit expectations that denied public website feeds to internal accounts or expected raw public views rather than the new guarded wrappers. These are being aligned with the owner's explicit public-feed decision while retaining agency/consumer boundaries and the verified actor identity. One newly added vocabulary test attempted forbidden cleanup of immutable vocabulary rows; its unique synthetic rows now live only until disposable-cluster teardown. The third newly enabled assistant test lacked its fictional project fixture and is now seeded inside a rollback with a table-backed viewer. The other two populated assistant integrations and all 64 new assistant permission cases passed.

Review also found cached assistant draft source/diff text retained after a denied refresh. A shared invalidation path now clears all source-derived state on denied reload/confirmation or failed capability refresh, while retaining the unsent question and authored draft/reason. Four browser cases cover changed permissions, 401, 403 and denied source reload. Typecheck and offline build passed again after this change. The final DB gate passed **51 reported SQL/concurrency checks + 8 Node cases**; final H1 against the rebuilt UI passed **11 protocol + 38 browser cases**, native exit 0. Full UI is running; the corrected full API gate remains required. No Phase 6 working upgrade or push yet.

The first full UI run finished **225 passed / 4 failed**, 6.2 minutes. All four new assistant revocation cases correctly removed source data and preserved the authored values in the failure snapshots; the assertions used the wrong implicit-label locator for the recovery textareas. They now use the visible textbox accessibility role/name. This is a test correction, with no application change, rebuild, skip or retry. Corrected full API and UI gates are running sequentially on fresh disposable clusters.

Final API passed **1,766 tests / 8 existing opt-in skips**, 355.23s (Phase 5: 1,672 / 11 skips). All three previously skipped assistant integrations now run, with real non-superuser execution, populated synthetic tool results, HTTP proposal/citation checks and the fictional model fixture; no provider is constructed. The other additions cover assistant revocation, public-reader identity/status, exhaustive route/RLS/default-ACL inventory and bounded shared projections. Final UI remains in progress.

The eight remaining opt-in skips are explicitly: `test_actuals_import.py::test_real_import_replay_conflict_and_failed_rows_preserve_last_good`; `test_archive_db.py::test_archive_review_application_evidence_versions_and_private_access`; `test_demo_finance.py::test_finance_seed_real_controls_replay_preserved_edits_and_complete_snapshot`; `test_document_worker.py::test_real_local_image_ocr_preserves_all_occurrences_and_exact_money`; `test_hosted_h1.py::test_disposable_managed_simulation_end_to_end`; `test_hub_demo.py::test_complete_business_seed_replay_rolls_back_and_preserves_document_work`; `test_promotions_db.py::test_real_promotion_snapshots_approvals_atomic_release_and_stale_rollback`; `test_residential_seed.py::test_seed_replay_preserves_originals_and_user_edits`. No skip was added. The separate full DB and loopback H1 suites remain required and passed as recorded above.

### Phase 6 final gates and working upgrade

- Typecheck and offline webpack production build passed.
- API: **1,766 passed / 8 unchanged opt-in skips**, 355.23s (Phase 5: 1,672 / 11 skips). Ninety-one new cases plus three newly enabled assistant integrations account for the increase. No provider calls.
- UI: **229 passed**, 5.8 minutes (Phase 5: 221); zero final failures, skips or retries. All eight new shared/assistant cases passed, including 401/403 recovery with retained typed drafts.
- DB: **51 reported SQL/concurrency checks + 8 Node cases**, unchanged, with populated upgrade through migration 52. Permission-specific SQL also runs under the real non-superuser runtime in API tests.
- Local H1: **11 protocol + 38 browser cases passed**, native exit 0, all 52 migrations under the non-superuser migration owner. Replay preserves credentials and cannot restore the removed runtime memberships. No hosted request or real email occurred.

Logs: `.local/permissions-gates/phase6-{typecheck,build,db,api,ui,h1}.log`. All gates passed before the working upgrade. Migrations 51/52 and their profile checksums are now frozen. Migration 51 guards assistant tools, history, citations and proposals; migration 52 closes shared/account/public boundaries, residual FORCE RLS/default ACLs, operator entry points and runtime memberships.

Fresh pre-upgrade dump: **`.local/backups/permissions-phase6-2026-10-09T14-44-01-236Z/sena_hub_local.dump`**, 6,464,903 bytes. The guarded upgrade verified the real working data directory, applied only migrations 51/52 and their history entries transactionally, and compared every existing account field before committing. Verified **BNA7 = 1; all 8 existing accounts and every field unchanged; 279 staged REM projects; 4 Hub projects; one ACTIVE manage-users account preserved**. Proof: `.local/permissions-gates/phase6-working-verification.json`.

Working PostgreSQL/API/admin were restored. Health, home, Accounts, all migrated content/Registry/operations routes, Finance references, Questions, assistant config, `/v1/me` and the permission catalog returned 200. All 12 grids remain `LEGACY_LOCKED` until Phase C finishes the UI integration. Proof: `.local/permissions-gates/phase6-working-services.json`. No working seed or upstream write ran.

Checkpoint subject: **`feat: enforce shared permissions and retire legacy runtime roles (phase 6)`**. Commit and push this passed phase, then resume at **Phase C**. Only read-only Phase C plans/contracts exist in ignored `.local/permissions-gates/`; no Phase C implementation is included.
