# 46 — Hosted TEST content rollout

Owner authorization: 27 October 2026. Repository `Keetawon/sena_digital_hub_mkt`,
branch `main`, starting commit `b2b15e0`. The repository contains migrations
1–76; the authorized hosted upgrade is 57–76. Work proceeds in package order
A–E, subject to the owner's explicit STOP points.

## Owner decisions — verbatim

- **H1  Hosted rollout authorised.** Deploy current `main` to hosted TEST (VPS application release and Supabase migrations 5776) using the documented procedure in docs/39 and docs/40: verify the exact TEST target and TLS, take a fresh protected backup and verify it, keep the previous release for rollback, make the API cache directory real and writable, then smoke-test. This authorisation covers hosted **TEST** only.
- **H2  Business sheet import.** Import the `Project` tab (gid 0) and the `ProjectGroupMaster` tab (gid 633899292) of sheet `1BvPr9mjRt2hm2OUVS29HPIjGShZM8rbuRB77xExv-j4` through its public CSV export. Never read or import the `AgencyFee` tab.
- **H3  Website re-crawl and ingest.** Re-crawl the distinct website URLs listed in the imported `Project` snapshot and wire their content into the new content model as drafts and suggestions.
- **H4  Suggestions, not confirmations.** Image categories, tags, contexts and bindings produced from page position or AI are suggestions. Marketing confirms them in batches; publishers still approve rights. Nothing is published, and no account, template or capability is changed.
- **H5  AI cost gate.** Before any live ChatGPT API batch, count the images, estimate the cost with the configured model, and STOP for the owner's approval of that budget.

Credentials remain only in the approved ignored files and existing hosted
configuration. Missing credentials require an owner STOP; no new credential
location is permitted. No credential contents enter receipts, logs, screenshots,
fixtures or commits. Check both approved local development files with
`git check-ignore` before each commit. Screenshots belong in ignored `artifacts/`.

## A. Read-only preflight

Completed at 04:30 UTC (11:30 Bangkok), 27 October. No hosted database, R2 object,
VPS configuration or application release has been changed. Receipts are under ignored
`.local/hosted-content-rollout/20261027-preflight/`.

The comparison baseline is docs/40's final corrected transfer, plus the
19 October migration-56/performance deployment recorded in docs/32:

| Item | Expected baseline |
|---|---:|
| Applied migrations | 56 |
| Project drafts / Brand drafts | 82 / 33 |
| Project / Brand source identities | 278 / 38 |
| DW marketing-group references | 118 |
| Model drafts | 1,896 |
| Knowledge candidates | 11,102 |
| Active uploaded assets / withdrawn test assets | 1 / 2 |
| Active Brand / Project upload bindings | 1 / 0 |
| Human Knowledge reviews / publication versions / retrieval chunks | 0 / 0 / 0 |
| Auth users / Hub accounts | 1 / 1 |
| Active content originals / bytes | 4,019 / 1,189,706,760 |
| Physical transferred originals / bytes, including withdrawn test uploads | 4,021 / 1,190,851,809 |
| BNA7 Knowledge candidates / image-document candidates | 334 / 71 |
| Current API and frontend release | `794d9cd-perf2-e78be5d8bee9` |

Existing synthetic storage-smoke objects, if present, must be reconciled with
their earlier receipts separately from transferred content. The baseline account
and permission fingerprints are retained in
`.local/performance-followup-20261019/data-after.json`; no account records are
exported into this document.

Any unexplained difference stops the rollout before package B. No live AI call
is permitted before the separate H5 budget approval.

All expected database counts above match. The 56 applied canonical/executed
migration checksums and TEST deployment provenance passed verification. Both
operator and `hub_runtime` connections used verified TLS. The account fingerprint
is `651a0ecc52b3cde9da3abd5f6f3defdd`, and the permission fingerprint is
`eff76ba7bb000aa7497d0a2233a8df16`; both match the 19 October receipt exactly.
There are six unchanged permission-template rows, fingerprint
`eee189314fa864ba1df2f0e8bff37d88`. Additional table fingerprints are retained
only in `database.json` for post-batch comparisons.

