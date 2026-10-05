# DW project and model intake

Design recorded before implementation, 5 October 2026. This is local Hub source
staging only. REM and DW are read-only; hosted H1 remains synthetic. Intake never
creates Hub drafts, changes Marketing fields, confirms mappings or publishes.

## Reviewed input and verification gate

The owner supplied `rem-project-model-review-v1` from the sibling DW repository,
`data/rem-project-export/20261005T025000717680Z/`, with reviewed manifest SHA-256
`6251c4663d85303caeb5bb7469d79bd00b022f64f470486afcf14db050955ed3`.
This supersedes the unapplied 3 October package
(`9bbce38a5b8bf7c52591368a273a9c33d4d4d910998be08dc5f2fac9f1c6d86f`).
The field contract is the DW repository's `docs/REM_PROJECT_MODEL_EXPORT.md`.
The reviewed hash must be an explicit command argument, never a hardcoded
allowlist, so future reviewed packages do not need a code change.

Before any database connection, verify the manifest bytes against that argument,
its checksum sidecar, exact file set, each payload's hash, size, columns and row
count, nested Gold project columns, distinct exact identity keys, scalar types,
identifier arrays, deletion evidence and recorded read windows. Preserve original
bytes in ignored `.local/dw-project-intake/<manifest-sha256>/original/` without
rewriting an existing file. Preserve REM timestamps as timezone-unconfirmed text.
The replacement package reads Silver/Gold/lineage in one DW `REPEATABLE READ
READ ONLY` transaction. REM is `NOT READ` with null identity/window fields. Retain
the separate Bronze (5 October) and Gold (3 October) watermarks: one DW snapshot
does not make their upstream capture dates equal. Historical packages retain
their separate REM/DW windows. Prices and unit counts remain private evidence.

The first step is a read-only dry-run report with source counts, all exceptions,
model reconciliation, prior-evidence comparison and proposed new/changed/missing
identities. The owner authorizes application without another confirmation only
when there are no unreviewed conflicts and HYABC matches. Otherwise stop before
staging writes and show the conflicts. The strict requested model coverage check
includes every raw row, including deleted models; the DW contract's Gold grain
excludes deleted models. A failed coverage check must be reported, not silently
waived or repaired by trimming IDs or fabricating groups.

## Source status and staff presentation

Source: product-owner confirmation dated **3 October 2026**, supplied in the
5 October intake instruction. Keep the original `ProjectStatus` text beside the
label in the source picker, progress dashboard and editor's read-only source rows.

| Raw ProjectStatus | English meaning | Thai staff label |
|---|---|---|
| `0` | Presale | พรีเซล |
| `1` | On Construction | กำลังก่อสร้าง |
| `2` | Ready to move | พร้อมอยู่ |
| `3` | Closed | ปิดโครงการ |
| Any other value, including null | Unknown | ไม่ทราบสถานะ |

Do not coerce, trim or infer unknown codes. Show the raw value, including an
explicit null marker. Status is staff-only and is not added to consumer payloads.
The dashboard default scope is explicitly non-deleted projects with exact status
`0`, `1` or `2`. Closed, deleted and unknown-status rows are available through a
toggle and a status filter with counts. “ใหม่จาก REM” counts only default-scope
source projects with no Hub project. “ต้องดูแล” also includes live projects whose
source is deleted or Closed; it never withdraws them automatically.

## Reconciliation and exceptions

Match raw `(ProjectID, ModelID)` to Gold `(project_id, model_ids member)` using
exact text. Report every raw key in zero groups or multiple groups and every
Gold member without a raw key. Do not join on labels, trim IDs, infer room counts
or treat `ModelArea` as confirmed usable area. Preserve deleted raw models.

Keep all exception observations and exact keys visible in the picker/dashboard:

- Missing source brand: show the reason and disable brand binding for that source
  project. Never infer a brand from its name or Gold commercial branding.
- Gold identity/group conflict: disable Gold prefill for the affected project;
  REM remains its identity source. Preserve both claims for staff review.
- Trailing-space ID mismatch: preserve both exact forms, show whitespace clearly
  in the review report, and leave the relationship unresolved.
- Unknown model type, blank name and any other quality finding remain flags.

Compare HYABC with the immutable 18 September pilot batch, current REM mirrors
and the separately preserved Gold staging. Check project/brand/company/group
identity, status and all 13 real raw/model-group identities. Report all source
value changes separately from identity conflicts. The existing synthetic model
`DEMO-HYABC-01` is protected local demo evidence, not a fourteenth real REM model;
do not delete or join it to this package. Preserve HYABC/KUBON/B_PO Hub models,
confirmed mappings, previous source bytes, batches and receipts.

## Planned staging transaction and refresh behavior

After the gate passes, use only `127.0.0.1:55432/sena_hub_local`, checking the actual
working data directory. In one transaction append a private immutable
`staging.intake_batches` record and source evidence; mirror projects and raw models
in `staging.rem_projects` / `staging.rem_models`, and Gold project/model groups in
the existing `staging.dw_projects` storage used by prefill. No new source of truth
for identity and no direct browser access to intake evidence is introduced.

