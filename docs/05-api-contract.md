# 05 — Published Content API

> **ขอบเขตปัจจุบัน:** Hub เตรียมข้อมูลจาก Marketing และ enterprise DW เพื่อส่งเนื้อหาและ asset ที่อนุมัติแล้วให้เว็บไซต์เชิงพาณิชย์และ AI ผ่าน API ทีม Hub รับผิดชอบ field mapping, เอกสาร/ตัวอย่าง API, test consumer, change feed, signed webhook และการช่วยเชื่อมต่อฝั่ง Hub ทีมเว็บไซต์รับผิดชอบ frontend, โค้ดเรียก API/cache ในเว็บไซต์, hosting, locale UI, SEO rendering และการเปิดเว็บไซต์ ทดสอบการส่งมอบข้อมูลได้ผ่าน API client และ controlled consumer harness ดู [REQUIREMENTS](../REQUIREMENTS.md) และ [แผนส่งมอบ](07-delivery-plan.md)

## 1. สิ่งที่ปรับจากแผนเดิม

| แผนเดิม | ปัญหา | ข้อเสนอ |
|---------|-------|---------|
| `GET /projects/{project_id}` | กำกวมว่า `project_id` คือ REM ID หรือ public ID | ใช้ `public_project_id` เป็น canonical path; REM ID อยู่เฉพาะ staff API ตาม D4 |
| ไม่มี versioning ใน path | breaking change จะทำให้เว็บพังทันที | `/v1/...` + นโยบาย deprecation 30 วัน |
| ไม่มี delta / change feed | consumer ต้อง poll ทั้งชุด | `GET /v1/changes?since=` + webhook |
| ไม่มี endpoint สำหรับ entity resolution | chatbot map ชื่อที่ลูกค้าพิมพ์ไม่ได้ | `GET /v1/resolve?q=` |
| ไม่มี endpoint promotion | P0 | `GET /v1/promotions` ([04](04-promotions.md)) |
| ไม่มี preview | "Preview ก่อนเผยแพร่" ระบุไว้แต่ไม่มีกลไก | `?version_id=` + signed preview token |

## 2. Endpoint

### Implemented published model/asset reads — 2 October 2026

After the local brand slice, the next bounded core increment adds:

```http
GET /v1/projects/{public_project_id}/models
GET /v1/projects/{public_project_id}/assets?role=hero
GET /v1/models/{public_model_id}
GET /v1/models/{public_model_id}/assets?role=floor_plan
```

All four require `service_consumer` and read only the existing eligible
`public_api.projects` immutable snapshot. A model has no independent publication
pointer: its metadata's `entity_version`/`published_at` identify the containing
project release. Model detail adds that frozen `public_project_id` as context.
Draft edits never supply names, specifications, bindings or files. An unavailable
parent project (including source/brand/rights withdrawal) makes all child reads
return 404. Unknown IDs also return 404; source IDs are never path aliases.

Project assets return only bindings with no `public_model_id`; model assets require
the exact frozen public model ID. Preserve frozen order, role, Thai alternative
text and asset metadata. The optional exact role filter accepts project roles
`hero`, `thumbnail`, `master_plan`, `floor_plan`, `brochure`, or model roles
`model_image`, `floor_plan`, `structural_plan`, respectively. Unsupported or duplicate
query parameters and wrong-scope roles return 422. Metadata, no-store caching and
file-access controls remain those of the existing published-project API. These
routes grant no new table, asset-file or staff permission.

Verification on 2 October: 45 focused consumer-boundary/snapshot/scope/filter
tests passed; the full API suite passed with **1,272 passed, 11 skipped** and one
existing Starlette deprecation warning. Twelve read-only requests against the
local eligible synthetic fixture verified one project, one frozen model, two
project assets, an empty model-media collection, matching release metadata and
404 responses for unpublished/unknown identities. No data migration or content
write was required; the prior brand slice's database, build and browser results
remain recorded in [28 — DW brands and published content](28-dw-brands-and-published-content.md).

