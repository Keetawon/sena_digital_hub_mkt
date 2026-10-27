# 42 — Project content programme log

## Phase 1 — complete, 21 October 2026

Authorised programme: [design and verbatim owner decisions](41-project-content-and-faq.md).
Work began on clean `main`. The owner approved the two existing ignored local
credential locations and ignored `artifacts/`. No new credential file was made.

### Delivered scope

- Migration `202610210057_public_content_boundary.sql`: explicit public-field
  allowlists for projects, nested brands/models/media and promotions. Website
  reference text, internal UUIDs, REM/source fields and private file metadata stay
  internal. Raw views lose direct consumer access. Public file IDs/URLs use an
  immutable checksum, with a digest fallback for legacy URL-only media.
- Public file reads preserve published eligibility and current-rights checks;
  download filenames use the public identity. Staff/DW reads keep their existing
  contracts. Existing content, historical snapshots, reviews and accounts are not
  rewritten. Only derived readiness/progress caches are recomputed.
- Readiness uses additional project collection images for the gallery target and
  `floor_plan` for model plans. Hero/thumbnail blockers remain unchanged.
- English inputs for brand description, advertising disclaimer, SEO title and
  description, and facilities. Other locale-map values survive edits. Facility
  rows stack on mobile so the complete editor fits the screen.
- Project/brand publish and rollback comparisons use the same projection as the
  public reader and render every outgoing field, both locales and nested data.
  Existing permission redactions apply before preview; partial reviews cannot be
  confirmed. Dialogs open at the heading rather than jumping to the reason box.
- Q74 (IT + Marketing: approved rail/expressway reference source and maintenance)
  and Q75 (Brand manager + Marketing: official English name for นอนดี) added as
  PENDING. The 75-ID catalogue and documentation agree.

### Verification

| Gate | Result |
|---|---|
| Admin typecheck + offline webpack production build | Passed |
| Full API suite | 1,888 passed, 11 existing opt-in skips, 0 failed; 6 existing deprecation warnings; 766.55 s |
| Full DB suite | 53 SQL/concurrency checks + 8 Node tests passed; 0 skipped/failed |
| Browser suite | Final full run: 259 passed, 0 skipped/failed; 8.5 minutes. Earlier focused content run: 28 passed |
| Disposable upgrades / migration replay | Passed; content, versions, reviews, accounts and permissions preserved |
| Loopback H1 | 11 protocol + 45 browser tests passed (35 core, 3 flags, 7 outage); 0 skipped/failed; all 57 migrations |
| Credential scan | Passed: no configured credential values in changed files, browser static files or test artifacts; receipt `credential-scan.json` |

Gate logs are ignored under `artifacts/project-content-phase1/`:
`admin-build.log`, `api-tests.log`, `db-tests.log`, `h1-tests.log`, `ui-content.log`,
`ui-tests.log` (initial full run), `ui-final.log` (259 passed). The full API `-ra` log records every unchanged opt-in skip: Actuals
read-back, Archive, assistant DB/model/tools (three), demo Finance, real local OCR,
H1, Hub demo, Promotions DB, and the fixed local residential seed. H1 is exercised
separately; tests never call a live AI provider.
Initial failures identified an SVG fixture still using a UUID URL and a browser
assertion reading a facility before save completion. The checks were corrected
for the new contract/save confirmation; no security assertion was removed and no
existing test was skipped, quarantined or weakened.
The first full browser run passed 256 cases and found three stale assertions:
two still expected five brand comparison fields and one omitted the new English
disclaimer from its exact input-order list. Those expectations now include all
seven outgoing brand fields and the English input; the full rerun passed all 259.
The staged whitespace check then found CRLF in the new migration. It was
normalized to LF before its first commit and its two inventory checksums updated.
All 9 checksum/profile tests and the full DB suite (including disposable replay
and preservation) passed again; SQL content is unchanged. The final byte-check
run is recorded in `db-final-bytes.log`.

### Screenshots

The new live local tests use synthetic content and preserve the original draft
fields. Screenshots remain ignored, never force-added:

- Project English: [1280 px](../artifacts/project-content-phase1/project-english-1280.png), [390 px](../artifacts/project-content-phase1/project-english-390.png).
- SEO English: [1280 px](../artifacts/project-content-phase1/seo-english-1280.png), [390 px](../artifacts/project-content-phase1/seo-english-390.png).
- Facility English: [1280 px](../artifacts/project-content-phase1/facility-english-1280.png), [390 px](../artifacts/project-content-phase1/facility-english-390.png).
- Brand English: [1280 px](../artifacts/project-content-phase1/brand-english-1280.png), [390 px](../artifacts/project-content-phase1/brand-english-390.png).
- Brand comparison: [1280 px](../artifacts/project-content-phase1/brand-review-1280.png), [390 px](../artifacts/project-content-phase1/brand-review-390.png).
- Project comparison: [1280 px](../artifacts/project-content-phase1/project-review-1280.png), [390 px](../artifacts/project-content-phase1/project-review-390.png).

The final project mobile comparison, brand desktop comparison and mobile facility
captures were visually reviewed. Dialog headings and the full mobile facility
labels/English value are visible; automated checks also cover both viewport widths.

### Implementation decisions and boundary

No business-scope deviation. Two supporting test-runner changes enforce the
owner's credential restriction: PostgreSQL receives its initialization password
through stdin, and loopback H1 holds its connection/R2 fixture configuration in
memory. H1's reviewed inventory appends migration 57 without changing historical
hashes. The H1 API helper changes only how its existing fictional configuration
is supplied; real signing, destination validation, Auth and DB checks still run.

The working database has not been migrated or reseeded. No hosted resource,
provider, DW, REM or website write occurred; `sena_h_approved` remains false.
Checkpoint: the `main` commit containing this completion entry, with subject
`Fix public content boundary and publication review`. Its hash and confirmed push
are reported in the delivery message. Next: Phase 2 core data and FAQ
identity/version/editor work under the programme's existing STOP conditions.

## Phase 2 — complete

Phase 1 checkpoint: `b3b08dd34025fafb1efab7d4d92ac2c71a0dfd21`, pushed to
`origin/main` and verified against the remote-tracking ref. The Phase 2 permission
card and additive preservation strategy are recorded in doc 41 before coding.
No Phase 2 migration has been applied to the working database.

### Implementation

- Migrations `202610210058_project_content_core.sql`,
  `202610210059_content_versions.sql`, `202610210060_content_translation.sql`
  and `202610210061_content_readiness.sql` add the registry, facts, buildings,
  contacts, content/FAQ versions, controlled questions, glossary and translations.
  All fifteen new tables have audit metadata, change triggers and FORCE RLS.
  Runtime writes use revision-checked commands; worker helpers remain closed.
