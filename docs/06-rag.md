# 06 — RAG: ส่วนที่ต้องแก้จากแผนเดิม

แนวคิดหลักของแผนเดิม (RAG ตอบเนื้อหาเชิงบรรยาย, structured API ตอบข้อเท็จจริง) **ถูกต้อง** แต่ pipeline มีจุดที่จะทำให้พังจริงในการใช้งาน

## 1. บั๊กเชิงออกแบบ: ไม่มีขั้นตอนลบ chunk เก่า (P0-5)

แผนเดิม ข้อ 8 เขียนว่า *"บันทึกใน Supabase pgvector"* — ไม่มีการลบ
ผลคือเมื่อแก้ FAQ แล้ว re-index จะมี chunk เก่าและใหม่อยู่พร้อมกัน บอทจะหยิบอันไหนก็ได้ และ**ไม่มีใครรู้ว่าตอบผิดเพราะอะไร**

**แก้เป็น versioned replace ใน transaction เดียว:**
```sql
begin;
  delete from rag.knowledge_chunks
   where document_id = $1 and source_version <> $2;
  insert into rag.knowledge_chunks (...) values (...);
  update rag.knowledge_documents
     set indexed_version = $2, indexed_at = now()
   where document_id = $1;
commit;
```
บวกกับ **reconcile job รายวัน**: chunk ใดที่ `document_id` ไม่อยู่ใน `public_api` แล้ว → ลบทิ้ง (กันกรณี unpublish/archive แล้ว index ค้าง)

## 2. Retrieval ต้องเป็น Hybrid — vector ล้วนไม่พอสำหรับภาษาไทย (P1-8)

ปัญหาที่จะเจอแน่นอน:
- Postgres FTS **ไม่ตัดคำไทย** (`to_tsvector('thai', …)` ไม่มี) → BM25 แบบ default ใช้ไม่ได้
- Vector search อ่อนกับ **ชื่อเฉพาะและตัวเลข** — *"แบบ A2"*, *"35 ตร.ม."*, *"เฟส 3"* มักหลุด

**ข้อเสนอ:**
1. ตัดคำไทยตอน index (PyThaiNLP `newmm` หรือ ICU) แล้วเก็บลง `tsvector` ด้วย config `simple`
2. เก็บ `pg_trgm` index บนชื่อ/รหัส สำหรับ exact-ish match
3. ค้นสองทาง (vector + lexical) แล้วรวมด้วย **Reciprocal Rank Fusion**
4. **Metadata pre-filter บังคับเสมอ** — `project_id`, `public_model_id`, `content_domain`, `language`, effective window
   → ถ้าไม่ filter ก่อน คำตอบจะปนข้ามโครงการ ซึ่งเป็น failure mode ที่ลูกค้าจับได้เร็วที่สุดและเสียความเชื่อถือมากที่สุด
5. Rerank top-20 → top-5 ด้วย cross-encoder ถ้ามีงบ (optional)

## 3. Chunk คุณภาพสูงมาจาก schema ไม่ใช่จาก algorithm

เพราะเราออกแบบ `hub.content_sections` แล้ว ([02 §7](02-data-model.md)) แต่ละ section **คือ chunk โดยธรรมชาติ** — มีหัวข้อ มีขอบเขตความหมายชัด เขียนโดยมนุษย์

| แหล่งเนื้อหา | วิธี chunk |
|--------------|-----------|
| `content_sections` | 1 section = 1 chunk (แตกย่อยถ้ายาวเกิน ~800 token โดยตัดที่หัวข้อย่อย) |
| `faqs` | 1 คำถาม = 1 chunk (Q+A อยู่ด้วยกันเสมอ) |
| Brochure PDF | layout-aware ตามหัวข้อ + OCR เฉพาะหน้าที่เป็นภาพ |
| `facilities`, `nearby_places` | **ไม่ต้อง chunk** — ตอบจาก structured API |

ทุก chunk ต้องมี `citation_label` + **URL ที่คลิกกลับไปหาแหล่งจริงได้** (แผนเดิมมี label แต่ไม่มี URL) ใช้ URL ของเอกสาร/เวอร์ชันหรือ API ของ Hub ตามสิทธิ์เข้าถึง ไม่ต้องสร้างหน้าเว็บไซต์ภายนอกเพื่อรองรับ citation

## 4. Content Domain Deny-list — บังคับที่ระดับ DB

