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
| Facilities / commercial-type drafts | 0 / 0 | 0 / 0 |
| New asset links, places, contacts, media links, disclosures, FAQ clusters | Tables absent | 0 each |

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

Owner confirmation, 27 October 2026 — verbatim:

> I have closed every signed-in hosted TEST Hub tab and window on all my browsers and devices, including incognito windows and any app-integrated browser pane. I did not sign out, so no Auth write was triggered.
>
> Proceed with migrations 7376 under H1a. Do not open, reuse or refresh a signed-in hosted browser session until the post-upgrade fingerprints are recorded. Condition 5 remains the safety net: if auth.users.updated_at or anything else protected changes during 7376, STOP and report.

The confirmation is retained in ignored `h1a-browser-window.json`. No browser
controls are used during the migration window. The operator must revalidate the
applied prefix and H1a comparisons before creating its fresh migration-73 backup;
the 06:44 backup is not reused.

### B resumed database result

Migrations **73–76 completed successfully under H1a** at 07:44 UTC (14:44
Bangkok). The original baseline remains unchanged and its full Auth comparison
remains failed only on the previously accepted `updated_at`. Every accepted
comparison passed; the full Auth drift guard detected **no further drift**, and
all 29 other protected tables retained their original counts and fingerprints.
No Auth rows were written. No browser controls were used during this interval.

Fresh owner/SYSTEM-protected backups were verified by checksum, archive
inventory and full archive read before each migration. Paths below are relative
to `.local/backups/`, each containing `supabase-before-migration.dump`:

| Migration | Fresh backup directory | Bytes | SHA-256 |
|---|---|---:|---|
| 73 | `hosted-content-202610220073-20261027T073450Z` | 9,168,760 | `bea5d747300785b3be6694cc2efde3aff7a6283ccdc69c4a8e976cff76efc69e` |
| 74 | `hosted-content-202610220074-20261027T073654Z` | 9,195,176 | `95bba3d5a112839bcd3006a95745ff710f2d9c5a554abb45d1355aa79eec0ca8` |
| 75 | `hosted-content-202610220075-20261027T073857Z` | 9,209,748 | `f7bf73a2352d3c9e4f3e0c08718e97c01bba496b7b9ac50158002541772bf11a` |
| 76 | `hosted-content-202610230076-20261027T074128Z` | 9,268,940 | `e8ea4e450a925bb43fbacdfba0f2586bdcd9da3a72f4fc2e2e404ecb47c47d30` |

Receipts `migration-0073.json` through `migration-0076.json` retain checksums
and each comparison before backup, after backup and after migration. The final
`database-deployment.json` records all post-upgrade fingerprints. An independent
read-only `database-h1a-postflight-*.json` then passed before promotion or hosted
screen inspection: exact migration 76, unchanged protected content, BNA7 visible
and content readable under the non-bypass runtime role, website workspace
readable, and missing-actor denial.

Counts remain 82 project drafts, 33 brand drafts, 278 REM project identities,
118 groups, 11,102 Knowledge candidates, three asset rows (one active and two
withdrawn tests), one Hub account, 12 permission rows and six templates. New
asset links, facilities, places, contacts, media links, commercial-type drafts,
disclosures and FAQ clusters are all zero. Website pages, publication batches,
publication versions and publisher-capability assignments are zero. There are
no hosted pilot pages to change from `no_ai`; local pilots remain untouched.
`sena_h_approved` is false. This completes the database part of B; application
promotion and post-promotion smoke receipts follow separately.

### B application promotion and smoke results

Candidate **`953a152-content-4eb69b56f5b2`** is promoted. Its isolated preview
passed health/login and anonymous consumer denial before switching the two Hub
service units and `current` pointer. The previous
`794d9cd-perf2-e78be5d8bee9` release remains intact for rollback; the previous
units are protected at
`/srv/sena-hub-test/backups/953a152-content-4eb69b56f5b2-units`.
The fresh pre-promotion service/web configuration archive is
`.local/backups/hosted-content-vps-promote-20261027T074605Z/units-web-before.tar.gz`
(3,799 bytes; SHA-256
`7a24ec761532e115d5c294f5fdf12b1349f9a6455d9a0930f11fc6c730f32aaa`).

The candidate has a real private `0700` API cache, writable by the API user and
explicitly permitted in `ReadWritePaths`; its one retained file passed checksum
verification. The admin service cannot read R2 credentials. Both services retain
`ProtectSystem=strict` and `NoNewPrivileges`. Existing hosted credential/config
files are unchanged, and scanning 84 browser bundle files found zero credential
matches. No new credential location was created.

The 07:47 UTC post-promotion smoke passed trusted IP HTTPS, health/login 200,
and 401 with `no-store` for anonymous project, brand, admin project, web changes,
`llms.txt`, robots-AI and admin-web endpoints. Certificate renewal remains active;
unrelated site configuration is unchanged. R2 remains **4,022 objects /
1,190,851,866 bytes**, with the same complete inventory checksum. Added/reused
objects for this package: **0 / 0**.

`database-h1a-postflight-1793087257101.json` records a second independent
post-promotion pass, including every H1a fingerprint, no additional Auth drift,
unchanged counts, BNA7 content/runtime access, missing-actor denial, zero
publication and false `sena_h_approved`. The first independent pass was
`database-h1a-postflight-1793087133191.json`. Both precede the first hosted browser
inspection, which began after these receipts existed. Browser inspection after
that point uses the owner's permitted post-upgrade window and is recorded below.

