# 47 — Unified content workspace, governance and Hub shell

Status: owner decisions recorded 4 November 2026. Approved for local
implementation under the programme in section 10. Progress is logged in
`docs/48-unified-workspace-log.md`.

This document supersedes, where they conflict:

- docs/03 navigation and authoring flows (Flow A–F and the screen inventory);
- docs/41 owner decision D3 at the approval step, the Phase 8 condition that a
  publisher needs approval on every source tab, the §3.8 navigation item
  "คลัง FAQ เว็บไซต์" and the §3.11 split of content screens by permission tab;
- docs/36 "per-project/brand scoping remains deferred" (now scheduled as BUD
  scoping, section 7);
- docs/30 §7.4 as a Marketing work screen (the review screen stays as Admin
  evidence, section 4.6).

All other rules in REQUIREMENTS.md and docs/30, 36, 41 and 46 still apply,
including the safety rules in docs/41 §1, hosted rollout rules in docs/46 and
the permission card in docs/36.

## 1. Problem and objective

Objective (REQUIREMENTS.md): the Hub is the single source of approved brand,
project, unit-type, media, FAQ, document and promotion content used by the
websites and by AI.

Measurable outcomes:

1. Every project page on the website has every required item.
2. Every number an AI answer gives comes from approved, dated content.
3. No expired content remains visible on the website.
4. Every change can be traced to a person, a time and a reason.

User jobs:

| Who | Job |
|---|---|
| MKT | Make the projects I own complete and correct |
| Manager | Review, or edit and approve immediately without waiting |
| Online Marketing | Put approved content on the website and withdraw it when needed |
| Everyone | See what is missing, expiring or waiting for me |

Today one project is spread over at least five screens (project editor,
`/content`, `/media`, `/faq`, `/knowledge`) plus two publishing screens
(`/releases` and `/faq?tab=publication`). The FAQ editor asks the user to pick
an answer level from a dropdown, and legacy website data is a separate intake
flow. These splits come from how the system was built (phase by phase, menus
following permission tabs, a one-off intake tool), not from what users need.

Principle: **keep the data model separate, unify the screens.** Each level
(group, business, brand, project) gets one page with the same tabs. FAQ, media
and facts are tabs of that page, not separate products.

## 2. Owner decisions, 4 November 2026 (verbatim intent)

| Code | Decision |
|---|---|
| N1 | A Manager may edit and approve the same version. The owner changed the requirement because two-person approval is not practical for a small team. Approving one's own edit requires a reason and is flagged in history. Promotions keep their existing DATA + LEGAL review and edit/approve separation. Web publication still needs a different person (N2). |
| N2 | Online Marketing publishes to the website. The publisher needs View on the source content plus the special «เผยแพร่ขึ้นเว็บ», not Approve on every source tab. Only Manager-approved versions can be published. A person who edited, reviewed the English of, or self-approved a version cannot publish that version (D3 is kept at the publish step). The publisher can return single items with a reason. |
| N3 | Add a «ธุรกิจ» (business) level between group and brand as a fixed list maintained only by migration. Initial member: «ที่อยู่อาศัย» (residential). LivNex and RentNex stay programmes attached to selected projects, not a level. |
| N4 | Permission scope follows **BUD**, not brand, with per-project exceptions. One BUD covers several projects and brands; one brand can span several BUDs. BUD membership is dynamic (changes quarterly or on staff reassignment). |
| N5 | AI writing aid for marketing text in Thai and English: draft, spelling and grammar check, make concise. Excludes legal documents, disclosures, sales terms, prices, finance, investor figures and customer data. Output is shown as a diff and the user accepts or rejects it. A monthly budget applies. |
| N6 | One publishing queue. Merge «ชุดเผยแพร่ข้อมูล» (`/releases`) and «เผยแพร่เว็บไซต์» (`/faq?tab=publication`) into one menu «เผยแพร่» for Online Marketing, keeping both histories. |
| N7 | Remove «ตรวจข้อมูลก่อนนำเข้า» (`/knowledge`) from Marketing navigation. Keep it for Admin as evidence. Legacy website data appears as «ข้อเสนอจากเว็บเดิม» inside the normal editing sections. |

Additional owner instructions, same date:

| Code | Instruction |
|---|---|
| O1 | The sidebar is a service shell. This content product is one service with a dropdown of sub-menus. More services will follow (for example an analytics tools hub and a Marketing back office). Ads and finance become another service. |
| O2 | Replace the current text wordmark with the SENA Development logo and derive the theme from it. |
| O3 | Redesign sidebar collapse and expand. |
| O4 | Fix the overflowing text at the bottom left of the sidebar. |
| O5 | The Hub assistant leaves the sidebar menu. It becomes a chat reachable from the top search bar and a floating button, with a greeting such as «วันนี้ให้ช่วยอะไรดี». |
| O6 | FAQ per project needs project search. Resolved by the global search and entity pages. |
| O7 | Every edit and publication must be logged (already true in the database; section 8.4 adds the screens). |
| O8 | Website images must be reviewable as starting images with their source project and page, and taggable. The queue exists; section 4.5 moves it into the entity page. |

## 3. Target navigation

### 3.1 Service shell (O1)

The sidebar lists services. Each service expands to its sub-menu. A service is
hidden when the account has no permission for any of its items. Do not show
placeholder entries for services that do not exist yet; the navigation data
must make adding a service a data change (service → groups → items), not a
layout change. This is navigation only, not a tenant or workspace framework
(REQUIREMENTS.md §1 still forbids that).

| Service (Thai label) | Items |
|---|---|
| «ข้อมูลเว็บไซต์และ AI» | «หน้าแรก», «ข้อมูลเว็บไซต์», «โปรโมชั่น», «บทความ», «เผยแพร่», «ตั้งค่า» |
| «งานโฆษณาและงบ» | Existing ads items unchanged |
| Other (no service) | «คำถามที่รอคำตอบ», «ผู้ใช้และสิทธิ์» at the bottom |

«ตั้งค่า» holds «คำถามมาตรฐาน», «คำแปลมาตรฐาน», «ทะเบียนฟิลด์», «แท็กรูป» and
«กติการูปที่ต้องมี», each with its existing permission. Admin also sees
«หลักฐานนำเข้าเดิม» (the old `/knowledge` screen) here.

### 3.2 Old screen to new place

| Today | New place |
|---|---|
| «โครงการที่อยู่อาศัย» list and project editor | «ข้อมูลเว็บไซต์» tree and the project page tabs «ข้อมูล», «แบบห้อง» |
| `/content` «เนื้อหาเว็บไซต์โครงการ» | Project page «ภาพรวม» and «ข้อมูล» |
| `/media` including «รูปจากเว็บไซต์ (รอยืนยัน)» | Project page «รูปและวิดีโอ» |
| `/faq` «คำตอบ FAQ», «ความครบ» | «FAQ» tab of each level; coverage summary on «หน้าแรก» |
| `/faq` «คัดจากของเดิม», `/knowledge` | «ข้อเสนอจากเว็บเดิม» inside each section and FAQ tab; `/knowledge` Admin only |
| `/faq` «คำถามมาตรฐาน», «คำแปลมาตรฐาน», `/content/fields` | «ตั้งค่า» |
| `/faq` «ติดต่อองค์กร» | Group page «ข้อมูล» |
| «แบรนด์ที่อยู่อาศัย», «กลุ่มโครงการ» | «ข้อมูลเว็บไซต์» tree (brand pages; a group is a project page with several phases) |
| `/releases`, `/faq?tab=publication` | «เผยแพร่» |
| `/promotions` | Contextual Promotions tab on project and brand pages (section 4.7); standalone menu remains for cross-project campaigns, DATA and LEGAL queues and expiring-soon work |
| «ผู้ช่วย Hub» sidebar item | Top search bar and floating button |

Old URLs keep working by redirecting to the new place with the same context
(project, tab, item) for at least one release.

## 4. Entity pages

### 4.1 Levels

| Level | Thai | Page subject |
|---|---|---|
| 1 | «เครือ» | SENA group (current scope `corporate`) |
| 2 | «ธุรกิจ» | Fixed business list (N3), initially «ที่อยู่อาศัย» |
| 3 | «แบรนด์» | Hub brand |
| 4 | «โครงการ» | The project as shown on the website. It contains one or more REM phases (E8 in docs/41) and the Marketing unit types |

Programmes (LivNex, RentNex) have their own pages reachable from «ข้อมูลเว็บไซต์»
but are not a level in the tree; their content attaches to selected projects.

Facts stay stored per REM phase (E8). On a multi-phase project page, phase
specific sections show a phase selector and show per-phase values when they
differ. Unknown project/phase grouping is never guessed: a phase without a
confirmed grouping has its own project page.