- The field registry supplies labels, usage tooltips, required languages and
  private draft readiness. Future-phase fields, reference metadata and evidence
  fields are seeded without enabling future publication behavior. Registry edits
  require an ACTIVE internal admin and the explicit new Projects special; no
  account permissions or template assignments are changed.
- Facts read the existing local REM snapshot, preserve unknowns and source dates,
  distinguish both unit counts, require override reasons and compute counts and
  parking ratios. Buildings can prefill from their own REM snapshot rows.
  Contacts support project, brand and corporate scopes; company-domain and
  shared-mailbox checks guard email. No DW sales email is imported.
- `/content` provides facts, buildings, narrative versions, selling points,
  contacts, reviewed English and readiness. `/faq` provides Manager-approved
  questions, corporate and scoped answers, explicit phase applicability, sources,
  English review, staff text preview and immutable submitted history. No new
  website publication action is available in this phase.
- Thai edits queue bounded translation work without replacing reviewed English.
  Changed sources, stale leases and revoked authority invalidate worker results;
  failed work has an explicit retry. Numbers, placeholders and approved glossary
  renderings are protected. Tests stub the provider. Financial FAQ topics stay
  outside AI drafting, with manual English review available.
- Existing FAQ/section rows and accepted reviews survive migration unchanged;
  their new versions are additive copies. Subsequent source rejection withdraws
  the derived current draft. The disposable populated-upgrade test compares
  original content, reviews, versions, accounts and permissions after each new
  migration.

### Verification

| Gate | Result |
|---|---|
| Admin typecheck + offline webpack production build | Passed |
| Full API suite | 1,913 passed, 11 unchanged opt-in skips, 0 failed; 6 existing deprecation warnings; 664.54 s |
| Full DB suite | 54 SQL/concurrency checks + 8 Node tests passed; 0 skipped/failed |
| Disposable populated upgrade / migration replay | Passed through all 61 migrations; original content, reviews, versions, accounts and permissions preserved |
| Loopback H1 | 11 protocol + 45 browser cases passed (35 core, 3 flags, 7 outage); 0 skipped/failed |
| Browser suite | Final full run: 263 passed, 0 skipped/failed; 9.2 minutes. Earlier focused run: 4 passed at 1280/390 px |
| Credential scan | Passed across changed files, browser static files and artifacts; receipt `credential-scan.json` |

Logs are ignored under `artifacts/project-content-phase2/`: `admin-typecheck.log`,
`admin-build.log`, `api-tests.log`, `db-final.log`, `h1-tests.log`, `ui-focused.log`
and `ui-final-rerun.log`. The API `-ra` log records the same eleven opt-in skips as
Phase 1; H1 runs separately. No tests were skipped, quarantined or weakened for
this phase. The synthetic REM SQL fixture was corrected to include its required
project identity before the full DB gate passed.

The initial API run found two inventory expectations that needed the explicit
new route/shared-boundary entries; they were extended without altering historical
manifests or reducing denial checks. The initial browser run found a hidden
tooltip locator and a question-key input whose help text polluted its accessible
label. The locator was scoped to its fact card and the label/help association was
corrected. Final review also aligned glossary proxy keys with the database and
added a browser approval case for a key beginning with a number.

The first full browser run exposed older synthetic handlers that returned an
empty array for every otherwise unknown GET. The new field registry has an
object contract, so those handlers crashed the project/brand detail fixtures.
Ten relevant specs now pass only the exact registry GET to the real disposable
API; all existing write, rights, retry and concurrency assertions are retained.
Because the running suite had already loaded the old fixture code, its verified
owned Playwright process was stopped, the runner cleaned up its services, and
the entire browser suite was restarted. `ui-final.log` retains that interrupted
diagnostic run; it is not counted as a passed gate.

### Screenshots

Synthetic local data only, saved in ignored `artifacts/` and never force-added:

- Facts and registry tooltips: [1280 px](../artifacts/project-content-phase2/facts-1280.png), [390 px](../artifacts/project-content-phase2/facts-390.png).
- Buildings: [1280 px](../artifacts/project-content-phase2/buildings-1280.png), [390 px](../artifacts/project-content-phase2/buildings-390.png).
- Narrative and selling points: [1280 px](../artifacts/project-content-phase2/narrative-1280.png), [390 px](../artifacts/project-content-phase2/narrative-390.png).
- English review: [1280 px](../artifacts/project-content-phase2/english-1280.png), [390 px](../artifacts/project-content-phase2/english-390.png).
- Contacts: [1280 px](../artifacts/project-content-phase2/contacts-1280.png), [390 px](../artifacts/project-content-phase2/contacts-390.png).
- Manager question approval: [1280 px](../artifacts/project-content-phase2/question-bank-1280.png), [390 px](../artifacts/project-content-phase2/question-bank-390.png).
- FAQ editor: [1280 px](../artifacts/project-content-phase2/faq-editor-1280.png), [390 px](../artifacts/project-content-phase2/faq-editor-390.png).
- FAQ preview: [1280 px](../artifacts/project-content-phase2/faq-preview-1280.png), [390 px](../artifacts/project-content-phase2/faq-preview-390.png).
- Submitted history: [1280 px](../artifacts/project-content-phase2/faq-history-1280.png), [390 px](../artifacts/project-content-phase2/faq-history-390.png).
- Registry: [1280 px](../artifacts/project-content-phase2/registry-1280.png), [390 px](../artifacts/project-content-phase2/registry-390.png).
- Glossary approval: [1280 px](../artifacts/project-content-phase2/glossary-1280.png), [390 px](../artifacts/project-content-phase2/glossary-390.png).

The mobile fact tooltip, English review, glossary and FAQ editor plus desktop FAQ preview
were visually inspected. Automated checks cover both widths and reject horizontal
page overflow.

### Questions and coordination

At Phase 2 completion, Q76 awaited the company shared-mailbox domain policy;
the owner's 22 October answer closes it in Phase 3 below. Disposable tests use
synthetic addresses. Q74 (rail/expressway reference source) and Q75 (official
English name for นอนดี) remain pending. No live provider call.

The owner's revised work allocation is **1 → 2 → 3 → 5 → 6 → 8** for this
workstream. A separate agent owns Phases 4 and 7 and the articles portion of Phase
10 through owner-merged pull requests. Pull `origin/main` before each new phase;
stop on conflicts or if changes to that agent's added files are needed. Phase 6
waits for merged Phase 4; Phase 8 waits for merged Phase 7. Do not build substitutes,
renumber that agent's migrations, force-push or rewrite main. Phase 8 still ends
at the original integration STOP.

Checkpoint: the `main` commit containing this completion entry, with subject
`Add project content and FAQ draft workspaces`. Its hash and confirmed push are
reported in the delivery message. Next: pull `origin/main`, then Phase 3 media
under the revised work allocation. The working database was not migrated or
reseeded, no hosted/DW/REM/provider write occurred, and `sena_h_approved` remains
false. The two approved ignored local credential paths are checked before commit;
screenshots and gate logs remain ignored under `artifacts/`.

