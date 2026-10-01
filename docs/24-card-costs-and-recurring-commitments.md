# 24 — Card-paid costs and recurring commitments (expanded P2)

Date: **30 September 2026 (Asia/Bangkok)**. Status: **expanded P2 implemented and
verified locally**, authorized by `P2.0 approved — implement expanded P2`. This records the owner's replacement
card-paid addendum: the P2 items below are implemented locally; the
statement PDF/OCR and LINE OA count-matching pipeline is **P4 design only now**.
Actual synthetic verification and remaining deployment gates are recorded in the
[P2 implementation report](ads/P2_IMPLEMENTATION_20260930.md). No real financial
source or document has been processed.

Read with [doc 23](23-media-lines-and-memo-register.md),
[doc 20](20-marketing-operations-flows.md), [UI contract](22-hub-assistant-and-ui.md),
[priorities](ads/PHASE1_PRIORITIES.md) and [open questions](ads/OPEN_QUESTIONS.md).
This addendum supersedes the earlier blanket exclusion of card-cost records from
P2. It does not authorize QT/PO issuance, bill approval, bank payment execution,
P3 actuals ingestion, P4 construction, P1 naming changes, a commit or a push.

## 1. Owner-reported evidence and its limits

The owner supplied these facts; the PDF and classified workbook were **not supplied
or independently inspected in this design task**:

| Evidence | Reported fact |
|---|---|
| Statement | Krungsri corporate card, five-page image-only PDF; cycle **2026-08-26 through 2026-09-25**, due **2026-10-15**, total **THB 373,108.98**. |
| Media classification | The existing monthly sheet with Category/BUD/Detail sums exactly to the statement total. Preserve this process and import a read-only export. |
| Google descriptor | Contains the Google Ads sub-account ID: `8130112100` = SENA PREMIUM; `4049804056` = SENA NICHE MONO. These examples are evidence, not automatically approved account mappings or test fixtures. |
| LINE OA | All **111** rows have descriptor `LINEPAY*LP_LINEOFFICIA BANGKOK THA`. The descriptor cannot identify the individual OA. Identical descriptions are not duplicate-payment evidence. |

Do not reproduce cardholder name, company address or partial card number in this
document, P2 fixtures or import metadata. P2 tests remain wholly synthetic. Arithmetic
agreement of a sheet and statement establishes a control total, not verified scope,
BUD, memo authority or account identity. Actual source-profile acceptance is Q22.

## 2. Separate budget, cash charge and monthly cost

| Measure | Source/grain | Counting rule |
|---|---|---|
| Approved budget / memo cap | Doc 23 memo and applicable line budget; approved commitment cover | Authorization ceiling, not an incurred cost. Do not add commitments to a media-line envelope that already includes them. |
| Expected recurring charge | One commitment cycle | Forecast/schedule only; does not create an actual charge or SN. |
| Statement charge | One retained source occurrence with one applicable interpretation of one or more typed `ads.cost_record` leaves | Sum source occurrences once for statement reconciliation; cost exports sum their typed leaves instead. Never add a parent full charge to its child costs. Identical occurrences remain separate. |
| Monthly allocated cost | `ads.cost_allocation`, one charge × covered month × BUD/scope | Split a charge across coverage months/BUDs; the complete allocation must sum exactly to the original signed charge. Do not add it to the cash amount again. |

Every **typed cost record and allocation** has a non-null cost type and payment
method. Valid types are `MEDIA`, `AGENCY_FEE`, `CHANNEL` (including LINE OA), `TOOL`
and `BANK_FEE`. Methods are `CORPORATE_CARD`, `AGENCY_PO_INVOICE`, `PLATFORM_INVOICE`
(for example Meta FB-INV) and `BANK_TRANSFER`. Recurring commitment forecasts and
typed budget items carry the same two dimensions. Neither dimension implies the
other: a media purchase can be paid by card or invoice; a card can pay a tool.

