# 05 — Published Content API

> **ขอบเขตปัจจุบัน:** Hub เตรียมข้อมูลจาก Marketing และ enterprise DW เพื่อส่งเนื้อหาและ asset ที่อนุมัติแล้วให้เว็บไซต์เชิงพาณิชย์และ AI ผ่าน API ทีม Hub รับผิดชอบ field mapping, เอกสาร/ตัวอย่าง API, test consumer, change feed, signed webhook และการช่วยเชื่อมต่อฝั่ง Hub ทีมเว็บไซต์รับผิดชอบ frontend, โค้ดเรียก API/cache ในเว็บไซต์, hosting, locale UI, SEO rendering และการเปิดเว็บไซต์ ทดสอบการส่งมอบข้อมูลได้ผ่าน API client และ controlled consumer harness ดู [REQUIREMENTS](../REQUIREMENTS.md) และ [แผนส่งมอบ](07-delivery-plan.md)

## 1. สิ่งที่ปรับจากแผนเดิม

| แผนเดิม | ปัญหา | ข้อเสนอ |
|---------|-------|---------|
| `GET /projects/{project_id}` | กำกวมว่า `project_id` คือ REM ID หรือ public ID | ใช้ `public_project_id` เป็น canonical path, คืน `project_id_rem` เป็น attribute, รองรับ `?by=rem_id` สำหรับ internal |
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
    "source_updated_at": "2026-09-19T02:00:00+07:00",   // จาก REM
    "data_freshness": "fresh",         // fresh | stale | unknown
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

```sql
create view public_api.projects as
select p.public_project_id, p.project_id_rem, v.payload, p.updated_at
from hub.projects p
join hub.entity_versions v on v.version_id = p.published_version_id
where p.deleted_at is null
  and p.status = 'published'
  and (p.effective_from is null or p.effective_from <= now())
  and (p.effective_to   is null or p.effective_to   >  now());   -- expired หายเอง

revoke all on schema hub from service_consumer;
grant usage on schema public_api to service_consumer;
grant select on all tables in schema public_api to service_consumer;
```

> ข้อได้เปรียบ: แม้โค้ด application จะมีบั๊ก Draft ก็หลุดออกไม่ได้ เพราะ role ไม่มีสิทธิ์เห็น schema `hub` เลย

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
