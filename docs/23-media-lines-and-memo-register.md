# 23 — Media lines and memo register (P2 core)

Date: **30 September 2026 (Asia/Bangkok)**. Status: **expanded P2 implemented and
verified locally**. The owner replied `P2.0 approved — implement expanded P2`.
The contract below covers the authorized migration, API, screens, importers and tests.
P1 remains implemented and locally verified; `sena_h_approved=false` and
production name issuing remain blocked pending P'Note's approval.

Sources: [19](19-campaign-naming-registry.md) §§2.1B, 4.2, 5–6, 9;
[20](20-marketing-operations-flows.md) BF-0/BF-2/BF-5/BF-12, §§5–7;
[priorities](ads/PHASE1_PRIORITIES.md), [questions](ads/OPEN_QUESTIONS.md),
[P1 implementation](ads/P1_IMPLEMENTATION_20260929.md) and
[UI contract](22-hub-assistant-and-ui.md). Schema/security conventions come from
`supabase/migrations/202609290014_ads_registry.sql`; the staging workflow comes from
`scripts/stage-ads-scopes.py`. External evidence is read-only.

**Replacement addendum, 30 September:** [doc 24](24-card-costs-and-recurring-commitments.md)
adds P2 typed costs/payment methods and document requirements, ad/channel accounts,
recurring commitments, memo aliases, prepaid monthly allocation and the read-only
Media card-sheet import. It replaces the earlier blanket exclusion of card-cost
records. P4 statement upload/OCR/count reconciliation is designed there but remains
unbuilt. The owner explicitly approved implementation of this expanded P2 design.

## 1. Outcome and decisions for approval

Online can connect an SN registration to the appropriate financial line for each
calendar month. That line supplies BUD, memo, fee-PO reference and gross budget.
These facts never enter the campaign name. All frozen name variants under one SN
share its monthly assignment; variants and native campaigns do not multiply budgets.

| Decision | Proposed P2 behavior and reason |
|---|---|
| Project grain | One assignable **group × month × agency** parent, with exact **REM ProjectID (phase) × month × agency** financial children. Doc 19 §2.1B records phase-grain ledger rows and a `Formatted Mapping` group code; flattening to one representative phase would discard BUD/memo/PO facts. Doc 20's group link remains usable for A/B/C registrations. |
| Revisions | Exactly one applicable approved revision for an ACTIVE line. New revisions supersede, never add to, the old revision. Draft or suspended lines cannot receive new assignments. |
| Memo reconciliation | `memo gross = applicable line envelopes + standalone commitment reservations` is an exact-decimal **finding**, not a database equality constraint. A commitment already funded inside an envelope is not counted again. Partial imports and unallocated funds remain visible; doc 24 separately enforces each commitment cover's cap. |
| Assignment | Online chooses the line explicitly. Candidates use scope, month and agency, plus membership/program checks. Even one candidate is a suggestion; ambiguous candidates are never auto-assigned. |
| Agency access | No P2 line access, including amount-free line lists. Agencies retain only P1 own-name viewing and ID returns, consistent with confirmed Q12. |
| E-memo boundary | Manual mirror and document number/link as text. The Hub never approves a memo, uploads a file, fetches a linked document or invents a memo number. |
| Corrections | Admin review with evidence, then a separate explicit application per month. No automatic correction of imports, assignments, scope masters, names or external systems. Q5 still gates production authority. |

P2 adds financial context without changing P1 grammar, scope tokens, issuing rules,
name generation, CODE identity, native bindings or approval setting. A pending or
missing financial link is displayed separately from the P1 naming approval banner.
P2 does not claim to authorize ad launch or replace the external approval process.

## 2. Common data rules and migration boundary

All domain objects live in `ads`; import evidence lives in `staging`. Use UUID
internal keys, existing registry foreign keys, `created_by`/`updated_by` trusted actor
UUIDs, `created_at`/`updated_at timestamptz`, and optimistic `row_version` for mutable
records. Preserve source IDs, memo numbers, PO numbers and program references as
text, including leading zeros. Never reconstruct a lost zero or identify a source
object by its display name.

Money magnitudes are nonnegative `numeric(14,2)` THB; API money is a decimal string.
Reject excess precision/overflow rather than silently rounding. Doc 24 costs have
an explicit debit/credit direction. For media-only envelopes, optional media and fee
amounts must both be supplied or both be absent; if supplied as a complete split,
their exact sum equals gross. Memos covering CHANNEL/TOOL/BANK_FEE instead use a
reviewed cost-type breakdown; do not force other costs into media/fee fields. Fee
means the gross fee including its VAT. P2 does not infer rates or calculate a PO.
Month is a `date` whose day is 1, interpreted in Asia/Bangkok. Period endpoints are
inclusive first-day months. Business approval dates are `date`; decision/audit times
are `timestamptz`, displayed in Asia/Bangkok. API month format is `YYYY-MM-01` in CE;
Thai display may show BE with an explicit year label.

No DELETE. Close, supersede, retire or archive records with a reason. Approved
financial snapshots and applied correction mappings are immutable. Historical
assignments and source evidence remain available to authorized marketing operations.

Implemented migration: `supabase/migrations/202609300015_ads_media_lines_memos.sql`,
global counter **0015** after `202609290014_ads_registry.sql`. It does not amend
0014 or its setting whitelist. See the [implementation report](ads/P2_IMPLEMENTATION_20260930.md).

## 3. Tables

### 3.1 `ads.memo`: mirror of an external decision

