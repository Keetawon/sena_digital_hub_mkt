# 49 — ชุดทดสอบรับงานพื้นที่ข้อมูลเว็บไซต์และ AI

> เตรียมสำหรับวันจันทร์ 23 พฤศจิกายน 2026 ตามคำสั่งเจ้าของวันที่ 20 พฤศจิกายน
> ใช้ focused tests + DB + affected API ระหว่างเตรียมและแก้ UAT; full gate รวมหนึ่งครั้ง
> หลังแก้ UAT ก่อน rollout วันพุธ 25 พฤศจิกายน ข้อกำหนด full gate ก่อน UAT ในร่างเก่า
> ถูกแทนที่เฉพาะลำดับงานนี้ สิทธิ์/RLS/public output/hash/clean apply ยังตรวจครบ
> ทุกกรณี U01–U61 ยัง NOT RUN; owner acceptance ยัง PENDING
> คู่มือเริ่มระบบและ fixture: [Monday local UAT runbook](50-local-uat-runbook.md)


สถานะ: **ร่างเตรียม UAT เท่านั้น — ยังไม่ทดสอบ (NOT RUN) ทั้ง 61 กรณี U01–U61**
**Owner acceptance: pending** — ยังไม่มีการรับงาน ไม่ใช้หลักฐานเตรียมแทนผลเจ้าของ

ฉบับกระทบยอดเอกสารวันที่ 13 พฤศจิกายน 2026; วันที่นี้เป็นวันเตรียมเอกสาร ไม่ใช่วัน UAT
คงช่อง final commit, full gate และวันเวลาเริ่ม–จบจริงใน §1/§9.1 ไว้รอยืนยัน
ทะเบียนแหล่งเตรียมและข้อจำกัดอยู่ใน §13; ไม่มีการรันระบบจากงานเอกสารนี้

เอกสารนี้ปรับตามการทบทวน W4–W7 และกติกา BUD ฉบับแทนที่ของเจ้าของ
ไม่ใช่รายงานว่าระบบเสร็จหรือผ่านการทดสอบแล้ว
ผู้ดูแลต้องเติมรายการเตรียมที่ระบุว่า **รอยืนยันใน W8** จาก `main` ฉบับสุดท้าย
และแนบผล full gate ก่อนนัดเจ้าของทดสอบหนึ่งรอบ ห้ามเปลี่ยนช่องว่างเป็นผลผ่านโดยอนุมาน
จากการอ่านโค้ด การเก็บรายการทดสอบ หรือผลจาก commit ก่อนหน้า

ข้อกำหนดอ้างอิง: [docs/47](47-unified-content-workspace.md) เป็นหลัก;
การตัดสินใจล่าสุดของเจ้าของเรื่อง BUD และข้อกำหนด W7 เริ่มต้นปิดทุกช่องอยู่ใน
[docs/48](48-unified-workspace-log.md) รวมภาคผนวกแบบ W6 ที่ต้องรวมเข้าฉบับสุดท้าย
ข้อความในเครื่องหมาย «…» คัดลอกจาก docs/47 โดยตรง
รายการไฟล์ทดสอบใน §9.2 ยืนยันเพียงว่ามีกรณีรองรับใน source ที่ทบทวนแล้ว
ยังไม่ใช่ผลรันบน final main หรือผลรับงานของเจ้าของ

## 1. ใบบันทึกการทดสอบจริง

| รายการ | ผู้ดูแลกรอกก่อนเริ่ม |
| --- | --- |
| Commit สุดท้ายบน `main` และวันที่ full gate | **รอยืนยันใน W8** |
| ผู้ทดสอบ / ผู้ดูแล fixture / ผู้บันทึกข้อพบ | **รอยืนยันใน W8** |
| วันเวลาเริ่ม–จบจริง เขตเวลา Asia/Bangkok | **รอยืนยันใน W8** |
| Local origin ที่เปิดให้ทดสอบ / browser และรุ่น | **รอยืนยันใน W8** |
| ชุด fixture และรุ่น / วิธีคืนค่าแต่ละกรณี | **รอยืนยันใน W8** |
| จุดสลับบัญชีทดสอบที่ระบบเดิมรองรับ | **รอยืนยันใน W8** |
| หลักฐาน stub provider และสถานะปิดการเรียกจริง | **รอยืนยันใน W8** |
| จุดควบคุม fake clock เฉพาะฐานข้อมูลทิ้งได้ / วิธีคืนเวลา | **รอยืนยันใน W8** |
| โฟลเดอร์หลักฐาน | `artifacts/unified-workspace/w8/<run-id>/` — เติม run-id |

ผลแต่ละกรณีใช้หนึ่งค่า: **ยังไม่ทดสอบ / ผ่าน / ไม่ผ่าน / ทำต่อไม่ได้** พร้อมหลักฐาน
หากเตรียม fixture ไม่สำเร็จ ให้บันทึกว่าทำต่อไม่ได้ ไม่ถือว่าผ่านหรือข้ามผ่าน
เมื่อพบความต่าง ให้บันทึกการกระทำ ผลที่เห็น ผลที่ควรเป็น บัญชี และรหัสวัตถุทดสอบ
โดยไม่แนบ token, cookie, header ยืนยันตัวตน หรือข้อมูลบุคคลจริง

## 2. การเตรียมโดยผู้ดูแลก่อนเจ้าของลงมือ

ส่วนนี้เป็นรายการสิ่งที่ต้องเตรียม **ไม่ใช่คำสั่งรัน** และไม่มีชื่อคำสั่ง seed หรือ
fake-clock ที่สมมติขึ้น ผู้ดูแลเติมคำสั่งที่ตรวจแล้วในตารางท้ายเอกสารเมื่อถึง W8

1. ใช้ฐานข้อมูลและไฟล์ทดสอบ local ที่ทิ้งได้เท่านั้น ผู้ดูแลถือ test lock หนึ่งราย
   ถ้าพอร์ตที่ต้องใช้มีงานของเจ้าของอยู่ ให้รายงานและรอ ห้ามหยุด process นั้น
2. ใช้เฉพาะบัญชี ข้อความ รูป และข้อมูลโครงการสังเคราะห์ที่ระบุด้านล่าง
   แยก browser profile/session ตามบัญชี เพื่อไม่ให้สิทธิ์หรือข้อความค้างข้ามคน
   หน้าอ้างอิงเว็บเดิมต้องเป็น fixture local หรือสำเนา offline ที่ผู้ดูแลเตรียม
   ไม่เปิดเว็บไซต์จริงเพื่อดึงหลักฐานเพิ่มระหว่างรอบนี้
3. ไม่เปิด อ่าน พิมพ์ หรือคัดลอกไฟล์ credential; ไม่เชื่อม REM/DW ไม่แก้ DW repo
   ไม่ migrate/deploy hosted TEST ไม่เขียน R2 และไม่เรียก AI จริง การจำลอง H1
   เป็น local harness เดิมที่ผู้ดูแลรันตาม gate เท่านั้น
4. เตรียม snapshot ก่อนแต่ละกรณีที่แก้ข้อมูล ไม่ใช้การแก้ประวัติหรือเวอร์ชันเดิม
   เพื่อคืนค่า เก็บค่าเริ่มต้นของข้อความ revision เวอร์ชันที่เผยแพร่ และสิทธิ์ไว้ในใบ fixture
5. กรณี BUD ใช้ fixture แปดคอลัมน์ของ `serving.hub_project_bu` และ fake clock
   เฉพาะระบบทดสอบ เวลาในหน้าจอต้องเทียบกับเวลาจำลองที่บันทึก ไม่เทียบกับเวลาจริง
   ห้ามเพิ่มช่องส่งเวลาจากผู้ใช้ หรือเปลี่ยนนาฬิกาเครื่องเพื่อให้กรณีผ่าน
6. ชุด DW วันที่ 5 ตุลาคม 2026 เป็นหลักฐานเก่า ใช้วันเดิมกับนาฬิกาจำลองใกล้วันนั้น
   หรือทดสอบว่าถูกปฏิเสธเมื่อเก่าเกินเกณฑ์ ห้ามเปลี่ยน timestamp ให้ดูเป็นข้อมูลปัจจุบัน
7. ทุกช่องช่วยเขียนเริ่มปิด กรณีบวกต้องเปิดเฉพาะช่องข้อความที่อนุญาตด้วยการบันทึก
   ทะเบียนฟิลด์ตามสิทธิ์ปกติ แล้วผูกกับตัวบันทึกฉบับร่างเดิม ใช้ stub ตลอดทั้งรอบ
8. อย่าอนุมานสิทธิ์จากชื่อ persona: ผู้อนุมัติต้นทางและผู้เผยแพร่ต้องแยกกันจริง
   ตรวจ V/E/A และ special ของบัญชีสังเคราะห์จากใบ fixture ทุกครั้ง ไม่แก้ default
   account/grant/template; สิทธิ์ชั่วคราวที่จำเป็นต้องให้และคืนผ่าน flow ปกติพร้อม revision ปัจจุบัน

### 2.1 บัญชีตามงานจริง

ชื่อด้านล่างเป็นชื่ออ้างอิง fixture ไม่ใช่บัญชีที่มีอยู่จริง ผู้ดูแลต้องเติมรหัสบัญชี
และสิทธิ์ V/E/A รายแท็บที่แน่นอนก่อนเริ่ม ไม่เพิ่มสิทธิ์ให้บัญชีเจ้าของเพื่อให้ทดสอบผ่าน
สิทธิ์ E/A ต้องมี V ของวัตถุเดียวกันด้วย

| บัญชีอ้างอิง | งานและสิทธิ์ที่ต้องเตรียม | รหัสจริงใน fixture |
| --- | --- | --- |
| MKT-A | ทำข้อมูลโครงการใน BU-A; Projects V/E และ Knowledge V/E ตามขอบเขต; ไม่มี A หรือสิทธิ์เผยแพร่ | รอยืนยันใน W8 |
| MKT-B | เหมือน MKT-A แต่เลือก BU-B เพื่อเทียบโครงการแบรนด์เดียวกันคนละ BUD | รอยืนยันใน W8 |
| MANAGER-AB | V/E/A ของแหล่งที่ใช้ในกรณี ภายใน BU-A และ BU-B; ไม่มีสิทธิ์เผยแพร่ | รอยืนยันใน W8 |
| ONLINE | V ครบทุกแหล่งของชุดเผยแพร่และ special «เผยแพร่ขึ้นเว็บ»; ไม่มี A และไม่เคยร่วมแก้/ตรวจอังกฤษ/อนุมัติงานตัวเองในฉบับนั้น | รอยืนยันใน W8 |
| PUB-EDITOR / PUB-EN / PUB-SELF / PUB-APPROVER | สี่บัญชีแยกกัน มี source V และ special เดียวกับ ONLINE แต่เป็นผู้แก้ ผู้ตรวจอังกฤษ Manager ผู้แก้แล้วอนุมัติ หรือผู้อนุมัติ ตามลำดับ | รอยืนยันใน W8 |
| FAQ-ONLY | Knowledge V/E/A ตามขอบเขต ไม่มี Projects V หรือ Brands V; ใช้พิสูจน์ FAQ ไม่เพิ่มสิทธิ์แหล่งอื่น | รอยืนยันใน W8 |
| ACCOUNT-MANAGER | สิทธิ์จัดการบัญชี แต่ไม่ใช่ ACTIVE Admin และไม่มีสิทธิ์อ่านเนื้อหาโดยอัตโนมัติ | รอยืนยันใน W8 |
| ADMIN | ACTIVE Admin พร้อมสิทธิ์จัดการบัญชี และ source V เฉพาะข้อมูลทดสอบ; อีกชุดไม่มีสิทธิ์จัดการบัญชีสำหรับกรณีปฏิเสธ | รอยืนยันใน W8 |
| VIEWER / NO-PUBLISH / AGENCY | ผู้ดูอย่างเดียว; ผู้มี source V แต่ไม่มี special; บัญชี agency สำหรับขอบเขตผู้ช่วย | รอยืนยันใน W8 |
| RELEASES-HISTORY | Releases V แต่ไม่มี Knowledge V หรือ special เผยแพร่; source V ของรายละเอียดประวัติให้เฉพาะชุดที่ระบุ ไม่ได้เพิ่มจาก Releases V | รอยืนยันใน W8 |
| UNRESTRICTED / PROJECT-EXCEPTION | บัญชีเดิมไม่จำกัดขอบเขต; บัญชีเลือกโครงการโดยตรง; ทั้งคู่มี base grant ที่ระบุ | รอยืนยันใน W8 |

### 2.2 ข้อมูลทดสอบและค่าที่ต้องจับคู่

| ชุด | ต้องมีอะไร | รหัส/URL/ค่าตั้งต้นที่ผู้ดูแลเติม |
| --- | --- | --- |
| F-ENTITY | เครือ, residential, แบรนด์ร่วมที่มีโครงการใน BU-A/BU-B, โครงการเดี่ยว, โครงการหลาย phase ที่ยืนยันแล้ว, phase ไม่ยืนยัน/ขัดแย้ง, programme ที่เลือกบางโครงการ | รอยืนยันใน W8 |
| F-IDS | public project ID, REM phase ID มีเลขศูนย์นำหน้า, brand ID, programme/group/unit reference และ public unit-type ID แยกจาก row UUID | รอยืนยันใน W8 |
| F-DRAFT | ฉบับร่างที่บันทึกแล้วหลายรายการ, ฟอร์มยังไม่บันทึก, งานรออนุมัติ/ส่งกลับ/ต้องอนุมัติใหม่, ฉบับอนุมัติที่ไม่เปลี่ยน, ฉบับของอีก phase และฉบับสืบทอด | รอยืนยันใน W8 |
| F-FAQ | คำถามอนุมัติมากกว่า 50 ข้อ, core ที่ยังขาด, คำตอบของตน/สืบทอด, fact ว่าง, handoff/not-applicable/hold, cluster มี key/ไม่มี key/กำกวมหลาย phase | รอยืนยันใน W8 |
| F-FAQ-ORDER | คำถามเดียวกันที่ applicable จริงทุกระดับ: unit type, project, project group, programme, brand, business, corporate; อีกคำถามไม่ applicable; rule ที่ผล phase เปลี่ยนก่อน/หลัง prepare และเพื่อนบ้านที่ไม่เปลี่ยน | รอยืนยันใน W8 |
| F-EVIDENCE | ข้อความเว็บเดิมของ narrative/unit/media, ตัวเลข/ราคา/ผังที่ต้องกรอกเอง, รูปอย่างน้อย 41 รายการพร้อม source page และสิทธิ์ภาพแยก | รอยืนยันใน W8 |
| F-PUBLISH | หน้าเว็บและ legacy release ที่ใช้ APPROVED คนละฉบับ; รายการเพื่อนบ้านถูกต้อง; ฉบับที่แต่ละ PUB-* มีส่วนร่วม; รายการเปลี่ยนหลังเตรียม/หมดอายุ/สิทธิ์ภาพไม่ผ่าน; source project/brand/promotion ที่มี retained version และ public URL | รอยืนยันใน W8 |
| F-HISTORY | ประวัติแก้ project/brand ที่ไม่มี version state, FAQ มีผู้เขียน/ผู้อนุมัติ, คืนงาน/เผยแพร่/ถอน/ย้อนกลับ, เหตุการณ์รอบเที่ยงคืนไทย | รอยืนยันใน W8 |
| F-BU | BU-A/BU-B/BU-C ที่ใช้ exact REM ID/code/name; code ซ้ำแต่ ID ต่าง; flags เป็น null; โครงการปิด/BU inactive; missing/NULL BU; ชุด snapshot และเวลา T0 | รอยืนยันใน W8 |
| F-AI | ช่อง TH/EN ที่อนุญาตและเริ่มปิด, ข้อความมีจำนวน/placeholder, stub สำเร็จ/ผิดข้อความคงไว้/ผลกำกวม/เกินงบ, source revision เปลี่ยนและสิทธิ์ถูกถอนระหว่างรอ; ordinary save สำเร็จแต่ reload ล้มเหลวแยกจาก save ล้มเหลว | รอยืนยันใน W8 |
| F-OLD-URL | URL เก่าที่มี project/phase/question/cluster/item/field/version และ media slot ครบ; รวม tags แบบ JSON และ unit ID สอง namespace | รอยืนยันใน W8 |

แต่ละกรณีด้านล่างมีช่องหลักฐานในตาราง §8 ใช้รหัสเดียวกันตั้งชื่อไฟล์
เช่น `U01-390-dark.png` และ `U15-result.md` ภายใต้โฟลเดอร์ของรอบนี้

### 2.3 ลำดับงานและความครอบคลุม

รอบนี้มี **61 กรณี U01–U61**; หมายเลขคงเดิม ไม่ตัดภาคเพิ่มเติมออกจากยอดรวม
ผู้ดูแลเปลี่ยน persona/fixture ให้ตามกรณี และใช้ลำดับเดินงานดังนี้:

| ลำดับ | กรณี | งาน |
| --- | --- | --- |
| 1 | U01–U10 | งานประจำ shell/search/ผู้ช่วย/entity/FAQ/legacy/media |
| 2 | U11–U19 | review/publication/contributors/history |
| 3 | U20–U25 | BUD/object access/เวลา/แจ้งเตือน |
| 4 | U26–U28 | writing default-off/stub/diff/งบ/การกู้สถานะ |
| 5 | U31–U40 | โปรโมชั่นในบริบทโครงการและแบรนด์ |
| 6 | U41–U54 | อัปโหลดและข้อเสนอจากข้อมูลในไฟล์ |
| 7 | U55–U61 | P1 count/empty/time/picker/title/clearance/BUD failure |
| 8 | U29 แล้ว U30 | ตรวจข้ามพื้นผิว/ธีม/keyboard แล้วตรวจคำถามค้างและงานเดิมก่อนปิดรอบ |

U29 ใช้ตรวจแต่ละพื้นผิวระหว่างเดินงานได้ แล้วกระทบยอดครบก่อน U30; ผู้ดูแลตรวจ
catalogue/คำถามที่จำเป็นต่อ fixture ไว้ก่อน ไม่เลื่อน setup ไปตัดสินใจท้ายรอบ
§8 เก็บผล U01–U30, §11.4 เก็บ U31–U40, §12.3 เก็บ U41–U54 และตารางท้าย
ภาคผนวก P1 เก็บ U55–U61 รวมเป็นทะเบียนผล 61 กรณี ทั้งหมดยังคง NOT RUN

ส่วนที่ต้องใช้ fake clock, pause request หรือคำขอที่ UI ไม่อนุญาตให้กด
เป็นการสาธิตโดยผู้ดูแลด้วย adapter ที่ผ่าน rehearsal แล้วเท่านั้น; artifact ที่มีเพียง
syntax/parsing receipt ยังไม่พิสูจน์ runtime เจ้าของตรวจผลร่วมกับ receipt
ไม่ต้องเปิดฐานข้อมูล ใช้ credential หรือแก้คำขอเอง

| งาน | กรณีหลัก |
| --- | --- |
| W1 shell/ธีม | U01, U29, U60 |
| W2 search/งานของฉัน/ผู้ช่วย | U02–U03, U29, U56, U60 |
| W3 entity/FAQ/legacy/media/history | U04–U10, U19, U29 |
| W4 N1/N2/N6 และ promotions | U11–U18, U19, U55, U59 |
| W5 business | U03–U04, U08, U15–U17 |
| W6 BUD/object access/เวลา/แจ้งเตือน | U20–U25, U57–U58, U61 |
| W7 default-off/stub/diff/งบ | U26–U28 |
| W3.2 promotions | U31–U40 |
| W9 upload | U41–U54 |
| P1 | U55–U61 |
| W8 catalogue/หลักฐาน/ปิดรอบ | U30, §8–§10, §11.4, §12.3 และตารางผล P1 |

### 2.4 Retained walkthrough: source ที่เตรียมแล้วกับ runtime ที่ยังไม่รัน

> Historical preparation snapshot from 13 November. Its NOT RUN statements
> describe the earlier artifacts, not the Monday runtime rehearsal. Current
> preparation results and remaining fixture gaps are in docs/50 and the receipt
> below. Owner UAT remains NOT RUN. The current full-gate timing is docs/11's
> owner-approved fast lane: after UAT fixes, before Wednesday rollout.


คำสั่งมาตรฐานเดิมใน docs/27 §9 คือ `npm.cmd run dev:hosted-h1` ผ่าน
`scripts/run-hosted-h1.mjs`; ไม่ถือว่าคำสั่งนี้เตรียม U01–U61 หรือมี controls
ของ supervisor เพิ่มเติมโดยอัตโนมัติ retained-supervisor v1, writing-v2 และ
publication-v3 เป็น artifact แยกตาม §13 ยังไม่ใช่ final-main integration/runtime receipt
ไม่เปิดรอบหรือเรียก startup จากงานเอกสารเตรียมฉบับนี้

| Artifact ที่ตรวจ receipt/hash แล้ว | ความสามารถที่มีใน source | Runtime ที่ยังไม่พิสูจน์ |
| --- | --- | --- |
| v1 | inspect; persona 7 ชื่อ; OTP จาก outbox ในหน่วยความจำ; clock presets 11 ค่า; reset generation; finish/cleanup | login/authority, ports, clock restoration และ cleanup ยัง NOT RUN; ไม่มี case fixtures ครบ |
| writing-v2 | writing-prepare / writing-inspect / writing-restore; corporate FAQ หนึ่งรายการ มี target faq.short_answer และ supporting faq.detail ของ owner เดียวกัน; เปิด/คืน catalogue flags สองช่องผ่าน writer เดิม | IDs/revisions/สิทธิ์/flag restoration และ positive operations ยัง NOT RUN; ไม่สร้าง proposal หรือ acceptance |
| publication-v3 | publication-prepare / publication-inspect / publication-restore; corporate FAQ อีกหนึ่งรายการและ page ใหม่; Editor/Publisher ทำ source workflow; synthetic Viewer ใช้ source View + publication special | readiness/review/queue presence/grant restoration ยัง NOT RUN; ไม่เรียก queue prepare/publish/withdraw/rollback และไม่ใช่ minimal-permission proof |

v3 คง writing adapter ของ v2 และ controls เดิมไว้ ไม่รัน supervisor ทั้งสามพร้อมกัน
ผู้ดูแลเลือกฉบับและกระทบยอด hashes กับ final source ก่อน rehearsal; receipt ยืนยัน
เฉพาะ syntax/pure control parsing งานเอกสารนี้ไม่ได้เรียก controls, tests หรือระบบใด

- ผู้ดูแลถือ test lease เดียวตั้งแต่ก่อน startup จนตรวจ cleanup ครบ `--lease-id`
  บันทึก lease ที่ผู้ดูแลถืออยู่ ไม่ได้ acquire lock หรือพิสูจน์เจ้าของ lease อัตโนมัติ
  absolute final source/run-id/lease-id/origin จริงยังรอกรอกภายหลัง ไม่เดาจาก artifact
- supervisor ตรวจ exact helper hashes ไม่มี ignore-hash flag; dependencies/build/full gate
  ของ final source ยังเป็น prerequisite แยก ไม่ใช้ source manifest แทน gate receipt
- ใช้ isolated ephemeral browser contexts และ login ปกติ ตรวจ account ID กับ `/v1/me`
  จริงก่อนจับคู่ §2.1; persona เจ็ดชื่อไม่รับรอง V/E/A/special/BUD/project scope
  หรือความเป็น independent contributor และไม่เพิ่มสิทธิ์ให้บัญชีเจ้าของ
- OTP ใช้เฉพาะ interactive operator terminal ตาม grammar ที่จำกัด ไม่ redirect/บันทึก
  terminal ที่มี OTP ไม่เขียน outbox/token/cookie/storageState/credential ลงใบผล
- clock source ใช้ T0 `2031-01-01T00:00:00Z`: real/t0, ก่อน–ตรง–หลัง 48 ชั่วโมง,
  ก่อน–ตรงวันที่ 5/7/8; ระยะก่อน/หลังที่มีคือหนึ่ง microsecond นี่คือค่าประกาศใน source
  ไม่ใช่ fixture ที่รันแล้ว เปลี่ยนเฉพาะ private clock ของ disposable cluster ที่ attest
  ไม่เปลี่ยนนาฬิกาเครื่อง/Auth/JWT และไม่มี user-supplied date/SQL หรือ product clock endpoint
- clock control ไม่ seed BU snapshot/scopes/move; เส้นวันที่ 8 ต้องมี day-1 move
  ที่ adapter ของกรณีเตรียมต่างหาก ยังต้องพิสูจน์ fresh reads, pause/revoke/resume,
  invitation และการคืนเวลาเพื่อ U20–U25; historical DW fixture คงเวลาเดิมตาม §2
- writing-v2 มี context ของ FAQ owner เดียวกัน ไม่แทน separate-owner/context-only race,
  view-only context, permission loss, request barrier, orphan/ambiguous aging, budget/fault,
  ordinary-save acceptance หรือ save/reload failure ทุกกรณีใน U26–U28
- publication-v3 เป็น common setup เท่านั้น Viewer ไม่เขียน/ตรวจอังกฤษ/อนุมัติ owned source
  แต่ยังไม่มีผลเผยแพร่หรือ contributor-denial proof; View grants เดิมอื่นยังคงอยู่ จึงไม่ใช่
  minimal-permission proof และ corporate queue อาจมีเพื่อนบ้านเดิม ต้องใช้ runtime IDs
  แยก owned FAQ/page ไม่สมมติว่าทั้ง queue มีแต่ fixture นี้
- restore ไม่ลบ question/FAQ/page/version/review/audit; full-generation reset ทิ้ง generation
  เดิมและออก IDs/session ใหม่ v3 วาง publication restoration ก่อน writing และก่อนปิด
  browser/API แล้วคืน clock/ปิด owned processes ตาม lifecycle เดิม ผลจริงยังต้องพิสูจน์
  ไม่ลบ failure เดิมจาก receipt เพียงเพราะ retry ภายหลังสำเร็จ
- H1 ยังปิด conversational assistant; U03 ส่วนบทสนทนา/citation/SSE ต้องมี local stub
  harness แยก การเปิด writing fields ไม่ใช่การเปิด conversational assistant
- `test:api`, `test:db`, `test:ui`, `test:hosted-h1` ไม่ใช่ retained walkthrough
  ไม่ใช้ `--existing-simulation`, metadata/config/credential file หรือ arbitrary SQL ข้าม setup
  source/config behavior ภายใน standard H1 child คงขอบเขตที่อนุญาตเดิม ไม่เพิ่ม loader shim

**ยังต้องเติมโดยผู้ดูแล:** final-source integration/rehearsal, actual origin, case-to-persona/
fixture/reset/clock/pause mapping และ sanitized runtime IDs/revisions/authority/restore receipts
ครบตาม §9/§13 สิ่งเหล่านี้เป็นงานเทคนิคที่ยังทำต่อได้ ไม่ใช่คำถามให้เจ้าของเลือก constants
หรือ permission gate ใหม่ กรณีทั้งหมดและ owner acceptance ยังคง pending

## 3. งานประจำของ MKT และผู้ใช้ทั่วไป

### U01 — เข้าใช้งานและหาบริการให้เจอ (W1)

**ใช้:** MKT-A, VIEWER, AGENCY; F-ENTITY

1. เปิด «หน้าแรก» กดโลโก้ แล้วเปิดบริการ «ข้อมูลเว็บไซต์และ AI»
   ตรวจรายการ «หน้าแรก», «ข้อมูลเว็บไซต์», «โปรโมชั่น»,
   «บทความ», «เผยแพร่», «ตั้งค่า» ตามสิทธิ์ของบัญชี
