# 46 — Hosted TEST content rollout

## Shared production host: current admission — 20 November 2026

This section records the owner's latest decisions and supersedes older capacity
STOP/admission wording. Historical receipts remain unchanged. The production
warehouse is `sena-warehouse-postgres`; the additional ETL `postgres` container
is not proven TEST-only. Never change either container, its limits, schedules,
configuration or data. Hub TEST must fail first. No VPS load/stress test is ever
permitted; upload capacity measurements use local Linux only. Existing operator,
credential, protected-state and database-restore STOP rules still apply.

### Earlier rollout and marketing review — owner decision 20 November

The owner moved the next release earlier than Wednesday, subject to one
pre-rollout full gate on final main, including preview corrections and any
approved Project Group review additions. Prepare one concrete rollout plan
for approval, including the frozen packages, TEST database backup, rollback,
smoke checks and an admissible Saturday-afternoon or Sunday candidate window.
No new window or package installation is approved by this scheduling decision.

The application/schema rollout may proceed before interim caps if their
window has not yet happened. This is a specific exception to the earlier
caps-before-rollout ordering; all standing job, pressure, backup, restore and
warehouse protections remain. Saturday's page-check/cap reservations stand.
**Real-data import must wait until caps are active and verified**, after a
successful rollout, local dry-run inventory and another TEST database backup.
Run it serially inside the maintenance-helper allowance, using existing
intake/staging paths, with idempotent/resumable receipts and TEST R2 only.
Collected website items remain awaiting confirmation; image rights remain
pending. Never auto-approve, auto-publish or broaden public/web API exposure.
Reconcile earlier hosted imports before creating or replaying any object.

Use the existing hosted environment; secret settings are reported set/unset.
Daily W6 BU synchronization stays disabled (DW steps 2/4 unfinished).
Report actual REM source/freshness; Monday uses hosted real data after readiness.
List local-only cases separately and report before every hosted step.
The later approved canonical job/unit/source baseline in [docs/53](53-hosted-marketing-release.md)
replaces volatile ExecStart hashes only; drift or missing identity is a STOP.
Missing PSI is a reported gap, not passed; apply every other pressure STOP signal.

### Standing lightweight-job overlap rule — owner approved 20 November

Until Hub moves to its own server, the following identified, unchanged jobs
may overlap **every Hub operation window**, including owner page checks, cap
application and hosted rollout. This replaces the date-limited 19 November
exceptions and the earlier cgid gap blocker; it does not itself admit a window.

| Covered job | Retained identity |
|---|---|
| `*/3` LiteSpeed cgid permission-check cron, `if find /usr/local/lsws/cgid ... then ... fi` | Command SHA-256 `c248d4fc0a87064a34ba1d4bb09d6565bebf053c61b9ba0fad118c5f6b6eefb9` |
| `sena-pipeline-health.service` | Existing DW metadata monitor; `check_pipeline_health.py` SHA-256 `3ce5e37f2a492ae6a07b96aeef5e3e12d2604be28576cd016a0238b2072c3ba9` |
| `sena-line-alert.service` | Existing DW notification job; `alert_pipeline_failure.py` SHA-256 `b5623f6401af49cc5ea10908ee13f8939d46c651b1fc70f9216bc8b755c8d510`; helper `line_notifier.py` SHA-256 `22e65fa047bd5cd0ab8214e17feb2333ea49871a7a511a5b06e4912cf5321df9` |

Before admission, verify command and job identity against the retained receipts
under `.local/hosted-capacity-w9-20261116/interim/observations/`:
`20261119T060910Z-cgid-condition.json`, `20261119T041659Z-health-identity.json`,
`20261119T051940Z-alert-outline.json` and `20261119T052035Z-alert-helper-outline.json`.
The service receipts' raw `ExecStart` hashes include the systemd representation;
distinguish configured executable/arguments from volatile run accounting. Do not
silently accept changed commands, source or identity, or replace the baseline.
If a command hash/identity changes or cannot be established, the job is no longer
covered: **skip the occurrence and report**.

Record every overlapping natural run's identity, start, end and outcome through
the operation and tail. Never start, delay, stop, reschedule or modify these jobs,
or trigger an alert. Missing end/outcome evidence remains explicit. Their
unmeasured memory peaks remain evidence gaps; the system pressure policy applies.
The observed DW monitor exit 2 remains an owner/DW-side issue, not Hub diagnosis.

All other work remains excluded: 06:00/11:00/17:00 refresh groups, hourly :20
customer job, :30 backup housekeeping, :39 cleansessions and descendants,
certificate windows and unexpected work. Require actual completion plus five
settled minutes after excluded work. Keep the full pressure STOP policy, Hub
peak capture, five-minute tail and no DW changes. Do not let an overlap exception
hide a pressure event or an unexpected descendant doing different work.

**Approved Saturday 21 November 2026, Bangkok:** 09:45–09:59 owner page check
(owner signed in on one tab from 09:40, waiting for the start signal), followed
by 10:45–10:59 cap application per [docs/51](51-hosted-test-cap-window.md).
Each occurrence requires fresh admission. Apply caps only after the page check
is complete and admin lifetime peak is **at most 256 MiB**, with all other
docs/51 conditions met. Above 256 MiB, present a rebalance proposal and do not
apply. Skip either occurrence if admission fails and propose the next slot that
same day; a replacement slot is not automatically approved. These are approved
reservations, not completed page checks, admitted intervals or applied caps.

### Pressure thresholds for every operation window

The owner released the 17 November STOP: 551 swap-out pages (about 2 MiB) over
47 minutes and 1,792 KiB swap-used growth are below the revised thresholds.
Preserve `interim/swap-stop-20261117.md` as historical evidence, not an active
blocker. Resume short, low-frequency passive observations through the existing
admitted route. No resident watcher, counter reset or host modification.

STOP if any of the following occurs during an operation:

- `MemAvailable` is below **3.84 GiB** at any sample.
- Swap-used growth from the operation baseline exceeds **64 MiB**, or swap-out
  rate exceeds **100 MiB per five minutes**. Use the actual page size and elapsed
  time; do not assume that a long-window average rules out a short burst.
- Any allocation-stall or direct-reclaim counter increases, or available memory
  PSI `some avg10` exceeds **10**.
- Any new `high`, `max` or OOM event in a Hub TEST cgroup, any kernel OOM,
  or warehouse unhealthy/not running/`OOMKilled`.

Record all deltas below these thresholds, including swap-in; they are not a
STOP. Record missing PSI as unavailable, not zero. Retain timestamps, boot and
cgroup identities, counter coverage, resets/restarts and sampling gaps. Apply
the same rule to admission, the operation and its five-minute settled tail.
Every rollout/postflight must record warehouse health and OOM state, host
pressure, and Hub TEST current/peak memory within its limits. Never flush swap,
drop caches or change production to obtain admission.

### Interim W1–W5 caps: approved diff, not yet applied

W9 delivery is verified: product `c9791af`, receipt `45ca776`, handoff `be5d20f`.
The conditional approval remains tied to
`.local/hosted-capacity-w9-20261116/interim/proposed-config.diff`, SHA-256
`b0d532a7b2e46d7a2719aff58334e4dfa52d2abf8a716fe13da21d3a428c7b87`.

| TEST unit/allowance | MemoryHigh MiB | MemoryMax MiB | Swap MiB |
|---|---:|---:|---:|
| API and in-process broker | 1024 | 1280 | 0 |
| Media worker | 96 | 128 | 0 |
| Admin web | 256 | 384 | 0 |
| Broker socket/helper | 4 | 8 | 0 |
| Certificate helper | 96 | 128 | 0 |
| One operation helper, inside the parent | 320 | 376 | 0 |
| Aggregate parent | 2048 | 2304 | 0 |

1280 + 128 + 384 + 8 + 128 + 376 = **2304 MiB (2.25 GiB)**. The earlier host
snapshot gives 15.362297 − 7.519035 warehouse active cache − 2.25 TEST − 1.5
OS/other allowance = **4.093262 GiB** reserve, above 3.84 GiB. This is planning
arithmetic, not a warehouse cache reservation or a current admission result.
Warehouse full working-set peaks and CPU/I/O still matter on the shared host.

The exact diff retains `OOMScoreAdjust=1000`, `OOMPolicy=kill`, `Restart=no`,
cleared forced-restart overrides and the socket's API-lifetime binding. A TEST
crash/OOM leaves it down: report it; do not restart automatically. Verify the
slice hierarchy, effective caps and every application/Exec-command PID's +1000
score after applying. The previously disclosed short-lived systemd-internal
socket setup helper does not inherit the execution-context score; do not modify
shared systemd or claim otherwise. Both PostgreSQL containers remain excluded.

The owner decoupled interim-cap admission from local Linux capacity/failure
experiments. Required admission is now:

1. Fresh read-only admission under the thresholds above and the existing route.
2. An owner-approved quiet interval supported by actual job observations.
3. Read MainPID, cgroup identity, current/lifetime-peak memory and memory events
   for **API, admin, media worker and broker units** before and after the **owner**
   opens main demo pages normally inside that interval. Identify shared broker/API
   accounting and unavailable socket metrics explicitly. Record route outcomes;
   do not reset lifetime peaks. The API composition path's peak must be assessed
   against its proposed 1024/1280 MiB high/max limits. Do not simulate load.
   If admin's observed peak exceeds **256 MiB**, propose a rebalanced
   allocation inside 2304 MiB and obtain approval before applying.

No W9.1 upload measurement or local web-load/failure rehearsal blocks these
three admission conditions. Exact absent-path/property checks, reviewed apply
order, syntax validation and fail-safe verification remain part of execution.
Stop admin, worker, socket and API in the reviewed order; install only the six
hash-matched approved files; reload the unit manager; verify the parent before
starting socket/API, worker and admin. No release, schema or environment switch.
Verify health/login, anonymous denial/no-store, warehouse health, limits, scores
and pressure through the settled tail. After activation failure, stop TEST and
retain protection; never automatically restore its old larger envelope.

### Production schedules and quiet-interval decision

Retained 9–16 November observations are evidence of past starts/terminal events,
not current clearance. Host timezone is UTC; this table is Bangkok (UTC+7).

| Job | Scheduled start | Delay/observed duration |
|---|---|---|
| Customer summary | hourly :20 | observed up to 7m45s |
| Solar refresh | 06:00, 11:00, 17:00 | random 0–5m; observed 50s |
| Project group | 06:10 | observed 4m53s |
| Solar short form | 06:15, 11:15, 17:15 | random 0–5m; observed 23s |
| Search-ad solar refresh | 06:30, 11:30, 17:30 | random 0–10m; observed 13m07s |
| Analytics solar refresh | 06:45, 11:45, 17:45 | random 0–15m; observed 11m30s |
| Advertising refresh | 11:40 | observed 20m56s |
| Warroom / social refresh | 03:00 / 03:20 | random 0–5m; observed 2m05s / 4m13s |
| Pipeline health | 5m after boot, then 15m after activation | random 0–1m; observed 4s |
| Advertising cron | hourly :00 and :05 | retained pairs up to 6.910s / 8.641s |
| TEST certificate renewal | 01:00, 07:00, 13:00, 19:00 | random 0–30m |

Other three-minute, :09/:39, half-hourly/hourly, backup and maintenance jobs
also exist. Terminal rows may be failures and do not prove detached descendants
ended. Calendar timers may catch up; manual starts and retries remain possible.
Observe actual starts/ends and next triggers read-only over representative days,
then present a fixed interval for owner approval. No executable interval has
been admitted; the approved reservation below still needs fresh clearance.
Deploys, migrations, imports, backups and UAT bulk steps must avoid production
job windows and fit cleanup plus a five-minute settled tail. Unknown completion
is not clearance. Do not reschedule or stop production to manufacture a gap.

**Historical reservation, superseded by the current policy above:** 19 November 2026, 09:40–09:59
Bangkok for the owner's normal page-reading peak check. The full reservation is
not proven quiet. Admit only a subwindow after actual job/descendant completion
and five settled minutes, with at least twelve minutes before the next relevant
trigger and reservation end. The moving health timer and :39 background cron
can invalidate this occurrence; skip it if clearance is unavailable. The
three-minute conditional cron also requires an activity check. A 15–16-minute
health cadence normally cannot fit five settled minutes followed by this
twelve-minute gap; skip if fresh clearance is insufficient. No production
schedule changes are permitted. Exact ten URLs, one-tab/20-second instructions,
six-minute visit budget, five-minute observation tail and separate cap-apply
step are in `.local/hosted-capacity-w9-20261116/interim/quiet-window-proposal-20261118.md`.
An error-page render does not prove a successful large-payload render's peak.
At 20 seconds a still-loading page may finish or report an error up to 60 seconds;
record its outcome/time and continue without reload or retry. Stop on two pages
exceeding 60 seconds, or the overall six-minute budget. Record unvisited routes
and do not claim complete acceptance for an incomplete sequence. No cap
application is authorized in this session; its own window requires approval.

### Local Linux work and remaining order

The owner approved and accepted WSL2 Ubuntu-24.04 setup with account-wide
`.wslconfig` memory=12GB and swap=0, leaving approximately 11.8 GiB outside its
ceiling on this laptop. Actual Windows free memory still needs checking. Existing
distro systemd and cgroup v2 were verified without a privileged configuration
change. The W9 product tree and lockfile were exported explicitly without
credential/environment files. Frozen production and measurement environments
match the lock; the accepted setup receipt is
`/home/keetawatw/w9-1-lab/receipts/setup-receipt.json`, status
`LINUX_SETUP_VERIFIED_NO_CAPACITY_CLAIM`. Setup is not capacity acceptance.

The owner explicitly authorized **local measurements before hosted interim
caps** on 18 November. Serialize them with every other local test run; each probe
uses a transient cgroup with four CPUs, MemoryMax=2304M (2,415,919,104 bytes),
MemorySwapMax=0, and a recorded limit receipt. Laptop wall time is a local estimate
only, never proof of the hosted 30-second deadline. Memory is the primary result.
All experiments remain inside the local distro; no hosted load, package install,
release or configuration change follows from them. See
[WSL configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).

W9.1 must preserve the 24 MP product floor and 4096 output edge, bound PDF
aggregate work, trace excess allocations, and measure killable processing,
JPEG decode scaling and streaming alternatives locally. W9's slowest accepted
processing call is **26.349 seconds against 30 seconds**; W9.1 must bring it well
below that limit, not increase the deadline. No hosted package or rollout is
approved by local setup.

Order: **local W9.1 measurements may proceed now; interim caps → W9.1 delivery
and the approved home performance slice → W8 UAT → separately approved hosted
rollout in an approved window**. W6+ hosted
rollouts, migrations, imports and UAT bulk remain blocked until caps and the
window are verified. Receipts and current admission plan remain under
`.local/hosted-capacity-w9-20261116/interim/`; the uncommitted older preparation
in `ws/w9-1-rollout-plan` is preserved and its superseded requirements are not
additional approval conditions.

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

#### H5a Thai text correction

Source: `.local/owner-input/h5a-h5b-thai-text.md`, decoded explicitly as UTF-8.
The owner added the two budget labels and exact ledger-only format on 28 October;
the current source has 108 Thai combining marks and no replacement characters.
Tables A-C below are copied exactly. The original H5a verbatim block is unchanged.

## A. H5a UI strings (use exactly)

| Key | Thai (correct) | Where |
|---|---|---|
| button_label | ขอคำแนะนำจาก AI | per-image button (shared component) |
| hint | ใช้งบ AI · ผลเป็นคำแนะนำ ยังไม่บันทึกเป็นข้อมูลจริง | muted line under the button |
| state_waiting | กำลังขอคำแนะนำ | queued/running |
| state_not_configured | ยังไม่ได้เปิดใช้ AI บนระบบนี้ | provider not configured |
| state_budget | งบ AI เดือนนี้หมดแล้ว | monthly cap reached |
| upload_budget_notice | ไม่ได้ขอคำแนะนำ AI เพราะงบเดือนนี้หมด | upload saved, no AI request |
| budget_spent_label | ใช้งบ AI เดือนนี้แล้ว | month-to-date spend, followed by the amount |
| budget_remaining_label | งบ AI คงเหลือ | remaining monthly budget, followed by the amount |

Budget line format: label, a space, then the amount as "US$" with two
decimals; the two parts are joined by " · ". Example:
ใช้งบ AI เดือนนี้แล้ว US$1.20 · งบ AI คงเหลือ US$3.80
Amounts come from the Hub cap ledger (cap US$5), never from the provider.

Existing labels named in H5a (already correct in code; do not change):

| H5a verbatim (corrupted) | Correct, as in code |
|---|---|
| แกไขหมวด แทก และบรบท | แก้ไขหมวด แท็ก และบริบท (website-media-queue.tsx) |
| รปจากเวบไซต (รอยนยน) | รูปจากเว็บไซต์ (รอยืนยัน) |
| แกไขขอมลภาพ | แก้ไขข้อมูลภาพ (project-media-workspace.tsx) |
| ขอคำแนะนำ AI | ขอคำแนะนำ AI (existing button, replaced by button_label) |

The hint separator is the middle dot " · ", matching existing UI copy such as
media-common.tsx.

## B. H5a pilot project names

| Project ID | Thai name |
|---|---|
| B_PO | นิช โมโน บางโพ |
| B1/5 | เสนา แกรนด์ โฮม รังสิต-ติวานนท์ |

Project IDs are authoritative; names are for reports only.

## C. Other corrupted references in the H5a block

- "docs/41 5" means docs/41 section 5 (gates).
- "docs/41 6" means docs/41 section 6 (STOP conditions).

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

#### Owner decision H5b — 28 October 2026

**H5b  Thai text by file; offline E9 translation; owner-configured OpenAI key.**

The UTF-8 source of truth is `.local/owner-input/h5a-h5b-thai-text.md`. Decode it
explicitly as UTF-8 and verify Thai combining marks before use. Keep the H5a
verbatim block unchanged and copy A–C exactly as the H5a Thai text correction
above. UI strings use the correction. If future pasted Thai looks stripped,
stop and request the file instead of guessing. The first source check found
67 combining marks and no replacement characters; the later section-E update
contains 96 combining marks and no replacement characters.

Complete the existing TEST E9 backlog offline using the neutral method
`offline_batch`, with no provider call, key access, provider charge, model name
or drafting-product provenance. Inventory jobs read-only by state, owner type,
project, field and current source revision. Exclude price text, material outside
E1 (including customer, contract, legal and finance data), and fields not
requiring English. Export eligible job/owner/field IDs, Thai text/hash/version
and applicable glossary entries under ignored `.local/`.

English must be plain, accurate public-website copy, with no invented facts,
claims or superlatives. Apply glossary renderings exactly and preserve every
placeholder, number, unit and date. Project/brand names use the glossary first,
then the reviewed English business-sheet name; otherwise retain a romanised
draft flagged `needs_review`. Flag every `non_dee` occurrence under Q75.
Automated QA checks placeholder/number/glossary preservation, no Thai in English
and nonempty output. Read 30 random results and record corrections; STOP if more
than 10% require meaning corrections.

Import BNA7/FLEXI first, then B_PO/B1/5, then other projects. Complete existing
jobs and write `machine_en`, `translation_state='machine'` and the translated
`en_from_th_version`; recheck Thai and skip stale rows. Preserve `reviewed_en`
and `entered_en`, and never mark reviewed. Rehearse locally, take a fresh verified
protected backup for every write batch, compare protected fingerprints, use one
guarded transaction per batch and require exact `already_applied` replay. STOP
before any required schema change or new credential. Migration 79 remains for
H5a. Do not install a translation worker or change queue behavior; new Thai saves
continue to wait. Any importer must test number/placeholder guards, stale skips,
human-English preservation, replay and permission denial, with touched docs/41
section-5 gates. Report counts, flags, QA, five examples per pilot and receipts.

The owner configures the API key personally in the existing protected hosted
API env and restarts the API service. Do not ask for, print or relocate it.
**After the owner reports completion**, perform only the authorized presence,
file owner/mode, 30 protected fingerprint (all Auth columns), health and smoke
postflight against the 09:45 Bangkok H5a baseline. Inventory the API features
enabled by the key and existing spend bounds; propose controls without changing
them. The H5a worker-connection STOP and all earlier protection/QA STOPs remain.

#### Owner decision H5c — 28 October 2026

**H5c  One OpenAI project and key per Hub agent, each with its own hard spend limit.**
This replaces H5a's shared project. The owner creates projects and service-account
keys and configures them personally through existing protected files. Never ask
for, print, copy or move a key; labels end with the creation month.

| Project | Caller | Key label | Existing file / variable | Owner monthly limit |
|---|---|---|---|---:|
| senaidea-digitalhub-test-assistant | staff assistant and knowledge embeddings | senaidea-digitalhub-test-assistant-202610 (configured by owner) | `/etc/sena-hub-test/api.env`: `OPENAI_API_KEY` | US$4 |
| senaidea-digitalhub-test-media | image-suggestion worker | svc-hub-test-media-2026-10 | same file: `HUB_MEDIA_OPENAI_API_KEY` | US$6 |
| senaidea-digitalhub-test-translation | E9 worker | not created | `HUB_TRANSLATION_OPENAI_API_KEY`, absent | US$0 |
| senaidea-digitalhub-local-ops | local operator scripts | svc-hub-local-ops-2026-10, when needed | existing `apps/api/.env`: `OPENAI_API_KEY` | US$5 |

The Hub image cap remains US$5, below the media project's US$6; provider-side
overshoot is possible. TEST allocations total US$10. Production projects wait
for go/no-go. Configuration and hard-limit enforcement are owner-managed and
are not asserted as verified by this code change.

Media reads only `HUB_MEDIA_OPENAI_API_KEY`; E9 reads only
`HUB_TRANSLATION_OPENAI_API_KEY`, without fallback. Make the constructor key
variable explicit per caller; this key selection is the only E9 behavioral
change authorized by H5c. Assistant, embeddings and local operator scripts retain
`OPENAI_API_KEY`. Missing media configuration uses section-A `state_not_configured`.
Section E of the UTF-8 file supplies `assistant_budget` and `knowledge_budget`.

Recognize HTTP 429 codes `project_spend_limit_exceeded`,
`organization_spend_limit_exceeded` and `insufficient_quota`. Media stops claiming
and marks waiting image jobs `budget_exhausted`, never failed, with no retry.
Assistant and knowledge return their exact budget messages with no retry.
Record bounded audit events without request content or secrets. Both test runners
must scrub all provider key variables and credential scanning must cover the new
names. Do not edit credential files; document developer variable names only.
Mock providers for key isolation, each error code, zero retries and no key leaks.

