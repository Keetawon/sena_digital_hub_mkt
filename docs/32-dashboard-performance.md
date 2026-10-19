# 32 — Dashboard performance and source group names

Local follow-up, 6 October 2026. No publication or hosted deployment.

## Measurement contract

Production `next build` + `next start`, current local working data, viewer role.
API: one warm-up and 20 sequential loopback requests, response including body.
Browser: five fresh Edge contexts; interactive means the first project disclosure
has responded to a click. This is an operational interaction measurement, not a
Lighthouse TTI score. Baseline: p95 3,339ms, 2,338,111 bytes/279 rows, page maximum
4,236ms. Evidence: ignored `.local/dashboard-followup/before.json`.

## Summary contract

Maintain a private, rebuildable progress projection from the existing readiness
function. Cache population uses a set-based query over mirrors and Hub records,
without `hub.project_detail()`. Coalesced deferred invalidations refresh affected
identities in the same transaction after saves, publication, bindings, rights,
source imports and knowledge reviews. No original data or readiness rules change.
Validity deadlines also refresh once when crossed; ordinary loads reuse stored
readiness. Staff permissions remain enforced; consumers and agencies get no access.

The server filters/sorts/paginates the cached projection; tiles and REM-status
counts have their own response. List rows contain readiness/completeness counts,
not model lists. Full Hub checklists load only on expansion; source rows aggregate
model confirmation/specification counts. Preserve exact source IDs and flags.

Private list images are 96px WebP derivatives created during upload/import and
backfilled locally for existing files. Never fetch an original as a thumbnail
fallback. Missing/unsupported derivatives use the existing initials fallback.
Placeholders reserve the fixed image and dashboard space without animation.
PNG/JPEG/WebP inputs are decoded with Pillow, EXIF orientation applied, metadata
stripped and resized without upscaling. SVG/PDF do not fall back to originals;
they currently use initials in lists. The original-file editor remains available.
`scripts/backfill-local-thumbnails.py` verifies originals and the fixed working
cluster before generating missing derivatives; it does not update asset rows.

The stored summary is separate from its private rebuild inputs. List loads select
only summaries with the checklist arrays removed; detailed checklist reads select
one exact source identity. Filtering, faceting and page selection run in the API;
the browser does not download the entire project or group collection.

## Item 2 measured result

Same working data (33 brands, 4 Hub projects, 110 Hub models, 279 source projects,
6 asset rows, no project publications). Only migration 0040 and six private
derivatives were applied locally; no seeds or draft edits.

| Measurement | Before | After | Target |
|---|---:|---:|---:|
| Loopback API p95, 20 requests | 3,339ms | 56ms | <500ms |
| JSON bytes per default page | 2,338,111 (279 rows) | 10,561 (10 rows) | <300KB |
| Fresh-page interaction, maximum of five | 4,236ms | 1,489ms | <2,000ms |
| Server summary function p95, 20 read-only calls | 1,812ms | 18ms | diagnostic |

The function comparison executes the original `432752b` implementation and the
new implementation against the same migrated local data, without modifying it.
Loopback timings include serialization/HTTP; function timings exclude those and
are measured separately. These are local results, not a Mumbai/Singapore latency
simulation. Item 2 HTTP/browser samples: `.local/dashboard-followup/{before,after}.json`.

Verification: admin typecheck/build passed; 203 related API regressions and the
four final cache/derivative smoke checks passed; full DB suites passed; 19 relevant
production UI specs passed. Earlier full API runs found the cleanup assertion and
JSON operator-precedence issues, both corrected and covered by the passing focused
runs. The full combined API/UI suites will run again with the remaining follow-ups.

## Item 3 status labels

Dashboard and source-picker filter options use `<raw code> <Thai label> (<count>)`.
Null uses `— ไม่ทราบสถานะ`; unknown non-null codes retain their exact raw value.
Counts and default-scope semantics are unchanged.