## Phase 3 — complete, 22 October 2026

Phase 2 was pushed as `01d288f5d6830af17de7ca3fec1fd5fb2f62d88e`.
`git pull --ff-only origin main` completed before Phase 3. A later fetch still
matched that baseline; no parallel-agent pull request was merged or changed.

### Delivered scope

- Migrations `202610210062_media_metadata.sql`,
  `202610210063_media_coverage_links.sql` and `202610210064_media_jobs.sql` add
  fourteen media categories, controlled FK-backed tags, contextual image links,
  coverage rules/checklists, external clips/tours and private leased jobs. All
  seven new tables have FORCE RLS and audit; existing content, reviews, asset
  rights/bindings, accounts and migration bytes remain unchanged.
- `/media` provides checklist deep links, batch upload and explicit batch apply,
  per-file metadata and retry, real context pickers, facility covers, separate
  AI suggestions, tag approval, rule editing and clip metadata/manual checks.
  Registry tooltips explain fields. Thai desktop/390 px layouts use no animation.
- Coverage counts eligible rights and effective/capture dates, confirmed metadata,
  room tags and known floors while respecting skipped floors. Unknown floors
  stay unknown. Promotion banner dates stay within their promotion. Only hero
  and thumbnail block publication; other images feed recommended readiness.
- E1 work resizes verified local images and uses only approved marketing context.
  Legal/PDF/finance/customer content is excluded. Suggestions do not confirm
  metadata or rights. New tags remain proposals. Fixed YouTube/TikTok endpoints
  provide separate suggestions and periodic link checks; provider HTML and
  arbitrary remote thumbnail URLs are discarded. Tests use provider stubs.
- Revision checks, concurrent clip creation, private bytes, shared promotion
  authority and worker completion after source/permission changes are covered.
  The API runtime cannot assume the media worker role or forge its results.
- Q76 is closed by the owner's 22 October decision and folded into migration
  `202610220065_contact_mailbox_policy.sql`: valid email domains are unrestricted,
  shared/company-mailbox confirmation remains required, free webmail shows a
  visible advisory warning, and existing four-eyes publication approval remains.
  Domain registry controls are retired without rewriting prior migrations or
  historical rows. Regression checks cover webmail, custom domains, required
  confirmation, warning visibility and the closed question.
- The owner's Phase 7 bootstrap follow-up is included in this Phase 3 commit:
  `scripts/local-db.mjs` now calls the existing stdin initializer only when
  `PG_VERSION` is absent. `pg.start()` and subsequent setup are unchanged, and
  initialized working databases skip this path. No temporary plaintext password
  file is created. Two isolated regressions intercept credential-file writes,
  verify the stdin prompts and check that existing databases are not initialized
  again; they are included in `test:db`.

### Verification

| Gate | Current result |
|---|---|
| Admin typecheck + offline webpack build | Passed, including Q76 and the final media UI |
| Full API suite | Passed: 1,936 tests, 11 unchanged opt-in skips and 6 existing deprecation warnings |
| Database suite | Passed: 55 SQL/concurrency checks plus 10 Node cases, including known/skipped floors, capture age, room context, revision guards and the two initializer regressions |
| Populated upgrade | Passed as part of the database suite; preserves original content, reviews, accounts, asset metadata, rights and bindings through all 65 migrations |
| Loopback H1 | Passed after Q76: 11 protocol + 45 browser cases |
| Local DB initialization | 2 isolated regressions passed; no real service startup or credential-file writes |
| Phase 3 browser cases | All 6 passed in the full browser run: mailbox warning/confirmation, batch retry/lost response/AI separation, tag retirement/reactivation and clip/rule flows at 1280/390 px |
| Existing browser regression | The 269-case full run had 268 passes and one desktop SVG upload timing failure. After the test synchronization correction described below, all 9 affected brand-logo cases passed. All 269 unique cases have passing evidence across these runs |
| Credential scan | Passed: 49 changed files, 78 browser files, 52 current artifacts; no configured credential matches |

The earlier port conflict with `D:/Personal/workspace/sena_hub_parallel` is
resolved. The owner coordinated release; its runners were preserved and no port
guard was bypassed. Tests resumed only after the required ports were free.

Phase 3 implementation and verification are complete. Current logs are
`db-final.log`, `admin-typecheck.log`, `admin-build.log`,
`h1-q76-final.log`, `ui-focused-q76.log`, `ui-batch-final.log` and
`api-final-q76.log`, `ui-final.log`, `ui-logo-final.log` and
`local-db-initialisation.log`, all ignored under
`artifacts/project-content-phase3/`.

Initial checks caught mobile wrapping, ambiguous tooltip selectors, a browser
save-response race, a suggestion fixture relying on newest-first file order,
the Q76 migration's missing transaction wrapper and an absent synthetic
construction row. The corrected checks passed without weakening their assertions.

The full browser run's desktop SVG upload succeeded after 5.7 seconds, beyond
the test's five-second display assertion. Cleanup then removed its fixture before
the subsequent binding could finish. The test now awaits that exact file's upload
response and asserts 201 before checking the replacement; SVG sanitization,
rights, role and immutable-history assertions remain intact. The affected
nine-case suite passed. The entire browser suite was not repeated after this
test-only synchronization change.

Checkpoint: the `main` commit containing this completion entry, with subject
`Add project media workspace and coverage checks`. Its hash and confirmed push
are reported in the delivery message. Both approved local credential paths and
`artifacts/` were checked as Git-ignored; no artifacts are staged.

### Screenshots

Synthetic data only, ignored and never force-added:

- Checklist: [1280 px](../artifacts/project-content-phase3/checklist-1280.png), [390 px](../artifacts/project-content-phase3/checklist-390.png).
- Batch fields and tooltip: [1280 px](../artifacts/project-content-phase3/batch-1280.png), [390 px](../artifacts/project-content-phase3/batch-390.png).
- Media library: [1280 px](../artifacts/project-content-phase3/library-1280.png), [390 px](../artifacts/project-content-phase3/library-390.png).
- Separate suggestion and confidence details: [1280 px](../artifacts/project-content-phase3/suggestion-1280.png), [390 px](../artifacts/project-content-phase3/suggestion-390.png).
- Approver coverage rules: [1280 px](../artifacts/project-content-phase3/rules-1280.png), [390 px](../artifacts/project-content-phase3/rules-390.png).
- Broken clip handling: [1280 px](../artifacts/project-content-phase3/clips-1280.png), [390 px](../artifacts/project-content-phase3/clips-390.png).
- Q76 mailbox warning and required confirmation: [1280 px](../artifacts/project-content-phase3/mailbox-warning-1280.png), [390 px](../artifacts/project-content-phase3/mailbox-warning-390.png).