| Field/group | Contract |
|---|---|
| Identity | `id`, unique canonical `memo_no text`, `series` = BUD or CORPORATE. Canonical and alias lookups share the unique `ads.memo_identifier` namespace in doc 24 §6. Identity is fixed once confirmed/referenced; aliases require evidence and never silently merge different serial numbers. A mistaken identity requires explicit reviewed correction/relinking. |
| Description | `subject text`, `requesting_bud` referencing active `ads.vocab` BUD values. Free text is internal and excluded from DW export. |
| Amount | `gross_amount`, optional complete media/fee split or reviewed cost-type breakdown, all under §2 and doc 24. The amount is the full memo ceiling, not an allocation per SN or a second actual cost. A memo can cover a commitment period/cap. |
| External status | `mirrored_status`: UNKNOWN, IN_REVIEW, APPROVED, REJECTED, CANCELLED. This records what E-memo says; no Hub approval transition exists. |
| Decisions | `approvers` structured array of `{name, role_label, decision, decision_at}`; `approval_date`. Decision time must carry an offset. Unknown individual details remain missing and produce a completeness finding, not fabricated names/times. Do not assume a fixed four-person route. |
| Evidence | `evidence_ref text`: E-memo document number or reviewed link, not an upload, attachment or stored PDF. No automatic URL fetching; reject credential-bearing/signed-secret links. |
| Provenance | `source = MANUAL` in P2; `record_status` = DRAFT or CONFIRMED, `confirmed_by/at`, common actor/time/version fields and `material_version` for changes to approval/financial evidence. Subject-only edits increment `row_version`, not `material_version`. Future API/export integration requires a separate contract under Q1. |

Candidate validation, still **unconfirmed per doc 19 §9 / Q14**:

```text
BUD:       ^MO[0-9]{2}(0[1-9]|1[0-2])[0-9]{3}$    e.g. MO2604048
CORPORATE: ^M\.COM[0-9]{3}_[0-9]{2}$               e.g. M.COM033_69
```

The MO year/month and corporate BE year are identifiers, not inferred approval dates
or line periods. Validation checks syntax and series, never actual authority. Until
the owner confirms formats, synthetic fixtures use these candidates; a production
exception is quarantined for review, never repaired by guessing. All real memo
activation is gated by Q14 and Q1's manual-evidence acceptance.

Online's action is **confirm the accuracy of a transcription**, labelled
`ยืนยันข้อมูลที่บันทึก`; never `อนุมัติ Memo`. A confirmed APPROVED mirror requires a
valid memo number, BUD, gross, approval date and nonempty evidence reference. The
record retains the approver information actually available; any missing decisions
remain conspicuous and subject to the accepted evidence policy (Q1).

All changes are audited. Changing a confirmed memo's amount, BUD, status, approval
date, decision data or evidence returns its record to DRAFT and atomically suspends
linked ACTIVE lines and commitments for review, including archived lines with retained budgets.
Use the shared financial-write lock described in §3.3, then lock affected rows in
stable ID order. Do not
silently change an approved line snapshot or delete its existing assignments.
Reconfirm the mirror and confirm a new line revision to resume. Subject-only edits
remain audited without invalidating a financial snapshot. Approver PII is restricted
in the base table, API, logs and audit history as well as the UI (§6).

### 3.2 `ads.media_line`: stable assignment target

| Kind | Natural key and required context |
|---|---|
| GROUP | `(group_scope_id, month, agency)`; canonical active A/group scope, explicit calendar month and active agency vocab. |
| ZONE_POOL | `(scope_id, month, agency)`; exact active D scope and its immutable member set. |
| BRAND_POOL | `(scope_id, month, agency)`; exact active E scope. |
| CORP_PROGRAM | `(program_ref, period_start_month, period_end_month)`; BUD `SID`, explicit program reference, linked permitted CORP scope(s) and permitted agency codes. Agency is a compatibility check, not an extra budget key. |
| BU_PROGRAM | `(bu_scope_id, program_ref, period_start_month, period_end_month)`; explicit BU and an approved BUD mapping. Do not coerce a BU such as SOLAR to SID. Activation remains blocked for unverified mappings (Q16). |

Common fields: `id`, `kind`, the applicable key columns, `source_kind` MANUAL or
LEDGER, `state` DRAFT/ACTIVE/SUSPENDED, nullable `archived_at` and common audit/version
fields. Archiving prevents new assignments but retains a line's financial state and
approved budget for its original month/period; it is not a budget withdrawal. Mutually
exclusive checks prevent project lines with periods or program lines with a second
monthly budget. Keys are immutable once referenced. Prevent overlapping ACTIVE
periods for the same corporate program (or same BU/program); split or supersede
explicitly instead of creating competing budgets.

Corporate lines may span several months. The full period amount is stored once;
monthly registration links do not clone it. Monthly tables label it `งบทั้งช่วงเวลา`
and exclude it from a monthly-only total. A corporate scope/pillar can contain many
programs, so scope alone cannot choose the program. Online selects and attests the
program, period, permitted scopes and agencies against evidence (Q16).

### 3.3 `ads.media_line_revision` and `ads.media_line_component`

`media_line_revision`: `id`, `line_id`, `revision_no`, status DRAFT/APPROVED/SUPERSEDED,
`reason`, `confirmed_by/at`, common version/audit fields. Program scope/agency
compatibility lists belong to the revision so their changes are reviewed too.
`APPROVED` here means **confirmed against an externally approved memo**, not approval
of that memo by the Hub. The UI says `ยืนยันรายการตาม Memo ที่อนุมัติแล้ว`.