Doc 23's gross phase/program envelope may contain both media and agency fee. It is
a **budget total**, not one homogeneous cost. Keep its source gross intact. Proposed
`ads.line_budget_item` holds typed items under a revision component: ID, component
ID, cost type, payment method and amount. If the export supplies only combined gross,
the split/method remain unresolved at envelope level; do not create an untyped cost
row, label all of it MEDIA, or infer the media payment method from the fee-PO number.
When fully itemized, item amounts must equal the component gross; otherwise display
`ยังแยกประเภทค่าใช้จ่ายไม่ครบ`. An externally approved budget envelope can still be
recorded while its itemization is incomplete. That is not a classified cost or a
document-complete payment record.

Money follows doc 23: `numeric(14,2)` THB, decimal strings, no floats. Credits/refunds
use a nonnegative magnitude and explicit `direction` DEBIT/CREDIT; signed totals
subtract credits. Repayment of a card balance is settlement, not another expense.
Do not manufacture BANK_FEE rows to balance a statement. Foreign-currency evidence
without an explicit posted THB amount/rate provenance stays unresolved under Q22.

## 3. Document requirements by both dimensions

Propose `ads.document_requirement` keyed by **(cost_type, payment_method)** with
version, effective dates, requirement codes, review status and actor/time audit.
No fallback lookup by cost type alone. The complete 5 × 4 matrix below is a proposed
business profile for Finance/Marketing acceptance (Q24), not a claim about statutory
tax requirements or an already approved company policy.

References: **M** = confirmed external memo/commitment cover; **S** = reconciled
statement/control and source occurrence; **V** = vendor/platform invoice or receipt;
**P** = approved PO plus related invoice reference; **T** = transfer evidence;
**A** = reviewed account/scope/BUD mapping; **C** = commitment/plan/coverage reference;
**F** = issuer fee detail. These are text references in P2, never file uploads.

| Cost type | CORPORATE_CARD | AGENCY_PO_INVOICE | PLATFORM_INVOICE | BANK_TRANSFER |
|---|---|---|---|---|
| MEDIA | M + S + V + A | M + P + A | M + V + A | M + V + T + A |
| AGENCY_FEE | M + S + V | M + P | M + V | M + V + T |
| CHANNEL | M + S + V + A + C | M + P + A + C | M + V + A + C | M + V + T + A + C |
| TOOL | M + S + V + C | M + P + C | M + V + C | M + V + T + C |
| BANK_FEE | S + F; budget authority to confirm | REVIEW_REQUIRED | REVIEW_REQUIRED | T + F; budget authority to confirm |

The conditional C requirement applies when a charge is recurring; one-off CHANNEL
or TOOL costs need explicit coverage/purpose evidence instead. Finance must confirm
exceptions, including bank-fee authority. `REVIEW_REQUIRED` combinations cannot be
silently marked complete. Missing references are an explicit document-completeness
finding; they do not erase a real charge or prevent reconciling truthful statement
amounts. Completeness is not payment authorization. No P2 button pays, approves a
bill, creates a PO or infers that an agency-fee PO covers platform media.

## 4. Effective-dated account registries

Use the existing guarded-function, audit and forced-RLS pattern. Accounts are not
campaign registrations; no SN/name is generated. Source account IDs are text.

### 4.1 `ads.ad_account` and mapping versions

Stable identity: UUID, `platform`, `account_id text`, optional display label; unique
`(platform, account_id)`. A reviewed mapping version records `scope_id`, `agency`,
`valid_from date`, exclusive `valid_to date` (nullable), status, evidence reference,
actor/time/version. Scope membership comes from the unchanged P1 registry. Reject
overlapping confirmed intervals for one account. Resolve against charge date, not
today's mapping; store the exact mapping version used on derived costs.

Each mapping has either one BUD or an explicit **brand-account BUD split rule**:
ordered BUD rows with integer basis-point weights totalling 10,000, review evidence
and approver/time. Unknown/overlapping/missing mappings remain unresolved. Apply
weights to integer satang with a deterministic remainder rule (largest fractional
remainder, then BUD code as tie-break); allocated amounts must sum to the source
charge. Do not guess equal shares. This split attributes funding to BUDs; it does
not distribute D/E campaign performance to projects or implement the deferred
inter-line `funding_contribution` workflow.