This closes four missing read paths in **API-02**, not the whole core acceptance
gate. Amenities and Marketing Unit Types in migrations `0010`/`0011` remain private
draft catalogue data: no current public snapshot freezes their reviewed content.
They are not returned through these endpoints or substituted for canonical models.
Their release/lineage/rights contract must precede consumer exposure. Spatial,
narrative, FAQ/nearby/compliance, locale fallback, wider filters, source sync and
change-feed/webhook gaps also remain; the full endpoint list below is the target
contract, not a claim that every listed path has been implemented.

### สำหรับ Consumer (read-only, `service_consumer`)
```http
GET /v1/brands
GET /v1/projects?brand=&product_type=&status=&bedrooms=&price_max=&near_transit=&page=
GET /v1/projects/{public_project_id}
GET /v1/projects/{id}/structure          # tree: เฟส/ตึก/ชั้น/โซน
GET /v1/projects/{id}/models
GET /v1/projects/{id}/assets?role=
GET /v1/projects/{id}/facilities
GET /v1/projects/{id}/nearby
GET /v1/projects/{id}/content            # content_sections
GET /v1/projects/{id}/faqs
GET /v1/projects/{id}/compliance
GET /v1/models/{public_model_id}
GET /v1/models/{id}/assets
GET /v1/promotions?project_id=&model_type_id=&brand_id=
GET /v1/campaigns/{code}
GET /v1/resolve?q=เสนาแถวรังสิต          # entity resolution สำหรับ chatbot
GET /v1/changes?since={cursor}           # delta feed
GET /v1/knowledge/feed?since=            # เฉพาะ rag_eligible
# proxy ไปยัง REM — Hub ไม่เก็บ
GET /v1/projects/{id}/availability        # แนบ data_freshness เสมอ
GET /v1/projects/{id}/pricing
```

### สำหรับ Admin (service role, server-side เท่านั้น)
```http
POST   /v1/admin/assets
POST   /v1/admin/assets/from-url          # mirror-on-ingest
PATCH  /v1/admin/{entity}/{id}
POST   /v1/admin/publish-sets             # สร้าง release
POST   /v1/admin/publish-sets/{id}/publish
POST   /v1/admin/publish-sets/{id}/rollback
POST   /v1/admin/crosswalk/{id}/confirm
GET    /v1/admin/drift
POST   /v1/admin/import                   # bulk CSV/XLSX
```

## 3. Response Envelope — บังคับทุก endpoint

```jsonc
{
  "data": { /* ... */ },
  "meta": {
    "version": "v1",
    "entity_version": 14,
    "published_at": "2026-09-20T10:00:00+07:00",
    "data_freshness": "unknown",       // Public reads omit private REM lineage
    "locale": "th",
    "is_fallback_locale": false,
    "fallback_indicator": {            // บอก consumer ว่าอะไรไม่ครบ
      "missing": ["hero_image"],
      "use_placeholder": true
    },
    "cache_ttl": 900
  }
}
```

`fallback_indicator` สำคัญ: แผนเดิมพูดถึง "fallback เมื่อข้อมูลไม่ครบ" แต่ไม่ได้บอกว่าใครตัดสิน
→ **Hub เป็นคนบอก** ว่าอะไรขาดให้ consumer ใช้ตาม contract การนำไปแสดงในเว็บไซต์เป็นงานของทีม consumer ภายนอก

## 4. การบังคับ "Published เท่านั้น" ที่ระดับ DB

Consumer reads execute guarded functions that apply the explicit public-field
allowlist to eligible frozen versions:

```sql
select * from public_api.read_projects();
select * from public_api.read_brands();
select * from public_api.read_promotions();
```

These functions require an ACTIVE authorized reader. Drafts never supply public
content. Source eligibility, current rights, publication pointers and expiry still
gate the underlying views. The raw `public_api.projects/brands/promotions` views
are internal inputs; `service_consumer` and `hub_app` have no direct SELECT grant.
Do not grant SELECT on all tables in `public_api`. See migration
`202610210057_public_content_boundary.sql` for the implemented boundary.