Persist `reconciliation_acknowledgements` on the confirmed revision as validated
structured entries keyed by memo ID: memo material version, observed memo gross,
applicable allocated gross, difference, reason and trusted actor/time. This records
exactly which finding was reviewed; dismissing a UI warning is not evidence.
Calculate those figures for the proposed post-confirmation state: exclude the
superseded revision and include its replacement, never sum both.

`media_line_component` preserves the financial facts under each revision:

| Field/group | Contract |
|---|---|
| Identity | `id`, `revision_id`, `component_kind` PHASE/POOL/PROGRAM. Unique `(revision_id, rem_project_id)` for PHASE; exactly one POOL/PROGRAM component per pool/program revision in minimum P2. |
| Phase provenance | PHASE requires `rem_project_id text`, `formatted_mapping text` and a verified phase-to-group bridge matching its GROUP parent. Keep the real phase ID even when the naming registry has an ASCII alias. No fake phase for a pool or corporate program. |
| Finance | `bud`, `gross_amount`, optional media/fee split, `fee_po_ref text` nullable. A reference is not a PO record or proof of procurement/payment. |
| Memo link | Nullable `memo_id`, nullable `observed_memo_no` verbatim from import. Approved revision requires a linked, CONFIRMED/APPROVED memo and matching requesting BUD. Record an immutable snapshot of memo ID/number/material version/BUD/gross/status/approval date at confirmation; exclude approver/evidence PII from that snapshot. |
| Origin | Nullable `source_row_id`, explicit MANUAL/LEDGER origin, common actor/time fields. Do not infer memo from a campaign name or copy it from an adjacent phase/month. |

One group revision may contain several phases with **different BUDs, memos and PO
references**. Parent gross is computed as the sum of its components, not stored as
a second financial amount. Parent filters match any child; display distinct BUD/memo
sets with child detail, never an arbitrary representative value. Missing or
conflicting phase/group bridges stay unresolved. More than one ledger row for the
same phase/month/agency is a grain conflict, not permission to sum duplicates.

One memo may approve many components and lines across several months. There is no
one-memo-per-line or one-line-per-memo uniqueness rule; each component retains its
own memo link, and allocation totals count components once.

For this low-volume P2 workflow, all financial writes (memo edits/confirmation,
line/revision changes, assignment changes/acknowledgement and ledger apply) take one
fixed transaction-scoped advisory lock before ordered row locks. Keep transactions
short and bounded; never hold a lock during operator review. This deliberately
serializes writes so a concurrent memo cancellation cannot race with confirmation
or acknowledgement using stale approval evidence. Reads remain concurrent.

To confirm a revision, a guarded transaction takes that lock and locks the stable line, checks the
expected current revision, validates components, scope/agency compatibility, memo
evidence and reconciliation acknowledgements, supersedes the old approved revision,
then promotes the new one. A unique partial index allows at most one APPROVED
revision per line; guarded transitions plus a deferred invariant require exactly
one for ACTIVE lines. A suspended line's retained approved snapshot is historical
and **not applicable**. DRAFT/SUSPENDED lines have no applicable revision. An archived
ACTIVE line retains its one applicable revision and remains in historical budget
and memo totals; `archived_at` affects new assignment eligibility only. A material
memo edit can suspend it too; later review retains the archive flag.
Approved revisions/components cannot be edited. Concurrent confirmations against
the same old revision yield one success and one 409; failure rolls back the entire
transition. No transient two-revision sum is visible to readers.

Memo allocation finding: sum components from applicable revisions once, including
one complete corporate period component once, plus standalone commitment reservations
from doc 24. Covers already funded inside a component are not added again. Compare
against the current confirmed memo gross using exact decimals. Show allocated, unallocated or overallocated amount,
coverage and last review; no tolerance silently passes a difference. A mismatch
does not prevent storing truthful evidence or confirming a reviewed line, but
requires a recorded acknowledgement/reason and stays open. This is a local P2
completeness check, not the P3 DW actuals/control engine or a spend authorization.
Line supersession/suspension must revalidate or suspend linked commitment covers;
they cannot continue reserving against a superseded component. Doc 24 defines
typed budget items separately from combined gross envelopes and actual cost rows.

### 3.4 `ads.line_assignment`: registration × calendar month

Fields: `id`, registration `code`, `month`, `line_id`,
`acknowledged_revision_id`, status ACTIVE/ENDED, optional `correction_target_id`,
`reason`, actor/time fields. Unique ACTIVE `(code, month)` gives many SNs per line and
one SN on several lines across months, **at most one line in each month**. No
amount is copied onto an assignment. Assigning requires an ACTIVE line with its
applicable approved revision and valid compatibility below. A revision change
preserves links but marks their financial context `ต้องตรวจสอบอีกครั้ง` until Online
acknowledges the new revision. Memo suspension likewise marks them unresolved.
Acknowledgement takes the same financial-write lock and expected-revision guard,
rechecks every membership/agency/program rule against the current revision and
requires an ACTIVE line. A dropped B phase or changed permitted program agency
cannot be acknowledged as a valid match. Archive blocks new/replacement assignments;
acknowledging an existing historical link remains possible if all other checks pass.

Replacement ends the old assignment and inserts the new one atomically with a
reason and expected version. No overwrite/delete of history. Suggestions are
read-only and return why a line matches or is ineligible; even a unique suggestion
requires Online's explicit action. An ambiguous result requires a selection.

