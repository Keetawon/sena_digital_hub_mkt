"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { uploadFileError, type UploadContext } from "../lib/upload-context";
import { request } from "./hub-request";
import { BilingualInput, ContentLabel, errorMessage, type ContentField, type Locales } from "./content-common";
import { Preview, RightsBadge, uploadAsset } from "./project-assets";
import { newContext, newMetadata, type Coverage, type MediaAsset, type MediaLink } from "./media-common";
import "./km-hubs.css";

export type AmenityMedia = { assets: MediaAsset[]; links: MediaLink[]; checklist: { items: Coverage[] } };
export function FacilityPhotos({ projectId, code, media, fields, canEdit, onChanged, onEditingChange }: {
  projectId: string; code: string; media: AmenityMedia; fields: ContentField[]; canEdit: boolean; onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void;
}) {
  const links = media.links.filter(l => l.target_type === "facility" && l.target_key === code).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const cover = links.find(l => l.is_primary);
  const [editing, setEditing] = useState<{ asset: MediaAsset; caption: Locales } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [ordering, setOrdering] = useState<{ link: MediaLink; sort: string } | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadCaption, setUploadCaption] = useState("");
  const [waiting, setWaiting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = Boolean(editing) || Boolean(ordering) || uploadFiles.length > 0;
  useEffect(() => { onEditingChange(dirty || busy); return () => onEditingChange(false); }, [dirty, busy, onEditingChange]);
  async function act(action: () => Promise<unknown>, success: string) {
    if (!canEdit || busy) return;setBusy(true);setError("");setNotice("");
    try { await action();await onChanged();setEditing(null);setOrdering(null);setNotice(success); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function uploadInline(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || busy || !uploadFiles.length) return;
    const ctx: UploadContext = {
      v: 1,
      kind: "media_target",
      project_ref: projectId,
      target_type: "facility",
      target_key: code,
      category: "facility",
      usage: "gallery",
    };
    const invalid = uploadFiles.find(file => uploadFileError(file, ctx));
    if (invalid) {
      setError(`${invalid.name}: ${uploadFileError(invalid, ctx)}`);
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const mediaBase = `v1/admin/projects/${encodeURIComponent(projectId)}/media`;
    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        const uploaded = await uploadAsset(file, ctx, setWaiting);
        const asset = uploaded.asset as MediaAsset;
        const captionText = uploadCaption.trim() || `ภาพส่วนกลาง ${code}`;
        await request(`${mediaBase}/assets/${asset.id}`, "PUT", {
          expected_revision: asset.media_revision ?? 0,
          changes: {
            ...newMetadata(),
            media_category: "facility",
            image_kind: "photo",
            caption: uploadCaption.trim() ? { th: uploadCaption.trim() } : {},
            alt_text: { th: captionText },
          },
        });
        await request(`${mediaBase}/links/${crypto.randomUUID()}`, "PUT", {
          expected_revision: 0,
          changes: {
            ...newContext(""),
            target_type: "facility",
            target_key: code,
            usage: "gallery",
            is_primary: !cover && i === 0,
            sort: links.length + i,
            asset_id: asset.id,
          },
        });
      }
      const count = uploadFiles.length;
      setUploadFiles([]);
      setUploadCaption("");
      if (fileRef.current) fileRef.current.value = "";
      await onChanged();
      setNotice(`อัปโหลดและผูกภาพส่วนกลางสำเร็จ ${count} ภาพ`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setWaiting(false);
    }
  }
  return <section className="content-section" aria-label={`ภาพส่วนกลาง ${code}`}><h3>ภาพส่วนกลาง</h3>
    <p>ส่วนกลางที่มี: ขั้นต่ำ 1 ภาพ · เป้าหมาย 3 ภาพ · เลือกภาพปก 1 ภาพ</p>
    <p>{links.length} ภาพที่ผูกไว้ · {cover ? "เลือกภาพปกแล้ว" : "ยังไม่ได้เลือกภาพปก"}</p>
    <p className="field-help">เช็กลิสต์สื่อนับเฉพาะภาพที่ผ่านเงื่อนไขสิทธิ์และข้อมูลภาพ ใช้เกณฑ์เดียวกับหน้าสื่อโครงการ</p>
    {canEdit && !editing && !ordering && (
      <form className="km-slot-card" onSubmit={uploadInline}>
        <h4>อัปโหลดรูปส่วนกลางนี้โดยตรง</h4>
        {waiting && <p role="status">รอคิวอัปโหลดสักครู่…</p>}
        <div className="content-two-columns">
          <label className="content-input">
            เลือกรูปภาพส่วนกลาง (PNG, JPEG, WebP)
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { setUploadFiles(Array.from(e.target.files ?? [])); setError(""); }} />
          </label>
          <label className="content-input">
            คำบรรยายภาพส่วนกลาง (ไทย · ถ้ามี)
            <input maxLength={500} placeholder="เช่น สระว่ายน้ำระบบเกลือยาว 25 เมตร" value={uploadCaption} disabled={busy} onChange={e => setUploadCaption(e.target.value)} />
          </label>
        </div>
        {uploadFiles.length > 0 && (
          <div className="content-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setUploadFiles([]); if (fileRef.current) fileRef.current.value = ""; }}>
              ล้างไฟล์ที่เลือก
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? "กำลังอัปโหลด…" : `อัปโหลดและผูกภาพส่วนกลางทันที (${uploadFiles.length} ภาพ)`}
            </button>
          </div>
        )}
      </form>
    )}
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
