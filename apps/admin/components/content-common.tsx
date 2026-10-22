"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { request } from "./hub-request";
import "./project-content.css";

export type Locales = { th?: string; en?: string };
export type Exposure = "open" | "web_only" | "internal";
export type ContentField = {
  field_key: string; entity: string; section: string; label: Locales; help: Locales; sort: number;
  value_kind: string; unit: string | null; source_policy: string; source_ref: string | null; owner_role: string;
  required_for: Record<string, "required" | "recommended" | "optional">; locales_required: string[];
  surfaces: string[]; default_ai_exposure: Exposure; review_every_days: number | null;
  validation: { min?: number; integer?: boolean; units?: string[]; max_length?: number };
  status: "active" | "planned" | "retired"; revision: number;
};
export type FieldCatalog = { items: ContentField[]; can_manage: boolean };
export type Translation = {
  id: string; owner_type: string; owner_key: string; field_key: string; revision: number; th_version: number;
  th_text: string; reviewed_en: string | null; machine_en: string | null; entered_en: string | null;
  translation_state: "missing" | "machine" | "reviewed" | "stale"; editable: boolean;
  job: null | { status: string; error_code: string | null; model: string | null; completed_at: string | null };
};

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองใหม่"; }
export function contentDate(value: string | null | undefined) {
  if (!value) return "ยังไม่ทราบวันที่";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));
}
export const exposureLabels: Record<Exposure, string> = { open: "เว็บไซต์และ AI", web_only: "เว็บไซต์เท่านั้น", internal: "ภายใน Hub" };
const sectionLabels: Record<string, string> = { facts: "ข้อเท็จจริง", identity: "ข้อมูลทั่วไป", narrative: "เนื้อหาและจุดขาย", seo: "ผลค้นหา", buildings: "อาคาร", contacts: "ช่องทางติดต่อ", faq: "คำถามที่พบบ่อย", media: "สื่อ", facilities: "สิ่งอำนวยความสะดวก", features: "คุณสมบัติ", prices: "ราคาและโปรโมชัน", places: "สถานที่ใกล้เคียง", legal: "ข้อมูลตามกฎหมาย", sales: "เงื่อนไขขาย", programmes: "โครงการบริการ", progress: "ความคืบหน้าก่อสร้าง", articles: "บทความ", publication: "การเผยแพร่", unit_types: "แบบห้องและแบบบ้าน" };
export function sectionLabel(section: string) { return sectionLabels[section] ?? "ข้อมูลประกอบ"; }
function surfaceLabel(surface: string) {
  if (surface === "hub_only") return "ภายใน Hub";
  if (surface === "chatbot") return "แชตบอต";
  if (surface === "jsonld") return "ข้อมูลสำหรับเครื่องมือค้นหา";
  if (surface === "llms_txt") return "รายการข้อมูลสำหรับ AI";
  if (surface === "dw_export") return "ข้อมูลส่งต่อ DW";
  return `เว็บไซต์ · ${sectionLabel(surface.split(".").at(-1) ?? "")}`;
}

export function useFieldCatalog() {
  const permissions = useHubPermissions();
  const key = capabilityKey(permissions.account);
  const [catalog, setCatalog] = useState<FieldCatalog | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setCatalog(null); setError("");
    request<FieldCatalog>("v1/admin/content/fields").then(value => { if (active) setCatalog(value); })
      .catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [key, revision]);
  return { catalog, error, reload: () => setRevision(value => value + 1) };
}