2. ยุบและขยาย sidebar ด้วยปุ่มข้างโลโก้ โหลดหน้าใหม่ แล้วเดินผ่านเมนูท้าย sidebar
   «คำถามที่รอคำตอบ» และ «ผู้ใช้และสิทธิ์» เฉพาะบัญชีที่มีสิทธิ์
3. สลับเป็นบัญชีที่ไม่มีสิทธิ์ทั้งบริการ และตรวจ «งานโฆษณาและงบ» ด้วย fixture เดิม

**ต้องเห็น:** โลโก้เต็ม/mark ถูกตำแหน่ง สถานะยุบคงอยู่ ชื่อไม่ล้น ไม่มีเมนูบริการสมมติ
บริการที่เข้าไม่ได้ไม่แสดง เมนู ads เดิมยังไปที่เดิม ไม่มีผู้ช่วยเป็นเมนู sidebar
การซ่อนเมนูไม่แทนการตรวจสิทธิ์: URL ตรงของเมนูที่ถูกปฏิเสธต้องไม่เปิดข้อมูล

### U02 — เริ่มจากงานของตัวเองและค้นหาข้ามหน้า (W2)

**ใช้:** MKT-A, MANAGER-AB, ONLINE, FAQ-ONLY, VIEWER; F-DRAFT/F-FAQ/F-ENTITY

1. ที่ «หน้าแรก» ตรวจคำทัก «วันนี้ให้ช่วยอะไรดี» และ «งานของฉัน»
   เปิดงานคืนให้แก้ งานรออนุมัติ งานรอเผยแพร่ ใกล้หมดอายุ fact ที่ขาด และถึงรอบทบทวน
   ตามงานจริงของแต่ละบัญชี
2. ค้นด้วยช่อง «ค้นหาโครงการ แบรนด์ BUD หรือคำถาม» ด้วยชื่อ project, brand, exact BUD code
   และ question key ของ fixture; เปิดผลทีละชนิด แล้วใช้ปุ่มย้อนกลับของ browser
3. เปิดงาน «คำถามที่ผู้ช่วยยังตอบไม่ได้» และดู «มีบันทึกว่าตอบไม่ได้ แต่ไม่ได้เก็บข้อความคำถาม»
4. ตรวจ «ความพร้อมของข้อมูล» แยกตาม BUD และ brand เปลี่ยนตัวกรองแล้วเปิดรายการที่ขาด
   ใช้ brand ที่มีช่องของตนขาดต่างจากช่องของ project ลูก และบัญชีที่มี Brands V แต่ไม่มี Projects V
   ซึ่งผู้ดูแลบันทึกไว้ในใบ fixture เพื่อเทียบการนับกับเพื่อนบ้านที่เห็นได้

**ต้องเห็น:** ผลและจำนวนอยู่ในขอบเขตผู้ใช้ งานเปิด field/question/slot ที่ตรงรายการ
พร้อม phase/unit/facility ที่ถูกต้อง ไม่เปิดหน้ารวมให้หาเอง ไม่แสดงข้อความคำถามที่ไม่ได้เก็บ
FAQ-ONLY หาและเปิด FAQ ได้โดยไม่เรียกข้อมูล project/brand editor หรือเพิ่มสิทธิ์แหล่งนั้น
ความพร้อมของ brand ต้องนับช่องของ brand เองแยกจากผลรวมโครงการ ไม่เอาจำนวนโครงการแทน
ช่องที่ขาด และไม่แสดงชื่อหรือจำนวน project ที่ไม่มีสิทธิ์เพียงเพราะอ่าน brand ได้

### U03 — ผู้ช่วยอยู่กับงานและไม่ส่งข้อความเอง (W2)

**ใช้:** MKT-A, AGENCY และ local H1 fixture; F-ENTITY

1. พิมพ์ข้อความสังเคราะห์ใน search แล้วเลือก «ถามผู้ช่วย: <ข้อความ>»
   ตรวจกล่องข้อความก่อนส่ง; ปิดแล้วเปิดด้วยปุ่มลอย «ถามผู้ช่วย» จากหน้าโครงการ
2. ส่งหนึ่งคำถามด้วย stub ที่เตรียมไว้ ตรวจ context โครงการและ citation ตามสิทธิ์
   สลับเป็น AGENCY แล้วลองจุดเข้าเดิมและ URL/คำขอตรงที่ผู้ดูแลเตรียม
3. ใน local H1 ที่ปิดผู้ช่วย ค้นโครงการแล้วเปิดผลตามปกติ

**ต้องเห็น:** เติมข้อความแต่ไม่ส่งเอง context ตรงหน้า ผู้ช่วยไม่รับ agency
H1 แสดง «ผู้ช่วยยังไม่เปิดใช้งาน» สั้นอ่านได้ ขณะที่ search ยังใช้ได้
ไม่มีข้อมูลสิทธิ์บัญชีหรือการแจ้งเตือนการเข้าถึงถูกส่งเป็น context ของผู้ช่วย
สำหรับ business ให้ผู้ดูแลสาธิต citation ของ FAQ/section ที่บันทึกแล้วด้วย source/version
ที่แน่นอน เมื่อ source เปลี่ยนหรือหมดสิทธิ์ ต้องไม่คืนข้อความเก่าหรืออ้างอิงจากฉบับที่ซ่อน
ใช้หลักฐาน backend แบบ stub ใน §9.2 ไม่เปิดผู้ช่วยจริงเพื่อทำกรณีนี้

### U04 — ต้นไม้ข้อมูลและหน้าแต่ละระดับ (W3/W5)

**ใช้:** MKT-A, MANAGER-AB; F-ENTITY/F-IDS

1. เปิด «ข้อมูลเว็บไซต์» ไล่ «เครือ» → «ธุรกิจ» →
   «แบรนด์» → «โครงการ»; ตรวจ initial business «ที่อยู่อาศัย»
   และเปิด programme จากรายการแยก
2. เปิด project หลาย phase สลับ phase ที่มีค่าต่างกัน แล้วเปิด phase ที่ยังไม่ยืนยันกลุ่ม
3. ตรวจแท็บตามลำดับ «ภาพรวม», «ข้อมูล», «แบบห้อง»,
   «รูปและวิดีโอ», «FAQ», «ประวัติ» โดยซ่อนแท็บที่ใช้ไม่ได้
4. เปิดรายการ project/brand เดิมจากต้นไม้ ตรวจการเลือกแหล่งข้อมูล สร้าง/ขอ/ตรวจรายการ
   ตามสิทธิ์เดิม ไม่สร้างขั้นตอนจัดกลุ่มใหม่
5. เปิด business ด้วย Knowledge-only ตรวจ section/contact, FAQ, ประวัติ และ private preview
   ตามแท็บที่มีจริง บันทึกผ่าน writer เดิมด้วย revision ที่โหลด ไม่เรียก editor ของ project/brand
   และไม่ให้สิทธิ์ลูกโครงการเพียงเพราะเปิดระดับ business ได้

**ต้องเห็น:** business ไม่มีปุ่มสร้าง/เปลี่ยนชื่อ; programme ไม่เป็นระดับของต้นไม้
phase ที่ไม่ยืนยันไม่ถูกรวมเพราะชื่อคล้ายกัน ข้อมูลและ ID คง namespace เดิม
FAQ เดิมไม่ถูกย้าย scope เอง และการเพิ่ม business ไม่ทำให้คำตอบใช้กับทุกโครงการเอง
ธุรกิจ residential และความสัมพันธ์แบรนด์เป็นข้อมูลตั้งต้นแบบเพิ่ม ไม่แก้คำตอบเดิม
version/review/publication history หรือบัญชี/grant/template เพื่อจัดเข้าลำดับใหม่

### U05 — ความพร้อมพาไปแก้จุดที่ขาดและรักษาข้อความค้าง (W3)

**ใช้:** MKT-A; F-DRAFT/F-IDS/F-OLD-URL

1. เปิด «ข้อมูลจำเป็นที่ยังขาด» จาก «ภาพรวม» สำหรับ fact, contact,
   unit price และ media slot อย่างละหนึ่ง รวมรายการใกล้หมดอายุจากหน้าแรก
2. ตรวจ field/item, phase, public unit-type ID, facility, rule, category, target,
   floor และ tags ที่ fixture ระบุ แล้วบันทึกค่าทดสอบผ่านฟอร์มเดิม
3. พิมพ์ข้อความแต่ยังไม่บันทึก แล้วเปลี่ยนแท็บ/phase เปิดคำแนะนำเว็บเดิม หรือขอโหลดใหม่
   ให้ผู้ดูแลแก้ parent revision จาก session อื่นก่อนลองบันทึก

**ต้องเห็น:** เปิดส่วนและรายการถูกต้อง สิทธิ์/validation เดิมยังทำงาน
ข้อความค้างไม่หายโดยเงียบ ไม่ถูก suggestion หรือ metadata ใหม่ทับ
เมื่อ stale ต้องแก้ความขัดแย้งหรือโหลดอย่างชัดเจน ไม่ใช้ hash ใหม่ครอบข้อความเก่า
เปิด «ดูตัวอย่างหน้าเว็บ» ได้แบบ private draft โดยไม่เตรียมชุดเผยแพร่หรือเขียนข้อมูล

### U06 — ข้อเสนอข้อความเดิมอยู่ในส่วนที่ตรงงาน (W3/N7)

**ใช้:** MKT-A; F-EVIDENCE

1. ที่แท็บ «ข้อมูล», «แบบห้อง» และ «รูปและวิดีโอ»
   ตรวจ «ข้อเสนอจากเว็บเดิม» ว่ามีเฉพาะหลักฐานที่ตรงส่วน และเปิด «ดูหน้าอ้างอิง»
2. ทดลอง «ใช้», «แก้แล้วใช้» และ «ไม่ใช้» กับคนละรายการ
   ตรวจเหตุผลการไม่ใช้ และตรวจค่าการเปิดเผยข้อความที่ยอมรับเป็นฉบับร่าง
3. ลองรายการจำนวน ราคา และผัง; พิมพ์ค่าที่ยืนยันเองในฟอร์มปกติ
   เปิดฟอร์มหลักค้างก่อนลอง suggestion อีกครั้ง

**ต้องเห็น:** ไม่รับตัวเลข/ราคา/ผังอัตโนมัติ ข้อเสนอใหม่ที่ยัง internal
ไม่แอบปรากฏใน private website preview และผู้ใช้เห็นสถานะการเปิดเผยใน editor
การตัดสินใจมีหลักฐานเฉพาะ project/candidate ไม่เปลี่ยนการตัดสินใจของ phase อื่น
การเปิดหรือบันทึก suggestion ไม่ล้าง dirty state ของฟอร์มข้างกัน

### U07 — ตรวจรูปเว็บเดิมและงานสื่อปกติ (W3)

**ใช้:** MKT-A และ VIEWER; F-EVIDENCE

1. เปิด «รูปและวิดีโอ» เลือก «จากเว็บเดิม รอยืนยัน» ตรวจ thumbnail,
   «ดูหน้าอ้างอิง», ตำแหน่งบนหน้า เวลาเก็บ และค่าที่ AI แนะนำแยกจากค่าที่ยืนยัน
2. ยืนยันชุดที่เลือก 40 รูป แล้วลองเกิน 40; ตรวจรายการที่สำเร็จ/ไม่สำเร็จแยกกัน
3. เปิดงานรูปหลัก project, brand logo, unit asset, clip/tour และ slot ที่ขาดจาก deep link
   ตรวจ unit/asset/binding/role ตรงตัว ไม่เผลอแก้รูปหลักของ project แทน unit

**ต้องเห็น:** จำกัดชุดไม่เกิน 40 ประวัติต่อรูปยังอยู่ การยืนยัน tag ไม่ใช่อนุมัติสิทธิ์ภาพ
VIEWER ไม่บันทึกได้ รูป/ไฟล์นอกขอบเขตเปิด URL ตรงหรือ thumbnail ไม่ได้
การนำเข้าภาพและ metadata เกิดใน fixture local ไม่มี R2 write

### U08 — FAQ มีระดับคงที่และคำตอบสืบทอดชัดเจน (W3/W5)

**ใช้:** MKT-A, FAQ-ONLY, MANAGER-AB; F-FAQ/F-FAQ-ORDER

1. เปิด «FAQ» ของโครงการ ตรวจ core ที่ขาดอยู่ก่อนและไม่มี dropdown เปลี่ยนระดับ
   จากคำตอบสืบทอดเลือก «เขียนเฉพาะโครงการนี้» แล้วบันทึกคำตอบของ project
2. เปิด «แก้ที่ต้นทาง» ตรวจระดับต้นทางและ «โครงการที่ได้รับผลตามสิทธิ์ของคุณ»
   จำนวนต้องเป็นสิ่งที่บัญชีเห็นได้ และบอกเมื่อยังนับทั้งหมดให้ไม่ได้
3. เปรียบเทียบ fixture ที่ applicable ตรงกันทุกระดับ แล้วถอดคำตอบที่เฉพาะที่สุดทีละชุด
   ตามการคืน fixture ของผู้ดูแล ไม่ลบประวัติเพื่อทดสอบ
4. ทำซ้ำด้วย FAQ-ONLY รวมหน้า brand และ unit ที่อยู่ในขอบเขต
5. เปิดคำถามมาตรฐานที่ default เป็น business แล้วสร้างคำตอบในหน้า business
   ตรวจระดับคงที่และ applicability ว่างที่ยังไม่ได้เลือก; ลองค่า default ครบทั้งเจ็ดระดับ
   โดยไม่ย้ายคำตอบเดิม สร้าง preview ของ applicability แล้วเปลี่ยนหรือยกเลิก draft
   ก่อนตอบกลับ ต้องไม่เติม phase เก่าลง draft ใหม่
6. หลังอนุมัติ business FAQ ให้ผู้ดูแลเปลี่ยนผล rule ที่เลือก phase โดยไม่แก้ข้อความ
   ทดสอบทั้งก่อน prepare และหลัง prepare เทียบกับ FAQ เพื่อนบ้านที่ผล rule ไม่เปลี่ยน
7. ใช้ corporate FAQ ที่ manual project IDs และ applicability rule ว่าง เปรียบเทียบคำถามมาตรฐาน
   ที่ `show_on_project_pages` เปิดและปิดตาม flow เดิม แล้วเทียบ business FAQ ที่ว่างเหมือนกัน
   แยก fixture แต่ละกรณี ไม่ rescope คำตอบเก่าหรือแก้ history เพื่อคืนค่า

**ต้องเห็น:** ลำดับ unit type > project > project group > programme > brand > business
> corporate; ข้อไม่ applicable ไม่ถูกดึงเข้ามาเพียงเพราะมี business/brand เดียวกัน
FAQ-ONLY อ่าน/แก้/อนุมัติตาม Knowledge ได้; บนหน้า project/brand/unit ที่ไม่มี source V
ต้องไม่มี project facts, media, source editor หรือ private website preview
ส่วนเนื้อหา business ที่เป็นของ Knowledge ใช้สิทธิ์ของตนเอง ข้อความสืบทอดไม่เปิด fact ที่ซ่อน
เมื่อ phase set เปลี่ยน ฉบับอนุมัติเก่าต้องอนุมัติใหม่ก่อนเข้าชุดใหม่และชุดที่เตรียมไว้ต้องปฏิเสธ
เฉพาะรายการที่เปลี่ยน เพื่อนบ้านยังใช้ได้; retained publication/rollback เดิมไม่ถูกเขียนใหม่
corporate FAQ ยังคงสืบทอดตาม opt-in `show_on_project_pages` เดิมเมื่อไม่มี manual/rule;
เมื่อปิด opt-in ต้องไม่สืบทอด ส่วน business ที่ไม่ได้เลือก manual/rule ไม่สืบทอดเข้า project
จาก membership เพียงอย่างเดียว แม้คำถามนั้นเปิด opt-in สำหรับ corporate

### U09 — FAQ ค้นหา ลิงก์ตรง และคัดจากหลักฐานอย่างถูกทาง (W3/N7)

**ใช้:** MKT-A, FAQ-ONLY, ADMIN, ACCOUNT-MANAGER; F-FAQ/F-EVIDENCE

1. ค้นคำถาม/คำตอบ เปิดหน้าถัดไป แล้วเปิดลิงก์ question key ที่อยู่นอก 50 ข้อแรก
   ตรวจคำถามถูกเลือกโดยไม่ทิ้งตัวกรองหรือรายการเดิม และไม่มีคำถามซ้ำ
2. เปิด fact ว่างจาก FAQ และ coverage บนหน้าแรก ตรวจลิงก์ exact field;
   FAQ-ONLY ต้องไม่อ่าน fact/coverage ที่ต้องใช้ Projects V
3. เปิด cluster มี key และ cluster ยังไม่มีคำถามอนุมัติ ใช้กระบวนการ intake เดิม
   ให้ผู้ดูแลเตรียมการพัก/เสนอคำถาม/ไม่ใช้ที่แน่นอนก่อนทดสอบ ห้ามรับเป็น FAQ ไร้ key
4. ADMIN เปิด «ตั้งค่า» → «หลักฐานนำเข้าเดิม»; FAQ candidate อ่านได้อย่างเดียว
   เปิดลิงก์แต่ละ cluster; cluster หลาย phase ที่กำกวมต้องขอบริบท ไม่เลือกตัวแรกเอง

**ต้องเห็น:** MKT และ ACCOUNT-MANAGER ที่ไม่ใช่ actual Admin เข้า evidence ไม่ได้
แม้มี Knowledge V; Admin ยังต้องมี source V ทุกครั้ง ช่องทาง accept เก่าปิดทั้ง UI/API
matched/unmatched cluster มี scope ถูกต้องและแบ่งหน้าครบ การค้นหาหรืออ่านไม่สร้าง gap เอง

### U10 — ลิงก์เก่าถึงงานเดิมพร้อมบริบท (W3/N7)

**ใช้:** MKT-A, FAQ-ONLY; F-OLD-URL ผู้ดูแลเติม URL จริงก่อนเริ่ม

เปิด URL เก่าจากคอลัมน์ซ้ายทีละรายการ แล้วตรวจปลายทางและบริบทด้านขวา
ห้ามพิมพ์ ID ข้าม namespace หรือยอมรับเพียงว่าหน้าไม่เป็น 404

| ทางเข้าเดิม | สิ่งที่ต้องตรวจหลังเปลี่ยนหน้า |
| --- | --- |
| `/?project=…` / `/?brand=…` | entity เดิม แท็บ/field/item/version เดิม; `tab=faq` ต้องคง FAQ |
| `/?view=projects` / `brands` / `groups` | รายการพร้อมงานเดิมของ project/brand หรือ tree ตามชนิด ไม่เสีย create/request/review |
| `/content?project=…&tab=…` | entity data/unit/media ที่ตรงส่วน; website text อยู่ inline ไม่คืนเมนู intake แยก |
| `/media?project=…&tab=…` | รูปหลัก/upload/clip/coverage/website image queue ตรงงาน พร้อม unit/asset/binding/role |
| `/faq` พร้อม draft/cluster/question/phase | FAQ ในระดับและ phase ถูกต้อง; `question_key` เลือกคำถามเดียวกับ `question` |
| `/faq?tab=coverage` พร้อมตัวกรอง | coverage บนหน้าแรก คง project/phase/filter และ guard เดิม |
| `/faq?tab=bank` / `glossary`, `/content/fields` | settings เดิมและ question/term/field เดิมตามสิทธิ์ |
| `/faq?tab=publication`, `/releases` | publishing workspace เดียว; config page/item/field และประวัติทั้งสองยังเข้าถึงได้ |

**ต้องเห็น:** media tags ที่เดิมเป็น JSON array ยังคง tag code ทุกตัว ไม่กลายเป็นเศษ JSON
public unit ID ไม่ถูกแทนด้วย row UUID; FAQ-only root link ไม่ทำให้โหลด source editor
ย้อนกลับ/เดินหน้าของ browser แล้ว context และ active navigation ยังตรงกัน

## 4. งาน Manager และ Online Marketing

### U11 — ส่ง อนุมัติ คืน และถอนทีละรายการ (W4)

**ใช้:** MKT-A, MANAGER-AB; F-DRAFT/F-FAQ

1. MKT บันทึก section, selling point, contact, FAQ และ media link คนละรายการ
   แล้วกด «ส่งอนุมัติ» ตรวจจาก «ร่าง» เป็น «รออนุมัติ»
2. ลองแก้ฉบับรออนุมัติ จากนั้น Manager «อนุมัติ» หนึ่งรายการ
   และ «ส่งกลับ» อีกหนึ่งรายการพร้อม «เหตุผล»
3. ผู้เขียนเปิดงานคืน แก้เป็นฉบับใหม่; แก้รายการที่อนุมัติ/เผยแพร่แล้วอีกหนึ่งรายการ
4. ทดลอง «ถอนคำตอบนี้» กับ FAQ ที่ DRAFT, IN_REVIEW, APPROVED
   โดยใช้คนละ fixture และสิทธิ์ที่กำหนด

**ต้องเห็น:** ฉบับรออนุมัติถูกตรึง รายการอื่นไม่ถูกคืนตาม มีประวัติและเวอร์ชันเดิมครบ
การแก้หลังอนุมัติสร้าง draft ใหม่ หน้าเว็บยังเป็น published snapshot เดิม
ถอน FAQ ไม่ลบประวัติและไม่ทำให้ฉบับที่ยังไม่ได้เผยแพร่กลายเป็นข้อมูลบนเว็บ
ผู้ดูแลแนบ coverage ทุก workflow kind จาก final gate ไม่ใช้ตัวอย่างห้าชนิดแทน coverage ทั้งหมด

### U12 — Manager แก้แล้วอนุมัติได้พร้อมเหตุผล (W4/N1)

**ใช้:** MANAGER-AB, PUB-SELF; F-DRAFT

1. ใช้ «แก้และอนุมัติ» กับ project/brand และข้อความย่อยที่อนุญาต
   ลองไม่กรอกเหตุผลก่อน แล้วกรอกเหตุผลที่ตรวจย้อนหลังได้
2. ตรวจว่าบันทึกฉบับใหม่และอนุมัติสำเร็จในครั้งเดียว ประวัติแสดง «อนุมัติงานที่แก้เอง»
   พร้อมผู้กระทำและเหตุผล; ลองอนุมัติฉบับที่ตนมีส่วนแก้ผ่านปุ่มปกติด้วย
3. ในสอง session ให้คนอื่นแก้ parent/source หลังโหลดฟอร์ม ก่อน save-and-approve
   แล้วลองคำสั่งจากฟอร์มเดิม

**ต้องเห็น:** ไม่มีเหตุผลต้องไม่บันทึกหรืออนุมัติครึ่งเดียว ข้อความเตือน
«ระบุเหตุผลที่อนุมัติงานที่แก้เอง» ชัดเจน stale form ไม่ใช้ metadata ใหม่ rebase ข้อมูลเงียบ ๆ
input ยังอยู่หลังปฏิเสธ และต้องโหลด/บันทึกใหม่อย่างชัดเจน
N1 ไม่เปลี่ยน account/grant/template และไม่เปลี่ยนกติกา promotion

### U13 — ส่งทั้งหมดหมายถึงฉบับที่บันทึกและแก้จริงในหน้านี้ (W4)

**ใช้:** MKT-A; F-DRAFT ที่มีมากกว่าหนึ่งหน้าของรายการ saved draft

1. เปิด entity/phase ที่กำหนด ตรวจรายการก่อนกด «ส่งอนุมัติทั้งหมดที่แก้»
   มี draft และ needs_reapproval ของขอบเขตนี้ แต่ไม่มี inherited draft, อีก phase,
   ลูกโครงการของระดับร่วม หรือ APPROVED ที่ไม่เปลี่ยน
2. ทิ้งฟอร์มหนึ่งยังไม่บันทึกแล้วลองส่งทั้งหมด; บันทึกหรือโหลดฟอร์มนั้นอย่างชัดเจนก่อนลองใหม่
3. หลังโหลดรายการ ให้ session อื่นแก้หนึ่ง source แล้วส่งชุดเดิม

**ต้องเห็น:** เก็บ hash เดิมของแต่ละรายการ ไม่โหลด hash ใหม่เพื่อผ่าน conflict
รายการเก่ารับผล stale ของตน รายการเพื่อนบ้านที่ยังถูกต้องส่งได้และแสดง
«ผลการส่งอนุมัติ» แยกกัน ไม่มีการตัดรายการหน้าถัดไปโดยเงียบ
ข้อมูลที่ยังพิมพ์ไม่ถูกส่งหรือถูกล้างโดยปุ่ม header

### U14 — Promotion ยังแยกผู้แก้และ DATA/LEGAL (W4)

**ใช้:** บัญชี promotion editor, DATA reviewer และ LEGAL reviewer ที่ผู้ดูแลระบุ;
F-PUBLISH promotion แยกจากงาน N1

1. แก้ promotion และลองให้ผู้แก้อนุมัติงานตนเองตามเส้นทางเดิม
2. ผ่าน DATA อย่างเดียวแล้วลองเผยแพร่ จากนั้นผ่าน LEGAL ตามกระบวนการเดิม
3. ตรวจเงื่อนไขราคา วันใช้ สิทธิ์ภาพ และเป้าหมาย promotion เหมือนก่อน programme นี้

**ต้องเห็น:** ยังคง DATA + LEGAL และ separation เดิม ไม่ใช้ N1 ข้ามขั้น
ข้อความ «โปรโมชั่นต้องผ่านการตรวจข้อมูลและกฎหมายตามขั้นตอนเดิม» ไม่ถูกใช้แทนการปฏิเสธจาก server
special เผยแพร่ไม่ให้สิทธิ์แก้หรืออนุมัติ promotion เพิ่ม

### U15 — Online ใช้ View กับ special และคืนได้ทีละชิ้น (W4/N2/N6)

**ใช้:** ONLINE, NO-PUBLISH; F-PUBLISH

1. ONLINE เปิด «เผยแพร่» เลือกรายการทั้งกลุ่ม «เผยแพร่เว็บไซต์»
   และ «ชุดเผยแพร่ข้อมูล» ตรวจ label/source/version และลิงก์ exact item
2. ใช้ «เตรียมตรวจรายการเผยแพร่» แล้ว «ตรวจรายการก่อนเผยแพร่»
   เปรียบเทียบ preview กับ «เวอร์ชันที่เผยแพร่อยู่» และเปิดต้นทางที่ต้องแก้
3. คืนหนึ่งรายการพร้อมเหตุผล; เผยแพร่เพื่อนบ้านที่ยัง APPROVED ด้วย
   «ยืนยันเผยแพร่» จากนั้นลองด้วย NO-PUBLISH และบัญชีขาด source V หนึ่งแท็บ
4. เปิดทางเผยแพร่จาก project/brand/promotion และ brand dashboard ต้องมาที่ `/publish`
   โดยไม่มี POST อัตโนมัติ; การเลือกหลายแบรนด์คง exact ID และแสดงรายการที่ถูกปฏิเสธ
   เปิด `/publish?tab=configuration` พร้อม page/item/field เดิมแล้วตรวจ editor ตามสิทธิ์
5. ให้ retained before-preview มีแหล่งที่ผู้ใช้หมดสิทธิ์ แต่ after-preview มี source V ครบ
   ตรวจว่า before ถูกซ่อนโดยไม่ทำลาย after ที่อนุญาต; ทำกลับด้านแยกอีก fixture
6. ONLINE ที่มี Knowledge V และ special แต่ไม่มี Projects V เปิดงานเผยแพร่ business FAQ
   ที่อนุมัติแล้วจากหน้าแรกและคิว ใช้ source authority จริง ไม่เพิ่ม Projects V เพื่อให้รายการปรากฏ