Implement and gate H5c now, commit to main, and hold deployment for the combined
H5a release. The missing media-worker connection STOP remains. For the future
owner-confirmed postflight expect only API-key presence, with media key absent
until the owner reports otherwise. Keep new documentation/commits free of model
or drafting-product names beyond historical configuration.

The owner additionally approved including the required budget state and audit
RPCs in **migration 79**, with these limits: only `image_suggestion` jobs may use
`budget_exhausted`; translation stays unchanged apart from key selection; no new
capability, template, login or grants to new roles; apply 79 locally only and hold
TEST application/deployment for the combined H5a release. This does not release
the worker-connection STOP.

Subsequent owner amendment **H5e, 28 October 2026**: the media key and dedicated
worker database URL belong only in `/etc/sena-hub-test/media-worker.env`, loaded
only by the media worker. `api.env` must contain neither variable. The earlier
H5c record above is retained as history; H5e replaces its media-key location and
authorizes the exact dedicated login described below.

#### H5b read-only inventory and offline QA

Receipt: `.local/hosted-content-rollout/h5b-inventory-1793158007922.json`. All 30 protected fingerprints, including full Auth, match the 09:45 Bangkok H5a baseline. No hosted write or provider call was made by the inventory.

All **1,090 jobs are queued and current**. The initial E1/registry filter excludes 28; 1,062 rows contain 860 distinct texts. The source/glossary export is `.local/offline-translation/20261028T032647707Z/source.json`.

| Owner type | Jobs |
|---|---:|
| commercial_type | 283 |
| facility | 30 |
| place | 594 |
| section | 183 |

| Field | Jobs |
|---|---:|
| `commercial_type.description` | 10 |
| `commercial_type.public_name` | 273 |
| `facility.display_name` | 30 |
| `place.name` | 594 |
| `section.concept_detail` | 69 |
| `section.concept_name` | 46 |
| `section.project_intro` | 68 |

| Exact source project/reference ID | Jobs |
|---|---:|
| `00101` | 3 |
| `00300` | 8 |
| `00401` | 3 |
| `00500` | 15 |
| `00601` | 13 |
| `00602` | 4 |
| `01301` | 18 |
| `01401` | 3 |
| `01501` | 17 |
| `01800` | 18 |
| `10301` | 30 |
| `20100` | 9 |
| `20202` | 15 |
| `70101` | 18 |
| `70103` | 19 |
| `70401` | 16 |
| `70502` | 5 |
| `70503` | 22 |
| `70504` | 17 |
| `80201` | 6 |
| `AQ` | 27 |
| `B1/5` | 21 |
| `B1/7` | 6 |
| `BGTHT` | 8 |
| `BNA6` | 34 |
| `BNA7` | 33 |
| `BPHF3` | 17 |
| `BPHGH` | 17 |
| `BPSK1` | 18 |
| `BPSK2` | 19 |
| `BPSN` | 6 |
| `BPU` | 20 |
| `B_PO` | 45 |
| `CBDC1` | 3 |
| `CHA14` | 28 |
| `CHOMT` | 11 |
| `F9SV5` | 12 |
| `FGL70` | 30 |
| `FISUK` | 9 |
| `K1AB` | 7 |
| `K1P48` | 11 |
| `K2KH2` | 3 |
| `K4LPT` | 5 |
| `K9BK3` | 23 |
| `K9BK4` | 27 |
| `K9PG` | 6 |
| `KBDF4` | 6 |
| `KUBON` | 25 |
| `LADK2` | 6 |
| `LADKB` | 5 |
| `LIFIS` | 28 |
| `LIFK6` | 22 |
| `LP107` | 11 |
| `NUSA` | 17 |
| `ONUT1` | 14 |
| `PCHAO` | 32 |
| `PH7/1` | 13 |
| `RAM9A` | 22 |
| `RAMK` | 25 |
| `RTF6` | 12 |
| `SAMRG` | 8 |
| `SKHPT` | 25 |
| `SLYA` | 23 |
| `SNHP2` | 35 |
| `SRKIT` | 6 |
| `TRAK1` | 15 |
| `VELA` | 17 |
| `VELAP` | 3 |
| `VIVA` | 15 |

The later offline/manual scope review holds 58 additional rows (financial abbreviations, contact text, incomplete sources and uncertain names), leaving **1,004 drafts**. All numbers/placeholders, applicable glossary terms, equivalent units, nonempty output and no-Thai output pass. No `non_dee` occurrence was found in this backlog. Romanised or uncertain source-name drafts are held for review rather than imported.

The operator read the stored random sample of **30 distinct results**: **zero meaning corrections (0%)** and one grammar/casing cleanup, recorded in the pinned package QA. This is below the owner's 10% STOP threshold. The sample and original drafts remain ignored locally.

The sole wording correction was `BPSK2`, `section.concept_detail`: “a
MinimalJapanese Style, incorporating Element and colours with positive meanings”
became “a minimal Japanese style, with elements and colours associated with
positive meanings”. It corrected spacing, case and grammar without changing
facts, numbers or project claims. No other sampled result needed correction.

Final pinned package: `.local/offline-translation/20261028T032647707Z/package-v2.json`, SHA-256 `2410419432769da074ea49e8c974840b58ff05793c9ff2c159a29e471295eb03`. The first package and receipt remain retained; the second version holds two further energy-saving claims for source/financial interpretation. The random QA sample is unchanged. It contains nine ordered batches: BNA7 (32; FLEXI has zero backlog jobs), B_PO/B1/5 (43/18), then the remaining projects. FLEXI has no eligible translation jobs or five-result example set to report; no jobs were invented. All nine local rehearsals and guarded TEST batches completed successfully as recorded below.

#### H5b API caller/spend inspection

The owner subsequently reported completion and the read-only postflight below
passed. The offline work does not read a provider key. Source inspection finds
two API-process provider callers:

| Caller | Existing TEST access boundary | Existing request bounds | Hub monthly spend bound |
|---|---|---|---|
| Staff assistant | Returns `assistant_local_only` before a provider call on hosted TEST. Live mode is restricted to a closed synthetic case on the local development target. | 2,000-character user input; 60 seconds; six turns; eight tool calls; 2,048 output tokens per model call; client retries zero. | None; owner project allocation is external configuration. |
| Knowledge search embeddings | Hosted `preview`/`preview-release` return `knowledge_preview_unavailable` before embedding. Local preview embeds one question of at most 1,500 characters after input/scope checks. | One embedding request per eligible query; existing deployed client permits one SDK retry. H5c changes that to zero. | None; owner project allocation is external configuration. |

Adding the API key alone therefore does **not** open either blocked TEST
endpoint. This is a code-inspection finding, not a claim of a hosted authenticated
smoke or provider request. Image suggestions and E9 run in separate workers;
neither hosted worker is installed, and API saves only enqueue their jobs.
Local operator scripts remain explicitly invoked workflows using their local
project key; no operator provider invocation occurred here.

Proposed future controls, not applied by this inspection: monetary reservations
and usage accounting for each API caller, per-account request and concurrency
limits, bounded embedding batches with caching, and explicit approval before
opening either hosted route. H5c's project split and quota-error handling do not
turn these proposals into implemented Hub monthly caps. No access boundary,
account, permission, template or provider limit is changed by this report.


#### H5b pilot examples - offline drafts, not Marketing-reviewed

These examples are taken from the pinned package. Completion counts and receipts are recorded separately after guarded import. Thai source spelling is preserved.

**BNA7**

| Thai source | English draft |
|---|---|
| รร.คอนคอร์เดียน | Concordian School. |
| MRT ศรีเอี่ยม | MRT Si Iam |
| รร.นานาชาติไทย-สิงคโปร์ | Thai-Singapore International School |
| รพ.ไทยนครินทร์ | Thainakarin Hospital |
| BTS บางนา | BTS Bang Na |

**B_PO**

| Thai source | English draft |
|---|---|
| ตลาดสดเตาปูน | Tao Poon Fresh Market |
| ถนน ทหาร ถนน สามเสน | Thahan Road, Samsen Road |
| โรงเรียนราชินีบน | Rajinibon School |
| Gateway บางซื่อ | Gateway Bang Sue |
| โรงเรียนโยธินบูรณะ | Yothinburana School |

**B1/5**

| Thai source | English draft |
|---|---|
| มาร่วมค้นหานวัตกรรมใหม่ล่าสุด Green Tech for Life ที่เพิ่มความสะดวกสบายให้การใช้ชีวิตเป็นมิตรกับสิ่งแวดล้อมที่ เสนา แกรนด์ โฮม...บ้านที่สร้างพลังงานความสุขให้ทุกคนในครอบครัว พร้อม 3-Gen Facility | Discover Green Tech for Life, innovations that make environmentally friendly living more convenient at SENA GRAND HOME. Homes designed for family happiness, with 3-Gen Facility. |
| ใกล้มหาวิทยาลัยธรรมศาสตร์รังสิต 17 ก.ม. | Near Thammasat University Rangsit, 17 km. |
| ใกล้มหาวิทยาลัยรังสิต 3.0 ก.ม. | Near Rangsit University, 3.0 km. |
| ใกล้สนามบินดอนเมือง 11.8 ก.ม. | Near Don Mueang Airport, 11.8 km. |
| ใกล้รถไฟฟ้าสายสีแดง สถานีรังสิต 3.0 ก.ม. | Near the Red Line's Rangsit station, 3.0 km. |

FLEXI has no existing job in the inventoried backlog; no example or completion is invented.

#### H5b/H5c owner-confirmed key postflight — passed

The owner reports configuring the API key through a hidden prompt and restarting
`sena-hub-test-api.service` at **04:19:37 UTC / 11:19 Bangkok**, 28 October.
The configured project is **`senaidea-digitalhub-test-assistant`**, service-account
key label **`senaidea-digitalhub-test-assistant-202610`**, with an owner-reported
US$4 monthly limit and restrictions to `gpt-5.4-mini-2026-03-17` and
`text-embedding-3-large`. Project limits and model restrictions are owner
attestations; this postflight made no provider request or dashboard inspection.
All provider project names above use the corrected `senaidea-digitalhub` prefix;
infrastructure service/path names remain their actual existing names.

Receipt `.local/hosted-content-rollout/h5bc-key-postflight-1793161600871.json`
passed the exact TEST migration/target/TLS checks and all **30 protected
fingerprints against the 09:45 H5a baseline**, including every Auth column.
The protected env file is a regular, nonsymlink **`600 root:root`** file.
Presence-only results: **`OPENAI_API_KEY=true` (one setting),
`HUB_MEDIA_OPENAI_API_KEY=false`, `HUB_TRANSLATION_OPENAI_API_KEY=false`**.
No key value was printed, copied, moved or stored in the receipt.

| Non-secret setting | Explicit TEST value | Effective value |
|---|---|---|
| `HUB_ASSISTANT_MODEL` | unset | `gpt-5.4-mini-2026-03-17` (existing code default) |
| `HUB_TRANSLATION_MODEL` | unset | `gpt-5.4-mini-2026-03-17` (existing code default) |
| Knowledge embedding configuration | fixed in existing code | `text-embedding-3-large` |

These effective model choices match the owner's reported restrictions. The API
service is active/running as `sena-hub-api`, with `ProtectSystem=strict` and
`NoNewPrivileges=yes`. Trusted HTTPS health/login returned 200; project, brand,
web changes, llms and website-media endpoints returned 401 with `no-store`.
No signed-in browser was opened, no provider was called, and a second fingerprint
pass found no protected change during the inspection.

The first postflight probe stopped on the **local** checksum-profile inventory
because newly approved migration 79 had not yet been registered there. It is
retained as `h5bc-key-postflight-1793161525756.json`. Adding the canonical 79 entry
to the local profile corrected that metadata prerequisite; the unchanged
read-only checks then passed. **TEST remains at migration 78**; no migration or
service change was executed by either probe. Migration 79 is held for the
combined H5a release as instructed.

#### H5c implementation and gates

The two workers select their key variable explicitly. Image suggestions accept
only `HUB_MEDIA_OPENAI_API_KEY`; E9 accepts only `HUB_TRANSLATION_OPENAI_API_KEY`.
Neither falls back to the API process key. Assistant and embeddings retain
`OPENAI_API_KEY`. Both disposable test launchers scrub every provider-key
variable, including both new names. Developer setup documents variable names
only; no credential file was edited.

The three approved provider spend-limit codes stop image claiming and mark only
image-suggestion jobs `budget_exhausted`, without retry or failed-job completion.
The assistant and knowledge routes return the exact section-E budget messages;
embedding retries are zero. Audits retain bounded caller/state/code information,
without provider payloads or request content. Translation queue behavior is
unchanged apart from key selection. Provider calls in all tests are mocked.

Migration **202610280079_media_provider_budget.sql**, SHA-256
`a439a8af79b26280ace573c084bac71433513b8474fc1b059c1b71f2c0fa2a91`,
adds the image-only state, monthly provider-refusal latch and bounded audit RPCs
using existing roles. It adds no account, capability, template or login.
**Applied locally only**; TEST remains at 78. Local application receipt:
`.local/hosted-content-rollout/h5b-local-migration-1793162958380.json`.
Its verified protected backup is
`.local/backups/h5b-local-migration-79-20261028T044910Z/database-before-batch.dump`,
17,152,742 bytes, SHA-256
`a0518b7348643531ad24a7567561215897dfe930b3dfab8978cfc247a6a9b576`.
All 57 locally present protected tables remained unchanged.

The H5b helper uses the existing operator connection inside the caller's guarded
transaction. It validates source identity/hash/version, glossary, placeholders,
numbers, units, English scope and permission before completion. It preserves
entered/reviewed English and skips stale or conflicting drafts. Existing job
completion is the replay marker; provenance is `offline_batch`. It adds no route,
credential, grant or schema change, and records no provider cost.

| Gate | Exact final result | Ignored evidence under `artifacts/hosted-content-rollout/` |
|---|---|---|
| Full API | 2,129 passed; 11 existing opt-in skips; zero failed | `h5bc-api-final.log` |
| Database and concurrency | 62 checks and 11 Node tests passed | `h5bc-db-full.log` |
| Populated migration upgrade/replay | passed | `h5bc-db-full.log` |
| H1 | 11 protocol and 45 browser tests passed | `h5bc-h1-final.log` |
| Full browser suite, one run | 302/302 passed in 12.0 minutes, including 1280/390 px cases | `h5bc-ui-full.log` |
| Admin typecheck | passed | `h5bc-typecheck.log` |
| Documented offline build | passed | `h5bc-build.log` |
| Focused guards and fixture isolation | 19 and 34 passed | `h5bc-focused-04.log`, `h5bc-isolation.log` |
| Provider-key scrubber | passed | `h5c-scrubber.log` |
| Credential scan of changes and browser bundle | zero matches; no credential files read | `h5bc-provider-scan.json` |

The source seal is `.local/hosted-content-rollout/h5bc-gates.json` (676 source
files). Initial failures remain retained: the first H1 check expected the old
migration inventory; it now checks the exact approved 79 entry. A new offline
test initially leaked its synthetic section fixture into two existing API tests;
the new fixture now rolls back its outer transaction. The original tests and
assertions remain unchanged, and the full API rerun passed. An earlier focused
HTTP test fixture was corrected to use its own client lifetime. No existing test
was skipped, weakened or quarantined.

The full run regenerated `artifacts/hosted-content-rollout/website-review-1280.png`
and `artifacts/hosted-content-rollout/website-review-390.png`; both were visually
inspected. They show the existing synthetic batch-confirmation queue, not an
H5a button or hosted pilot. Screenshots remain Git-ignored.

This is code delivery held for the combined H5a release. It does not implement
or claim the H5a monetary reservation cap, shared image button, hosted worker or
pilot. The missing dedicated worker connection STOP remains in force. There
has been no live image request, provider charge, hosted migration 79 or new
application deployment.

#### H5b guarded execution — completed

All nine local rehearsals passed, including exact replay, and rolled back their
translation writes. Their receipts are
`.local/hosted-content-rollout/h5b-local-rehearsal-<batch>.json`, using the batch
names below. Every rehearsal used its own new protected, verified backup and
preserved all 57 locally present protected tables.

TEST batches then ran sequentially in the approved pilot order, each with a
new protected backup verified by archive inventory and a complete archive read.
Each batch used one guarded transaction, source/permission rechecks, strict
protected comparisons before and after, and a second exact `already_applied`
replay that changed no translation row. No stale or human-English conflict was
encountered. No schema change or new credential was needed for this import.

Receipt paths below are under `.local/hosted-content-rollout/`. Backup directory
paths are under `.local/backups/`; every directory contains
`database-before-batch.dump` and its checksum receipt.

| Batch | Completed | TEST receipt | Protected backup directory |
|---|---:|---|---|
| `pilot-1-01` — BNA7 | 32 | `h5b-test-apply-1793163573740.json` | `h5b-test-apply-pilot-1-01-20261028T045343Z/` |
| `pilot-2-01` — B_PO / B1/5 | 61 | `h5b-test-apply-1793164082443.json` | `h5b-test-apply-pilot-2-01-20261028T050136Z/` |
| `remaining-01` | 150 | `h5b-test-apply-1793164444542.json` | `h5b-test-apply-remaining-01-20261028T050823Z/` |
| `remaining-02` | 150 | `h5b-test-apply-1793164811393.json` | `h5b-test-apply-remaining-02-20261028T051426Z/` |
| `remaining-03` | 150 | `h5b-test-apply-1793165183323.json` | `h5b-test-apply-remaining-03-20261028T052035Z/` |
| `remaining-04` | 150 | `h5b-test-apply-1793165534997.json` | `h5b-test-apply-remaining-04-20261028T052645Z/` |
| `remaining-05` | 150 | `h5b-test-apply-1793165881701.json` | `h5b-test-apply-remaining-05-20261028T053237Z/` |
| `remaining-06` | 150 | `h5b-test-apply-1793166235240.json` | `h5b-test-apply-remaining-06-20261028T053824Z/` |
| `remaining-07` | 11 | `h5b-test-apply-1793166461323.json` | `h5b-test-apply-remaining-07-20261028T054415Z/` |

Final read-only reconciliation:
`.local/hosted-content-rollout/h5b-final-postflight-1793166543038.json`.
It records and revalidates all 18 local/TEST backup paths, byte counts and
SHA-256 checksums, all nine TEST completions/replays, and all source revisions.
It also contains the full per-project and per-field completion counts. The
package, exports, QA samples, receipts and backups remain Git-ignored.

| Measure | Before | After |
|---|---:|---:|
| Translation jobs, total | 1,090 | 1,090 |
| Completed jobs | 0 | 1,004 |
| Queued jobs | 1,090 | 86 |
| `content_translations`, total | 2,132 | 2,132 |
| Machine drafts | 0 | 1,004 |
| Missing English | 2,132 | 1,128 |
| Newly reviewed English | 0 | 0 |
| Media jobs / media usage records | 0 / 0 | 0 / 0 |

Every imported row has `machine_en` equal to the pinned draft,
`translation_state='machine'`, and `en_from_th_version` equal to the still-current
Thai source version. Existing `entered_en` and `reviewed_en` were preserved;
none of these imports is reviewed. The completed jobs use only the neutral
`offline_batch` method marker and have zero provider attempts. No provider API
was called and no provider-cost record was created.

Skipped/held reconciliation: **zero stale skips**, **64 out of scope** (28 in
the initial inventory and 36 in subsequent source review), and **22 flagged
for source/name review**. Those 86 jobs remain untouched and queued. Flags
include uncertain spelling, incomplete source, missing units and the two held
energy-saving claims. Q75 remains unresolved; no `non_dee` occurrence was found.

| Field | Completed drafts |
|---|---:|
| `commercial_type.description` | 8 |
| `commercial_type.public_name` | 271 |
| `facility.display_name` | 30 |
| `place.name` | 579 |
| `section.concept_detail` | 35 |
| `section.concept_name` | 44 |
| `section.project_intro` | 37 |

All **58 protected tables** are unchanged through the complete TEST operation.
The original **30-table H5a baseline**, including every Auth column, also
matches strictly: no exclusion or accepted drift was used. All existing content
and human edits, account/permission state, glossary, candidates, reviews, assets
and bindings remain intact.

Read-only smoke receipt
`.local/hosted-content-rollout/website-database-postflight-1793166543514.json`
passed the exact migration prefix **78**, BNA7/content/workspace/website-source
reads as the non-bypass runtime role, and missing-actor denial. Counts remain
82 projects, 33 brands, 278 REM identities, 118 groups, 20,389 candidates,
3,131 assets, 3,573 links, 30 facilities, 594 places, 374 contacts, 140 media
links, 273 commercial drafts, 52 disclosures and 426 FAQ clusters. All 3,421
website suggestions remain pending; website assets retain pending rights and
`needs_review`. There are zero published pages, zero page-policy exceptions,
and `sena_h_approved=false`.

No hosted browser session was opened during this work. The earlier key/VPS
postflight receipts remain valid and separately recorded above; there was no
application deployment. Application rollback paths remain
`/srv/sena-hub-test/releases/953a152-content-4eb69b56f5b2` and
`/srv/sena-hub-test/releases/794d9cd-perf2-e78be5d8bee9`; database rollback
evidence is the protected per-batch dumps above. No restore or R2 change ran.

New Thai saves continue to create waiting E9 jobs. No hosted translation worker
was installed. E9 still has request/output bounds and zero client retries, with
no Hub monthly monetary ledger; its dedicated key is absent and its approved
project allocation is US$0. H5c deployment and the remaining H5a implementation
are held. **STOP remains: IT must provision the dedicated nonprivileged worker
database connection in the existing protected location.** No login, grant or
connection was created here, and no image pilot or other live image batch ran.

Closing credential-pattern scan passed with **zero matches across 114 changed
source/browser files**, covering all three provider-key variable names and
opening no credential file. Receipt:
`artifacts/hosted-content-rollout/h5bc-provider-scan-final.json`.
Whitespace validation passed. The approved local credential files and all
receipt/screenshot paths remain ignored; they are not part of this commit.

#### Owner decision H5d — 28 October 2026

**H5d  Clean offline name drafts; freeze migration 79; explain missing-English rows.**

