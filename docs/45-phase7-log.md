# 45 — Phase 7: facilities, features and places

Current base: Phase 6 at `f3f8625`, following Phase 9 and merged PR 1. Phase 7
migrations are now 72–74. All automated gates passed on this rebase, including
the complete browser suite in one run. Final credential verification and PR
delivery are recorded below; earlier results are historical. The owner report
records the delivery commit and PR link.
The dated sections below preserve the
preparation history; the latest verification section supersedes earlier status.

Branch: `parallel/c4-facilities-places`. Isolated worktree:
`D:/Personal/workspace/sena_hub_phase7`. Baseline: `origin/main` at
`01d288f5d6830af17de7ca3fec1fd5fb2f62d88e` (Phase 2).

## Initial coordination and scope (before Phase 3)

Only doc 41 §3.6 is owned here. Main-line work, the Phase 4 branch, other
worktrees, credentials and processes are not changed. Phase 3 has not landed;
facility photo binding and checklist integration wait for its existing API and
`hub.asset_links`. No service, database setup or test runner may start before
Phase 3 is in `origin/main`. The Phase 4 log was read from
`origin/claude/k2-faq-intake:docs/44-parallel-phases-log.md`.

All shared ports must be free before any binding command:
55432, 8000, 3000, 55434, 54329, 8001, 3001, and populated-replay port 55435. Main-line work has priority,
then Phase 4, then this worktree. Never stop or reuse foreign processes.

## Permission card (before implementation)

| Field | Decision |
|---|---|
| Feature / owner | Facilities, project features, approved solar scenarios and nearby places; Marketing / Managers |
| Tab | Existing `projects`; no new tab permission, special, account grant or template change |
| View | Authorized project drafts, feature definitions, place references, source notes, English review state and reference template |
| Edit | Projects E saves project facilities/features/places and draft solar scenarios using expected revisions |
| Approve | Projects A maintains controlled reference data and approves/withdraws solar scenarios; approval cannot be by the scenario's editor |
| Separation | Existing Projects E/A separation remains; no automatic publication or approval from a save or translation |
| Templates | Unchanged; current account and template rows must survive migrations exactly |
| Agency | No access, including direct SQL/API/proxy, private bytes and cached drafts |
| Sensitivity | Internal drafts; publishable content carries `ai_exposure`. Source evidence and financial scenario text are excluded from AI input |
| Other tabs | Existing minimal project/REM references and same-project commercial types only. Glossary approvals remain Knowledge A |
| Shared surfaces | Existing field registry, translations and Phase 3 asset links/checklist. No public output, RAG, export or assistant changes |
| Endpoints / SQL | New bounded router and guarded SECURITY DEFINER entry points; exact route inventory and runtime function/table inventories accompany implementation |
| Rollout / verification | FORCE RLS and audit on every new table, private helpers closed; runtime deny/neighbor and stale-write tests, API and desktop/mobile browser tests, full programme gates and H1 |

## Implementation contract

- Extend existing facility rows additively. Preserve legacy notes, descriptions,
  collection semantics and unknown/present/absent/planned distinctions. Shared
  applicability uses explicit existing REM project IDs. Existing saves must
  participate in revision checks.
- Use the existing registry entries, localized maps and translation queue/review
  workflow. New marketing text must preserve reviewed English when Thai changes.
  Financial scenario text and evidence require manual English; no provider call.
- Feature metrics are validated against the catalog definitions in SQL, including
  numeric bounds, enums and unknown-key rejection. A commercial type must belong
  to the same project. The pending `feature.non_dee` glossary entry is retained.
- Solar values are entered scenarios with sources and dates. Saving never
  calculates bills/savings or approves a scenario. Approved content is protected
  from ordinary draft edits.
- Reference maintenance needs Projects A. CSV input is bounded and validated;
  identifiers and parent references are explicit. No guessed stations/ramps or
  coordinates. Nearest-station suggestions require both project and reference
  coordinates and are labelled as straight-line suggestions.