| Registration scope | Assignment rule |
|---|---|
| A | Exact canonical group line, same month and agency. Financial children describe funding provenance, not a new interpretation of the advertised group. |
| B | Same parent group/month/agency; the registration's exact REM phase must occur among the revision's phase components. |
| C | Same group/month/agency; every selected immutable PHASE member must be present. Never derive a different member set from the group token. |
| D | Exact D scope ID/member set, month and agency on a ZONE_POOL. Keep shared spend; do not split across member groups. |
| E | Exact E scope ID, month and agency on a BRAND_POOL. Do not distribute a brand pool to its projects. |
| F CORP | Explicit CORP_PROGRAM selected by Online, month within period, BUD SID, scope and registration agency included in the confirmed compatibility lists. Never infer the program from LABEL or corporate pillar alone. |
| F BU | Explicit BU_PROGRAM, same BU, month within period and confirmed agency/BUD mapping. Unverified mappings cannot be assigned. |

A candidate needing unmatched phase coverage, several funding lines, a different
paying group, multiple memos within one phase, or a weighted pool cannot be forced
into a nearby line. Keep it unresolved (Q15/Q17) until the owner defines funding
contributions or supplies a corrected, reviewed source. P2 does not create
`ads.funding_contribution` or pretend scope membership is a contribution percentage.
The A–F dashboard semantics and three-step picker in doc 19 remain unchanged.

### 3.5 `ads.correction` and `ads.correction_target`

`correction`: `id`, exact `observed_code text`, inclusive `month_from/month_to`,
`agency`, `proposed_reason`, restricted `evidence_ref text`, status
PROPOSED/APPROVED/REJECTED/RETIRED, proposer/decision actor and timestamp, version.
Default is PROPOSED. Admin alone approves/rejects with evidence and reason; the
person authorized to hold that responsibility in production is still Q5.

`correction_target`: one row per month in the range, `id`, `correction_id`, `month`,
`target_line_id`, application state NOT_APPLIED/APPLIED/RETIRED,
`applied_by/at` and application reason. A range cannot point blindly at one monthly
line: every month needs its own compatible target, or the same program line whose
period covers that month. Enforce no overlapping approved, non-retired targets for
`(observed_code, agency, month)` using transactional locks and a database uniqueness
guard over the expanded month keys. Reject conflicting proposals at approval with
409. Draft proposals can coexist for review.

Approval alone makes a mapping eligible, **not effective**. Online/admin then
explicitly applies selected month targets after seeing the observed code, agency,
month, target and evidence. Applying records a receipt and enables that mapping for
explicitly selected assignments and export; it does not rewrite any existing row or
automatically assign anything. An assignment using a correction records its target
ID and still obeys §3.4 compatibility. Retargeting requires a new proposal; retiring
does not erase earlier receipts or assignments. The importer never auto-applies a
crosswalk. DW must not resolve from a merely PROPOSED or APPROVED/unapplied row.

`C-MIBF-BNGPU` / `C-MIGD-BNGPU` remain blocked pending authoritative master evidence.
A correction does not activate an inactive scope, rename an issued campaign, resolve
a P1 native-binding collision or authorize a DW/REM/Sheet write. BF-12's corrections
are exceptions with a human decision, not a fuzzy match service.

### 3.6 `staging.ads_ledger_batch` and `staging.ads_ledger_row`

Batch: UUID, format/profile version, logical source ID, source file label, exact tab,
calendar month, sanitized file hash, received/exported timestamps, actor,
APPLIED/QUARANTINED status and structured issues. Row: batch ID, original source row
number, retained exact-header map, **sanitized raw row**, canonical row hash,
provenance, APPLIED/QUARANTINED and issue codes/field references. Source IDs remain
text. A row can reference a prior identical applied row instead of creating a second
domain component. Keep all decision receipts; do not delete rejected evidence.

“Raw” means the exact allowed-column projection received under §4, never a copy of
the whole ledger. Excluded columns/values, including card last-4, do not enter files
archived by the importer, hashes, staging JSON, errors, logs or audit payloads.

## 4. Ledger import contract — read-only operator export

### 4.1 Input and exact header binding

Proposed command: `scripts/stage-ads-ledger.py --manifest <path>`; repeat with
`--apply` after reviewing its report. Like the scope staging script, validate before
applying and preserve replay evidence. **Do not copy its whole-source-file archive
behavior** for the ledger: it can contain prohibited payment/card columns.

Input is an **operator-exported, sanitized UTF-8 CSV for one INVOICE Ads month tab**
(optional UTF-8 BOM), plus a JSON manifest. No live Sheet credentials, XLSX ingestion,
formula evaluation or network fetch. Only a month tab is eligible; `draft`, payment,
target and summary tabs are not import sources. The operator selects the approved
columns before delivery. The Hub never writes to the Sheet.

Manifest fields: `format_version`, stable `logical_source_id text`, `source_file`
(label only), exact `tab`, explicit `month`, `exported_at` with timezone,
`header_profile_id/version`, source header-row number and a source-row-number array
corresponding to the CSV data records. The importer records receipt time and computes
the sanitized file/row SHA-256 hashes. Month is not guessed from the tab label or
memo number. Original ledger files and discarded column data are not retained.

| Semantic field | Exact-header evidence / rule |
|---|---|
| Group | `Formatted Mapping` is evidenced in doc 19 §2.1B. |
| Gross | `BUDGET ONLINE การตลาดให้` is evidenced in doc 19 §2.1B. |
| Fee-PO reference | `เลข PO` is evidenced in doc 19 §2.1B; required header, nullable value. |
| Memo number | `เลข Memo` is the proposed optional column (Q4), not claimed present on every source tab. Missing/blank stays null with an unresolved-memo finding. |
| REM ProjectID, BUD, agency | Required meanings; production **exact header strings are not verified** by the existing narrative. A dated approved header profile must supply them. Synthetic profiles are labelled synthetic and cannot authorize a real import. |