### 4.2 Tabs (same order on every level; a tab is hidden when it does not apply)

| Tab | Content |
|---|---|
| «ภาพรวม» | Readiness (required and recommended), open tasks, changes since the last publication, link «ดูตัวอย่างหน้าเว็บ» |
| «ข้อมูล» | Sections for the level: narrative and selling points, facts, buildings, location and places, facilities, features, contacts, legal and sales records, investor section, brand story and logo, corporate contacts |
| «แบบห้อง» | Project only: the existing six-step unit-type wizard and prices |
| «โปรโมชั่น» | Project and brand only: applicable promotions, source, scope and legacy suggestions (section 4.7); after Unit types on project and after Data on brand; hidden without Promotions View |
| «รูปและวิดีโอ» | Media grid, filters, tagging panel, clips and tours, website images awaiting confirmation |
| «FAQ» | Questions for this level and inherited answers (section 4.4) |
| «ประวัติ» | Timeline of edits, submissions, approvals, returns, publications and withdrawals (section 8.4) |

Every section shows its state chip («ร่าง», «รออนุมัติ», «อนุมัติแล้ว»,
«บนเว็บ», «ถูกส่งกลับ»), any «ข้อเสนอจากเว็บเดิม» chip, and its own
«ส่งอนุมัติ» button. The page header has «ส่งอนุมัติทั้งหมดที่แก้». A Manager
also sees «แก้และอนุมัติ» (N1).

### 4.3 Readiness deep links

Every missing or expiring item on «ภาพรวม», «หน้าแรก» and the FAQ coverage opens
the exact field, question or media slot with its context selected (project,
phase, question key, unit type, facility). No item may lead to a generic list.

Owner review W3.1 (5 November 2026, received 6 November): the overview is a
summary. Group required/recommended gap counts by tab and section; show at
most five contextual exact-field links per expanded group, with view-all
expanding in place. Every repeated item names its visible owning item (selling
point, unit type or building). Keep the latest five changes plus a History link;
explain version numbers and omit meaningless internal counters. Target about
two desktop screens at 1280 px for many gaps, readable at 390 px without
horizontal scroll. Preserve exact-field navigation and existing test intent;
add a many-gap page-height regression and light/dark screenshots at both widths
under artifacts/unified-workspace/w3.1/.

### 4.4 FAQ tab

- The answer level is the page the user is on. Remove the level dropdown from
  the authoring form. Applicability rules (D1) remain for levels above project.
- The tab lists every approved standard question that applies, with its state:
  own answer, inherited answer (chip naming the source level, for example
  «จากแบรนด์ FLEXI»), missing, waiting for a fact, legacy suggestion, handoff,
  not applicable. Missing core questions are listed first.
- On a project page, an inherited answer offers «เขียนเฉพาะโครงการนี้» (creates a
  project-level answer that wins by the existing most-specific rule) and
  «แก้ที่ต้นทาง» (opens the source level, showing how many projects are affected).
- Fact slots show the current value next to the slot. An empty fact links to
  the fact field.
- Search on the tab filters questions and answers; the global search finds the
  project itself.

### 4.5 Legacy website data as suggestions (N7)

- Website evidence and draft suggestions already exist per project
  («หลักฐานจากเว็บไซต์» tab, migration 78). Show them inline in the matching
  section as «ข้อเสนอจากเว็บเดิม» with «ใช้», «แก้แล้วใช้», «ไม่ใช้» and a link to
  the source page. Numbers and prices stay evidence: the user must type the
  confirmed value.
- FAQ clusters (`staging.faq_clusters`) appear as suggestions in the FAQ tab of
  the suggested level and project, using the existing intake decision commands
  so every decision stays in `hub.faq_intake_decisions`.
- In `/knowledge`, FAQ candidates can no longer be accepted (the accept path
  currently creates project FAQ drafts without a question key:
  `202610060034_knowledge_review.sql` line 167). Show them read-only with a link
  to their cluster.
- Website images: the existing queue «รูปจากเว็บไซต์ (รอยืนยัน)» moves into
  «รูปและวิดีโอ» as the filter «จากเว็บเดิม รอยืนยัน». Keep the thumbnail, the
  source page link «ดูหน้าอ้างอิง», page position, fetch time, AI suggestion shown
  apart from confirmed values, batch confirmation of at most 40 and per-asset
  audit. Rights approval stays separate.

#### Owner decision 5 Nov 2026

The owner authorizes this change. When a user accepts a website suggestion ("use" or "edit then use"), the resulting draft takes the field registry's default_ai_exposure for that field instead of internal.
- Never broader than the registry default. A field whose default is internal stays internal.
- The draft still needs Manager approval and an Online Marketing publication before anything reaches the website or AI. No other workflow changes.
- Do not bulk-rewrite existing drafts, versions or imported rows in a migration. Drafts created earlier keep their stored exposure until a user saves them through the suggestion flow or an ordinary edit.
- Show the exposure on every section and item as a small chip. When an item marked internal is submitted, approved or added to a publication, show a clear non-blocking notice that it will not appear on the website or in AI answers, with a link to change it.
- Record the decision verbatim in docs/47 section 4.5 ("Owner decision 5 Nov 2026") and add the exposure rule to the docs/36 permission card for W3.1. Tests: default applied per field, internal stays internal, no broadening, notice shown, existing rows unchanged.

### 4.6 Home «หน้าแรก»

- Greeting and the search box (section 8.2).
- «งานของฉัน»: returned to me, waiting for my approval (Manager), waiting to
  publish (Online), expiring soon, facts missing that hide answers, review due,
  questions the AI could not answer. Each opens the exact field.
- Readiness by BUD and by brand, filtered to the account's scope.

### 4.7 Promotions in context — owner decision, 5 November 2026 (W3.2)

W3.2 follows the W3.1 commit. Its design and permission card precede code; it
gets its own full gate, explicit-path commit and push. W6 implements the BUD
rules below. The standalone Promotions menu remains available for cross-project
campaigns, the DATA and LEGAL review queues and the expiring-soon list.

Verified baseline: migration `202610220070_real_promotions.sql` extends the
existing required primary `project_id` with at most 100 project, brand or
commercial-type targets. `hub.promotion_target_projects` resolves the primary
project plus targets; publication freezes `target_project_ids`. The create DTO
still requires `project_id`. There is no owning brand without a primary project
and no excluded-target model. Existing promotions and published payloads retain
their exact interpretation and history.

The smallest planned extension adds an optional owning brand and explicit
excluded project targets, and permits a null primary project only for a new
brand-owned promotion. A constraint requires exactly one primary project or
owning brand. Existing rows keep their primary project, targets and null owning
brand; no backfill, fake primary project or content/version rewrite is allowed.
Project-owned creation uses the existing primary project. Brand-owned creation
resolves the brand's projects and displays them before submission. Business and
group ownership are outside this slice, so those pages receive no Promotions
tab. If the implementation cannot retain these additive semantics, stop and
report before changing the model.

- The project tab includes every promotion whose resolved scope includes the
  project, with active, DATA/LEGAL in-review, draft and expired groups. Show
  title, source (this project, originating brand, or shared project count),
  start/end, booking/transfer windows, banner thumbnail and rights state, and
  audience. Retain explicit published versus draft status: an unpublished scope
  edit must not make the existing published promotion disappear. Include a row
  when either its current resolved draft or frozen published scope applies,
  distinguishing those scopes rather than mislabelling draft applicability as
  live. Scheduled and withdrawn states remain visible with their exact status.
- Reuse the existing promotion editor and validation. Context pre-fills the
  owning project or brand. Shared editing shows the affected-project count and
  source. Scope resolution is authoritative on the server and rechecked during
  submission, DATA/LEGAL review and publication; changed resolution requires
  review of the new version. Publication freezes the resolved list minus
  exclusions; old versions continue reading their frozen lists.
- On a project page, the exclusion action opens the source editor with this
  project pre-selected for exclusion. Saving creates a new draft revision and
  invalidates its prior review; normal DATA and LEGAL review is required.
  Neither opening nor saving changes the published website. Exclusions are
  explicit project IDs, validated and deduplicated, never inferred.
- Website import evidence and quarantined KM promotion candidates appear as
  legacy suggestions with source-page link, capture date and their existing
  likely-expired, undated and not-a-promotion flags. Creating from a suggestion
  copies only title, benefit/summary and conditions text into the same editor.
  Dates, money, prices, quantities and validity fields start empty and require
  human entry. OCR numbers are never parsed into structured fields. Keep the
  original evidence and normal audit provenance; no automatic approval,
  publication or candidate acceptance bypass.