## 5. Change Feed + Webhook (P0-9)

```http
GET /v1/changes?since=2026-09-20T10:00:00Z&types=project,promotion
```
```jsonc
{ "changes": [
    {"entity_type":"promotion","entity_id":"...","op":"expired","at":"..."},
    {"entity_type":"project","public_id":"...","op":"published","version":15,"at":"..."}
  ],
  "next_cursor":"..." }
```

Webhook ไปยัง consumer ที่ลงทะเบียน (ลงลายเซ็น HMAC):
`content.published` · `content.rolled_back` · `promotion.activated` · `promotion.expired` · `asset.replaced`

**กติกา Hub:** `promotion.expired` ต้องยิงภายใน 60 วินาทีหลังหมดอายุ และส่ง cache contract ที่ไม่เกิน 300 วินาทีหรือข้ามวันตาม REQUIREMENTS ทดสอบด้วย endpoint และ cache client ที่ควบคุมได้ ส่วนการ purge cache ของเว็บไซต์จริงเป็นหน้าที่ของ consumer ภายนอก ไม่ใช่งานพัฒนาในโครงการนี้

## 6. Security

- **API key แยกต่อ consumer** (website / chatbot / partner) — เพื่อ revoke แยก, วัด usage แยก, และ rate limit แยก
- Service Role Key ใช้ฝั่ง server เท่านั้น (ตามแผนเดิม — ถูกแล้ว)
- Asset ที่ต้องคุมสิทธิ์ใช้ signed URL TTL 15 นาที, asset สาธารณะเสิร์ฟผ่าน CDN
- Preview token: JWT อายุ 30 นาที ผูกกับ `version_id` + user
- Idempotency-Key บังคับบน admin POST ทุกตัว
- Rate limit: อ่าน 600 req/min ต่อ key, เขียน 60 req/min

## 7. การส่งมอบข้อมูลให้ทีมเว็บไซต์

ตาม `API-17` / `A-21` ทีม Hub และทีมเว็บไซต์ตรวจสัญญาข้อมูลร่วมกันก่อน core Hub handoff วันที่เป้าหมาย 16 ต.ค. โดยไม่ต้องรอสร้างหรือเปิดเว็บไซต์จริง

| สิ่งส่งมอบของ Hub | หลักฐาน |
|---|---|
| Field mapping และ content checklist | ระบุ field ที่เว็บไซต์ต้องใช้, source owner (DW/Marketing), entity/API path, required/optional, ข้อมูลที่ยังขาดและผู้รับผิดชอบสำหรับ 7 โครงการ |
| Rich content และ asset ที่เผยแพร่แล้ว | ตัวอย่าง response ของ project/model, รายละเอียด/FAQ, รูป/แปลน/brochure, โปรฯ และ legal terms, SEO metadata และ locale/fallback พร้อม stable ID, version และ freshness |
| เอกสารและตัวอย่างใช้งาน API | Versioned API schema และคำสั่งที่ทำซ้ำได้สำหรับอ่านข้อมูล, authentication, pagination/filter, errors, expiry/cache, change feed และ HMAC webhook; ไม่ใส่ secret จริงในเอกสาร |
| Consumer onboarding และผลทดสอบ | เตรียม restricted test consumer ตามสิทธิ์เดิม ทดสอบ published-only/expiry/cache/webhook ด้วย harness และบันทึกผล review/ข้อบกพร่องของข้อมูลหรือ API ให้ทีม Hub แก้ |

Marketing เติมข้อมูลและสื่อที่ตนเป็นเจ้าของผ่าน back office ส่วน enterprise facts ที่ผิดส่งให้เจ้าของ source แก้ ข้อมูลบังคับที่ขาดยังคงขวาง publication; ช่องว่าง optional ระบุไว้ใน contract ทีมเว็บไซต์นำข้อมูลไป render และดูแลโค้ด integration ของตนเอง การจัดเตรียมข้อมูลไม่รวมการสร้าง page builder หรือเว็บไซต์เชิงพาณิชย์ใน Hub


