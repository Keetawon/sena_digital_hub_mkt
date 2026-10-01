# 25 — Line actuals, exceptions and document tracking (P3.0)

Date: **1 October 2026 (Asia/Bangkok)**. Status: **P3.0 approved for demo-first TEST implementation**.
The owner supplied `P3.0 approved` and authorized Tasks 0–6. Section 13 records the
implementation defaults before code; business assumptions below remain proposals
for production and appear as `รอคำตอบ` remarks. Implement P3 before P4, one priority
at a time. P1/P2 behavior, issued names, the
SENA-H grammar and `sena_h_approved=false` are unchanged.

Sources: [doc 19 §6](19-campaign-naming-registry.md#6-dw-integration-and-matching),
[doc 20](20-marketing-operations-flows.md) BF-5/BF-12 and §§5–7,
[doc 23 §8](23-media-lines-and-memo-register.md#8-implemented-read-only-dw-export-contract),
[doc 24](24-card-costs-and-recurring-commitments.md),
[doc 22 §3](22-hub-assistant-and-ui.md#3-hub-motion-and-interaction-spec),
[P2 import format](ads/P2_IMPORT_FORMAT.md), migrations 0014/0015 and their view
comments, and the [decision register](ads/OPEN_QUESTIONS.md). The broader process in
doc 20 includes future controls and procurement; only the bounded scope below is P3.

The owner reports that the DW P1 intake and contract have been pushed. A read-only
review of its 1 October contract confirms the documented 15-view/202-column offline
intake shape; it does not establish a live run, acceptance of this newly frozen
fixture set or deployed P3 marts. The local read-only login and
[frozen 15-view TEST manifest](../supabase/tests/fixtures/ads_export/manifest.json)
provide the contract handoff. No DW repository or external source is changed here.

## 1. Outcome, ownership and assumptions

Online sees which approved Hub line receives each campaign's platform spend and
attributed leads, how that association was made, and which references or C5/C6 issues
need attention. Budgets, platform delivery, card cash and monthly allocated costs
remain distinguishable. A balanced statement or complete reference list does not
approve a budget, memo, bill or payment.

| Owner | Responsibility |
|---|---|
| Hub | Authoritative registrations, bindings, scopes, financial lines/revisions, monthly assignments, applied corrections and confirmed P2 cost records; local exception workflow and follow-up history. |
| DW | Ingest the safe Hub exports; normalize platform and REM facts; compute matches, actuals and C5/C6 findings; publish complete read-back snapshots. |
| Online / marketing operations | Review unresolved links, reuse P2 assignment/correction actions, maintain workflow ownership, and review document references within accepted authority. |
| Finance / business / identity owners | Approve document rules, evidence authority, lead definitions, production cutover and any future agency spend projection. |

**Production contracts and operating policies remain proposals.** The approved TEST
adapter and demo defaults in §13 make this slice implementable without another pause. The
following assumption IDs are used throughout, so a default is not mistaken for a DW
agreement or production approval. Existing P1/P2 invariants are retained rather than
reopened.

| Assumption | Decision still required | Default pending answer |
|---|---|---|
| A25.1 / Q25 | DW accepts the four marts, exact fields, manifests, full-snapshot handoff and TEST namespace below. | Develop only against synthetic contract fixtures after P3 approval; no real read-back activation. |
| A25.2 / Q25 | Production operating cutover, history ownership and program periods spanning cutover. | Candidate **2026-10-01**, aligned with the DW contract's October proposal but explicitly inactive until signed off. Hub remains authoritative for every financial month it imports, including earlier history. |
| A25.3 / Q25 | Daily schedule, revision/rebuild window and freshness service level. | Propose one completed snapshot daily by **07:00 Asia/Bangkok**, on-demand reviewed reruns, and a **36-hour** stale threshold. These are proposed targets, not current service guarantees. |
| A26.1 / Q26 | DW accepts matching precedence, temporal handling, C5/C6 rule codes and parser contract. | Confirmed native binding wins; an unusable authoritative link stays unresolved. No ambiguous, fuzzy or silent fallback remapping. |
| A26.2 / Q26 | REM lead identity, deduplication, attribution timestamp/window, platform spend basis and CPL comparability. | Show unavailable metrics as null with a reason; never substitute platform conversion counts for REM leads or zero for missing data. |
| A26.3 / Q26 | Comparable typed media budget and corporate period reporting. | Full period budget once; no invented monthly phasing. Percent used/CPL only on an explicitly comparable basis. |
| A27.1 / Q24, Q27 | Accepted requirement matrix, due-date rules, document owner and authority to verify or waive a requirement. | Matrix remains proposed. Imported reference presence is visible; no fabricated deadline, verification or completeness claim. |
| A28.1 / Q28 | Whether agencies should receive a narrowly projected own-spend view. | Existing P2 financial denial remains. No agency financial endpoint or role grant is enabled by this design. |

## 2. Source contract and counting rules

The DW must consume the existing **15** `ads_export` views together, under one
repeatable-read, read-only snapshot, using source key `hub`. The complete column
contract and migration checksums are in the fixture manifest. P2 exports deliberately
omit memo approver PII, evidence text, raw rows, descriptors and private filenames.
Do not expand those exports merely to render the document tracker: the Hub can read
its own permitted P2 references locally.

| Input | P3 use and mandatory constraint |
|---|---|
| `hub__media_line` | Authoritative line identity and revision components. Sum `gross_amount` only where `is_applicable=true`, once per component. `budget_items` itemize that amount; they are not additional budget. Frozen memo gross is reference evidence, never an additive component measure. |
| `hub__line_assignment` | Explicit SN/month link. Require nullable `is_current IS TRUE`: ACTIVE link, ACTIVE line and acknowledged current revision. False/null cannot establish a current financial match. Preserve ended/stale links as history. |
| `hub__correction` | Only `is_applied=true` targets may resolve their exact observed code, month and agency. Approval alone is insufficient. No override of confirmed native binding. |
| Five P1 views | Resolve issued CODE, exact frozen name, native identity, scope identity and C/D member sets. Variants and multiple bindings never multiply a line budget or campaign spend. |
| `hub__memo`, `hub__memo_identifier` | Safe canonical identity and status checks. A retired alias is historical; punctuation similarity never creates a match. |
| `hub__ad_account`, `hub__channel_account` | Confirmed effective-dated account context, including `effective_valid_to`. This does not imply an SN or line assignment. |
| `hub__recurring_commitment` | Context and expected coverage only. Cycle amount and cover caps are neither actual spend nor an additional budget already reserved in a line. |
| `hub__cost_record` | Applicable typed cash leaves, signed by DEBIT/CREDIT. Do not add a full source occurrence to its leaves. Card balance settlement is not another expense. |
| `hub__cost_allocation` | Applicable monthly management allocations. Join to the applicable parent cost as well; superseded statement interpretations must not leak into monthly totals. Never add these amounts to cash amounts. |

Availability limits are part of the contract. The `media_line` view's inner joins
omit componentless draft lines; absence cannot prove that no draft exists in the
Hub. Assignment exports include `ended_at` but no start time or explicit
`review_required` field. Correction exports include `applied_at`, not review-decision
or retirement timestamps. Do not reconstruct these missing history facts from the
current snapshot. Commitment occurrence IDs are opaque: no occurrence schedule view
is exported. There is no exported document-requirement or statement-control relation,
nor cost `evidence_refs`; those remain local staff-only Hub reads. C6 cannot compare
an unavailable raw ledger campaign code by substituting `formatted_mapping` or a
correction's observed code; label the missing comparison evidence explicitly.

Money remains `numeric(14,2)` THB; transport amounts are decimal strings. Source
account/campaign/REM IDs and codes remain text, including leading zeros. Month is the
first day of an Asia/Bangkok calendar month; event/snapshot times are `timestamptz`.
DW must explicitly normalize platform reporting time zones before calendar-month
joins. A billing cycle ending on the 25th is not a calendar-month allocation.

Financial lines come from `hub__media_line`, **not a second DW reconstruction of
the INVOICE Ads ledger**, for all months imported into the Hub. No existing `adinv`
financial-line ingestion or live history mart is asserted here. Read-only ledger
evidence cannot create a competing budget authority for an imported month.

### 2.1 Cutover and historical authority — A25.2

Propose `hub_operating_from_month = 2026-10-01`, aligned with the DW contract's
October 2026 proposal. **Acceptance remains unresolved under Q25**; the date is not
an approved activation. The boundary concerns new operating entry, not exclusion of earlier Hub
imports. It is not an activation date or delivery promise. Activation needs DW, Online and
Finance acceptance of the opening Hub line population and unresolved P2 go-live
decisions; production SENA-H issuance separately retains P'Note's approval gate.

- A Hub line imported for an earlier month remains Hub-owned and eligible for an
  explicit historical assignment under P2 rules. Its date does not switch authority
  to another source.
- Pre-Hub platform history without an accepted Hub financial line stays separately
  labelled historical/unassigned spend. No invented legacy budget or memo fills the
  gap; no historical financial-line feed is assumed to exist.
- On/after the approved boundary, missing Hub lines likewise yield unresolved spend.
  If a future historical line feed is proposed, its identity/authority/cutover map
  needs a separate DW contract decision before ingestion. A matching label or amount
  is not identity; do not union two budget authorities for the same month.
- A program crossing the boundary requires an explicit opening treatment. Preserve
  the original period budget once; do not copy it into every month or divide it at
  cutover without approved phasing evidence. Hold affected comparative totals as
  unavailable until that treatment is accepted under Q25/Q26.
- Delayed go-live requires a recorded opening reconciliation and an explicit decision
  whether to retain or revise the operating boundary; the calendar reaching
  1 October cannot activate a source automatically.

## 3. Proposed DW marts and snapshot envelope — A25.1

These are **DW-owned proposals**, not implemented Hub or DW tables. Every row carries
`environment text` (`test` or `production`), `contract_version text`, `snapshot_id
text`, `snapshot_at timestamptz` and `hub_snapshot_id text`. `snapshot_at` is the
completed DW computation time; the separate Hub/platform/REM watermarks below are
the ages of the actual inputs. Export time must not substitute for source freshness.
Keys listed below are unique within `(environment, snapshot_id)`.

P3 also proposes `effective_at timestamptz|null`, `recorded_at timestamptz`,
`temporal_basis text` and `temporal_provenance jsonb` for each read-back row. These
describe the selected source interpretation, not additions to the existing fifteen
Hub export views. The meanings and unavailable-history behavior are explicit in
§11.2; a month date or first observation never fabricates an effective event time.

### 3.1 `gold.dim_media_line`

**Grain:** one stable Hub line revision, with a structured list of its exact financial
components. **Key:** `(line_source, line_key, revision_key)`. For Hub rows,
`line_source='hub'`, `line_key=line_id::text` and `revision_key=revision_id::text`.
No `adinv_history` line rows are proposed in this contract.
Do not use a group token as the primary key. A program is one period line.

| Columns | Type / meaning |
|---|---|
| `line_source`, `line_key`, `revision_key` | text; namespaced source and stable identity. |
| `hub_line_id`, `hub_revision_id` | UUID; required Hub identity, including imported historical months. |
| `revision_no`, `revision_status`, `line_state`, `is_applicable`, `archived_at` | integer, text, text, boolean, nullable timestamptz. Archiving alone does not remove an ACTIVE line's applicable historical budget. |
| `kind`, `scope_id`, `scope_code`, `agency` | text, nullable UUID, text, nullable text; no single agency invented for a shared program. |
| `month`, `program_ref`, `period_start_month`, `period_end_month` | nullable date/text/date/date according to P2 kind. |
| `permitted_scope_ids`, `permitted_agencies` | UUID array and text array copied from the revision, not inferred from observed campaigns. |
| `components` | JSON array, unique `component_id`, ordered by ID; exact shape below. |
| `approved_gross`, `approved_media`, `approved_fee` | nullable numeric(14,2); sum applicable components once. Media/fee nullable unless the declared split is complete. Gross is one full monthly or period envelope. |
| `budget_basis`, `typed_budget_complete`, `source_updated_at` | `MONTH`/`PERIOD`, boolean, timestamptz. Rows with uncertain comparison evidence use null comparable measures and a reason in `quality_codes`. |
| `quality_codes`, `hub_source_snapshot_at` | text array, timestamptz; machine codes only, no private notes. |

Each `components` element has `component_id text`, `component_kind text`,
`rem_project_id text|null`, `formatted_mapping text|null`, `bud text`,
`gross_amount decimal-string`, `media_amount decimal-string|null`,
`fee_amount decimal-string|null`, `memo_id UUID|null`, `fee_po_ref text|null`, and
`budget_items [{id text, cost_type text, payment_method text, amount decimal-string}]`.
The JSON list preserves phase/BUD provenance without repeating parent measures in a
flattened join. Component values and parent gross are alternative levels of the same
budget. A BUD filter cannot attribute shared platform spend to a phase by budget ratio.

### 3.2 `gold.bridge_native_campaign_media_line`

**Grain:** one native campaign identity × Asia/Bangkok month, including unresolved
identities. **Key:** `(platform, account_id, campaign_id, month)`. At most one
effective target line in a month. A multi-line candidate set is not multiple rows of
the same spend. Historical mid-month remapping cannot be modeled as two simultaneous
targets; it requires explicit DW temporal evidence and Q26 review before support.

| Columns | Type / meaning |
|---|---|
| `platform`, `account_id`, `campaign_id`, `month` | text, text, text, first-day date; platform vocabulary accepted in Q26. |
| `line_source`, `line_key`, `revision_key` | nullable text; effective target, null when unresolved. |
| `observed_code`, `registration_code`, `name_id`, `scope_id`, `agency` | nullable text/text/UUID/UUID/text; observed and authoritative values stay separate. |
| `observed_name`, `observed_at`, `source_kind`, `source_record_refs` | nullable text, nullable timestamptz, text, JSON array; literal DW observation with provenance under §11.3, never a reconstructed name or ledger code. |
| `match_method`, `candidate_method` | Selected method: `CODE`, `HUB_NATIVE_ID`, `SCOPE_MONTH_AGENCY`, `APPLIED_CORRECTION`, `UNRESOLVED`; nullable candidate method records an unaccepted suggestion without claiming an effective link. |
| `assignment_id`, `binding_name_id`, `correction_target_id` | nullable UUID; provenance for the selected method. |
| `candidate_line_keys`, `conflict_codes`, `unresolved_reason` | text array, text array, nullable text code. A candidate is not an approved assignment. |
| `name_conformance`, `parser_version`, `match_rule_version` | text (`SENA_H_VALID`, `LEGACY`, `INVALID`, `UNKNOWN`), text, text. Never regenerate/overwrite an issued name. |
| `platform_source_snapshot_at`, `hub_source_snapshot_at` | timestamptz; source watermarks. |

The bridge is rebuilt from a consistent complete snapshot, with old snapshots
retained under the agreed history policy. A match is an analytics association; it
does not insert or change `ads.line_assignment`.

### 3.3 `gold.fact_media_line_monthly`

**Grain:** one authoritative line × calendar month. **Key:** `(line_source,
line_key, month)`. Corporate/BU programs have one row for each covered month with
actual activity/coverage, but their **period budget lives once in the dimension**.
Source campaigns without a resolved line remain in the bridge/findings and a separate
manifest unresolved-total control, not an invented line named "unknown".

| Columns | Type / meaning |
|---|---|
| `line_source`, `line_key`, `revision_key`, `month` | text/text/text/date; current dimension revision reference. |
| `budget_basis`, `approved_month_gross`, `approved_month_media`, `typed_budget_complete` | text, nullable numeric(14,2), nullable numeric(14,2), boolean. Monthly measures null for PERIOD lines without approved phasing. |
| `platform_media_spend`, `platform_spend_basis`, `platform_data_through` | nullable numeric(14,2), versioned text basis, timestamptz. Basis states currency, tax/credit treatment and report timezone; no silent conversion. |
| `attributed_leads`, `lead_definition_version`, `leads_data_through` | nullable bigint, nullable text, nullable timestamptz. Count distinct accepted REM lead identity under Q26, not campaign rows. |
| `media_budget_used_pct`, `media_cpl`, `comparison_reason` | nullable numeric(9,2), nullable numeric(14,2), nullable text code. Formula and null rules in §6. |
| `campaign_count`, `unresolved_context_count` | bigint; counts are descriptive, never amount multipliers. |
| `card_cash_by_type`, `card_monthly_by_type` | JSON arrays described below; two alternative accounting bases in separate sections. |
| `financial_components`, `quality_codes` | component identity/BUD/budget array from the dimension, and text array. No allocated spend or leads invented for children. |
| `hub_source_snapshot_at`, `platform_source_snapshot_at`, `rem_source_snapshot_at` | timestamptz, nullable timestamptz, nullable timestamptz. |

Each card array element is `{cost_type, payment_method, amount, cost_count}` with
unique `(cost_type, payment_method)`, decimal-string signed THB `amount`, and integer
`cost_count`. Include only applicable P2 costs explicitly linked to this line;
monthly allocations inherit that line from their applicable parent cost. Cash groups
by charge month, recognition groups by allocation month. Costs with no line remain
visible in P2 and the snapshot's unassigned-cost control, not allocated by account or
scope guess. No card `MEDIA` amount is added to platform spend: it can be settlement
of the same advertising. No "all-in total" is offered without a future accepted
reconciliation basis. Five cost types stay separately labelled.

Missing source data means null measures with `quality_codes`, not zero. Zero is
valid only when the accepted source coverage attests a complete zero-activity period.
All derived totals filter applicable revisions and use the same snapshot.

### 3.4 `gold.fact_marketing_ops_finding`

**Grain:** one C5/C6 rule × stable subject × calendar month. **Key:** `finding_key`.
Proposed stable key is SHA-256 of canonical UTF-8 JSON
`[environment, "marketing_ops", control_code, rule_code, subject_kind, subject_key, month]`.
Native subject keys contain platform/account/campaign text IDs; line subjects use the
namespaced stable line key. Changing amount, display wording, owner, severity, run
ID or revision does not change identity. A materially different rule requires a new
`rule_code`; `rule_version` alone is provenance and must not churn the key.

| Columns | Type / meaning |
|---|---|
| `finding_key`, `control_code`, `rule_code`, `rule_version` | text; control restricted to C5/C6 in this slice. |
| `subject_kind`, `subject_key`, `month` | text/text/date; stable source identity, no free-text label as key. |
| `line_source`, `line_key`, `platform`, `account_id`, `campaign_id`, `registration_code`, `agency` | nullable text references; preserve unresolved identities without guessing an owner agency. |
| `condition_present`, `severity`, `first_observed_at`, `last_observed_at`, `cleared_at` | boolean, text, timestamptz, timestamptz, nullable timestamptz. DW source state, separate from Hub workflow. |
| `expected`, `observed`, `context_refs` | schema-validated JSON containing codes, safe IDs/counts/amount strings and source-version references; no raw descriptors, PII, evidence URLs or arbitrary HTML. |
| `suggested_owner_role`, `match_method`, `source_snapshot_at` | text, text, timestamptz; owner suggestion is not a permission or assignment. |

When the finding compares literal identity evidence, `observed` uses the §11.3
envelope; `source_record_refs` retain its source and observation time. Raw payment
descriptors and personal data are not campaign-code evidence and remain excluded.

Retain cleared findings in the agreed history window, so disappearance from a partial
delivery cannot be mistaken for resolution. Each full delivery explicitly marks its
covered month range. A vanished key is a contract error unless an accepted complete
rebuild/tombstone rule explains it. Snapshot history and source clearance are DW
responsibilities; user acknowledgement/resolution is stored only in the Hub (§8).

### 3.5 Manifest, cadence and test/production separation

Each delivery contains all four relations and a manifest with `contract_version`,
`environment`, `snapshot_id`, `snapshot_at`, `exported_at`, `hub_snapshot_id`,
`hub_source_commit`, `hub_migration_checksums`, `covered_month_from/to`,
`hub_operating_from_month`, `parser_version`, `match_rule_version`,
`lead_definition_version`, and per-source watermarks. For every relation record
`relation`, `columns` (ordered names/types/nullability), `primary_key`, `row_count`,
`file_sha256` and `snapshot_at`. UTF-8 JSON arrays use decimal strings and ISO dates.
Manifest `control_totals` includes platform resolved/unresolved totals and confirmed
card assigned/unassigned totals **on separate cash/monthly bases**; no blended sum.

A25.3 proposes a complete daily rebuild of the accepted covered period, with an
explicit reviewed rerun after P2 correction/assignment changes. DW must confirm the
practical history window and source arrival schedule; until then do not promise
real-time data. A correction action displays `บันทึกแล้ว รอข้อมูลจากคลังข้อมูล`.
Do not recompute the DW's finding locally to make it disappear immediately.

TEST deliveries have `environment=test`, synthetic-only source provenance and a
separate DW dataset/source credential. Production ingestion rejects TEST manifests,
fixture identifiers and mixed environments. The local `dw_hub_reader` works only on
the workstation loopback endpoint; it is not a production read-back credential.
Production service identities and hosting remain separately approved operations.

## 4. Hub read-back staging — A25.1

Propose `scripts/stage-ads-actuals.py`, following `scripts/stage-gold-project.py`:
operator-exported files, strict validation and a dry run before explicit `--apply`.
No direct DW writes, refresh triggers in the DW or access to its base credentials.
The first implementation uses the established local-only staging target; hosted
read-back needs an approved deployment/credential step.

1. Read the manifest and four files. Validate exact columns/types, environment,
   source timestamps with offsets, checksums, counts, key uniqueness, cross-relation
   references, coverage, money precision and declared versions. Reject partial or
   mixed-generation delivery, duplicate applicable revisions, unknown line references
   and differences from the accepted contract. Unknown IDs remain explicit validation
   issues, never a guessed master-data match.
2. Keep immutable `staging.ads_actuals_batch` provenance and safe source rows in four
   staging relations corresponding to the marts. Proposed batch states are
   VALIDATED/APPLIED/QUARANTINED. Retain source snapshot time independently of receipt
   time. Dry run writes nothing.
3. Apply one verified snapshot in one transaction, using a transaction-scoped lock
   and expected-current snapshot guard. Atomically move the published snapshot pointer
   only after all relations and control totals validate. No partial table activation.
4. Exact `(environment, snapshot_id, content hashes)` replay is a no-op. A reused ID
   with different content is quarantined; an older snapshot cannot displace a newer
   one without an explicit reviewed historical rebuild. Keep the last good snapshot
   available with a visible failed-refresh/freshness notice.
5. Reads join immutable staged DW facts to permitted current Hub context and separate
   workflow state. If the Hub has changed since the DW input snapshot, show
   `ข้อมูลการเชื่อมมีการเปลี่ยนแปลง รออัปเดต` rather than claiming a stale association
   is current. A period or role filter is applied server-side, including totals.

Future tables/functions follow forced RLS, fixed `search_path`, trusted role/actor
claims, `audit.record_change`, no DELETE and optimistic versions on mutable workflow.
No ads data, findings or document references enter `public_api` or public RAG.

## 5. Matching and C5/C6 semantics — A26.1

Discovery order remains **CODE → Hub-bound native ID → (SCOPE, Asia/Bangkok month,
AGENCY) → applied correction → unresolved**. As doc 19 specifies, this is candidate
discovery order, not permission to override a binding. Check confirmed native identity
before choosing the final candidate; a binding always wins a conflicting observed
CODE. Preserve both observations and emit a C6 conflict.

1. Validate an observed SENA-H CODE with the agreed parser/check character, then
   resolve the exact registry record and its current monthly assignment. For an
   unbound platform campaign, require its literal observed SENA-H name, including
   any variant, to equal an issued frozen `campaign_name` for that CODE. A valid
   check character alone does not establish a registered name. Malformed, mismatched
   or unissued names remain unresolved candidates and cannot bypass this check via
   scope/correction fallback. A confirmed binding in step 2 still wins despite a
   name conflict, with a C6 diagnostic. Legacy/raw-code evidence needs the separately
   accepted Q26 policy. A CODE alone is not a media line; preserve issued variants
   under the same SN without multiplying spend.
2. Look up exact `(platform, account_id, campaign_id)` in Hub bindings. Resolve its
   authoritative CODE and `is_current` monthly assignment. If valid, choose that
   target and record `HUB_NATIVE_ID`, even when the observed name disagrees. If the
   bound registration lacks a usable current assignment, the target is unresolved;
   never route it elsewhere through weaker scope or correction candidates.
3. For an identity with no confirmed binding and no unusable authoritative CODE link,
   an exact scope/month/agency candidate is a suggestion. A final Hub-backed match
   still needs the identified registration's explicit `is_current IS TRUE` monthly
   assignment and all P2 scope rules. Even a unique candidate without that assignment
   stays `UNRESOLVED` / `EXPLICIT_ASSIGNMENT_REQUIRED`, with its `candidate_method`.
   Ambiguity remains unresolved; no closest-label or amount matching.
4. Only after those checks may an exact **applied**, non-retired correction target
   suggest its observed code/month/agency target. Final acceptance still checks the
   explicit current SN/month assignment; applying a crosswalk is not that assignment.
   Conflicting or multiple effective targets remain unresolved. An approved-but-
   unapplied correction has no effect. Conflicting
   `C-MIBF-BNGPU` / `C-MIGD-BNGPU` remain blocked under P2 rules.
5. Otherwise retain `UNRESOLVED` with a machine-readable reason and a C5/C6 finding.
   A stale acknowledged revision, suspended line or incomplete scope membership is
   not an invitation to choose another line. Cancelled registrations retain historical
   evidence; new-period validity and historical as-of interpretation require Q26.

For compatibility with the DW contract's coarser method vocabulary, propose
`CODE`/`HUB_NATIVE_ID` → `REGISTRY`, `SCOPE_MONTH_AGENCY` → `NAME_KEY`,
`APPLIED_CORRECTION` → `CROSSWALK`, and `UNRESOLVED` unchanged. Retain the granular
method for Hub explanations. Q26 must accept this mapping and candidate-versus-
effective semantics; the Hub does not silently redefine the DW's current contract.

For A, use its exact group. B needs its exact phase among the group's components. C
requires **every** immutable registry member; a raw group token cannot reconstruct
that set. D uses its exact ZONE pool/member set and E its exact BRAND pool, without
distributing shared spend to projects. CORP/BU require Online's explicit program and
period mapping; a scope token alone cannot choose between programs or agencies.
Apply any effective member dates from the accepted source snapshot. Source gaps
produce unresolved results rather than changing P1 scope tokens.

| Control | Bounded P3 condition | Suggested remedy |
|---|---|---|
| C5 | Spending native campaign has no resolved eligible Hub line, stale monthly acknowledgement, or no applicable approved financial revision. If the complete required P2 evidence is unavailable, report the check unavailable rather than claiming an approval breach. | Inspect identity/context; return/bind IDs through P1; explicitly assign/acknowledge through P2; review the existing line/memo workflow. |
| C6 | Observed CODE/scope/agency conflicts with confirmed binding, registry membership, current assignment or authoritative line/master context; conflicting correction evidence. | Show both IDs and match method; propose/review/apply a P2 correction only where allowed, or explicitly repair the monthly assignment. |

This proposes alignment with the DW's narrower financial C5 definition. Name/check-
character failures remain visible identity diagnostics; they are not automatically
a financial approval failure. Doc 20's broader name-conformance target remains
outside this narrower initial C5 rule unless Q26 explicitly accepts an extension.

The exact rule codes, treatment of pre-cutover legacy campaigns and meaning of "new
spend" require DW/Online agreement. Do not reclassify all historical SENA-7/V1 names
as new SENA-H failures. An authoritative bound line can retain its attributed spend
while C6 flags an incorrect observed name. A parse failure never generates a new
name or changes an issued one.

## 6. Thai line-actuals screen and comparable metrics

Proposed route `/ads/actuals`, Thai menu `ผลใช้จ่ายรายเดือน`. Filter state is in the
URL: month, agency, BUD, scope and selected line. For a multi-BUD parent, the BUD
filter means `รายการที่มี BUD นี้`; display all its children and do not label the
parent's whole spend as that BUD's spend. A child-only budget subtotal is clearly
labelled and has no fabricated child spend/CPL.

```text
+-----------------------------------------------------------------------+
| ผลใช้จ่ายรายเดือน                          ข้อมูล ณ 1 ต.ค. 2569 07:00 |
| เดือน [พ.ย. 2569] เอเจนซี [ทั้งหมด] BUD [ทั้งหมด] ขอบเขต [ทั้งหมด]    |
| งบสื่อที่เปรียบเทียบได้ | ใช้จ่ายสื่อถึงวันที่ | ใช้ไป | ผู้สนใจ | CPL |
| ช่วงเวลาข้อมูลสื่อ/ผู้สนใจ   [ดูความครบถ้วน]                           |
| รายการ / ขอบเขต | งบที่อนุมัติ | ใช้จ่ายสื่อ | ผู้สนใจ | วิธีเชื่อม    |
| C-DEMO-TEST1     | ...         | ...       | ...    | ผูก ID ใน Hub  |
| [เปิดรายละเอียด]  งบทั้งช่วงเวลาแสดงแยกจากยอดรวมงบรายเดือน              |
+-----------------------------------------------------------------------+
| รายละเอียดรายการ                         [ภาพรวม] [แคมเปญ] [เอกสาร] |
| แคมเปญ: platform / account_id / campaign_id / SN / วิธีเชื่อม           |
| งบรายเดือน ...  หรือ งบทั้งช่วงเวลา ...  ช่วง ... ถึง ...              |
| ค่าใช้จ่ายผ่านบัตร: [ยอดเรียกเก็บ] [ค่าใช้จ่ายตามเดือน]                 |
| สื่อโฆษณา | ค่าบริการเอเจนซี | ช่องทาง | เครื่องมือ | ค่าธรรมเนียมธนาคาร |
| ยอดบัตรอาจเป็นการชำระค่าสื่อเดียวกัน ไม่รวมซ้ำกับยอดจากแพลตฟอร์ม        |
+-----------------------------------------------------------------------+
```

Wireframe dates/IDs are illustrative, not a statement that November data exists.
`platform_media_spend` is spend to the displayed source cutoff. `% used` is
`100 × comparable platform_media_spend / approved_month_media` only when the
denominator is positive, applicable, fully itemized for the accepted MEDIA basis,
and the source coverage/tax/currency basis agrees (A26.2/3). Otherwise show `—` with
`ยังเปรียบเทียบงบสื่อไม่ได้` and the reason. Never divide media spend by a combined
gross envelope while labelling it media budget usage. Zero budget and nonzero spend
remain visible; no infinity or implied pacing alert.

CPL is comparable platform media spend divided by accepted attributed REM leads
for the same period/campaign coverage, rounded for display to two decimals. With
zero leads show `— / ยังไม่มีผู้สนใจ`; with missing attribution show
`— / ข้อมูลผู้สนใจยังไม่ครบ`. Do not sum platform conversions into REM leads or
round inputs before aggregate calculation. Q26 must settle late leads, duplicates,
re-attribution and channel coverage before a real CPL is presented as comparable.

For a program period, display full approved period budget once and period-to-date
spend across its months. Monthly spend can be shown, but monthly budget and percent
remain null without approved phasing. A multi-program total counts each period
envelope once and is labelled separately from monthly-only totals. Period-to-date
percent requires complete comparable coverage across the entire selected period.

Show each source watermark, not only the latest export time. If stale under the
accepted A25.3 threshold, preserve the last good numbers with `ข้อมูลยังไม่อัปเดต`.
No-source/empty/error states distinguish `ยังไม่มีข้อมูลจากคลังข้อมูล`,
`ไม่พบรายการตามตัวกรอง` and `โหลดข้อมูลไม่สำเร็จ ลองอีกครั้ง`.

## 7. Document tracking from existing references — A27.1

Proposed route `/ads/documents`, menu `ติดตามเอกสาร`. This is a **reference tracker**,
not P4 file storage/search, a procurement module, C9 enforcement or a payment action.
Generate a monthly line × document-requirement view from the **versioned pair**
`(cost_type, payment_method)` in P2. The matrix remains PROPOSED under Q24; display
`รูปแบบเอกสารรอยืนยันจากฝ่ายการเงิน`. Missing a cost split or payment method means
`ยังระบุชุดเอกสารไม่ได้`, not a guessed matrix or a passed checklist.

The underlying requirement key is `(line_id, month, subject_kind, subject_id,
requirement_version, requirement_code)`. Subjects are exact revision components or
applicable cost records; this preserves different phase memos/POs and several vendor
charges. A monthly line summary expands to those subjects, rather than treating one
memo or PO as satisfying every child. Program references can appear in each relevant
month for navigation, while the document/budget itself is not duplicated.

| Existing P2 source | V1 tracker behavior |
|---|---|
| Ledger-import component `memo_id`, `observed_memo_no` and frozen canonical context | Display the exact existing reference and its provenance. An absent memo column remains missing; never recover it from a campaign name or adjacent row. |
| Component `fee_po_ref` | Record the **agency-fee PO reference only**. It neither proves an approved PO/invoice pair nor satisfies a platform media invoice requirement. |
| Applicable card cost's `evidence_refs`, memo/account/commitment links and statement-control ID | Read already retained allowed references via staff-only Hub access. Show each requirement's source/version. Confirmed cash arithmetic is not proof of document authenticity. |
| No existing imported QT, vendor invoice, transfer reference, issuer fee detail, payment status or verification decision | V/T/F and the invoice part of P remain missing/unavailable when no existing qualifying reference exists. Do not add import columns, invent status or ask users to re-key those values here. Existing P2 `document_status=COMPLETE` is not equivalent to P3 VERIFIED. |

An imported reference's status is derived as follows:

| State | Rule and Thai label |
|---|---|
| `MISSING` | Required under the selected profile but no qualifying existing reference: `ยังไม่มีเอกสารอ้างอิง`. Matrix uncertainty remains visible alongside the state. |
| `REFERENCE_RECORDED` | Reference exists with source identity/version: `บันทึกเลขอ้างอิงแล้ว`. This is the maximum automatic V1 state. |
| `VERIFIED` | A separately authorized reviewer attests the **existing** reference against accepted evidence, with actor/time, source version and decision provenance: `ตรวจสอบแล้ว`. No number is re-keyed and no memo/payment is approved. Disabled until Q27 defines authority/evidence. |
| `NOT_REQUIRED` | Accepted matrix rule or authorized exception says not required, with a mandatory reason, rule/version and actor/time where manual: `ไม่ต้องใช้เอกสาร`. Unknown fields never imply this state. |

Verification/waiver workflow records are separate from P2 financial records; a source
reference/version change invalidates the current attestation and preserves history.
Until Q27 is accepted, retain `REFERENCE_RECORDED`/`MISSING` and no manual waiver or
verification action. Reference values are read-only here; corrections use the
existing P2 source workflow, not a parallel edit form. A future P4 confirmation can
provide evidence under the same policy, but is not assumed in V1.

`OVERDUE` is a derived flag, never a fifth stored status: accepted `due_at` exists,
current Bangkok time is later, and the requirement is neither VERIFIED nor
NOT_REQUIRED. A recorded reference may still be overdue for verification if that is
the approved rule. Record `due_rule_version`, anchor and timezone. No accepted rule
means `ยังไม่กำหนดวันครบกำหนด` and `is_overdue=null`, not false or an invented 19th-of-
next-month deadline. The card's payment due date is not automatically a document due
date. The broader C9 calendar stays out of scope.

```text
+-----------------------------------------------------------------------+
| ติดตามเอกสาร      เดือน [พ.ย. 2569] เอเจนซี [ทั้งหมด] ผู้รับผิดชอบ [...] |
| [เฉพาะที่ยังขาด] [เกินกำหนด]   รูปแบบเอกสารรอยืนยันจากฝ่ายการเงิน       |
| รายการ/เฟส | ประเภทต้นทุน/วิธีชำระ | Memo | PO ค่าบริการ | ใบแจ้งหนี้  |
| ...        | ...                  | บันทึกแล้ว | ยังไม่มี | ยังไม่มี  |
| [ดูแหล่งข้อมูล] [คัดลอกข้อความติดตาม] [ประวัติการติดตาม]                |
| วันครบกำหนด: ยังไม่กำหนด       ผู้รับผิดชอบ: ยังไม่ระบุ                  |
+-----------------------------------------------------------------------+
```

Filters: missing, overdue, workflow owner, agency and month. Unknown deadlines are
separately filterable; totals do not report them as on time. A source reference may
be shown as text without automatically fetching its URL or creating a P4 download.

`คัดลอกข้อความติดตาม` previews the exact Thai message, for example:
`ขอติดตามเลขอ้างอิงใบแจ้งหนี้ สำหรับรายการ {scope} เดือน {Thai month/year}
กรุณาส่งข้อมูลให้ผู้รับผิดชอบเพื่อตรวจสอบใน Hub`.
Use only the selected recipient-safe identifiers; omit budget, memo details, private
links and other agencies' rows. The user can copy it; the Hub sends nothing. A
successful clipboard write appends a log with subject keys, template version,
message snapshot, actor, `copied_at timestamptz` and action **COPIED**, never SENT.
If clipboard write fails, offer selectable text and do not falsely log success.
Follow-up ownership/notes/history are marketing-ops data, audited and access-restricted.

## 8. Exceptions queue and workflow

Proposed route `/ads/exceptions`, menu `รายการที่ต้องตรวจสอบ`. It shows **C5 and C6
only**, filtered by month, control, source condition, workflow state, owner and agency.
DW supplies expected/observed values and match provenance. The Hub stores only local
workflow beside the immutable staged finding: `finding_key`, `state` OPEN/
ACKNOWLEDGED/RESOLVED, owner actor/role, note, optimistic version, trusted updated
actor/time and append-only transition history. It does not rewrite DW source facts.

`รับเรื่อง` records acknowledgement and owner. `บันทึกว่าดำเนินการแล้ว` requires a
reason and optionally a link to the P2 assignment/correction action. RESOLVED is an
operator workflow claim, not proof that the source condition cleared. While awaiting
DW confirmation show `ดำเนินการแล้ว รอตรวจผลจากคลังข้อมูล`.

On the next newer complete snapshot, a still-present condition reopens the workflow
with a system history entry; a cleared source condition is displayed as cleared
without deleting the operator history. A condition that clears and later recurs uses
the same stable key and reopens with a new occurrence marker/time. Failed/partial
refreshes never resolve or reopen findings. Preserve both source and workflow state
so acknowledgement cannot hide unregistered spending.

```text
+-----------------------------------------------------------------------+
| รายการที่ต้องตรวจสอบ  [C5/C6] เดือน [...] ผู้รับผิดชอบ [...] สถานะ [...] |
| เรื่อง | เอเจนซี | วิธีเชื่อม | ตรวจพบล่าสุด | สถานะการดำเนินการ        |
| รหัสไม่ตรงกับ ID ที่ผูกไว้ ...             | ยังไม่รับเรื่อง            |
| [เปิดรายละเอียด]                                                   |
| ค่าที่พบ ...    ค่าที่ควรเป็น ...    แหล่งข้อมูล/เวลาข้อมูล ...          |
| [รับเรื่อง] [เชื่อม SN กับรายการงบ] [เสนอรายการแก้ไข]                  |
| หมายเหตุ [...] [บันทึกว่าดำเนินการแล้ว]                              |
| ประวัติ: ใคร / เมื่อไร / ทำอะไร / ผลตรวจครั้งถัดไป                    |
+-----------------------------------------------------------------------+
```

Actions deep-link to existing P2 functions and retain their permissions, explicit
confirmation, optimistic checks and evidence requirements. Online proposes a
correction; admin reviews it under Q5 and application remains separate. An exceptions
button does not auto-approve/apply it, rebind a native ID, rename a campaign or write
to the DW/REM/Sheets. SN assignment remains explicit, one line per SN/month. Findings
caused by an ineligible line require financial review, not bypassing P2 guards.

## 9. Access, API and shared UI rules

`online_staff` and `admin` may read the staff actuals/tracker/queue and maintain local
workflow. The existing admin-only correction review remains. Residential roles,
`service_consumer`, public endpoints and RAG receive none of these records. Memo
approver PII remains marketing-ops-only and is neither needed nor exposed by the DW
read-back. Workflow actor names/notes receive the same restricted treatment.

Agencies retain their current P1 own-name/ID-return access and **no P2 financial
access**. If Q28 later explicitly authorizes a P3 spend projection, it may expose at
most campaigns/lines assigned to the verified agency and its own platform spend and
permitted attribution. It must omit budget, percent-of-budget, memos, fee/card costs,
document references, workflow notes and other-agency counts, filters or totals.
Shared/multi-agency programs cannot expose their aggregate line spend; return only
the provably isolated agency subset or deny the row. Binding an agency claim must
come from trusted identity metadata, never a client filter. This design grants no
new access and does not assume cost records carry sufficient agency provenance.

Proposed staff API prefix `/v1/admin/ads`:

| Endpoint | Contract |
|---|---|
| `GET /actuals`, `GET /actuals/{line_id}` | Snapshot ID, applied filters, nullable metrics/bases, source cutoffs, match details and quality reasons; paginated. |
| `GET /document-tracking` | Reference-derived requirements, uncertainty, owner/due/verification state and safe local source links. |
| `POST /document-tracking/{key}/follow-ups` | Record a successful copy event against expected source/template version; trusted actor/time; no send endpoint. |
| `POST /document-tracking/{key}/review` | Future accepted Q27 verification/waiver workflow only, expected source version and reason/evidence decision; never a reference-number editing endpoint. |
| `GET /findings`, `GET /findings/{key}` | C5/C6 source state plus separate local workflow/history, snapshot and match provenance. |
| `POST /findings/{key}/workflow` | Explicit acknowledge/owner/note/resolve actions with expected workflow version. |

Task 2 implements these reads, follow-up copies and finding workflow for local TEST.
The `/review` verification/waiver endpoint remains future work and is not exposed.
Scope and totals
are authorized server-side before serialization. Denied/missing detail uses
`ไม่พบรายการที่มีสิทธิ์เข้าถึง`. Export-reader membership is not a browser role.

All screens reuse the existing **Emerald & Champagne** semantic tokens, Thai Google
Sans headings and the current dense-table fallback/readability rules in doc 22. No
new palette or raw-color pairs are introduced. Use `registry-motion.tsx` primitives
and **`styles/motion.css` / doc 22 §3 exclusively**: shared row-to-card transition,
static frosted backdrop with opacity transition, standard dropdown pop, existing
tab/disclosure entrance and existing loading/status components. No local durations,
new keyframes, numeric counter animation or ad-hoc chart entrance. Data is immediately
available; animation never delays input or table rendering.

Details deep-link in the current URL and preserve filters on close; Back/Esc closes
and restores focus to the opener, direct links focus the heading. With reduced motion
the existing instant/limited-opacity behavior applies. Keep visible focus, labelled
controls, Thai error summaries, stable live regions and status text beyond color.
Desktop tables use explicit headers and right-aligned money; narrow screens use
labelled cards/disclosures without losing column meaning. No page-wide overflow,
hover-only evidence, sticky control obscuring focus or tiny dense action targets.

UX review used `ui-ux-pro-max`'s data-dense dashboard and keyboard-focus guidance.
Its generic marketing-site pattern and suggested palette/fonts were not adopted;
the existing Hub system owns those decisions. Validate Thai density with real Thai
reviewers before go-live; synthetic screenshot checks do not establish readability.

## 10. Acceptance plan, exclusions and gate

The approved TEST consumer uses the verified contract and adaptations in §13. Use
synthetic fixtures only for this build and its tests; keep P1/P2 checks intact.

- Contract/staging tests: all four relation counts/checksums, exact schemas, text IDs,
  decimal precision, environment separation, foreign keys, complete snapshots,
  source watermarks, replay no-op, conflicting replay quarantine, rollback and
  last-good pointer during concurrent or failed refreshes.
- Reconciliation tests: applicable revision/component counted once; variants and
  native bindings do not multiply budgets; period budget not repeated monthly;
  suspended/archived distinction; typed split incompleteness; cash versus monthly
  recognition, credit signs and annual 1,199.99 conservation; no platform-plus-card
  MEDIA total; unassigned totals retained without guessed attribution.
- Matching fixtures agreed with DW: leading-zero native IDs, conflicting CODE versus
  binding, unbound names/variants absent from the frozen registry, unusable
  authoritative links, C member completeness, D/E pools, explicit
  CORP/BU program mapping, ambiguous fallback, approval without correction application,
  blocked Bangpu conflict and pre/post-cutover legacy handling.
- SQL/RLS/API: forced RLS and role denial; workflow trusted actors/audit/no DELETE;
  stale optimistic versions; stable finding key and recurrence; reference change
  invalidates verification; absent authority/matrix/due rule never becomes verified,
  waived or on time; no memo/budget/PII leakage. Agencies remain denied unless a
  separately approved isolated projection is explicitly tested.
- Playwright on Edge: Thai filters, null/freshness/error states, match explanations,
  existing P2 action deep links, read-only source references, copy success/failure and
  COPIED log, keyboard/focus/Back/Esc, mobile cards and reduced motion.
- Run and report real admin typecheck/build, API pytest, `npm run test:db` and
  `npm run test:ui` after implementation. Reserve the next global migration counter
  at implementation time; this design creates no migration or runtime artifact.

Out of scope: C2 fee arithmetic, C3 bill reconciliation alerts, C4 pacing alerts,
C9 payment-package enforcement, BF-1 targets, procurement/QT/PO/bill/payment workflows,
new budget allocation rules, P4 upload/OCR/R2/search and the P5 assistant. Showing a
PO reference or a percent-used metric does not implement these controls. C7 attribution
quality may inform a metric's coverage note, but is not an additional exception
engine in this slice.

**Open questions:** Q25 contract/cadence/cutover; Q26 matching/lead/budget comparability;
Q27 document authority/due/owner policy together with Q24's matrix; Q28 agency access.
Existing Q2, Q3, Q4, Q5, Q12, Q15–Q17 and Q18–Q24 retain their production gates where
relevant. A P3 engineering approval would not resolve any business or hosting decision.

## 11. DW questions (faaa297/44f04b3)

This is the Hub's **design response** to the DW handoff identified by those commits.
It is not an assertion that a live DW run, official fixture acceptance or P3 deployment
has completed. The existing fifteen-view intake remains frozen; none of these answers
changes migrations 0014/0015, P1/P2 behavior or current data. The DW's proposed
stable-line dimension and line/month/platform/currency fact differ from §3's proposed
read-back shapes. Q25 must accept one versioned projection or an explicit DW adapter;
neither side should silently assume the other has already changed its grain.

### 11.1 Componentless draft lines

**Decision: deliberately exclude componentless drafts from the existing
`ads_export.media_line` view.** Its contracted grain is a revision financial component,
and a header without a component has no row at that grain. Do not insert a dummy
component, zero budget or synthetic approved revision, change the join to manufacture
a row, or add a sixteenth export view in this slice.

The consumer must distinguish `LINE_DETAIL_UNAVAILABLE` from "the Hub line does not
exist". An absent exported line cannot prove the latter. Keep any safely observed
identity/spend in the unresolved bridge and completeness diagnostics. A complete
snapshot with a known ineligible line can support C5; missing P2 context cannot be
presented as proof of a budget-approval breach. Staff can inspect permitted current
Hub context separately, with its own snapshot time. If P3 later genuinely needs a
line-header export, request a versioned contract change and approval; it is not
required to repair the current component-grain contract.

### 11.2 Effective time, recorded time and historical limits

Current exports cannot reconstruct full approval, assignment or retirement history.
In particular, assignment `ended_at` supplies no start time, correction `applied_at`
is not its review-decision or retirement time, and an observed scope reference does
not establish historical membership validity. Preserve these absences.

Proposed P3 read-back temporal fields are:

| Field | Contract |
|---|---|
| `effective_at timestamptz|null` | When an authoritative, evidenced event became effective. Null if that time is not exported/known. Never substitute first observation, receipt, snapshot time or month start. |
| `recorded_at timestamptz` | When the DW durably recorded this interpretation/version, with source lineage. A late correction can be recorded after its evidenced effective time. It is not a replacement for that effective time. |
| `temporal_basis text` | `EVIDENCED_EFFECTIVE_TIME` or `SNAPSHOT_ONLY`; a snapshot-only result makes no true historical as-of claim. |
| `temporal_provenance jsonb` | `{source_kind, source_record_refs, source_field, source_snapshot_at, effective_time_evidence_ref}`; refs are safe opaque identifiers, the evidence ref may be null, and no private memo/audit text is exposed. |

A row assembled from several events uses the temporal envelope for the selected
interpretation and retains event-specific times in its provenance; one field cannot
prove all lifecycle transitions. Do not relabel `bound_at`, account validity dates
or row `updated_at` as line-approval history. Snapshot-only versions may show "best
known at snapshot X", with revision IDs retained; they cannot answer "what was
approved at the historical instant" without the missing evidence. Historical legacy
matching remains explicit about this limitation under Q26.

The service month remains a first-day **date**, not a timestamp fabricated as an
approval event. If a month boundary must be represented as an instant for period
filtering, `2026-10-01T00:00:00+07:00` is `2026-09-30T17:00:00Z`.
That conversion does not establish `effective_at`. A platform date-only fact needs
its declared reporting timezone/basis; do not shift it as if it contained an event
timestamp. All source timestamps must retain explicit offsets.

### 11.3 Literal observed-code evidence comes from DW read-back

**Observed platform/ledger evidence belongs in the DW read-back, not a new Hub
export field populated from resolved assignments.** `formatted_mapping` is the
ledger's group context. An applied correction's `observed_code` is that reviewed
crosswalk subject. Neither proves that every source ledger row carried an observed
SN or campaign name. Do not reconstruct such literals from registry CODE, scope,
the target line or the correction result.

The proposed comparison envelope, embedded in finding `observed` and carried by
bridge evidence, is:

| Field | Meaning |
|---|---|
| `observed_code text|null` | Exact source code where present; if parsed from a literal observed name, retain parser version and source field. It is not the selected registration CODE. |
| `observed_name text|null` | Exact observed platform campaign name if the source actually supplies it; never a newly generated or normalized replacement. |
| `observed_at timestamptz|null` | Source observation/event time when provided with verified semantics. Null when unavailable; do not infer it from ingestion time. |
| `source_snapshot_at timestamptz` | Watermark of the source snapshot that supplies this evidence, distinct from export/Hub receipt time. |
| `source_kind text` | `PLATFORM_CAMPAIGN`, `LEDGER_ROW` or `MASTER_REFERENCE`; value states what was actually observed. A master reference cannot stand in for raw ledger evidence. |
| `source_record_refs jsonb` | Array of safe `{source_key, relation, record_key, source_batch_id, source_field}` references; text IDs retain leading zeros. No credentials, personal fields, private filenames or signed links. |
| `evidence_status text` | `AVAILABLE`, `MISSING` or `STALE`, with a machine-readable reason and parser/rule version where applicable. Missing comparison evidence is not a successful equality test. |

Propose the same exact envelope shape wherever it appears rather than unrelated
free-form finding JSON. Only the field relevant to the actual source is populated;
unavailable raw ledger CODE remains null even when platform CODE is known. Keep
expected registry values in `expected`, with independent Hub snapshot references.
The Hub displays observed/expected/match method together under staff authorization.
No statement descriptor or financial free text is added to identity evidence or RAG.

### 11.4 Refresh, retention and stale evidence

Retain §3.5's proposal: one coherent daily delivery by 07:00 Asia/Bangkok, all four
mart counts/checksums and individual source watermarks, and a **36-hour** stale
threshold pending Q25. The threshold applies to the relevant source watermark,
not just the newly generated file timestamp. Missing timestamps or failed upstream
coverage are unknown/unavailable, never fresh by assumption.

Keep each accepted generation immutable with its manifest and the source evidence
needed to explain its findings. Preserve the last good generation and its original
watermarks after partial/failed refreshes; never replace failure with empty relations.
Findings already acknowledged/resolved must retain references to their evaluated
generation and evidence. Late/revised source data creates a new interpretation, not
an in-place rewrite of the old receipt or workflow history.

Retention length and controlled disposal require DW/Hub data-owner acceptance under
Q25 and the applicable organizational policy. Until that is decided, this design
authorizes **no scheduled deletion** of accepted read-back evidence or workflow
history. It does not promise indefinite production retention either. Confirm the
bounded retention/archival policy before production, and retain generations needed
for open disputes or applicable legal holds. P3 data is restricted operational data,
not a public or RAG dataset.

### 11.5 C5/C6 ownership, lifecycle and historical cutover

The DW computes source conditions and their stable keys. The Hub owns assignment
of a reviewer, acknowledgement, notes, declared resolution and transition history.
A Hub `RESOLVED` action never clears a DW condition. A still-failing complete next
generation or a later recurrence reopens the workflow; missing/partial/stale evidence
cannot establish clearance. Source clearance and local workflow state remain separate.
The integration contact is the **DW maintainer role**; no named approver is invented.

For this initial slice, propose the DW's narrow C5 financial test (spend without an
eligible current approved line) and C6 identity/scope consistency test. Malformed-name
diagnostics stay visible but do not alone prove unapproved spend. Route missing
identity/context to Online/data operations, identity/master conflicts to the registry
steward, and financial evidence to marketing finance operations; named owners and
authority still require approval. Q5 controls correction review, Q26 controls final
rule codes and lead/temporal semantics. The stable-key encoding proposed in §3.4 must
be agreed with the DW: do not rotate keys merely because transport/schema version
changes, amount changes or display text changes.

The **2026-10-01** operating boundary remains a proposal for accepted Hub financial
ownership, not a live switch or retroactive SENA-H enforcement date. Earlier months
explicitly imported into the Hub stay Hub-owned. Pre-Hub spend with no accepted
financial line is labelled historical/unassigned; no fictitious `adinv` budget union
is created. Set a separate, explicit naming-enforcement policy/date under Q26 before
calling historical SENA-7/V1 spend noncompliant with a newer grammar. Program periods
and historical as-of limitations follow §§2.1 and 11.2.

## 12. Master-data handoff and account evidence

Read-only source: the DW's `docs/HUB_MASTER_DATA_EXPORT.md`, reviewed 1 October.
This defines **DW masters → Hub scope staging**, distinct from the fifteen financial
and registry views flowing **Hub → DW**. No master export, synchronization job,
real-data import or account activation is implemented by this design response.

### 12.1 Accept the JSON array contract, with DW-side conversion

Accept the proposed UTF-8 `project_groups.json` and `project_members.json` arrays
plus one manifest/exception report. Group rows contain exact `project_group_id`,
`project_name_th`, `project_name_en`, `project_id_set` and `source_snapshot_at`.
**`project_id_set` must be a JSON array of distinct text IDs.** The DW converts its
comma-separated membership text before export, trimming separator whitespace only;
it preserves case and leading zeros and rejects duplicates/unknown or empty members.
The Hub does not accept a comma-separated scalar or cast an ID such as `00401` to a
number. Optional DW `member_count` is checked against the parsed set, never used to
manufacture missing members.

Member rows retain `project_group_id`, `project_id`, `project_name`,
`project_name_eng`, `membership_status='CURRENT_REFERENCE'` and
`reference_observed_at`. Missing historical `valid_from/to` stays null/absent;
observation time is not membership validity. Require exact equality between each
group's declared set and its bridge set, unique current ownership, valid labels,
row-level timezone-qualified source times and the manifest's complete counts/hashes.
Capture time and maximum row time cannot establish freshness of every master row.

Deletion/status/conflict evidence is retained in the review package rather than
silently expanding or bypassing the existing importer. Deleted members are not
activation-ready; Closed/Land status needs an explicit eligibility decision. The
current payload does not make the Hub validate every extra master-control flag, so
the DW export-readiness review must gate the package before an authorized apply.
Do not drop inconvenient members to make the sets agree.

### 12.2 Recurring packages are review proposals, not automatic synchronization

The current `scripts/stage-ads-scopes.py` supports dry-run validation and explicit
local apply of a complete approved batch. It can create new GROUP/PHASE scopes as
ACTIVE and quarantines incompatible existing identity/label/status data. It does
**not** implement recurring update, retirement or approved reconciliation of changed
masters. Source omission is not a retirement instruction.

Propose a later reviewed diff of old versus new IDs, memberships, labels and
eligibility, followed by explicit scope-steward acceptance and a versioned change
decision. A membership or label change must not reinterpret existing issued names,
frozen C/D member sets or historical assignments. Implement that workflow only after
its separate design/approval; this addendum neither changes the importer nor invokes
`--apply`. A smaller closed subset needs a recorded scope decision and an exception
report that still identifies omitted groups.

Q31 records the retained Bangpu membership conflict; Q32 records the five invalid
English labels. They require current source/steward evidence, not automatic normalization,
translation, punctuation removal, truncation or choosing one source as the winner.
An approved phase-token alias does not repair an invalid English display label.

### 12.3 Requested account coverage and shared-brand identity

Q33 records that Google account **`1789352841` was not observed in the retained
September 30 seed**. This is not proof that it does not exist. It must not be replaced
by observed Solar account **`1795870642`** or Corporate account `8280697886`. Q34 keeps
Solar in the requested account-review scope, subject to its explicit verified BU/BUD/agency
mapping; an account label does not grant budget authority or create a `BU-SOLAR`
mapping automatically. Use advertiser account ID, not the excluded MCC manager ID.

Q35 covers shared Google account **`4311741342` / SENA VIVA / VELA**, which cannot choose the advertised
brand, project or line. **Require campaign CODE to distinguish VIVA from VELA**;
never infer it from that shared account, majority activity or a guessed account-wide
split. An existing confirmed native binding still wins conflicting observed CODE
and raises C6; a missing/unusable current SN-month assignment remains unresolved.
Account-only identity is not a fallback around these rules. Approved funding BUD
splits remain separate from campaign identity and project attribution.

Boundary platform translation remains exact: DW `META_ADS`/`GOOGLE_ADS` maps to Hub
`META`/`GOOGLE`, with account IDs kept as text. An identity seed and source label are
evidence for review, not a confirmed P2 account-mapping version. Q31–Q35 go-live
questions supplement Q25/Q26; none authorizes loading real evidence, changing scopes
or connecting to an external system in this docs-only update.

The original design-only stop was satisfied by the owner's 1 October approval.
Proceed under the demo-first order; real-data and production decisions remain open.

## 13. Approved demo implementation defaults — 1 October 2026

This note precedes Task 2 code. The owner approved P3.0 and DEMO-FIRST; no new
engineering gate is pending. Q24–Q28 remain visible production decisions.

Read-only verification found a complete DW package at
`data/hub-registry/p3-readback/4e7f2eaf-8807-4f39-9aa0-b4750d37211f/` in the DW repo.
Its manifest SHA-256 is
`a72f9aaa407128780a71b93bd7b0f50ed60a05dac7ba6af7a95a5f68dc6197ae`, snapshot
`2026-10-01T04:05:27.770130+00:00`, contract `hub-p3-test-v1`, environment `test`,
`synthetic_only=true`. The four arrays contain respectively 13 dimension, 17 bridge,
8 monthly and 73 finding rows (38/38/35/36 columns). Preserve the original package
as a frozen Hub fixture with checksums verified before copying/using it.

The owner identified DW producer commit
`ec2a182c436783adb0a641479357b792ab97523f`; its
`docs/MARKETING_OPS_INTEGRATION.md` §5 confirms the four grains and TEST adaptations
below. Read this as package/contract provenance, not as a claim that generated
package bytes are committed in DW. The original manifest and arrays remain unchanged.
The far-future months are coverage fixtures only. Task 6 must seed coherent
presentation months and make those the demo's selected months; do not move original
DW observations to different dates or present its future coverage as a live period.

Accept this closed TEST-v1 transport: UUIDs remain lossless strings; JSON arrays stay
arrays; catalog nullability is descriptive, while business keys are independently
required. The finding extension `evaluation_status` is explicit: 11 conditions are
present, 44 false and 18 UNAVAILABLE/null. Missing first/last observation times stay
null. These differences refine the TEST adapter without activating production rules.
Synthetic periods and watermarks through 2356 are retained with a demo label and
cannot support a real freshness claim. Show original source watermarks separately
from snapshot/receipt time.

Use migration `202610010016_ads_actuals.sql`. The CLI validates, then applies only to
`127.0.0.1:55432/sena_hub_local`, with one transaction and a guarded generation
pointer. Preserve immutable source rows, exact replay, quarantine receipts, optimistic
workflow versions, fixed-search-path guarded functions, forced RLS and audit. The
Hub consumes DW matches and C5/C6 facts; it does not rebuild them or update DW.

Q25 defaults: inactive proposed October cutover, manual TEST imports, proposed daily
07:00 Bangkok/36-hour stale threshold only, no scheduler or deletion. Q26 defaults:
confirmed binding precedence and nullable evidence/metrics, as computed by DW. Q24/Q27
defaults: proposed pair matrix, reference presence only, no due rule means unknown,
no manual verification/waiver before authority is accepted. Q28 defaults: no agency
financial projection. These defaults are useful demo behavior, not go-live claims.

The owner has deferred Q18/Q20. LINE OA costs remain CHANNEL records in one
unattributed bucket; statement controls include them. Do not allocate accounts or
build an OA matching-review screen. No statements or ads data enter public/RAG APIs.

Local operator commands (the first is a dry run; neither connects to DW):

```powershell
uv run --project apps/api python scripts/stage-ads-actuals.py --package supabase/tests/fixtures/ads_actuals
uv run --project apps/api python scripts/stage-ads-actuals.py --package supabase/tests/fixtures/ads_actuals --apply
```

The second command loads the existing ignored local administrator configuration,
verifies the fixed local target, then uses the guarded apply function as `admin`.
`--expected-current <snapshot UUID>` can pin the reviewed generation (`none` requires
an empty pointer). Without it, the script observes the pointer immediately before
applying; the SQL function still rejects concurrent replacement. Credentials and
source row contents are not printed. A validation error or quarantined package is
not a successful publication. Running an exact accepted package again is a no-op.

Workflow owner selection defaults to the caller or unassigned until a trusted staff
directory is available; it does not turn a typed UUID into verified staff membership.
The document screen shows imported references and successful copy history, with no
manual verification or waiver control. Its unset deadline and owner remain explicit
unknowns under Q27; unknown deadlines are never counted as on time.

Task 2 retains applied migration history through `202610010020`. The forward fixes
preserve the existing admin ban on `staging` namespace access: operator intake RPCs
are `ads.apply_ads_actuals` and `ads.actuals_current_snapshot`, while the underlying
generation tables remain private in `staging`. No staff member gains base-table
writes or audit-row access. Duplicate component budget items with the same cost and
payment pair produce one document requirement whose version includes every item.

A recurrence check uses the last explicit evaluated DW condition, skipping an
intervening UNAVAILABLE snapshot. Unknown evidence neither clears a condition nor
erases a previously observed clearance. Local workflow resolution still cannot
override source findings. `context_changed` is deliberately conservative: an
allowlisted P1/P2 source write after the Hub source watermark, or changed applicable
revision/state, asks staff to refresh the read-back. The private helper reads only
audit table identity/write time and exposes one boolean; it does not calculate a
new match or expose audit actors, rows or evidence. An unrelated source change can
therefore show the same refresh notice. Q25 retains this demo default.

### Task 6 presentation dataset

The coherent demo command described in [the implementation report](ads/DEMO_IMPLEMENTATION_20261001.md#task-6--coherent-demo-pack-design-before-code)
adds explicitly synthetic October 2026 scenarios for HYABC/FLEXI. Its package is
authored locally for presentation, not delivered by the DW. It uses the existing
closed TEST validator and atomic generation publication; it does not implement
runtime matching or calculate new operational DW findings. All original frozen
bytes, business months, source observation dates and finding identities remain
available as evidence. Retained findings not evaluated by the demo are UNAVAILABLE,
not silently cleared. Q45 records presentation ownership and the replay/conflict
default. Generation receipt time is never a claim of fresh platform/REM data.

The actuals screen initially selects the current Asia/Bangkok month when the URL
has no month choice. An explicit month or all-month choice remains authoritative.
The Thai walkthrough pins October 2026 links so the far-future contract coverage
does not become the presentation's default month. No cutover, cadence, retention
or production integration decision is activated by this local dataset.