Google descriptor parsing may extract an ID through a reviewed anchored rule and
suggest the effective account mapping. Keep descriptor provenance; an unknown ID
or conflicting Media-sheet BUD is a review item. Account matching never infers an
SN, changes a native campaign binding or makes a group-name fuzzy match.

### 4.2 `ads.channel_account`

Stable identity: UUID, channel `LINE_OA`, actual `account_id text` when verified,
display label and optional steward reference. An unresolved steward reference is
labelled unverified and is not a fabricated platform ID. Mapping versions contain
project/`scope_id`, BUD, plan reference/name, expected amount per charge, currency,
validity dates and review evidence/actor/time. No overlapping confirmed intervals
for the same channel account. A plan's expected amount is a default copied into a
reviewed commitment version, not a second financial obligation.

One shared statement descriptor is not an OA identifier. P2 supports explicit
reviewed links from the Media sheet or operator evidence; it does not build the P4
count matcher. Without sufficient evidence, cost rows can reconcile financially
while their channel-account attribution remains `รอตรวจสอบบัญชี`.

## 5. Recurring commitments and memo coverage

### 5.1 `ads.recurring_commitment`

Store UUID, vendor text, account reference (ad/channel or verified vendor account
text for a tool), scope ID, BUD or reviewed account split reference, plan, cost type,
amount per cycle, frequency MONTHLY/ANNUAL, inclusive start/end dates, currency,
payment method and memo cover references. Store explicit expected charge dates or
a reviewed billing-day rule with exceptions; frequency/start date alone does not
prove the charge date. End-of-month and leap-day handling must be shown in a preview
and confirmed. A proposed `ads.commitment_occurrence` records the expected cycle,
charge date, covered first-day months and expected amount; it is a forecast.

Statuses DRAFT/ACTIVE/SUSPENDED/CLOSED and immutable confirmed versions follow doc
23's audit/version rules. Plan, price, BUD or coverage changes create a new effective
version without rewriting old charges or allocations. Require evidence and a
confirmed memo cover before activation; the Hub records an external decision.
No SENA-H name, CODE or native-campaign row is required or created. A tool subscription
or OA plan is not forced into an SN just to connect its budget.

### 5.2 `ads.commitment_memo_cover`

Link a commitment version and BUD to canonical memo UUID, coverage start/end, cap amount,
memo material version and evidence/actor/time. One memo may cover several cycles
or commitments during its period; do not require a new memo every month. Q19 decides
the actual business cadence. Covers must match the memo's requesting BUD. An approved
multi-BUD account split requires an explicit cover for each BUD share; multiple
covers cannot ambiguously fund the same cycle/BUD share. A share without one
applicable confirmed cover remains unresolved.

The memo gross remains its overall ceiling; each cover cap is its assigned portion.
If a line envelope already reserves this commitment's cap, record the corresponding
component/budget-item reference and count that reservation once. Validate identical
memo/BUD, covered period and an applicable referenced revision; cumulative linked
cover caps cannot exceed that component/item reservation. Superseding or suspending
the line requires revalidating/relinking its covers to the replacement or suspending
them in the same transaction. Historical cover references are never silently reused.
Otherwise treat the cover as a separate memo reservation. Show the reconciliation as line envelopes
plus standalone commitment reservations, not envelopes plus all commitments plus
charges. Concurrent cover changes take doc 23's shared financial-write lock. Expected
cycles exceeding their own cover cap cannot become ACTIVE without corrected external
cover. Overall memo reservation differences remain doc 23's recorded finding and
acknowledgement across line and commitment writes; this is not a new global hard cap
that a later line revision could bypass. Acknowledgement never authorizes extra spend.

