# SENA Digital Hub & AI Knowledge Platform

ศูนย์กลางข้อมูลโครงการและ Digital Assets ที่ทำหน้าที่เป็น **Source of Truth เดียว**
รวบรวมข้อมูลจาก Marketing และข้อมูลธุรกิจผ่าน DW เพื่อเตรียมและเผยแพร่ข้อมูลคุณภาพให้เว็บไซต์เชิงพาณิชย์ขององค์กรและ AI Chatbot โดยทีมเว็บไซต์รับผิดชอบตัวเว็บไซต์

**Current scope (15 September 2026): build the Thai back office and rich content platform for SENA residential — 7 pilot projects — to feed the enterprise commercial websites and SENA AI pilot.** The Hub collects enterprise data through DW and Marketing content through forms, uploads and imports, then validates, enriches, approves and publishes it. It owns content/assets/promotions, stored SEO and locale metadata, APIs and the website data handoff, including Hub-side integration support. The separate website team owns commercial page design, frontend code, hosting, rendering and launch. All internal staff are Thai-speaking; the interface and default authoring language are Thai. Solar is entirely deferred to Phase 2 after October. EV, LivNex and other non-residential BUs are also outside Phase 1; no cross-BU workspace or generic product framework is required now.

Planning targets: **30 September — one-project internal pilot · 16 October — core residential Hub · 30 October — SENA AI pilot**. Phase 2 has no committed launch date. These targets replace the earlier combined September MVP and depend on acceptance checks and the staffing/access assumptions in [REQUIREMENTS §1.3](REQUIREMENTS.md#13-delivery-milestones) and [the delivery plan](docs/07-delivery-plan.md). The requirements take precedence over historical examples elsewhere in `docs/`.

```mermaid
flowchart LR
    REM[("Enterprise facts<br/>REM")] --> DW[("Existing DW")]
    DW --> HUB
    MKT["Marketing<br/>Thai back office · forms · uploads"] --> HUB
    HUB[("Digital Hub<br/>Validate · enrich · approve")] --> API["Published content and assets<br/>API and integration handoff"]
    HUB --> RAG["RAG Index"]
    API --> WEB["Enterprise commercial websites<br/>built by the website team"]
    API --> BOT["Chatbot"]
    RAG --> BOT
```

## Requirements

**[REQUIREMENTS.md](REQUIREMENTS.md)** — implementation specification in English, self-contained,
with numbered testable requirements (P0/P1/P2), acceptance criteria and open questions.
ส่งให้ engineering agent หรือทีม dev ได้โดยไม่ต้องอ่านเอกสารอื่นประกอบ

## เอกสารออกแบบ

| เอกสาร | เนื้อหา |
|--------|---------|
| [00 — รีวิวแผน Codex และช่องว่าง](docs/00-executive-review.md) | สิ่งที่แผนเดิมทำถูก, ช่องว่าง P0/P1/P2, ข้อเสนอ 10 อันดับแรก |
| [01 — สถาปัตยกรรม Source of Truth](docs/01-source-of-truth.md) | หลักการ 7 ข้อ, **System of Record Matrix**, consumer contract |
| [02 — Data Model](docs/02-data-model.md) | schema ที่เพิ่ม: spatial tree, model type spec, versioning, i18n |
| [03 — **User Flows**](docs/03-user-flows.md) | Setup Wizard 10 ขั้น, Asset Library, Promotion, REM Drift, Publish, Chatbot routing |
| [04 — Campaign & Promotion](docs/04-promotions.md) | scope corporate/brand/project/model, include–exclude, กฎ resolve |
| [05 — Published Content API](docs/05-api-contract.md) | endpoint, response envelope, change feed, security |
| [06 — RAG](docs/06-rag.md) | แก้บั๊ก stale chunk, hybrid retrieval ภาษาไทย, eval metrics |
| [07 — แผนส่งมอบ](docs/07-delivery-plan.md) | vertical slice, descope levers, DoD, ความเสี่ยง |
| [08 — **Promotion: REM + Ads**](docs/08-promotion-integration.md) | เชื่อม Promotion 7,676 รายการจาก REM, แยก Offer ออกจาก Public Promotion, เชื่อมกับการลงทะเบียน Ads |
| [09 — **Ads Registry**](docs/09-ads-registry-integration.md) | อ่าน Google Sheet ของทีม content แบบไม่แก้ไฟล์, เชื่อมด้วย URL ปลายทาง, UTM กับ Meta campaign id |
| [10 — **Tech Stack**](docs/10-tech-stack.md) | FastAPI, Supabase, Thai admin บน Next.js/Vercel, pgvector, OpenAI, deployment และ CI |

## สรุปสั้นที่สุด

**แผนเดิมวางโครงถูกแล้ว 6 เรื่อง** — แยก Hub/RAG, REM name ≠ public name, asset registry กลาง,
published-only API, routing table ของ chatbot, และมี out-of-scope ที่ชัดเจน

**ช่องว่างที่ต้องปิดก่อนเริ่มเขียนโค้ด (P0):**

1. ไม่มี schema ของเฟส / ตึก / ชั้น / โซน
2. ไม่มี attribute ของ Model Type (ห้องนอน พื้นที่ ที่จอดรถ) → chatbot ตอบคำถามหลักไม่ได้
3. ไม่มี data model ของโปรโมชั่นเลย
4. ไม่มี versioning / atomic publish / rollback
5. RAG pipeline ไม่มีขั้นตอนลบ chunk เก่า
6. ไม่มี System of Record Matrix
7. `paste_url` ไม่มีนโยบาย mirror → ลิงก์ตาย
8. ไม่มี i18n
9. ไม่มี change feed / cache invalidation → โปรฯ หมดอายุยังโชว์
10. ไม่มี REM drift detection

## Repository ที่เกี่ยวข้อง

- `sena_digital_hub_mkt` (ที่นี่) — schema, Admin, Storage, Published API, RAG ingestion
- `sena_ai_chatbot_mkt` — Chat UI, routing, structured tools, retrieval client, handoff
