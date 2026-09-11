# 07 — แผนส่งมอบที่ปรับใหม่

## 1. ปัญหาของแผนเดิม: วางงานแบบแนวนอน

แผน Codex เรียงงานเป็น `freeze schema → ตั้ง Supabase → สร้าง Admin → สร้าง API → test`
ซึ่งแปลว่า **ไม่มีอะไรทำงานได้จนถึงสัปดาห์สุดท้าย** และ 28–29 ก.ย. คือวันแรกที่จะรู้ว่าพลาดตรงไหน — เหลือเวลาแก้ 1 วัน

จากวันนี้ (11 ก.ย. 2026) ถึง MVP เหลือ **19 วัน**

## 2. ข้อเสนอ: Vertical Slice ก่อน แล้วค่อยขยาย

```mermaid
gantt
    dateFormat YYYY-MM-DD
    axisFormat %d %b
    section Track 0 — Content (เริ่มวันนี้)
    Intake template + เก็บข้อมูล 7 โครงการ  :active, c1, 2026-09-11, 12d
    Bulk import + ตรวจความครบถ้วน           :c2, 2026-09-23, 5d
    section Track 1 — Vertical Slice
    Slice: 1 โครงการวิ่งครบ chain            :crit, v1, 2026-09-11, 5d
    section Track 2 — ขยายความกว้าง
    Schema เต็ม + Admin CRUD                :s1, 2026-09-16, 7d
    Asset Library + bulk upload             :s2, 2026-09-18, 5d
    Promotion + Campaign                    :s3, 2026-09-21, 5d
    section Track 3 — Publish & API
    Versioning + Publish/Rollback           :p1, 2026-09-21, 5d
    Public API + change feed                :p2, 2026-09-23, 5d
    section Track 4 — ปิดงาน
    E2E + UAT 7 โครงการ                     :crit, t1, 2026-09-28, 2d
    MVP Acceptance                          :milestone, m1, 2026-09-30, 0d
```

### Track 1 — Vertical Slice (11–15 ก.ย.) ⭐ สำคัญที่สุด
เป้าหมาย: **1 โครงการ วิ่งครบเส้นทางภายใน 5 วัน**
```
เลือกจาก REM → สร้าง project → อัปโหลด 1 รูป → publish → GET /v1/projects/{id} คืนค่าถูกต้อง
```
ทำด้วย schema แค่ 5 ตาราง (`brands`, `projects`, `assets`, `entity_assets`, `entity_versions`)
**คุณค่า:** รู้ปัญหาเรื่อง auth, RLS, storage, CORS, deployment ตั้งแต่วันที่ 5 แทนวันที่ 18

### Track 0 — Content Intake (เริ่มวันนี้ ขนานกับทุกอย่าง) ⭐
**Critical path จริงของโครงการนี้คือข้อมูล ไม่ใช่โค้ด**
ข้อมูล 7 โครงการ = 7 project × (~3 เฟส + ~6 model type + ~40 asset) ≈ **300+ record และ 300+ ไฟล์**

ทำทันทีโดยไม่ต้องรอ Admin UI:
1. Excel/Google Sheet template ที่ column ตรงกับ schema เป๊ะ ๆ
2. โฟลเดอร์ Drive ที่มี **naming convention บังคับ** เช่น
   `{PROJECT_CODE}__{level}__{ref}__{role}__{seq}.{ext}`
   ตัวอย่าง `KITH-RSU__model__TYPE-A__floorplan__01.jpg`
3. เก็บข้อมูลไปเรื่อย ๆ ระหว่างทีม dev สร้างระบบ → พอ import พร้อมก็เทเข้าได้เลย

> ถ้าไม่ทำข้อนี้ ต่อให้ระบบเสร็จ 27 ก.ย. ก็จะไม่มีข้อมูลให้ demo วันที่ 30

## 3. Descope Levers (เรียงตามลำดับที่ควรตัดก่อน)

ถ้าถึง 23 ก.ย. แล้วงานไม่ทัน ให้ตัดตามลำดับนี้ — **อย่าตัดแบบสุ่มตอนวันที่ 29**

| ลำดับ | ตัดอะไร | ทดแทนด้วย | ความเสี่ยงที่รับ |
|-------|---------|-----------|------------------|
| 1 | เนื้อหาภาษาอังกฤษ | ทำ schema i18n ไว้ กรอกแค่ `th` | ต่ำ — เว็บ EN เลื่อนได้ |
| 2 | Renditions อัตโนมัติ | ใช้ Supabase Image Transformation on-the-fly | ต่ำ — แค่ช้ากว่า |
| 3 | Drag-drop เรียงรูป | กรอก `display_order` เป็นตัวเลข | ต่ำ — แค่ UX แย่ลง |
| 4 | Preview แบบ signed token | publish ขึ้น staging environment แทน | กลาง |
| 5 | REM Drift Inbox | รันรายงาน drift ส่งอีเมลรายวัน | กลาง |
| 6 | Content Gap Queue | เลื่อนไป Phase 2 | ต่ำ (แต่เสียดาย) |
| 7 | Admin UI ของ Facility/Nearby | ใช้ Supabase Studio กรอกตรง | กลาง |