Actual charges exceeding a cap are still recorded and reconciled, with an over-cap
finding; never reduce a real charge to fit approval. Cap consumption counts linked
net cash charges linked to covered occurrences once, regardless of cash date: an
annual prepayment before coverage starts and a linked refund after coverage ends
still affect that cover. Never count both charges and monthly allocations. Show
committed forecast, actual consumption and remaining cap
separately. A changed/cancelled memo suspends linked commitments as well as lines;
new confirmation revalidates the cover and preserves historical snapshots.
For BUD-specific covers, forecast and consumption use only that cover's approved BUD
share of each occurrence/charge, never the full charge repeated per BUD. Shares must
conserve the original amount; monthly recognition does not consume the cap again.

### 5.3 Annual prepayment and monthly allocation

Proposed `ads.cost_allocation` stores cost ID, coverage month, scope, BUD, amount,
direction, cost type/payment method, commitment occurrence/mapping version, method,
review status and actor/time. The two dimensions must match the parent cost. Cost
and allocation versions are immutable after confirmation; replacements supersede,
never add to, earlier applicable sets.

For an annual prepayment covering 12 complete months, keep **one cash charge** and
spread its amount equally in integer satang over those months. Allocate any residual
satang to the earliest covered months, one each. Synthetic example: THB **1,199.99**
becomes eleven months of **100.00** and one of **99.99**, exactly **1,199.99** in total.
Then apply any approved BUD split within each month's amount; both month and total
invariants must hold. Never spread the commitment forecast again as actual cost.

Coverage is explicit, independent of card cycle/due date. Missing coverage or
mid-month/prorated cases require a reviewed schedule under Q24; do not infer daily
accounting treatment. Preserve the charge with incomplete allocation visible.
Refunds/reversals require explicit reviewed links and coverage adjustments; never
subtract a card repayment as if it were a cost refund. These are Hub management
allocations, not an asserted general-ledger accounting policy.

## 6. Canonical memo numbers and aliases

Keep `ads.memo.memo_no` as the canonical number and introduce `ads.memo_identifier`
for a single unique lookup namespace: exact identifier text, memo UUID,
CANONICAL/ALIAS kind, status PROPOSED/CONFIRMED/RETIRED, reason/evidence and trusted
review actor/time. Exactly one canonical identifier per memo must match `memo_no`.
The same string can never resolve to two memos, including canonical-versus-alias
collisions. Aliases point directly to a memo UUID; no chains or recycled identifiers.
All lookup and confirmation paths use that namespace under the financial lock.

Canonical validation remains doc 23's candidate regex/Q14. Preserve observed input
on every imported cost/line row. A reviewed alias can resolve a noncanonical
separator format without modifying source text. Online proposes, admin confirms
with evidence; alias confirmation is not approval of the underlying memo.

**Owner clarification, 1 October 2026:** `M.COM037/69` and `M.COM033_69` are
different memo numbers from an illustrative example. Q23 asks whether
`M.COM037/69` and `M.COM037_69` are the same identifier under the authoritative
slash/underscore notation rule. The serial stays **037** in that question.
Do not merge them, replace digits, strip separators indiscriminately or auto-confirm
a suggested alias. Unknown/unconfirmed aliases remain unresolved; real source facts
and previously linked canonical IDs remain unchanged. Retiring an alias blocks new
resolution but does not erase historical uses.

## 7. P2 card-sheet importer and cost records

### 7.1 Statement control without document storage

`ads.card_statement_control` stores an opaque Hub UUID/operator reference, issuer,
cycle start/end dates, due date, currency THB, declared statement total and its
meaning, external evidence reference text, review status and audit fields. It holds
no PDF, cardholder/address fields or full/partial card number. The opaque reference
distinguishes statements without exposing a card identifier.

P2 takes the total from an operator-confirmed reference; it does not OCR or verify
the PDF. Q22 must establish whether the quoted figure is new charges or a closing
balance including opening balance, repayments, credits and adjustments. Initially
support only an explicitly confirmed comparable net-charge total. Other statement
equations remain REVIEW_REQUIRED; never compare unlike amounts or invent a fee.

Cycle dates, charge date, posting date (if supplied), due date and allocation month
are separate. The 26 August–25 September cycle is not simply September expense.

