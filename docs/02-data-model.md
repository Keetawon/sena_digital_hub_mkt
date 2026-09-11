# 02 — Data Model ที่ปรับปรุงแล้ว

> DDL ในเอกสารนี้เป็น **sketch เพื่อสื่อสารการออกแบบ** ไม่ใช่ migration จริง
> คอลัมน์มาตรฐานที่ทุกตารางมี: `created_at, created_by, updated_at, updated_by, deleted_at`

## 1. Schema Layout

| Schema | หน้าที่ | ใครเข้าถึง |
|--------|---------|-----------|
| `hub` | content + asset registry (working data ทั้งหมด รวม draft) | admin app (service role) |
| `public_api` | **views เท่านั้น** ที่ filter published + ยังไม่หมดอายุแล้ว | `service_consumer` (read-only) |
| `rag` | documents, chunks, embeddings | ingestion job + retrieval service |
| `audit` | change log, publish log, sync log | admin (read), ทุกคน (write ผ่าน trigger) |
| `staging` | landing zone ของ REM sync และ bulk import | sync job |

> **สำคัญ:** consumer role ต้องมีสิทธิ์เฉพาะ `public_api` เท่านั้น การกรอง published ทำที่ view ไม่ใช่ที่โค้ด — ป้องกัน P0 "Draft หลุด" เชิงโครงสร้าง

## 2. i18n Convention (เพิ่มใหม่ — P0-8)

ทุก field ที่แสดงต่อสาธารณะเก็บเป็น `jsonb` keyed ด้วย BCP-47 locale

```sql
-- ตัวอย่างค่า
{"th": "เสนา คิทท์ รังสิต", "en": "SENA Kith Rangsit"}
```

กติกา:
- `th` เป็น **required** — publish ไม่ได้ถ้าไม่มี
- fallback chain: ขอ `en` ไม่มี → คืน `th` พร้อม flag `is_fallback: true` ให้ consumer รู้
- helper: `hub.i18n(val jsonb, locale text) returns text` และ index ด้วย `((val->>'th'))`
- เตรียมรองรับ `zh-Hans` ในอนาคตโดยไม่ต้อง migrate

## 3. Spatial Hierarchy — ตารางเดียวรองรับทั้งคอนโดและแนวราบ (P0-1)

ปัญหา: คอนโดคือ `Phase → Building → Floor` แนวราบคือ `Phase → Zone → Plot`
ถ้าทำ 4 ตารางแยก การผูก asset จะต้องมี FK 4 ตัว และ query "ทุกแปลนในโครงการนี้" จะกลายเป็น UNION 4 ทาง

**ข้อเสนอ: adjacency tree ใบเดียว**

```sql
create type hub.node_type as enum ('phase','building','floor','zone','cluster');

create table hub.project_nodes (
  node_id          uuid primary key default gen_random_uuid(),
  project_id       uuid not null references hub.projects,
  parent_node_id   uuid references hub.project_nodes,
  node_type        hub.node_type not null,
  code             text not null,              -- 'A', 'Tower B', '12'
  name_rem         text,                       -- ชื่อจาก REM (read-only)
  public_name      jsonb,                      -- ชื่อทางการตลาด {th,en}
  name_source      text default 'rem_default', -- rem_default | marketing_override
  sort_order       int not null default 0,
  path             ltree,                      -- materialized path, maintained by trigger
  attrs            jsonb not null default '{}',
  status           hub.lifecycle_status not null default 'draft',
  unique (project_id, parent_node_id, code)
);
create index on hub.project_nodes using gist (path);
```

**`attrs` ตาม node_type** (validate ด้วย JSON Schema ในชั้น application):

| node_type | attrs ที่คาดหวัง |
|-----------|------------------|
| `phase` | `launch_date`, `completion_date`, `sales_status`, `units_total` |
| `building` | `floors_above`, `floors_below`, `units_total`, `elevators`, `building_type` |
| `floor` | `floor_number`, `units_on_floor`, `is_typical_floor` |
| `zone` / `cluster` | `plots_total`, `zone_theme` |