Clean only untouched H5b imports: state `machine`, exact pinned package-v2
English, no entered/reviewed English and unchanged Thai source version. Scope:
`place.name`, `facility.display_name`, `commercial_type.public_name`; include
`section.concept_name` only for a single short name/tagline, never paragraphs
or multi-sentence text. Remove one trailing period and trailing/doubled spaces;
retain real abbreviation endings such as `Co.`, `Ltd.` and `St.`; change `km.`
to `km`. Change no wording, case or name. Preserve machine state, source version
and `offline_batch`. Keep the original drafts plus per-row before/after values
in a new checksum-pinned ignored package and receipt. Use local rehearsal, a
fresh verified protected backup per write batch, strict protected comparisons,
one guarded transaction and exact no-op replay. Add helper QA rejection and
tests for cleanup, abbreviations, edited/reviewed skips and replay. Report counts
per field, every skip reason and ten examples. STOP if more than 5% are skipped
or item 1 requires schema changes.

Migration `202610280079_media_provider_budget.sql` is frozen at its committed,
locally applied checksum. Remaining H5a schema uses **80**, replacing H5a's old
next-number instruction. TEST receives 79 and 80 only with the combined H5a
release. Confirm the deployment guard enforces this and explain its mechanism.

Read-only inventory must explain the 1,128 missing-English rows versus 86 queued
jobs by owner, field, project, English registry requirement and reason for no
job. List every remaining BNA7/FLEXI must-have field with and without a job.
Propose gap filling and await an owner decision; do not enqueue or fill it.
List the five concept-name rows whose Thai source exceeds 120 characters for
Marketing review, including project and row reference. Do not move or rewrite
their content. Earlier safety rules and the no-provider-call rule remain.

#### Owner decision H5e — 28 October 2026

**H5e  Dedicated media-worker login through the migration runner, and a separate worker env file.**

The owner resolves the missing worker-connection STOP: the owner operates TEST,
so no IT request is required. Exactly one new credential location is approved:
`/etc/sena-hub-test/media-worker.env`, regular, nonsymlink, `0600 root:root`,
loaded only by the worker systemd unit. API/admin must not load it. It contains
only `HUB_MEDIA_WORKER_DATABASE_URL` (release operator writes without printing)
and `HUB_MEDIA_OPENAI_API_KEY` (owner later supplies through a hidden prompt).
Non-secret settings may be in the unit or file. Check API-file absence of both
variables using presence flags only. List all worker settings; STOP before
granting any other required secret, including R2 image access, and report the
narrowest option. No other new credential location is approved.

Provision `hub_media_worker_login` only through
`scripts/supabase-test-migrations.mjs`: LOGIN, NOINHERIT, NOSUPERUSER,
NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, CONNECTION LIMIT 2.
Grant only CONNECT and membership of `hub_media_worker` with admin false,
inherit false and set true. Generate at least 32 base64url characters into the
existing ignored `.env.supabase-test` as
`HUB_SUPABASE_TEST_MEDIA_WORKER_PASSWORD`; only its SCRAM verifier enters SQL.
Runner guards must allow exactly the two approved login roles and their exact
memberships. API runtime cannot assume the worker role; worker login cannot
assume any other Hub role. Use direct or Session pooler port 5432 with
verify-full TLS and existing CA; never the transaction pooler.

Continue H5a with frozen 79 and new 80: shared per-image button using the UTF-8
owner strings, monthly cap/price table and hardened sequential image-only
worker. Deploy 79, 80, login, worker unit/file and H5c together using verified
backups per write batch, strict protected fingerprints, retained rollback and
smokes. Back up the new file with the existing protected configuration procedure.
Keep AI controls disabled without the media key. **Do not run the pilot. STOP
after deployment for the owner to configure that key.**

Mock-provider checks must prove API environment isolation, exact role boundaries,
image-only claims and no queue draining, secret-free logs/audits/receipts/browser
bundle, and scanning coverage of the new variable names. Add a short docs/27
Hosted env files table: path, loading unit, variable names only, maintainer and
rotation (edit that one file, restart only that unit, read-only postflight).
STOP on any other missing credential, protected account/permission/Auth change
beyond the approved worker login, other process access to the worker env file,
or a docs/41 section-6 condition. Commit to main when complete.

#### H5e prerequisite STOP — private image access

Read-only source inspection found that `media_worker.resized_image` refuses an
R2 original unless an explicitly authorized reader is injected. `R2Assets`
requires an access key and secret from the existing protected storage config;
its interface supports both reading and uploading. The approved two-setting
worker env and database login do not supply an image reader. No R2 credential
has been read, copied or granted, and no login, password, service or env file has
been provisioned by this slice.

Narrowest proposed option: a private Unix-socket image broker in the existing
API process, using its existing R2 reader. The worker would submit only its
already-issued image-job ID and lease; the broker would also require the
dedicated worker OS identity, revalidate the live image lease/current revision
and eligibility, and return only checksum-verified, resized image bytes. No
object-key input, public route, general file API, persistent broker credential,
R2 grant or worker access to API secrets is proposed. Broker calls would not
call a provider or claim/finish jobs. Database roles remain separate. This
option awaits the owner's access-boundary decision before implementation or
grants. H5d cleanup and its read-only inventories can proceed independently.

The current generic migration runner is **not yet a combined-release guard**:
its recorded-79 checksum/inventory checks alone still permit `--apply` at 78.
This is a guard gap, not a confirmation of protection. H5d will add a fail-closed
hold before any hosted operation; no migration is being applied now. The
existing `.local/` batch operators separately assert TEST is exactly at 78.

The owner subsequently **approved the private broker**, with these conditions:
Unix socket only, never TCP or a proxied HTTP route; a systemd RuntimeDirectory,
socket `0660`, group containing only the worker user, and `SO_PEERCRED` peer UID
verification. Runtime may validate a lease read-only but must never claim,
finish or assume the worker role. Enforce input, decompression-pixel and timeout
limits; return resized JPEG only. Audit every fetch without image content.
Fetch before any provider attempt: broker failure leaves the job waiting with
zero provider attempts and no charge. Test wrong UID, expired/foreign lease,
stale revision, ineligible asset and absence of an HTTP route. This approval
resolves the private-image access STOP above without a new secret or R2 grant.

#### H5d/H5e STOP — new protected Auth timestamp drift

The first H5d read-only preflight stopped before the translation inventory:
`.local/hosted-content-rollout/h5d-inventory-1793170151910.json`. The 35 protected
tables checked before `auth.users` still match the final H5b receipt. The Auth
fingerprint does not. The remainder of the inventory was not executed, and no
broader claim of unchanged protected state is made.

Two read-only diagnostic receipts are retained:
`.local/hosted-content-rollout/h5de-auth-stop-1793170247262.json` and
`.local/hosted-content-rollout/h5de-auth-stop-1793170343455.json`. The verified
last H5b backup was compared in memory; no Auth value or timestamp was logged.
Results: user count **1 to 1**, schema unchanged, generated column unchanged,
and **only `auth.users.updated_at` changed**. Every other Auth column matches.
**Matches a session/token refresh within 5 seconds: yes.** The Auth audit log
is empty. **Cause: unknown**; correlation alone is not proof of the cause.

The original baseline comparison is retained unchanged and failed. H1a's
earlier scoped exception does not authorize accepting this new drift. An owner
decision is pending to accept only the observed timestamp change as a fresh
H5d/H5e checkpoint, after signed-in hosted Hub tabs are closed without signing
out. The proposed resumed check remains strict on every Auth column, including
`updated_at`, and on every other protected table; no default exclusion is
proposed.

No name cleanup, translation write, migration, database login, password, grant,
worker env file, service or deployment has run in this slice. No provider call
was made. Migration 79 still matches both committed and locally applied
SHA-256 `a439a8af79b26280ace573c084bac71433513b8474fc1b059c1b71f2c0fa2a91`.
Its new combined-release guard has not yet been implemented: the gap described
above remains explicitly open, and no hosted apply is allowed while stopped.
H5d cleanup, helper tests, gap inventory and Marketing placement list, together
with H5e implementation/gates/deployment and docs/27's maintenance table, remain
pending this protected-state STOP.

#### Owner decision H5f — scoped acceptance, 28 October 2026

The owner confirms that a signed-in hosted Hub tab was open after the H5b
postflight, all signed-in hosted tabs are now closed, and no sign-out occurred.
For **H5d and H5e only**, the owner accepts the single `auth.users.updated_at`
difference against the H5b backup, on the verified basis of the unchanged user
count and every other Auth column and its session-refresh correlation. Take
a fresh read-only capture of all protected fingerprints as the new baseline.
Keep every Auth column strict from that baseline; any further Auth difference
is a new STOP. Resume H5d first, including the fail-closed combined-release
guard preventing 79 alone, then H5e with the approved broker conditions.
Commit the pending docs/46 records on resumption.

Fresh read-only capture **passed**:
`.local/hosted-content-rollout/h5f-protected-baseline.json`. All **58 protected
tables** and the original **30-table projection** were captured and checked
again in a fresh snapshot. Compared with the H5b checkpoint, the accepted Auth
timestamp is the only difference; all non-Auth tables match. The new baseline
includes **every Auth column, including `updated_at`**, with no exclusions.
The prior failed comparison and both STOP diagnostics remain unchanged.
This capture made no hosted write. Migration 79 remains frozen; TEST is at 78.

#### H5d read-only gap inventory and Marketing review list

Read-only receipt: `.local/hosted-content-rollout/h5d-inventory-1793171749566.json`. All 58 protected fingerprints match
the strict H5f baseline before and after this inventory. No jobs, sources or
translations were created or changed by the inventory.

Of 1,128 metadata rows in `missing`, 86 have current queued jobs and **1,042
have no current job**. Every one of the 1,042 has English in `locales_required`.
That locale requirement differs from whether a field is required, recommended
or optional for a particular publication.

| Owner | No-job rows | Explanation |
|---|---:|---|
| commercial_type | 536 | 263 descriptions and 273 highlights have empty Thai sources. |
| facility | 90 | Description, location label and opening hours are empty on 30 facilities. |
| disclosure | 416 | 364 fields have empty Thai; 52 nonempty notes are excluded by the Legal translation policy. All 416 disclosure fields are outside E1 offline translation. |

The primary reason is empty Thai for **990** rows and policy exclusion for
**52** nonempty notes. The 364 empty disclosure fields have both blockers.
`hub.sync_content_translation` records empty localized metadata, but enqueues
only nonempty Thai with an authorized actor and allowed field/source. This
explains these groups without treating an absent job as lost provider work.

| Field | Rows without a job | Publication registry | Source / translation policy |
|---|---:|---|---|
| `commercial_type.description` | 263 | required | Empty Thai; E1 marketing field |
| `commercial_type.highlights` | 273 | recommended | Empty Thai; E1 marketing field |
| `disclosure.bank` | 52 | optional | Legal; no E1 translation (empty Thai except notes) |
| `disclosure.building_description` | 52 | required | Legal; no E1 translation (empty Thai except notes) |
| `disclosure.legal_project_name` | 52 | required | Legal; no E1 translation (empty Thai except notes) |
| `disclosure.location_text` | 52 | required | Legal; no E1 translation (empty Thai except notes) |
| `disclosure.managing_director` | 52 | required | Legal; no E1 translation (empty Thai except notes) |
| `disclosure.notes` | 52 | optional | Legal; no E1 translation (empty Thai except notes) |
| `disclosure.owner_address` | 52 | required | Legal; no E1 translation (empty Thai except notes) |
| `disclosure.owner_company` | 52 | required | Legal; no E1 translation (empty Thai except notes) |
| `facility.description` | 30 | recommended | Empty Thai; E1 marketing field |
| `facility.location_label` | 30 | recommended | Empty Thai; E1 marketing field |
| `facility.opening_hours` | 30 | recommended | Empty Thai; E1 marketing field |

All project/reference IDs below remain exact text. Full row references and
reason flags are in the ignored receipt.

| Project/reference | No-job rows |
|---|---:|
| `00101` | 8 |
| `00300` | 10 |
| `00401` | 10 |
| `00500` | 2 |
| `00601` | 10 |
| `00602` | 10 |
| `01301` | 14 |
| `01501` | 10 |
| `01800` | 6 |
| `10301` | 14 |
| `20100` | 4 |
| `20202` | 2 |
| `70101` | 12 |
| `70103` | 4 |
| `70401` | 16 |
| `70502` | 4 |
| `70503` | 12 |
| `70504` | 12 |
| `80201` | 16 |
| `AQ` | 18 |
| `B1/5` | 7 |
| `B1/7` | 6 |
| `BGTHT` | 18 |
| `BNA6` | 42 |
| `BNA7` | 33 |
| `BPHF3` | 12 |
| `BPHGH` | 6 |
| `BPSK1` | 12 |
| `BPSK2` | 12 |
| `BPSN` | 6 |
| `BPU` | 12 |
| `B_PO` | 42 |
| `CBDC1` | 8 |
| `CHA14` | 34 |
| `CHOMT` | 28 |
| `F9SV5` | 4 |
| `FGL70` | 27 |
| `FISUK` | 20 |
| `K1AB` | 16 |
| `K1P48` | 31 |
| `K2KH2` | 8 |
| `K4LPT` | 14 |
| `K9BK3` | 14 |
| `K9BK4` | 3 |
| `K9PG` | 14 |
| `KBDF4` | 14 |
| `KUBON` | 27 |
| `LADK2` | 14 |
| `LADKB` | 12 |
| `LIFIS` | 20 |
| `LP107` | 30 |
| `NUSA` | 41 |
| `ONUT1` | 18 |
| `PCHAO` | 46 |
| `PH7/1` | 4 |
| `RAM9A` | 20 |
| `RAMK` | 28 |
| `RTF6` | 18 |
| `SAMRG` | 18 |
| `SKHPT` | 16 |
| `SLYA` | 4 |
| `SNHP2` | 39 |
| `SRKIT` | 16 |
| `TRAK1` | 12 |
| `VELA` | 10 |
| `VELAP` | 2 |
| `VIVA` | 10 |

**Pilot publication blockers, including absent metadata.** FLEXI is existing
brand reference `25`, public ID `brd_64325839308d4e479d7f5b7d0bf4ca71`.
Legacy project/brand rows predate the translation trigger and were not
backfilled; unlike the website-created child drafts, their required fields can
have neither translation metadata nor a job. Raw English alone is not the E9
review record. These additional absent rows are not part of the 1,042 count.

| Pilot | Must-have field | English/job state |
|---|---|---|
| BNA7 | `project.public_name` | Thai/raw English present; no metadata or job; E9 review missing. |
| BNA7 | `project.address` | Thai present; English absent; no metadata or job. |
| BNA7 | `project.ad_disclaimer` | Thai/English absent; no metadata or job; Legal-owned completion needed. |
| BNA7 | `section.project_intro` | Machine English/job done; Marketing review still required. |
| BNA7 | `section.selling_summary` | Section/source absent; no metadata or job. |
| BNA7 | `section.concept_name` | Section/source absent; no metadata or job. |
| BNA7 | `commercial_type.public_name` (11) | Machine drafts/jobs done; Marketing review still required. |
| BNA7 | `commercial_type.description` (11) | Empty Thai; English missing; no jobs. Exact unit references below. |
| BNA7 | `disclosure.building_description`, `legal_project_name`, `location_text`, `managing_director`, `owner_address`, `owner_company` | Six required fields on disclosure `10edab79-d4e2-565a-9a0a-d72830c1d21d`; empty Thai/English, no jobs; outside E1. |
| FLEXI | `brand.public_name` | Thai/raw English present; no metadata or job; E9 review missing. |
| FLEXI | `brand.description` | Thai/English absent; no metadata or job. |

The effective BNA7 project-readiness result explicitly flags the six direct
project/section fields listed above. The required child-field rows are also
listed rather than being hidden by the missing-metadata distinction.

| BNA7 unit row: `commercial_type.description` | Job |
|---|---|
| `c4d54b12-5e96-5b0b-bae8-221b39e30545` | none; Thai empty |
| `d3a38e87-5878-50bd-a9f8-da4421b2a78d` | none; Thai empty |
| `d88a27b1-5298-5786-9c07-e4707542a1e2` | none; Thai empty |
| `caf2c36f-2362-5174-8b32-9a09f7796920` | none; Thai empty |
| `4e3debd1-20b2-579d-a6b1-b72537fc9895` | none; Thai empty |
| `211fad64-5685-5555-a905-55606ac281b3` | none; Thai empty |
| `52669bf0-2c6c-53f1-a4cf-0a30005d8cbb` | none; Thai empty |
| `11458454-167e-51be-b55f-a141e67228b8` | none; Thai empty |
| `35d5b257-fc22-5ee1-a72e-81aeb03f86aa` | none; Thai empty |
| `4d0b8106-c698-5db9-891f-0b1a03e682dc` | none; Thai empty |
| `840bc44f-b89e-54c4-87cc-e2f346ce0db0` | none; Thai empty |

BNA7 also has 34 `missing` metadata rows: 11 descriptions, 11 recommended
highlights, eight disclosure fields, three recommended facility fields and one
recommended place name. The place name has a queued held job; the other 33
have none. Recommended project meta title/description have Thai but no English
or metadata/job. Eighteen place names, one facility name and one concept detail
have machine drafts pending Marketing review. FLEXI has no translation metadata
or queued job; this is not evidence that its required English is complete.

**Proposed follow-up — awaiting owner decision, not executed.** Marketing first
supplies missing Thai/evidence or reviews field applicability; no empty source
can be translated. Inventory and backfill only eligible current nonempty
project/brand/section sources through the existing translation structures, with
the same protected backups and replay guards, then use an approved further
offline batch. Preserve existing entered/raw English and route it to Marketing
review instead of replacing it. Legal completes disclosure/advertising English
outside E1; do not enqueue those fields. Review the 86 existing holds before
any further completion. This task does not change the queue or review state.

**Marketing placement review only.** The five concept-name Thai paragraphs are
listed below. No text, placement or source row was moved or rewritten.

| Exact project ID | Section owner key | Version row reference | Thai characters |
|---|---|---|---:|
| `00101` | `793806da-c914-456e-840f-7935e69dc156` | `164012cd-f0da-4068-b0d2-111e35b7c25b` | 192 |
| `BPSN` | `15461dad-3b2f-44e9-99cd-1f1b40360530` | `cf9fc2a9-3251-4d67-8850-ba73913a499b` | 233 |
| `70502` | `a4da547a-2865-45af-a46f-70ab8169c610` | `29f5d4f4-48f9-4946-875e-e3f4ca3f5dcd` | 248 |
| `AQ` | `87f3a12a-6472-41ed-996d-e151d50b70ff` | `398c4bb6-16da-43e6-b5fb-218e27fa307c` | 223 |
| `K9PG` | `36784830-3234-4307-bfbf-2e5047ffd226` | `a4bbbd57-6bb7-4496-a6c1-5703b22595e9` | 361 |

The name-cleanup package separately excludes those five long concepts, one
multi-sentence concept and one intentional ellipsis tagline; it does not turn
an ellipsis into two periods. Only the 200 reviewed punctuation-only deltas
are selected for the guarded cleanup.

Manual review additionally retained `25 SQ.M.` as a genuine unit abbreviation.
The preliminary 201-row package remains retained and superseded; no writes used
it. The current 200-row package is
`.local/offline-translation/h5d-20261028T073713Z/package.json`, SHA-256
`2fb552ab1df7510efb9422a9a133a19e762fccfa8c5cdd9d7dfa7ca63b446d14`.

#### H5d guarded cleanup result and new H5f STOP

The pinned 200-row cleanup passed local rehearsal, including exact replay and
rollback, then committed on TEST in one guarded transaction. **Changed: 181
`place.name`, nine `commercial_type.public_name`, ten short
`section.concept_name`, zero `facility.display_name`; skipped: zero (0%).**
All original 1,004 job drafts and `offline_batch` markers are retained. Only
the selected machine English, metadata revision and normal audit-touch columns
changed; state remains `machine`, source versions and `en_from_th_version` are
unchanged, and no entered/reviewed English was overwritten. Replay returned
`already_applied` with no row change. No schema or provider call was needed.

Receipts: `.local/hosted-content-rollout/h5d-local-rehearsal.json`,
`.local/hosted-content-rollout/h5d-test-1793175754150.json`, and
`.local/hosted-content-rollout/h5d-postflight-1793175821872.json`. The postflight
snapshot verified all 1,004 originals, all cleaned values and 58 strict H5f
fingerprints; jobs remain 1,004 done and 86 queued. Every missing-English gap
and Marketing placement item in the read-only report above is unchanged.

| Protected verified backup | Bytes | SHA-256 |
|---|---:|---|
| `.local/backups/h5d-local-rehearse-20261028T081144Z/database-before-batch.dump` | 17,157,443 | `440f1714112add8a0084a66469487556bb900de6e642606898e3e5f3d97a6b68` |
| `.local/backups/h5d-test-apply-20261028T081708Z/database-before-batch.dump` | 16,972,178 | `04b7e509718094c80cc6ff59ecea24e7349afcc9946d7c2e7dd5eac90e9f7383` |

Each backup passed inventory and a complete archive read; its directory ACL
allows only the operator and SYSTEM. The local rehearsal reconstructed the
pinned prior H5b state only inside its rolled-back transaction. All local
translation fingerprints matched after rollback. All 58 protected tables
matched H5f before/after the TEST write and its exact replay.

| Field / project | Original draft | Cleaned machine draft |
|---|---|---|
| `place.name` / `BNA7` | Concordian School. | Concordian School |
| `place.name` / `BNA7` | Bangna1 Hospital. | Bangna1 Hospital |
| `place.name` / `BNA7` | Sikarin Hospital. | Sikarin Hospital |
| `place.name` / `B1/5` | Near Thammasat University Rangsit, 17 km. | Near Thammasat University Rangsit, 17 km |
| `place.name` / `B1/5` | Near Rangsit University, 3.0 km. | Near Rangsit University, 3.0 km |
| `place.name` / `B1/5` | Near Don Mueang Airport, 11.8 km. | Near Don Mueang Airport, 11.8 km |
| `place.name` / `B_PO` | Bang Pho Hospital. | Bang Pho Hospital |
| `place.name` / `B_PO` | Saint Gabriel's College. | Saint Gabriel's College |
| `place.name` / `B1/5` | Near the Red Line's Rangsit station, 3.0 km. | Near the Red Line's Rangsit station, 3.0 km |
| `place.name` / `B_PO` | Pracha Rat Sai 2 Road. | Pracha Rat Sai 2 Road |

`25 SQ.M.` remains unchanged as a real abbreviation. The 15 held place rows
outside H5b imports remain untouched. The seven concept exclusions described
above are outside the selected cleanup scope, not edited-row skips.