## Readiness decision — 7 October 2026

The product owner split publication requirements from recommended completeness. The [current contract](31-readiness-and-review.md) supersedes earlier model-blocking rules in this document. Models never block publication; only confirmed models with complete required specs enter new versions. Optional media with pending/expired rights is omitted. Existing versions remain immutable. `model_catalogue_complete` is frozen in new project payloads and appended as a nullable boolean in `hub_export.project_published` (NULL for older versions). Draft fact cards expose current completeness; published fact cards use the frozen value. Incomplete/unknown catalogues cause a chatbot handoff for room/specification questions.
## Staff project progress summary (6 October 2026 follow-up)

`GET /v1/admin/projects/progress` returns a server-filtered page: `rows`, `total`,
`page`, `size`, `pages`. Parameters: `page` (1+), `size` (1–50, default 10), `q`,
`status` (tile key), `rem_status` (exact raw code or `null`), `other` (default false),
`brand`, `group`, `group_state`. Order: publishable first, completeness descending,
then exact REM ID. `view=counts` returns independent tile/status counts and brand
options; `view=groups` returns a paginated group summary. `detail=<exact REM ID>`
returns the cached checklist for one expanded row. List responses omit checklist
arrays/model lists. Source-only details aggregate model checks as counts.

`GET /v1/admin/sources/projects` returns source summaries/counts and flags, without
Gold model lists or private price fields. Detail/prefill endpoints retain their
existing evidence contract. `GET /v1/admin/assets/{id}/thumbnail` serves only a
pre-generated private 96px WebP with existing staff file authorization. Missing or
unsupported derivatives return 404; clients use initials, never the original.
No consumer payload or publication gate is changed. See docs/32 for cache refresh
and performance measurements.

Marketing-group follow-up: `group` filters the exact accepted Gold marketing ID;
`group_state` is `marketing_reference`, `conflict` or `missing`. `view=counts` also
returns group ID/Thai-name options and `group_mismatch_count`. Rows include the
marketing name, immutable intake/snapshot provenance, dictionary issue flags and
exact REM/marketing mismatch boolean. `view=groups` includes `name_th`. These are
staff-only source summaries; no group membership or consumer contract changes.


## Public-field boundary — 21 October 2026 (programme Phase 1, D4)

This implemented contract supersedes the older proposal to return REM identities.
`read_projects()`, `read_brands()` and `read_promotions()` expose explicit
customer-facing allowlists from eligible immutable versions. All nested brands,
models and media are projected too. No website reference text, internal UUIDs,
REM identities/source records, publisher identities, rights evidence or original
filenames leave these consumer reads. Public version numbers and publication
timestamps remain. Unknown future payload keys are excluded by default.

Project/model media use `public_asset_id` and `public_url`; stored file URLs are
`/v1/assets/ast_<64 lowercase hex characters>/file`. The identifier is the immutable
file checksum, or a digest of the identity for legacy URL-only media. Legacy
approved URLs without UUIDs remain available. Old UUID file paths are rejected.
Binary reads retain existing published eligibility, current-rights checks and
no-store headers, with a public-ID filename.

The raw eligibility views remain internal inputs for staff and the DW exporter;
consumer/application roles cannot SELECT them. Public HTTP routes use guarded
read functions. Internal reference data and historical snapshots are preserved.
Staff publication comparisons use the same projection, with existing permission
redactions applied first; a partial comparison cannot be confirmed in the UI.
See [the programme design](41-project-content-and-faq.md).

## Private project content and FAQ drafts — Phase 2

All routes below retain staff authentication, no-store responses and the live
tab-capability checks. Exact method/path coverage is recorded in
`tests/permissions/project-content-routes.json`; no broad path prefix grants
authority. `Draft` writes take `{expected_revision, changes}`, reject unknown
top-level fields and limit the changes object to 40 fields / 64,000 characters.
SQL validates each command's allowed fields and rechecks the source scope.
Stale revisions return 409; absent objects 404; denied authority 403; invalid
content 422. Submitted FAQ/narrative text is immutable; editing creates a new
draft. These APIs do not publish website content.