BNA7 has one active draft, 334 Knowledge candidates and 71 asset candidates.
Its draft/identity fingerprints are `c807f8b21cce34e0b7ed9518a2afb3fb` and
`3537949ca556eb8dd5fa905f7a56532c`. It is readable as the existing ACTIVE actor
through `hub_runtime` → `hub_app`, with no superuser or RLS bypass. A missing
actor is denied; the two withdrawn testing assets remain inaccessible. Both
issuance flags, including `sena_h_approved`, remain false.

R2 contains **4,022 objects / 1,190,851,866 bytes**. All 4,021 transferred
originals match the database references and sizes, with zero missing objects or
size mismatches. The sole extra object is the exact 57-byte synthetic storage
smoke from 16 October, reconciled by SHA-256 against the existing smoke helper.
This explains the physical total; there is no unexpected content. Active content
remains **4,019 originals / 1,189,706,760 bytes**. Inventory only: this preflight
did not redownload every original or repeat the earlier full byte verification.
The existing private-bucket confirmation is configured; no new dashboard privacy
inspection was performed.

Both services are active at `794d9cd-perf2-e78be5d8bee9`. Available earlier
releases include `794d9cd-perf-2777ff8998ca`, `794d9cd-km-34b945a23221`,
`794d9cd-auth-e423f97fa09c` and `794d9cd-r2-f3fcfe74eb24`; two unused candidate
directories also remain. The API cache is a real `0700` directory, writable by
`sena-hub-api` and explicitly included in `ReadWritePaths`. Next cannot read the
R2 credential file. `ProtectSystem=strict` and `NoNewPrivileges` remain active.
Trusted IP HTTPS, health and login returned 200; anonymous project, brand and
admin project endpoints returned 401 with `no-store`. The renewal timer is active.

Receipts: `database.json`, `r2-reference-inventory.json`, `r2-objects.json`,
`r2-reconciliation.json`, and `vps-r2-02.json`. The first VPS probe used an
incorrect environment-key name and stopped before R2 access; its failed probe
receipt is preserved as `vps-r2.json`. Correcting the probe to the documented
`HUB_ENV` key required no server change.

## B. Hosted deployment preparation

The current runner explicitly recognizes upgrades only through 55→56. Before
deployment, extend its reviewed upgrade path to 56→76 (including exact intermediate
prefixes for recovery), retaining checksum, provenance, target, TLS and role guards.
Rehearse failure/rollback and interrupted upgrade under the existing managed-role
H1 simulation. Historical migration files remain unchanged. No account/template
assignment or publication capability is granted by this rollout.

The rehearsal passed under the non-superuser migration login: upgrade to 56,
inject a failure in 57 and verify rollback, commit canonical 57 to model an
interrupted connection, then recover through 76 and replay without rewriting
history or rotating the runtime credential. Accounts, permissions and templates
remain identical; no page or publisher assignment is created. H1 passed **11
protocol tests + 45 browser tests**. Typecheck and the offline webpack build also
passed. The full API suite passed **2,095 tests / 11 existing opt-in skips / zero
failures**, with six existing deprecation warnings. There are **300 browser tests**
in the current complete suite, and promotion requires one passing full run.

The first attempt used `test:local`. Its API suite and populated migration replay
passed, then the DB invitation fixture failed because the earlier API tests had
left an `auth` schema in that combined runner's shared disposable database
(`42P06`). This is retained in `artifacts/hosted-content-rollout/local-full.log`.
The documented standalone `test:db` and `test:ui` commands run each remaining
suite on its own fresh disposable database. No assertion, timeout or skip was
changed to bypass the combined-run collision. Their results are recorded below
when complete.

The standalone database gate passed **62 SQL/concurrency tests + 10 Node tests**.
The first complete browser run passed 299/300: the existing navigation assertion
found the Articles icon duplicated the Knowledge-intake icon. Give Articles a
distinct open-book path in the existing icon system; labels, permissions and tests
remain unchanged. Rebuild and rerun all 300 browser tests before promotion. The
failed run is retained as `artifacts/hosted-content-rollout/ui-full.log`.

The second full run passed the icon check but finished 299/300 after a local
`ECONNRESET` in the Phase 3 test's intercepted metadata request (`route.fetch`).
The same 1280 px case passed in run one and its 390 px counterpart passed in run
two. Preserve `ui-full-02.log` and rerun the complete suite unchanged; do not add
retries, skips or weaker assertions to obtain a pass.

