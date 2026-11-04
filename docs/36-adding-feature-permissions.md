# Adding a feature with permissions

## สรุปสำหรับเจ้าของงาน

ทุกฟีเจอร์ต้องระบุสิทธิ์ก่อนเริ่มทำหน้าจอ: อยู่ในแท็บใด, ดู/แก้ไข/อนุมัติหมายถึงอะไร, ต้องใช้ข้อมูลจากแท็บอื่นหรือไม่ และเอเจนซีใช้ได้แค่ไหน ผู้ดูแลบัญชีไม่ได้มีสิทธิ์อ่านข้อมูลทุกแท็บโดยอัตโนมัติ ฐานข้อมูลเป็นผู้ตัดสินสิทธิ์ทุกคำขอ การซ่อนเมนูเป็นเพียงการช่วยให้ใช้งานง่าย

แท็บใหม่เริ่มต้นโดย **ไม่มีใครได้รับสิทธิ์** ผู้ดูแลเห็นข้อความ «มี Tab ใหม่» แล้วเลือกผู้รับสิทธิ์ ดูรายการเปลี่ยนแปลงรายคน และยืนยันก่อนบันทึก การรับทราบข้อความไม่ได้ให้สิทธิ์ การเพิ่มแม่แบบเวอร์ชันใหม่ไม่เปลี่ยนบัญชีที่มีอยู่ ต้องใช้คำสั่ง «ใช้กับ N คน» พร้อมตรวจรายการเปลี่ยนแปลง

โครงการ แบรนด์ โปรโมชัน และชุดเผยแพร่แยกผู้แก้ไขออกจากผู้อนุมัติ บัญชีเดียวเลือก E และ A พร้อมกันไม่ได้ การแยกนี้ยังไม่ใช่กฎห้ามอนุมัติทุกฉบับที่ตนเคยแก้ไข ซึ่งเป็นงานระยะต่อไป เอเจนซีใช้โปรไฟล์ภายนอกตายตัวและเห็นทะเบียนของเอเจนซีตนเองเท่านั้น

## Permission card — required in every feature specification

Complete this card before implementation. For a feature on an existing tab, name that tab and explain whether the existing levels already describe the action; do not create a new checkbox merely for a new screen.

| Field | Required decision |
|---|---|
| Feature / owner | Name, responsible owner, intended users and concrete workflow |
| Tab | Existing catalog code, or proposed new code and Thai label/group |
| View (V) | Exact lists, detail, search, history, downloads, thumbnails and cached payloads visible |
| Edit (E) | Exact draft/write actions; write “unavailable” if none |
| Approve (A) | Exact confirmation/publication/withdrawal actions; write “unavailable” if none |
| Special actions | Only an owner-approved exception with its own Thai description; otherwise none |
| Separation | Whether E and A are mutually exclusive; required revision-author checks, if any |
| Templates | Explicit defaults by template and version; copying never updates existing accounts automatically |
| Agency | Fixed external boundary, canonical agency identity and mandatory row predicate; normally no access |
| Sensitivity | Public, internal or restricted; retention and audit requirements |
| Other tabs | Every source and destination permission; precise minimal name/code references allowed when a source tab is hidden |
| Shared surfaces | Assistant tools/citations/history, RAG, assets/bytes, CSV/exports, background workers and public feeds affected |
| Endpoints / SQL | Every method + exact route and every table, view, policy, definer and dispatcher branch |
| Rollout / verification | Initial deny, migration state, runtime-role deny/neighbor cases, preview/confirmation and rollback |

Published consumer payloads already served by the public website remain available to ACTIVE internal accounts independently of management boxes. This exception does not cover drafts, internal search, private files or a new internal projection. External identities retain their existing boundary. Account/request/permission data never enters assistant tools, exports, RAG or embeddings.

## Implementation checklist

