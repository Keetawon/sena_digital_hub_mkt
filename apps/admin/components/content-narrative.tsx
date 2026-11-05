"use client";
import { workspaceText } from "@/lib/unified-workspace";
import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { BilingualInput, ContentLabel, ExposureInput, exposureLabels, FieldInfo, contentDate, errorMessage, type ContentField, type Exposure, type Locales } from "./content-common";

type SectionVersion = { version_no: number; body: Locales; state: string; source_ref: string | null; ai_exposure: Exposure; created_at: string };
export type NarrativeSection = { id: string; section_key: string | null; revision: number; state: string; version: SectionVersion; history: SectionVersion[] };
export type SellingPoint = { point_key: string; revision: number; title: Locales; detail: Locales; icon_code: string; linked_feature_code: string | null; linked_fact_keys: string[]; sort: number; state: string; ai_exposure: Exposure; created_at?: string; history?: SellingPoint[] };
const features: Record<string, string> = { vmove: "VMOVE", joint_venture: "พันธมิตร", fresh_air: "อากาศบริสุทธิ์", pm25_filter: "กรอง PM2.5", universal_design: "การออกแบบเพื่อทุกคน", low_carbon: "ลดคาร์บอน", non_dee: "นอนดี", smart_camera: "กล้องอัจฉริยะ", smart_app: "แอปอัจฉริยะ", smart_home: "บ้านอัจฉริยะ", smart_parking: "ที่จอดรถอัจฉริยะ", bms: "ระบบจัดการอาคาร", solar_rooftop: "โซลาร์รูฟท็อป", ev_charger: "ชาร์จรถไฟฟ้า", cctv: "กล้องวงจรปิด", key_card: "คีย์การ์ด", guard_24h: "เจ้าหน้าที่รักษาความปลอดภัย", easy_pass: "ทางเข้าอัตโนมัติ", lift_lock: "ลิฟต์ล็อกชั้น" };
export const stateLabel = (state: string) => ({ DRAFT: workspaceText.DRAFT, IN_REVIEW: workspaceText.IN_REVIEW, APPROVED: workspaceText.APPROVED, PUBLISHED: workspaceText.PUBLISHED, RETURNED: workspaceText.RETURNED, WITHDRAWN: "ถอนฉบับแล้ว" }[state] ?? workspaceText.DRAFT);