### 7.2 Export/profile and privacy

Proposed CLI `scripts/stage-ads-card-costs.py --manifest <path>` reads an
operator-exported copy of the **existing Media monthly card sheet**, validates and
reports; `--apply` stages it atomically. Use stdlib CSV/Decimal/hash helpers and the
existing validate/apply pattern. No Sheet editing, credentials, replacement form,
new required source columns or Media-process change. The Hub integration operator
maintains the export profile/manifest and safe local projection.

Category/BUD/Detail are owner-reported column meanings; exact headers, date/amount
columns and classifications must be verified under Q22. Bind by exact headers,
never by position or near-match. Reject missing/duplicate required bindings and
unapproved profiles. The approved profile allowlists retained cells; unrelated
columns are discarded before staging, hashing, logging or archival. No whole-workbook
copy is archived. Unknown structural columns require profile review, not automatic
inclusion. Do not read formula/macro content as executable instructions.

The manifest identifies logical source, original file label/tab, source coordinates,
profile/version, statement-control UUID, export timestamp and explicit sheet-to-cycle
scope. Dates/amounts/IDs use defined formats with text IDs preserved. If an export
combines several statements, the operator supplies an explicit partition manifest;
the importer neither guesses a card from last-4 nor mixes cycle totals.

Retain Category/BUD/Detail and raw safe cell text under staff access, plus source row
number and SHA-256 **raw-row hash** of that allowed projection. A free-text Detail
cell can itself contain personal/card information: unsafe cells require operator
sanitization of the read-only export before retention, with a redaction marker and
review receipt. Keep no original sensitive value in errors/audit/hash input. This
changes the Hub copy only, not Media's source. Do not request or infer partial card
numbers for matching.

### 7.3 Occurrence identity, reconciliation and replay

`staging.ads_card_batch` and `staging.ads_card_row` preserve safe provenance, hashes,
source occurrences, classification evidence, validation issues and lifecycle receipts.
One statement has versioned batches with **at most one confirmed applicable batch**.
A row identity is `(batch_id, original_source_row_number)` (or an explicit reviewed
source occurrence ID), **not** `(descriptor, date, amount)` or `row_hash` alone.
Repeated identical rows and repeated hashes are permitted. All 111 reported LINE OA
occurrences must remain separate; their multiplicity is meaningful.

1. Dry run writes nothing. Validate date/decimal formats, row count, allowed fields,
   debit/credit direction, category mapping and exact statement control equation.
2. Sum all safe source cash rows once, including unresolved classification rows.
   Compare signed total with the comparable statement total using exact decimals.
   Show count, debit total, credits, net total, control total and difference. Do not
   sum BUD/month allocations, line budgets or commitment forecasts here.
3. `--apply` rechecks under the shared financial lock and writes one transaction.
   Mismatched totals, ambiguous source identity or conflicting replay produce a
   QUARANTINED batch with safe evidence/issues and no confirmed cost facts. A valid
   new batch is APPLIED_DRAFT for staff review, not automatically confirmed/paid.
4. Exact canonical **batch** replay returns the previous receipt without new rows.
   The fingerprint includes statement UUID, source/profile, ordered occurrences and
   safe values; filename and receipt timestamp do not define identity. Any changed
   or reordered replacement for that statement is quarantined for explicit review,
   not appended or deduplicated by value. Doc 23's budget natural-key deduplication
   must not be applied to individual card occurrences.
5. Online/admin reviews the source transcription/classification and confirms an
   eligible batch. A replacement requires explicit previous-batch/version selection;
   supersede the old batch and all of its current cost/allocation interpretations
   atomically. Preserve history and unresolved links; do not copy old per-row links
   by position onto a reordered file. Concurrent confirmations yield one success
   and one 409, never two applicable statement totals.

### 7.4 `ads.cost_record` and attribution