Hosted screen inspection passed after those fingerprints were recorded: the
project list resolves BNA7 and its 334 candidates; its existing draft and the new
content workspace load under the existing account. The draft remains visibly
unpublished. Desktop and 390 px mobile captures are under ignored `artifacts/`:

- `artifacts/hosted-content-rollout/hosted-bna7-list-1280.jpg`
- `artifacts/hosted-content-rollout/hosted-content-bna7-1280.jpg`
- `artifacts/hosted-content-rollout/hosted-content-bna7-390.jpg`

No save, approval, publication or account action was used. The viewport was
restored and the inspection tab closed without signing out. Package B is
complete; the original release and all protected recovery material are retained.

## C. Business-sheet snapshot

The two authorized public CSV exports were fetched at 07:51 UTC, 27 October,
and saved as an immutable verified package:
`.local/business-sheet-intake/2026-10-27T07-51-20.247659_00-00-95932f6b9cf7`.
Manifest SHA-256:
`95932f6b9cf7523194b581491deafec2ad06b26989801ffe6e9cf8546d1ebb1f`.
The Bangkok source snapshot date is 2026-10-27. AgencyFee was not accessed.

The Project export yields **87 rows / 86 distinct exact Project IDs**, plus
**one missing-ID exception**. LADKB occurs on two source rows; both are retained
without guessing a second identity. All 16 ProjectGroupMaster columns are kept
for its **118 rows**. English-name Thai characters and whitespace within group
member lists are flagged while preserving source spelling. The source package
and normalized records are checksum-pinned; source references remain separate
from accepted REM/DW identities and nonempty human content.

There are **79 distinct allowed website URLs**, with explicit project scopes.
FR189, SK1SD and K9BK5 have `N/A` URLs and remain recorded gaps. No robots or
allowlist exception is inferred. The reviewed snapshot was applied locally and
to TEST after the verification below; dry-run and transaction receipts follow.

## C–E implementation boundaries

Business-sheet snapshots use the existing immutable intake batch, project
reference evidence and marketing-group evidence structures. The sheet is a
separate source from REM/DW: it cannot replace REM identities, erase DW exception
flags or become the latest DW status snapshot. Source spelling and IDs remain
exact text. A missing ID is an exception, duplicate IDs retain their distinct
source rows, and shared URLs retain explicit phase applicability. Excluded
columns stay out of normalized records, database intake, crawler input and AI
context. Raw CSV evidence stays in the ignored checksum-pinned package.

The first successful hosted read-only diff is
`.local/hosted-content-rollout/business-plan-1793089265701.json`: **86 project
identities (66 changed, 20 conflicts)** and **118 groups (80 changed, 38
conflicts)**; zero new accepted group references. The additional business-sheet
columns are new evidence relative to the narrower DW group projection. Group
member whitespace stays literal and unresolved, rather than becoming a guessed
ID match. All source rows remain in the snapshot, including LADKB's two rows.
The full conflict list is in that receipt; none authorizes overwriting a value.

The planner's initial two attempts made no writes: its first TLS assertion
incorrectly inspected the pooler's backend connection instead of the client's
verified TLS transport. The corrected check verifies the client TLS connection
and exact TEST identity. All original protected content and every Auth column
except the already scoped `updated_at` match the original accepted baseline.
`updated_at` differs from the H1a end after the explicitly permitted Package B
browser inspection. Package C captures a fresh full Auth fingerprint and compares
**every column, including `updated_at`, strictly before/after each write batch**;
the H1a migration window and original failed comparison remain unchanged.

### C–D code verification

The full API gate passed **2,102 tests / 11 existing opt-in skips / 0 failures**
in 1,029.41 seconds. DB passed **62 SQL/concurrency checks + 10 Node tests**,
including populated migration replay. H1 passed **11 protocol + 45 browser
tests**, including the interrupted 56→77 upgrade and exact replay. Admin
typecheck and the documented offline webpack build passed. Focused intake and
extractor runs each passed 16 cases. Logs use the `business-sheet-` prefix under
`artifacts/hosted-content-rollout/`.

The first full browser run hit `ECONNRESET` in the 390 px Phase 2 case while
switching the local persona after its content edits and layout checks. No content
assertion failed in that case. Its evidence is retained at
`artifacts/hosted-content-rollout/business-sheet-ui-first-failure/`. The unchanged
complete suite then passed **300/300 in one run (12.2 minutes)**, recorded in
`business-sheet-full-ui-02.log`. No test was skipped, retried within a run or
weakened. The tested source hashes are sealed in the ignored
`.local/hosted-content-rollout/business-sheet-gates.json` before import.
The credential scan covered 236 changed, receipt and browser-bundle files plus
356 archive members, with **zero matches**. Both approved local development
credential files remained ignored immediately before the delivery commit.

The intake diff distinguishes unchanged, new, changed and conflicting evidence.
Existing accepted mirrors and human edits are preserved; changed sheet values
are append-only source suggestions. Conflicts in group membership, brand text or
names remain review evidence, without rebinding a project. Both databases use
the same verified package. Transaction locks, immutable receipts and exact
package replay checks prevent duplicate intake.

### C execution receipts

Code checkpoint **`f9c0a57`** is in `origin/main`. Local migration 77 and intake
passed, followed by an exact no-op replay. TEST then applied migration 77 and
the same pinned package in separate write batches, each with a new protected
backup whose inventory and complete archive contents were verified.

