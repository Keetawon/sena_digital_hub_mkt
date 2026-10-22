"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { errorMessage, useFieldCatalog } from "./content-common";
import { useContentLocation } from "./content-operations-shared";
import { Preview, RightsBadge, uploadAsset } from "./project-assets";
import { categoryLabels, targetName, newContext, newMetadata, metadataOf, contextOf, MetadataFields, TargetFields, MediaPanel, MediaCatalog,
  type MediaAsset, type MediaLink, type MediaTag, type MediaContext, type Rule, type Coverage, type Metadata, type LinkContext } from "./media-common";
import { MediaClips, type Clip } from "./media-clips";
import { MediaRules } from "./media-rules";
import "./project-content.css";
import "./project-media.css";

type Workspace = { project: { id: string; public_project_id: string; name: { th?: string }; updated_at: string }; assets: MediaAsset[]; links: MediaLink[]; clips: Clip[]; context: MediaContext; tags: MediaTag[]; requirements: Rule[];
  checklist: { items: Coverage[]; recommended_score: number; required_missing: number; broken_links: Clip[]; unknown_coverage: { key: string; label: { th?: string } }[] } };
type Job = { id: string; kind: string; subject_id: string; status: string; error_code: string | null };
type Card = { id: string; file?: File; asset?: MediaAsset; metadata: Metadata; context: LinkContext; metadataSaved: boolean; link?: MediaLink; saved: boolean; selected: boolean; error: string };
const tabs = { checklist: "ภาพที่ยังขาด", upload: "อัปโหลดหลายไฟล์", library: "ภาพและเอกสาร", clips: "คลิปและทัวร์ 360", rules: "แท็กและเกณฑ์ภาพ" };
const jobLabels: Record<string, string> = { queued: "รอประมวลผล", running: "กำลังประมวลผล", done: "เสร็จแล้ว", failed: "ไม่สำเร็จ", superseded: "ข้อมูลหรือสิทธิ์เปลี่ยน กรุณาสั่งใหม่" };
const jobErrors: Record<string, string> = { provider_unavailable: "ยังไม่ได้เปิดบริการคำแนะนำ", provider_error: "บริการตอบกลับไม่สำเร็จ", invalid_result: "ผลไม่ผ่านการตรวจ", manual_required: "ผู้ให้บริการนี้ต้องกรอกและตรวจเอง", file_unavailable: "อ่านไฟล์ภาพไม่ได้", source_changed: "ข้อมูลหรือสิทธิ์เปลี่ยน", permission_revoked: "สิทธิ์ถูกเปลี่ยน" };

function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => { const local = URL.createObjectURL(file); setUrl(local); return () => URL.revokeObjectURL(local); }, [file]);
  // SVG/PDF preview uses the API's sanitized thumbnail only after upload.
  return /image\/(png|jpeg|webp)/.test(file.type) && url ? <img className="media-local-preview" src={url} alt={`ภาพก่อนอัปโหลด ${file.name}`} /> : <p>ตัวอย่างไฟล์จะแสดงหลังตรวจไฟล์และอัปโหลด</p>;
}