The profile maps each meaning to one complete exact header string and the allowed
set. Do not bind by index, substring, translated synonym, case folding or trimmed
near match. Different month layouts are fine; profiles resolve exact names, not
positions. Reject missing required headers, duplicate/ambiguous bindings, unexpected
columns and unsupported profile versions **before reading/persisting row values**.
Structural/sanitization failures exit without DB writes or archiving the unsafe
file. Reports identify the condition/coordinate without logging excluded content.
Q4 blocks production profile acceptance, not writing the synthetic importer.

This ledger importer handles budget envelopes only. Card-cost occurrence imports
use doc 24's separate replay/grain contract and do not inherit phase-key deduplication.
Import only line key (phase/group/month/agency, or an explicitly profiled corporate
program/period), BUD, gross, optional memo number and fee-PO reference. Corporate rows
without an approved program/period profile remain quarantined; manual program entry
is available. No subject, approver, QT, bill, payment, card or fee-calculation columns.
All IDs arrive as text; spreadsheet-coerced identifiers must be corrected by the
source owner, not padded by the importer. Gross CSV values use a canonical decimal
string without currency symbols, grouping commas or exponent notation; malformed
amounts are issues, never locale-guessed. Formula-like cells are not executed.

### 4.2 Validation, apply and replay

1. Parse the safe format/profile; bind headers; validate IDs, dates, money, vocab,
   phase/group bridges, source coordinates, duplicate business keys and memo syntax.
   Show errors and incomplete coverage without changing the DB in a dry run.
2. Unknown memo numbers may be retained as observed references on a DRAFT component;
   do not manufacture a memo row, approval date or status. Missing `เลข Memo` cannot
   be recovered from legacy names, preceding months or nearby rows. An exact approved
   alias may resolve through doc 24's identifier namespace while preserving observed
   text; unconfirmed/ambiguous aliases stay unresolved. Existing memos must match BUD;
   unapproved/unconfirmed mirrors keep the line DRAFT.
3. On `--apply`, recheck the parsed input and current DB state under an import lock
   for the logical source and relevant natural keys. Perform staging and typed
   writes in **one transaction**. A DB error rolls everything back.
4. Exact replay of an APPLIED or QUARANTINED batch/row returns its original receipt
   and is a no-op. Fingerprints use profile version, logical source, tab, source row,
   month and canonical allowed values, not local file name or receipt time. The
   natural line/phase keys also catch a duplicate moved to a different source row.
   Identical business facts at a new source coordinate are duplicate-source evidence,
   not an exact replay: quarantine for review instead of silently collapsing them.
5. Changed values at a previously accepted source identity, competing values for a
   natural key, duplicate-source evidence, invalid bridges/vocab, or unresolved code conflicts quarantine the
   **whole batch** on apply: commit sanitized staging/issues only, no partial domain
   writes. Never overwrite or automatically revise an accepted budget/memo/PO. A
   corrected source produces a new review receipt; changing accepted domain facts
   requires an explicit manual revision with retained source provenance.
6. A clean batch creates new DRAFT line revisions/components (or recognizes exact
   replays at the same source identity). Stage rows are APPLIED, meaning imported, **not approved**.
   Approval/revision confirmation is a separate Online action against memo evidence.
   Group components are assembled from all accepted phase rows in that revision;
   never merge a later partial export into an approved snapshot automatically.

A corporate full-period budget repeated on another month tab is likewise duplicate
source evidence. Quarantine it for manual review; never create a second period
budget or silently collapse it without a reviewed source rule.

Quarantine issues include a stable code, safe field/row reference and Thai resolution
message. Incomplete memo references are draft findings, while contradictory known
references are quarantine errors. Operators can inspect sanitized evidence and
prepare a reviewed revision; there is no “ignore all errors” apply option.

## 5. API contract (proposed)

Use the existing FastAPI `/ads` routing/auth/transaction pattern; paths below are
relative to that prefix. Typed request models reject unknown fields. Actors/roles
come from verified claims, never request fields. New writes require a version or
expected revision; use 409 for stale/conflicting state, 422 for invalid data and 403
for denied roles. Errors shown to users are Thai with verbatim IDs. No endpoint
accepts a generated campaign-name string or issues a new name as a side effect.

| Endpoint | Purpose / authority |
|---|---|
| `GET/POST /memos`; `GET/PATCH /memos/{id}` | List/filter, create or edit manual mirror; online_staff/admin only. |
| `POST /memos/{id}/confirm-record` | Confirm transcription and evidence, not approve a memo. |
| `GET/POST /media-lines`; `GET /media-lines/{id}` | Filter month/agency/BUD/scope/status; create draft and read components/revisions/findings. |
| `POST /media-lines/{id}/revisions`; `PATCH /media-lines/{id}/revisions/{revision_id}` | Draft replacement and draft-only editing; snapshot previous data without altering history. |
| `POST /media-lines/{id}/revisions/{revision_id}/confirm` | Atomic supersession with memo checks and explicit discrepancy acknowledgements. |
| `POST /media-lines/{id}/archive` | Close to new use with reason; retain history. |
| `GET /registrations/{code}/line-candidates?month=…` | Explain eligible/disabled suggestions; does not select. |
| `GET /registrations/{code}/monthly-lines` | Staff-only financial context including memos, revisions and review status. Separate from the unchanged P1 registration response. |
| `POST /line-assignments`; `POST /line-assignments/{id}/replace`; `POST /line-assignments/{id}/end`; `POST /line-assignments/{id}/acknowledge` | Explicit SN/month assignment, replacement, closure or acknowledgement of a reviewed revision. |
| `GET/POST /corrections`; `GET /corrections/{id}` | Read/propose crosswalk with month targets and evidence. |
| `POST /corrections/{id}/review` | Admin APPROVE/REJECT decision; no application side effect. |
| `POST /corrections/{id}/apply`; `POST /corrections/{id}/retire` | Explicit selected-month application by Online/admin; retirement by admin. Record receipts; never mutate source facts. |
| `GET /ledger-imports`; `GET /ledger-imports/{id}` | Staff review of sanitized receipts/issues. Import writes are operator CLI only in minimum P2. |

