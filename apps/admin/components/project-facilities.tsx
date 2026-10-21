"use client";
import { useHubPermissions } from "./accounts";
import { ContentLabel, useFieldCatalog } from "./content-common";

import { FormEvent, useEffect, useState } from "react";
import type { LocalRole } from "@/lib/local-session";
import type { Project } from "./hub-admin";
import { request } from "./hub-request";
import "./project-facilities.css";

export type Facility = {
  code: string; name_th: string; name_en: string; required: boolean;
  status: "present" | "absent" | "planned" | "unknown";
  description: Record<string, string>; location_note: string; access_note: string;
  evidence_note: string; expected_open_date: string | null;
  updated_at: string | null; updated_by: string | null;
};
export type Facilities = {
  review_status: "draft"; checklist_version: number; expected_count: number; collected_count: number;
  items: Facility[]; missing: { field: string; message: string }[];
};
const statusLabels = { present: "มี", absent: "ไม่มี", planned: "อยู่ในแผน", unknown: "ยังไม่ทราบ" };

export function ProjectFacilities({ project, role, disabled, onDirtyChange, onProjectChanged }: {
  project: Project; role: LocalRole; disabled: boolean;
  onDirtyChange: (dirty: boolean) => void; onProjectChanged: (project: Project) => void;
}) {
  const permissions = useHubPermissions();
  const { catalog } = useFieldCatalog();
  const [editing, setEditing] = useState<Facility | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const data = project.facilities;
  const canEdit = permissions.can("projects", "edit");
  useEffect(() => { onDirtyChange(Boolean(editing) || pending); return () => onDirtyChange(false); }, [editing, pending, onDirtyChange]);

  function edit(item: Facility, status = item.status, openDetails = false) {
    const draft = editing?.code === item.code ? editing : { ...item, description: { ...item.description } };
    setEditing({ ...draft, status, expected_open_date: status === "planned" ? draft.expected_open_date : null });
    if (!editing || openDetails) setDetailsOpen(openDetails);
    setError(""); setNotice("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing || disabled || pending || !canEdit) return;
    setPending(true); setError(""); setNotice("");
    try {
      const next = await request<Project>(`v1/admin/projects/${encodeURIComponent(project.public_project_id)}/facilities/${encodeURIComponent(editing.code)}`, "PUT", {
        updated_at: project.updated_at, status: editing.status, description: editing.description,
        location_note: editing.location_note, access_note: editing.access_note,
        evidence_note: editing.evidence_note, expected_open_date: editing.status === "planned" ? editing.expected_open_date || null : null,
      });
      onProjectChanged(next); setEditing(null); setNotice("บันทึกสิ่งอำนวยความสะดวกเป็นร่างแล้ว");
    } catch (error) { setError(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ"); }
    finally { setPending(false); }
  }

  return <section className="panel project-facilities" id="facilities" tabIndex={-1} aria-labelledby="facilities-title">
    <div className="panel-heading"><div><span className="section-chip">ข้อมูลจาก Marketing</span><h2 id="facilities-title">สิ่งอำนวยความสะดวก</h2><p>เลือกสถานะได้ทันที แล้วบันทึกทีละรายการ · เพิ่มรายละเอียดได้เมื่อจำเป็น</p></div>{data && <span className="count">{data.collected_count}/{data.expected_count}</span>}</div>
    <div className="panel-body">
      <p className="read-only-note">ข้อมูลร่างภายในสำหรับเตรียมตรวจสอบ ยังไม่รวมในการเผยแพร่ผ่าน API</p>
      {data ? <>
        <p className="field-help">ระบุสถานะรายการหลักแล้ว {data.collected_count} จาก {data.expected_count} รายการ · จำนวนนี้แสดงการรวบรวมข้อมูล ยังไม่ใช่ผลอนุมัติ</p>
        {disabled && canEdit && <p className="inline-warning">บันทึกหรือยกเลิกงานส่วนอื่นก่อนแก้ไขสิ่งอำนวยความสะดวก</p>}
        {error && <div className="notice error" role="alert">{error}<p className="field-help">ข้อมูลที่กรอกยังอยู่ หากร่างเปลี่ยนในหน้าต่างอื่น ให้เก็บข้อความก่อนโหลดใหม่</p></div>}
        {notice && <p className="notice success" role="status">{notice}</p>}
        <div className="table-scroll"><table className="facility-list"><caption className="sr-only">สถานะสิ่งอำนวยความสะดวก (ไม่กีดกันการเผยแพร่)</caption><thead><tr><th>รายการ</th><th>สถานะ</th><th>รายละเอียด</th></tr></thead>{data.items.map(item => {
          const active = editing?.code === item.code;
          const status = active ? editing.status : item.status;
          return <tbody className="facility-item" key={item.code} id={`facilities-${item.code}`} tabIndex={-1}>
          <tr><th scope="row"><h3>{item.name_th}</h3><p className="small-text muted">{item.required ? "รายการหลัก" : "ข้อมูลเพิ่มเติม"}</p></th><td>
          {!canEdit && <span>{statusLabels[status]}</span>}
          {canEdit && <fieldset className="facility-status-options" disabled={disabled || pending || Boolean(editing && !active)}>
            <legend className="sr-only">สถานะ{item.name_th}</legend>
            {Object.entries(statusLabels).map(([value, label]) => <label key={value} className="facility-status-option">
              <input type="radio" name={`facility-status-${item.code}`} value={value} checked={status === value} onChange={() => edit(item, value as Facility["status"])} />
              <span>{label}</span>
            </label>)}
          </fieldset>}</td><td>{canEdit && !active && <button type="button" className="button text-button" disabled={disabled || pending || Boolean(editing)} onClick={() => edit(item, item.status, true)}>รายละเอียด<span className="sr-only"> {item.name_th}</span></button>}</td></tr>
          {(active || item.description.th || item.description.en || item.access_note || item.expected_open_date || item.evidence_note) && <tr><td colSpan={3}>
          {active ? <form onSubmit={save} className="facility-editor">
            <p className="field-help">ยังไม่บันทึก · บันทึกหรือยกเลิกรายการนี้ก่อนเลือกสิ่งอำนวยความสะดวกถัดไป</p>
            <fieldset disabled={disabled || pending}><legend className="sr-only">แก้ไข{item.name_th}</legend>
              {editing.status === "planned" && <div className="form-field"><label htmlFor={`facility-date-${item.code}`}>วันที่คาดว่าจะเปิดใช้ (ถ้าทราบ)</label><input id={`facility-date-${item.code}`} type="date" value={editing.expected_open_date ?? ""} onChange={event => setEditing({ ...editing, expected_open_date: event.target.value || null })} /></div>}
              <details className="facility-detail-fields" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}><summary>รายละเอียดและแหล่งข้อมูล (ถ้ามี)</summary>
              <div className="form-field"><ContentLabel htmlFor={`facility-description-${item.code}`} field={catalog?.items.find(field => field.field_key === "facility.description")}>รายละเอียด{item.name_th}</ContentLabel><textarea id={`facility-description-${item.code}`} rows={3} maxLength={4000} value={editing.description.th ?? ""} onChange={event => setEditing({ ...editing, description: { ...editing.description, th: event.target.value } })} /></div>
              <div className="form-field"><label htmlFor={`facility-description-en-${item.code}`}>รายละเอียด{item.name_th} (ภาษาอังกฤษ)</label><textarea id={`facility-description-en-${item.code}`} rows={3} maxLength={4000} value={editing.description.en ?? ""} onChange={event => setEditing({ ...editing, description: { ...editing.description, en: event.target.value } })} /></div>
              <div className="form-field"><label htmlFor={`facility-location-${item.code}`}>ตำแหน่ง / อาคารที่ใช้ร่วมกัน</label><input id={`facility-location-${item.code}`} maxLength={2000} value={editing.location_note} onChange={event => setEditing({ ...editing, location_note: event.target.value })} /></div>
              <div className="form-field"><label htmlFor={`facility-access-${item.code}`}>เวลาและเงื่อนไขการใช้งาน</label><textarea id={`facility-access-${item.code}`} rows={2} maxLength={2000} value={editing.access_note} onChange={event => setEditing({ ...editing, access_note: event.target.value })} /></div>
              <div className="form-field"><label htmlFor={`facility-evidence-${item.code}`}>แหล่งข้อมูล / ผู้ให้ข้อมูล</label><textarea id={`facility-evidence-${item.code}`} rows={2} maxLength={2000} value={editing.evidence_note} onChange={event => setEditing({ ...editing, evidence_note: event.target.value })} /></div>
              </details>
            </fieldset>
            <div className="facility-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => { setEditing(null); setError(""); }}>ยกเลิก</button><button className="button primary" type="submit" aria-busy={pending} disabled={disabled || pending}>{pending ? "กำลังบันทึก…" : "บันทึกสิ่งอำนวยความสะดวก"}</button></div>
          </form> : <>{item.description.th && <p className="facility-description">{item.description.th}</p>}{item.description.en && <p className="facility-description" lang="en">{item.description.en}</p>}{item.access_note && <p className="small-text muted">เงื่อนไข: {item.access_note}</p>}{item.expected_open_date && <p className="small-text muted">คาดว่าจะเปิดใช้: {item.expected_open_date}</p>}{item.evidence_note && <details className="facility-evidence"><summary>แหล่งข้อมูลและประวัติบันทึก</summary><p>{item.evidence_note}</p>{item.updated_at && <p className="small-text muted">บันทึก {new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(item.updated_at))}</p>}</details>}</>}
          </td></tr>}
        </tbody>; })}</table></div>
      </> : <p className="muted">ยังไม่มีรายการสิ่งอำนวยความสะดวกจากระบบ</p>}
    </div>
  </section>;
}