export function ContentNarrative({ projectId, sections, points, fields, canEdit, onChanged, onEditingChange, showPoints = true }: {
  showPoints?: boolean; projectId: string; sections: NarrativeSection[]; points: SellingPoint[]; fields: ContentField[]; canEdit: boolean;
  onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void;
}) {
  const [section, setSection] = useState<{ key: string; revision: number; body: Locales; source: string; exposure: Exposure } | null>(null);
  const [point, setPoint] = useState<SellingPoint | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { onEditingChange(Boolean(section || point)); return () => onEditingChange(false); }, [section, point, onEditingChange]);
  const base = `v1/admin/projects/${encodeURIComponent(projectId)}`;
  const field = (key: string) => fields.find(item => item.field_key === key);
  async function mutate(path: string, method: string, body: unknown) {
    if (pending || !canEdit) return;
    setPending(true); setError(""); setNotice("");
    try { await request(path, method, body); await onChanged(); setSection(null); setPoint(null); setNotice("บันทึกฉบับแล้ว ยังไม่มีการเผยแพร่ขึ้นเว็บไซต์"); }
    catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  const editing = Boolean(section || point);
  return <section className="content-section"><h2>เนื้อหาและจุดขาย</h2><p className="field-help">ทุกครั้งที่บันทึกจะมีฉบับใหม่ ตรวจภาษาอังกฤษก่อนส่งตรวจ ฉบับที่ส่งตรวจแล้วเก็บไว้ในประวัติ</p>
    {error && <p className="notice error" role="alert">{error} ข้อความที่กรอกยังอยู่</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    <div className="content-card-list">{fields.filter(item => item.entity === "section" && item.status === "active" && !item.field_key.startsWith("section.corporate_")).map(item => {
      const current = sections.find(value => value.section_key === item.field_key);
      return <article className="content-card" key={item.field_key} data-workspace-field={item.field_key} tabIndex={-1}><div className="content-label"><h3>{item.label.th}</h3><FieldInfo field={item} /></div>
        {section?.key === item.field_key ? <form onSubmit={event => { event.preventDefault(); void mutate(`${base}/sections/${item.field_key}`, "PUT", { expected_revision: section.revision, changes: { body: section.body, source_ref: section.source || null, ai_exposure: section.exposure } }); }}><fieldset disabled={pending || !canEdit}>
          <BilingualInput id="section-body" field={item} value={section.body} onChange={body => setSection({ ...section, body })} rows={5} />
          <label className="content-input">แหล่งอ้างอิง<input maxLength={1000} value={section.source} onChange={event => setSection({ ...section, source: event.target.value })} /></label>
          <ExposureInput value={section.exposure} onChange={exposure => setSection({ ...section, exposure })} />
        </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => setSection(null)}>ยกเลิก</button><button className="button primary" disabled={pending || !canEdit || !section.body.th?.trim()}>บันทึกเนื้อหา</button></div></form>
          : <><p className="content-state">{current ? `${stateLabel(current.state)} · ฉบับ ${current.version.version_no}` : "ยังไม่มีเนื้อหา"}</p><p className="content-state">{current && exposureLabels[current.version.ai_exposure]}</p><p className="content-preserve">{current?.version.body.th}</p>{current?.version.body.en && <p className="content-preserve" lang="en">{current.version.body.en}</p>}
            {canEdit && <div className="content-actions"><button className="button secondary" disabled={editing || pending} onClick={() => { setSection({ key: item.field_key, revision: current?.revision ?? 0, body: { ...current?.version.body }, source: current?.version.source_ref ?? "", exposure: current?.version.ai_exposure ?? item.default_ai_exposure }); setError(""); }}>{current ? `แก้ไข ${item.label.th}` : `เพิ่ม ${item.label.th}`}</button>
              {current?.state === "DRAFT" && <button className="button secondary" disabled={editing || pending} onClick={() => void mutate(`${base}/sections/${item.field_key}/submit`, "POST", { expected_revision: current.revision })}>ส่งตรวจ {item.label.th}</button>}</div>}</>}
        {current && <details><summary>ประวัติ {item.label.th}</summary>{current.history.map(version => <div className="content-card" key={version.version_no}><strong>ฉบับ {version.version_no} · {stateLabel(version.state)} · {contentDate(version.created_at)}</strong><p className="content-preserve">{version.body.th}</p><p className="content-preserve" lang="en">{version.body.en}</p></div>)}</details>}
      </article>;
    })}</div>
    {showPoints && <><div className="content-toolbar"><h2>จุดขาย {points.length}/6 ข้อ</h2>{canEdit && !editing && <button className="button secondary" disabled={points.length >= 6} onClick={() => { setPoint({ point_key: "", revision: 0, title: {}, detail: {}, icon_code: "check", linked_feature_code: null, linked_fact_keys: [], sort: points.length + 1, state: "DRAFT", ai_exposure: "open" }); setError(""); }}>เพิ่มจุดขาย</button>}</div><p className="field-help">ต้องมี 3–6 ข้อ ชื่อจุดขายไม่เกิน 60 ตัวอักษร เชื่อมข้อเท็จจริงแทนการพิมพ์ตัวเลขในข้อความ</p>
    {point && <form onSubmit={event => { event.preventDefault(); void mutate(point.point_key ? `${base}/selling-points/${point.point_key}` : `${base}/selling-points`, point.point_key ? "PUT" : "POST", { expected_revision: point.revision, changes: { title: point.title, detail: point.detail, icon_code: point.icon_code, linked_feature_code: point.linked_feature_code, linked_fact_keys: point.linked_fact_keys, sort: point.sort, state: point.state, ai_exposure: point.ai_exposure } }); }}><fieldset disabled={pending || !canEdit}>
      <BilingualInput id="point-title" field={field("selling_point.title")} value={point.title} onChange={title => setPoint({ ...point, title })} maxLength={60} rows={2} />
      <BilingualInput id="point-detail" field={field("selling_point.detail")} value={point.detail} onChange={detail => setPoint({ ...point, detail })} maxLength={4000} />
      <div className="content-two-columns"><label className="content-input">สัญลักษณ์<select value={point.icon_code} onChange={event => setPoint({ ...point, icon_code: event.target.value })}>{["check", "home", "leaf", "shield", "location", "sun"].map(icon => <option key={icon} value={icon}>{{ check: "เครื่องหมายถูก", home: "บ้าน", leaf: "ใบไม้", shield: "ความปลอดภัย", location: "ทำเล", sun: "พลังงาน" }[icon]}</option>)}</select></label>
        <div className="content-input"><ContentLabel htmlFor="point-feature" field={field("selling_point.linked_feature_code")}>คุณสมบัติที่เกี่ยวข้อง</ContentLabel><select id="point-feature" value={point.linked_feature_code ?? ""} onChange={event => setPoint({ ...point, linked_feature_code: event.target.value || null })}><option value="">ไม่ระบุ</option>{Object.entries(features).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div></div>
      <fieldset className="content-checks"><legend>ข้อเท็จจริงที่เกี่ยวข้อง</legend>{fields.filter(item => item.entity === "project" && item.section === "facts" && item.status === "active").map(item => <label key={item.field_key}><input type="checkbox" checked={point.linked_fact_keys.includes(item.field_key)} onChange={event => setPoint({ ...point, linked_fact_keys: event.target.checked ? [...point.linked_fact_keys, item.field_key] : point.linked_fact_keys.filter(key => key !== item.field_key) })} />{item.label.th}</label>)}</fieldset>
      <div className="content-two-columns"><label className="content-input">ลำดับ<input type="number" min="0" max="1000" value={point.sort} onChange={event => setPoint({ ...point, sort: Number(event.target.value) })} /></label><ExposureInput value={point.ai_exposure} onChange={ai_exposure => setPoint({ ...point, ai_exposure })} /></div>
    </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => setPoint(null)}>ยกเลิก</button><button className="button primary" disabled={pending || !canEdit || !point.title.th?.trim()}>บันทึกจุดขาย</button></div></form>}
    <div className="content-card-list">{points.map(item => <article className="content-card" key={item.point_key} data-workspace-item={item.point_key} tabIndex={-1}><h3>{item.title.th}</h3><p className="content-preserve">{item.detail.th}</p><p lang="en">{item.title.en}</p>{canEdit && <button className="button secondary" disabled={editing || pending} onClick={() => { setPoint({ ...item, title: { ...item.title }, detail: { ...item.detail } }); setError(""); }}>แก้ไขจุดขาย {item.title.th}</button>}
      <details><summary>ประวัติจุดขาย</summary>{item.history?.map(version => <div className="content-card" key={version.revision}><strong>ฉบับ {version.revision} · {contentDate(version.created_at)}</strong><p>{version.title.th}</p><p>{version.detail.th}</p><p lang="en">{version.title.en}</p><p lang="en">{version.detail.en}</p></div>)}</details></article>)}</div>
    </>}
  </section>;
}
