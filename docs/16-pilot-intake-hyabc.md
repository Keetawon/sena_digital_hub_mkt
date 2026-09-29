# 16 — Current residential intake: HYABC

**Selection changed on 18 September 2026:** the user asked to add only `HYABC`, replacing `KUBON` and `B_PO` for current intake. The seven-project Phase 1 target remains unchanged: **one project selected, six further selections pending**. The [earlier two-project review](14-pilot-intake-kubon-b-po.md), immutable source package and staging event remain historical evidence.

## Verified source identities

Fresh source reads ran on **18 September 2026, 15:00:07–15:00:12 Asia/Bangkok** (08:00:07–08:00:12 UTC). Exact source values:

| Field | Value |
|---|---|
| ProjectID | `HYABC` |
| Thai project name | เฟล็กซี่ สาทร - เจริญนคร เฟส 1 |
| English project name | FLEXI Sathon-Charoennakorn Phase 1 |
| BrandID / brand | `25` — เฟล็กซี่ / FLEXI |
| CompanyID / company | `HSP` — บริษัท เสนา เอชเอชพี 22 จำกัด / SENA HHP 22 CO.,LTD |
| Project-model source | `dbo.Sys_REM_ProjectModel`, keyed by `(ProjectID, ModelID)` |
| Model-master records | **13**, all with unique complete source keys |
| ModelTypeID / exact source label | `CON1` — คอนโดมิเนียม 5-8 ชั้น |
| Raw project-model ModelArea | **25.20–64.00**, 12 distinct values; meaning and unit unverified |

The company is the reference on this project record, not a claim that it owns the entire FLEXI brand. `ProjectCode` is null and `BrandCode` is an empty string; neither replaces its source ID. Raw `ProjectStatus` is `2`, with no customer-facing interpretation assigned. All **17 source rows** (one project, brand, company and type-master, plus 13 models) explicitly have `isDelete = false`; that does not prove current sales availability or publication approval.

Both Thai and English type-master labels contain the same Thai wording. The label is a source category, not verified evidence of the project's actual floor count or bedroom classification. The type-master's own `ModelArea` is null and must not substitute for project-model area.

| ModelID | Raw ModelArea |
|---|---:|
| `A1` | 25.20 |
| `A3` | 25.20 |
| `B1` | 32.00 |
| `C1` | 29.40 |
| `CA1` | 50.40 |
| `CB1` | 64.00 |
| `D1` | 30.13 |
| `E1` | 31.06 |
| `F1` | 46.77 |
| `F2` | 51.36 |
| `G1` | 50.48 |
| `H1` | 45.00 |
| `I1` | 31.54 |

These are **13 model-master rows, not the distinct model count in `bronze.rem__sys_master_units`**. That unit-table reconciliation remains pending. Preserve every exact model code; no grouping by area or label was performed.

## Package and technical review

Git-ignored package: `.local/pilot-intake/20260918T080012467449Z_HYABC/`.

Manifest SHA-256: `79188d1687c08bdc1ade916b3a3771db76858a91df62b61824bf1d0f28fa54fc`.

The five datasets are `projects.json`, `brands.json`, `companies.json`, `models.json`, and `model_types.json`. `queries.sql`, `review.json`, `manifest.json` and `manifest.sha256` record the queries, checks, provenance and integrity. A separate `technical-review.json` records independent agent verification; it does not modify the manifest or source files and is not human business approval.

The extract used **direct SELECT-only REM reads through the existing DW repository's configured REM connection**, with runtime database name verified as `SENA_PRD`. The DW tunnel was reachable but the desktop read-only PostgreSQL credential was unavailable. This is **not a live bronze-table result or scheduled DW ingestion**. Production intake must still use the approved DW handoff.

The DW reference checkout was `1505dcb295c755fcec8ed54d4918db8595bd6221`, with project contract version 3 and four reference-file hashes retained. Two complete reads produced identical fingerprints and independent counts of **1 / 1 / 1 / 13 / 1**. Snapshot isolation was off; observed agreement is not a transactionally atomic point-in-time guarantee. No source writes or configuration changes were performed.

Independent verification passed for manifest/file hashes, the four DW reference hashes, complete and per-row fingerprints, counts, exact scope, composite keys, dictionary references, nullable source values, raw decimal strings and SELECT-only queries. Automated review flags are empty. The four focused extraction checks and offline verifier passed:

```powershell
python -B scripts/prepare-pilot-intake.py --verify .local/pilot-intake/20260918T080012467449Z_HYABC
python -B -m unittest discover -s tests -p test_pilot_intake.py -v
```