Fields: UUID, source batch/row occurrence and item number, cost type, payment method, DEBIT/CREDIT,
THB amount, charge date, optional posting date, vendor, account/mapping version when
known, observed Category/BUD/Detail reference, memo canonical ID and observed memo
text when supplied, optional commitment occurrence, optional explicit media-line
reference, evidence-reference set, document completeness and attribution status,
version/audit fields. `CORPORATE_CARD` comes from this import source, not Category.
Line links do not create or alter an SN assignment. Every typed row has exactly one
cost type; a genuinely composite source occurrence needs reviewed typed leaf costs
whose signed sum equals that occurrence. Uniqueness is per occurrence/interpretation/
item number, not row hash. The occurrence total stays in staging/control; do not
create another full-amount parent cost beside the leaves or count both in exports.

Unknown cost types stay staging-only until classified; a batch cannot be confirmed
unless all source occurrences have complete typed coverage. Known CHANNEL costs can
be confirmed with channel attribution still unresolved, provided Category/BUD/amount
are reviewed and the missing account/memo is visible. This allows truthful financial
totals without a invented OA identity. Missing document requirements remain separate
findings. An unresolved BUD/account split cannot produce confirmed allocations.

P2 mirrors Media's existing reviewed classification, allows explicit staff correction
with history and shows account-rule suggestions. It does not build statement OCR or
the P4 automatic classifier/count matcher. Card confirmation records row accuracy;
it does not approve the charge or settle the card. Budget, account and memo conflicts
stay visible even when the statement arithmetic balances.

### 7.5 Implementation refinement: close an account mapping's effective interval

An open-ended confirmed mapping must support a future successor without rewriting
its scope, BUD, split rule or original validity declaration. P2 therefore records
an audited, one-way `closed_on` lifecycle date separately from frozen `valid_to`.
Its effective exclusive end is the earlier non-null value of those two dates.
All overlap, charge-date and commitment coverage checks use that effective end;
exports expose it as `effective_valid_to`, with original `valid_to` and `closed_on` retained
to explain the original declaration and subsequent close.

Staff explicitly close the mapping with its expected version, exclusive cutoff and
reason. Reject a cutoff at/before the start, a repeat close, an extension beyond the
declared end, confirmed charges at/after the cutoff, or an ACTIVE commitment whose
period reaches the cutoff. Suspend/revise affected commitments first. Closing never
rewrites past charge or allocation references, and does not automatically confirm a
successor. The Thai action is `ปิดช่วงเวลาผังบัญชี`; the cutoff label explains that
the old mapping is usable only before that date. This completes the approved
versioned-account workflow for nullable end dates; it is not a new funding rule.

## 8. API, UI, permissions and exports

Extend doc 23's API pattern with staff-only account list/create/version-confirm
endpoints; commitment list/create/revise/activate/suspend endpoints with cover and
monthly previews; memo-identifier propose/review endpoints; statement-control and
card-import receipt/list/detail/confirm/replace endpoints; cost detail and explicit
allocation review. Validate versions, roles and totals on the server, in guarded
transactions. No PDF upload/download/OCR endpoint exists in P2. No client-generated
name, role or actor field is accepted.

Reuse doc 22's theme, Thai typography, focus/deep-link/reduced-motion rules. Add
`ทะเบียนบัญชีโฆษณา`, `ทะเบียนบัญชีช่องทาง`, `ภาระผูกพันประจำ`,
`รายการค่าใช้จ่ายผ่านบัตร`. Show separate `งบที่อนุมัติ`, `ยอดเรียกเก็บ`,
`ค่าใช้จ่ายตามเดือน`; imports show `ยอดตามรายการ`, `ยอดตามใบแจ้งยอด`,
`ผลต่าง`, `รอตรวจสอบบัญชี` and a focused error summary linking to affected fields.
Commitments display `ไม่ใช่แคมเปญ — ไม่ออก SN`. No automatic fake campaign entry.
Memo aliases show canonical and observed text side by side before confirmation.