export function FieldInfo({ field }: { field?: ContentField }) {
  if (!field) return null;
  const required = field.required_for.all === "required";
  return <details className="content-field-info"><summary aria-label={`การใช้งาน ${field.label.th ?? field.field_key}`}><span aria-hidden="true">i</span></summary>
    <div><strong>{field.label.th}</strong><p>{field.help.th}</p>
      <p>แสดงที่: {field.surfaces.map(surfaceLabel).join(" · ") || "ยังไม่ส่งออก"}</p>
      <p>{field.default_ai_exposure === "internal" ? "ไม่ส่งไปเว็บไซต์หรือ AI" : field.default_ai_exposure === "web_only" ? "ไม่ส่งไปแชตบอต รายการ AI หรือข้อมูลสำหรับเครื่องมือค้นหา" : "ส่งต่อได้เฉพาะช่องทางที่ระบุ เมื่อผ่านการเผยแพร่"}</p>
      <p>ผู้รับผิดชอบ: {field.owner_role === "Marketing" ? "การตลาด" : field.owner_role}{field.review_every_days ? ` · ทบทวนทุก ${field.review_every_days} วัน` : " · ทบทวนเมื่อข้อมูลเปลี่ยน"}</p>
      <p>{required ? "จำเป็นก่อนเผยแพร่" : field.required_for.all === "recommended" ? "แนะนำให้มี" : "ข้อมูลเพิ่มเติม"}{field.locales_required.includes("en") ? " · ต้องตรวจภาษาอังกฤษ" : ""}</p>
      {Object.entries(field.required_for).filter(([key]) => key !== "all").map(([key, value]) => <p key={key}>{{ condominium: "คอนโดมิเนียม", house: "บ้าน", townhome: "ทาวน์โฮม" }[key] ?? key}: {{ required: "จำเป็นก่อนเผยแพร่", recommended: "แนะนำให้มี", optional: "ข้อมูลเพิ่มเติม" }[value]}</p>)}
    </div>
  </details>;
}