export function ProjectMediaWorkspace({ projectId }: { projectId: string }) {
  const { catalog, error: catalogError } = useFieldCatalog();
  const permissions = useHubPermissions(), canView = permissions.can("projects"), canEdit = permissions.can("projects", "edit");
  const [data, setData] = useState<Workspace | null>(null), [jobs, setJobs] = useState<Job[]>([]), [error, setError] = useState("");
  const [dirty, setDirty] = useState(false), [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const location = useContentLocation(dirty), current = location.params.get("tab") ?? "checklist";
  const tab = current in tabs ? current as keyof typeof tabs : "checklist";
  const base = `v1/admin/projects/${encodeURIComponent(projectId)}/media`;
  const permissionKey = JSON.stringify(permissions.capabilities.tabs);
  const reload = useCallback(async () => { const [value, queued] = await Promise.all([request<Workspace>(base), request<Job[]>(`${base}/jobs`)]); setData(value); setJobs(queued); }, [base]);
  useEffect(() => { let live = true;
    if (!canView) { setData(null); setJobs([]); return; }
    if (projectId) Promise.all([request<Workspace>(base), request<Job[]>(`${base}/jobs`)]).then(([value, queued]) => { if (live) { setData(value); setJobs(queued); setError(""); } }).catch(error => { if (live) setError(errorMessage(error)); });
    return () => { live = false; };
  }, [base, projectId, canView, permissionKey]);
  const act = async (work: () => Promise<unknown>) => { setError(""); try { await work(); await reload(); } catch (error) { setError(errorMessage(error)); } };
  const edit = (asset: MediaAsset) => { if (location.navigate({ tab: "upload" })) setEditingAsset(asset); };
  const deepLink = (item: Coverage) => {
    if (item.blocks_publish) return `/?project=${encodeURIComponent(projectId)}&media_role=${item.rule_key}&media_upload=1#assets`;
    return `/media?${new URLSearchParams({ project: projectId, tab: "upload", category: item.context.media_category ?? "exterior", target_type: item.kind, target_key: item.key, floor: String(item.floor ?? ""), tags: item.context.tags.join(","), usage: item.context.usage })}`;
  };
  return <MediaCatalog.Provider value={catalog?.items ?? []}><div className="content-workspace media-workspace"><header className="content-header"><a href={`/?project=${encodeURIComponent(projectId)}#assets`}>กลับไปข้อมูลโครงการและตรวจสิทธิ์ภาพ</a><h1>ภาพ คลิป และทัวร์ 360</h1><p>{data?.project.name.th ?? projectId}</p><p className="content-state">ข้อมูลร่างภายใน Hub · การยืนยันข้อมูลภาพแยกจากการอนุมัติสิทธิ์</p></header>
    {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}</p>}
    {!projectId ? <p>เลือกโครงการจากหน้ารวมก่อนจัดการสื่อ</p> : !canView ? <p>บัญชีนี้ไม่มีสิทธิ์ดูสื่อโครงการ</p> : !data ? <p role="status">กำลังโหลดสื่อ…</p> : <>
      <nav className="content-tabs" aria-label="ส่วนสื่อ">{Object.entries(tabs).map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} disabled={dirty && tab !== key} onClick={() => { if (location.navigate({ tab: key })) setEditingAsset(null); }}>{label}</button>)}</nav>
      {tab === "checklist" && <MediaPanel title="รายการภาพที่ยังขาด"><p>ความครบตามเป้าหมายแนะนำ {data.checklist.recommended_score}% · ยังขาดภาพจำเป็น {data.checklist.required_missing} รายการ</p><p>ภาพหลักและภาพย่อเท่านั้นที่เป็นเงื่อนไขเผยแพร่ ภาพอื่นเป็นเป้าหมายเก็บข้อมูล</p>
        {data.checklist.unknown_coverage.map(item => <p className="inline-warning" key={item.key}>ยังนับชั้นของ {item.label.th ?? item.key} ไม่ได้ กรุณาตรวจข้อมูลอาคารหรือแบบที่อยู่อาศัย</p>)}
        <ul className="content-checklist">{data.checklist.items.map(item => <li key={`${item.rule_key}-${item.key}-${item.floor}`}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span><div><strong>{item.label.th}</strong><p>{item.context_label} · {item.count}/{item.target_count} ภาพ · {item.blocks_publish ? "จำเป็น" : "แนะนำ"}</p>{!item.complete && canEdit && <a className="button secondary" href={deepLink(item)}>เติมภาพ · {item.label.th}</a>}</div></li>)}</ul>
        {data.checklist.broken_links.length > 0 && <div role="status"><h3>ลิงก์ที่ถูกซ่อน</h3><p>{data.checklist.broken_links.length} ลิงก์เปิดไม่ได้ เป็นส่วนตัว หรือถูกนำออก</p><button className="button secondary" onClick={() => location.navigate({ tab: "clips" })}>แก้ไขคลิปและทัวร์</button></div>}
      </MediaPanel>}
      {tab === "upload" && <MediaUpload key={`${projectId}-${editingAsset?.id ?? "new"}`} data={data} base={base} initialAsset={editingAsset} canEdit={canEdit} canPromotions={permissions.can("promotions", "edit")} query={location.params} onChanged={reload} onDirty={setDirty} />}
      {tab === "library" && <MediaPanel title="ภาพและเอกสารในโครงการ"><p>ไฟล์ที่อัปโหลดโดยคุณและยังไม่ผูกจะแสดงเพื่อให้ทำงานต่อได้</p><div className="media-grid">{data.assets.map(asset => {
        const links = data.links.filter(link => link.asset_id === asset.id), suggestion = asset.ai_suggestion;
        const mismatch = suggestion && (suggestion.media_category !== asset.media_category || links.some(link => link.target_type === "facility" && suggestion.tags.some(code => data.tags.some(tag => tag.code === code && tag.tag_group === "facility")) && !suggestion.tags.includes(link.target_key)));
        return <article className="media-card" key={asset.id}><Preview asset={asset} /><h3>{asset.original_filename}</h3><p>{categoryLabels[asset.media_category] ?? "ยังไม่จัดหมวด"} · {asset.metadata_state === "confirmed" ? "ยืนยันข้อมูลแล้ว" : "รอตรวจข้อมูล"}</p><RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} /><p>{asset.caption.th || "ยังไม่มีคำบรรยาย"}</p>
          {canEdit && <button className="button secondary" onClick={() => edit(asset)}>แก้ไขข้อมูลภาพ</button>}
          {suggestion && <div className="media-suggestion"><h4>คำแนะนำ AI · ยังไม่ยืนยัน</h4>{mismatch && <p role="alert" className="inline-warning">คำแนะนำต่างจากหมวดหรือส่วนกลางที่เลือก กรุณาตรวจภาพ</p>}<p>{categoryLabels[suggestion.media_category]} · {suggestion.caption.th}</p><p>คำอธิบายภาพ: {suggestion.alt_text.th}</p><p>แท็ก: {suggestion.tags.map(code => data.tags.find(tag => tag.code === code)?.label.th ?? code).join(" · ")}</p><details><summary>รายละเอียดคำแนะนำ</summary><p>ความมั่นใจ {Math.round(suggestion.confidence * 100)}% · {suggestion.model} · {suggestion.suggested_at}</p><p>แท็กเสนอใหม่: {suggestion.proposed_tags.map(tag => tag.label.th).join(" · ") || "ไม่มี"}</p><p>{suggestion.source_revision === asset.media_revision ? "ตรงกับข้อมูลล่าสุด" : "ข้อมูลภาพเปลี่ยนหลังให้คำแนะนำ"}</p></details></div>}
          {canEdit && asset.marketing_publication && asset.ai_exposure !== "internal" && asset.mime_type.startsWith("image/") && !["legal_document", "brochure"].includes(asset.media_category) && <button className="button secondary" onClick={() => void act(() => request(`${base}/jobs`, "POST", { kind: "image_suggestion", subject_id: asset.id, expected_revision: asset.media_revision }))}>ขอคำแนะนำ AI</button>}
          {links.map(link => <div className="media-binding" key={link.id}><p>{targetName(link, data.context)} · {link.is_primary ? "ภาพปก" : "ภาพประกอบ"}</p>{canEdit && <>{link.target_type === "facility" && <button className="button secondary" onClick={() => void act(() => request(`${base}/links/${link.id}`, "PUT", { expected_revision: link.revision, changes: { is_primary: !link.is_primary } }))}>{link.is_primary ? "ยกเลิกภาพปก" : "ตั้งเป็นภาพปก"}</button>}<button className="button danger" onClick={() => void act(() => request(`${base}/links/${link.id}/remove`, "POST", { expected_revision: link.revision }))}>นำการผูกนี้ออก</button></>}</div>)}
        </article>;
      })}</div>{!data.assets.length && <p>ยังไม่มีไฟล์ในโครงการ</p>}</MediaPanel>}
      {tab === "clips" && <MediaClips clips={data.clips} data={data} base={base} canEdit={canEdit} canPromotions={permissions.can("promotions", "edit")} onChanged={reload} onDirty={setDirty} />}
      {tab === "rules" && <MediaRules tags={data.tags} rules={data.requirements} canEdit={canEdit} canApprove={permissions.can("projects", "approve")} onChanged={reload} onDirty={setDirty} />}
      {jobs.length > 0 && <details className="content-section"><summary>สถานะคำแนะนำและการตรวจลิงก์</summary><button className="button secondary" disabled={dirty} onClick={() => void act(async () => {})}>โหลดสถานะล่าสุด</button><ul>{jobs.slice(0, 15).map(job => <li key={job.id}>{job.kind === "image_suggestion" ? "คำแนะนำภาพ" : "ข้อมูลและสถานะคลิป"} · {jobLabels[job.status] ?? job.status}{job.error_code ? ` · ${jobErrors[job.error_code] ?? "ตรวจข้อมูลแล้วลองใหม่"}` : ""}</li>)}</ul></details>}
    </>}
  </div></MediaCatalog.Provider>;
}