All new tables, child versions, staging rows and functions follow doc 23 forced RLS,
fixed search_path, no DELETE and `audit.record_change`. Only authorized
`online_staff`/`admin` may see costs, mappings, commitments and statement control.
Agency/residential/public roles get no financial access. **Media team membership
does not imply online_staff**: Q21 must confirm role ownership/provisioning; until
then, an already authorized Online/admin operator imports the Media team's export.
Do not grant a broad role based on a display name or invent a new production role.

The existing four P2 export views remain, extended for typed budget items without
duplicating component gross. Propose six additional read-only views under the same
`ads_export_owner`/`ads_export_reader`, source key `hub`:

| View → proposed DW table | Grain / safe data |
|---|---|
| `ad_account` → `hub__ad_account` | Confirmed account mapping version with account ID, platform, scope, agency, validity and reviewed BUD split as a non-additive list. No evidence, reviewer or raw descriptor. |
| `channel_account` → `hub__channel_account` | Confirmed channel mapping version with verified account ID, scope/BUD/plan, expected charge and validity. No steward notes or personal data. |
| `recurring_commitment` → `hub__recurring_commitment` | Commitment version with cost dimensions, account/scope/BUD, frequency, cycle amount, dates/state, structured memo-cover caps/periods and material versions. Amount is a forecast, not actual spend. No evidence or actors. |
| `cost_record` → `hub__cost_record` | Typed cash-cost version with occurrence ID, statement-control UUID, amount/direction/dates, cost dimensions and confirmed mapping/memo/commitment/line references, state and applicability. No Category/Detail/descriptor/PII/evidence text. |
| `cost_allocation` → `hub__cost_allocation` | Allocation version × month × scope/BUD, amount/direction, cost dimensions and parent cost ID, method/status/applicability. Sum these for monthly costs; never add parent cash again. |
| `memo_identifier` → `hub__memo_identifier` | Confirmed/retired identifier text, canonical memo UUID, kind and status. No evidence/approver identity; retired identifiers are historical only. |

Use explicit column grants and a consistent snapshot. No statement PDF, OCR, raw
sheet row, private filename, cardholder/address/partial-card value or audit PII is
exported. These are Hub contracts only; no DW repo/source registration/jobs change
here. P3 remains the later actuals/read-back workstream; these validated card rows
are not claimed to replace Google/Meta platform spend or DW reconciliation controls.

## 9. P4 design only: private statements and LINE OA count matching

The full authorized P4.0 design is [doc 21](21-ememo-archive-and-search.md), awaiting
`P4.0 approved` and completion of P3 before implementation. The owner's 1 October
instruction makes **accepted per-account evidence under Q20 a prerequisite** for
automated LINE OA reconciliation. This supersedes the earlier count-only assumption.

P4 reuses the private document pipeline's storage, version/hash, access audit and
OCR infrastructure, **not its memo RAG indexing path**. Statement document type must
be explicitly excluded from all RAG namespaces, including restricted memo search.
No statement image, OCR text, derived chunk or embedding is indexed. Money is read
from validated typed rows, never retrieved prose. Marketing-ops roles alone can read
statements or extracted drafts; signed short-lived downloads require authorization.

Proposed sequence after Q7: private source receipt → text-layer extraction, or image
OCR when absent/incomplete (the reported five-page file has no text layer) → DRAFT
occurrences with page/row provenance → exact per-page counts and total check →
authorized Media reviewer confirms rows → versioned rule-based classification.
Here confirmation means **OCR transcription confirmed**. Final **financial cost-batch
confirmation** is a separate state transition after complete typed coverage and the
§7 total checks; classification cannot be skipped by confirming OCR text.
OCR confidence/total agreement alone cannot confirm a row or memo. Preserve source
occurrence counts across pages and reruns; never deduplicate identical transactions.
If a confirmed P2 sheet batch already represents this statement, compare/link the
OCR evidence to that same control record; never import it as another expense batch.