The third full browser run passed **300/300 in one run (11.6 minutes)** with no
skips or failures (`ui-full-03.log`). The corrected admin typecheck and offline
webpack build passed (`typecheck-02.log`, `build-02.log`). All API/SQL sources are
unchanged from their passing gates. The icon was visually checked in
`artifacts/permissions/sidebar-1280.png`. An immediate read-only deployment
recheck found all **30 pre-existing protected tables unchanged** at migration 56;
receipt: `.local/hosted-content-rollout/attempt-4adfe8e/predeploy-recheck.json`.
The final credential scan found **zero matches in 875 files**, including changed
source, the browser bundle, operator receipts and test artifacts. The passed gates
are sealed against 611 source-file hashes in the ignored
`attempt-4adfe8e/deployment-gates.json`.

Ignored operator helpers under `.local/hosted-content-rollout/` prepare these
steps without creating credential files:

1. Seal the passed source hashes and push the reviewed runner change to main.
2. Back up service/web configuration, stage only tracked application source in
   a new release, and run the isolated Linux typecheck/build/dependency audit.
3. Before **each** migration 57–76, verify a fresh owner/SYSTEM-protected custom
   dump by checksum, archive inventory and a full archive read. Compare protected
   content and account/permission/template fingerprints before and after every
   migration. Compare only pre-existing columns when a content table gains fields.
4. Verify BNA7 and the new content workspace through the non-bypass runtime role,
   with missing-actor denial, zero publications and unchanged issuance flags.
5. Create a real private API cache, verify retained cache files, test the candidate
   on unused loopback ports, then switch only the two Hub service units and their
   `current` pointer. Preserve the previous release and units for rollback.
6. Repeat trusted HTTPS, consumer-authentication, protected fingerprint, R2
   inventory and unrelated-site configuration checks; inspect hosted screens.

Database recovery remains an operator-reviewed forward fix or protected restore,
never an automatic whole-database restore. Application promotion restores the
previous service configuration if its readiness checks fail. The IP vhost,
certificate renewal, shared web server and other applications remain unchanged.

### B execution receipts

Preparation commit **`4adfe8e`** is pushed to `origin/main`. The candidate
`4adfe8e-content-8ef94dd153e4` contains 209 verified tracked application files.
Its source-manifest SHA-256 is
`8ef94dd153e41ff4838dd1e15efa55724600ac9aaed84446e5adf96c9f87c3d9`.
The previous `794d9cd-perf2-e78be5d8bee9` release remains available and active
until promotion. The protected staging backup is
`.local/backups/hosted-content-vps-stage-20261027T053527Z/units-web-before.tar.gz`.

The first build invocation stopped on an unresolved placeholder in the ignored
operator helper, before creating its script or installing dependencies. A
read-only probe confirmed that no build environment or running service changed.
The helper's string replacement was corrected and syntax/target resolution
verified before retrying with a new protected configuration backup. Application
source, migration bytes and the sealed gates were unchanged.