function MediaUpload({ data, base, initialAsset, canEdit, canPromotions, query, onChanged, onDirty }: { data: Workspace; base: string; initialAsset: MediaAsset | null; canEdit: boolean; canPromotions: boolean; query: URLSearchParams; onChanged: () => Promise<void>; onDirty: (value: boolean) => void }) {
  const initialContext = () => { const value = newContext(data.project.id); const kind = query.get("target_type"), key = query.get("target_key");
    if (kind && key) { value.target_type = kind; value.target_key = key; if (kind === "building_floor") value.building_key = key; }
    if (/^[1-9]\d{0,2}$/.test(query.get("floor") ?? "")) value.floor_from = value.floor_to = Number(query.get("floor"));
    if (["gallery", "card", "banner", "evidence"].includes(query.get("usage") ?? "")) value.usage = query.get("usage")!;
    return value;
  };
  const [batch, setBatch] = useState<Metadata>(() => ({ ...newMetadata(), ...(query.get("category") && categoryLabels[query.get("category")!] ? { media_category: query.get("category")! } : {}), tags: (query.get("tags") ?? "").split(",").filter(code => data.tags.some(t => t.code === code && t.status === "active")) }));
  const [context, setContext] = useState<LinkContext>(initialContext);
  const [cards, setCards] = useState<Card[]>(() => { const link = data.links.find(link => link.asset_id === initialAsset?.id); return initialAsset ? [{ id: crypto.randomUUID(), asset: initialAsset, metadata: metadataOf(initialAsset), context: link ? contextOf(link, data.project.id) : newContext(data.project.id), link, metadataSaved: false, saved: false, selected: true, error: "" }] : []; });
  const cardsRef = useRef(cards); cardsRef.current = cards;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = cards.some(card => !card.saved);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const change = (id: string, update: Partial<Card>) => setCards(previous => previous.map(card => card.id === id ? { ...card, ...update } : card));
  async function save() {
    setBusy(true); setError("");
    for (const original of cardsRef.current.filter(card => !card.saved)) {
      let card = { ...original };
      try {
        if (!canEdit) throw new Error("สิทธิ์แก้ไขถูกเปลี่ยน ข้อมูลที่พิมพ์ยังอยู่");
        if (!card.asset && card.file) { card.asset = (await uploadAsset(card.file)).asset as MediaAsset; change(card.id, { asset: card.asset }); }
        if (!card.asset) throw new Error("ยังไม่มีไฟล์");
        if (!card.metadataSaved) {
          // Recover only an exact acknowledged revision after a lost response;
          // a different editor's values still produce the normal stale error.
          if (card.error) {
            const current = (await request<Workspace>(base)).assets.find(asset => asset.id === card.asset!.id);
            const same = current && Object.entries(card.metadata).every(([key, value]) => {
              const actual = current[key as keyof Metadata];
              if (Array.isArray(value)) return JSON.stringify([...value].sort()) === JSON.stringify([...(actual as string[])].sort());
              if (value && typeof value === "object") return JSON.stringify(Object.entries(value).sort()) === JSON.stringify(Object.entries(actual as object).sort());
              return actual === value;
            });
            if (current && current.media_revision === card.asset.media_revision + 1 && same) { card.asset = current; card.metadataSaved = true; }
          }
          if (!card.metadataSaved) card.asset = await request<MediaAsset>(`${base}/assets/${card.asset.id}`, "PUT", { expected_revision: card.asset.media_revision ?? 0, changes: card.metadata });
          card.metadataSaved = true; change(card.id, { asset: card.asset, metadataSaved: true });
        }
        if (card.metadata.media_category !== "legal_document") {
          // A stable link ID makes a retry after a lost response recoverable.
          const latest = await request<Workspace>(base), existing = latest.links.find(link => link.id === (card.link?.id ?? card.id));
          const matching = existing?.asset_id === card.asset.id && Object.entries(card.context).every(([key, value]) => JSON.stringify(existing[key as keyof MediaLink]) === JSON.stringify(value));
          card.link = existing && matching ? existing : await request<MediaLink>(`${base}/links/${card.link?.id ?? card.id}`, "PUT", { expected_revision: card.link?.revision ?? 0, changes: { ...card.context, asset_id: card.asset.id } });
        }
        change(card.id, { saved: true, link: card.link, error: "" });
        if (card.file && card.metadata.marketing_publication && card.metadata.ai_exposure !== "internal" && card.asset.mime_type.startsWith("image/") && !["legal_document", "brochure"].includes(card.metadata.media_category)) {
          try { await request(`${base}/jobs`, "POST", { kind: "image_suggestion", subject_id: card.asset.id, expected_revision: card.asset.media_revision }); }
          catch (error) { change(card.id, { error: `บันทึกไฟล์แล้ว แต่ขอคำแนะนำไม่สำเร็จ: ${errorMessage(error)}` }); }
        }
      } catch (error) { change(card.id, { error: errorMessage(error) }); }
    }
    try { await onChanged(); } catch (error) { setError(errorMessage(error)); }
    setBusy(false);
  }
  return <MediaPanel title={initialAsset ? "แก้ไขข้อมูลภาพ" : "เตรียมภาพก่อนอัปโหลด"}>
    {!canEdit && <p className="notice">ไม่มีสิทธิ์แก้ไข ข้อมูลที่ยังไม่บันทึกคงอยู่</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!initialAsset && <fieldset disabled={busy || !canEdit}><legend>บริบทเริ่มต้นของไฟล์ใหม่</legend><TargetFields value={context} onChange={setContext} context={data.context} project={data.project.id} tags={data.tags} canPromotions={canPromotions} />
      <details><summary>ข้อมูลที่จะใช้กับไฟล์ใหม่ / ไฟล์ที่เลือก</summary><MetadataFields id="batch" value={batch} onChange={setBatch} tags={data.tags} /></details>
      <label className="content-input">เลือกหลายไฟล์ (สูงสุด 20 ไฟล์ ครั้งละไม่เกิน 10 MB ต่อไฟล์)<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf" onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        if (files.length + cards.length > 20 || files.some(file => file.size > 10 * 1024 * 1024)) { setError("เลือกได้ไม่เกิน 20 ไฟล์ และไม่เกิน 10 MB ต่อไฟล์"); return; }
        setCards(previous => [...previous, ...files.map(file => ({ id: crypto.randomUUID(), file, metadata: structuredClone(batch), context: structuredClone(context), metadataSaved: false, saved: false, selected: true, error: "" }))]); setError("");
      }} /></label>
      <button type="button" className="button secondary" disabled={!cards.some(card => card.selected && !card.saved)} onClick={() => setCards(previous => previous.map(card => card.selected && !card.saved ? { ...card, metadata: structuredClone(batch), context: structuredClone(context), metadataSaved: false } : card))}>แทนที่ข้อมูลและบริบทของไฟล์ที่เลือก</button>
    </fieldset>}
    <div className="media-grid">{cards.map((card, index) => <article className="media-card" key={card.id} aria-label={`ไฟล์ ${index + 1}`}>
      <h3>{card.asset?.original_filename ?? card.file?.name}</h3>{card.asset ? <Preview asset={card.asset} /> : card.file && <LocalPreview file={card.file} />}
      <p role="status">{card.saved ? "บันทึกแล้ว" : card.asset ? "อัปโหลดไฟล์แล้ว รอบันทึกข้อมูลหรือการผูก" : "ยังไม่อัปโหลด"}</p>
      {card.error && <p className="notice error" role="alert">{card.error}</p>}
      {!card.saved && <fieldset disabled={busy || !canEdit}><legend>ข้อมูลไฟล์ {index + 1}</legend><label className="media-check"><input type="checkbox" checked={card.selected} onChange={event => change(card.id, { selected: event.target.checked })} />เลือกเพื่อใช้ข้อมูลชุดเดียวกัน</label>
        <MetadataFields id={`card-${card.id}`} value={card.metadata} onChange={metadata => change(card.id, { metadata, metadataSaved: false })} tags={data.tags} />
        {card.metadata.media_category !== "legal_document" && <TargetFields value={card.context} onChange={context => change(card.id, { context })} context={data.context} project={data.project.id} tags={data.tags} canPromotions={canPromotions} />}
        {card.asset?.ai_suggestion && <button type="button" className="button secondary" onClick={() => { const suggestion = card.asset!.ai_suggestion!; change(card.id, { metadata: { ...card.metadata, media_category: suggestion.media_category, caption: suggestion.caption, alt_text: suggestion.alt_text, tags: suggestion.tags, image_kind: suggestion.image_kind, people: suggestion.people, third_party_marks: suggestion.third_party_marks, metadata_state: "needs_review" }, metadataSaved: false }); }}>นำคำแนะนำ AI มาแก้ไข (ยังไม่ยืนยัน)</button>}
        <button className="button secondary" onClick={() => setCards(previous => previous.filter(item => item.id !== card.id))}>นำออกจากชุดนี้{card.asset ? " · ไฟล์ยังอยู่ในคลัง" : ""}</button>
      </fieldset>}
    </article>)}</div>
    {cards.length > 0 && <div className="content-actions"><button className="button primary" disabled={busy || !canEdit || !dirty} onClick={() => void save()}>{busy ? "กำลังบันทึก…" : cards.some(card => card.error) ? "ลองบันทึกไฟล์ที่ยังไม่สำเร็จอีกครั้ง" : "อัปโหลดและบันทึกข้อมูล"}</button>{!dirty && <button className="button secondary" onClick={() => setCards([])}>เสร็จแล้ว ล้างรายการชุดนี้</button>}</div>}
    <p className="field-help">ไฟล์ที่อัปโหลดแล้วคงอยู่เมื่อเกิดข้อผิดพลาด สิทธิ์ภาพต้องผ่านการตรวจในหน้าโครงการก่อนใช้เผยแพร่</p>
  </MediaPanel>;
}