| Target / batch | Protected backup | Bytes | SHA-256 |
|---|---|---:|---|
| Working local | `.local/backups/business-sheet-local-20261027T090448Z/sena_hub_local.dump` | 10,116,951 | `64f46bd9c1b6139cf88645f288349a7f876c9fded5975d090e71d697016b81db` |
| TEST migration 77 | `.local/backups/business-sheet-migration-20261027T090537Z/supabase-before-batch.dump` | 9,374,152 | `68bb000065308fced66992c5bc7135ccb05dd8b5690eb38cf2eb68db43d6c640` |
| TEST snapshot | `.local/backups/business-sheet-apply-20261027T090811Z/supabase-before-batch.dump` | 9,374,617 | `a673f1e271993b2a9a6c58b8a1508f8430ad10fbfb4046f90a8652dbd9a714be` |

Both targets appended **86 project evidence rows and 118 group evidence rows**
with the same 66/20 project and 80/38 group changed/conflict split. Accepted
group references remain **118**: no group, REM identity, draft, review, candidate
or R2 binding was overwritten. The TEST transaction checked all 30 protected
tables before and after its writes; an independent post-commit comparison also
passed, including strict `auth.users.updated_at`. No browser session was opened.
Published pages and publication versions remain zero; `sena_h_approved` remains
false. Local pilot pages remain `no_ai` and unpublished.

Receipts under `.local/hosted-content-rollout/`:
`business-local-1793091899395.json`,
`business-migration-1793092059446.json`, and
`business-apply-1793092267754.json`. Each exact package replay returned
`already_staged`. The original H1a baseline and failed comparison are unchanged.

### D capture receipt

The reviewed crawler input contains 79 distinct URLs and has SHA-256
`03ff5d8184527a994fd8b9b222ce806a5a9899a3222be6aacbcead935d446b6d`.
It derives directly from the imported sheet package; its three missing-URL
exceptions are retained separately. The capture log is
`artifacts/hosted-content-rollout/website-recrawl.log`. Same-scope aliases and
linked files use the existing crawler rules. Robots failures remain gaps;
they are not overridden.

The finished capture is
`.local/knowledge-intake/2026-10-27T09-11-29-292Z-03ff5d81`, manifest SHA-256
`162b56c1abe36557354117ab2a3e20dd14975885757b6810d6677b6ea3fef123`.
The 79 input URLs and same-scope aliases produced 81 page requests: **77 fetched,
4 gaps**. There are **3,550 downloaded file URLs, 3,457 distinct files and
1,159,647,361 original bytes**, plus 82 link-only video/tour references.

The two unavailable robots files belong to `nicheprideekkamai.sena.co.th` and
`pitisukhumvit101.sena.co.th`. Two page redirects leave the allowlist:
`/en/project/senakith-sukhumvit-bangpu-beachfront` and
`/project/sena-park-ville2-ramindra-wongwaenn`. Of 486 file gaps, **484** are on
`content.sena.co.th` with unavailable robots rules; two LINE chrome files are
off the allowlist. These remain gaps. No refusal was overridden.

### E pinned preparation

The prepared package is
`.local/website-content-intake/20261027T103018256707Z-162b56c1abe3`, manifest
SHA-256 `57affeeb0f33bddba6d6d257abf27c952b8220b2b211ed50cb5284a802cb6226`.
It pins the same business snapshot, capture and read-only TEST reference export
(278 exact IDs, 45 media tags). The unresolved exact ID `BPEF2` remains an
exception. No REM identity was invented.

Preparation retained **3,128 assets / 660,672,586 bytes**, including **3,084
images**, and **5,573 base Knowledge candidates + 3,714 structured items** across
78 known project scopes. Cleanup excluded 222 pixel-verified resolution variants,
61 chrome/icons and 46 files that failed the existing asset validation limits.
All original capture bytes and exclusions remain in the pinned evidence.
YouTube metadata was fetched for 202 extracted references with no provider gaps;
Matterport/Kuula links remain manual. No AI call ran.

The initial preparation `fd770b39b2269dc66ba38634285b53d9b3baf3d63795e89ce4fc9937d1d2faee`
is retained and superseded: explicit master-plan labels now take precedence over
a broad Floor Plan gallery tab; a `masterplan` directory alone does not establish
that category. Conflicting positions remain unresolved. The final preparation
has **1,879 images eligible under the existing E1 rules** and **1,205 images with
unresolved categories**. These are preparation counts; H5 still requires the
configured model, final registered eligibility and an owner-approved budget.

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

### E implementation and verification

Migration **78** adds website provenance, unconfirmed asset bindings and an
audited review queue without modifying any previous migration. Website-only
drafts may retain unknown construction dates, place classifications and media
ownership; ordinary saves and publication checks keep their existing rules.
Marketing confirms category, tags and context in batches of at most 40, with
per-asset audit and stale-version checks. Rights and overall metadata review
remain separate. A repeated committed confirmation is a no-op.

The importer uses the existing content tables and FAQ cluster generator.
It appends source candidates, creates only missing draft records, preserves
existing human rows and REM mappings, and records unresolved shared-phase
scope as review evidence. Source prices never create price rows. Package
replay is guarded by an immutable receipt and a transaction lock. Existing
R2 objects are read and checksum-verified before reuse; only missing hashes
are eligible for conditional upload.

E1 supports an explicitly approved list of job IDs and records provider token
usage. An ambiguous expired attempt is not automatically retried. Private R2
bytes must match their authorized metadata before resize. These capabilities
do not authorize a live batch: **H5 remains pending**.

The full API run passed **2,109 tests**, with 11 existing opt-in skips. The
initial run exposed seven missing entries in the explicit permission test
inventories; those entries now cover the four new routes and two new FORCE RLS
tables. The complete suite was rerun successfully. Focused runs passed 55 API
and 28 permission checks. No existing permission assertion was removed.

