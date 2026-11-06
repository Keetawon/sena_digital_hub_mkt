"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "./hub-request";
import { ContentWorkflow } from "./content-workflow";
import { ContentLabel, ExposureInput, FieldInfo, contentDate, errorMessage, type ContentField, type Exposure } from "./content-common";

export type ProjectFact = {
  id: string; fact_key: string; grain: string; revision: number; value_number: number | null;
  value_text: { th?: string } | null; unit: string | null; as_of: string | null; valid_to: string | null;
  override_reason: string | null; ai_exposure: Exposure; source: string; rem_value: unknown;
  basis: { th?: string; expected_annual_rent?: number; price?: number };
};
export type RemFacts = { as_of?: string; land_area_sqwah?: number | null; unit_total?: number | null; unit_counted?: number | null; project_status?: string | null };
type Editing = { id?: string; field: ContentField; revision: number; value: string; unit: string; asOf: string; validTo: string; reason: string; countChoice: string; exposure: Exposure; basis: string; rent: string; price: string };

function rai(value: number) {
  const rai = Math.floor(value / 400), ngan = Math.floor((value % 400) / 100), wah = value % 100;
  return `${rai} ไร่ ${ngan} งาน ${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(wah)} ตร.ว.`;
}

export function ContentFacts({ projectId, facts, rem, computed, fields, canEdit, onChanged, onEditingChange }: {
  projectId: string; facts: ProjectFact[]; rem: RemFacts; computed: Record<string, number | null>;
  fields: ContentField[]; canEdit: boolean; onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [workflowOwners, setWorkflowOwners] = useState<string[]>([]), [workflowRevision, setWorkflowRevision] = useState(0);
  const workflowActive = workflowOwners.length > 0;
  function workflowEditing(owner: string, active: boolean) {
    setWorkflowOwners(owners => owners.includes(owner) === active ? owners : active ? [...owners, owner] : owners.filter(value => value !== owner));
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { onEditingChange(Boolean(editing || pending || workflowActive)); return () => onEditingChange(false); }, [editing, pending, workflowActive, onEditingChange]);
  function edit(field: ContentField, fact?: ProjectFact) {
    const remValue = rem[field.field_key.split(".")[1] as keyof RemFacts];
    setEditing({ id: fact?.id, field, revision: fact?.revision ?? 0, value: fact?.value_number != null ? String(fact.value_number) : typeof remValue === "number" ? String(remValue) : "",
      unit: fact?.unit ?? field.unit ?? "", asOf: fact?.as_of ?? "", validTo: fact?.valid_to ?? "", reason: fact?.override_reason ?? "",
      countChoice: "", exposure: fact?.ai_exposure ?? field.default_ai_exposure, basis: fact?.basis.th ?? "", rent: fact?.basis.expected_annual_rent != null ? String(fact.basis.expected_annual_rent) : "", price: fact?.basis.price != null ? String(fact.basis.price) : "" });
    setError(""); setNotice("");
  }
  function draftChanges(draft: Editing) {
    const changes: Record<string, unknown> = { value_number: Number(draft.value), unit: draft.unit || null, as_of: draft.asOf,
      valid_to: draft.validTo || null, override_reason: draft.reason || null, ai_exposure: draft.exposure,
      basis: draft.field.field_key === "project.rental_yield_gross_pct" ? { th: draft.basis, expected_annual_rent: Number(draft.rent), price: Number(draft.price) } : {} };
    if (draft.field.field_key === "project.unit_total") changes.unit_count_choice = draft.countChoice;
    return changes;
  }
  async function reloadWorkflow() { await onChanged(); setEditing(null); setError(""); setWorkflowRevision(value => value + 1); }
  async function save() {
    if (!editing || pending || workflowActive || !canEdit) return;
    setPending(true); setError(""); setNotice("");
    try {
      const changes = draftChanges(editing);
      await request(`v1/admin/projects/${encodeURIComponent(projectId)}/facts/${editing.field.field_key}`, "PUT", { expected_revision: editing.revision, grain: "project", changes });
      await onChanged(); setEditing(null); setNotice("บันทึกข้อเท็จจริงแล้ว");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  const selectedRem = editing?.field.field_key === "project.unit_total" && editing.countChoice === "rem_counted" ? rem.unit_counted : editing ? rem[editing.field.field_key.split(".")[1] as keyof RemFacts] : null;
  const override = editing?.field.source_policy === "rem_override" && typeof selectedRem === "number" && Number(editing.value) !== selectedRem;
  return <section className="content-section"><h2>ข้อเท็จจริงของโครงการ / เฟสนี้</h2><p className="field-help">ข้อมูลจาก REM ใช้สำเนาที่มีอยู่ใน Hub · ค่าว่างหมายถึงยังไม่ทราบ ไม่ใช่ไม่มี</p>
    {error && <p className="notice error" role="alert">{error} ข้อมูลที่กรอกยังอยู่</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    <div className="content-card-list">{fields.filter(field => field.entity === "project" && field.section === "facts" && field.status === "active").map(field => {
      const key = field.field_key.split(".")[1], fact = facts.find(fact => fact.fact_key === field.field_key && fact.grain === "project");
      const fromRem = rem[key as keyof RemFacts];
      const value = field.source_policy === "computed" ? computed[key] : field.source_policy === "rem" ? fromRem : fact?.value_number;
      const active = editing?.field.field_key === field.field_key;
      return <article className="content-card" key={field.field_key} data-workspace-field={field.field_key} tabIndex={-1}><div className="content-toolbar"><div><div className="content-label"><h3>{field.label.th}</h3><FieldInfo field={field} /></div><p>{value == null ? "ยังไม่ทราบ" : key === "land_area_sqwah" && typeof value === "number" ? rai(value) : String(value)}{value != null && key !== "land_area_sqwah" ? ` ${fact?.unit ?? field.unit ?? ""}` : ""}</p></div>
        {canEdit && ['mkt', 'rem_override'].includes(field.source_policy) && !active && <button className="button secondary" disabled={Boolean(editing || pending || workflowActive)} onClick={() => edit(field, fact)}>แก้ไข {field.label.th}</button>}</div>
        {field.source_policy === "computed" && <p className="field-help">คำนวณจากข้อมูลที่บันทึกแล้ว ไม่สามารถพิมพ์ค่าเอง</p>}
        {field.source_policy.startsWith("rem") && <div className="content-machine"><strong>จาก REM ณ {contentDate(rem.as_of)}</strong><p>{key === "unit_total" ? `จำนวนในข้อมูลโครงการ: ${rem.unit_total ?? "ยังไม่ทราบ"} · จำนวนยูนิตที่นับได้: ${rem.unit_counted ?? "ยังไม่ทราบ"}` : fromRem == null ? "ไม่มีค่าในสำเนาที่มีอยู่" : key === "land_area_sqwah" && typeof fromRem === "number" ? rai(fromRem) : String(fromRem)}</p></div>}
        {fact?.as_of && <p className="field-help">ข้อมูล ณ {contentDate(fact.as_of)}{fact.valid_to ? ` · ใช้ถึง ${contentDate(fact.valid_to)}` : ""}</p>}
        {fact?.override_reason && <p className="field-help">เหตุผลที่ใช้ค่าต่างจาก REM: {fact.override_reason}</p>}
        {active && editing && <form ref={form} inert={Boolean(workflowActive)} onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || !canEdit}>
          {key === "unit_total" && <label className="content-input">ยืนยันแหล่งจำนวนยูนิต<select required value={editing.countChoice} onChange={event => setEditing({ ...editing, countChoice: event.target.value, value: event.target.value === "rem_total" ? String(rem.unit_total ?? "") : event.target.value === "rem_counted" ? String(rem.unit_counted ?? "") : editing.value })}><option value="">เลือกค่าที่ Marketing ยืนยัน</option><option value="rem_total" disabled={rem.unit_total == null}>จำนวนในข้อมูลโครงการ REM</option><option value="rem_counted" disabled={rem.unit_counted == null}>จำนวนยูนิตที่นับได้จาก REM</option><option value="marketing">ค่าที่ Marketing ตรวจยืนยัน</option></select></label>}
          <div className="content-two-columns"><div className="content-input"><ContentLabel htmlFor={`fact-${key}`} field={field} /><input id={`fact-${key}`} required type="number" step={field.validation.integer ? "1" : "any"} min={field.validation.min ?? 0} value={editing.value} readOnly={key === "unit_total" && editing.countChoice.startsWith("rem_")} onChange={event => setEditing({ ...editing, value: event.target.value })} /></div>
          {field.validation.units && <label className="content-input">หน่วยตามประเภทที่อยู่อาศัย<select required value={editing.unit} onChange={event => setEditing({ ...editing, unit: event.target.value })}><option value="">เลือกหน่วย</option>{field.validation.units.map(unit => <option key={unit}>{unit}</option>)}</select></label>}</div>
          <div className="content-two-columns"><label className="content-input">วันที่ข้อมูล<input type="date" required value={editing.asOf} onChange={event => setEditing({ ...editing, asOf: event.target.value })} /></label><label className="content-input">วันที่สิ้นสุดข้อมูล (ถ้ามี)<input type="date" min={editing.asOf || undefined} value={editing.validTo} onChange={event => setEditing({ ...editing, validTo: event.target.value })} /></label></div>
          {override && <p className="inline-warning">ค่านี้ต่างจาก REM กรุณาระบุเหตุผลที่ Marketing ยืนยันค่าใหม่</p>}
          {field.source_policy === "rem_override" && <label className="content-input">เหตุผลที่ใช้ค่าต่างจาก REM<textarea rows={2} required={Boolean(override)} value={editing.reason} onChange={event => setEditing({ ...editing, reason: event.target.value })} /></label>}
          {key === "rental_yield_gross_pct" && <><p className="inline-warning">ประมาณการ ไม่รับประกัน · ผลตอบแทนต้องตรงกับค่าเช่าคาดหมายต่อปี ÷ ราคา</p><div className="content-two-columns"><label className="content-input">ค่าเช่าคาดหมายต่อปี (บาท)<input type="number" required min="0" step="any" value={editing.rent} onChange={event => setEditing({ ...editing, rent: event.target.value })} /></label><label className="content-input">ราคาที่ใช้เป็นฐาน (บาท)<input type="number" required min="0.01" step="any" value={editing.price} onChange={event => setEditing({ ...editing, price: event.target.value })} /></label></div><label className="content-input">ที่มาและสมมติฐาน<textarea required rows={3} value={editing.basis} onChange={event => setEditing({ ...editing, basis: event.target.value })} /></label></>}
          <ExposureInput value={editing.exposure} onChange={value => setEditing({ ...editing, exposure: value })} />
        </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending || Boolean(workflowActive)} onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary" disabled={pending || Boolean(workflowActive) || !canEdit}>บันทึกข้อเท็จจริง</button></div></form>}
        {fact && <ContentWorkflow key={`${fact.id}:${workflowRevision}`} target={{ kind: "fact", identity: { id: active && editing?.id ? editing.id : fact.id } }} label={field.label.th || field.field_key}
          revision={active && editing ? editing.revision : fact.revision} disabled={pending || Boolean(editing && !active) || workflowOwners.some(owner => owner !== fact.id)}
          draft={active && editing?.id ? { dirty: true, valid: canEdit && Boolean(editing.value.trim() && editing.asOf), sourceStamp: { revision: editing.revision }, getChanges: () => form.current?.reportValidity() ? draftChanges(editing) : null } : undefined}
          onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing(fact.id, value)} />}
      </article>;
    })}</div>
  </section>;
}