Only after per-account evidence, the rule and expected commitments/charge dates
are reviewed and accepted under Q20, a future approved rule may group LINE OA debits
by **(charge date, amount)** within the same statement/vendor/currency context.
Remove valid prior/manual matches from both observed and expected sets consistently;
conflicting matches go to review. Compare the **unmatched observed** occurrence count
with eligible **unmatched expected** commitment occurrences. Once that evidence gate
is satisfied, when counts match exactly and mappings/coverage are valid, the rule may assign
the interchangeable rows deterministically (stable source order and commitment ID)
and record rule/version, bucket counts and method **COUNT_MATCH**. No amount/date
tolerance, fuzzy vendor match or assumed billing date. Already matched occurrences
cannot be reused. Credits/refunds require their own explicit review.

This records a count-based allocation convention, **not proof that a particular
indistinguishable row identifies one OA**. Mismatched/missing/extra counts or conflicting
manual assignments send the whole affected bucket to review; no arbitrary partial
match. Reprocessing is idempotent; changed commitments/rules require a reviewed new
interpretation rather than rewriting confirmed history. Without accepted per-account
evidence, attribution stays unresolved even when counts match. Neither the descriptor
nor source row order supplies that missing evidence; current P2 reviewed mappings remain.

Statement PII includes cardholder name, company address and partial card number.
Real storage/access locations require the **Q7 DPO decision before any real upload**;
external OCR/LLM processing also waits for that decision and verified local masking
of the cardholder name, address and card-number fields. Do not upload/send the reported PDF to any OCR or
LLM in P2, provision storage or assume provider endpoints prove residency. This is
an owner approval gate; it is not a completed legal assessment.

## 10. Acceptance, questions and scope gate

After `P2.0 approved`, implement these P2 additions with synthetic fixtures and the
five real checks in doc 23, plus targeted coverage:

- SQL/RLS: deny agency/public access; account validity overlap rejection; exact BUD
  split sums; every typed cost's dimensions; memo alias collisions; cover caps;
  confirmed cost/allocation immutability; export PII exclusions; no statement RAG path.
- Concurrency: one applicable statement batch; replacement cannot double-count;
  competing linked cover reservations cannot exceed the same line reservation;
  expected cycles cannot exceed their own cover cap; global memo differences remain
  visible findings; memo invalidation
  races cannot activate a stale commitment; one canonical/alias lookup owner.
- Importer: exact header binding and safe projection; same batch no-op; changed or
  reordered batch quarantined; **111 synthetic identical LINE occurrences retained**;
  raw-row hash not unique; debit/credit totals; mismatch no confirmed facts; absent
  coverage/account remains unresolved; excluded personal/card content never retained.
- Allocation/pytest: synthetic annual 1,199.99 → 12 exact months; BUD remainder
  conservation; no cash-plus-recognition double sum; effective-date boundaries,
  refund review, unknown mappings, category conflicts, no SN side effects and
  `M.COM037/69` never silently merged with `M.COM033_69`.
- Playwright: Thai account/commitment/card review flows, visible control difference,
  cash versus monthly amounts, alias review, role denial and reduced motion. No PDF
  controls or LINE auto-match behavior until P4.

P4 acceptance is a future test plan only: synthetic image PDF → draft rows → total
check → authorized confirmation → classification; exact count-match/mismatch buckets,
page/rerun multiplicity, no duplicate P2/P4 expense and no RAG ingestion. Q7 blocks
real overseas OCR/LLM processing. No P4 implementation or real statement test now.

Questions added: Q18 LINE OA budget owner/location; Q19 memo cadence; Q20 account-level
billing export; Q21 Media/Online role relationship; Q22 export/control profile; Q23
memo alias evidence; Q24 document matrix, allocation and split policy. Each has an
owner, go-live impact and safe default in the decision register. Unanswered business
questions permit synthetic P2 coding after approval, not invented production rules.
The previous ~1.5-week P2 allowance did not include this scope; re-estimation is
needed, with no new delivery date promised here.

**Stop after expanded P2 implementation, verification and report.** The explicit
P2.0 gate is satisfied; P4 construction and external source writes remain unauthorized.
The 1 October owner instruction separately authorizes the Task 0/A handoff and
P3.0/P4.0 design commits/pushes; it does not authorize P3/P4 implementation.
