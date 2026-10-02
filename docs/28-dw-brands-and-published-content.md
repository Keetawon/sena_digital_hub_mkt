# DW brands and published Hub content

Decision: 2 October 2026. Brand intake is authorized **locally only**. Hosted H1
keeps fictional identities under [doc 27's real-data default](27-hosted-test-environment.md#6-synthetic-seed-and-acceptance-sequence).
No real brand package, local database dump or `.local` directory goes to hosted
TEST before the owner confirms with the data owner. Migrations contain schema
and guards only; hosted seed inputs remain explicitly synthetic.

## Reviewed local brand dictionary

The DW report is
`sena_idea_mkt_data_warehouse/docs/REM_BRAND_DICTIONARY.md`; it identifies the
review package `data/rem-brand-export/20261002T071912690927Z/`.
The Hub importer pins manifest SHA-256
`1512ac0bac74f5356617458b30bf2079896cce18db54393b5244c136ae54f877`.
It verifies both payload hashes, byte sizes, column sets and row counts before
connecting. The complete package has 38 brands (36 active deletion flags, one
deleted, one unknown) and four exception records. Thirty-five brands have
residential references. IDs remain exact text, including leading zeros.

```powershell
uv --cache-dir .cache/uv run --project apps/api python scripts/stage-dw-brands.py
uv --cache-dir .cache/uv run --project apps/api python scripts/stage-dw-brands.py --apply
```

Dry-run is the default. Apply accepts no connection override: the only target
is `127.0.0.1:55432/sena_hub_local`, checked against server identity. Preserve
original bytes in ignored `.local/dw-brand-intake/<manifest-sha256>/`; conflicting
archived bytes refuse. One transaction stores the original manifest, brands and
exceptions in immutable private `staging.intake_batches` and mirrors every brand
in `staging.rem_brands`. Exact replay verifies the original batch and all mirror
fields, returns `already_staged`, and preserves the first import time. Drift or
failure rolls back all database changes. The shared pilot advisory lock serializes
the two intake commands.

The only permitted overlap enriches the two reviewed September pilot batches
(`59391f30…` and `79188d16…`). Verify each previous mirror against its immutable
batch and require unchanged ID, Thai/English labels, deletion flag, brand code
and raw source dates before replacing its source evidence. The old batches remain
immutable. Unreviewed overlaps or changed business values stop the whole import;
this is not a recurring upsert/refresh or retirement workflow. No Hub content,
draft, mapping, publication pointer, asset, company, project or model is changed.

`is_deleted` is three-state: false means a nondeleted source flag, true means
deleted, null means unknown. Source Thai names may be null or blank; review rows
are retained. Neither source status nor residential usage establishes marketing
approval. Raw REM create/modify timestamps retain their original wall-clock text
and unconfirmed timezone; `source_updated_at` remains null. `source_snapshot_at`
is brand extraction time, **not export/import time**. Project-reference freshness
bounds, aliases, original quality flags and usage policy remain in `source_record`.

## Staff source picker and Hub ownership

`GET /v1/admin/sources/brands` retains its staff-only guarded RPC. It adds
`deletion_status`, `residential_project_count`, the separate nondeleted count
and `exception_codes` from the matching immutable batch. Earlier residential
pilot/synthetic mirrors fall back to their staged project-reference count.
Batch evidence itself remains private. Missing-dictionary project exceptions stay
in the batch; they never create a fabricated brand row.

“ดูแบรนด์จากต้นทาง” defaults to brands referenced by residential projects and
offers all dictionary rows. Each card shows Thai/English source labels, exact ID,
deletion status, residential count and text exception badges. The DW count uses
`C`/`H` references excluding Solar containers `B2B`, `B2C`, `B2G`, including
closed/deleted projects; the UI states this qualification. Search includes both
source languages and the ID. Empty, loading and retry states remain Thai.

Only admin can call `hub.create_brand_from_rem(text)`; deleted and unknown rows
fail at the database guard as well as disabling UI actions. Creation copies only
`rem_brand_id`. Public names/descriptions start as `{}`, slug as `''`, logos empty
and publication pointer null. Marketing supplies public content through the
existing draft and asset workflows. Admin retains no publisher bypass. Existing
Hub edits are never refreshed from source labels.

## Verification

The real package was imported locally at `2026-10-02T07:56:42.357604+00:00`.
The immediate exact replay returned `already_staged` with the same timestamp.
All 38 mirrors have null normalized source modification time; 35 have residential
references, 36 have active deletion flags, one is deleted and one unknown.
Before/after row-count and SHA-256 checks preserved all 41 other Hub/staging/audit
tables and the full rows of every previous immutable intake batch. Real package
bytes and this local receipt are ignored artifacts, not repository fixtures.

The importer tests use invented records and disposable localhost databases. They
check pinned manifests, hashes/counts, text keys, deletion lineage, raw source time,
transaction rollback, exact replay, immutable evidence, bounded predecessor
enrichment, unchanged Hub content and admin/unknown/deleted creation guards.
Browser coverage checks both 1366×768 and 390×844, default/all usage filtering,
Thai/English search, count/status/exception badges and role controls.

```powershell
$env:HUB_INTAKE_TEST_DB='1'
uv --cache-dir .cache/uv run --project apps/api python -m unittest discover -s tests -p test_stage_dw_brands.py -v
```

Local brand-intake verification on 2 October 2026:

| Check | Actual result |
|---|---|
| Pinned dry-run, real local apply and immediate replay | Passed; 38 brands / four exceptions; replay preserves import time |
| Importer tests with `HUB_INTAKE_TEST_DB=1` | Five passed, including fresh synthetic bootstrap |
| Admin typecheck / production build | Exit 0; existing Google Sans fallback warning |
| Full API suite | 1,204 passed, 11 skipped, one existing Starlette warning in 186.90 seconds |
| Opt-in promotion database test | One passed, rollback-only synthetic fixture |
| `npm.cmd run test:db` | Exit 0; all SQL/RLS/concurrency checks and two existing DW fixture tests passed |
| Full Edge UI suite | 162 passed, 14 H1 checks skipped in local mode, exit 0 in 8.1 minutes |
| `npm.cmd run test:hosted-h1` | Ten runner/mock checks and 14 Edge checks passed on isolated localhost; schema/profile replay and synthetic seed verified |

Logo fixtures now explicitly prepare their public names through the Hub draft
workflow; the final full UI run passed after correcting that former source-name
assumption. The real package was never copied into the H1 simulation or hosted
TEST. Neither the fixture checks nor the local source dictionary approve real
published content for hosted use.

## Published-content export contract v1

Migration `0027` adds `hub_export.brand_published` and
`hub_export.project_published`, following the private `ads_export` view pattern.
Each returns **one current, consumer-eligible immutable publication per entity**.
Draft changes never supply a field. Unpublished, withdrawn, deleted, expired,
source-ineligible or rights-ineligible content is absent under the existing
`public_api` eligibility rules. This is a current snapshot, not all publication
history or a deletion/change feed. DW consumers must reconcile the complete
snapshot; absence does not destroy the Hub's immutable history.

Both views have exactly eight columns, in this order:

| Brand column | Project column | PostgreSQL type / meaning |
|---|---|---|
| `rem_brand_id` | `rem_project_id` | `text`; exact frozen source ID, retaining leading zeros |
| `public_brand_id` | `public_project_id` | `text`; stable Hub public identity |
| `public_name_th` | `public_name_th` | `text`; published Thai public name |
| `public_name_en` | `public_name_en` | `text`; published English public name, nullable |
| `slug` | `slug` | `text`; published slug, never the current draft's slug |
| `published_version_id` | `published_version_id` | `uuid`; exact selected immutable version |
| `published_at` | `published_at` | `timestamptz`; original version publication time |
| `logo_roles_present` | `logo_roles_present` | `text[]`; sorted distinct roles present in that published snapshot |

Logo roles are `favicon`, `logo_mono`, `logo_primary`, `logo_white`; an empty
array is represented as `[]`, not null. The project column describes the
**brand logo set frozen into that project version**. Publishing a new brand
version does not silently change an older project's names, version ID or logo
roles. Rollback exports the selected earlier version's original ID and timestamp;
`published_at` is neither rollback time nor source freshness.

These projections exclude drafts, descriptions, arbitrary payload JSON, source
records, actor IDs, asset IDs/URLs/storage keys/files and rights/approval evidence.
They grant no file access or RPC execution. A `security_barrier` view owned by
the new NOLOGIN/NOINHERIT, non-superuser `hub_export_owner` reads only the needed
public view columns and the project's publication pointer columns under RLS.
The reader cannot assume this owner role or read `hub`, `staging`, `audit`,
`public_api`, `internal` or `rag` directly.

Grant USAGE on `hub_export` and SELECT on the two named views to the existing
`ads_export_reader` group. The existing `dw_hub_reader` login inherits them with
its **same sole group membership**, two-connection limit and read-only default.
It receives no base-table, column, schema-create or write grant. The verifier
checks both exports and private ACLs with the read-only default disabled; that
default supplements actual grants. Local provisioning still rejects any target
except `127.0.0.1:55432/sena_hub_local`; no hosted reader was provisioned here.

Extract both views together, optionally alongside the 15 `ads_export` views,
using the existing DW login in **one REPEATABLE READ, READ ONLY transaction**:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT * FROM hub_export.brand_published ORDER BY public_brand_id;
SELECT * FROM hub_export.project_published ORDER BY public_project_id;
COMMIT;
```

DW destination names are `hub__brand_published` and `hub__project_published`
under source key `hub`. Preserve strings and nullable English; do not fall back
to REM labels, drafts, inferred translations or a newer live brand logo set.
Fixture column nullability comes from PostgreSQL's view catalog, not sample rows
or a guarantee about business-required publication fields.

## Frozen synthetic export fixtures

The [fixture package](../supabase/tests/fixtures/hub_export/README.md) has two
UTF-8 JSON arrays plus a manifest: two published synthetic brands and one
synthetic project, 16 columns across the two views, three rows total. The new
fixture IDs begin `00000-HUB-EXPORT-` to exercise leading-zero text transport.
The prepared standard `DEMO-BRAND-01` is the second brand. No real dictionary row
or package byte is included.

```powershell
npm.cmd run dev:dw-reader
npm.cmd run dev:hub-content-fixtures -- --seed
node --test supabase/tests/hub_export.test.mjs
```

`--seed` creates only the named invented localhost examples through existing
admin/editor/publisher functions, including individual rights reviews. Seed replay
preserves existing work; incomplete, withdrawn or conflicting fixtures refuse
rather than reset. Registry metadata is sufficient for this SQL contract fixture;
the generator does not write or export asset files.

The exporter reads the **complete eligible view sets** through the real DW login.
A privileged read-only session first verifies their exact synthetic source
identities and public text in the same exported PostgreSQL snapshot. Real staged
brands may coexist locally, but any unapproved/non-synthetic published export row
refuses fixture output; nothing is silently omitted or relabelled. Manifest
checks cover original bytes, SHA-256, row counts, exact ordered columns/types,
UTC capture time, source Hub commit, every applied migration and generator hashes.
Portable LF-normalized checks supplement the applied workstation hashes.

The unchanged 15-view financial fixture remains in `fixtures/ads_export`.
This additive package has its own `hub-published-content-v1` contract and does
not change the financial fixture's frozen snapshot.

Published-export verification on 2 October 2026:

| Check | Actual result |
|---|---|
| Local migration and DW reader provisioning | Exit 0; existing login reads all 17 export views and cannot assume the new owner |
| Synthetic fixture generation and exact schema/hash checks | Two views, three rows; two contract tests passed |
| `npm.cmd run test:db` after migration `0027` | Exit 0; SQL/RLS/concurrency checks and all four financial/content fixture tests passed |
| Brand and published API regression checks | 74 passed; one existing Starlette warning |
| Final `npm.cmd run test:hosted-h1` | Ten runner/mock tests, 27-migration managed-permission replay and 14 Edge browser tests passed on isolated localhost |
| Real local dictionary replay after export checks | `already_staged`; original `07:56:42.357604+00:00` import time preserved; no real Hub draft or publication created |

The H1 inventory verifier now recognizes the ninth schema and separate view-owner
role at migration `0027`, while retaining earlier migration inventories. The final
browser run waits for the replacement favicon filename before examining its
previews, avoiding an assertion against the earlier desktop fixture during the
mobile upload. No hosted database was contacted or changed.