Paginate lists, bound filter ranges and return exact totals with declared grain.
Responses explicitly distinguish monthly budget and full-period program budget.
Do not expand a period amount onto each monthly result or each assigned SN. Staff
only memo/line routes remain 403 for agencies even if an ID is guessed; UI hiding
alone is insufficient. There is no bulk export of personal decision data.

## 6. Roles, RLS and audit

| Role | P2 access |
|---|---|
| `online_staff` | Read/maintain manual memos, draft lines, confirm external evidence, manage explicit assignments, propose/apply approved corrections; inspect import receipts. No correction approval. |
| `admin` | Same marketing-ops access plus correction approval/rejection/retirement. Production provisioning must identify authorized approvers under Q5. |
| `agency` | No P2 tables, views, functions, counts or financial endpoints, including own lines without amounts. Existing P1 own-name/ID permissions unchanged. |
| `editor`, `publisher`, `viewer`, `service_consumer`, anonymous/public | No P2 financial or memo access merely because of a residential role. |
| Dedicated guarded writer/import execution roles | NOLOGIN, NOINHERIT, NOBYPASSRLS, minimal object grants following 0014. CLI uses a trusted operator actor, not a shared agency/service claim. No superuser import path. |
| `ads_export_owner` / `ads_export_reader` | Only the explicit column/view contract in §8; no approver/evidence/subject/raw staging access. |

Enable and **FORCE RLS** on every new ads/staging table, including revision,
component, assignment and correction children. Authorization must traverse children
correctly rather than leaking data through a foreign key helper or count. Revoke
PUBLIC function execution and all direct app DML; guarded SECURITY DEFINER mutation
functions use fixed `search_path = pg_catalog, pg_temp`, fully qualified objects,
verified actor/role checks, explicit row locks and narrow execution grants. Use
existing trusted transaction-local actor context from auth.py; deny missing claims.
Owners do not bypass forced RLS. Export SELECT policies are separate from staff
policies and limited to allowed base columns.

Use `audit.record_change` for each mutable table and explicit decision/application
receipts for transitions. Audit records containing memo subject, approver or
evidence data must be readable only by marketing-ops roles; no PII in routine logs,
exception strings, agency responses or the DW export. Verify audit-table permissions
as part of SQL tests, not just the source-table policy. Do not grant DELETE. No ads
data is published into `public_api` or any RAG namespace in P2. Q7 gates real personal
data use; implementation tests use synthetic actors and synthetic memo details only.

## 7. Thai admin screens and interaction

Reuse doc 22's **Emerald & Champagne** tokens, Google Sans with Noto Sans Thai
fallback/dense-table treatment, shared Hub navigation and existing motion primitives.
No new theme or font package is part of P2. Apply `MotionConfig reducedMotion="user"`:
RowToCard shared-layout detail, short backdrop fade, tabbed detail and DropdownPop;
reduced motion removes transforms/layout travel and retains clear state changes.
Keyboard focus enters detail, Esc closes, and focus returns to its invoking row.
Deep links and URL filters survive refresh/back. Do not close dirty forms without
an explicit discard/save decision. Labels, empty/error/loading states are Thai;
identifiers remain verbatim, selectable and usable with a keyboard.

Staff navigation: `ทะเบียน Memo`, `รายการงบรายเดือน`, `รายการแก้ไขรหัส`.
Agency navigation remains the P1 naming/ID-return flow without these financial links.

### 7.1 Memo register

```text
ทะเบียน Memo                                      [บันทึก Memo]
[ค้นหาเลข Memo] [BUD v] [สถานะจาก E-memo v]
เลข Memo      เรื่อง       BUD   วงเงินรวม   สถานะจาก E-memo   การตรวจข้อมูล
MO…           …           …     …          อนุมัติแล้ว        รอตรวจข้อมูล
  -> รายละเอียด: ข้อมูล Memo | รายการงบที่เชื่อม | ประวัติ
     อ้างอิง E-memo [ข้อความ/ลิงก์]    ผู้อนุมัติและเวลาตัดสินใจ [จำกัดสิทธิ์]
     จัดสรรแล้ว … / ยังไม่จัดสรร … / เกินวงเงิน …
     [บันทึกร่าง] [ยืนยันข้อมูลที่บันทึก]
```

Show external decision and Hub transcription state separately. Explain the external
source beside confirmation. No upload control, preview PDF, approval button or
inference from a valid-looking number. Show each memo once even across several lines.

### 7.2 Lines by month and line detail