The database gate passed **62 SQL/concurrency checks and 10 Node tests**,
including populated upgrade replay. Its first attempt correctly noticed the
new nullable `website_source` key in a whole-row snapshot. The test now asserts
that this field is NULL on every existing row and compares all original fields;
existing bindings must remain confirmed. No preservation check was weakened.
Hosted simulation passed **11 protocol and 45 browser tests**. Typecheck and
the documented offline webpack build passed. The full browser suite passed
**302/302 in one complete run (10.8 minutes)**, with no skips or retries.
Logs are under `artifacts/hosted-content-rollout/`:
`website-api-full-final.log`, `website-db-final.log`, `website-h1.log`,
`website-typecheck.log`, `website-build-final.log` and `website-ui-full.log`.
The credential scan checked **296 files and 356 archive members, zero matches**.
The tested 667 source-file hashes are sealed in ignored
`.local/hosted-content-rollout/website-gates.json`.

Screenshots were visually inspected at both required widths; the browser tests
also checked for horizontal overflow. They remain Git-ignored:
`artifacts/hosted-content-rollout/website-review-1280.png`,
`artifacts/hosted-content-rollout/website-review-390.png`,
`artifacts/hosted-content-rollout/website-sources-1280.png`, and
`artifacts/hosted-content-rollout/website-sources-390.png`.

### E local execution

Working-local migration 78, rolled-back rehearsal, committed import and exact
replay all passed. Receipts are
`.local/hosted-content-rollout/website-local-migration-1793112761369.json` and
`.local/hosted-content-rollout/website-local-apply-1793113199207.json`.
The fully verified, ACL-protected backups are:

| Batch | Backup under `.local/backups/` | Bytes | SHA-256 |
|---|---|---:|---|
| Migration 78 | `website-local-migration-20261027T145238Z/database-before-batch.dump` | 10,201,404 | `f03f6bcc8be237f0722212bf796091af73f19d9e52ba311cd76f071a51b610c3` |
| Website import | `website-local-apply-20261027T145305Z/database-before-batch.dump` | 10,231,619 | `a12655e1a14b4ec3816280f5e18d2d765b175617c3b7729f7c6cbee2888fada3` |

The local import created **3,128 assets, 3,573 unconfirmed asset links, 9,287
source candidates and 1,752 draft records**: 183 narrative sections and draft
versions, 30 facilities, 594 places, 374 contacts, 140 media links, 273 commercial
types, 106 construction records and 52 disclosures. It recorded 229 conflicting
source values and 2,018 unresolved wiring outcomes without overwriting existing
content. The existing FAQ generator inserted 333 clusters locally; no decision
or review was changed. No project, group or brand identity was created.

Every prior content row was preserved. Account/permission tables, approved
versions, reviews, source identities, settings and pilot pages passed strict
checks inside the transaction and again after commit. New narrative draft
versions are append-only; existing version bytes remain protected. The replay
returned `already_applied`, with no new rows. Published pages remain zero,
both local pilot pages remain `no_ai`, and `sena_h_approved` remains false.
No AI job was run.

### E hosted execution

Implementation **`a47ee22`** is in `origin/main`. Both approved local credential
files were checked with `git check-ignore` immediately before the commit; the
final delivery scan covered 299 files and 356 archive members with zero matches.
Canonical migration 78 retains SHA-256
`999bf82638752cb2c36e79917eda4c8a21f176778c0eaf8ed9afa777c9b58bec`, matching
the tested working bytes, Git index and local applied history.

TEST migration 78 passed with exact prefix/checksum and verified TLS checks.
All **57 protected/preserved tables** matched before and after; the complete
Auth row, including `updated_at`, stayed strict and unchanged. No hosted browser
was opened. Receipt:
`.local/hosted-content-rollout/website-test-migration-1793113574287.json`.
The fresh verified backup is
`.local/backups/website-test-migration-20261027T150238Z/database-before-batch.dump`
(9,472,313 bytes, SHA-256
`1002e0660e7536034746dec458cc132afaf7ed558e3daf760b814450571cce99`).

The private R2 batch then passed: **2,929 objects / 634,978,713 bytes reused**
after checksum reads, and **199 objects / 25,693,873 bytes newly uploaded** with
conditional writes and checksum verification. No prior object was replaced.
The exact inventory changed from **4,022 / 1,190,851,866 bytes** to
**4,221 / 1,216,545,739 bytes**; its new SHA-256 is
`9d4f64941aa97ecd7e3868e3c1e451e640110ad47df537b3626a88cb97b2335a`.
Protected database tables, including full Auth, remained unchanged.

R2 receipts: `.local/hosted-content-rollout/website-object-plan-20261027T151302Z.json`,
`website-storage-test.json`, and `website-test-objects-1793114025193.json`.
Its fresh verified backup is
`.local/backups/website-test-objects-20261027T150716Z/database-before-batch.dump`
(9,502,762 bytes, SHA-256
`461df743243ec9282f27be200cc433c2c225e3505ccc5c6a4948f9e7b1c6b51b`).
The public-byte transfer remains ignored locally; the private VPS staging copy
is `/srv/sena-hub-test/intake/website-57affeeb0f33bddba6d6d257abf27c952b8220b2b211ed50cb5284a802cb6226`.

The first hosted import attempt stopped in connection validation, before its
rehearsal or any content transaction. The historical transfer helper rejects a
DSN query suffix, while the approved deployment configuration accepts only
`sslmode=verify-full` and normalizes it before supplying an explicit verified
TLS context. A read-only diagnostic proved the original helper rejection and
acceptance of that validated normalized form; all **57 tables were unchanged**
and no package receipt existed. No credential was printed, changed or moved.
The ignored operator now passes the deployment's validated DSN in memory to
the child, which retains certificate and exact-target checks. This does not
change application code, the tested source seal or the TLS requirement.