The mobile mailbox warning, checklist, library/suggestion and clip views were
visually inspected; automated checks reject horizontal page overflow.

### Questions and coordination

No new business question. Q74 and Q75 remain pending; Q76 is resolved above. Automatic metadata
fetch/checks cover YouTube and TikTok; other providers use manual metadata/checks
because this phase adds no provider credentials or undocumented endpoint.
Feature/place/article/disclosure bindings reject saves until their owning phase
provides a real guarded reference. These limits are explicit in the Phase 3
design; no replacement tables or content were invented.

Next is Phase 5 after a fresh pull of `origin/main`. Phase 6 still waits for the
owner-merged Phase 4. No working-database migration, hosted/DW/REM/provider write
or live AI call ran. `sena_h_approved` remains false; approved credential files
and all artifacts remain ignored.

## Phase 5 — complete, 22 October 2026

Pulled `origin/main` with `--ff-only` before starting; it was already at
`13fcc661460eb96b5179759a2dc786f92107f764` and the working tree was clean.
No Phase 4/7 parallel-agent PR is present at this base. The Phase 5 permission
card and source-grain/versioning decisions are recorded in docs/41 before code.
Scope: the six-step unit-type wizard, retained REM references with staff-only
snapshot comparison, reviewed unit content/media, and E2/E3 Marketing prices.
Phase 6 remains dependent on the owner-merged Phase 4.

### Delivered scope

- Migration `202610220066_unit_type_workflow.sql` extends existing commercial
  types without changing their identities, content or REM mappings. It adds
  categories, special rooms, ceiling height, furniture, highlights, exposure,
  price mode and immutable review versions. Submitted versions cannot be edited;
  edits to approved content start a new draft and preserve the prior approval.
- The six-step Thai editor covers details, concept/highlights, floor plans,
  room photos/360, REM mapping, and prices/readiness. It reuses the media library,
  clip editor and English review panel, preserves unsaved input on errors, and
  retains the previous basic/bulk editors. Missing recommended plans or room
  photos do not block submission. Publication still belongs to Phase 8.
- REM model identity, area and model-group counts/prices come only from the
  existing local snapshot/evidence. Groups appear once; shared mappings never
  allocate counts to a Marketing type. Missing values stay unknown, rooms are
  never inferred, and availability directs staff to Sales. Suggested name/area
  matches require explicit selection. Automatic REM prices remain disabled.
- Commercial media bindings gain bilingual captions, a controlled room tag and
  a floor number checked against the house's storeys. Changing storeys cannot
  orphan an existing floor binding. Frozen unit payloads include only eligible
  rights-approved, confirmed, publication-enabled media and public identifiers.
  Reused tour content authors also count for four-eyes approval; tour saves and
  unit submission serialize on the project row.
- Migration `202610220067_marketing_prices.sql` adds draft/review/approval/withdraw
  workflows for starting and unit prices. Every price states its type, size,
  conditions and validity of at most 60 days. REM differences warn without
  blocking. Price English is entered/reviewed manually, with no AI job. A private
  composition helper omits expired, hidden or internal prices and requires an
  approved type; existing public endpoints and snapshots are unchanged.
- Seven private API routes use Projects V/E/A, project revision checks and the
  existing H1 proxy boundary. Three new tables are audited with FORCE RLS;
  fifteen new functions are inventoried, private by default, and use fixed
  search paths. Authors cannot approve their own version after a role change.
  No account, permission-template or historical-content rewrite is performed.

### Verification

| Gate | Result |
|---|---|
| Admin typecheck + offline webpack production build | Passed |
| Full API suite | 1,954 passed, 11 unchanged opt-in skips, 0 failed; 6 existing deprecation warnings; 722.04 s |
| Full DB suite | 56 SQL/concurrency checks + 10 Node tests passed; 0 skipped/failed |
| Relevant browser suite | 45 passed, 0 skipped/failed, including all 4 new cases at 1280/390 px; 4.1 minutes |
| Disposable migration replay / populated upgrade | Passed; prior content, bindings, REM references, versions, reviews, accounts and permissions preserved |
| Loopback H1 | 11 protocol + 45 browser tests passed (35 core, 3 flags, 7 outage); 0 skipped/failed; all 67 migrations |
| Credential scan | Passed: 0 configured-credential matches across 29 changed files, 78 browser static files and 46 artifacts; receipt `credential-scan.json` |

Gate logs are ignored under `artifacts/project-content-phase5/`:
`admin-typecheck-final.log`, `admin-build-final.log`, `db-final.log`,
`ui-final.log`, `api-verified.log`, `h1-verified.log`. The focused new browser
run also passed all 4 cases (`ui-current.log`). The migration-byte inventory
preserves every prior migration checksum and adds only migrations 66/67.
The API log names each unchanged opt-in skip; H1 is exercised separately above.

The first browser probe found an exact-label selector that also included native
select options; it now uses the control's accessible role/name. All four new
desktop/mobile workflows subsequently passed. The first full API run passed
1,953 tests with 11 unchanged skips and found one incorrect new inventory
expectation: default Admin was listed as an approver. The server correctly
returned 403. The inventory now requires the existing Projects A capability,
with an explicit default-admin denial assertion; no account or guard changed.
H1 initially caught a stale count of 65 migrations; its exact inventory now
requires all 67. No test is skipped, quarantined or weakened for this phase.

### Screenshots

All captures use synthetic disposable data and remain ignored:

- Details and registry hints: [1280 px](../artifacts/project-content-phase5/details-1280.png), [390 px](../artifacts/project-content-phase5/details-390.png).
- REM mapping and unknown values: [1280 px](../artifacts/project-content-phase5/rem-1280.png), [390 px](../artifacts/project-content-phase5/rem-390.png).
- Floor plans and media workflow: [1280 px](../artifacts/project-content-phase5/plans-1280.png), [390 px](../artifacts/project-content-phase5/plans-390.png).
- Separate approval and frozen history: [1280 px](../artifacts/project-content-phase5/approval-1280.png), [390 px](../artifacts/project-content-phase5/approval-390.png).
- Price validation with retained inputs: [1280 px](../artifacts/project-content-phase5/price-1280.png), [390 px](../artifacts/project-content-phase5/price-390.png).

Desktop details/REM and mobile plans, approval history and prices were visually
inspected. Every new browser workflow checks horizontal viewport overflow.
Frozen history renders all payload fields with readable Thai labels, using the
existing publication-value renderer and retaining both locales and unknowns.

### Questions and coordination

