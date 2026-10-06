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
simulation. Raw samples: `.local/dashboard-followup/{before,after,server-times}.json`.

Verification: admin typecheck/build passed; 203 related API regressions and the
four final cache/derivative smoke checks passed; full DB suites passed; 19 relevant
production UI specs passed. Earlier full API runs found the cleanup assertion and
JSON operator-precedence issues, both corrected and covered by the passing focused
runs. The full combined API/UI suites will run again with the remaining follow-ups.
