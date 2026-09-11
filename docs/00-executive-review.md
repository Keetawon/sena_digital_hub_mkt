# 00 — รีวิวแผน Codex และช่องว่างที่ควรปิด

> เอกสารนี้รีวิวแผน **SENA Digital Hub & AI Knowledge Platform** ฉบับ Codex
> โดยยึดวัตถุประสงค์หลัก: *เป็น Source of Truth เดียวสำหรับ Website, Chatbot และ Consumer อื่น ๆ*

---

## 1. สิ่งที่แผนเดิมทำถูกแล้ว (ควรคงไว้)

| # | ประเด็น | เหตุผลที่ถูก |
|---|---------|--------------|
| 1 | แยก **Digital Hub (ต้นทาง)** ออกจาก **RAG (ดัชนีที่ derive มา)** | RAG เป็น index ไม่ใช่ database ถ้าปนกันจะแก้ข้อมูลไม่ได้และ audit ไม่ได้ |
| 2 | **REM Name ≠ Public Name** และห้ามเขียนทับ REM | นี่คือหัวใจ ถ้าเขียนทับจะ reconcile กับ REM ไม่ได้ตลอดไป |
| 3 | **Asset Registry กลาง + polymorphic `entity_assets`** | รูปหนึ่งใบผูกได้หลายบริบท ถูกต้องตามหลัก DAM |
| 4 | **Published-only API + effective date** | กัน Draft/Expired หลุดออก public |
| 5 | **ตาราง Routing: คำถามไหนไป Structured API คำถามไหนไป RAG** | เป็น architectural instinct ที่ถูก — ราคา/ห้องว่าง/โปรฯ ต้องไม่มาจาก RAG |
| 6 | **มี Out-of-scope list ชัดเจน** | วินัยที่ดีสำหรับ deadline 19 วัน |

---

## 2. ช่องว่างระดับ P0 — ไม่ปิดแล้ว "Source of Truth" ไม่เกิดจริง

| # | ช่องว่าง | ผลกระทบ | แก้ที่ไหน |
|---|----------|---------|-----------|
| **P0-1** | **ไม่มี schema ของ Phase / Building / Floor / Zone** — แผนพูดถึงใน Asset Hierarchy แต่ไม่เคยนิยามตาราง ทั้งที่ user flow ขั้นที่ 3 ต้องใช้ | Admin กรอกข้อมูลเฟส/ตึก/ชั้นไม่ได้ แนบ floor plan / ผังหมู่บ้านไม่ได้ | [02 §3](02-data-model.md) `hub.project_nodes` |
| **P0-2** | **ไม่มี attribute ของ Model Type เลย** (ห้องนอน, ห้องน้ำ, พื้นที่ใช้สอย, เนื้อที่ดิน, ที่จอดรถ) แผนมีแค่ crosswalk ชื่อ | Chatbot ตอบ *"แบบบ้าน 3 ห้องนอนมีไหม"* / *"ห้อง 35 ตร.ม. มีแบบไหน"* ไม่ได้ — ซึ่งเป็นคำถามอันดับต้น ๆ ของลูกค้า | [02 §4](02-data-model.md) `hub.model_types` |
| **P0-3** | **ไม่มี Promotion / Campaign model เลย** มีแค่คำว่า "Approved Promotion API" กับ asset_role `promotion` | โปรโมชั่นคือสิ่งที่ลูกค้าถามมากที่สุดและมีความเสี่ยงทางกฎหมายสูงสุด | [04](04-promotions.md) |
| **P0-4** | **ไม่มี Versioning / Atomic Publish / Rollback** มีแค่ status column (`Draft→Published→Archived`) | แก้ 5 จุดแล้ว publish ทีละจุด = เว็บเห็นข้อมูลครึ่ง ๆ กลาง ๆ / พลาดแล้วย้อนกลับไม่ได้ | [02 §9](02-data-model.md) `entity_versions` + `publish_sets` |
| **P0-5** | **RAG pipeline ไม่มีขั้นตอนลบ chunk เก่า** (ข้อ 8 เขียนแค่ "บันทึกใน pgvector") | เอกสารแก้แล้ว chunk เดิมยังอยู่ → bot ตอบข้อมูลเก่าปนใหม่ หา root cause ยากมาก | [06 §4](06-rag.md) |
| **P0-6** | **ไม่มี System of Record Matrix** ว่า field ไหนใครเป็นเจ้าของ | "Source of Truth" ยังเป็นสโลแกน ไม่ใช่สัญญา — ทีม website จะแอบ hardcode ข้อมูลเอง | [01 §2](01-source-of-truth.md) |
| **P0-7** | **`paste_url` ไม่มีนโยบาย mirror** | ลิงก์จากระบบเดิม/Drive/Canva ตาย → เว็บรูปแตก และ Hub ไม่ได้เป็นเจ้าของ asset จริง | [02 §6](02-data-model.md) Mirror-on-ingest |
| **P0-8** | **ไม่มี i18n** — `public_project_name` เป็นค่าเดียว | เว็บไทย/อังกฤษทำไม่ได้ ต้องรื้อ schema ทีหลัง (แพงกว่าทำตั้งแต่แรก 10 เท่า) | [02 §2](02-data-model.md) JSONB locale |
| **P0-9** | **ไม่มี Change Feed / Cache Invalidation contract** | โปรฯ หมดอายุตอนเที่ยงคืนแต่เว็บ cache ไว้ 24 ชม. → **โฆษณาเกินจริง = ความเสี่ยงทางกฎหมาย** | [05 §5](05-api-contract.md) `GET /changes` + webhook |
| **P0-10** | **ไม่มี REM Drift Detection** — แผนบอกว่าห้ามเขียนทับ REM แต่ไม่บอกว่าถ้า REM เปลี่ยนชื่อ/ปิดโครงการแล้วจะรู้ได้ยังไง | Mapping ที่ Confirm ไว้จะเน่าเงียบ ๆ | [02 §5](02-data-model.md) + [03 Flow D](03-user-flows.md) |

