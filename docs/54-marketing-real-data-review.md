# 54 — เช็กลิสต์ตรวจข้อมูลจริงสำหรับทีมการตลาด — เตรียมรอบวันจันทร์ 23 พฤศจิกายน 2026

สถานะ: **ยังไม่เริ่ม UAT** ทุกกรณี U01–U61 ยัง **NOT RUN** และรอเจ้าของรับงาน

ใช้ลิงก์ด้านล่าง **หลังผู้ดูแลแจ้งว่า rollout และการตรวจข้อมูลเดิมสำเร็จแล้วเท่านั้น** ลิงก์นี้มาจากเส้นทางที่มีอยู่ใน source ไม่ใช่คำยืนยันว่ารุ่นใหม่เปิดบน TEST แล้ว หากต้องนำเข้าข้อมูลเพิ่ม ต้องเปิดและตรวจ caps สำเร็จก่อน ไม่ทดสอบโหลดบน VPS และไม่แตะระบบคลังข้อมูล production

## ก่อนเริ่ม

- [ ] ผู้ดูแลระบุ release/commit จริง เวลาเริ่มรอบ และกลุ่ม/โครงการตัวอย่างที่ตรวจได้
- [ ] ใช้บัญชีเดิมของแต่ละคนตามสิทธิ์จริง ไม่สร้างบัญชีหรือเพิ่มสิทธิ์เพื่อให้ผ่านกรณีทดสอบ ไม่ส่งรหัสผ่านในแชต
- [ ] เปิดทีละหน้า ใช้งานตามปกติ ไม่เปิดหลายแท็บเพื่อสร้างโหลด ไม่ยิงคำขอซ้ำ หากหน้าค้างหรือผิดพลาดให้บันทึกเวลา/URL/ข้อความและแจ้งผู้ดูแล
- [ ] รอบอ่านข้อมูลไม่ต้องกด ใช้ข้อเสนอ / บันทึก / ยืนยันรูป / อนุมัติสิทธิ์ / ส่งอนุมัติ / เผยแพร่ เว้นแต่เป็นตัวอย่าง TEST ที่ตกลงรายการและผู้ทำไว้แล้ว
- [ ] เก็บภาพเฉพาะข้อมูลที่มีสิทธิ์เห็น ห้ามแนบรหัสผ่าน token cookie หรือข้อมูลส่วนตัวที่ฝังในไฟล์

## ทางเข้า