- Overview counts link to the exact promotion/filter for promotions ending
  within seven days, active promotions lacking a rights-approved banner, and
  starting prices referring to expired or withdrawn promotions. Use the same
  server clock and publication eligibility as the public promotion feed;
  project-price details require Projects View.
- Promotions keep E/A separation, independent DATA and LEGAL evidence, revision
  checks and contributor exclusions. N1 does not apply. Online Marketing
  publishes through the single N2/N6 queue. Promotion FAQ answers still read
  only approved, in-date promotions.
- W6: drafting requires at least one resolved project in the actor's scope;
  DATA review, LEGAL review and approval require every resolved project, or
  unrestricted scope. Legal reviewers normally receive unrestricted scope
  through ordinary account administration; this slice grants nothing. Apply
  object checks to lists, counts, details, references, suggestions, banners,
  history, preview, queue, exports and assistant retrieval, including revoked
  access and runtime deny/positive-neighbour cases.

Permission card (docs/36), lead-owned; intended users are content editors,
DATA/LEGAL reviewers and Online Marketing:

| Field | W3.2 decision |
|---|---|
| Tab | Existing `promotions`; contextual UI adds no catalog checkbox |
| View (V) | Promotions V for lists/detail, scope/source chips, preview/history, suggestions and banner summaries; project/brand page additionally needs its own source V; denied tabs emit no private payload or counts |
| Edit (E) | Promotions E creates/edits drafts, exclusions and suggestion-derived text; Projects E also required for banner upload/binding/metadata commands on the actual project; existing rights-review permission remains separate |
| Approve (A) | Promotions A for existing DATA/LEGAL review and approval commands, with existing lane identity and author separation; existing publication/withdrawal specials remain required |
| Special actions | Reuse existing publish/withdraw/rights specials only; N2 requires source V, current APPROVED versions and independent publisher |
| Separation | Promotions E/A remain mutually exclusive; exact revision editors and English reviewers cannot publish; DATA and LEGAL evidence retained |
| Templates | No new default, template, account or grant changes |
| Agency | Existing fixed external boundary; no access to internal contextual management or evidence |
| Sensitivity | Internal drafts/import evidence; public only through existing eligible frozen snapshots; audit.change_log and existing review/version history, no second log |
| Other tabs | Projects/Brands V for corresponding source names, scope resolution and entity page; Knowledge V for quarantined KM evidence; Projects V/E and binding authorization for banner access/writes; hidden source permits no new private reference exception |
| Shared surfaces | Scope-aware assistant/citations/history, RAG, exports, asset bytes, workers and caches; existing public feed eligibility and FAQ promotion resolution preserved |
| Endpoints / SQL | Extend existing GET /v1/admin/promotions, /references, /{promotion_id}; POST /promotions; PATCH /{promotion_id}; POST /{promotion_id}/review; existing publication queue/withdrawal paths. Add bounded GET /v1/admin/content/workspace/{kind}/{ref}/promotions and /promotions/suggestions and POST /v1/admin/promotions/resolve, registered exactly before runtime. SQL: public_promotions additive columns/constraints; promotion_target_projects, promotion_read, promotion_references, promotion_payload, promotion_command, promotion_readiness, promotion_banners, publication_promotion_check, public_api.promotions and public_api.read_promotions; preserve FORCE RLS publication_owner, publication_app_read and restrictive publication_permission policies; inventory every affected private helper/dispatcher before code review |
| Rollout / verification | Local only; fresh replay plus before/after existing rows and versions byte-equivalence; scope resolve/exclusion reviewed revision; no live change before publication; suggestion structured fields empty; default deny, revoked access and allowed neighbours; overview counts; tab hidden without V; four screenshots at 1280/390 in light/dark under artifacts/unified-workspace/w3.2/; complete programme full gate before commit |

Exact helper names, route signatures and migration number are frozen in the
W3.2 implementation lease before code. Any additional entry point must first
extend this card and the permission inventories. Migration allocation stays
with the lead and must follow committed dependencies without renumbering a
committed migration.

Implementation refinement, 6 November 2026: migration 0087 keeps the existing
globally unique promotion code. Add nullable owning_brand_id, bounded explicit
excluded_project_ids, and nullable resolved_project_ids on review evidence.
Existing reviews retain their stored interpretation and existing published
payloads are not rewritten. New approvals capture the resolved projects and
check the resolution hash shown to the reviewer; a later membership change
requires new DATA/LEGAL evidence before a new publication. Already published
versions continue using their frozen scope. Revoking an old review retains its
existing command and does not require the current draft's resolution hash.

The contextual tab opens the existing standalone editor through ordinary links.
Only source identities travel in suggestion links; the editor reads the bounded
suggestion projection again. This projection exposes only promotion text and
source-page/capture/flag evidence under Promotions V plus the page source V,
and Knowledge V for KM text. It does not expose raw candidate files, filesystem
locations or general intake evidence; those existing Admin-only routes remain
closed to other accounts. The verified older KM promotion evidence has no capture
timestamp, so show unknown rather than its import, OCR validity or review date.
Creating from a suggestion records its validated identity in the ordinary audit
reason. No candidate acceptance or new logging table is introduced.

## 5. Lifecycle and governance (N1, N2, N6)

States for every content kind that reaches the website:

`DRAFT` → «ส่งอนุมัติ» → `IN_REVIEW` (frozen) → Manager «อนุมัติ» → `APPROVED`
→ Online «เผยแพร่ขึ้นเว็บ» → `PUBLISHED` (inside a page or release snapshot).

- Manager «ส่งกลับ» or Online «ส่งกลับ» with a reason sets the version to
  `RETURNED`; the author edits a new draft. Returning one item never blocks the
  other items of a batch.
- Manager «แก้และอนุมัติ» saves a new version and approves it in one
  transaction. The reason is required and history shows «อนุมัติงานที่แก้เอง».
- Editing after approval or publication creates a new draft. The website keeps
  the published version until the new one is approved and published.
- Add per-item approval to content kinds that currently go from submission to
  publication without a Manager step (FAQ versions, content sections, selling
  points, contacts, media links and any other kind found in the inventory).
  Kinds that already have Manager review (unit types, prices, commercial
  records, articles, question bank, glossary) keep it with N1 applied.
- Add «ถอนคำตอบนี้» for a FAQ in `DRAFT`, `IN_REVIEW` or `APPROVED`, keeping
  history (R4 in the 3 November review).
- Publishing (N2): the publisher needs View on every source tab in the batch
  plus the special. Publication checks, in the same transaction, that every
  included version is `APPROVED` and unchanged, that the publisher is not an
  editor, English reviewer or self-approver of any included version, and that
  rights and validity still hold. A stale item rejects only itself; the
  publisher can publish the remaining approved items.
- Permission catalog: set `separate_edit_approve = false` for `projects` and
  `brands` (N1). Keep it `true` for `promotions`. `releases` is replaced by the
  single publishing queue; keep its history readable.
- Every public change involves at least two people: the approver (or the
  self-approving Manager) and a different publisher.
- Single queue «เผยแพร่» (N6) lists approved items grouped by website page and
  by legacy release target (brand, project with models, promotion). Both
  publication systems keep their snapshots, history, withdrawal and rollback.
  Do not rewrite existing release or web-page versions.

## 6. Levels data (N3)

- Add a fixed business list (`code`, `label {th,en}`) seeded with `residential`
  / «ที่อยู่อาศัย» and assign every current residential brand to it. No UI or API
  can create or rename businesses.
- Add `business` to content and FAQ scope types. Composition order becomes:
  unit type > project > project group > programme > brand > business >
  corporate. Existing answers keep their scope; nothing is rescoped
  automatically.
- REQUIREMENTS.md CONT-43 is amended accordingly (fixed list, not a registry).

## 7. BUD scoping (N4)

### 7.1 Source, refresh and grace for BUD membership

Owner decision of 4 November 2026, latest reply, supersedes the earlier W6
freshness wording. BUD is the exact REM BU joined through the project's BUID.
Use rem_bu_id as key and show exact rem_bu_code and rem_bu_name. No mapping,
prefix stripping, parent rollup or business-sheet assignment. The Hub never
connects to live REM or modifies the DW repository.

The DW delivered serving.hub_project_bu in commit 3b425c0. Its read-only contract
is DIM_PROJECT_DATA_CONTRACT.md, "Daily Hub project-to-BUD access (2026-11-04)".
Read exactly project_id, rem_bu_id, rem_bu_code, rem_bu_name, rem_bu_is_active,
rem_bu_is_deleted, source_snapshot_at and project_status_code in one read-only
transaction with sslmode=verify-full. Keep exact text identifiers, leading zeros,
nullable flags and label whitespace/case. Flags and project status do not add
new access eligibility rules. NULL rem_bu_id means no BUD; infer no assignment.