**กติกา parent-child** เก็บในตาราง `hub.node_type_rules` (ไม่ hardcode) เพื่อให้เพิ่มประเภทใหม่ได้ เช่น `phase→building`, `building→floor`, `phase→zone`, `zone→cluster`

**ทำไมดีกว่าแผนเดิม:** `entity_assets` ที่ Codex ออกแบบไว้ (polymorphic) ทำงานกับ tree นี้ได้ทันทีด้วย `entity_type='project_node'` — ไม่ต้องเพิ่ม entity type อีก 4 แบบ และ query "ทุก floor plan ใต้ตึก B" เป็น `path <@ 'proj.phase1.bldgB'` ครั้งเดียว

## 4. Model Type — เพิ่ม attribute ที่ query ได้ (P0-2)

แผนเดิมมีแค่ crosswalk ชื่อ ทำให้ chatbot ตอบคำถามเชิงสเปกไม่ได้เลย

```sql
create table hub.model_types (
  model_type_id     uuid primary key default gen_random_uuid(),
  project_id        uuid not null references hub.projects,
  node_id           uuid references hub.project_nodes,   -- null = ใช้ได้ทั้งโครงการ
  rem_model_id      text,                                 -- ผ่าน crosswalk
  public_model_id   text not null unique,                 -- canonical public key
  slug              text not null,
  public_name       jsonb not null,                       -- ชื่อการตลาด {th,en}
  name_source       text default 'rem_default',
  product_form      text not null,   -- condo_unit|detached|twin|townhome|home_office|shophouse|land

  -- ▼ ส่วนที่แผนเดิมไม่มีเลย และเป็นสิ่งที่ทำให้ chatbot มีประโยชน์
  bedrooms          numeric(3,1),    -- 2, 2.5
  bathrooms         numeric(3,1),
  usable_area_sqm   numeric(8,2),    -- พื้นที่ใช้สอย
  land_area_sqwah   numeric(8,2),    -- เนื้อที่ดิน (ตร.ว.) สำหรับแนวราบ
  frontage_m        numeric(6,2),    -- หน้ากว้าง
  depth_m           numeric(6,2),
  storeys           int,             -- บ้าน 2 ชั้น
  parking_spaces    int,
  ceiling_height_m  numeric(4,2),
  functional_rooms  jsonb,           -- ["ห้องพระ","ห้องแม่บ้าน","Multi-purpose"]
  highlights        jsonb,           -- จุดขายสั้น ๆ {th:[],en:[]}

  price_from        numeric(14,2),   -- snapshot เท่านั้น
  price_as_of       timestamptz,
  price_source      text,

  status            hub.lifecycle_status not null default 'draft',
  effective_from    timestamptz,
  effective_to      timestamptz
);
```

เพิ่ม `hub.model_type_variants` สำหรับแบบ A / A1 / A2 (แปลนกลับด้าน, ต่อเติมต่างกัน) เพื่อไม่ให้ต้องสร้าง model type ซ้ำทั้งใบ

**ผลลัพธ์:** คำถาม *"แบบบ้าน 3 ห้องนอน ที่จอด 2 คัน ในโครงการนี้มีอะไรบ้าง"* ตอบได้ด้วย SQL — ไม่ต้องพึ่ง RAG (ซึ่งจะตอบผิดแน่นอน)

## 5. REM Crosswalk + Drift Detection (P0-10)

คง crosswalk ตามแผนเดิม (ดีอยู่แล้ว) แต่เพิ่ม **นโยบายที่แผนเดิมไม่มี**:

```sql
alter table hub.rem_model_crosswalk
  add column source_fingerprint text,      -- hash ของ payload จาก REM
  add column drift_status text default 'in_sync',  -- in_sync|source_changed|source_missing
  add column drift_detected_at timestamptz;
```

**เกณฑ์ match_confidence ที่ต้องระบุ** (แผนเดิมมี field แต่ไม่มีนโยบาย):

