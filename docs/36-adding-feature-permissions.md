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

P1 polish (12 November 2026): copy/layout corrections and the quiet content-page
BUD request-failure line change no permission, route, catalog, schema or API
contract. Empty-state wording, notice counting, date precision, aria
descriptions, queue-card titles and assistant clearance are presentation only;
every guarded command keeps its existing checks. The targeted BUD-grant notice
variant needs a caller-projection field and is backlog in docs/47 §7.1, not
part of P1.

Home performance correction (13 November 2026): **no permission change**.
Owner-approved migration `202611130092_home_faq_projection.sql` replaces
the native FAQ projection's discarded full-reader call with the existing
exact-row `content_source_allowed` check. Scoped collection filtering, current
draft/version predicates, final source checks, locks, function ownership and
ACL stay intact. The separately approved composer guard evaluates the existing
business-membership lookup only when its already-selected version satisfies
the same question and state predicates. It preserves full composition JSON,
latest-version selection, applicability, publication behavior and function
attributes. Rollback-only proof covered 448 accumulated-corpus comparisons and
108 ordinary-fixture comparisons, with zero differences and unchanged audit/gap
counts. No route, account, grant, API contract or timeout changes.
Delivery requires exact old/new FAQ-set equality across the approved grant,
lifecycle and owning-scope matrix; any differing row stops delivery. The
correction is separately identified from P1 and W7. Prepared W9 moves to 0093;
delivered 0089/0090 and prepared 0091 are not edited.

---

## W9 upload optimization - final permission card

