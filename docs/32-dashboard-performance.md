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