| score | การกระทำ |
|-------|----------|
| ≥ 0.95 | เสนอเป็น `Suggested` พร้อม pre-tick ให้ยืนยันรวดเดียว |
| 0.75 – 0.95 | เสนอเป็น candidate ต้องเลือกเอง |
| < 0.75 | ไม่เสนอ เข้า Manual Review |

**Drift flow** — เมื่อ nightly sync พบ fingerprint เปลี่ยน:
1. ตั้ง `drift_status='source_changed'` — **ไม่แตะ `public_name` เด็ดขาด**
2. record เข้า **REM Drift Inbox** ใน Admin
3. ถ้า drift แตะ field ที่กระทบ public (เช่น REM ปิดโครงการ) → ขึ้น banner เตือนบนหน้า project
4. ถ้า `source_missing` เกิน N วัน → เสนอให้ archive (ไม่ auto-unpublish เพราะอาจเป็น sync error)

**สิ่งที่ต้องระวัง:** REM record หายไปชั่วคราวเพราะ API error ต้องไม่ทำให้เว็บล่ม → sync job ต้องแยก "หายจริง" ออกจาก "sync ล้มเหลว" ด้วยการเทียบจำนวน record รวมก่อน commit

## 6. Assets — คงโครงเดิม + เพิ่ม 4 อย่าง

โครง `assets` / `asset_sources` / `entity_assets` ของแผนเดิม**ถูกต้องแล้ว** เพิ่มเติม:

### 6.1 Mirror-on-ingest (P0-7) ⭐
เมื่อ Marketing paste URL:
1. ระบบ fetch ไฟล์เข้า `hub-originals` ทันที
2. `public_url` ชี้ไปที่ Hub เสมอ — **ไม่เคยเสิร์ฟ URL ภายนอกให้ consumer**
3. URL เดิมเก็บใน `asset_sources.source_url` เป็นหลักฐาน/ที่มา
4. ถ้า fetch ไม่ได้ (ต้อง login) → mark `ingest_method='link_only'` + เข้าคิว link health check รายสัปดาห์ + ห้าม publish เป็น `hero`/`thumbnail`

### 6.2 Renditions (P1-4)
```sql
create table hub.asset_renditions (
  rendition_id uuid primary key,
  asset_id uuid references hub.assets,
  purpose text,          -- thumb|card|hero|og|print
  format text,           -- webp|avif|jpg|pdf_page
  width int, height int,
  storage_path text, public_url text,
  page_number int,       -- สำหรับ brochure PDF → รูปรายหน้า
  unique (asset_id, purpose, format, coalesce(page_number,0))
);
```

### 6.3 Alt text ต้องอยู่ที่ความสัมพันธ์ ไม่ใช่ที่ไฟล์
รูปเดียวกันใช้เป็น hero ของโครงการและ gallery ของ model → alt text ต่างกัน
```sql
alter table hub.entity_assets add column alt_text jsonb;  -- {th, en}
-- constraint ที่แผนเดิมไม่ได้พูดถึง แต่จำเป็นมาก
create unique index on hub.entity_assets (entity_type, entity_id, asset_role)
  where is_primary and deleted_at is null;
```

### 6.4 External references เป็น first-class (แทน JD ID/Link ลอย ๆ)
```sql
create table hub.external_references (
  ref_id uuid primary key,
  entity_type text, entity_id uuid,
  system text,            -- jd|canva|drive|dam|legacy_web
  external_id text, url text, label text,
  last_checked_at timestamptz, health text  -- ok|broken|auth_required
);
```
เหตุผล: วันหน้าจะมี Canva, Drive, DAM เพิ่มแน่นอน — ถ้าใส่เป็น `jd_id`/`jd_link` ในตาราง asset จะต้อง migrate ทุกครั้ง

## 7. Content Sections — แทน `description` ก้อนเดียว (P1-3) ⭐