**ต้องเห็น:** ONLINE ไม่ต้องมี source A แต่ต้อง V ครบและ special จริง
ปฏิเสธผู้ขาดสิทธิ์ทั้ง UI/API; การคืนหนึ่งชิ้นไม่คืนทั้งชุด
preview เป็นเนื้อหาที่อนุญาต ไม่มีข้อมูลภายในหรือการเตรียม/เผยแพร่จาก GET
ทั้งหน้าเว็บและ release มีผลและประวัติแยกกันใต้จุดงานเดียว
ผู้มี Approve อย่างเดียวไม่ได้สิทธิ์เผยแพร่; before/after ที่ปฏิเสธต้องไม่มีข้อความหรือ HTML ซ่อนในหน้า
การปิด before-preview อย่างเดียวไม่ปิดปุ่มเผยแพร่ after ที่ผ่าน source View และ N2 ของตนเอง

### U16 — คนมีส่วนร่วมในฉบับนั้นเผยแพร่ฉบับนั้นไม่ได้ (W4/N2)

**ใช้:** PUB-EDITOR, PUB-EN, PUB-SELF, PUB-APPROVER และ ONLINE; F-PUBLISH แยกสี่ชุด

1. แต่ละ PUB-* เตรียมชุดที่มีฉบับซึ่งตนมีส่วนร่วมตามชื่อบัญชี และฉบับเพื่อนบ้านที่ไม่เกี่ยวข้อง
2. ยืนยันเผยแพร่ ตรวจผลของฉบับที่ตนแก้/ตรวจอังกฤษ/แก้แล้วอนุมัติ/อนุมัติ และผลเพื่อนบ้าน
3. ONLINE ที่ไม่มีส่วนร่วมทำกับฉบับที่เหลือ; ใช้ฉบับใหม่ซึ่งบุคคลนั้นไม่ได้ร่วมแก้
   เพื่อตรวจว่าการห้ามผูกกับ contributors ของฉบับ ไม่ใช่ประวัติตลอดชีวิตของวัตถุ

**ต้องเห็น:** ทั้งสี่บทบาทถูกปฏิเสธเฉพาะฉบับที่เกี่ยวข้อง แม้มี V และ special
มีเหตุผล «ผู้เผยแพร่ต้องเป็นคนละคนกับผู้แก้ไข ผู้ตรวจภาษาอังกฤษ และผู้อนุมัติฉบับนี้» และผลแต่ละรายการชัดเจน
ฉบับที่ผ่านยังเผยแพร่ได้ ไม่ใช้การเพิ่ม A หรือบัญชี Admin ข้ามกติกา
ทุก public change ยังมีผู้อนุมัติและผู้เผยแพร่คนละคน

### U17 — ของเปลี่ยนระหว่างตรวจไม่ทำให้ชุดที่ดีเสียไปด้วย (W4/N2)

**ใช้:** ONLINE, MANAGER-AB; F-PUBLISH/F-DRAFT

1. เตรียมและตรวจ web page + release แล้วให้ session อื่นแก้และอนุมัติ source ใหม่
   ของหนึ่งรายการก่อนกดยืนยันชุดเก่า เก็บอีกหนึ่งรายการไม่เปลี่ยน
2. ทำซ้ำด้วยสิทธิ์ภาพ/วันใช้หมดอายุ และถอน source V หลัง prepare
   ตรวจผล server ของแต่ละกรณีตาม fixture ที่ผู้ดูแลเตรียม
3. ให้ผู้ดูแลเปลี่ยนค่าข้อเท็จจริงที่ใช้อยู่ใน local staging รวมจำนวน phase ที่แสดง
   ตรวจ «ต้องอนุมัติใหม่» และ before/after; แยกกรณีนำเข้าค่าเดิม,
   เปลี่ยนเฉพาะ BU/as_of และเปลี่ยน group แต่จำนวนที่ใช้ยังเท่าเดิม

**ต้องเห็น:** stale/rejected เกิดเฉพาะรายการที่ไม่ผ่าน มี «รายการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุด»
หรือเหตุผลเฉพาะ; รายการอื่นเผยแพร่ได้และแสดง «เผยแพร่บางรายการแล้ว โปรดตรวจรายการที่ยังไม่ผ่าน» เมื่อเหมาะสม
ไม่เผยแพร่ draft หรือฉบับใหม่ที่ไม่ได้เตรียม ค่า local staging ที่มีผลจริงต้องอนุมัติใหม่
แต่ timestamp/BU/ค่าเดิมไม่ทำให้อนุมัติใหม่เอง ผู้แก้ฉบับเดิมยังอยู่ในหลักฐาน reapproval
แยกกรณีขาด source V ระดับแท็บออกจาก stale item: ชุดที่ต้องใช้แท็บนั้นต้องถูกปฏิเสธ 403
ส่วนชุดเพื่อนบ้านที่เตรียมแยกและมี source V ครบยังเผยแพร่ได้ ไม่ใช้ partial outcome ข้ามการปฏิเสธสิทธิ์

### U18 — ถอนและย้อนกลับโดยไม่ทิ้งหลักฐาน (W4/N6)

**ใช้:** ONLINE, RELEASES-HISTORY; F-PUBLISH ที่มี snapshot เก่าสองระบบ

1. เปิด «ประวัติเผยแพร่เว็บไซต์» ใช้ «ถอนหน้าเว็บ» แล้ว
   «คืนเวอร์ชันนี้» ตามสิทธิ์และการยืนยันที่ระบบเดิมกำหนด
2. เปิด «ประวัติชุดเผยแพร่ข้อมูล» ใช้ «ย้อนกลับชุดเผยแพร่»
   ตรวจ «ยืนยันย้อนกลับชุดเผยแพร่» และผลของ pointer/เวอร์ชันจริง
3. ใช้ session อื่นเปลี่ยน pointer ก่อนยืนยัน หรือทำให้ retained source ไม่พร้อม
4. เปิด `/publish?source=project&id=…`, `source=brand` และ `source=promotion`
   ด้วย public ID ที่ตรงชนิด เปรียบเทียบร่างที่อ่านได้กับ snapshot ที่เผยแพร่
   เลือก retained version ที่แน่นอนก่อนย้อนกลับ พร้อมเหตุผลและยืนยันการเปลี่ยน pointer
5. ถอน source ที่เผยแพร่แล้วผ่านจุดเดียวกัน ตรวจ public API ของ source นั้นตอบ 404
   และยืนยันว่า retained version/history ยังอ่านได้ตามสิทธิ์; คืนค่าโดย flow ที่อนุญาตเท่านั้น
6. RELEASES-HISTORY เปิด `/publish` และ URL เก่า `/releases` พร้อม release ID
   ตรวจว่าถึงประวัติ release เดิมโดยไม่มี Knowledge V; เปิดรายละเอียดเฉพาะ source ที่มี V
   แล้วเทียบกับบัญชี Knowledge V ที่อ่านประวัติทั้งสองระบบได้ตาม source guard

**ต้องเห็น:** stale pointer/source ถูกปฏิเสธ ไม่เขียนทับเหตุการณ์หรือ snapshot เก่า
ทั้งสองประวัติอ่านได้และ source guard ยังทำงาน สถานะ «ถอนแล้ว» /
«ย้อนกลับแล้ว» สื่อผลจริง ไม่อ้างว่า FAQ draft withdraw คือการถอนหน้าเว็บ
ไม่มี publish จาก source-history panel; การเปิด เปลี่ยน selection หรือยกเลิก confirmation
ต้องไม่เปลี่ยน pointer และการถอน/คืนต้องอ้าง exact source/version เดิม ไม่เลือกเวอร์ชันล่าสุดแทน
Releases V เพียงอย่างเดียวไม่ทำให้โหลด web queue/configuration หรือได้ special เผยแพร่
เมนูมีปลายทาง `/publish` เพียงแห่งเดียว และ context ของ release ไม่หายระหว่าง redirect

### U19 — ตรวจย้อนหลังตามคน เวลา เหตุผล และค่าที่เปลี่ยน (W3/W4)

**ใช้:** MKT-A, FAQ-ONLY, ADMIN, ACCOUNT-MANAGER; F-HISTORY

1. เปิด «ประวัติ» ของ project/brand/FAQ ตรวจผู้เขียน ผู้อนุมัติ เวลา
   เหตุผล และ «ก่อนเปลี่ยนแปลง» / «หลังเปลี่ยนแปลง» ของ edit/submit/approve/
   self-approve/return/publish/withdraw/rollback/needs_reapproval
2. ตรวจ «การเปลี่ยนแปลงหลังเผยแพร่ล่าสุด» ใน overview รวม ordinary edit ที่ version metadata เป็น null
3. ADMIN เปิด «บันทึกการใช้งาน» กรอง «ผู้ดำเนินการ», BUD, project,
   «วันที่เริ่ม» และ «วันที่สิ้นสุด» รอบวันตาม Asia/Bangkok

**ต้องเห็น:** ไม่มี crash หรือ version ปลอมเมื่อ metadata ไม่มี
วันเริ่มรวม 00:00:00 และวันจบรวม 23:59:59.999 +07:00 ตาม fixture
FAQ-ONLY เห็นเฉพาะประวัติ FAQ/intake ที่อนุญาต ไม่เห็น project/brand edit
ACCOUNT-MANAGER ไม่ได้ activity log เพียงเพราะจัดการบัญชีได้
ไม่มี account/grant/template/permission event หลุดใน content history, export หรือผู้ช่วย

## 5. ขอบเขต BUD และข้อมูลที่เปลี่ยนตามเวลา

กรณี U20–U25 ใช้เวลาและข้อมูลที่ผู้ดูแลเตรียมใน local เท่านั้น ผู้ทดสอบไม่ต้องรอวันจริง
ก่อนแต่ละจุดให้จด `fake_now`, source watermark ที่เก่าสุด, accepted run/epoch,
เวลารับ move และค่า grace ปัจจุบัน ห้ามใช้เวลารับไฟล์แทนเวลาต้นทาง
ค่าปกติ grace = 7 × 24 ชั่วโมง; ขอบเขตเวลาในกรณีต่อไปใช้ค่านี้เว้นแต่ระบุเปลี่ยน
คำนวณจาก instant จริง แม้เปลี่ยน session timezone หรือมี DST ก็ห้ามได้เวลาเพิ่ม
เวลาแสดงในหน้าจอเป็น Asia/Bangkok โดยแยก stale cutoff กับ handover cutoff ให้เห็นเมื่อมีทั้งคู่

ใบ fixture ต้องมีแปดคอลัมน์ `project_id`, `rem_bu_id`, `rem_bu_code`,
`rem_bu_name`, `rem_bu_is_active`, `rem_bu_is_deleted`, `source_snapshot_at`,
`project_status_code` โดยค่า null ไม่ถูกเปลี่ยนเป็น false หรือค่าสมมติ
source watermark คือค่าที่เก่ากว่าระหว่างการเก็บ project และ BU dictionary ครบชุด
การเตรียม local ต้องไม่เรียก relation จริงเพื่อเติมค่า

| สัญลักษณ์/จุดตรวจ | เวลาและผลที่คาดสำหรับ grace 7 วัน |
| --- | --- |
| S0 | source watermark ที่เก่าสุดของ last-good snapshot; ผู้ดูแลเติมวันเวลาจริงใน fixture |
| รับที่ S0 +48 ชั่วโมงพอดี | รับได้ถ้าแถวอื่นถูกต้อง; เหลือ 5 วันถึง stale cutoff ไม่ใช่ได้เพิ่มอีก 7 วัน |
| รับที่ S0 +48 ชั่วโมงเกินแม้เพียงเล็กน้อย | ปฏิเสธทั้ง refresh; last-good/run/epoch และสิทธิ์ที่ยังไม่ถึง cutoff คงเดิม |
| S0 +5 วัน | เตือนผู้ที่สิทธิ์พึ่ง BU และผู้จัดการบัญชี พร้อมวัน cutoff |
| S0 +7 วัน −1 millisecond / S0 +7 วัน | ก่อนเส้นยังใช้ BU grant ได้ / ตรงเส้นหยุด โดยไม่มี tick ก็ต้องหยุด |
| M0 | เวลารับ move A → B; B ได้ทันที A สิ้นสุดที่ค่าก่อนกว่าระหว่าง M0 +7 วันกับ stale cutoff ปัจจุบัน |
| รับ source สดระหว่าง handover | stale cutoff ขยับตาม source ใหม่ได้ แต่ M0 ของ move เดิมไม่เริ่มใหม่ |

วัน relay ที่เคยข้าม 29/31 ตุลาคมและ 1 พฤศจิกายน 2026 ใช้เป็นกรณีไม่มี source ใหม่
ไม่สร้าง watermark ใหม่จากเพียงเวลาที่ job local ทำงาน ตารางนี้ไม่สั่งรัน scheduler จริง

### U20 — เลือกสิทธิ์ตามงานโดยเห็นผลก่อนยืนยัน (W6)

**ใช้:** ACCOUNT-MANAGER, ADMIN, MKT-A, UNRESTRICTED; F-BU

1. เปิด «ผู้ใช้และสิทธิ์» ตรวจบัญชีเดิมยัง «ทุกโครงการ» เฉพาะแท็บที่มี base grant
   เลือก «ขอบเขต» / «เลือกเอง» ของ V/E/A ทีละระดับ
   เลือก BU-A พร้อม project exception แล้วดูรายชื่อโครงการที่ได้/เสียก่อนยืนยัน
2. เปลี่ยน base grant/template ถอดแล้วให้แท็บเดิมกลับ ด้วย flow ปกติ
   ตรวจว่า scope ที่เลือกยังอยู่; ลอง selected-empty และบัญชีไม่มี base V
3. เปิด preview แล้วให้ session อื่นเปลี่ยนบัญชี/scope/accepted run/settings
   หรือข้ามเส้นเวลา expiry ก่อนยืนยัน
4. เตรียม V/E/A คนละชุด project/BU: ให้ E หรือ A ของรายการหนึ่งแต่ V ของรายการนั้นไม่มี
   ต้องใช้ E/A ไม่ได้ ขณะที่รายการเพื่อนบ้านที่ V และระดับงานตรงกันยังใช้ได้
5. เตรียมตัวเลือกโครงการมากกว่า 100 รายการ ใช้ «โหลดรายการเพิ่มเติม» แล้วเลือก
   project exception ในหน้าถัดไป ยืนยันผ่าน flow เดิม จากนั้นเปิดใหม่โดยให้โครงการที่บันทึก
   อยู่นอกหน้าปัจจุบัน ถอดรายการนั้นแล้วตรวจ preview ก่อนยืนยันการถอด
6. คงรายการ scope ที่ยังไม่ยืนยันไว้ระหว่างแบ่งหน้าประวัติและแก้ base grant โดยยังไม่บันทึก
   ตรวจ «บันทึกหรือยกเลิกการแก้ไขสิทธิ์รายแท็บก่อนเปลี่ยนขอบเขต» แล้วบันทึกหรือยกเลิก
   base grant ตาม flow เดิม รายการ scope ที่เลือกค้างต้องไม่หายหรือถูกยืนยันแทนโดยเงียบ

**ต้องเห็น:** ไม่มีการยกเลิก scope เงียบ ๆ จากการใช้ template/ให้สิทธิ์ใหม่
selected-empty ปฏิเสธ; ไม่มี base grant ไม่ได้สิทธิ์จาก scope
preview stale เปลี่ยนอะไรไม่ได้ทั้งชุด ต้องตรวจใหม่; การกลับเป็นไม่จำกัดต้องเป็น
การเลือกและยืนยันอย่างชัดเจน แสดงสมาชิก BU ในอนาคตตามความหมายจริง
การแบ่งหน้าไม่ทำตัวเลือกหรือรายการที่บันทึกแล้วหาย project exception ที่อยู่นอกหน้าปัจจุบัน
ยังถอดได้และมีผลตรง preview โดยไม่เปลี่ยนรายการอื่น

### U21 — BUD ใช้ตัวตนจาก REM และสิทธิ์ร่วมไม่เท่ากับทั้งแบรนด์ (W6)

**ใช้:** MKT-A, MKT-B, MANAGER-AB, FAQ-ONLY; F-ENTITY/F-BU

1. เปรียบเทียบ project ภายใต้ brand เดียวแต่คนละ BU; ค้น BUD และดู picker
   ตรวจ exact `rem_bu_id`, code/name รวม prefix ช่องว่าง ตัวพิมพ์ และเลขศูนย์นำหน้า
2. เปิด fixture code ซ้ำ ID ต่าง, BU inactive/deleted/unknown และ closed project
   ตรวจว่า flags/status ไม่ถูกนำมาคิดสิทธิ์เอง และไม่ใช้ business sheet เดา BUD
   แยกกรณี nonblank BU ID ที่ dictionary ไม่รู้จักออกจาก NULL BU; ห้ามตั้ง code/name แทนค่า null
3. แก้เนื้อหาร่วมที่มี affected projects ใน A/B ด้วยบัญชีเห็นบางส่วน
   แล้วลองอนุมัติด้วยผู้ที่ครอบคลุมไม่ครบ เปลี่ยน applicability ก่อนลองอีกครั้ง

**ต้องเห็น:** V/E ต้องสัมพันธ์กับโครงการที่เกี่ยวข้องจริง; A ของ shared source ต้อง
ครอบคลุมทั้งหมดหรือไม่จำกัดตามกติกาปัจจุบัน ไม่อนุมัติด้วย affected set ว่างโดยปริยาย
E/A ยังต้อง V ของวัตถุ; global configuration ไม่ใช้สิทธิ์บาง BU แทนไม่จำกัด
FAQ ยึด Knowledge scope แยกจาก Projects และไม่เปิด hidden affected counts
บันทึกสถานะคำถาม shared approval ของเจ้าของตามจริง หากยังรอคำตอบให้คง pending
แยกจากผลทดสอบกติกาปัจจุบัน ไม่ถือว่าการทำ UAT เป็นคำตอบแทนเจ้าของ

### U22 — ย้าย BUD แล้วยังส่งต่องานได้ตามวันสิ้นสุดจริง (W6)

**ใช้:** MKT-A, MKT-B, PROJECT-EXCEPTION, UNRESTRICTED; F-BU

1. ณ T0 รับ snapshot ที่สดและถูกต้องให้ project ย้าย A → B
   เปิดด้วย A/B ทันที ตรวจ banner วันสิ้นสุดบน project และแจ้งเตือนของผู้เกี่ยวข้อง
2. รับ snapshot สดซ้ำที่ยังอยู่ B แล้วเดิน fake clock ถึงก่อน/ตรงเส้น handover
   โดยยังมี source สดพอ; ตรวจ A หมดสิทธิ์ตรงเวลาและ B ยังเข้าถึงได้
3. คืน fixture แล้วทำ A → B → C, กลับ A, A → NULL และ project หายจาก snapshot
   ตรวจแต่ละช่วงกับตารางเวลาที่ผู้ดูแลเตรียม ไม่มีการรีเซ็ตวัน move เก่าเมื่อ refresh
4. เปิดไฟล์/thumbnail/history ของ project เดิมก่อน cutoff แล้วให้คำขอรออยู่จนข้าม cutoff
   เมื่อทำต่อ A ต้องไม่ได้ private bytes/ผลเก่า ส่วน B และ project exception ที่ยังอนุญาตยังทำงาน
5. บันทึกสถานะอนุมัติ รหัสฉบับอนุมัติ รหัสเวอร์ชันที่เผยแพร่ รหัสชุดเผยแพร่ และรายการประวัติ
   ของเนื้อหาทดสอบก่อนรับ snapshot ย้าย BUD เทียบอีกครั้งหลังย้ายและหลังรับ snapshot สดซ้ำ
   โดยไม่มีการแก้เนื้อหา อนุมัติ หรือเผยแพร่เพิ่มระหว่างเปรียบเทียบ

**ต้องเห็น:** B ได้ทันที A ได้ช่วงส่งต่อไม่เกิน 7 วันจาก accepted move และไม่เกิน
stale deadline ของ source; move ซ้อนนับแยก ไม่ได้สิทธิ์ซ้ำจาก set ซ้ำ
A → NULL/หายปิด BU handover ทันที project exception และ unrestricted ยังอยู่
การเข้า URL เดิมหลังหมดสิทธิ์ไม่คืนข้อมูลค้าง; unsaved input ไม่ถูกล้างโดยเงียบ
การย้ายหรือ refresh สมาชิกเปลี่ยนเฉพาะสิทธิ์ตามเวลา ไม่ทำให้เนื้อหาต้องอนุมัติใหม่
สถานะและรหัสอนุมัติ/เวอร์ชัน/ชุดเผยแพร่/ประวัติเผยแพร่ที่บันทึกไว้ต้องตรงเดิม

### U23 — ข้อมูลต้นทางเก่าหรือ refresh ผิดไม่ขยายอายุสิทธิ์ (W6)

**ใช้:** MKT-A, ACCOUNT-MANAGER, PROJECT-EXCEPTION, UNRESTRICTED; F-BU

1. รับ snapshot ที่อายุครบ 48 ชั่วโมงพอดี แล้วลองเกิน 48 ชั่วโมง, timestamp null/
   future/ไม่ถูกต้อง, duplicate/null project ID และชุดว่าง ทีละ fixture
2. ทำ failed refresh หลัง last-good; เดินเวลา source +5 วัน, ก่อน +7 วัน,
   และตรง +7 วัน โดยหยุด maintenance tick ตามการจำลองของผู้ดูแล
3. ทดสอบ source watermark ต่างกันในชุดเดียว ใช้ค่าที่เก่าสุดสำหรับ deadline
   แล้วลอง fetch/retry/accept ซ้ำและรับ identical input ด้วย epoch เดิม
4. ให้ผู้ดูแลสาธิต refresh สองชุดเสร็จย้อนลำดับ รวม equal-watermark แต่ membership ต่าง
5. หลังรับ last-good ที่สด ลองชุดอายุ 49 ชั่วโมงก่อนถึงวันเตือนของ last-good
   ต้องแจ้ง failed refresh เฉพาะผู้จัดการโดยไม่ตัด BU access เดิมหรือย้าย deadline
   แล้วทดสอบ no initial snapshot แยกจาก rejected refresh หลังมี last-good
6. บันทึกสถานะอนุมัติ รหัสฉบับอนุมัติ รหัสเวอร์ชันที่เผยแพร่ รหัสชุดเผยแพร่ และประวัติเดิม
   ก่อน failed/rejected refresh และก่อนรับ snapshot สดที่คืนสิทธิ์ เทียบหลังแต่ละขั้น
   โดยไม่แก้เนื้อหา อนุมัติ หรือเผยแพร่เพิ่ม

**ต้องเห็น:** ผิดหนึ่งแถวปฏิเสธทั้งชุด last-good ไม่เปลี่ยน; ไม่ใช้ customer/unit relay
หรือเวลา fetch เป็น BU watermark; 48 ชั่วโมงเป็นเกณฑ์รับ snapshot ไม่ใช่ตัดสิทธิ์
วันที่ 5 เตือน วันที่ 7 BU-based access หยุดแม้ไม่มี tick; exception/unrestricted ยังเข้าได้
no initial snapshot ต้องปฏิเสธ BU grant; รับ source สดจึงคืนสิทธิ์ได้
stale refresh completion ถูกปฏิเสธและ retry ต้องอ่านใหม่ identical input ไม่รีเซ็ต epoch/เวลา
การหมดสิทธิ์และคืนสิทธิ์จากสมาชิก BUD ไม่เปลี่ยนสถานะอนุมัติหรือรหัสที่บันทึกไว้
และไม่เขียนทับหรือสร้างประวัติเผยแพร่เนื้อหาแทนการเปลี่ยนสมาชิก

### U24 — แจ้งล่วงหน้า ตั้ง grace และย้อนดูสิทธิ์ที่เปลี่ยนจริง (W6)

**ใช้:** ADMIN, ACCOUNT-MANAGER, MKT-A, PROJECT-EXCEPTION; F-BU

1. ตรวจ failed/stale refresh แจ้งผู้จัดการบัญชี; วันที่ 5/7 แจ้งผู้ที่พึ่ง BU จริง
   และผู้จัดการ พร้อม cutoff และลิงก์ให้ project exception ตาม flow preview/apply
2. ตรวจ move notice ของ A/B และ project banner; ผู้มีทางเข้าทางอื่นไม่ถูกบอกว่าเสียสิทธิ์ทั้งหมด
3. ADMIN ที่มี account authority ลอง grace 1 และ 7, ค่า 0/8, ลดเวลาเหลือน้อยกว่า 2 วัน
   และเพิ่มที่อาจคืนสิทธิ์; ตรวจผลได้/เสียก่อนยืนยันและ stale confirmation
4. ACCOUNT-MANAGER ที่ไม่ใช่ actual Admin และ Admin ที่ขาด account authority ลองตั้งค่า
   เปิดประวัติบัญชีที่มี scope-effect มากกว่า 100 รายการและ permission/agency เดิม
5. เปิดคำเชิญบัญชี pending ด้วย flow เดิม ตรวจ gain เมื่อยอมรับสำเร็จครั้งเดียว
   scope ที่เลือกไว้คงเดิม; การยอมรับที่ถูกปฏิเสธ/ล้มเหลวต้องไม่มี activation หรือ history ครึ่งเดียว
6. ให้ผู้ดูแลพัก notice read หลังรอ scope lock แล้วข้ามเส้นวัน 5/7 หรือ handover ก่อนปล่อย
   เวลาที่ใช้คำนวณต้องเป็นหลังได้ lock ไม่คืน notice ที่หมดอายุจากเวลาที่จับไว้ก่อนรอ
7. ใช้ ACCOUNT-MANAGER ที่ไม่มี content View ทุกแท็บและไม่ใช่ ACTIVE Admin
   เปิด «ผู้ใช้และสิทธิ์» ตรวจ notice และ «จัดการสิทธิ์รายโครงการชั่วคราว» ผ่าน Accounts
   ลิงก์ยังเข้า flow preview/confirm เดิมได้ แต่เปิดเนื้อหาหรือตั้ง grace ไม่ได้
8. ใช้ MKT-A เปิดฟอร์มโครงการจริงและพิมพ์ข้อความของตนที่ยังไม่บันทึก
   กด «โหลดข้อมูลล่าสุด» ของ notice ตรวจวันที่สิ้นสุดและข้อความในฟอร์มหลัง refresh
   ตรวจการเก็บข้อความค้างในฟอร์มเดิมนี้แยกจากกรณีสลับ phase และคำตอบช้าของ U25

**ต้องเห็น:** มี setting เดียวในช่วง 1..7; สองบัญชีไม่ครบเงื่อนไขตั้งไม่ได้
การลด grace เตือนตามเวลาที่เหลือ/ทันทีเมื่อจำเป็น การเพิ่มแสดงการคืนสิทธิ์จริงก่อนยืนยัน
history แบ่งหน้าระบุ project gain/loss, logical effective time และ observed time
ไม่ยัดทุกเหตุการณ์ลง directory ไม่ซ้ำเมื่อ tick ซ้ำ ไม่เขียน history จากการ GET
project exception ชั่วคราวไม่อ้างหมดอายุอัตโนมัติ หากระบบไม่ได้มี expiry ที่อนุมัติไว้
ordinary user เห็นเฉพาะ notice ของตน ไม่มีลิงก์บัญชีหรือ payload ของผู้อื่น
manager ใช้ได้เฉพาะลิงก์ `/admin/accounts` ที่ระบบตรวจแล้ว; home notice ไม่เข้า assistant context/example
การรับ notice และเปิดลิงก์ผ่าน Accounts ไม่เพิ่ม content View หรือสิทธิ์ ACTIVE Admin
ให้ ACCOUNT-MANAGER; การ refresh notice ไม่บันทึก ไม่ล้าง และไม่เขียนทับข้อความค้างในฟอร์ม