- Use existing Thai forms, semantic styles, tooltips, English review panel and
  dirty-state behavior. Verify 1280 px and 390 px without page overflow.
- Provisional migrations will be renumbered after a fresh rebase onto main. No
  historical migration bytes or other agents' migrations will be changed.

## Pending questions

Existing Q74 (reference source/rights/owner) and Q75 (official English name for
นอนดี) remain pending. No new question ID allocated during implementation.

## Verification and delivery (initial preparation)

Current verification is recorded in the resumed-work section below. No local
credentials have been generated and no port-binding command has run. No commit
or PR yet.

## Resolved STOP — credential-file conflict, 22 October 2026

The mandatory fresh `dev:db` setup conflicts with doc 41 §1.1 and §8 and the
owner's explicit prohibition on creating any other credential file:

- `scripts/local-db.mjs:38` calls `pg.initialise()` for a fresh cluster.
- Installed pinned `embedded-postgres/dist/index.js:143–144` creates
  `%TEMP%/pg-password-<random>` and writes the PostgreSQL password in plaintext;
  line 156 passes it to `initdb --pwfile`. Deleting it afterward does not satisfy
  the restriction against creating it.
- `scripts/initialise-disposable-db.mjs` already documents this exact problem and
  supplies the stdin-based initialization used by disposable tests and H1.
  The documented development setup does not use that helper.

No setup command, migration, service, test suite or provider call ran. The three
credential paths in this worktree do not exist. Their ignore rules, and the
artifact ignore rule, were verified without reading any credential contents.
The dependency-install process started for this worktree was identified by its
exact workspace cache argument and stopped (owned npm PID 22368); its command
exited. No foreign process was stopped, killed or reused. Dependency installation
is incomplete and generated files remain ignored.

Required upstream resolution: make the documented development setup reuse the
existing stdin initializer without creating a temporary password file, then
land Phase 3 on main. That setup-script change belongs to the main-line owner;
this branch does not alter shared setup logic or create a substitute.

Delivery status: only this preparation/permission log is changed. No application
code or migration was written. No commit, push or PR. Every gate is **not run**
(no passed/failed test count claimed); no screenshots. Q74 and Q75 remain pending,
with no new question IDs. Resume Phase 7 after the safety conflict is resolved;
Phase 8 still requires the owner-merged Phase 7 PR.

## Resumed after Phase 3 and Phase 5

Rebased cleanly onto `d9837de` (following `13fcc66`). The development setup
imports and calls the existing stdin initializer on a fresh cluster; the
credential-file conflict above is resolved. No port-binding command has run.
Per the owner's coordination update, PR 1 has temporary port priority until its
rebased push is reported. After that, priority is main-line work, Phase 4, then
this worktree. Final Phase 7 migration numbers must follow PR 1's migration after
it is merged. Non-binding implementation work may continue meanwhile.

## Phase 7 draft implementation — awaiting shared-port release

Root and admin `npm ci` and API `uv sync` completed in this worktree, using its
own ignored caches. The approved credential files remain absent and ignored.
No service or test runner has been started. The initial stopped-install report
above describes the earlier STOP, not the resumed installation.

Draft migrations (provisional, unapplied; final numbers must follow merged PR 1):

| File | Purpose |
|---|---|
| `202610220900_facilities_features_places.sql` | Additive facility/taxonomy columns, eight new tables, guarded metric definitions, FORCE RLS/audit, 15 facility codes, 19 feature codes and four sourced rail-line identities |
| `202610220901_facilities_places_commands.sql` | Projects E project saves, Projects A reference maintenance and independent solar approval, revision guards, same-project references, coordinate-only station suggestions and workspace reads |
| `202610220902_facility_media_translation.sql` | Extend existing translation and media dispatch, activate registry fields, manual-only financial English and atomic facility-cover selection using the existing media commands |

