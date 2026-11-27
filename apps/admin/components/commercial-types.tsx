"use client";
import { uploadFileError, type UploadContext, type UploadEvidence } from "../lib/upload-context";
import { uploadText } from "../lib/upload-text";
import { UploadResult } from "./upload-evidence";
import { useHubPermissions } from "./accounts";
import { AssetFileLink } from "./private-assets";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { LocalRole } from "@/lib/local-session";
import { ContentWorkflow } from "./content-workflow";
import { request } from "./hub-request";
import { WritingFields, useWritingTranslations, useFieldCatalog } from "./content-common";
import { WritingAidError, type WritingAcceptance } from "@/lib/writing-aid";
import { Preview, RightsBadge, RightsDialog, uploadAsset, UploadCategory, type Asset } from "./project-assets";
import "./commercial-types.css";
import "./km-hubs.css";
import { UnitTypeWizard, unitStateLabel } from "./unit-type-wizard";

type Localized = { th?: string; en?: string; [locale: string]: string | undefined };
type SourceModel = { public_model_id: string; rem_model_id: string; model_name_rem: string; match_status?: string };
type SourceLink = SourceModel & { shared_reference: boolean; link_kind: "reference"; classification_status: "unverified" };
type Form = "condominium" | "house" | "townhome" | "other";
type NumericField = "area_min_sqm" | "area_max_sqm" | "bedrooms" | "bathrooms" | "kitchens" | "storeys" | "parking_spaces" | "land_area_sqm";
export type CommercialAsset = Asset & { room_tag?: string | null; caption?: Localized; floor_number?: number | null; binding_id: string; asset_role: "model_image" | "floor_plan" | "structural_plan"; alt_text: Localized; title: string; floor_label: string; plan_revision: string; applicability_model_ids: string[]; display_order: number; asset_effective_from?: string | null; asset_effective_to?: string | null };
export type CommercialType = Record<NumericField, number | null> & {
  id: string; public_commercial_type_id: string; public_name: Localized; description: Localized; product_form: Form | null;
  source_model_ids: string[]; source_links: SourceLink[]; source_notes: string; status: "draft" | "in_review" | "approved" | "withdrawn";
  category?: string | null; special_rooms?: string[]; ceiling_height_m?: number | null; furniture_package?: string | null;
  highlights?: Localized; price_mode?: "manual" | "hidden"; ai_exposure?: "open" | "web_only" | "internal"; revision?: number;
  readiness: { collection?: { present: number; expected: number }; missing: { field: string; message: string }[]; review_issues?: { field: string; message: string }[]; publication_ready: false }; assets: CommercialAsset[];
};
export type CommercialProject = { public_project_id: string; updated_at: string; models?: SourceModel[]; commercial_types?: CommercialType[] };
type Draft = Record<NumericField, string> & { name: string; name_en: string; description: string; description_en: string; product_form: Form | ""; source_model_ids: string[]; source_notes: string };
const forms: Record<Form, string> = { condominium: "ห้องชุด", house: "บ้าน", townhome: "ทาวน์โฮม", other: "อื่น ๆ" };
const numbers: { key: NumericField; label: string; area?: boolean; house?: boolean }[] = [
  { key: "area_min_sqm", label: "พื้นที่ใช้สอยต่ำสุด (ตร.ม.)", area: true }, { key: "area_max_sqm", label: "พื้นที่ใช้สอยสูงสุด (ตร.ม.)", area: true },
  { key: "bedrooms", label: "ห้องนอน" }, { key: "bathrooms", label: "ห้องน้ำ" }, { key: "kitchens", label: "ห้องครัว" },
  { key: "storeys", label: "จำนวนชั้นของบ้าน", house: true }, { key: "parking_spaces", label: "ที่จอดรถ" }, { key: "land_area_sqm", label: "พื้นที่ดิน (ตร.ม.)", area: true, house: true },
];
function draftFrom(item?: CommercialType): Draft {
  return { name: item?.public_name.th ?? "", name_en: item?.public_name.en ?? "", description: item?.description.th ?? "", description_en: item?.description.en ?? "", product_form: item?.product_form ?? "", source_model_ids: item?.source_model_ids ?? [], source_notes: item?.source_notes ?? "", ...Object.fromEntries(numbers.map(({ key }) => [key, item?.[key] == null ? "" : String(item[key])])) } as Draft;
}
function payload(draft: Draft, previous?: CommercialType) {
  return { public_name: { ...previous?.public_name, th: draft.name.trim(), en: draft.name_en.trim() }, description: { ...previous?.description, th: draft.description.trim(), en: draft.description_en.trim() }, product_form: draft.product_form || null, source_model_ids: draft.source_model_ids, source_notes: draft.source_notes.trim(), ...Object.fromEntries(numbers.map(({ key }) => [key, draft[key] === "" ? null : Number(draft[key])])) };
}
function problem(draft: Draft) {
  if (!draft.name.trim()) return "กรอกชื่อแบบขายภาษาไทย";
  if (numbers.some(({ key, area }) => draft[key] !== "" && (!Number.isFinite(Number(draft[key])) || Number(draft[key]) < 0 || (area && Number(draft[key]) <= 0) || (["storeys", "parking_spaces"].includes(key) && !Number.isInteger(Number(draft[key]))) || (key === "storeys" && Number(draft[key]) < 1)))) return "พื้นที่ต้องมากกว่า 0 จำนวนชั้นต้องเป็นจำนวนเต็มตั้งแต่ 1 และจำนวนห้อง/ที่จอดรถต้องไม่ติดลบ";
  if (draft.area_min_sqm !== "" && draft.area_max_sqm !== "" && Number(draft.area_min_sqm) > Number(draft.area_max_sqm)) return "พื้นที่สูงสุดต้องไม่น้อยกว่าพื้นที่ต่ำสุด";
  return "";
}
function SourceChoices({ models, selected, onChange, disabled }: { models: SourceModel[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  return <fieldset className="ct-source-choices" disabled={disabled}><legend>รหัส REM ที่เกี่ยวข้อง — เลือกได้หลายรหัส</legend>{!models.length ? <p className="field-help">ยังไม่มีรหัสต้นทางในโครงการนี้ บันทึกแบบขายเป็นร่างและเติมหลักฐานก่อนได้</p> : <div>{models.map(model => <label key={model.public_model_id}><input type="checkbox" disabled={model.match_status === "REJECTED" && !selected.includes(model.public_model_id)} checked={selected.includes(model.public_model_id)} onChange={event => onChange(event.target.checked ? [...selected, model.public_model_id] : selected.filter(id => id !== model.public_model_id))} /><span>{model.rem_model_id}{model.model_name_rem !== model.rem_model_id && <small>{model.model_name_rem}</small>}{model.match_status === "REJECTED" && <small>รหัสถูกปฏิเสธ — นำออกจากการอ้างอิง</small>}</span></label>)}</div>}<p className="field-help">ใช้รหัสเดียวร่วมกับหลายแบบขายได้ การเลือกนี้เป็นข้อมูลอ้างอิงและยังไม่ยืนยันว่ายูนิตใดอยู่ในแบบขายนี้</p></fieldset>;
}
function TypeFields({ draft, onChange, models, disabled, prefix }: { draft: Draft; onChange: (draft: Draft) => void; models: SourceModel[]; disabled: boolean; prefix: string }) {
  const set = (key: keyof Draft, value: string | string[]) => onChange({ ...draft, [key]: value });
  return <fieldset className="ct-fields" disabled={disabled}>
    <legend className="visually-hidden">รายละเอียดแบบขาย</legend>
    <div className="ct-field-grid"><div className="form-field"><label htmlFor={`${prefix}-name`}>ชื่อแบบขาย (ไทย) <span aria-hidden="true">*</span></label><input id={`${prefix}-name`} value={draft.name} required maxLength={200} onChange={event => set("name", event.target.value)} /></div><div className="form-field"><label htmlFor={`${prefix}-name-en`}>ชื่อแบบขาย (English)</label><input id={`${prefix}-name-en`} value={draft.name_en} maxLength={200} onChange={event => set("name_en", event.target.value)} /></div></div>
    <div className="form-field"><label htmlFor={`${prefix}-form`}>ประเภทแบบขาย</label><select id={`${prefix}-form`} value={draft.product_form} onChange={event => set("product_form", event.target.value)}><option value="">ยังไม่ระบุ</option>{Object.entries(forms).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <div className="ct-field-grid"><div className="form-field"><label htmlFor={`${prefix}-description`}>รายละเอียด (ไทย)</label><textarea id={`${prefix}-description`} rows={3} maxLength={4000} value={draft.description} onChange={event => set("description", event.target.value)} /></div><div className="form-field"><label htmlFor={`${prefix}-description-en`}>รายละเอียด (English)</label><textarea id={`${prefix}-description-en`} rows={3} maxLength={4000} value={draft.description_en} onChange={event => set("description_en", event.target.value)} /></div></div>
    <div className="ct-section-label">พื้นที่และห้อง</div><p className="field-help">เว้นว่างเมื่อยังไม่ทราบ · ระบุ 0 เมื่อยืนยันว่าไม่มี · พื้นที่เดียวกันให้กรอกต่ำสุดและสูงสุดเท่ากัน</p>
    <div className="ct-number-grid">{numbers.filter(field => !field.house || draft.product_form !== "condominium" || draft[field.key] !== "").map(field => <div className="form-field" key={field.key}><label htmlFor={`${prefix}-${field.key}`}>{field.label}</label><input id={`${prefix}-${field.key}`} type="number" min={field.area ? "0.01" : field.key === "storeys" ? "1" : "0"} step={["storeys", "parking_spaces"].includes(field.key) ? "1" : "any"} inputMode={field.area ? "decimal" : "numeric"} value={draft[field.key]} onChange={event => set(field.key, event.target.value)} /></div>)}</div>
    <div className="ct-section-label">ข้อมูลอ้างอิงจาก REM</div><SourceChoices models={models} selected={draft.source_model_ids} onChange={ids => set("source_model_ids", ids)} disabled={disabled} />
    <div className="form-field"><label htmlFor={`${prefix}-source-notes`}>หลักฐานและหมายเหตุการจัดกลุ่ม</label><textarea id={`${prefix}-source-notes`} rows={2} maxLength={4000} value={draft.source_notes} onChange={event => set("source_notes", event.target.value)} /><p className="field-help">เช่น เลขที่แบบแปลน เอกสารรับมอบ และความแตกต่างของแบบย่อย ไม่ใส่ข้อมูลส่วนบุคคลของลูกค้า</p></div>
  </fieldset>;
}

export function CommercialTypes<T extends CommercialProject>({ project, role, disabled, onDirtyChange, onProjectChanged }: { project: T; role: LocalRole; disabled: boolean; onDirtyChange: (dirty: boolean) => void; onProjectChanged: (project: T) => void | Promise<void> }) {
  const permissions = useHubPermissions();
  const query = useSearchParams(), requestedType = query.get("unit_type");
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string | null; revision: string; drafts: Draft[]; previous?: CommercialType } | null>(null);
  const [workflowOwners, setWorkflowOwners] = useState<Set<string>>(() => new Set());
  const workflowBusy = workflowOwners.size > 0;
  const workflowEditing = (key: string, value: boolean) => setWorkflowOwners(owners => { if (owners.has(key) === value) return owners; const next = new Set(owners); if (value) next.add(key); else next.delete(key); return next; });
  const [mediaOwners, setMediaOwners] = useState<Set<string>>(() => new Set());
  const mediaDirty = mediaOwners.size > 0;
  const typeIds = (project.commercial_types ?? []).map(item => item.public_commercial_type_id).join(",");
  const mediaCallbacks = useMemo(() => Object.fromEntries(typeIds.split(",").filter(Boolean).map(id => [id, (value: boolean) => setMediaOwners(owners => { if (owners.has(id) === value) return owners; const next = new Set(owners); if (value) next.add(id); else next.delete(id); return next; })])), [typeIds]);
  const [wizard, setWizard] = useState<string | null>(null);
  const [wizardDirty, setWizardDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const canEdit = permissions.can("projects", "edit");
  const types = project.commercial_types ?? [];
  const { catalog } = useFieldCatalog();
  const writing = useWritingTranslations(`v1/admin/projects/${encodeURIComponent(project.public_project_id)}/unit-types`, project.updated_at,
    canEdit && !!catalog?.items.some(field => field.ai_writing_enabled));
  const models = [...(project.models ?? [])].sort((a, b) => a.rem_model_id.localeCompare(b.rem_model_id, "en", { numeric: true }));
  const base = `v1/admin/projects/${encodeURIComponent(project.public_project_id)}/commercial-types`;
  const occupied = Boolean(edit || mediaDirty || pending || wizardDirty || workflowBusy);
  useEffect(() => {
    if (requestedType && project.commercial_types?.some(item => item.public_commercial_type_id === requestedType)) setWizard(requestedType);
  }, [requestedType, project.public_project_id]);
  useEffect(() => { onDirtyChange(occupied); }, [occupied, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (edit) editorRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [edit?.id, Boolean(edit)]);
  function start(item?: CommercialType, bulk = false) {
    if (disabled || occupied || !canEdit) return;
    setError(""); setConflict(false); setNotice("");
    setOpen(item?.public_commercial_type_id ?? null);
    setEdit({ id: item?.public_commercial_type_id ?? null, revision: project.updated_at, drafts: bulk ? [draftFrom(), draftFrom()] : [draftFrom(item)], previous: item });
  }
  function startFromRemModel(model: SourceModel) {
    if (disabled || occupied || !canEdit) return;
    setError(""); setConflict(false); setNotice("");
    setOpen(null);
    const seed = draftFrom();
    seed.name = model.model_name_rem || model.rem_model_id;
    seed.source_model_ids = [model.public_model_id];
    setEdit({ id: null, revision: project.updated_at, drafts: [seed] });
  }
  const mappedModelIds = useMemo(() => new Set(types.flatMap(item => item.source_model_ids ?? [])), [types]);
  const unmappedModels = useMemo(() => models.filter(model => model.match_status !== "REJECTED" && !mappedModelIds.has(model.public_model_id)), [models, mappedModelIds]);
  async function acceptWriting(item: CommercialType, acceptance: WritingAcceptance) {
    if (!canEdit || disabled || acceptance.expectedDraft.updated_at !== (edit ? edit.revision : project.updated_at)
        || edit && (edit.id !== item.public_commercial_type_id || JSON.stringify(edit.drafts[0]) !== JSON.stringify(draftFrom(item)))) throw new WritingAidError("stale");
    setPending(true);
    try {
      await request<T>(`${base}/${item.public_commercial_type_id}`, "PATCH", { updated_at: acceptance.expectedDraft.updated_at,
        description: { ...item.description, [acceptance.language]: acceptance.after } });
      const fresh = await request<T>(base); await writing.reload(); await onProjectChanged(fresh); setEdit(null);
    } finally { setPending(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!edit || disabled || pending || workflowBusy || mediaDirty || wizardDirty || !canEdit) return;
    setError(""); setConflict(false);
    const invalid = edit.drafts.map(problem).findIndex(Boolean);
    if (invalid >= 0) { setError(`รายการ ${invalid + 1}: ${problem(edit.drafts[invalid])}`); return; }
    setPending(true);
    try {
      const data = await request<T>(edit.id ? `${base}/${encodeURIComponent(edit.id)}` : base, edit.id ? "PATCH" : "POST", edit.id ? { updated_at: edit.revision, ...payload(edit.drafts[0], edit.previous) } : { updated_at: edit.revision, types: edit.drafts.map(draft => payload(draft)) });
      await onProjectChanged(data); setNotice(edit.id ? "บันทึกแบบขายฉบับร่างแล้ว" : `เพิ่มแบบขายฉบับร่าง ${edit.drafts.length} รายการแล้ว`); setEdit(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "บันทึกแบบขายไม่สำเร็จ"); setConflict((failure as { status?: number; code?: string }).status === 409 && (failure as { code?: string }).code !== "duplicate"); }
    finally { setPending(false); }
  }
  async function reload() {
    if (!window.confirm("ข้อมูลร่างที่ยังไม่บันทึกจะถูกทิ้ง ต้องการโหลดข้อมูลล่าสุดหรือไม่?")) return;
    setPending(true);
    try { await onProjectChanged(await request<T>(base)); setEdit(null); setError(""); setConflict(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setPending(false); }
  }
  const editor = edit && <div ref={editorRef} className="ct-editor"><form inert={workflowBusy} onSubmit={save}><h3>{edit.id ? "แก้ไขแบบขาย" : edit.drafts.length > 1 ? "เพิ่มแบบขายเป็นชุด" : "เพิ่มแบบขาย"}</h3>{!edit.id && <p className="field-help">แต่ละรายการเป็นแบบขายแยกกัน บันทึกทั้งชุดพร้อมกันเมื่อข้อมูลถูกต้อง สามารถเว้นรหัส REM ไว้ก่อนได้</p>}{edit.drafts.map((draft, index) => <section className="ct-draft-row" key={index} aria-label={`แบบขายรายการ ${index + 1}`}>{edit.drafts.length > 1 && <div className="ct-row-heading"><h4>รายการ {index + 1}</h4><button type="button" className="button text-button" disabled={pending || disabled} onClick={() => setEdit({ ...edit, drafts: edit.drafts.filter((_, itemIndex) => itemIndex !== index) })}>นำรายการ {index + 1} ออก</button></div>}<TypeFields draft={draft} models={models} disabled={pending || disabled} prefix={`ct-draft-${index}`} onChange={value => setEdit({ ...edit, drafts: edit.drafts.map((old, itemIndex) => itemIndex === index ? value : old) })} /></section>)}<div className="ct-actions">{!edit.id && <button type="button" className="button secondary" disabled={pending || disabled || edit.drafts.length >= 50} onClick={() => setEdit({ ...edit, drafts: [...edit.drafts, draftFrom()] })}>เพิ่มอีกแถว</button>}<button type="submit" className="button primary" aria-busy={pending} disabled={pending || disabled || conflict}>{pending ? "กำลังบันทึก…" : "บันทึกแบบขาย"}</button><button type="button" className="button secondary" disabled={pending} onClick={() => { setEdit(null); setError(""); setConflict(false); }}>ยกเลิกการแก้ไข</button></div></form>{edit.previous && <ContentWorkflow target={{ kind: "unit_type", identity: { id: edit.previous.id } }} label={edit.previous.public_name.th || edit.id!} revision={edit.revision} disabled={pending || disabled || mediaDirty || wizardDirty || conflict || workflowOwners.size > 0 && !workflowOwners.has("type:" + edit.previous.id)} draft={{ dirty: true, valid: canEdit && !problem(edit.drafts[0]), sourceStamp: { updated_at: edit.revision }, getChanges: () => editorRef.current?.querySelector("form")?.reportValidity() ? payload(edit.drafts[0], edit.previous) : null }} onEditingChange={value => workflowEditing("type:" + edit.previous!.id, value)} onChanged={async () => { await onProjectChanged(await request<T>(base)); setEdit(null); }} onReload={reload} />}</div>;
  return <section className="panel commercial-types" id="commercial-types" aria-labelledby="commercial-types-title">
    <div className="panel-heading"><div><span className="section-chip">แบบขายของ Marketing</span><h2 id="commercial-types-title">แบบขายและรหัสแบบต้นทาง <span className="count">{types.length}</span></h2><p>รวมหลายรหัส REM เป็นแบบขายเดียว หรือแยกหลายแบบขายจากรหัสรวม พร้อมเก็บหลักฐานของแต่ละรายการ</p></div></div>
    <div className="panel-body"><p className="ct-draft-note">แบบขายส่วนนี้ยังไม่ส่งออกใน API ที่เผยแพร่ · เตรียมเนื้อหาและราคา Marketing ผ่าน 6 ขั้นตอน ตัวเลข REM ใช้เปรียบเทียบภายในและไม่ยืนยันการแบ่งยูนิต · สำหรับรูปผังชั้นอาคารหลายชั้น (Master Plan / Floor Plan รายชั้น) จัดการได้ที่ <Link prefetch={false} href={`/website/project/${encodeURIComponent(project.public_project_id)}?tab=data&section=buildings`}>ข้อมูล → อาคารและผังชั้น</Link></p>
      {canEdit && <div className="ct-actions"><button className="button primary" disabled={disabled || occupied} onClick={() => start()}>เพิ่มแบบขาย</button><button className="button secondary" disabled={disabled || occupied} onClick={() => start(undefined, true)}>เพิ่มแบบขายเป็นชุด</button><button className="button secondary" disabled={disabled || occupied} onClick={() => setWizard("")}>สร้างแบบด้วย 6 ขั้นตอน</button></div>}
      {(types.length > 0 || models.length > 0) && (
        <section className="km-mapping-box" aria-label="ตารางเทียบแบบห้องที่สื่อสารกับรหัสแบบใน REM">
          <h3>ตารางเทียบแบบห้องที่สื่อสาร (Marketing) ↔ รหัสแบบใน REM</h3>
          {types.length > 0 && (
            <div className="km-mapping-table-wrap">
              <table className="km-mapping-table">
                <thead>
                  <tr>
                    <th scope="col">แบบห้องที่สื่อสารกับลูกค้า</th>
                    <th scope="col">รหัสแบบใน REM ที่เชื่อมโยง</th>
                    <th scope="col">รูปแปลนและห้องตัวอย่าง</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map(item => {
                    const id = item.public_commercial_type_id;
                    const typeName = item.public_name.th || "ยังไม่ระบุชื่อแบบขาย";
                    const plansCount = (item.assets ?? []).filter(a => a.asset_role === "floor_plan").length;
                    const photosCount = (item.assets ?? []).filter(a => a.asset_role === "model_image").length;
                    const linkedModels = item.source_model_ids.map(mid => models.find(m => m.public_model_id === mid)).filter((m): m is SourceModel => Boolean(m));
                    return (
                      <tr key={id}>
                        <td>
                          <strong>{typeName}</strong>
                          <div className="field-help">
                            {item.product_form ? forms[item.product_form] : "ยังไม่ระบุประเภท"} · {item.area_min_sqm == null ? "ยังไม่ระบุพื้นที่" : `${item.area_min_sqm}${item.area_max_sqm != null && item.area_max_sqm !== item.area_min_sqm ? `–${item.area_max_sqm}` : ""} ตร.ม.`}
                          </div>
                        </td>
                        <td>
                          {linkedModels.length > 0 ? (
                            <div className="km-rem-list">
                              {linkedModels.map(m => (
                                <span className="km-rem-badge" key={m.public_model_id}>
                                  {m.rem_model_id}{m.model_name_rem && m.model_name_rem !== m.rem_model_id ? ` · ${m.model_name_rem}` : ""}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="field-help">ยังไม่เชื่อมรหัส REM</span>
                          )}
                        </td>
                        <td>
                          <div className="km-rem-list" style={{ alignItems: "center" }}>
                            <span className="km-rem-badge">แปลน {plansCount} ไฟล์</span>
                            <span className="km-rem-badge">รูปห้อง {photosCount} ไฟล์</span>
                            <button type="button" className="button text-button" disabled={occupied} onClick={() => setOpen(open === id ? null : id)}>
                              {open === id ? "ซ่อนช่องอัปโหลด" : "จัดการรูป/แปลน"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {unmappedModels.length > 0 && (
            <div className="km-unmapped-bar">
              <strong>รหัสแบบใน REM ที่ยังไม่ได้จับคู่กับแบบห้องที่สื่อสาร ({unmappedModels.length} รหัส)</strong>
              <div className="km-unmapped-items">
                {unmappedModels.map(model => (
                  <span className="km-rem-badge" key={model.public_model_id}>
                    {model.rem_model_id}{model.model_name_rem && model.model_name_rem !== model.rem_model_id ? ` (${model.model_name_rem})` : ""}
                    {canEdit && (
                      <button type="button" className="button text-button" disabled={disabled || occupied} onClick={() => startFromRemModel(model)}>
                        + สร้างแบบห้องจากรหัสนี้
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      {wizard !== null && <UnitTypeWizard key={wizard} project={project} initialType={wizard} role={role} disabled={disabled || pending || workflowBusy || mediaDirty || Boolean(edit)} onDirtyChange={setWizardDirty} onProjectChanged={onProjectChanged} onClose={() => setWizard(null)} />}
      {disabled && <p className="inline-warning">บันทึกหรือยกเลิกการแก้ไขส่วนอื่นก่อนจัดการแบบขาย</p>}
      {notice && <p className="notice success" role="status">{notice}</p>}
      {error && <div className="notice error" tabIndex={-1} ref={errorRef} role="alert">{error}{conflict && <><p>มีข้อมูลใหม่กว่า ข้อมูลที่กรอกยังอยู่ กรุณาตรวจสอบก่อนโหลดใหม่</p><button className="button secondary" disabled={pending} onClick={() => void reload()}>ทิ้งการแก้ไขและโหลดข้อมูลล่าสุด</button></>}</div>}
      {edit && !edit.id && editor}
      {!types.length && !edit && <div className="ct-empty"><h3>ยังไม่มีรายการแบบขายที่ Marketing จัดเตรียม</h3><p>รหัส REM {models.length} รายการเป็นข้อมูลต้นทาง จำนวนรหัสไม่ได้ยืนยันว่ามีแบบขายจริงครบแล้ว</p></div>}
      <div className="ct-list">{types.map(item => {
        const id = item.public_commercial_type_id;
        const missing = item.readiness?.missing ?? [];
        const expanded = open === id;
        const name = item.public_name.th || "ยังไม่ระบุชื่อแบบขาย";
        return <article className={`ct-card${expanded ? " is-open" : ""}`} key={id} data-workspace-item={id} tabIndex={-1} aria-label={`แบบขาย ${name}`}>
          <button className="button secondary" disabled={disabled || occupied} onClick={() => setWizard(id)}>เปิด 6 ขั้นตอน · {name}</button>
          <div className="ct-card-header"><div><h3>{name}</h3><p className="ct-summary">{item.product_form ? forms[item.product_form] : "ยังไม่ระบุประเภท"} · {item.area_min_sqm == null ? "ยังไม่ระบุพื้นที่" : `${item.area_min_sqm}${item.area_max_sqm != null && item.area_max_sqm !== item.area_min_sqm ? `–${item.area_max_sqm}` : ""} ตร.ม.`} · {item.bedrooms ?? "—"} ห้องนอน · {item.bathrooms ?? "—"} ห้องน้ำ</p><div className="ct-chips"><span className="ct-chip">{unitStateLabel[item.status]}</span><span className="ct-chip">อ้างอิง REM {item.source_model_ids.length} รหัส</span>{item.readiness.collection && <span className="ct-chip">กรอกแล้ว {item.readiness.collection.present}/{item.readiness.collection.expected} หัวข้อ</span>}{missing.length > 0 && <span className="ct-chip warning">ต้องเติม/ตรวจ {missing.length} รายการ</span>}{item.source_links?.some(link => link.shared_reference) && <span className="ct-chip warning">รอแยกยูนิต</span>}</div></div><div className="ct-card-actions"><button className="button secondary" aria-expanded={expanded} aria-controls={`ct-detail-${id}`} disabled={occupied} onClick={() => setOpen(expanded ? null : id)}>{expanded ? "ย่อรายละเอียด" : "ดูรายละเอียด"}<span className="visually-hidden"> {name}</span></button>{canEdit && <button className="button secondary" disabled={disabled || occupied || item.status === "in_review"} onClick={() => start(item)}>แก้ไข<span className="visually-hidden"> {name}</span></button>}</div></div>
          <div id={`ct-detail-${id}`} hidden={!expanded} className="ct-detail">{edit?.id === id ? editor : <><div className="ct-facts"><div><strong>รายละเอียด</strong><p>{item.description.th || "ยังไม่ระบุรายละเอียด"}</p></div><dl>{numbers.map(field => <div key={field.key}><dt>{field.label}</dt><dd>{item[field.key] ?? "ยังไม่ทราบ"}</dd></div>)}</dl><div><strong>รหัส REM ที่เกี่ยวข้อง</strong><p>{item.source_links?.map(link => link.rem_model_id).join(", ") || "ยังไม่เชื่อมรหัสต้นทาง"}</p><p className="field-help">เป็นข้อมูลอ้างอิงที่ยังไม่ยืนยันการจัดประเภทยูนิต{item.source_links?.some(link => link.shared_reference) ? " · รหัสร่วมกับแบบขายอื่น ต้องตรวจขอบเขตและยูนิตก่อนใช้ข้อมูลราคา/คงเหลือ" : ""}</p>{item.source_notes && <p>{item.source_notes}</p>}</div></div>{missing.length > 0 && <div className="ct-gaps"><h4>ข้อมูลที่ต้องเติมหรือตรวจสอบ</h4><ul>{missing.map((gap, index) => <li key={`${gap.field}-${index}`}>{gap.message}</li>)}</ul></div>}{Boolean(item.readiness.review_issues?.length) && <div className="ct-gaps"><h4>รอการตรวจสอบ</h4><ul>{item.readiness.review_issues?.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}</ul></div>}<CommercialMedia project={project} item={item} role={role} disabled={disabled || pending || workflowBusy || wizard !== null || Boolean(edit) || item.status === "in_review" || mediaOwners.size > 0 && !mediaOwners.has(item.public_commercial_type_id)} onDirtyChange={mediaCallbacks[item.public_commercial_type_id]} onProjectChanged={onProjectChanged} /></>}{expanded && <WritingFields field={catalog?.items.find(field => field.field_key === "commercial_type.description")} fields={catalog?.items ?? []}
            translations={writing.items} ownerType="commercial_type" ownerKey={item.id} value={edit?.id === id ? { th: edit.drafts[0].description, en: edit.drafts[0].description_en } : item.description}
            savedValue={item.description} stamp={{ updated_at: edit?.id === id ? edit.revision : project.updated_at }}
            dirty={Boolean(edit && (edit.id !== id || JSON.stringify(edit.drafts[0]) !== JSON.stringify(draftFrom(item))))} canEdit={canEdit} maxLength={4000}
            disabled={disabled || pending || mediaDirty || wizardDirty || wizard !== null || Array.from(workflowOwners).some(owner => owner !== "writing:" + item.id)}
            onActivityChange={active => workflowEditing("writing:" + item.id, active)} onAccept={value => acceptWriting(item, value)} />}</div>
          {!edit && wizard === null && <ContentWorkflow target={{ kind: "unit_type", identity: { id: item.id } }} label={name} revision={project.updated_at} disabled={disabled || pending || mediaDirty || workflowOwners.size > 0 && !workflowOwners.has("type:" + item.id)} onEditingChange={value => workflowEditing("type:" + item.id, value)} onChanged={async () => { await onProjectChanged(await request<T>(base)); }} onReload={async () => { await onProjectChanged(await request<T>(base)); }} />}
        </article>;
      })}</div>
    </div>
  </section>;
}

type BindingDraft = { room_tag: string; caption_th: string; caption_en: string; alt_en: string; floor_number: string; asset_id: string; asset_role: "model_image" | "floor_plan" | "structural_plan"; title: string; alt: string; floor_label: string; plan_revision: string; applicability_model_ids: string[] };
const blankBinding = (): BindingDraft => ({ room_tag: "", caption_th: "", caption_en: "", alt_en: "", floor_number: "", asset_id: "", asset_role: "floor_plan", title: "", alt: "", floor_label: "", plan_revision: "", applicability_model_ids: [] });
const assetRoles = { model_image: "ภาพแบบขาย", floor_plan: "แปลนแบบขาย", structural_plan: "แบบโครงสร้างภายใน" };
function CommercialBindingExtras({ binding, setBinding, roomTags, storeys }: { binding: BindingDraft; setBinding: (value: BindingDraft) => void; roomTags: { code: string; label: Localized }[]; storeys: number | null }) {
  return <div className="ct-field-grid">
    <label>ประเภทห้องในภาพ<select value={binding.room_tag} onChange={e => setBinding({ ...binding, room_tag: e.target.value })}><option value="">ยังไม่ระบุ</option>{roomTags.map(tag => <option key={tag.code} value={tag.code}>{tag.label.th}</option>)}</select></label>
    {storeys != null && <label>ชั้นของแบบบ้าน<select value={binding.floor_number} onChange={e => setBinding({ ...binding, floor_number: e.target.value })}><option value="">ยังไม่ระบุ</option>{Array.from({ length: Math.min(storeys, 200) }, (_, i) => <option key={i + 1} value={i + 1}>ชั้น {i + 1}</option>)}</select></label>}
    <label>คำบรรยายภาพ (ไทย)<textarea value={binding.caption_th} maxLength={2000} onChange={e => setBinding({ ...binding, caption_th: e.target.value })} /></label>
    <label>คำบรรยายภาพ (อังกฤษ)<textarea lang="en" value={binding.caption_en} maxLength={2000} onChange={e => setBinding({ ...binding, caption_en: e.target.value })} /></label>
    <label>คำอธิบายไฟล์ (อังกฤษ)<textarea lang="en" value={binding.alt_en} maxLength={1000} onChange={e => setBinding({ ...binding, alt_en: e.target.value })} /></label>
  </div>;
}
export function CommercialMedia<T extends CommercialProject>({ project, item, role, disabled, onDirtyChange, onProjectChanged, roomTags = [] }: { roomTags?: { code: string; label: Localized }[]; project: T; item: CommercialType; role: LocalRole; disabled: boolean; onDirtyChange: (dirty: boolean) => void; onProjectChanged: (project: T) => void | Promise<void> }) {
  const permissions = useHubPermissions();
  const [workflowOwners, setWorkflowOwners] = useState<Set<string>>(() => new Set());
  const workflowBusy = workflowOwners.size > 0;
  const workflowEditing = (key: string, value: boolean) => setWorkflowOwners(owners => { if (owners.has(key) === value) return owners; const next = new Set(owners); if (value) next.add(key); else next.delete(key); return next; });
  const [library, setLibrary] = useState<Asset[] | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [quickPlanFiles, setQuickPlanFiles] = useState<File[]>([]);
  const [quickPlanFloor, setQuickPlanFloor] = useState("");
  const [quickPlanTitle, setQuickPlanTitle] = useState("");
  const [quickPhotoFiles, setQuickPhotoFiles] = useState<File[]>([]);
  const [quickPhotoRoom, setQuickPhotoRoom] = useState("");
  const [quickPhotoCaption, setQuickPhotoCaption] = useState("");
  const quickPlanRef = useRef<HTMLInputElement>(null);
  const quickPhotoRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(""), [purpose, setPurpose] = useState("media");
  const [uploadResults, setUploadResults] = useState<{ name: string; upload: UploadEvidence | null }[]>([]);
  const uploadContext: UploadContext = { v: 1, kind: "commercial_type", project_ref: project.public_project_id, ref: item.public_commercial_type_id, category: category || null, purpose };
  const [binding, setBinding] = useState<BindingDraft | null>(null);
  const [revision, setRevision] = useState(project.updated_at);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [review, setReview] = useState<Asset | null>(null);
  const [remove, setRemove] = useState<CommercialAsset | null>(null);
  const [conflict, setConflict] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const canEdit = permissions.can("projects", "edit");
  const prefix = `ct-media-${item.public_commercial_type_id}`;
  const base = `v1/admin/projects/${encodeURIComponent(project.public_project_id)}/commercial-types/${encodeURIComponent(item.public_commercial_type_id)}`;
  const dirty = Boolean(files.length || quickPlanFiles.length || quickPhotoFiles.length || binding || pending || review || remove || workflowBusy);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function loadLibrary() { setLibrary(await request<Asset[]>("v1/admin/assets")); }
  async function openLibrary() { if (disabled || pending || workflowBusy) return; setError(""); setPending(true); try { await loadLibrary(); } catch (failure) { setError(failure instanceof Error ? failure.message : "โหลดคลังสื่อไม่สำเร็จ"); } finally { setPending(false); } }
  const [uploadWaiting, setUploadWaiting] = useState(false);
  async function quickUploadAndBind(roleType: "floor_plan" | "model_image") {
    const selectedFiles = roleType === "floor_plan" ? quickPlanFiles : quickPhotoFiles;
    if (!selectedFiles.length || disabled || pending || workflowBusy || !canEdit) return;
    const ctx: UploadContext = {
      v: 1,
      kind: "commercial_type",
      project_ref: project.public_project_id,
      ref: item.public_commercial_type_id,
      category: roleType === "floor_plan" ? "unit_plan" : "interior",
      purpose: roleType === "floor_plan" ? "unit_plan" : "media",
    };
    const invalid = selectedFiles.find(file => uploadFileError(file, ctx));
    if (invalid) {
      setError(`${invalid.name}: ${uploadFileError(invalid, ctx)}`);
      return;
    }
    setPending(true);
    setError("");
    setNotice("");
    setConflict(false);
    let currentUpdatedAt = project.updated_at;
    let latestProject: T | null = null;
    try {
      for (const file of selectedFiles) {
        const uploaded = await uploadAsset(file, ctx, setUploadWaiting);
        setUploadResults(previous => [...previous, { name: file.name, upload: uploaded.upload }]);
        const cleanName = file.name.replace(/\.[^.]+$/, "");
        const defaultTitle = roleType === "floor_plan"
          ? (quickPlanTitle.trim() || `แปลน ${item.public_name.th || cleanName}${quickPlanFloor.trim() ? ` (${quickPlanFloor.trim()})` : ""}`)
          : (quickPhotoCaption.trim() || `ภาพห้องตัวอย่าง ${item.public_name.th || cleanName}`);
        latestProject = await request<T>(`${base}/assets`, "POST", {
          updated_at: currentUpdatedAt,
          asset_id: uploaded.asset.id,
          asset_role: roleType,
          title: defaultTitle.slice(0, 200),
          alt_text: { th: defaultTitle.slice(0, 1000), en: "" },
          room_tag: roleType === "model_image" && quickPhotoRoom ? quickPhotoRoom : null,
          caption: { th: roleType === "model_image" ? quickPhotoCaption.trim() : "", en: "" },
          floor_number: null,
          floor_label: roleType === "floor_plan" ? quickPlanFloor.trim() : "",
          plan_revision: "",
          applicability_model_ids: item.source_model_ids ?? [],
        });
        currentUpdatedAt = latestProject.updated_at;
      }
      if (latestProject) await onProjectChanged(latestProject);
      if (roleType === "floor_plan") {
        setQuickPlanFiles([]);
        setQuickPlanFloor("");
        setQuickPlanTitle("");
        if (quickPlanRef.current) quickPlanRef.current.value = "";
      } else {
        setQuickPhotoFiles([]);
        setQuickPhotoRoom("");
        setQuickPhotoCaption("");
        if (quickPhotoRef.current) quickPhotoRef.current.value = "";
      }
      setNotice(`อัปโหลดและผูก${roleType === "floor_plan" ? "แปลนห้อง" : "รูปห้องตัวอย่าง"}สำเร็จ ${selectedFiles.length} ไฟล์ แสดงตัวอย่างด้านบนแล้ว`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "อัปโหลดและผูกไฟล์ไม่สำเร็จ");
      setConflict((failure as { status?: number }).status === 409);
    } finally {
      setPending(false);
    }
  }
  async function upload(event: FormEvent) {
    event.preventDefault(); if (disabled || pending || workflowBusy || !canEdit) return; setError(""); setNotice("");
    const invalid = files.find(file => uploadFileError(file, uploadContext));
    if (invalid) { setError(invalid.name + ": " + uploadFileError(invalid, uploadContext)); return; }
    setPending(true); let completed = 0;
    try {
      for (const file of files) {
        const result = await uploadAsset(file, uploadContext, setUploadWaiting);
        setUploadResults(previous => [...previous, { name: file.name, upload: result.upload }]);
        completed++;
      }
      setFiles([]); if (fileRef.current) fileRef.current.value = "";
      await loadLibrary();
    } catch (failure) { setFiles(files.slice(completed)); setError(failure instanceof Error ? failure.message : "อัปโหลดไม่สำเร็จ"); }
    finally { setNotice(`อัปโหลดเข้าคลังสำเร็จ ${completed} ไฟล์ กรุณาเลือกใช้และกำหนดรายละเอียดทีละไฟล์ สถานะสิทธิ์เดิมยังคงอยู่`); setPending(false); }
  }
  async function bind(event: FormEvent) {
    event.preventDefault(); if (!binding || disabled || pending || workflowBusy || !canEdit) return; setError(""); setConflict(false);
    if (!binding.asset_id || !binding.title.trim() || !binding.alt.trim()) { setError("เลือกไฟล์และกรอกชื่อแปลน/ภาพกับคำอธิบายภาษาไทย"); return; }
    setPending(true);
    try { await onProjectChanged(await request<T>(`${base}/assets`, "POST", { updated_at: revision, asset_id: binding.asset_id, asset_role: binding.asset_role, title: binding.title.trim(), alt_text: { th: binding.alt.trim(), en: binding.alt_en.trim() }, room_tag: binding.room_tag || null, caption: { th: binding.caption_th.trim(), en: binding.caption_en.trim() }, floor_number: binding.floor_number ? Number(binding.floor_number) : null, floor_label: binding.floor_label.trim(), plan_revision: binding.plan_revision.trim(), applicability_model_ids: binding.applicability_model_ids })); setBinding(null); setNotice("ผูกไฟล์กับแบบขายฉบับร่างแล้ว ยังไม่เผยแพร่ไฟล์"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "ผูกไฟล์ไม่สำเร็จ"); setConflict((failure as { status?: number }).status === 409); }
    finally { setPending(false); }
  }
  async function removeBinding() {
    if (!remove || disabled || pending || workflowBusy || !canEdit) return; setPending(true); setError(""); setConflict(false);
    try { await onProjectChanged(await request<T>(`${base}/assets/${encodeURIComponent(remove.binding_id)}/remove`, "POST", { updated_at: revision })); setRemove(null); setNotice("นำไฟล์ออกจากแบบขายร่างแล้ว ไฟล์ยังอยู่ในคลัง"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "นำไฟล์ออกไม่สำเร็จ"); setConflict((failure as { status?: number }).status === 409); }
    finally { setPending(false); }
  }
  async function reloadAfterConflict() {
    if (!window.confirm("ทิ้งรายละเอียดไฟล์ที่ยังไม่บันทึกและโหลดโครงการล่าสุดหรือไม่? ไฟล์ที่อัปโหลดสำเร็จยังอยู่ในคลัง")) return;
    setPending(true);
    try { await onProjectChanged(await request<T>(`v1/admin/projects/${encodeURIComponent(project.public_project_id)}`)); setBinding(null); setRemove(null); setFiles([]); if (fileRef.current) fileRef.current.value = ""; setError(""); setConflict(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "โหลดข้อมูลล่าสุดไม่สำเร็จ"); }
    finally { setPending(false); }
  }
  return <section className="ct-media" aria-labelledby={`${prefix}-title`}><div className="ct-row-heading"><h3 id={`${prefix}-title`}>ภาพและแปลน <span className="count">{item.assets?.length ?? 0}</span></h3><button className="button secondary" disabled={disabled || pending || workflowBusy || Boolean(binding)} onClick={() => library ? setLibrary(null) : void openLibrary()}>{library ? "ปิดคลังสื่อ" : "เลือกจากคลังสื่อ"}</button></div>
    <p className="field-help">เพิ่มแปลนได้หลายไฟล์ เช่น ชั้น 1 / ชั้น 2 ของบ้าน หรือแปลนห้องกลับด้าน · ผังชั้นอาคารคอนโดให้เก็บที่โครงการ</p>
    {error && <div className="notice error" role="alert" ref={errorRef} tabIndex={-1}>{error}{conflict && <><p>รายละเอียดที่กรอกยังอยู่ กรุณาตรวจสอบก่อนโหลดใหม่</p><button className="button secondary" disabled={pending} onClick={() => void reloadAfterConflict()}>ทิ้งรายละเอียดไฟล์และโหลดล่าสุด</button></>}</div>}{notice && <p className="notice success" role="status">{notice}</p>}
    <div className="ct-bound-assets">{(item.assets ?? []).map(asset => <article className="ct-bound-asset" key={asset.binding_id}><Preview asset={asset} alt={asset.alt_text.th} /><div><strong>{asset.title || asset.original_filename}</strong><p>{assetRoles[asset.asset_role]}{asset.floor_label && ` · ${asset.floor_label}`}{asset.plan_revision && ` · ฉบับ ${asset.plan_revision}`}</p><RightsBadge status={asset.rights_status} from={asset.asset_effective_from} to={asset.asset_effective_to} /><p className="field-help">{asset.applicability_model_ids?.length ? `รหัสอ้างอิง: ${asset.applicability_model_ids.map(id => project.models?.find(model => model.public_model_id === id)?.rem_model_id ?? id).join(", ")}` : "ยังไม่ระบุขอบเขตรหัสแบบ"} · ขอบเขตยังรอตรวจสอบ</p><AssetFileLink asset={asset}>เปิดไฟล์<span className="visually-hidden"> {asset.original_filename} (เปิดในแท็บใหม่)</span></AssetFileLink>{canEdit && <button className="button text-button" disabled={disabled || dirty} onClick={() => { setRevision(project.updated_at); setRemove(asset); }}>นำออก<span className="visually-hidden"> {asset.title}</span></button>}</div><ContentWorkflow target={{ kind: "type_asset", identity: { id: asset.binding_id } }} label={asset.title || asset.original_filename} revision={project.updated_at} disabled={disabled || pending || Boolean(files.length || binding || review || remove) || workflowOwners.size > 0 && !workflowOwners.has("binding:" + asset.binding_id)} onEditingChange={value => workflowEditing("binding:" + asset.binding_id, value)} onChanged={async () => { await onProjectChanged(await request<T>(`v1/admin/projects/${encodeURIComponent(project.public_project_id)}`)); }} onReload={async () => { await onProjectChanged(await request<T>(`v1/admin/projects/${encodeURIComponent(project.public_project_id)}`)); }} /></article>)}</div>
    {!item.assets?.length && <p className="ct-empty muted">ยังไม่มีภาพหรือแปลนของแบบขายนี้</p>}
    {remove && <div className="ct-remove" role="group" aria-label="ยืนยันนำไฟล์ออก"><p>นำ “{remove.title || remove.original_filename}” ออกจากแบบขายนี้? ไฟล์จะยังอยู่ในคลังสื่อ</p><div className="ct-actions"><button className="button secondary" disabled={disabled || pending} onClick={() => void removeBinding()}>ยืนยันนำออก</button><button className="button secondary" disabled={pending} onClick={() => setRemove(null)}>ยกเลิกนำออก</button></div></div>}
    {canEdit && (
      <div className="km-slot-grid" aria-label="ช่องอัปโหลดด่วนพร้อมผูกกับแบบห้อง">
        <div className="km-slot-card">
          <h4>1. ช่องอัปโหลดแปลนห้อง / แปลนบ้าน (ผูกทันที)</h4>
          <p className="field-help">อัปโหลดรูปแปลนยูนิตหรือแปลนบ้านแต่ละชั้น ระบบจะผูกเข้ากับแบบห้องนี้และแสดงรูปตัวอย่างด้านบนทันที</p>
          <label className="form-field">
            ชื่อแปลน (เว้นว่างใช้ชื่อแบบห้องอัตโนมัติ)
            <input maxLength={200} placeholder={`เช่น แปลน ${item.public_name.th || "มาตรฐาน"}`} value={quickPlanTitle} disabled={disabled || pending || workflowBusy} onChange={e => setQuickPlanTitle(e.target.value)} />
          </label>
          <label className="form-field">
            {item.product_form === "house" || item.product_form === "townhome" ? "ชั้นของบ้าน (เช่น ชั้น 1, ชั้น 2)" : "ตำแหน่ง/รูปแบบแปลน (เช่น Type A, แปลนกลับด้าน)"}
            <input maxLength={100} placeholder={item.product_form === "house" || item.product_form === "townhome" ? "เช่น ชั้น 1" : "เช่น แปลนมาตรฐาน"} value={quickPlanFloor} disabled={disabled || pending || workflowBusy} onChange={e => setQuickPlanFloor(e.target.value)} />
          </label>
          <div className="ct-actions">
            <input ref={quickPlanRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" disabled={disabled || pending || workflowBusy || Boolean(binding || remove)} onChange={e => { setQuickPlanFiles(Array.from(e.target.files ?? [])); setError(""); }} />
            <button type="button" className="button secondary" disabled={disabled || pending || workflowBusy || Boolean(binding || remove)} onClick={() => quickPlanRef.current?.click()}>
              + เลือกไฟล์แปลนห้อง
            </button>
          </div>
          {quickPlanFiles.length > 0 && (
            <div className="ct-actions">
              <button type="button" className="button primary" disabled={disabled || pending || workflowBusy} onClick={() => void quickUploadAndBind("floor_plan")}>
                {pending ? "กำลังอัปโหลด…" : `อัปโหลดและผูกแปลนทันที (${quickPlanFiles.length} ไฟล์)`}
              </button>
              <button type="button" className="button text-button" disabled={pending || workflowBusy} onClick={() => { setQuickPlanFiles([]); if (quickPlanRef.current) quickPlanRef.current.value = ""; }}>
                ล้างไฟล์ที่เลือก
              </button>
            </div>
          )}
        </div>
        <div className="km-slot-card">
          <h4>2. ช่องอัปโหลดรูปห้องตัวอย่าง / บรรยากาศในห้อง (ผูกทันที)</h4>
          <p className="field-help">อัปโหลดรูปถ่ายห้องตัวอย่างหรือภาพ Perspective ภายในของแบบห้องนี้</p>
          {roomTags.length > 0 && (
            <label className="form-field">
              มุมห้องในภาพ
              <select value={quickPhotoRoom} disabled={disabled || pending || workflowBusy} onChange={e => setQuickPhotoRoom(e.target.value)}>
                <option value="">ยังไม่ระบุมุมห้อง</option>
                {roomTags.map(tag => <option key={tag.code} value={tag.code}>{tag.label.th}</option>)}
              </select>
            </label>
          )}
          <label className="form-field">
            คำบรรยายรูปห้องตัวอย่าง
            <input maxLength={200} placeholder={`เช่น ห้องนั่งเล่น ${item.public_name.th || ""}`.trim()} value={quickPhotoCaption} disabled={disabled || pending || workflowBusy} onChange={e => setQuickPhotoCaption(e.target.value)} />
          </label>
          <div className="ct-actions">
            <input ref={quickPhotoRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" disabled={disabled || pending || workflowBusy || Boolean(binding || remove)} onChange={e => { setQuickPhotoFiles(Array.from(e.target.files ?? [])); setError(""); }} />
            <button type="button" className="button secondary" disabled={disabled || pending || workflowBusy || Boolean(binding || remove)} onClick={() => quickPhotoRef.current?.click()}>
              + เลือกรูปห้องตัวอย่าง
            </button>
          </div>
          {quickPhotoFiles.length > 0 && (
            <div className="ct-actions">
              <button type="button" className="button primary" disabled={disabled || pending || workflowBusy} onClick={() => void quickUploadAndBind("model_image")}>
                {pending ? "กำลังอัปโหลด…" : `อัปโหลดและผูกรูปห้องทันที (${quickPhotoFiles.length} ไฟล์)`}
              </button>
              <button type="button" className="button text-button" disabled={pending || workflowBusy} onClick={() => { setQuickPhotoFiles([]); if (quickPhotoRef.current) quickPhotoRef.current.value = ""; }}>
                ล้างไฟล์ที่เลือก
              </button>
            </div>
          )}
        </div>
      </div>
    )}
    {canEdit && <form className="ct-upload" onSubmit={upload}>{uploadWaiting && <p role="status">{uploadText.waiting}</p>}<label className="form-field">{uploadText.purpose}<select value={purpose} disabled={disabled || pending} onChange={event => setPurpose(event.target.value)}>{["media", "floor_plan", "unit_plan", "structural_plan"].map(role => <option key={role} value={role}>{assetRoles[role as keyof typeof assetRoles] ?? uploadText.media}</option>)}</select></label>{purpose !== "structural_plan" && <UploadCategory value={category} onChange={setCategory} disabled={disabled || pending} />}<p className="field-help">{uploadText.limits}<br />{uploadText.pixel_limits}</p><div className="form-field"><label htmlFor={`${prefix}-files`}>อัปโหลดภาพหรือแปลนหลายไฟล์</label><input ref={fileRef} id={`${prefix}-files`} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" disabled={disabled || pending || workflowBusy || Boolean(binding || remove)} onChange={event => { setFiles(Array.from(event.target.files ?? [])); setError(""); }} /><p className="field-help">{uploadText.limits} · ไฟล์ใหม่รอตรวจสิทธิ์ อัปโหลดแล้วจึงกำหนดรายละเอียดในคลัง</p></div>{files.length > 0 && <><ul>{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}</li>)}</ul><div className="ct-actions"><button className="button secondary" disabled={disabled || pending || workflowBusy} type="submit">{pending ? "กำลังอัปโหลด…" : `อัปโหลด ${files.length} ไฟล์เข้าคลัง`}</button><button className="button text-button" disabled={pending || workflowBusy} type="button" onClick={() => { setFiles([]); if (fileRef.current) fileRef.current.value = ""; }}>ยกเลิกไฟล์ที่เลือก</button></div></>}</form>}
    {uploadResults.map((result, index) => <div key={index}><strong>{result.name}</strong><UploadResult value={result.upload} /></div>)}
    {library && <section className="ct-library" aria-label="คลังสื่อสำหรับแบบขาย"><h4>คลังสื่อร่วมกัน</h4><p className="field-help">ไฟล์ใช้ร่วมกับรายการอื่นได้ การเปลี่ยนสิทธิ์มีผลต่อทุกรายการที่ใช้ไฟล์นั้น</p>{!library.length && <p className="muted">ยังไม่มีไฟล์ในคลัง</p>}<div className="ct-library-list">{library.map(asset => <div key={asset.id}><span><strong>{asset.original_filename}</strong><RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} /></span>{canEdit && <button className="button secondary" disabled={disabled || dirty} onClick={() => { setRevision(project.updated_at); setBinding({ ...blankBinding(), asset_id: asset.id, title: asset.original_filename }); }}>ใช้ไฟล์<span className="visually-hidden"> {asset.original_filename}</span></button>}{permissions.can("projects", "approve") && <button className="button secondary" disabled={disabled || dirty} onClick={() => setReview(asset)}>ตรวจสิทธิ์<span className="visually-hidden"> {asset.original_filename}</span></button>}</div>)}</div></section>}
    {binding && <form className="ct-binding-form" onSubmit={bind}><h4>รายละเอียดไฟล์ · {library?.find(asset => asset.id === binding.asset_id)?.original_filename}</h4><fieldset disabled={disabled || pending}><legend className="visually-hidden">รายละเอียดการใช้ไฟล์</legend><div className="ct-field-grid"><div className="form-field"><label htmlFor={`${prefix}-role`}>ประเภทไฟล์</label><select id={`${prefix}-role`} value={binding.asset_role} onChange={event => setBinding({ ...binding, asset_role: event.target.value as BindingDraft["asset_role"] })}>{Object.entries(assetRoles).filter(([key]) => key !== "model_image" || library?.find(asset => asset.id === binding.asset_id)?.mime_type.startsWith("image/")).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="form-field"><label htmlFor={`${prefix}-plan-title`}>ชื่อแปลนหรือภาพ</label><input id={`${prefix}-plan-title`} required maxLength={200} value={binding.title} onChange={event => setBinding({ ...binding, title: event.target.value })} /></div><div className="form-field"><label htmlFor={`${prefix}-floor`}>{item.product_form === "house" || item.product_form === "townhome" ? "ชั้นของบ้านที่แปลนแสดง" : "ตำแหน่ง/ส่วนของแปลนห้อง"}</label><input id={`${prefix}-floor`} maxLength={100} value={binding.floor_label} onChange={event => setBinding({ ...binding, floor_label: event.target.value })} /></div><div className="form-field"><label htmlFor={`${prefix}-plan-revision`}>เลขฉบับหรือวันที่ของแปลน</label><input id={`${prefix}-plan-revision`} maxLength={100} value={binding.plan_revision} onChange={event => setBinding({ ...binding, plan_revision: event.target.value })} /></div></div><div className="form-field"><label htmlFor={`${prefix}-alt`}>คำอธิบายไฟล์ (ไทย)</label><textarea id={`${prefix}-alt`} required maxLength={1000} rows={2} value={binding.alt} onChange={event => setBinding({ ...binding, alt: event.target.value })} /></div><CommercialBindingExtras binding={binding} setBinding={setBinding} roomTags={roomTags} storeys={item.storeys} /><SourceChoices models={(project.models ?? []).filter(model => item.source_model_ids.includes(model.public_model_id))} selected={binding.applicability_model_ids} disabled={disabled || pending} onChange={ids => setBinding({ ...binding, applicability_model_ids: ids })} /><p className="field-help">เลือกรหัสที่เอกสารนี้ใช้ได้ตามหลักฐาน เว้นว่างหมายถึงยังไม่ระบุขอบเขต ไม่ใช่ใช้กับทุกยูนิต การเลือกยังรอการตรวจสอบ</p>{binding.asset_role === "structural_plan" && <p className="inline-warning">เก็บเป็นแบบโครงสร้างภายใน การตรวจสิทธิ์ไฟล์ไม่เท่ากับอนุมัติให้เผยแพร่แบบโครงสร้าง</p>}<div className="ct-actions"><button type="submit" className="button primary" aria-busy={pending}>{pending ? "กำลังบันทึก…" : "ผูกไฟล์กับแบบขาย"}</button><button type="button" className="button secondary" onClick={() => setBinding(null)}>ยกเลิกการผูกไฟล์</button></div></fieldset></form>}
    {review && <RightsDialog asset={review} uploadContext={{ ...uploadContext, category: review.media_category ?? null }} onCancel={() => setReview(null)} onSaved={async () => { await loadLibrary(); await onProjectChanged(await request<T>(`v1/admin/projects/${encodeURIComponent(project.public_project_id)}`)); setReview(null); }} onReload={async () => { await loadLibrary(); setReview(null); }} />}
  </section>;
}