Refresh daily after the DW 16:00 Bangkok project-dimension relay completes.
The relay skipped 29 October, 31 October and 1 November; successful daily source
publication is not guaranteed. The source timestamp is the older project/BU
capture watermark. Fetch or retry time never substitutes for source evidence.

Accept a full new snapshot only if it is nonempty, project_id is unique and
nonnull, and every source_snapshot_at is nonnull, not in the future and no more
than 48 hours old. Reject the whole refresh otherwise and keep the last good
membership. The 48-hour threshold admits data; it never itself removes access.
Keep acceptance serialized and reject stale in-flight completions. Exact replay
does not create new membership or refresh its deadline.

Store membership in its own tables, never staging.dw_projects or any other
staging relation used by approval snapshots. Retain dated membership intervals
with valid_from, valid_to, source timestamp and run references, alongside the
accepted full snapshot. Use existing audit.change_log and permission history.
BU membership changes never invalidate content approval or rewrite content,
versions, reviews, publication history, accounts, grants or templates.

One admin-only grace setting defaults to seven days and cannot exceed the DW
contract's seven-day retention ceiling. All grace intervals use elapsed 24-hour
days. Authorization uses last-good membership until that interval from the
oldest accepted source_snapshot_at. At expiry, only BUD-based grants stop
applying; unrestricted and explicit per-project grants continue, including for
projects with no BUD. A fresh accepted snapshot can restore BUD-based access.

When acceptance moves a project from BUD A to BUD B, B grants apply immediately
and A grants keep applying to that project for the grace interval from acceptance,
then end. Show a project-page banner with the handover end date. Each move has
its own deadline; later refreshes cannot extend an earlier handover. The stale
membership deadline also bounds any BUD-derived handover access. NULL/missing
assignments never manufacture a destination BUD or a new handover.

Alerts use the existing notification mechanism, or an in-app banner plus a home
task item when none exists:

- Failed or stale runs: account managers.
- Day five of stale data: account managers and every user whose access depends
  on BUD membership, with the actual date BUD access will stop.
- Day seven: the same recipients; account managers also get a link to add
  temporary per-project grants through the existing preview/confirm workflow.
- A BUD move: account managers and affected users of both A and B, with the
  handover end date. Do not disclose another account's grants to ordinary users.

With a shorter configured grace interval, warn two days before its actual end
(or immediately when the interval is at most two days). Every effective access
change, including clock-driven expiry and restoration, is recorded through the
existing history. Read projections do not create a second logging mechanism.

Local tests use fixtures and a fake clock, including the staged 5 October 2026
package. This checkout makes no connection to the DW. Build and exercise the
fixture capture/accept/reject/persist/maintenance path locally; document the
disabled future schedule and verified-TLS read adapter. Hosted TEST activation
requires the owner's dedicated credential and separate rollout authorization.

### 7.2 Scope model

- Each content grant level (View, Edit, Approve) has a scope: «ทุกโครงการ»,
  selected BUDs, or selected projects. Selecting a BUD includes projects that
  join it later. Selected projects are exceptions added on top of BUDs.
- Existing accounts keep unrestricted scope. No existing account, template or
  grant changes silently; new scopes are set only through the existing
  preview-and-confirm account workflow (docs/36).
- Online Marketing publishers normally hold unrestricted View.
- Shared levels (group, business, brand, programme): anyone with Edit whose
  scope contains at least one affected project may draft; approval requires an
  approver whose scope contains every currently affected project, or an
  unrestricted approver. Confirm this rule with the owner as a pending
  question; implement it as the default meanwhile.
- Checks are object-aware in every guarded SQL function, RLS policy, API
  route, cached projection, search, coverage, home task list, publication
  batch, assistant tool, export and preview. A new checkbox alone is not
  enough (docs/36).

### 7.3 Account screen

Under «ผู้ใช้และสิทธิ์», each content grant shows «ขอบเขต» with «ทุกโครงการ» or
«เลือกเอง». «เลือกเอง» shows a searchable tree: BUD → projects, with BUD-level
ticks (including future members) and project ticks. The preview lists the
projects gained and lost before confirmation.

## 8. Shell, brand, assistant, AI aid and logs

### 8.1 Logo and theme (O2, O3, O4)

- Files: `apps/admin/public/brand/sena-development-logo.png` (full logo,
  1001×645, transparent background behind the grey «DEVELOPMENT» line) and
  `apps/admin/public/brand/sena-development-mark.png` (top block only,
  1001×506) for the collapsed rail and small spaces. Register a pending
  question asking the owner for the official vector logo and brand colour codes;
  swap the files when received.
- Logo colours sampled from the file: teal `#1FB3A3`, aqua `#88D0C8`, grey
  `#77787B`, white `#FFFFFF`. Build the palette from them. Teal on white is
  about 2.6:1 and the logo grey about 4.5:1, so text, primary buttons and focus
  rings need darker shades. Every text pair must reach 4.5:1 and every
  non-text UI pair 3:1 in light and dark themes; update the measured pairs in
  docs/22 §1.3 and keep the existing contrast checks.
- The full logo must sit on a light surface because its grey line has no
  background. Use a light sidebar, or a light logo plate on a darker sidebar.
- The logo links to «หน้าแรก». A separate toggle button beside the logo
  collapses and expands the sidebar. In the collapsed rail show the mark; the
  expand button appears beside it on hover and keyboard focus. Keep the current
  mobile drawer, keyboard focus order, `prefers-reduced-motion` and the saved
  collapsed state.
- Sidebar labels stay on one line with an ellipsis and a tooltip showing the
  full text. The overflowing bottom-left text is most likely the disabled
  assistant item, whose label is «ผู้ช่วย: » plus `h1Unavailable`
  (`apps/admin/lib/hosted-config.ts`); it leaves the sidebar under O5. Verify at
  1280 px, 1024 px and 390 px in hosted and local modes.

### 8.2 Search and assistant (O5, O6)

- A top-bar search: typing shows matching projects, brands, BUDs and FAQ
  questions within the account's scope. The last row is «ถามผู้ช่วย: <ข้อความ>».
- A floating «ถามผู้ช่วย» button on every page opens the existing assistant
  panel with the current page's entity as context.
- Home shows «วันนี้ให้ช่วยอะไรดี» with example questions from the user's tasks.
- The assistant keeps its existing boundaries (staff only, caller permissions,
  agencies excluded). Where the assistant is disabled (hosted H1), search still
  works and the assistant entry shows a short disabled state without
  overflowing.

### 8.3 AI writing aid (N5)

- Buttons beside eligible text fields: «ร่างจากข้อมูล», «ตรวจคำและไวยากรณ์»,
  «ปรับให้กระชับ», for Thai and English.
- Eligibility comes from the field registry (new flag, default off). Never
  eligible: legal documents and disclosures, sales terms, prices, promotion
  conditions, finance and investor figures, contacts and customer data.
- Server-side calls only, through the existing provider configuration and
  budget mechanism. Protect numbers and placeholders as the translation worker
  does. The result is shown as a diff; nothing is saved until the user accepts,
  and acceptance is an ordinary draft save. AI never submits, approves or
  publishes. Record model, time and token use. No automatic retry of an
  ambiguous call.
- A monthly budget with the exact budget-exceeded message. Tests use a stub
  provider. Live calls need the owner's budget approval and existing
  credentials; if either is missing, stop before any live call.

### 8.4 History and activity log (O7)

- `audit.change_log` already records actor, time, table, operation and the row
  before and after for audited tables; versions are immutable. Add read
  projections, not new logging.
- «ประวัติ» tab: date and time, person, action (edit, submit, approve,
  self-approve, return, publish, withdraw, roll back), the section changed and
  the reason, with a before/after view. FAQ history currently omits author and
  approver names; add them.
- Admin «บันทึกการใช้งาน»: filter by person, BUD, project and date range.
  Account and permission data never enters content views, exports, the
  assistant or AI calls.

### 8.5 Shared interface copy

Implementation copy for the screens above. Copy these UTF-8 strings into the
interface; this catalogue adds no permission or workflow behavior. Existing
editors retain their existing copy unless a label above supersedes it.