The retained stop receipt is `website-test-apply-1793114307037.json`; the
read-only comparison is `website-stop-check-1793114495352.json`, both under
`.local/hosted-content-rollout/`. Its unused protected backup is
`.local/backups/website-test-apply-20261027T151513Z/database-before-batch.dump`
(9,502,762 bytes, SHA-256
`c0daf6a6b64d6ac1ec411ef993f6de0d9da3ab00f11438a94f5cce63a99e56d5`).
The retry takes a new verified backup; it does not reuse this dump.

The corrected TEST rehearsal reached text and asset insertion successfully,
but measured database round trips were 90–97 ms. Its projected duration was
close to the optional rehearsal runner's one-hour limit. Only this task's
verified rehearsal Python child was stopped; its transaction rolled back.
The operator exited and released its advisory lock. Read-only comparison
`website-stop-check-1793115714401.json` then proved all 57 tables, including
every Auth and project timestamp column, unchanged against the completed R2
batch baseline, with no import receipt.

That deliberate stop is retained as `website-test-apply-1793115617841.json`.
Its unused backup is
`.local/backups/website-test-apply-20261027T152258Z/database-before-batch.dump`
(9,502,762 bytes, SHA-256
`2131b40cefe4f0f6102117563505ea8621c8e2fbc7f041a25ecd070e93382fe3`).
The final TEST attempt uses the already completed local rehearsal of the same
pinned package, a new verified backup, one guarded import transaction and exact
no-op replay, with a two-hour runner limit. All before-commit, post-commit,
existing-row, Auth and permission checks remain in place. No required code,
browser or migration gate was skipped or weakened, and no other agent's
process or service was stopped.

### Pending display follow-up in protected Phase 7 code

The existing place card in `apps/admin/components/project-amenities.tsx:122`
renders `String(item.as_of)`. Newly imported website places deliberately have
an unknown date, so this older card displays `ข้อมูล ณ null`. The new website
evidence panel explicitly identifies the unknown date/distance; the stored
value remains NULL, with no invented effective date or confirmed distance.
The Phase 7 file remains untouched under the owner's earlier instruction to
stop and report before changing another agent's merged files. A display-only
follow-up would use the existing `stringValue` helper and a Thai unknown-date
label; it requires the owner's release of that file restriction. This is
recorded as a remaining UI limitation, not as a completed fix.

### Imported disclosure and construction edit compatibility

The final edit-path check found that the commercial API's input models still
rejected `website_import` and an unknown construction `as_of`, despite migration
78 and the importer deliberately retaining those values. The API now accepts
them only for existing imported records with stored website evidence. A missing
effective date remains private, and ordinary construction reports still require
a date. The original evidence is preserved; submission/readiness and four-eyes
approval remain unchanged. This correction touches our Phase 9 API and the new
website tests only; no historical migration or protected Phase 4/7 file changes.

Two disposable API regressions passed, including edit success, preserved source,
denied viewers, rejected forged sources and refused incomplete submission.
The full API rerun passed **2,111 tests / 11 existing opt-in skips / zero failures**
in 576.82 seconds. Typecheck and the documented offline build also passed.
Receipts are `website-edit-focused.log`, `website-edit-api-full.log`,
`website-edit-typecheck.log` and `website-edit-build.log` under
`artifacts/hosted-content-rollout/`. The database rerun passed **62 SQL/concurrency
checks + 10 Node tests**; H1 passed **11 protocol + 45 browser tests**. The complete
browser rerun passed **302/302 in one run (10.9 minutes)** with no failures or
skips, including the new queue at 1280 px and 390 px. These final receipts are
`website-edit-db.log`, `website-edit-h1.log` and `website-edit-ui-full.log`.
The final credential scan found zero matches in 302 files and 356 archive
members. `.local/hosted-content-rollout/website-edit-gates.json` seals 667 final
source-file hashes; the original pre-import `website-gates.json` is retained.

### TEST website import — completed

The guarded import completed at 16:45:56 UTC on 27 October (23:45:56 Bangkok).
Receipt `.local/hosted-content-rollout/website-test-apply-1793119556071.json`
records a successful transaction, preservation of all old content and full Auth
columns, strict protected-table comparisons and an exact `already_applied`
replay. The new verified protected backup was
`.local/backups/website-test-apply-20261027T154310Z/database-before-batch.dump`
(9,502,763 bytes, SHA-256
`5a34770a2896901862c568603ced6c9bba3a5a56bb658006d09d8ac55d601f09`).
No previous dump was reused.

| TEST item | Before E | After E |
|---|---:|---:|
| Project drafts | 82 | 82 |
| Brand drafts | 33 | 33 |
| REM project identities | 278 | 278 |
| Marketing-group references | 118 | 118 |
| Knowledge candidates | 11,102 | 20,389 |
| Asset registry rows | 3 | 3,131 |
| Asset links | 0 | 3,573 |
| Facilities | 0 | 30 |
| Places | 0 | 594 |
| Contacts | 0 | 374 |
| Media links | 0 | 140 |
| Commercial/unit-type drafts | 0 | 273 |
| Disclosure drafts | 0 | 52 |
| Construction progress drafts | 0 | 106 |
| Narrative sections | 0 | 183 |
| FAQ clusters | 0 | 426 |
| Website asset suggestions (asset/project scope) | 0 | 3,421 |
| Media jobs / human Knowledge reviews / publication versions | 0 / 0 / 0 | 0 / 0 / 0 |

