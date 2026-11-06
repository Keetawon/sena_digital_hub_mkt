"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "./hub-request";
import { ContentWorkflow } from "./content-workflow";
import { BilingualInput, ContentLabel, ExposureInput, errorMessage, type Exposure, type FieldCatalog, type Locales } from "./content-common";

export type Contact = { id: string; revision: number; channel: string; value: string; url: string | null; label: Locales; shared_mailbox_confirmed: boolean; is_primary: boolean; sort: number; ai_exposure: Exposure };
const channels: Record<string, string> = { phone: "โทรศัพท์", call_center_ext: "หมายเลขต่อศูนย์บริการ", line_oa: "LINE Official Account", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", website: "เว็บไซต์", email: "อีเมลส่วนกลางบริษัท", messenger: "Messenger" };
const emptyContact: Contact = { id: "", revision: 0, channel: "phone", value: "", url: null, label: {}, shared_mailbox_confirmed: false, is_primary: false, sort: 0, ai_exposure: "web_only" };
const freeWebmail = (value: string) => ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com"].includes(value.trim().split("@")[1]?.toLowerCase());
const mailboxWarning = "ข้อควรระวัง: อีเมลนี้ใช้บริการอีเมลฟรี ใช้ได้หากเป็นกล่องส่วนกลางของบริษัท กรุณาตรวจว่าไม่ใช่ที่อยู่ส่วนบุคคล และให้ผู้อนุมัติอีกคนตรวจสอบก่อนเผยแพร่";

export function ContentContacts({ items, catalog, apiBase, canEdit, onChanged, onEditingChange }: {
  items: Contact[]; catalog: FieldCatalog; apiBase: string; canEdit: boolean; onChanged: () => Promise<void>; onEditingChange?: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState<Contact | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [workflowOwners, setWorkflowOwners] = useState<string[]>([]), [workflowRevision, setWorkflowRevision] = useState(0);
  const workflowActive = workflowOwners.length > 0;
  function workflowEditing(owner: string, active: boolean) {
    setWorkflowOwners(owners => owners.includes(owner) === active ? owners : active ? [...owners, owner] : owners.filter(value => value !== owner));
  }
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { onEditingChange?.(Boolean(editing || pending || workflowActive)); return () => onEditingChange?.(false); }, [editing, pending, workflowActive, onEditingChange]);
  const field = (key: string) => catalog.items.find(field => field.field_key === `contact.${key}`);
  function changes(item: Contact) {
    const { channel, value, url, label, shared_mailbox_confirmed, is_primary, sort, ai_exposure } = item;
    return { channel, value, label, shared_mailbox_confirmed, is_primary, sort, ai_exposure, url: channel === "email" ? `mailto:${value}` : url || null };
  }
  async function reloadWorkflow() { await onChanged(); setEditing(null); setError(""); setWorkflowRevision(value => value + 1); }
  async function save() {
    if (!editing || pending || workflowActive || !canEdit) return;
    setPending(true); setError(""); setNotice("");
    try {
      const { id, revision } = editing;
      await request(id ? `${apiBase}/${id}` : apiBase, id ? "PUT" : "POST", {
        expected_revision: revision, changes: changes(editing),
      });
      await onChanged(); setEditing(null); setNotice("บันทึกช่องทางติดต่อแล้ว");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <section className="content-section" aria-label="ช่องทางติดต่อ"><div className="content-toolbar"><h2>ช่องทางติดต่อ</h2>{canEdit && !editing && <button className="button secondary" disabled={pending || Boolean(workflowActive)} onClick={() => { setEditing({ ...emptyContact }); setError(""); setNotice(""); }}>เพิ่มช่องทางติดต่อ</button>}</div>
    <p className="field-help">ใช้ช่องทางธุรกิจของโครงการหรือองค์กร อีเมลใช้ได้ทุกโดเมน แต่ต้องยืนยันว่าเป็นกล่องส่วนกลางของบริษัท และผ่านผู้อนุมัติอีกคนก่อนเผยแพร่</p>
    {error && <p className="notice error" role="alert">{error} ข้อมูลที่กรอกยังอยู่</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {editing && <form ref={form} inert={Boolean(workflowActive)} onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || !canEdit}>
      <div className="content-two-columns"><div className="content-input"><ContentLabel htmlFor="contact-channel" field={field("channel")} /><select id="contact-channel" value={editing.channel} onChange={event => setEditing({ ...editing, channel: event.target.value, shared_mailbox_confirmed: false, url: null })}>{Object.entries(channels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div className="content-input"><ContentLabel htmlFor="contact-value" field={field("value")} /><input id="contact-value" required maxLength={1000} type={editing.channel === "email" ? "email" : "text"} aria-describedby={editing.channel === "email" && freeWebmail(editing.value) ? "contact-mailbox-warning" : undefined} value={editing.value} onChange={event => setEditing({ ...editing, value: event.target.value, shared_mailbox_confirmed: editing.channel === "email" ? false : editing.shared_mailbox_confirmed })} /></div></div>
      {!['email', 'phone', 'call_center_ext'].includes(editing.channel) && <div className="content-input"><ContentLabel htmlFor="contact-url" field={field("url")} /><input id="contact-url" type="url" required placeholder="https://" value={editing.url ?? ""} onChange={event => setEditing({ ...editing, url: event.target.value })} /></div>}
      {editing.channel === "email" && <><div role="status">{freeWebmail(editing.value) && <p id="contact-mailbox-warning" className="inline-warning">{mailboxWarning}</p>}</div><div className="content-checks"><label><input required type="checkbox" checked={editing.shared_mailbox_confirmed} onChange={event => setEditing({ ...editing, shared_mailbox_confirmed: event.target.checked })} />ยืนยันว่าเป็นกล่องอีเมลส่วนกลางของบริษัท ไม่ใช่ที่อยู่ส่วนบุคคล</label></div></>}
      <BilingualInput id="contact-label" field={field("label")} value={editing.label} rows={2} maxLength={300} onChange={value => setEditing({ ...editing, label: value })} />
      <div className="content-two-columns"><label className="content-input">ลำดับ<input type="number" min="0" max="1000" value={editing.sort} onChange={event => setEditing({ ...editing, sort: Number(event.target.value) })} /></label><ExposureInput value={editing.ai_exposure} onChange={value => setEditing({ ...editing, ai_exposure: value })} /></div>
      <div className="content-checks"><label><input type="checkbox" checked={editing.is_primary} onChange={event => setEditing({ ...editing, is_primary: event.target.checked })} />เป็นช่องทางหลักของประเภทนี้ (เลือกได้หนึ่งรายการ)</label></div>
    </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending || Boolean(workflowActive)} onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary" disabled={pending || Boolean(workflowActive) || !canEdit}>บันทึกช่องทางติดต่อ</button></div></form>}
    <div className="content-card-list">{items.map(item => <article className="content-card" key={item.id} data-workspace-item={item.id} tabIndex={-1}><h3>{item.label.th || channels[item.channel]}{item.is_primary ? " · ช่องทางหลัก" : ""}</h3><p>{item.value}</p>{item.url && <p>{item.url}</p>}{item.channel === "email" && freeWebmail(item.value) && <p className="inline-warning">{mailboxWarning}</p>}{canEdit && <button className="button secondary" disabled={Boolean(editing || pending || workflowActive)} onClick={() => { setEditing({ ...item, label: { ...item.label } }); setError(""); }}>แก้ไข {channels[item.channel]}</button>}<ContentWorkflow key={`${item.id}:${workflowRevision}`} target={{ kind: "contact", identity: { id: item.id } }} label={item.label.th || channels[item.channel]}
      revision={editing?.id === item.id ? editing.revision : item.revision} disabled={pending || Boolean(editing && editing.id !== item.id) || workflowOwners.some(owner => owner !== item.id)}
      draft={editing?.id === item.id ? { dirty: true, valid: canEdit && Boolean(editing.value.trim()), sourceStamp: { revision: editing.revision }, getChanges: () => form.current?.reportValidity() ? changes(editing) : null } : undefined}
      onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing(item.id, value)} /></article>)}</div>
    {!items.length && !editing && <p className="content-empty">ยังไม่มีช่องทางติดต่อที่บันทึก</p>}
  </section>;
}