| Key | Thai label |
| --- | --- |
| assistant_context_choose | เลือกบริบท |
| local_testing | พื้นที่ทดสอบในเครื่อง |
| local_testing_note |  · แยกป้ายข้อมูลจำลองและสำเนา REM · ยังไม่เชื่อม DW สด |
| local_persona_discard | มีข้อมูลร่างที่ยังไม่ได้บันทึก ต้องการทิ้งการแก้ไขและเปลี่ยนบัญชีทดสอบหรือไม่? |
| search | ค้นหา |
| search_placeholder | ค้นหาโครงการ แบรนด์ BUD หรือคำถาม |
| loading | กำลังโหลดข้อมูล… |
| retry | ลองใหม่ |
| empty | ไม่พบรายการตามตัวกรอง |
| all | ทั้งหมด |
| previous | ก่อนหน้า |
| next | ถัดไป |
| project | โครงการ |
| brand | แบรนด์ |
| business_narrative | เนื้อหาธุรกิจ |
| business_contacts | ช่องทางติดต่อ |
| business_no_applicable_phases | ยังไม่ได้ระบุโครงการหรือเฟสที่ใช้คำตอบนี้ |
| readiness | ความพร้อมของข้อมูล |
| required_missing | ข้อมูลจำเป็นที่ยังขาด |
| returned_task | ถูกส่งกลับให้ฉัน |
| approval_task | รอฉันอนุมัติ |
| needs_reapproval | ต้องอนุมัติใหม่ |
| publish_task | รอเผยแพร่ |
| expiring_task | ใกล้หมดอายุ |
| missing_fact_task | ข้อมูลที่ยังขาดทำให้ตอบไม่ได้ |
| review_task | ถึงรอบทบทวน |
| unanswered_task | คำถามที่ผู้ช่วยยังตอบไม่ได้ |
| unanswered_note | มีบันทึกว่าตอบไม่ได้ แต่ไม่ได้เก็บข้อความคำถาม |
| date | วันที่ |
| person | ผู้ดำเนินการ |
| date_from | วันที่เริ่ม |
| date_to | วันที่สิ้นสุด |
| before | ก่อนเปลี่ยนแปลง |
| after | หลังเปลี่ยนแปลง |
| affected_projects | โครงการที่ได้รับผลตามสิทธิ์ของคุณ |
| since_publication | การเปลี่ยนแปลงหลังเผยแพร่ล่าสุด |
| assistant_disabled | ผู้ช่วยยังไม่เปิดใช้งาน |
| task_question | รายการนี้ต้องทำอะไรต่อ |
| canonical_media | รูปภาพและไฟล์ประกอบโครงการ |
| load_error | โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่ |
| reason | เหตุผล |
| confirm | ยืนยัน |
| cancel | ยกเลิก |
| save | บันทึก |
| refresh | โหลดข้อมูลล่าสุด |
| select_item | เลือกรายการ |
| clear_selection | ล้างรายการที่เลือก |
| prepare_review | เตรียมตรวจรายการเผยแพร่ |
| review_publication | ตรวจรายการก่อนเผยแพร่ |
| confirm_publication | ยืนยันเผยแพร่ |
| partial_publication | เผยแพร่บางรายการแล้ว โปรดตรวจรายการที่ยังไม่ผ่าน |
| rejected | ไม่ผ่าน |
| stale_item | รายการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุด |
| publisher_conflict | ผู้เผยแพร่ต้องเป็นคนละคนกับผู้แก้ไข ผู้ตรวจภาษาอังกฤษ และผู้อนุมัติฉบับนี้ |
| not_approved_or_available | ยังไม่อนุมัติหรือไม่พร้อมเผยแพร่ |
| pointer_changed | เวอร์ชันที่เผยแพร่เปลี่ยนแปลงแล้ว |
| retained_source_unavailable | เนื้อหาจากเวอร์ชันเดิมไม่พร้อมใช้งาน |
| page_config_changed_or_unapproved | การตั้งค่าหน้าเว็บเปลี่ยนแปลงหรือยังไม่อนุมัติ |
| web_history | ประวัติเผยแพร่เว็บไซต์ |
| release_history | ประวัติชุดเผยแพร่ข้อมูล |
| withdraw_page | ถอนหน้าเว็บ |
| rollback_release | ย้อนกลับชุดเผยแพร่ |
| restore_version | คืนเวอร์ชันนี้ |
| confirm_pointer_change | ยืนยันเปลี่ยนเวอร์ชันที่เผยแพร่ |
| confirm_release_rollback | ยืนยันย้อนกลับชุดเผยแพร่ |
| own_approval_reason | ระบุเหตุผลที่อนุมัติงานที่แก้เอง |
| submit_results | ผลการส่งอนุมัติ |
| version | เวอร์ชัน |
| thai | ภาษาไทย |
| english | ภาษาอังกฤษ |
| permission_required | ไม่มีสิทธิ์ดำเนินการนี้ |
| draft_preserved | เก็บข้อมูลที่คุณแก้ไขไว้แล้ว |
| normal_review_required | โปรโมชั่นต้องผ่านการตรวจข้อมูลและกฎหมายตามขั้นตอนเดิม |
| withdrawn | ถอนแล้ว |
| rolled_back | ย้อนกลับแล้ว |
| website_publication | เผยแพร่เว็บไซต์ |
| data_publication | ชุดเผยแพร่ข้อมูล |
| publication_results | ผลการเผยแพร่แต่ละรายการ |
| preview | ดูตัวอย่างหน้าเว็บ |
| current_version | เวอร์ชันที่เผยแพร่อยู่ |
| detail | ดูรายละเอียด |
| prepared | เตรียมรายการแล้ว |
| writing_unavailable | ช่องนี้ยังไม่เปิดให้ผู้ช่วยร่างข้อความ |
| writing_enabled | เปิดใช้ผู้ช่วยร่างข้อความ |
| writing_unsaved | บันทึกหรือโหลดข้อมูลล่าสุดก่อนขอให้ช่วยร่างข้อความ |
| writing_ambiguous | ยังยืนยันผลไม่ได้ ระบบจะไม่ลองซ้ำอัตโนมัติ กรุณาตรวจสถานะ |
| writing_processing | กำลังเตรียมข้อเสนอข้อความ |
| writing_accept | ยอมรับและบันทึกฉบับร่าง |
| writing_reject | ไม่ใช้ข้อเสนอนี้ |
| writing_saved | บันทึกข้อเสนอเป็นฉบับร่างแล้ว |
| writing_save_failed | บันทึกไม่สำเร็จ ข้อเสนอยังอยู่ กรุณาตรวจข้อมูลก่อนลองอีกครั้ง |
| writing_protected_invalid | ข้อเสนอเปลี่ยนข้อความที่ต้องคงไว้ จึงไม่สามารถใช้ข้อเสนอนี้ได้ |
| promotion_tab | โปรโมชั่น |
| promotion_active | กำลังใช้งาน |
| promotion_review | รอตรวจข้อมูลหรือกฎหมาย |
| promotion_draft | ร่าง |
| promotion_expired | หมดอายุแล้ว |
| promotion_scheduled | ยังไม่เริ่มใช้สิทธิ์ |
| promotion_this_project | เฉพาะโครงการนี้ |
| promotion_from_brand | จากแบรนด์ {brand} |
| promotion_shared | ใช้ร่วมกับ {count} โครงการ |
| promotion_exclude_project | ไม่ใช้กับโครงการนี้ |
| promotion_create_project | สร้างโปรโมชั่นสำหรับโครงการนี้ |
| promotion_create_brand | สร้างโปรโมชั่นสำหรับแบรนด์นี้ |
| promotion_shared_edit | การแก้ไขนี้มีผลกับ {count} โครงการ |
| promotion_create_suggestion | สร้างจากข้อเสนอนี้ |
| promotion_suggestion_source | ข้อเสนอจากเว็บเดิม |
| promotion_source_page | ดูหน้าอ้างอิง |
| promotion_captured_at | วันที่เก็บข้อมูล |
| promotion_likely_expired | น่าจะหมดอายุแล้ว |
| promotion_undated | ไม่ระบุวันที่ |
| promotion_not_offer | ไม่ใช่โปรโมชั่น |
| promotion_confirm_numbers | กรุณากรอกวันที่ จำนวนเงิน ราคา และช่วงใช้สิทธิ์ที่ยืนยันแล้วด้วยตนเอง |
| promotion_ending_seven_days | โปรโมชั่นที่จะสิ้นสุดภายใน 7 วัน |
| promotion_missing_banner_rights | โปรโมชั่นที่กำลังใช้งานแต่ยังไม่มีภาพแบนเนอร์ที่อนุมัติสิทธิ์แล้ว |
| promotion_invalid_starting_price | ราคาเริ่มต้นอ้างอิงโปรโมชั่นที่หมดอายุหรือถอนแล้ว |
| promotion_resolved_projects | โครงการที่ใช้โปรโมชั่นนี้ |
| promotion_excluded_projects | โครงการที่ไม่ใช้โปรโมชั่นนี้ |
| promotion_scope_pending | ขอบเขตฉบับร่างยังไม่เปลี่ยนข้อมูลบนเว็บไซต์ |
| promotion_booking_window | ช่วงจอง |
| promotion_transfer_window | ช่วงโอน |
| promotion_banner_rights | สิทธิ์ภาพแบนเนอร์ |
| promotion_audience | กลุ่มผู้รับสิทธิ์ |
| promotion_scope_changed | ขอบเขตโครงการเปลี่ยนแล้ว กรุณาตรวจรายชื่อโครงการอีกครั้ง |
| promotion_scope_empty | กรุณาเลือกอย่างน้อยหนึ่งโครงการที่ใช้โปรโมชั่นนี้ |
| promotion_scope_unavailable | ขอบเขตโครงการยังไม่พร้อมเผยแพร่ |
| promotion_capture_unknown | ไม่ทราบวันที่เก็บข้อมูล |
| promotion_withdrawn | ถอนการเผยแพร่แล้ว |
| promotion_unavailable | งดแสดงบนเว็บไซต์ |
| promotion_owner | ระดับของโปรโมชั่น |
| promotion_owner_project | โครงการ |
| promotion_owner_brand | แบรนด์ |
| promotion_draft_scope | ขอบเขตฉบับร่าง |
| promotion_published_scope | ขอบเขตที่เผยแพร่ |
| promotion_scope_refresh | ตรวจขอบเขตโครงการ |
| promotion_open_editor | เปิดตัวแก้ไขโปรโมชั่น |
| promotion_context_return | กลับไปยังหน้าต้นทาง |
| promotion_no_items | ยังไม่มีโปรโมชั่นสำหรับหน้านี้ |
| promotion_banner_missing | ยังไม่มีภาพแบนเนอร์ |
| promotion_banner_approved | อนุมัติสิทธิ์แล้ว |
| promotion_banner_unapproved | ยังไม่ได้อนุมัติสิทธิ์ |
| promotion_review_data | ตรวจข้อมูล |
| promotion_review_legal | ตรวจกฎหมาย |
| promotion_review_approved | ตรวจผ่าน |
| promotion_review_revoked | ถอนผลการตรวจ |
| promotion_review_waiting | ยังไม่ตรวจผ่าน |
| promotion_read_only | บัญชีนี้อ่านข้อมูลได้ แต่สร้างร่างไม่ได้ |
| promotion_access_denied | บัญชีนี้ไม่มีสิทธิ์ดูโปรโมชั่นและข้อมูลต้นทาง |

