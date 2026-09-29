# SENA campaign registry: Google Sheets pilot field specification

> Moved from `sena_idea_mkt_data_warehouse/docs/` on 29 September 2026; this is now the only maintained copy. Interim Sheet UI. The Apps Script now lives in [`tools/name_builder/`](../../tools/name_builder/). It still generates V1 names and must be re-pointed to SENA-7 ([19](../19-campaign-naming-registry.md)).


## Current scope: naming register only

On 25 September 2026 the user narrowed phase 1 to a simple campaign-name register for marketers who run ads. The full workflow below is retained as a deferred design, not the marketer's current entry requirement.

The simplified live view is [Campaign_Names](https://docs.google.com/spreadsheets/d/1NltzExXglQjQqYstaMhhw_-2Zhun8TTB0XSSYFLcstg/edit?gid=954537573#gid=954537573): launch month, target choice, channel/tactic, objective, audience, agency, literal sequence and registrant, followed by the generated V1 name. It is the only visible tab. Supporting name options are on the hidden `Naming_Options` tab. Existing detailed tabs are retained and hidden. Budget approval, reconciliation, native account/campaign binding, UTM setup and API publishing are outside this naming-only step.

The table has Thai headers on row 5 and 200 blank entry rows, 6–205. A:H are inputs; I generates the name. B:F have dropdowns. Month must be a real Gregorian YYYYMM key; sequence is a literal integer 1–999, displayed as three digits. The hidden naming list contains 323 options, including all 117 groups, 192 V1-compatible exact phase pairs, the two curated joint/cluster choices and 12 brand/corporate/business templates. Thirteen phase IDs incompatible with V1 are retained in the source snapshot and omitted from choices rather than rewritten.

Generated names remain stable when another row duplicates them: conditional formatting marks duplicate names red and the user changes the sequence. Names are limited to 150 characters; incomplete/invalid selections show a direct message in I. KW audiences require Google SEM/SEMMAXCLICK. Adding a new target package requires the steward to extend the named option, dropdown and lookup range. No original account/entity DRAFT state was activated by creating naming templates.

Native Google Sheets checks generated the expected A–F names, highlighted duplicate names without altering them, showed the incompatible audience message and rejected a fractional sequence. Temporary test entries were removed. Builder and source snapshot: `outputs/naming_registry_simple_20260925/`.

**Update, 25 September 2026 (later):** `Name_Builder` replaced `Campaign_Names` as the visible entry tab (Apps Script `apps_script/name_builder_setup.gs`, bound to the Sheet). `How_To_Use` is the Thai guide; `Campaign_Names` is retained but hidden. Rows run request → automatic check → SENA Idea approval (the name is then frozen as text and cannot be withdrawn; cancel instead) → platform UTM → returned Ad Account/Campaign ID. Sequences are issued automatically and never reused. Channel choices and their UTM templates live in `Naming_Options` G:I, so a new ad platform is added as one row there. `CHATGPT / CONVERSATIONAL` is included for planned ChatGPT Ads buying. Approver emails go in `CFG.APPROVERS`, applied to every file with `updateApprovers`.

**Pre-approval template (25 September 2026, latest).** Agency files are on hold until management approves one internal template: `SPLIT_AGENCY_FILES=false`, their edit triggers and the 30-minute sync are removed, `All_Requests` is hidden, and the five files below remain unshared in Drive. The internal `Name_Builder` accepts all six agencies. Target selection is now three cascading columns: D scope (A–F), E project group / brand / corporate-BU, F phase or additional groups. The edit script narrows E and F per row. Scope C lists every phase combination for groups of up to 7 phases; the three larger groups (C-MIGD-BNGPU 14, C-MIBF-BNGPU 12, C-TKTH-TIWNN 11) accept typed phase IDs separated by dots. Scope D accepts one or more additional group IDs. C/D identifiers are ordered by the code-unit order stored in the hidden `Scope_Lists` tab, which is rebuilt from `Naming_Options` (`refreshScopeLists`). Six brand slugs from the REM brand snapshot were added as proposals pending approval (`NICHE-ID`, `NICHE-MONO`, `NICHE-PRIDE`, `PITI`, `FLEXI`, `SENA-SOLAR`); REM has no umbrella NICHE brand. The V1 name grammar is unchanged.

**Agency files (25 September 2026, on hold).** The registry file stays internal: hidden tabs remain accessible to anyone with file access, so agencies never get access to it. Its `Name_Builder` accepts only `INHOUSE` (`CFG.MASTER_AGENCIES`). Each agency has its own file with the same `Name_Builder` and `How_To_Use`, restricted to its own agency code, created by `setupAgencyFiles`:

| Agency | File |
|---|---|
| BRANDSTROM | [SENA Campaign Names — BRANDSTROM](https://docs.google.com/spreadsheets/d/15Y3gFOxBdX0Hq-jnvwAkkKTTX1ZTQYFYDSuD1i_O-7c/edit) |
| COMBAY | [SENA Campaign Names — COMBAY](https://docs.google.com/spreadsheets/d/1R3_1e9iMUkOnL_XGluU20tP3JVZ-nxO9XtAcQ5GnXjo/edit) |
| MEDIAOPTION | [SENA Campaign Names — MEDIAOPTION](https://docs.google.com/spreadsheets/d/1n038mlnu4sKz44xss7iddRtaQUpHrWMErSldBD3MUBM/edit) |
| KIN | [SENA Campaign Names — KIN](https://docs.google.com/spreadsheets/d/1MLem20X6l-1ZkCy6QIRh2AVbeLM2DUfJ9J_VSFj-YO4/edit) |
| 7DAYSSUCCESS | [SENA Campaign Names — 7DAYSSUCCESS](https://docs.google.com/spreadsheets/d/1v1qM8z2TfKVw42i3SOZz3-stn2QWMm6M6Cc3RBNmGos/edit) |

Names contain the agency code, so separate files cannot issue the same name. The registry's bound script owns every edit trigger, so request IDs stay unique across files and approval locking works identically. Every 30 minutes `syncAll` copies the master `Naming_Options` into each agency file (the master remains the only editable option list) and rebuilds the internal read-only `All_Requests` tab from all files, flagging a Campaign ID or name that appears in more than one file. A new agency is added to `Naming_Options!N` and created by re-running `setupAgencyFiles`; existing files are kept. Files are created unshared: list agency emails in `CFG.AGENCY_EDITORS` and run `shareAgencyFiles`. SENA Idea approvers need edit access to each agency file (`updateApprovers` adds `CFG.APPROVERS`).

One row registers one proposed campaign name. This register does not establish a verified native campaign identity. Keep issued inputs unchanged, use a new row for a different campaign, and retain the launch month for always-on campaigns. Target choices map to exact group/phase or named multi-target packages; users do not type lists of master IDs.

## Deferred full registry design

Date: 24 September 2026; setup updated 25 September 2026. Status: draft pilot implemented in the [SENA Campaign & Media Registry](https://docs.google.com/spreadsheets/d/1NltzExXglQjQqYstaMhhw_-2Zhun8TTB0XSSYFLcstg/edit?gid=1208751702#gid=1208751702). This is a template, not approved campaign records or a production DW integration.

The live draft contains the six functional tabs below plus Start_Here, Examples and Field_Guide. Rows 2–201 are prepared for entry. The reviewed audit snapshot supplies 117 groups and 205 group/member pairs. Lists now contains 25 DRAFT account candidates (14 META, 11 GOOGLE) and 14 DRAFT nonproperty candidates (8 BRAND, 5 BU, 1 CORPORATE). Their activation, account labels/timezones, individual role assignments and role-specific editing protections remain setup work. The original empty tab is retained and hidden.

The user's role response is recorded as **SENA Idea Marketing Manager** for registry ownership/stewardship and budget approval in this draft. BUD admin remains the invoice/card reconciler, coordinated by SENA Idea. Individual Online release and BUD reconciliation assignments remain open; no approval records or permissions were created.

Account candidates use the all-time DW audit snapshot dated 23 September 2026 because local PostgreSQL was unavailable during setup. Brand keys use the 7 September REM brand snapshot; BU/corporate candidates use the controlled parser rules dated 9 September. DRAFT candidates are excluded from active account/entity eligibility formulas. Review details and provenance are retained in `outputs/registry_setup_20260925/SETUP_REVIEW.md` and the candidate CSV/JSON files.

The 25 September post-edit Google export verified exact candidate values and text IDs, empty active-eligibility outputs, all 3,800 formulas and validation rules unchanged, zero cached formula errors, and blank live campaign/target/budget/decision/reconciliation inputs.

The draft also includes fixed naming month/agency/sequence inputs, a proposed-name formula, generated UTM fields, tracking-test evidence, limited entry checks and an exact budget-revision lookup key. These helpers do not replace semantic target review or Decisions. Field_Guide in the Sheet documents the complete implemented field list. Google Sheets import converted whole-number rules to decimal rules; native custom validation was applied to all seven revision columns and verified to reject 1.5. Exact phase lookup and case-mismatch checks were verified in Google Sheets, and temporary inputs were removed.

## 1. Scope and working model

Start in Google Sheets, then migrate the same records into the Digital Hub. API publishing is deferred. Agencies and in-house buyers continue creating campaigns in Ads Manager and return the native campaign IDs to the registry.

Keep business fields and approval evidence now. Detailed audience configuration, pixel settings, bids, asset uploads, access tokens and API payloads stay out of this pilot. Their relevant evidence can remain in a linked media plan or creative brief.

One Campaigns row represents one planned/native advertising campaign in one account on one platform. A shared promotion across Meta and Google has two campaign records. One always-on native campaign keeps its record across months; its budget periods change independently. A copied native campaign needs a new record.

Use Thai-friendly display headings and descriptions, with stable English field keys documented here for import. Required means required by the indicated stage, not that every cell must be filled when someone first drafts a request.

## 2. Workbook tabs

| Tab | Row represents | Main editor |
|---|---|---|
| Campaigns | One paid campaign, showing its current working brief | Requester and assigned buyer; steward controls IDs and released values |
| Targets | One exact advertised target within a campaign brief revision | Requester selects; scope owner/steward verifies |
| Budget_Periods | One campaign budget period and revision | BUD/requester proposes; Idea records approved amounts |
| Decisions | One submission, approval, evidence review or release decision | Authorized decision-maker/steward |
| Reconcile | One campaign budget-period review at a stated data cutoff | Online/data coordinator and BUD admin |
| Lists | Controlled choices and master keys | Steward only |

Most staff work in Campaigns and their relevant target/budget rows. Decisions and Lists support the workflow; marketers do not maintain them. Reconcile is for the later review, not a prerequisite to drafting a campaign. Put ordinary input fields first and group administrative columns to the right.

## 3. Campaigns fields

### Business brief and responsibility

| Field key | Suggested heading | Entry / requirement |
|---|---|---|
| campaign_id | รหัสทะเบียนแคมเปญ | Steward-issued permanent text, e.g. AC000123; required for related records |
| brief_revision | รุ่นของข้อมูลแคมเปญ | Steward-managed integer; required when submitted; increments for a material brief revision |
| campaign_title | ชื่อแคมเปญสำหรับทีมงาน | Requester; readable Thai/English description, separate from the ad-platform name |
| requesting_team | ทีมผู้ขอ / BUD | Requester; controlled team/unit |
| sena_owner | ผู้รับผิดชอบฝั่ง SENA | Requester; one accountable internal owner |
| buyer | ผู้ลงโฆษณา / Agency | Assigned agency or INHOUSE; required before release |
| platform | แพลตฟอร์มโฆษณา | META / GOOGLE / TIKTOK; one per record |
| scope_type | ประเภทเป้าหมาย | A single group / B phase / C joint phases / D multiple groups / E brand / F corporate or BU |
| objective | วัตถุประสงค์ | Controlled business objective: LEADS, TRAFFIC, SALES, AWARENESS, ENGAGEMENT, CONVERSION |
| planned_start_date | วันที่เริ่มที่วางแผน | Full date; actual launch/delivery is a different field |
| planned_end_date | วันที่สิ้นสุดที่วางแผน | Full date for finite campaigns; blank may mean ongoing, but each budget period must have an end |
| destination_type | ช่องทางรับผลลัพธ์ | WEBSITE / INSTANT_FORM / MESSAGES / ENGAGEMENT_ONLY or another reviewed option |
| destination_url | ลิงก์ปลายทาง | Required for website campaigns; do not substitute the Facebook post URL |
| brief_link | ลิงก์ Media Plan / Brief | Supporting document; required before release when needed to establish the approved setup |
| content_reference | ลิงก์โพสต์ / ชิ้นงาน | Optional existing post, artwork or internal content reference; a creative-brief link can cover several assets |
| program | ชุดแคมเปญ / Initiative | Optional, e.g. SepAlwaysOn or StayEasy; not the project target or native identity |
| notes | หมายเหตุ | Optional explanation; no IDs or approved amounts hidden only in notes |

### Buyer and administration fields

| Field key | Suggested heading | Entry / requirement |
|---|---|---|
| source_account_id | บัญชีโฆษณา | Buyer chooses a verified account from Lists; store exact ID as text; required before release |
| tactic | รูปแบบการซื้อสื่อ | Buyer; platform-compatible controlled value, needed for naming |
| audience_type | กลุ่มผู้ชมโดยสรุป | Buyer; summary such as PROSPECTING, RETARGETING, MIXED or an applicable keyword family; detailed settings stay in the media plan |
| naming_version | รุ่นรูปแบบชื่อ | Steward; V1 for supported new pilot names, LEGACY for existing imported names |
| approved_campaign_name | ชื่อโฆษณาที่อนุมัติ | Generated/reviewed and then frozen as a value; buyer copies this into Ads Manager |
| native_campaign_id | Campaign ID จากแพลตฟอร์ม | Buyer enters after native creation, before launch verification; exact text, never rounded |
| observed_campaign_name | ชื่อที่พบในแพลตฟอร์ม | Buyer/imported observation; compared with the approved name, not used to overwrite it |
| first_delivery_date | วันที่เริ่มส่งโฆษณาจริง | Buyer/source evidence; leave unknown if delivery has not been observed |
| platform_record_link | ลิงก์แคมเปญใน Ads Manager | Buyer; convenience link, not an alternative to the native ID |
| brief_status | สถานะข้อมูลแคมเปญ | DRAFT / SUBMITTED / CHANGES_REQUESTED / APPROVED / CANCELLED / CLOSED; steward summary tied to Decisions |

Optional read-only convenience columns may show account name, target summary, current budget approval and release status from their owning tabs. Do not create separately editable copies of those facts. The native key is platform + buying account + native campaign ID; a matching name alone is insufficient.

## 4. Targets fields

Use this tab for every scenario, including a single group. Campaigns can show a read-only target summary, so there is only one authoritative target selection to migrate later.

| Field key | Meaning |
|---|---|
| campaign_id | Permanent parent campaign code |
| brief_revision | Exact revision this selection belongs to |
| target_kind | GROUP / PHASE / BRAND / CORPORATE / BU |
| project_group_id | Exact marketing group ID; required for GROUP and PHASE |
| project_id | Exact REM member/phase ID; required only for PHASE |
| entity_id | Exact registered brand/corporate/BU key for nonproperty scopes; selected from the matching typed list |
| master_version | Steward-supplied source date/version used for validation |

Display names are lookups beside the IDs. Preserve keys exactly, including leading zeroes, punctuation and case. A complete parent-group/member pair must exist in the reviewed master.

For this pilot, BRAND keys use `SENA_PRD.dbo.Sys_Master_Brands.BrandID`; for example COZI is text `36` and Sena Kith is text `000006`. Registry BU maps to DW `BUSINESS_TYPE` in `ADD01_CONTROLLED_BUSINESS_TYPE`, not REM `BUSINESS_BU` UUIDs. Registry CORPORATE uses `CORPORATE_SENA` in `ADD01_CONTENT_SCOPE`; this is advertising scope, not a legal payer or funding owner. Keep SENA Solar BRAND `37` distinct from BU `SOLAR`. Master activation does not implement new brand-slug mappings in the DW parser or approve a campaign.

| Scenario | Valid selection |
|---|---|
| A | One GROUP row |
| B | One PHASE row with its parent group |
| C | Two or more distinct PHASE rows under the same group |
| D | At least two distinct groups, with GROUP rows or explicit PHASE rows per group |
| E | One BRAND row; no property rows |
| F | One CORPORATE or BU row; no property rows |

Do not mix a group-wide row and phase-restricted rows for the same group. Do not place comma-separated IDs or multi-select chips into the authoritative target cells. Do not infer targets from funding, a website's whole brand catalog or creative nicknames.

Example for C:

| campaign_id | brief_revision | target_kind | project_group_id | project_id |
|---|---|---|---|---|
| AC000123 | 1 | PHASE | C-FLEX-STCRN | HYABC |
| AC000123 | 1 | PHASE | C-FLEX-STCRN | HY2DE |

These illustrative codes are not issued production records. This example gives one group the campaign's media spend; it does not establish a phase split.

## 5. Budget_Periods fields

One budget period can have several retained revisions. Select one applicable approved revision; never sum superseded revisions. Each revision states the replacement full amount, not an unexplained increment.

| Field key | Meaning / owner |
|---|---|
| budget_period_id | Steward-issued permanent identifier for a campaign's period |
| budget_revision | Integer revision; earlier rows remain preserved |
| campaign_id / brief_revision | Exact campaign and brief being funded |
| period_start / period_end | Full service dates, not only Aug/Sep text; each period has both |
| currency | Explicit currency, normally THB where applicable |
| requested_amount | Original proposed TOTAL for the whole stated budget period; requester. Daily platform settings remain in the media plan. |
| request_basis | MEDIA_ONLY or GROSS_ALL_IN, so 5,000 does not have an ambiguous meaning |
| approved_media_amount | Idea-approved media-only cap |
| approved_fee_amount | Idea-approved agency fee component, if applicable |
| approved_tax_amount | Approved documented tax component; do not assume one formula fits every arrangement |
| approved_gross_amount | Sum of established components; unknown components remain unknown, not zero |
| funding_owner | Unit/pool bearing the cost; distinct from Idea's approval authority |
| funding_reference | Memo/pool reference; not a project key |
| covered_line_reference | Identifies this campaign's share within a consolidated memo/plan |
| signed_memo_link | Signed memo/version covering the period |
| agency_fee_po_link | Signed prelaunch fee PO/version where applicable |
| approval_decision_id | Links to the applicable Idea decision in Decisions |
| supersedes_revision | Prior budget revision replaced, if any |

A shared memo can fund several campaigns. Enter each campaign's covered amount, not the memo's full cap on every row. For the pilot, the coordinator verifies the total commitments against the linked approved funding schedule. Keep a multiple-source contribution schedule in that evidence when needed; do not invent a single funding source or silently double-count it.

Approval and document-review statuses are summaries from Decisions. A link merely shows that a document exists; the reviewer must verify its purpose, signatures, version, period and amount coverage. The unsigned payment-stage PO is not the signed prelaunch fee PO.

The same campaign can have October and November budget rows while its Campaigns row, native ID and released name stay unchanged. Overlapping periods or ambiguous active revisions require review before a budget comparison is declared valid.

## 6. Decisions fields

Keep this as a small, steward-controlled event log. This prevents an editable Approved cell from being the only evidence of authorization.

| Field key | Meaning |
|---|---|
| decision_id | Permanent reference |
| campaign_id / brief_revision | Exact brief covered |
| budget_period_id / budget_revision | Exact budget covered when applicable |
| decision_type | SUBMISSION / SCOPE_APPROVAL / IDEA_BUDGET_APPROVAL / DOCUMENT_REVIEW / ONLINE_RELEASE / CORRECTION |
| decision | APPROVED / REJECTED / CHANGES_REQUESTED / REVOKED; submission uses SUBMITTED |
| decided_by | Named authorized person, not a generic team name |
| decided_at | Fixed date/time with timezone convention; not NOW() |
| authority_reference | Authorized role/delegation or route reference |
| approved_snapshot_link | Exact values-only brief, Targets and budget revision reviewed |
| evidence_link | Signed evidence or documented decision; additional indexed evidence can be in the snapshot package |
| reason | Decision notes, applicable exceptions and limitations |

Idea makes budget decisions. Authorized scope owners confirm intent. Online reviews required documents and records release. BUD admin's financial reconciliation does not grant budget approval authority.

The pilot can operate manually: the steward saves the exact submitted values as a versioned snapshot, records the decision against it and protects the released cells. Any material change creates a new revision and affected decision. Store snapshots in a location whose editing rights are appropriately restricted. Sheets protection/version history supports this process; it is not a cryptographically immutable approval ledger. Do not backdate approvals for imported legacy campaigns.

## 7. Reconcile fields

Use one review row per campaign budget period and review cutoff; retain a new review version when a closed period is restated. Paid media actuals should come from the DW where its source coverage exists. TikTok or another uncovered source may use an explicit platform export reference until ingestion exists; it must not be labelled a DW actual.

| Field key | Meaning / editor |
|---|---|
| review_id | Stable review reference |
| campaign_id / budget_period_id | Campaign and service period under review |
| reviewed_budget_revision | Applicable approved cap used in the comparison |
| actual_source_link | DW report/run or platform export evidence |
| actual_through_date / data_as_of | Coverage cutoff and extraction time |
| source_completeness | COMPLETE / PARTIAL / UNKNOWN |
| actual_currency | Currency reported by the source; must match the approved media cap or use an explicit reviewed conversion |
| actual_media_spend | Observed media actual at the stated grain/currency; imported or controlled by data coordinator |
| media_budget_variance | Actual minus comparable approved media cap; positive means over cap; do not infer final underspend from an incomplete period |
| identity_target_check | Native binding/name/target result with specific issue where present |
| finance_package_reference | Link to the existing invoice/card reconciliation package; do not copy its entire value into every campaign row |
| bud_reconciler | Named BUD admin reviewer |
| reconciliation_status | PENDING_DATA / IN_REVIEW / EXCEPTION / RECONCILED |
| issue_action | What needs resolving and its assigned owner |
| finance_handoff_status | PENDING / SENT_TO_IDEA / SENT_TO_ACCOUNTING / RETURNED; retain supporting receipt/reference |
| reviewed_at | Fixed timestamp |

Reuse the existing invoice workflow for billing and payment detail. Finance evidence may exist at account/project/month grain; the campaign registry holds its reference instead of inventing campaign-level invoice amounts. Media actuals, invoices and card payments must not be summed as separate media expenses. RECONCILED does not mean PAID.

## 8. Lists and controls

Lists contains reviewed groups and exact group/member pairs; typed brand/BU/corporate entities; eligible ad accounts with platform/currency/timezone; agencies and INHOUSE; teams/owners; objective/tactic/audience/destination choices; and controlled statuses. Keep dictionary source/version and inactive values for historical references.

Use ordinary dropdowns from ranges and reject invalid values for controlled fields. [Google dropdown guidance](https://support.google.com/docs/answer/186103?hl=en). Independent group/member lists plus a pair-membership check are enough; dependent-dropdown scripting is optional.

Minimum review checks:

- Permanent code unique; native platform/account/campaign key unique when present.
- Exact scenario cardinality and parent/member validity; an unknown phase must not pass because its group is valid.
- Currency, amount basis and dates present; no ambiguous approved budget revision.
- Required owner, account, name, target approval, Idea budget decision and applicable release evidence complete before manual launch.
- Returned native name/key agree with the released brief; current DW name parsing and registry validation remain separate checks.

Keep IDs as plain text, amounts numeric, and full dates as dates. Show Gregorian years explicitly; do not store only Aug, a Buddhist-year suffix or a formatted budget string. Set a documented business timezone and retain account-reporting timezone for actuals comparisons.

A single steward issues fixed campaign IDs and naming sequences. Never use row position, ROW(), NOW() or concurrent MAX()+1 formulas as identity. Do not create separate campaign tabs by month, merged data cells, Project1/Project2 columns or colour-only statuses. Comments and edit history are not substitutes for structured decisions.

Keep the central workbook internal when agency records or budgets must be isolated. Protected ranges restrict edits, not visibility, and hidden tabs are accessible. Share scoped agency handoff files containing only their records, or collect their updates through an appropriate intake process. [Google's protection guidance](https://support.google.com/docs/answer/1218656?hl=en).

## 9. Naming, organic content and Hub migration

Use supported V1 naming during this pilot, with the permanent AC code in its own column. Import historical names as LEGACY without bulk renaming. Freeze the approved name after issue; its month means original launch month, not the current budget month. The steward retains the V1 sequence/reservation and original naming inputs with the approved snapshot.

The proposed V2 requires a registry-aware resolver and is not enabled merely by adding a Sheet. Complete group/member targets can be registered now for D/E/F while displaying existing DW limitations honestly. Registering a campaign does not itself change production allocation.

For organic work, keep the existing internal content file where it is already useful. Add a permanent publication reference, exact platform/account, planned date, actual native post ID/URL and publication status when that workflow is brought into the pilot. Agency content can come through a brief link without being forced into the internal editorial file. Organic publication records and media-spend campaigns remain separate; an organic post may later be used by several paid campaigns. No API publishing or token columns are needed now.

For migration, preserve campaign IDs, atomic target rows, budget periods/revisions, decision references, native IDs and source links. Map the documented field keys into Hub tables. Import into staging, validate uniqueness/membership/references and reconcile row counts and budget totals before cutover. Preserve prior snapshots, then make the old Sheet read-only once the Hub becomes the owner; avoid two independently editable registries.

Recommended sequence: agree the visible business fields → build the Sheet with reviewed Lists → pilot ordinary project, phase, shared and nonproject cases → refine the workflow → integrate approved snapshots with the DW → migrate into the Hub. API publishing remains a later, separate decision.