## Optional marketing-group dictionary (item 4)

`project_groups.json` is an additive extension of the reviewed DW package. Older packages remain valid.
The intake verifies its six columns, bytes, SHA-256, row count, exact text identifiers, member array
and offset-bearing source timestamp before connecting. It archives the original bytes with the other
payloads. A private mirror stores the first name and provenance; immutable evidence records later
changed/missing rows for review. Omission of the optional file does not mark groups missing.
No group membership, Hub mapping, draft or publication is created or changed by the dictionary.

Staff summaries join the accepted Gold `marketing_project_group_id` to the dictionary, displaying
`<id> · <Thai name>` (an explicit missing-name label when unknown). REM codes remain in source details;
different nonblank REM/marketing codes get a mismatch flag without being joined or repaired. Source
identity conflicts remain in their separate review bucket. Group membership outside the residential
package and missing dictionary references are reported as named evidence issues, never auto-created.
Group evidence/mirror writes invalidate the existing cached summaries in the same transaction.

The 6 October extension manifest is `89ccfc35f045b13d82005f0967c7c3d04c74e3a5dccfa429c1169b33ac8fc737`.
All five existing business/exception files are byte-identical to the approved 5 October package.
Its 118 groups contain no outside-package members or missing marketing dictionary references.
Three membership differences (`00412`, `00401`, `01401`) match the already recorded
`GOLD_PROJECT_IDENTITY_OR_GROUP_CONFLICT` exceptions. They remain flagged with Gold prefill disabled.
Any dictionary membership conflict without such explicit prior evidence stops intake.

Local intake result: 118 new dictionary mirrors/evidence rows. Existing projects (278), retained
raw models (3,427), Gold projects (278) and Gold model groups (3,178) were identical no-ops;
the 89 previously discarded models remain excluded. Exact package replay returned `already_staged`.
Protected Hub brand/project/model/version/asset-link fingerprints were identical before/after.
The local dashboard has one exact REM/marketing code mismatch: `00412`,
`C-MIBF-BNGPU` versus `C-MIGD-BNGPU`. No mapping was repaired.

Item 4 verification: typecheck and production build passed; 9 offline importer contract tests;
full API 1,390 passed / 11 skipped, then 41 final intake/progress checks passed; full DB suite
and all 204 production UI tests passed. Evidence is under ignored `.local/dashboard-followup`.

## Final verification after group intake and H1 profile update

All local services were restored. The production build was measured again with group names loaded:
API p95 **82ms**, **12,966 bytes / 10 rows**, maximum interaction time across five fresh browser
contexts **1,153ms**. All three targets pass. Raw samples: `.local/dashboard-followup/final.json`.
A separate read-only replay on this final dataset compares original `432752b` server code with the
cached summary: p95 **4,597ms → 37ms** (`server-times.json`). This diagnostic repeats the legacy code
on the final intake history; it is distinct from the original pre-change HTTP baseline.

H1 `npm.cmd run test:hosted-h1`: 10 runner/mock tests, all 41 migrations under the managed-permission
simulation, immutable checksum/replay/ACL checks and 15 UI tests passed. No hosted requests or writes.
The default synthetic project is visible with explicit status 2; agency access remains denied.
The final admin typecheck passed. Existing Google Sans fallback and Python deprecation warnings remain.

Read-only screenshots (visually checked): `.local/dashboard-followup/projects.png`, `projects-table.png`,
`sidebar.png`, `sidebar-mobile.png`, `groups.png`. No browser page errors were recorded.

## SVG and PDF thumbnail follow-up

Upload, knowledge intake and guarded local backfill use the same derivative installer. Sanitized
SVG bytes are checked for canonical sanitizer equality again, then rasterized by resvg at a maximum
96px edge; no raw SVG, script, external href/image/style or resource directory reaches the renderer.
Transparency is preserved in WebP and displayed on the existing neutral list tile. PDFs pass the
existing inactive-content/page-count validation and render only page 1 at 96px with PDFium. PDFium
calls are serialized within a process, including handle cleanup; no form/JavaScript environment is
initialized. Raster image behavior and the staff-only thumbnail endpoint remain unchanged.

