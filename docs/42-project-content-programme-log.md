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

Q76 asks IT + Marketing for the allowed company shared-mailbox domains. The
allowed domain list stays empty until that answer; disposable tests use
synthetic domains. Q74 (rail/expressway reference source) and Q75 (official English
name for นอนดี) remain pending. No business-scope deviation or live provider call.

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
