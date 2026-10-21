"use client";
import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { BilingualInput, ContentLabel, ExposureInput, errorMessage, type Exposure, type FieldCatalog, type Locales } from "./content-common";

export type Contact = { id: string; revision: number; channel: string; value: string; url: string | null; label: Locales; shared_mailbox_confirmed: boolean; is_primary: boolean; sort: number; ai_exposure: Exposure };
const channels: Record<string, string> = { phone: "โทรศัพท์", call_center_ext: "หมายเลขต่อศูนย์บริการ", line_oa: "LINE Official Account", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", website: "เว็บไซต์", email: "อีเมลส่วนกลางบริษัท", messenger: "Messenger" };
const emptyContact: Contact = { id: "", revision: 0, channel: "phone", value: "", url: null, label: {}, shared_mailbox_confirmed: false, is_primary: false, sort: 0, ai_exposure: "web_only" };

export function ContentContacts({ items, catalog, apiBase, canEdit, onChanged, onEditingChange }: {
  items: Contact[]; catalog: FieldCatalog; apiBase: string; canEdit: boolean; onChanged: () => Promise<void>; onEditingChange?: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState<Contact | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { onEditingChange?.(Boolean(editing)); return () => onEditingChange?.(false); }, [editing, onEditingChange]);
  const field = (key: string) => catalog.items.find(field => field.field_key === `contact.${key}`);
  async function save() {
    if (!editing || pending || !canEdit) return;
    setPending(true); setError(""); setNotice("");
    try {
      const { id, revision, channel, value, url, label, shared_mailbox_confirmed, is_primary, sort, ai_exposure } = editing;
      await request(id ? `${apiBase}/${id}` : apiBase, id ? "PUT" : "POST", {
        expected_revision: revision, changes: { channel, value, label, shared_mailbox_confirmed, is_primary, sort, ai_exposure, url: channel === "email" ? `mailto:${value}` : url || null },
      });
      await onChanged(); setEditing(null); setNotice("บันทึกช่องทางติดต่อแล้ว");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <section className="content-section" aria-label="ช่องทางติดต่อ"><div className="content-toolbar"><h2>ช่องทางติดต่อ</h2>{canEdit && !editing && <button className="button secondary" onClick={() => { setEditing({ ...emptyContact }); setError(""); setNotice(""); }}>เพิ่มช่องทางติดต่อ</button>}</div>
    <p className="field-help">ใช้ช่องทางธุรกิจของโครงการหรือองค์กร อีเมลต้องเป็นกล่องส่วนกลางและอยู่ในโดเมนบริษัทที่อนุญาต</p>
    {error && <p className="notice error" role="alert">{error} ข้อมูลที่กรอกยังอยู่</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {editing && <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || !canEdit}>
      <div className="content-two-columns"><div className="content-input"><ContentLabel htmlFor="contact-channel" field={field("channel")} /><select id="contact-channel" value={editing.channel} onChange={event => setEditing({ ...editing, channel: event.target.value, shared_mailbox_confirmed: false, url: null })}>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div className="content-input"><ContentLabel htmlFor="contact-value" field={field("value")} /><input id="contact-value" required maxLength={1000} type={editing.channel === "email" ? "email" : "text"} value={editing.value} onChange={event => setEditing({ ...editing, value: event.target.value })} /></div></div>
      {!['email', 'phone', 'call_center_ext'].includes(editing.channel) && <div className="content-input"><ContentLabel htmlFor="contact-url" field={field("url")} /><input id="contact-url" type="url" required placeholder="https://" value={editing.url ?? ""} onChange={event => setEditing({ ...editing, url: event.target.value })} /></div>}
      {editing.channel === "email" && <div className="content-checks"><p className="field-help">โดเมนที่อนุญาต: {catalog.email_domains.join(", ") || "ยังไม่มี กรุณาให้ผู้ดูแลทะเบียนฟิลด์เพิ่มโดเมนบริษัทก่อน"}</p><label><input required type="checkbox" checked={editing.shared_mailbox_confirmed} onChange={event => setEditing({ ...editing, shared_mailbox_confirmed: event.target.checked })} />ยืนยันว่าเป็นกล่องอีเมลส่วนกลางของบริษัท ไม่ใช่ที่อยู่ส่วนบุคคล</label></div>}
      <BilingualInput id="contact-label" field={field("label")} value={editing.label} rows={2} maxLength={300} onChange={value => setEditing({ ...editing, label: value })} />
      <div className="content-two-columns"><label className="content-input">ลำดับ<input type="number" min="0" max="1000" value={editing.sort} onChange={event => setEditing({ ...editing, sort: Number(event.target.value) })} /></label><ExposureInput value={editing.ai_exposure} onChange={value => setEditing({ ...editing, ai_exposure: value })} /></div>
      <div className="content-checks"><label><input type="checkbox" checked={editing.is_primary} onChange={event => setEditing({ ...editing, is_primary: event.target.checked })} />เป็นช่องทางหลักของประเภทนี้ (เลือกได้หนึ่งรายการ)</label></div>
    </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary" disabled={pending || !canEdit || editing.channel === "email" && !catalog.email_domains.length}>บันทึกช่องทางติดต่อ</button></div></form>}
    <div className="content-card-list">{items.map(item => <article className="content-card" key={item.id}><h3>{item.label.th || channels[item.channel]}{item.is_primary ? " · ช่องทางหลัก" : ""}</h3><p>{item.value}</p>{item.url && <p>{item.url}</p>}{canEdit && <button className="button secondary" disabled={Boolean(editing)} onClick={() => { setEditing({ ...item, label: { ...item.label } }); setError(""); }}>แก้ไข {channels[item.channel]}</button>}</article>)}</div>
    {!items.length && !editing && <p className="content-empty">ยังไม่มีช่องทางติดต่อที่บันทึก</p>}
  </section>;
}