The provisional numbers intentionally cannot pass the consecutive hosted-profile
inventory yet. Final renumbering, normalized-LF checksums and inventory updates
are deferred until the required rebase after PR 1 merges. No older migration is
modified. No migration has been applied to any database.

The UI draft adds ส่วนกลาง, คุณสมบัติ and ทำเล to the existing project content
workspace. It reuses the field registry, English review panel, asset previews,
rights badges and Phase 3 upload/checklist links. Facility photos support a
single cover choice, ordering and Thai/English captions. Reference names and
evidence are entered manually; project marketing text uses the existing English
queue. Solar text and feature source notes have manual English review and never
enter AI drafting. Solar values remain exactly the entered scenario values.

The reference screen supplies a header-only CSV template with no sample real
stations or ramps. Preview runs the same guarded SQL in a rolled-back savepoint;
apply repeats revision checks and is atomic. Rail identities cite the BTS
operator history and BEM system map. Q74 still governs real station/ramp intake;
Q75 still prevents invented English for นอนดี.

Shared-file registrations so far:

- `apps/api/sena_hub_api/main.py`: import/register the new router.
- `apps/api/sena_hub_api/content_permissions.py`: eleven exact route ceilings.
- `apps/admin/lib/content-routes.ts` and `hosted-config.ts`: exact proxy/H1 route registration.
- `apps/admin/components/project-content-workspace.tsx`: three tab registrations and a keyed component that refreshes the existing parent data after saves.
- `apps/admin/components/media-common.tsx`: feature/place target labels, type members and context lookup registration.
- `apps/api/tests/test_permission_baseline.py`: the eleven-route manifest.
- `apps/api/tests/test_permission_db_baseline.py`: eight table/twelve function inventories and exact policy checks.
- `scripts/test-db.mjs`: one new SQL suite registration.
- `tests/content-upgrade.test.mjs`: register the new Phase 7 preservation fixture before/after migration replay. The fixture uses the replay's existing connection and port; it creates no separate service.

New tests cover CSV malformed input and atomic preview/apply, permission denial
and neighboring permission preservation, stale and concurrent writes, typed
metrics, same-project commercial types, independent solar approval and immutable
approved rows, translation staleness, source-coordinate suggestions, cover
switching and the original rights-aware media checklist. Six new browser
scenarios cover facility/photo editing, features/solar and CSV/place editing at
1280 px and 390 px. Screenshot paths will be under
`artifacts/project-content-phase7/`; none have been captured yet.

Non-binding checks on the current draft: admin typecheck and Python syntax
compilation passed; the documented offline webpack build passed (logs:
`artifacts/phase7/typecheck.log`, `artifacts/phase7/offline-build.log`). The SQL
wrapper scanner parsed the three LF-only migrations and TypeScript parsed the
six browser scenarios; these are syntax checks, not database/browser execution.
`git diff --check` passed. All five approved credential paths are absent and
Git-ignored; artifacts are ignored. API, DB, browser, populated replay and H1 gates are **not run**;
there are no runtime test counts or screenshot claims. Final credential scanning
will include the generated browser bundle and all gate artifacts after local
setup is permitted. All gates will be rerun after final rebase/renumbering.

No commit, push, PR, hosted/DW/REM access or live provider call. No new question
ID. The owner has been asked to report PR 1's rebased push and release of its
temporary reservation; until then the hold remains in effect. Phase 8 still
requires the owner-merged Phase 7 PR.

## Rebased after PR 1 merge — 22 October 2026

The owner released the temporary reservation and retired the Phase 4 parallel
worker. Port priority is now main-line work, then this worktree. PR 1 is merged
in `origin/main` at `ca67317`; this branch rebased onto that commit. Restoring
the draft required only additive adjacent registrations in the two permission
inventory tests and the SQL-suite runner. Both phases' registrations were kept;
no other phase's logic was changed.

