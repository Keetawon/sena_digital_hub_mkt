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

The former label **“ชื่ออ้างอิงโครงการ” means `slug`**, an editable URL-friendly content identifier such as `flexi-example`. Staff supply it; the current app does not generate it from a source name or code. It is not a REM name, commercial name, ProjectID, or automatically verified business alias. The public API continues to use immutable `public_project_id`. Show **รหัส URL (slug)** in the collapsed **ข้อมูลประกอบและการเชื่อมต่อ** section with an explanation; source/public names occupy the main form.

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

Use three tabs instead of repeating a long checklist in the sidebar:

| Workspace | Staff task |
|---|---|
| ข้อมูลโครงการ | Edit the ordered form, then project images and master plan immediately below it; complete the amenities section; company/source integration metadata is collapsed and secondary |
| แบบที่อยู่อาศัย | Choose/confirm the project, then view and expand a Marketing type to edit details, images/plans and source associations. Keep exact REM models available in a separately labelled source/review section; commercial draft save does not confirm canonical mappings |
| เผยแพร่และประวัติ | Review missing requirements, asset rights, mapping state and publication/version actions |

Keep project context visible across tabs. Separate sections with headings and text chips for source, editable content and review status; do not rely on color alone. Use visible field labels, Thai help/error text, clear focus, keyboard-operable navigation and comfortable mobile controls. The numbered tabs stay visible while scrolling and preserve unsaved fields. **บันทึกข้อมูลร่าง** saves in place; **บันทึกและไปต่อ** saves successfully before moving to Marketing types, then a separate next action opens readiness. Failed saves keep the draft and current section. Project and canonical-model media can be uploaded, attached or removed while project text is unsaved; media changes preserve the text draft and advance its saved revision only when the server's editable text is unchanged. Conflict reloads containing another editor's text retain the old revision and local input so a later save cannot silently overwrite them. Main form saving and other active detail editors still block conflicting media actions. Changing project warns before discarding unsaved changes. Tabs group work; they do not force staff to complete every model before returning to project details. Exact REM model inspection is collapsed beneath the Marketing types by default.

Project images belong directly below details because staff usually describe and illustrate the same project together. Model images/plans belong with their selected model, reducing accidental attachment to the whole project. Upload, draft save, rights approval, model confirmation and publication are separate actions. Originals are retained; attachments do not bypass review or become public immediately.

The project media flow is **choose purpose → select files → caption each file → upload and append to draft**. Each purpose supports multiple files: hero, thumbnail, master plan, building/floor plan and brochure. Existing-library selection appends one compatible file without replacing an earlier binding. New files are processed sequentially with visible per-file results and retry for unfinished items; successfully attached files remain when later items fail or the queue is closed. An uploaded file that is not yet attached stays in the private library. Main project text remains unsaved and intact until its separate draft save. Project plans and type plans remain separate scopes.

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