### U25 — ถอนสิทธิ์แล้วข้อมูลเดิมไม่รั่วจากทางอื่น (W6)

**ใช้:** MKT-A และเพื่อนบ้านที่ยังมีสิทธิ์; F-BU/F-PUBLISH/F-AI

ให้ผู้ดูแลเตรียม URL และจุดพัก request ที่รองรับจริงก่อนเริ่ม
ทดสอบหนึ่ง project ถูกถอน V/เปลี่ยน scope/ข้าม stale หรือ handover deadline
โดยยังเปิดอีก project ที่มีสิทธิ์อยู่เป็นตัวเทียบทุกครั้ง

เพิ่มกรณี client โดยผู้ดูแลใช้ browser fixture ที่ควบคุมเวลาและคำตอบช้าได้จริง:

1. เปิด source และพิมพ์ข้อความค้าง ให้ถึง `content_scope.expires_at` ขณะที่ `/me` ยังรอ
   จากนั้นให้ refresh ล้มเหลว ข้อมูล source/cache/name ที่ป้องกันต้องหายทันทีและยังปิดอยู่
   ข้อความที่ผู้ใช้พิมพ์เองในบัญชีเดิมต้องยังอยู่ในทางกู้คืนที่ระบบรองรับ
2. คง base grants เดิมแต่เปลี่ยน scope fingerprint แล้วปล่อย search/citation/proposal/SSE
   เก่าที่รออยู่ ต้องไม่คืนข้อมูลหรือ diff เดิม ไม่เขียนทับข้อความที่ยังไม่ส่ง
   หากมีคำขอ refresh ใหม่ระหว่าง `/me` หรือ assistant config ยังรอ ต้องไม่ทำคำขอใหม่นั้นหาย
3. รับข้อผิดพลาดที่มี `invalidate_access=true` ตรวจว่าปิดข้อมูลก่อน fresh `/me` สำเร็จ
   เทียบกับ 403 ของวัตถุหนึ่งที่ไม่มี flag ซึ่งต้องไม่ล้างสิทธิ์ทั้งบัญชี และเทียบ unrestricted
   ที่ยังใช้ได้; เปลี่ยนเป็นคนละบัญชีจริงต้องไม่แสดงข้อความกู้คืนหรือชื่อจากคนก่อน
4. ใช้โครงการหลาย phase ที่ยังมีสิทธิ์ เปิด phase A แล้วพักคำตอบ refresh notice ของ A
   สลับไป phase B ผ่าน flow ปกติ โดยบันทึกหรือละทิ้งข้อความของ A ตามการยืนยันเดิม
   จากนั้นพิมพ์ข้อความเฉพาะที่แยกแยะได้และยังไม่บันทึกในฟอร์มจริงของ B
   บันทึก banner/cutoff และข้อความค้างของ B ก่อนปล่อยคำตอบ A ที่มาช้า
   หลังปล่อย banner/cutoff และข้อความค้างของ B ต้องไม่เปลี่ยน คำตอบนั้นต้องไม่คืน
   «โครงการย้าย BUD อยู่ระหว่างส่งต่องาน» หรือ «สิ้นสุดการส่งต่องานวันที่» ของ A บน B

| จุดตรวจ | สิ่งที่ผู้ทดสอบดูร่วมกับหลักฐาน final gate |
| --- | --- |
| list/detail/tree/search/home/readiness/coverage | ไม่มีชื่อ ID count facet หรือ nested binding ของ project ที่หายสิทธิ์; pagination ไม่เปิดข้อมูลซ่อน |
| history/version/CSV/private preview | URL เก่าและ cached result ใช้สิทธิ์ปัจจุบัน ไม่แสดง draft/snapshot ภายในที่หมดสิทธิ์ |
| file/thumbnail/cache hit | หยุดระหว่างอ่าน local bytes/สร้าง thumbnail แล้วถอนสิทธิ์; เมื่อทำต่อไม่คืน bytes/path ที่โหลดไว้ก่อนถอน |
| ผู้ช่วย/retrieval/citation/proposal | หยุด tool/embedding/queued SSE แล้วถอนสิทธิ์; ไม่ส่งคำตอบหรือ citation เก่า ไม่ apply proposal; เก็บข้อความที่ยังไม่ส่ง |
| translation/media/W7 worker | ถอน V/E หรือให้ source เปลี่ยนระหว่าง request/claim/pre-fetch/finish; ไม่อ่าน private bytes หรือจบงานเข้า content หลังถูกปฏิเสธ |
| publish/specials | prepare สำเร็จก่อนถอนสิทธิ์ไม่ใช่ใบอนุญาตถาวร; recheck วัตถุจริงและไม่ทิ้งผลเพื่อนบ้าน |
| public consumer เดิม | published allowlist เดิมยังใช้ได้ตามข้อยกเว้นเดิม ไม่มี draft/internal metadata เพิ่ม และไม่ใช้ public path เปิด private file |

**ต้องเห็น:** การอนุญาตหลัง await และก่อนคืนข้อมูลจริงมีหลักฐานเฉพาะกรณี
ไม่ถือเพียงเมนูหายเป็นหลักฐานป้องกัน API/RLS/cache; Accounts notices/history
ไม่เข้าคำตอบ ผู้ช่วย content export หรือ AI prompt
หลักฐาน API/DB ของ raw table/private helper/clock denial เป็นส่วนบังคับใน final gate

## 6. ผู้ช่วยเขียนที่ผู้ใช้เป็นคนตัดสินใจ

### U26 — ทุกช่องเริ่มปิดและเปิดได้เฉพาะข้อความที่อนุญาต (W7/N5)

**ใช้:** ผู้มีสิทธิ์ทะเบียนฟิลด์, MKT-A, VIEWER; F-AI

**เตรียมเพิ่มสำหรับ U27–U28:** fixture คำขอสถานะ running/ambiguous ของ revision ปัจจุบันและ revision เก่า พร้อม request ID, source binding, สิทธิ์ และยอดจอง/ยอดคิดก่อน–หลัง; ใช้เพดานสังเคราะห์มากกว่าศูนย์เพื่อพิสูจน์การคิดคำขอใหม่ แล้วคืนค่าตามใบ fixture โดยยังใช้ stub เท่านั้น

1. ก่อน opt-in ตรวจว่าทุก field เริ่มปิด «เปิดใช้ผู้ช่วยร่างข้อความ»
   ไม่มีการเปิด eligible ทั้งชุดจาก migration หรือค่า default ของ UI
   ค่าเริ่มต้นงบเป็นศูนย์และ provider เป็น stub; กรณี fixture ที่เปลี่ยนงบต้องบันทึกและคืนค่า
2. เปิดหนึ่ง field marketing TH/EN ที่อนุญาตผ่านการบันทึกทะเบียนตามสิทธิ์ปกติ
   ตรวจปุ่ม «ร่างจากข้อมูล», «ตรวจคำและไวยากรณ์», «ปรับให้กระชับ» ของ field นั้น
3. ลองช่อง legal/disclosure, sales terms, price, promotion conditions, finance,
   investor figures, contacts และ customer data รวมการเรียกตรงด้วย fixture ของผู้ดูแล

**ต้องเห็น:** ต้อง opt-in จริงและ source V/E ปัจจุบัน ช่องที่ปิดไม่เริ่มคำขอ provider
หากแสดงเหตุผลของช่องที่ปิด ใช้ «ช่องนี้ยังไม่เปิดให้ผู้ช่วยร่างข้อความ»
รายการห้ามไม่เปิดได้แม้พยายามส่ง flag; VIEWER ใช้คำสั่งเขียนไม่ได้
ไม่มีการเรียก provider จริงในทุกขั้น
corporate narrative ที่ยังไม่มี ordinary editor ต้องไม่สร้างทางบันทึกขึ้นมาเฉพาะ AI
brand ที่ไม่มี context อื่นที่อนุญาตยังตรวจคำ/ย่อข้อความเดิมได้ แต่ร่างจากข้อมูลต้องไม่เปิดให้กด

เลือกตัวอย่างที่บันทึกแล้วจากแต่ละ writer ด้านล่าง ผู้ดูแลแนบกรณีครบทุก field จาก gate
ค่าผูกต้องมาจาก projection จริง ไม่เดา row UUID จาก public ID และไม่ใช้ hash ใหม่แทน stamp เดิม

| ช่อง native ที่อยู่ในขอบเขต W7 | ตัวบันทึกเดิมและค่าควบคุมความขัดแย้ง |
| --- | --- |
| `project.meta_title`, `project.meta_description` | Project PATCH; `updated_at` ของ draft ที่โหลด |
| `brand.description` | Brand PATCH; `updated_at` ของ brand ที่โหลด |
| `section.*` ที่อยู่ใน allowlist รวม business; `selling_point.title/detail` | Section/selling-point PUT; `expected_revision` เดิม |
| `facility.description` ใน amenities และรายการเดิม | Amenities ใช้ revision; รายการเดิมใช้ parent project `updated_at`; identity เป็น project UUID + facility code |
| `commercial_type.description/highlights` ใน wizard และ description ในรายการเดิม | Commercial-type PATCH; parent project `updated_at` เดิมและ public type ID ตรงรายการ |
| `faq.question/alt_questions/short_answer/detail` | FAQ PUT; revision เดิม, answer kind เป็น text, ไม่มี fact slots, topic ที่อนุญาต |
| `article.title/excerpt/seo_title/seo_description` | Article PUT; revision เดิมและ translation owner ของ path นั้น; เก็บ blocks/links/metadata อื่น |

### U27 — เห็น diff ก่อนตัดสินใจและบันทึกแค่ฉบับร่าง (W7)

**ใช้:** MKT-A; F-AI ช่องที่เปิดแล้วและ ordinary writer เดิม

1. ใช้ทั้งสาม action กับ TH และ EN เฉพาะช่องที่มี context ตาม stub ที่เตรียม ดูก่อน/หลังพร้อมจำนวนและ placeholder
   ก่อนยอมรับตรวจว่า source, revision และสถานะยังไม่เปลี่ยน
2. เลือก «ไม่ใช้ข้อเสนอนี้» แล้วตรวจไม่เกิด draft save
   ขอใหม่ด้วยกรณีที่สำเร็จ เลือก «ยอมรับและบันทึกฉบับร่าง»
3. ตรวจ «บันทึกข้อเสนอเป็นฉบับร่างแล้ว» ฉบับร่าง ประวัติผู้กระทำ เวลา และ usage metadata
   ลองกรณี stub เปลี่ยนจำนวนหรือ placeholder ที่ต้องคงไว้
4. ทดสอบ source ว่างที่มี context ที่อนุญาต กับ source ไม่มี context แยกกัน
   context มีไม่เกิน 8 translation references จากวัตถุ/หน้าเดียวกันที่อ่านได้และเปิดใช้จริง
   ไม่มี raw text ของช่องห้ามหรือของ project อื่นในคำขอ; source binding คง translation ID,
   owner, field, revision, `th_version` และ locale ของรายการที่เลือก
5. ขณะขอผล อ่าน diff ยอมรับ และรอโหลด translation/source ใหม่ ให้ลอง field คู่ TH/EN
   รายการข้างกัน ปุ่ม workflow และเปลี่ยนหน้า/phase ปุ่มเจ้าของ proposal ยังตัดสินใจได้
   แต่ทางบันทึกอื่นต้องไม่แทรกระหว่างงาน; locale ที่ไม่ได้เลือกและข้อมูลอื่นต้องคงเดิม

6. เปิด diff ของ section A ที่ร่างจาก section B ซึ่งบันทึกแล้วและอยู่ใน context ของข้อเสนอนั้น จากนั้นให้ fixture อีกคำขอแก้ B จน revision เปลี่ยน โดยไม่แก้ A แล้วจึงยอมรับ diff ของ A
   ตรวจว่าการยอมรับอ่านสถานะของ A และทุก context ด้วย GET ของ translation ID เดิม; ID/revision ของ B ต้องตรงข้อเสนอและยัง eligible หาก B เปลี่ยนฉบับ หมดสิทธิ์ View หรือถูกปิด eligibility ต้องไม่เรียก ordinary writer
   ไม่ส่ง POST ขอข้อเสนอใหม่ ไม่ retry หรือคืนยอดคิดเอง; A และข้อความที่ผู้ใช้ยังไม่บันทึกต้องคงเดิม
   แยก fixture ที่ B ยัง eligible และ revision เดิมแต่มีเพียง View: ต้องไม่เรียกร้อง Edit ของ B และเมื่อ A ยังผ่านสิทธิ์/ฉบับเดิมต้องบันทึก ordinary draft ได้หนึ่งครั้ง
   ระหว่างรอ GET ของ context ให้ลองแก้ข้อความ A หรือออกจาก field: ต้องตรวจ snapshot/สิทธิ์ปัจจุบันอีกครั้งก่อน writer และไม่เขียนทับข้อความหรือบันทึกจาก field ที่ปิดไปแล้ว

**ต้องเห็น:** ใช้ writer และ original revision เดิม บันทึกเมื่อยอมรับเท่านั้น
หลังการกู้สถานะตาม U28 และขอใหม่โดยชัดเจน ให้ทำกรณีบันทึกสำเร็จนี้ซ้ำ: ordinary writer รับ source V/E/BUD/object authority และ revision/updated_at ของ proposal ใหม่นั้นตามเดิมเพียงครั้งเดียว ไม่รับ proposal เก่าด้วย revision ใหม่
ไม่ submit/approve/publish อัตโนมัติ; protected text ผิดแสดง
«ข้อเสนอเปลี่ยนข้อความที่ต้องคงไว้ จึงไม่สามารถใช้ข้อเสนอนี้ได้» และใช้ข้อเสนอนั้นไม่ได้
draft ยังต้องผ่าน Manager และ Online ตามปกติ ไม่มีข้อความหรือข้อมูลลูกค้าจริงใน fixture

### U28 — งบ ผลกำกวม และสิทธิ์เปลี่ยนไม่ทำให้ลองเองหรือทับงาน (W7/W6)

**ใช้:** MKT-A, ADMIN; F-AI

1. พิมพ์ฟอร์มค้างแล้วขอช่วยเขียน ตรวจ «บันทึกหรือโหลดข้อมูลล่าสุดก่อนขอให้ช่วยร่างข้อความ»
   หลังเริ่ม stub ให้ session อื่นแก้ source หรือถอนสิทธิ์ก่อนรับผล/ยอมรับ
2. ทำให้ ordinary draft save ไม่สำเร็จ ตรวจ «บันทึกไม่สำเร็จ ข้อเสนอยังอยู่ กรุณาตรวจข้อมูลก่อนลองอีกครั้ง»
   และข้อความข้อเสนอ/ข้อความผู้ใช้ยังอยู่โดยไม่แอบโหลด hash ใหม่
3. แยก fixture ที่ ordinary save สำเร็จแล้ว แต่ translation หรือ source reload ถัดไปล้มเหลว
   ตรวจว่ามี writer เพียงครั้งเดียว diff ยังอยู่และปุ่มอื่นยังถูกกันไว้
   การตรวจสถานะใหม่ต้องไม่บันทึกซ้ำหรือใช้ revision/hash ใหม่รับ proposal เก่า
   หลังเห็น stale ให้ปฏิเสธ proposal แล้วโหลดข้อมูลอย่างชัดเจน ไม่สั่ง ordinary save ซ้ำเอง
4. ระหว่าง acceptance reload ให้ถอนสิทธิ์หรือปิด registry flag ของ field
   proposal ที่เก็บค้างต้องหายทันทีเมื่อรู้ผลปฏิเสธ และ late response ต้องไม่คืน diff กลับมา
5. ใช้ stub กรณีผลกำกวม และกรณีงบเดือนเต็ม เก็บจำนวน attempt ก่อน/หลัง
   ตรวจข้อความเกินงบเดิมของระบบโดยผู้ดูแลยืนยัน literal ที่ final W7/W8
   สำหรับ running ของ revision ปัจจุบัน ให้ตรวจว่าคำสั่งขอใหม่ยังถูกกัน แม้มี ambiguous อยู่ด้วย; running/ambiguous ของ revision เก่าต้องไม่กั้น revision ปัจจุบัน
   เมื่อผู้ดูแลทำให้คำขอเดิมปรากฏเป็น ambiguous ให้กดโหลดสถานะล่าสุด และกลับมา focus หน้าเดิม: การอ่านสถานะใช้ GET เท่านั้น ไม่ส่ง POST ขอข้อเสนอหรือ ordinary save ซ้ำ ไม่ retry อัตโนมัติและไม่คืนยอดคิดของคำขอเดิม
   เมื่อไม่มี running ของ revision ปัจจุบันและสิทธิ์/field/budget ยังอนุญาต ให้ผู้ใช้เลือก action ขอใหม่โดยชัดเจนเพียงครั้งเดียว: ต้องได้ request ID ใหม่และ POST ใหม่หนึ่งครั้ง คำขอเดิมยังมีอยู่และยอดคิดเดิมไม่ถูกคืน คำขอใหม่ถูกจอง/คิดตามเพดานอีกครั้ง
   ตรวจว่าการขอใหม่อย่างเดียวยังไม่แก้ source จากนั้นใช้ proposal ใหม่ทำกรณี ordinary save สำเร็จใน U27; เปรียบเทียบ method/path, request ID, revision และยอดคิดแยกจากภาพหน้าจอ
6. ให้ผู้ดูแลแนบกรณีคำขอซ้ำ ID เดิมและหลายคำขอชน budget พร้อมกัน
   รวมการรอ budget lock แล้ว source/context เปลี่ยนหรือ BUD หมดอายุก่อนเข้าทำงาน
   ต้องตรวจสิทธิ์/ฉบับหลังได้ lock ไม่มีจองงบซ้ำ ใช้เกินงบ หรือ deadlock กับการเปลี่ยนขอบเขตบัญชี

**ต้องเห็น:** ผลกำกวมแสดง «ยังยืนยันผลไม่ได้ ระบบจะไม่ลองซ้ำอัตโนมัติ กรุณาตรวจสถานะ» ไม่ retry อัตโนมัติ
งบเต็มไม่เรียกเพิ่ม; recheck scope/revision ก่อนคืนผลและบันทึก
การกู้สถานะอ่านด้วย GET เท่านั้น ไม่ลองหรือคืนยอดคิดเอง; คำขอใหม่เกิดจาก action ใหม่ของผู้ใช้ ใช้ ID ใหม่และคิดยอดเพิ่มตามเพดาน โดยคง authority/revision ของ ordinary save
metadata บอกการใช้บริการได้โดยไม่เผย credential; ไม่เปิด provider จริงเพื่อทดสอบทางล้มเหลว
**รอยืนยันใน W8:** ข้อความเกินงบตามระบบเดิม ไม่มีการแต่ง literal ใหม่ในเอกสารนี้

## 7. การอ่านและใช้งานบนจอจริง

### U29 — 1280 / 1024 / 390, light / dark และ keyboard (W1–W7)

**ใช้:** MKT-A, MANAGER-AB, ONLINE, ADMIN; fixture ที่ไม่ต้องเปลี่ยนข้อมูล

ทดสอบขนาด viewport เป็น CSS px ตามตาราง โดยผู้ดูแลบันทึกวิธีตั้งขนาดที่ตรวจแล้ว
390 ใช้ความสูง 844; desktop ใช้ความสูง 900 เป็นค่าเริ่มต้นของรอบนี้
หากเครื่องจำกัดให้บันทึกขนาดจริงและใช้หลักฐาน browser gate ขนาดที่ขาด ห้ามอ้างว่าได้ตรวจเอง

| หน้าหรือสถานะ | 1280 light/dark | 1024 light/dark | 390 light/dark |
| --- | --- | --- | --- |
| shell ขยาย/ยุบ, search, home, assistant | รอตรวจ | รอตรวจ | รอตรวจรวม drawer |
| entity data, FAQ, unit, media, history | รอตรวจ | รอตรวจ | รอตรวจ |
| publishing review/outcomes/history | รอตรวจ | รอตรวจ | รอตรวจ |
| Accounts scope preview/notice/history | รอตรวจ | รอตรวจ | รอตรวจ |
| AI diff และ source conflict | รอตรวจ | รอตรวจ | รอตรวจ |
| local H1 search + disabled assistant | รอตรวจจาก H1 | รอตรวจจาก H1 | รอตรวจจาก H1 |

1. ใช้ Tab/Shift+Tab/Enter/Escape เดินเมนู เปิด/ปิด drawer ตรวจ focus กลับจุดเปิด
   ไปท้าย settings ใน sidebar ที่เลื่อน แล้วอ่าน tooltip ของข้อความตัด
2. เปลี่ยนเป็น reduced motion ทำชุดเดิม ตรวจไม่มีการเคลื่อนไหวที่ทำให้ focus/tooltip หาย
   drawer และ overlay ไม่อยู่กึ่งโปร่งใสตอนพร้อมใช้งาน
3. อ่านข้อความยาว ตาราง diff และผลบางรายการ; เปิด private website preview ใน dark
   ตรวจตัวอักษรดำบน preview plate สีอ่อนและ iframe ไม่กลืนกับพื้น

**ต้องเห็น:** ไม่มี horizontal page scroll ที่ 390; โฟกัสมองเห็นได้ ไม่หลุด modal
tooltip ทั้งกล่องอยู่ใน viewport รวมลิงก์ท้ายสุด ไม่ถูกตัดขอบบน/ล่าง
โลโก้เต็มมีพื้นอ่อนใน dark ปุ่ม/ข้อความ error/disabled อ่านได้
ผู้ดูแลแนบการวัด contrast ทุกคู่ text ≥4.5:1 และ UI ≥3:1 ทั้งสอง theme จาก gate
การมองด้วยตาไม่แทนการวัด และห้ามลด threshold เพื่อให้ผ่าน

### U30 — เรื่องที่ยังต้องตอบและตรวจงานเดิมก่อนจบรอบ (W8)

**ใช้:** ผู้มีสิทธิ์ «คำถามที่รอคำตอบ» และบัญชีงานเดิมที่ผู้ดูแลระบุ

1. เปิด «คำถามที่รอคำตอบ» ตรวจคำถามของ programme ครบหกเรื่อง:
   BU read-only/hosted enablement, vector logo/สี, shared approval,
   บัญชี Online ที่ได้ special, งบ AI ต่อเดือน และ business เพิ่มเติม
2. ผู้ดูแลจับคู่รหัส Q77–Q82 กับข้อความจริงใน catalogue ฉบับสุดท้าย
   แยกส่วนที่ตอบแล้วออกจากส่วนที่ยังรอ โดยไม่สร้างคำถามซ้ำหรืออ้างปิดคำถามแทนเจ้าของ
3. เปิดงาน ads เดิมหนึ่งงานตามสิทธิ์ และตรวจแหล่งอ้างอิง/หน้าเก่าที่ programme ย้าย
   ไม่มีเมนูเสียหรือสิทธิ์ content แพร่ไป finance/agency โดยไม่ตั้งใจ

**ต้องเห็น:** คำถามค้างและคำตอบเจ้าของตรวจย้อนหลังได้ การผ่าน UAT local
ไม่ใช่การอนุญาตเปิด hosted sync, deploy, R2 write หรือ AI จริง

## 8. บันทึกผลและหลักฐานต่อกรณี

ตารางนี้เป็นผล U01–U30; รวมกับ U31–U40 ใน §11.4, U41–U54 ใน §12.3
และ U55–U61 ในตารางภาคผนวก P1 เป็น 61 กรณีครบหนึ่งครั้งต่อกรณี
ทุกแถวยังคง **ยังไม่ทดสอบ (NOT RUN)**; ไม่มีแถวผ่านจากงานเตรียมเอกสาร

ทุกแถวเริ่ม **ยังไม่ทดสอบ** กรอกผู้ทดสอบ เวลา บัญชี/fixture และเหตุผลหากทำต่อไม่ได้
ภาพต้องบันทึกขณะสถานะนิ่งและเห็นบริบท ห้ามมีข้อมูลลับในภาพหรือ log
หลักฐาน API เก็บเฉพาะ method/path แบบล้างข้อมูลอ่อนไหว status และฟิลด์ที่จำเป็น
ประวัติเก็บ audit/version/event ID ของ fixture เพื่อเทียบได้ ไม่ dump ตารางบัญชีทั้งชุด

| กรณี | ผล | หลักฐานภายใต้ run-id | ข้อพบ / ผู้ทดสอบ / เวลา |
| --- | --- | --- | --- |
| U01 | ยังไม่ทดสอบ (NOT RUN) | `U01-*` | — |
| U02 | ยังไม่ทดสอบ (NOT RUN) | `U02-*` | — |
| U03 | ยังไม่ทดสอบ (NOT RUN) | `U03-*` | — |
| U04 | ยังไม่ทดสอบ (NOT RUN) | `U04-*` | — |
| U05 | ยังไม่ทดสอบ (NOT RUN) | `U05-*` | — |
| U06 | ยังไม่ทดสอบ (NOT RUN) | `U06-*` | — |
| U07 | ยังไม่ทดสอบ (NOT RUN) | `U07-*` | — |
| U08 | ยังไม่ทดสอบ (NOT RUN) | `U08-*` | — |
| U09 | ยังไม่ทดสอบ (NOT RUN) | `U09-*` | — |
| U10 | ยังไม่ทดสอบ (NOT RUN) | `U10-*` | — |
| U11 | ยังไม่ทดสอบ (NOT RUN) | `U11-*` | — |
| U12 | ยังไม่ทดสอบ (NOT RUN) | `U12-*` | — |
| U13 | ยังไม่ทดสอบ (NOT RUN) | `U13-*` | — |
| U14 | ยังไม่ทดสอบ (NOT RUN) | `U14-*` | — |
| U15 | ยังไม่ทดสอบ (NOT RUN) | `U15-*` | — |
| U16 | ยังไม่ทดสอบ (NOT RUN) | `U16-*` | — |
| U17 | ยังไม่ทดสอบ (NOT RUN) | `U17-*` | — |
| U18 | ยังไม่ทดสอบ (NOT RUN) | `U18-*` | — |
| U19 | ยังไม่ทดสอบ (NOT RUN) | `U19-*` | — |
| U20 | ยังไม่ทดสอบ (NOT RUN) | `U20-*` | — |
| U21 | ยังไม่ทดสอบ (NOT RUN) | `U21-*` | — |
| U22 | ยังไม่ทดสอบ (NOT RUN) | `U22-*` | — |
| U23 | ยังไม่ทดสอบ (NOT RUN) | `U23-*` | — |
| U24 | ยังไม่ทดสอบ (NOT RUN) | `U24-*` | — |
| U25 | ยังไม่ทดสอบ (NOT RUN) | `U25-*` | — |
| U26 | ยังไม่ทดสอบ (NOT RUN) | `U26-*` | — |
| U27 | ยังไม่ทดสอบ (NOT RUN) | `U27-*` | — |
| U28 | ยังไม่ทดสอบ (NOT RUN) | `U28-*` | — |
| U29 | ยังไม่ทดสอบ (NOT RUN) | `U29-*` | — |
| U30 | ยังไม่ทดสอบ (NOT RUN) | `U30-*` | — |

## 9. รายการรอยืนยันก่อนเรียกฉบับนี้ว่า UAT พร้อมใช้