| Route family | Methods and authority |
|---|---|
| `/v1/admin/content/fields` | GET with Projects, Brands or Knowledge V; PATCH `/{field_key}` needs explicit `projects.manage_field_catalog` and ACTIVE internal admin |
| `/v1/admin/content/email-domains/{domain}` | PUT with the same registry-admin guard; expected revision + active/retired |
| `/v1/admin/content/translations/{id}/review` | POST with exact original source E, expected revision, Thai version, English; requires unchanged source and preserved numbers/slots |
| `/v1/admin/content/translations/{id}/retry` | POST with exact source E; only the failed current draft can return to the queue |
| `/v1/admin/content/glossary` | GET Knowledge V; PUT `/{term_key}` Knowledge E; POST `/{term_key}/approve` Knowledge A and another version author |
| `/v1/admin/projects/{public_id}/content` | GET Projects V: facts, local REM observations, derived values, buildings, section/point history, contacts, English and private readiness |
| Project `/facts/{key}`, `/buildings/{key}`, `/sections/{key}` | PUT Projects E; facts also take an explicit grain. REM/computed fields cannot be typed; overrides need a reason |
| Project `/sections/{key}/submit` | POST Projects E + current reviewed English; freezes the version for review |
| Project `/selling-points` | POST Projects E; PUT `/{point_id}` appends a version; maximum six current points |
| Project and brand `/contacts` | POST scoped E; PUT `/{contact_id}` with expected revision. GET via scoped `/content` |
| `/v1/admin/faq/corporate-contacts` | GET Knowledge V; POST and PUT `/{contact_id}` Knowledge E |
| `/v1/admin/faq/questions` | GET Knowledge V; PUT `/{question_key}` proposes with E; POST `/{key}/approve` uses A and editor separation |
| `/v1/admin/faq/references` | GET Knowledge V; minimal local names/IDs for exact scope/phase pickers, no neighboring draft data |
| `/v1/admin/faq` | GET list with Knowledge V; POST with E; GET/PUT `/{faq_id}` for detail/history/sources/English and append-only drafts |
| `/v1/admin/faq/{faq_id}/submit` | POST Knowledge E; approved question, reviewed required English and explicit applicability; no publication |

Corporate scope is `corporate:sena`; project applicability uses exact REM phase
IDs from local references. Rules remain disabled until Phase 6. The staff FAQ
preview renders escaped text from the authorized detail payload; fact slots
remain visible placeholders at this stage. Legacy intake rows are copied into
new versions without changing their original fields or reviews. A later source
rejection withdraws its active derived draft and preserves the history.

Email accepts any valid domain and requires a shared/company-mailbox confirmation
(Q76, owner decision 22 October 2026). Free webmail triggers an advisory UI warning,
never a save block; existing four-eyes publication approval remains required.
The legacy email-domain registry command is retired: authorized calls return 422
without a write, and the field catalog no longer exposes an email-domain allowlist.
Social channels require matching HTTPS provider hosts. Legal documents, finance
facts, contacts and source evidence never enter translation requests. Financial
FAQ topics use manual English. Worker claim/finish RPCs are closed to the API
role; the worker cannot approve text or publish content.

## Private project media — Phase 3

The exact thirteen routes in `tests/permissions/media-routes.json` use the same
bounded Draft/revision contract, live permissions and no-store responses. They
do not publish media. `/media?project=<public_project_id>` opens the project
workspace; its context pickers contain only actual, authorized records.