The Linux dependency install, typecheck and webpack build completed, but the
production-dependency audit then blocked promotion: pinned Next.js **16.3.8**
falls in the affected ranges for
[SVG optimization RCE](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw),
[typed-array cache RCE](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)
and [Server Action denial of service](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r).
The upstream fixes start at 16.4.1; pin the current stable bug-fix release
[16.4.3](https://github.com/vercel/next.js/releases/tag/v16.4.3), regenerate the
lockfile and repeat affected gates before staging a fresh candidate. No hosted
migration or active-service switch occurred. The audit receipt is
`.local/hosted-content-rollout/attempt-4adfe8e/vps-dependency-audit.json`.
The candidate's eight receipts were preserved under `attempt-4adfe8e/`; the
unused release directory is retained. The patched dependency audit reports zero
findings. React and unrelated dependencies remain at their existing versions.
The patched typecheck and offline build passed, as did the repeated H1 gates
(11 protocol tests + 45 browser checks). A hash comparison confirms the other
609 previously tested source files, including all API/SQL sources and migrations,
are unchanged. The patched full browser suite passed **300/300 in one run
(12.1 minutes)**, with zero skips/failures (`ui-next-patched.log`). The final
credential scan passed with zero matches in 140 remaining source/bundle/receipt
files after test cleanup. An earlier scan encountered a temporary screenshot lock
during the run; it was repeated successfully after the runner finished. The fresh
06:00 UTC pre-deployment comparison still matches all 30 protected tables at
migration 56.

Commit **`953a152`** is pushed. The replacement candidate is
`953a152-content-4eb69b56f5b2`, with source-manifest SHA-256
`4eb69b56f5b29e6f0b4a3cfb1f25de2004f4bde44c16274817412b1f095bc537`.
Its isolated Linux install, typecheck, webpack build and production dependency
audit passed. The protected staging configuration backup is
`.local/backups/hosted-content-vps-stage-20261027T060444Z/units-web-before.tar.gz`.
The database operator started the reviewed sequential upgrade at 06:10 UTC;
individual results and verified backup paths are recorded in
`.local/hosted-content-rollout/migration-0057.json` through `migration-0076.json`
as each migration completes. A missing receipt does not imply that step passed.

### B STOP  Auth timestamp drift

Owner decision, 27 October 2026 — verbatim:

H1a  Accepted: the observed change to auth.users.updated_at only (one row) may be accepted for resuming the hosted upgrade from migration 72. This is a scoped exception, not a weaker baseline.

Basis: none of migrations 5776 reference the auth schema except auth.uid(), and no migration in the repository updates or triggers on auth.users. So the migrations did not cause the change.

Conditions:
1. Correlate first, read-only. For that user, compare auth.users.updated_at in memory with auth.sessions.refreshed_at/updated_at and auth.refresh_tokens.created_at/updated_at, and with auth.audit_log_entries if it is populated. Record only the result, never the values: "matches a session/token refresh within N seconds: yes/no". Record the cause as established or unknown. Either result allows resumption. Do not modify any Auth row.
2. Keep the original baseline comparison unchanged and record it as failed on updated_at. Add a separate "accepted comparison" that excludes only auth.users.updated_at. Every other Auth column, including last_sign_in_at, stays strict, as do all 29 other protected tables. The exclusion covers this rollout only; it does not change the default check.
3. Before migration 73, revalidate the exact applied prefix 172 (names and checksums) and take a new verified protected backup. Do not reuse the 06:44 dump.
4. Do not open, reuse or refresh any signed-in hosted browser session while migrations 7376 run, and until the post-upgrade fingerprints are recorded. Do hosted screen inspection only after that, and record that it happened.
5. STOP again on any other change: a different Auth column, a new Auth row, or any change in another protected table. Do the same if updated_at drifts again during 7376 while no session is open.

Then resume package B as planned: migrations 7376 with a backup and fingerprints before each one. Promote candidate 953a152-content-4eb69b56f5b2 only after its readiness checks pass, keeping 794d9cd-perf2-e78be5d8bee9 for rollback, then run the smoke tests. Continue to packages C, D and E. Keep the STOP before any live AI batch (H5) with the image count and cost estimate, and every other STOP point unchanged.

The original stop record follows. H1a supersedes its pending-decision paragraph;
the failed comparison, original baseline and receipts remain unchanged.

At 06:46 UTC (13:46 Bangkok), the preservation assertion stopped the operator
**before migration 73**. Migrations **57–72** applied successfully, each with
a fresh verified protected backup and unchanged post-migration fingerprints.
The hosted history ends at `202610220072_facilities_features_places.sql`;
migrations 73–76 remain pending. The backup prepared for migration 73 passed
verification, but that migration was not executed. No application promotion or
automatic database restore occurred.

The only changed protected table is `auth.users` (still one row). Read-only
comparison against both the first rollout backup and the pre-72 backup finds
**only `updated_at` changed; the other 33 Auth columns match exactly**. Values
were compared in memory and never exported into diagnostic receipts. All other
29 protected tables, including Hub accounts, permissions, templates, existing
drafts, candidate evidence, reviews and media bindings, retain their original
counts and fingerprints. The Auth timestamp's cause is not established. A
browser inspection reused an existing signed-in session during this interval;
no login, logout, account edit or publication was requested, and that temporal
overlap does not establish causation.

The full Auth-row fingerprint therefore no longer meets the owner's unchanged
fingerprint requirement. Keep the STOP in place. **Owner decision needed:** may
this observed timestamp-only difference be accepted for resumption from 72,
while continuing to require exact equality for all other Auth fields and every
other protected table? Do not reset `updated_at`, rewrite account data, replace
the original baseline or silently weaken its check. A permitted continuation
must record the original and accepted comparison separately, revalidate the
exact applied migration prefix, and take another fresh verified backup before
migration 73. No acceptance has been given yet.

Read-only recovery checks at 06:58 UTC confirm that the active release remains
`794d9cd-perf2-e78be5d8bee9`, both services and their configuration are unchanged,
the private cache remains real and writable, trusted HTTPS health/login return
200, and anonymous consumer/admin requests return 401 with `no-store`. BNA7
remains readable through the non-bypass runtime role with missing-actor denial.
Its draft/identity fingerprints, 334 candidates and 71 asset candidates match
preflight. Accounts, permissions and both issuance flags match preflight;
`sena_h_approved` is false. Publication versions remain zero. Website page
tables are not installed yet because migration 76 is pending.

| Preserved item | Before | At STOP |
|---|---:|---:|
| Project drafts / Brand drafts | 82 / 33 | 82 / 33 |
| REM project identities / marketing groups | 278 / 118 | 278 / 118 |
| Knowledge candidates | 11,102 | 11,102 |
| Active assets / withdrawn test assets | 1 / 2 | 1 / 2 |
| Human Knowledge reviews / publication versions | 0 / 0 | 0 / 0 |
| R2 objects / bytes | 4,022 / 1,190,851,866 | 4,022 / 1,190,851,866 |
| New asset links, facilities, places, contacts, media links, commercial-type drafts, disclosures, FAQ clusters | Tables absent | 0 each |

R2 added objects/bytes: **0 / 0**. No new ingestion has reused objects yet. The
inventory checksum is unchanged. No live business-sheet fetch, sheet import,
new website crawl, website content wiring or live AI batch has run; AI images
processed and incurred API cost are **0 / 0**. Sheet diffs, crawl outcomes,
agreement scores and an H5 budget are not available yet. Ignored importer and
extractor drafts have synthetic checks only and are not shipped functionality.

STOP evidence is retained under `.local/hosted-content-rollout/`:

- `migration-0057.json` through `migration-0072.json`: successful batches.
- `database-deployment-stop-1793083593567.json`: stop before migration 73.
- `migration-stop-diagnostic-1793083664221.json`: all 30 protected comparisons.
- `auth-column-diagnostic-1793083782281.json` and
  `auth-column-diagnostic-1793084216315.json`: changed column names only,
  compared against the pre-72 and first rollout backups respectively.
- `stop-safety-1793084274409/database.json` and `vps-stop-safety-1793084280.json`:
  migration history, counts, BNA7 runtime checks, active release, HTTPS and R2.

Recovery material remains protected and ignored:

- Before the whole upgrade:
  `.local/backups/hosted-content-202610210057-20261027T061014Z/supabase-before-migration.dump`
  (8,473,370 bytes; SHA-256
  `cce3ea468adbb374d958c0b64b8b60ef2a19f04b4b245b80e0afa639f5cc4785`).
- Latest verified migration-72 state, prepared before the unapplied migration 73:
  `.local/backups/hosted-content-202610220073-20261027T064457Z/supabase-before-migration.dump`
  (9,168,727 bytes; SHA-256
  `66b43a1d8302e0c5eec41c094952abbd6a65928ae8fcfe596cd7f19c70b142fd`).
- Previous application release:
  `/srv/sena-hub-test/releases/794d9cd-perf2-e78be5d8bee9` (still active).
- Service/web configuration backup:
  `.local/backups/hosted-content-vps-stage-20261027T060444Z/units-web-before.tar.gz`.

The ready candidate `953a152-content-4eb69b56f5b2` remains unpromoted. Gates
passed for its source: API **2,095** (11 existing opt-in skips), database **62**
plus **10** Node checks, H1 **11** protocol plus **45** browser checks, and the
full browser suite **300/300 in one run**. Typecheck, local/Linux builds and
production dependency audit passed. This report does not mark package B or the
overall rollout complete.

### H1a preparation and read-only correlation

The read-only correlation reports **"matches a session/token refresh within 5
seconds: yes"**. `auth.sessions.updated_at` and both requested refresh-token
timestamps match within that window; `auth.sessions.refreshed_at` does not.
`auth.audit_log_entries` exists but is empty. The cause remains **unknown**:
timestamp proximity supports a refresh correlation but does not prove causation.
No timestamp, user identifier, session/token value or audit payload was recorded.
No Auth row was modified.

The separate H1a comparison is derived from the verified first rollout backup.
It reconstructs the generated `confirmed_at` value and verifies the full original
row against the original baseline before excluding only `updated_at`. All other
34 columns, including `last_sign_in_at` and generated `confirmed_at`, remain
strict. (The earlier 34-column archive comparison covered 33 unchanged stored
columns; PostgreSQL's dump omits the generated column.) All 29 other protected
tables remain strict. The original baseline and failed comparison are preserved.

`h1a-accepted-comparison.json` records the separate accepted fingerprint and a
full-row drift guard. The current full Auth fingerprint still equals the original
STOP diagnostic, so no further timestamp drift has occurred. Every comparison
during 73–76 checks that full fingerprint as well: another `updated_at` change
stops the run. Eight focused operator checks pass, covering the scoped exception,
new Auth rows, further timestamp drift, other Auth changes, account permissions,
project edits, widened exclusions and replacement of the original baseline.
The normal deployment runner and default checks remain unchanged.

Before resumption, the exact applied prefix 1–72 was verified by names, canonical
checksums, executed checksums and TEST provenance. The resume operator will
verify it again and create a new protected backup before 73. Each remaining
migration has a fresh backup and comparisons before backup, after backup and
after application. No browser inspection is permitted until the post-upgrade
fingerprints have been recorded. A browser tab-inventory request was rejected by
automatic approval review under H1a; no browser information was returned. The
owner was asked to close hosted tabs, and browser controls remain untouched.

## C–E implementation boundaries

Business-sheet snapshots use the existing immutable intake batch, project
reference evidence and marketing-group evidence structures. The sheet is a
separate source from REM/DW: it cannot replace REM identities, erase DW exception
flags or become the latest DW status snapshot. Source spelling and IDs remain
exact text. A missing ID is an exception, duplicate IDs retain their distinct
source rows, and shared URLs retain explicit phase applicability. Excluded
columns stay out of normalized records, database intake, crawler input and AI
context. Raw CSV evidence stays in the ignored checksum-pinned package.

The intake diff distinguishes unchanged, new, changed and conflicting evidence.
Existing accepted mirrors and human edits are preserved; changed sheet values
are append-only source suggestions. Conflicts in group membership, brand text or
names remain review evidence, without rebinding a project. Both databases use
the same verified package. Transaction locks, immutable receipts and exact
package replay checks prevent duplicate intake.

Website extraction must retain section, tab, floor/type labels, page URL and
fetch time, including failed and refused requests. A fetch timestamp never
becomes a construction date, a contact confirmation, an image capture date or a
business effective date. The extractor runs on inert HTML with synthetic
fixtures for both website templates; the existing crawler retains its robots,
host, DNS, redirect, rate and size restrictions. Chrome, icons and unrelated
page furniture are excluded under the existing intake rules.

Reuse existing content and media tables. Website text becomes a draft or review
suggestion; nonempty human values remain unchanged. Prices remain evidence and
never populate `project_prices`. Unresolved entity/type/floor mappings stay
unconfirmed. Media metadata and bindings from page position are explicitly
unconfirmed, rights remain pending, and originals remain private. Existing
content hashes are reused only after byte/checksum verification; new object
writes are conditional and cannot replace an existing object.

The media review queue uses existing Projects view/edit permissions. Marketing
can select assets and confirm category, tags and actual target context, with
revision checks and an audit record for each asset. Shared assets retain all
existing cross-tab permission checks. Rights approval remains separate and uses
the existing approver rules. No account, template or capability assignment is
part of this work. Website origin appears as **ดึงจากเว็บไซต์สาธารณะ SENA**;
the queue is **รูปจากเว็บไซต์ (รอยืนยัน)**.

Page-position and E1 AI suggestions remain separate. Agreement can affect queue
ordering but cannot confirm metadata or bindings. The H5 report must count the
eligible images, use the configured model and current documented pricing, and
state the estimate before any live batch. No translation or image worker may
accidentally drain queued jobs before that approval. Missing expected
credentials require a STOP without creating another credential location.