1. **Catalog and migration.** Add or amend the server-owned `hub.permission_catalog` entry: code, Thai label, group, offered levels, special-action labels, separation, agency visibility and sensitivity. A new row must retain default-deny rollout and onboarding defaults. Add no account permission rows, broad default grant or automatic template propagation. Existing template versions are immutable; publish a new version explicitly when defaults change.
2. **Database boundaries.** Enable and FORCE RLS on every new Hub-family table. Give application access only through reviewed policies or bounded functions. Read/write checks use the actual ACTIVE account, `hub.can(tab, level)` / `hub.can_special(tab, action)` and mandatory tenant predicates. Direct DML must not bypass a guarded function. SECURITY DEFINER entry points use a fixed safe search path, closed PUBLIC EXECUTE and explicit caller grants; their private helpers are not callable by `hub_app`. The normal runtime can assume only `hub_app`, never an owner or legacy human role.
3. **Cross-tab behavior.** Check all source and destination tabs in the transaction that performs the action. A release requires A for every member; Archive apply also needs Finance E and confirmed-card creation needs Finance A. Asset reads follow authorized bindings; the uploader may use their own never-bound upload during intake subject to the upload permission. Do not use a forged binding, cached payload, search result, citation or shared dispatcher to reveal a hidden tab. Operator-only workers/stewardship remain outside the grid and outside manage-users.
4. **API mapping.** Register every method and resolved route in `CONTENT_RULES` or an explicitly reviewed `SHARED_RULES` class in `apps/api/sena_hub_api/content_permissions.py`. Use the same DB check even if FastAPI also denies early. An unmapped route must fail closed. Shared actions still need their own exact identity/ownership/source checks; a broad prefix is not a permission rule. Add the exact Next proxy and local H1 allowlist entries where applicable.
5. **Page and controls.** Consume the bounded `/v1/me` capability/catalog projection. The role/template name is descriptive, never authorization. Add a route/icon presentation entry for a new nav tab, while labels, groups and offered actions come from the catalog. Deny direct URLs as well as menus. Controls must match the exact action, including specials and cross-tab conjunctions. Preserve unsaved form text on revocation, errors and stale versions; clear withheld data caches. Keep new UI free of transitions.
6. **Runtime coverage.** Extend the reviewed table/function inventory and route coverage deliberately; never update the frozen historical manifests to conceal a difference. Prove direct SQL and each SECURITY DEFINER entry point under the actual non-superuser runtime with one box removed, plus a positive neighboring permission. Check FORCE RLS, closed helpers/worker ACLs, inactive accounts, unknown tabs/actions and agency scope. Add API/UI cases for direct URL, cached content, file bytes, assistant/export paths and next-request revocation where relevant.
7. **Enable and assign.** Set `guards_ready` and `MIGRATED` only in a reviewed migration after all entry points are covered. Keep incomplete groups locked; `DISABLED` always denies and never falls back to a broader role. The new-tab notice offers an explicit selection by template provenance, exact team or account IDs. Show the per-account preview, exclusions and diff; confirm against the server digest. A changed account, target set, catalog or template invalidates the preview and changes nothing. Notice acknowledgment is per manager and grants nothing.
8. **Delivery.** Run typecheck, offline build, DB/API/UI and loopback H1 gates. Back up the working local DB before applying a passed migration and verify BNA7/existing accounts afterward. Record conversion differences, tests and owner-review decisions in `docs/35-permissions-implementation-log.md`. Commit/push only the passed phase. Hosted execution still requires the owner's explicit “credentials ready”.

## Coverage that must keep failing closed

| Check | Failure means |
|---|---|
| Exact API route classification | A new method/path lacks a tab/action or reviewed shared boundary |
| Live database inventory | A new relation/function/policy has not been reviewed; a table lacks FORCE RLS or its required permission guard |
| Navigation ↔ live catalog | A menu entry has no catalog code, or an offered catalog tab has no reviewed route/icon |
| New-feature mutation probes | An unreviewed table/route/nav entry would escape coverage, or a new tab grants access before explicit assignment |
| Runtime deny/neighbor probes | Removing one box fails to deny the DB operation, or unnecessarily denies a separate permitted operation |
| Template/batch invariants | Template changes propagate implicitly, self/last-manager rules fail, preview drifts, or a batch partially applies |

Use a disposable database and synthetic identities for fixture mutations. Do not add test bypasses, superuser API execution, broad helper grants or production environment switches to make a test pass. `test:api -- --assistant-fixtures -ra` also enables the existing synthetic assistant integration fixtures without provider calls.

## Deliberate boundaries

`can_manage_users` governs Accounts only and is audited separately from data boxes. Applying even the admin data template preserves that flag; granting it is an explicit confirmed single-account decision. Bulk template/tab changes preserve manager flags, exclude self/inactive/external accounts with visible reasons and are bounded to 100 resolved accounts per preview. Split larger rollouts into reviewed batches.

Invites pin an exact server template version, never grant admin, and do not acquire newer defaults while waiting. Agency accounts cannot convert to an internal template or acquire arbitrary boxes; a canonical agency-code correction stays inside their external profile. New tab acknowledgment is per-manager receipt, not global permission approval.

Per-project/brand scoping and strict revision-author four-eyes checks remain deferred. Adding either requires a separate permission card and changes to object-aware DB checks, cross-tab projections, caches, audit and concurrency tests; a new checkbox alone is insufficient.

Update, 4 November 2026: scoping is now scheduled by BUD with per-project exceptions, and the edit/approve rules change for content, in [docs/47](47-unified-content-workspace.md) §5 and §7. The requirements above for a permission card and object-aware checks still apply.