```sql
alter table rag.knowledge_documents
  add constraint no_volatile_content_in_rag
  check (not (rag_eligible and content_domain in
    ('promotion','price','availability','legal_contract','customer_data')));
```
เป็นการเปลี่ยน "นโยบาย" ของแผนเดิมให้กลายเป็น **constraint ที่ละเมิดไม่ได้** — ซึ่งจำเป็น เพราะคนจะเผลอ upload โบรชัวร์ที่มีราคาอยู่ข้างในอย่างแน่นอน

> หมายเหตุ: โบรชัวร์ที่มีราคาพิมพ์อยู่ ควร ingest แบบ **redact ราคาออก** หรือ mark section ราคาเป็น `rag_eligible=false` ไม่ใช่ตัดทั้งไฟล์

## 5. Evaluation ที่วัดได้จริง (P1-9)

แผนเดิมระบุแค่ "Golden Question Set 50–100 คำถาม" ซึ่งยังไม่ใช่เกณฑ์วัด

**ชุดคำถามควรแบ่งชั้น:**
- 7 โครงการ × 8 ประเภทคำถาม ≈ 56 ข้อ (baseline)
- \+ 20 ข้อ **adversarial** ที่ต้องปฏิเสธ: *"ลด 50% ใช่ไหม"*, *"มีห้องว่างกี่ห้อง"*, *"ผ่อนเดือนละเท่าไร"*
- \+ 15 ข้อ **cross-project** ที่จงใจล่อให้ตอบข้ามโครงการ
- \+ 10 ข้อภาษาอังกฤษ

**Metric และเกณฑ์ผ่าน:**

| Metric | นิยาม | เกณฑ์ MVP |
|--------|-------|-----------|
| Retrieval recall@5 | chunk ที่ถูกอยู่ใน top-5 | ≥ 0.90 |
| Citation precision | อ้างอิงที่แนบมารองรับคำตอบจริง | ≥ 0.95 |
| Groundedness | ทุกประโยคสืบกลับหา context ได้ | ≥ 0.95 |
| Cross-project leakage | ตอบด้วยข้อมูลโครงการอื่น | **0%** (hard fail) |
| Volatile-answer rate | ตอบราคา/ห้องว่าง/โปรฯ จาก RAG | **0%** (hard fail) |
| No-answer correctness | ไม่มีข้อมูลแล้วตอบว่าไม่มี | ≥ 0.90 |
| Handoff rate | ส่งต่อเจ้าหน้าที่ | ติดตาม ไม่ตั้งเกณฑ์ |

**Regression gate:** ห้าม reindex ขึ้น production ถ้า recall@5 ตกเกิน 3 จุด หรือ hard-fail metric ไม่เป็น 0

## 6. Guardrail ตอนตอบ

1. **Tool-first**: ถ้า intent จับได้ว่าเป็นราคา/ห้องว่าง/โปรฯ/สเปก → เรียก structured tool **ห้ามเข้า RAG**
2. **Numeric provenance check**: ตัวเลขทุกตัวในคำตอบต้องตรงกับค่าใน context หรือ tool result ไม่งั้นตัดทิ้งแล้วตอบเชิงคุณภาพแทน
3. **Scope lock**: ถ้าบทสนทนาระบุโครงการแล้ว การ retrieve ครั้งถัดไปล็อก `project_id` ไว้
4. **No-answer**: ตอบตรง ๆ ว่ายังไม่มีข้อมูล + เสนอส่งต่อเจ้าหน้าที่ + **log เข้า `hub.content_gaps`**
5. **PDPA**: ไม่มีข้อมูลบุคคลเข้า vector store (บังคับที่ deny-list ข้างบน) และไม่ log ข้อความลูกค้าแบบมี PII ลงในระบบเดียวกับ knowledge base

## 7. ตารางที่ปรับจากแผนเดิม

เพิ่มจาก `knowledge_documents` / `knowledge_chunks` เดิม:

| Field ที่เพิ่ม | เหตุผล |
|----------------|--------|
| `documents.indexed_version` | เทียบกับ `version` เพื่อรู้ว่า index ตามทันหรือยัง |
| `documents.content_domain` | ใช้กับ deny-list constraint |
| `documents.source_entity_type/id` | ผูกกลับหา project/model เพื่อ filter และทำ citation URL |
| `chunks.citation_url` | ให้คำตอบมีลิงก์กลับหาต้นทางจริง |
| `chunks.token_count`, `chunks.lang_detected` | debug คุณภาพ chunk ภาษาไทย |
| `chunks.embedding_model` | วันที่เปลี่ยนโมเดล embedding จะได้ reindex แบบมีแผน |
| `rag.eval_runs`, `rag.eval_results` | เก็บผล golden set ทุกรอบเพื่อดู regression |
