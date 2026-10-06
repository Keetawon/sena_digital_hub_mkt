# 17 — Project form, models and plan relationships

Decision date: 18 September 2026. Scope: Thai staff back office, current HYABC pilot; the seven-project residential target is unchanged. This updates the project-editing flow in the older [03 — User Flows](03-user-flows.md). [REQUIREMENTS.md](../REQUIREMENTS.md) remains the implementation contract.

**20 September extension:** [18 — Marketing types and amenities](18-marketing-types-and-amenities.md) separates commercial types from canonical REM models, adds Marketing-supplied amenities, and places company in secondary source context. The ordered project fields and recorded Gold intake below remain valid. The new draft catalogue/media increment must not be mistaken for implemented commercial-type publication, verified unit partition or complete spatial/FAQ management.

## Names and source boundaries

**3 October, phase A — coordinates:** migration `0029` treats latitude outside
5.0–21.0 or longitude outside 97.0–106.0 (inclusive) as a named missing item in
the existing publication readiness function. Null coordinates remain missing;
all other rules and permissions stay the same. The form validates the same bounds,
accepts a pasted `lat, lng` pair in either coordinate field, and offers **เปิดใน
Google Maps** for a valid pair. Saving an incomplete draft through the API is
still permitted; the database publication gate enforces the bounds. Synthetic
seeds use Bangkok example coordinates 13.7563, 100.5018. Source evidence and
existing immutable publication versions are not rewritten.

Phase A verification: typecheck and production build passed; full API suite
**1,273 passed, 11 skipped** with `HUB_COORDINATE_TEST=1`; `test:db` passed all
SQL/RLS/concurrency and five fixture-contract tests; six project-form browser
tests passed. Isolated H1 passed ten runner/mock tests, all 29 migration replay
checks and 14 browser tests. Checks used a disposable local cluster, leaving the
working data directory untouched. The existing Google Sans build warning and
Starlette deprecation warning remain. Published export fixtures were refrozen
from the disposable synthetic seed with the updated generator and migration hashes.

The former label **“ชื่ออ้างอิงโครงการ” means `slug`**, an editable URL-friendly content identifier such as `flexi-example`. Staff supply it; the current app does not generate it from a source name or code. It is not a REM name, commercial name, ProjectID, or automatically verified business alias. The public API continues to use immutable `public_project_id`. Show **รหัส URL (slug)** after the eleven ordered rows in **ข้อมูลหลัก**, followed by the ad disclaimer and brand binding. All main fields stay expanded.

REM owns ProjectID, BrandID, internal names, group and operational relationships. `gold.dim_project` combines these with commercial enrichment from the governed commercial Sheet. Its `commercial_brand` label does not replace the actual REM BrandID link. Marketing edits the Hub public wording; source evidence remains read-only.

## Ordered project fields

Keep this exact row order on desktop and mobile. Labels below correct the spelling in the request without changing its meaning. All source fields are from `gold.dim_project` unless stated otherwise.

| Order | Staff label | Source default | Behavior |
|---:|---|---|---|
| 1 | แบรนด์ | `commercial_brand` | Read-only check |
| 2 | รหัสโครงการ | `project_id` | Read-only exact source ID |
| 3 | รหัสกลุ่มโครงการ | `rem_project_group_id` | Read-only REM group |
| 4 | ชื่อโครงการไทยจาก REM | `project_name` | Read-only |
| 5 | ชื่อคอมเมอร์เชียลที่ใช้สื่อสาร (ไทย) | `commercial_project_name` | Editable Thai public name |
| 6 | ชื่อโครงการ (English) จาก REM | `project_name_eng` | Read-only |
| 7 | ชื่อคอมเมอร์เชียลที่ใช้สื่อสาร (English) | `commercial_project_name_eng` | Editable English public name |
| 8 | ที่อยู่โครงการ (ไทย) | `moo + soi + road + subdistrict + district + province + postcode` | Editable, concatenate nonblank components with spaces |
| 9 | ที่อยู่โครงการ (English) | `moo_eng + soi_eng + road_eng + subdistrict_eng + district_eng + province_eng + postcode` | Editable; Gold has no `postcode_eng`, so reuse the shared postal code |
| 10 | ละติจูด | `latitude` | Editable source default with correction provenance |
| 11 | ลองจิจูด | `longitude` | Editable source default with correction provenance |