Current Phase 7 migrations are `202610220069_facilities_features_places.sql`,
`202610220070_facilities_places_commands.sql` and
`202610220071_facility_media_translation.sql`, following merged migration 68.
The hosted profile and migration inventory now contain 71 migrations, with
normalized-LF checksums for these three files. The numbers will be checked again
against the newest main before the PR.

After all eight shared ports were confirmed free, the documented `dev:db`
setup successfully applied all 71 migrations and generated the three approved
ignored local credential files. The stdin initialization fix from `13fcc66`
is present and worked. This worktree's database was then stopped with Ctrl+C;
all eight ports were confirmed free again. No foreign process was touched.
Runtime gate results below will supersede the earlier not-run status.

## Pre-hold gate results — final post-Phase-9 rerun pending

| Gate | Passed / skipped / failed |
|---|---|
| Admin typecheck + documented offline webpack build | Passed after the pre-hold upload-link and checkbox corrections |
| Focused new API tests | 27 / 0 / 0; 1,975 other tests deselected |
| Full API suite | 1,991 / 11 unchanged opt-in skips / 0; 801.28 seconds; six existing deprecation warnings |
| Full DB suite | 35 SQL checks + 23 concurrency checks + 10 Node tests / 0 / 0 |
| Populated migration replay | Passed through 71; included in the 10 Node tests |
| Focused new browser scenarios | 6 / 0 / 0 at 1280/390 px before final upload-link assertion |
| Full browser suite, one run | 281 / 0 / 0; 12.0 minutes |
| Loopback H1 | Pending |
| Credential scan | Post-browser: 0 configured-secret matches across 29 changed files, 81 browser static files and 140 artifacts; final post-rebase rerun pending |

Ignored gate logs are under `artifacts/phase7/`: `typecheck.log`,
`offline-build.log`, `api-focused.log`, `api-full.log`, `db-full.log`,
`ui-focused.log`, `ui-full.log`, and `credential-scan.json`. Gate output is
redacted in memory before it reaches the console or logs. The scan also reads
members of any retained trace ZIP without extracting credential files.

The first six browser failures had three diagnosed test causes: a tooltip
selector matched a different hidden tooltip, an exact label included native
select option text, and a persona used `agency` instead of `agency_kin`.
Corrected selectors/persona passed all six scenarios in a fresh run. Review then
caught a wrong upload-link query key (`media_category` instead of the existing
`category`); the link now also supplies the facility tag, and the browser test
checks facility/category/tag preselection. Visual review tightened a checkbox's
inherited text-input width. No existing test was skipped, quarantined or
weakened, and no failure was dismissed as a flake.

Synthetic screenshots under `artifacts/project-content-phase7/` are
`facility-edit-{1280,390}.png`, `facility-photos-{1280,390}.png`,
`feature-metrics-{1280,390}.png`, `solar-entered-{1280,390}.png`,
`solar-approved-{1280,390}.png`, `reference-preview-{1280,390}.png`,
`place-edit-{1280,390}.png` and `place-saved-{1280,390}.png`.
Desktop features/photos and mobile facility, place, reference-preview and solar
screens were visually inspected. Every new browser flow checks horizontal page
overflow; the full suite refreshes the captures after the final styling fix.

Two further shared-file registrations complete the earlier list:
`supabase/hosted-test/profile.json` adds only the three new LF checksums;
`tests/supabase-test-migrations.test.mjs` requires count 71 and final filename 71.
No prior migration bytes or checksums changed. No new pending question,
hosted/DW/REM write, deployment or live provider call. `sena_h_approved` stays
false. Phase 8 still requires the owner's merge.

## Phase 9 port reservation — 22 October 2026

