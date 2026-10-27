"use client";
import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { errorMessage, ExposureInput, type Locales, type Exposure } from "./content-common";
import { bangkokISO, localBangkok } from "./content-operations-shared";
import { MediaPanel, MediaInput, MetaText, Select, TargetFields, newContext, targetName, type MediaAsset, type MediaContext, type MediaTag, type LinkContext } from "./media-common";

export type Clip = { id: string; revision: number; provider: string; kind: string; tour_kind: string | null; url: string; title: Locales; description: Locales; published_at: string | null; captured_at: string | null; duration_sec: number | null; aspect: string | null; language: string | null; subtitles: string[]; channel_name: Locales; owner_type: string; is_sponsored: boolean; thumbnail_asset_id: string | null; is_featured: boolean; sort: number; state: string; ai_exposure: Exposure; targets: { target_type: string; target_key: string }[];
  provider_metadata?: { title?: Locales; channel_name?: Locales }; metadata_source?: string; metadata_fetched_at?: string | null; checked_at?: string | null; link_status?: string; visible?: boolean };
const providers = { youtube: "YouTube", tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", matterport: "Matterport", kuula: "Kuula", other: "อื่น ๆ" };
const kinds = { review: "รีวิว", walkthrough: "พาชม", tour_360: "ทัวร์ 360", drone: "โดรน", ad: "โฆษณา", interview: "สัมภาษณ์", progress: "ความคืบหน้า" };
const statuses = { ok: "เปิดได้", broken: "เปิดไม่ได้", private: "เป็นส่วนตัว", removed: "ถูกนำออก" };
const fields = ["provider", "kind", "tour_kind", "url", "title", "description", "published_at", "captured_at", "duration_sec", "aspect", "language", "subtitles", "channel_name", "owner_type", "is_sponsored", "thumbnail_asset_id", "is_featured", "sort", "state", "ai_exposure", "targets"] as const;
export function MediaClips({ clips, data, base, canEdit, canPromotions, onChanged, onDirty, initialTarget }: { initialTarget?: { target_type: string; target_key: string }; clips: Clip[]; data: { project: { id: string }; context: MediaContext; tags: MediaTag[]; assets: MediaAsset[] }; base: string; canEdit: boolean; canPromotions: boolean; onChanged: () => Promise<void>; onDirty: (value: boolean) => void }) {
  const [draft, setDraft] = useState<Clip | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [target, setTarget] = useState<LinkContext>(() => ({ ...newContext(data.project.id), ...initialTarget }));
  const [check, setCheck] = useState<Record<string, string>>({});
  useEffect(() => { onDirty(Boolean(draft)); return () => onDirty(false); }, [draft, onDirty]);
  const update = <K extends keyof Clip>(key: K, value: Clip[K]) => setDraft(prior => prior ? { ...prior, [key]: value } : null);
  async function action(work: () => Promise<unknown>) { setBusy(true); setError(""); try { await work(); await onChanged(); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }
  const save = async (fetchMetadata = false) => { if (!draft) return;
    const saved = await request<Clip>(`${base}/clips/${draft.id}`, "PUT", { expected_revision: draft.revision, changes: Object.fromEntries(fields.map(key => [key, draft[key]])) });
    setDraft(null);
    if (fetchMetadata) await request(`${base}/jobs`, "POST", { kind: "clip_metadata", subject_id: saved.id, expected_revision: saved.revision });
  };
  return <MediaPanel title="คลิปและทัวร์ 360"><p>วาง URL แล้วขอข้อมูลผู้ให้บริการ ชื่อและคำอธิบายที่ดึงมาเป็นคำแนะนำให้ตรวจเอง ลิงก์ที่เปิดไม่ได้จะถูกซ่อนและขึ้นรายการที่ต้องแก้ไข</p>
    <p className="field-help">ตรวจลิงก์ YouTube และ TikTok อัตโนมัติทุก 7 วัน ผู้ให้บริการอื่นใช้การกรอกข้อมูลและยืนยันผลตรวจด้วยตนเอง</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {canEdit && !draft && <button className="button primary" onClick={() => setDraft({ id: crypto.randomUUID(), revision: 0, provider: "youtube", kind: "walkthrough", tour_kind: null, url: "", title: {}, description: {}, published_at: null, captured_at: null, duration_sec: null, aspect: "landscape", language: "th", subtitles: [], channel_name: {}, owner_type: "sena_owned", is_sponsored: false, thumbnail_asset_id: null, is_featured: false, sort: 0, state: "DRAFT", ai_exposure: "open", targets: initialTarget ? [initialTarget] : [] })}>เพิ่มคลิปหรือทัวร์</button>}
    {draft && <form onSubmit={event => { event.preventDefault(); void action(() => save()); }}><fieldset disabled={busy || !canEdit}><legend>ข้อมูลคลิป</legend>
      <Select fieldKey="media_link.provider" label="ผู้ให้บริการ" value={draft.provider} options={providers} onChange={v => update("provider", v)} />
      <MediaInput fieldKey="media_link.url" label="URL คลิปหรือทัวร์" type="url" required maxLength={2048} value={draft.url} onChange={value => update("url", value)} />
      <Select fieldKey="media_link.kind" label="ชนิดคลิป" value={draft.kind} options={kinds} onChange={v => update("kind", v)} />
      {draft.kind === "tour_360" && <Select fieldKey="media_link.tour_kind" label="ชนิดทัวร์" value={draft.tour_kind ?? ""} empty="ยังไม่ระบุ" options={{ panorama: "พาโนรามา", virtual_walk: "เดินชมเสมือน", dollhouse: "มุมมองอาคาร 3 มิติ", other: "อื่น ๆ" }} onChange={v => update("tour_kind", v || null)} />}
      <MetaText fieldKey="media_link.title" id="clip-title" label="ชื่อคลิป" value={draft.title} onChange={v => update("title", v)} maxLength={500} />
      <MetaText fieldKey="media_link.description" id="clip-description" label="รายละเอียดคลิป" value={draft.description} onChange={v => update("description", v)} maxLength={4000} />
      <div className="content-grid"><MediaInput fieldKey="media_link.published_at" label="วันที่เผยแพร่ที่ผู้ให้บริการ (เวลาไทย)" type="datetime-local" value={localBangkok(draft.published_at ?? undefined)} onChange={value => update("published_at", value ? bangkokISO(value) : null)} />
        <MediaInput fieldKey="media_link.captured_at" label="วันที่ถ่ายคลิป" type="date" value={draft.captured_at ?? ""} onChange={value => update("captured_at", value || null)} />
        <MediaInput fieldKey="media_link.duration_sec" label="ความยาว (วินาที)" type="number" min={1} max={86400} value={draft.duration_sec ?? ""} onChange={value => update("duration_sec", value ? Number(value) : null)} />
        <Select fieldKey="media_link.aspect" label="สัดส่วนภาพ" value={draft.aspect ?? ""} empty="ยังไม่ทราบ" options={{ landscape: "แนวนอน", portrait: "แนวตั้ง", square: "จัตุรัส", panorama: "พาโนรามา" }} onChange={v => update("aspect", v || null)} />
        <Select fieldKey="media_link.language" label="ภาษาคลิป" value={draft.language ?? ""} empty="ยังไม่ทราบ" options={{ th: "ไทย", en: "อังกฤษ", other: "อื่น ๆ" }} onChange={v => update("language", v || null)} />
      </div><fieldset className="media-tags"><legend>ภาษาคำบรรยาย</legend>{Object.entries({ th: "ไทย", en: "อังกฤษ", other: "อื่น ๆ" }).map(([key, label]) => <label key={key}><input type="checkbox" checked={draft.subtitles.includes(key)} onChange={event => update("subtitles", event.target.checked ? [...draft.subtitles, key] : draft.subtitles.filter(v => v !== key))} />{label}</label>)}</fieldset>
      <MetaText fieldKey="media_link.channel_name" id="clip-channel" label="ชื่อช่อง" value={draft.channel_name} onChange={v => update("channel_name", v)} maxLength={300} />
      <Select fieldKey="media_link.owner_type" label="เจ้าของคลิป" value={draft.owner_type ?? ""} empty="ยังไม่ยืนยันเจ้าของ" options={{ sena_owned: "SENA", partner: "พันธมิตร", influencer: "อินฟลูเอนเซอร์" }} onChange={v => update("owner_type", v)} />
      <label className="media-check"><input type="checkbox" checked={draft.is_sponsored} onChange={event => update("is_sponsored", event.target.checked)} />เป็นเนื้อหาที่มีผู้สนับสนุน</label>
      <label className="media-check"><input type="checkbox" checked={draft.is_featured} onChange={event => update("is_featured", event.target.checked)} />คลิปแนะนำ</label>
      <Select fieldKey="media_link.thumbnail_asset_id" label="ภาพปกคลิป" value={draft.thumbnail_asset_id ?? ""} empty="ยังไม่เลือก" options={Object.fromEntries(data.assets.filter(asset => asset.mime_type.startsWith("image/") && asset.media_category !== "legal_document").map(asset => [asset.id, asset.original_filename]))} onChange={v => update("thumbnail_asset_id", v || null)} />
      <MediaInput fieldKey="media_link.sort" label="ลำดับคลิป" type="number" min={0} value={draft.sort} onChange={value => update("sort", Number(value))} />
      <ExposureInput value={draft.ai_exposure} onChange={v => update("ai_exposure", v)} />
      <details><summary>ผูกคลิปกับส่วนกลาง แบบที่อยู่อาศัย หรือรายการอื่น</summary><TargetFields value={target} onChange={setTarget} context={data.context} project={data.project.id} tags={data.tags} canPromotions={canPromotions} /><button type="button" className="button secondary" disabled={!target.target_key} onClick={() => update("targets", [...draft.targets.filter(t => t.target_type !== target.target_type || t.target_key !== target.target_key), { target_type: target.target_type, target_key: target.target_key }])}>เพิ่มรายการที่เกี่ยวข้อง</button><ul>{draft.targets.map(t => <li key={`${t.target_type}-${t.target_key}`}>{targetName(t, data.context)}<button type="button" className="button secondary" onClick={() => update("targets", draft.targets.filter(item => item !== t))}>นำออก</button></li>)}</ul></details>
      {draft.provider_metadata?.title && <div className="media-suggestion"><h3>ข้อมูลจากผู้ให้บริการ · ยังไม่ยืนยัน</h3><p>{draft.provider_metadata.title.th}</p><button type="button" className="button secondary" onClick={() => setDraft({ ...draft, title: draft.provider_metadata?.title ?? draft.title, channel_name: draft.provider_metadata?.channel_name ?? draft.channel_name })}>คัดลอกชื่อและช่องมาแก้ไข</button></div>}
      <div className="content-actions"><button className="button primary" type="submit">บันทึกคลิป</button><button className="button secondary" type="button" disabled={!draft.url} onClick={() => void action(() => save(true))}>บันทึกและดึงข้อมูลผู้ให้บริการ</button><button type="button" className="button secondary" onClick={() => setDraft(null)}>ยกเลิก</button></div>
    </fieldset></form>}
    <div className="media-grid">{clips.map(clip => <article className="media-card" key={clip.id}><h3>{clip.title.th || "คลิป"}</h3><p>{providers[clip.provider as keyof typeof providers]} · {kinds[clip.kind as keyof typeof kinds]} · {clip.visible ? "พร้อมใช้ในร่าง" : "ซ่อนจากร่าง"}</p><p>สถานะ: {statuses[clip.link_status as keyof typeof statuses] ?? "ยังไม่ตรวจ"} · {clip.checked_at ? "ตรวจแล้ว" : "ยังไม่ตรวจ"}</p><a href={clip.url} target="_blank" rel="noopener noreferrer">เปิดคลิปเพื่อตรวจ</a>{canEdit && !draft && <>
      <button className="button secondary" disabled={busy} onClick={() => { setDraft({ ...clip, targets: clip.targets.map(t => ({ target_type: t.target_type, target_key: t.target_key })) }); setError(""); }}>แก้ไขคลิป</button>
      <button className="button secondary" disabled={busy} onClick={() => void action(() => request(`${base}/jobs`, "POST", { kind: "clip_check", subject_id: clip.id, expected_revision: clip.revision }))}>ตรวจลิงก์อัตโนมัติ</button>
      <Select label={`ผลตรวจด้วยตนเอง · ${clip.title.th}`} value={check[clip.id] ?? ""} empty="เลือกผลหลังเปิดตรวจ" options={statuses} onChange={v => setCheck(previous => ({ ...previous, [clip.id]: v }))} />
      <button className="button secondary" disabled={busy || !check[clip.id]} onClick={() => void action(() => request(`${base}/clips/${clip.id}/check`, "POST", { expected_revision: clip.revision, decision: check[clip.id] }))}>บันทึกผลตรวจลิงก์</button>
      <button className="button danger" disabled={busy} onClick={() => void action(() => request(`${base}/clips/${clip.id}`, "PUT", { expected_revision: clip.revision, changes: { state: clip.state === "WITHDRAWN" ? "DRAFT" : "WITHDRAWN" } }))}>{clip.state === "WITHDRAWN" ? "คืนเป็นร่าง" : "ถอนคลิปจากร่าง"}</button>
    </>}</article>)}</div>{!clips.length && <p>ยังไม่มีคลิปหรือทัวร์</p>}
  </MediaPanel>;
}