Do not replace missing English content with an invented translation. Address concatenation must preserve zero-valued components and omit only null/blank values. The source house-number fields exist but were not included in the requested default; staff can add approved wording in the editable address. Gold's preformatted address may prefer `full_address` even when it is only a project name, so use the requested components.

## Defaults and source verification

- Accept exact-project verified snapshots with source payload, fingerprint, snapshot time and verification provenance. Repository SQL or a local REM relay proves a contract/source observation; it does not prove the current live Gold row.
- Commercial scalars are null when non-null variants disagree. Retain variant/conflict metadata; do not choose an arbitrary commercial label or silently substitute a REM name.
- New drafts can initialize from verified Gold values. For existing drafts, preview **เติมค่าเริ่มต้นจาก DW** and apply it explicitly only to untouched missing fields or unchanged historical REM-default names. Saved Marketing edits and deliberate clears survive the application. Require both the expected draft revision and reviewed source fingerprint; reject stale writes. Saving a draft does not approve source semantics or publish it.
- Missing commercial defaults remain visible gaps. Original REM names are still available for checking, with their correct origin. Coordinates remain unknown when the source pair is missing/invalid; do not invent a map location.
- The local Gold path is bounded snapshot intake, not recurring DW synchronization. The user supplied HYABC project JSON and 13 model rows through chat; the reviewed result is now staged locally. Receipt/import is not a direct live DW query, an applied draft prefill or approval to publish.

The local source contract is private `staging.dw_projects`: exact `source_record`, fixed `source_relation = gold.dim_project`, `source_snapshot_at`, SHA-256 `source_fingerprint`, and provenance. Staff responses expose nullable `gold_source`; consumer payloads do not expose this private evidence. `POST /v1/admin/projects/{public_id}/prefill` receives `updated_at` and `source_fingerprint`. Name provenance distinguishes `unset`, `dw_default`, historical `rem_default`, and `marketing_override`. A missing verified snapshot disables Gold default application.

## Workspace flow

Phase B (3 October 2026) orders work by publication blockers. The eleven field rows above retain their approved order on desktop and mobile.

| Tab | Staff task |
|---|---|
| ข้อมูลหลัก | Eleven ordered rows, then slug, ad disclaimer and brand binding. Expanded throughout. Source values are compact read-only text; missing Gold values fall back to the existing REM mirror with **จาก REM**, including the original `project_name_en` evidence when available. No invented values and no duplicate source/brand section. |
| รูปภาพ | Project media and existing rights status/review controls. |
| แบบที่อยู่อาศัย | REM table first: name, ModelID, confirmation, complete required specs and plan count. A row opens the existing model form in place. Media remains scoped to that selected model. Marketing commercial types follow with **ยังไม่ออก API**. |
| ข้อมูลเสริม | Optional compact amenity table and SEO fields. A selected radio is the status; no duplicate chip. Amenities never block publication. |
| เผยแพร่และประวัติ | Existing readiness, named field links, publication and history. No bottom save bar. Publish confirmation compares only published-content fields with the live version, using the brand comparison layout. |

Each tab shows a check or missing count from existing readiness; REM models also show confirmed/total. The empty readiness state is **พร้อมเผยแพร่ · ไม่มีรายการค้าง**. Versions without a live pointer show **ถอนการเผยแพร่แล้ว**; live content with a changed saved payload shows **มีการแก้ไขที่ยังไม่เผยแพร่**. Comparison excludes source/audit metadata, rejected models and optional draft modules. A failed history read prevents confirming a misleading comparison. No database function, role, RLS or publication rule changes in B.

History shows the publisher role. Model confirmations show known local actor roles; legacy/imported identities without a staff directory display **ผู้ยืนยันแบบ**. UUIDs remain in immutable evidence/API data, not the human-facing attribution. This is a role label, not an invented display name.

Tabs preserve unsaved text; save-and-continue advances only after a successful save. Project and model media can change while project text is unsaved, preserving local input and concurrency revisions. Other active editors block conflicting writes. Inline model edits preserve validation, revision-conflict handling and discard confirmation. The mobile save bar is one compact row. The assistant trigger has reserved space in the editor, so it cannot cover the language chip or sticky tabs. Upload, save, rights approval, model confirmation and publication remain separate actions.

Phase B verification: typecheck, production build and `test:db` passed. Full API:
1,273 passed, 11 skipped. All 70 relevant browser cases passed (68 in the broad
run, then the two updated legacy selectors passed focused reruns). Coverage
includes comparison, withdrawn/pending labels, role attribution, mobile overflow,
keyboard navigation, optional amenities, media revisions, source selection and
read-only viewers. Tests used the disposable local database. No hosted fixture
or migration changed in this phase; H1 was not redeployed or reseeded.