During the full browser run, the owner reserved the shared ports for main-line
Phase 9 gates. The running browser suite will finish without interruption;
after its cleanup this worktree will verify all eight ports are free. No new
port-binding command will start until a Phase 9 commit appears in `origin/main`.
Fetch checks will run every 15 minutes during this hold; code review and
documentation can continue. Once Phase 9 lands, priority remains main-line work
first, then this worktree, with all eight ports checked before each run.
The final rebase will place these migrations after the newest main migration
and every gate will run again on that rebased result.

The browser run finished with 281 passes, no skips and no failures. Cleanup
completed normally. An elevated listener check at 13:59 Bangkok time confirmed
ports 55432, 8000, 3000, 55434, 54329, 8001, 3001 and 55435 were all free. There
are no remaining services or test runs owned by this worktree.

Static review during the hold found the facility upload link was still visible
to viewers, although the existing API and upload workspace denied writes. The
link now requires Projects E, and the new browser cases assert viewers retain
the checklist link without upload/cover controls. The approved-solar capture
also waits for the save to finish and tabs to unlock. These subsequent UI/test
edits await the mandatory post-Phase-9 gate rerun.

Feature summary cards now retain the catalog's metric units and show whether
the feature applies to the whole project or a selected commercial type, so
reviewers can distinguish otherwise identical feature names and quantities.

Post-run visual review confirmed the mobile place checkbox now has the intended
size and the desktop feature form retains readable numeric units. The saved
solar screenshot was captured while its refresh was finishing; its next
capture waits for the unlocked tabs rather than retaining a transient busy
banner. The post-browser credential scan found zero configured-secret matches
across 29 changed files, 81 browser static files and 140 ignored artifacts.

Scheduled fetch at 14:10 Bangkok time still showed `origin/main` at `ca67317`;
Phase 9 was not present. The port hold remains active. Next fetch is due at
approximately 14:25 Bangkok time.

The continuing static audit aligned rail-line source validation with the other
reference tables by rejecting whitespace-only evidence. Existing API scenarios
now also assert that the original facility editor preserves every new detail,
advances the shared revision and invalidates a stale Phase 7 draft. These checks
are written but will not execute until the hold is released.

The scheduled 14:25 Bangkok fetch still showed `ca67317`, with no Phase 9 commit.
All port-binding commands remain on hold; next fetch is due around 14:40.

Read-only port checks observed the database/API/admin listeners at 14:26, then
all eight ports free at 14:31. No listener was stopped or reused. The commit
hold continues even when the ports are free.

The 14:40 Bangkok fetch again showed `ca67317`; Phase 9 is not yet in main.
The reservation remains in force, with the next fetch around 14:55.

Reference cards now show the source, source date, status and available
coordinates to Projects V users, so project editors can inspect the evidence
behind station suggestions without needing reference-maintenance permission.
The existing mobile/desktop place scenario asserts this read-only evidence.

The 14:55 scheduled fetch (completed at 14:56) still showed `ca67317`, so the
hold continues; the next fetch is due around 15:11 Bangkok time. The ignored
credential scanner now checks all five approved paths when present, including
passwords embedded in connection URLs, without printing their contents. It
again found zero matches across 29 changed files, 81 browser static files and
140 artifacts. Only port checks, fetches, review and ignored scan output have
run during this reservation.

## Rebased after Phase 9 — 22 October 2026

At 14:59 Bangkok time the shared `origin/main` ref showed `7451cf4`; an immediate
fetch and review of docs/41, docs/42 and docs/44 confirmed Phase 9 was pushed.
This releases the owner's commit hold. Port priority remains main-line work
first, then this worktree, with all eight ports checked before each binding run.
The Phase 3 stdin-fix commit `13fcc66` remains in main's ancestry.

This branch rebased onto `7451cf4368760676be21096c109352bab9c1bcb4`. Restoring the
owned draft produced eight conflicts, all confined to additive tab/route/policy
registrations and migration inventories. Both phases' registrations are retained;
the diff against the new main remains the same twelve shared registration files.
No Phase 9 business logic or historical migration was changed. The owned stash
`d98d5600ac31cc527637859adb7d1ce64335b023` remains as a backup.