| promotion_audience_general | ลูกค้าทั่วไป |

| promotion_audience_investor | ผู้ลงทุน |

| promotion_audience_livnex | LivNex |

W9 upload copy (owner decision, 6 November 2026):

| Key | Thai label |
|---|---|
| upload_original | ไฟล์ก่อนปรับขนาด |
| upload_stored | ไฟล์ที่จัดเก็บ |
| upload_unchanged | เก็บไฟล์โดยไม่เปลี่ยนแปลง |
| upload_metadata_removed | ลบข้อมูลแฝงของไฟล์แล้ว |
| upload_image_limit | ภาพไม่เกิน 30 MB ต่อไฟล์ |
| upload_pdf_limit | PDF ไม่เกิน 50 MB ต่อไฟล์ |
| upload_legal_limit | เอกสารกฎหมายหรือไฟล์ที่ยังไม่ระบุประเภทต้องไม่เกิน 10 MB |
| upload_image_output_limit | ภาพหลังปรับขนาดยังเกิน 10 MB กรุณาลดขนาดไฟล์แล้วอัปโหลดอีกครั้ง |
| upload_pdf_output_limit | PDF หลังปรับขนาดยังเกิน 20 MB กรุณาลดขนาดไฟล์แล้วอัปโหลดอีกครั้ง |
| upload_pdf_reexport | ไม่สามารถลบข้อมูลแฝงของ PDF ได้อย่างปลอดภัย กรุณาส่งออก PDF ใหม่แล้วอัปโหลดอีกครั้ง |
| file_metadata_suggestions | ข้อเสนอจากข้อมูลในไฟล์ |
| file_metadata_source | จากข้อมูลในไฟล์ |
| file_metadata_use | นำมาใช้ |
| file_metadata_unconfirmed | ยังไม่ได้ยืนยัน |
| file_metadata_credit_evidence | หลักฐานเครดิตและสิทธิ์จากไฟล์ |
| file_metadata_stock_evidence | พบข้อมูลภาพจากคลังภาพ กรุณาตรวจสิทธิ์เป็นรายไฟล์ |
| file_metadata_near | ถ่ายใกล้โครงการ |
| file_metadata_far | ถ่ายห่างจากโครงการ |
| file_metadata_location_unknown | ไม่ทราบความใกล้โครงการ |
| file_metadata_offset_unknown | ไม่ทราบเขตเวลาที่ถ่าย |
| file_metadata_unmapped_tags | คำสำคัญจากไฟล์ที่ยังไม่ตรงกับป้ายกำกับ |

W3.1 overview and exposure copy:

| Key | Thai label |
|---|---|
| view_all | ดูทั้งหมด |
| show_less | แสดงน้อยลง |
| view_history | ดูประวัติทั้งหมด |
| gap_count | รายการที่ยังขาด |
| item_count | รายการ |
| context_selling_point | จุดขาย |
| context_building | อาคาร |
| context_unit_type | แบบห้อง |
| context_price | ราคา |
| context_record | รายการ |
| section_commercial | กฎหมายและการขาย |
| section_investor | ผู้ลงทุน |
| exposure_open | เว็บไซต์และ AI |
| exposure_web_only | เว็บไซต์เท่านั้น |
| exposure_internal | ภายใน Hub |
| exposure_registry | ตามทะเบียนฟิลด์ |
| exposure_source | ตามนโยบายของเนื้อหา |
| exposure_draft_notice | บันทึกเป็นร่าง ต้องผ่านการอนุมัติและเผยแพร่ก่อนเปลี่ยนข้อมูลบนเว็บไซต์หรือใน AI |
| exposure_default | ช่องทางตามค่าเริ่มต้นของฟิลด์ |
| internal_notice | รายการนี้ใช้ภายใน Hub เท่านั้น จะไม่ปรากฏบนเว็บไซต์หรือในคำตอบของ AI |
| change_exposure | เปลี่ยนช่องทางการใช้ข้อมูล |

W6 account scope and membership notices:

| Key | Thai label |
|---|---|
| scope_edit | แก้ไขขอบเขต |
| scope_search | ค้นหา BUD หรือโครงการ |
| scope_future_members | รวมโครงการที่จะเข้าร่วม BUD นี้ในอนาคต |
| scope_project_exception | เลือกโครงการนี้เพิ่มเติม |
| scope_bu_included | รวมอยู่ใน BUD ที่เลือก |
| scope_no_bu | ยังไม่มี BUD |
| scope_empty_selected | ยังไม่ได้เลือก BUD หรือโครงการ จึงไม่มีสิทธิ์ในระดับนี้ |
| scope_base_required | ขอบเขตไม่เพิ่มสิทธิ์ดู แก้ไข หรืออนุมัติที่ยังไม่ได้รับ |
| scope_preview | ตรวจการเปลี่ยนแปลงขอบเขต |
| scope_gained | โครงการที่ได้รับสิทธิ์เพิ่ม |
| scope_lost | โครงการที่สิทธิ์สิ้นสุด |
| scope_unchanged | ไม่มีการเปลี่ยนแปลงสิทธิ์ |
| scope_confirm | ยืนยันเปลี่ยนขอบเขต |
| scope_saved | บันทึกขอบเขตแล้ว |
| scope_stale | ข้อมูลเปลี่ยนแปลงแล้ว เก็บรายการที่คุณเลือกไว้ กรุณาตรวจอีกครั้ง |
| scope_history | ประวัติการเปลี่ยนแปลงสิทธิ์ในโครงการ |
| scope_effective_at | มีผลวันที่ |
| scope_observed_at | บันทึกวันที่ |
| scope_gain | ได้รับสิทธิ์ |
| scope_loss | สิทธิ์สิ้นสุด |
| scope_load_more | โหลดรายการเพิ่มเติม |
| scope_sync_runs | ประวัติการปรับข้อมูล BUD |
| scope_sync_failed | ปรับข้อมูล BUD ไม่สำเร็จ |
| scope_sync_accepted | รับข้อมูลแล้ว |
| scope_sync_rejected | ไม่รับข้อมูลชุดนี้ |
| scope_source_at | วันที่ข้อมูลต้นทาง |
| scope_cutoff | สิทธิ์ตาม BUD สิ้นสุดวันที่ |
| scope_grace | ระยะผ่อนผันสิทธิ์ตาม BUD |
| scope_grace_help | ใช้ระยะเดียวกันเมื่อข้อมูลล่าช้าหรือโครงการย้าย BUD เลือกได้ 1–7 วัน ค่าเริ่มต้น 7 วัน |
| scope_days | วัน |
| scope_settings_preview | ตรวจผลการเปลี่ยนระยะผ่อนผัน |
| scope_settings_confirm | ยืนยันเปลี่ยนระยะผ่อนผัน |
| scope_settings_saved | บันทึกระยะผ่อนผันแล้ว |
| scope_admin_only | ผู้ดูแลระบบเท่านั้นที่เปลี่ยนระยะผ่อนผันได้ |
| scope_preview_partial | แสดงผลกระทบ 100 รายการแรก |
| scope_discard | ยกเลิกการแก้ไขที่ยังไม่บันทึก |
| scope_read_only | ดูขอบเขตสิทธิ์ |
| scope_reason_scope_change | เปลี่ยนขอบเขตสิทธิ์ |
| scope_reason_base_change | เปลี่ยนสิทธิ์รายแท็บ |
| scope_reason_settings_change | เปลี่ยนระยะผ่อนผัน |
| scope_reason_membership_accept | รับข้อมูลสมาชิก BUD |
| scope_reason_membership_stale | ข้อมูล BUD เกินระยะผ่อนผัน |
| scope_reason_handover_end | สิ้นสุดระยะส่งต่องาน |
| scope_reason_account_status | เปลี่ยนสถานะบัญชี |
| scope_sync_missing | ยังไม่มีข้อมูลสมาชิก BUD |
| scope_stale_data | ข้อมูล BUD ล่าช้า กำลังใช้ข้อมูลล่าสุดที่รับไว้ |
| scope_stale_warning | ข้อมูล BUD ล่าช้า โปรดตรวจวันที่สิทธิ์จะสิ้นสุด |
| scope_stale_expired | สิทธิ์ตาม BUD หยุดใช้ชั่วคราวจนกว่าจะรับข้อมูลใหม่ |
| scope_handover | โครงการย้าย BUD อยู่ระหว่างส่งต่องาน |
| scope_handover_end | สิ้นสุดการส่งต่องานวันที่ |
| scope_temporary_grant | จัดการสิทธิ์รายโครงการชั่วคราว |
| scope_save_base_first | บันทึกหรือยกเลิกการแก้ไขสิทธิ์รายแท็บก่อนเปลี่ยนขอบเขต |
| scope_title | ขอบเขต |
| scope_all | ทุกโครงการ |
| scope_selected | เลือกเอง |
| scope_references_partial | แสดงเฉพาะโครงการที่คุณมีสิทธิ์ดู จำนวนผลกระทบรวมทุกโครงการ ขอบเขตที่ไม่แสดงจะคงไว้เมื่อบันทึก |

### 8.6 Upload optimization

The following owner decision and addendum are recorded verbatim. The addendum
supersedes the earlier PDF no-gain byte-retention rule for non-legal PDFs:
metadata removal and a safe full rewrite are mandatory even without compression
gain. Legal and unknown-category uploads retain the byte-exact existing limits.
Implementation and the docs/36 permission card are tracked under W9 in docs/48.

#### Owner decision and addendum (verbatim)

Owner decision (6 Nov 2026): uploads are optimized automatically and the Hub keeps ONLY the optimized file, not the camera or designer original. The Hub serves the website and AI, not print production; print originals stay with designers and agencies. New workstream W9. It may run in parallel with W4-W6 as a bounded sub-agent that owns the upload files listed below, but merge it before W8 so the UAT covers it. Record the decision verbatim in docs/47 (new section 8.6 "Upload optimization") and log the work in docs/48.

CURRENT STATE (verify)
- apps/api/sena_hub_api/assets.py stores uploaded bytes unchanged: max 10 MB per file (MAX_BYTES), max 40 million pixels, PNG, JPEG, WebP, sanitized SVG and PDF. The stored checksum is the content address and the public asset identity. EXIF and other metadata (including GPS) are kept today.
- prepare_upload() already transforms SVG before hashing; that is the natural place for the new step.
- The same 10 MB limit appears in the Next proxy (apps/admin/app/api/hub/[...path]/route.ts, maxUploadBytes), in client checks (project-assets.tsx, commercial-types.tsx and other upload components), in hosted_assets.py, and in operator importers that call prepare_upload or validate_file.

IMAGES
- Accept inputs up to 30 MB and 100 million pixels. Keep the decompression-bomb guard. Process one image at a time under a lock so concurrent uploads cannot exhaust memory.
- Apply EXIF orientation, convert to sRGB, and strip all metadata (EXIF including GPS and camera serials, XMP, IPTC, comments).
- Resize so the long edge is at most 4096 px. Never upscale.
- JPEG stays JPEG and WebP stays WebP, encoded at quality 85. PNG stays PNG with lossless optimization, so plans, maps, logos and line art never blur. Exception: a PNG without transparency that is still larger than 4 MB after lossless optimization is converted to JPEG at quality 90.
- A file already within 4096 px and 2 MB keeps its dimensions; only its metadata is stripped, with no visible quality loss (for example JPEG quality "keep").
- The stored result must not exceed 10 MB; otherwise reject with a clear Thai message. Animated images stay rejected. SVG keeps its existing sanitization.

PDF
- Accept inputs up to 50 MB and the existing page limit. Run the existing active-content checks on the input and on the output.
- Brochures and other marketing PDFs: recompress embedded images to about 200 dpi at JPEG quality 80 with the existing pypdf library. Do not add a system binary such as Ghostscript.
- Keep the compressed file only when it is at least 20% smaller, has the same page count and still yields extractable text where the original did. Otherwise keep the original bytes. The stored PDF must not exceed 20 MB; otherwise reject with a clear Thai message.
- Legal documents (media category legal_document and any disclosure evidence) are never modified. They are stored byte-exact with the existing limits. The category must be known before processing; if it is not, treat the file as legal and do not modify it.

IDENTITY, DEDUP AND AUDIT
- The stored file's checksum remains the content address and public identity, exactly as today.
- Add metadata: original checksum, size, MIME type and dimensions, and a processing record (pipeline version, max edge, quality, output format, metadata stripped, PDF images recompressed, kept original because no gain).
- Dedup on the original checksum first, so uploading the same original again reuses the existing asset even after a library upgrade, then on the stored checksum.
- Never reprocess, rewrite or delete existing stored objects or asset rows. Existing files keep their bytes and identities. Future operator imports use the same pipeline.
- Thumbnails, private previews and image suggestions use the stored optimized file.

UI
- Update every upload limit consistently: client checks, Next proxy and API (30 MB images, 50 MB PDFs).
- After upload, show a result line per file, for example original 18.4 MB 6000x4000 -> stored 1.6 MB 4096x2731, or "kept unchanged" for legal documents and PDFs with no gain. Thai labels as UTF-8 in docs/47 section 8.5.

HOSTED
- Local only. Write down in docs/48 the hosted settings the later rollout will need (web server and proxy request-body limits, API memory headroom). Do not change hosted configuration.

TESTS
Large JPEG resized to 4096 px with GPS removed and orientation applied; PNG line art stays lossless; large photographic PNG becomes JPEG; small file keeps its dimensions; WebP; animated image and decompression bomb rejected; brochure recompressed when it gains at least 20% and kept original otherwise; active PDF rejected; legal document byte-exact; dedup by original checksum; existing assets untouched; per-file result shown; limits enforced in client, proxy and API; concurrent uploads serialized. Add a storage summary to docs/48: the average stored size per image and per PDF on the test fixtures.

GATES AND REPORT
Complete the docs/36 permission card (no permission change expected; say so). Quick gates while iterating, one full gate before the W9 commit, then commit explicit paths and push. Report the commit hash, files changed, tests per suite, the storage summary and deviations. Addendum to W9 (owner, 6 Nov 2026): file metadata. Add this to docs/47 section 8.6 and implement it inside W9.