| Route | Authority and behavior |
|---|---|
| `/v1/admin/media/tags` | GET Projects V; PUT `/{code}` Projects E proposes; POST `/{code}/approve` Projects A with a different author activates/retires |
| `/v1/admin/media/requirements` | GET Projects V; PUT `/{key}` Projects A; only project hero/thumbnail can block publication |
| `/v1/admin/projects/{public_id}/media` | GET Projects V returns authorized assets/bindings, clips, context and computed checklist |
| Project media `/assets/{id}` | PUT Projects E plus E for every shared source tab; controlled tags, bilingual metadata and editorial confirmation; rights unchanged |
| Project media `/links/{id}` | PUT Projects E, real target and revision; POST `/remove` soft-deletes; promotion targets also need Promotions E |
| Project media `/clips/{id}` | PUT Projects E saves a draft/withdrawal, real targets and optional private thumbnail; title may be completed after provider fetch |
| Project media `/clips/{id}/check` | POST Projects E records a manual link result with expected revision |
| Project media `/jobs` | GET Projects V; POST Projects E with kind, subject ID and expected source revision; only eligible images or current clips can queue |

Asset tags use a foreign-key join, returned as `tags[]`. Batch uploads reuse the
existing sanitization, size limits and file identity; per-card retries preserve
successful files. New links never replace legacy hero/thumbnail, brand, model
or commercial-type bindings. Facilities permit many images with one cover.
Building/storey targets validate known floors and skipped floors. Promotion
banner dates are clamped to the promotion window. Coverage respects rights,
confirmation, effective dates and capture age; missing floor counts remain
unknown. Only hero and thumbnail are mandatory media; other gaps feed the
recommended readiness score and contextual upload links.

Legal files are private to Projects E/A, cannot be reclassified or enter legacy
publication bindings, and never enter AI. Image suggestions are separate from
confirmed metadata; model/time/source revision are retained. Unknown suggested
tags remain proposals. Clip provider metadata is separate from editorial text;
broken/private/removed clips are hidden and reported in the checklist. Worker
completion rejects stale leases, changed sources and revoked authority. The API
role cannot claim, complete or schedule worker jobs.