---

## 3. ช่องว่างระดับ P1 — กระทบคุณภาพและต้นทุนดูแล

| # | ช่องว่าง | ข้อเสนอ |
|---|----------|---------|
| P1-1 | มี endpoint `/facilities` และ `/nearby` แต่**ไม่มีตาราง** | ทำ `hub.facilities` + `hub.facility_taxonomy` (controlled vocabulary) และ `hub.nearby_places` พร้อม `transit_line`, `distance_m` เพื่อให้ filter บนเว็บและ bot ทำงานได้แบบ structured |
| P1-2 | ไม่มี **slug / SEO metadata** | ถ้า Hub เป็น SoT ของเว็บ `slug`, `meta_title`, `meta_description`, `og_image` ต้องอยู่ใน Hub ไม่ใช่ใน repo เว็บ |
| P1-3 | `description` เป็น text ก้อนเดียว | เปลี่ยนเป็น `hub.content_sections` (section_key + markdown) → เว็บได้ section ที่จัด layout ได้ **และ RAG ได้ chunk ที่แบ่งตามความหมายโดยธรรมชาติ** (ดีกว่า chunk ด้วย algorithm มาก) |
| P1-4 | ไม่มี **asset renditions** (thumbnail/webp/หลายขนาด) | เว็บโหลดช้า → ทำ `hub.asset_renditions` หรือใช้ Supabase Image Transformation แล้วบันทึก recipe |
| P1-5 | `price_from` เป็น column ธรรมดา | ราคาเป็นข้อมูลควบคุม → เก็บเป็น snapshot + `price_as_of` + `price_source` และ API ต้องคืน freshness เสมอ |
| P1-6 | ไม่มี **Publish Readiness Gate** มีแต่ "fallback เมื่อข้อมูลไม่ครบ" | Gate ดีกว่า fallback: กำหนด required field ต่อ entity + แสดง % ความครบถ้วนใน Admin |
| P1-7 | ไม่มี **alias / entity resolution** ระดับโครงการ (มีแต่ใน model crosswalk) | Bot ต้อง map *"เสนาแถวรังสิต"* → project ได้ → `hub.entity_aliases` + `GET /resolve?q=` |
| P1-8 | Vector search ล้วน + ภาษาไทย | Postgres FTS ไม่ตัดคำไทย และ vector อ่อนกับชื่อเฉพาะ/ตัวเลข → ต้องทำ **hybrid (BM25/trigram + vector) แล้ว fuse ด้วย RRF** |
| P1-9 | Golden Question 50–100 ข้อ แต่**ไม่มี metric** | นิยาม recall@5, citation precision, groundedness, no-answer correctness + ตั้ง regression gate ก่อน reindex ทุกครั้ง |
| P1-10 | ไม่มี **bulk import** | ป้อนข้อมูล 7 โครงการด้วยมือคือ critical path จริงของ timeline → ต้องมี CSV/XLSX import + bulk asset upload ตาม naming convention |
| P1-11 | ไม่มี **legal / compliance fields** | โฆษณาอสังหาฯ ไทยต้องแสดงข้อมูลบางอย่าง → เก็บ `license_no`, `eia_status`, `land_title_no`, `ad_disclaimer` ใน Hub เพื่อให้เว็บ/bot แสดงตรงกันทุกช่องทาง |
| P1-12 | มี `rights_status` แต่ไม่มีการเตือน | สัญญานักแสดง/ช่างภาพหมดอายุ = ใช้ภาพต่อไม่ได้ → ผูก `effective_to` กับ license แล้วแจ้งเตือนล่วงหน้า 30 วัน |