```text
รายการงบรายเดือน                         [สร้างรายการงบ]
[เดือน v] [เอเจนซี v] [BUD v] [ขอบเขต v] [สถานะ v]
ขอบเขต/โปรแกรม   เดือน/ช่วงเวลา  เอเจนซี   BUD   งบรวม   Memo   สถานะ
…                …              …        …     …       …      ร่าง
  -> รายละเอียดรายการงบ [ลิงก์ถาวร]
     ภาพรวม | เฟสและ Memo | ชื่อแคมเปญที่เชื่อม | รุ่นและประวัติ
     เฟส [รหัส REM]   BUD   งบรวม   เลข Memo   เลข PO
     [สร้างรุ่นใหม่] [ยืนยันรายการตาม Memo ที่อนุมัติแล้ว]
     SN…  เดือน…  สถานะการตรวจ…                 [เชื่อมชื่อแคมเปญ]
```

Rows summarize parents; expansion preserves phase amounts and distinct memos.
Place monthly and full-period program totals in separate labelled blocks. On assign,
select SN and month, show compatibility/memo status and the exact target revision,
then `ยืนยันการเชื่อม`. Disabled candidates explain missing evidence or membership.
New revisions show old/new differences before confirmation, including reconciliation
findings. A stale submit keeps entered data and explains the 409 in Thai.

### 7.3 Registration detail: staff-only monthly context

```text
SN…   [ชื่อและรหัสแพลตฟอร์ม] [รายการงบรายเดือน]
รออนุมัติรูปแบบชื่อ
เดือน     รายการงบ/โปรแกรม    Memo     สถานะการเชื่อม
…         …                  …        ยังไม่เชื่อม
                                      [เลือกรายการงบ]
```

Use the new staff-only endpoint, never add financial fields to the agency P1 payload.
Keep name/copy/UTM behavior unchanged. A period budget or group budget is context,
not “budget per SN”; show this in Thai. Memo/revision review and pending naming
approval are distinct statuses. Missing context does not mutate the name.

### 7.4 Corrections queue

```text
รายการแก้ไขรหัส                      [เสนอการแก้ไข]
[เดือน v] [เอเจนซี v] [สถานะ v]
รหัสที่พบ    ช่วงเดือน    เอเจนซี    รายการงบปลายทาง    สถานะ
…            …           …         …                 รอพิจารณา
  -> รหัสต้นทาง | ปลายทางแยกเดือน | เหตุผลและหลักฐาน | ประวัติ
     [อนุมัติการแก้ไขรหัส] [ไม่อนุมัติ]   (ผู้ดูแลเท่านั้น)
     [นำรายการที่เลือกไปใช้]             (หลังอนุมัติ; ยืนยันอีกขั้น)
```

Explicit application previews each month, target and evidence. Approval does not
silently apply it. Block unresolved Bangpu conflicts with an explanation and owner
action. Retired/history records remain visible to staff. Evidence links do not
trigger automatic fetching.

Thai readability acceptance: repeat doc 22's dense-table protocol with synthetic
long Thai subjects, mixed Thai/ASCII codes, multiple BUDs, narrow/mobile widths,
200% zoom, keyboard-only navigation and reduced motion. Record named authorized
Thai reviewers before production acceptance; do not claim a design review is a
completed browser/readability test.

## 8. Read-only DW export proposal

Extend the **0014 `ads_export_owner` / `ads_export_reader` pattern** with explicit
column grants, forced-RLS SELECT policies and security-barrier views. Existing P1
views and base permissions remain unchanged. Do not grant SELECT on all new tables,
default future tables, approver JSON, audit or raw staging. The non-login export
owner has only explicit card staging ID/status columns needed to join the cost
views; the reader has no staging access. Source key remains `hub`;
the names below are proposed DW destinations, not tables/jobs created in the DW repo.

| Hub view → proposed DW table | Grain / explicit exported fields |
|---|---|
| `ads_export.media_line` → `hub__media_line` | One **revision component**, key `(line_id, revision_id, component_id)`. IDs, kind, state/archive timestamp, revision number/status, `is_applicable`, scope/group/phase IDs, month or program/period, allowed scope/agency codes, BUD, component gross/optional split, frozen memo ID/number/material version/BUD/gross/status/approval date, fee-PO reference, nonpersonal update timestamp. Frozen memo gross is reference evidence, never an additive component measure. No duplicated parent gross. |
| `ads_export.line_assignment` → `hub__line_assignment` | One assignment-history row: ID, SN code, month, line ID, acknowledged revision, ACTIVE/ENDED, review-required flag, correction-target ID if any, nonpersonal timestamps. No amounts, names, reasons or actors. |
| `ads_export.memo` → `hub__memo` | One memo: ID, memo number/series, requesting BUD, gross/optional split, mirrored/record status, approval date, source MANUAL, row/material versions and update timestamp. **No subject, approver names/decisions, evidence reference, notes or actor UUIDs.** |
| `ads_export.correction` → `hub__correction` | One approved/retired correction-month target: IDs, observed code, agency, month, target line, approval/application/retirement state and nonpersonal `applied_at` timestamp. No evidence, reasons or proposer/approver identity. Only APPLIED, non-retired targets are eligible for downstream resolution. |

These are the four core P2 views. Doc 24 adds six account/commitment/cost/identifier
views, a non-additive typed-budget-item list on each component and an optional
cost-type breakdown on the memo view. Preserve the component grain and gross; never
add its item list amounts to that gross again. Use one repeatable-read, read-only
snapshot across the five P1 and all proposed P2 views.
For current financial totals, filter `is_applicable=true` and sum components exactly
once. Never sum revisions, duplicate a component for each SN, or repeat a corporate
period budget per month. The export carries history so consumers can reconcile
changes. Correction exports do not override confirmed native bindings or turn an
ambiguous match into an automatic assignment. DW actuals, findings, jobs and source
registration are separate owner work under Q3; no deployment is claimed here.