The package added 9,287 candidates, 3,128 asset registry rows and 1,752 typed
drafts. All 229 conflicting text outcomes remain review evidence; 2,018 outcomes
still need review, including shared-phase and unresolved taxonomy/format cases.
No existing human content was overwritten, no new project was created, and no
page-derived price row was inserted. FAQ regeneration inserted 426 TEST clusters
without replacing a human decision; the local total was 333 because its prior
candidate population differs. Registry-row creation is separate from the R2
byte reuse recorded above.

Read-only postflight `website-database-postflight-1793119655406.json` verifies
the exact 78-migration history and all post-import fingerprints, including every
Auth column. The existing one account, 12 permission rows and six templates are
unchanged. BNA7, the website queue and source evidence are readable through
`hub_runtime` → `hub_app` without RLS bypass; a missing actor is denied.
All 3,421 suggestions remain pending, all website bindings are unconfirmed and
internal, and imported assets retain pending rights and `needs_review` metadata.
Published pages, publication versions, media jobs and publisher assignments
remain zero; `sena_h_approved` remains false. TEST has no web-page rows; the
existing local pilot pages retain `no_ai`.

The first separate read-only postflight probe stopped before producing its
migration/count checks (`website-database-postflight-1793119601738.json`). Its
cause was not established. The retry added safe error-class diagnostics only;
the same checks then passed with no database or credential change and no relaxed
assertion. Both receipts are retained. No hosted browser session was opened
during the import or these fingerprint checks.

### Final TEST application deployment and smoke

The API correction and execution receipts were pushed to `main` as **07dda14**.
Exact source release **`07dda14-content-82bd4feeade5`** is now live on TEST.
The restricted Linux build passed frozen dependency installation, typecheck,
the offline webpack build and the dependency audit. Candidate health/login and
anonymous-consumer denial passed before promotion. The API cache is a real,
writable `0700` directory; its existing cached file was preserved and verified.
The protected hosted configuration stayed unchanged, and the Linux browser
bundle scan found zero credential matches in 84 files.

Deployment receipts are under
`.local/hosted-content-rollout/website-deployment/`: `vps-source-manifest.json`,
`vps-candidate.json`, `vps-build.json` and `vps-promotion.json`.
The 211-file source-manifest SHA-256 is
`82bd4feeade5d9f91451f79ab2518fcd3ab58db40f473110afbbd8f86df4893c`.
Fresh verified service/web configuration backups preceded stage, build and
promotion, under `.local/backups/hosted-content-vps-stage-20261027T165124Z/`,
`hosted-content-vps-build-20261027T165207Z/` and
`hosted-content-vps-promote-20261027T165512Z/`. Each `units-web-before.tar.gz`
is 3,799 bytes, SHA-256
`4f78ac413b78d67bb5fd0378fc27e95acd7dc5ba60fd46f628a3f6acdd001885`.

Post-promotion database receipt `website-database-postflight-1793120179814.json`
again passed all 57 fingerprints, the exact migration prefix, counts and BNA7
non-bypass runtime access. `website-vps-postflight-1793120162.json` passed trusted
IP TLS, health/login 200, all probed consumer/admin endpoints 401 with `no-store`,
the exact R2 object/byte/checksum inventory, service hardening, writable cache,
certificate-renewal timer and unchanged other-site configuration. Next still
cannot read the R2 configuration. No page, account, permission or AI job changed.

Rollback application paths remain
`/srv/sena-hub-test/releases/953a152-content-4eb69b56f5b2` and
`/srv/sena-hub-test/releases/794d9cd-perf2-e78be5d8bee9`.
The previous service units are also preserved under
`/srv/sena-hub-test/backups/07dda14-content-82bd4feeade5-units`.
Database recovery uses the protected per-batch dumps listed above and the
documented restore procedure; no restore or R2 deletion was performed.

Only after the post-promotion fingerprints were recorded was browser inventory
requested for visual inspection. The tool reported **no browser available**;
no hosted tab or signed-in session was opened or refreshed. This final release
therefore has automated browser and hosted HTTP/SQL smoke evidence, but no new
hosted visual inspection. The earlier B/H1a screen inspection remains separately
recorded above. The following ignored synthetic-data screenshots were refreshed
by the passing browser suite and visually inspected:

- `artifacts/hosted-content-rollout/website-review-1280.png`
- `artifacts/hosted-content-rollout/website-review-390.png`
- `artifacts/hosted-content-rollout/website-sources-1280.png`
- `artifacts/hosted-content-rollout/website-sources-390.png`

The unavailable-browser result is retained in
`.local/hosted-content-rollout/website-browser-inspection.json`. The closing
credential scan found zero matches in 310 files and 356 archive members.

### H5 STOP — budget approval and missing hosted credential

**Superseded by H5a on 28 October 2026.** The US$60 / 1,879-image proposal below
was declined. Its receipt is retained and marked declined/superseded; it grants
no authority to queue jobs. H5a replaces it with individual requests and the
separately bounded two-project pilot. The original estimate remains historical
evidence only.

Read-only receipt
`.local/hosted-content-rollout/website-h5-budget-1793120297292.json` pins the
package, selected asset revisions and approved contexts. It found **3,084 images:
1,879 eligible and 1,205 held**. The remaining 44 registered assets are non-image
files. The configured/default model resolves to **`gpt-5.4-mini-2026-03-17`**.
The expected `OPENAI_API_KEY` is **not configured** in the existing hosted
`/etc/sena-hub-test/api.env`. Only its presence flag was read; no credential was
printed, copied or relocated, and no new credential file was created.

