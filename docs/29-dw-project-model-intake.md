# DW project and model intake

Design recorded before implementation, 5 October 2026. This is local Hub source
staging only. REM and DW are read-only; hosted H1 remains synthetic. Intake never
creates Hub drafts, changes Marketing fields, confirms mappings or publishes.

## Reviewed input and verification gate

Owner decision, 5 October: discard the 89 deleted, ungrouped models from usable
staging rather than retaining REM-only mirrors. The original bytes and immutable
batch still contain their evidence. The importer explicitly opts into this policy
with `--discard-deleted-ungrouped-models`; any existing Hub reference stops deletion.
The two reported trailing-space mismatches are accepted unresolved exceptions,
never trimmed or joined. All other unexplained reconciliation conflicts still stop.

Implementation: append private immutable evidence per REM project/model and Gold
project/group, plus an immutable batch receipt. Existing accepted mirrors and Gold
prefill baselines remain unchanged on refresh; latest source status and review flags
are read from evidence. New identities are mirrored, missing/deleted identities are
flagged, and exact replays append nothing. First-seen timestamps are assigned once
to the imported source identities, including existing pilot identities, in one
transaction. Previous evidence stays addressable; no draft or mapping is rewritten.

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
staging writes and show the conflicts. Reconciliation reports every raw row, including the 89 deleted rows excluded by
the owner's later decision. The two explicitly reported whitespace conflicts
remain unresolved flags. Any additional unexplained gap stops the import; no
identity is repaired by trimming or fabricating groups.

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
or treat `ModelArea` as confirmed usable area. Preserve the original deleted rows in immutable package evidence; omit the 89
owner-discarded model identities from usable mirrors. Later newly deleted
identities remain flagged; this deletion authorization does not expand on refresh.

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

## Delivery and operator commands

The replacement package was applied locally on 5 October after the owner resolved
the deleted-model policy and the dry-run passed. The superseded 3 October package
was never applied. Both packages' original bytes remain in ignored `.local/`.

```powershell
uv run --project apps/api python scripts/stage-dw-projects.py `
  --package <reviewed-package-folder> --manifest-sha256 <reviewed-sha256> `
  --discard-deleted-ungrouped-models
# Add --apply only after reviewing the dry-run (already authorized for this input).
```

The default is a read-only dry-run. All byte/hash/count/column/identity checks run
before connecting. Apply checks the actual local working data directory, locks
the source mirrors and uses one serializable transaction. No hosted/DW/REM target
argument exists. The explicit manifest hash supports future reviewed packages.
The first receipt freezes the identities authorized for omission; later deleted
models outside that list remain flagged and never inherit permission to delete.

Migrations 0032–0033 add private immutable evidence/receipts and first-seen metadata.
Existing RLS, roles and publication-readiness functions are unchanged. Accepted
REM mirrors and Gold prefill baselines stay intact on refresh. Staff source status
comes from the latest evidence; a missing row retains its last observed status.
Neither intake nor refresh creates drafts, changes mappings or publishes.

| Intake outcome | Count |
|---|---:|
| Package projects / raw models | 278 / 3,516 |
| Usable package model mirrors after authorized omission | 3,427 |
| New project mirrors / existing project identities preserved | 275 / 3 |
| New model mirrors / existing model identities preserved | 3,318 / 109 |
| New Gold project baselines | 277 |
| New Gold model-group evidence | 3,165 |
| Existing HYABC Gold project/group changes stored as review evidence | 1 / 13 |
| Total immutable source-evidence rows appended | 7,161 |
| Deleted, ungrouped models omitted | 89 |
| Existing mirror rows deleted | 0 |
| Drafts / mappings / publications changed | 0 / 0 / 0 |

The 89 omitted models were not present in the working mirrors; no existing row
needed deletion. Exact replay returned `already_staged` with zero new evidence,
mirror inserts or deletes. Original bytes and every preexisting immutable batch
and receipt remain intact. All old working rows were preserved, except adding
the explicitly requested first-seen timestamp to imported source identities.
All imported identities share one transaction timestamp, shown as **นำเข้าครั้งแรก**.

The Hub lists still contain 33 brands and four projects (HYABC, KUBON, B_PO and
the explicitly protected assistant demo). Source staging contains 279 project
mirrors and 3,428 models including that retained synthetic evidence. Gold staging
contains 278 projects. No automated-test records reached the working database.

| Raw status | Package projects | Non-deleted |
|---|---:|---:|
| `0` — พรีเซล | 15 | 15 |
| `1` — กำลังก่อสร้าง | 25 | 25 |
| `2` — พร้อมอยู่ | 156 | 153 |
| `3` — ปิดโครงการ | 81 | 81 |
| `4` — ไม่ทราบสถานะ | 1 | 1 |

The dashboard defaults to 193 projects, with **190 ใหม่จาก REM**. Closed, deleted
and unknown-status projects are behind the status-scope toggle; the status filter
shows counts and raw codes. The attention tile also includes live Closed/deleted
projects without automatic withdrawal. Source picker and editor show the same
staff-only labels, raw values, exception reasons and source-change flags.

All 14 exceptions remain visible: three missing brands (`000000`, `2020`,
`K9_Demo`), five unknown model types, three Gold identity/group conflicts (`00401`,
`00412`, `01401`), two trailing-space model IDs and one blank English name.
Missing brands cannot be bound; the three Gold conflicts cannot prefill. Exact
IDs are retained, including whitespace, without auto-joining.

Reconciliation: 3,425 raw models occur in exactly one Gold group; 91 occur in none
(the 89 omitted deleted rows plus the two unresolved active whitespace IDs).
No raw model occurs in multiple groups. Two Gold IDs have no exact raw model.
The full exact-key lists remain in the private reconciliation report.

HYABC matches the 18 September immutable pilot: 13 raw model IDs, 13 Gold groups,
unchanged comparable raw fields and project/brand/company/group identity, with
status `2` (พร้อมอยู่). Its original Gold staging and all confirmed mappings remain
unchanged; newer Gold values are immutable evidence marked **ต้นทางเปลี่ยน**.

Compared with the unapplied 3 October package, all 278 raw projects and 3,516 raw
models are byte-identical. Private prices/unit counts differ for 23 Gold projects
and 35 groups. Exact Gold rows also differ in timestamp representation/provenance.
These are package-comparison counts, not a second applied refresh. Prices and unit
counts remain private evidence and are absent from consumer payloads.

Private receipts under
`.local/dw-project-intake/6251c4663d85303caeb5bb7469d79bd00b022f64f470486afcf14db050955ed3/`:

- `intake-dry-run-20261005T040242584537Z.json`
- `apply-20261005T040326894517Z.json`
- `apply-20261005T040328866082Z.json` (exact replay)
- `dry-run-20261005T040631169815Z.json` (full reconciliation/HYABC report)
- `post-apply-verification.json` and `staff-verification.json`

Validation: typecheck/build, full API suite (1,302 passed, 11 skipped), full DB/RLS
and concurrency suite, eight offline validator tests, nine intake integration and
status tests, 23 relevant browser tests, and local H1 simulation (10 unit, 14 UI)
passed. Relevant browser
checks cover default scope, status counts, raw IDs, exception guards, read-only
viewers, existing editor behavior and source selection. Synthetic fixture bytes,
columns/counts and checksums are frozen in `supabase/tests/fixtures/dw_projects/`.

The actual local viewer UI was also checked after application: 193 default rows,
the exact conflicted source `00401` visible with its warning, and zero attempted
writes. Screenshots are ignored under `artifacts/phase-e-local-*.png`.
