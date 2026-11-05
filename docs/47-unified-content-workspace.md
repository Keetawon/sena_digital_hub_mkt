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

### 4.6 Home «หน้าแรก»

- Greeting and the search box (section 8.2).
- «งานของฉัน»: returned to me, waiting for my approval (Manager), waiting to
  publish (Online), expiring soon, facts missing that hide answers, review due,
  questions the AI could not answer. Each opens the exact field.
- Readiness by BUD and by brand, filtered to the account's scope.

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

### 7.1 Source of BUD membership

- Authoritative source (owner, 4 November 2026): REM `Sys_Admin_Bu.BUCode`
  joined to `Sys_Master_Projects.BUID` on `BUId`. The Hub must not read REM
  directly and must not modify the DW repository.
- The DW already loads `Sys_Admin_Bu` once a day in the project-dimension relay
  and publishes `rem_bu_id`, `rem_bu_code`, `rem_bu_name`, `rem_parent_bu_id`,
  `rem_bu_for` and `rem_sub_bu_id` in `gold.dim_project`. The reviewed DW
  package of 5 October 2026 (manifest
  `6251c4663d85303caeb5bb7469d79bd00b022f64f470486afcf14db050955ed3`) already
  carries these fields for all 278 REM projects inside each row's `gold`
  object; the Hub has not used them yet. Codes in that package: BusinessUnit1
  82, BUD C1 43, blank 39, BUD H1 27, BUD H2 21, BUD C3 18, BUD C2 15, BUD51 15,
  BUD11 9, BUD31 4, BUD12 3, BUD Premium 2.
- Owner decision (4 November 2026, second reply): **BUD is the REM BU exactly
  as `Sys_Admin_Bu` holds it.** Use `rem_bu_id` as the key and show
  `rem_bu_code` with `rem_bu_name`. No mapping table, no prefix stripping and
  no grouping of codes. REM wins over every other source, so TPRAK and K9BK5
  belong to BUD31. A project with a blank BUID has no BUD and is visible only to
  unrestricted scopes; list it for follow-up.
- The business sheet (Google Sheet `1BvPr9mjRt2hm2OUVS29HPIjGShZM8rbuRB77xExv-j4`,
  tab Project) is not a BUD source. Its CSV was byte-identical on 6 October,
  27 October and 4 November 2026, so it does not follow BUD changes.
- One brand appears in several BUDs (for example KITH in BUD C1, BUD C3 and
  BUD H2), so brand cannot stand in for BUD.
- Freshness (owner decision): the Hub refreshes BUD membership **daily**, after
  the DW's 16:00 Bangkok project-dimension relay. Today BU data reaches the Hub
  only through manually exported packages, so W6 adds a read-only daily sync:
  - it reads only project ID, BU fields and the source snapshot time from a
    narrow read-only DW relation through a dedicated read-only credential
    (delivered by the DW request of 4 November 2026);
  - it is idempotent, stores one dated membership row per change
    (`valid_from`, `valid_to`, source snapshot time, run reference), so the Hub
    keeps the history itself;
  - a failed, empty or stale run (source snapshot older than 48 hours) keeps
    the previous membership, records the failure and warns account managers;
  - local development and tests use fixtures and the 5 October package; enabling
    the job on hosted TEST needs the owner to install the credential (STOP
    until then).
- Membership changes apply automatically, because BUD-scoped grants are meant
  to follow the BUD. Every run is audited, and account managers see a notice
  listing projects that moved and the accounts whose access changed.
  Per-project exceptions are unaffected by BUD moves.

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
| W4 | Governance: N1, per-item approval, return per item, FAQ withdraw, N2 publisher rules, N6 single queue | none for backend; UI after W3 | yes |
| W5 | Business level (N3) | W4 migrations merged | yes |
| W6 | BUD scoping (N4), daily read-only BU sync (section 7.1) and account scope screen | W4 merged | yes |
| W7 | AI writing aid (N5): backend with stub provider, field-registry flag, UI buttons | backend none; UI after W3 | small |
| W8 | Thai UAT pack `docs/49-uat-unified-workspace-th.md` covering every flow in this document | all | none |

Order of merges into `main`: W1 → (W2, W3) → W4 → W5 → W6 → W7 UI → W8.
Backend work for W4 and W7 may proceed in parallel with W1–W3.

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
  No pull requests unless the owner asks. No AI model or vendor names in
  commit messages.
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
