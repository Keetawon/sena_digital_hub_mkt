"use client";
import { useCallback, useEffect, useState } from "react";
import { request } from "./hub-request";
import { errorMessage, type Locales } from "./content-common";
import { Preview, RightsBadge } from "./project-assets";
import { categoryLabels, imageLabels, Select, TargetFields, contextOf, newContext,
  type MediaAsset, type MediaContext, type MediaLink, type MediaTag, type LinkContext } from "./media-common";

type Source = { source_remark: string; page_url: string; fetched_at: string };
type Position = { media_category: string | null; tags: string[]; image_kind: string | null;
  positions: { label: string; context: Record<string, string> }[] };
type Suggestion = { id: string; asset_id: string; revision: number; asset_revision: number; source: Source;
  page_position: Position; agreement: number | null; links: MediaLink[] };
type Card = Suggestion & { selected: boolean; metadata: Pick<MediaAsset, "media_category" | "tags" | "image_kind">;
  contexts: Record<string, LinkContext> };
type Page = { total: number; items: Suggestion[] };
const title = "รูปจากเว็บไซต์ (รอยืนยัน)";

export function WebsiteMediaProjects() {
  const [items, setItems] = useState<{ public_project_id: string; public_name: Locales; pending: number }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let live = true;
    request<NonNullable<typeof items>>("v1/admin/media/website").then(value => { if (live) setItems(value); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, []);
  return <section className="content-section"><h2>{title}</h2><p>ดึงจากเว็บไซต์สาธารณะ SENA · รอตรวจข้อมูลและบริบทของภาพ</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {items === null ? !error && <p role="status">กำลังโหลดรายการ…</p> : items.length ? <ul>{items.map(item => <li key={item.public_project_id}>
      <a href={`/media?${new URLSearchParams({ project: item.public_project_id, tab: "website" })}`}>{item.public_name.th || item.public_project_id}</a> · {item.pending} ภาพ
    </li>)}</ul> : <p>ยังไม่มีภาพจากเว็บไซต์ที่รอยืนยัน</p>}
  </section>;
}

export function WebsiteMediaQueue({ base, project, assets, context, tags, canEdit, canPromotions, onChanged, onDirty }: {
  base: string; project: string; assets: MediaAsset[]; context: MediaContext; tags: MediaTag[]; canEdit: boolean; canPromotions: boolean;
  onChanged: () => Promise<void>; onDirty: (value: boolean) => void;
}) {
  const [cards, setCards] = useState<Card[]>([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [bulkCategory, setBulkCategory] = useState(""), [bulkTags, setBulkTags] = useState<string[]>([]);
  const [replaceTags, setReplaceTags] = useState(false);
  const [useContext, setUseContext] = useState(false), [bulkContext, setBulkContext] = useState<LinkContext>(() => newContext(project));
  const selected = cards.filter(card => card.selected), dirty = selected.length > 0;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const load = useCallback(async () => {
    const value = await request<Page>(`${base}/website?offset=${offset}`);
    setCards(value.items.map(item => ({ ...item, selected: false,
      metadata: { media_category: item.page_position.media_category ?? "", tags: item.page_position.tags, image_kind: item.page_position.image_kind },
      contexts: Object.fromEntries(item.links.map(link => [link.id, contextOf(link, project)])) })));
    setTotal(value.total); setLoaded(true);
  }, [base, offset, project]);
  useEffect(() => { setLoaded(false); setError(""); void load().catch(e => setError(errorMessage(e))); }, [load]);
  const change = (id: string, patch: Partial<Card>) => setCards(rows => rows.map(row => row.id === id ? { ...row, ...patch } : row));
  function applyBulk() {
    setCards(rows => rows.map(row => !row.selected ? row : { ...row,
      metadata: { ...row.metadata, media_category: bulkCategory || row.metadata.media_category,
        tags: replaceTags ? bulkTags : row.metadata.tags.filter(code => { const tag = tags.find(t => t.code === code); return tag && (!tag.allowed_categories.length || tag.allowed_categories.includes(bulkCategory || row.metadata.media_category)); }) },
      contexts: useContext ? Object.fromEntries(row.links.map(link => [link.id, { ...bulkContext }])) : row.contexts }));
  }
  async function confirm() {
    setBusy(true); setError(""); setMessage("");
    try {
      await request(`${base}/website/confirm`, "POST", { items: selected.map(card => ({ id: card.id,
        expected_revision: card.revision, asset_revision: card.asset_revision, metadata: card.metadata,
        links: card.links.map(link => ({ id: link.id, expected_revision: link.revision, changes: card.contexts[link.id] })) })) });
      setMessage(`ยืนยันหมวด แท็ก และบริบทแล้ว ${selected.length} ภาพ · สิทธิ์ภาพยังต้องผ่านผู้อนุมัติ`);
      await onChanged(); await load();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="content-section website-media"><h2>{title}</h2>
    <p>ดึงจากเว็บไซต์สาธารณะ SENA · คำแนะนำจากตำแหน่งบนหน้าเว็บยังไม่ใช่ข้อมูลที่ยืนยันแล้ว</p>
    <p>เรียงภาพที่คำแนะนำจากหน้าเว็บและ AI ตรงกันก่อน โดยเทียบหมวด แท็ก และลักษณะภาพ ไม่รวมบริบทที่ AI ไม่ได้ระบุ</p>
    {error && <div role="alert" className="notice error"><p>{error}</p><p>รายการที่เลือกและสิ่งที่แก้ไขยังอยู่</p></div>}
    {message && <p role="status">{message}</p>}
    {!loaded && !error && <p role="status">กำลังโหลดภาพ…</p>}
    {loaded && <p>{total} ภาพรอยืนยัน · แสดง {cards.length ? offset + 1 : 0}–{offset + cards.length}</p>}
    {canEdit && cards.length > 0 && <fieldset disabled={busy} className="website-batch"><legend>ตรวจและยืนยันเป็นชุด</legend>
      <label className="media-check"><input type="checkbox" checked={selected.length === cards.length} onChange={e => setCards(rows => rows.map(row => ({ ...row, selected: e.target.checked })))} />เลือกทั้งหมดในหน้านี้</label>
      <Select label="หมวดสำหรับรายการที่เลือก" value={bulkCategory} empty="คงหมวดแต่ละภาพ" options={categoryLabels} onChange={value => { setBulkCategory(value); setBulkTags([]); }} />
      <label className="media-check"><input type="checkbox" checked={replaceTags} onChange={e => setReplaceTags(e.target.checked)} />แทนที่แท็กของรายการที่เลือก</label>
      {replaceTags && <fieldset className="media-tags"><legend>แท็กสำหรับรายการที่เลือก</legend>{tags.filter(tag => tag.status === "active" && (!tag.allowed_categories.length || tag.allowed_categories.includes(bulkCategory))).map(tag => <label key={tag.code}>
        <input type="checkbox" checked={bulkTags.includes(tag.code)} onChange={e => setBulkTags(values => e.target.checked ? [...values, tag.code] : values.filter(value => value !== tag.code))} />{tag.label.th}
      </label>)}</fieldset>}
      <label className="media-check"><input type="checkbox" checked={useContext} onChange={e => setUseContext(e.target.checked)} />ใช้บริบทเดียวกันกับรายการที่เลือก</label>
      {useContext && <TargetFields value={bulkContext} onChange={setBulkContext} context={context} project={project} tags={tags} canPromotions={canPromotions} />}
      <button className="button secondary" disabled={!selected.length || !bulkCategory && !useContext && !replaceTags} onClick={applyBulk}>ใช้ค่ากับภาพที่เลือก</button>
      <button className="button" disabled={!selected.length || selected.some(card => !card.metadata.media_category)} onClick={() => void confirm()}>ยืนยัน {selected.length} ภาพที่เลือก</button>
      {dirty && <button className="button secondary" onClick={() => { setCards(rows => rows.map(row => ({ ...row, selected: false }))); setMessage(""); }}>ยกเลิกการเลือก</button>}
    </fieldset>}
    <div className="media-grid">{cards.map(card => {
      const asset = assets.find(item => item.id === card.asset_id);
      return <article className="media-card" key={card.id}>
        {asset && <><Preview asset={asset} /><RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} /></>}
        <h3>{asset?.original_filename ?? "ภาพจากเว็บไซต์"}</h3>
        <p>{card.agreement === null ? "ยังไม่มีผล AI ที่เทียบกับข้อมูลล่าสุดได้" : `ตรงกัน ${Math.round(card.agreement * 100)}% ของข้อมูลที่เปรียบเทียบได้`}</p>
        <p>ดึงจากเว็บไซต์สาธารณะ SENA · <a href={card.source.page_url} target="_blank" rel="noreferrer">ดูหน้าอ้างอิง</a></p>
        <p>ดึงข้อมูลเมื่อ {new Date(card.source.fetched_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · ไม่ทราบวันที่ถ่าย</p>
        <p>{card.page_position.positions.map(p => [p.label, ...Object.values(p.context)].filter(Boolean).join(" · ")).filter(Boolean).slice(0, 5).join(" / ") || "หน้าเว็บไม่ระบุบริบท"}</p>
        {asset?.ai_suggestion && <details><summary>คำแนะนำ AI · ยังไม่ยืนยัน</summary><p>{categoryLabels[asset.ai_suggestion.media_category]} · {asset.ai_suggestion.caption.th}</p><p>{asset.ai_suggestion.tags.map(code => tags.find(tag => tag.code === code)?.label.th ?? code).join(" · ")}</p></details>}
        {canEdit ? <fieldset disabled={busy}><legend>ข้อมูลที่จะยืนยัน</legend>
          <label className="media-check"><input type="checkbox" checked={card.selected} onChange={e => change(card.id, { selected: e.target.checked })} />เลือกภาพนี้</label>
          <p>{categoryLabels[card.metadata.media_category] || "ยังไม่จัดหมวด"} · {card.metadata.tags.map(code => tags.find(tag => tag.code === code)?.label.th ?? code).join(" · ") || "ยังไม่มีแท็ก"}</p>
          <details><summary>แก้ไขหมวด แท็ก และบริบท</summary>
          <Select label="หมวดภาพ" value={card.metadata.media_category} empty="เลือกหมวด" options={categoryLabels} onChange={media_category => change(card.id, { selected: true, metadata: { ...card.metadata, media_category, tags: [] } })} />
          <Select label="ลักษณะภาพ" value={card.metadata.image_kind ?? ""} empty="ยังไม่ทราบ" options={imageLabels} onChange={image_kind => change(card.id, { selected: true, metadata: { ...card.metadata, image_kind: image_kind || null } })} />
          <fieldset className="media-tags"><legend>แท็กภาพ</legend>{tags.filter(tag => tag.status === "active" && (!tag.allowed_categories.length || tag.allowed_categories.includes(card.metadata.media_category))).map(tag => <label key={tag.code}>
            <input type="checkbox" checked={card.metadata.tags.includes(tag.code)} onChange={e => change(card.id, { selected: true, metadata: { ...card.metadata, tags: e.target.checked ? [...card.metadata.tags, tag.code] : card.metadata.tags.filter(code => code !== tag.code) } })} />{tag.label.th}
          </label>)}</fieldset>
          {card.links.map(link => <details key={link.id}><summary>บริบทที่ต้องตรวจ · {link.target_type === "project" ? "โครงการ" : "รายการในโครงการ"}</summary>
            <TargetFields value={card.contexts[link.id]} onChange={value => change(card.id, { selected: true, contexts: { ...card.contexts, [link.id]: value } })} context={context} project={project} tags={tags} canPromotions={canPromotions} />
          </details>)}</details>
        </fieldset> : <p>{categoryLabels[card.metadata.media_category] || "ยังไม่จัดหมวด"} · ดูข้อมูลเท่านั้น</p>}
      </article>;
    })}</div>
    {loaded && !cards.length && <p>ไม่มีภาพในหน้านี้ที่รอยืนยัน</p>}
    <nav className="website-pagination" aria-label="หน้าคิวรูปเว็บไซต์"><button className="button secondary" disabled={busy || dirty || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 40))}>ก่อนหน้า</button>
      <button className="button secondary" disabled={busy || dirty || offset + 40 >= total} onClick={() => setOffset(value => value + 40)}>ถัดไป</button></nav>
  </section>;
}