Authority: [docs/47 section 8.6](47-unified-content-workspace.md#86-upload-optimization), including the metadata addendum, and the existing W6 object/scope rules. Migration: `202611130093_upload_optimization.sql`, allocated by the lead. This appendix consolidates the approved contract; it changes no business permission. Integration, runtime verification and the W9 full-gate results are recorded in docs/48. Source presence is not a pass result.

### Permission decision

| Field | Final decision |
| --- | --- |
| Feature / owner | Future-upload optimization, immutable original-to-stored provenance and private unconfirmed file suggestions. Lead owns integration/verification for existing project, brand, model, commercial-type, media, promotion-banner and Knowledge workflows. |
| Tab / defaults | Existing `projects`, `brands`, `promotions`, `knowledge`; no new tab, checkbox, special action, role, account grant, template version or propagation. |
| View | Existing actual asset access AND current owning-context authority. UUID/hash possession is insufficient. Bytes, thumbnails and cached payloads keep existing guards; private-exact adds the legal restriction described below. Never-bound intake remains actor-owned and requires existing upload eligibility. |
| Edit | Preserve Projects E OR Brands E OR Knowledge E OR Knowledge A upload eligibility. Supplied objects additionally require their exact action/scope before body read. Knowledge A does not substitute for Projects/Brands E. Use copies a suggestion into an ordinary draft; normal save permissions, revisions, validation and cross-tab checks remain. |
| Approve / separation | Individual rights review retains Knowledge A, asset access and the complete W6 binding-project-set guard. Retained file stock evidence excludes bulk approval in API and SQL, without revoking existing approval or removing individual review. Existing E/A separation, publication and author checks remain unchanged. |
| Agency / Accounts | Existing external profile and agency predicates remain; no legacy-role fallback. `can_manage_users` grants no content authority. |
| Sensitivity / audit | Original checksum and bounded provenance stay private. Only allowlisted unconfirmed suggestions persist. No original optimized-upload bytes are retained. Private-exact legal/unknown bytes are intentionally retained byte-exact; their metadata is not extracted into suggestions or public data. Audit uses a finite projection, not whole-row snapshots. |
| Other tabs | Preserve every source/destination conjunction. A promotion banner needs Projects E plus current scoped Promotions E and valid membership. No header, category or client processing claim grants authority. |
| Shared surfaces | Suggestions do not enter public payloads, JSON-LD, exports/DW, RAG, assistant tools/citations/history or provider inputs. Explicitly used and ordinarily saved draft values follow existing content rules. Thumbnails, private previews and worker image input use stored bytes. |
| Endpoints / SQL | Existing routes, one finite upload-context header and explicit private evidence opt-in. Exactly two new FORCE-RLS relations, four bounded `hub_app` entries and six owner-only helpers. |
| Rollout | Additive only: no historical backfill, byte/asset/identity/rights/timestamp/publication rewrite, permission rows or hosted changes. Historical rows without provenance retain their existing behavior. Runtime acceptance for the verification obligations below remains pending; already recorded port-free checks retain their stated scope. |

### Context, classification and admission

`POST /v1/admin/assets` retains its raw body, `Content-Type` and encoded `X-Filename`. Require exactly one `X-Upload-Context`: printable ASCII JSON object, at most 2,048 bytes, integer `v:1`, exact fields below. Reject duplicate headers/keys, missing/extra keys, arrays/nested objects, control characters and non-finite values. String values are 1..200 printable ASCII characters; opaque references are preserved without URL decoding. Canonicalize `knowledge.candidate_id` and non-null `disclosure.ref` as UUIDs. Only category and `disclosure.ref` may be null; `media_target.target_key` is required and non-null. Forward the header explicitly through CORS and the Next proxy.

| `kind` | Exact members besides `v,kind` | Upload authority and finite values |
| --- | --- | --- |
| `intake` | none | Existing upload disjunction; actor-owned never-bound private intake. No object or coordinate lookup. |
| `project` | `ref,category,purpose` | Projects E for that project; purpose `media,hero,thumbnail,master_plan,floor_plan,brochure`. |
| `brand` | `ref,purpose` | Brands E for that brand; purpose `logo_primary,logo_white,logo_mono,favicon`; PDF is invalid. |
| `model` | `project_ref,ref,category,purpose` | Projects E and current model membership; purpose `model_image,floor_plan,structural_plan`. |
| `commercial_type` | `project_ref,ref,category,purpose` | Projects E and current commercial-type membership; purpose `media,floor_plan,unit_plan,structural_plan`. |
| `media_target` | `project_ref,target_type,target_key,category,usage` | Projects E plus existing `media_target(...,'edit')`; type `project,commercial_type,facility,feature,place,promotion,article,building_floor,selling_point,disclosure`; usage `hero,thumbnail,gallery,card,banner,evidence`. Existing resolver still rejects unsupported/inactive targets. Promotion additionally requires scoped Promotions E, `promotion_ad` and `banner`. |
| `disclosure` | `project_ref,ref` | Projects E; existing disclosure UUID must belong to this project, or null denotes a new draft. Always private-exact. |
| `knowledge` | `candidate_id` | Existing asset candidate and effective project set; Knowledge E or Knowledge A under the corresponding W6 guard. Category comes only from validated candidate evidence. |

A non-null category must be an exact `hub.media_categories()` value. Null/unknown category, legal_document, disclosure evidence/target or structural_plan is private-exact. Brand logo purposes are the finite category-independent image exception; no logo category is invented. Brochure purpose requires PDF; hero/thumbnail reject PDF. Explicit intake is the only contextless path; never downgrade an unauthorized supplied object to intake. Resolve coordinates and active vocabulary only after authority succeeds. Do not accept coordinates, actor IDs, permissions, hashes, suggestions, processing claims or context stamps from HTTP.

| Immutable class | Input | Stored result |
| --- | --- | --- |
| `private_exact` | Existing 10 MiB; raster 40M pixels; PDF 200 pages | Byte-exact, <=10 MiB; existing invalid/active/animated checks; no extracted suggestions; private permanently for this identity. |
| `marketing_raster` | PNG/JPEG/WebP <=30 MiB and 100M pixels | <=10 MiB; orientation/sRGB, no upscale, <=4096px edge, metadata removal and the exact format/small-file/PNG quality rules in section 8.6. |
| `marketing_pdf` | <=50 MiB, 200 pages | <=20 MiB; safe complete metadata/history rewrite even without recompression gain; same page count/text; active checks on input/output. |
| `sanitized_svg` | Existing <=2 MiB bound | Existing sanitizer/output bound; no raster processing or suggestions. |

MiB is 1,048,576 bytes. Reject SVG for legal/disclosure/structural-plan/unknown/intake contexts; sanitization is not byte-exact legal retention. Stored readers use stored limits. Do not widen unrelated archive/memo/import/evidence limits.

Authenticate and resolve context in a short transaction before stream/body access. One non-queued proxy slot covers receipt through upstream response; one API slot covers receipt, lookup, processing/extraction, final recording and installation. Busy returns 429 `upload_busy`, `Retry-After: 1`, `Cache-Control: no-store` before body read. Ordinary reads remain usable. Hashing, decoding and extraction run off the event loop without an open transaction. Final stored-file verification and installation run off-thread inside the final transaction and stored-checksum lock. Cancellation retains admission until the worker finishes, then discards/cleans up; release on every failure. This is process-local admission, not a cross-worker guarantee. Later hosted review must address worker count, request limits and measured memory; no hosted setting is changed here.

### Private schema and finite processor contract

Exactly two relations, both ENABLE/FORCE RLS, one owner-only `upload_owner` policy per relation (`USING(true) WITH CHECK(true)`). Revoke all direct privileges from PUBLIC, hub_app, editor, publisher, viewer, admin, online_staff, agency, service_consumer, hub_media_worker and hub_translation_worker. No app read policy/view, third relation, retention job or staging table.

| Relation | Columns and constraints |
| --- | --- |
| `hub.asset_upload_sources` | `id uuid` PK/default generated; `original_checksum text` required lowercase SHA-256; `processing_class text` required closed four-class enum; `original_size bigint` required 1..52,428,800 with class ceilings enforced by recorder; required `original_mime text` in the five MIME types; paired positive `original_width,original_height integer`, null exactly for PDF; `asset_id uuid` required FK to assets, delete RESTRICT; required `pipeline_version text` matching `[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`; `processing jsonb` object <=2,048 bytes; required `created_at timestamptz` default clock_timestamp and authenticated `created_by uuid`. UNIQUE(original_checksum,processing_class); index(asset_id). |
| `hub.asset_upload_evidence` | `id uuid` PK/default generated; required `source_id uuid` FK, delete RESTRICT; `context jsonb` canonical object <=2,048 bytes; required `extraction_version text` with the same identifier bound; required `proximity text` in near/far/unknown; `suggestions jsonb` object <=32 KiB; required `created_at timestamptz` default clock_timestamp and authenticated `created_by uuid`. Index(source_id,created_at DESC,id DESC). |

Both relations reject UPDATE/DELETE through existing `hub.reject_version_change()` via `upload_immutable`. Every authorized extraction appends evidence, even for repeated source/context/version; current coordinates/vocabulary may have changed. Sources have no original filename/bytes, suggestions or coordinates. Stored hash/MIME/size/dimensions remain on assets; different originals may share one compatible stored asset. Actual encoding version is immutable.

The recorder accepts backend-derived objects only:

- `original`: exactly `checksum,size,mime_type,width,height`, all required; image dimensions positive/paired, PDF dimensions null.
- `stored_metadata`: only `original_filename,mime_type,storage_path,checksum,file_size,asset_type,width,height,language,storage_bucket,storage_provider`, <=4,096 bytes. New registration retains existing required filename/MIME/path/hash/size/type/dimension and environment storage validation; language/default th and storage fields retain existing optional rules. `source_system` is excluded and belongs only to installation. Original reuse takes these facts and filename from the actual winner.
- `processing`: required `pipeline_version,output_format,metadata_stripped`; optional `max_edge,quality,pdf_images_recompressed,kept_original_because_no_gain,kept_unchanged_legal,kept_image_encoding_because_no_gain,pdf_dpi`; no other keys, <=2,048 bytes. Output format png/jpeg/webp/pdf/svg; max_edge null/4096; pdf_dpi null/200; quality null, integer 1..100, `keep` or `lossless`; remaining flags boolean. Lift pipeline_version into its column.
- `suggestions`: exactly `{source:'file_metadata',pipeline_version,confirmed:false,values:{...}}`, <=32 KiB. Private/SVG use the full envelope with empty values, not bare `{}`. Lift pipeline_version into extraction_version and values.proximity (missing=unknown) into its column; neither stays inside stored suggestions JSON.
- Allowed values: `taken_at:{value,offset_known}` with validated ISO local datetime and optional matching offset; credit/caption <=1,000 chars; credit_evidence <=32 `{field,text}` pairs with <=500-char text and field in `exif_artist,exif_copyright,iptc_byline,iptc_credit,iptc_copyright,xmp_creator,xmp_rights,xmp_usage_terms`; stock only `present`; stock_evidence <=4 fixed codes `stock_1..stock_4`; image_kind photo/render; tags <=30 active codes; unmapped_keywords <=64 strings of <=80 chars. Unknown/ambiguous tags stay text, never automatic vocabulary proposals. PDF keeps caption only; private/SVG values stay empty.
- Plain text only: reject/remove excluded contact/path/control data and raw tool/camera identifiers. Never retain raw GPS/distance, serials, contact details, face regions, edit histories, paths/user/computer names, embedded previews, PDF author/creator/producer/dates or decoder messages in evidence, audit, logs or responses. Non-project contexts never inspect GPS; authorized project coordinates produce only near/far/unknown, freshly derived from supplied original bytes.

Revalidate active tags on display and ordinary save. Use into the existing date field keeps the source calendar date without inventing time/offset. The ordinary credit save limit remains 500 characters; Use must not silently truncate. File suggestions never auto-confirm metadata, rights or publication.

### SQL entries, private helpers and projections

Only these four new exact signatures receive EXECUTE TO `hub_app`:

```sql
hub.asset_upload_context(context jsonb, mime text) returns jsonb
hub.find_uploaded_asset_source(original_checksum text, original_mime text, context jsonb) returns jsonb
hub.record_asset_upload_source(stored_metadata jsonb, original jsonb, processing jsonb,
  suggestions jsonb, context jsonb, expected_context_stamp text) returns jsonb
hub.asset_upload_evidence(asset_uuid uuid, context jsonb) returns jsonb
```

The six new owner-only signatures have no runtime EXECUTE:

```sql
hub.asset_upload_resolve_context(context jsonb, action text, mime text) returns jsonb
hub.require_asset_upload_use(asset_uuid uuid, use_kind text, category text, external_use boolean) returns void
hub.asset_upload_has_stock(asset_uuid uuid) returns boolean
hub.asset_upload_audit() returns trigger
hub.asset_upload_use_guard() returns trigger
hub.register_uploaded_asset_for_upload(metadata jsonb) returns jsonb
```

Close PUBLIC and every non-owner copied/default grant on all ten signatures before granting the four entries. Definers use `search_path=pg_catalog,pg_temp`, qualified names and closed dispatch; no overload/default alternatives, caller actor/role/SQL or dynamic relation choice. Resolver action is only upload/view/rights; use_kind is only metadata/binding/disclosure/public/job. Validate JSON in SQL as well as API. These EXECUTE grants create no business permission.

**Retain `hub.register_uploaded_asset(jsonb)` and its existing ACL/10 MiB behavior** for legitimate legacy/operator historical byte-exact paths. The new owner-only registration helper copies the existing guarded definition and changes only its internal PDF stored ceiling to 20 MiB; the recorder validates class/output first. The shared asset table permits PDFs up to 20 MiB and retains 10 MiB for other MIME types and the existing nullable legacy metadata. The recorder still enforces 10 MiB for private-exact PDFs and 2 MiB for sanitized SVGs; direct-write privileges do not change. The W9 HTTP upload route uses the new recorder. No historical caller is closed and no old row needs fabricated provenance.

`asset_upload_context` returns backend-only canonical context, derived class/ceilings, authorized coordinates/vocabulary and SHA-256 context_stamp. `find_uploaded_asset_source` independently reauthorizes context and asset access: null when unmapped, otherwise `{source_id,asset,pipeline_version,processing,original}` with the full internal stored asset and original checksum/facts; it returns no prior-context suggestions. Never serialize these internal objects to HTTP/logs.

Recorder return is `{asset,reused,reuse_kind,upload}`, with reuse_kind none/stored/original. POST retains `data` and `meta.reused`; `meta.upload` is exactly:

```text
source_id, evidence_id,
original {size,mime_type,width,height}, stored {size,mime_type,width,height},
pipeline_version, extraction_version, processing, suggestions
```

The private projection restores only categorical proximity inside suggestions.values. It adds no original checksum, storage path, coordinates, context or stamp. The existing asset DTO retains its existing fields. Reuse reports the actual winner's stored facts/version. `GET /v1/admin/assets/{asset_id}` opts in using X-Upload-Context; no header means the existing DTO without file evidence. No new route/query convention or generic private-row join.

Evidence reads first require current asset access and the supplied current finite context's View, with the existing Knowledge A rights fallback plus complete current binding project set. Matching then uses stable owner: same brand, same Knowledge candidate, or same project across project-family contexts, ignoring mutable purpose/category/usage. Intake stays exact actor and never-bound. Recheck original model/commercial/disclosure existence and membership; original media target View and promotion View must still succeed. Skip inaccessible/removed original targets. Return latest authorized evidence by created_at/id, or null if no owner evidence matches. Another project can never contribute evidence/proximity; a UUID alone never authorizes access.

Audit uses AFTER INSERT `upload_audit` on both private relations, NULL before_row and these exact after_row keys:

| Relation | Keys | Fixed reason |
| --- | --- | --- |
| sources | `id,asset_id,processing_class,pipeline_version,original_size,original_width,original_height` | `upload_recorded` |
| evidence | `id,source_id,extraction_version,proximity,stock_present,owner` | `file_evidence_extracted` |

owner is canonical context minus category/purpose/usage. No suggestion text, original filename/checksum, whole context or parser message. Do not attach generic whole-row audit. Both private relations are excluded by workspace_history_contexts and content_row_visible, so generic history/activity/assistant/export surfaces gain no read path.

### Identity, concurrency and storage

1. After authorized admission and bounded receipt, hash original bytes and lookup original+class before encoding. On a hit, verify supplied original facts and actual stored bytes; reuse identity and encoding version. Extract fresh current-context suggestions from supplied original without encoding or installation; never copy another context's proximity.
2. On a miss, process once, then finalize under current ACTIVE account/scope/context/vocabulary checks. Compare the backend context stamp; changed facts reject before persistence. Locks are actor/scope, resolved context and vocabulary, source advisory key `upload-source:<class>:<original hash>`, then stored checksum. Never acquire source while already holding stored lock, and never retain transaction locks during body receipt/admission wait/decoding.
3. Recheck the original winner under the source lock. A concurrent winner is authoritative: discard candidate output, lock/verify its actual stored bytes, return its metadata/version and never install losing bytes. Different originals with the same compatible stored output get separate source mappings/private evidence.
4. Stored winners require current asset access, matching stored facts and identical class across every association. Authorized incompatible class raises P0091 `upload_class_conflict`; a historical stored winner with no mapping raises P0092 `legacy_provenance_collision`. Neither mutates historical bytes/rows/rights/publications or backfills provenance. Hidden winners retain non-disclosing denial.
5. Registration/source/evidence and final no-overwrite installation share the final transaction/stored lock. Preserve checksum/length verification. On proven rollback remove only an owned unregistered installation; retain private orphan bytes if commit status/DB is ambiguous. Never delete a shared winner.

SQL 40001 `upload_context_changed` maps to HTTP409 with that stable code; P0091/P0092 map to HTTP409 `upload_identity_conflict`. Invalid SQL metadata/use invariants retain 23514/422, scoped denial 42501/403 and hidden/unavailable P0002/404. Malformed context rejects before body; busy is 429, invalid declared length 400, unsupported MIME 415 and oversize 413. Preserve stable Thai copy in docs/47 section 8.5, access invalidation and no raw parser/SQL details. Retry extraction only outside a transaction when appropriate; never persist stale proximity under a newly resolved context.

### Later use, Knowledge and historical installations

`upload_class_guard` calls the owner-only use helper BEFORE UPDATE on `hub.assets`, and BEFORE INSERT OR UPDATE on exactly `hub.entity_assets,hub.brand_assets,hub.commercial_type_assets,hub.asset_links,hub.media_links,hub.project_disclosures,hub.knowledge_asset_links`. Existing W6 commands/RLS remain responsible for authorization. Assets with provenance cannot change stored checksum/size/MIME/dimensions/path/bucket. Private-exact stays internal with marketing_publication false; optimized/sanitized files cannot become legal_document or disclosure/structural-plan evidence. The guard respects actual target/role and existing source/destination permissions across ordinary and workflow commands.

`can_read_asset` adds private/legal class restriction without replacing W6: the existing actor-owned never-bound upload exception remains; after binding require Projects E/A on an actual authorized project binding, including while media_category is null. This adds no read authority. `hub.public_asset_file`, `public_api.asset_file`, the existing owner-only public_content_payload mapper and publication_dependency_check exclude private-exact. `media_job_allowed` adds class eligibility while preserving requester, Projects E, asset-edit/scope, revision, MIME/category, publication and exposure checks at request/claim/dispatch. Job payload remains finite and uses stored bytes, never evidence. No brand-job shortcut.

Stock eligibility considers all retained associated source evidence, not just latest visible evidence/image_kind. The existing scoped Knowledge lock/link/approval path rechecks stock; a draft image_kind edit cannot clear it. Pack GET calls existing lock_knowledge_asset only for otherwise eligible candidates when the caller has Knowledge A, in a short independent transaction per candidate. Scoped denial/change yields only bulk_rights_eligible=false. No decoder/storage work or raw evidence is added to the pack; these deliberate short read locks add no grant.

Future Knowledge installations use the same admission/context/original-first processor and recorder, checking immutable candidate raw SHA separately from stored output identity. Register/install each bounded source before one final atomic rights batch; a later failure may leave an unapproved private upload, never partial rights approval. Recheck candidate revision, evidence, stock and existing authority at finalization. Only recorder-proven legacy stored collision with raw=validated=stored SHA and reused=true may retain the existing byte-exact registry path. Unknown new category stays private and cannot enter an external Knowledge link; current review controls do not provide an authorized category. An explicit owning/category context is a later user step, not an inferred bypass.

Fixed synthetic seeds, already linked/registered historical assets and immutable historical transfer packages keep their identity/lifecycle. Real future operator uploads use the W9 API/pipeline and their existing authority. No timestamps/markers are invented to exempt new assets. Class/use guards return the original behavior when no W9 provenance exists; historical publication does not depend on a backfill.

### Finite inventory and verification obligations

Existing HTTP surfaces remain classified by content_permissions.py and the reviewed route manifests: GET/POST `/v1/admin/assets`; GET `/v1/admin/assets/{asset_id}` and its `/file,/thumbnail`; POST its `/review`; GET `/v1/assets/{asset_id}/file`; project media GET, media asset/link PUT and media job POST/GET; existing project/model/commercial-type/brand asset POST/removal routes; content-workflow exposure/save/review/publication; disclosure writes; Knowledge rights approval. Their current source/destination predicates remain unchanged.

Database inventory adds only the two relations/policies, ten exact functions, two immutable triggers, two audit triggers and eight class-guard attachments above. `tests/permissions/upload-optimization-db.json` and `test_upload_permission_inventory.py` provide the finite extension; preserve frozen historical manifests. Existing registration ACL remains unchanged.

Required source coverage includes SQL `upload_optimization.sql`, real contention `concurrent_upload_optimization.mjs`, API upload admission/optimization/pipeline/routes/inventory, committed asset lifecycle, worker/thumbnail privacy, Knowledge installation/pack eligibility, existing W6 byte/revocation/scope/history/publication/export/assistant tests, and UI upload result/metadata Use/rights/tagging/admission cases. The lead must reconcile final hashes and real results for:

- Runtime hub_app deny/neighbor, Knowledge A-only intake, closed helpers/direct DML/FORCE RLS, suspended/external and exact scope boundaries.
- Pre-body context/authority, declared/streamed ceilings, single admission/cancellation, final revocation/context/vocabulary changes, and cancellation/storage cleanup.
- Original reuse/version stability; same-original race winner and distinct-original/same-output mapping; class/legacy collisions; unchanged old bytes/identities/rights/timestamps/publication; no stranded locks.
- Persistent current-owner evidence with changed purpose/category; cross-project/proximity isolation and inaccessible original targets; individual rights fallback and stock bulk exclusion.
- Excluded sentinels in stored bytes/private DB/audit/API/logs; populated public and worker outputs; generic history, public/JSON-LD/export/DW/RAG/assistant/citation/provider exclusions; stored-thumbnail privacy; active-tag and ordinary save boundaries.
- Owner fixtures, per-file UI results, 1280/390 light/dark views, fixture image/PDF storage averages, appropriate quick checks and the final documented DB/API/UI/typecheck/offline-build/H1 full gate before W9 delivery.

**Runtime and full-gate status: see docs/48 and its linked receipts.** No UAT run/pass, commit, push, migration application or hosted rollout is asserted by this card. The privacy evidence map distinguishes direct W9 tests from compositional downstream coverage; test source is not runtime proof.

Preparation history uses these explicit paths (main paths are relative to the main checkout root, not to `docs/`):

- Main: `artifacts/unified-workspace/w9/route-lead-review-20261112.md`.
- Main: `artifacts/unified-workspace/w9/admission-review-20261112.md`.
- Main: `artifacts/unified-workspace/w9/upload-protocol-draft.md`.
- Main: `artifacts/unified-workspace/w9/provenance-integration-notes.md`.
- Isolated worker: `D:/Personal/workspace/sena_hub_wt/w9-contract-final/artifacts/worker-preparation/report.md`.
- Isolated worker: `D:/Personal/workspace/sena_hub_wt/w9-contract-final/artifacts/worker-preparation/w9-privacy-evidence-map-20261113.md`.
- Isolated worker: `D:/Personal/workspace/sena_hub_wt/w9-contract-final/artifacts/worker-preparation/w9-privacy-evidence-map-20261113.json`.
- Isolated worker: `D:/Personal/workspace/sena_hub_wt/w9-contract-final/artifacts/worker-preparation/w9-privacy-tests-handoff-20261113.md`.

Those reports explain preparation chronology; this consolidated appendix is the final contract. New requests for historical backfill/byte replacement, public legal files, broader authority or cross-worker admission require separate scope. No new owner decision is introduced here.

## W9.1 input admission and supervised processing — 18 November 2026

**No permission change.** Owner-approved new-input resource limits and child
isolation use the existing shared upload route and owning tab/context. View,
Edit, Approve, agencies, external users, denied/neighbor scopes and Knowledge
rights fallback are unchanged. No account, grant, catalog, route, schema,
migration or published projection is added. Authority/context are resolved
before admission/body receipt and rechecked by the existing recorder before
installation. Original reuse preserves stored identity/version and current
access. No database transaction is held during decoding.

Header rejection is 422 with the fixed Thai copy in docs/47 §8.5. Busy remains
429 with Retry-After: 1 and no-store, with zero queue. One OS slot across local
API processes sharing storage lasts until the child is reaped. The child has
no settings, DB or storage credentials; bounded IPC carries only authorized
input/context/result. Existing byte/active-content/privacy checks and stored
thumbnail failure behavior remain. No hosted change or capacity acceptance
is asserted; full-route, isolation, cancellation, disposal and final API gates
must be recorded before product delivery.

The approved admin 429 retry is client-only (60-second retry window); the
server still has zero queue. Retry-After is exposed to the existing allowed
admin origin. Authentication, invalidation and all non-429 errors retain their
existing handling. No permission change.

The W9.1 admin-proxy correction sends the Hub API namespace directly to its
existing guarded route handler, avoiding the page proxy's truncated body clone.
Identity/cookie refresh, route/query allowlists, CSRF, scope rechecks, upload
admission and byte limits remain in that handler. Existing response-specific
cache directives are retained. Explicit empty DELETE/OPTIONS responses preserve
the framework's status, body and Allow behavior while adding no-store; bare
/api/hub keeps its original page-proxy handling. No permission change.

### Home projection 0094 — no permission change

The private missing-fact helper replaces only the composition call inside the
existing home task loop. Existing entry guards, source visibility and public
composition are unchanged. No grant, role, permission bit or API contract is
added. The helper is revoked from PUBLIC and included in the private-function
inventory and direct-call denial checks; the original home ACL is preserved.