1) EXTRACT USEFUL METADATA AS SUGGESTIONS, THEN STRIP
Before stripping an image, read only the allowlisted fields below and store them as suggestions with source "file_metadata" and the pipeline version. Keep them apart from confirmed values exactly like the existing AI suggestions (the ai_suggestion column with an explicit source, or a separate suggestion object; your choice, recorded in docs/48). Never auto-confirm. Never include them in public payloads, JSON-LD, exports, RAG, assistant tools or any AI provider call. Treat all metadata text as untrusted: plain text only, length-limited, safely decoded.
- Capture date (DateTimeOriginal or CreateDate, with its offset when present) -> suggested taken_at. A missing offset stays unknown; never substitute the upload time.
- Creator, copyright, credit line and usage terms (EXIF Artist and Copyright, IPTC By-line, Credit and CopyrightNotice, XMP dc:creator, dc:rights and xmpRights:UsageTerms) -> suggested credit, and shown to the rights approver as evidence.
- Stock-agency identifiers or credits (for example Shutterstock, Getty, iStock, Adobe Stock) -> suggested stock flag "present", which keeps the file out of bulk rights approval.
- AI or render signals (IPTC DigitalSourceType trainedAlgorithmicMedia or compositeWithTrainedAlgorithmicMedia, a C2PA manifest present, or a rendering tool named in Software) -> suggested image_kind "render". Camera make and model present with none of these -> suggested "photo".
- Caption and keywords (IPTC Caption-Abstract and Keywords, XMP dc:description and dc:subject) -> caption and tag suggestions. Tags only map to the active controlled vocabulary; anything else is shown as text, not proposed automatically.
- GPS: only when the upload context is a project with stored coordinates, compute whether the photo was taken within 1 km of the project and store only "near", "far" or "unknown". Never store the coordinates or the distance.
- PDF: the document Title may become a caption suggestion. Nothing else from a PDF is kept.

Never extract or keep: GPS coordinates, camera or lens serial numbers, photographer contact details (email, phone, address), face or person region names, edit history, file paths, user or computer names, embedded preview thumbnails, PDF author, creator, producer and dates.

UI: the media tagging panel shows these suggestions next to the AI suggestions, labelled as coming from the file, each with a "use" action. The rights review screen shows the credit and stock evidence.

2) STRIP PDF METADATA EVEN WITHOUT COMPRESSION GAIN
For every non-legal PDF, remove the document information dictionary, XMP metadata and incremental-update history (rewrite the file), even when the embedded images are not recompressed because the gain is under 20%. Content must stay identical: same page count and extractable text. If metadata cannot be removed safely, reject the upload with a clear Thai message asking the user to export the PDF again. Legal documents remain byte-exact and keep their metadata; they are private and never public.

3) TESTS
Fixtures with each metadata kind: capture date with and without offset; credit and copyright; stock identifier; DigitalSourceType AI marker; caption and keywords; GPS near, far and missing project coordinates; serial number, contact details, face regions and an embedded thumbnail that differs from the main image. Assert the suggestions, assert that none of the excluded fields survive anywhere (stored file, database, logs, API responses), assert the stored image has no metadata or embedded thumbnail, assert suggestions never reach public payloads or AI calls, assert non-legal PDFs lose their metadata with identical page count and text, and assert legal PDFs are byte-exact.

## 9. Pending questions to register

Add to the existing «คำถามที่รอคำตอบ» catalogue with suggested owners:

1. DW owner: deliver the narrow read-only BU relation and its read-only
   credential for the daily sync (section 7.1); owner installs the credential on
   hosted TEST.
2. Owner and Brand team: official vector logo and brand colour codes.
3. Owner: confirm the shared-level approval rule in section 7.2.
4. Owner: which accounts form Online Marketing and receive «เผยแพร่ขึ้นเว็บ».
5. Owner: monthly AI budget for the writing aid.
6. Owner: businesses other than residential and when to add them.

## 10. Delivery programme

### 10.1 Workstreams

| ID | Scope | Depends on | Migrations |
|---|---|---|---|
| W1 | Service shell, logo, theme, collapse, overflow fix, assistant leaves the sidebar | none | none |
| W2 | Global search, floating assistant, home greeting, «งานของฉัน» (read-only aggregation) | W1 shell merged | read-only views if needed |
| W3 | Entity pages: level tree, page shell and tabs reusing existing sections, readiness deep links, FAQ tab (section 4.4), inline legacy suggestions and N7, media tab, history tab, Admin activity log, old URL redirects | W1 | read-only projections only |
| W3.1 | Owner-review corrections: registry-default suggestion exposure, exposure chips/notices and compact contextual overview (sections 4.3/4.5) | W4 committed | additive function/projection changes only |
| W3.2 | Contextual Promotions tabs, brand ownership, reviewed exclusions and legacy suggestions (section 4.7) | W3.1 committed | additive only, lead allocated |
| W4 | Governance: N1, per-item approval, return per item, FAQ withdraw, N2 publisher rules, N6 single queue | none for backend; UI after W3 | yes |
| W5 | Business level (N3) | W4 migrations merged | yes |
| W6 | BUD scoping (N4), daily read-only BU sync (section 7.1) and account scope screen | W4 merged | yes |
| W7 | AI writing aid (N5): backend with stub provider, field-registry flag, UI buttons | backend none; UI after W3 | small |
| W9 | Upload optimization, safe file metadata suggestions and private legal retention (section 8.6) | independent bounded preparation; shared upload adapters after their active owner; before W8 | additive only, lead allocated |
| W8 | Thai UAT pack `docs/49-uat-unified-workspace-th.md` covering every flow in this document | all | none |

Order of merges into `main` (owner clarification received 6 November 2026):
W1 → W2 → W3 → W4 → W3.1 → W3.2 → W5 → W6 → W7 → W9 → W8.
Finish the current W4 full gate and commit before W3.1 implementation. Bounded
W9 preparation may run in parallel; shared upload UI/API adapters wait for the
active owner. W8 and the final programme gate remain last.

After a workstream is merged, remove its finished worktrees with
`git worktree remove` and merged branches with `git branch -d`; never force or
delete unmerged work. List remaining worktrees in docs/48.

### 10.2 Parallel work rules

- The lead agent owns `main`, the migration counter, the test lock, the log and
  all commits to `main`. Sub-agents work in separate git worktrees on branches
  named `ws/<workstream>-<slug>` and hand back a branch with a short report.
- Only the lead allocates migration numbers, in merge order. Names follow
  `YYYYMMDDNNNN_<slug>.sql` with the global counter continuing from `0081`
  (`202610290081_media_worker_heartbeat.sql`). Never renumber or edit a merged
  migration.
- Assign disjoint files to concurrent sub-agents. Shared files
  (`hub-shell.tsx`, `hub-navigation-data.ts`, `styles/tokens.css`,
  `apps/api/sena_hub_api/main.py`, `content_permissions.py`, route
  inventories under `tests/permissions/`) change in one workstream at a time.
- Port-bound commands (`test:api`, `test:db`, `test:ui`, `test:local`, H1,
  disposable simulations and the working dev stack) run one at a time across
  all agents under the lead's test lock. Sub-agents may run the admin
  typecheck, linters and checks that bind no port. Never stop another
  process.
- Every workstream that changes permissions completes the docs/36 permission
  card before code and adds runtime deny and positive-neighbour tests.

### 10.3 Gates, commits and reporting

- Quick gates while iterating and the full gate once per workstream before its
  commit (docs/11 "Test gates"): typecheck, documented offline webpack build,
  `test:production`, `test:api`, `test:db`, `test:ui` (1280 px and 390 px), H1
  where hosted paths are touched, migration replay on a disposable database
  and a credential scan of changed files and the browser bundle.
- After a workstream passes its full gate, commit explicit paths to `main` and
  push to `origin/main`, then continue without waiting unless a STOP applies.
  No pull requests unless the owner asks. No AI model or vendor model names in docs, logs, commit messages or
  code comments; describe delegation only as bounded sub-agents.
- Log each workstream in `docs/48-unified-workspace-log.md`: commit hash,
  migrations, what was built, tests per suite (passed/skipped/failed),
  screenshots under `artifacts/`, deviations, new pending questions, next step.

### 10.4 STOP and report when

- a credential, hosted resource, hosted deployment, REM access or DW repository
  change would be needed (for BUD, build and test the daily sync with fixtures
  and the staged 5 October package; stop only before enabling it on hosted
  TEST without the credential);
- a migration would delete or rewrite existing content, versions, reviews,
  publication history, accounts, grants or templates (the N1 catalog flag
  change is allowed);
- a live AI call would be needed (W7 uses a stub until the owner approves the
  budget);
- a requirement here conflicts with a safety rule or with REQUIREMENTS.md and
  this document does not resolve it.

Local only. No hosted TEST migration, deployment or R2 write without a separate
owner authorisation recorded in docs/46.