### Phase C design — project progress

The staff-only project list gains the brand dashboard's summary tiles and table
treatment. Counts may overlap: a live project can also await publication or need
attention. Missing fields come directly from `hub.snapshot_readiness` via the
existing project detail; there is no new percentage or publication criterion.
Amenities are a separate, optional collection count. Viewers can inspect and
follow field links but cannot create or edit.

`GET /v1/admin/projects/progress` reads every visible Hub project and the existing
REM picker mirror, without the old card list's 100-row cap. It reports new REM,
incomplete, awaiting-publisher, published and attention counts, grouped named
gaps, confirmed/total models and update/age metadata. Awaiting publisher includes
ready unpublished changes and pending asset rights. Attention uses the **live
snapshot's** brand and hero/thumbnail IDs, with current brand withdrawal and
rights status/expiry (within 30 days), plus explicit source deletion/inactivity.
Unreviewed numeric REM status codes are not interpreted as active or inactive.

The existing source-list function adds only read-only age metadata, retaining
its signature, actor check and execution ACL. Known first-seen metadata takes
precedence; otherwise use the earliest immutable intake receipt for that project,
labelled **ใช้เวลานำเข้าสำเนาครั้งแรก**. Legacy rows without an intake receipt show
**ไม่ทราบวันนำเข้า** rather than treating export/source dates as import dates.
No source, Hub content, mapping, publication, RLS or role is changed by the read.

Phase C verification: typecheck and production build passed; full API **1,293
passed, 11 skipped**, including read-only PostgreSQL checks for all four staff
roles. `test:db` passed, including unchanged execution ACLs/private intake denial,
earliest receipt selection and Gold preview regression. All 14 relevant browser
cases passed (dashboard, field links, real local viewer response, project form
and shared brand tiles/CSV). The CSV case now uses a synthetic seed rather than
depending on real DW brand 35. Local H1 passed ten runner/mock tests, all 31
canonical migrations/replay checks and 14 browser tests. No hosted changes.

The first active hero, thumbnail or brochure remains its role's primary binding. Adding files does not change it; removing it promotes the next ordered active binding. Plans remain collections. Duplicate project attachment of the same file to the same role is an idempotent no-op with the current project revision, retaining the existing caption and order. Brand-logo replacement and canonical-model duplicate rules remain unchanged. Originals, rights checks and immutable published snapshots retain their existing protections.

Facility rows expose native radio boxes for **มี / ไม่มี / อยู่ในแผน / ยังไม่ทราบ** immediately. Selecting a status opens that row's Save/Cancel controls; notes are optional disclosure fields, and a planned status exposes its expected opening date. Unknown is distinct from confirmed absence. Row saves remain explicit and block conflicting project/type mutations until saved or cancelled.

Commercial types use an expandable summary/editor with explicit save/cancel. Multiple plan files are uploaded inside the editor with order, house-floor labels and stated sub-type applicability; use a dialog for library selection or a large preview. Preserve unsaved changes across expansion/navigation. “Add as a set” creates independent draft types, not a new level of the hierarchy. Company is reference-only here; location, product form and physical structure remain the primary project context.

## Plan hierarchy and same-code variants

| Information | Owner/context | Relationship |
|---|---|---|
| Project master plan | Project, optionally phase | Project `master_plan` asset; later phase applicability through project nodes |
| Building/floor plan | Project + building/tower + floor(s) | Drawing applies to one or several spatial nodes; reuse a typical plan instead of duplicating its file |
| Model layout drawing | Canonical `(ProjectID, ModelID)` | Implemented model `floor_plan` asset role |
| Model structural drawing | Canonical `(ProjectID, ModelID)` | Implemented separate `structural_plan` asset role; not collapsed into a floor plan |
| Marketing type sales plan / multi-storey house plans | Separate commercial type | New draft-media relationship with order, floor label and stated applicability; a sales plan is not a verified assignment to every source model/unit |
| Different layout for the same ModelID | Model layout variant | Own drawing/revision plus explicit building/floor applicability; preserve canonical REM identity |

The existing `hub.project_nodes` tree requirement supports phase/building/floor and low-rise zone/cluster structures. A layout variant records the relevant canonical model and/or commercial type, with separate applicability links to nodes; it is not a new fake REM ModelID. Several nodes may use one variant and a node may contain several models. Exact mappings should later use project/tower/floor source keys, not names or floor numbers alone. A text floor label on a draft upload is not implementation of those verified spatial links.