**Fail-closed migration hold implemented.** The current documented runner
rejects canonical migrations 79 and later at both `runMigrations` and exported
`applyMigration`, before any SQL is issued. There is no CLI/environment bypass.
Only the existing real disposable H1 connection on loopback port 55434 with
database `hub_hosted_test_simulation` and a loopback peer is exempt. Unit checks
cover both entry points, the remote target and a loopback connection with the
wrong database, proving zero SQL calls. H5e must add admission for the complete
79/80 bundle while preserving the standalone hold. Frozen migration 79 and its
registered checksum are unchanged. TEST is still at 78.

| Gate | Final result | Evidence under `artifacts/hosted-content-rollout/` |
|---|---|---|
| API | 2,132 passed; 11 existing opt-in skips; zero failed | `h5d-api-final.log` |
| DB/concurrency and Node | 62 checks plus 11 Node tests passed | `h5d-db-full.log` |
| H1 | 12 protocol plus 45 browser tests passed | `h5d-h1-full.log` |
| Full browser suite, one run | 302/302 passed in 12.3 minutes | `h5d-ui-full.log` |
| Typecheck / offline build | passed | `h5d-typecheck.log`, `h5d-build.log` |
| Focused helper / runner | five helper tests and ten runner checks passed | `h5d-focused.log`; runner test output |
| Credential-pattern scan | final scan: zero matches in 92 source/browser/report files; no credential file read | `h5d-provider-scan-final.json` (prior scan retained as `h5d-provider-scan.json`) |

Source seal: `.local/hosted-content-rollout/h5d-gates.json`, 676 files. The
initial full API pass preceded the final abbreviation refinement; it is
retained as `h5d-api-full.log`. The full API gate was rerun on the corrected
rule and passed. No existing test was weakened or skipped. Existing synthetic
website queue screenshots remain ignored at
`artifacts/hosted-content-rollout/website-review-1280.png` and
`artifacts/hosted-content-rollout/website-review-390.png`.

**New STOP after H5f.** A subsequent fresh read-only smoke found Auth no longer
matching the fresh H5f baseline. The first legacy smoke still used the old
checkpoint (`website-database-postflight-1793175815872.json`); its failure was
initially attributed to the accepted old drift. That attribution was premature.
A separate H5f-scoped smoke also failed
(`h5f-website-database-postflight-1793175882693.json`), and direct check
`h5f-auth-check-1793176013228.json` established a **new** difference. All failed
receipts and both original baselines are retained without modification.

Read-only diagnostic
`.local/hosted-content-rollout/h5f-new-auth-stop-1793176135392.json` compared
Auth in memory with the verified fresh H5d backup, which matched H5f. User
count remains **one**, schema/generated columns match, and **only
`auth.users.updated_at` differs**. All other 57 protected tables match H5f;
the complete translation state still matches the successful cleanup.
**Matches a session/token refresh within five seconds: yes. Cause: unknown.**
The Auth audit log is empty. No Auth value or timestamp was logged.

H5f authorized only the earlier difference and explicitly makes any further
Auth drift a new STOP. No new baseline has been accepted or captured. No
further hosted write or H5e implementation/deployment is permitted pending
the owner decision. The broader runtime/publication smoke is not claimed
complete under the new baseline. No login, grant, password or worker env file
has been created; migration 80 has not been written or applied. No provider
call, image job, pilot, rights approval or publication ran.

The owner also supplied the two budget-label strings and ledger-only two-decimal
format in the existing UTF-8 file. It has 108 combining marks and no replacement
characters; the A-C correction above is synchronized exactly, while H5a's
verbatim block remains unchanged. H5e will use those strings on resumption.

#### Owner decision H5g — 28 October 2026

Owner decision H5g, 28 October 2026. The second auth.users.updated_at drift (between the passing H5d postflight and the failing H5f smoke) is attributed to a still-live session of the only Auth user refreshing itself; the browser client auto-refreshes tokens. I have now signed out from the hosted Hub with a global sign-out, which revokes every refresh token for that account, and closed the tab. I will not sign in to hosted TEST again until you STOP after the H5e deployment.
For H5e only, accept against the fresh H5d backup: (a) the observed auth.users.updated_at change, and (b) the changes caused by this sign-out, limited to session and refresh-token rows of that one user being removed or revoked and that user's updated_at. Verify read-only that the user count is unchanged, every other auth.users column matches, no new Auth row exists and all non-Auth protected tables match. If anything else differs, STOP.
Then take a fresh read-only baseline of all 58 protected tables, strict on every Auth column with no exclusions. After a global sign-out nothing should be able to refresh, so any further Auth difference is a real STOP: report it with its time window and do not ask for another timestamp acceptance.
Resume H5e as decided, with the approved broker conditions and the 79/80 bundle admission that keeps the standalone hold. Commit the docs/46 records.

#### H5g read-only verification — STOP on session-claim cascade

Receipt: `.local/hosted-content-rollout/h5g-stop-1793183201011.json`.
Inspection window: **28 October 2026, 10:26:11–10:26:41 UTC
(17:26:11–17:26:41 Bangkok)**. The comparison used the verified fresh H5d
backup at `.local/backups/h5d-test-apply-20261028T081708Z/database-before-batch.dump`,
whose SHA-256 still matches the H5d receipt. Auth rows were reconstructed and
compared in memory; no Auth values, token values or Auth timestamps were
printed or saved. No hosted write or provider call was made.

| Check against verified H5d backup | Result |
|---|---|
| Auth users / identity | One before and after; same identity |
| `auth.users` columns | Only `updated_at` differs; every other column matches, including generated `confirmed_at` |
| `auth.sessions` | Three before, zero after; three removed, no new or edited rows |
| `auth.refresh_tokens` | 25 before, zero after; 25 removed, no new or edited rows |
| Live sessions / unrevoked refresh tokens | None remain |
| Additional Auth change | **Three `auth.mfa_amr_claims` rows removed; zero new or edited rows** |
| Session-claim relationship | All three prior claim rows belonged to the sole user's prior sessions; FK is `FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE` |
| All other Auth tables | Match; 27 Auth tables compared in total, no new Auth row found |
| Protected content / permissions | All 57 non-Auth protected tables match; all 58 protected tables inspected |
| Completed H5d translations | Match the successful cleanup receipt |

The removed session claims are consistent with the global sign-out's session
deletions and the inspected cascade constraint. They are nevertheless outside
H5g's explicit acceptance, which is limited to session/refresh-token rows and
the user's `updated_at`. H5g says to STOP if anything else differs. **H5e
therefore remains stopped.** No new H5g baseline was accepted or written;
the H5f baseline, fresh H5d backup and previous failed comparisons are retained.
The owner must decide the treatment of these three cascade-deleted claim rows
before a strict H5e baseline can be established. This finding does not request
another timestamp exception or weaken any future strict Auth check.

Earlier read-only diagnostic receipts are retained:
`h5g-stop-1793183019951.json`, `h5g-stop-1793183042043.json` and
`h5g-stop-1793183084228.json` stopped on the diagnostic's handling of generated
Auth columns, before any state comparison; the helper was corrected to
reconstruct populated generated columns and compare empty tables as empty.
`h5g-stop-1793183128665.json` first identified the claim-table difference;
the final receipt above completes the remaining comparisons. These diagnostic
failures made no hosted changes and did not create a baseline.

Migration 79 remains frozen and blocked from standalone hosted application;
TEST remains at the previously recorded migration 78 (not revalidated by this
Auth-only diagnostic). No schema 80, worker login, grant, password, worker env
file, broker, service or deployment was created. No code changed, so no new
code gate run was needed for this documentation-only checkpoint.

#### Owner decision H5h — 28 October 2026

Owner decision H5h, 28 October 2026. Record it in docs/46 directly after the H5g session-claim cascade STOP, then carry it out. It resolves that STOP and replaces per-incident Auth acceptances from now on. H1a, H5f and H5g stay as historical records.

H5h  Protect Auth identity strictly; record Auth activity instead of stopping on it.

0. Why
Session refreshes rewrite auth.users.updated_at, and a sign-out deletes session, refresh-token and session-claim rows by cascade. A whole-row Auth fingerprint stops work on each of these, although none of them changes who a user is or what they may do. Any real identity change also changes an identity column. UAT will add more sign-ins and sign-outs, so this needs a standing rule.

1. Prevention (the real guarantee)
- Add a static check to the release gates: reject any migration numbered 80 or later, and any script under scripts/ that issues SQL, if it writes to the auth schema: INSERT, UPDATE, DELETE, TRUNCATE, COPY, or CREATE/ALTER/DROP/GRANT/REVOKE on auth objects, including triggers on auth tables. Reads such as auth.uid() and auth.jwt() stay allowed.
- Inventory migrations 1-79 with the same check. Do not edit them. Report every match with its number and statement kind; frozen migrations stay as they are, matched by their registered checksums.
- Add a read-only postflight check: hub_runtime, hub_media_worker, hub_media_worker_login and every Hub actor role have no INSERT, UPDATE, DELETE or TRUNCATE on any auth table and no ownership of auth objects. Existing read access stays as already approved.

2. Split Auth comparison
Activity (record, do not STOP):
- auth.users.updated_at and auth.users.last_sign_in_at;
- rows added, changed or removed in auth.sessions, auth.refresh_tokens, auth.mfa_amr_claims, auth.flow_state and auth.audit_log_entries.
Strict (any difference is a STOP, as today):
- auth.users row count and ids, and every other auth.users column, including email, phone, encrypted_password, role, aud, raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous, banned_until, deleted_at, all confirmation/recovery/email-change/phone-change/reauthentication tokens and their sent_at columns, and generated columns;
- every other Auth table (of the 27 compared in H5g), including auth.identities, auth.mfa_factors, auth.one_time_tokens and any SSO/SAML tables;
- the Auth schema shape (tables, columns, generated columns, constraints). A new Auth table is strict until I classify it.
Rules:
- An activity row whose user id or session id does not resolve to an existing user or session (an orphan), or a new auth.users row, is a STOP.
- Each receipt lists all Auth tables with their class, and for activity records only which columns or tables changed, row-count deltas and the orphan check result. Never record values, tokens, timestamps, IP addresses or user agents.
- Every non-Auth protected table stays fully strict.

3. Attribution (read-only investigation only)
Find out whether Auth events (for example token refresh, login, logout) can be attributed automatically, for example a Supabase setting that writes Auth audit events to the database, or Auth log access. Report the options, what each exposes, and any retention or privacy concern. Do not change any project setting; that is my decision.

4. Applying it now
- Keep every original baseline, failed comparison and STOP receipt unchanged.
- Re-run the H5g comparison against the verified fresh H5d backup under this rule and record the result. Expected: activity only (users.updated_at, three sessions, 25 refresh tokens and three session claims removed by the global sign-out), no orphans, all strict Auth columns and tables and all 57 non-Auth protected tables match. If anything strict differs, STOP.
- Then take a fresh read-only baseline of all 58 protected tables with the new split, and resume H5e as decided, including the approved broker conditions and the 79/80 bundle admission that keeps the standalone hold.
- The H5g promise not to sign in is lifted: sign-ins, refreshes and sign-outs on hosted TEST no longer stop work.

5. Tests
Unit tests for the comparator with synthetic data: updated_at only, last_sign_in_at only, and session, refresh-token or session-claim rows added or removed each pass and are recorded. Each of these STOPs: an email, encrypted_password, role, metadata, banned_until or deleted_at change; a new user row; a new identity or MFA factor; an orphan activity row; a new Auth table. Tests for the static auth-write check: a write statement is rejected, auth.uid() and auth.jwt() pass, a trigger on an auth table is rejected. The privilege postflight fails on a synthetic grant.

6. Records
Add the rule to docs/46 and amend the Auth wording in docs/41 section 6 with a short note pointing to H5h; do not rewrite earlier decisions. This rule covers hosted TEST, including UAT. Production keeps its own decision at go/no-go.

STOP and report on any docs/41 section 6 condition, any strict Auth difference, any Hub role with write access to the auth schema, any existing migration that writes to auth in a way not already recorded, or any other missing credential. No provider calls. Commit to main when done.


#### H5h verification and standing release checks

H5h resolves the prior session-claim STOP. The new immutable baseline is
`.local/hosted-content-rollout/h5h-protected-baseline.json`, SHA-256
`aa6da4d61f0c23d8acc514e54ce1229c1c006ae1c8b9c5a6d044af744cb4b73c`. The verified fresh H5d backup, original baselines, failed
comparisons and all STOP receipts remain unchanged. The capture passed from
10:46:42 to 10:47:34 UTC on 28 October 2026. Only the two classified user
activity columns are excluded from the identity hash; no identity column or
non-Auth protected row is excluded. All 57 non-Auth protected tables match.
The 27-table Auth inventory, generated columns and constraints match the
verified backup, including all strict data. There are no orphan references.

| Auth table | H5h class | Delta vs verified H5d backup | Result |
|---|---|---:|---|
| `auth.audit_log_entries` | activity | 0 | unchanged |
| `auth.custom_oauth_providers` | strict | 0 | strict match |
| `auth.flow_state` | activity | 0 | unchanged |
| `auth.identities` | strict | 0 | strict match |
| `auth.instances` | strict | 0 | strict match |
| `auth.mfa_amr_claims` | activity | -3 | activity changed |
| `auth.mfa_challenges` | strict | 0 | strict match |
| `auth.mfa_factors` | strict | 0 | strict match |
| `auth.mfa_recovery_code_sets` | strict | 0 | strict match |
| `auth.mfa_recovery_codes` | strict | 0 | strict match |
| `auth.oauth_authorizations` | strict | 0 | strict match |
| `auth.oauth_client_states` | strict | 0 | strict match |
| `auth.oauth_clients` | strict | 0 | strict match |
| `auth.oauth_consents` | strict | 0 | strict match |
| `auth.one_time_tokens` | strict | 0 | strict match |
| `auth.refresh_tokens` | activity | -25 | activity changed |
| `auth.saml_providers` | strict | 0 | strict match |
| `auth.saml_relay_states` | strict | 0 | strict match |
| `auth.schema_migrations` | strict | 0 | strict match |
| `auth.scim_tokens` | strict | 0 | strict match |
| `auth.scim_users` | strict | 0 | strict match |
| `auth.sessions` | activity | -3 | activity changed |
| `auth.sso_domains` | strict | 0 | strict match |
| `auth.sso_providers` | strict | 0 | strict match |
| `auth.users` | strict identity activity columns | 0 | strict match; activity column updated_at only |
| `auth.webauthn_challenges` | strict | 0 | strict match |
| `auth.webauthn_credentials` | strict | 0 | strict match |

The read-only privilege postflight passed for 18 existing Hub roles and 486
table/role checks, including column-level INSERT/UPDATE privileges and direct
or inherited ownership of Auth schemas, relations, functions and types.
`hub_media_worker_login` is absent as expected before approved H5e provisioning;
it will be included in the same postflight after creation. No permission,
account, template or Auth row was modified by verification.

Follow-up receipt `.local/hosted-content-rollout/h5h-postflight-1793193789011.json`
passed again during 13:22:34-13:23:09 UTC: every strict comparison still matches,
no additional activity difference and no orphan. The earlier schema diagnostic
`h5h-stop-1793184286932.json` is retained: a complete statement comparison now
proves its only transport difference was an extra `CREATE SCHEMA auth` wrapper
in the fresh dump, not an object-shape change. Original failed output was not
rewritten to passing.

`check:auth-writes` inventories registered checksums as well as SQL. The frozen
1-79 inventory has **zero Auth-write matches**; migration 45's dynamic SELECT
from `auth.users` is a read and remains unchanged. There are no historical
write exceptions to list. New migration 80 and every SQL-capable script under
`scripts/` must pass the gate, invoked by both disposable and H1 runners and
before hosted migration application. Qualified/dynamic literal writes, Auth
search-path writes, Auth triggers/policies, object moves and foreign keys that
would create Auth-side triggers are rejected. `auth.uid()`/`auth.jwt()` pass.
No generic CLI flag or environment switch bypasses the standalone 79 hold.

The old H1 scripts' synthetic Auth writes were moved to
`tests/fixtures/h1-auth.mjs`. It verifies the actual server address, port 55434
and database `hub_hosted_test_simulation` before creating or saving mock rows;
remote targets and a wrong loopback database fail before any write. This is
local test evidence only and grants no hosted Auth-writing route. Runtime
application code still has no Auth-write capability.

Current H5h/runner unit output: 64 passed, zero skipped/failed at
`artifacts/hosted-content-rollout/h5e-runner-unit.log` (including subsequent
H5e admission/SCRAM checks). The earlier H1 run passed 35+3+7 browser cases in
`h5h-h1-verified.log`; its earlier failed attempts are retained. The final
combined H5e gates, deployment and receipts are recorded separately below.

#### Auth event attribution options - read-only investigation

