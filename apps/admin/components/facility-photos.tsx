"use client";
import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { BilingualInput, ContentLabel, errorMessage, type ContentField, type Locales } from "./content-common";
import { Preview, RightsBadge } from "./project-assets";
import type { Coverage, MediaAsset, MediaLink } from "./media-common";

export type AmenityMedia = { assets: MediaAsset[]; links: MediaLink[]; checklist: { items: Coverage[] } };
export function FacilityPhotos({ projectId, code, media, fields, canEdit, onChanged, onEditingChange }: {
  projectId: string; code: string; media: AmenityMedia; fields: ContentField[]; canEdit: boolean; onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void;
}) {
  const links = media.links.filter(l => l.target_type === "facility" && l.target_key === code).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const cover = links.find(l => l.is_primary);
  const [editing, setEditing] = useState<{ asset: MediaAsset; caption: Locales } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [ordering, setOrdering] = useState<{ link: MediaLink; sort: string } | null>(null);
  const dirty = Boolean(editing) || Boolean(ordering);
  useEffect(() => { onEditingChange(dirty || busy); return () => onEditingChange(false); }, [dirty, busy, onEditingChange]);
  async function act(action: () => Promise<unknown>, success: string) {
    if (!canEdit || busy) return;setBusy(true);setError("");setNotice("");
    try { await action();await onChanged();setEditing(null);setOrdering(null);setNotice(success); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="content-section" aria-label={`ภาพส่วนกลาง ${code}`}><h3>ภาพส่วนกลาง</h3>
    <p>ส่วนกลางที่มี: ขั้นต่ำ 1 ภาพ · เป้าหมาย 3 ภาพ · เลือกภาพปก 1 ภาพ</p>
    <p>{links.length} ภาพที่ผูกไว้ · {cover ? "เลือกภาพปกแล้ว" : "ยังไม่ได้เลือกภาพปก"}</p>
    <p className="field-help">เช็กลิสต์สื่อนับเฉพาะภาพที่ผ่านเงื่อนไขสิทธิ์และข้อมูลภาพ ใช้เกณฑ์เดียวกับหน้าสื่อโครงการ</p>
    {!dirty && !busy && <>{canEdit && <a className="button secondary" href={`/media?project=${encodeURIComponent(projectId)}&tab=upload&target_type=facility&target_key=${encodeURIComponent(code)}&category=facility&tags=${encodeURIComponent(code)}`}>เพิ่มภาพส่วนกลาง</a>}
    <a className="button text-button" href={`/media?project=${encodeURIComponent(projectId)}&tab=checklist`}>ดูเช็กลิสต์ภาพ</a></>}
    {error && <p className="notice error" role="alert">{error} ข้อความที่กรอกยังอยู่</p>}{notice && <p role="status">{notice}</p>}
    <div className="c4-photo-grid">{links.map(link => { const asset = media.assets.find(a => a.id === link.asset_id);return asset && <article className="content-card" key={link.id}><Preview asset={asset} alt={asset.alt_text?.th || "ภาพส่วนกลาง"} /><p>{link.is_primary ? "ภาพปก" : "ภาพประกอบ"} · ลำดับ {link.sort}</p><RightsBadge status={asset.rights_status} />
      <p>{asset.caption?.th || "ยังไม่มีคำบรรยาย"}</p>{asset.caption?.en && <p lang="en">{asset.caption.en}</p>}
      {canEdit && <div className="content-actions"><button type="button" className="button secondary" disabled={busy || dirty || link.is_primary} onClick={() => void act(() => request(`v1/admin/projects/${projectId}/amenities/facilities/${code}/cover`, "POST", { link_id: link.id, expected_revision: link.revision, previous_cover_id: cover?.id ?? null, previous_revision: cover?.revision ?? 0 }), "เปลี่ยนภาพปกแล้ว")}>ตั้งเป็นภาพปก</button>
        <button type="button" className="button secondary" disabled={busy || dirty} onClick={() => setEditing({ asset, caption: asset.caption ?? {} })}>แก้คำบรรยายภาพ</button>
        <button type="button" className="button secondary" disabled={busy || dirty} onClick={() => setOrdering({ link, sort: String(link.sort) })}>แก้ลำดับภาพ</button></div>}
    </article>; })}</div>
    {editing && <form onSubmit={e => { e.preventDefault();void act(() => request(`v1/admin/projects/${projectId}/media/assets/${editing.asset.id}`, "PUT", { expected_revision: editing.asset.media_revision, changes: { caption: editing.caption } }), "บันทึกคำบรรยายภาพแล้ว"); }}><fieldset disabled={busy || !canEdit}><BilingualInput id="c4-caption" field={fields.find(f => f.field_key === "asset.caption")} value={editing.caption} onChange={caption => setEditing({ ...editing, caption })} translationHint={false} /></fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary" disabled={busy || !canEdit}>บันทึกคำบรรยาย</button></div></form>}
    {ordering && <form onSubmit={e => { e.preventDefault();void act(() => request(`v1/admin/projects/${projectId}/media/links/${ordering.link.id}`, "PUT", { expected_revision: ordering.link.revision, changes: { sort: Number(ordering.sort) } }), "บันทึกลำดับภาพแล้ว"); }}><fieldset disabled={busy || !canEdit}><ContentLabel htmlFor="c4-photo-sort" field={fields.find(f => f.field_key === "asset_link.sort")} /><input id="c4-photo-sort" type="number" min="0" step="1" value={ordering.sort} onChange={e => setOrdering({ ...ordering, sort: e.target.value })} required /></fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setOrdering(null)}>ยกเลิก</button><button className="button primary" disabled={busy || !canEdit}>บันทึกลำดับภาพ</button></div></form>}
  </section>;
}