All 13 mapping candidates remain `SUGGESTED`, with human reviewer/time and approved usable area unset. Empty technical flags do not resolve area semantics, public wording, asset rights or publication gates. Raw source timestamps retain their unverified timezone; extraction timestamps are explicitly UTC.

## Local staging and draft status

The HYABC package was staged in the local development database at **15:09:23 Asia/Bangkok on 18 September** (08:09:23.455322 UTC): one project, one brand, one company and 13 models. The type-master record is retained in the immutable batch. Separate staff API calls then created the matching FLEXI brand draft and HYABC project draft; the project update timestamp is **15:09:46.740469 Bangkok**.

| Local result | Verified value |
|---|---|
| HYABC draft | `prj_7b1044dfaaee44d1a56891802b0506f2` — [open locally](http://127.0.0.1:3000/?project=prj_7b1044dfaaee44d1a56891802b0506f2) |
| FLEXI brand draft | `brd_205a9f92b2434450a9c473cb84bca73f` |
| Exact source relationships | Brand `25`, company `HSP`; matching FLEXI brand assigned |
| Model approval | All 13 `SUGGESTED`; reviewer and verification time unset |
| Specifications | Bedrooms, bathrooms, usable area and parking remain null; no facts inferred from ModelArea |
| Publication | HYABC and FLEXI remain unpublished |
| Existing work | KUBON/B_PO already had unpublished drafts with 63/33 unconfirmed models; both drafts, source mirrors and evidence were retained unchanged |

Only HYABC is in the current pilot plan. Preserving older drafts does not add them back to that plan. The extraction's `hub_import_performed: false` describes the original review event; later local staging and staff API actions are separate events.

The local receipt is `.local/pilot-intake/local-staging-hyabc-20260918.json`, verified at **15:10:51 Bangkok** (08:10:51 UTC). Exact replay returned `already_staged` with the original import timestamp. Consumer APIs excluded the HYABC/FLEXI drafts. Before/after comparisons confirmed the old KUBON/B_PO Hub details/models, all source mirrors and immutable intake batch were unchanged.

The current importer is pinned to the HYABC manifest. It preserves the immutable earlier batch and original files. Only unreferenced staging mirrors tied to the exact superseded manifest may be retired; existing Hub references keep that old staging intact while independent HYABC intake proceeds. Conflicting source rows must not be overwritten. The historical package remains verifiable offline but is no longer an accepted import target. Creating drafts through normal staff APIs does not confirm mappings or publish.

All **10 focused checks** passed for this change: four extraction tests and six staging tests, including two disposable-database tests. The actual HYABC draft also loaded with its Thai heading, FLEXI association and 13 model cards without page errors; desktop visual evidence is under `artifacts/hyabc/`. There was no API/UI code change or new full-suite rerun in this step. Technical checks do not grant human approval or satisfy the complete pilot acceptance gate.

## Requested DW unit-table check

The user will run the query through their working warehouse connection and share results. It retrieves HYABC's distinct model IDs from unit records without assuming those equal the model master:

```sql
SELECT
    project_id,
    COUNT(DISTINCT model_id) AS distinct_model_count,
    ARRAY_AGG(DISTINCT model_id ORDER BY model_id)
        FILTER (WHERE model_id IS NOT NULL) AS model_ids
FROM bronze.rem__sys_master_units
WHERE project_id = 'HYABC'
GROUP BY project_id
ORDER BY project_id;
```

The count excludes null `model_id` values but includes empty strings and models referenced only by deleted units: this query intentionally has **no source-status filter**. No result row means no matching unit records, not an observed zero count. Reconcile the returned IDs against the 13 master keys, investigate either-direction differences and null/blank values, and preserve the query's source/status scope before deciding eligibility. Do not remove a valid master model solely because no unit currently references it.

## Next steps and approval limits

1. Continue from the existing HYABC/FLEXI drafts; preserve the old KUBON/B_PO work outside the current intake plan.
2. Reconcile the user-supplied DW unit-table result against these model-master keys; record differences without guessing their meaning.
3. Have the designated source/business reviewer confirm each model mapping and the definition/unit of `ModelArea`, or supply approved specification evidence. Bedrooms, bathrooms and usable area remain separate requirements.
4. Supply and approve Thai public wording, brand logo, project images/floor plans, rights, required project fields and promotion terms before publication.
5. Confirm the remaining six project selections and owners for the unchanged seven-project core commitment. Recurring DW delivery, production access and full pilot acceptance remain separate work.

Governing references: [source-field ownership](13-source-field-ownership.md), [requirements](../REQUIREMENTS.md), [local implementation limits](11-local-development.md), and [KPI schedule](15-status-kpi-plan-20260918.md).
