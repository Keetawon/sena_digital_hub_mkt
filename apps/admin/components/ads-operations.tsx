"use client";
import { ActorName } from "./accounts";

import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./hub-request";
import { object, records, str, type RecordData as Row } from "./finance-form";
import { display } from "./finance-display";
import { costTypes, paymentMethods } from "./finance-fields";
import { PendingQuestion } from "./pending-question";
import { LoadingRows, RegistryRowSummary, DetailDialog, StatusText } from "./registry-motion";
import "./ads-registry.css";
import "./ads-operations.css";

export const operationTitles = { actuals: "ผลใช้จ่ายรายเดือน", documents: "ติดตามเอกสาร", exceptions: "รายการที่ต้องตรวจสอบ" };
export type OperationScreen = keyof typeof operationTitles;
const paths = { actuals: "actuals", documents: "document-tracking", exceptions: "findings" };
const api = "v1/admin/ads";
const methods: Record<string, string> = { CODE: "รหัส SN และชื่อที่ออกให้ตรงกัน", HUB_NATIVE_ID: "รหัสแพลตฟอร์มที่ผูกใน Hub", BOUND_NATIVE: "รหัสแพลตฟอร์มที่ผูกใน Hub", SCOPE_MONTH_AGENCY: "ขอบเขต เดือน และเอเจนซี", APPLIED_CORRECTION: "รายการแก้ไขที่นำไปใช้แล้ว", UNRESOLVED: "ยังเชื่อมไม่ได้" };
const states: Record<string, string> = { OPEN: "ยังไม่รับเรื่อง", ACKNOWLEDGED: "รับเรื่องแล้ว", RESOLVED: "ดำเนินการแล้ว รอตรวจผลจากคลังข้อมูล", MISSING: "ยังไม่มีเอกสารอ้างอิง", REFERENCE_RECORDED: "บันทึกเลขอ้างอิงแล้ว", VERIFIED: "ตรวจสอบแล้ว", NOT_REQUIRED: "ไม่ต้องใช้เอกสาร" };
const documentTypes: Record<string, string> = { M: "Memo หรือวงเงินผูกพัน", S: "ใบแจ้งยอดที่กระทบยอดแล้ว", V: "ใบแจ้งหนี้หรือใบเสร็จผู้ให้บริการ", P: "PO และใบแจ้งหนี้ที่เกี่ยวข้อง", T: "หลักฐานโอน", A: "บัญชี ขอบเขต และ BUD", C: "แผนบริการและช่วงครอบคลุม", F: "รายละเอียดค่าธรรมเนียม" };
const rules: Record<string, string> = { ASSIGNMENT_SCOPE_CONFLICT: "การเชื่อมรายการงบไม่ตรงกับขอบเขต", BOUND_IDENTITY_CONFLICT: "รหัสหรือชื่อขัดแย้งกับ ID ที่ยืนยันแล้ว", CORRECTION_CONFLICT: "รายการแก้ไขรหัสมีความขัดแย้ง", LEDGER_CODE_EVIDENCE_UNAVAILABLE: "ยังไม่มีหลักฐานรหัสจากรายการงบ", NO_APPLICABLE_LINE: "ยังไม่มีรายการงบที่ใช้ได้", REGISTRY_CONTEXT_CONFLICT: "ข้อมูลไม่สอดคล้องกับทะเบียนแคมเปญ", UNISSUED_OR_INVALID_SENA_H_NAME: "ชื่อไม่ตรงกับชื่อที่ออกให้หรือไม่ผ่านรูปแบบ" };
const documentReasons: Record<string, string> = { MATRIX_UNAVAILABLE: "ยังระบุชุดเอกสารไม่ได้", PO_AND_INVOICE_PAIR_UNAVAILABLE: "เลข PO ค่าบริการเพียงอย่างเดียวไม่ใช่หลักฐานว่ามีใบแจ้งหนี้ครบคู่", VERIFICATION_NOT_AUTHORIZED: "บันทึกเลขอ้างอิงได้ แต่ยังไม่มีอำนาจตรวจสอบเอกสารตามกติกาที่ยืนยันแล้ว" };
const reasons: Record<string, string> = { TYPED_BUDGET_INCOMPLETE: "ยังแยกประเภทค่าใช้จ่ายในงบไม่ครบ", PERIOD_BUDGET_NOT_PHASED: "งบทั้งช่วงเวลายังไม่ได้แบ่งรายเดือน", PERIOD_BUDGET: "งบทั้งช่วงเวลา ไม่ใช่งบรายเดือน", NO_LEADS: "ยังไม่มีผู้สนใจ", LEAD_COVERAGE_UNKNOWN: "ข้อมูลผู้สนใจยังไม่ครบ", PLATFORM_COVERAGE_UNKNOWN: "ข้อมูลใช้จ่ายจากแพลตฟอร์มยังไม่ครบ", PERIOD_BUDGET_UNPHASED: "งบทั้งช่วงเวลายังไม่ได้แบ่งรายเดือน", LEADS_INCOMPLETE: "ข้อมูลผู้สนใจยังไม่ครบ", LEAD_COVERAGE_INCOMPLETE: "ข้อมูลผู้สนใจยังไม่ครบ", ZERO_MEDIA_BUDGET: "งบสื่อที่เปรียบเทียบได้เป็นศูนย์", ASSIGNMENT_UNUSABLE: "การเชื่อมรายการงบยังใช้ไม่ได้", HUB_CONTEXT_UNAVAILABLE: "หลักฐานจาก Hub ยังไม่ครบ", NO_APPROVED_ASSIGNMENT: "ยังไม่มีการเชื่อมรายการงบที่ยืนยันแล้ว", NAME_MISMATCH: "ชื่อที่พบไม่ตรงกับชื่อที่ออกให้", EVIDENCE_UNAVAILABLE: "ยังไม่มีหลักฐานสำหรับตรวจสอบ" };
const filterKeys = ["month", "agency", "scope", "bud", "owner", "status", "overdue", "control_code", "state", "condition", "offset"];
type Collection = { items: Row[]; total: number; meta: Row };
const errorText = (error: unknown) => error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง";
const money = (value: unknown) => value == null ? "—" : display(value, "amount");
const date = (value: unknown) => value == null ? "ยังไม่มีข้อมูลเวลา" : display(value, "source_at");
const month = (value: unknown) => value == null ? "ยังไม่ระบุเดือน" : `${display(value)} (${str(value).slice(0, 7)})`;
const method = (value: unknown) => methods[str(value)] ?? `วิธีเชื่อม ${str(value) || "ยังไม่ระบุ"}`;
const reason = (value: unknown) => reasons[str(value)] ?? `ข้อมูลยังไม่พร้อมเปรียบเทียบ (${str(value) || "ยังไม่มีเหตุผลจากต้นทาง"})`;
const owner = (value: unknown) => ({ online_staff: "ทีมออนไลน์", admin: "ผู้ดูแลระบบ" })[str(value)] ?? "ยังไม่ระบุ";
const costType = (value: unknown) => costTypes[str(value) as keyof typeof costTypes] ?? "ยังไม่ระบุประเภทค่าใช้จ่าย";
const lineTitle = (row: Row) => str(row.scope_code ?? row.program_ref ?? row.line_key ?? row.line_id) || "ยังไม่ระบุรายการงบ";
function condition(row: Row) { return row.condition_present === true ? "ยังพบเงื่อนไข" : row.condition_present === false ? "ไม่พบเงื่อนไขในรอบนี้" : "ยังประเมินไม่ได้"; }
function Facts({ values }: { values: [string, React.ReactNode][] }) { return <dl className="registry-detail-list operations-facts">{values.map(([label, value]) => <div className="contents" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }
const isLocalDemo = (row: Row) => row.source_kind === "LOCAL_SYNTHETIC_DEMO" || object(row.observed).source_kind === "LOCAL_SYNTHETIC_DEMO" || object(row.temporal_provenance).source_kind === "LOCAL_SYNTHETIC_DEMO" || (Array.isArray(row.quality_codes) && row.quality_codes.includes("LOCAL_SYNTHETIC_DEMO"));
function DemoSource({ row }: { row: Row }) { return isLocalDemo(row) ? <p className="operations-caption">ข้อมูลตัวอย่างที่สร้างใน Hub</p> : null; }
function Quality({ codes }: { codes: unknown }) { const values = Array.isArray(codes) ? codes.filter(code => code !== "LOCAL_SYNTHETIC_DEMO") : []; return values.length ? <ul className="operations-quality">{values.map((code, index) => <li key={index}>{reason(code)}</li>)}</ul> : null; }

function Snapshot({ meta }: { meta: Row }) {
  const watermarks = object(meta.source_watermarks);
  const sources: [string, unknown][] = [["ข้อมูล Hub", watermarks.hub_source_snapshot_at], ["ข้อมูลแพลตฟอร์ม", watermarks.platform_source_snapshot_at], ["ข้อมูลผู้สนใจจาก REM", watermarks.rem_source_snapshot_at]];
  const outdated = sources.some(([, value]) => typeof value === "string" && Date.now() - Date.parse(value) > 36 * 60 * 60 * 1000);
  return <aside className="registry-banner operations-snapshot" aria-label="สถานะข้อมูลจากคลังข้อมูล"><strong>{meta.synthetic_only ? "ข้อมูลตัวอย่าง · TEST" : "ข้อมูลจากคลังข้อมูล"}</strong>
    {meta.synthetic_only === true && <p>เดือนและเวลาของข้อมูลตัวอย่างใช้สำหรับสาธิตเท่านั้น ไม่ใช้ยืนยันความสดของข้อมูลจริง รายการที่สร้างใน Hub จะระบุแยกจากชุดทดสอบเดิมของคลังข้อมูล</p>}
    {meta.context_changed === true && <p>รายการงบใน Hub เปลี่ยนหลังรอบข้อมูลนี้ แสดงตัวเลขตามรอบเดิมและรอนำเข้ารอบใหม่ก่อนเปรียบเทียบกับรายการที่แก้ไข</p>}
    {meta.status === "NOT_IMPORTED" ? <p>ยังไม่มีข้อมูลจากคลังข้อมูล</p> : <>
      <p>{outdated ? "ข้อมูลยังไม่อัปเดตตามเกณฑ์สาธิต 36 ชั่วโมง แสดงข้อมูลรอบล่าสุดที่นำเข้าสำเร็จ" : meta.synthetic_only ? "ยังไม่ประเมินความสดของข้อมูลจริง" : "ตรวจสอบเวลาต้นทางก่อนใช้ข้อมูล"}</p>
      <details><summary>ดูเวลาต้นทางและรอบข้อมูล</summary><Facts values={[["รอบข้อมูล", str(meta.snapshot_id) || "ยังไม่มีข้อมูล"], ["สร้างรอบข้อมูลเมื่อ", date(meta.snapshot_at)], ["Hub รับข้อมูลเมื่อ", date(meta.received_at)], ...sources.map(([label, value]) => [label, date(value)] as [string, string])]} /></details>
    </>}
  </aside>;
}

export function AdsOperations({ screen }: { screen: OperationScreen }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState("");
  const [ready, setReady] = useState(false); const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<Collection>({ items: [], total: 0, meta: {} });
  const [detail, setDetail] = useState<Row | null>(null); const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false); const dirtyRef = useRef(false); dirtyRef.current = dirty;
  const restore = useRef(false); const openedHere = useRef(false);
  const loadedSelection = useRef("");
  const selectionKey = screen === "actuals" ? "line" : screen === "documents" ? "requirement" : "finding";
  const readUrl = useCallback(() => {
    const url = new URL(window.location.href); const query = url.searchParams;
    if (screen === "actuals" && !query.has("month")) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).formatToParts(new Date());
      query.set("month", `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}-01`);
      window.history.replaceState({}, "", url);
    }
    setSelected(query.get(selectionKey) ?? ""); const next = Object.fromEntries(filterKeys.map(key => [key, query.get(key) ?? ""])); setFilters(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); setReady(true);
  }, [screen, selectionKey]);
  useEffect(() => { readUrl(); const pop = () => { if (restore.current) { restore.current = false; return; } if (dirtyRef.current && !window.confirm("มีหมายเหตุที่ยังไม่ได้บันทึก ต้องการละทิ้งข้อมูลหรือไม่")) { restore.current = true; window.history.forward(); return; } setDirty(false); readUrl(); }; window.addEventListener("popstate", pop); return () => window.removeEventListener("popstate", pop); }, [readUrl]);
  useEffect(() => { if (!dirty) return; const leave = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave); }, [dirty]);
  function navigate(updates: Record<string, string>, replace = false) { const url = new URL(window.location.href); Object.entries(updates).forEach(([key, value]) => value || (screen === "actuals" && key === "month") ? url.searchParams.set(key, value) : url.searchParams.delete(key)); window.history[replace ? "replaceState" : "pushState"]({}, "", url); readUrl(); }
  function open(row: Row) { const key = str(screen === "actuals" ? row.line_key : screen === "documents" ? row.key : row.finding_key); openedHere.current = true; navigate({ [selectionKey]: key, ...(screen !== "exceptions" && row.month ? { month: str(row.month) } : {}) }); }
  function close() { if (dirty && !window.confirm("มีหมายเหตุที่ยังไม่ได้บันทึก ต้องการละทิ้งข้อมูลหรือไม่")) return; setDirty(false); if (openedHere.current) { openedHere.current = false; window.history.back(); } else navigate({ [selectionKey]: "" }, true); }
  const changeFilter = (key: string, value: string) => navigate({ [key]: value, offset: "" }, true);
  useEffect(() => {
    if (!ready) return; let active = true; setLoading(true); setError("");
    const query = new URLSearchParams({ limit: "50", offset: filters.offset || "0" });
    const permitted = screen === "actuals" ? ["month", "agency", "scope", "bud"] : screen === "documents" ? ["month", "agency", "owner", "status", "overdue"] : ["month", "agency", "owner", "control_code", "state", "condition"];
    permitted.forEach(key => { if (filters[key]) query.set(key, filters[key]); });
    request<Collection>(`${api}/${paths[screen]}?${query}`).then(result => { if (active) setData(result); }).catch(err => { if (active) setError(errorText(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [screen, filters, ready, refresh]);
  useEffect(() => {
    const resource = `${screen}/${selected}/${filters.month ?? ""}`;
    if (loadedSelection.current !== resource) setDetail(null);
    loadedSelection.current = resource;
    setDetailError(""); if (!selected) return; let active = true;
    const query = screen !== "exceptions" && filters.month ? `?month=${encodeURIComponent(filters.month)}` : "";
    request<Row>(`${api}/${paths[screen]}/${encodeURIComponent(selected)}${query}`).then(result => { if (active) setDetail(result); }).catch(err => { if (active) setDetailError(errorText(err)); });
    return () => { active = false; };
  }, [screen, selected, filters.month, refresh]);
  const questions = screen === "documents" ? ["Q24", "Q27"] : screen === "actuals" ? ["Q25", "Q26", "Q28", "Q45"] : ["Q25", "Q26", "Q28"];
  const title = screen === "actuals" ? lineTitle(object(detail?.line)) : screen === "documents" ? `เอกสาร ${documentTypes[str(object(detail?.item).requirement_code)] ?? "ที่เกี่ยวข้อง"}` : "รายละเอียดที่ต้องตรวจสอบ";
  return <>
    <h1 id="registry-title" tabIndex={-1}>{operationTitles[screen]}</h1>
    <p className="operations-intro">{screen === "actuals" ? "งบที่ใช้ได้จาก Hub และผลใช้จ่ายจากคลังข้อมูล แสดงยอดแต่ละฐานแยกกัน" : screen === "documents" ? "อ่านเลขอ้างอิงจากรายการงบและค่าใช้จ่ายเดิม ไม่บันทึกเลขซ้ำหรืออนุมัติเอกสารในหน้านี้" : "ผลตรวจ C5 และ C6 จากคลังข้อมูล แยกจากสถานะการดำเนินการของทีมงาน"}</p>
    <div className="operations-questions">{questions.map(id => <PendingQuestion id={id} key={id} />)}</div>
    {Object.keys(data.meta).length > 0 && <Snapshot meta={data.meta} />}
    {screen === "documents" && <aside className="registry-banner">รูปแบบเอกสารรอยืนยันจากฝ่ายการเงิน · ยังไม่เปิดการตรวจสอบหรือยกเว้นเอกสาร และยังไม่กำหนดวันครบกำหนด</aside>}
    {screen === "documents" && data.meta.period_month_selection_required === true && <p className="operations-caption">กรุณาเลือกเดือนเพื่อดูเอกสารของงบทั้งช่วงเวลา การเลือกเดือนไม่ใช่การแบ่งวงเงินรายเดือน</p>}
    <section className="registry-panel" aria-label="ตัวกรองรายการ"><div className="operations-filters">
      <label>เดือนที่แสดง<input className="registry-input" type="month" value={(filters.month ?? "").slice(0, 7)} onChange={event => changeFilter("month", event.target.value ? `${event.target.value}-01` : "")} /></label>
      <label>เอเจนซีที่แสดง<input className="registry-input" value={filters.agency ?? ""} onChange={event => changeFilter("agency", event.target.value)} placeholder="ทุกเอเจนซี" /></label>
      {screen === "actuals" ? <><label>รายการที่มี BUD นี้<input className="registry-input" value={filters.bud ?? ""} onChange={event => changeFilter("bud", event.target.value)} placeholder="ทุก BUD" /></label><label>ขอบเขตที่แสดง<input className="registry-input" value={filters.scope ?? ""} onChange={event => changeFilter("scope", event.target.value)} placeholder="ทุกขอบเขต" /></label></> : <>
        <label>ผู้รับผิดชอบ<select className="registry-input" value={filters.owner ?? ""} onChange={event => changeFilter("owner", event.target.value)}><option value="">ทุกผู้รับผิดชอบ</option><option value="unassigned">ยังไม่ระบุ</option><option value="online_staff">ทีมออนไลน์</option><option value="admin">ผู้ดูแลระบบ</option></select></label>
        {screen === "documents" ? <><label>สถานะเอกสาร<select className="registry-input" value={filters.status ?? ""} onChange={event => changeFilter("status", event.target.value)}><option value="">ทุกสถานะ</option><option value="MISSING">เฉพาะที่ยังขาด</option><option value="REFERENCE_RECORDED">บันทึกเลขอ้างอิงแล้ว</option></select></label><label>วันครบกำหนด<select className="registry-input" value={filters.overdue ?? ""} onChange={event => changeFilter("overdue", event.target.value)}><option value="">ทั้งหมด</option><option value="unknown">ยังไม่กำหนดวันครบกำหนด</option><option value="true">เกินกำหนด</option><option value="false">ยังไม่เกินกำหนด</option></select></label></> : <>
          <label>ประเภทการตรวจ<select className="registry-input" value={filters.control_code ?? ""} onChange={event => changeFilter("control_code", event.target.value)}><option value="">C5 และ C6</option><option value="C5">C5 · ชื่อและรายการงบ</option><option value="C6">C6 · ความสอดคล้องของรหัส</option></select></label>
          <label>สถานะการดำเนินการ<select className="registry-input" value={filters.state ?? ""} onChange={event => changeFilter("state", event.target.value)}><option value="">ทุกสถานะ</option>{Object.entries(states).filter(([key]) => ["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>ผลตรวจจากคลังข้อมูล<select className="registry-input" value={filters.condition ?? ""} onChange={event => changeFilter("condition", event.target.value)}><option value="">ทุกผลตรวจ</option><option value="PRESENT">ยังพบเงื่อนไข</option><option value="CLEARED">ไม่พบเงื่อนไขในรอบนี้</option><option value="UNAVAILABLE">ยังประเมินไม่ได้</option></select></label>
        </>}
      </>}
    </div><button type="button" className="registry-button mt-4" onClick={() => navigate(Object.fromEntries(filterKeys.map(key => [key, ""])), true)}>ล้างตัวกรอง</button></section>
    {screen === "actuals" && filters.bud && <p className="operations-caption">แสดงทั้งรายการที่มี BUD {filters.bud} ยอดใช้จ่ายของรายการไม่ได้แยกตาม BUD</p>}
    {error && <div className="registry-error" role="alert">{error}<button className="registry-button" onClick={() => setRefresh(value => value + 1)}>ลองอีกครั้ง</button></div>}
    <><section className="registry-panel" aria-label="รายการข้อมูล">
      {loading && !data.items.length ? <><p role="status" className="hub-loading">กำลังโหลดรายการ…</p><LoadingRows /></> : !error && !data.items.length ? <p>{data.meta.status === "NOT_IMPORTED" && screen !== "documents" ? "ยังไม่มีข้อมูลจากคลังข้อมูล" : "ไม่พบรายการตามตัวกรอง"}</p> : !error && <>
        <p className="operations-caption" role="status">{loading ? "กำลังอัปเดตรายการ…" : `พบ ${data.total} รายการ`}</p><table className={`registry-table operations-table operations-${screen}`}><thead><tr><th>รายการและเดือน</th>{screen === "actuals" ? <><th>งบที่อนุมัติ</th><th>ใช้จ่ายสื่อถึงวันที่</th><th>ผู้สนใจและ CPL</th></> : screen === "documents" ? <><th>ประเภทและเอกสาร</th><th>สถานะและเลขอ้างอิง</th><th>ผู้รับผิดชอบและกำหนด</th></> : <><th>ผลตรวจต้นทาง</th><th>วิธีเชื่อม</th><th>การดำเนินการ</th></>}</tr></thead><tbody>{data.items.map((row, index) => {
          const key = str(screen === "actuals" ? row.line_key : screen === "documents" ? row.key : row.finding_key); const dim = object(row.dimension); const workflow = object(row.workflow);
          return <tr key={`${key}-${str(row.month)}-${index}`}><td data-label="รายการและเดือน"><RegistryRowSummary id={`${screen}-${screen === "actuals" ? `${key}-${str(row.month)}` : key}`}><button type="button" onClick={() => open(row)}>{screen === "actuals" ? lineTitle(dim) : screen === "documents" ? lineTitle(row) : `${str(row.control_code)} · ${str(row.registration_code ?? row.campaign_id ?? row.rule_code)}`}</button><p>{month(row.month)}</p><p>เอเจนซี {str(dim.agency ?? row.agency) || "ยังไม่ระบุ"}</p><DemoSource row={isLocalDemo(row) ? row : dim} /></RegistryRowSummary></td>
            {screen === "actuals" ? <><td data-label="งบที่อนุมัติ">{row.budget_basis === "PERIOD" ? <span>งบทั้งช่วงเวลา · ดูในรายละเอียด</span> : <><strong>{dim.is_applicable === true ? money(row.approved_month_gross) : "—"}</strong><p>งบสื่อ {dim.is_applicable === true ? money(row.approved_month_media) : "—"}</p></>}</td><td data-label="ใช้จ่ายสื่อถึงวันที่"><strong>{money(row.platform_media_spend)}</strong><p>{date(row.platform_data_through)}</p><p>ใช้ไป {row.media_budget_used_pct == null ? "—" : `${str(row.media_budget_used_pct)}%`}</p>{row.media_budget_used_pct == null && <p>{reason(row.comparison_reason)}</p>}</td><td data-label="ผู้สนใจและ CPL"><p>ผู้สนใจ {row.attributed_leads == null ? "ยังไม่มีข้อมูลที่ครบถ้วน" : str(row.attributed_leads)}</p><p>CPL {money(row.media_cpl)}</p>{row.media_cpl == null && <p>{row.attributed_leads === 0 ? "ยังไม่มีผู้สนใจ" : "ข้อมูลผู้สนใจหรือการเปรียบเทียบยังไม่ครบ"}</p>}</td></> : screen === "documents" ? <><td data-label="ประเภทและเอกสาร"><p>{costType(row.cost_type)}</p><p>{paymentMethods[str(row.payment_method) as keyof typeof paymentMethods] ?? "ยังระบุวิธีชำระไม่ได้"}</p><p>{documentTypes[str(row.requirement_code)] ?? "ยังระบุชุดเอกสารไม่ได้"}</p></td><td data-label="สถานะและเลขอ้างอิง"><strong>{states[str(row.status)] ?? "ยังระบุชุดเอกสารไม่ได้"}</strong><p>{str(row.reference) || "ยังไม่มีเลขอ้างอิง"}</p>{row.partial_reference != null && <p>อ้างอิงบางส่วน: {str(row.partial_reference)}</p>}</td><td data-label="ผู้รับผิดชอบและกำหนด"><p>{owner(row.owner)}</p><p>{row.due_at ? date(row.due_at) : "ยังไม่กำหนดวันครบกำหนด"}</p>{row.is_overdue === true && <p>เกินกำหนด</p>}</td></> : <><td data-label="ผลตรวจต้นทาง"><strong>{condition(row)}</strong><p>{rules[str(row.rule_code)] ?? "ตรวจสอบหลักฐานตามกฎจากคลังข้อมูล"}</p><p>ตรวจพบล่าสุด {date(row.last_observed_at)}</p></td><td data-label="วิธีเชื่อม">{method(row.match_method)}</td><td data-label="การดำเนินการ"><strong>{states[str(workflow.state)] ?? states.OPEN}</strong><p>{owner(workflow.owner_role)}</p></td></>}
          </tr>;
        })}</tbody></table><div className="operations-actions"><button className="registry-button" disabled={!Number(filters.offset)} onClick={() => navigate({ offset: String(Math.max(0, Number(filters.offset) - 50)) }, true)}>ก่อนหน้า</button><button className="registry-button" disabled={Number(filters.offset || 0) + data.items.length >= data.total} onClick={() => navigate({ offset: String(Number(filters.offset || 0) + 50) }, true)}>ถัดไป</button></div>
      </>}
    </section><>{selected && <DetailDialog key={selected} dialogId={`${screen}-${screen === "actuals" ? `${selected}-${filters.month}` : selected}`} title={title} onClose={close}>
      {detailError ? <p role="alert" className="registry-error">{detailError}</p> : !detail ? <p role="status" className="hub-loading">กำลังโหลดรายละเอียด…</p> : screen === "actuals" ? <ActualDetail detail={detail} /> : screen === "documents" ? <DocumentDetail detail={detail} onChanged={() => setRefresh(value => value + 1)} /> : <FindingDetail detail={detail} onChanged={() => { setDirty(false); setRefresh(value => value + 1); }} onDirty={setDirty} />}
    </DetailDialog>}</></>
  </>;
}

function ActualDetail({ detail }: { detail: Row }) {
  const line = object(detail.line); const months = records(detail.months);
  return <>
    <DemoSource row={line} />
    <Facts values={[["ขอบเขต", lineTitle(line)], ["เอเจนซี", str(line.agency) || "โปรแกรมร่วม / ยังไม่ระบุ"], ["รุ่นงบ", str(line.revision_no)], ["สถานะรุ่นงบ", line.is_applicable === true ? "รุ่นที่ใช้ได้" : "ไม่ใช่รุ่นงบที่ใช้ได้"]]} />
    {line.budget_basis === "PERIOD" && <section className="registry-banner"><h3>งบทั้งช่วงเวลา</h3><p>{line.is_applicable === true ? money(line.approved_gross) : "—"} · {month(line.period_start_month)} ถึง {month(line.period_end_month)}</p><p>แสดงวงเงินนี้ครั้งเดียว งบรายเดือนยังไม่กำหนดจนกว่าจะอนุมัติการแบ่งงบ</p></section>}
    {months.map(row => <section key={str(row.month)} className="operations-month"><h3>{month(row.month)}</h3><div className="operations-metrics">{[["งบรวมรายเดือนที่ใช้ได้", line.is_applicable === true ? money(row.approved_month_gross) : "—"], ["งบสื่อที่เปรียบเทียบได้", line.is_applicable === true ? money(row.approved_month_media) : "—"], ["ใช้จ่ายสื่อถึงวันที่", money(row.platform_media_spend)], ["ใช้งบสื่อไป", row.media_budget_used_pct == null ? "—" : `${str(row.media_budget_used_pct)}%`], ["ผู้สนใจ", row.attributed_leads == null ? "ยังไม่มีข้อมูลที่ครบถ้วน" : str(row.attributed_leads)], ["CPL", money(row.media_cpl)]].map(([label, value]) => <dl key={label}><dt>{label}</dt><dd>{value}</dd></dl>)}</div>
      {(row.media_budget_used_pct == null || row.media_cpl == null) && <p>{reason(row.comparison_reason)}</p>}{!isLocalDemo(line) && <DemoSource row={row} />}<Quality codes={row.quality_codes} />
      <Facts values={[["ข้อมูลสื่อถึงวันที่", date(row.platform_data_through)], ["ข้อมูลผู้สนใจถึงวันที่", date(row.leads_data_through)], ["ฐานข้อมูลใช้จ่าย", str(row.platform_spend_basis)], ["เวลาข้อมูลแพลตฟอร์ม", date(row.platform_source_snapshot_at)], ["เวลาข้อมูล REM", date(row.rem_source_snapshot_at)]]} />
      <CardCosts title="ยอดเรียกเก็บผ่านบัตร" rows={records(row.card_cash_by_type)} /><CardCosts title="ค่าใช้จ่ายบัตรตามเดือน" rows={records(row.card_monthly_by_type)} />
      <p className="operations-caption">ยอดเรียกเก็บและค่าใช้จ่ายตามเดือนเป็นคนละฐานของค่าใช้จ่ายเดียวกัน ยอดบัตรค่าสื่ออาจซ้ำกับใช้จ่ายจากแพลตฟอร์ม จึงไม่มีผลรวมระหว่างสามฐาน</p><p className="operations-caption">LINE OA (ยังไม่แยกบัญชี): รายการ LINE OA ยังรวมในหมวดช่องทาง ไม่มีการอนุมานหรือจับคู่บัญชี</p>
    </section>)}
    <section className="operations-month"><h3>แคมเปญและวิธีเชื่อมจากคลังข้อมูล</h3>{!records(detail.campaigns).length ? <p>ยังไม่มีแคมเปญที่เชื่อมในรอบนี้</p> : records(detail.campaigns).map((row, index) => <details key={index} className="operations-disclosure"><summary>{str(row.platform)} · {str(row.campaign_id)} · {method(row.match_method)}</summary><Facts values={[["เดือน", month(row.month)], ["รหัสบัญชี", str(row.account_id)], ["รหัสแคมเปญ", str(row.campaign_id)], ["รหัส SN ที่ยืนยัน", str(row.registration_code) || "ยังไม่มี"], ["รหัสที่พบ", str(row.observed_code) || "ยังไม่มีหลักฐาน"], ["ชื่อที่พบ", str(row.observed_name) || "ยังไม่มีหลักฐาน"], ["พบเมื่อ", date(row.observed_at)], ["การผูก ID", str(row.binding_name_id) || "ยังไม่มี"], ["การเชื่อมรายเดือน", str(row.assignment_id) || "ยังไม่มี"], ["ข้อเสนอที่ยังไม่ได้ใช้", row.candidate_method ? method(row.candidate_method) : "ไม่มี"]]} /><Quality codes={row.conflict_codes} /><p>การผูก ID ที่ยืนยันมีสิทธิ์เหนือชื่อที่ขัดแย้ง ระบบไม่เปลี่ยนการเชื่อมหรือชื่อแคมเปญจากหน้านี้</p><Provenance row={row} /></details>)}</section>
    <a className="registry-button mt-4" href={`/ads/finance?view=media-lines&record=${encodeURIComponent(str(line.hub_line_id ?? line.line_key))}`}>เปิดรายการงบและการเชื่อม SN</a>
  </>;
}

function CardCosts({ title, rows }: { title: string; rows: Row[] }) { return <section className="operations-month"><h4>{title}</h4>{!rows.length ? <p>ไม่มีรายการที่เชื่อมในชุดข้อมูลนี้</p> : <ul className="operations-costs">{rows.map((row, index) => <li key={index}><span>{costType(row.cost_type)} · {paymentMethods[str(row.payment_method) as keyof typeof paymentMethods] ?? "ยังไม่ระบุวิธีชำระ"}</span><strong>{money(row.amount)}</strong></li>)}</ul>}</section>; }
function Provenance({ row }: { row: Row }) { const refs = records(row.source_record_refs ?? object(row.temporal_provenance).source_record_refs); return <details className="operations-disclosure"><summary>หลักฐานและที่มาของเวลา</summary><DemoSource row={row} /><Facts values={[["เวลาต้นทาง", date(row.source_snapshot_at ?? row.platform_source_snapshot_at ?? row.hub_source_snapshot_at)], ["เวลาที่มีผล", date(row.effective_at)], ["เวลาที่บันทึก", date(row.recorded_at)]]} />{refs.map((ref, index) => <p className="operations-code" key={index}>{[ref.source_key, ref.relation, ref.record_key].filter(Boolean).map(str).join(" · ")}</p>)}<p className="operations-caption">ไม่ทราบเวลาที่มีผล ไม่ได้หมายความว่าเริ่มมีผลเมื่อ Hub รับข้อมูล</p></details>; }

function DocumentDetail({ detail, onChanged }: { detail: Row; onChanged: () => void }) {
  const item = object(detail.item); const meta = object(detail.meta);
  const [notice, setNotice] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const snapshotReady = meta.status === "AVAILABLE" && typeof meta.snapshot_id === "string";
  async function copy() {
    if (!snapshotReady) return;
    setBusy(true); setError(""); setNotice("");
    try { await navigator.clipboard.writeText(str(item.message_th)); }
    catch { setError("คัดลอกไม่สำเร็จ เลือกข้อความตัวอย่างแล้วคัดลอกด้วยตนเอง ระบบยังไม่บันทึกว่าคัดลอกแล้ว"); setBusy(false); return; }
    try { await request(`${api}/document-tracking/${encodeURIComponent(str(item.key))}/follow-ups`, "POST", { expected_source_version: item.source_version, template_version: item.template_version, expected_snapshot_id: meta.snapshot_id, month: item.month }); setNotice("คัดลอกแล้วและบันทึกประวัติการคัดลอก ไม่มีการส่งข้อความ"); onChanged(); }
    catch (err) { setError(`คัดลอกข้อความแล้ว แต่บันทึกประวัติไม่สำเร็จ: ${errorText(err)}`); }
    finally { setBusy(false); }
  }
  return <>
    <Facts values={[["รายการงบ", lineTitle(item)], ["เดือน", month(item.month)], ["เอเจนซี", str(item.agency) || "ยังไม่ระบุ"], ["ประเภทค่าใช้จ่าย", costType(item.cost_type)], ["วิธีชำระ", paymentMethods[str(item.payment_method) as keyof typeof paymentMethods] ?? "ยังไม่ระบุ"], ["สถานะเอกสาร", states[str(item.status)] ?? "ยังระบุชุดเอกสารไม่ได้"], ["เลขอ้างอิงเดิม", str(item.reference) || "ยังไม่มี"], ["เลขอ้างอิงบางส่วน", str(item.partial_reference) || "ยังไม่มี"], ["เหตุผล", documentReasons[str(item.reason)] ?? (/[ก-๙]/.test(str(item.reason)) ? str(item.reason) : "อ้างอิงตามชุดเอกสารที่ยังรอยืนยัน")], ["วันครบกำหนด", item.due_at ? date(item.due_at) : "ยังไม่กำหนดวันครบกำหนด"], ["ผู้รับผิดชอบ", owner(item.owner)], ["รุ่นต้นทาง", str(item.source_version)], ["รุ่นชุดเอกสาร", str(item.requirement_version)]]} />
    {item.source_link && <a className="registry-button mt-4" href={str(item.source_link)}>เปิดรายการต้นทางใน Hub</a>}
    <section className="operations-month"><h3>ตัวอย่างข้อความติดตาม</h3><p>ข้อความนี้ไม่มีวงเงิน รายละเอียด Memo หรือลิงก์ส่วนตัว และไม่มีการส่งให้ผู้อื่นจาก Hub</p><label>ข้อความที่จะคัดลอก<textarea className="registry-input operations-message" readOnly value={str(item.message_th)} onFocus={event => event.target.select()} /></label><button className="registry-button primary mt-4" disabled={busy || !item.message_th || !snapshotReady} onClick={() => void copy()}>{busy ? "กำลังคัดลอก…" : "คัดลอกข้อความติดตาม"}</button>
      <p role="status"><StatusText message={notice} /></p>{!snapshotReady && <p className="operations-caption">รอนำเข้ารอบข้อมูล TEST ก่อนบันทึกประวัติการคัดลอก สามารถอ่านข้อความตัวอย่างได้</p>}{error && <p role="alert" className="registry-error">{error}</p>}
    </section>
    <section className="operations-month"><h3>ประวัติการติดตาม</h3>{!records(item.follow_ups).length ? <p>ยังไม่มีประวัติการคัดลอก</p> : <ul>{records(item.follow_ups).map((row, index) => <li key={str(row.id) || index}>คัดลอกข้อความ · {date(row.copied_at)} · ผู้ดำเนินการ <ActorName id={str(row.actor_id)} /><p className="operations-message">{str(row.message_th)}</p></li>)}</ul>}</section>
  </>;
}

function FindingDetail({ detail, onChanged, onDirty }: { detail: Row; onChanged: () => void; onDirty: (dirty: boolean) => void }) {
  const finding = object(detail.finding); const workflow = object(finding.workflow); const observed = object(finding.observed); const expected = object(finding.expected);
  const [ownerAction, setOwnerAction] = useState("KEEP"); const [note, setNote] = useState(str(workflow.note));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(state: string) {
    setError(""); if (state === "RESOLVED" && !note.trim()) { setError("กรุณาระบุเหตุผลก่อนบันทึกว่าดำเนินการแล้ว"); return; }
    setBusy(true); try { await request(`${api}/findings/${encodeURIComponent(str(finding.finding_key))}/workflow`, "POST", { expected_version: workflow.version ?? 0, expected_snapshot_id: object(detail.meta).snapshot_id, state, owner_action: ownerAction, note }); setOwnerAction("KEEP"); onChanged(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return <>
    <section className="operations-month"><h3>ผลตรวจจากคลังข้อมูล</h3><DemoSource row={finding} /><Facts values={[["ประเภทการตรวจ", str(finding.control_code)], ["เรื่องที่ต้องตรวจ", rules[str(finding.rule_code)] ?? "ตรวจสอบหลักฐานตามกฎจากคลังข้อมูล"], ["รหัสกฎ", str(finding.rule_code)], ["ผลตรวจ", condition(finding)], ["เดือน", month(finding.month)], ["วิธีเชื่อม", method(finding.match_method)], ["รหัส SN ที่ควรเป็น", str(expected.registration_code ?? expected.bound_code ?? finding.registration_code) || "ยังไม่มีหลักฐาน"], ["รหัสที่พบ", str(observed.observed_code) || "ยังไม่มีหลักฐาน"], ["ชื่อที่พบ", str(observed.observed_name) || "ยังไม่มีหลักฐาน"], ["ตรวจพบครั้งแรก", date(finding.first_observed_at)], ["ตรวจพบล่าสุด", date(finding.last_observed_at)], ["เวลาไม่พบเงื่อนไข", date(finding.cleared_at)]]} /><Provenance row={{ ...finding, ...observed }} /></section>
    <section className="operations-month"><h3>การดำเนินการใน Hub</h3><p>{states[str(workflow.state)] ?? states.OPEN}</p><p>สถานะนี้ไม่เปลี่ยนผลตรวจต้นทาง หากรอบข้อมูลใหม่ยังพบเงื่อนไข ระบบจะเปิดเรื่องอีกครั้ง</p>
      <p>ผู้รับผิดชอบปัจจุบัน: {owner(workflow.owner_role)} {str(workflow.owner_id)}</p><label>กำหนดผู้รับผิดชอบ<select className="registry-input" value={ownerAction} onChange={event => { setOwnerAction(event.target.value); onDirty(true); }}><option value="KEEP">คงผู้รับผิดชอบเดิม</option><option value="SELF">รับผิดชอบด้วยบัญชีของฉัน</option><option value="CLEAR">ยังไม่ระบุผู้รับผิดชอบ</option></select></label>
      <label className="operations-note">หมายเหตุหรือเหตุผล<textarea className="registry-input" maxLength={2000} value={note} onChange={event => { setNote(event.target.value); onDirty(true); }} /></label>
      {error && <p className="registry-error" role="alert">{error}</p>}<div className="operations-actions"><button className="registry-button" disabled={busy} onClick={() => void save("ACKNOWLEDGED")}>รับเรื่อง</button><button className="registry-button" disabled={busy} onClick={() => void save(str(workflow.state) || "OPEN")}>บันทึกหมายเหตุและผู้รับผิดชอบ</button><button className="registry-button primary" disabled={busy} onClick={() => void save("RESOLVED")}>บันทึกว่าดำเนินการแล้ว</button></div>
      <div className="operations-actions">{Boolean(finding.line_key) && <a className="registry-button" href={`/ads/finance?view=media-lines&record=${encodeURIComponent(str(finding.line_key))}`}>เชื่อม SN กับรายการงบ</a>}{Boolean(finding.registration_code) && <a className="registry-button" href={`/ads/registry?registration=${encodeURIComponent(str(finding.registration_code))}&tab=details`}>เปิดทะเบียน SN</a>}<a className="registry-button" href="/ads/finance?view=corrections&record=new">เสนอรายการแก้ไข</a></div>
    </section><section className="operations-month"><h3>ประวัติการดำเนินการ</h3>{!records(detail.history).length ? <p>ยังไม่มีการดำเนินการ</p> : <ul>{records(detail.history).map((row, index) => <li key={str(row.id) || index}><p>{row.action === "SOURCE_REOPEN" ? "คลังข้อมูลรอบใหม่ยังพบเงื่อนไข เปิดเรื่องอีกครั้ง" : "ทีมงานบันทึกการดำเนินการ"}</p><p>{date(row.recorded_at)} · {states[str(row.state)] ?? "บันทึกการเปลี่ยนสถานะ"}</p><p>{str(row.note)}</p><p>ผู้ดำเนินการ <ActorName id={str(row.actor_id ?? row.created_by)} /></p></li>)}</ul>}</section>
  </>;
}