The conservative estimate for the 1,879-image batch is **US$47.3012**. Proposed
owner-approved spending cap: **US$60**, including 25% headroom rounded upward.
This uses standard uncached input at US$0.75/million tokens and output at
US$4.50/million, with no assumed cache or Batch API discount, as verified against
the [official model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
Inputs are resized to a maximum 768-pixel edge; 32-pixel patches and the model's
1.2 multiplier bound a square image at 692 input tokens. The rest of the
estimate includes the full UTF-8 context/schema/prompt size, 2,048 extra framing
tokens and up to 3,500 output tokens per image. The
[official vision token rules](https://developers.openai.com/api/docs/guides/images-vision)
were rechecked on 27 October. Requests would be sequential, with zero automatic
retries; extra attempts or a changed image/context/model scope require renewed
budget review.

**AI images processed: 0. Actual AI cost: US$0.** No jobs were queued and no
provider request occurred. STOP before AI remains in force under both H5 and
the owner's missing-credential rule. Resume only after the owner approves the
US$60 cap and the expected key is configured through the existing protected
hosted procedure. Do not supply the key in chat or add another credential file.

Remaining review items are the sheet membership/brand/name conflicts and
source-character exceptions recorded in C; the preserved 229 text conflicts,
2,018 unresolved outcomes and shared-phase scope; the 1,205 held images;
the robots/allowlist gaps recorded in D; and the protected Phase 7 unknown-date
display follow-up above. A connected browser is also needed for a fresh hosted
visual inspection. Marketing confirmations, publisher rights approval and any
publication remain separate human actions. Packages A–D and the non-AI E import
and deployment are complete; E's live AI suggestions remain deliberately pending.

#### Owner decision H5a — verbatim, 28 October 2026

```text
H5a  No bulk batch; AI image suggestions only on request.
- I do not approve the US$60 cap or the 1,879-image bulk batch. Mark the H5 budget receipt as declined and superseded, without deleting it. Queue no jobs from it.
- No per-project or batch AI request in this release. Staff request AI suggestions one image at a time, using the button below, or through the existing automatic request after a Marketing upload. Batch confirmation of category, tags and context stays as it is; it is not AI.
- Results remain suggestions under H4. Marketing confirms them, and rights stay with publishers.
- Credential: IT will configure OPENAI_API_KEY in the existing protected location (/etc/sena-hub-test/api.env). The key will belong to a dedicated OpenAI project with a US$10 monthly limit, shared by image suggestions and translation, configured through the existing protected hosted procedure. Never ask for the key in chat, print it, or create another credential location. Build and deploy everything below without the key; while it is absent, the AI controls must show as disabled.
- Pilot: two sample projects only (section 4). Then STOP for my decision.

## 1. "ขอคำแนะนำจาก AI": per-image button, low-key
- Add the button at the very bottom of every per-image tag editor. Known places:
  - the editor panel "แกไขหมวด แทก และบรบท" on each card in the website queue "รปจากเวบไซต (รอยนยน)" (website-media-queue.tsx);
  - the library card in the project media workspace, where the existing "ขอคำแนะนำ AI" button moves down and takes the new label and style (project-media-workspace.tsx:69);
  - the single-image edit form opened by "แกไขขอมลภาพ", and any other per-image category/tag editor you find.
  Build it as one shared component.
- Style: small, subdued, text/link style, using the existing secondary tokens. It is never the primary action and never sits above the confirm or save actions. Under it, one muted hint line: "ใชงบ AI  ผลเปนคำแนะนำ ยงไมบนทกเปนขอมลจรง". Keep it at the bottom at 1280 px and 390 px, with no horizontal scroll and no animation.
- Behaviour:
  - It queues one image_suggestion job for the image's current revision, using the existing hub.media_job_request and the existing projects edit permission. No new capability or template change.
  - Requests are idempotent: an image with a queued or running job, or a suggestion for the same revision, shows its status instead.
  - States:
    - "กำลงขอคำแนะนำ" while waiting;
    - the existing suggestion display when done; it never auto-applies values;
    - "ยงไมไดเปดใช AI บนระบบน" when the provider is not configured;
    - "งบ AI เดอนนหมดแลว" when the cap is reached;
    - hidden for ineligible images (legal documents, brochures, internal-only, non-images).
  - Write an audit record per request.

## 2. Hosted media worker
Hosted TEST has no media worker today, so requested jobs would never be processed.
- Add a hardened hosted worker following the docs/39 service pattern (ProtectSystem=strict, NoNewPrivileges, a private writable cache). It runs as the existing hub_media_worker database role, and the API runtime still cannot assume that role.
- It may read the key only from the existing protected env file.
- If it needs a database login or any other credential that is not already configured, STOP and report exactly what is missing. Do not create it.
- Process jobs sequentially. After a provider attempt that may have been billed, never retry automatically.
- The worker must not drain translation jobs or any other queue.

## 3. Monthly cap enforced in the Hub (on top of the OpenAI project limit)
- Add a non-secret config value for the monthly image-suggestion cap:
  - US$5 on hosted TEST;
  - US$0 (disabled) in every other environment;
  - raising it requires an owner decision recorded in docs/46.
- Also record the price table used: model, input price and output price per million tokens, with an effective date.
- Before claiming each job, the worker compares month-to-date spend (from recorded provider_usage) plus the next job's worst-case ceiling with the cap. If that would exceed the cap, it stops claiming and marks waiting jobs "budget_exhausted". Do not mark them failed.
- Show staff the month-to-date spend and the remaining budget in a small muted line near the button.
- When the budget is used up:
  - an upload still saves and shows "ไมไดขอคำแนะนำ AI เพราะงบเดอนนหมด";
  - the button shows its budget state.
- Report how translation (E9) spend is currently controlled. Do not change translation in this task.

## 4. Pilot: one condominium and one house
- Projects (exact Project IDs from the business-sheet snapshot):
  - B_PO, นช โมโน บางโพ: condominium, www.sena.co.th/project template.
  - B1/5, เสนา แกรนด โฮม รงสต-ตวานนท: detached house, brands.sena.co.th template.
- Run this only after the key is configured.
- Count each project's eligible website images, excluding held ones, and compute the worst-case total. If it exceeds the remaining US$5 cap, STOP and report the counts before queueing anything.
- Otherwise, run them through the existing budgeted operator path (exact approved job IDs, hub.website_media_claim): sequentially, with no automatic retry, counted against the same monthly cap.
- Report for each project:
  - images processed, actual cost, average per image and errors;
  - the share where AI agrees with the page-position suggestion;
  - 5 examples comparing the page-position suggestion with the AI suggestion (category, tags, image kind, Thai caption and alt text), with no personal data.
  Save screenshots of the website queue for each project under ignored artifacts/. Hosted browser inspection is allowed now that the post-deploy fingerprints are recorded.
- STOP for my decision before any other project.

## 5. Gates and deployment
- Next migration number: 79. Run every gate in docs/41 5. The full browser suite must pass in one run, including the button's states at 1280 px and 390 px.
- Add tests for:
  - cap refusal and the "budget_exhausted" state;
  - idempotent re-requests;
  - permission denial;
  - provider not configured;
  - hidden button for ineligible images;
  - the worker never draining another queue.
  Provider calls must be mocked in tests.
- Deploy to hosted TEST using the docs/46 procedure: a verified backup before each write batch, protected fingerprints before and after, the previous release kept for rollback, and smoke checks. Record everything in docs/46.

STOP and report on any condition in docs/41 6, on a missing credential, or on any change to protected accounts, permissions or Auth.
```

#### H5a prerequisite STOP — missing worker database connection

Read-only preflight completed at 02:45 UTC on 28 October (09:45 Bangkok),
receipt `.local/hosted-content-rollout/h5a-worker-preflight-1793155504592.json`.
The exact TEST target and TLS passed, and the applied migration prefix remains
78. All 30 protected-table fingerprints were unchanged during the check,
including every Auth column; no account, permission, role or data was changed.

The existing `hub_media_worker` is a nonprivileged **NOLOGIN** role. There are
**zero nonprivileged LOGIN roles authorized to assume it**. The existing API
runtime correctly cannot assume it. The protected hosted API environment has
one configured database connection (the API connection), no worker connection,
and no OpenAI key. Neither a media-worker nor a translation-worker service is
installed. These are presence/privilege results only; no configuration value or
credential was copied into the receipt or report.

**Required from IT:** a dedicated, nonprivileged PostgreSQL LOGIN/connection
authorized to `SET ROLE hub_media_worker`, configured in the existing protected
`/etc/sena-hub-test/api.env` (proposed setting: `HUB_MEDIA_WORKER_DATABASE_URL`).
It must not grant the API runtime worker authority or reuse an administrator
connection. Existing verified TEST TLS configuration can be reused. No new
credential location is needed or permitted. This agent has not created a login,
password, grant, connection setting or service.

H5a section 2 explicitly says, “If it needs a database login or any other
credential that is not already configured, STOP and report exactly what is
missing. Do not create it.” That STOP applies here. The known absence of the
OpenAI key alone is allowed during implementation by H5a; the missing worker
database connection is the current blocker. Migration **79 has not been
created or applied**, and the per-image controls, monthly cap and worker have
not been built or deployed. The live application remains
`07dda14-content-82bd4feeade5`.

The original H5 budget receipt remains at
`.local/hosted-content-rollout/website-h5-budget-1793120297292.json`, with status
`declined_superseded`, its previous status/hash retained, and an H5a decision
record setting both bulk-budget approval and queue authorization to false.
Its image inventory and estimate were not deleted. The historical execution
plan is also marked superseded. **No media jobs exist and no jobs were queued
from the declined receipt. No provider call, pilot run or AI charge occurred.**

#### E9 translation spending controls — read-only finding

The current implementation limits an individual translation response to 8,000
output tokens, uses the reviewed model and fixed provider endpoint, and disables
SDK automatic retries. Its worker is a separate local-only runner assuming
`hub_translation_worker`. The queue rechecks source eligibility, revision and
the requester's permission; failed jobs require an explicit retry, while an
expired running lease may be reclaimed up to three attempts. These are request
and workflow bounds, **not a monthly monetary cap**.

E9 currently has **no Hub monthly spend ledger/cap and no `provider_usage`
column**. TEST has 1,090 translation-job rows and zero completed translations;
no hosted translation-worker service is present. The dedicated OpenAI project's
US$10 monthly limit shared with images is the owner's planned IT configuration,
not something verified or configured by this preflight. Translation code,
queue state, settings and services remain unchanged, as required by H5a.

Resume after IT has provisioned the worker connection through the approved
procedure. Then implement and gate H5a, deploy with controls disabled while the
key is absent, and run only the B_PO/B1/5 pilot after the key and budget checks
permit it. The declined 1,879-image bulk proposal must never be used to queue
work. Stop again after the pilot for the owner's decision.

This stopped slice changes documentation only. The credential scan passed with
zero matches in 312 files and 356 archive members; whitespace validation passed.
No application gates were rerun and no new test or deployment result is claimed.