| งาน | ลิงก์หลังเปิดรอบ | ใช้สิทธิ์เดิม |
| --- | --- | --- |
| เข้าสู่ระบบ | [เข้าสู่ระบบ](https://72.62.253.205/login) | บัญชีที่ใช้งานได้อยู่แล้ว |
| งานและการค้นหา | [หน้าแรก](https://72.62.253.205/home) | สิทธิ์ดูเนื้อหาที่เกี่ยวข้อง |
| ต้นไม้ข้อมูล | [ข้อมูลเว็บไซต์](https://72.62.253.205/website) | ตามขอบเขตของบัญชี |
| รายการโครงการ | [โครงการ](https://72.62.253.205/website?view=projects) | Projects View |
| กลุ่มโครงการ | [กลุ่มโครงการ](https://72.62.253.205/website?view=groups) | Projects View |
| รายการแบรนด์ | [แบรนด์](https://72.62.253.205/website?view=brands) | Brands View |
| ธุรกิจที่อยู่อาศัย | [ภาพรวมธุรกิจ](https://72.62.253.205/website/business/residential?tab=overview) | Knowledge View ตามขอบเขต |
| งานรออนุมัติ | [งานรออนุมัติของฉัน](https://72.62.253.205/home?task=approval) | สิทธิ์ดู/อนุมัติต้นทางที่มีอยู่จริง |
| คิวและประวัติเผยแพร่ | [เผยแพร่](https://72.62.253.205/publish) | สิทธิ์อ่านตามระบบ; การเผยแพร่ต้องมี special และเป็นคนละคนตามกติกา |
| คำถามมาตรฐาน | [คำถามมาตรฐาน](https://72.62.253.205/settings?section=bank) | Knowledge ตามสิทธิ์ |
| หลักฐานนำเข้าเดิม | [หลักฐานนำเข้าเดิม](https://72.62.253.205/knowledge) | ACTIVE content Admin และ Knowledge View ตามระบบ; ไม่ใช่หน้าสำหรับทุกคน |
| คำถามที่รอเจ้าของตัดสินใจ | [คำถามที่รอคำตอบ](https://72.62.253.205/questions) | สิทธิ์เดิมของหน้านี้ |

ลิงก์รายโครงการ/แบรนด์/กลุ่มให้กดจากรายการจริงแล้วคัดลอก URL ที่ระบบเปิดให้ ห้ามนำ REM ID มาแทน public ID หรือเดารหัสใน URL รายชื่อ `LADK2`, `SNHP2`, `00300`, `BNA7` เป็นรหัสต้นทางสำหรับค้น/เทียบหลักฐาน ไม่ใช่ public ID ที่ยืนยันสำหรับลิงก์โดยตรง

## 1. กลุ่มโครงการและเฟสจาก REM

- [ ] เปิด “กลุ่มโครงการ” เลือกกลุ่มที่ผู้ดูแลระบุ จดรหัสกลุ่มการตลาด รหัสกลุ่ม REM ชื่อกลุ่ม และสถานะยืนยัน/ขัดแย้ง
- [ ] จดจำนวนเฟสที่ Hub แสดงและ REM ID ของทุกเฟสที่บัญชีมองเห็น คงเลขศูนย์นำหน้าและช่องว่างต้นทาง
- [ ] เทียบกับ **สำเนา REM ที่มีวันเวลาอ้างอิง** ในระบบ จดจำนวนที่ต้นทางคาดไว้และรายการที่ขาด/เกิน หากหน้าจอไม่มีจำนวนต้นทางครบหรือบัญชีเห็นเพียงบางเฟส ให้ระบุ “ยังเทียบทั้งหมดไม่ได้” ไม่ถือว่าเท่ากัน
- [ ] เปิดแต่ละเฟสจากรายการ ตรวจไม่สลับไปเฟสชื่อคล้ายกัน และไม่รวมเฟสที่ยังไม่ยืนยันโดยอัตโนมัติ
- [ ] ตรวจข้อความรหัสกลุ่มไม่ตรงกัน ต้นทางเปลี่ยน/หาย/ลบ และหลักฐานจาก business sheet แยกจาก REM จดข้อพบก่อนแก้ข้อมูล

ข้อจำกัดความสด: สำเนา DW ที่อ้างใน package ถูกเก็บ 6 ตุลาคม; ค่า project จาก Gold มีเวลา 3 ตุลาคม และกลุ่มมีเวลา 6 ตุลาคม ข้อมูล business sheet วันที่ 27 ตุลาคมเป็นหลักฐานเพิ่ม ไม่ใช่การ refresh REM หากต้องยืนยันกับ REM ปัจจุบัน ให้เจ้าของข้อมูลต้นทางยืนยันแยก ห้ามเรียกหรือแก้ DW เพื่อทำ UAT

## 2. อาคาร ที่อยู่ และข้อมูลต้นทางรายเฟส

- [ ] เปิดเฟสนั้น → “ข้อมูล” → ส่วนข้อมูลหลัก/ข้อเท็จจริง/อาคารที่มีจริง ตรวจชื่อ ที่อยู่ สถานะ และข้อมูลอาคารทีละรายการ
- [ ] แยกค่าต้นทาง REM/DW ออกจากค่าที่ทีมแก้ใน Hub และข้อเสนอจากเว็บไซต์เดิม จดแหล่งที่มา วันเวลาของข้อมูล และค่าที่ต่าง
- [ ] วันเวลาที่ดึงสำเนาไม่ใช่วันเวลาที่ข้อมูลต้นทางเปลี่ยน หากไม่มี as-of ของ field ให้บันทึกว่าขาด ไม่ใช้วันที่เปิดหน้าหรือวันที่อัปโหลดแทน
- [ ] ตรวจว่า field ที่อ่านอย่างเดียวไม่ชวนให้แก้ต้นทาง หากต้องแก้สำเนาหรือจับคู่ใหม่ ให้บันทึกเป็นคำขอพร้อมหลักฐาน ไม่แก้ schema หรือเพิ่มข้อมูล REM เอง

## 3. KM และ FAQ ของแต่ละเฟส

- [ ] เปิด “ภาพรวม” แล้ว “FAQ” ของเฟสเดิม ตรวจจำนวนที่มี/ยังขาด รายการคำถามมาตรฐาน และแหล่งคำตอบที่สืบทอด
- [ ] แยก **หลักฐาน KM ที่นำเข้า**, **FAQ draft**, **คำตอบอนุมัติ** และ **ฉบับเผยแพร่** ไม่ใช้จำนวน candidate เป็นจำนวนคำตอบพร้อมใช้งาน
- [ ] เปิดงานที่ขาดจากภาพรวม ตรวจลิงก์ถึงคำถามและเฟสที่ตรงกัน ชื่อคำถามควรใช้ชื่อโครงการแทนข้อความดิบ `project`
- [ ] ถ้ามีป้าย “รออนุมัติคำถาม” ต้องเห็นชื่อคำถามและเหตุผลที่ยังตอบไม่ได้ พร้อมทางไปกระบวนการคำถามมาตรฐานเดิม ไม่ถือว่าการเปิดพบคำถามแปลว่าตอบได้แล้ว
- [ ] คำถามอนุมัติที่ยังไม่มีคำตอบควรเปิดตรงรายการพร้อมทางตอบตามสิทธิ์ เมื่อจะบันทึกจริงให้ใช้เฉพาะรายการที่ตกลงไว้และสิทธิ์ Knowledge Edit เดิม
- [ ] อ่านคำอธิบายตัวนับ “งานของฉัน” บน home และหน้าโครงการ เพราะนับคนละชุดงาน จดความต่างที่อธิบายไม่ได้

## 4. รูปและวิดีโอรายเฟส/อาคาร

- [ ] เปิดเฟส → “รูปและวิดีโอ” → รายการ “จากเว็บเดิม รอยืนยัน” ตรวจ thumbnail แหล่ง URL เวลาเก็บ และบริบทเฟส
- [ ] ตรวจอาคาร/ชั้น/แบบห้อง/ตำแหน่งใช้งานจากตัวกรองหรือรายละเอียดที่มีอยู่จริง หากรูปยังไม่ผูกอาคาร ให้จด “ยังไม่ระบุอาคาร” ไม่เดาจากชื่อไฟล์หรือรวมเป็นภาพครบทุกอาคาร
- [ ] จดจำนวนรูปต่อเฟส และต่ออาคารเท่าที่ตรวจความสัมพันธ์ได้ แยกภาพซ้ำที่ใช้หลายบริบทออกจากจำนวนไฟล์จริง
- [ ] ตรวจสถานะสิทธิ์ภาพและ metadata แยกกัน รูปจากเว็บไซต์เดิมยังต้องยืนยันสิทธิ์ การยืนยัน tag/ตำแหน่งไม่ใช่อนุมัติสิทธิ์ใช้งาน
- [ ] ภาพ/เอกสารต้นทางที่มีอยู่ก่อน W9.1 ต้องไม่ถูกแก้ bytes หรือถูกลบเพื่อให้เข้าเกณฑ์ใหม่

ข้อพบจาก inventory: WebP ของ `LADK2` 6 ไฟล์เกิน 24 MP และ PDF ของ `SNHP2`/`00300` มีภาพย่อยเกิน 24 MP หากนำไฟล์เหล่านี้มาอัปโหลดใหม่ต้องถูกปฏิเสธตามกติกา ไม่ลองอัปโหลดเพื่อทดสอบบน VPS และไม่เปลี่ยนไฟล์เก่าอัตโนมัติ รายละเอียด checksum อยู่ในรายงาน inventory

## 5. ข้อเสนอจากเว็บไซต์เดิม

- [ ] ใน “ข้อมูล”, “แบบห้อง”, “รูปและวิดีโอ” และ “โปรโมชั่น” อ่านข้อเสนอที่ตรงส่วน พร้อม source URL และวันที่เก็บ
- [ ] ตรวจคำเตือนใช้หลายเฟส ข้อมูลขัดแย้ง ไม่มีวันที่ หรือโปรโมชั่นน่าจะหมดอายุ อย่าเลือกเฟสแรกแทนการยืนยันบริบท
- [ ] วันที่เก็บเว็บไซต์ล่าสุดใน package คือ 27 ตุลาคม ไม่ใช่ข้อมูลปัจจุบันแน่นอน หากเว็บปัจจุบันต่าง ให้จดความต่างและ URL โดยไม่ crawl หรือเขียนทับหลักฐานเดิม
- [ ] อย่ารับราคา วันที่ จำนวน และผังจากข้อความ/OCR อัตโนมัติ ค่าที่ต้องใช้จริงต้องตรวจยืนยันและกรอกผ่านฟอร์มเดิมโดยผู้มีสิทธิ์
- [ ] “ใช้/แก้แล้วใช้” เปลี่ยนเป็น draft ตามสิทธิ์เท่านั้น ไม่อนุมัติ ไม่เผยแพร่ และไม่ยืนยันสิทธิ์ภาพอัตโนมัติ

## 6. ประวัติ หน้าที่ และการเผยแพร่

- [ ] อ่าน “ประวัติ” รายเฟส/แบรนด์ ตรวจผู้แก้ เวลา เหตุผล แหล่งข้อมูล และความต่างก่อน/หลังตามสิทธิ์
- [ ] อ่านคิวเผยแพร่และงานรออนุมัติด้วยบัญชีที่ทำงานนั้นจริง ไม่เพิ่มสิทธิ์ให้ผู้ดูเพื่อทดสอบ
- [ ] รอบนี้ไม่กดอนุมัติ/เผยแพร่ข้อมูลนำเข้าทั้งชุด ขั้นเขียน ตรวจสิทธิ์ภาพ อนุมัติ ถอน หรือย้อนกลับต้องมีรายการ TEST ตัวอย่างที่ผู้ดูแลและเจ้าของงานตรวจแล้ว พร้อมผู้ทำที่แยกกันตามกติกา
- [ ] ผู้ช่วยร่างข้อความยังเริ่มปิด ตรวจได้ว่าปุ่ม/คำอธิบายตรงสถานะ แต่ไม่เปิด field ไม่เปลี่ยนงบ และไม่ส่งคำขอจริงเพื่อทำ UAT

## 7. หน้าจอและการส่งข้อพบ

- [ ] ตรวจหน้าใช้งานที่ 1280 และ 390 ทั้ง light/dark; เพิ่ม 1024 สำหรับ U29 ตามที่เครื่องทำได้ ระบุขนาดจริง
- [ ] เลื่อนถึงท้ายหน้า ตรวจปุ่มผู้ช่วยไม่ทับการ์ด ปุ่ม ลิงก์ หรือ footer และสถานะปิดอ่านได้
- [ ] ใช้ keyboard ตรวจ focus และปิด dialog ตามปกติ ลองค้นที่ไม่พบแล้วล้างตัวกรอง ข้อความว่างต้องตรงกับข้อมูลจริง
- [ ] บันทึกการอ่านได้เพียงบางข้อเป็น “ข้อสังเกตบางส่วน” ไม่สรุปผ่านทั้ง Uxx จากภาพเดียว

| เวลาไทย / ผู้ทดสอบตามบทบาท | กลุ่ม / REM phase ID / URL จริง | จุดตรวจ | สิ่งที่พบ | แหล่งและ as-of | สิ่งที่ควรเป็น | ภาพ/หลักฐาน | ต้องการให้แก้ draft หรือส่งเจ้าของข้อมูล |
| --- | --- | --- | --- | --- | --- | --- | --- |
| รอรอบจริง | — | — | — | — | — | — | — |

กรณี fake clock, BUD/feed/move/grace, ถอนสิทธิ์ระหว่างคำขอ, writing stub, GPS/private sentinel, 100 MP, PDF หนักสุด, 429 หลายผู้ใช้และ timeout/cancel **ทำใน local เท่านั้น** ไม่ทำบน VPS ส่วนข้อมูลหรือ actor ไม่ครบให้ระบุสิ่งที่ขาด ไม่สร้างสิทธิ์หรือแต่งผลผ่าน

ตารางด้านล่างแยกครบ U01–U61; [แผน rollout และ inventory](53-hosted-marketing-release.md) ระบุข้อมูลก่อนนำเข้า สถานะปัจจุบัน: **ผ่าน 0 / ไม่ผ่าน 0 / ทำต่อไม่ได้ 0 / ยังไม่ทดสอบ 61** ไม่มีการตรวจ hosted หรือเปลี่ยนข้อมูลจากการเตรียมเอกสารนี้

## Hosted / local case mapping

Planning only: READ means hosted read-only observations, SAMPLE means ordinary write branches require reviewed TEST samples and existing authorized actors, LOCAL means the entire controlled case remains local. Partial observations never pass an entire case. The original prerequisites and expected results in docs/49 remain authoritative. All 61 cases are NOT RUN: 17 READ, 23 SAMPLE, 21 LOCAL.

| Case | Planned lane | Hosted prerequisite / write hold | Required local branch | Result |
| --- | --- | --- | --- | --- |
| U01 | READ | Existing accounts covering staff/viewer/agency; no account or grant creation. | Missing role combinations and legacy ads fixtures stay local. | NOT RUN |
| U02 | READ | Named accessible project/brand/FAQ samples and independently recorded expected visible counts. | Exact BUD search, all task states, hidden-count/FAQ-only combinations and absent fixtures remain local. | NOT RUN |
| U03 | READ | Keep hosted assistant configuration unchanged; no send/provider call. | Stub conversation, citation/SSE, agency denial and business stale/revocation proofs remain local. | NOT RUN |
| U04 | SAMPLE | Any business draft or create/request action needs a named sample and current source/Knowledge authority. | Unconfirmed/conflicting identity and Knowledge-only namespace/conjunction fixtures remain local when not naturally present. | NOT RUN |
| U05 | SAMPLE | Ordinary save only on reviewed TEST sample; do not overwrite collected marketing content for a test. | Two-session parent-revision conflict and deterministic dirty-form recovery remain local. | NOT RUN |
| U06 | SAMPLE | Use/edit-use/reject only with marketing confirmation of the exact candidate/project; retain pending rights and no auto-publication. | Structured-number/price/plan negative and dirty-form race fixtures remain local. | NOT RUN |
| U07 | SAMPLE | Only individually reviewed normal metadata actions on named samples; this is not image-rights approval. | 40/41-file bulk boundary, inaccessible-file fixtures and synthetic media generation remain local. | NOT RUN |
| U08 | SAMPLE | A normal answer draft needs an approved question, named scope and existing Knowledge E; no question approval by automation. | Seven-level precedence, rule/applicability changes, all default scopes, corporate opt-in and reapproval invalidations remain local. | NOT RUN |
| U09 | SAMPLE | Any proposal/hold/reject intake action needs a named reviewed candidate and existing authority. | Over-50 fixtures, ambiguous phase resolution, hidden source and rejected legacy-accept paths remain local. | NOT RUN |
| U10 | READ | Need a reviewed URL list from real UI; never synthesize UUID/public/REM identifiers. | Missing old-link/media-tag/unit namespace cases remain local. | NOT RUN |
| U11 | SAMPLE | Submit/approve/return/withdraw requires reviewed TEST samples and distinct existing normal actors; never blanket-approve imported rows. | Complete workflow-kind coverage and unavailable draft/review fixtures remain local engineering proof. | NOT RUN |
| U12 | SAMPLE | Edit-and-approve only on an explicit sample by an already authorized Manager; no reason bypass or promotion exception. | Two-session stale parent/source and atomic failure cases remain local. | NOT RUN |
| U13 | SAMPLE | Submitting a batch requires an explicit reviewed list of exact sample IDs/hashes; no broad real-data submit-all. | Multi-page inventory, unsaved form and stale-neighbour conflict matrix remain local. | NOT RUN |
| U14 | SAMPLE | Promotion lifecycle requires named TEST samples and distinct current editor/DATA/LEGAL/publisher actors; no rights expansion. | Self-approval/bypass and missing-lane fixtures remain local; no new roles to complete coverage. | NOT RUN |
| U15 | SAMPLE | Prepare/return/publish only on reviewed TEST samples with exact source V and independent existing publisher special. | Missing permissions, retained before/after redaction and Knowledge-only business publishing fixtures remain local. | NOT RUN |
| U16 | SAMPLE | Four contributor variants and independent publication require named samples and existing actors; otherwise blocked on hosted. | Create missing contributor/version matrix locally; never create hosted grants or use Admin to bypass separation. | NOT RUN |
| U17 | LOCAL | No scope/grant/rights/clock/staging changes on TEST for this case. | All source/review/expiry/revocation/staging-fact/BU/as-of drift and permitted-neighbour branches run locally. | NOT RUN |
| U18 | SAMPLE | Withdraw/restore/rollback needs an explicit reviewed TEST source/version and normal independent authorized actor; no real-content publication side effect by default. | Stale pointer/source and missing source-V/history-role fixture branches remain local. | NOT RUN |
| U19 | READ | Need naturally present event types and actual history authority; account-manager status alone grants nothing. | Missing event states and midnight/timezone exact-boundary fixture comparisons remain local. | NOT RUN |
| U20 | LOCAL | No account/template/base-grant/scope changes; BUD feed remains disabled. | Entire scope preview/apply/expiry/100-reference and unsaved-selection case uses F-BU locally. | NOT RUN |
| U21 | LOCAL | Do not infer BUD from brands/business sheet or activate feed. | Exact BU identities/duplicate codes/null flags/shared approval and applicability fixtures remain local. | NOT RUN |
| U22 | LOCAL | No snapshot import or time change. | Entire A/B/C handover, no-BU, file/thumbnail pause and unchanged publication-history proof remains local. | NOT RUN |
| U23 | LOCAL | No synthetic or altered source watermark on TEST. | All 48-hour/day5/day7/no-tick/stale/replay/out-of-order refresh branches remain local. | NOT RUN |
| U24 | LOCAL | Do not create invites or temporary grants to prepare UAT. | Entire notices/grace/100-effect/pending-invite/lock-time/dirty-form case remains local. | NOT RUN |
| U25 | LOCAL | Existing permissions stay unchanged. | Entire invalidation/concurrency/cache/private-output matrix remains local with allowed neighbours. | NOT RUN |
| U26 | READ | Do not enable fields, change budget/configuration or issue a drafting request on TEST. | Positive field opt-in, banned-field direct requests and all native writers use local stub fixtures. | NOT RUN |
| U27 | LOCAL | No real service call or raw source transmission. | All TH/EN diffs, context revision/authority races and ordinary-save acceptance use local stubs. | NOT RUN |
| U28 | LOCAL | No budget, flag, grant or provider change. | Entire ambiguous/running/orphan/reload/write-failure/budget concurrency case remains local. | NOT RUN |
| U29 | READ | Use available real pages without generating missing states or bulk load. | Stub diff, scope/notice/conflict fixtures and measured contrast proof remain local; partial screenshots are not a full-case pass. | NOT RUN |
| U30 | READ | Actual authorized actors and current Q77–Q82 catalogue required; no duplicate questions or inferred decisions. | Unavailable ads/role fixtures remain local; UAT grants no hosted sync/provider authorization. | NOT RUN |
| U31 | READ | Existing Promotions V/source V actors; do not alter roles to make controls visible. | Missing denial/neighbour actor combinations remain local; menu screenshots alone do not prove RLS. | NOT RUN |
| U32 | READ | Need naturally present versions/states; no synthetic publishing to fill missing states. | Absent frozen-vs-draft additions/removals and lifecycle states are local or remain unprepared. | NOT RUN |
| U33 | SAMPLE | Create only a reviewed TEST sample through ordinary promotion workflow; no fake primary or business/group ownership. | Existing-row byte-equivalence and missing context fixtures remain local proof. | NOT RUN |
| U34 | SAMPLE | Exclusion/review/publication only on a reviewed isolated TEST sample with existing DATA/LEGAL and independent publisher. | Scope-resolution drift before submit/review/publish stays local. | NOT RUN |
| U35 | SAMPLE | Any draft/banner mutation needs named sample plus actual Promotions and Projects conjunction; metadata is not rights approval. | Stale forms and missing permission/rights reviewer combinations stay local. | NOT RUN |
| U36 | SAMPLE | Create only reviewed sample text drafts; marketing fills confirmed dates/prices/amounts itself; no auto-accept/approve/publish. | OCR structured-field negatives and hidden-source actor fixtures stay local. | NOT RUN |
| U37 | SAMPLE | Review/publish only named samples with pre-existing independent lane actors and source V/special. | Wrong-lane/N1/contributor-negative fixtures remain local if absent; no role grants. | NOT RUN |
| U38 | READ | Record current eligible sample IDs/time; do not change dates to manufacture states. | Before/exact/after seven-day and rights/publication eligibility matrix stays local. | NOT RUN |
| U39 | LOCAL | Do not create BUD/partial-scope/LEGAL grants or mutate authority. | Entire any-scope/all-scope/contributor/revocation/worker/cache/allowed-neighbour permission matrix remains local. | NOT RUN |
| U40 | READ | Need current real version/time evidence; no newly approved or published real import merely to populate the case. | Controlled future/expired/withdrawn/scope and frozen-version variants remain local. | NOT RUN |
| U41 | SAMPLE | Only individually approved ordinary uploads after caps/rollout, serially on named TEST samples; a normal 24 MP photo is not a stress run. | 100 MP/worst-case, orientation matrix, color/metadata encoder proof and resource acceptance stay local. | NOT RUN |
| U42 | LOCAL | No bombs, malformed/animated/100 MP boundary or HDR probes on shared VPS. | Entire 30 MiB/100 MP JPEG/24 MP PNG-WebP/HDR rejection and neighbour matrix stays local. | NOT RUN |
| U43 | SAMPLE | Optional ordinary small reviewed JPEG/WebP/PNG sample uploads, serially after caps; no stress or unreviewed SVG. | Lossless/photo threshold and unsafe SVG/quality boundary matrix stays local. | NOT RUN |
| U44 | READ | No private/GPS sentinel or fabricated metadata fixture on TEST; absent W9.1 records remain a fixture gap. | Offset/encoding/stock/render/camera/vocabulary/private-field matrix stays local. | NOT RUN |
| U45 | SAMPLE | Use/save only reviewed normal sample fields by existing E actor; no automatic confirmations or rights/publication changes. | Revocation/stale and missing actor combinations stay local. | NOT RUN |
| U46 | SAMPLE | Individual rights decision needs real supporting permission and a named reviewed sample; do not approve import rights for testing. | Stock mixed-bulk boundary, no-authority denial and synthetic review matrix stay local. | NOT RUN |
| U47 | LOCAL | No real location data as a substitute fixture. | Entire 1 km/context/no-coordinate/destination exclusion proof stays local. | NOT RUN |
| U48 | LOCAL | No private serial/contact/face/path/history sentinel on TEST. | Entire embedded-preview/metadata removal and DB/log/API exclusion audit stays local. | NOT RUN |
| U49 | LOCAL | No legal/unknown private metadata or category-bypass fixture uploaded to TEST. | Entire exact-byte/legal/disclosure/unknown/10 MiB/dedup boundary case stays local. | NOT RUN |
| U50 | LOCAL | No worst-PDF or multiple gain-boundary processing on shared VPS. | Entire recompression/gain/page/text/visual comparison uses local offline PDFs. | NOT RUN |
| U51 | LOCAL | No private PDF metadata sent to TEST for a privacy proof. | Entire low/no-gain rewrite/Title-only/unsafe fallback case stays local. | NOT RUN |
| U52 | LOCAL | No 50 MiB/200-page/240 MP/worst-PDF/active-content boundary files on shared VPS. | Entire weighted 24 MP object+mask, 240 MP unique aggregate, stored-size and active-content case stays local. | NOT RUN |
| U53 | SAMPLE | Optional serial duplicate of a reviewed ordinary TEST sample only; no changing pipeline version or inaccessible-checksum probing. | Concurrent original/stored dedup, class/context/no-access and pipeline-version fixtures remain local. | NOT RUN |
| U54 | LOCAL | No concurrent tabs/users, busy-duration/cancel/timeout stress or private destination sentinels. | Entire 429 Retry-After success/60-second expiry, kill/reap, mixed failure and output exclusion matrix remains local. | NOT RUN |
| U55 | READ | Do not change exposure or submit real rows to manufacture 1/4, zero or all-internal fixtures. | Exact 1/4, N=0, N=M and submit outcomes remain local unless explicit reviewed samples exist later. | NOT RUN |
| U56 | READ | Do not delete/hide real rows or publish samples to force empty/since-publication states. | Missing empties, fixture role combinations and unchanged ads baseline remain local. | NOT RUN |
| U57 | LOCAL | BUD feed stays disabled and no session/server clock injection. | Entire day5/day7/move/midnight/timezone date matrix remains local. | NOT RUN |
| U58 | LOCAL | Do not grant BUD or populate the disabled feed for UAT. | Entire two-BUD aria-describedby picker/preview/cancel proof remains local. | NOT RUN |
| U59 | READ | Requires existing queue cards and currently authorized readers; an empty queue is not a title-count pass. | Missing permission variants and no-additional-request proof stay local or pending existing samples. | NOT RUN |
| U60 | READ | Keep hosted assistant disabled; no provider/configuration change to make the enabled branch. | Enabled-stub entry, full bounding-box matrix and local H1 branches remain local. | NOT RUN |
| U61 | LOCAL | No hosted fault injection, notice blocking or audience/grant change. | Entire controlled home/project/Accounts error+retry/role/status matrix remains local. | NOT RUN |

Use docs/50 only for separately scheduled local fixture sessions under the sole test lease. No local tests during owner UAT sessions. Missing samples, actors or fixtures remain explicit gaps; no new hosted account/grant or artificial failure is authorized by this map.

## บทบาทนำร่องและใบตั้งค่าสิทธิ์รายบัญชี — 23 พฤศจิกายน 2569

เป็นคู่มือตั้งค่าด้วยสิทธิ์เดิม ไม่เพิ่มแม่แบบ ไม่เปลี่ยนกติกา และยังไม่ได้ปรับบัญชีบน TEST ชื่อบทบาทด้านล่างเป็นชื่อที่ใช้ในโครงการนำร่อง หน้าจอยังแสดงชื่อแม่แบบเดิมหรือ “กำหนดเอง (จาก …)” จนกว่าจะทำตัวสร้างบทบาทหลังนำร่อง

คำสิทธิ์ที่ใช้: **ดู**, **แก้ไข**, **อนุมัติ**, **เผยแพร่ขึ้นเว็บ**, **จัดการผู้ใช้** แม่แบบ `publisher` หมายถึงผู้อนุมัติเนื้อหา แม้ชื่อเดิมบนหน้าจอมีคำว่าเผยแพร่ การเผยแพร่ขึ้นเว็บต้องติ๊ก `knowledge.publish_web` เพิ่มโดยชัดเจน ไม่ได้มาพร้อมแม่แบบนี้

ทุกบทบาทดูโครงการ แบรนด์ โปรโมชัน ความรู้/FAQ ชุดเผยแพร่ และคำถามได้ตามกติกาการอ่านเดิม “ดูทุกโครงการ” ไม่ข้ามสถานะหรือข้อจำกัดของเนื้อหา แท็บ Ads ทั้งหกไม่ให้สิทธิ์จากตารางนี้: ทะเบียนแคมเปญ งบการตลาด ยอดใช้จริง ติดตามเอกสาร คลังเอกสาร และข้อยกเว้น การขอ Ads ใช้กระบวนการลงทะเบียน Ads แยกต่างหาก

| บทบาทนำร่อง | แม่แบบเริ่มต้น | โครงการ / แบรนด์ / ความรู้–FAQ | โปรโมชัน | ชุดเผยแพร่ / คำถาม | สิทธิ์พิเศษ / จัดการผู้ใช้ |
| --- | --- | --- | --- | --- | --- |
| เจ้าหน้าที่การตลาด BU | ผู้แก้ไขข้อมูล (`editor`) | ดูทุกโครงการ; แก้ไขโครงการของตน; ไม่อนุมัติ | ดูทั้งหมด + แก้ไขของตน | ดูเท่านั้น | ไม่ให้ |
| ผู้ช่วยผู้จัดการการตลาด BU | ผู้แก้ไขข้อมูล (`editor`) | ดูทุกโครงการ; แก้ไขโครงการของตน; ไม่อนุมัติ | ดูทั้งหมด + แก้ไขของตน | ดูเท่านั้น | ไม่ให้ |
| ผู้จัดการการตลาด BU | ผู้แก้ไขข้อมูล แล้วปรับเอง | ดูทุกโครงการ; แก้ไขและอนุมัติโครงการของตน | ดูทั้งหมด + อนุมัติของตน; ไม่แก้ไข | ดูเท่านั้น | ไม่ให้ |
| ทีมพัฒนาเว็บ SENA Idea | ผู้ดูข้อมูล (`viewer`) | ดูทุกโครงการ; ไม่แก้ไขและไม่อนุมัติ | ดูเท่านั้น | ดูเท่านั้น | เผยแพร่ขึ้นเว็บ; ไม่จัดการผู้ใช้ |
| ผู้จัดการการตลาด SENA Idea | ผู้แก้ไขข้อมูล แล้วปรับเอง | ดู แก้ไข และอนุมัติทุกโครงการ | ดู + อนุมัติทั้งหมด; ไม่แก้ไข | ดูเท่านั้น | เผยแพร่ขึ้นเว็บ; ไม่จัดการผู้ใช้ |
| ผู้ดูแลบัญชีผู้ใช้ | บัญชี admin; แม่แบบผู้ดูแลระบบ แล้วปรับเอง | ดูทุกโครงการ; ไม่แก้ไขและไม่อนุมัติ | ดูเท่านั้น | ดูเท่านั้น | จัดการผู้ใช้เท่านั้น; ไม่เผยแพร่ขึ้นเว็บ |
| ผู้ดูแลระบบสูงสุด | บัญชี admin; แม่แบบผู้ดูแลระบบ แล้วปรับเอง | ดู แก้ไข และอนุมัติทุกโครงการ | ดู + เลือกแก้ไข **หรือ** อนุมัติตามหน้าที่ที่อนุมัติไว้ | ดูเท่านั้นตามขอบเขตนำร่องนี้ | เผยแพร่ขึ้นเว็บ, จัดการรายการแบรนด์ (`brands.manage_catalog`), จัดการรายการฟิลด์ (`projects.manage_field_catalog`), จัดการผู้ใช้ |

**“ของตน” ใช้รายการโครงการที่เจ้าของอนุมัติให้แต่ละคนอย่างชัดเจน** ไม่เดาจากชื่อทีม/ตำแหน่ง ไม่ใช้แบรนด์แทน BU และไม่เลือก BUD ระหว่างนำร่อง เพราะ daily BU sync บน TEST ยังปิดอยู่ ขอบเขตดูเป็นทุกโครงการ; ขอบเขตแก้ไขและอนุมัติแยกกันตามตาราง

ข้อมูลใช้ร่วมกันระดับกลุ่ม/ธุรกิจ/แบรนด์/โปรแกรมยังใช้กติกาเดิม: ขอบเขตแก้ไขครอบคลุมอย่างน้อยหนึ่งโครงการที่ได้รับผลจึงร่างได้; อนุมัติต้องครอบคลุมทุกโครงการที่ได้รับผลหรือเป็นขอบเขตทุกโครงการ ดังนั้น “ของตน” ไม่ได้แยกสำเนาแบรนด์ให้แต่ละ BU และไม่ได้อนุญาตให้อ้างว่าการแก้เนื้อหาใช้ร่วมกันกระทบเพียงโครงการเดียว

### วิธีตั้งค่าในหน้าผู้ใช้และสิทธิ์

ใช้ [ผู้ใช้และสิทธิ์](https://72.62.253.205/admin/accounts) หลังเปิดรุ่นใหม่ ผู้ดำเนินการต้องมีสิทธิ์จัดการผู้ใช้; การตั้ง content scope ต้องเป็นบัญชี admin ที่ใช้งานอยู่ด้วย ตั้งให้บัญชีอื่นเท่านั้น ระบบไม่ให้ปรับสิทธิ์ตนเอง และต้องเหลือผู้จัดการบัญชีอย่างน้อยหนึ่งคน

1. เปิด **ผู้ใช้ทั้งหมด** ค้นอีเมลที่เจ้าของระบุ เปิด **จัดการ** ตรวจว่าเป็นคนถูกต้องและสถานะใช้งานอยู่ หากยังรอตอบรับ/รอคำขอ ให้ใช้ขั้นตอนเดิมจนเสร็จก่อน ห้ามข้ามการยืนยันตัวตน
2. ใน **แม่แบบสิทธิ์** เลือกแม่แบบตามตาราง แล้วกด **ใช้แม่แบบนี้** การเลือกอย่างเดียวไม่คัดลอกสิทธิ์; การคัดลอกยังไม่บันทึกและไม่เปลี่ยนสิทธิ์จัดการผู้ใช้
3. ใน **ตารางสิทธิ์รายแท็บ** ติ๊ก **ดู** สำหรับโครงการ แบรนด์ โปรโมชัน ความรู้ ชุดเผยแพร่ และคำถามทุกบทบาท แล้วตั้งทีละบทบาทดังนี้
   - เจ้าหน้าที่/ผู้ช่วยฯ: ติ๊ก **แก้ไข** ในโครงการ แบรนด์ ความรู้ และโปรโมชัน; ไม่ติ๊ก **อนุมัติ**
   - ผู้จัดการ BU: ติ๊ก **แก้ไข** และ **อนุมัติ** ในโครงการ แบรนด์ และความรู้; แถวโปรโมชันเอา **แก้ไข** ออกก่อน แล้วติ๊ก **อนุมัติ**
   - ทีมพัฒนาเว็บ: เอา **แก้ไข** และ **อนุมัติ** ออกทุกแถว แล้วติ๊ก **เผยแพร่ขึ้นเว็บ** ใต้ความรู้
   - ผู้จัดการ SENA Idea: เหมือนผู้จัดการ BU และติ๊ก **เผยแพร่ขึ้นเว็บ** ใต้ความรู้
   - ผู้ดูแลบัญชี: เอา **แก้ไข**, **อนุมัติ** และสิทธิ์พิเศษทั้งหมดออก เหลือหกช่อง **ดู** เท่านั้น
   - ผู้ดูแลสูงสุด: ติ๊ก **แก้ไข** และ **อนุมัติ** ในโครงการ แบรนด์ ความรู้; โปรโมชันเลือกเพียงอย่างเดียวตามงาน; ติ๊กสิทธิ์พิเศษสามรายการตามตาราง ชุดเผยแพร่และคำถามคง **ดู** เท่านั้น ทุกบทบาทนำร่องไม่ติ๊กช่องอนุมัติของชุดเผยแพร่ที่ยังมีในตารางเดิม
4. ทุกบทบาทเอา **ดู** ออกจาก Ads ทั้งหกแถว แล้วตรวจว่าแก้ไข/อนุมัติ/สิทธิ์พิเศษใต้ Ads ว่างทั้งหมด ห้ามปล่อย Ads ที่แม่แบบ admin คัดลอกมาไว้โดยไม่ตรวจ
5. เอา **จัดการผู้ใช้และสิทธิ์** ออกสำหรับบทบาท 1–5; ติ๊กให้บทบาท 6–7 หากเป็นการเพิ่มใหม่ ต้องติ๊ก **ยืนยันให้สิทธิ์ผู้ดูแลระบบ อนุมัติบัญชีและเปลี่ยนสิทธิ์ผู้อื่นได้** ด้วย สิทธิ์นี้ให้อำนาจเปลี่ยนสิทธิ์ของคนอื่น แม้สิทธิ์เนื้อหาตนเองเป็นดูอย่างเดียว
6. อ่าน **ความแตกต่างของสิทธิ์** ทุกแถว ใส่บันทึกชื่อบทบาทนำร่อง/เหตุผล แล้วกด **บันทึก** เปิดข้อมูลล่าสุดตรวจซ้ำ อย่ากดใช้แม่แบบอีกหลังปรับเอง เพราะจะคัดลอกช่องเดิมมาทับ
7. ตั้ง **ขอบเขต** หลังบันทึกสิทธิ์พื้นฐานแล้ว: ในแต่ละแถวเนื้อหา/ระดับที่มีสิทธิ์ กด **แก้ไขขอบเขต** ระดับ **ดู** เลือก **ทุกโครงการ**; บทบาท 1–3 ระดับแก้ไข/อนุมัติที่ได้รับเลือก **เลือกเอง** แล้วติ๊กเฉพาะรายการโครงการของคนนั้นใต้ **เลือกโครงการนี้เพิ่มเติม** ไม่ติ๊ก BUD บทบาท 4–7 ใช้ทุกโครงการสำหรับระดับที่มีจริง
8. กด **ตรวจการเปลี่ยนแปลงขอบเขต** ตรวจรายการได้รับ/เสียสิทธิ์ ติ๊กยืนยัน แล้วกด **ยืนยันเปลี่ยนขอบเขต** ทำแยกแต่ละแท็บ/ระดับ ห้ามถือว่าตั้งโครงการหนึ่งแถวแล้วครอบคลุมความรู้หรือโปรโมชันโดยอัตโนมัติ ระดับที่ไม่มีสิทธิ์ไม่ต้องเพิ่มขอบเขต และขอบเขตไม่เพิ่มสิทธิ์พื้นฐาน
9. ให้เจ้าของบัญชีตรวจการอ่านและปุ่มตามบทบาทผ่านการใช้งานปกติ ผู้เผยแพร่ยังต้องต่างจากผู้แก้ไข/ผู้อนุมัติรายการตามกติกาที่มีอยู่ การมีทั้งอนุมัติและเผยแพร่ไม่ได้อนุญาตให้เผยแพร่รายการที่ตนมีส่วนร่วม

ข้อจำกัดการตั้ง admin: **ใช้แม่แบบผู้ดูแลระบบไม่เปลี่ยน `hub_role` ของบัญชีเดิม** คู่มือนี้ใช้บัญชี admin ที่มีอยู่สำหรับบทบาท 6–7; อย่าคาดว่าการคัดลอกแม่แบบให้ editor จะเปลี่ยนเป็น admin ขั้นอนุมัติบัญชีใหม่ในหน้าจอไม่เปิดแม่แบบ admin ให้เลือก หากต้องสร้าง/แปลงบัญชี admin ใหม่ ให้รายงานกลับเจ้าของเพื่อเลือกขั้นตอนเดิมที่รองรับ ห้ามแก้ฐานข้อมูลหรือกติกาเพื่อให้เข้าตารางนี้

### ผลตรวจความเป็นไปได้ในเครื่อง

23 พฤศจิกายน 2569 ตรวจด้วยบัญชีสังเคราะห์ในฐานข้อมูลใช้แล้วทิ้งผ่าน API และ `hub_runtime`/`hub_app` จริง: **12 กรณีผ่าน** รวมการบันทึก viewer + ดูหกแท็บ + `knowledge.publish_web` โดยไม่มีแก้ไข/อนุมัติ และบัญชี admin + ดูหกแท็บ + จัดการผู้ใช้ โดยไม่มีสิทธิ์แก้ไข/อนุมัติ/เผยแพร่หรือ Ads การเพิ่มจัดการผู้ใช้โดยไม่ติ๊กยืนยันถูกปฏิเสธตามเดิม

กรณีเดิมพิสูจน์การเผยแพร่เนื้อหาสังเคราะห์ที่ผ่านอนุมัติด้วย viewer ที่มีสิทธิ์เผยแพร่แยกต่างหาก พร้อมถอน/ย้อนและอ่าน public output; ชุดลบยืนยัน grid ผิดกติกาแปดแบบยังถูกปฏิเสธ ไม่พบว่าบทบาท 4 หรือ 6 ถูกกติกาปัจจุบันปฏิเสธภายใต้เงื่อนไขบัญชีข้างต้น นี่เป็นผลวิศวกรรม local ไม่ใช่ผล owner UAT และไม่ได้ตั้งบัญชี hosted

หลักฐาน: `.local/pilot-roles-20261123/focused-final.log`, `results-final.xml`, `pilot_roles_probe.py` รอบแรกมี probe ผิดสองกรณีเพราะคาดรูป JSON แบบละแถวว่าง/ลำดับสิทธิ์ไม่ตรง API; แก้เฉพาะ probe ให้เทียบ grant set ครบทุกแถว กฎสิทธิ์และชุดทดสอบเดิมไม่เปลี่ยน