| สิ่งที่ต้องเติมจาก final W8 | หลักฐาน/ผู้รับผิดชอบ | สถานะ |
| --- | --- | --- |
| Final `main` hash, full gate, migration replay และ credential scan | Lead ใส่ลิงก์ receipt ใน docs/48 | รอยืนยันใน W8 |
| Local origin และคำสั่งเตรียม/คืน fixture ที่มีอยู่จริง | Lead ตรวจจาก harness สุดท้าย; ไม่ใส่ credential หรือคำสั่ง hosted | รอยืนยันใน W8 |
| บัญชีสังเคราะห์และ V/E/A/special/BU/project scope ทุก persona | Lead แนบใบ fixture แบบไม่ใส่ secret | รอยืนยันใน W8 |
| Namespace/URL และ ordinary writer ของแต่ละ deep link | Lead ตรวจจาก W3/W4 ที่รวมจริง รวม page config, unit asset และ clip target | รอยืนยันใน W8 |
| Source draft/revision/hash และผู้ร่วมฉบับของ N1/N2 | Lead เตรียมคนละชุด ไม่ให้การทดสอบก่อนหน้าปน contributors | รอยืนยันใน W8 |
| รายการ workflow kind สุดท้ายพร้อม coverage ทุกชนิด | Lead แนบ API/DB/UI receipt; ตัวอย่าง U11 ไม่ทดแทนทั้งหมด | รอยืนยันใน W8 |
| BUD eight-column fixtures, T0/deadline ตาราง move และ accepted epoch | Lead ใช้ W6 ที่รวมจริง; ไม่เปลี่ยน timestamp ของชุด 5 ต.ค. | รอยืนยันใน W8 |
| Fake-clock/pause/revoke controls และการคืนค่าที่มีอยู่จริง | Lead พิสูจน์ local-only; ไม่มี actor-supplied clock หรือ public bypass | รอยืนยันใน W8 |
| Alert copy, grace control และ paged access history UI | Lead เทียบ docs/47 ฉบับ W6 สุดท้าย ไม่สมมติป้ายที่ยังไม่ได้จัดทำ | รอยืนยันใน W8 |
| FAQ precedence/applicability และ Knowledge-only fixtures | Lead ตรวจ scope จริง; ไม่ทำ blanket business applicability | รอยืนยันใน W8 |
| W7 registry opt-in, original writer, stub responses และงบหมด | Lead ตรวจ default-off และข้อความเกินงบเดิมใน final W7/W8 | รอยืนยันใน W8 |
| H1 local modes และ screenshot ทุกขนาด/ธีมตาม U29 | Lead แนบ runner/receipt จริง ไม่เปิด hosted resource | รอยืนยันใน W8 |
| Retained walkthrough และชนิดหลักฐานของแต่ละขั้น | Lead ตรวจ §2.4; แยก UI จริง, mocked UI, API/DB fake-clock/race และรายการที่ fixture ยังไม่พร้อม | รอยืนยันใน W8 |
| Q77–Q82 ข้อความ/ผู้รับผิดชอบ/คำตอบล่าสุด รวม shared approval | Lead จับคู่ catalogue และบันทึก pending ตามจริง; ไม่สร้าง approval gate เพิ่ม | รอยืนยันใน W8 |

มี artifact เตรียมตาม §2.4/§13 แล้วบางส่วน แต่ทุกช่องในตารางนี้ยังรอยืนยันจาก
final-source rehearsal; source/hash/parsing receipt ไม่เติม origin/IDs/grants/runtime result
รายการ factual placeholders แยกใน `w8-unresolved-placeholders-20261113.md`

### 9.1 ใบ full gate ที่ต้องมีแยกจากผลเจ้าของ

Lead เติมจำนวน passed/skipped/failed ของแต่ละ suite พร้อม log/screenshot path
บน commit สุดท้าย ห้ามใช้การตรวจ UTF-8 ของเอกสารนี้แทน runtime gate

| Gate | ผลและหลักฐานบน final main |
| --- | --- |
| Admin typecheck | รอยืนยันใน W8 |
| Documented offline webpack build | รอยืนยันใน W8 |
| `test:production` | รอยืนยันใน W8 |
| `test:api` รวม positive neighbour และ denial | รอยืนยันใน W8 |
| `test:db` รวม non-superuser/RLS/ACL/concurrency | รอยืนยันใน W8 |
| `test:ui` เต็มที่ 1280 | รอยืนยันใน W8 |
| `test:ui` เต็มที่ 390 | รอยืนยันใน W8 |
| Local H1 รวม workspace/publication/scope/writing paths ที่เปลี่ยน | รอยืนยันใน W8 |
| Disposable migration replay | รอยืนยันใน W8 |
| Changed-file และ browser-bundle credential scan | รอยืนยันใน W8 |

### 9.2 แหล่งเตรียม fixture และกรณีอ้างอิงที่ตรวจพบแล้ว

ตารางนี้เป็นแผนที่ไปยัง source ที่มีอยู่ในชุดส่งมอบที่ทบทวนแล้ว ไม่ใช่ผลทดสอบ
Lead ต้องยืนยันว่าไฟล์และการลงทะเบียนอยู่ใน final main ก่อนใช้ แล้วแนบ receipt ที่ตรง commit
ผู้ดูแลถือ test lock และใช้ harness เดิมเท่านั้น เจ้าของไม่ต้องรันชุดทดสอบหรือเปิด config เอง
กรณีที่ต้องพัก request/รอ lock/เลื่อนเวลา ใช้กลไกภายใน test ที่ระบุ ไม่มีคำสั่งเปลี่ยนเวลาของระบบจริง
ระบุชนิดหลักฐานใน receipt ด้วย: API/DB ที่ใช้ disposable fixture, browser ที่ผ่าน API จริง,
หรือ browser ที่ mock เฉพาะ response/เวลาเพื่อดูการแสดงผล ห้ามใช้ mocked scope/notice/SSE
เป็นหลักฐานว่า SQL/API อนุญาตหรือปฏิเสธถูกต้อง และอย่านำ teardown ของ test มาเป็นวิธี seed
ให้ retained walkthrough โดยไม่ทบทวนก่อน

| กรณี UAT | ไฟล์/กรณีที่ใช้เตรียมหรือจับคู่หลักฐาน | สิ่งที่ยังต้องเติมใน W8 |
| --- | --- | --- |
| U02 | `apps/api/tests/test_workspace_home.py`; `supabase/tests/workspace_home.sql`; `tests/ui/workspace-home.spec.ts`, `tests/ui/workspace-home-h1.spec.ts` | ความพร้อมตาม BUD/brand, ช่องของ brand แยกจาก project aggregate, Brands-only neighbour และ exact missing-field links |
| U11–U18 | `tests/ui/content-workflow-fixtures.ts`; `supabase/tests/fixtures/content_workflow.sql`; `apps/api/tests/content_workflow_fixture.py` | Persona/temporary grant และตัวบันทึกต้นทางที่เลือกจริง; browser fixture ใช้ authenticated Accounts API และคืนสิทธิ์ด้วย revision ปัจจุบัน |
| U11–U13 | `tests/ui/content-workflow-forms.spec.ts`, `tests/ui/content-workflow-locks.spec.ts`; `apps/api/tests/test_content_workflow.py` | ชนิดรายการครบ, original stamp/hash, peer-lock และ stale-draft receipts |
| U15–U17 | `apps/api/tests/test_publication_queue_http.py::test_view_and_special_without_approve_reach_real_http_publication`; `test_included_contributor_cannot_publish_but_independent_item_can`; `test_stale_item_keeps_its_published_value_and_accepts_the_valid_neighbour` | Source V/special จริงและผู้แก้/ตรวจ/อนุมัติที่แยกจาก publisher; ห้ามใช้ชื่อบัญชีแทนหลักฐานสิทธิ์ |
| U15–U18 | `tests/ui/unified-publication.spec.ts`, `tests/ui/unified-publication-h1.spec.ts`; `tests/ui/project-review.spec.ts`, `tests/ui/brand-review.spec.ts`, `tests/ui/project-workflow.spec.ts` | Queue/config/source-history URLs, version UUID, pointer ก่อน/หลัง, withdrawal 404 และ before/after redaction |
| U10, U18 | `tests/ui/publication-navigation.spec.ts`, `tests/ui/publication-navigation-h1.spec.ts`; `apps/api/tests/test_permission_publication.py` | Knowledge-only/Releases-only positive, no-View denial, เมนูเดียว, redirect คง context; แยก mocked browser projection ออกจาก permission/API proof |
| U03–U04, U08, U15–U17 | `apps/api/tests/test_business_content.py::test_shared_brand_business_faq_pins_rule_resolution_and_rejects_only_changed_item`; `test_business_faq_publish_task_needs_only_own_source_view_and_keeps_n2_denials`; `test_assistant_saved_business_faq_and_section_evidence_rechecks_exact_source_and_version` | Business rule drift ก่อน/หลัง prepare, เพื่อนบ้านที่ใช้ได้ และ exact saved citation |
| U08 | `apps/api/tests/test_business_content.py::test_business_membership_never_implies_faq_applicability_and_corporate_opt_in_survives` | Corporate empty manual/rule ใช้ question-bank opt-in เดิม; business empty ไม่ใช้ membership แทน applicability |
| U04, U08, U29 | `tests/ui/business-workspace.spec.ts`, `tests/ui/business-workspace-h1.spec.ts` | Fixed hierarchy, เจ็ดระดับ, defaults/late applicability, business mount และ proxy ที่รวมแล้ว |
| U20–U23 | `supabase/tests/fixtures/bu_membership/valid.json`, `move.json`, `no-bu.json`, `invalid.json`; `apps/api/tests/test_bu_membership.py` | Exact ID/code/name, last-good watermark/run/epoch และตาราง T0 ของรอบนี้ |
| U22–U23 | `test_bu_membership.py::test_day5_day7_fail_closed_without_tick_and_idempotent_effect_history`; `test_rejected_49_hour_refresh_keeps_grace_and_manager_only_early_alert`; `test_session_timezone_cannot_extend_stale_or_handover_deadline_or_change_fingerprint` | Cutoff ก่อน/ตรงเส้น, no tick, unrestricted/per-project neighbours และหลักฐาน 7 × 24 ชั่วโมง |
| U20, U24 | `apps/api/tests/test_content_scopes.py`; `apps/api/tests/test_content_scope_history.py::test_notice_clock_is_read_after_a_real_waiting_scope_lock`; `test_invitation_records_exact_gains_once_and_preserves_scopes`; `test_failed_invitation_has_no_access_effect_or_partial_activation` | Scope preview/apply, lock barrier, invite gain ครั้งเดียว และ manager-only history |
| U22–U25, U29 | `tests/ui/content-bu-notices.spec.ts`, `tests/ui/content-bu-notices-h1.spec.ts` | Notice ของ caller, cutoff สองชนิด, ข้อมูลไม่เข้า assistant, คำตอบช้าไม่ข้าม phase/บัญชี และ dirty form ไม่หาย |
| U25 | `apps/api/tests/test_content_scope_read_boundaries.py`; `apps/api/tests/test_content_asset_delivery.py::test_final_exact_asset_sql_rechecks_after_await_and_keeps_positive_scope_neighbours` | Storage/thumbnail/embedding await, expiry โดยไม่ทำ maintenance, exact source/version และ no-store |
| U03, U25 | `apps/api/tests/test_assistant_scope_stream.py`; `apps/api/tests/test_business_assistant.py::test_real_hub_app_citation_route_keeps_private_helper_closed_and_uses_owned_evidence`; `tests/ui/assistant-scope-races.spec.ts`; `tests/ui/assistant.spec.ts` | Queued source/version recheck, stub stream, late config/citation/proposal, deadline และ unsent text; แยก test doubles จาก real hub_app citation route |
| U25 | `tests/ui/content-scope-expiry.spec.ts`, `tests/ui/content-scope-proxy.spec.ts`, `tests/ui/content-scope-raw-callers.spec.ts` | Client fake-clock/pending-or-failed refresh, same grants/new fingerprint, delayed body/SSE, explicit invalidation และ ordinary-403/unrestricted neighbours; browser/transport proof ไม่แทน DB proof |
| U26–U28 | `tests/ui/writing-fields.spec.ts`, `tests/ui/writing-fields-h1.spec.ts`; `tests/ui/writing-aid.spec.ts`, `tests/ui/writing-aid-h1.spec.ts` | Native writer ทุกกลุ่ม, opt-in/locale/locks, save สำเร็จแต่ reload ล้มเหลว, registry/authority loss และ H1 catalogue special แบบสังเคราะห์ |
| U26–U28 | `apps/api/tests/test_writing_aid.py`; `apps/api/tests/test_writing_admission.py` | Stub-only, default-off/budget zero, idempotency/quota, protected tokens, source/context/BUD หลังรอ lock และไม่มีการเขียนเนื้อหาจาก provider |

ไฟล์ fixture `valid.json` มีส่วน `historical.rows` ที่ตรวจย้อนถึงชุด DW วันที่ 5 ตุลาคม 2026
จำนวน 278 แถว และคง watermark จริง ไม่ต้องเปิด DW repository หรือดึงข้อมูลใหม่
มี validator local ที่ตรวจพบจริงคือ `scripts/sync-content-bu.py` ซึ่งไม่เชื่อม Hub/DW/REM
ตัวอย่างต่อไปนี้ตรวจไฟล์เท่านั้น **ไม่ได้เตรียมฐานข้อมูล ไม่เปลี่ยนเวลา authorization และยังไม่ได้รันในรอบ UAT**:

```powershell
apps/api/.venv/Scripts/python.exe scripts/sync-content-bu.py --historical --at 2026-10-05T02:50:00.717680+00:00
apps/api/.venv/Scripts/python.exe scripts/sync-content-bu.py --historical --at 2026-11-05T00:00:00+00:00
```

ตัวอย่างแรกคาดว่า validator ยอมรับตามเวลาเก่าของชุด ส่วนตัวอย่างที่สองคาดว่าปฏิเสธว่า source เก่า
และคืน exit code 1; ทั้งสองยังต้องบันทึกผลจริงใน W8 ไม่เปลี่ยน timestamp เพื่อทำให้ตัวอย่างหลังผ่าน
การจำลองเวลาเพื่อทดสอบสิทธิ์จริงอยู่ใน `test_bu_membership.py`/`test_content_scopes.py`
และใช้ operator ของ disposable harness เดิม ไม่มี runtime API ให้ผู้ใช้ส่งนาฬิกาเข้ามา

คำสั่ง gate ที่มีอยู่ใน `package.json` คือ `npm run test:api`, `npm run test:db`,
`npm run test:ui` ผ่าน `scripts/run-disposable-tests.mjs` และ `npm run test:hosted-h1`
ผ่าน `scripts/run-hosted-h1.mjs` ผู้ดูแลต้องยืนยันรายการ suite, viewport และ H1 phases ที่ลงทะเบียน
ใน final main ก่อนรันภายใต้ lock; การมีชื่อคำสั่งไม่ได้แปลว่าครบ gate หรือ fixture พร้อมให้เจ้าของใช้แล้ว
ห้ามใช้คำสั่งนำเข้า DW/deploy/worker จริงแทนการสาธิต local ในเอกสารนี้

## 10. การปิดรอบ

เจ้าของบันทึกผลจริงครบ U01–U61 ตามลำดับ §2.3 พร้อมข้อพบที่ต้องแก้; ทำ U30 ปิดรอบหลังตรวจภาคเพิ่มเติมครบ
Lead ระบุ commit/receipt ที่ตรงผลจริงและรายการที่ยังทำต่อไม่ได้
หากมีข้อไม่ผ่าน ห้ามสรุปว่ารับงานแล้วเพียงเพราะส่วนอื่นผ่าน

| สรุปจากการทดสอบจริง | ค่า |
| --- | --- |
| ผ่าน / ไม่ผ่าน / ทำต่อไม่ได้ / ยังไม่ทดสอบ | ยังไม่ทดสอบ (NOT RUN) ทั้งหมด 61 กรณี |
| ข้อพบที่ยังเปิดและผู้รับผิดชอบ | รอผล UAT |
| การตัดสินใจของเจ้าของ / วันเวลา | ยังไม่มีการรับงาน |
| ขอบเขตถัดไป | หยุดหลังรายงาน W8 และ final gate; hosted rollout ต้องมีอนุญาตแยก |

เอกสารร่างนี้ไม่มีผล runtime หรือ screenshot ที่อ้างว่าผ่านแล้ว
การตรวจเอกสารนี้เป็น static UTF-8/โครงสร้าง/จำนวนกรณี/hash/ความคงเดิมของข้อกำหนด และความตรงของป้ายกับ docs/47 เท่านั้น

## 11. ภาคเพิ่มเติม W3.2 — โปรโมชั่นในบริบทโครงการและแบรนด์

สถานะภาคนี้: **ร่างเตรียม UAT — ยังไม่ทดสอบ (NOT RUN) ทุกกรณี U31–U40**
W3.1 prerequisite และ final-source W3.2 implementation/route inventory/rehearsal
ยังต้องกระทบยอดก่อนเปิดรอบ; source/spec ใน evidence matrix ไม่ใช่ผลพร้อมรับงาน
คงข้อกำหนด U01–U30 และคำถามค้างเดิม; ภาคนี้เพิ่ม U31–U40 จำนวน 10 กรณี
ยอดทั้ง pack คือ 61 กรณีรวม W9/P1 ตาม §10; ทั้งหมด NOT RUN และ owner acceptance pending
ใช้ docs/47 §4.7 และ permission card เป็นข้อกำหนด; ป้ายใน «…» ของภาคนี้คัดจาก §8.5
ยกเว้นชื่อแท็บ «แบบห้อง» และ «ข้อมูล» ใน U31 ที่คัดตรงจาก docs/47 §4.2 ตามที่ lead ยืนยัน

### 11.1 ใบเตรียมแยกจากขั้นเจ้าของ — pending lead rehearsal

Lead ต้องยืนยัน W3.1 prerequisite, implementation lease/route inventory ของ W3.2,
commit สุดท้ายและ full gate ตาม docs/47 §10.2–10.3 ก่อนเติม URL/รหัสจริง
ห้ามใช้ชื่อ endpoint ใน design เป็นคำยืนยันว่าเปิดใช้งานแล้ว ไม่เพิ่ม bypass เพื่อสาธิต
การเตรียมทั้งหมดใช้ local disposable fixture ที่ผ่านการทบทวนและสิทธิ์ตาม flow ปกติ
ไม่เชื่อมเว็บจริง/provider/REM/DW/hosted ไม่เปิด credential และไม่เปลี่ยนบัญชีหรือ default ถาวร

| ชุดที่ lead ต้องสร้างและซ้อม | รายละเอียดที่ต้องบันทึกก่อนส่งให้เจ้าของ | สถานะ |
| --- | --- | --- |
| FP-CONTEXT | project P-A ใน BU-A, P-B ใน BU-B แบรนด์เดียวกัน, P-C นอกชุด, brand ต้นทาง, business/group; source V และ URL entity/editor ที่ตรวจแล้ว | pending lead rehearsal |
| FP-SCOPE | promotion ของ P-A, ของ brand ที่ไม่มี primary project, shared promotion; resolved draft กับ frozen published ต่างกันทั้งเพิ่ม/ถอด P-A; active/review/draft/expired/scheduled/withdrawn คนละรายการ พร้อม revision และ published pointer | pending lead rehearsal |
| FP-EXCLUDE | shared published promotion มี P-A/P-B, draft revision ใหม่, DATA/LEGAL evidence แยก, บัญชี independent publisher, published payload ก่อนแก้; scope drift ก่อน submit/review/publish พร้อมเพื่อนบ้านไม่เปลี่ยน | pending lead rehearsal |
| FP-LEGACY | หลักฐาน website และ quarantined KM แบบ offline มี source page/capture date และ likely-expired/undated/not-a-promotion ครบ; ข้อความมีวันที่ เงิน ราคา จำนวน และ OCR; source evidence/audit IDs | pending lead rehearsal |
| FP-COUNTS | promotions สิ้นสุดก่อน/ตรง/หลังเส้นเจ็ดวัน, active ที่ไม่มี banner/rights ไม่ผ่าน/rights ผ่าน, ราคาเริ่มต้นอ้าง expired/withdrawn และเพื่อนบ้านถูกต้อง; clock/eligibility ตรง public feed พร้อม expected IDs/counts | pending lead rehearsal |
| FP-ACCESS | editor มี Promotions V/E และ scope เฉพาะ P-A; DATA/LEGAL reviewer มี V/A คนละ lane และ all-scope; reviewer partial-scope; unrestricted; publisher V+special ไม่ใช่ contributor; no-V, source-V-only, no-source-V, no-Projects-E, no-Knowledge-V, revoked, inactive, agency และ permitted neighbours | pending lead rehearsal |
| FP-FAQ | คำถาม/คำตอบ promotion ที่อนุมัติและอยู่ในช่วง, ยังไม่อนุมัติ, ยังไม่เริ่ม, หมดอายุ, ถอน และ scope ไม่ตรง; frozen version เก่าและ clock ขอบวัน Asia/Bangkok | pending lead rehearsal |
| FP-RESTORE | วิธี reset แต่ละกรณีด้วย fixture/ordinary draft-review-publication flow โดยไม่แก้ history, local origin, exact IDs/URLs, contributor/review/version map และชนิดหลักฐาน UI/API/DB ที่แยกกัน | pending lead rehearsal |

บัญชี promotion ไม่ใช้ MANAGER-AB ที่มี E/A ของ project เป็นหลักฐานว่า E/A ของ Promotions
อยู่ด้วยกันได้ บันทึก Promotions E/A แยกจริง รวม lane และ source/special ต่อรายการ
บัญชี LEGAL unrestricted ต้องมาจากการจัดการบัญชีปกติ ไม่ได้สิทธิ์เพิ่มจาก W3.2
ราคาเริ่มต้นต้องใช้ Projects V; หลักฐาน KM ต้องใช้ Knowledge V; banner command ต้องมี
Projects E และสิทธิ์ binding ของ project จริง นอกเหนือจาก Promotions E

### 11.2 กรณีเจ้าของ U31–U40

แต่ละกรณีเริ่มหลัง lead เติมชุดเตรียมที่ระบุครบแล้วเท่านั้น หากยังไม่พร้อมคง NOT RUN
และระบุสิ่งที่ขาด ห้ามให้เจ้าของเดา URL หรือเรียก SQL/API เอง

### U31 — ตำแหน่งและสิทธิ์เห็นแท็บตรงระดับ (ข้อกำหนด 1)

**เตรียม:** FP-CONTEXT/FP-ACCESS; lead เติม URL จริงและสิทธิ์รายบัญชี

1. เปิดหน้า project แล้วตรวจ «โปรโมชั่น» อยู่หลังแท็บ «แบบห้อง»;
   เปิดหน้า brand แล้วตรวจอยู่หลังแท็บ «ข้อมูล» (ตำแหน่งตาม docs/47 §4.2)
2. เปิด business/group และเปรียบเทียบบัญชีที่มี Promotions V กับบัญชีที่ไม่มี
   จากนั้นเปิดเมนู «โปรโมชั่น» สำหรับงานข้ามโครงการและคิว DATA/LEGAL

**ต้องเห็น:** แท็บมีเฉพาะ project/brand ที่มี source V และ Promotions V
business/group ไม่มีแท็บนี้ เมนูเดี่ยวสำหรับงานข้ามโครงการยังอยู่
บัญชีไม่มี V ไม่ได้รับ private payload หรือจำนวนจากแท็บที่ซ่อน; source V อย่างเดียวไม่พอ
lead แนบ direct-request denial และ permitted neighbour แยกจากภาพเมนู

### U32 — แยกขอบเขตร่างกับบนเว็บและแสดงต้นทาง (ข้อกำหนด 2)

**เตรียม:** FP-SCOPE; ใบเทียบ expected resolved/frozen IDs และเวอร์ชันก่อนเปิดหน้า

1. เปิด project ที่ draft scope หรือ frozen published scope อย่างใดอย่างหนึ่งยังครอบคลุม
   เปรียบเทียบ «โครงการที่ใช้โปรโมชั่นนี้» กับสถานะฉบับที่เผยแพร่อยู่
2. ตรวจกลุ่ม «กำลังใช้งาน», «รอตรวจข้อมูลหรือกฎหมาย», «ร่าง», «หมดอายุแล้ว»
   และรายการ «ยังไม่เริ่มใช้สิทธิ์»/«ถอนแล้ว» ตาม fixture
3. เทียบ chip «เฉพาะโครงการนี้», «จากแบรนด์ {brand}», «ใช้ร่วมกับ {count} โครงการ»
   โดยแทน placeholder ด้วยค่าที่มีสิทธิ์เห็น ตรวจชื่อ วันที่เริ่ม/สิ้นสุด «ช่วงจอง»,
   «ช่วงโอน», thumbnail, «สิทธิ์ภาพแบนเนอร์» และ «กลุ่มผู้รับสิทธิ์»

**ต้องเห็น:** row ยังอยู่เมื่อ scope ใด scope หนึ่งครอบคลุม ไม่ติดป้าย draft ว่า live
การถอด project ใน draft ไม่ทำให้ published promotion เดิมหายจากหน้าเว็บ
ข้อความ «ขอบเขตฉบับร่างยังไม่เปลี่ยนข้อมูลบนเว็บไซต์» ตรงกับ published pointer ที่คงเดิม

### U33 — สร้างของโครงการหรือแบรนด์โดยไม่มี primary ปลอม (ข้อกำหนด 3)

**เตรียม:** FP-CONTEXT/FP-SCOPE; record/version เดิมสำหรับเทียบโดย lead

1. ใช้ «สร้างโปรโมชั่นสำหรับโครงการนี้» ตรวจ project ต้นทางที่เติมไว้
2. ใช้ «สร้างโปรโมชั่นสำหรับแบรนด์นี้» ตรวจ owning brand และ resolved projects
   ที่แสดงก่อนส่งงาน โดยไม่ต้องเลือก project มารับบท primary แทน brand

**ต้องเห็น:** ใหม่มี primary project หรือ owning brand อย่างใดอย่างหนึ่งเท่านั้น
brand-owned ไม่มี fake primary; business/group สร้าง ownership ไม่ได้
lead แนบ static/runtime receipt จาก final implementation ว่า existing rows/targets,
published payload และ version history เดิมมีความหมายและ bytes เดิม ไม่มี backfill/rewrite
ภาพ UI อย่างเดียวไม่ถือเป็นหลักฐานเรื่องโครงสร้างหรือความเท่ากันของข้อมูลเดิม

### U34 — ยกเว้นโครงการเป็นฉบับใหม่และผ่าน review ก่อนขึ้นเว็บ (ข้อกำหนด 4)

**เตรียม:** FP-EXCLUDE; baseline published payload และ revision/review IDs

1. จาก P-A เลือก «ไม่ใช้กับโครงการนี้» ตรวจว่าเปิด editor ต้นทาง
   และ P-A ถูกเลือกใน «โครงการที่ไม่ใช้โปรโมชั่นนี้» แล้วบันทึก
2. ตรวจ draft revision ใหม่และ review เก่าที่ใช้ไม่ได้ ให้ DATA และ LEGAL ตรวจใหม่
   ก่อน independent Online เผยแพร่ผ่าน publishing queue เดียวตาม N2/N6
3. lead สาธิต scope resolution เปลี่ยนก่อน submit, DATA/LEGAL review และ publish
   ด้วยวิธีที่ซ้อมแล้ว เทียบกับเพื่อนบ้านที่ scope ไม่เปลี่ยน