Detailed variant assignment is secondary. Initial project/model attachments must not claim building/floor applicability that has not been captured. Never infer identical plans from a shared name or infer a variant from a different area alone. Distinct real REM codes, including L/R codes, remain separate source identities even if their commercial wording matches.

Asset owner, effective dates, rights review and versioning apply to plans as to images. Keep approved releases immutable; draft attachment changes do not alter previously published content. Removed/expired/restricted assets remain subject to the existing serving gates.

## Additional autofill candidates

| Gold metadata | Recommended use |
|---|---|
| Project status, commercial type/subtype, district/zone | Optional classified content with source labels; do not infer taxonomy equivalence |
| Opening/completion dates, `total_unit`, area components | Source suggestions for review; master total and current inventory counts are different measures |
| Website/LINE links, CMS ID, sales email | Optional contact/integration metadata; no website implementation is implied |
| Variant/conflict flags, coordinate validity, source/load timestamps | Staff diagnostics and freshness, not customer copy |
| Model `model_ids`, names, type IDs, area range, `model_attribute_variant` | Source-assisted review while preserving each canonical ModelID; not automatic specification approval |
| Available-price statistics and availability counts | Operational read-only information with freshness; project averages are not “starting prices” |

`gold.dim_project_model` is grouped by exact trimmed active `(project_id, model_name)`. It can combine several technical IDs, so use its `model_ids` array for lineage and never substitute its surrogate key for a REM ModelID. Missing approved bedrooms/bathrooms/area definitions remain content gaps.

## HYABC evidence and remaining handoff

Read-only local relay inspection verified file SHA-256 and row counts against these DW manifests:

- `data/rem-project-relay/rem_project_dimension_20260918T091457Z.manifest.json` — HYABC group `C-FLEX-STCRN`, brand `25`, company `HSP`, 479 master units, status `2`, empty latitude/longitude, populated Thai/English address components. Its full-address fields contain only the project name. Thirteen active model records have distinct matching model names/IDs.
- `data/rem-unit-relay/rem_unit_dimension_20260918T091618Z.manifest.json` — 479 HYABC units, all with raw deletion flag false, 13 distinct model IDs, towers `248`/`249`/`250`, and 21 tower/floor pairs. This proves reuse across locations, not differing drawings.

These observations come from local files in `sena_idea_mkt_data_warehouse`, **not a successful live `gold.dim_project`/`gold.dim_project_model` query**. They do not supply commercial Sheet values. The separately received Gold result below is operator-provided evidence; existing immutable REM pilot evidence and drafts are preserved.

### Operator-provided Gold result

The user supplied the full HYABC project JSON and 13 model rows through chat, preserved in ignored `.local/pilot-intake/gold-hyabc-chat-20260918/project.json` and `models.json`. The supplied values identify commercial brand `FLEXI`, REM brand `25`, company `HSP`, and group `C-FLEX-STCRN`. Each of the 13 commercial model groups contains one technical model ID; all have type `CON1` and `model_attribute_variant = false`, with raw area values spanning 25.2–64. The model unit totals sum to 479. Latitude and longitude are null. These are received source values, not publication approval or a newly verified live connection.

Retain the pasted Thai strings exactly, including missing marks in values such as `เจรญนคร` and `กรงเทพมหานคร`. Do not silently repair source evidence or merge it with the differently spelled REM relay. The source owner should verify the transfer/source text; any approved Marketing correction belongs in the separate editable public field.

The intake is for **source staging only**. The existing HYABC draft contains correctly spelled Thai wording; preserve it instead of replacing it with the received text. As of the 20 September form update, safe defaults appear automatically in previously untouched empty inputs as **unsaved suggestions**. Staff must review the supplied values and resolve text issues before saving. All mappings remain subject to human review and nothing is published by intake.

The supplied project has `available_unit_count = 33`, matching the model-row sum of 33. However, project `available_priced_unit_count = 40` differs from the model-row sum of 33. Reconcile the definitions before making commercial availability/price claims. The inspected code uses raw ITF available status for project price aggregation and effective supply-state eligibility for model pricing; that is a possible explanation, not a verified reconciliation of these supplied rows.