Supabase records sign-in, sign-out and refresh audit actions externally and
can optionally write them to `auth.audit_log_entries`. The dashboard's
Authentication / Audit Logs configuration has a database-write toggle; enabling
it would make future events SQL-correlatable. It consumes database storage and
may expose user identifiers, event times, IP addresses, user agents and metadata.
No automatic database cleanup/retention guarantee was established by this
inspection. The currently empty table does not prove the toggle's setting.
The owner must decide enablement, access and retention; nothing was changed.
[Official Auth audit logging](https://supabase.com/docs/guides/auth/audit-logs).

The existing dashboard Logs interface can filter Auth events and users. Auth
server logs and Auth audit events are distinct sources; either can assist
attribution, subject to recorded events and availability. SQL log queries or
privileged API access are alternatives if an approved credential is already
configured. This task neither obtained a new access token nor downloaded raw
logs. Raw results can contain personal data; retain only action/count and
correlation results in rollout receipts, with no source values.
[Logs interface](https://supabase.com/docs/guides/observability/logs),
[log sources](https://supabase.com/docs/guides/observability/log-field-reference).

Current published Free limits distinguish **one hour for Auth audit logs**
from **one day for API/database logs**. Historical events may already be gone;
external absence cannot establish absence of activity. Database audit storage
needs its own reviewed retention policy. Log drains and longer plan retention
would require a separate owner decision; no plan, setting or export was changed.
[Official plan comparison](https://supabase.com/pricing).

#### H5e implementation contract and held release

| Field | Existing authority and boundary |
|---|---|
| Feature / owner | Per-image marketing suggestions; Marketing requests/confirms, publisher approves rights |
| Tab / V | Existing projects view reads media/job state and the non-secret Hub cap ledger |
| E | Existing projects edit requests one eligible current image revision; one request audit; queued/running/completed same-revision requests are idempotent |
| A / separation | Existing rights and four-eyes publication rules; suggestions never auto-apply or publish |
| Templates / specials / agency | No new capability, template, account grant or agency access |
| Storage | New owner-only FORCE-RLS `hub.media_ai_settings`; no direct application DML; audited bounded RPCs |
| Runtime | API assumes only hub_app; validates broker leases read-only and writes bounded fetch audits, never claims/finishes jobs |
| Worker | Dedicated approved login may assume only hub_media_worker; only image jobs, sequential attempts, no automatic retry after a possibly billed attempt |
| Broker | Systemd Unix socket only, 0660 worker-only group, SO_PEERCRED UID check; bounded original/pixels/time, checksum and revision rechecks, resized JPEG only, one audit per fetch |
| Endpoints | Existing POST media/jobs and GET media/jobs; new GET `/v1/admin/projects/{public_id}/media/ai-state`; no broker HTTP endpoint |
| Shared surfaces | Website queue, library and single-image metadata editor reuse one subdued footer; no RAG, translation or consumer/publication change |
| Release | Frozen 79 plus new 80, complete source/gate/readiness attestation, atomic schema transaction and fresh verified backup, then separately backed-up approved login provisioning |

Price configuration uses the already reviewed snapshot
`gpt-5.4-mini-2026-03-17`: input US$0.75, cached input US$0.075 and output
US$4.50 per million tokens, effective 28 October 2026. A request is bounded
by 48,000 input tokens and 3,500 output tokens: **US$0.051750 maximum reservation**.
The text/schema/wire bound and 768px image bound are checked before attempting
the provider. Month-to-date cost is calculated from stored provider_usage;
unknown billed usage conservatively retains its ceiling. Active reservations
also reduce the available balance. TEST's Hub cap is US$5; other environments
start at US$0. Raising it requires a new owner decision in this document.
The provider project cap remains a separate owner-controlled setting.

Fresh worker leases have zero attempts. Broker/read failure releases the job
back to waiting with zero charge; only after fetch does the worker durably mark
one provider attempt. Expired attempted leases never retry. Lease tokens are
redacted from new media-job audit rows. Translation rows and all other queues
are untouched. The key is intentionally absent; no pilot or live provider call
is authorized in this deployment. The previous release must remain available.

The read-only VPS receipt
`.local/hosted-content-rollout/h5e-vps-readiness-20261028T124701Z.json` confirms
systemd 252, the existing CA, no worker variables in API/admin process envs,
and the retained live release `07dda14-content-82bd4feeade5`. The new worker
user/env/service had not yet been provisioned at that inspection.

#### H5e bundle admission and request semantics

The generic migration CLI and direct single-migration entry point retain the
standalone hold from 79 onward. The separately attested combined entry requires
the exact TEST target/TLS, immutable H5h baseline hash, complete source hashes,
passing gate receipt, Linux build/native broker/unit readiness, absent media
key, and a fully read-verified protected backup no older than 15 minutes.
Only the exact applied prefix 1–78 is upgraded: 79 and 80 commit in one guarded
transaction. A separate fresh post-schema backup precedes worker-login
provisioning through the same runner. Missing or incomplete admission evidence
fails before schema writes. The fixed disposable H1 exception admits no hosted
CLI flag or environment bypass.

An explicit staff request reuses a queued/running job or an existing suggestion
for the same revision. A prior failure or previous-month budget refusal does
not permanently disable that image. A fresh staff action is still subject to
the current Hub ledger, permission, eligibility and revision checks, with a new
request audit. The previous attempt and its recorded cost remain intact. No
worker path requeues a possibly billed attempt automatically; a failed broker
fetch remains waiting with zero attempts and zero charge.

The full API inventory test was updated from 17 to 18 media routes while
retaining exact route-set and permission equality. Earlier partial browser runs
were deliberately interrupted to include the translated budget-history label
and month-reset case in the final build; their logs remain under `artifacts/`.
No test was skipped, quarantined or weakened. Final gate counts and execution
receipts follow after the complete final-source runs.

#### 29 October resumption — read-only protected check

Receipt `.local/hosted-content-rollout/h5h-postflight-1793239048200.json`
passes against the unchanged H5h baseline: all strict Auth identity, table and
schema comparisons, all 57 non-Auth protected tables, and the orphan check
match. No new classified Auth activity was observed. No hosted write occurred.
The prior H1 execution ended between turns without a complete result; its log
is preserved as `artifacts/hosted-content-rollout/h5e-h1-interrupted-session.log`.
Its ports/processes were clear before restarting the entire H1 gate. The
completed full API, DB/replay and 304-case browser runs use unchanged source.
Read-only deployment checks use a repeatable-read transaction so a concurrent
session cascade cannot produce an inconsistent orphan check across tables.

#### H5h/H5e final code gates — 29 October 2026

| Gate | Result |
|---|---|
| Full API | 2,151 passed; 11 existing opt-in skips; 0 failed |
| SQL/concurrency | 62 passed; 0 skipped/failed |
| Node DB/guard/fixture checks | 65 passed, including populated upgrade and replay; 0 skipped/failed |
| H1 protocol/admission | 67 passed; all 80 canonical/executed checksums, non-superuser migration, replay/rollback, SCRAM login and role boundaries verified |
| Full normal browser suite | 304 passed in one uninterrupted run; 0 skipped/failed |
| H1 browser suite | 35 + 3 + 7 = 45 passed in one complete H1 run; 0 skipped/failed |
| Focused per-image controls | 2 passed at 1280/390 px, including month reset, request idempotency, budget/history text and saved-upload refusal notice |
| Admin typecheck / offline webpack build | Passed |
| Credential scan | 702 source files and 64 browser files; 0 matches; ignored credential files not read |
| Auth-write inventory | 80 migrations and 76 scripts; 0 matches; frozen 1–79 checksums unchanged |

The immutable source seal is `.local/hosted-content-rollout/h5e-gates.json`
(695 files); the complete frozen/Auth-write inventory is
`.local/hosted-content-rollout/h5h-auth-write-inventory.json`.
Final logs are `artifacts/hosted-content-rollout/h5e-api-final.log`,
`h5e-db-final.log`, `h5e-ui-full.log`, `h5e-h1-final.log`,
`h5e-typecheck-final.log`, `h5e-build-final.log` and
`h5e-credential-scan-final.json` in the same directory. Earlier failures and
interrupted runs remain preserved. No existing assertion was removed and no
test was quarantined. New test navigation reopens the image from the library,
and waits for the actual request/commit before checking the unchanged job count.

Screenshots remain ignored:
`artifacts/hosted-content-rollout/h5e-ai-editor-1280.png`,
`h5e-ai-editor-390.png`, `h5e-ai-website-1280.png` and
`h5e-ai-website-390.png`. These are local synthetic browser checks, not a hosted
pilot. Native Linux Unix-peer/resized-JPEG checks also passed read-only in
memory with no remote file write, database connection or provider call.

At this checkpoint TEST remains at 78 and no hosted write has occurred.
Migration 79 remains unchanged. The combined release still requires Linux
candidate readiness and fresh verified backups before admission; the media key
is absent and no pilot or live provider call has run.

#### H5e deployment resumption — 29 October 2026, strict identity STOP

The owner authorised execution of the held 79/80 combined TEST release from
`3b945cf2002115dbb3d8d575731b362acbc36a5a`, with the dedicated worker login,
DSN-only worker env file, broker, worker unit and H5c. The media key, pilot,
provider calls, cap increases and other changes remain outside this execution.

Read-only preflight receipt
`.local/hosted-content-rollout/h5e-release-preflight-1793259115813.json`
verified the exact applied prefix 1–78, verified TLS, all strict protected
comparisons and the frozen migration 79 SHA-256
`a439a8af79b26280ace573c084bac71433513b8474fc1b059c1b71f2c0fa2a91`.
The separate Auth schema check passed in
`.local/hosted-content-rollout/h5h-postflight-1793259174168.json`.
The original baseline and receipts remain unchanged.

The combined-readiness source-seal precheck refused admission: the old
`h5e-gates.json` seal differs at `scripts/run-disposable-tests.mjs` and
`tests/disposable-test-guard.test.mjs`, and does not include the newly added
`scripts/api-test-selection.mjs`. No Linux candidate or migration admission was
attempted. A full current-source gate was started to replace the stale seal
through the existing sealing tooling, without editing any receipt by hand.

Verified HTTPS preflight passed all seven anonymous health/login/authentication
checks in `h5e-https-preflight-20261029T073230Z.json`; VPS metadata checks passed
in `h5e-vps-readiness-20261029T073231Z.json`, both under
`.local/hosted-content-rollout/`. The live release remains
`07dda14-content-82bd4feeade5`. Both worker variables are absent from API/admin
configuration and processes; the worker OS user and worker env file are absent.

Read-only queue baseline
`.local/hosted-content-rollout/h5e-queue-baseline-3b945cf.json` pins all existing
translation-job/content rows and both other job queues: 1,090 translation jobs,
2,132 content translations, zero media jobs and zero archive jobs. Only counts
and fingerprints are recorded. Private operator tooling now checks these
queues before/after each batch, backs up worker configuration before installing
units and provides application-only rollback. None of those hosted steps ran.

After the owner opened a signed-in hosted Hub tab for the required visual
checks, the read-only H5h check stopped during 08:02:40–08:03:00 UTC. Receipt:
`.local/hosted-content-rollout/h5h-postflight-1793260980084.json`.
The last passing full check completed at 07:32:54 UTC; this bounds the observed
strict difference. These are operation times, not Auth field values.

- **Strict STOP:** `auth.identities` fingerprint differs, with row-count delta
  zero. The cause and changed columns are not established; no activity exception
  is inferred for this table.
- Every strict `auth.users` identity column and the user count match, every
  other classified strict Auth table matches, all 57 non-Auth protected tables
  match, and the orphan check passes.
- Recorded activity only: `auth.users.updated_at` and `last_sign_in_at` changed;
  sessions, refresh tokens and session claims each have row-count delta +1.
  No Auth values, tokens, field timestamps, IP addresses or user agents are
  recorded. All 27 Auth table classifications are listed in the receipt.
- Auth privilege checks pass for all 18 existing Hub roles. The approved worker
  login has not been provisioned. The separate dump-based Auth schema check was
  not reached in this failing execution.

Deployment is **STOPPED under H5h**. No baseline, Auth row, Auth classification
or protected state was changed. No VPS candidate was staged; no migration,
worker login, env file, unit, socket or promotion was applied. There is no new
release to roll back. No new hosted backup was taken, and the earlier expired
backup will not be reused. No media key, pilot or provider call was used.

Completed current-source gate output is under ignored
`artifacts/hosted-content-rollout/h5e-3b945cf-*`: typecheck and offline webpack
build passed; full API 2,151 passed / 11 existing opt-in skips; full DB 62
SQL/concurrency plus 72 Node checks passed, including populated upgrade and
replay; full browser suite 304 passed in one uninterrupted 12.2-minute run.
Credential scan: 703 source files, 64 browser files, zero matches, no ignored
credential files read. H1 was already running when the STOP was detected; its
completion and any replacement gate seal are recorded below, without resuming
hosted operations.

The already-running H1 gate completed successfully: 67 protocol/admission
checks and 35 + 3 + 7 = 45 browser checks passed. Thus the **full local gate
passed on the unchanged final source**; the hosted H5h preflight remains a
separate STOP. The sealing tooling produced a new immutable 696-file receipt,
`.local/hosted-content-rollout/h5e-gates-3b945cf.json`, SHA-256
`92c930af0cf9afdd12e8acef8be48afd348399936ad009e9b81d80ad142ea379`.
Its hashes pin the seven current-source logs/scan outputs. The new Auth-write
inventory is
`.local/hosted-content-rollout/h5h-auth-write-inventory-3b945cf.json`, SHA-256
`0d7857d2e3795fcdd927e42c92138ffbfa0e0da20854676025d80ae74428726c`;
all 80 migrations passed with zero Auth-write matches. The old seal and
inventory were preserved. No candidate receipt or combined-release admission
was produced, and these passing local gates do not override the strict STOP.
Only this documentation record is committed; the existing hosted-env table
requires no change because no hosted configuration was installed.

#### Owner decision H5i — 29 October 2026

Owner decision H5i  29 October 2026. Record it verbatim in docs/46 directly
after "H5e deployment resumption  strict identity STOP", then carry it out.
It replaces the H5h Auth/protected-data comparison as a STOP gate.
H1a, H5f, H5g and H5h stay as historical records.

H5i  Attest our own writes. Stop fingerprinting live shared state.

0. Why
Every STOP since H1a came from comparing live tables against a baseline taken
days earlier, while Supabase Auth and Hub users legitimately change those tables:
- refresh;
- sign-out cascade;
- now auth.identities on sign-in.
Enumerating exceptions will not converge. UAT invitations, password resets,
Google profile refreshes and access approvals would each STOP next. The
question a deployment gate must answer is narrower: did OUR write change
anything outside its declared scope? PostgreSQL can answer that exactly, per
transaction, before commit.

1. The rule
A. Prevention (keep as is):
   - the static Auth-write gate;
   - the read-only privilege postflight: no Hub, runtime, worker or deployment
     role may write to, or own, Auth objects.
B. Write-set attestation (new; this is now the release gate):
   - Every hosted DB write transaction must go through one shared helper. This
     covers migration batches, worker-login provisioning, content/translation
     batch operators, and the private operator tooling under .local/.
   - Each batch declares an explicit allowlist of schema-qualified relations it
     may write.
   - Before COMMIT, the helper reads pg_stat_xact_all_tables for the current
     transaction:
     - Sum n_tup_ins, n_tup_upd, n_tup_del and n_tup_hot_upd, plus
       n_tup_newpage_upd where that column exists.
     - Exclude pg_catalog, pg_toast, information_schema and temporary schemas.
       Catalog changes are covered by C.
   - It requires:
     - zero writes to any relation in schema auth. Auth can never appear in an
       allowlist; reject such a manifest;
     - zero writes to any relation outside the allowlist.
   - On violation: ROLLBACK, write a receipt (relation names and counts only),
     STOP.
   - On success: record the observed write set in the batch receipt.
   - Derive each allowlist from a disposable rehearsal of the exact batch,
     built to the same prefix with populated fixtures. The hosted write set must
     be a subset of the rehearsal's.
   - TRUNCATE and DDL are not tuple counts. A, C and the static gate cover them.
C. Catalog check (short window):
   - Take one snapshot immediately before and one immediately after each write
     batch, in the same operator run. Cover:
     - Hub roles, memberships, grants, RLS policies;
     - function owners, SECURITY DEFINER settings and search_path;
     - the Auth schema shape (tables, columns, constraints, triggers).
   - The after-snapshot must equal the before-snapshot plus that batch's
     expected catalog changes. Anything else is a STOP.
   - Differences between batches, for example a Supabase platform upgrade, are
     recorded, not STOPs.
D. Retired as STOP gates:
   - Auth data fingerprints for all Auth tables, including the users/identities
     activity split and the orphan check;
   - strict comparison of protected Hub tables against multi-day baselines;
   - fingerprint-based queue baselines.
   Receipts may keep row counts (no values) for information. Keep every earlier
   baseline and receipt unchanged as history.
   Sign-ins, refreshes, sign-outs, password resets, invitations, new UAT users
   and Google profile refreshes never stop work, including during deployments
   and visual checks.
E. Standing principle: add it to docs/41 6. Any future deployment or release
   gate must be attribution-based (our transaction or process) or
   catalog-based. Never compare live shared data against an old snapshot as a
   STOP condition.

2. Close the current STOP (record only, not blocking)
- Read-only: compare auth.identities between the verified H5d backup and live,
  per column. Do it in memory or in a disposable local restore.
- Record only:
  - the names of columns with any difference;
  - the changed-row count;
  - whether the same user ids also changed auth.users.last_sign_in_at (a boolean).
- Never print or store values.
- Report the result. Under H5i it is informational, not a STOP.

3. Review fix before deployment: heartbeat audit flood
hub.media_worker_heartbeat updates hub.media_ai_settings on every worker loop.
The audit trigger on that table writes a full before/after audit row each time:
about 2,880 rows per day while idle.
Fix it in new migration 81. 79 is frozen, and 80 is sealed and applied locally.
- Add a singleton worker status table, holding provider_configured and
  worker_seen_at:
  - owner-only and FORCE RLS;
  - not audited, no touch trigger;
  - written only by the heartbeat.
- Write one audit record only when provider_configured changes value.
- Point hub.media_budget_totals at the new table.
- Drop the two status columns from hub.media_ai_settings.
- Keep every other 80 behaviour and grant identical.
- Admit 79+80+81 as one combined transaction. Update the combined-release
  admission (exact migration count/components) accordingly.
- Test: 100 heartbeats add zero audit rows, and a configured-state flip adds
  exactly one.

4. Implementation and tests (offline, disposable DB and H1 simulation; no
   provider calls)
- A shared helper module that every hosted write path uses. Add a static test
  that fails if any hosted write path opens a transaction without the helper.
- Release admission no longer requires the H5h baseline hash. Instead it
  requires:
  - the write-set manifest;
  - the catalog before/after receipts.
- Replace the post-deploy queue smoke with an attribution check. During the
  deploy window, audit.change_log rows with database_role hub_media_worker may
  touch only image-job tables. Translation and other jobs must show no worker
  change.
- Tests:
  - an allowed write passes and records counts;
  - a write to a non-allowed Hub table rolls back with nothing committed;
  - a write into auth rolls back, including one made through a SECURITY
    DEFINER function or a trigger;
  - an allowlist containing auth is refused;
  - a concurrent second session writing auth rows during the batch (simulated
    sign-in, new user, identities timestamp, recovery token) does NOT fail the
    batch;
  - an unexpected role, grant or policy change fails the catalog check; the
    expected changes pass;
  - Auth activity between batches never STOPs.

5. Gates
- Use quick gates while iterating.
- Then run the full gate once on the final source and produce a new seal
  through the existing tooling.

6. Resume H5e deployment
Continue from step 1 of the H5e deployment prompt with H5i in place of the H5h
comparisons:
- Linux candidate;
- a fresh verified backup;
- the attested combined 79+80+81 batch;
- a fresh verified backup;
- attested worker-login provisioning;
- the DSN-only media-worker.env (the key stays absent), backed up;
- units/socket and the new release, with the previous release kept;
- smoke checks and the privilege postflight.
Signed-in visual checks are allowed at any time.
Then STOP for the owner to add HUB_MEDIA_OPENAI_API_KEY. Report:
- the exact owner steps;
- all receipts;
- the observed write sets;
- confirmation that no pilot or provider call ran.

STOP and report on any of these:
- a write-set or catalog violation (after the automatic rollback);
- a privilege-postflight or static-gate failure;
- any docs/41 6 condition;
- a missing credential other than the media key;
- a failed smoke check. In that case, roll the application back to the previous
  release before touching the schema again.
Commit to main when done. H5i addendum (same decision; record with H5i).

B2. Same-snapshot Auth invariance:
- Run every attested write transaction at REPEATABLE READ.
- At its first statement and again immediately before COMMIT, hash every Auth
  table (rows, in memory only; never store values).
- Any difference means our transaction changed Auth. Then ROLLBACK and STOP.
- This covers TRUNCATE, dynamic SQL and anything pg_stat_xact does not count.
  Concurrent sign-ins are invisible to this snapshot, so they cannot trigger it.
- Test it with:
  - a dynamic TRUNCATE of an Auth table;
  - a concurrent committed sign-in and new user during the batch, which must
    pass.

C2. After each batch, run the Auth-write gate on the final definitions of all
functions in Hub-owned schemas (pg_get_functiondef). Migration text alone is
not enough; for example, migration 80 rewrites a function dynamically.
- The catalog check also fails on any new extension, foreign server, user
  mapping, or use of dblink, postgres_fdw, pg_net or pg_cron not declared in the
  batch manifest.

F. Security watch, a report and not a STOP: in each deploy receipt and in a
read-only command the owner can run any time, report:
- new Auth users and identities by provider (counts);
- changes to Hub admin/publisher assignments and account status, with the
  acting user from audit.change_log (ids only);
- whether the Supabase postgres role can write Auth tables.

#### H5i implementation and read-only preflight — 29 October 2026

H5i and its addendum above are the current TEST release rule. The historical
H5h comparisons and failed receipts remain unchanged; they are not admission
requirements for this release. `scripts/hosted-write-attestation.mjs` owns the
hosted operator transaction boundary, with a thin asyncpg pipe adapter for the
existing Python operators. Hosted use requires a pinned disposable rehearsal;
local-only operators retain their existing transaction semantics. Historical
content operators cannot perform a hosted write without a new H5i manifest.

The helper uses REPEATABLE READ, checks the exact migration-history digest,
compares Auth row hashes only in memory at the first and last statements,
records relation counters, and checks the catalog and final function definitions
before commit. PostgreSQL retains backend-local pending statistics across
transactions until a flush; the helper requests that flush before BEGIN and
requires zero write counters on entry. It never resets shared statistics.
Catalog comparison normalizes deployment-owner names and generated internal
constraint-trigger OIDs, retaining the constraint identity, enabled state and
definition. Database grants are compared separately so unrelated platform grants
do not become a rehearsal prerequisite.

The informational H5d-backup comparison found **one changed identity row**, in
column **`updated_at` only**; the same user's `last_sign_in_at` changed: **yes**.
No values were recorded. Receipt:
`.local/hosted-content-rollout/h5i-informational-1793264101323.json`.

Read-only TEST readiness passed with exact prefix **1–78**, frozen 79 and sealed
80 unchanged, all checked Hub roles free of Auth writes/ownership, and all final
Hub function definitions passing the static Auth-write check. Catalog
preconditions match the disposable combined rehearsal. Receipt:
`.local/hosted-content-rollout/h5i-readiness-1793267812576.json`.
The earlier read-only precondition receipt
`h5i-readiness-1793267620948.json` remains unchanged; its trigger-OID mismatch
was resolved in the comparator, before any hosted write.

The security watch reported no new Auth users, identities or account-assignment
changes in its observation window. **Supabase `postgres` can write Auth: true**;
this is the report-only platform-role item explicitly required by H5i F. Hub
actors, runtime, worker and dedicated deployment roles remain subject to the
strict privilege check. The owner can run the read-only watch using the existing
approved configuration:

```powershell
node --env-file=.env.supabase-test scripts/hosted-security-watch.mjs --since 2026-10-29T00:00:00Z
```

Migration 81 moves heartbeat status into owner-only FORCE RLS storage with no
touch/audit triggers. The budget RPC reads that storage; a configuration flip
adds one explicit audit row. Migration 79 and 80 bytes were not edited. Admission
now requires the exact **79+80+81** bundle and both rehearsal receipts (schema
and worker login), including their write sets and catalog before/after evidence.
It no longer requires the H5h baseline hash. Generic standalone 79/80/81 apply
remains refused on hosted TEST.

Quick gates so far: DB tier passed, including populated upgrade/replay and the
100-heartbeat/one-flip regression; 19 attestation tests passed; affected
business/media API tests 26 passed; AI-footer browser tests 2 passed at 1280 and
390 px. The permission quick gate initially reported 391 passed and 6 failures
because the new owner-only table was unclassified; the corrected focused
permission/media set passed its 45 tests (the separate business-sheet isolation
failure was fixed and covered by the subsequent 26-test run). Full gate: not yet
run on final H5i source. Logs are under ignored
`artifacts/hosted-content-rollout/h5i-*`; no hosted write, pilot or provider call
has run at this point.

#### Owner deployment inspection adjustment — 30 October 2026

The owner directs the full browser and H1 gates to use their normal Playwright
runners while the computer remains available for other work. Computer Use is
not required and must not be used for hosted pages in this task. Hosted visual
inspection is no longer a deployment blocker: use the automated API smoke
(`ai-state`: cap 5, spent 0, provider not configured) and the local Playwright
per-image footer evidence at 1280 and 390 px. The owner will inspect the hosted
page after deployment. After the full gate, produce the new seal, commit H5i
code/tests/docs by explicit path and push main before any hosted write step.
Then complete the approved deployment and STOP for the media key; the pilot
and provider calls remain excluded.

#### H5i gate recovery — 30 October 2026

The first full attempt was interrupted for a catalog-comparison correction
before release admission; its API output was retained but not used as a final
gate. The next attempt passed typecheck, build, API (2,151 passed, 11 skipped)
and DB, then Windows interrupted the browser process. A resumed browser run was
also interrupted when the Computer Use turn ended. Original receipts and logs
remain unchanged, with separate interruption records under
`.local/hosted-content-rollout/h5i-full-{1,2,3}-interruption.json`.

The subsequent browser run completed with **303 passed, 1 failed** in
`artifacts/hosted-content-rollout/h5i-full-4-ui.log`. Its workflow setup clicked
a URL-controlled dashboard checkbox before the final state was ready. The
test-only helper now waits for the role-change document and asserts the eventual
checked state after a single click. Application behavior and test expectations
are unchanged. The affected quick gate passed **5 tests** in
`artifacts/hosted-content-rollout/h5i-workflow-quick-2.log`; the earlier failing
quick log is retained. A fresh full gate on the corrected source is required
before sealing or committing.

The read-only preflight also checked the exact rehearsal history digest, not
only migration names: `.local/hosted-content-rollout/h5i-readiness-1793326374721.json`
passed at prefix 78, with no catalog mismatch, Auth privilege violation or final
function-definition violation. Anonymous HTTPS preflight passed seven checks
with verified TLS in `h5e-https-preflight-20261030T015909Z.json`.

#### Owner media-key steps — only after the successful deployment STOP

Use the dedicated TEST media-project key. First, from the repository PowerShell
terminal, take fresh verified database and protected configuration backups using
the existing operator (these modes only back up; they do not promote a release):

```powershell
node --env-file=.env.supabase-test .local/hosted-content-rollout/h5e-production-operations.mjs backup_promote
python -X utf8 .local/hosted-content-rollout/h5e-production-vps.py backup_worker_config
```

Require both receipts to pass. In an interactive SSH terminal on the TEST VPS,
run the following as root. It appends through a hidden prompt to the
one approved file, refuses a duplicate key or unexpected file, and prints no
credential. Do not paste the key into chat or a shell command.

```bash
python3 - <<'PY'
import getpass, os, re, stat
path = '/etc/sena-hub-test/media-worker.env'
fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
with os.fdopen(fd, 'r+b') as file:
    info = os.fstat(file.fileno())
    assert stat.S_ISREG(info.st_mode)
    assert (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (0, 0, 0o600)
    existing = file.read()
    assert existing.endswith(b'\n')
    assert [line.split(b'=', 1)[0] for line in existing.splitlines()] == [b'HUB_MEDIA_WORKER_DATABASE_URL']
    key = getpass.getpass('Media API key (hidden): ')
    assert re.fullmatch(r'[A-Za-z0-9_-]{20,}', key), 'Unexpected key format; nothing written'
    file.write(('HUB_MEDIA_OPENAI_API_KEY=' + key + '\n').encode('ascii'))
    file.flush()
    os.fsync(file.fileno())
print('Media key configured; value withheld.')
PY
systemctl restart sena-hub-test-media-worker.service
systemctl is-active sena-hub-test-media-worker.service
```

Restart only that worker unit. Report completion without the key. The next
read-only postflight checks presence flags, root ownership/mode and unit
isolation, Auth privileges, the security watch, API health, the worker heartbeat,
the Hub budget and worker-attributed queue changes. Pilot execution still waits
for the separate authorized pilot step; these instructions do not queue jobs.

#### H5i final full gate and source seal — 30 October 2026

The complete final gate passed on unchanged source in
`.local/hosted-content-rollout/h5i-full-5.json` (SHA-256
`e4c8ac9ca1d210df67afb2b92253c130fdb7dca91112ed23a3ec305d8f27ec25`).

| Full-gate tier | Result |
|---|---|
| Admin typecheck | Passed |
| Offline admin build | Passed |
| API | 2,151 passed, 11 opt-in skipped; 6 existing deprecation warnings |
| DB | 63 SQL/concurrency checks and 94 Node tests passed; populated upgrade included |
| Browser | 304 passed in one run, including the corrected workflow test and both AI-footer widths |
| H1 | 67 Node/protocol checks and 45 browser tests passed; exact populated prefix 78 rehearsed and attested through 79+80+81 and worker-login provisioning |
| Credential scan | 713 source files and 64 browser files; zero matches; credential files not read |
| Static Auth-write inventory | 81 migrations and 82 scripts; zero matches, including migrations 1–79 |
| Hosted transaction-path scan | 102 operator paths; passed |

Command logs and their exact hashes/durations are in the full-gate receipt,
under `artifacts/hosted-content-rollout/h5i-full-5-*.log`. The seal tooling
produced `.local/hosted-content-rollout/h5i-gates.json`, SHA-256
`460f4965a2b5d0b6b066806aea3ec3aa3540fa4a38bdbda269c74a14be9a4b7e`,
covering **706 source files**. It records the pre-commit base separately from
the exact tested working-tree hashes; deployment verifies those bytes again.
No receipt was edited by hand.

The seal pins these disposable rehearsal receipts:

- Combined schema: `h5i-attestation-1793328503451-78577d21-1e7f-4ee1-b826-d8cb0903a515.json`,
  SHA-256 `d66126206c6ebd43e77909f37a500923843fc0a2fed751a5ff260b23ee2af564`.
  Relations: `audit.change_log`, `hub.media_ai_settings`,
  `hub.media_worker_status`, `hub_deployment.schema_migrations`.
- Worker login: `h5i-attestation-1793328504414-421b836c-95f3-4bdf-a8f3-6cd298693aac.json`,
  SHA-256 `11cfa0190115bb67ec4293761f785596581de4e0f96ab5a70157740ea3583e44`.
  Relation: `hub_deployment.media_worker_provision`.

Both are under `.local/hosted-content-rollout/`, include catalog before/after
hashes and exact expected changes, and passed the same-snapshot Auth check,
privilege postflight and final-function scan. These are rehearsal observations;
hosted observations will be recorded separately.

Local Playwright evidence, regenerated by this final run and checksum-pinned in
the seal: `artifacts/hosted-content-rollout/h5e-ai-editor-1280.png`,
`h5e-ai-editor-390.png`, `h5e-ai-website-1280.png`, and
`h5e-ai-website-390.png` in the same directory. All remain Git-ignored. These
replace hosted screenshots under the owner's 30 October instruction.

At this checkpoint no hosted write, pilot or provider call has run. The next
step is the explicit-path H5i commit and push, followed by the approved TEST
deployment with fresh verified backups and the sealed attestations.

#### H5i hosted execution — 30 October 2026, application smoke STOP

**The combined deployment is incomplete. The application was automatically
rolled back to `07dda14-content-82bd4feeade5`; do not add the media key yet.**
The candidate is `7781704-media-5b9714604a03`. Migrations 79–81 and the dedicated
worker login were committed successfully and remain applied. No schema rollback,
promotion retry, pilot or provider call was performed after the failed smoke.

H5i code, tests and docs were committed and pushed to main as
`7781704f0997f2b6bb049379183ffc1b7b822da2` before the hosted write steps. The
source-commit receipt rechecked all 706 sealed files against that pushed commit.
Post-push preflight confirmed exact migration prefix 1–78, the frozen 79/80
checksums, the rehearsal's catalog prerequisites, Auth privileges and seven
trusted-TLS HTTPS checks. The security watch reported no new users, identities
or account/permission assignment changes in its observation window.

The Linux candidate transferred and verified 225 source files. Its source
manifest digest is `5b9714604a03d6786ac168a77818ee31325a479996aff034cf0a14f795227e91`.
Linux build, two native Unix-peer/JPEG checks, systemd syntax, private-socket-only
configuration, API rejection of both worker-only variables and key-absence
checks passed. The candidate receipt pins the same gate SHA-256
`460f4965a2b5d0b6b066806aea3ec3aa3540fa4a38bdbda269c74a14be9a4b7e`.
Build output hash: `fdeb41c2592000cc44a606c9c10b853dc636cfe7ad77a021991cbc6c43815016`.

**Committed database batches.** Each had a new protected, inventory-checked,
fully read-verified backup less than 15 minutes old. The combined schema batch
used `applyCombinedContentRelease`, never generic `--apply`. Both transactions
ran at REPEATABLE READ, passed same-snapshot Auth invariance, allowed-write-set
and exact catalog checks, and passed the final-function and privilege checks.

| Batch / observed relation | Inserted | Updated | Deleted | HOT updated | New-page updated | H5i sum |
|---|---:|---:|---:|---:|---:|---:|
| 79+80+81: `audit.change_log` | 2 | 0 | 0 | 0 | 0 | 2 |
| 79+80+81: `hub.media_ai_settings` | 1 | 1 | 0 | 1 | 0 | 3 |
| 79+80+81: `hub.media_worker_status` | 1 | 0 | 0 | 0 | 0 | 1 |
| 79+80+81: `hub_deployment.schema_migrations` | 3 | 0 | 0 | 0 | 0 | 3 |
| Worker login: `hub_deployment.media_worker_provision` | 1 | 0 | 0 | 0 | 0 | 1 |

The H5i sum includes the HOT counter as the owner specified; it is not a count
of distinct changed rows. The schema batch's relation set was a subset of the
rehearsal manifest. Its settings update applies the already-approved TEST cap
of US$5. No content, Auth, account, permission, publication or job relation was
written by either operator transaction.

The exact 26 schema catalog changes matched rehearsal: the three relations
`hub.media_ai_settings`, `hub.media_jobs`, `hub.media_worker_status`; policies
`media_ai_owner` and `media_worker_status_owner`; and these 21 `hub` functions:
`media_ai_state`, `media_budget_blocked`, `media_budget_exhausted`,
`media_budget_totals`, `media_claim`, `media_clip_claim_legacy`, `media_finish`,
`media_finish_legacy`, `media_image_begin`, `media_image_claim`,
`media_image_fetch_audit`, `media_image_finish`, `media_image_lease`,
`media_image_wait`, `media_job_audit`, `media_job_request`, `media_jobs_read`,
`media_worker_heartbeat`, `provider_budget_event`, `website_media_claim` and
`website_media_finish`. Function signatures and before/after catalog hashes are
in the schema attestation.

The login batch matched its five expected catalog entries: the
`hub_media_worker_login` role, its database CONNECT grant, its membership in
`hub_media_worker`, the platform-created deployment membership in the new
login, and `hub_deployment.media_worker_provision`. Its random password was
generated only into the existing ignored `.env.supabase-test`; only its SCRAM
verifier entered SQL. The actual Session-pooler connection passed verify-full
TLS and could SET ROLE only to itself and `hub_media_worker`. The postflight
checked 19 roles / 513 Auth-table privilege combinations and all 504 final Hub
function definitions: zero violations. `hub_runtime` cannot assume the worker.

**Host configuration and rollback.** The exclusive `sena-hub-media` system
user/group and `/etc/sena-hub-test/media-worker.env` were created. The env file
is regular, non-symlink, root:root 0600, contains only
`HUB_MEDIA_WORKER_DATABASE_URL`, and has a protected configuration backup.
`HUB_MEDIA_OPENAI_API_KEY` remains absent. API/admin files and processes contain
neither worker variable. The service users cannot read the root-owned source
file; systemd is the intended loader for the worker alone.

Promotion ran from **03:21:33 to 03:22:10 UTC (10:21:33–10:22:10 Bangkok)**.
Candidate preview completed and the new application/worker/socket started, but
the isolated, read-only deployed ASGI `ai-state` smoke service exited **1**.
This harness uses the actual deployed API and runtime database role, injects an
existing actor only inside a non-listening process, and removes provider keys
before imports. It does not alter live authentication. The captured operator
error withholds raw details; the underlying smoke failure is **not yet
established**. This is not recorded as a passing API smoke or a completed release.

The failure handler restored the previous symlink and original API/admin/cache
units, restarted the previous API/admin, and removed/stopped the new worker,
socket and broker drop-in. Read-only inspection confirmed the previous release
active, API/admin running, worker/socket not installed and inactive, preview
services inactive, and candidate source hashes unchanged. Original unit backups
remain at `/srv/sena-hub-test/backups/7781704-media-5b9714604a03-h5e-units`.
The candidate directory, database changes, OS user and protected DSN-only env
file remain available; no further schema operation was attempted.

**Read-only STOP postflight.** The restored application passed all seven HTTPS
checks with verified TLS: health and login 200; consumer/admin unauthenticated
routes 401. Database prefix 81 and checksums, Auth privileges, final function
definitions and runtime/worker separation passed. The database ledger reports
cap **US$5**, spent **US$0**, reserved **US$0**, remaining **US$5**, provider
configured **false**. These SQL results do not replace the failed API smoke.
No heartbeat had been recorded before the worker was stopped. Image jobs,
running image jobs and provider attempts are all **0**; worker-attributed audit
changes across the entire deployment window are **0**, including translation
and other queues. No pilot or provider call ran.

The first read-only STOP diagnostic used the wrong job column (`state` instead
of `status`) and returned SQLSTATE 42703. Its failed receipt is preserved. Only
that SELECT was corrected; the subsequent read-only diagnostic passed. No
promotion retry, application change or database write followed the STOP.

The security watch again reports zero new Auth users/identities and zero account
assignment/status changes; Supabase `postgres` Auth-write access remains **true**,
the report-only H5i F platform-role item. Candidate credential re-scan checked
**84 browser files and 417 bundle files, zero matches**. Worker-env ownership,
mode, DSN-only content and API/admin isolation were rechecked using flags only.
No Computer Use or signed-in hosted browser inspection was used. The final local
Playwright footer evidence at 1280/390 remains linked above; the owner will do
hosted visual inspection after a successful deployment.

The STOP remains in force for the failed smoke. The owner media-key instructions
above are for a successful deployment only and must not be run at this checkpoint.
Investigation and a new deployment attempt remain pending; no gate was waived
or weakened.

**Receipt and backup index.** The immutable
`.local/hosted-content-rollout/h5e-deployment-stop-index-20261030.json`
(SHA-256 `1e89010fc843b2fe2c9527485d9329b57f6c99d4dd4cb2581918cae6dd80ff8b`)
indexes every receipt below, both observed write sets/catalog change lists, and
all 11 protected backup files. Backup bytes were rehashed against their receipts.
All receipts, backups and screenshots remain ignored; none was force-added.

Receipt paths below are relative to `.local/hosted-content-rollout/`.

| Receipt | Result | SHA-256 |
|---|---|---|
| `h5i-source-commit.json` | passed | `3218639125acfe1cfb3eafeb5c9f2193a63df3485dc098cdbf8e96b33f5a080b` |
| `h5i-readiness-1793328851545.json` | passed | `aa80fd469c08334ffc032c7d8ffb8713dc1030c51e45b30d7592299c5800e760` |
| `h5e-vps-readiness-20261030T025400Z.json` | passed | `bafcdc804b4c80ca39f5ebe3b4d59a7c1a4dc6ebd7ecd8b9cc2737788f7aba7b` |
| `h5e-https-preflight-20261030T025401Z.json` | passed | `9a271c6c17ecbb0bd6e19f859ebdb0dbb3c8f61143beb5ba8534c4e95f94f537` |
| `h5e-backup_stage-1793328984912.json` | passed | `cbc7edd1d1283b10d0d1e4184deeb1fb5df1e35ddff1ed8c504e390a94893e0b` |
| `h5e-vps-candidate.json` | recorded | `6d170128461852393729b0b96098070ef5f8d83ae09fd3c757dbba0baaac7b7e` |
| `h5e-vps-source-manifest.json` | recorded | `c3c900b5067addf38c854714f81fab62e1f63c4aff9da4d9ffb31b2777ea6376` |
| `h5e-backup_build-1793329619728.json` | passed | `09882a943a658fffa20cee9a9cdfa43fd27440ca159f4d71d342110fa06248f4` |
| `h5e-vps-build.json` | passed | `76d6b38312b9231b3a0ea7c91ff2b9bba0bc26dff49b575c9228935f67cabcf9` |
| `h5e-candidate-readiness.json` | passed | `7d326c93e72dbf214e86c2ec7ec115be7a2771cc6d969f95dc9666998d8ea48e` |
| `h5e-combined-manifest.json` | recorded | `29382bf63526bcd567a0c0bfa34c59772b8609e9f8efaea3137032095a469e24` |
| `h5e-combined_schema-1793329938510.json` | passed | `9f8e2ef60f46b00669f7a7353022db888e8fbf863b1258b601515d8d1e97418b` |
| `h5i-attestation-1793329929948-e8098685-9d23-44d3-8d3a-2b44cb18dd78.json` | committed | `3cbbe29ba044cb68b6b975ce03d4aa9dd627eae9d926447200df3b86c746067b` |
| `h5e-media_worker_login-1793330118687.json` | passed | `c9168f890f45ece02b898b7abc6d3e700dd55c8e1c6e8f9b20ca78a9d16c5339` |
| `h5i-attestation-1793330109959-08786e0a-795e-4bb3-b9ac-2b396f18d421.json` | committed | `ba851e15970b8ece3ce90532411253bfaaa6ac8b8cc28f1806f9c64ed68ffd82` |
| `h5e-worker_connection-1793330145076.json` | passed | `67ae5bc162c0e24e5570d3d76f24ca46a10498eab1ca5b5267ff6ef847cd1df5` |
| `h5e-backup_configure_worker-1793330293293.json` | passed | `8e31e780eb872f9a624b8026bcb65e52ab64306e3d8cca34390ee37574adcfc9` |
| `h5e-configure_worker-1793330321196.json` | passed | `29c9721899f72c71b471a5bdad23add289d77c53f2f3f6e2c9ab40e99f08e37a` |
| `h5e-vps-worker-config.json` | configured | `36b68243d3be3e0502f70eef1f1fc3247f9f0ee46d77ddf577f3d38a61d2ea7a` |
| `h5e-backup_promote-1793330482929.json` | passed | `aeffa195bf02f27ae918f52a73b14487b1b171003425c9223ac23ee564dcbdad` |
| `h5e-promote-1793330530988.json` | STOP | `92e9743b2b4d5e71b6afcf5a6b6dcf513f76f2995e93604993022a5b689e9be0` |
| `h5e-promotion-stop-inspection-20261030T032408Z.json` | recorded | `e025ead21ba57c647991c0d195292276bd252b2c5b68f04d3a00ed6af1d6559b` |
| `h5e-promotion-stop-journal-20261030T032601Z.json` | recorded | `8b2ce12da6ebe737ed44c5465b90983619a2e9ddca0a827439494fa419cbddac` |
| `h5e-https-postflight-20261030T032603Z.json` | passed | `f6e5812c044ce307913fb4d8a15e5316b04bc9d491bc71b8a0aed4ec9f095486` |
| `h5e-promotion-stop-postflight-1793330940345.json` | STOP | `1e459ebd08e2c40ab9de3e5e60a85017621bd658b4ad4cad25fd1502a05f3a09` |
| `h5e-promotion-stop-postflight-1793331007648.json` | passed | `e2af206705a37a7127812796b23acc806b9e0d271d33fc9d38fa0942e6203090` |
| `h5e-promotion-stop-env-scan-20261030T033141Z.json` | passed | `13f09b30a7796df4bf32e0526d5a292e418fcc8a3daae49ee68d577b5eca66d9` |

Backup paths below are relative to `.local/backups/`. Each directory also
contains a protected `receipt.json`; its hash is pinned in the index. All six
database archives passed full read verification; all five configuration archives
passed inventory verification.

| Backup file | Bytes | SHA-256 |
|---|---:|---|
| `h5e-backup_build-20261030T030506Z/database-before-batch.dump` | 17019796 | `c624f61cab673b45a4f7b2642b4d601ae1dcc517a10771d338c158a0bbb0f3cb` |
| `h5e-backup_configure_worker-20261030T031615Z/database-before-batch.dump` | 17051272 | `346591bdee5db3761aa03f344865d2bae7f099572995e09ecac0718b220f3c85` |
| `h5e-backup_promote-20261030T031917Z/database-before-batch.dump` | 17051272 | `746847b45752a1c0807c585f2a865783c94021843ecb64cd708080549c7181ce` |
| `h5e-backup_stage-20261030T025430Z/database-before-batch.dump` | 17019796 | `e8ac48021894107a20649303f1840d90684b44a301551a1b901384070841bdb0` |
| `h5e-combined_schema-20261030T031005Z/database-before-batch.dump` | 17019796 | `e2df3d5d6cdc34b8e4cac7a687b04eeffc956d0951b5b531518339dc9061876f` |
| `h5e-media_worker_login-20261030T031310Z/database-before-batch.dump` | 17050066 | `54b8d6448414b50d59e60e8c1dd3c60d6dae5412e008d322885343bcd3954c9d` |
| `h5e-vps-build-20261030T030715027975Z/protected-configuration.tar.gz` | 2827 | `1dab4dd633349c4f30fb3becf5e5f8adb3efdd383269afc07925b00cf828bd06` |
| `h5e-vps-configure_worker-20261030T031830543527Z/protected-configuration.tar.gz` | 2827 | `1dab4dd633349c4f30fb3becf5e5f8adb3efdd383269afc07925b00cf828bd06` |
| `h5e-vps-configure_worker-20261030T031833058761Z/protected-configuration.tar.gz` | 2936 | `6a1a9f5e470a22668cea038b20ce6b7eb82746a1e9ade9cc4ef0e8af98f13d70` |
| `h5e-vps-promote-20261030T032142373381Z/protected-configuration.tar.gz` | 2936 | `6a1a9f5e470a22668cea038b20ce6b7eb82746a1e9ade9cc4ef0e8af98f13d70` |
| `h5e-vps-stage-20261030T030441272475Z/protected-configuration.tar.gz` | 2827 | `1dab4dd633349c4f30fb3becf5e5f8adb3efdd383269afc07925b00cf828bd06` |

Record-only quick checks passed before the documentation commit: static Auth
gate; 108 hosted operator paths with zero transaction-path violations; 713
source / 64 browser files with zero credential matches and no credential files
read; all 706 sealed source files unchanged; `git diff --check`; and
`git check-ignore` for both approved local-development credential files.
Receipt: `artifacts/hosted-content-rollout/h5i-stop-record-checks.json`, SHA-256
`f45008655eaea4fbcc515620b27002751981a5cbec35dcddf176f786e348306d`.
The final full-gate results above remain valid for the unchanged code. They do
not override the hosted smoke STOP.

#### Owner follow-up — ai-state diagnosis and promotion-only resumption

Owner instruction, 30 October 2026:

> Agreed: no media key. Diagnose the ai-state smoke read-only. Do not promote and
> do not change the schema.
>
> 1. Rerun the exact smoke harness against the existing candidate directory
>    7781704-media-5b9714604a03, without switching the live symlink. Record only
>    non-secret diagnostics:
>    - the step reached (import / app creation / lifespan / request / response
>      check);
>    - the exception class;
>    - SQLSTATE;
>    - the HTTP status;
>    - the API error code;
>    - the names of any missing response keys.
>    Never record values, DSNs, tokens or headers.
> 2. Check these hypotheses explicitly:
>    a. The harness inherited HUB_MEDIA_BROKER_ENABLED=1 without systemd socket
>       activation, so start_broker raised in lifespan.
>    b. The harness read cap_usd and other keys from the top level instead of the
>       API's {"data": ...} envelope.
>    c. The injected actor lacks projects view on the chosen project, or the
>       actor role lacks EXECUTE on hub.media_ai_state on hosted.
>    d. Hosted-only lifespan checks (R2 private bucket, hosted profile, registry
>       readiness) fail for the harness's OS user.
> 3. Fix where the cause lies:
>    - If it is the harness: move it into the repo, with tests against the local
>      H1 simulation.
>    - If it is app code: quick gate, then one full gate and a new seal.
>    Then re-run only the promotion step. Migrations 7981, the worker login and
>    the env file are already done; never repeat them.
> 4. Standing rule for all operator tooling: redaction removes secret values
>    only. Always keep the step, exception class, SQLSTATE and HTTP status, so
>    that a STOP always names its cause.
> 5. STOP after a successful promotion for the media key, as planned. Commit the
>    diagnosis and fix to main.

**Read-only diagnosis: established.** The original harness failed at
`import/httpx`, with `ModuleNotFoundError`; SQLSTATE, HTTP status and API error
code were null, and no response-key check was reached. `httpx` belongs to the
development dependency group; the Linux candidate correctly uses `--no-dev`.
The original harness SHA-256 is
`e526268a2bf5043f9b2c6f921f2b274411b63d562a637514b24a7d181ef3d75c`.
Diagnostic instrumentation changed only observations/error handling; original
request and assertion behavior was retained. Receipts:
`h5e-smoke-diagnosis-1793332301372.json` and
`h5e-smoke-diagnosis-1793332393506.json` under
`.local/hosted-content-rollout/`. The live symlink stayed on the previous release.

| Hypothesis | Observed result |
|---|---|
| Broker flag without activation | Excluded: the flag and activation presence flags were false; the original harness never entered lifespan. |
| Wrong response envelope | Excluded: the original code reads `response.json()['data']`. The regression tests also reject a top-level budget object and name missing nested keys. |
| Actor/object permission or EXECUTE denial | Excluded: selected actor has projects view; the actual runtime connection with `SET LOCAL ROLE hub_app` successfully calls the selected project's RPC. EXECUTE is true for `hub_app`, false for the login and actor roles, as intended by the API's base-role design. No grant was changed. |
| Hosted lifespan/OS-user checks | Excluded by the corrected read-only run: actual R2 private-bucket, hosted-profile and registry-readiness checks passed as `sena-hub-api`. |

The corrected harness is `scripts/hosted-ai-state-smoke.py`, with shared metadata
redaction in `scripts/operator_diagnostics.py`. It uses the existing locked
production `httpx2` dependency; no application dependency, app code, credential,
schema or permission change is required. It now exercises the real lifespan
under a read-only pool, preserves the API envelope and injects an existing actor
only inside the non-listening smoke process. Provider keys are removed before
application imports; worker-only configuration is refused.

The first corrected run passed lifespan but stopped at the read-only assertion:
the hosted pool connection did not retain the requested startup read-only GUC.
Receipts `h5e-smoke-diagnosis-1793333164435.json` and
`h5e-smoke-diagnosis-1793333230416.json` preserve that failure. The harness now
sets and verifies `default_transaction_read_only` on **every pool checkout**,
including after connection resets. Its regression test simulates the ignored
startup setting. These diagnostic runs issued only reads and connection-local
settings; no migration, login, env-file operation or promotion was repeated.

The final read-only candidate check passed in
`h5e-smoke-diagnosis-1793333352626.json`: step `response_check`, HTTP **200**, no
exception/SQLSTATE/API error or missing response key; real lifespan, database
read-only mode, anonymous denial and expected cap/spend/disabled-provider state
all passed. Fixed harness SHA-256:
`46b80c12fc986870349ac741f1f220630db0ab241b62b99431152d99483bf0c3`.
No provider call or signed-in hosted session was used.

Quick gate: **14 Node runner tests passed**, and **10 H1 smoke tests passed** in
`artifacts/hosted-content-rollout/h5e-smoke-quick-2.log`. The first eight-test
quick run remains in `h5e-smoke-quick-1.log`. Tests cover production-only imports,
the real H1 lifespan/response, permission denial with SQLSTATE, broker/R2
failures, missing response keys, worker-env isolation, read-only checkout and
metadata forwarding without secret values. Shared JS operator errors now retain
the same metadata; active promotion wrappers must preserve it rather than
replace it with a generic assertion. This standing rule is also in docs/11 and
docs/41. Full gate and the promotion-only result are recorded next.

#### Smoke-harness full gate and replacement seal — 30 October 2026

The full gate passed on the final source, without a failure loop:

| Tier | Result |
|---|---|
| Admin typecheck and offline build | Passed |
| API | 2,151 passed, 11 opt-in skipped, 6 existing deprecation warnings |
| DB | 63 SQL/concurrency checks and 94 Node tests passed; populated upgrade included |
| Browser | 304 passed in one run (12.0 minutes), including both footer widths |
| H1 | 68 Node/protocol checks, 10 smoke-harness regressions and 45 browser tests passed |
| Credential scan | 716 source files and 64 browser files, zero matches; credential files not read |
| Static Auth-write gate | 81 migrations and 84 scripts passed |
| Hosted transaction-path scan | Passed with zero violations |

Full receipt: `.local/hosted-content-rollout/h5i-full-6.json`, SHA-256
`ce8eddbdfe09a1df22980bdfdf326a0dda2fd8fe19e22704d2e826dcd7feb444`.
Logs are `artifacts/hosted-content-rollout/h5i-full-6-*.log`; the receipt pins
their hashes and durations. The normal tooling produced the new seal at
`.local/hosted-content-rollout/h5e-smoke-gates.json`, SHA-256
`a113cb8848562c452e46f2e563c800a0dacc35def2f06cd5d8cfafaba179b0e3`,
covering **709 source files**. The original gate receipt and seal remain intact.

The four local Playwright screenshots listed above were regenerated by this
run and are pinned in the new seal. The per-image footer remains below the
editor actions at 1280 and 390 px; the mobile layout has no horizontal overflow.
The suite tests the not-configured, waiting, completed, budget and ineligible
states. No hosted Computer Use or provider call was made.

Promotion-only admission requires the pushed operator commit, this new seal,
the original Linux readiness receipt and exact equality of all **225 candidate
application files** with the tested source. The corrected repo harness and its
diagnostic helper run in memory against the existing candidate. The promotion
wrapper also preserves the last readiness exception and HTTP status without
response content. No application rebuild, schema batch, worker-login operation
or env-file creation is part of this retry. A fresh verified backup precedes
promotion; its outcome is recorded below.


#### Promotion-only retry - worker import STOP, 30 October 2026

The harness fix and diagnosis were committed and pushed as
`cd453c13f6f8126a2fd696f5d8b4a9ef67bdccd8` before hosted execution. Admission
verified the new seal, all 225 unchanged candidate files and the original Linux
readiness proof. Seven trusted-HTTPS preflight checks passed. A fresh protected
backup passed inventory and full-archive read verification; a protected
configuration backup included the existing DSN-only worker env file.

The retry ran **04:49:07 to 04:49:56 UTC**. The corrected ai-state smoke passed its
HTTP 200, envelope, cap 5/spent 0/provider-not-configured, real lifespan and
read-only assertions. Execution reached `promotion/environment_isolation`,
then raised **`FileNotFoundError`** while inspecting process environments.
SQLSTATE, HTTP status and API error code were null at this later step; there
were no missing response keys. The operator retained this metadata and
performed its automatic application rollback.

**New cause established, read-only:** the production worker exits at
`import/media_worker/httpx` with **`ModuleNotFoundError`**, in
`apps/api/sena_hub_api/media_worker.py:13`. Both the deployment-window journal
classification and an import-only probe as `sena-hub-media` reproduce it.
`httpx` is available only in the development dependency group; the Linux
candidate uses the correct production `--no-dev` install. The worker import
fails before its connection/heartbeat loop. The follow-up probe read no
credential file, opened no database connection and started no service. No raw
journal, exception message, DSN, token, header or response value was retained.

This is a separate application dependency issue after the harness fix. The
passing local gates include development dependencies and did not establish
production worker startup. Resolving it needs an application dependency/import
correction and a production-only worker-startup regression, followed by quick
and full gates, a new seal and Linux candidate validation. **No such app change,
package installation on the VPS or second promotion attempt was made after
this failed-smoke STOP.** No new credential is needed for the diagnosed import.

Rollback verification at **04:50:37 UTC** found live release
`07dda14-content-82bd4feeade5`, API/admin active, all previous unit references
restored, and worker/socket/preview units inactive and removed. All 225 held
candidate source hashes still match. Seven HTTPS checks passed again: health
and login 200, five unauthenticated consumer/staff routes 401. The held candidate
remains `7781704-media-5b9714604a03`.

Read-only safety postflight passed:

- Exact migration prefix **81** and checksums; migrations 79 through 81, worker login
  provisioning and env-file creation were **not repeated**.
- Auth privilege postflight: **513 table/role checks** passed; **504 final
  function definitions** passed the static Auth-write check. The runtime still
  cannot assume the worker role.
- Media ledger: cap **US$5**, spent/reserved **US$0**, provider not configured;
  no worker heartbeat recorded, zero image jobs and zero provider attempts.
- Worker attribution from the original deployment start: **zero audit changes**,
  including translation/other queues. No hosted DB write batch was executed by
  this retry; there is no new migration/login write set to attest.
- Security watch: no new Auth users/identities or account-assignment changes in
  the observed window. The Supabase `postgres` role can write Auth tables; this
  remains the informational platform-role observation required by H5i F.
- Worker env remains regular `0600 root:root`, DSN only; all service users are
  denied direct file reads. API/admin process presence flags for both worker
  variables are false. Media key absent. Credential scan: **84 browser and 417
  deployed bundle files, zero matches**.

**STOP remains in force under the failed-smoke rule. Do not add the media key.**
The owner key steps above remain conditional on a successful deployment STOP.
No pilot, provider call, cap change, schema repair or account/permission change
was performed in this retry. Earlier failed receipts and baselines remain intact.

The diagnosis/rollback receipt index is
`.local/hosted-content-rollout/h5e-smoke-stop-index-20261030.json`, SHA-256
`28dd1f6ac11c4c349598bb39939b4229b8c54fcb998cc300c0c0930b01f64168`.
It pins the following 17 receipts, both protected backup archives and their
receipts, plus the exact private operator source hashes. Paths in this table
are relative to `.local/hosted-content-rollout/`.

| Receipt | Result | SHA-256 |
|---|---|---|
| `h5e-smoke-diagnosis-1793332301372.json` | recorded | `8f6783d6571f0b05cc77f710b4e5ffb20a87a34498367c4e90dc063a06d6f35e` |
| `h5e-smoke-diagnosis-1793332393506.json` | recorded | `0d800f6377bc8cb079271359db7b31f542d5fa7649bcf035111c7fbcae531748` |
| `h5e-smoke-diagnosis-1793333164435.json` | recorded | `46d4b51f68809843a73f851a1003aa8baa875c1034d59421752e22cc78f04aeb` |
| `h5e-smoke-diagnosis-1793333230416.json` | recorded | `9d8b249f612172ad9f8342dbcb1c3695218fa59e460fed5e98af40994c11916a` |
| `h5e-smoke-diagnosis-1793333352626.json` | recorded | `2d9fb8f9e10f26b6da5fc9fa405ba8f6bc51a9309051bde4074562e10fa85d53` |
| `h5i-full-6.json` | passed | `ce8eddbdfe09a1df22980bdfdf326a0dda2fd8fe19e22704d2e826dcd7feb444` |
| `h5e-smoke-gates.json` | passed | `a113cb8848562c452e46f2e563c800a0dacc35def2f06cd5d8cfafaba179b0e3` |
| `h5e-smoke-source-commit.json` | passed | `209bd8f55df78caeaee719a60fa70434ea5d9a44d2555fd7378732a5c8fc707b` |
| `h5e-https-preflight-20261030T044645Z.json` | passed | `cc519f67980021c5db50d04af9c0cc2b7ec730109d32b898c21b2fb8a63f47ab` |
| `h5e-backup_promote-1793335734473.json` | passed | `860d46a3b2db433215761a95fbff456b9372a5337065417939abf1a14871100b` |
| `h5e-promotion-resume-admission.json` | passed | `e4e6f69ef88e3c398e7c81866c77728f22fab6fe484ba304103fa38f88d76e92` |
| `h5e-promote-1793335796356.json` | STOP | `044b49ce858d60c1d2fb6a26707ec5e63f90f9df0e2d614b1a7737caa54a1df1` |
| `h5e-promotion-stop-inspection-20261030T045038Z.json` | recorded | `2106b12854d54a21c32698e81dfae4504ac84294362d40d6079425d7ebffa5cd` |
| `h5e-https-postflight-20261030T045039Z.json` | passed | `487dea0ad6a296166adb45f9886a0d3a6e1f098f713a6b33251caf736971c27b` |
| `h5e-worker-import-stop-20261030T045204Z.json` | diagnosed | `cee08bb2b3ff25499eb6d3bb7382debe524e1edaed72b664f1ebe56d340ef83b` |
| `h5e-promotion-stop-postflight-1793335928746.json` | passed | `d159565ae9a658d12ec1d195b5b5ae54e13a95892b9616a8b90fcd5a723c0eb2` |
| `h5e-promotion-stop-env-scan-20261030T045203Z.json` | passed | `13f09b30a7796df4bf32e0526d5a292e418fcc8a3daae49ee68d577b5eca66d9` |

Protected backups (each directory also has its indexed `receipt.json`):

| Path | Bytes | SHA-256 |
|---|---:|---|
| `.local/backups/h5e-backup_promote-20261030T044701Z/database-before-batch.dump` | 17051334 | `04dd09153911db2f7b04cd545fc027dbb3bb9155e6a15063dbacbfa8cf9b2005` |
| `.local/backups/h5e-vps-promote-20261030T044923104304Z/protected-configuration.tar.gz` | 2938 | `94745b8f8b3efbeec18e191594fc2f17cd966dfdb975c52a2cf7a3754bfae56d` |

The additional root-only unit backup is
`/srv/sena-hub-test/backups/7781704-media-5b9714604a03-h5e-resume-units-20261030T044924Z`.
Its three `0600` unit/configuration files and hashes are recorded separately in
`.local/hosted-content-rollout/h5e-resume-unit-backup.json`, SHA-256
`4f6561e40d2bed8f538214e37669420aa18cd50ee0031065438da815a3aec78e`.
The previous application release and the original unit backup remain available.

Record-only checks before this documentation commit passed: all 709 sealed
source files unchanged; static Auth gate; 111 hosted operator paths with zero
violations; 716 source and 64 browser files with zero credential matches;
`git diff --check`; and `git check-ignore` on both approved local-development
credential files. Receipt `artifacts/hosted-content-rollout/h5e-smoke-stop-record-checks.json`,
SHA-256 `b8df99b17548daac95daadbb9afc6c89eedb5da85cea4940ec0dcd8fa50f211c`. The full-gate results above remain valid for the
unchanged code, but the hosted worker-import smoke remains a STOP.

#### Owner follow-up: production dependency and pre-promotion guards

30 October 2026: the owner authorizes moving `httpx>=0.28,<1` from the dev group
to runtime dependencies, updating the lock with `uv`, adding a frozen production
install/import gate and candidate API/worker self-checks, then quick/full gates,
a new seal, a rebuilt Linux candidate and promotion only. Do not repeat
migrations 79 through 81, the worker login or the env file. The media key stays
absent; after successful promotion, STOP for the owner.

The `uv lock` update moves only the dependency classification; no package
version changes. `test:production` installs the frozen runtime set into a fresh
temporary project/venv, imports all 47 API modules plus the API launchers and
hosted worker launcher (**50 entries**), and creates the API with synthetic
settings without lifespan. Checks block network access, writes and credential
file reads. Pinned public package downloads are allowed during installation;
no service credentials enter that process. Four regressions cover a runtime
import of dev-only `pytest`, forbidden side effects, invalid worker settings,
and valid synthetic worker settings with no connection or provider call.

The worker's `--self-check` uses the same extracted connection validation as
normal startup, including the exact TEST target/login, Session/direct port,
TLS mode and public CA. It exits before connecting. Candidate checks run as
`sena-hub-api` and `sena-hub-media` in temporary hardened units with private
networking. Only the worker self-check unit loads the existing worker env file;
the API self-check uses synthetic settings. Both results are required in
candidate readiness and checked again before the promotion symlink switch.
Startup errors retain diagnostic metadata without values.

Quick gate: **50 production imports and four regressions passed** in
`artifacts/hosted-content-rollout/h5e-production-quick.log`; **14 affected API
tests passed** in `h5e-production-media-quick.log` in the same directory. The
first offline install attempt correctly refused a missing cached wheel; the
normal frozen install fetched that pinned public wheel. The full-gate commands
in the canonical skill and docs/11 now include `test:production`. Full gate,
new seal and hosted receipts follow below. No hosted operation has run in this
follow-up at this checkpoint.

The first full run, `.local/hosted-content-rollout/h5i-full-7.json` (SHA-256
`591835db4acc13fb8d3c0ae093ea9d227e23cd496b8ab8725513bcf4a5868895`), passed
typecheck, offline build, production imports/regressions and **2,151 API tests
(11 skipped)**. The DB tier then refused to start its H5i attestation fixture:
`EADDRINUSE` on `127.0.0.1:55436`. Read-only process inspection identified the
separate DW workspace's PostgreSQL process, PID 27620. It was preserved; no
port substitution or test weakening was made. All other required test ports
were free. Port receipt: `artifacts/hosted-content-rollout/h5e-production-port-check.json`.
The owner was asked to have that process's owner release the port. Following
the failure-loop rule, rerun the failing test once free, then the full gate.
No seal, commit or hosted mutation is authorized by this incomplete run.

#### Owner follow-up: free ports for disposable test listeners

30 October 2026: the owner directs that PID 27620 remain running and that the
test choose its own free loopback port, retrying a bind race. This supersedes
the request to wait for the DW owner above. The attestation and populated
upgrade fixtures now probe `127.0.0.1:0`, close the listener and start their own
SCRAM cluster on the assigned port. Only an address-in-use startup failure
retries (at most five attempts); no competing process is stopped. The Python
attestation bridge checks the actual data directory and matching run marker
before any write, as well as loopback host and the disposable database name.

The repository audit also found fixed H1 database/Auth/API/admin listeners.
Those now use runtime loopback ports carried in the simulation's in-memory
metadata. Synthetic Auth writers and the local migration/rehearsal exception
require the disposable directory and matching marker; the real hosted target
and TLS checks are unchanged. H1 origins remain loopback-only and cannot use
the working service ports. The primary runner's fixed **55432/8000/3000** guards
and branches are unchanged. Remaining literal ports in negative tests and
synthetic configuration examples do not open listeners; production ports and
historical receipts are unchanged.

Quick gate: **89 Node tests passed**, including the bind-race regression,
attestation bridge and populated upgrade; **87 affected API tests passed,
1 opt-in skipped**; **10 H1 smoke tests passed** on dynamically allocated
ports. Typecheck and the static Auth-write gate passed. Logs under
`artifacts/hosted-content-rollout/`: `h5e-dynamic-ports-quick.log`,
`h5e-dynamic-api-quick.log`, `h5e-dynamic-h1-quick.log`. The sandbox-only
Windows account lookup failure was resolved by running with the normal local
test permissions. An initial H1 marker-order failure was fixed by writing
the marker after `initdb`; the focused rerun passed. A clean full gate follows;
the earlier full run remains failed and is not reused for admission.

#### Production dependency fix — clean full gate and seal

30 October 2026: `.local/hosted-content-rollout/h5i-full-8.json` passed the
complete gate on unchanged source. SHA-256:
`0733c4293174eb4f501cabfa838e5720c9e5bbd5bedfce5fd2ccb3130c63df8f`.

| Full-gate tier | Actual result |
|---|---|
| Admin typecheck and offline build | Passed |
| Frozen production install | 50 imports and 4 isolation/dependency regressions passed |
| API | 2,152 passed, 11 opt-in skipped, 6 existing warnings; 944.29 seconds |
| DB | 63 SQL/concurrency checks and 95 Node tests passed; populated upgrade and replay passed |
| Browser | 304 passed in one run, 12.6 minutes |
| H1 | 68 protocol tests, 10 API smoke tests and 45 browser tests passed |
| Credential scan | 722 source files and 64 browser files; zero matches; no credential files read |
| Static Auth and hosted write paths | 81 migrations checked, no Auth writes; 116 operator paths, zero violations |

The tooling-created seal is
`.local/hosted-content-rollout/h5e-production-gates.json`, SHA-256
`5f6bc609364048f1b0810ed2ce9084af12d6f5d998f0339930771486f8d69ffd`.
It covers **715 files**, the exact rehearsal manifests and these regenerated
local Playwright screenshots under ignored `artifacts/hosted-content-rollout/`:
`h5e-ai-editor-1280.png`, `h5e-ai-editor-390.png`,
`h5e-ai-website-1280.png`, `h5e-ai-website-390.png`. No Computer Use was used.
All full logs are `h5i-full-8-*.log` in that artifact directory. No provider
call ran. The code and this evidence are committed and pushed before hosted
candidate staging; the hosted application remains on the rollback release at
this pre-deployment checkpoint.

#### H5e promotion completed — STOP for the media key

30 October 2026: commit **0240315** was pushed before hosted work. Release
**`0240315-media-ee2fbf04e1e9`** is now live on TEST. The candidate's 228 source
files matched manifest SHA-256
`ee2fbf04e1e9aa9ee2de4e336e8f3dd6b947d0364bf38a3e69ffd03237827dab`.
Linux build, frozen production imports, two native broker checks and unit
syntax validation passed. API and worker self-checks passed under
`sena-hub-api` and `sena-hub-media`, both during candidate readiness and again
before switching the live symlink. Each self-check recorded zero network
calls, database connections, provider calls and writes. Candidate readiness
and promotion admission reference the same gate seal above.

Fresh protected database backups were fully read-verified before staging,
building and promotion. Each VPS batch also captured and verified the protected
configuration archive, including the existing worker env file. The application
promotion used **no hosted database write transaction**, so its observed
operator write sets are **`[]`**. Migrations **79–81**, worker-login provisioning
and env-file creation were **not repeated**; the exact hosted prefix remains
**81**. The existing schema/login attestation receipts stay unchanged.

Postflight results:

- API health and admin load passed. Seven HTTPS/TLS checks passed before and
  after deployment; protected consumer/admin endpoints returned **401** to
  anonymous requests. The deployed read-only `ai-state` smoke returned **200**,
  with the expected envelope, **cap US$5, spent US$0, reserved US$0, remaining
  US$5, provider not configured**. BNA7, its website queue and budget remained
  readable under non-bypass `hub_runtime`; it cannot assume the worker role.
- API, admin, worker and broker socket are active. The worker runs as
  `sena-hub-media` and has a fresh heartbeat with `provider_configured=false`.
  The socket is Unix-only, `0660 sena-hub-api:sena-hub-media`, under a `0755`
  API-owned runtime directory. The worker group is exclusive; a wrong peer UID
  was refused. The real private cache is writable by the API and its existing
  file checksum was preserved.
- The worker env file remains regular, nonsymlink, `0600 root:root` and
  **DSN-only**. API/admin have neither worker variable; the worker has its DSN
  and no provider key. The API rejects either worker-only variable at startup.
  Only the worker service and its isolated self-check load that file; direct
  file reads by API, admin, build, worker and nobody users were denied.
- **513 Auth table/role privilege checks** and **504 final function-definition
  checks** passed. The same-run catalog delta is empty. Worker-attributed job
  changes are **zero**, including translation/other queues; image provider
  attempts are **zero**. Current informational boundaries remain zero published
  pages, all pages `no_ai`, and `sena_h_approved=false`.
- H5i security watch: zero new Auth users/identities, no account or assignment
  changes in the observed window. The Supabase `postgres` platform role can
  write Auth tables; this is reported, not a live-data fingerprint STOP.
- Deployed credential scans found **zero matches in 84 browser files and 420
  deployed source/build files**. Protected existing configuration hashes match.
  No signed-in hosted browser or Computer Use was used; the four local
  Playwright screenshots above supply the owner-approved visual evidence.

Rollback release:
`/srv/sena-hub-test/releases/07dda14-content-82bd4feeade5`.
The protected unit backup is
`/srv/sena-hub-test/backups/0240315-media-ee2fbf04e1e9-h5e-resume-units-20261030T100925Z`
(`0700 root:root`); its four files and hashes are in the unit postflight receipt.
The application-only rollback operator is `h5e-production-vps.py rollback`,
preceded by `h5e-production-operations.mjs backup_rollback`; it does not touch
schema. No rollback was needed for this successful promotion.

**STOP:** no media key was added, no pilot ran and no provider call ran. The
owner's exact hidden-prompt instructions are in **Owner media-key steps** above;
their backup commands now reference the sealed production-fix operators. Add
the key only to `/etc/sena-hub-test/media-worker.env`, restart only
`sena-hub-test-media-worker.service`, then report completion without the key
for the read-only postflight. The pilot remains held. No new pending question
is introduced.

The immutable receipt index is
`.local/hosted-content-rollout/h5e-production-deployment-index-20261030.json`,
SHA-256 `c02b25240b350b04306cd9a91e304155554ca7668e0f1f662b7b8d8b33968f0a`.
It pins 18 receipts, six protected archives and their receipts, and four private
operator sources. No earlier receipt or baseline was rewritten.

Receipt paths below are relative to `.local/hosted-content-rollout/`.

| Receipt | SHA-256 |
|---|---|
| `h5e-production-admission.json` | `212a9ea0a407d1eeb6299ab29444176ba12c17c70035d5c35678e034b073b53f` |
| `h5e-production-backup_build-1793354564015.json` | `b92c7cba925b4b9b4254fa0de1f0df43968ff7bb66ac279a092a3ff80101f818` |
| `h5e-production-backup_promote-1793354941776.json` | `2e95615355c640cf05bbfd997bafe1f6801225815b41a0062674998735457b10` |
| `h5e-production-backup_stage-1793354362420.json` | `dc2dd9079265dbb1e1a73a2af759f7d841a77ce0232887c77905bad345587711` |
| `h5e-production-ca-preflight.json` | `4e077860036af04897c9be6bc9e68ca73c99c1bc6b201070ac5dcd7852cbf681` |
| `h5e-production-candidate-readiness.json` | `863bcb1753ca743b9ed8d2b4d406d0d3f2adf2babd3bd36de894dd796255def3` |
| `h5e-production-gates.json` | `5f6bc609364048f1b0810ed2ce9084af12d6f5d998f0339930771486f8d69ffd` |
| `h5e-production-postflight-1793355055079.json` | `2955fc95301925fb0c97a8bfa72f56f1c360d1e69a1e0b808fd527c0ff6d99fe` |
| `h5e-production-promote-1793355006910.json` | `48c0ca4a6739d0403534c67b3737d2d80ed9147eec45a953947a5b3e91dfced4` |
| `h5e-production-source-commit.json` | `61e590c423ace87bf4b92e2d6f72c70b843b5d0ad958aee4f245dc4be9d47992` |
| `h5e-production-unit-postflight.json` | `ba562faac3d9d950c7d154e9df133da35b6e05fcadc8fcfd1126acd8d9051aeb` |
| `h5e-production-vps-build.json` | `9dbba07afd3efd0cfe0e940a40ebcaa34cf81b739e4b1ba061e03da92b7f7e78` |
| `h5e-production-vps-candidate.json` | `de16051fdac6118f2520b1029ce86299747ac1c63f54da1b7076b9dd820b8e44` |
| `h5e-production-vps-promotion.json` | `ebf59829c8a560faeda441566aa4800fe4257e71ce674e3ce9573bd4ff948c32` |
| `h5e-production-vps-source-manifest.json` | `2451236b75c0f26a00f5570f263aac703ea6a862daca1923ab734e0458292992` |
| `h5i-full-8.json` | `0733c4293174eb4f501cabfa838e5720c9e5bbd5bedfce5fd2ccb3130c63df8f` |
| `h5e-https-preflight-20261030T095706Z.json` | `b25446cf24b23adf2049250e00592b193a0ed999da9088a2dd4ff4c2ade4ca2d` |
| `h5e-https-postflight-20261030T101036Z.json` | `8296b369903972e9db57807631a1b75e30d98c06f4fd1a7639c8ec6ce0c6ed6b` |

Protected archive paths are relative to `.local/backups/`; each directory also
contains the indexed `receipt.json` with its verification result.

| Protected archive | Bytes | SHA-256 |
|---|---:|---|
| `h5e-production-backup_build-20261030T100047Z/database-before-batch.dump` | 17051375 | `b50e64d4c2bda3301f78a79f2ca8f7bc5a4c55d249a2db37a2388987e4ed1fec` |
| `h5e-production-backup_promote-20261030T100701Z/database-before-batch.dump` | 17051375 | `91d636fb21857ded31a271329a80439b15e5b5fbd12187149058ba98b19b9f6c` |
| `h5e-production-backup_stage-20261030T095727Z/database-before-batch.dump` | 17051375 | `607157c7fb055554c6433e022629a5e05f4347a784ce916254e092ac62eef73c` |
| `h5e-production-vps-build-20261030T100313200600Z/protected-configuration.tar.gz` | 2938 | `7d12c41cec1215dd2d39888472a5618386f9754372c28bb4c259c10d3bd3c4c0` |
| `h5e-production-vps-promote-20261030T100924554373Z/protected-configuration.tar.gz` | 2938 | `7d12c41cec1215dd2d39888472a5618386f9754372c28bb4c259c10d3bd3c4c0` |
| `h5e-production-vps-stage-20261030T100012043494Z/protected-configuration.tar.gz` | 2938 | `7d12c41cec1215dd2d39888472a5618386f9754372c28bb4c259c10d3bd3c4c0` |

## W1-W5 hosted TEST demo release - 11 November 2026

**Live with owner-approved performance limitations.** Release
`4b00099-media-00f0f23e0fe3` replaces `0240315-media-ee2fbf04e1e9`.
Source is exactly `4b0009972b2fa660f8c0b30fca348bdb127ea407`, materialized
from its commit archive, never main's dirty tree. The canonical 270-file
source-manifest SHA-256 is
`00f0f23e0fe39ef248b3ecce02ea9682a9b52cdb636d01527ec6c051ccb7456d`.
The pinned W5 full-gate receipt SHA-256 is
`eac925d4bfd1e2b76ade92e603422e50773b6e15d22e4dbaf266adb493c8f381`.
W6/W7/W9 and migrations 0089 onward are absent from this release.

### Migration and preservation

Preflight confirmed exact prefix 81, 264 catalog preconditions, fingerprints,
Auth/identity checks, health and protected configuration. The old application
is not fully compatible with schema 88: legacy FAQ mutations, promotion-review
evidence/reasons and publication behavior differ. API/admin therefore entered
maintenance for migration; the worker remained running.

Exact migrations 82–88 committed together at 09:13:58 UTC. **Prefix is now 88.**
All 163 pre-existing application tables compared using their original columns
retained identical row counts and fingerprints. The intended write set was
33 brand-business inserts, one business insert, 34 audit inserts, seven history
inserts and two permission-catalog row updates (plus two HOT-update counters).
No account, grant, content, import, approval, publication or protected setting
was changed by an operator.

| Migration | SHA-256 |
|---|---|
| 0082 | `ada4f2cde77322389dd45d6868effc7c8e3467d773a168483cf3ecf53cbe5c29` |
| 0083 | `2172d2acbfd93e540d1069965cd4e53cbee1963de7a698a3b16880a61ed3e65f` |
| 0084 | `899ad50272191c1e0f1daab09a111b303f920576144a511e182966ff6a19dd8c` |
| 0085 | `c5963feac4f7b61e6e54e8bba496c038a734bfc860d8239f57d94dba94be5817` |
| 0086 | `8b3af3e6f6f19baa84e2b476e80dd2ec7e87606a0951756e0c3fc7cd47af8e9b` |
| 0087 | `cbdc3cd60d9cf9660d0b4ebc34ddb60db883120473fad89cb1253322da91bb4c` |
| 0088 | `f9dcb86198f599a917819976af62f2c0635fbd18b7f322f20c106990bdcbae94` |

The initial admission STOP found that saved rehearsals omitted the 33-row
`hub.brand_business` backfill. Those receipts were preserved. Following the
owner's later instruction to proceed, a new populated disposable rehearsal used
33 synthetic brands and one project, proved preservation/rollback/commit,
and pinned the actual five-relation allowlist and 21 operator sources.
It ran only after W6's runner naturally exited; local test leases did not overlap.
The batched executor retains the committed migration bodies and history hashes.

The first migration attempt rolled back before writes after a preservation-reader
column-array decoding error. A read-only check reconfirmed prefix 81; the corrected
reader passed before retry. After successful migration, FLEXI timed out and the
required post-commit STOP was observed. The owner then explicitly approved the
switch subject to cancellation/health checks and read-only diagnosis. This pause
extended maintenance beyond the planned immediate promotion. No restore occurred.

### Build, backups and postflight

Linux frozen production installation/imports, type generation, typecheck, offline
webpack build and dependency audit passed; two native broker checks passed.
API/worker self-checks passed with zero network calls, database connections,
provider calls or writes. Deployed scans found zero credential matches in
95 browser files and 495 source/build files.

All backup paths below are relative to `.local/hosted-content-rollout/`.
Each archive was fully read back and verified. Prefix 81 was fresh before
migration; a separate fresh prefix-88 backup preceded promotion after the STOP.

| Protected backup | Bytes | SHA-256 |
|---|---:|---|
| `protected-backup-2026-11-11T09-00-14-041Z/database-prefix-81.dump` | 17054560 | `b753b877f3dd6dbe06fd065a0d7bb9668bfe62ca635f3e3e86b1ed17d27ed1fa` |
| `protected-backup-2026-11-11T09-30-09-769Z/database-prefix-88.dump` | 17577154 | `867866f6db939a6145f4d701fe0fe7eee893158232a9f8e368d0bfeb8ef6c040` |
| `protected-vps-20261111T090334Z/protected-configuration.tar.gz` | 6410 | `6bb9b2913c7eb09d37df1c8fc0dd82797853d7e4428d92db6078b74ff2595683` |

Seven trusted HTTPS probes passed: health/login 200; anonymous projects, brands,
admin projects, content home and publication queue 401, all with no-store.
R2 remained 4,221 objects / 1,216,545,739 bytes, inventory SHA-256
`9d4f64941aa97ecd7e3868e3c1e451e640110ad47df537b3626a88cb97b2335a`.
Protected environment, CA, object-store and proxy hashes match. Worker PID 44002
and final worker/broker states match the baseline. API RuntimeDirectory cleanup
removed the Unix socket pathname, requiring stop API, restart the existing broker
socket, start API. No socket configuration changed and the worker was not restarted.
The earlier failed application recovery and successful socket recovery are retained.
Only release references in API/admin units and their cache drop-in changed.

### Requested checks and demo limitation

The established non-listening ASGI operator called exact deployed handlers using
the real non-bypass `hub_runtime`, read-only connections on every checkout, the
existing account's capabilities and the production 15-second command timeout.
No token or signed-in hosted browser session was created. Each requested heavy
route was called once after the switch. Project overview was also checked after
FLEXI and at the end to verify recovery.

| Read | Result | Seconds |
|---|---|---:|
| FLEXI brand, seven projects | Cancelled at time limit | 15.992 |
| BNA7 project immediately afterward | 200 | 3.833 |
| Residential business | 200 | 0.844 |
| Sena Kith brand, 18 projects | Cancelled at time limit | 15.815 |
| BNA7 FAQ | 200 | 0.899 |
| Publishing queue | Cancelled at time limit | 15.889 |
| Approvals list | Cancelled at time limit | 15.847 |
| Home | Cancelled at time limit | 15.843 |
| BNA7 promotions | 200 | 0.819 |
| BNA7 history | Cancelled at time limit | 15.808 |
| BNA7 project at end | 200 | 3.592 |
| BNA7 data | 200 | 4.832 |
| BNA7 submit-all header inventory | Cancelled at time limit | 15.793 |
| Residential header inventory | 200 | 0.609 |

After every request, live API health returned 200, the connection was reusable,
and pg_stat_activity showed no active runtime query, idle-in-transaction session
or lock wait. The final independent session check was empty. Cancellation and
serial recovery passed; this is not a concurrent-load certification. The owner's
conditions for returning to maintenance were not observed.

Project content reads pass but the shared submit-all header shows an error.
Accordingly, project pages join home, brands, publishing, approvals and history
outside the clean demo URL list. Existing account **`entz357@gmail.com`** can open:

- [Login](https://72.62.253.205/login)
- [Residential business overview](https://72.62.253.205/website/business/residential?tab=overview)

Open the direct Residential link after login because the default home route times
out. The account's content approvals and `knowledge.publish_web` remain false.
No accounts or grants were created or changed. Project route identifiers and
individual passing tab checks remain in the receipts for diagnosis, not as claims
of an error-free page demo.

### Read-only diagnosis and options

Live `hub.faq_rule_projects` definition SHA-256:
`3f9355e6f2750ad99c90b33f032f41feb4cf6e6fd63f4d4bfa4f1c14247afc91`.
It contains the 0088 business-membership predicate, ordinary AND clauses for
`faq_project_form` and `business_project_matches`, and no 0089 cheap-predicate
CASE guard. Ordinary AND clauses do not require cheap brand/group exclusions
to run first. W6's measured local fixture recorded 612 rule resolutions,
216,924 business lookups (3.95 seconds), 193,692 form lookups (1.83 seconds),
and 7.48 seconds total FAQ composition in
`artifacts/unified-workspace/w6/api-home-profile-4.log`.
The 0089 CASE rewrite forces cheap exclusions first; its regression proves zero
expensive calls for unrelated brands and correct positive/lost-membership results.

This confirms the same unoptimized function is deployed and strongly supports
the brand-cost diagnosis. Hosted function-level execution was not instrumented,
so exclusive attribution of every timeout is not claimed; home/history may have
additional aggregate costs. No function, source, setting or schema was changed
to diagnose or fix performance.

Options: deliver the optimization with W6 after its gates and DW BUD feed are
ready, or separately review/test/attest a minimal resolver hotfix. Do not edit
applied 0088. A separate CASE rewrite removes current 0089's exact replacement
anchor; coordinate numbering or add an exact prepatched-body guard, then renew
0089 canonical/profile hashes and rehearsal/gate evidence. No hotfix was implemented.

### Rollback and receipts

Application rollback release is
`/srv/sena-hub-test/releases/0240315-media-ee2fbf04e1e9`; protected unit backup is
`/srv/sena-hub-test/backups/4b00099-media-00f0f23e0fe3-w1-w5-units-20261111-demo`.
The reviewed `w1-w5-switch.py rollback` restores application references only.
Keep API/admin in maintenance if the old application is restored against schema
88. Any database restore requires a further owner decision.

Primary receipts under `.local/hosted-content-rollout/`:
`w1-w5-vps-candidate.json`, `w1-w5-vps-source-manifest.json`,
`w1-w5-populated-proof.json`, `w1-w5-populated-attestation.json`,
`w1-w5-migrate-1794388437985.json`, `w1-w5-promotion-promote.json`,
`w1-w5-https-postflight.json`, `w1-w5-20261111-postflight/vps-r2-02.json`,
`w1-w5-preservation-postflight.json`, `w1-w5-heavy-check-1794389700568.json`,
`w1-w5-support-check-1794389822249.json`, `w1-w5-function-diagnosis-corrected.json`,
and `w1-w5-socket-recovery.json`. Earlier STOP receipts remain intact. The deployment
index pins final evidence; this entry supersedes the earlier staged-only handoff.

W6 naturally stopped with six H1 browser failures after API/DB passed. It remains
local and undeployed while those failures are repaired. This rollout did not edit
any of W6's 101 frozen source paths. The extracted release source was moved outside
the repo after W6's operator inventory detected it; that failure/resume is logged
separately in docs/48.


## Owner page-check health-monitor exception — 19 November 2026

This approved exception applies only to the owner's normal page-render check,
not deployments, migrations, backups, imports, cap application or bulk UAT.

The production DW pipeline health monitor may overlap the page sequence and
five-minute tail. Its inspected source runs synchronous systemd queries,
single-record journal reads, container inspection and disk-usage checks; it
does not invoke SQL, refresh, import or backup work. Retained median runtime
is1.4s and maximum3.8793s. Its memory peak is unavailable, explicitly accepted
by the owner as an evidence gap for this check. System-wide pressure STOPs
still cover it. Record each overlapping natural run's start, end and result;
never delay, stop, restart or change the monitor.

All heavy-job exclusions remain:06:00/11:00/17:00 refresh groups, the:20
customer job,:30 backup housekeeping,:39 cleansessions and descendants,
certificate windows and unexpected work. Require actual completion and five
settled minutes. Other jobs, including conditional housekeeping and alert
timers, receive no new exemption. Keep the full existing pressure policy,
all Hub MainPID/cgroup/current/lifetime-peak/events capture before and after,
five-minute tail and one-minute reserve. Never reset peaks.

The owner approved19 November2026,14:45-14:59 Bangkok, with one signed-in
tab waiting from14:40. Give a start signal only after fresh admission and no
later than14:47, with twelve clear minutes remaining until the next excluded
work and reservation end. Skip otherwise. Follow the ten URLs and unchanged
six-minute/slow-page sequence in the local proposal. No cap application or
other hosted change is authorized by this reservation.

Owner no-action note: the monitor's observed exit2 indicates a reported
problem status. The owner will raise it with the DW side. Hub work must not
diagnose or change it.

Review, approval and exact read-only command/evidence receipts are under
.local/hosted-capacity-w9-20261116/interim/:
health-job-admission-review-20261119.md,
owner-page-check-approval-20261119.md, and observations/20261119T041659Z-health-identity.json,
20261119T041820Z-health-actions.json,20261119T042042Z-health-command-shapes.json.
No hosted change occurred during this review.

### Additional monitor approval and skipped occurrence — 19 November 2026

The owner also approved sena-line-alert overlap exactly as proposed in
interim/line-alert-exception-proposal-20261119.md, only for the19November
14:45–14:59 owner page check. Its unavailable memory peak is an accepted
evidence gap for that check, covered by the system-wide pressure STOP policy.
This supersedes the alert exclusion above only for that named job/occurrence.
No other job is exempt; the owner directed a skip if another recurring job
blocks the gap, with no further exception proposal today.

The occurrence was skipped before the owner's14:40 waiting time. The separate
three-minute conditional cgid job remained excluded. Fourteen observed paired
runs had a maximum finish-to-next-start gap of180.335068s, below the1020s
required for five settled minutes plus the twelve-minute operation. Its cron
session scopes demonstrably deactivated, with no remaining matching processes,
but the evidence does not establish the conditional action's no-op outcome.
No permission to overlook that uncertainty was inferred.

The13:09 passive reading found the warehouse healthy/running/not-OOMKilled,
no pressure STOP, swap-out/growth0 and no stall/direct-reclaim/Hub event increase.
These are short passive samples, not page-render peak acceptance. No start
signal, signed-in operator browser, cap application or hosted mutation occurred.
The owner was told not to wait at14:40. The reservation and both monitor
exceptions expired with that occurrence; they do not authorize another window.

Evidence under .local/hosted-capacity-w9-20261116/interim/:
owner-line-alert-approval-20261119.md,
page-check-afternoon-decision-20261119.json,
observations/20261119T060240Z-window-provenance.json and
observations/20261119T060910Z-cgid-condition.json. Exact read-only commands,
source identities, session/cgroup provenance and pressure counters are retained.
The DW health monitor's exit2 remains a no-action note for the owner's DW team;
no diagnosis, restart, schedule or configuration change was attempted.

### Wednesday 25 November release plan — home 0094 included

Planned source includes delivered W9.1 and the owner-approved interim home
projection 202611190094_home_missing_fact.sql, SHA-256
dec0f4ba977d1ab67fb58cc9494675b3970ed3a28962d15fa73d03abcafd5327.
Final source commit/manifest and migration inventory are frozen after Monday
local UAT fixes. Run one combined full gate before promotion; focused delivery
checks are not hosted rollout acceptance. Current TEST remains on schema 88.

This is a plan, not authorization to run hosted mutations. Existing TEST-only
caps must be applied and verified in a separately approved window, followed by
fresh job/pressure admission for rollout. Keep production warehouse read-only,
verify its health and OOM state throughout, and retain the current STOP policy.
Take and read back the protected backup before hosted migrations; verify every
committed migration hash and clean apply, then follow the existing promotion,
postflight and rollback operators. No VPS load/stress test. The below-five-second
300-project home target remains open after UAT; 0094 is an interim improvement.

### Saturday cap proposal and Monday preparation - 20 November 2026

The concrete Saturday 21 November proposal is in [docs/51](51-hosted-test-cap-window.md):
09:45-09:59 Bangkok owner page check, then separately 10:45-10:59 cap application
only after accepted peak evidence, window approval and fresh admission. Both
remain NOT ADMITTED: the recurring cgid job lacks a proven safe gap; the two
19 November overlap exceptions have expired. The approved six-file diff and
2304 MiB aggregate are unchanged. No hosted action was performed.

Monday local pack/runbook: [docs/49](49-unified-workspace-uat.md) and
[docs/50](50-local-uat-runbook.md). One combined full gate follows UAT fixes before
Wednesday rollout, including home 0094. Existing DW BUD-feed decision/readiness
(Q77) remains a prerequisite; local synthetic feeds do not satisfy it or authorize
warehouse TLS/HBA/configuration changes. Backups, migration pins/clean apply,
warehouse health/pressure checks and all hosted STOP rules remain mandatory.

### Owner approval received - 20 November 2026

The standing overlap policy at the start of this document supersedes the
preceding proposal's cgid blocker and expired exceptions. Both Saturday windows
are now approved under that policy and docs/51, subject to fresh admission and
the completed page check/admin peak condition. No hosted check or change was
performed when recording this decision. Skip failed occurrences and propose the
next same-day slot; do not extend a window without approval.