**ต้องเห็น:** เพียงเปิดหรือบันทึก exclusion ไม่เปลี่ยนเว็บ; เปลี่ยนหลัง publish ฉบับใหม่เท่านั้น
exclusions เป็น explicit project IDs ที่ตรวจและ deduplicate ไม่เดา; frozen list ใหม่หัก exclusion
ฉบับเก่ายังอ่าน frozen list เดิม resolution ที่เปลี่ยนต้อง review ฉบับใหม่ ไม่ใช้ review เก่าผ่าน

### U35 — editor เดียวกันและไม่ข้ามสิทธิ์ของงานรูป (ข้อกำหนด 5)

**เตรียม:** FP-CONTEXT/FP-ACCESS; URL/editor และ validation ที่ยืนยันจาก implementation

1. เปิด promotion เดียวกันจาก project, brand และเมนูเดี่ยว ตรวจ editor/validation เดิม
   พร้อมต้นทางและ «การแก้ไขนี้มีผลกับ {count} โครงการ»
2. ลองบันทึกข้อมูลไม่ครบและฟอร์ม stale แล้วกลับมาแก้ draft ที่มีสิทธิ์
3. lead สลับบัญชีไม่มี Projects E ให้ลอง upload/bind/metadata banner ของ project จริง
   เทียบกับบัญชีที่มี conjunction ครบและบัญชี rights reviewer

**ต้องเห็น:** context เติม owner ไม่สร้าง editor หรือ validation ชุดใหม่
Promotions E ไม่ให้สิทธิ์เขียน banner ของ Projects เอง; การแก้ metadata ไม่ใช่ rights approval
input ที่ยังไม่บันทึกไม่หายหลัง denial/stale และเพื่อนบ้านที่ได้รับอนุญาตทำงานได้

### U36 — ข้อเสนอเก่ามีหลักฐานและเติมเฉพาะข้อความ (ข้อกำหนด 6)

**เตรียม:** FP-LEGACY/FP-ACCESS; offline source เท่านั้นและ baseline audit/evidence IDs

1. เปิด «ข้อเสนอจากเว็บเดิม» ของ website และ KM ตรวจ «ดูหน้าอ้างอิง»,
   «วันที่เก็บข้อมูล», «น่าจะหมดอายุแล้ว», «ไม่ระบุวันที่», «ไม่ใช่โปรโมชั่น» ตามหลักฐานจริง
2. ใช้ «สร้างจากข้อเสนอนี้» ตรวจ title, benefit/summary และ conditions ใน editor เดิม
   ตรวจวันที่ เงิน ราคา จำนวน และ validity ทุก structured field ก่อนกรอกค่าที่ยืนยันเอง
3. ทำซ้ำด้วยบัญชีไม่มี Knowledge V กับ KM และไม่มี source V กับต้นทางที่ซ่อน

**ต้องเห็น:** เติมเฉพาะข้อความ สามารถมีตัวเลขเดิมในข้อความหลักฐานแต่ไม่ parse OCR ไปช่อง structured
ช่องวันที่/เงิน/ราคา/จำนวน/validity เริ่มว่าง; แสดง
«กรุณากรอกวันที่ จำนวนเงิน ราคา และช่วงใช้สิทธิ์ที่ยืนยันแล้วด้วยตนเอง»
คง evidence/provenance/audit เดิม ไม่ auto accept candidate, approve หรือ publish
hidden source ไม่มีข้อยกเว้นให้ private reference และ permitted suggestion neighbour ยังเปิดได้

### U37 — DATA/LEGAL แยกจากผู้แก้และใช้คิวเผยแพร่เดียว (ข้อกำหนด 7)

**เตรียม:** FP-EXCLUDE/FP-ACCESS; lane identity, exact revision contributors และ special map

1. ต่อจาก U14 ให้ editor ลองเส้นทาง N1 edit-and-approve และให้ reviewer ผิด lane ลองตรวจ
   จากนั้น DATA และ LEGAL ที่ถูกต้องตรวจฉบับเดียวกันตาม flow เดิม
2. ให้ publisher ที่มี source V และ existing publish special แต่ไม่มี A เปิด publishing queue
   ตรวจ promotion ฉบับ APPROVED; เปรียบเทียบผู้แก้และผู้ตรวจอังกฤษของ revision นั้น
3. ตรวจประวัติ review/publication/withdrawal เดิมและ special ถอนที่ยังจำเป็น

**ต้องเห็น:** Promotions E/A mutually exclusive, N1 ใช้ไม่ได้; DATA/LEGAL evidence แยก
และตรวจ revision ปัจจุบัน contributor ของฉบับนั้น publish ไม่ได้
มีคิว N2/N6 เดียวแต่ไม่รวม/ลบประวัติเก่า; source V+special ยังไม่ทำให้ฉบับไม่ APPROVED ขึ้นเว็บ

### U38 — ภาพรวมทั้งสามจำนวนเปิดรายการตรงตัว (ข้อกำหนด 8)

**เตรียม:** FP-COUNTS/FP-ACCESS; expected IDs/counts และ server clock ของรอบในใบ fixture

1. เปิด «โปรโมชั่นที่จะสิ้นสุดภายใน 7 วัน» ตรวจจำนวนและรายการก่อน/ตรง/หลังเส้นเวลา
2. เปิด «โปรโมชั่นที่กำลังใช้งานแต่ยังไม่มีภาพแบนเนอร์ที่อนุมัติสิทธิ์แล้ว»
   เทียบ active ที่ไม่มีภาพ ภาพ rights ไม่ผ่าน และภาพ rights ผ่าน
3. เปิด «ราคาเริ่มต้นอ้างอิงโปรโมชั่นที่หมดอายุหรือถอนแล้ว»
   เทียบ expired/withdrawn กับราคาเพื่อนบ้านที่ยังถูกต้อง แล้วลองบัญชีไม่มี Projects V

**ต้องเห็น:** ทั้งสามลิงก์ถึง promotion/filter/ราคา exact ตามสิทธิ์ ไม่จบที่ generic list
clock และ publication eligibility เดียวกับ public feed; ไม่นับ private scope ที่ caller ไม่มีสิทธิ์
ราคาเริ่มต้นไม่เผยรายละเอียดโดยไม่มี Projects V; บัญชีที่มีสิทธิ์ยังเปิดรายการถูกต้องได้
lead ยืนยันกติกาขอบเวลาและผลจริง ไม่อนุมานตัวเลขจาก client clock

### U39 — draft any-scope แต่ review all-scope พร้อม allowed neighbours (ข้อกำหนด 9)

**เตรียม:** FP-ACCESS/FP-SCOPE; resolved scope P-A/P-B, P-C นอกชุดและ no-access ชัดเจน

1. editor scope เฉพาะ P-A สร้าง/แก้ draft ที่ resolved scope มี P-A/P-B
   เทียบ promotion ที่ไม่มี resolved project ใน scope ของตนเลย
2. DATA/LEGAL reviewer partial-scope ลอง review/approve ชุด P-A/P-B แล้วใช้
   reviewer all-scope หรือ unrestricted ตามสิทธิ์ปกติทำกรณีที่ได้รับอนุญาต
3. lead สาธิต revoke และ denied/allowed neighbours ผ่านรายการ จำนวน detail/reference,
   suggestion/banner/history/preview/queue/export/assistant/citation/RAG/asset bytes,
   worker/cache ที่ final inventory ระบุ พร้อมระบุหลักฐาน API/DB แยกจาก UI

**ต้องเห็น:** draft ต้องมีอย่างน้อยหนึ่ง resolved project ใน scope; review/approval
ต้องครบทุก resolved project หรือ unrestricted โดยยังต้องมี base V/E/A และ lane ที่ถูกต้อง
ไม่มีการ grant LEGAL/account/template อัตโนมัติ agency/inactive/unknown/direct request ยังคงถูกปฏิเสธ
revoke ไม่เผย private payload ค้างจาก shared surface; permitted neighbours ยังใช้ได้
ไม่ถือการซ่อน UI หรือ mocked response เป็นหลักฐาน runtime authorization

### U40 — FAQ อ่านเฉพาะโปรโมชั่นที่อนุมัติและอยู่ในช่วง พร้อมหลักฐานสี่ภาพ (ข้อกำหนด 10)

**เตรียม:** FP-FAQ; lead ยืนยัน eligibility/clock และ fixture ฟื้นคืนได้

1. เปิด FAQ ที่อ้าง promotion ที่อนุมัติและอยู่ในช่วง แล้วเทียบยังไม่อนุมัติ,
   ยังไม่เริ่ม, หมดอายุ, ถอน และผิด scope โดยสลับ fixture ที่ระบุไว้
2. ทำ U31–U39 ในจุดสำคัญซ้ำที่ 1280/390 และ light/dark ตรวจ chip, scope list,
   editor, counts, keyboard/focus และไม่มี horizontal page scroll

**ต้องเห็น:** FAQ ไม่ใช้ draft/ยังไม่อนุมัติ/นอกช่วงแทน promotion ที่ eligible
ไม่อ่านฉบับใหม่ที่ยังไม่เผยแพร่แทน frozen snapshot เดิม; การเปลี่ยนเวลาไม่ใช้ client bypass
มีภาพสี่ภาพตามชุดขนาด/ธีมที่เห็นบริบท promotion จริง และ receipt ของการตรวจส่วนอื่น
รูปสี่ภาพไม่ได้แทน runtime permission หรือ full gate

### 11.3 Permission card — แผนที่การตรวจ ไม่ใช่การเปลี่ยนสิทธิ์

card หลักยังเป็น docs/47 §4.7 (lead-owned) และข้อบังคับ docs/36
ตารางนี้จับคู่ทุก field กับการเตรียม/หลักฐาน ไม่เปิด entry point หรือ checkbox เพิ่ม

| Field | การตรวจในภาคนี้ |
| --- | --- |
| Feature / owner / Tab | lead รับผิดชอบ W3.2 สำหรับ editor/reviewer/Online; ใช้ `promotions` เดิม ไม่มี catalog checkbox ใหม่ — U31/U35/U37 |
| View (V) | Promotions V สำหรับ list/detail/chip/preview/history/suggestion/banner summary; entity source V เพิ่มตามหน้า; hidden tab ไม่มี payload/count — U31/U32/U36/U39 |
| Edit (E) | Promotions E สำหรับ draft/exclusion/text suggestion; banner ต้อง Projects E และ authorized actual-project binding; rights แยก — U34–U36 |
| Approve (A) | Promotions A และ lane/author separation เดิมสำหรับ DATA/LEGAL/review/approve; publication/withdraw special ยังใช้ — U37/U39 |
| Special actions / Separation | source V+existing publish/withdraw/rights specials; independent publisher, current APPROVED; Promotions E/A แยกและ revision editors/English reviewers publish ไม่ได้ — U37 |
| Templates | ไม่เพิ่ม default/template/account/grant; lead แนบ before/after receipt — U31/U39 |
| Agency | fixed external boundary ไม่มี internal context/evidence — U39 |
| Sensitivity | draft/import internal; public เฉพาะ eligible frozen snapshots; ใช้ audit.change_log/review/version history เดิม ไม่มี second log — U33/U34/U36/U37 |
| Other tabs | Projects/Brands V สำหรับ source names/resolution/entity; Knowledge V สำหรับ KM; Projects V/E และ binding สำหรับ banner; ไม่มี hidden-source reference exception — U31/U35/U36/U38 |
| Shared surfaces | assistant/citations/history/RAG/export/bytes/workers/caches และ feed/FAQ eligibility คงเดิม — U39/U40 |
| Endpoints / SQL | pending lead rehearsal: lead ผูก exact registered methods/routes, SQL helpers/dispatcher/policies กับ final W3.2 lease และ permission inventories; ใช้ runtime non-superuser deny/positive-neighbour receipts ไม่เดาชื่อ route เพิ่ม — U31/U33/U34/U39 |
| Rollout / verification | local fresh replay, existing bytes/history equivalence, scope/exclusion review, text-only suggestion, no live change before publish, default/revoked deny+allowed neighbour, counts และสี่ภาพ — U31–U40; full gate ตาม §9.1 ยังค้าง |

### 11.4 ผลและตำแหน่งหลักฐาน W3.2

ทุก path ต่อไปนี้เป็น **แผนเก็บผล owner UAT ที่ยัง NOT RUN**; หลักฐานวิศวกรรมแยกไม่เปลี่ยนผลกรณี
ใช้ `artifacts/unified-workspace/w3.2/<run-id>/` เติม run-id/commit/persona/clock จริงก่อนรอบ
เก็บต่อกรณีเป็น `U31-result.md` ถึง `U40-result.md` พร้อม expected/actual IDs,
sanitized status และ audit/version/review/publication IDs เท่าที่จำเป็น ไม่เก็บ secret หรือ private dump
ภาพบังคับ: `promotions-1280-light.png`, `promotions-1280-dark.png`,
`promotions-390-light.png`, `promotions-390-dark.png` ใต้ path เดียวกัน
ภาพกรณีเพิ่มเติมใช้ `Uxx-<width>-<theme>.png`; ระบุว่า UI จริงหรือ mocked UI
API/DB permission receipt ต้องแยกชัดจาก browser projection และไม่แทนด้วย screenshot

| กรณี | ผลปัจจุบัน | หลักฐานที่ต้องเติม | สิ่งกีดขวาง |
| --- | --- | --- | --- |
| U31 | ยังไม่ทดสอบ (NOT RUN) | `U31-result.md` | pending lead rehearsal: FP-CONTEXT/FP-ACCESS |
| U32 | ยังไม่ทดสอบ (NOT RUN) | `U32-result.md` | pending lead rehearsal: FP-SCOPE |
| U33 | ยังไม่ทดสอบ (NOT RUN) | `U33-result.md` | pending lead rehearsal: FP-CONTEXT/FP-SCOPE และ byte-equivalence receipt |
| U34 | ยังไม่ทดสอบ (NOT RUN) | `U34-result.md` | pending lead rehearsal: FP-EXCLUDE และ scope-drift controls |
| U35 | ยังไม่ทดสอบ (NOT RUN) | `U35-result.md` | pending lead rehearsal: FP-CONTEXT/FP-ACCESS |
| U36 | ยังไม่ทดสอบ (NOT RUN) | `U36-result.md` | pending lead rehearsal: FP-LEGACY/FP-ACCESS |
| U37 | ยังไม่ทดสอบ (NOT RUN) | `U37-result.md` | pending lead rehearsal: FP-EXCLUDE/FP-ACCESS |
| U38 | ยังไม่ทดสอบ (NOT RUN) | `U38-result.md` | pending lead rehearsal: FP-COUNTS/FP-ACCESS |
| U39 | ยังไม่ทดสอบ (NOT RUN) | `U39-result.md` | pending lead rehearsal: FP-ACCESS/FP-SCOPE และ runtime inventory receipts |
| U40 | ยังไม่ทดสอบ (NOT RUN) | `U40-result.md` และภาพสี่ภาพตามชุดขนาด/ธีม | pending lead rehearsal: FP-FAQ และ UI W3.2 |

ก่อนปิดรอบ lead รวมผล U01–U61 จากทุกตาราง กับ pending Q77–Q82 เดิมและรายการ §9
หาก prerequisite หรือ fixture ยังไม่พร้อม ให้บันทึกสิ่งที่ขาดและผู้รับผิดชอบตามจริง
ห้ามตีความ static document checks ว่า runtime ผ่าน หรือ W3.2 พร้อมให้เจ้าของรับงาน

## 12. ภาคเพิ่มเติม W9 — อัปโหลดและข้อเสนอจากข้อมูลในไฟล์

สถานะ: **ร่างเตรียม UAT — ยังไม่ทดสอบ (NOT RUN) ทุกกรณี U41–U54**
อ้างอิง owner decision และ addendum ใน docs/47 §8.6, ป้ายตรงจาก §8.5
และ permission card W9 ท้าย docs/48; addendum ให้ non-legal PDF ลบ metadata
และ rewrite อย่างปลอดภัยเสมอ แม้บีบอัดไม่ถึง 20% จึงไม่ใช้กติกาเก็บ bytes เดิมเมื่อไม่คุ้ม
evidence matrix มีแหล่ง source/spec ของ W9 สำหรับเตรียม แต่ไม่ใช่ final-main
delivery/rehearsal หรือผล UAT; ต้องกระทบยอด receipt บน final source ไม่อ้างว่ากรณีใดผ่าน
คงข้อกำหนด U01–U40 และ setup gaps เดิม; ภาคนี้เพิ่ม U41–U54 จำนวน 14 กรณี
ยอดทั้ง pack คือ 61 กรณีรวม P1 ตาม §10 และทั้งหมดคง NOT RUN

### 12.1 ใบเตรียมสำหรับ lead — pending lead rehearsal

ก่อนเจ้าของลงมือ lead ต้องผูกชุดสังเคราะห์ด้านล่างกับ final implementation/commit,
local origin, account/context/category และ expected result จริง ระบุขอบ MB/MiB
กับค่า byte ที่ระบบใช้ตรงกันใน client/proxy/API โดยไม่เปลี่ยนข้อจำกัดจากการเดา
ใช้ disposable local fixture, source offline และ stub เท่านั้น ไม่มี provider/hosted/R2 write
ภาพหรือเอกสารที่มีข้อมูลแฝงเป็น sentinel สังเคราะห์ ไม่มีข้อมูลบุคคลหรือพิกัดสถานที่จริง
ไม่ให้เจ้าของรันคำสั่งเทคนิค อ่านฐานข้อมูล หรือเปิด credential

| ชุดที่ต้องสร้าง/ซ้อม | รายละเอียดและค่า expected ที่ lead ต้องเติม | สถานะ |
| --- | --- | --- |
| FW9-IMAGE | JPEG orientation 1–8, color profile, ขอบยาวเกิน/เท่ากับ/ต่ำกว่า 4096, ไฟล์เล็ก ≤2 MB, 30 MB และ 100 ล้าน pixels ก่อน/ตรง/หลังขอบ; animated/bomb/malformed; stored >10 MB | pending lead rehearsal |
| FW9-FORMAT | JPEG/WebP, PNG line art, PNG โปร่งใส, PNG ภาพถ่ายทึบเกิน 4 MB หลัง lossless, SVG unsafe/sanitized; ขนาดก่อน/หลังและ expected MIME/dimensions | pending lead rehearsal |
| FW9-META | capture date มี/ไม่มี offset; creator/copyright/credit/terms; stock; AI DigitalSourceType/C2PA/render software และ camera make/model; caption/keywords active/inactive/unmapped; plain-text/length/invalid encoding sentinel | pending lead rehearsal |
| FW9-GPS | รูปใกล้/ไกลโครงการและเส้น 1 km, ไม่มี GPS/ไม่มีพิกัด project/ไม่มี project context; context สอง project ต่างกัน; expected near/far/unknown โดยไม่มีพิกัดดิบในใบผล | pending lead rehearsal |
| FW9-PRIVATE | sentinel serial/contact/face regions/history/path/user/computer/embedded thumbnail ต่างจาก main image; PDF author/creator/producer/dates/XMP/incremental history; approved legal/disclosure และ unknown category แยกจาก marketing | pending lead rehearsal |
| FW9-PDF | brochure gain ก่อน/ตรง/หลัง 20%, low/no-gain, text/image pages, ขอบ 50 MB input/20 MB stored และ page limit เดิม, active-content input/output, rewrite ไม่ปลอดภัย; baseline page count/text/visual | pending lead rehearsal |
| FW9-IDENTITY | original ซ้ำ, stored ซ้ำจาก original ต่างกัน, pipeline-version เปลี่ยน, asset เดิมก่อน W9 และ historical knowledge package, context ที่มี/ไม่มีสิทธิ์, legal/unknown class เทียบ marketing; checksum/rights/binding baseline | pending lead rehearsal |
| FW9-ACTORS | source V/E และ actual object/BUD scope ตาม workflow project/brand/model/banner/media; no-V/no-E/no-source/revoked/agency; rights individual/bulk; publisher แยก; permitted neighbours และ draft revision | pending lead rehearsal |
| FW9-UI | mixed batch สำเร็จ/ปฏิเสธ/รอ/retry, ฟอร์มมีข้อความค้าง; 1280/390 light/dark, keyboard; ordinary reset ที่ไม่แก้ history | pending lead rehearsal |

**หลักฐานก่อนเปิดรอบ:** lead แนบ runtime deny/allowed-neighbour, next-request revocation,
serialized decode-through-encode และ bounded admission, concurrent original/stored dedup,
unchanged historical bytes/identity, exclusion sentinel scan และ storage summary ค่าเฉลี่ย
stored image/PDF จาก fixtures ที่ระบุจำนวน/หน่วย ไม่ใช้ค่าเฉลี่ยสมมติหรือภาพหน้าจอแทน
ต้องมี full gate/final scan และ inventory ของ card W9; ไม่มี runtime receipt เหล่านี้ในร่างนี้
เจ้าของดู receipt ประกอบการทดสอบ ไม่ต้องสร้าง concurrent load หรือเรียก storage เอง

### 12.2 ขั้นเจ้าของ U41–U54

เริ่มแต่ละกรณีหลัง lead เติมชุดเตรียมและ URL จริงครบ หากยังไม่พร้อมคง NOT RUN
ทุกการใช้ข้อเสนอทดสอบบน draft สังเคราะห์ที่คืนค่าได้ด้วย ordinary workflow

### U41 — ภาพตั้งตรง สีและขนาดเหมาะกับเว็บ

**เตรียม:** FW9-IMAGE; lead แสดงภาพอ้างอิง orientation/color/dimensions ที่คาดหมาย

1. อัปโหลด JPEG ต่าง orientation และภาพขอบยาวเกิน 4096 จาก context ที่กำหนด
2. เทียบภาพที่แสดงกับต้นฉบับ offline ตรวจไม่หมุนผิด/กลับด้าน สีไม่เพี้ยนอย่างเห็นได้ชัด
   และขอบยาวหลังเก็บไม่เกิน 4096 โดยรักษาสัดส่วน
3. อัปโหลดภาพเล็กไม่เกิน 4096 และ 2 MB เทียบ dimensions ก่อน/หลัง
4. อัปโหลด JPEG 24 MP ขนาด 6000×4000; ขอบยาวที่จัดเก็บต้องเป็น 4096
   รักษาสัดส่วน ไม่ลดเหลือ 3000 จาก draft decode

**ต้องเห็น:** EXIF orientation ถูกใช้ก่อนตัด metadata, output เป็น sRGB ไม่ upscale
ไฟล์เล็กคง dimensions ไม่มี visible quality loss; preview/thumbnail ใช้ stored optimized file
lead แนบผลตรวจสี/metadata/dimensions จริง ไม่ใช้สายตาอย่างเดียวพิสูจน์ encoder

### U42 — ขอบเขตภาพและไฟล์อันตรายถูกปฏิเสธชัดเจน

**เตรียม:** FW9-IMAGE/FW9-ACTORS; lead เตรียมไฟล์ขอบโดยไม่ให้เจ้าของสร้าง bomb

1. ลองภาพก่อน/ตรง/เกินขอบ 30 MiB ตามใบ fixture; JPEG ไม่เกิน 100 ล้านพิกเซล
   ส่วน PNG ทุกความลึกสีและ WebP ไม่เกิน 24 ล้านพิกเซล ตรวจปฏิเสธจาก header ก่อน decode
   ลอง PNG แบบ PQ และ HLG แม้เป็นภาพเล็ก ต้องปฏิเสธพร้อมคำแนะนำส่งออกใหม่
2. ลอง animated/malformed/decompression-bomb fixtures และภาพที่ output ยังเกิน 10 MB
3. เปิดผลแต่ละไฟล์ แล้วเทียบกับภาพเพื่อนบ้านที่อยู่ในเกณฑ์

**ต้องเห็น:** แสดง «ภาพไม่เกิน 30 MB ต่อไฟล์» ตามกรณี; output เกินใช้
«ภาพหลังปรับขนาดยังเกิน 10 MB กรุณาลดขนาดไฟล์แล้วอัปโหลดอีกครั้ง»
ใช้ข้อความตามชนิด: «ภาพ JPEG ต้องมีขนาดไม่เกิน 100 ล้านพิกเซล กรุณาลดความละเอียดแล้วอัปโหลดอีกครั้ง»;
«ภาพ PNG ต้องมีขนาดไม่เกิน 24 ล้านพิกเซล กรุณาลดความละเอียดแล้วอัปโหลดอีกครั้ง»;
«ภาพ WebP ต้องมีขนาดไม่เกิน 24 ล้านพิกเซล กรุณาลดความละเอียดแล้วอัปโหลดอีกครั้ง»;
«ไม่รองรับภาพ PNG แบบ HDR กรุณาส่งออกเป็นภาพ 8-bit sRGB แล้วอัปโหลดอีกครั้ง»
animated/bomb ไม่ผ่าน guard และไม่ค้างงานอื่น; lead ยืนยัน client/proxy/API limits ตรงกัน
การปฏิเสธไฟล์หนึ่งไม่ทำให้ไฟล์ที่อนุญาตในชุดนั้นหาย

### U43 — เลือกรูปแบบโดยรักษารูปเส้นและความโปร่งใส

**เตรียม:** FW9-FORMAT พร้อม expected format/quality/dimensions และภาพเทียบ offline

1. อัปโหลด JPEG, WebP, PNG line art/แผนที่/logo และ PNG โปร่งใส
2. อัปโหลด PNG ภาพถ่ายทึบที่ยังเกิน 4 MB หลัง lossless แล้วเทียบชนิดไฟล์ที่จัดเก็บ
3. เปิด sanitized SVG fixture และให้ lead แสดง receipt ของ SVG ที่ถูกปฏิเสธ

**ต้องเห็น:** JPEG คง JPEG และ WebP คง WebP; quality 85 ใช้กับไฟล์ที่ต้องปรับตามขั้นปกติ
ยกเว้นภาพขอบยาวไม่เกิน 4096 px และขนาดไม่เกิน 2 MB ตาม U41: คง dimensions
และไม่มี visible quality loss โดยใช้ JPEG quality keep หรือ lossless handling ที่เหมาะสม
พร้อมลบ metadata ตาม processing record
PNG lossless ไม่ทำให้เส้นเบลอ/พื้นโปร่งใสหาย; เฉพาะ PNG ไม่มี transparency และยังเกิน 4 MB
หลัง lossless จึงเปลี่ยนเป็น JPEG quality 90; SVG ใช้ sanitization เดิม

### U44 — ข้อมูลแฝงที่ปลอดภัยเป็นข้อเสนอเท่านั้น

**เตรียม:** FW9-META/FW9-PRIVATE; lead แยก expected allowlist กับ sentinel ที่ห้ามเก็บ

1. เปิด «ข้อเสนอจากข้อมูลในไฟล์» ที่ media tagging panel ข้าง AI suggestions
   ตรวจ «จากข้อมูลในไฟล์» และ «ยังไม่ได้ยืนยัน» แยกจากค่าที่ staff ยืนยันแล้ว
2. เทียบ capture date ที่มี offset และไม่มี offset รวม caption/keywords/image-kind/credit
3. ตรวจ keyword ที่ตรง active vocabulary กับคำที่ไม่ตรงหรือ tag inactive

**ต้องเห็น:** ที่มาเป็น file_metadata มี pipeline version/context ไม่รวมเข้าค่า confirmed อัตโนมัติ
ไม่มี offset ต้องแสดง «ไม่ทราบเขตเวลาที่ถ่าย» ไม่ใช้ upload time แทน
AI/render signals ให้ render suggestion; camera make/model โดยไม่มี signal เหล่านั้นให้ photo
คำไม่ตรงแสดงเป็น «คำสำคัญจากไฟล์ที่ยังไม่ตรงกับป้ายกำกับ» ไม่สร้าง/propose tag เอง
text เป็น plain text จำกัดความยาวและ decode อย่างปลอดภัย ไม่มี markup/script ทำงาน