Rendering failures do not reject an otherwise valid original. A private checksum-keyed
`thumbnails-v1/<checksum>.failure.json` records the reason code, exception type and UTC attempt time;
logs use only checksum/MIME/code/type, never filenames, URLs or exception messages. A successful retry
removes the failure marker. Backfill reports created/existing/failed/missing-or-invalid-original counts
and a reason per failed checksum, preserving all originals and database records. No request-time
rendering or original-file fallback. Storage failures also retain the fallback and are logged.

Renderer APIs: [resvg](https://resvg-py.readthedocs.io/en/latest/api.html),
[PDFium rendering and threading](https://pypdfium2.readthedocs.io/en/stable/python_api.html).

Validation: admin typecheck/build passed; full API suite 1,400 passed / 11 skipped; disposable
database checks passed; 13 upload/logo/thumbnail UI tests and 15 H1 loopback UI tests passed.
The first focused run exposed two old assertions assuming the storage directory contained only
the original; those now verify the original plus derivative explicitly. Local backfill found
6 existing derivatives, 0 created, 0 failed and 0 missing/invalid originals. All 8 original files
in the local store retained their SHA-256 hashes. No database records or hosted data changed.

## Hosted projection follow-up — 19 October 2026

The owner reported slow pages after the approved content transfer. The Singapore
VPS was healthy (four cores, low load, about 14 GB available memory). Its local
login route responded in 7–13 ms. Supabase is in `ap-south-1`; a warm database
round trip from the VPS was about 63 ms. These login/SQL timings are diagnostics,
not signed-in page-loading measurements.

The principal measured bottleneck was introduced by the permission projection in
migration 0047: `(hub.progress_permission_projection(c)).*` expands a composite
function once for every returned column. This repeated the same nested permission
and content-redaction work for each project. The read-only comparison returned
identical 278 rows, while PostgreSQL execution fell from 3,300 ms to 375 ms when
the function was evaluated once through a lateral join. The running application
query took 3.616–4.072 seconds from the VPS; one observed browser navigation from
Brands to the Projects table took 10.072 seconds, including automation overhead.

Migration `202610190056_project_progress_projection_once.sql` changes only that
query shape. It retains `require_permission`, transaction-local actor checks,
dirty/expired cache refresh, the existing security-definer search path and grants,
and the same asset/hidden-tab redaction function. No additional account or content
cache is introduced. The rows and count endpoints still make separate requests;
both benefit from this shared fix.

The regression in `supabase/tests/project_progress_cache.sql` compares every
projected field and uses transaction-local function statistics to require exactly
one projection call per row under `hub_app`, without a timing-dependent test.
Existing API tests exercise direct SQL/RPC denials and hidden Brands/Knowledge
fields using the real non-superuser runtime login. The hosted profile pins the
new migration checksum and accepts only its reviewed 55-to-56 upgrade.

Migration 0056 was applied to TEST after all local gates passed and a fresh
protected `pg_dump` was verified. Backup:
`.local/backups/hosted-progress-performance-20261019T070233Z/supabase-before-performance.dump`
(8,472,832 bytes; archive inventory checked). All 278 runtime-projected rows were
identical before/after. Account, permission and Auth-user fingerprints, function
grants and security-definer settings were unchanged. BNA7 remained present;
82 project drafts, 33 brands and 11,102 Knowledge candidates were retained, with
no publications or reviews created. A missing actor was still denied.

The database fix exposed another avoidable delay in hosted requests: `/api/hub/*`
performed Supabase user verification in both the page proxy and its route handler,
and `/api/hub/v1/me` fetched the same account twice within one request. The page
proxy now delegates Hub API authentication to the existing route handler. That
handler still refreshes cookies, verifies the exact bearer with Supabase `getUser`,
and fetches fresh Hub account authority; FastAPI independently validates JWTs and
Hub permissions. The `/v1/me` handler reuses only the account response already
obtained within that same request. Responses remain `private, no-store`; there is
no cross-request authorization cache. Page navigation checks are unchanged.

Frontend release `794d9cd-perf-2777ff8998ca` passed the Linux build and private
preview before promotion. Only the two hosted Next request paths changed from
the previous running frontend. The API process, credentials, public routing and
content stayed unchanged; the previous frontend and service unit remain available
for rollback.

| Observation | Before | After |
| --- | --- | --- |
| Project summary query, VPS to Supabase, two samples | 3.616–4.072 s | 0.540–0.835 s |
| Projects full reload, same signed-in browser | 8.345 s | 5.227 s / 4.838 s |
| Brands to Projects, same browser | 10.072 s | 5.711 s |

Browser timings run from navigation/reload to the visible project table and
include automation overhead. These are small-sample observations, not p95 or load
test results. After both changes the page still showed the same 193 default-scope
projects and ten data rows per page; the Brands view also loaded successfully.
The intermediate DB-only browser results were 10.402 s on its first reload and
6.255 s on the next; the final browser measurements above include both fixes.
The remaining roughly five-second page load still warrants future profiling;
this is not a claim that every page or concurrent-user load is optimized.

Validation before the DB deployment: typecheck and offline production build;
API **1,884 passed / 11 skipped**; **52 DB scenarios + 8 Node checks**; UI **257
passed**; local H1 **11 Node + 43 browser checks**; migration-runner **9 passed**.
The later two hosted-only Next changes passed fresh typecheck, offline build and
the complete H1 suite (**11 Node + 44 browser checks**), including API-only cookie
refresh, forged-bearer rejection, fresh status on the next request, one account
lookup per `/v1/me` request and the existing outage/unsaved-input checks. API, SQL
and local-mode behavior did not change in that follow-up. The Linux production
build and dependency audit also passed (zero reported vulnerabilities). No UI/H1
test was skipped or retried. The 11 API skips were the existing opt-in modules:
`test_actuals_import`, `test_archive_db`, `test_assistant_db`,
`test_assistant_model`, `test_assistant_tools_db`, `test_demo_finance`,
`test_document_worker`, `test_hosted_h1`, `test_hub_demo`, `test_promotions_db` and
`test_residential_seed`. Six existing Starlette/Pillow warnings remain.

Ignored execution evidence is under `.local/performance-fix-20261019/`:
`deployment.json`, `frontend-gates.json`, `promote-frontend.log`,
`final-measurements.json` and `projects-after.png`, alongside the test/probe logs.
No commit or push was requested for this follow-up.

### Follow-up: remove the remaining startup request waterfall

The owner correctly flagged that the observed roughly five-second load was still
slow. The next pass removes work on the critical path without adding a permission
cache or altering database grants:

- The hosted root layout passes only the bounded navigation projection from its
  existing, request-scoped `getHubAccount` read. `AccountDirectory` consumes this
  once after hydration, allowing the workspace to start without another blocking
  browser `/v1/me` request. Polls, focus and account-change events still fetch fresh
  authority. Account form fields and the bearer are never serialized in this prop.
- `view=dashboard` returns the paged Projects rows and existing count/filter
  metadata from one authorized `hub.progress_rows` call. The separate historical
  views remain supported. The UI uses this combined response; it contains no new
  detail or hidden-tab fields.
- The hosted API forwarder verifies the exact bearer with Supabase `getUser`,
  then forwards the requested operation directly. FastAPI still independently
  verifies JWTs and loads current Hub authority for every operation. The redundant
  HTTP `/v1/me` preflight is removed from ordinary forwarded requests; server
  navigation continues to read `/v1/me`. Its ten-second timeout and distinct
  401/503 handling remain covered. This supersedes the first release's reuse of
  its preflight `/v1/me` response described above.
- API transactions still use `SET LOCAL ROLE hub_app`. Setting the actor and
  agency transaction-local values shares one parameterized query, saving a
  database round trip while retaining the same role switch and RLS enforcement.

Release `794d9cd-perf2-e78be5d8bee9` is deployed to the TEST API and frontend.
The existing migration 0056 is unchanged; this pass applied no migration.
Both services passed readiness checks and anonymous API access remains denied.
Protected configuration is unchanged. The existing private thumbnail cache was
copied and hash-checked into the new release's real cache directory; no R2
originals changed. Previous releases and service units remain available for
rollback, with units saved under
`/srv/sena-hub-test/backups/794d9cd-perf2-e78be5d8bee9-units`.

| Browser observation | Before this pass | After this pass |
| --- | --- | --- |
| Brands to Projects | 5.711 s | 11.167 s, first navigation after restart |
| Projects full reloads, in observed order | 5.227 s / 4.838 s | 8.109 s / 3.589 s / 2.877 s |
| Projects to Brands | No comparable baseline | 3.773 s |

The final two repeat Projects loads improved to 2.9–3.6 seconds, but the first
two post-restart requests took 8–11 seconds. The first-load delay is unresolved
and its cause has not been established. These small-sample timings include
browser automation overhead; they do not establish p95, concurrent-user
performance or full-site optimization. Projects still showed the same 193
default-scope records and ten data rows per page. The browser was returned to
the Brands view after verification.

Validation: API **1,888 passed / 11 skipped** (the same opt-in modules listed
above); **52 DB scenarios + 8 Node checks**; UI **257 passed**; H1 **11 Node + 45
browser checks**; typecheck, offline production build, Linux production build
and dependency audit passed (zero reported vulnerabilities). The API run used
`-qq`; its count was checked from the complete progress markers and successful
disposable-run completion. The full UI run reported all 257 tests passed with
cleanup complete, but its outer PowerShell session returned exit 1. A focused
Projects rerun passed **8 tests** with the native exit code explicitly captured
as 0. No UI/H1 test failed, was retried or was skipped. Six pre-existing API
warnings remain.

The final two hosted-only forwarding changes followed the full API/DB/local-UI
gates and passed fresh typecheck, offline/Linux builds and the complete H1 suite.
API and local-mode behavior were unchanged by those last two files. The new
checks cover the combined projection's equality and hidden-tab redaction,
next-request permission revocation, one browser dashboard request, no redundant
hosted account preflight, server-seeded startup and fresh focus/status updates.
SSH transport interrupted earlier build/promotion attempts; the successful
Linux build has an explicit zero-exit receipt. Promotion used a separately
uploaded reviewed script, and the old live services were verified intact before
that successful promotion.

Before/after read-only checks confirmed unchanged account and permission
fingerprints, BNA7 present, and unchanged totals: **1 account, 82 project drafts,
33 brands and 11,102 Knowledge candidates**. No content, account or permission
mutation was needed. The earlier verified database backup remains at the path
recorded above; this pass did not require a new migration backup.

Ignored evidence is under `.local/performance-followup-20261019/`:
`gates.json`, `promotion-file.log`, `data-before.log`, `data-after.log`,
`final-measurements.json`, `projects-after.png` and the individual test/build
logs. Previous frontend state is retained in
`.local/hosted-performance2-previous.json`.

Repository checkpoint, 19 October 2026: after reviewing these results, the owner
requested commit and push. The checkpoint includes the earlier hosted sign-in,
private R2 and content-transfer changes alongside both performance passes, so
the repository captures the tested deployment. All 160 sealed application/test
source hashes still match the final gates. A fresh local comparison of 691
source/browser files against the protected credentials found zero matches.
Credentials, backups, imported data, screenshots, logs and generated build
outputs remain excluded from Git. This checkpoint does not resolve or conceal
the first-load performance limitation above.