Current migrations are:

- `202610220071_facilities_features_places.sql`
- `202610220072_facilities_places_commands.sql`
- `202610220073_facility_media_translation.sql`

They follow Phase 9 migrations 69/70. Their SQL is LF-normalized before hashing;
all seventy existing profile entries remain identical to main. The Phase 7
translation registration now appends to the owner list extended by Phase 9,
preserving its disclosure, sales-term and programme branches. The inventory
expects 73 migrations. Every gate will run fresh on this rebased result.

The updated programme log assigns Phase 6 and articles to main before Phase 8;
Phase 8 still requires the owner's merge of this Phase 7 PR. Q74 and Q75 remain
pending, and this branch adds no question ID.

### Gates on `7451cf4` plus Phase 7 migrations 71–73

| Gate | Result |
|---|---|
| Admin typecheck | Passed |
| Documented offline webpack production build | Passed |
| Full DB | 36 SQL checks + 23 concurrency checks + 10 Node tests passed; 0 skipped/failed |
| Populated migration replay | Passed through all 73 migrations; included above |
| Full API | 2,035 passed / 11 unchanged opt-in skips / 0 failed; 844.91 seconds; six existing deprecation warnings |
| Full browser, one run | 287 passed / 0 skipped / 0 failed; 11.9 minutes |
| Loopback H1 | Pending |
| Credential scan on this base | 0 matches across 29 changed files, 81 browser static files and 157 artifacts |
| Visual review on this base | Facility forms/photos, feature metrics, entered/approved solar, CSV preview and places inspected at desktop/mobile sizes |

Fresh logs are `artifacts/phase7/{typecheck,build,db,api}-rebased.log`. Every
port-binding gate begins with the elevated eight-port preflight. The DB runner
cleaned up normally; the typecheck/build started no server.

Facility form/photo captures now use their visible section as the screenshot
region, avoiding an unreadably tall image of the entire taxonomy list. The
same browser helper still checks the full document for horizontal overflow.

## Phase 6 port reservation — 22 October 2026

The owner has reserved the ports for main-line Phase 6 gates. The current full
287-case browser run will finish without interruption, then this worktree will
verify all eight ports are free. H1 and every new port-binding command remain
on hold until a Phase 6 commit appears in `origin/main`; fetch checks run every
15 minutes. Code and documentation review may continue during the hold.

After Phase 6 lands, this Phase 7 worktree has port priority for its complete
gate cycle, including the required rebase, renumbering and full rerun, through
opening the PR. It will rebase onto that new main and place only its own three
migrations after the newest main migration. The owner will be notified as soon
as the PR is open. The results on `7451cf4` above will then be historical.

The browser run completed normally at 15:44 Bangkok: 287 passed, no skips or
failures. Its runner exited with success after cleaning up its owned children.
The elevated port check at 15:44 found only port 55432 listening, already owned
by PostgreSQL from the main worktree; the other seven ports were free. No
foreign process was stopped or reused. The owner was notified immediately of
this actual state. Phase 7 has no running service or test and H1 remains on hold.

During the hold, the refreshed screenshots were inspected and the credential
scan passed. All five approved credential paths and `artifacts/` remain ignored.
The shared-file diff contains only the twelve documented registrations and
inventories. Both visual review and credential scan will run again on the final
Phase 6 rebase; these checks do not replace that required complete gate cycle.

The owner reiterated that main's Phase 6 owns migration 71. If that is the
latest migration at rebase time, this branch's three migrations become 72–74;
if articles or another main migration lands first, they move after that newer
migration instead. Only Phase 7 files are renamed. The hosted profile and all
inventories use normalized-LF hashes and the complete gates are rerun. A new
main migration before owner merge requires repeating this process before
requesting merge; the check is not limited to the first PR opening.