```sql
create table hub.content_sections (
  section_id   uuid primary key,
  entity_type  text not null,     -- project|project_node|model_type|brand
  entity_id    uuid not null,
  section_key  text not null,     -- overview|highlights|location|transport|
                                  -- design_concept|facility_story|payment|faq_intro
  heading      jsonb,
  body_md      jsonb,             -- markdown ต่อ locale
  sort_order   int,
  rag_eligible boolean default true,
  status       hub.lifecycle_status default 'draft',
  unique (entity_type, entity_id, section_key)
);
```

**ทำไมสำคัญกว่าที่คิด:** section แต่ละอันคือ **chunk ที่แบ่งตามความหมายอยู่แล้ว**
RAG จึงไม่ต้อง chunk ด้วย algorithm (ซึ่งกับภาษาไทยที่ไม่มีช่องว่างระหว่างคำจะตัดผิดบ่อย) — ได้ retrieval quality ฟรีจากการออกแบบ schema ให้ดี

## 8. Facilities / Nearby / Compliance (P1-1, P1-11)

```sql
create table hub.facility_taxonomy (          -- controlled vocabulary
  facility_code text primary key,             -- pool|fitness|co_working|ev_charger|pet_zone
  label jsonb, category text, icon text, is_active boolean default true
);

create table hub.facilities (
  facility_id uuid primary key,
  entity_type text, entity_id uuid,           -- project หรือ project_node
  facility_code text references hub.facility_taxonomy,
  detail jsonb,                               -- {th:"สระ 25 ม. ชั้น 8"}
  floor_ref text, sort_order int, status hub.lifecycle_status
);

create table hub.nearby_places (
  place_id uuid primary key,
  project_id uuid references hub.projects,
  category text,        -- transit|school|hospital|mall|park|expressway
  name jsonb,
  transit_line text,    -- BTS สุขุมวิท | MRT สีน้ำเงิน | SRT สีแดง
  distance_m int, travel_time_min int, travel_mode text,
  latitude numeric(10,7), longitude numeric(10,7),
  is_highlight boolean default false, sort_order int
);

create table hub.project_compliance (         -- โฆษณาอสังหาฯ ต้องแสดงข้อมูลบางอย่าง
  project_id uuid primary key references hub.projects,
  license_no text,            -- เลขที่ใบอนุญาตจัดสรร / เลขที่ อช.
  license_issued_at date,
  eia_status text,            -- approved|in_review|not_required
  land_title_no text,
  ad_disclaimer jsonb,        -- ข้อความกำกับโฆษณา {th,en}
  reviewed_by text, reviewed_at timestamptz
);
```

**เหตุผลของ `project_compliance`:** ถ้าข้อความกำกับโฆษณาอยู่ใน Hub เว็บ/บอท/โบรชัวร์จะแสดงตรงกันอัตโนมัติ — ถ้าไม่อยู่ ทีมเว็บจะ hardcode แล้วมันจะไม่ตรงกันภายใน 3 เดือน

## 9. Versioning + Atomic Publish (P0-4) ⭐⭐

แผนเดิมใช้แค่ status column ซึ่ง **rollback ไม่ได้ diff ไม่ได้ preview ไม่ได้**

```sql
create table hub.entity_versions (
  version_id    uuid primary key,
  entity_type   text not null, entity_id uuid not null,
  version_no    int not null,
  payload       jsonb not null,        -- snapshot เต็มของ entity ณ เวลานั้น
  change_reason text,
  created_by    text, created_at timestamptz default now(),
  unique (entity_type, entity_id, version_no)
);

-- ตัว entity เก็บแค่ pointer
alter table hub.projects add column published_version_id uuid references hub.entity_versions;

create table hub.publish_sets (            -- = release
  set_id uuid primary key, title text,
  scheduled_at timestamptz,                -- P1: scheduled publish
  published_at timestamptz, published_by text,
  status text                              -- draft|scheduled|published|rolled_back
);
create table hub.publish_set_items (
  set_id uuid, entity_type text, entity_id uuid,
  from_version_id uuid, to_version_id uuid
);
```

**Publish = flip pointer ใน transaction เดียว** → ได้ 4 อย่างฟรี:

