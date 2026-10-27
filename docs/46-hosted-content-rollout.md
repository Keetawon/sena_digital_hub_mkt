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