## 9. Verification contract

Use synthetic fixtures only, including all memo subjects/approvers, amounts, source
files, IDs and header profiles. No live ledger, memo, Sheet, REM, media-plan or DW
reads/writes are necessary to implement or test P2.

| Suite | Required evidence |
|---|---|
| SQL/RLS (`supabase/tests/ads_media_lines.sql`, proposed) | Forced RLS on every parent/child/staging table; Online/admin capabilities; agency/residential/public denial including guessed IDs/counts; audit PII restrictions; export column allowlist; no DELETE; immutable approved snapshots; exact financial precision; partial memo reconciliation finding; active-revision invariant; phase-grain preservation; corporate period counted once; overlapping corrections rejected. |
| Concurrency (`supabase/tests/concurrent_ads_line_revision.mjs`, proposed) | Two connections confirm revisions with the same expected previous revision: one success, one stale/conflict, exactly one applicable approved revision; failed replacement leaves old revision intact. Race memo invalidation against line confirmation/acknowledgement: no ACTIVE applicable context may commit against invalidated evidence. Also race assignments for one SN/month and duplicate imports/correction month keys. Wire into `npm run test:db`. |
| Importer tests (`tests/test_stage_ads_ledger.py`, proposed) | Header reordering succeeds; missing/duplicate/ambiguous/unexpected headers fail; no index guessing; unknown production profiles fail; optional memo absent stays missing; leading zeros retained; decimal/date validation; exact replay no-op; conflicting/moved-row replay quarantined; whole-batch atomicity; dry run has no writes; card columns/values absent from accepted input, hashes, staging, archives, logs and error output. Verify the tests are included in a required test command, or run/report their separate command. |
| API pytest | Every endpoint role, forged actor/agency denial, validation, happy paths, explicit assignment for A–F, uncovered C phase, D/E ambiguity, program-period/BUD checks, memo edit suspension, acknowledgement revalidates dropped phase/agency and current evidence, archive retains budgets but blocks new assignments, persisted discrepancy acknowledgement, correction approval/application separation, stale writes and P1 regression. No finance fields leak through P1 agency endpoints. |
| Playwright (`tests/ui/ads-media-lines.spec.ts`, proposed) | Thai labels for all five screens; manual memo confirmation wording; filters/deep links; phase detail and totals; create/revise/assign; monthly registration context; admin correction versus Online; agency navigation/API denial; keyboard focus/Esc, mobile/dense Thai table and reduced-motion run. Synthetic fixture cleanup uses existing isolated-test mechanisms, not production DELETE grants. |

Implementation test paths refine the proposed names above: the shared ledger/card
importer tests are `apps/api/tests/test_finance_imports.py` and
`apps/api/tests/test_finance_imports_db.py`, so the required API pytest command runs
them. The combined finance browser suite is `tests/ui/ads-finance.spec.ts`.
The exact operator handoff format and local CLI commands are in
[P2 import format](ads/P2_IMPORT_FORMAT.md).

The additional APIs/screens, imports, allocation/cap rules and tests in doc 24 are
also part of expanded P2 acceptance. Required real commands after P2 implementation:

```powershell
npm.cmd run typecheck --prefix apps/admin
npm.cmd run build --prefix apps/admin
uv run --project apps/api --env-file apps/api/.env pytest apps/api/tests
npm.cmd run test:db
npm.cmd run test:ui
```

Report actual output and any blocked check; never mark an unrun command passed.
Write a P2 implementation report following the P1 report structure: files per step,
validation output, design deviations/reasons and remaining go-live blockers. The
checks above define acceptance; actual measured results belong in that report.

## 10. Open questions, defaults and exclusions

[OPEN_QUESTIONS](ads/OPEN_QUESTIONS.md) is the decision register. Q1 (accepted E-memo
access/manual evidence), Q4 (approved exact ledger headers and memo-column template)
and Q5 (named correction authority) are **go-live blockers, not coding blockers**
after `P2.0 approved`. Code against synthetic fixtures and the documented defaults.
Q2 continues to block production name issuing. Q3 governs real DW exchange; Q7
governs real approver personal data. New Q13 asks about readable ZONE slugs without
implementing them; Q14 confirms memo formats; Q15 covers funding contributions;
Q16 covers program/BU mappings; Q17 covers phase coverage and duplicate ledger grain.
The replacement card-paid addendum adds Q18–Q24 for LINE OA ownership, memo cadence,
account-level billing exports, Media role provisioning, card source/control profiles,
memo identity evidence and Finance's document/split/allocation policy.

Included by doc 24: read-only classified card-sheet costs, typed document-reference
checks, account registries/BUD splits, recurring commitments/caps, memo aliases and
prepaid monthly allocations. These do not implement full bill/payment workflows.
Not in P2: P3 actuals/read-back/C1–C9 engine; P4 E-memo/statement PDF storage,
R2, OCR, automatic statement classification/LINE OA count matching or document search;
any RAG for card statements; QT/PO creation or approval, bill approval or payment
packages; BF-1 targets; inter-line funding contributions; readable ZONE slug editing;
any P1 behavior/grammar/setting change. Fee-PO and required documents are reference
text only. No change to REQUIREMENTS, doc 15, the DW repo or external systems.

**Stop gate:** expanded P2.0 was explicitly approved on 30 September 2026. Complete
schema → API → UI → tests and the implementation report, then stop. Engineering
approval does not resolve business approvals or authorize P3–P6, a commit or a push.
