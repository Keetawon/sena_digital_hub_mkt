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
| 2 — content core | Passed | This phase commit; subject below | Typecheck/build passed; API 1,527 → 1,556 (+11 unchanged skips); UI 214 → 215; DB 51 + 7 → 51 + 8; H1 11 + 38 |
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

Phases A, 0, 1 and 2 are complete. Next: **Phase 3 — content publication and knowledge**, then 4–6, C and UAT. Phase 2 started from clean origin/main `488664c`; its commit subject is `feat: enforce content permissions and bound asset visibility (phase 2)`. Record its literal hash in the next phase rather than inventing a self-referential hash here. Migration 47 is applied to the backed-up working local database, with BNA7 and every existing account field verified intact. Working PostgreSQL/API/admin are restored. Push each subsequent phase only after all its gates pass. No permission grid is editable yet, and this is not the final UAT build.

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