**ห้ามตัดเด็ดขาด:** REM crosswalk · atomic publish + rollback · published-only view · promotion legal approval · model type attributes
(ทั้ง 5 อย่างนี้ ถ้าตัดแล้วจะกลายเป็นหนี้ทางเทคนิคที่ต้องรื้อทั้งระบบภายหลัง)

## 4. Definition of Done ที่แก้ไขแล้ว

### Digital Hub MVP (30 ก.ย.)
เพิ่มจากรายการเดิม — ข้อที่ **ตัวหนา** คือข้อใหม่:
- [ ] Marketing จัดการ content + asset ได้เอง ครบ 7 โครงการ
- [ ] รองรับ Upload / Paste URL / เลือกจาก Library — **และ URL ที่ paste ถูก mirror เข้า Hub แล้วทุกไฟล์ (ไม่มี external URL หลุดออก public API)**
- [ ] REM Name กับ Public Name แยกกัน และ **ทุก record มี REM anchor (crosswalk confirmed 100%)**
- [ ] **Model Type มีสเปกครบ (ห้องนอน/ห้องน้ำ/พื้นที่) ทุกแบบใน 7 โครงการ**
- [ ] **Publish เป็น release เดียวแบบ atomic และ rollback ได้จริง (พิสูจน์ด้วยการทดสอบ rollback)**
- [ ] Draft / Archived / Expired ไม่หลุด public API — **พิสูจน์โดยทดสอบด้วย consumer role จริง ไม่ใช่แค่ code review**
- [ ] **Promotion resolve ถูกต้องทั้ง 5 scope + exclude list + หมดอายุอัตโนมัติ (ทดสอบด้วยการเลื่อนเวลา)**
- [ ] **Change feed + webhook ทำงาน: promo หมดอายุแล้วเว็บอัปเดตภายใน 5 นาที**
- [ ] **Completeness gate บล็อก publish ได้จริงเมื่อ required field ไม่ครบ**
- [ ] มี Publish owner + หลักฐาน acceptance ต่อโครงการ

### RAG Pilot (31 ต.ค.)
- [ ] ใช้เฉพาะเอกสารที่ publish แล้ว — **บังคับด้วย view ไม่ใช่ด้วยโค้ด**
- [ ] **Re-index เป็น delete-then-insert และ reconcile job ไม่พบ orphan chunk**
- [ ] คำตอบมี citation + version + **URL ที่คลิกกลับหาต้นทางได้**
- [ ] **Cross-project leakage = 0% และ volatile-answer rate = 0% บน golden set**
- [ ] **Recall@5 ≥ 0.90, citation precision ≥ 0.95**
- [ ] ไม่มีข้อมูลลูกค้าเข้า vector store — **บังคับด้วย DB constraint**
- [ ] มี Human handoff และ **no-answer ถูก log เข้า content gap queue**
- [ ] ผ่าน UAT ครบ 7 โครงการ

## 5. ความเสี่ยงหลักและวิธีลด

| ความเสี่ยง | โอกาส | ผลกระทบ | วิธีลด |
|-----------|:-----:|:------:|--------|
| **ข้อมูลเก็บไม่ทัน** — critical path จริง | สูง | สูง | เริ่ม Track 0 วันนี้ + bulk import + naming convention |
| REM API ไม่พร้อม / ไม่มี sandbox | กลาง | สูง | ทำ mock adapter หลัง interface เดียวกันตั้งแต่ slice แรก |
| Schema เปลี่ยนหลัง freeze (15 ก.ย.) | กลาง | สูง | หลัง freeze อนุญาตเฉพาะ additive migration; ใช้ `attrs jsonb` รับ field ที่ยังไม่แน่ |
| โปรฯ หมดอายุแล้วยังโชว์ | กลาง | **สูงมาก (กฎหมาย)** | expired เกิดจาก view + cache TTL ≤ 300s + webhook purge |
| รูปซ้ำ / ลิงก์ตาย | สูง | กลาง | checksum dedup + mirror-on-ingest + link health job |
| Admin ใช้ยากจน Marketing ไม่ใช้ | กลาง | สูง | ให้ Marketing ลองใช้ slice จริงตั้งแต่ 16 ก.ย. ไม่ใช่รอ UAT |
| RAG ตอบข้ามโครงการ | กลาง | สูง | metadata pre-filter บังคับ + scope lock + adversarial test set |
| 30 ก.ย. เป็นวันตายตัว | สูง | กลาง | descope levers ที่ตัดสินใจล่วงหน้าแล้ว (§3) |

## 6. สิ่งที่ควรตัดสินใจภายในสัปดาห์นี้

1. **7 โครงการคือโครงการไหน** — ต้องระบุชื่อ ไม่ใช่จำนวน
2. **REM เชื่อมต่อได้อย่างไร** — API / DB replica / export ไฟล์ และมี sandbox หรือไม่
3. **ใครเป็น Publisher และใครเป็น Legal approver** — ระบุตัวบุคคล
4. **รองรับกี่ภาษาใน MVP** — th อย่างเดียว หรือ th+en
5. **เว็บที่จะ consume คือเว็บปัจจุบันหรือเว็บใหม่** — กระทบเรื่อง slug/redirect โดยตรง
6. **เจ้าของ content ต่อโครงการ** — เพื่อให้ notification และ review cadence มีปลายทาง
