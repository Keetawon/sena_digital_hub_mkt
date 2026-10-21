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
