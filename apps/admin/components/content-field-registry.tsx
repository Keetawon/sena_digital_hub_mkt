"use client";

import { useState } from "react";
import { writingFieldSafe, writingText } from "@/lib/writing-aid";
import { request } from "./hub-request";
import { useHubPermissions } from "./accounts";
import { FieldInfo, useFieldCatalog, errorMessage, sectionLabel, type ContentField } from "./content-common";
import { useContentLocation } from "./content-operations-shared";

export function ContentFieldRegistry() {
  const permissions = useHubPermissions();
  const { catalog, error: loadError, reload } = useFieldCatalog();
  const [search, setSearch] = useState("");
  const [planned, setPlanned] = useState(false);
  const [editing, setEditing] = useState<ContentField | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useContentLocation(Boolean(editing));
  const canManage = Boolean(catalog?.can_manage && permissions.special("projects.manage_field_catalog"));
  async function save() {
    if (!editing || !canManage || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      await request(`v1/admin/content/fields/${encodeURIComponent(editing.field_key)}`, "PATCH", {
        expected_revision: editing.revision, changes: { label: editing.label, help: editing.help, owner_role: editing.owner_role,
          review_every_days: editing.review_every_days, required_for: editing.required_for, sort: editing.sort, ai_writing_enabled: editing.ai_writing_enabled === true },
      });
      setEditing(null); reload(); setNotice("บันทึกทะเบียนฟิลด์แล้ว");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <div className="content-workspace"><header className="content-header"><a href="/">กลับรายการโครงการ</a><h1>ทะเบียนฟิลด์</h1><p>ชื่อ คำแนะนำ เจ้าของข้อมูล และข้อกำหนดที่ใช้ร่วมกันในแบบฟอร์มและการตรวจความครบ</p></header>
    {(loadError || error) && <p className="notice error" role="alert">{error || loadError}</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {!catalog ? <p role="status">กำลังโหลดทะเบียนฟิลด์…</p> : <>
      {!canManage && <p className="read-only-note">อ่านทะเบียนได้ การแก้ไขต้องมีสิทธิ์จัดการทะเบียนฟิลด์สำหรับผู้ดูแลระบบ</p>}
      <section className="content-section"><div className="content-two-columns"><label className="content-input">ค้นหาฟิลด์<input value={search} onChange={event => setSearch(event.target.value)} /></label><div className="content-checks"><label><input type="checkbox" checked={planned} onChange={event => setPlanned(event.target.checked)} />รวมฟิลด์ที่เตรียมไว้สำหรับระยะถัดไป</label></div></div>
        <div className="content-card-list">{catalog.items.filter(field => (planned || field.status === "active") && `${field.label.th} ${field.field_key}`.toLowerCase().includes(search.toLowerCase())).map(field => <article className="content-card" key={field.field_key}>
          <div className="content-toolbar"><div><div className="content-label"><h2>{field.label.th}</h2><FieldInfo field={field} /></div><p className="field-help">{sectionLabel(field.section)} · {field.field_key}{field.status === "planned" ? " · เตรียมไว้ ยังไม่ใช้ตรวจความครบ" : ""}</p></div>{canManage && editing?.field_key !== field.field_key && <button className="button secondary" disabled={Boolean(editing)} onClick={() => { setEditing({ ...field, label: { ...field.label }, help: { ...field.help }, required_for: { ...field.required_for } }); setError(""); }}>แก้ไข {field.label.th}</button>}</div>
          {editing?.field_key === field.field_key && <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || !canManage}>
            <label className="content-input">ชื่อฟิลด์ภาษาไทย<input required value={editing.label.th ?? ""} onChange={event => setEditing({ ...editing, label: { ...editing.label, th: event.target.value } })} /></label>
            <label className="content-input">คำแนะนำ<textarea rows={3} value={editing.help.th ?? ""} onChange={event => setEditing({ ...editing, help: { ...editing.help, th: event.target.value } })} /></label>
            <div className="content-two-columns"><label className="content-input">ผู้รับผิดชอบ<input required value={editing.owner_role} onChange={event => setEditing({ ...editing, owner_role: event.target.value })} /></label><label className="content-input">ทบทวนทุกกี่วัน (เว้นว่างหากไม่มีรอบตายตัว)<input type="number" min="1" max="3650" value={editing.review_every_days ?? ""} onChange={event => setEditing({ ...editing, review_every_days: event.target.value ? Number(event.target.value) : null })} /></label></div>
            <div className="content-two-columns">{[["all", "ทุกประเภท"], ["condominium", "คอนโดมิเนียม"], ["house", "บ้าน"], ["townhome", "ทาวน์โฮม"]].map(([key, label]) => <label className="content-input" key={key}>ข้อกำหนด: {label}<select value={editing.required_for[key] ?? ""} onChange={event => { const next = { ...editing.required_for }; if (event.target.value) next[key] = event.target.value as "required" | "recommended" | "optional"; else delete next[key]; setEditing({ ...editing, required_for: next }); }}><option value="">ใช้ค่าทุกประเภท</option><option value="required">จำเป็น</option><option value="recommended">แนะนำ</option><option value="optional">เพิ่มเติม</option></select></label>)}</div>
            {writingFieldSafe(editing) && <label className="content-checks"><input type="checkbox" checked={editing.ai_writing_enabled === true} onChange={event => setEditing({ ...editing, ai_writing_enabled: event.target.checked })} />{writingText.writing_enabled}</label>}
          </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary" disabled={pending || !canManage}>บันทึกทะเบียนฟิลด์</button></div></form>}
        </article>)}</div>
      </section>
      <section className="content-section"><h2>อีเมลติดต่อบริษัท</h2><p>ใช้ได้ทุกโดเมน ผู้บันทึกต้องยืนยันว่าเป็นกล่องส่วนกลางของบริษัท ไม่ใช่ที่อยู่ส่วนบุคคล บริการอีเมลฟรีจะแสดงคำเตือนโดยไม่กีดกันการบันทึก และยังต้องผ่านผู้อนุมัติอีกคนก่อนเผยแพร่</p></section>
    </>}
  </div>;
}