No new business question or change to the accepted scope. Q74 and Q75 remain
pending, Q76 was closed in Phase 3. Prices use existing snapshot groups as
comparison evidence, not a newly invented model-level allocation. No live AI
provider, working-database migration, hosted write, or DW/REM write is needed.
The next phase remains Phase 6, only after a fresh pull confirms Phase 4 is merged.
All programme gates passed before commit. No working/hosted database migration,
live provider call or external-system write ran; `sena_h_approved` stays false.
The approved credential files and artifacts remain Git-ignored.

## Phase 9 — C5 complete (22 October 2026)

Owner advanced Phase 9 ahead of the Phase 6/8 dependencies and lifted only its
Phase 8 report gate. Pulled `origin/main` before starting; base is
`d9837de848135ec61db6278040791612e21b2ec3`, with a clean working tree.
Phase 4 PR #1 was owner-reviewed at `7383a48` and merged as `ca67317` at
06:17:11 UTC. Its implementation remains untouched. The owner ended Claude
Code's assignment after Phase 4 and returned articles (docs/41 §3.9) to this
workstream. Next sequence after a passed Phase 9 push: Phase 6, Phase 10a
articles, then Phase 8 after the continuing Phase 7 agent's PR merges, then
STOP. Finish articles before Phase 8 even if Phase 7 merges sooner.

Fast-forwarded main to the owner's Phase 4 merge. Restoring the preserved
Phase 9 work produced six shared-file conflicts; stopped and reported them.
The owner then authorized resolution. Both phases' routes, permission
inventories, API documentation and tests are retained. Only the uncommitted
Phase 9 migrations were renumbered to 69/70; Phase 4 migration 68 and its added
implementation/tests remain unchanged. The Phase 9 stash is retained until
the verified commit is safely pushed.

Owner's updated port coordination starts at **05:43:41 UTC** on 22 October:
fetch every 15 minutes. Test runners may bind ports after a new
`origin/claude/k2-faq-intake` head contains `origin/main`, or after two hours
without a new push (07:43:41 UTC). In both cases 55432/8000/3000 must be free;
do not stop or bypass another process. At 06:13:15 UTC the new head
`7383a484d34df13edd5eb9bc53013ec89fab1f3c` contained `origin/main`, releasing
the test gate. The owner's subsequent instruction gives this workstream port
priority before the continuing `parallel/c4-facilities-places` agent. Other
agents' processes must still never be stopped.

Code adds typed project disclosures, sales terms, programmes and construction
records, immutable submitted versions, independent approval, private Legal
uploads, manual English review and the investor section. Real promotions gain
audiences, verified scopes, booking/transfer windows and rights-filtered banner
snapshots while retaining DATA/LEGAL review and environment guards. The
permission card and contracts are in docs/41 and docs/05.

Migrations added: `202610220069_project_commercial.sql` and
`202610220070_real_promotions.sql`. No existing content, review or account state
is rewritten. The independent Phase 4 migration remains byte-for-byte unchanged.

### Verification

| Gate | Result |
|---|---|
| Admin typecheck + offline webpack production build | Passed on the final implementation |
| Full API suite | 2,008 passed, 11 unchanged opt-in skips, 0 failed; 6 existing deprecation warnings; 812.81 s |
| Full DB suite | Final 58 SQL/concurrency checks + 10 Node tests passed; 0 skipped/failed |
| Relevant browser suite | Final 52 passed, 0 skipped/failed, 3.7 minutes; includes 6 new cases at 1280/390 px, Phase 4 intake and reduced-motion regression |
| Disposable migration replay / populated upgrade | Passed; all 70 migrations, preserving existing content, reviews, accounts and permissions |
| Loopback H1 | 11 protocol + 45 browser tests passed (35 core, 3 flags, 7 outage); 0 skipped/failed; all 70 migrations |
| Credential scan | Passed: 0 configured-credential matches across 31 changed files, 80 browser static files and 35 artifacts; receipt `credential-scan.json` |

Logs remain ignored under `artifacts/project-content-phase9/`: `typecheck-final.log`,
`build-final.log`, `db-final.log`, `api-final.log`, `api-focus-final.log`,
`ui-final.log` and `h1-final.log`. The 68 prior migration inventory entries are unchanged;
only migrations 69/70 were added. Phase 4's added implementation and tests
have no changes.

The first focused probes found new fixture mistakes: a malformed synthetic PNG,
an unbound banner that was correctly hidden by RLS, and expectations that did
not match existing private-file and media-workspace contracts. The fixtures now
use valid synthetic image bytes, bind before rights review, and assert the
actual private 404, revocation decision and upload context. The focused
promotion suite passed all 9 tests. The full API run's exact permission mapping
passed but its older publication route count still expected 20; it now expects
21 and explicitly includes the new promotion-reference route. No existing test was skipped, quarantined
or weakened. The pytest safety guard also refused an attempted direct model
test outside the disposable runner; it was not bypassed.

Final review also tightened banner exposure: an open link cannot broaden a
web-only asset, and a later restriction on the live asset also restricts its
published banner. A regression assertion covers the frozen exposure. The
database and API gates are rerun after this change.

The first relevant browser run found a translation-panel cleanup clearing
another promotion form's dirty flag. Draft, commercial scope and publisher
review now have independent dirty state; the commercial panel combines its
own form and translation editing state. Existing stale-save/Escape protection
and both viewport tests are retained and rerun. The final build passed, and
10 focused API tests passed (plus one unchanged opt-in skip), including the
new banner assertion and corrected exact route inventory.

### Screenshots

All captures contain synthetic disposable data and remain Git-ignored:

- Private Legal form: [1280 px](../artifacts/project-content-phase9/legal-form-1280.png), [390 px](../artifacts/project-content-phase9/legal-form-390.png).
- Legal review and source comparison: [1280 px](../artifacts/project-content-phase9/legal-review-1280.png), [390 px](../artifacts/project-content-phase9/legal-review-390.png).
- Programme approval and manual English: [1280 px](../artifacts/project-content-phase9/programme-approved-1280.png), [390 px](../artifacts/project-content-phase9/programme-approved-390.png).
- Investor narrative and yield: [1280 px](../artifacts/project-content-phase9/investor-1280.png), [390 px](../artifacts/project-content-phase9/investor-390.png).
- Real promotion scope and windows: [1280 px](../artifacts/project-content-phase9/promotion-1280.png), [390 px](../artifacts/project-content-phase9/promotion-390.png).
- Preselected banner upload: [1280 px](../artifacts/project-content-phase9/banner-context-1280.png), [390 px](../artifacts/project-content-phase9/banner-context-390.png).

Desktop and mobile Legal, programme, investor and banner views were visually
inspected; the new tests assert no horizontal page overflow. The promotion
capture uses the viewport so its modal is represented accurately.

### Questions and boundaries