| ได้อะไร | อย่างไร |
|---------|---------|
| **Atomic release** | แก้ 12 จุดแล้ว publish ครั้งเดียว เว็บไม่เห็นสถานะครึ่ง ๆ |
| **Rollback ทันที** | flip pointer กลับ — ไม่ต้องกู้ backup |
| **Preview** | เรียก API ด้วย `?version_id=` + signed preview token |
| **Diff / Audit** | เทียบ payload สอง version ได้ตรง ๆ ว่าใครแก้อะไร |

**Lifecycle status ที่ควรมี** (แผนเดิมมี 3 ขาด 2):
```
draft → in_review → approved → scheduled → published → expired ⟶ archived
                                              ↓ (auto เมื่อถึง effective_to)
```
`expired` ต้องเป็นสถานะที่ **เกิดเองจากเวลา** ผ่าน view ไม่ใช่รอ cron มา update (กัน P0-9 เชิงโครงสร้าง)

## 10. Publish Readiness Gate (P1-6)

```sql
create table hub.publish_requirements (
  entity_type text, field_path text, requirement text,  -- required|recommended
  applies_when jsonb                                    -- เงื่อนไข เช่น product_form='condo_unit'
);
```
Admin คำนวณ **completeness %** แบบ real-time และ **บล็อกการ publish** ถ้า required ไม่ครบ

ตัวอย่าง required สำหรับ `project`: `public_name.th`, `slug`, `address`, `lat/long`, asset role `thumbnail` + `hero`, ≥1 model type ที่ published, `compliance.ad_disclaimer`

## 11. Alias / Entity Resolution สำหรับ Chatbot (P1-7)

```sql
create table hub.entity_aliases (
  alias_id uuid primary key,
  entity_type text, entity_id uuid,
  alias text not null, locale text,
  alias_type text,       -- former_name|nickname|misspelling|transliteration|rem_name
  source text            -- marketing|search_log|chat_log
);
create index on hub.entity_aliases using gin (alias gin_trgm_ops);
```
เก็บทั้งชื่อเก่า ชื่อเล่นที่ลูกค้าใช้ และ **คำที่พิมพ์ผิดบ่อย** ซึ่งดึงมาจาก chat log ได้อัตโนมัติ → ใช้กับ `GET /resolve?q=`

## 12. Content Gap Loop (P2 แต่คุ้มมาก)

```sql
create table hub.content_gaps (
  gap_id uuid primary key,
  source text,          -- chatbot_no_answer|web_404|search_zero_result
  question text, detected_entity_type text, detected_entity_id uuid,
  occurrence_count int default 1, last_seen_at timestamptz,
  status text default 'open',   -- open|assigned|resolved|wont_fix
  assigned_to text, resolved_by_section_id uuid
);
```
ทุกครั้งที่ bot ตอบว่า "ไม่พบข้อมูล" → บันทึกที่นี่ → Marketing เห็นเป็นคิวงานใน Admin
ต้นทุนพัฒนาต่ำมาก แต่เป็นกลไกเดียวที่ทำให้ knowledge base โตขึ้นเองตามความต้องการจริงของลูกค้า

## 13. สรุปตารางที่เพิ่มจากแผนเดิม

| ตาราง | ปิดช่องว่าง |
|-------|-------------|
| `project_nodes` + `node_type_rules` | P0-1 |
| `model_types` + `model_type_variants` | P0-2 |
| `campaigns`, `promotions`, `promotion_targets` ([04](04-promotions.md)) | P0-3 |
| `entity_versions`, `publish_sets`, `publish_set_items` | P0-4 |
| `asset_renditions` | P1-4 |
| `external_references` | P2 (แทน JD field) |
| `content_sections` | P1-3 |
| `facility_taxonomy`, `facilities`, `nearby_places` | P1-1 |
| `project_compliance` | P1-11 |
| `publish_requirements` | P1-6 |
| `entity_aliases` | P1-7 |
| `content_gaps` | P2 |
| `api_consumers` | P2 |
