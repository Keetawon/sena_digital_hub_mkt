# 05 — Published Content API

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
→ **Hub เป็นคนบอก** ว่าอะไรขาด เว็บจึงไม่ต้องเดา และจะไม่ไปดึงรูปจากแหล่งอื่นมาแทนเอง

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

**กติกา:** `promotion.expired` ต้องยิงภายใน 60 วินาทีหลังหมดอายุ และ consumer ต้อง purge cache ทันที

## 6. Security

- **API key แยกต่อ consumer** (website / chatbot / partner) — เพื่อ revoke แยก, วัด usage แยก, และ rate limit แยก
- Service Role Key ใช้ฝั่ง server เท่านั้น (ตามแผนเดิม — ถูกแล้ว)
- Asset ที่ต้องคุมสิทธิ์ใช้ signed URL TTL 15 นาที, asset สาธารณะเสิร์ฟผ่าน CDN
- Preview token: JWT อายุ 30 นาที ผูกกับ `version_id` + user
- Idempotency-Key บังคับบน admin POST ทุกตัว
- Rate limit: อ่าน 600 req/min ต่อ key, เขียน 60 req/min
