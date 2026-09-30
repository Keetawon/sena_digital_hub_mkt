import { f, options, type Field } from "./finance-form";

export const costTypes = { MEDIA: "สื่อโฆษณา", AGENCY_FEE: "ค่าบริการเอเจนซี", CHANNEL: "ช่องทางสื่อสาร", TOOL: "เครื่องมือ", BANK_FEE: "ค่าธรรมเนียมธนาคาร" };
export const paymentMethods = { CORPORATE_CARD: "บัตรบริษัท", AGENCY_PO_INVOICE: "ใบแจ้งหนี้เอเจนซีตาม PO", PLATFORM_INVOICE: "ใบแจ้งหนี้แพลตฟอร์ม", BANK_TRANSFER: "โอนผ่านธนาคาร" };
export const statuses: Record<string, string> = { CURRENT: "ตรวจตรงรุ่นปัจจุบัน", DRAFT: "ร่าง", ACTIVE: "ใช้งาน", SUSPENDED: "ระงับเพื่อทบทวน", CLOSED: "สิ้นสุด", APPROVED: "อนุมัติแล้วจากต้นทาง", CONFIRMED: "ยืนยันข้อมูลแล้ว", UNKNOWN: "ยังไม่ทราบ", IN_REVIEW: "กำลังพิจารณาจากต้นทาง", REJECTED: "ไม่อนุมัติ", CANCELLED: "ยกเลิก", PROPOSED: "รอผู้ดูแลตรวจสอบ", APPLIED: "นำเข้าแล้ว", APPLIED_DRAFT: "นำเข้าแล้ว รอตรวจข้อมูล", QUARANTINED: "แยกไว้ตรวจสอบ", SUPERSEDED: "แทนที่แล้ว", RETIRED: "เลิกใช้", ENDED: "สิ้นสุดการเชื่อม", REVIEW_REQUIRED: "ต้องตรวจสอบอีกครั้ง", RESOLVED: "ตรวจสอบแล้ว", UNRESOLVED: "ยังไม่ระบุ", COMPLETE: "ครบถ้วน", INCOMPLETE: "ยังไม่ครบ", PENDING: "รอตรวจสอบ", DEBIT: "เรียกเก็บ", CREDIT: "คืนเงิน", MONTHLY: "รายเดือน", ANNUAL: "รายปี", MANUAL: "บันทึกโดยทีมงาน", LEDGER: "นำเข้ารายการงบ", LINE_OA: "LINE OA", GROUP: "กลุ่มโครงการ", ZONE_POOL: "กองกลางหลายโครงการ", BRAND_POOL: "กองกลางแบรนด์", CORP_PROGRAM: "โปรแกรมองค์กร", BU_PROGRAM: "โปรแกรมหน่วยธุรกิจ", PHASE: "เฟส", POOL: "กองกลาง", PROGRAM: "โปรแกรม", CANONICAL: "เลขหลัก", ALIAS: "เลขอ้างอิงอื่น" };
export const reason = f("reason", "เหตุผล", { type: "textarea", required: true });
export const evidence = f("evidence_ref", "อ้างอิงหลักฐาน", { required: true, hint: "เลขเอกสารหรือลิงก์ที่ไม่มีรหัสลับ ระบบไม่เปิดหรือดึงเอกสารให้อัตโนมัติ" });
export const scope = f("scope_id", "ขอบเขต", { choices: "scopes", required: true });
export const bud = f("bud", "BUD", { choices: "buds", required: true });
export const agency = f("agency", "เอเจนซี", { choices: "agencies", required: true });
export const costType = f("cost_type", "ประเภทค่าใช้จ่าย", { options: options(costTypes), required: true });
export const paymentMethod = f("payment_method", "วิธีชำระ", { options: options(paymentMethods), required: true });
export const memoFields: Field[] = [
  f("memo_no", "เลข Memo หลัก", { required: true, hint: "เช่น MO2609001 หรือ M.COM001_69 · เก็บเลขและตัวคั่นตามจริง" }),
  f("subject", "เรื่อง", { required: true }), f("requesting_bud", "BUD ผู้ขอ", { choices: "buds", required: true }),
  f("gross_amount", "วงเงินรวม", { type: "money", required: true }), f("media_amount", "วงเงินสื่อโฆษณา", { type: "money" }), f("fee_amount", "วงเงินค่าบริการรวมภาษี", { type: "money" }),
  f("cost_breakdown", "วงเงินแยกประเภท", { type: "rows", fields: [costType, f("amount", "วงเงิน", { type: "money", required: true })], hint: "ใช้เมื่อ Memo ครอบคลุมช่องทาง เครื่องมือ หรือค่าธรรมเนียม ผลรวมต้องเท่ากับวงเงินรวม" }),
  f("mirrored_status", "สถานะจาก E-memo", { required: true, initial: "UNKNOWN", options: options({ UNKNOWN: "ยังไม่ทราบ", IN_REVIEW: "อยู่ระหว่างพิจารณา", APPROVED: "อนุมัติแล้วจาก E-memo", REJECTED: "ไม่อนุมัติ", CANCELLED: "ยกเลิก" }) }),
  f("approval_date", "วันที่อนุมัติจากต้นทาง", { type: "date" }), { ...evidence, required: false },
  f("approvers", "ผู้ตัดสินใจจากต้นทาง", { type: "rows", fields: [f("name", "ชื่อผู้ตัดสินใจ", { required: true }), f("role_label", "ตำแหน่งหรือบทบาท", { required: true }), f("decision", "ผลการตัดสินใจ", { required: true, options: options({ APPROVED: "อนุมัติ", REJECTED: "ไม่อนุมัติ", IN_REVIEW: "กำลังพิจารณา" }) }), f("decision_at", "เวลาตัดสินใจ", { required: true, type: "datetime-local" })], hint: "บันทึกเฉพาะข้อมูลที่มีหลักฐาน ไม่สมมติชื่อหรือเวลา" }),
];
export const componentFields: Field[] = [
  f("component_kind", "ประเภทรายการย่อย", { options: options({ PHASE: "เฟส", POOL: "กองกลาง", PROGRAM: "โปรแกรม" }), required: true }),
  f("rem_project_id", "รหัสโครงการ REM", { required: true, show: value => value.component_kind === "PHASE", hint: "เก็บเป็นข้อความ รวมเลขศูนย์นำหน้า" }),
  f("formatted_mapping", "รหัสกลุ่มโครงการ", { required: true, show: value => value.component_kind === "PHASE" }), bud,
  f("gross_amount", "งบรวมรายการย่อย", { type: "money", required: true }), f("media_amount", "งบสื่อโฆษณา", { type: "money" }), f("fee_amount", "งบค่าบริการรวมภาษี", { type: "money" }),
  f("memo_id", "Memo ที่เชื่อม", { choices: "memos" }), f("observed_memo_no", "เลข Memo ตามต้นทาง"), f("fee_po_ref", "เลข PO ค่าบริการ (อ้างอิง)"),
  f("budget_items", "รายการแยกประเภทค่าใช้จ่าย", { type: "rows", fields: [costType, paymentMethod, f("amount", "จำนวนเงิน", { type: "money", required: true })], hint: "ยังไม่ทราบการแบ่งประเภทให้เว้นไว้ ไม่สมมติว่างบรวมเป็นค่าสื่อทั้งหมด" }),
];
export const revisionFields: Field[] = [
  f("components", "รายการงบย่อย", { type: "rows", fields: componentFields }),
  f("permitted_scope_ids", "ขอบเขตที่โปรแกรมรองรับ", { type: "multi", choices: "scopes" }),
  f("permitted_agencies", "เอเจนซีที่โปรแกรมรองรับ", { type: "multi", choices: "agencies" }),
  f("mapping_verified", "ตรวจสอบขอบเขตและ BUD ของโปรแกรมตามหลักฐานแล้ว", { type: "boolean" }), reason,
];
const program = (value: Record<string, unknown>) => value.kind === "CORP_PROGRAM" || value.kind === "BU_PROGRAM";
export const lineFields: Field[] = [
  f("kind", "ประเภทรายการงบ", { required: true, initial: "GROUP", options: options({ GROUP: "กลุ่มโครงการรายเดือน", ZONE_POOL: "กองกลางหลายโครงการ", BRAND_POOL: "กองกลางแบรนด์", CORP_PROGRAM: "โปรแกรมองค์กร", BU_PROGRAM: "โปรแกรมหน่วยธุรกิจ" }) }),
  { ...scope, show: value => value.kind !== "CORP_PROGRAM" }, f("month", "เดือนงบประมาณ", { type: "month", required: true, show: value => !program(value) }), { ...agency, show: value => !program(value) },
  f("program_ref", "รหัสโปรแกรม", { required: true, show: program }), f("period_start_month", "เดือนเริ่มโปรแกรม", { type: "month", required: true, show: program }), f("period_end_month", "เดือนสิ้นสุดโปรแกรม", { type: "month", required: true, show: program }), ...revisionFields,
];
export const mappingFields: Field[] = [scope, f("valid_from", "มีผลตั้งแต่", { type: "date", required: true }), f("valid_to", "สิ้นสุดก่อนวันที่", { type: "date", hint: "ไม่รวมวันนี้ เว้นว่างได้เมื่อยังไม่มีกำหนดสิ้นสุด" }), evidence];
export const adMappingFields: Field[] = [...mappingFields, agency, { ...bud, required: false, hint: "เลือก BUD เดียว หรือระบุสัดส่วนด้านล่างอย่างใดอย่างหนึ่ง" }, f("bud_splits", "สัดส่วน BUD", { type: "rows", fields: [bud, f("weight_bps", "สัดส่วน (%)", { type: "percent", required: true, hint: "เช่น 25.00% ผลรวมทุกรายการต้องเท่ากับ 100%" })] })];
export const channelMappingFields: Field[] = [...mappingFields, bud, f("plan", "แผนบริการ", { required: true }), f("expected_amount", "ยอดคาดหมายต่อการเรียกเก็บ", { type: "money", required: true })];
export const adFields: Field[] = [f("platform", "แพลตฟอร์ม", { required: true, options: options({ GOOGLE: "Google Ads", META: "Meta Ads", TIKTOK: "TikTok Ads", CHATGPT: "ChatGPT" }) }), f("account_id", "รหัสบัญชีโฆษณา", { required: true, hint: "รหัสจากแพลตฟอร์ม เก็บเลขศูนย์นำหน้าตามต้นทาง" }), f("label", "ชื่อแสดงบัญชี"), f("mapping", "ข้อมูลการใช้งานบัญชี", { type: "object", fields: adMappingFields })];
export const channelFields: Field[] = [f("account_id", "รหัส LINE OA ที่ตรวจสอบแล้ว"), f("label", "ชื่อแสดงบัญชี", { required: true }), f("steward_ref", "รหัสอ้างอิงผู้ดูแล (เมื่อยังไม่ทราบรหัสจริง)"), f("mapping", "ข้อมูลช่องทาง", { type: "object", fields: channelMappingFields })];
export const correctionFields: Field[] = [f("observed_code", "รหัสที่พบในต้นทาง", { required: true }), agency, f("month_from", "ตั้งแต่เดือน", { type: "month", required: true }), f("month_to", "ถึงเดือน", { type: "month", required: true }), reason, evidence, f("targets", "เป้าหมายรายเดือน", { type: "rows", fields: [f("month", "เดือนที่แก้ไข", { type: "month", required: true }), f("line_id", "รายการงบที่ถูกต้อง", { choices: "lines", required: true })] })];
export const ackFields: Field[] = [f("acknowledgements", "คำชี้แจงผลต่าง Memo", { type: "rows", fields: [f("memo_id", "Memo ที่มีผลต่าง", { required: true, choices: "memos" }), reason], hint: "ผลต่างยังเป็นข้อสังเกต การบันทึกคำชี้แจงไม่ได้อนุมัติให้ใช้เงินเกินวงเงิน" })];
