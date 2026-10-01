# 21 — E-memo archive, statement extraction and restricted search (P4.0)

Date: **1 October 2026 (Asia/Bangkok)**. Status: **approved synthetic/local demo**.
The owner approved P4.0 and demo-first implementation on 1 October. P3 is complete;
Task 3's residential slice was pushed as `dba493f` before this area begins. Real
uploads, external OCR/model calls and deployment remain blocked. P1/P2 behavior, issued
names, the SENA-H grammar and `sena_h_approved=false` stay unchanged.

Read with [doc 23](23-media-lines-and-memo-register.md),
[doc 24](24-card-costs-and-recurring-commitments.md),
[doc 20](20-marketing-operations-flows.md) BF-2,
[doc 22 §3](22-hub-assistant-and-ui.md#3-hub-motion-and-interaction-spec),
[doc 06](06-rag.md), and [open questions](ads/OPEN_QUESTIONS.md).
This document applies the `sena-ememo-archive` boundary to **two document types**:
`E_MEMO` and `CARD_STATEMENT`. They share storage and extraction infrastructure;
only a reviewed, sanitized memo body may enter restricted search.

## 1. Sources and decisions that precede real use

| Type | Preferred input | Authority and fallback |
|---|---|---|
| E_MEMO | E-memo API/webhook, then read-only view/export, then operator PDF upload | Q1 must confirm access, external IDs, fields and approval history. Structured authoritative records take precedence over OCR; retain their evidence PDF/version when available. A webhook triggers a verified read, not an unauthenticated record update. Until access is agreed, P2's accepted MANUAL mirror remains the route. |
| CARD_STATEMENT | Bank text/CSV export when available, otherwise PDF | Finance confirms the source profile, cycle identity, reconciliation equation and control total under Q22. A text layer/export still needs validation and human confirmation. Never alter the bank or Media source. |

Q7 requires a recorded IT/DPO/data-owner decision on actual storage, database,
backup, support/access and processing locations **before any real document upload**,
including a private R2 upload, or external OCR/LLM processing. A bucket location hint,
provider name or redacted sample does not establish approval. This is a deployment
decision gate, not a legal compliance finding. Synthetic documents can be used in
approved P4 development; there is no current permission to provision real storage.

The Hub **mirrors E-memo approval**. Confirming extracted text does not approve a
memo, authorize a budget, approve a bill or pay a card. Source status, transcription
status, review status and P2 financial applicability remain separate.

## 2. Private storage, identity and versions

Use a private R2 bucket with public access disabled and separate TEST/production
credentials and object namespaces. No document key or URL appears in public assets,
`public_api`, DW exports, analytics, browser telemetry or ordinary error logs.
Originals remain restricted even when a sanitized derivative is safe for processing.
R2 buckets are private by default; explicitly prohibit public `r2.dev` access and
public custom domains for this archive. See the
[Cloudflare R2 public-access documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).

Content-addressed originals use `memo/sha256/<sha256>.pdf` and
`statement/sha256/<sha256>.pdf`; text/CSV source objects use their validated media
type and extension under the statement namespace. Server-side SHA-256 is calculated
from the uploaded bytes. Store an internal blob ID, hash, byte size, validated MIME,
restricted original filename, object key, page count, source type/reference,
uploader and `timestamptz`. External document/account IDs remain text. Original
filenames are display metadata only, never object paths or trusted identifiers.

An archive document has an immutable type and stable UUID. Each document version
links a blob, version number, source revision and receipt time; it also links the
existing P2 `memo_id` or `card_statement_control_id` once reviewed. Identical bytes
deduplicate in the same environment/type; each authorized source receipt still has
provenance. Hash equality never grants another caller access or merges two business
identities. Changed bytes create a new version; previous evidence stays retained.
The same PDF re-upload is not another charge, memo cap or financial revision.

Validate PDF magic/MIME, bounded size/page count and safe decoding; reject encrypted,
JavaScript-bearing, embedded-file or malformed PDFs and quarantine unsafe inputs.
Scan and parse in a worker sandbox without network access or PDF script execution.
Reuse the existing asset-upload hardening where suitable, with document-specific
limits approved in P4 implementation. Text/CSV imports use an allowlisted encoding
and profile; formulas, links and file content are data, never executable instructions.
Do not fetch arbitrary embedded links or URLs supplied in document text.

Keep extraction drafts and sanitized derivatives private with explicit parent hash,
transformation version and review receipt. Do not overwrite an original with OCR
text or redaction. No automatic physical deletion is authorized while Q29 retention
and legal-hold rules are pending.

## 3. One worker pipeline, explicit review boundaries

The API accepts a bounded upload/source receipt and queues work; it never runs OCR
inside a web request. Start with a durable database-backed worker job, not another
message broker. A worker on the approved host takes a lease, records heartbeats and
can resume after a crash. Q7 applies to that host and its temporary files as well.

```text
validated source/version
  -> text-layer extraction
  -> local OCR for absent, incomplete or unusable page text
  -> structured extraction and deterministic validation
  -> DRAFT fields/rows with page provenance
  -> human review and confirmation
  -> CONFIRMED transcription
       E_MEMO         -> explicit P2 memo update/record confirmation
       CARD_STATEMENT -> existing P2 staging/classification/financial-batch controls
```

Use the text layer first (existing `pypdf` for PDFs); a nonempty text layer is not
proof it contains every table row. Test reading order, dates, amounts and page
coverage. Run local OCR on deficient pages, keeping original page numbers and row
coordinates. Engine selection is an evaluation outcome (§6), not a commitment to
one new dependency. Unknown text/amounts stay null with a review issue; do not infer
missing rows or adjust amounts to make a total balance.

Each field stores raw observed text privately, normalized typed value, source page
and bounding box/row where available, extraction method, engine/model/configuration
version, job attempt, and validation issues. Confidence is nullable; retain the
engine's reported score and its scale when available. Do not invent percentages,
equate a model's self-reported certainty with calibrated probability, or treat a
high score as permission to confirm. A human correction preserves the original
draft value, corrected value, reviewer, time and reason.

Minimal proposed persistence, separate from existing P2 business records:

| Record | Grain and purpose |
|---|---|
| Private document/blob and version | One archive identity with immutable source versions and private storage metadata; type cannot be changed to bypass statement restrictions. |
| Extraction run | One `(type, sha256, pipeline_version, engine_config_hash)` result and its append-only attempts; lease, state, bounded retry count, safe error code, started/finished times. |
| Draft field/page or statement occurrence | One extracted field or observed row occurrence per run, with provenance, validation and human-review state. Statement identity is `(version, page, row_ordinal)`, not a descriptor/value hash. |
| Review/application receipt | Exact run/version reviewed, actor/time, corrected fields, checks, P2 target IDs and expected versions; an idempotency key prevents repeated application. |
| Document access/retention record | View/download receipts, access purpose, retention policy/version, hold state and authorized disposal history. |

The eventual migration may reuse an existing document/job facility if it meets these
boundaries. No generic framework, new P2 export or second memo/cost ledger is needed.
Use forced RLS, guarded functions with fixed `search_path`, verified actor context,
narrow worker grants and `audit.record_change` for mutable metadata. No application
DELETE grant. Only an approved retention job may dispose of archived evidence;
the restricted index worker may remove stale/ineligible derived chunks under §7
without deleting the retained source document.

Retries with the same run key reuse results and never duplicate source occurrences
or P2 records. A different engine/pipeline version creates a new draft interpretation;
it does not overwrite a confirmed result. Failed jobs retain safe diagnostic codes,
not PDF text or PII in logs. Confirmation uses expected run/document/P2 versions and
transactional checks; concurrent or stale confirmation returns a conflict. Changing
reviewed fields invalidates the pending confirmation checks.

## 4. Statements: evidence, reconciliation and P2 handoff

### 4.1 Reported evidence and the acceptance control

The following is **owner-reported evidence, not independently inspected or rerun**
for this design: a Krungsri statement is a five-page image-only PDF with a watermark,
cycle 26 August–25 September 2026, due 15 October, total **THB 373,108.98**. A
Tesseract baseline recovered **115 of 132 rows** and misread one amount; comparison
with the reported total caught the error. The existing Media classified sheet was
reported to sum exactly to that total. These observations motivate the controls;
they are not an engine benchmark or permission to process that document.

The reviewer establishes the expected transaction count for **each page** from the
source, excluding headings, carried balances and subtotals according to the approved
profile. Do not invent per-page counts from the aggregate 132. Keep each occurrence,
including identical dates/descriptors/amounts and repeated row hashes. Validate:

1. Every page and expected source row is accounted for once. Compare extracted and
   independently checked expected counts per page and in total; detect duplicated
   page imports and page-boundary carry rows explicitly.
2. Parse money as exact decimal strings into `numeric(14,2)` THB or integer satang.
   Record DEBIT/CREDIT separately; sum signed source occurrences once. Report debit
   total, credit total, net total, declared comparable control and exact difference.
3. Count agreement and an exact zero difference are both required. A balanced total
   can hide offsetting errors, so the reviewer checks rows/amounts against the source;
   arithmetic alone never confirms transcription.
4. The statement's control meaning must be accepted. Current P2 supports confirmed
   `NET_CHARGES`; a closing balance containing opening balance, repayment or other
   adjustments is not that measure. Unknown meanings remain `REVIEW_REQUIRED` under
   Q22. Do not fabricate BANK_FEE rows or change the declared total to make it fit.

Charge date, posting date, billing cycle, due date and covered recognition months
remain distinct. Dates display in Asia/Bangkok; business months are first-day dates.
No calendar-month assumption is derived from the statement label or due date.

### 4.2 Local masking before external processing

Statements contain cardholder name, address and full/partial card-number fields.
Before **any approved external** OCR/vision/extraction request, redact these locally
on every page, header, footer and appendix. Remove underlying PDF text, metadata,
attachments and hidden layers; rasterize/flatten the reviewed derivative so a black
rectangle cannot expose the original text. Review the actual exported images/text
for residual PII and record a redaction receipt linked to their hashes.

Only the reviewed derivative may be sent through the approved API path after Q7.
Never send the original PDF, object URL, filename containing personal data or raw
debug payload. If local masking cannot be verified, use local processing and manual
review; do not send the file externally to discover what should have been redacted.
Keep no real samples in Git, test snapshots or the ChatGPT web application.

### 4.3 Confirmation and existing financial controls

Media/Online reviewer authority is a role decision (Q21/Q30), not inferred from
access to a cost screen. An authorized reviewer confirms the exact transcription
version after counts, amounts and statement-control meaning pass. Versioned,
reviewed classification rules may then suggest cost type, vendor/account and BUD.
Unknown or conflicting matches remain review items; no model approves a charge.

Link the archive to the **same** P2 `ads.card_statement_control` and source batch.
If an existing confirmed Media-sheet batch already represents it, compare the
statement evidence with that batch and record the evidence link; do not create a
second expense. An explicit replacement follows P2's quarantine/review/supersession
rules. Never transfer old mappings by row position onto reordered occurrences.

If no batch exists, confirmed transcription feeds the existing sanitized P2
staging/import controls, using stable page/row source coordinates and raw safe-row
hashes. It creates draft typed costs only after complete classification coverage;
P2's separate authorized **financial batch confirmation** remains required. Keep
exact replay harmless, conflicting replay quarantined, one applicable confirmed
batch per statement, and all cost/allocation revisions and history intact.
Do not add a second raw-parent expense beside typed leaves. Cash charges, monthly
allocations, recurring forecasts and budget/memo caps remain separate measures.

### 4.4 LINE OA owner deferral

The owner parked account attribution on 1 October. Q18/Q20 are deferred and absent
from the pending-question page. Keep statement occurrences as `CHANNEL` costs in
the unattributed bucket `LINE OA (ยังไม่แยกบัญชี)` so totals reconcile. Do not build
an OA matching/review screen. The following evidence discussion is future work only.

The 111 reported LINE OA rows share one descriptor, which cannot identify an OA.
**Automated reconciliation waits for per-account evidence under Q20.** A matching
count alone does not now authorize assigning accounts. Continue reviewed explicit
P2 mappings when supported by evidence; otherwise show unresolved attribution even
when the financial total balances. No invented account ID, row-order inference or
automatic SN/line assignment is allowed.

After the owner accepts the per-account evidence and eligibility policy, a later
approved rule may compare unmatched occurrences with eligible expected commitments
by `(statement, vendor, currency, charge_date, amount)`. Account/plan/validity/coverage
must be evidenced; subtract prior matches consistently, retain multiplicity and
require exact equal counts. A count-based distribution of otherwise interchangeable
rows would be recorded as `COUNT_MATCH`, with rule version, source evidence and
bucket counts. It is an allocation convention, not proof of a specific row's OA.
Missing/extra counts, credits, conflicting matches or changed commitments go to
review; no partial arbitrary assignment, tolerance or re-use of an occurrence.
This replaces the earlier count-only eligibility assumption in doc 24.

## 5. Memo extraction, canonical identity and mirrored approvals

Draft fields include exact observed memo number, subject, requesting BUD, gross and
optional media/fee/VAT amounts, authorized period, external status, approver names
and decision times, approval date and source reference. Preserve source strings and
leading zeros; validate candidate formats without claiming Q14's formats are final.
Missing source fields remain unknown. Do not infer a period or approval from a
memo's serial/year or turn a signature image into a confirmed identity.

The review screen shows the source page beside each field. A staff reviewer confirms
or corrects the values and explicitly links/updates the existing P2 memo via guarded
commands. The application receipt retains provenance and expected P2 version. P2's
existing review, material-change invalidation, revision and cap rules still apply;
archive transcription confirmation cannot reactivate a superseded financial record.
Approval/status discrepancies between authoritative API data and a PDF are review
items, not a reason for an OCR result to override the authoritative source silently.

Resolve identifiers through `ads.memo_identifier`. Q23 asks whether **`M.COM037/69`
and `M.COM037_69`** are the same document in different notation. Preserve observed
notation and require the existing evidence/admin alias review; punctuation cleanup
does not confirm identity. `M.COM037/69` and `M.COM033_69` have different serials and
remain different memo numbers. Do not merge their caps or create a memo from a
similar-looking extracted identifier without review.

Approver names, signatures and decision details remain restricted evidence/personal
data. They do not appear in the DW contract, public content or an embedding. The
archive does not introduce a Hub button that approves E-memo itself.

## 6. Engine evaluation before selection

After P4 implementation approval and the relevant Q7 decisions, evaluate **three
statements and ten memos** with authorized data custodians. Until then use synthetic
fixtures only. This is a planned evaluation; no comparative results are claimed.
Q30 names the benchmark custodian/reviewers and accepts the corpus, thresholds and
cost/runtime limits. Include image-only and text-layer sources, Thai/English text,
watermarks, repeated identical rows, page breaks and low-quality scans.

Compare a pinned local [Tesseract](https://tesseract-ocr.github.io/tessdoc/)
`tha+eng` baseline with candidate local deployments of
[PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR),
[EasyOCR](https://github.com/JaidedAI/EasyOCR) and
[Typhoon OCR](https://github.com/scb-10x/typhoon-ocr), and an approved
[OpenAI vision API](https://developers.openai.com/api/docs/guides/images-vision) path.
Evaluate candidates before choosing dependencies; model availability, licenses,
hardware requirements and whether a deployment calls an external service must be
verified for the selected versions. "Local candidate" is a deployment requirement,
not an assurance that every package/model runs offline by default. Never use the
ChatGPT web app as a processing or benchmark route.

These primary references were reviewed on **1 October 2026**; no benchmark was run.
OpenAI documents image inputs through the API and limitations involving accuracy,
non-Latin text and small text. Those limitations reinforce the need for the Thai
document evaluation and human checks below; they do not establish a preferred
engine or an accuracy guarantee for these statements and memos.

Use the same allowed source/derivative for comparable runs; record original and
redacted hash, corpus version, engine/model version, prompts/configuration, language
packs, image rendering settings, hardware, runtime and API cost. Human reviewers
produce field/occurrence ground truth and per-page counts independently of the
engine. Keep the corpus private and report aggregate metrics without source PII.

| Metric | Definition and reporting |
|---|---|
| Row recall | Correctly recovered ground-truth transaction occurrences / all source occurrences, by page/document and overall. Identical rows count separately; also report extra/duplicate rows. |
| Exact amount match | Ground-truth occurrences with correctly aligned direction and exact posted THB amount / all ground-truth occurrences; missing rows are failures. Report memo gross/split fields separately. No rounding tolerance. |
| Total-check pass rate | Statements passing the accepted exact net-charge equation before human edits / evaluable statements; also report per-page count pass rates and unsupported equations. A pass is not financial approval. |
| Confirmation time | Active reviewer minutes to reach verified fields, counts and exact totals, per statement/memo; separate OCR waiting time and record correction count. Counterbalance engine review order. |

Report document-level results as well as aggregate counts so a large statement does
not hide a failed memo. Record engine failures and unsupported pages in denominators,
not as discarded cases. An engine never bypasses human confirmation; every confirmed
statement must have 100% accounted-for occurrences, exact checked amounts and zero
control difference. Q30 sets the useful pre-review recall/time threshold after the
baseline; the current design invents no claimed accuracy or automatic-accept cutoff.

## 7. Restricted memo search; statements never enter RAG

Search eligibility requires `E_MEMO`, the current confirmed document version,
reviewed sanitized text, an explicit internal-search permission and no hold on
processing. DRAFT extraction is a staff review queue, not search evidence. Names,
signatures, addresses and other personal fields are removed from indexable text,
metadata, snippets and embeddings under doc 06. Store the original only in the
private archive and protected structured fields; review any sanitization ambiguity.

Build Thai lexical + vector search over reviewed memo sections/pages in
`namespace='internal_memo'`, retaining document/version/page citations. Use Thai
segmentation and literal/trigram memo-code lookup as doc 06 describes. Apply the
caller's permitted memo/BUD/document scope **before** retrieval, ranking, snippets,
facets and counts. A namespace string or UI filter alone is not authorization.
Amounts, dates, approval status and memo caps displayed in results come from current
validated P2 fields, not generated prose or retrieved text. P5 assistant work is out
of scope; P4 search need not synthesize an answer.

Enforce a DB-level deny rule: `CARD_STATEMENT`, its images/OCR/rows/snippets and any
statement attachment are ineligible for **every** RAG namespace, including internal
ones. A memo with a statement appendix must be split into separately classified
private documents after review; never relabel the statement pages as memo text.
Exclude statement content from embedding jobs, cached search snippets and model
retrieval traces. Typed P2 financial records are the source of money, not a statement
search index. Never expose `internal_*` content through `public_api` or the customer
chatbot; test denial below the API layer.

Replace the current memo index version atomically after sanitization and permission
checks. Prior archive versions remain retained but their obsolete chunks do not
remain current search results. Daily reconciliation removes orphaned, superseded,
revoked or no-longer-eligible chunks and caches. For this namespace, eligibility is
the **memo ACL and current confirmed version**, not presence in `public_api` (doc 06's
public-content reconciliation example must not be copied verbatim). Permission
revocation blocks reads immediately even if asynchronous cleanup is still pending.

## 8. Access, download audit, retention and legal hold

Only authorized marketing-ops staff (`online_staff`/`admin`, subject to the accepted
document scope) may read originals, drafts and personal approval details. Agency,
residential, public and DW-reader roles receive no document access, counts, snippets,
storage metadata or signed URLs. Media is not automatically `online_staff` (Q21).
Workers have only the grants and object prefixes needed for their job; external
processing has a separate allowlisted egress path and no financial mutation role.

Authorize every metadata view, preview/page read and download against the current
ACL. Log actor, document/version, action, timestamp, request receipt, outcome and
purpose without duplicating document text/PII. Protect those audit records. Log
denied attempts too, without disclosing whether a guessed document exists.

Prefer an authenticated API/worker byte proxy for previews and downloads so the
actual request is checked and audited. If a short-lived presigned GET is used,
record its issuance **and** correlate actual object reads with access receipts;
issuing a URL alone is not proof of a view/download. Do not claim auditing is
complete if the selected R2 delivery path cannot provide those receipts; use the
proxy instead. Distinguish request, served/partial bytes and delivery failure;
delivery does not prove a human read the document. Multi-page/range reads may share
one view session receipt but retain per-request access events.

Never log signed URLs/tokens. Private previews use no shared/public cache; permission
changes invalidate app caches and future authorization. A bearer presigned URL can
remain usable until expiry, so strict immediate revocation requires the proxy path;
Q7 must accept any alternative lifetime. Recheck permission on citation opens and
downloads, not just when search results were generated.

Q29 assigns Finance/Legal/DPO/data owners to set a retention schedule, legal basis,
start event, approved storage/backup periods and disposal authority. **No statutory
retention duration is asserted here.** Default while unanswered: retain restricted
evidence, grant no app DELETE and perform no automated expiry of real records;
review this interim retention with the owner rather than treating it as indefinite
approval. A legal hold overrides expiry for originals, versions, derivatives,
extractions and applicable receipts. Release requires a named authorized decision
and audit. Disposal, once approved, must cover object versions, temporary copies,
worker caches, extracted text, embeddings and backup lifecycle, with a receipt and
retained minimal audit trail. Synthetic test cleanup is a separate, scoped policy.

## 9. Thai review and search screens

Use the existing Emerald & Champagne semantic tokens, Google Sans/Noto Thai rules
and **only** `styles/motion.css` and doc 22 §3 primitives. No new timing constants,
keyframes or ad-hoc animations. Row/detail cards preserve focus, Esc/Back and deep
links; reduced motion uses the existing instant/fade behavior. Data and validation
results render immediately. Do not animate amounts as though they are fresh facts.

| Screen | Required behavior and Thai wording |
|---|---|
| Archive list | `คลังเอกสาร`, filters `ประเภทเอกสาร`, `เดือน`, `หน่วยธุรกิจ`, `สถานะ`; separate memo and statement results. Show `รอตรวจสอบ` versus `ยืนยันข้อมูลแล้ว`, exact version and source timestamp. Storage/processing unavailable state explains the Q7 gate in Thai. |
| Memo review | Source page beside draft fields; `ข้อมูลจากเอกสาร`, `ค่าที่แก้ไข`, `เปิดหน้าหลักฐาน`, `ยืนยันข้อมูลที่ถอดจากเอกสาร`. Separate notice `การยืนยันข้อมูลไม่ใช่การอนุมัติบันทึกข้อความ`; warn about stale P2 versions and missing alias evidence. |
| Statement review | Page tabs/selector with expected versus extracted counts, occurrence table, debit/credit/net/control/difference. `จำนวนรายการไม่ตรง` and `ยอดรวมไม่ตรง` link to affected pages/rows. Separate `ยืนยันข้อมูลที่ถอดจากเอกสาร` and later existing `ยืนยันชุดค่าใช้จ่าย`; never imply one button approves both. |
| LINE OA | No matching/review screen in the owner-approved demo. Retain `CHANNEL` costs in `LINE OA (ยังไม่แยกบัญชี)`; Q18/Q20 are deferred. |
| Memo search | `ค้นหาบันทึกข้อความ`, Thai query input, filters memo series/BUD/month/status, results grouped by canonical memo with matched observed alias. Confirmed facets only; draft status opens the authorized review queue instead of RAG. |

Search result layout:

```text
ค้นหาบันทึกข้อความ  [ข้อความหรือเลขบันทึกข้อความ                 ] [ค้นหา]
ชุดเลขที่ [ทั้งหมด]  หน่วยธุรกิจ [ทั้งหมด]  เดือน [ทั้งหมด]  สถานะ [ยืนยันแล้ว]
-------------------------------------------------------------------------
เลขบันทึกข้อความ <verbatim>       หน่วยธุรกิจ <code>       <validated THB>
ช่วงเวลาที่อนุมัติ <validated period>       ข้อมูลยืนยันเมื่อ <Bangkok time>
ข้อความที่ผ่านการตรวจสอบ ...       [เปิดหลักฐาน หน้า <n> รุ่น <version>]
-------------------------------------------------------------------------
```

Return highlighted sanitized snippets with source page/version; opening a result
rechecks permission and audits the view. Private statement content never appears
in this screen. Empty/loading/failure states are Thai, with safe retry and source
timestamps. A failed extraction does not expose a raw engine error or PDF filename
containing personal information.

Keep dense table values at the existing Noto-first 15px/1.6 minimum and preserve
literal IDs/leading zeros. Provide visible labels, keyboard access, text/icon status
and a focusable error summary linked to inline field errors; a toast alone is not
validation. This applies the `ui-ux-pro-max` focusable-error-summary guidance to the
existing Hub system. Verify Thai marks at 200% zoom, readable row scanning, source
page navigation, focus return and narrow-screen stacking with actual Thai reviewers.

## 10. Proposed API boundary and acceptance plan

Under the existing authenticated admin API, propose document receipt/list/detail,
version/page/download, extraction-run/retry, draft review/confirm and memo-search
endpoints. Mutations require explicit actor, expected version and idempotency key;
the server decides document type/target eligibility and enforces the Q7 feature
gate. No public object listing, arbitrary-URL ingestion, agency route or generic
LLM tool execution endpoint. API/route/table names are finalized during the approved
implementation, using the next global migration counter then available.

P4 acceptance must exercise synthetic fixtures before real evaluation:

- SQL/RLS/API: agency/public/DW/residential denial, child-row permissions, immutable
  type/version, audit-read protection, stale/duplicate confirmation and transactional
  P2 application; no name or `sena_h_approved` changes.
- Worker/storage: MIME and PDF hardening, page/size limits, hash replay, changed-byte
  versions, lease expiry/retry, duplicate job races, safe logs and blocked external
  egress without Q7. Redaction tests inspect rendered pixels, hidden text and metadata.
- Statement controls: synthetic image-only/watermarked pages, an omitted row, a
  wrong amount, offsetting wrong amounts with a balanced total, duplicate pages,
  identical occurrences, page-boundary carry rows, credits and unsupported total
  meanings. Fail confirmation on any count/amount/control discrepancy.
- P2 integration: existing sheet-batch evidence link produces no expense; replacement
  follows quarantine and supersession; concurrent applications create one receipt;
  no cash-plus-allocation total. Unknown LINE accounts remain unresolved under Q20.
- Memo/search: candidate-format errors, same-serial separator alias pending review,
  different-serial rejection, authoritative-source conflicts, no PII embeddings,
  stale-version replacement and ACL revocation. Statements/mixed appendices are
  denied from all index paths, facets, counts, snippets and public namespaces.
- Audit/retention: actual preview/download/range access, denial, partial delivery,
  expiry/revocation, legal hold, approved disposal and failed-disposal receipt.
- Playwright: Thai labels/errors, focus/error summary, source-page/version links,
  separated confirmation actions, search permissions and reduced motion with the
  shared motion primitives. Run the repository's full definition-of-done checks and
  report real results when implementation is authorized.

## 11. Open decisions and stopping point

| Decision | Effect and default pending answer |
|---|---|
| Q1 E-memo access | Manual evidence remains the fallback; no assumed API or write-back. |
| Q7 locations/external processing | No real upload or external processing until the recorded IT/DPO decision; synthetic approved development only. |
| Q14/Q23 memo formats/notation | Preserve exact numbers and proposed aliases; no implicit identity merge. |
| Q19/Q24 memo period and accounting rules | Archive evidence cannot invent coverage, requirements, splits or a new financial policy. Existing P2 controls remain authoritative. |
| Q20 LINE OA per-account evidence | No automatic account assignment from count agreement alone; unresolved attribution remains visible. |
| Q21/Q30 reviewer authority | Name the Media/Online roles and who may confirm transcription, financial batches and benchmark truth; existing access alone is insufficient. |
| Q22 statement control meaning/profile | Only accepted comparable net charges enter current P2 confirmation; other equations remain review-required. |
| Q29 retention/legal hold | Finance/Legal/DPO determine duration and disposal rules; no automatic deletion of real evidence while unanswered. |
| Q30 engine/corpus acceptance | Data custodians approve 3-statement/10-memo corpus, metrics, thresholds and API processing path after Q7; no winner or accuracy claim now. |

P4 excludes the P5 assistant, general-purpose document chat, public indexing,
QT/PO/bill/payment workflow construction and approval in E-memo. Do not build P4
outside the approved synthetic/local slice below. This document adds no deployment
permission and makes no claim that real evidence has been processed.

## 12. Task 4 implementation note — before code

**Source preview refinement during verification:** Edge renders text-layer memo
PDFs inside the authenticated sandboxed frame, but leaves image-only statements
blank there. The statement panel therefore displays the exact embedded full-page
raster through an authenticated, audited PNG endpoint. It accepts only the known
single full-page image composition and preserves the source pixels; it never
rebuilds a page from OCR fields. Unsupported layouts fail closed. Original versioned
PDFs remain available for separate opening/download. The PDF sandbox remains intact.

Use the next global migration **0022** for private archive metadata, immutable
versions, leased jobs, extraction/review receipts and a memo-only internal index.
Reuse P2 memo/card commands for the explicit application step. Keep transcription
confirmation, P2 record confirmation and external approval visibly distinct.
All mutations use fixed-local TEST guards, caller roles, optimistic revisions,
forced RLS and audit. The only accepted inputs are generated synthetic fixture
hashes; arbitrary uploads/URL ingestion fail closed while Q7 is pending.

Store content-addressed PDFs under ignored `.local/document-archive/`, with an
authenticated byte proxy and audited preview/download delivery. This is the local
substitute for private R2, not a hosted R2 implementation or residency decision.
No application deletion; admin may place/release a legal hold with a reason.
Held processing is blocked, retained evidence remains restricted, and old memo
chunks disappear from results immediately on version/status/permission changes.

One local worker command claims bounded leases, extracts text using `pypdf`, and
uses installed Windows OCR for the image-only English synthetic statement fixture.
This workstation exposes `en-US` and no Thai OCR pack; confidence stays unknown
where the engine does not report it. Thai text-layer extraction remains supported;
Thai scanned-document accuracy and engine choice remain Q30 evaluation work.
On hosts without this local engine, OCR jobs return an explicit safe retryable
unavailable result rather than fabricated extracted rows. No external OCR/LLM is
called. Microsoft's [OCR API](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync)
provides the local image-to-text operation used here; no comparative accuracy claim.

The demo uses deterministic labelled memo PDFs and an image-only, watermarked
statement with repeated LINE OA occurrences, a credit and exact synthetic control
totals/counts. The fixture manifest is independent validation ground truth, never
substituted for OCR output. A wrong/missing/offsetting amount or page count blocks
confirmation. Human corrections preserve extracted originals, page provenance and
review evidence. Statement confirmation may link an existing P2 batch without
another expense, or explicitly create a P2 draft batch through the current importer;
financial confirmation remains the existing separate action.

Search uses confirmed, reviewed sanitized memo fields/pages only in
`internal_memo`, with exact identifier/alias matching plus local lexical ranking.
The local demo has no embedding/LLM call or vector model download; semantic/vector
evaluation remains Q30. The DB rejects statement indexing independently of API
filters. Search numbers come from linked P2 fields, and citations reopen the exact
version/page under a fresh permission check. `/ads/archive` provides list/review,
safe retry, source preview, separate confirm/apply actions and memo search, using
shared motion/remarks. Q1/Q7/Q21/Q22/Q23/Q29/Q30 remain visible defaults; Q18/Q20 do not.

Acceptance includes real local image OCR, complete statement checks, hostile/unknown
PDF denial, worker leases/replay, stale confirmation/application, no duplicate P2
cost, memo-only index eligibility, legal hold and access audit. Run the five full
repository checks and commit/push this slice before P5.
