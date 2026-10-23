"use client";
import { createContext, useContext, useId, type ReactNode, type InputHTMLAttributes } from "react";
import { BilingualInput, ContentLabel, ExposureInput, FieldInfo, type ContentField, type Locales, type Exposure } from "./content-common";
import type { Asset } from "./project-assets";
export const MediaCatalog = createContext<ContentField[]>([]);
export function useMediaField(key?: string) { return useContext(MediaCatalog).find(field => field.field_key === key); }
export function MediaLabel({ fieldKey, id, children }: { fieldKey: string; id?: string; children: ReactNode }) { const field = useMediaField(fieldKey); return <ContentLabel htmlFor={id} field={field}>{field?.label.th ?? children}</ContentLabel>; }
export function MediaInput({ fieldKey, label, onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & { fieldKey: string; label: string; onChange: (value: string) => void }) {
  const generatedId = useId(), id = props.id ?? generatedId;
  return <div className="content-input"><MediaLabel fieldKey={fieldKey} id={id}>{label}</MediaLabel><input {...props} id={id} onChange={event => onChange(event.target.value)} /></div>;
}

export const categoryLabels: Record<string, string> = { exterior: "ภายนอก", interior: "ภายใน", facility: "ส่วนกลาง", lifestyle: "ไลฟ์สไตล์", aerial: "มุมสูง", surrounding: "รอบโครงการ", master_plan: "ผังโครงการ", floor_plan: "ผังชั้น", unit_plan: "แปลนแบบที่อยู่อาศัย", map: "แผนที่", progress: "ความคืบหน้าก่อสร้าง", promotion_ad: "แบนเนอร์โปรโมชัน", brochure: "โบรชัวร์", legal_document: "เอกสาร Legal (ส่วนตัว)" };
export const imageLabels = { photo: "ภาพถ่าย", render: "ภาพจำลอง", progress: "ภาพความคืบหน้า", drawing: "ภาพวาด / แบบ", stock: "ภาพสต็อก" };
export const targetLabels: Record<string, string> = { project: "โครงการ", facility: "ส่วนกลาง", commercial_type: "แบบที่อยู่อาศัย", building_floor: "อาคารและชั้น", promotion: "โปรโมชัน", selling_point: "จุดขาย", feature: "คุณสมบัติ", place: "สถานที่ใกล้เคียง" };
export const usageLabels = { gallery: "แกลเลอรี", card: "การ์ด", banner: "แบนเนอร์", evidence: "หลักฐาน" };
export type MediaTag = { code: string; label: Locales; tag_group: string; allowed_categories: string[]; status: string; revision: number };
export type Metadata = { media_category: string; caption: Locales; alt_text: Locales; image_kind: string | null; taken_at: string | null; people: string; third_party_marks: string; credit: Locales; tags: string[]; metadata_state: string; ai_exposure: Exposure; marketing_publication: boolean };
export type Suggestion = Metadata & { source_revision: number; model: string; suggested_at: string; confidence: number; proposed_tags: { code: string; label: Locales }[] };
export type MediaAsset = Asset & Metadata & { media_revision: number; ai_suggestion: Suggestion | null };
export type LinkContext = { target_type: string; target_key: string; usage: string; building_key: string | null; floor_from: number | null; floor_to: number | null; room_tag: string | null; is_primary: boolean; sort: number; effective_from?: string | null; effective_to?: string | null; ai_exposure?: Exposure };
export type MediaLink = LinkContext & { id: string; asset_id: string; revision: number };
export type ContextOption = { key: string; label: Locales; status?: string; floors_above?: number; storeys?: number; skip_floors?: number[] };
export type MediaContext = Record<"facilities" | "commercial_types" | "buildings" | "promotions" | "selling_points" | "features" | "places", ContextOption[]>;
export function targetName(target: { target_type: string; target_key: string }, context: MediaContext) {
  if (target.target_type === "project") return "โครงการนี้";
  const groups: Record<string, keyof MediaContext> = { facility: "facilities", commercial_type: "commercial_types", building_floor: "buildings", promotion: "promotions", selling_point: "selling_points", feature: "features", place: "places" };
  return context[groups[target.target_type]]?.find(item => item.key === target.target_key)?.label.th ?? targetLabels[target.target_type] ?? "รายการที่เกี่ยวข้อง";
}
export type Rule = { rule_key: string; label: Locales; per: string; media_category: string | null; usage: string | null; tags: string[]; min_count: number; target_count: number; blocks_publish: boolean; max_age_days: number | null; status: string; revision: number };
export type Coverage = { rule_key: string; label: Locales; context_label: string; kind: string; key: string; floor: number | null; count: number; target_count: number; min_count: number; blocks_publish: boolean; complete: boolean; minimum_met: boolean; context: LinkContext & { media_category: string | null; tags: string[] } };
export const newMetadata = (): Metadata => ({ media_category: "exterior", caption: {}, alt_text: {}, image_kind: "photo", taken_at: null, people: "unknown", third_party_marks: "unknown", credit: {}, tags: [], metadata_state: "needs_review", ai_exposure: "open", marketing_publication: false });
export function metadataOf(asset: MediaAsset): Metadata { const defaults = newMetadata(); return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, asset[key as keyof Metadata] ?? value])) as Metadata; }
export const newContext = (project: string): LinkContext => ({ target_type: "project", target_key: project, usage: "gallery", building_key: null, floor_from: null, floor_to: null, room_tag: null, is_primary: false, sort: 0 });
export function contextOf(link: MediaLink, project: string): LinkContext { return Object.fromEntries(Object.keys(newContext(project)).map(key => [key, link[key as keyof LinkContext]])) as LinkContext; }
export function Select({ label, value, options, onChange, empty, fieldKey }: { label: string; value: string; options: Record<string, string>; onChange: (value: string) => void; empty?: string; fieldKey?: string }) {
  const id = useId(), field = useMediaField(fieldKey);
  return <div className="content-input"><ContentLabel htmlFor={id} field={field}>{field?.label.th ?? label}</ContentLabel><select id={id} value={value} onChange={event => onChange(event.target.value)}>{empty !== undefined && <option value="">{empty}</option>}{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>;
}
export function MetaText({ id, label, value, onChange, maxLength = 1000, fieldKey }: { id: string; label: string; value: Locales; onChange: (value: Locales) => void; maxLength?: number; fieldKey?: string }) {
  const field = useMediaField(fieldKey);
  return <BilingualInput id={id} label={field?.label.th ?? label} field={field} value={value} onChange={onChange} maxLength={maxLength} rows={2} translationHint={false} />;
}
export function MetadataFields({ value, onChange, tags, id }: { value: Metadata; onChange: (value: Metadata) => void; tags: MediaTag[]; id: string }) {
  const change = <K extends keyof Metadata>(key: K, data: Metadata[K]) => onChange({ ...value, [key]: data });
  const tagsField = useMediaField("asset.tags"), stateField = useMediaField("asset.metadata_state");
  return <div className="media-fields"><Select fieldKey="asset.media_category" label="หมวดสื่อ" value={value.media_category} options={categoryLabels} onChange={media_category => onChange({ ...value, media_category, tags: [], ...(media_category === "legal_document" ? { ai_exposure: "internal", marketing_publication: false } : {}) })} />
    <Select fieldKey="asset.image_kind" label="ลักษณะภาพ" value={value.image_kind ?? ""} empty="ยังไม่ทราบ / ไม่ใช่ภาพ" options={imageLabels} onChange={v => change("image_kind", v || null)} />
    <MetaText fieldKey="asset.caption" id={`${id}-caption`} label="คำบรรยาย" value={value.caption} onChange={v => change("caption", v)} maxLength={2000} />
    <MetaText fieldKey="asset.alt_text" id={`${id}-alt`} label="คำอธิบายภาพสำหรับการเข้าถึง" value={value.alt_text} onChange={v => change("alt_text", v)} />
    <div className="content-input"><MediaLabel fieldKey="asset.taken_at" id={`${id}-date`}>วันที่ถ่าย</MediaLabel><input id={`${id}-date`} type="date" value={value.taken_at ?? ""} onChange={event => change("taken_at", event.target.value || null)} /></div>
    <Select fieldKey="asset.people" label="บุคคลในภาพ" value={value.people} options={{ unknown: "ยังไม่ทราบ", present: "มี", absent: "ยืนยันว่าไม่มี" }} onChange={v => change("people", v)} />
    <Select fieldKey="asset.third_party_marks" label="เครื่องหมายของบุคคลอื่น" value={value.third_party_marks} options={{ unknown: "ยังไม่ทราบ", present: "มี", absent: "ยืนยันว่าไม่มี" }} onChange={v => change("third_party_marks", v)} />
    <MetaText fieldKey="asset.credit" id={`${id}-credit`} label="เครดิตภาพ" value={value.credit} onChange={v => change("credit", v)} maxLength={500} />
    <fieldset className="media-tags"><legend>{tagsField?.label.th ?? "แท็กที่ยืนยันแล้ว"}</legend><FieldInfo field={tagsField} />{tags.filter(tag => value.tags.includes(tag.code) || tag.status === "active" && (!tag.allowed_categories.length || tag.allowed_categories.includes(value.media_category))).map(tag => <label key={tag.code}><input type="checkbox" checked={value.tags.includes(tag.code)} onChange={event => change("tags", event.target.checked ? [...value.tags, tag.code] : value.tags.filter(code => code !== tag.code))} />{tag.label.th}{tag.status !== "active" ? " · เลิกใช้ กรุณานำออก" : ""}</label>)}</fieldset>
    <ExposureInput value={value.ai_exposure} onChange={v => change("ai_exposure", v)} />
    <div><label className="media-check"><input type="checkbox" checked={value.metadata_state === "confirmed"} onChange={event => change("metadata_state", event.target.checked ? "confirmed" : "needs_review")} />ตรวจยืนยันข้อมูลภาพแล้ว (แยกจากการอนุมัติสิทธิ์)</label><FieldInfo field={stateField} /></div>
    {!["legal_document", "brochure"].includes(value.media_category) && <label className="media-check"><input type="checkbox" checked={value.marketing_publication} onChange={event => change("marketing_publication", event.target.checked)} />ภาพการตลาดเพื่อเผยแพร่ ขอคำแนะนำ AI ได้ · ไม่มีข้อมูลลูกค้า สัญญา เอกสาร Legal หรือการเงิน</label>}
  </div>;
}
export function TargetFields({ value, onChange, context, project, tags, canPromotions }: { value: LinkContext; onChange: (value: LinkContext) => void; context: MediaContext; project: string; tags: MediaTag[]; canPromotions: boolean }) {
  const source: Record<string, ContextOption[]> = { project: [{ key: project, label: { th: "โครงการนี้" } }], facility: context.facilities, commercial_type: context.commercial_types, building_floor: context.buildings, promotion: context.promotions, selling_point: context.selling_points, feature: context.features, place: context.places };
  const options = source[value.target_type] ?? [];
  const chosen = options.find(option => option.key === value.target_key);
  const floors = value.target_type === "building_floor" ? chosen?.floors_above : value.target_type === "commercial_type" ? chosen?.storeys : undefined;
  const floorOptions = Object.fromEntries(Array.from({ length: Math.min(floors ?? 0, 200) }, (_, i) => i + 1).filter(n => !chosen?.skip_floors?.includes(n)).map(n => [String(n), `ชั้น ${n}`]));
  return <div className="media-fields"><Select label="ใช้กับ" value={value.target_type} options={Object.fromEntries(Object.entries(targetLabels).filter(([key]) => key !== "promotion" || canPromotions))} onChange={target_type => onChange({ ...newContext(project), target_type, target_key: target_type === "project" ? project : "" })} />
    <Select label="เลือกรายการจากข้อมูลโครงการ" value={value.target_key} empty="เลือกรายการ" options={Object.fromEntries(options.map(option => [option.key, option.label.th ?? option.key]))} onChange={target_key => onChange({ ...value, target_key, building_key: value.target_type === "building_floor" ? target_key : null, floor_from: null, floor_to: null })} />
    {["building_floor", "commercial_type"].includes(value.target_type) && <><Select fieldKey="asset_link.floor_from" label="ตั้งแต่ชั้น" value={String(value.floor_from ?? "")} empty="ไม่ระบุชั้น" options={floorOptions} onChange={v => onChange({ ...value, floor_from: v ? Number(v) : null, floor_to: v ? Number(v) : null })} /><Select fieldKey="asset_link.floor_to" label="ถึงชั้น" value={String(value.floor_to ?? "")} empty="ไม่ระบุชั้น" options={floorOptions} onChange={v => onChange({ ...value, floor_to: v ? Number(v) : null })} /></>}
    <Select fieldKey="asset_link.usage" label="การใช้งาน" value={value.usage} options={usageLabels} onChange={usage => onChange({ ...value, usage })} />
    <Select fieldKey="asset_link.room_tag" label="ห้อง" value={value.room_tag ?? ""} empty="ไม่ระบุห้อง" options={Object.fromEntries(tags.filter(tag => tag.tag_group === "room" && tag.status === "active").map(tag => [tag.code, tag.label.th ?? tag.code]))} onChange={room_tag => onChange({ ...value, room_tag: room_tag || null })} />
    <label className="content-input">ลำดับ<input type="number" min={0} value={value.sort} onChange={event => onChange({ ...value, sort: Number(event.target.value) })} /></label>
    {value.target_type === "facility" && <label className="media-check"><input type="checkbox" checked={value.is_primary} onChange={event => onChange({ ...value, is_primary: event.target.checked })} />เป็นภาพปกส่วนกลาง (ได้หนึ่งภาพ)</label>}
    {value.target_type === "promotion" && <p className="field-help">ช่วงใช้งานถูกจำกัดตามวันเริ่มและสิ้นสุดโปรโมชัน</p>}
  </div>;
}
export function MediaPanel({ title, children }: { title: string; children: ReactNode }) { return <section className="content-section"><h2>{title}</h2>{children}</section>; }