The actual export time was not supplied: `captured_at` remains **null/unknown**. Recorded `received_at = 2026-09-18T10:55:06+00:00` is explicitly the first agent UTC observation while processing the handoff, not the time the user ran SQL. The project and all model rows carry source snapshot `2026-09-18T09:16:18.194837+00:00`. The project warehouse load time is `2026-09-18T09:32:35.236568+00:00`, and model rows carry `2026-09-18T09:32:35.233597+00:00`; neither is an export timestamp.

**Local staging verified at `2026-09-18T11:03:00.565570+00:00`:** 13 Gold model groups were stored and exact replay returned `already_staged`. Combined source fingerprint: `ba7779ba5c92a51666a3f1342165da5ae5e4dac08a30b3b78e6697b805d76173`. The ignored handoff folder retains `receipt.json`, `provenance.json`, `before-state.json` and the supplied JSON files. JSON key ordering/formatting was normalized while preserving values; Thai spelling was not corrected.

Before/after verification found no changes to HYABC/KUBON/B_PO Hub projects or models, any Hub brands, or REM project/model staging. **No draft prefill, mapping confirmation or publication occurred.** Staff see three quality warnings: Thai text review, the 40-versus-33 priced-unit discrepancy, and missing coordinates. Human text review and approved coordinates remain necessary; successful technical staging does not clear those warnings.

The scoped queries for repeatable handoff are:

```sql
SELECT to_jsonb(p) AS project_source
FROM gold.dim_project AS p
WHERE p.project_id = 'HYABC';

SELECT project_model_key, project_id, model_name, model_name_eng,
       model_ids, technical_model_count, model_type_ids,
       minimum_model_area, maximum_model_area, model_attribute_variant,
       source_snapshot_at, warehouse_loaded_at
FROM gold.dim_project_model
WHERE project_id = 'HYABC'
ORDER BY model_name;
```

The full project row contains business contact/integration metadata; retain it as private source evidence, not automatically public content. Record export time when known and source provenance when handing it to the local intake. If export time is unknown, preserve that fact and record receipt time separately. A returned row still needs technical verification before it becomes an available default; it does not approve publication.

### Local snapshot intake

Save the first query's JSON value as one project object (a one-object array is also accepted), without a surrounding `project_source` property. Save all model rows as one JSON array. Keep `model_ids` and `model_type_ids` as JSON arrays, not JSON-encoded strings. The source `source_snapshot_at` must retain its verified timezone offset; a timezone-free value blocks intake until the DW owner confirms its timezone. Do not substitute export time or attach a guessed offset.

Run validation first. The example below is for a handoff with a known export time; its timestamp must be replaced with the actual export time and must not be used to invent one for the chat-supplied result:

```powershell
uv run --project apps/api --cache-dir .cache/uv python -B scripts/stage-gold-project.py --project .local/pilot-intake/hyabc-gold-project.json --models .local/pilot-intake/hyabc-gold-models.json --captured-at "2026-09-18T16:00:00+07:00"
```

For a handoff with unknown export time, use **`--received-at` instead of `--captured-at`**. The following validates the preserved chat handoff using its recorded processing receipt time; it keeps `captured_at` null:

```powershell
uv run --project apps/api --cache-dir .cache/uv python -B scripts/stage-gold-project.py --project .local/pilot-intake/gold-hyabc-chat-20260918/project.json --models .local/pilot-intake/gold-hyabc-chat-20260918/models.json --received-at "2026-09-18T10:55:06+00:00"
```

After reviewing the export, the same command with `--apply` stages only into local `127.0.0.1:55432/sena_hub_local`. It retains original bytes and hashes, checks brand/company references and the complete technical model-ID set against reviewed REM staging, and refuses a conflicting existing snapshot. Exact replay is harmless. Source snapshot time remains separate from the operator's export time. A failure commits no partial database snapshot; the preserved input evidence may remain for investigation.

This command does not edit Hub drafts, confirm mappings, publish content, query the live DW or implement recurring refresh. The HYABC result is already staged with the outcome recorded above.

### Unsaved defaults and guided form update — 20 September 2026

Migration `202609200012_project_gold_preview.sql` adds staff-only `gold_prefill_changes`, calculated by the same helper as explicit prefill. Opening the editor overlays these suggestions in the form without writing to the database. Existing Marketing values, deliberately cleared saved values, other locales and source identity checks remain protected. Serializing an untouched empty field does not count as a meaningful edit. Valid coordinates are suggested as a pair; HYABC has neither in the supplied Gold snapshot and displays missing-coordinate help instead. The original Thai source-quality warnings remain visible. Preview metadata is excluded from consumer publication payloads.