Add `first_seen_at` for each imported source project/model. The first package uses
one transaction timestamp for every row. Exact replay preserves it, adds no batch
and changes no rows. Label the staff column **นำเข้าครั้งแรก** until a later package
arrives; it is not the source creation date or a claim of historical first sight.

Later packages insert new identities. Identical source values are a no-op.
Changed values append immutable evidence marked **ต้นทางเปลี่ยน**, with previous
and incoming values available for staff review. Missing/deleted rows remain as
flagged evidence. Never remove mirrors, overwrite Hub drafts, rebind brands or
models, change confirmed mappings, or change publication pointers. Unreviewed
identity conflicts abort the whole transaction. Keep existing reviewed evidence
addressable after a refresh; source provenance must not silently switch underneath
an accepted mapping or Gold prefill.

RLS, staff roles and readiness stay unchanged. Exceptions restrict unsafe source
actions; they do not introduce new publication-readiness rules. Tests must cover
integrity before connection, exact replay/first-seen preservation, new/changed/
missing evidence, conflict rollback, exact whitespace, protected Hub state and
staff-only status presentation using synthetic packages matching this contract.

## Delivery state

The replacement package passed integrity checks on 5 October. Both packages'
original bytes remain under their manifest hashes in ignored `.local/` folders;
neither package has been applied. `scripts/review-dw-projects.py` is a read-only
gate, with no apply option. It verifies packages before connecting and reads only
the guarded working cluster when `--compare-local` is supplied. Its eight synthetic
offline tests cover hashes, counts/columns/types, DW-only versus historical source
windows, exact IDs, status scope, HYABC identity and private Gold comparisons.

```powershell
uv run --project apps/api python scripts/review-dw-projects.py `
  --package <reviewed-package-folder> --manifest-sha256 <reviewed-sha256> `
  --compare-local `
  --previous-package <prior-package-folder> --previous-manifest-sha256 <prior-sha256>
uv run --project apps/api python -m unittest discover -s tests -p test_review_dw_projects.py -v
```

Latest ignored report:
`.local/dw-project-intake/6251c4663d85303caeb5bb7469d79bd00b022f64f470486afcf14db050955ed3/dry-run-20261005T031127968304Z.json`.
It includes every unmatched exact ID, all exception observations, watermarks and
the private HYABC before/after values. No private price or unit-count values are
committed, displayed to consumers or treated as approved marketing content.

| Raw status | Total projects | Non-deleted projects |
|---|---:|---:|
| `0` — พรีเซล | 15 | 15 |
| `1` — กำลังก่อสร้าง | 25 | 25 |
| `2` — พร้อมอยู่ | 156 | 153 |
| `3` — ปิดโครงการ | 81 | 81 |
| `4` — ไม่ทราบสถานะ | 1 | 1 |

There are 278 projects, 3,516 raw models, 278 Gold projects and 3,178 Gold groups.
Default status/deletion scope would contain 193 projects. The 14 exceptions are
three missing brands, five unknown model types, three Gold identity/group
conflicts, two trailing-space ID mismatches and one blank English name.

**Reconciliation stops the apply gate:** 3,425 raw models occur in exactly one
Gold group; 91 occur in none (89 deleted and two active IDs with trailing spaces).
No raw model occurs in multiple groups. Two Gold IDs have no exact raw model.
The 89 deleted models are excluded by the documented Gold grain. Importing them
as flagged REM-only evidence needs the owner's resolution of the strict
every-raw-model coverage requirement; no grouping is invented. The two known
whitespace mismatches remain exact unresolved keys, as already instructed.

HYABC matches the 18 September immutable pilot and the preserved Gold identities:
13 raw model IDs, 13 Gold groups, unchanged project/brand/company/group identity,
unchanged comparable raw fields, and status `2` (พร้อมอยู่). All existing Hub
models, mappings, draft fields and publications remain unchanged. Gold enrichment
values differ from the older staging and remain private review evidence.

Compared with the superseded package, all 278 raw projects and 3,516 raw models
are byte-identical. Prices/unit counts differ for 23 Gold projects and 35 Gold
groups. Exact Gold rows differ for all 278 projects and 3,178 groups when timestamp
representation and provenance are included; this is distinct from a business
measure change. These are offline comparison counts, **not applied refresh
outcomes**. Applied batches, inserted mirrors, changed evidence, new drafts,
mapping changes and publications from this phase are all zero.

Pending the gate decision: the transactional staging importer, immutable source
refresh evidence/first-seen migration and staff picker/dashboard/editor changes
described above. RLS and the publication gate have not changed. Application
typecheck/build, full API/DB/UI and H1 checks passed for Phase D on the same
unchanged application code; the new review tool additionally passed eight
synthetic tests. Phase E is not complete.