### U45 — นำข้อเสนอมาใช้แล้วบันทึกได้เฉพาะร่างตามสิทธิ์

**เตรียม:** FW9-META/FW9-ACTORS; draft revision และค่า confirmed/rights/publication ก่อนเริ่ม

1. เลือก «นำมาใช้» ทีละ field ตรวจค่าที่เติมในฟอร์ม จากนั้นบันทึก draft ตาม flow เดิม
2. ลองด้วยบัญชีไม่มี E และให้ lead ถอนสิทธิ์หลังเปิดข้อเสนอ ก่อนบันทึกอีกครั้ง
3. ตรวจ rights, English-review และ published version เทียบก่อนเริ่ม แล้วกลับสู่ draft ที่อนุญาต

**ต้องเห็น:** Use เปลี่ยนเฉพาะ ordinary editable draft field และ save ต้องมี E ปัจจุบัน
ไม่ auto-confirm metadata/rights/English หรือ approve/publish; denied/stale ไม่ล้างข้อความค้าง
เพื่อนบ้านที่มีสิทธิ์ยังบันทึกได้ ข้อเสนอไม่เป็นหลักฐาน approval ด้วยตัวเอง

### U46 — เครดิตและ stock ต้องตรวจสิทธิ์เป็นรายไฟล์

**เตรียม:** FW9-META/FW9-ACTORS; stock evidence และ non-stock neighbour, rights reviewer แยก

1. เปิดงาน rights ของไฟล์ stock ตรวจ «หลักฐานเครดิตและสิทธิ์จากไฟล์» และ
   «พบข้อมูลภาพจากคลังภาพ กรุณาตรวจสิทธิ์เป็นรายไฟล์»
2. ลอง bulk rights approval ที่มี stock ปน แล้วเปิด individual evidence-based review
3. เปรียบเทียบ non-stock ที่ผ่านข้อกำหนดเดิมและบัญชีไม่มี rights-review authority

**ต้องเห็น:** stock suggestion present กันออกจาก bulk ทั้ง API/SQL ไม่ใช่แค่ซ่อน checkbox
individual review ยังทำได้ด้วยหลักฐานและสิทธิ์เดิม; credit/usage terms ไม่อนุมัติสิทธิ์ให้อัตโนมัติ
ไม่มี grant/special/template ใหม่ และ contributor/content review rules เดิมยังอยู่

### U47 — ความใกล้โครงการไม่เก็บพิกัดดิบ

**เตรียม:** FW9-GPS/FW9-ACTORS; lead ใส่ผลคาดหมายของเส้น 1 km ตาม implementation ที่ทบทวน

1. อัปโหลดภาพ near/far ใน project context ที่มีพิกัดเก็บไว้ และภาพไม่มี GPS
2. ทำซ้ำกับ project ไม่มีพิกัดและ context ที่ไม่ใช่ project
3. ใช้รูปเดิมใน project ที่สองและเทียบบัญชีที่ไม่มี source/object access

**ต้องเห็น:** เก็บเพียง «ถ่ายใกล้โครงการ», «ถ่ายห่างจากโครงการ» หรือ
«ไม่ทราบความใกล้โครงการ» ตามบริบท ไม่มี raw coordinates หรือ distance ในผลหน้าจอ/receipt
คำนวณชั่วคราวจาก project ที่มีสิทธิ์; suggestion จากอีก project ไม่รั่วข้าม context
lead แนบ sentinel audit ว่าพิกัด/ระยะไม่อยู่ใน stored file, database, logs หรือ API response

### U48 — ข้อมูลที่ห้ามเก็บถูกตัดและใช้ไฟล์ที่จัดเก็บเท่านั้น

**เตรียม:** FW9-PRIVATE/FW9-IMAGE; sentinel เป็นข้อมูลสังเคราะห์และ embedded thumbnail ต่างจากภาพหลัก

1. อัปโหลดภาพแล้วดู preview/thumbnail ตรวจว่าไม่ใช้ embedded preview เก่า
2. ให้ lead เปิด sanitized processing/privacy receipt และเปรียบเทียบ main stored image
3. ตรวจผล allowlisted suggestions ที่ยังมีเหตุผลใช้งานโดยไม่เปิด original ผ่าน Hub

**ต้องเห็น:** ไม่มี EXIF/GPS/XMP/IPTC/comments หรือ embedded thumbnail ใน stored image
ไม่เก็บ/log serials, contact details, face/person regions, edit history, path/user/computer names
สิ่งที่ห้ามไม่อยู่ใน DB/logs/API; allowlisted suggestions เก็บแยกอย่าง bounded เท่านั้น
Hub เก็บเฉพาะ optimized bytes ไม่มี camera/designer original หรือ download original ใหม่
private preview/thumbnail/image job ใช้ stored file; legal exception ตรวจแยกใน U49

### U49 — กฎหมาย disclosure และประเภทไม่ทราบคง bytes และความเป็นส่วนตัว

**เตรียม:** FW9-PRIVATE/FW9-IDENTITY/FW9-ACTORS; hashes ของ legal/disclosure/unknown inputs

1. เลือก legal category และ disclosure evidence ก่อนอัปโหลด ตรวจผล
   «เก็บไฟล์โดยไม่เปลี่ยนแปลง» แล้วเทียบ checksum receipt
2. อัปโหลดเมื่อ category ยังไม่ทราบ และลองไฟล์ก่อน/ตรง/เกิน 10 MB ตาม fixture
3. ลอง reused marketing asset ใน legal/disclosure context โดยให้ lead แสดงผลปฏิเสธที่ซ้อมแล้ว

**ต้องเห็น:** legal/unknown คง bytes/metadata ตรง input ภายใต้ existing limits และ private
แสดง «เอกสารกฎหมายหรือไฟล์ที่ยังไม่ระบุประเภทต้องไม่เกิน 10 MB» ตามกรณี
disclosure บังคับ legal handling แม้เลือก category อื่น; ต้องทราบ context ก่อน process
dedup ไม่ใช้ optimized marketing bytes แทน legal original และไม่ promote marketing เป็น legal evidence
metadata ที่อยู่ใน legal bytes เป็นข้อยกเว้น private ไม่ใช่สิทธิ์ส่งออก public/AI

### U50 — brochure บีบอัดเมื่อคุ้มและคงเนื้อหา

**เตรียม:** FW9-PDF; input/stored size, page count/text/visual baseline และ gain ที่คำนวณแล้ว

1. อัปโหลด brochure ที่ gain ต่ำกว่า/เท่ากับ/สูงกว่า 20% แล้วอ่านผลต่อไฟล์
2. เปิด stored PDF แบบ local ที่ได้รับอนุญาต เทียบจำนวนหน้า ข้อความค้นหาได้และหน้าที่มีภาพ
3. เทียบ processing record กับผลที่ lead แสดง ไม่คำนวณจากเลขปัดเศษบน UI เพียงอย่างเดียว

**ต้องเห็น:** ใช้ recompression เมื่อเล็กลงอย่างน้อย 20% และ page count/text ผ่าน
ภาพประมาณ 200 dpi/JPEG quality 80 ตาม record; ไม่ใช้ recompressed candidate ที่ทำเนื้อหาเสีย
ทุก non-legal PDF ยังต้อง rewrite/strip metadata แม้ไม่ใช้ recompression ตาม U51
จึงไม่อ้างว่า no-gain marketing PDF เก็บ original bytes

### U51 — PDF ไม่มี gain ก็ต้องลบ metadata และ rewrite อย่างปลอดภัย

**เตรียม:** FW9-PDF/FW9-PRIVATE; low/no-gain PDF มี Info/XMP/incremental history และ Title

1. อัปโหลด PDF low/no-gain ตรวจ «ลบข้อมูลแฝงของไฟล์แล้ว» และผลตรวจหน้า/text
2. เปิด «ข้อเสนอจากข้อมูลในไฟล์» ตรวจได้เฉพาะ Title เป็น caption suggestion
3. ลอง fixture ที่ rewrite metadata อย่างปลอดภัยไม่ได้

**ต้องเห็น:** document information dictionary, XMP และ incremental history ถูกลบด้วย full rewrite
แม้ gain ต่ำกว่า 20%; page count/extractable text คงเดิม; ไม่เก็บ author/creator/producer/dates
Title เป็น private suggestion เท่านั้น ไม่ใช้ metadata อื่น; unsafe rewrite ปฏิเสธพร้อม
«ไม่สามารถลบข้อมูลแฝงของ PDF ได้อย่างปลอดภัย กรุณาส่งออก PDF ใหม่แล้วอัปโหลดอีกครั้ง»
ไม่ fallback เก็บ original non-legal bytes ที่ยังมีข้อมูลแฝง

### U52 — PDF limits และ active content คุมทั้งก่อนและหลัง

**เตรียม:** FW9-PDF; ขอบ 50 MiB, 200 หน้า, ภาพละ 24 ล้านพิกเซลแบบ weighted
รวม attached masks และ depth weighting เดิม; aggregate 240 ล้านพิกเซลแบบ unique
แนบ 12 MP + 12 MP mask, 12 MP 16-bit, over-object, 10 unique × 24 MP,
เกิน aggregate และ shared-reference dedup; แยก header-only negatives จาก PDF ที่เปิดได้จริง

1. ลอง PDF ก่อน/ตรง/เกิน 50 MiB input, 200 หน้า และ stored เกิน 20 MiB
   ตรวจขอบ weighted 24 MP ต่อภาพพร้อม mask และ unique aggregate 240 MP;
   shared reference ต้องนับครั้งเดียว แต่ภาพคนละ object ต้องนับแยก
2. ให้ lead สาธิต active-content input/output denial จาก receipt ที่ซ้อมไว้
3. เทียบ PDF ที่ถูกต้องในชุดเดียวกันกับผลปฏิเสธแต่ละไฟล์

**ต้องเห็น:** «PDF ไม่เกิน 50 MB ต่อไฟล์» และกรณี output เกินแสดง
«PDF หลังปรับขนาดยังเกิน 20 MB กรุณาลดขนาดไฟล์แล้วอัปโหลดอีกครั้ง»
ภาพเกินขอบต่อ object แสดง «ภาพแต่ละภาพใน PDF ต้องมีขนาดไม่เกิน 24 ล้านพิกเซลเมื่อรวมความลึกสีและมาสก์ กรุณาลดความละเอียดแล้วส่งออก PDF ใหม่»
รวมเกินขอบแสดง «ภาพภายใน PDF มีขนาดรวมเกิน 240 ล้านพิกเซล กรุณาลดความละเอียดของภาพแล้วส่งออก PDF ใหม่»
active-content checks ทำทั้ง input/output; SQL/readers/adapters ใช้ stored limit สอดคล้อง
ไฟล์เกินเกณฑ์ไม่ bypass ผ่าน proxy/API หรือ category; permitted neighbour ยังเปิดได้

### U53 — identity/dedup คงเดิมและไม่เปิด asset ที่ไม่มีสิทธิ์

**เตรียม:** FW9-IDENTITY/FW9-ACTORS; lead แนบ original/stored checksum และ concurrent receipt

1. อัปโหลด original ซ้ำแล้วตรวจ asset identity ที่กลับมา รวมรอบ pipeline version ใหม่ที่ lead ซ้อมแล้ว
2. เทียบ original ต่างกันแต่ stored checksum เหมือนกัน และ context ที่ไม่มีสิทธิ์
3. เปิด asset/historical package ก่อน W9 เทียบ bytes/identity/rights/binding กับ baseline

**ต้องเห็น:** dedup original ก่อน stored ภายใต้ processing class/context ที่ได้รับอนุญาต
checksum ของ stored ยังคง content address/public identity; ไม่เผย asset เพราะรู้ checksum อย่างเดียว
new source association ไม่เขียน asset/rights เดิมใหม่; ไม่ reprocess/rewrite/delete ไฟล์เก่า
future operator intake ใช้ pipeline เดียว แต่ historical validation คง original identity checks
เจ้าของไม่ต้องสร้างการแข่งขันเอง; lead แนบ concurrency และ allowed-neighbour proof แยก

### U54 — ผลต่อไฟล์ retry และการไม่รั่วผ่านปลายทางอื่น

W9.1 เพิ่ม: ทดสอบทั้งสอง admin upload flows ด้วยสอง tab/ผู้ใช้สังเคราะห์ใน local เท่านั้น
มี processing job ได้ครั้งละหนึ่งงาน ไม่มี server queue; งานที่ชนได้ 429 + Retry-After
client รอตาม header และ retry ไม่เกิน 60 วินาที แสดง
«กำลังรอให้อัปโหลดไฟล์อื่นเสร็จ ระบบจะลองให้อัตโนมัติภายใน 60 วินาที»
ต้องมีรอบ retry แล้วสำเร็จ และรอบครบเวลาแสดง error พร้อมคงไฟล์/ข้อความเดิม
non-429 ไม่ retry; controlled cancel/timeout ต้อง kill/reap child ก่อนคืน slot
และไม่สร้าง asset สำเร็จบางส่วน แนบหลักฐานการทดสอบเดิมแยกจาก owner walkthrough
ห้ามทดสอบโหลดบน VPS

**เตรียม:** FW9-UI/FW9-ACTORS/FW9-PRIVATE; exclusion sentinel receipts และ stored-size summary

1. อัปโหลด mixed batch ตรวจ «ไฟล์ก่อนปรับขนาด» และ «ไฟล์ที่จัดเก็บ» ต่อไฟล์
   มี size/dimensions/result ตามชนิดไฟล์ ลอง retry เฉพาะไฟล์ที่ไม่สำเร็จผ่าน flow ปกติ
2. ทำซ้ำ 1280/390 light/dark ตรวจข้อความไทยยาว, keyboard/focus และไม่มี horizontal page scroll
3. ตรวจ public page/export/assistant ที่ lead เตรียมอย่างปลอดภัย และอ่าน exclusion receipt
   ไม่เรียก provider จริงหรือเปิด private raw payload เพื่อพิสูจน์ด้วยตัวเอง

**ต้องเห็น:** ผลสำเร็จ/ปฏิเสธไม่ปนกัน retry ไม่สร้าง asset ซ้ำหรือส่งงานสำเร็จซ้ำโดยเงียบ
ข้อความค้างยังอยู่เมื่อ error/revocation; use/save/rights ยังเคารพ source V/E/BUD/object conjunction
file suggestions ไม่เข้า public/JSON-LD/export/DW/RAG/assistant/citation/history/provider context
รวม reused/cached paths; legal และ excluded data ไม่เข้า public/export/AI
ไม่มี permission/catalog/grant/template change หรือ agency access เพิ่มจาก W9
storage averages และ serialized processing เป็น receipt prerequisite ไม่ใช่ผลจากภาพ UI

### 12.3 ใบผลและหลักฐาน W9 ที่ยังต้องเติม

path ต่อไปนี้เป็นแผนเก็บผล owner UAT U41–U54 ที่ **ยัง NOT RUN**; ต้องจับคู่หลักฐานวิศวกรรมกับ final source แยกต่างหาก:
`artifacts/unified-workspace/w9/<run-id>/` โดยระบุ commit, fixture version, persona/context,
expected/actual และ sanitized asset/source/version IDs เท่าที่จำเป็น ห้ามแนบ raw excluded metadata
ผลกรณีใช้ `U41-result.md` ถึง `U54-result.md`; รูป UI ใช้ `upload-1280-light.png`,
`upload-1280-dark.png`, `upload-390-light.png`, `upload-390-dark.png` รวมสี่ภาพ/ชุดขนาดธีม
receipt prerequisite ใช้ `privacy-exclusions.md`, `permissions-neighbours.md`,
`dedup-concurrency.md`, `processing-admission.md`, `historical-identity.md`, `storage-summary.md`
และลิงก์ full gate จริง แยก UI/mock projection ออกจาก API/DB/byte-level proof
ไม่เก็บ original binary ใน Hub เพื่อทำ screenshot; ใช้ input fixture offline ของผู้ทดสอบเท่านั้น

| กรณี | ผล | ชุดที่ยังรอ lead rehearsal |
| --- | --- | --- |
| U41 | ยังไม่ทดสอบ (NOT RUN) | FW9-IMAGE |
| U42 | ยังไม่ทดสอบ (NOT RUN) | FW9-IMAGE/FW9-ACTORS |
| U43 | ยังไม่ทดสอบ (NOT RUN) | FW9-FORMAT |
| U44 | ยังไม่ทดสอบ (NOT RUN) | FW9-META/FW9-PRIVATE |
| U45 | ยังไม่ทดสอบ (NOT RUN) | FW9-META/FW9-ACTORS |
| U46 | ยังไม่ทดสอบ (NOT RUN) | FW9-META/FW9-ACTORS |
| U47 | ยังไม่ทดสอบ (NOT RUN) | FW9-GPS/FW9-ACTORS |
| U48 | ยังไม่ทดสอบ (NOT RUN) | FW9-PRIVATE/FW9-IMAGE |
| U49 | ยังไม่ทดสอบ (NOT RUN) | FW9-PRIVATE/FW9-IDENTITY/FW9-ACTORS |
| U50 | ยังไม่ทดสอบ (NOT RUN) | FW9-PDF |
| U51 | ยังไม่ทดสอบ (NOT RUN) | FW9-PDF/FW9-PRIVATE |
| U52 | ยังไม่ทดสอบ (NOT RUN) | FW9-PDF |
| U53 | ยังไม่ทดสอบ (NOT RUN) | FW9-IDENTITY/FW9-ACTORS |
| U54 | ยังไม่ทดสอบ (NOT RUN) | FW9-UI/FW9-ACTORS/FW9-PRIVATE |

ก่อนปิด UAT lead ต้องรวมผลทั้ง 61 กรณีรวมภาคผนวก P1 โดยคง pending W3.1/W3.2/W9 และ Q77–Q82 ตามจริง
static Markdown/UTF-8/label check ไม่ใช่ runtime validation หรือ owner acceptance


## ภาคผนวก P1 — ข้อแก้ไขหน้าจอหกเรื่องและบรรทัดแจ้งข้อผิดพลาด BUD ที่อนุมัติเพิ่ม

งานเตรียมวันที่ 12 พฤศจิกายน 2026 ยังไม่ทดสอบทุกกรณี U55–U61 และยังไม่มี
การรับงานของเจ้าของ รวมเป็น 61 กรณีที่ยังไม่ทดสอบ; ฉบับกระทบยอดนี้คงข้อกำหนด U01–U61 เดิมทั้งหมด และแก้เฉพาะส่วนเตรียม/ยอดรวม/ลำดับ/สถานะหลักฐาน
เมื่อเริ่ม W8 ต้องรวมผลทั้ง 61 กรณีและคงคำถามที่ยังรอตามจริง

เริ่มทดสอบหลัง W6, P1, W7 และ W9 ส่งมอบบน main แล้วเท่านั้น P1 ต้องมี commit
ของตนและใช้ full gate ร่วมกับ W7 ผู้ดูแลเตรียมรหัสบัญชีสังเคราะห์และสิทธิ์
ในฐานทดสอบ ส่วนการรับงาน บัญชี hosted งบจริง และการเปิด DW feed เป็นการ
ตัดสินใจของเจ้าของ ไม่อนุญาตการเปลี่ยน hosted หรือเรียกบริการภายนอกจริงจาก UAT
เก็บผลและภาพภายใต้ artifacts/unified-workspace/w8/<run-id>/ แยกจากงานเตรียม

### U55 — จำนวนการเปิดเผยข้างปุ่ม «ส่งอนุมัติทั้งหมดที่แก้» ระดับหน้า: M คือรายการ eligible ที่แก้แล้ว N คือรายการ Hub-only ในชุดเดียวกัน (P1)

**ใช้:** MKT-A; F-DRAFT/F-ENTITY

**เตรียม:** fixture สังเคราะห์หนึ่งหน้าที่มีรายการ eligible ที่แก้แล้ว **สี่รายการ** โดย **หนึ่งรายการมี ai_exposure เป็น internal (Hub-only)** และ **สามรายการเป็น website/AI** ค่าคาดหมาย **N = 1, M = 4** บันทึกในใบ fixture ก่อนเปิดหน้า พร้อม fixture เพิ่มเติมสองชุด: ชุด N = 0 แต่ M > 0 (eligible แก้แล้วทั้งหมดเป็น website/AI) และชุด all-internal (eligible แก้แล้วทุกรายการเป็น Hub-only) ป้ายรายตัวและป้ายใน «ผลการส่งอนุมัติ» ยังใช้ประโยครายตัวเดิมของระบบ ห้ามแต่งประโยคใหม่แทน

1. เปิดหน้าที่กำหนดด้วย MKT-A ตรวจจำนวนการเปิดเผยที่อยู่ข้างปุ่ม «ส่งอนุมัติทั้งหมดที่แก้» ระดับหน้า: ต้องได้ **N = 1, M = 4** ตรงใบ fixture — M นับเฉพาะรายการ eligible ที่แก้แล้วซึ่งปุ่มนี้จะส่ง N นับเฉพาะรายการในชุดเดียวกันที่ ai_exposure เป็น internal กรณีนี้ไม่ใช่ตัวนับแบ่งหน้า (pagination) และไม่ใช่ chip นับการมองเห็น
2. ตรวจประโยคอธิบายระดับหน้าว่าระบุชัดว่า **รายการ Hub-only หนึ่งรายการจะไม่ปรากฏบนเว็บไซต์และไม่เข้าคำตอบ AI** โดยใช้ประโยคที่ระบบมีจริง ไม่แต่งใหม่
3. ขยายรายการเดิม (expand) ตรวจว่ารายการ Hub-only **แต่ละรายการ** มีลิงก์เปลี่ยนการเปิดเผย (change-exposure) เฉพาะของตน และเปิดลิงก์แล้วถึงรายการที่ถูกต้อง (ไม่เปิดเพื่อนบ้านแทน)
4. ทดสอบชุด N = 0 แต่ M > 0: **ไม่มีป้ายแจ้ง Hub-only ระดับหน้า** และปุ่มส่งอนุมัติทั้งหมดทำงานปกติกับรายการทั้งหมด
5. ทดสอบชุด all-internal: ต้องได้ **N = M** และประโยคระดับหน้าระบุครบว่าทุกรายการในชุดจะไม่ขึ้นเว็บไซต์และไม่เข้าคำตอบ AI
6. ตรวจว่าข้อสังเกตระดับหน้า **ไม่บังคับ**: กดส่งอนุมัติทั้งหมดได้ตามปกติ พฤติกรรมการส่งและกติกาการเปิดเผยรายตัวคงเดิมทุกอย่าง และป้ายรายตัวของรายการรวมถึงป้ายใน «ผลการส่งอนุมัติ» ยังใช้ **ประโยครายตัวเดิม** ไม่ถูกแทนด้วยประโยครวม
7. ทำซ้ำข้อ 1–2 ที่ 390 ตรวจ **ไม่มี horizontal page scroll** และจำนวน/ประโยคไม่ถูกตัดขอบจนอ่านไม่ได้

**ต้องเห็น:** จำนวน N/M เป็นการนับการเปิดเผยของชุดที่ปุ่มส่งอนุมัติทั้งหมดจะส่ง (M) โดย N เป็นส่วนที่ ai_exposure เป็น internal ตรง fixture ทุกชุด (1/4; N = 0 ไม่มีป้ายระดับหน้า; all-internal ได้ N = M) มีประโยคระบุผลกระทบเว็บไซต์/AI ระดับหน้า รายการ Hub-only ทุกรายการมีลิงก์เปลี่ยนการเปิดเผยของตนและเปิดถูกรายการ ป้ายรายตัวและป้ายผลการส่งคงประโยครายตัวเดิม การแสดงจำนวนไม่เปลี่ยนพฤติกรรมการส่งหรือกติกาการเปิดเผย และไม่มี horizontal scroll ที่ 390 กรณีนี้ไม่สมมติ pagination ใหม่ chip ใหม่ หรือทางเข้า/การนำทางใหม่

**หลักฐาน:** `U55-result.md` (ค่าคาดหมาย/ค่าจริง N/M ทั้งสามชุด fixture + บัญชี), `U55-1280-light.png`, `U55-1280-dark.png`, `U55-390-light.png`, `U55-390-dark.png`, ภาพกรณี N = 0 ที่ไม่มีป้ายระดับหน้า และภาพลิงก์เปลี่ยนการเปิดเผยรายตัวหลังขยายรายการ

**ผล:** ยังไม่ทดสอบ (NOT RUN)

### U56 — สถานะว่างที่ตรงความจริงบนพื้นผิวที่ได้รับผลแต่ละแห่ง และงานโฆษณาเดิมไม่เปลี่ยน (P1)

**ใช้:** MKT-A, ONLINE, RELEASES-HISTORY, FAQ-ONLY; F-DRAFT/F-PUBLISH/F-ENTITY/F-FAQ

**เตรียม:** fixture แยกสำหรับพื้นผิวที่ได้รับผลแต่ละแห่ง: (ก) หน้าที่ไม่มีรายการ eligible แก้แล้วเลย สำหรับบรรทัดจำนวนในส่วนหัวของการส่งอนุมัติทั้งหมด (submit-all header inventory line), (ข) คิวเผยแพร่เว็บไซต์ที่ไม่มีรายการรอ, (ค) ประวัติเผยแพร่ที่ยังไม่เคยมีการเผยแพร่, (ง) ภาพรวมของ source ที่เผยแพร่แล้วแต่ไม่มีการเปลี่ยนหลังเผยแพร่ล่าสุด และ (จ) รายการที่มีช่องค้นหา/ตัวกรองอยู่จริง พร้อม fixture กรณี active filter miss และ default empty จดภาพ/ผลของงานโฆษณาเดิมก่อนรอบ

1. พื้นผิว (ก): เปิดหน้าที่ไม่มีรายการ eligible แก้แล้ว ตรวจว่า **ซ่อนเฉพาะประโยคสถานะว่างใต้ปุ่มส่งอนุมัติทั้งหมด** ปุ่มยังแสดงจำนวน (0) ตามเดิม
2. พื้นผิว (ข): เปิดคิวเว็บไซต์ด้วย ONLINE ชุดที่ไม่มีรายการรอ ตรวจข้อความบอกว่า **ไม่มีอะไรรอเผยแพร่** ไม่มีแถวสมมติ จำนวนปลอม หรือ skeleton ที่ดูเหมือนกำลังโหลดข้อมูลอยู่
3. พื้นผิว (ค): เปิดประวัติเผยแพร่ (หน้าเว็บและชุดเผยแพร่ข้อมูลตามที่มีจริง) ด้วย ONLINE และ RELEASES-HISTORY ชุดที่ยังไม่เคยเผยแพร่ ตรวจข้อความบอกว่า **ยังไม่มีอะไรเผยแพร่**
4. พื้นผิว (ง): เปิดภาพรวมของ source ที่เผยแพร่แล้วซึ่งไม่มีการแก้หลังเผยแพร่ ตรวจส่วนการเปลี่ยนแปลงหลังเผยแพร่บอกว่า **ไม่มีการเปลี่ยนแปลงหลังเผยแพร่**
5. ตรวจยืนยันว่าพื้นผิว (ก)–(ง) **ไม่มีตัวกรองรายการ** อยู่แล้ว กรณีนี้จึงไม่เสนอ ไม่เพิ่ม และไม่สมมติตัวกรองใหม่บนพื้นผิวเหล่านี้ และไม่ถือว่าการไม่มีตัวกรองเป็นข้อบกพร่อง
6. พื้นผิว (จ) รายการที่มีค้นหา/ตัวกรองอยู่จริง: ทดสอบกรณี **active filter miss** (มีข้อมูลแต่ตัวกรองไม่มีผลตรง) เทียบกับ **cleared/default filter empty** (ชุดข้อมูลว่างจริงโดยไม่มีตัวกรอง) และชุดมีข้อมูลที่กลับมาแสดงหลังล้างตัวกรอง ตรวจว่าข้อความสองกรณีแยกความหมายกันและการล้างตัวกรองทำงานจริง
7. เปิดเมนู «งานโฆษณาและงบ» และทางเข้าเดิมด้วย fixture เดิม เทียบกับที่จดไว้ก่อนรอบ

