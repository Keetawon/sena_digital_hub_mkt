# 14 — First residential intake review: KUBON and B_PO

**Historical intake — selection superseded on 18 September:** the user now wants **HYABC only**, replacing KUBON/B_PO for current intake. See [16 — HYABC intake and current status](16-pilot-intake-hyabc.md). The records, counts, original selection, review and staging event below describe the earlier work; they are retained as evidence, not instructions to re-add these projects. The overall seven-project Phase 1 target remains unchanged.

**Preservation update:** local preflight found existing unpublished KUBON/B_PO drafts created after the original staging event, with 63 and 33 unconfirmed models respectively. Those drafts, their source mirrors and original evidence were retained unchanged when HYABC was added. They are outside the current pilot plan, not deleted or retroactively uncreated.

Reviewed source date: **17 September 2026, 22:45:39–22:45:42 Asia/Bangkok** (15:45:39–15:45:42 UTC). The user selected these two ProjectIDs for the first residential intake. The original package records source evidence and technical review, without import, human-confirmed crosswalks or publication at extraction. **It was subsequently staged locally on 18 September**, as recorded in the [staging update](#local-staging-update--18-september); human mapping approval and publication remain pending.

**Terminology resolved, recorded 18 September:** the user confirmed “Unit Type” means the model/floor-plan code. Use REM `(ProjectID, ModelID)` for that identity. See the [business terminology resolution](#business-terminology-resolution); the later investigation of the separate UnitTypeID column remains historical evidence, not a blocker for these model identities.

## Exact project, brand and company mappings

| Exact REM ProjectID | REM Thai project name | REM English project name | Source BrandID / brand | Project-recorded CompanyID / company | Model rows |
|---|---|---|---|---|---:|
| `KUBON` | โคซี่ รามอินทรา - คู้บอน | COZI RAMINTHRA - KHUBON | `36` — โคซี่ / Cozi | `THP` — บริษัท เสนา เอชเอชพี จำกัด | 63 |
| `B_PO` | นิช โมโน บางโพ | Niche MONO Bangpo | `000003` — นิช โมโน / Niche MONO | `A17` — บริษัท เสนา เอชเอชพี 12 จำกัด | 33 |

Company English names are `SENA HHP CO.,LTD.` (`THP`) and `SENA HHP 12 Company Limited` (`A17`). These are the companies referenced by the two project records, not a claim that each company owns an entire brand.

Both `ProjectCode` values are null: the user-provided `KUBON` and `B_PO` are the actual `ProjectID` values, not substitutes for that separate code field. The two projects, two brands, two companies, all 96 model rows and both referenced model-type rows explicitly have `isDelete = false`. This establishes source status at extraction, not sales availability or publication approval. Raw `ProjectStatus` is `1` for KUBON and `2` for B_PO; no customer-facing interpretation is assigned here.

## ModelTypeID and ModelArea findings

The live source catalog identified **`dbo.Sys_REM_Master_ModelType`**, and both referenced keys resolved exactly:

| ProjectID | Model rows | ModelTypeID | Exact source ModelTypeName | Raw project-model ModelArea range | Distinct raw area values |
|---|---:|---|---|---|---:|
| `KUBON` | 63 | `CD` | คอนโด | 24.00–34.50 | 7 |
| `B_PO` | 33 | `CON4` | คอนโดมิเนียม 7-37 ชั้น | 27.00–90.00 | 22 |

`CD.ModelTypeNameEng` is `Condo`. `CON4.ModelTypeNameEng` contains the same Thai wording as its Thai name; it is preserved without inventing an English translation. The source type labels describe a building/property category, not an approved bedroom classification. In particular, the `CON4` label is not evidence of B_PO's actual floor count.

All 96 **project-model** `ModelArea` values are present and positive. Both **type-master** `ModelArea` values are null. They are different fields at different grains and must not substitute for one another. No unit or authoritative business definition was found in the inspected source metadata. Preserve exact decimal strings; do not fill `usable_area_sqm`, land area, bedroom count, or any other approved specification from these values yet.

`CON4.ModifyDate` is null. It remains null; the extraction timestamp does not replace it. Source datetime timezone also remains unverified, so source create/modify values have no invented timezone conversion.

The source provides 96 technical model identities, each keyed by `(ProjectID, ModelID)`. Model names in this package equal their respective codes. No models were merged by name, code prefix, apparent area, or the DW's grouped commercial-model table. All source rows remain in the package, and all 96 mapping candidates remain `SUGGESTED`, with `verified_by` and `verified_at` null.

## Package and provenance

The original package also has a later, separately checksummed UnitTypeID investigation; see the [follow-up below](#unittypeid-follow-up). Original source files, manifest and model mappings were not rewritten.

The review package is local and Git-ignored:

`.local/pilot-intake/20260917T154542567868Z_KUBON_B_PO/`

| File | Contents |
|---|---|
| `projects.json` | Two exact project identities and source brand/company references |
| `brands.json`, `companies.json` | Referenced dictionaries, original names, raw status and source timestamps |
| `models.json` | All 96 model records with complete keys, type references and raw areas |
| `model_types.json` | The two referenced type-master records |
| `review.json` | Automated checks, one source-timestamp flag and 96 unconfirmed mapping candidates |
| `queries.sql` | Fixed source-context and scoped SELECT statements |
| `manifest.json`, `manifest.sha256` | Source context, extraction times, counts, row/file checksums and provenance |
| `REVIEW.md` | Thai-readable summary and complete per-project model tables |
| `technical-review.json` | Separate agent technical review tied to the manifest checksum; not human business approval |

Manifest SHA-256: `59391f30f3c31c4d999e11c5dbeacb875bfe2a9f4eb2e8a7e36f0b1029c78d08`.

The initial DW connection probe was unavailable. Under the user's REM/DW read authorization, the extract used the DW repository's existing REM connection for **direct SELECT-only source reads**, with connection errors sanitized and no credentials in the package. Runtime `DB_NAME()` verified `SENA_PRD`. The DW reference checkout was verified as `1505dcb295c755fcec8ed54d4918db8595bd6221`, project snapshot contract version 3, with reference-file hashes recorded. No REM/DW data, source configuration or Hub database was changed.

The source database has snapshot isolation and read-committed snapshot disabled. Two complete reads returned identical fingerprints, and separate source row-count checks matched for all five datasets: **2 / 2 / 2 / 96 / 2**. This verifies observed stability across the short extraction window, not a transactionally atomic point-in-time snapshot. No isolation setting was changed.

This package uses its own `sena_hub_residential_intake_review` version 1 contract. It is **not** a complete DW relay batch and must not be passed to the existing project relay loader. The earlier preparation directory ending `154336538667Z` is superseded because its provenance labels were not verified at runtime; use only the package identified above for this review.

## Verification and reproduction

The offline verifier checks manifest and file hashes, row fingerprints, dataset/key definitions, extraction timestamps, row counts, complete-read equality, exact project scope and pending human approval state:

```powershell
python -B scripts/prepare-pilot-intake.py --verify .local/pilot-intake/20260917T154542567868Z_KUBON_B_PO
python -B -m unittest discover -s tests -p test_pilot_intake.py -v
```

The four focused tests cover scope/duplicate rejection, preservation of leading zeros and nullable/deleted states, unresolved references, exact decimal handling, and prevention of automatic mapping approval or area conversion.

The original extraction used `scripts/prepare-pilot-intake.py` with the existing DW Python environment and sibling DW repository as working directory. **The helper now extracts the current HYABC scope**, not these superseded selections; offline verification above still supports this historical package. New extraction creates a separate timestamped package without replacing this evidence, importing Hub data or publishing. Credentials must not be passed as command arguments or copied into the Hub repository.

## Intake and publication gaps recorded before the selection change

These were the outstanding steps for the original two-project selection. Current work follows the [HYABC review](16-pilot-intake-hyabc.md); KUBON/B_PO are no longer scheduled for current intake.

1. Record human confirmation of each technical model's mapping and intended residential presentation before publication; staging can retain unconfirmed candidates. Codes and area values alone do not establish a public model name, bedroom count or residential marketing eligibility for every variant.
2. Have the source/business owner confirm the meaning and unit of project-model `ModelArea`, or provide an approved specification source. Keep its raw value until then.
3. Resolve the missing type-master modification timestamp policy and source datetime timezone without inventing source data. Decide how optional source timestamps are carried alongside mandatory extraction timestamps.
4. **Local staging completed 18 September:** migration 007 and the pinned intake adapter retain evidence and brand/company relationships without creating drafts or approving mappings. Recurring ingestion must still use the approved DW handoff; this one-off direct-read snapshot is not the production architecture.
5. Supply and approve public names, descriptions, logo/image rights and other required content before publication. Complete the remaining five pilot ProjectID selections separately; the overall seven-project scope is unchanged.

See [13 — Source identity and field ownership](13-source-field-ownership.md) for the governing rules and [11 — Local development](11-local-development.md) for what the application currently implements.

## UnitTypeID follow-up

After the user identified `UnitTypeID` as a possible project unit classification, read-only REM checks at **22:58–23:01 Bangkok on 17 September** established:

| Finding | Verified result |
|---|---|
| Field exists | `dbo.Sys_REM_ProjectModelOtherData.UnitTypeID`, nullable `nvarchar` |
| Source row identity | Primary key `ID`; the table also has `ProjectID`, `ModelID`, `Name`, `NameEng`, `Amount`, `GroupID`, status and timestamps |
| KUBON other-data rows | **0**, in both a direct read and a separate per-project count |
| B_PO other-data rows | **0**, in both a direct read and a separate per-project count |
| Status filtering | No deletion or active-status filter was used; zero rows are not the result of excluding inactive records |
| Separate table | `dbo.Sys_Master_UnitType` has key `(SBUID, UnitID, UnitType)`; the exact `UnitID + SBUID` join to pilot units returned no matches |
| Lookup relationship | No declared UnitType foreign key was found. The generic `Sys_Master_AllType` `UnitType` group is candidate evidence only; it does not establish the intended UnitTypeID join |

The first review's `ModelTypeID` findings remain valid but do not answer the user's UnitTypeID question. Likewise, the DW alias `unit_type_commercial = ModelName` is not proof of the actual classification source. Neither `CD`/`CON4` nor bedroom counts should be copied into UnitTypeID.

At the time of that follow-up, the intended business meaning was unresolved: the inspected source relationships supply no UnitTypeID values for these two projects. This does not establish that the field is unused elsewhere. The user's subsequent clarification resolves the intended meaning as model/floor-plan code, as recorded below. The original 96 project-model identities remain valid source evidence.

Evidence is appended as `unit-type-followup.json` with `unit-type-followup.sha256` in the original package directory. The supplement includes query text, schema/key evidence, zero-row results, independent counts and hashes of its captured source files; its parent manifest checksum matches the unchanged original. It is not part of the original manifest's five datasets, and the extraction helper still covers those five datasets only. Other-data attributes would need a separate verified contract if required later; they are not required to identify the business-confirmed model/floor-plan codes. No Hub import, approval or publication was performed.

## Business terminology resolution

Recorded **18 September 2026**, based on the user's answer: “Model or floor-plan code: A1-1 / A2-1 / B1-1.”

| Business concept | Source mapping | Treatment |
|---|---|---|
| Unit Type / model / floor-plan code | `dbo.Sys_REM_ProjectModel.(ProjectID, ModelID)` | Authoritative project-scoped identity; retain the exact code |
| Internal model label | `ModelName` / `ModelNameEng` | Preserve separately; coincidentally equals the code in these 96 rows |
| Public model name | Hub `public_name` | Marketing-owned wording, separately reviewed |
| Broad REM model category | `ModelTypeID` (`CD` / `CON4`) | Separate category; never replace ModelID |
| Additional REM attribute | `Sys_REM_ProjectModelOtherData.UnitTypeID` | No pilot values; not required for this clarified concept |
| Actual saleable unit | `Sys_Master_Units.UnitID` | Individual inventory identity, distinct from a model |

Examples verified in the existing snapshot: B_PO has `A1-1`, `A2-1`, `B1-1`; KUBON has distinct `A1-1L` and `A1-1R`. Do not shorten L/R suffixes, collapse similarly named variants, or merge matching codes between projects.

The business terminology decision is saved separately as `unit-type-terminology.json` with a checksum and references to the original manifest and investigation supplement. It resolves the earlier semantic question without rewriting source evidence. All 96 crosswalk candidates remain `SUGGESTED`; this answer does not constitute per-model review, approval of public names/specifications, confirmation of ModelArea units, or publication. No Hub database changes were part of that terminology update. The subsequent staging work is recorded separately below.

## Local staging update — 18 September

The reviewed package was loaded at **13:28:25 Asia/Bangkok on 18 September 2026** (06:28:25 UTC) into the local development database only. Migration `202609180007_pilot_intake.sql` adds an immutable private batch and raw source evidence on the four existing mirrors. The type-master dataset is retained in batch evidence; it is not confused with Hub floor-plan models.

| Result | Verified outcome |
|---|---|
| Staged records | 2 projects, 2 brands, 2 companies, 96 models; 2 type-master records retained in batch evidence |
| Exact relationships | KUBON → brand `36`, company `THP`, 63 models; B_PO → brand `000003`, company `A17`, 33 models |
| Timestamp handling | Normalized `source_updated_at` stays null for all imported mirrors because source timezone is unknown. Raw timestamps, including nulls, remain intact. UTC extraction timestamps and local import timestamp remain separate. |
| Area/specification handling | Exact raw decimal strings retained; no usable-area, bedrooms or bathrooms inferred or populated |
| Repeat import | Returns `already_staged`; counts and original import timestamp unchanged; conflicts stop without overwrites |
| Hub workflow | No real brands/projects/model drafts, mapping confirmations, or releases were created. Existing staff selection creates models as unconfirmed drafts when a person chooses a project. |
| Access and labels | Staff source APIs return the two projects/brands with provenance; consumers cannot access source endpoints or read these as published records. Thai UI distinguishes the reviewed snapshot from samples. |

At this staging event, the local-only `scripts/stage-pilot-intake.py` was pinned to the manifest checksum above, validated without connecting by default and wrote only with `--apply`. A single transaction prevented partial imports; deleted/unknown source states, unresolved references and conflicting mirrors were rejected. **The current importer is now pinned to HYABC and rejects this old package for import.** Historical batch evidence and offline verification are retained. Neither import is recurring DW ingestion or drift handling.

The receipt is `.local/pilot-intake/local-staging-20260918.json`. The original manifest, datasets, review and supplements remain unchanged; their `hub_import_performed: false` values describe the earlier review event, not this later import. The receipt and database batch record the later event separately.

Verification on 18 September: four new intake checks (including a disposable PostgreSQL database), four original extraction checks, 220 API tests, 14 browser tests, seven SQL/concurrency suites, build and TypeScript all passed. The real local import and exact replay were verified, followed by staff/consumer API checks and desktop/mobile source-picker inspection. None of these checks grants business approval or satisfies the full pilot acceptance gate.