No new business question. Q74 and Q75 remain pending; Q76 was closed in Phase 3.
Programme units remain empty pending the IT source contract, as required.
Legal/financial text uses manual English review because E1/E9 exclude those
provider inputs. No working-database migration, live provider call, hosted
write or DW/REM write is needed. `sena_h_approved` remains false.
All required test gates passed before the Phase 9 commit containing this report.
Next is Phase 6 after a fresh pull; Phase 4 is already merged. The owner report
records the delivery hash and push confirmation. The approved credential
locations and all screenshots remain Git-ignored.

## Phase 6 — FAQ coverage and fact slots (22 October 2026)

Phase 9 was committed and pushed to `origin/main` as
`7451cf4368760676be21096c109352bab9c1bcb4`. All gates passed, and the clean
working tree was fast-forward checked with `git pull --ff-only origin main`
before Phase 6. Phase 4 is present through owner merge `ca67317`; its added
files are protected. Only the verified Phase 9 recovery stash was removed.

The permission/composition card is recorded in docs/41 before implementation.
This phase adds private coverage, applicability and fact previews plus derived
gap tasks. It does not publish website pages. After this phase: Phase 10a
articles, then Phase 8 after Phase 7 merges, then the required STOP.

### Delivered scope

Migration `202610220071_faq_coverage.sql` adds private FAQ composition, bounded
applicability rules and audited, revision-checked missing-fact tasks. Existing
content, reviews and account/permission assignments are preserved. The previous
70 migrations and Phase 4's added implementation/tests remain unchanged.

The coverage matrix distinguishes all eight requested states. Composition uses
unit type > project > group > programme > brand > corporate, rejects duplicate
answers at the winning level and respects the corporate project-page flag.
Published-mode composition reads the published version's question key; changing
a draft cannot relabel the published answer. Missing, expired or internal facts
hide the answer and create one task per project/question. Repair resolves the
task, recurrence reopens it, and zero/false remain valid values. Price slots keep
the approved price's basis, conditions, dates and exposure restrictions.

Rule controls show the resolved REM phase IDs and unresolved product forms.
Saving captures the current membership; submission rejects drift. Phase 8 will
freeze the reviewed membership at publication. Draft previews can show derived
facts, while published-mode composition requires an approved fact record; Phase
8 must capture and review those dependencies before publishing them.

Five exact API routes require Knowledge plus Projects view, with Knowledge edit
for task changes. Database guards enforce the same source permissions. Revocation
clears cached browser content. Assignment is limited to oneself and does not
expose the account directory. Existing FAQ intake and its evidence are retained.

### Verification

| Gate | Result |
|---|---|
| Admin typecheck + offline webpack production build | Passed on the final implementation |
| Focused API regression | 14 passed, 2,017 deselected, 0 skipped/failed; includes the preceding DW intake fixture, 12 new FAQ coverage cases and exact route inventory |
| Full API suite | 2,020 passed, 11 unchanged opt-in skips, 0 failed; 6 existing deprecation warnings; 803.08 s |
| Full DB suite | 59 SQL/concurrency checks + 10 Node tests passed, 0 skipped/failed |
| Relevant browser suite | 54 passed, 0 skipped/failed, 3.9 minutes; six new workflow/source-revocation cases plus Phase 1/2/3/4/5/9 regressions |
| Disposable migration replay / populated upgrade | Passed through all 71 migrations, preserving content, reviews, accounts and permissions |
| Loopback H1 | 11 protocol + 45 browser tests passed (35 core, 3 flags, 7 outage), 0 skipped/failed |
| Credential scan | Passed: 0 configured-credential matches across 25 changed files, 80 browser static files and 23 artifacts; receipt `credential-scan.json` |

Logs are Git-ignored under `artifacts/project-content-phase6/`: `typecheck.log`,
`build.log`, `api-focused-final.log`, `api-full.log`, `db-full.log`, `ui.log` and
`h1.log`; `ui-permissions.log` records the two focused revocation cases. No live
provider call or working-database migration was performed.

The first browser run exposed two new selectors that included select-option
text in the accessible label; they now select the actual combobox/listbox roles.
The initial full API run found an omitted addition to the exact route-count
assertion and a new fixture reading translations from a SQL response that does
not include them. The assertion now explicitly counts all five routes, and the
fixture uses the existing translation-list function. The focused regression
passed after both corrections. The subsequent full run exposed random UUID
selection of an unnamed project left by the intake test; the answer correctly
failed name lint. The gap-lifecycle fixture now explicitly uses the named
synthetic seed, preserving every behavioral assertion and rerunning after that
intake case. Applicability also has an explicit permission guard on its resolved
preview. A browser regression covers revoke, restore and fresh preview, including
the shared shell's existing recovery panel for unsaved text. Initial assertions
expected the old form to remain and checked a fieldset instead of its controls;
the test now follows the actual recovery flow and checks the disabled selects.
Earlier disposable setup correctly refused a
port collision; no other agent's process was stopped. A synthetic DW fixture
also needed its required project ID. No test was skipped, quarantined or weakened.

### Screenshots

All captures use synthetic disposable data and remain Git-ignored:

- Missing facts and assigned tasks: [1280 px](../artifacts/project-content-phase6/gap-1280.png), [390 px](../artifacts/project-content-phase6/gap-390.png).
- Repaired zero-value answer and resolved task: [1280 px](../artifacts/project-content-phase6/preview-1280.png), [390 px](../artifacts/project-content-phase6/preview-390.png).
- Applicability controls and explicit phase list: [1280 px](../artifacts/project-content-phase6/rule-1280.png), [390 px](../artifacts/project-content-phase6/rule-390.png).
- Projects source permission revoked: [390 px](../artifacts/project-content-phase6/revoked-390.png).

Desktop/mobile previews, rule controls and the revoked-source screen were
visually inspected. Browser tests verify no horizontal page overflow at 390 px;
the wide desktop matrix scrolls inside its own labelled region.

### Coordination, questions and next phase

No new business question. Q74/Q75 remain pending and Q76 remains closed. This
phase does not add a public endpoint or website publication. `sena_h_approved`
stays false, with no hosted, DW, REM, R2 or VPS writes.

The Phase 7 agent's unmerged migrations used 71–73. The owner will relay that
the agent must rebase after this push and renumber its own migrations to 72–74;
this workstream has not edited that worktree or its files.

After the verified Phase 6 push, Phase 7 receives port priority for its full
gate cycle. Phase 10a articles comes next after a fresh pull. Article gates wait
until Phase 7 opens its PR, or until three hours after the Phase 6 push if no PR
is open and all shared ports are free. Other agents' processes must never be
stopped. Finish articles before Phase 8, even if Phase 7 merges sooner. Phase 8
still requires that merge and ends at its original STOP.

All required gates passed before the Phase 6 commit containing this report.
The owner delivery report records the commit hash and push confirmation. Both
approved local development credential files are checked with `git check-ignore`
before committing; screenshots and logs remain ignored and are never force-added.