**ต้องเห็น:** พื้นผิวที่ได้รับผลแต่ละแห่งมีสถานะว่างตรงความจริงของตนเอง: ซ่อนประโยคสถานะว่างใต้ปุ่ม submit-all โดยปุ่มยังแสดง (0); คิวเว็บไซต์บอกว่าไม่มีอะไรรอเผยแพร่; ประวัติเผยแพร่บอกว่ายังไม่มีอะไรเผยแพร่; ภาพรวมบอกว่าไม่มีการเปลี่ยนแปลงหลังเผยแพร่ ไม่มีแถว/จำนวน/skeleton ปลอม และไม่มีข้อความเดียวถูกใช้ทับกันทุกพื้นผิว ส่วนรายการที่มีตัวกรองจริงแยก active filter miss ออกจาก default empty ชัดเจน งานโฆษณา/งบเดิมไม่เปลี่ยนทั้งเมนู เส้นทาง และข้อมูล และกรณีนี้ไม่เสนอการแก้โค้ดหรือการเพิ่มการทดสอบงานโฆษณา

**หลักฐาน:** `U56-result.md` (ผลต่อพื้นผิว (ก)–(ง) + กรณีตัวกรอง (จ) + ผลเทียบโฆษณาเดิม), `U56-1280-light.png`, `U56-1280-dark.png`, `U56-390-light.png`, `U56-390-dark.png`

**ผล:** ยังไม่ทดสอบ (NOT RUN)

### U57 — วันเวลา BUD แสดงเป็นปีพุทธศักราช เขตเวลา Asia/Bangkok และ HH:mm ไม่มีวินาที โดยคงความหมายเวลาเดิม (P1)

**ใช้:** MKT-A, ACCOUNT-MANAGER; F-BU/F-HISTORY

**เตรียม:** จุดเวลาจำลองตามตาราง §5 ของชุดหลัก (S0, S0+5 วัน, เส้น S0+7 วัน, M0, เหตุการณ์รอบเที่ยงคืนไทย) โดยผู้ดูแลจด `fake_now`/cutoff ไว้ในใบ fixture ก่อนเปิดหน้า ห้ามเทียบกับเวลาจริงของเครื่องและห้ามเพิ่มช่องส่งเวลาจากผู้ใช้

1. เปิดจุดแสดงวันเวลาของ BUD ทีละจุด: ป้ายแจ้งวันที่ 5/7, banner วันสิ้นสุดการส่งต่องาน, ประวัติการเปลี่ยนสิทธิ์ และหน้าที่แสดงเวลารับ snapshot เทียบค่าที่แสดงกับ `fake_now`/cutoff ที่จดไว้
2. ตรวจรูปแบบทุกจุดที่ผู้ใช้เห็น: **วันที่เป็นปีพุทธศักราช** เดือนไทย **เขตเวลา Asia/Bangkok** และ **เวลาเป็น HH:mm ไม่มีวินาที**
3. เดินนาฬิกาจำลองข้ามเที่ยงคืนไทยและช่วง 29/31 ตุลาคม–1 พฤศจิกายน 2026 ตรวจวันที่เปลี่ยนวันถูกต้อง และเส้น cutoff ที่แสดงตรงกับวันที่คำนวณจาก instant จริง
4. เปลี่ยนเขตเวลาของ session ใน browser fixture แล้วเปิดซ้ำ ตรวจว่าการคำนวณยังอิง instant เดิม ไม่ได้วันหรือเวลาเพิ่ม
5. ตรวจว่าไม่มีช่องให้ผู้ใช้ป้อน/เปลี่ยนเวลาเข้ามา และการจัดรูปแบบที่จอไม่เปลี่ยนค่า ความหมาย หรือการเปรียบเทียบเวลาที่ระบบใช้ (datetime semantics คงเดิม — จัดรูปแบบการแสดงผลเท่านั้น)

**ต้องเห็น:** ทุกจุดที่ผู้ใช้เห็นแสดงวันที่แบบพุทธศักราชในเขต Asia/Bangkok และเวลาแบบ HH:mm โดยไม่มีวินาที ตรงกับ `fake_now`/cutoff ที่จดไว้ เที่ยงคืนไทยเปลี่ยนวันถูกต้อง การเปลี่ยน session timezone ไม่ได้เวลาหรือวันเพิ่ม ไม่มีช่องส่งเวลาจากผู้ใช้ และค่า/ความหมายเวลาที่ระบบเก็บและใช้ยังเป็นเดิมทุกประการ

**หลักฐาน:** `U57-result.md` (`fake_now`/cutoff ที่เทียบ ต่อจุดเวลา), `U57-1280-light.png`, `U57-1280-dark.png`, `U57-390-light.png`, `U57-390-dark.png`, ภาพจุดเส้น S0+7 วันและจุดข้ามเที่ยงคืนไทย

**ผล:** ยังไม่ทดสอบ (NOT RUN)

### U58 — คำอธิบาย scope_future_members ใช้ซ้ำเป็นเนื้อความเดียวใน picker ทุก BUD checkbox อ้างด้วย aria-describedby และ preview ยังมีประโยคของตน (P1)

**ใช้:** ACCOUNT-MANAGER, ADMIN, MKT-A; F-BU

**เตรียม:** BUD อย่างน้อยสองรายการพร้อมโครงการปัจจุบันตามใบ fixture ข้อความต้นฉบับ `scope_future_members` จาก final implementation สำหรับเทียบทุกตัวอักษร และวิธีอ่าน accessibility tree ที่ผู้ดูแลตรวจแล้ว

1. เปิด picker เลือกขอบเขต ตรวจว่าคำอธิบายโครงการอนาคตใช้ **ข้อความเดิม scope_future_members ทุกตัวอักษร** และปรากฏ **เป็นเนื้อความเดียวภายใน picker** ไม่ถูกซ้ำเป็นข้อความแทรกรายแถวหรือรายช่อง
2. อ่าน accessibility tree ตรวจว่า **ทุก BUD checkbox** อ้างข้อความตัวเดียวกันผ่าน aria-describedby และไม่มีสำเนาคำอธิบายเพิ่มต่อ checkbox ใด
3. เปิด preview ก่อนยืนยัน ตรวจว่า **preview ยังมีประโยคของตนเอง** (ไม่ดึงคำอธิบายของ picker ไปซ้ำ) และรายชื่อโครงการปัจจุบันที่ได้รับหรือเสียสิทธิ์ตรงใบ fixture โดยไม่แต่งรายชื่อสมาชิกในอนาคต
4. ยกเลิกโดยไม่ยืนยันแล้วเปิด picker อีกครั้ง ตรวจว่ามีคำอธิบายเดิมหนึ่งครั้งและทุก BUD checkbox ยังอ้างถึงโหนดที่มีอยู่จริง โดยไม่ขึ้นกับว่ามีการย้ายสมาชิกที่ทราบล่วงหน้าหรือไม่
5. ทำซ้ำข้อ 1–3 ที่ 1280 และ 390 ทั้ง light/dark ตรวจข้อความไม่ถูกตัดขอบและการอ้างยังถูกต้อง

**ต้องเห็น:** ข้อความ scope_future_members ปรากฏเป็นเนื้อความเดียวใน picker ทุก BUD checkbox อ้างถึงโหนดเดียวกันผ่าน aria-describedby โดยไม่มีสำเนา และ preview คงประโยคอธิบายของตนเองแยกจาก picker พร้อมผลอ่าน accessibility tree แยกจากภาพหน้าจอ

**หลักฐาน:** `U58-result.md` (การเทียบข้อความกับต้นฉบับ + ตัดส่วน accessibility tree แบบไม่มีข้อมูลอ่อนไหว), `U58-1280-light.png`, `U58-1280-dark.png`, `U58-390-light.png`, `U58-390-dark.png`

**ผล:** ยังไม่ทดสอบ (NOT RUN)

### U59 — ชื่อแสดงครั้งเดียวต่อการ์ดทั้ง 1280 และ 390 โดยคงการเข้ารายการ และใช้ context จาก payload เดิมเท่านั้น (P1)

**ใช้:** ONLINE, NO-PUBLISH; F-PUBLISH

**เตรียม:** คิวที่มีรายการหลายการ์ดทั้งงานหน้าเว็บและชุดเผยแพร่ ทางเข้า `/publish` รวม `?tab=configuration` และทางเข้าจาก project/brand/promotion วิธีนับชื่อใน DOM ต่อการ์ดที่ผู้ดูแลตรวจแล้ว และวิธีเก็บผลคำขอแบบล้างข้อมูลอ่อนไหวเพื่อยืนยันว่าไม่มีการเรียก API เพิ่ม

1. เปิดคิวด้วย ONLINE แล้วนับชื่อภายใน **แต่ละการ์ด** ทั้งที่ 1280 และ 390: ต้องปรากฏ **ครั้งเดียวต่อการ์ด** ไม่มีสำเนาชื่อซ้ำภายในการ์ดเดียว
2. เข้ารายการจากการ์ดและกลับมาที่คิว ตรวจว่า **การเข้ารายการยังทำงานครบ** เปิด editor/รายละเอียดถูกต้องพร้อม context ครบ และหลังกลับมาชื่อยังครั้งเดียวต่อการ์ด
3. ตรวจว่าชื่อที่แสดงมาจาก **payload เดิมของรายการเท่านั้น** กรณีที่เคยแสดงสำเนาซ้ำ การแก้ต้องลบสำเนาออกโดยใช้ payload เดิม ไม่เพิ่ม field/endpoint ใหม่ — ยืนยันจากผลคำขอว่าไม่มีการเรียก API เพิ่มเพื่อแก้กรณีนี้ (no API change)
4. ทำซ้ำข้อ 1–2 ด้วย NO-PUBLISH และบัญชีขาด source V หนึ่งแท็บ ตรวจว่าสิทธิ์ไม่ทำให้ชื่อซ้ำ และไม่แสดง payload ของส่วนที่บัญชีเข้าไม่ได้
5. ทำซ้ำข้อ 1 หลังย้อนกลับ/เดินหน้าของ browser และจากทางเข้า project/brand/promotion ตรวจยังครั้งเดียวต่อการ์ดโดยไม่มี POST อัตโนมัติ

**ต้องเห็น:** ชื่อปรากฏครั้งเดียวต่อการ์ดทุกรายการ ทั้ง 1280 และ 390 การเข้ารายการจากการ์ดยังทำงานครบพร้อม context ชื่อที่แสดงมาจาก payload เดิมเท่านั้น และไม่มีการเปลี่ยน API เพื่อแก้กรณีนี้ บัญชีไม่มีสิทธิ์ไม่เห็นชื่อซ้ำหรือ payload ของส่วนที่ถูกปฏิเสธ

**หลักฐาน:** `U59-result.md` (ผลนับชื่อต่อการ์ดต่อความกว้าง + สรุปคำขอที่ตรวจว่าไม่มี API เพิ่ม), `U59-1280-light.png`, `U59-1280-dark.png`, `U59-390-light.png`, `U59-390-dark.png`

**ผล:** ยังไม่ทดสอบ (NOT RUN)

### U60 — ปุ่มเปิดผู้ช่วยลอยไม่ทับการ์ดสุดท้ายและตัวควบคุมสุดท้ายเมื่อเลื่อน document สุดหน้า ทุกความกว้าง/ธีม/สถานะ โดยสถานะปิดแบบย่อเป็นบรรทัดเดียวที่มองเห็นและถูกประกาศ (P1)

**ใช้:** MKT-A, AGENCY และ local H1 fixture; F-ENTITY

**เตรียม:** หน้าที่เนื้อหายาวพอเลื่อน document จนสุดล่าง วิธีตั้ง viewport ที่ตรวจแล้ว (1280 สูง 900; 390 สูง 844) ทั้งสองธีม โหมด local H1 ที่ปิดผู้ช่วย และวิธีวัด bounding box จริงของปุ่มลอยเทียบกับ **การ์ดสุดท้าย**, **องค์ประกอบสุดท้ายที่กดได้** และ **ข้อความบรรทัดสุดท้ายใน footer**

1. เมื่อผู้ช่วยเปิดใช้ได้ (stub) ที่ 1280 และ 390 ทั้ง light/dark: **เลื่อน document จนสุดล่าง** แล้ววัด bounding box ของปุ่มลอยเทียบกับ (ก) **การ์ดสุดท้าย**, (ข) **องค์ประกอบสุดท้ายที่กดได้** และ (ค) **ข้อความบรรทัดสุดท้ายใน footer** — ต้องไม่ทับซ้อนทั้งสามกรณี ตัวควบคุมสุดท้ายยังกดได้จริง และ footer อ่านได้ครบ
2. ทำซ้ำข้อ 1 ครบทุกชุดความกว้าง/ธีมเมื่อผู้ช่วยปิด (local H1): วัด bounding box ชุดเดิม และตรวจสถานะปิดแบบย่อของทางเข้าเป็น **บรรทัดเดียว (single line)** มองเห็นได้ชัด ไม่ถูกตัด และ **มีชื่อ/สถานะที่ถูกประกาศ** สำหรับผู้อ่านหน้าจอ (เช่น ระบุว่า «ผู้ช่วยยังไม่เปิดใช้งาน») กรณีนี้ไม่เรียกร้องข้อความใหม่เมื่อกดทางเข้าปิด
3. ตรวจพฤติกรรม Escape/focus ที่ระบบมีอยู่เดิม **ยังคงเดิม** โดยไม่เพิ่มข้อกำหนดใหม่
4. ระหว่างตรวจ เปิด drawer แบบ modal หนึ่งครั้งเพื่อยืนยันว่า **การทับเนื้อหาของ drawer/modal ที่เปิดอยู่เป็นพฤติกรรมปกติ** ไม่ถือเป็นความล้มเหลว การประเมินของกรณีนี้อยู่ที่ปุ่มลอยหลังเลื่อน document สุดหน้าเท่านั้น
5. ตรวจไม่มี horizontal page scroll ที่ 390 ทุกสถานะ และแนบผลการวัดกรอบกล่องทุกชุดแยกจากภาพหน้าจอ

**ต้องเห็น:** หลังเลื่อน document สุดหน้า ปุ่มเปิดผู้ช่วยลอยไม่ทับการ์ดสุดท้าย องค์ประกอบสุดท้ายที่กดได้ และข้อความบรรทัดสุดท้ายใน footer ครบทั้ง 1280/390, light/dark, เปิด/ปิด ทางเข้าสถานะปิดแบบย่อเป็นบรรทัดเดียว มองเห็นได้ และถูกประกาศแก่ผู้อ่านหน้าจอ โดยไม่ต้องมีข้อความใหม่เมื่อกด พฤติกรรม Escape/focus เดิมคงอยู่ drawer/modal ที่เปิดอยู่ทับเนื้อหาได้ตามปกติ และไม่มี horizontal scroll ที่ 390

**หลักฐาน:** `U60-result.md` (ผล bounding box ของการ์ดสุดท้าย/ตัวควบคุมสุดท้าย/ข้อความบรรทัดสุดท้ายใน footer ทุกชุด + วิธียืนยันการประกาศสถานะปิด), `U60-1280-light.png`, `U60-1280-dark.png`, `U60-390-light.png`, `U60-390-dark.png`, ภาพสถานะปิดแบบย่อบรรทัดเดียว

**ผล:** ยังไม่ทดสอบ (NOT RUN)

### U61 — ข้อผิดพลาดคำขอแจ้งเตือน BUD บนหน้า home/project แสดงบรรทัดสงบพร้อม retry โดยคง alert ของหน้าบัญชีและสิทธิ์ (P1)

**ใช้:** MKT-A, VIEWER, ACCOUNT-MANAGER, ADMIN; F-BU/F-ENTITY และ local H1 fixture ตามสิทธิ์เดิม

**เตรียม:** วิธีจำลองเฉพาะคำขอ BUD notice ล้มเหลวและกลับมาสำเร็จผ่าน harness local เดิม; หน้า `/home`, หน้าโครงการที่แสดง BUD notice และหน้าบัญชี/สิทธิ์ที่บัญชีนั้นเข้าได้ พร้อมผลคำขอและ accessibility tree แบบล้างข้อมูลอ่อนไหว ข้อความใช้ `load_error` และ `retry` เดิมตาม docs/47 §7.1 และ §8.5 ไม่เพิ่ม UI label

1. ทำให้คำขอ BUD notice ล้มเหลวบน `/home` โดยข้อมูลหลักของหน้ายังโหลดได้ ตรวจข้อความล้มเหลวเพียงครั้งเดียวต่อหน้าใน `role=status` ที่ประกาศอย่างไม่เร่งด่วน ไม่มี `role=alert` หรือ error styling สำหรับข้อผิดพลาด BUD นี้ และมี retry control หนึ่งตัว
2. กด retry โดยผู้ใช้ครั้งเดียว ตรวจว่ามีคำขอ BUD notice ใหม่หนึ่งครั้ง ข้อมูลหลักยังอยู่ เมื่อคำขอกลับมาสำเร็จบรรทัดล้มเหลวหายและแสดงข้อมูลแจ้งเตือนตามผลจริง ไม่แสดง diagnostic ภายใน
3. ทำซ้ำข้อ 1–2 บนหน้าโครงการ รวมแท็บที่ใช้ BUD notice เดียวกัน ตรวจไม่เกิดข้อความซ้ำต่อแท็บหรือหน้า และ context โครงการยังถูกต้อง
4. จำลองข้อผิดพลาดเดียวกันในหน้าบัญชี/สิทธิ์ที่ได้รับอนุญาต ตรวจว่าการแจ้งข้อผิดพลาดแบบ assertive (`role=alert`) และ retry เดิมยังอยู่ ไม่ถูกเปลี่ยนเป็นบรรทัดสงบตามหน้าเนื้อหา
5. ทำซ้ำหน้าเนื้อหากับ caller ที่มีและไม่มี BUD-scoped grant ซึ่งเข้าหน้านั้นได้อยู่แล้ว ตรวจว่าไม่เพิ่มเงื่อนไขกลุ่มผู้เห็นจาก P1 และไม่เพิ่ม projection field, endpoint, API contract หรือสิทธิ์เพื่อทดสอบกรณีนี้ การจำกัดผู้เห็นเฉพาะ BUD-scoped grant เป็น backlog ตาม docs/47 §7.1 และไม่ใช่เกณฑ์รับงานครั้งนี้
6. ตรวจที่ 1280 และ 390 ทั้ง light/dark ว่าข้อความและ retry อ่านได้/ใช้ได้ตามเดิม พร้อมผลอ่าน role และการประกาศจาก accessibility tree; แยกข้อผิดพลาดของข้อมูลหลักออกจากข้อผิดพลาด BUD นี้

**ต้องเห็น:** หน้า home/project มีบรรทัด BUD request failure แบบไม่เร่งด่วนหนึ่งครั้งต่อหน้า ใช้ `role=status`, ข้อความเดิม, retry หนึ่งตัว และไม่มี error styling; หน้าบัญชี/สิทธิ์คง alert เดิม ไม่เปลี่ยน audience, permissions หรือ API contract และไม่ทำ BUD-grant targeting ที่ยังเป็น backlog

**หลักฐาน:** `U61-result.md` (method/path/status ก่อน–หลัง retry, จำนวนข้อความต่อหน้า, accessibility tree ของ home/project และ Accounts/permission, การเทียบ caller ทั้งสองกลุ่ม), `U61-1280-light.png`, `U61-1280-dark.png`, `U61-390-light.png`, `U61-390-dark.png`

**ผล:** ยังไม่ทดสอบ (NOT RUN)

### ตารางผลภาคผนวก (คงรูปแบบตาราง §8 ของชุดหลัก)

| กรณี | ผล | หลักฐานภายใต้ run-id | ข้อพบ / ผู้ทดสอบ / เวลา |
| --- | --- | --- | --- |
| U55 | ยังไม่ทดสอบ (NOT RUN) | `U55-*` | — |
| U56 | ยังไม่ทดสอบ (NOT RUN) | `U56-*` | — |
| U57 | ยังไม่ทดสอบ (NOT RUN) | `U57-*` | — |
| U58 | ยังไม่ทดสอบ (NOT RUN) | `U58-*` | — |
| U59 | ยังไม่ทดสอบ (NOT RUN) | `U59-*` | — |
| U60 | ยังไม่ทดสอบ (NOT RUN) | `U60-*` | — |
| U61 | ยังไม่ทดสอบ (NOT RUN) | `U61-*` | — |


## 13. ทะเบียนการกระทบยอดงานเตรียม — ไม่ใช่ผล UAT

> Historical preparation snapshot from 13 November. Its NOT RUN statements
> describe the earlier artifacts, not the Monday runtime rehearsal. Current
> preparation results and remaining fixture gaps are in docs/50 and the receipt
> below. Owner UAT remains NOT RUN. The current full-gate timing is docs/11's
> owner-approved fast lane: after UAT fixes, before Wednesday rollout.


อ่าน pack/evidence matrix วันที่ 13 พฤศจิกายน 2026 พร้อม README, controls และ receipt
ของ supervisor ทั้งสามฉบับ ตรวจไฟล์ที่ receipt ระบุครบโดยไม่ execute module/command
สถานะทั้งสามยัง runtime NOT RUN และ uat_cases_executed = 0; actual accounts/fixtures
ยังต้องพิสูจน์ การมี adapter ไม่ได้เติมผลกรณีใด

| แหล่ง | ตำแหน่งที่อ่าน | สถานะ |
| --- | --- | --- |
| Pack ตั้งต้น | main working tree: artifacts/unified-workspace/w8/prepared-docs49-with-p1-u61.md | 61 case requirements; ยังไม่รับงาน |
| Evidence matrix | main working tree: artifacts/unified-workspace/w8/w8-61-case-evidence-matrix-20261113.json | 61 NOT_RUN; supporting specs ไม่ใช่ clause-complete pass |
| v1 | main working tree: artifacts/unified-workspace/w8/retained-supervisor/artifact-receipt.json | PREPARED_RUNTIME_NOT_RUN |
| writing-v2 | main working tree: artifacts/unified-workspace/w8/retained-supervisor-writing-v2/artifact-receipt.json | PROPOSED_V2_RUNTIME_NOT_RUN |
| publication-v3 | D:/Personal/workspace/sena_hub_wt/p1-final-review/artifacts/worker-preparation/w8-retained-supervisor-publication-v3/artifact-receipt.json | PROPOSED_V3_RUNTIME_NOT_RUN; worker artifact ไม่ใช่การอ้างว่ารวม main แล้ว |

Exact hashes/static preservation checks อยู่ใน `w8-revised-pack-receipt-20261113.json`;
diff อยู่ใน `w8-revised-pack-20261113.diff` งานนี้ไม่เปลี่ยน main/product, ไม่เปิด ports/
services, ไม่รัน tests, ไม่อ่าน credentials, ไม่แตะ hosted และไม่มี staging/commit

### 13.1 งานเทคนิคที่ผู้ดูแลยังทำต่อได้

- กระทบยอด final delivered source/build/full gates และ source manifests ของ supervisor;
  ไม่เติม final commit/gate date/ผล suite จาก snapshot เก่า
- เตรียม mapping ครบ 61 กรณีด้วย ordinary workflows; ตรวจ runtime IDs/revisions/hashes,
  V/E/A/special/object/BUD scope จริง ไม่เดาจาก persona และไม่ขยายสิทธิ์เพื่อให้ผ่าน
- ซ้อม lifecycle/clock/OTP/restore/cleanup ภายใต้ lease เดียว; v1 clock ไม่แทน BU seed,
  move/invitation หรือ in-flight pause/revoke/resume adapter
- เติม writing scenarios ที่ v2 ไม่ครอบคลุม และ publication lifecycle/contributor/stale/
  independent-neighbour/withdrawal/rollback ที่ v3 ยังไม่ได้ทำ รวม Promotions DATA/LEGAL
- กระทบยอด W3.1/W3.2 prerequisites และ W9 resource/admission/concurrency/privacy/
  historical identity/context-category boundaries/storage measurements กับ final source
- จัดทำ screenshots/role/time/keyboard/readability observations; แยก mock UI จาก real
  API/DB proofs และสร้างผล Uxx หลังทำกรณีจริงเท่านั้น

### 13.2 เรื่องที่เป็นการตัดสินใจของเจ้าของ

- คำตอบที่ยังค้างใน Q77–Q82: BU read-only/hosted enablement, vector logo/สี,
  shared approval, บัญชี Online ที่ได้ special, งบจริงต่อเดือน และ business เพิ่มเติม
  ผู้ดูแลจับคู่ข้อความ/สถานะล่าสุดใน catalogue ได้เอง แต่ไม่ปิดคำถามแทนเจ้าของ
- การรับงานจริงพร้อมข้อพบและวันเวลา หลังเจ้าของทำ walkthrough; technical rehearsal
  หรือรายงานภาพของผู้ดูแลไม่ใช่ owner acceptance
- hosted/feed/บัญชีจริง/งบจริงหรือบริการภายนอกที่ต้องอนุญาตแยก; local UAT ไม่ให้สิทธิ์
  เหล่านี้ และไม่สร้าง permission gate ใหม่กั้นงานเตรียมทางเทคนิคที่อนุญาตแล้ว

รายละเอียด factual placeholders อยู่ใน `w8-unresolved-placeholders-20261113.md`;
ช่อง §1/§9/§9.1 คง pending **ผ่าน 0, ไม่ผ่าน 0, ทำต่อไม่ได้ 0, NOT RUN 61;
owner acceptance pending.** Setup gaps ไม่เปลี่ยน case status เป็น BLOCKED โดยอัตโนมัติ


## 14. Monday source and open risks — 20 November 2026

W9.1 product 8f7e052; receipt 3d691fa. Home 0094 is an interim improvement;
delivered as ab7a7bf, verified on origin/main. The below-five-second
300-project target is open after UAT, not a gate for this walkthrough.
Final combined full gate remains due before Wednesday rollout.

W9.1 input limits supersede the old generic 100 MP statement in FW9-IMAGE:
JPEG 100 MP, PNG/WebP 24 MP, HDR PNG rejected; FW9-PDF is 50 MiB/200 pages,
24 MP weighted per image plus masks, 240 MP unique aggregate. FW9-UI includes
single-job admission and the bounded 60-second retry in both upload clients.
Private/legal handling, stored identity, existing permissions and historical
assets remain covered by U49/U53. Boundary header-only fixtures are rejection
proofs, not visual or successful processing examples.

The noisy 50 MiB PDF Linux result is 930.51 MiB (9.13% below the 1024 MiB
reference), not hosted capacity acceptance. Rare 16-bit interlaced PNG retains
the accepted headroom risk. Local timings do not prove VPS deadlines.
The revised retained runtime uses the reviewed v6 correction and final pins;
its rehearsal status is recorded separately. All 61 acceptance rows remain NOT RUN.

Prepared runtime source: `ab7a7bf3e80b9c4ae15f7c20906c688bc528f132`.
Preparation evidence: `artifacts/unified-workspace/w8/monday-20261123/preparation-receipt.json`.
All 61 owner results remain NOT RUN.