Feature/place/article/disclosure target kinds remain unavailable until their
owning phases provide real guarded references. No placeholder content or public
endpoint is introduced here. Provider and local worker details are in
[doc 11](11-local-development.md#local-marketing-media-worker-project-content-phase-3).

## Programme Phase 5 — unit review and Marketing prices

The existing commercial-type create/patch and asset-binding routes keep their
project revision checks. Added draft fields are category, special rooms,
ceiling height, furniture package, highlights, price mode and AI exposure.
Asset bindings accept a controlled room tag, bilingual caption and house floor
number. Counts, availability, source amounts and approval state are never
client-editable fields. `rem_auto` is disabled.

All paths below start with `/v1/admin/projects/{public_id}`. Each write requires
`updated_at` from the current project. The API and SQL independently enforce
Projects V/E/A; unknown fields fail closed.

| Method / suffix | Permission / result |
|---|---|
| GET `/unit-types` | V: types, readiness/history, staff-only REM comparison, prices, translations and tours |
| POST `/commercial-types/{commercial_id}/submit` | E: freeze a complete type version for review |
| POST `/commercial-types/{commercial_id}/review` | A: `approve`, `return` or `withdraw`; a version editor cannot approve |
| POST `/prices` | E: create a Marketing price draft |
| PUT `/prices/{price_id}` | E: save price details within the same project |
| POST `/prices/{price_id}/submit` | E: freeze complete price text and validity for review |
| POST `/prices/{price_id}/review` | A: `approve`, `return` or `withdraw`; a version editor cannot approve |

Prices require kind, type, amount, basis size, localized display/basis/conditions,
and `valid_from`/`valid_to` no more than 60 days apart. English is reviewed through
the existing translation endpoint; price text never queues an AI job. REM
comparison values are read from the snapshot and a difference warns without
blocking submission or approval. Promotion references additionally require
Promotions V and must cover the same project and price dates.

Submitted type/price payloads are immutable. Changes after approval create a new
draft and retain prior snapshots. The private composition helper excludes
expired, withdrawn, hidden and internal prices at read time. No public website
endpoint changes in this phase. Type snapshots exclude REM identities/counts,
internal UUIDs, internal/Legal/structural media and unconfirmed or unapproved
assets. Tour editorial authors join the type's four-eyes check; tour saves and
type submissions serialize on the project revision lock.
## FAQ intake from existing candidates — Phase 4

Staff-only, no-store routes with live Knowledge checks. Exact coverage is recorded
in `tests/permissions/faq-intake-routes.json`. Nothing here publishes content.

| Route | Methods and authority |
|---|---|
| `/v1/admin/faq-intake/clusters` | GET Knowledge V. Optional single-value filters `state` (open, held, question_proposed, decided), `level`, `kind`, `hold` (a hold code or `none`), `brand` (REM brand ID), keyset `after` (sort key) and `limit` 1–100. Returns cards, `next_after`, `filtered_total`, progress `counts`, brand facets and the latest generation |
| `/v1/admin/faq-intake/clusters/{cluster_id}` | GET Knowledge V: question variants with source URL/reference, answer groups with exact REM phases and closed-status flags, suggestion, existing FAQ identities for the suggested key, decision history |
| `/v1/admin/faq-intake/clusters/{cluster_id}/decision` | POST Knowledge E with `{expected_revision, decision, changes}`; `decision` is `create`, `reject`, `hold` or `propose_question`. Stale revisions return 409 |

`create` takes `changes.answer` (Phase 2 FAQ fields: approved `question_key`,
scope, Thai question/short answer/detail, explicit `applies_to_project_ids`) and
optional `candidate_ids` and `faq_id` (to append a version to an existing answer
for the same question and scope). It calls `hub.save_faq`, records every chosen
candidate in `hub.faq_sources` with the cluster ID and leaves the answer as a
draft. Rejection and hold need a note; holds take a hold code. `propose_question`
creates a proposed question through `hub.save_faq_question`; the existing
Knowledge A approval activates it (D6). A 422 `intake_rule` carries a Thai reason:
commercial/numeric source text accepted unchanged, selling content for a closed
REM phase, unresolved Q70 programme or unsafe-text holds, missing explicit phases,
a duplicate answer identity, or a cluster that is already decided.

## C5 project commercial records and real promotions (Phase 9)

Existing Projects V/E/A applies to these exact routes:

| Method | Route | Purpose |
|---|---|---|
| GET | `/v1/admin/projects/{public_id}/commercial` | Structured records, comparisons, readiness, translations and frozen history; Legal evidence only for E/A |
| POST | `/v1/admin/projects/{public_id}/commercial/{kind}` | New identity, `{updated_at, record}` |
| PUT | `/v1/admin/projects/{public_id}/commercial/{kind}/{record_id}` | Edit draft with current project timestamp |
| POST | `/v1/admin/projects/{public_id}/commercial/{kind}/{record_id}/submit` | Freeze current revision, `{updated_at}` |
| POST | `/v1/admin/projects/{public_id}/commercial/{kind}/{record_id}/review` | Independent A decision, `{updated_at, decision: approve\|return\|withdraw}` |

`kind` is `disclosures`, `sales-terms`, `programmes` or `construction`, also
specified as the discriminator inside `record`. Unknown/source/approval fields
are rejected. Programme units cannot be entered. Mismatched project timestamps
fail with 409. No public C5 endpoint is introduced before Phase 8.

`GET /v1/admin/promotions/references` requires Promotions V and supplies bounded
project/type and brand picker references with their corresponding source V.
Existing create/patch promotion routes add `audience`, `targets: [{type,id}]`,
and paired `booking_from/to`, `transfer_from/to` dates. Create also accepts
`synthetic` (default true for existing clients; the admin UI sends false for a
real row). Targets accept only project, brand or commercial_type UUIDs from
authorized pickers. Draft reads include manual English-review records.

Existing promotion publication keeps the environment guard, DATA + LEGAL
reviews, source-offer eligibility, expiry and stacking. Real rows require
reviewed English and a different author/reviewer/publisher. Public promotion
payloads add audience, date windows, public scope IDs and rights-filtered banner
assets; internal UUIDs and editor/source identifiers remain private. Each
resolved project gets its own eligible promotion response. Legal documents
never appear in this output.