## Phase 10a — articles delivered (23 October 2026)

Articles started after Phase 6 was pushed as `f3f8625` and main was pulled again.
The owner reassigned articles from the departing Phase 4 agent; docs/44 already
records that handoff. The owner merged Phase 7 PR #2 as
`bf8781031a5e5e6bf5411f4c032433d7a41e1ff1` on 23 October and released the shared
ports. Main was fast-forwarded to that merge before final integration.

Restoring the article checkpoint produced four conflicts in preexisting shared
route/inventory files. Work stopped, then continued on the owner's instruction.
Both sets of registrations and permission inventories were retained. A further
`git pull --ff-only origin main` confirmed main current. All 29 files added by
Phase 4/7 remain unchanged; migration 75 follows 72-74 without renumbering the
other agent's migrations. The recovery stash remains available locally.

### Built

Migration `202610220075_articles.sql` adds three audited FORCE-RLS tables for
article identities, locale versions and version-owned source links. Its SHA-256
is `688fe5d80ec0b771ce8fe5828f66645c7abe4e629af68b908a114a269e67fcdb`.
The hosted-test profile contains all 75 verified canonical hashes, preserving
its single existing reviewed variant.

The MIT Tiptap editor supports headings, paragraphs, lists, quotes, library
images, media-link videos, tables, callouts, FAQ embeds and project cards. The
server validates a bounded closed document grammar and renders escaped HTML.
Images require current approved rights and authorized bindings; clips and FAQ
fact previews retain current Projects access. References store IDs, with a
neutral notice when a referenced source becomes unavailable. Video blocks open
the reviewed media-library link without executing an external embed.

The workspace provides Thai/English titles, excerpts, SEO, bylines, tags, cover
selection, project/brand/programme links, locale preview and version history.
Existing translation jobs handle marketing text leaves only; excluded commercial
and financial topics require manual English. Submission freezes text, links,
metadata, translation evidence and every editor, including English reviewers.
An editor cannot approve the same version after a permission change. A newer
draft preserves the previously approved version. Content approval remains private;
Phase 8 owns website publication.

Eight exact API routes use Knowledge V/E/A with matching SQL, proxy and H1
boundaries. Seven guarded SQL entry points serve those routes; helpers stay
closed. No account, template or special grant changed. Unsaved rich text survives
failed saves and revocation in the existing recovery panel; identity changes
clear it. History shows the latest 30 versions and media pickers the latest 200
eligible items; all versions remain stored.

### Final verification on integrated main

| Gate | Result |
|---|---|
| Admin typecheck / offline webpack build | Both passed |
| Full API | 2,079 passed, 11 unchanged opt-in skips, 0 failed; 6 existing deprecation warnings; 1,165.33 seconds |
| Focused article/Phase 7/permission integration | 129 passed, 1,961 deselected, 0 skipped/failed |
| Full DB | 61 SQL/concurrency checks plus 10 Node tests passed; 0 skipped/failed |
| Replay / populated upgrade | Passed through migration 75, preserving existing content, reviews, accounts and permissions |
| Relevant browser suite | 65 passed at 1280/390 px; 0 skipped/failed; includes Phase 7, articles and existing permission/content regressions |
| Loopback H1 | 11 protocol checks and 45 browser checks passed; 0 skipped/failed |
| Credential scan | 29 changed files, 86 browser static files and 150 artifacts; 0 configured-value matches. Receipt: `artifacts/project-content-articles/credential-scan.json`, counts and paths only |

Logs are under `artifacts/project-content-articles/`: `typecheck-integrated.log`,
`build-integrated.log`, `api-integrated-focused.log`, `api-integrated-full.log`,
`db-integrated.log`, `ui-integrated.log` and `h1-integrated.log`.
`integration-preservation.json` records the protected-file and migration checks.
All final disposable runners exited successfully and completed cleanup.

Pre-integration tests exposed a SQL parser ambiguity, missing synthetic image
fixture attribution/bindings and a variable/column naming collision; these were
corrected in article code/tests. Tiptap's default null table alignment is accepted,
while arbitrary styles remain invalid. Browser tests now wait for the list control
before typing and select the actual failed-save error. The broader regression
suite exposed a dropped identity/focus event while account refresh awaited display
names: the shared refresh now queues one follow-up. Both article revocation tests
hold that response across an identity switch and prove recovered text is cleared.
The final full API also verifies the exact Articles navigation alias to Knowledge.
No existing test was skipped, quarantined or weakened.

An earlier browser run passed all assertions but Windows briefly locked its
owned disposable database directory during removal. After resolved-path and
process checks, that directory was removed. The runner now uses bounded Node
removal retries with its existing path guard and stop sequence; the final API,
DB and browser runs all completed cleanup normally. No other agent's process
was stopped.

### Screenshots

All captures use synthetic disposable data and remain Git-ignored:

- Block editor: [1280 px](../artifacts/project-content-articles/editor-1280.png), [390 px](../artifacts/project-content-articles/editor-390.png).
- Reviewed English preview: [1280 px](../artifacts/project-content-articles/preview-1280.png), [390 px](../artifacts/project-content-articles/preview-390.png).
- Independent content approval: [1280 px](../artifacts/project-content-articles/approved-1280.png), [390 px](../artifacts/project-content-articles/approved-390.png).
- Permission revocation and unsaved text recovery: [edit](../artifacts/project-content-articles/revoked-edit-390.png), [view](../artifacts/project-content-articles/revoked-view-390.png).

Desktop/mobile editor, preview, approval and recovery captures were visually
inspected. Browser assertions check no horizontal page overflow. Screenshots and
logs are never force-added. Both approved local development credential files are
checked with `git check-ignore` immediately before the delivery commit.

No live provider call, working-database migration, hosted write or DW/REM write
occurred. `sena_h_approved` remains false. No new business question; Q74/Q75 remain
pending and Q76 remains closed. The delivery report records the commit hash and
push confirmation. Next: pull latest main, implement Phase 8 using merged Phase 7,
then STOP after the Phase 8 report as the owner instructed.

## Phase 8 — website publication delivered (27 October 2026)

Articles were committed and pushed to main as
`1c19e3a897ccca51f6a75c291c0dd523162b542a`. The working tree was clean and a fresh
`git pull --ff-only origin main` completed before this phase. Phase 7 is present
through migration 74; articles add 75. The Phase 8 permission and publication
contract is recorded in docs/41 before implementation. All parallel-PR added files
remain protected. The owner has released the shared ports. This phase ends at
the original STOP after its delivery report.

### Implemented publication boundary