export function ContentLabel({ htmlFor, field, children }: { htmlFor?: string; field?: ContentField; children?: ReactNode }) {
  return <div className="content-label"><label htmlFor={htmlFor}>{children ?? field?.label.th ?? "ข้อมูล"}</label><FieldInfo field={field} /></div>;
}
export function ExposureInput({ value, onChange }: { value: Exposure; onChange: (value: Exposure) => void }) {
  return <label className="content-input">ใช้ข้อมูลนี้ในช่องทางใด<select value={value} onChange={event => onChange(event.target.value as Exposure)}>{Object.entries(exposureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
}
export function BilingualInput({ id, field, label, value, onChange, rows = 3, maxLength = 12000, translationHint = true }: {
  id: string; field?: ContentField; label?: string; value: Locales; onChange: (value: Locales) => void; rows?: number; maxLength?: number; translationHint?: boolean;
}) {
  return <div className="content-bilingual"><div className="content-input"><ContentLabel htmlFor={`${id}-th`} field={field}>{label ?? field?.label.th}</ContentLabel>
    <textarea id={`${id}-th`} rows={rows} maxLength={maxLength} value={value.th ?? ""} onChange={event => onChange({ ...value, th: event.target.value })} /></div>
    <div className="content-input"><label htmlFor={`${id}-en`}>{label ?? field?.label.th} (ภาษาอังกฤษ)</label><textarea id={`${id}-en`} rows={rows} maxLength={maxLength} lang="en" value={value.en ?? ""} onChange={event => onChange({ ...value, en: event.target.value })} />
      {translationHint && <p className="field-help">บันทึกคำแปลที่มีอยู่ได้ แล้วตรวจยืนยันในแท็บภาษาอังกฤษ</p>}</div></div>;
}

export function TranslationReviewPanel({ items, fields, canEdit, onChanged, onEditingChange }: {
  items: Translation[]; fields: ContentField[]; canEdit: boolean; onChanged: () => Promise<void>; onEditingChange?: (value: boolean) => void;
}) {
  const [selected, setSelected] = useState<Translation | null>(null);
  const [english, setEnglish] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { onEditingChange?.(Boolean(selected)); return () => onEditingChange?.(false); }, [selected, onEditingChange]);
  const labels = { missing: "รอคำแปลและการตรวจ", machine: "มีร่างภาษาอังกฤษรอตรวจ", reviewed: "ตรวจภาษาอังกฤษแล้ว", stale: "ภาษาไทยเปลี่ยน ต้องตรวจใหม่" };
  async function save() {
    if (!selected || !canEdit || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      await request(`v1/admin/content/translations/${selected.id}/review`, "POST", { expected_revision: selected.revision, th_version: selected.th_version, english });
      await onChanged(); setSelected(null); setNotice("ตรวจยืนยันภาษาอังกฤษแล้ว");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  async function retry(item: Translation) {
    setPending(true); setError("");
    try { await request(`v1/admin/content/translations/${item.id}/retry`, "POST", { expected_revision: item.revision }); await onChanged(); setNotice("ส่งคำขอร่างภาษาอังกฤษใหม่แล้ว"); }
    catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <section className="content-section" aria-label="ตรวจภาษาอังกฤษ"><h2>ตรวจภาษาอังกฤษ</h2><p className="field-help">ตัวเลขและช่องข้อเท็จจริงต้องตรงกับภาษาไทย เมื่อภาษาไทยเปลี่ยน คำแปลที่เคยตรวจจะยังอยู่ให้เปรียบเทียบ</p>
    {error && <p className="notice error" role="alert">{error} ข้อความที่กรอกยังอยู่</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {!items.some(item => item.th_text.trim()) && <p>บันทึกข้อความภาษาไทยก่อน รายการรอตรวจจะปรากฏที่นี่</p>}
    <div className="content-card-list">{items.filter(item => item.th_text.trim()).map(item => {
      const field = fields.find(field => field.field_key === item.field_key);
      return <article className="content-card" key={item.id}><div className="content-label"><h3>{field?.label.th ?? "ข้อความการตลาด"}</h3><FieldInfo field={field} /></div><p className="content-state">{labels[item.translation_state]}</p>
        <p className="content-preserve">{item.th_text}</p>
        {item.reviewed_en && <div><strong>คำแปลที่ตรวจครั้งก่อน</strong><p lang="en" className="content-preserve">{item.reviewed_en}</p></div>}
        {item.machine_en && <div className="content-machine"><strong>ร่างเสนอใหม่ · ยังไม่ผ่านการตรวจ</strong><p lang="en" className="content-preserve">{item.machine_en}</p></div>}
        {item.job?.status === "queued" && <p className="field-help">รอร่างภาษาอังกฤษ</p>}{item.job?.status === "failed" && <p className="inline-warning">ยังร่างภาษาอังกฤษไม่สำเร็จ สามารถกรอกและตรวจคำแปลเองได้</p>}
        {item.job?.model && <details><summary>รายละเอียดการร่าง</summary><p>{item.job.model} · {contentDate(item.job.completed_at)}</p></details>}
        {canEdit && item.editable && item.job?.status === "failed" && <button className="button secondary" disabled={pending || Boolean(selected)} onClick={() => void retry(item)}>ขอร่างภาษาอังกฤษอีกครั้ง</button>}
        {selected?.id === item.id ? <form onSubmit={event => { event.preventDefault(); void save(); }}><label className="content-input">คำแปลภาษาอังกฤษที่ยืนยัน<textarea lang="en" rows={4} required maxLength={field?.validation.max_length ?? 12000} value={english} onChange={event => setEnglish(event.target.value)} disabled={pending || !canEdit} /></label>
          <div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => { setSelected(null); setError(""); }}>ยกเลิก</button><button className="button primary" disabled={pending || !canEdit}>{pending ? "กำลังบันทึก…" : "ยืนยันตรวจภาษาอังกฤษ"}</button></div></form>
          : canEdit && item.editable && <button className="button secondary" disabled={Boolean(selected)} onClick={() => { setSelected(item); setEnglish(item.entered_en && item.entered_en !== item.reviewed_en ? item.entered_en : item.machine_en ?? item.entered_en ?? item.reviewed_en ?? ""); setError(""); setNotice(""); }}>ตรวจคำแปล</button>}
        {!item.editable && <p className="field-help">ฉบับนี้ส่งตรวจแล้ว เปิดร่างใหม่เพื่อแก้ข้อความ</p>}
      </article>;
    })}</div>
  </section>;
}