---

## 4. ช่องว่างระดับ P2 — ทำทีหลังได้ แต่ควรออกแบบเผื่อ

- **Observability**: publish failure alert, broken-asset-URL checker (link health job), API latency/error budget
- **Environment strategy**: dev / staging / prod (Supabase branching) + additive-only migration หลัง freeze
- **Backup & DR**: PITR ของ DB + versioning ของ Storage bucket
- **Security รายละเอียด**: RLS policy จริง (ไม่ใช่แค่ชื่อ role), signed URL TTL, **API key แยกต่อ consumer** (website / chatbot / partner) เพื่อ revoke และวัด usage แยกกันได้, rate limit, idempotency key บน admin write API
- **Taxonomy เป็นตาราง ไม่ใช่ enum**: `asset_role`, `facility_type`, `document_type` ต้องเพิ่มค่าได้โดยไม่ต้อง migrate
- **Constraint เชิงปฏิบัติ**: partial unique index ให้ `is_primary` มีได้ 1 ค่าต่อ (entity, role); `display_order` unique ต่อ (entity, role); soft delete ทุกตาราง
- **Video/Virtual tour**: ต้องมี `provider` (youtube/vimeo/upload), `provider_video_id`, poster frame และ asset_type `virtual_tour` (360 tour เป็นมาตรฐานของอสังหาฯ แล้ว)
- **Content Gap Loop**: เก็บคำถามที่ bot ตอบไม่ได้ + หน้า 404 ของเว็บ ลงคิวให้ Marketing เห็นใน Admin → ปิดวงจรคุณภาพด้วยต้นทุนต่ำมาก

---

## 5. สรุปข้อเสนอ 10 อันดับแรก

1. **ประกาศ System of Record Matrix** เป็นสัญญาเป็นลายลักษณ์อักษร ก่อนเขียนโค้ดบรรทัดแรก
2. **เพิ่ม `project_nodes` (tree เดียวรองรับทั้ง condo และแนวราบ)** แทนการทำตาราง phase/building/floor/zone แยก 4 ใบ
3. **เพิ่ม `model_types` พร้อม attribute ที่ query ได้** — นี่คือสิ่งที่ทำให้ chatbot มีประโยชน์จริง
4. **ออกแบบ Campaign/Promotion แยกเป็นระบบย่อยของตัวเอง** พร้อม scope (corporate/brand/project/model) + include/exclude + precedence + approval 2 ชั้น
5. **ใช้ Versioned Publish (pointer flip)** แทน status column → ได้ preview, atomic release และ rollback ฟรี
6. **Mirror ทุก URL ที่ paste เข้ามา** เข้า `hub-originals` แล้วเสิร์ฟจาก Hub เสมอ
7. **ทำ i18n ตั้งแต่วันแรก** (JSONB locale, `th` บังคับ, fallback en→th) แม้จะยังกรอกแค่ไทย
8. **แก้ RAG pipeline ให้เป็น delete-then-insert ต่อ document version** + hybrid retrieval + metadata pre-filter บังคับ
9. **เปลี่ยน plan จากแนวนอนเป็น Vertical Slice** — ให้ 1 โครงการวิ่งครบ chain ภายใน 15 ก.ย. แล้วค่อยขยายเป็น 7
10. **เริ่มเก็บ content ขนานไปตั้งแต่วันนี้** ด้วย intake template — เพราะ critical path จริงคือข้อมูล ไม่ใช่โค้ด

---

## 6. ข้อสังเกตต่อ Timeline

แผนเดิมวางงานแบบ **แนวนอน** (schema → storage → admin → API → test) ซึ่งแปลว่า *ไม่มีอะไรทำงานได้เลยจนถึงสัปดาห์สุดท้าย* และวันที่ 30 ก.ย. คือวันแรกที่จะรู้ว่าพลาดตรงไหน

จากวันนี้ (11 ก.ย.) เหลือ **19 วัน** ถึง MVP — ข้อเสนอปรับแผนและ descope levers อยู่ใน [07-delivery-plan.md](07-delivery-plan.md)