Migration `202610230076_web_publication.sql` adds the page registry, immutable
prepared batches and change events, plus additive website snapshots in
`hub.entity_versions`. The restrictive snapshot policy keeps private source
evidence out of legacy project readers. All 29 files added by the parallel PRs
are unchanged, and all 76 canonical migration hashes match the hosted-test
profile. The populated upgrade preserves existing content, reviews and account
assignments. `artifacts/project-content-phase8/integration-preservation.json`
records the check.

Knowledge editors register pages and prepare every changed registered page as
one review batch. Staff see rendered Thai/English HTML, a before/after diff,
readiness issues and the frozen REM applicability list. The composer includes
reviewed project facts, narrative, contacts, approved media/types/prices,
facilities/features/places, commercial records, FAQs and approved article
versions. Required brand fields also require reviewed English. Private image
previews use the existing authorized file route; text is escaped and external
embed code is never executed.

Knowledge A plus `knowledge.publish_web` and approval for every source tab are
required to publish. The database excludes source editors, English reviewers and
the batch preparer, including after account changes. It recomputes the complete
review digest under locks and atomically updates all pointers. Stale or concurrent
publication rejects without partial output. Withdraw/rollback require a reason
and the expected pointer; rollback preserves the version-author check. No account
or template receives the special automatically. Account managers see the warning
when fewer than two ACTIVE internal accounts hold it.

Authenticated website consumers receive public page/FAQ projections, JSON-LD,
ETags, an ordered change feed, robots guidance and an open-content `llms.txt`
projection. New drafts never replace reviewed output. Current expiry, rights,
withdrawal and AI-exposure checks can hide previously published content. Changed
or missing FAQ facts hide the answer and maintain a deduplicated owner gap; zero
and false remain valid values. Visibility changes enter the feed. Legal evidence,
internal UUIDs, REM identifiers and the private review proof remain excluded.

### Verification and corrections

Typecheck and the offline webpack build passed. The full API run passed **2,094**
tests with **11 unchanged opt-in skips**, no failures and six existing deprecation
warnings (`api-full-01.log`). Follow-up verification of the final readiness and
source-permission refinements passed **118** checks (`api-final-focused.log`),
followed by **16** publication checks including corporate FAQ and narrative
publication (`api-publication-final-02.log`). Final gate and pilot results follow.

The extra corporate publication test caught question approval status being
mistaken for text authorship. Approval metadata is now excluded from the author
comparison while question text editors remain excluded. Other focused checks
corrected SQL alias/JSON-null handling, inventory classification and a facility
fixture that tried to attach a photo to an unknown facility. The first wider
browser run passed 73 of 74 checks: an existing media test asserted an error
before a 5.36-second upload finished. It now waits for the injected failed link
response before making the same UI assertions; no timeout was enlarged and no
assertion was removed. No existing test
was skipped, quarantined or weakened. The full authentication simulation passed
11 protocol and 45 browser checks; the final migration profile passed the 11
protocol checks again. All provider/network integrations were local mocks.

Evidence lives under `artifacts/project-content-phase8/`, which remains ignored.
The desktop/mobile workflow captures are `review-1280.png`, `review-390.png`,
`published-1280.png`, `published-390.png`, `rollback-1280.png` and
`rollback-390.png`. Screenshots are visually reviewed and browser assertions
check for horizontal page overflow at 390 px. Nothing in `artifacts/` is
force-added. Credential scans emit counts and paths only.

| Final gate | Passed / skipped / failed |
|---|---|
| Admin typecheck / offline webpack build | Both passed; `typecheck-03.log`, `build-02.log` |
| Full API | 2,094 / 11 existing opt-in / 0; follow-up checks above cover subsequent refinements |
| Full DB | 62 SQL/concurrency checks + 10 Node tests / 0 / 0; `db-final-03.log` |
| Migration replay / populated upgrade | Passed through 76; existing content, reviews, accounts and permissions preserved |
| Relevant browsers, including 1280/390 px | 74 / 0 / 0; `ui-final-02.log` |
| Local H1 authentication simulation | 11 protocol + 45 browser / 0 / 0; `h1-01.log`, `h1-protocol-final.log` |
| Credential scan | Zero configured-value matches in changed files, browser static output and evidence; `credential-scan.json` |

The last SQL-only check also verifies that inline article FAQs share the same
page budget. Its first assertion assumed JSON object iteration order; the final
assertion counts all visible FAQ items regardless of object order. The final
database replay passed with that assertion. All owned runners completed cleanup;
the shared ports were released. No other agent's process was stopped.

### Local pilot and remaining owner work

The working database was at migration 54. A verified custom-format backup was
taken before applying the 22 already-reviewed migrations 55–76 locally:
`.local/backups/web-publication-2026-10-27T03-40-47-455Z/sena_hub_local.dump`
(9,190,108 bytes). Its SHA-256 and readable table-of-contents check are in
`artifacts/project-content-phase8/backup-before-migrations.json`. No migration
was changed after application. Existing account assignments and the BNA7
identity were verified unchanged; `sena_h_approved` remains false.

BNA7 and the FLEXI brand are registered using their existing public IDs and
existing content. BNA7 has an empty source slug, so its draft website URL uses
the public project ID without changing the source slug. Both pages use `no_ai`
until a separately reviewed publication decision. The private review found:

- **BNA7: 9 blockers** — reviewed bilingual name/address/advertising disclaimer;
  the 3–6 selling-point requirement; project introduction, selling summary and
  concept name; hero and thumbnail readiness.
- **FLEXI: 2 blockers** — reviewed bilingual brand name and story. Existing
  placeholder content was left intact for Marketing to replace/review.
- **0 ACTIVE website publishers**, so no real pilot page was published and no
  account or template was silently changed. An account manager must explicitly
  assign the special to independent approvers with the necessary source-tab
  approval rights; the UI warns that at least two usable holders are needed.

The pilot therefore exercises registration, composition, readiness denial and
staff review with real local identities; successful publication/withdrawal/
rollback are proven using synthetic disposable data. Completing the real
content and assigning approvers are the remaining pilot prerequisites. Nothing
was invented to turn those checks green.

Pilot receipts: `local-pilot-initial.json`, `local-pilot.json` and
`local-pilot.log`. Final screenshots: [desktop](../artifacts/project-content-phase8/pilot-1280.png)
and [390 px](../artifacts/project-content-phase8/pilot-390.png). Both were visually
inspected; no horizontal overflow was detected. Screenshots and receipts remain
Git-ignored. Both approved local development credential paths were checked with
`git check-ignore` immediately before the delivery commit.

No new business question was opened. Q74/Q75 remain pending and Q76 remains
closed. No live provider, hosted deployment, R2 write, REM/DW write or web-team
integration occurred. Articles were already pushed as `1c19e3a`; this phase's
commit hash and push confirmation are in the delivery response. **STOP here**
for the owner's website integration decision. Do not start the remaining
Phase 10 expansion.