Hold-time review found that solar numeric inputs and place travel time lacked
visible units. The Phase 7 registry activation now supplies kW, kWh, baht,
percent and minutes, and its numeric form helper renders the registry unit in
the label. This small edit remains unverified until the required Phase 6 rerun;
the preceding gate results do not cover it. No service was started for the edit.

The scheduled elevated check at 16:00 Bangkok confirmed all eight shared ports
free. The owner was notified; the Phase 6 commit hold still applies even while
the ports are available. The 15:57 fetch still ended at `7451cf4`.

## Phase 6 rebase and final verification — 22 October 2026

The scheduled fetches at 16:12, 16:27, 16:42 and 16:57 Bangkok still ended at
Phase 9. The shared ref then advanced to `f3f86259744292c50d2722ba833fd897d0b36735`.
A fresh fetch verified Phase 6 and its delivery log; docs/41's new contract and
the unchanged Phase 4 log were read. All eight ports were free at 17:07 Bangkok.
The Phase 3 stdin-fix commit remains an ancestor of main.

Only this branch was rebased. Restoring its own stash produced six conflicts
in additive route registrations and permission/migration inventories. Both
phases' entries were preserved; no upstream business logic was changed. The
shared-file diff remains the same twelve files and 68 additions/14 deletions.

Only Phase 7's provisional files were renumbered:

- `202610220072_facilities_features_places.sql`
- `202610220073_facilities_places_commands.sql`
- `202610220074_facility_media_translation.sql`

All three SQL files were normalized to LF before hashing. The hosted profile
retains all 71 main entries exactly and appends only these three. The migration
inventory now expects 74 files. Main's migration 71 was not edited or renamed.
No new dependency installation is needed because Phase 6 changed no lockfile.

| Final gate | Result |
|---|---|
| Admin typecheck and offline webpack build | Passed; production compilation and TypeScript completed without errors |
| Full DB including populated replay | 37 SQL + 23 concurrency + 10 Node tests passed; 0 skipped/failed; all 74 migrations replayed |
| Full API | 2,047 passed / 11 unchanged opt-in skips / 0 failed; 841.48 seconds; six existing deprecation warnings |
| Full browser in one run | 293 passed / 0 skipped / 0 failed; one worker, no retries; 11.5 minutes |
| Loopback H1 | 11 protocol + 45 browser tests passed (35 core, 3 flags, 7 outage); 0 skipped/failed |
| Fresh visual review and credential scan | Passed; 0 credential matches across 29 changed files, 81 browser static files and 197 artifacts |

Final gate logs use `artifacts/phase7/*-final.log`. A fresh fetch before PR
opening/merge request will detect any further migration requiring renumbering
and another complete gate cycle. No process from another worktree is reused.

### Final delivery checks

The 17:45 Bangkok fetch still resolved `origin/main` to `f3f8625`; no additional
main migration had landed. Both programme logs were reread before preparing
the PR. All eight shared ports were confirmed free after H1 cleanup. This
worktree has no running database, API, admin or test process.

All sixteen Phase 7 screenshots were refreshed by the final browser run under
`artifacts/project-content-phase7/`. Desktop and mobile facility forms/photos,
feature metrics, entered/approved solar scenarios, CSV preview and place forms
were visually reviewed. Solar and travel-time labels show the registry units.
The six Phase 7 cases check whole-page overflow at both 1280 px and 390 px.

There is no functional scope deviation. The owner-directed holds and rebases
changed delivery sequencing only. No new pending question was added; Q74 and
Q75 remain pending. Phase 8 remains the main-line owner's work after articles
and the owner's merge of this PR. Phase 7 does not merge its own PR.

Credential receipt: `artifacts/phase7/credential-scan.json`. The final scan
covers changed files, browser static files and artifacts, including archive
members, without printing values. All five approved credential paths remain
Git-ignored; no credential or artifact is staged. Only this branch is pushed.
