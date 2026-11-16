"use client";
import { ContentLabel, useFieldCatalog } from "./content-common";
import { useHubPermissions } from "./accounts";
import { ActorName } from "./accounts";

import { WorkspaceBack } from "./workspace-navigation";

import { FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalRole } from "@/lib/local-session";
import type { Project } from "./hub-admin";
import { ContentWorkflow } from "./content-workflow";
import { workflowText } from "@/lib/content-workflow";
import { AssetDialog, Preview, ProjectAssets, RightsBadge, type AssetBinding } from "./project-assets";
import { request } from "./hub-request";
import { WritingFields, useWritingTranslations } from "./content-common";
import { WritingAidError, type WritingAcceptance } from "@/lib/writing-aid";
import { DemoFields } from "./demo-fields";
import { BrandDashboard } from "./brand-dashboard";
import { brandHasChanges, useBrandReviews, type BrandSnapshot, type BrandVersion } from "./brand-review";
import { PublicationComparison } from "./publication-comparison";
import "./brand-admin.css";

type Localized = { th?: string; [locale: string]: string | undefined };
export type BrandSource = { rem_brand_id: string; brand_name_rem: string | null; brand_name_en_rem: string | null; is_deleted: boolean | null; deletion_status?: "active" | "deleted" | "unknown"; residential_project_count?: number; non_deleted_residential_project_count?: number | null; exception_codes?: string[]; source_updated_at: string | null; source_snapshot_at: string; source_fingerprint: string; source_record: Record<string, unknown> | null; intake_manifest_sha256: string | null; public_brand_id?: string | null };
export type BrandSummary = { demo_fields?: unknown; id: string; public_brand_id: string; rem_brand_id: string; public_name: Localized; status: "active" | "inactive"; publication_available: boolean };
export type Brand = BrandSummary & {
  publication_preview?: Record<string, unknown>; publication_preview_redacted?: boolean;
  description: Localized; slug: string; updated_at: string; published_version_id: string | null;
  unconfirmed_source_names?: string[]; source_name_provenance?: Record<string, unknown>; updated_by?: string | null;
  readiness: { ready: boolean; percent: number; missing: { field: string; message: string }[] };
  source: BrandSource; assets: AssetBinding[];
  projects: { id: string; public_project_id: string; public_name: Localized; source: { rem_project_id: string; rem_company_id: string | null; company_name_rem: string | null } }[];
};
type BrandRequest = { id: string; requested_name: string; rem_brand_id: string | null; reason: string; status: "open" | "resolved" | "rejected"; brand_id: string | null; resolution_reason: string | null; created_at: string; created_by: string; updated_at: string };

const message = (error: unknown) => error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง";
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "ไม่ได้ระบุ";
const sourceDate = (value?: string | null) => value ? date(value) : "ยังยืนยันเวลา/เขตเวลาต้นทางไม่ได้";
const sourceProvenance = (source: BrandSource) => source.intake_manifest_sha256 != null ? "สำเนา REM ที่ตรวจสอบหลักฐานแล้ว · ต้องตรวจเนื้อหาและการจับคู่ก่อนเผยแพร่ · ยังไม่ใช่ DW สด" : "ข้อมูลจำลองสำหรับเครื่องพัฒนา";
const brandHref = (id: string) => `/?brand=${encodeURIComponent(id)}`;
const sourceStatus = (source: BrandSource) => source.deletion_status ?? (source.is_deleted === false ? "active" : source.is_deleted === true ? "deleted" : "unknown");
const sourceExceptionLabels: Record<string, string> = { BLANK_THAI_NAME: "ไม่มีชื่อภาษาไทย", BLANK_ENGLISH_NAME: "ไม่มีชื่อภาษาอังกฤษ", DUPLICATE_THAI_NAME: "ชื่อภาษาไทยซ้ำ · ตรวจตามรหัส", UNKNOWN_DELETION_STATUS: "ยังไม่ทราบสถานะการลบ", PROJECT_BRAND_MISSING_DICTIONARY: "โครงการอ้างอิงรหัสที่ไม่พบในพจนานุกรม" };

function Loading() { return <div className="loading-state" role="status"><span className="spinner" />กำลังโหลดข้อมูลแบรนด์…</div>; }
function LoadError({ error, retry }: { error: string; retry: () => void }) { return <div className="notice error" role="alert"><span>{error}</span><button className="button secondary" onClick={retry}>โหลดข้อมูลใหม่</button></div>; }
function BrandStatus({ brand, changed, hasHistory }: { brand: BrandSummary & { published_version_id?: string | null }; changed?: boolean | null; hasHistory?: boolean }) {
  return <span className="brand-statuses"><span className={`status-badge ${brand.publication_available ? "published" : "draft"}`}>{brand.publication_available ? "เผยแพร่แล้ว" : brand.published_version_id || hasHistory ? "หยุดแสดง" : "ฉบับร่าง"}</span>{changed && (brand.published_version_id || hasHistory) && <span className="status-badge brand-unpublished">มีการแก้ไขรอเผยแพร่</span>}</span>;
}

export function BrandWorkspace({ brandId, role, onDirtyChange }: { brandId: string | null; role: LocalRole; onDirtyChange: (dirty: boolean) => void }) {
  return brandId ? <BrandDetail key={`${brandId}-${role}`} brandId={brandId} role={role} onDirtyChange={onDirtyChange} /> : <BrandOverview role={role} />;
}

function BrandOverview({ role }: { role: LocalRole }) {
  const permissions = useHubPermissions();
  const { rows, reload: load, enabled } = useBrandReviews();
  const brands = rows.map(row => row.brand);
  const [sources, setSources] = useState(false);
  if (!enabled) return <div className="notice error" role="alert">บัญชีนี้ไม่มีสิทธิ์เปิดรายการแบรนด์ กรุณาเลือกบทบาทที่มีสิทธิ์</div>;
  return <>
    <div className="page-heading"><div><p className="eyebrow">ข้อมูลแบรนด์ที่ใช้ร่วมกัน</p><h1>แบรนด์ที่อยู่อาศัย</h1><p className="muted">จัดเตรียมชื่อ รายละเอียด และโลโก้ให้ตรวจสอบก่อนเผยแพร่</p></div><span className="scope-pill"><span />SENA Residential</span></div>
    <BrandDashboard role={role} onChanged={load}>
      {permissions.special("brands.manage_catalog") && <BrandRequests role={role} brands={brands} />}
      <div className="section-heading"><h2>แบรนด์ในพื้นที่ทำงาน</h2><button className="button secondary" aria-expanded={sources} aria-controls="brand-source-picker" onClick={() => setSources(!sources)}>{sources ? "ปิดต้นทางแบรนด์" : "ดูแบรนด์จากต้นทาง"}</button></div>
      {sources && <BrandSourcePicker role={role} />}
    </BrandDashboard>
    {!permissions.special("brands.manage_catalog") && <BrandRequests role={role} brands={brands} />}
  </>;
}

function BrandSourcePicker({ role }: { role: LocalRole }) {
  const permissions = useHubPermissions();
  const [sources, setSources] = useState<BrandSource[]>([]);
  const [search, setSearch] = useState("");
  const [usage, setUsage] = useState("residential");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState<BrandSource | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => { setLoading(true); setError(""); try { setSources(await request<BrandSource[]>("v1/admin/sources/brands")); } catch (error) { setError(message(error)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function create(source: BrandSource) {
    setPending(source.rem_brand_id); setError("");
    try { const brand = await request<Brand>("v1/admin/brands", "POST", { rem_brand_id: source.rem_brand_id }); window.location.assign(brandHref(brand.public_brand_id)); }
    catch (error) { setError(message(error)); setPending(null); }
  }
  const filtered = sources.filter(source => (usage === "all" || (source.residential_project_count ?? 0) > 0) && `${source.rem_brand_id} ${source.brand_name_rem || ""} ${source.brand_name_en_rem || ""}`.toLocaleLowerCase("th").includes(search.trim().toLocaleLowerCase("th")));
  return <section className="panel" id="brand-source-picker"><div className="panel-heading"><div><h2>แบรนด์จากข้อมูลต้นทาง</h2><p>ตรวจแหล่งข้อมูลของแต่ละรายการ · รหัสและชื่อต้นทางอ่านอย่างเดียว</p></div></div><div className="panel-body">
    <div className="form-field"><label htmlFor="source-brand-usage">การใช้แบรนด์ในโครงการที่อยู่อาศัย</label><select id="source-brand-usage" value={usage} onChange={event => setUsage(event.target.value)}><option value="residential">แบรนด์ที่โครงการที่อยู่อาศัยใช้อ้างอิง</option><option value="all">ทุกแบรนด์ต้นทาง</option></select><p className="field-help">จำนวนเป็นการอ้างอิงต้นทาง รวมโครงการที่ปิดหรือลบแล้ว ต้องตรวจสอบก่อนใช้งาน</p></div>
    <div className="form-field"><label htmlFor="source-brand-search">ค้นหาแบรนด์ต้นทาง</label><input id="source-brand-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <p className="read-only-note">การสร้างแบรนด์เชื่อมเฉพาะรหัสต้นทาง ทีมงานต้องจัดเตรียมชื่อที่เผยแพร่ คำอธิบาย ชื่ออ้างอิง และโลโก้ใน Hub</p>
    {notice && <p className="notice success" role="status">{notice}</p>}{error && <LoadError error={error} retry={load} />}
    {loading ? <Loading /> : <><p className="small-text muted" role="status" aria-atomic="true">พบ {filtered.length} แบรนด์ต้นทาง</p>{!filtered.length && <p className="empty-state compact">ไม่พบแบรนด์ที่ตรงกับตัวกรอง</p>}<ul className="source-cards">{filtered.map(source => <li key={source.rem_brand_id}><div><h3>{source.brand_name_rem || "ยังไม่มีชื่อภาษาไทยต้นทาง"}</h3><p className="small-text source-code">รหัส REM {source.rem_brand_id} · {source.brand_name_en_rem || "ยังไม่มีชื่อภาษาอังกฤษต้นทาง"}</p><p className="small-text">สถานะต้นทาง: {sourceStatus(source) === "active" ? "ยังไม่ถูกลบ" : sourceStatus(source) === "deleted" ? "ถูกลบแล้ว · สร้างแบรนด์ไม่ได้" : "ยังไม่ทราบ · สร้างแบรนด์ไม่ได้"} · โครงการที่อยู่อาศัย {source.residential_project_count ?? 0} โครงการ</p><div className="brand-statuses">{(source.exception_codes ?? []).map(code => <span className="status-badge brand-unpublished" key={code}>{sourceExceptionLabels[code] ?? "ข้อยกเว้นที่ต้องตรวจสอบ"}</span>)}</div><p className="small-text muted">{sourceProvenance(source)}</p><p className="small-text muted">ปรับปรุงต้นทาง: {sourceDate(source.source_updated_at)}</p><p className="small-text muted">เวลาสกัดสำเนาต้นทาง: {date(source.source_snapshot_at)}</p></div><div className="brand-row-actions">{source.public_brand_id ? <a className="button secondary" href={brandHref(source.public_brand_id)}>เปิดแบรนด์ที่มีอยู่</a> : permissions.special("brands.manage_catalog") ? <button className="button primary" disabled={Boolean(pending) || sourceStatus(source) !== "active"} onClick={() => void create(source)}>{pending === source.rem_brand_id ? "กำลังสร้างแบรนด์…" : "นำแบรนด์นี้เข้าระบบ"}</button> : permissions.can("brands", "edit") ? <button className="button secondary" disabled={sourceStatus(source) !== "active"} onClick={() => setRequested(source)}>ขอเพิ่มแบรนด์นี้</button> : <span className="small-text muted">ผู้ดูแลระบบเป็นผู้นำเข้าแบรนด์</span>}</div></li>)}</ul></>}
    {requested && <BrandRequestDialog sourceId={requested.rem_brand_id} initialName={requested.brand_name_rem || ""} onCancel={() => setRequested(null)} onCreated={() => { setRequested(null); setNotice("ส่งคำขอแล้ว ผู้ดูแลระบบจะตรวจสอบก่อนสร้างหรือเชื่อมแบรนด์"); }} />}
  </div></section>;
}

export function BrandRequestDialog({ sourceId, initialName = "", onCancel, onCreated }: { sourceId?: string | null; initialName?: string; onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState(initialName);
  const [remId, setRemId] = useState(sourceId ?? "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!name.trim() || !reason.trim()) { setError("ระบุชื่อแบรนด์ที่ต้องการและเหตุผลให้ครบ"); return; }
    setPending(true);
    try { await request("v1/admin/brand-requests", "POST", { requested_name: name.trim(), rem_brand_id: remId || null, change_reason: reason.trim() }); onCreated(); }
    catch (error) { setError(message(error)); setPending(false); }
  }
  return <AssetDialog title="ขอเพิ่มแบรนด์" dirty={name !== initialName || remId !== (sourceId ?? "") || Boolean(reason)} pending={pending} error={error} onCancel={onCancel} onSubmit={submit} submitLabel="ส่งคำขอเพิ่มแบรนด์">
    <p className="muted small-text">คำขอยังไม่สร้างแบรนด์หรือเปลี่ยนข้อมูล REM ผู้ดูแลระบบจะตรวจสอบรหัสต้นทางก่อนดำเนินการ</p>
    <div className="form-field"><label htmlFor="requested-brand-name">ชื่อแบรนด์ที่ต้องการ</label><input id="requested-brand-name" value={name} maxLength={250} disabled={pending} onChange={event => setName(event.target.value)} /></div>
    <div className="form-field"><label htmlFor="requested-brand-rem">รหัสแบรนด์ REM (ถ้าทราบ)</label><input id="requested-brand-rem" value={remId} maxLength={200} readOnly={sourceId != null} disabled={pending} onChange={event => setRemId(event.target.value)} /><p className="field-help">เก็บรหัสตามต้นทาง รวมเลขศูนย์ด้านหน้า</p></div>
    <div className="form-field"><label htmlFor="requested-brand-reason">เหตุผลในการขอเพิ่มแบรนด์</label><textarea id="requested-brand-reason" rows={3} maxLength={1000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></div>
  </AssetDialog>;
}

function BrandRequests({ role, brands }: { role: LocalRole; brands: Brand[] }) {
  const permissions = useHubPermissions();
  const [items, setItems] = useState<BrandRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [resolving, setResolving] = useState<BrandRequest | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setItems(await request<BrandRequest[]>("v1/admin/brand-requests")); } catch (error) { setError(message(error)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="panel brand-requests" id="brand-requests"><div className="panel-heading"><div><h2>คำขอเพิ่มแบรนด์ {!loading && !error && <span className="count" aria-label={`รอตรวจสอบ ${items.filter(item => item.status === "open").length} คำขอ`}>{items.filter(item => item.status === "open").length}</span>}</h2><p>ทีมงานส่งคำขอ ผู้ดูแลระบบตรวจสอบและบันทึกผล</p></div>{permissions.can("brands", "edit") && <button className="button secondary" onClick={() => setCreating(true)}>ขอเพิ่มแบรนด์</button>}</div><div className="panel-body">
    {notice && <p className="notice success" role="status">{notice}</p>}{loading ? <Loading /> : error ? <LoadError error={error} retry={load} /> : !items.length ? <p className="muted">ยังไม่มีคำขอเพิ่มแบรนด์</p> : <ul className="brand-request-list">{items.map(item => <li key={item.id}><div className="brand-card-heading"><h3>{item.requested_name}</h3><span className="status-badge draft">{item.status === "open" ? "รอตรวจสอบ" : item.status === "resolved" ? "เชื่อมแบรนด์แล้ว" : "ปฏิเสธคำขอ"}</span></div><p className="small-text source-code">รหัสแบรนด์ REM: {item.rem_brand_id || "ไม่ได้ระบุ"}</p><p>{item.reason}</p><p className="small-text muted">ขอเมื่อ {date(item.created_at)} · โดย <ActorName id={item.created_by} /></p>{item.resolution_reason && <p className="read-only-note">ผลพิจารณา: {item.resolution_reason}</p>}{item.brand_id && brands.find(brand => brand.id === item.brand_id) && <a className="asset-file-link" href={brandHref(brands.find(brand => brand.id === item.brand_id)!.public_brand_id)}>เปิดแบรนด์ที่เชื่อม</a>}{permissions.special("brands.manage_catalog") && item.status === "open" && <button className="button secondary" onClick={() => setResolving(item)}>พิจารณาคำขอ</button>}</li>)}</ul>}
    {creating && <BrandRequestDialog onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); setNotice("ส่งคำขอเพิ่มแบรนด์แล้ว"); void load(); }} />}
    {resolving && <ResolveBrandDialog item={resolving} brands={brands} onCancel={() => setResolving(null)} onReload={async () => { await load(); setResolving(null); }} onSaved={() => { setResolving(null); setNotice("บันทึกผลพิจารณาคำขอแล้ว"); void load(); }} />}
  </div></section>;
}

function ResolveBrandDialog({ item, brands, onCancel, onSaved, onReload }: { item: BrandRequest; brands: Brand[]; onCancel: () => void; onSaved: () => void; onReload: () => Promise<void> }) {
  const [decision, setDecision] = useState<"resolved" | "rejected">("resolved");
  const [brandId, setBrandId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const eligible = brands.filter(brand => (!item.rem_brand_id || brand.rem_brand_id === item.rem_brand_id) && !brand.source?.is_deleted);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setConflict(false);
    if (!reason.trim() || decision === "resolved" && !eligible.some(brand => brand.id === brandId)) { setError("ระบุเหตุผล และเลือกแบรนด์ที่ตรงกับคำขอเมื่ออนุมัติ"); return; }
    setPending(true);
    try { await request(`v1/admin/brand-requests/${item.id}/resolve`, "POST", { updated_at: item.updated_at, brand_id: decision === "resolved" ? brandId : null, decision, change_reason: reason.trim() }); onSaved(); }
    catch (error) { setError(message(error)); setConflict((error as { status?: number }).status === 409); setPending(false); }
  }
  return <AssetDialog title="พิจารณาคำขอเพิ่มแบรนด์" dirty={Boolean(reason || brandId || decision === "rejected")} pending={pending} error={error} conflict={conflict} onReload={onReload} onCancel={onCancel} onSubmit={submit} submitLabel="บันทึกผลพิจารณา" danger={decision === "rejected"}>
    <h3>{item.requested_name}</h3><p>รหัสต้นทาง: {item.rem_brand_id || "ยังไม่ทราบ"}</p><p className="read-only-note">{item.reason}</p>
    <div className="form-field"><label htmlFor="brand-request-decision">ผลพิจารณาคำขอ</label><select id="brand-request-decision" disabled={pending} value={decision} onChange={event => setDecision(event.target.value as "resolved" | "rejected")}><option value="resolved">เชื่อมกับแบรนด์ในระบบ</option><option value="rejected">ปฏิเสธคำขอ</option></select></div>
    {decision === "resolved" && <div className="form-field"><label htmlFor="resolved-brand">แบรนด์สำหรับคำขอ</label><select id="resolved-brand" disabled={pending} value={brandId} onChange={event => setBrandId(event.target.value)}><option value="">เลือกแบรนด์ที่ตรวจสอบแล้ว</option>{eligible.map(brand => <option key={brand.id} value={brand.id}>{brand.public_name.th || brand.rem_brand_id} · REM {brand.rem_brand_id}</option>)}</select>{!eligible.length && <p className="field-help">ยังไม่มีแบรนด์ที่ตรงกัน โปรดยกเลิกและนำแบรนด์จากต้นทางเข้าระบบก่อน</p>}</div>}
    <div className="form-field"><label htmlFor="brand-resolution-reason">เหตุผลในการพิจารณาคำขอ</label><textarea id="brand-resolution-reason" rows={3} maxLength={1000} disabled={pending} value={reason} onChange={event => setReason(event.target.value)} /></div>
  </AssetDialog>;
}

type BrandDraft = { name: string; nameEn: string; description: string; descriptionEn: string; slug: string; status: "active" | "inactive" };
const draftFrom = (brand: Brand): BrandDraft => ({ name: brand.public_name.th ?? "", nameEn: brand.public_name.en ?? "", description: brand.description?.th ?? "", descriptionEn: brand.description?.en ?? "", slug: brand.slug ?? "", status: brand.status });

export function BrandDetail({ brandId, role, onDirtyChange, embedded, history, onWorkflowChanged, onPendingChange }: { brandId: string; role: LocalRole; onDirtyChange: (dirty: boolean) => void; embedded?: "data" | "media" | "history"; history?: ReactNode; onWorkflowChanged?: () => void; onPendingChange?: (pending: boolean) => void }) {
  const { catalog: contentCatalog } = useFieldCatalog();
  const permissions = useHubPermissions();
  const { reload: reloadReviews } = useBrandReviews();
  const [brand, setBrand] = useState<Brand | null>(null);
  const [draft, setDraft] = useState<BrandDraft | null>(null);
  const [nativeWorkflowBusy, setWorkflowBusy] = useState(false), [writingBusy, setWritingBusy] = useState(false), [workflowRevision, setWorkflowRevision] = useState(0), [mediaEditing, setMediaEditing] = useState(false);
  const workflowBusy = nativeWorkflowBusy || writingBusy;
  const [versions, setVersions] = useState<BrandVersion[]>([]);
  const [versionsError, setVersionsError] = useState("");
  const [tab, setTab] = useState<"content" | "versions">(embedded === "history" ? "versions" : "content");
  useEffect(() => { if (embedded) setTab(embedded === "history" ? "versions" : "content"); }, [embedded]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const errorSummary = useRef<HTMLDivElement>(null);
  const base = `v1/admin/brands/${encodeURIComponent(brandId)}`;
  const dirty = Boolean(brand && draft && JSON.stringify(draft) !== JSON.stringify(draftFrom(brand)));
  const canEdit = permissions.can("brands", "edit");
  const writing = useWritingTranslations(`${base}/content`, brand?.updated_at, canEdit && !!brand && !!contentCatalog?.items.some(field => field.ai_writing_enabled));
  const update = (data: Brand) => { setBrand(data); setDraft(draftFrom(data)); onWorkflowChanged?.(); void reloadReviews(); };
  const loadVersions = useCallback(async () => { try { setVersions(await request<BrandVersion[]>(`${base}/versions`)); setVersionsError(""); } catch (error) { setVersionsError(message(error)); } }, [base]);
  const load = useCallback(async () => {
    setLoading(true); setError(""); setConflict(false);
    try { const data = await request<Brand>(base); setBrand(data); setDraft(draftFrom(data)); await loadVersions(); } catch (error) { setError(message(error)); }
    finally { setLoading(false); }
  }, [base, loadVersions]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onDirtyChange(dirty || saving || workflowBusy || mediaEditing); return () => onDirtyChange(false); }, [dirty, saving, workflowBusy, mediaEditing, onDirtyChange]);
  useEffect(() => { onPendingChange?.(saving || workflowBusy || mediaEditing); return () => onPendingChange?.(false); }, [saving, workflowBusy, mediaEditing, onPendingChange]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function draftChanges() { return brand && draft ? { public_name: { ...brand.public_name, th: draft.name, ...(draft.nameEn || brand.public_name.en !== undefined ? { en: draft.nameEn } : {}) }, description: { ...brand.description, th: draft.description, en: draft.descriptionEn }, slug: draft.slug, status: draft.status } : null; }
  async function acceptWriting(acceptance: WritingAcceptance) {
    if (!brand || !draft || !canEdit || dirty || acceptance.expectedDraft.updated_at !== brand.updated_at) throw new WritingAidError("stale");
    setSaving(true);
    try {
      await request<Brand>(base, "PATCH", { updated_at: acceptance.expectedDraft.updated_at,
        description: { ...brand.description, [acceptance.language]: acceptance.after } });
      await writing.reload(); await reloadWorkflow();
    } finally { setSaving(false); }
  }
  async function reloadWorkflow() { update(await request<Brand>(base)); setError(""); setConflict(false); setWorkflowRevision(value => value + 1); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!brand || !draft || !canEdit || saving || workflowBusy || mediaEditing) return;
    setError(""); setConflict(false); setNotice("");
    if (draft.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) { setError("ชื่ออ้างอิงแบรนด์ใช้ตัวอักษรอังกฤษตัวเล็ก ตัวเลข และขีดกลาง"); document.getElementById("brand-slug")?.focus(); return; }
    setSaving(true);
    try { update(await request<Brand>(base, "PATCH", { updated_at: brand.updated_at, ...draftChanges() })); setNotice("บันทึกข้อมูลร่างแบรนด์แล้ว ข้อมูลที่เผยแพร่ยังเป็นเวอร์ชันเดิม"); }
    catch (error) { setError(message(error)); setConflict((error as { status?: number }).status === 409); }
    finally { setSaving(false); }
  }
  if (loading) return <Loading />;
  if (!brand || !draft) return <>{!embedded && <WorkspaceBack fallback="/?view=brands" label="แบรนด์ทั้งหมด" />}<LoadError error={error} retry={load} /></>;
  const readiness = brand.readiness ?? { ready: false, percent: 0, missing: [] };
  const changed = versionsError ? null : brandHasChanges(brand, versions);
  const currentVersion = versions.find(version => version.version_id === brand.published_version_id);
  const comparisonUnavailable = Boolean(versionsError || brand.published_version_id && !currentVersion?.payload);
  return <div className={embedded ? "entity-embedded-brand" : undefined} data-entity-panel={embedded}>
    <div className="brand-detail-workspace"><div className="brand-detail-intro">
    {!embedded && <WorkspaceBack fallback="/?view=brands" label="แบรนด์ทั้งหมด" />}
    <p className="brand-legacy-content-link"><a className="button secondary" href={`/content?brand=${encodeURIComponent(brand.public_brand_id)}`} onClick={event => { if (dirty && !window.confirm("มีข้อมูลที่ยังไม่บันทึก ต้องการออกและละทิ้งการแก้ไขหรือไม่")) event.preventDefault(); }}>ช่องทางติดต่อและภาษาอังกฤษของแบรนด์</a></p>
    <div className="page-heading detail-heading brand-detail-heading"><div><p className="eyebrow source-code">ข้อมูลแบรนด์ / REM {brand.rem_brand_id}</p><h1>{brand.public_name.th || "แบรนด์ที่ยังไม่ระบุชื่อ"}</h1><DemoFields fields={brand.demo_fields} /><p className="muted">ปรับปรุงล่าสุด {date(brand.updated_at)}</p><details className="brand-source-summary" id="brand-source"><summary>ต้นทางแบรนด์ (อ่านอย่างเดียว) · {brand.source?.brand_name_rem || brand.rem_brand_id}</summary><p className="small-text muted">{brand.source ? sourceProvenance(brand.source) : "ยังไม่มีข้อมูลต้นทาง"}</p><dl className="source-list"><div><dt>รหัสแบรนด์ REM</dt><dd>{brand.rem_brand_id}</dd></div><div><dt>ชื่อแบรนด์ต้นทาง</dt><dd>{brand.source?.brand_name_rem || "—"}</dd></div><div><dt>ชื่อต้นทางภาษาอังกฤษ</dt><dd>{brand.source?.brand_name_en_rem || "—"}</dd></div><div><dt>สถานะต้นทาง</dt><dd>{brand.source?.is_deleted ? "ปิดใช้งานหรือลบแล้ว" : "ใช้งานได้"}</dd></div><div><dt>ปรับปรุงต้นทาง</dt><dd>{sourceDate(brand.source?.source_updated_at)}</dd></div><div><dt>เวลาสกัดสำเนาต้นทาง</dt><dd>{date(brand.source?.source_snapshot_at)}</dd></div></dl></details></div><BrandStatus brand={brand} changed={changed} hasHistory={versions.length > 0} /></div>
    {comparisonUnavailable && <div className="notice error" role="alert"><p>ยังเปรียบเทียบเวอร์ชันที่เผยแพร่ไม่ได้ โหลดเวอร์ชันก่อนตรวจการเปลี่ยนแปลง</p><button className="button secondary" onClick={() => void loadVersions()}>ลองโหลดเวอร์ชันแบรนด์อีกครั้ง</button></div>}
    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <div className="notice error model-error-summary" role="alert" tabIndex={-1} ref={errorSummary}><strong>{error}</strong>{conflict && <><p>ข้อความที่กรอกยังอยู่ คัดลอกสิ่งที่ต้องการเก็บก่อนโหลดข้อมูลล่าสุด</p><button className="button secondary" onClick={() => { if (!dirty || window.confirm("ทิ้งการแก้ไขและโหลดข้อมูลแบรนด์ล่าสุดหรือไม่?")) void load(); }}>โหลดข้อมูลแบรนด์ล่าสุด</button></>}</div>}
    </div><div className="detail-tabs brand-workspace-tabs" role="tablist" aria-label="ข้อมูลแบรนด์">{(["content", "versions"] as const).map(value => <button key={value} id={`brand-${value}-tab`} role="tab" aria-selected={tab === value} aria-controls={`brand-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const next = value === "content" ? "versions" : "content"; setTab(next); document.getElementById(`brand-${next}-tab`)?.focus(); } }}>{value === "content" ? "ข้อมูลและโลโก้แบรนด์" : "ประวัติการเผยแพร่แบรนด์"}</button>)}</div>
    {tab === "content" ? <div className="brand-workspace-content" id="brand-content-panel" role="tabpanel" aria-labelledby="brand-content-tab"><div className="detail-main">
      <form id="brand-content-form" inert={workflowBusy || mediaEditing} onSubmit={save} noValidate><section className="panel"><div className="panel-heading"><div><h2>ข้อมูลแบรนด์สำหรับเผยแพร่</h2><p>ชื่อการตลาดแยกจากชื่อต้นทาง โดยคงรหัส REM เดิม</p></div><span className="language-chip">ภาษาไทย</span></div><div className="panel-body">
        {Boolean(brand.unconfirmed_source_names?.length) && <div className="notice" role="note"><strong>ค่าจากต้นทาง ยังไม่ยืนยัน</strong><p>ชื่อ {brand.unconfirmed_source_names?.join(" / ")} เติมจาก REM และแก้ไขได้ ทีมงานตรวจชื่อก่อนใช้สื่อสาร</p>{canEdit && <button type="button" className="button secondary" disabled={dirty || saving || workflowBusy || mediaEditing} onClick={async () => { setSaving(true); setError(""); try { update(await request<Brand>(`${base}/confirm-source-names`, "POST", { updated_at: brand.updated_at })); setNotice("ยืนยันชื่อแบรนด์จากต้นทางแล้ว"); } catch (error) { setError(message(error)); } finally { setSaving(false); } }}>ยืนยันชื่อจากต้นทางที่ตรวจแล้ว</button>}</div>}
        {!canEdit ? <><p className="read-only-note">ข้อมูลร่างสำหรับตรวจสอบ · ผู้แก้ไขข้อมูลหรือผู้ดูแลระบบเป็นผู้แก้ไข</p><dl className="brand-review-fields"><div><dt>ชื่อแบรนด์ที่ใช้เผยแพร่</dt><dd>{draft.name || "ยังไม่ได้ระบุ"}</dd></div><div><dt>ชื่ออ้างอิงแบรนด์</dt><dd>{draft.slug || "ยังไม่ได้ระบุ"}</dd></div><div><dt>คำอธิบายแบรนด์ (ภาษาไทย)</dt><dd>{draft.description || "ยังไม่ได้ระบุ"}</dd></div><div><dt>สถานะแบรนด์ในข้อมูลร่าง</dt><dd>{draft.status === "active" ? "เปิดใช้งาน" : "ปิดใช้งาน"}</dd></div></dl></> : <>
        <div className="form-field"><ContentLabel htmlFor="brand-name" field={contentCatalog?.items.find(field => field.field_key === "brand.public_name")}>ชื่อแบรนด์ที่ใช้เผยแพร่</ContentLabel><input id="brand-name" data-workspace-field="brand.public_name" maxLength={250} disabled={!canEdit || saving || workflowBusy || mediaEditing} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
        <div className="form-field"><label htmlFor="brand-name-en">ชื่อแบรนด์ภาษาอังกฤษ</label><input id="brand-name-en" data-workspace-field="brand.public_name_en" maxLength={250} disabled={!canEdit || saving || workflowBusy || mediaEditing} value={draft.nameEn} onChange={event => setDraft({ ...draft, nameEn: event.target.value })} /></div>
        <div className="form-field"><label htmlFor="brand-slug">ชื่ออ้างอิงแบรนด์</label><input id="brand-slug" data-workspace-field="brand.slug" maxLength={160} disabled={!canEdit || saving || workflowBusy || mediaEditing} value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value })} /><p className="field-help">ตัวอักษรอังกฤษตัวเล็ก ตัวเลข และขีดกลาง เช่น sena-example</p></div>
        <div className="form-field"><label htmlFor="brand-description">คำอธิบายแบรนด์ (ภาษาไทย)</label><textarea id="brand-description" data-workspace-field="brand.description" rows={4} maxLength={20000} disabled={!canEdit || saving || workflowBusy || mediaEditing} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></div>
        <div className="form-field"><ContentLabel htmlFor="brand-description-en" field={contentCatalog?.items.find(field => field.field_key === "brand.description")}>คำอธิบายแบรนด์ (ภาษาอังกฤษ)</ContentLabel><textarea id="brand-description-en" data-workspace-field="brand.description_en" rows={4} maxLength={20000} disabled={!canEdit || saving || workflowBusy || mediaEditing} value={draft.descriptionEn} onChange={event => setDraft({ ...draft, descriptionEn: event.target.value })} /></div>
        <div className="form-field"><label htmlFor="brand-status">สถานะแบรนด์ในข้อมูลร่าง</label><select id="brand-status" data-workspace-field="brand.status" disabled={!canEdit || saving || workflowBusy || mediaEditing} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as BrandDraft["status"] })}><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select><p className="field-help">การแก้ไขสถานะร่างยังไม่เปลี่ยนเวอร์ชันที่เผยแพร่ ใช้ถอนการเผยแพร่เมื่อต้องการหยุดส่งข้อมูลผ่าน API</p></div>
      </>}{!canEdit && <BrandWebsitePreview brand={brand} />}</div></section>{canEdit && !dirty && <div className="save-bar"><span>ข้อมูลร่างแบรนด์เป็นปัจจุบัน</span><button className="button primary" disabled>บันทึกข้อมูลแบรนด์</button></div>}</form>
      {embedded !== "media" && <WritingFields field={contentCatalog?.items.find(field => field.field_key === "brand.description")} fields={contentCatalog?.items ?? []}
        translations={writing.items} ownerType="brand" ownerKey={brand.id} value={{ th: draft.description, en: draft.descriptionEn }} savedValue={brand.description}
        stamp={{ updated_at: brand.updated_at }} dirty={dirty} canEdit={canEdit} disabled={saving || mediaEditing || nativeWorkflowBusy}
        onActivityChange={setWritingBusy} onAccept={acceptWriting} />}
      {embedded !== "media" && <ContentWorkflow key={workflowRevision} target={{ kind: "brand", identity: { id: brand.id } }} label={brand.public_name.th || brand.public_brand_id} revision={brand.updated_at} disabled={saving || mediaEditing || writingBusy}
        draft={{ dirty, valid: canEdit && (!draft.slug || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)), sourceStamp: { updated_at: brand.updated_at }, getChanges: draftChanges }}
        onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={setWorkflowBusy} />}
      <ProjectAssets project={brand} role={role} disabled={dirty || saving || workflowBusy} onProjectChanged={update} {...{ onEditingChange: setMediaEditing }} />
      <section className="panel brand-project-list-panel"><div className="panel-heading"><div><h2>โครงการที่เชื่อมแบรนด์</h2><p>บริษัทที่แสดงมาจากต้นทางของแต่ละโครงการ ไม่ได้อนุมานจากแบรนด์</p></div><span className="count">{brand.projects?.length ?? 0}</span></div><div className="panel-body">{!brand.projects?.length ? <p className="muted">ยังไม่มีโครงการเชื่อมแบรนด์นี้</p> : <ul className="brand-project-list">{brand.projects.map(project => <li key={project.public_project_id}><a href={`/?project=${encodeURIComponent(project.public_project_id)}`}>{project.public_name.th || project.source.rem_project_id}</a><span className="small-text muted source-code">บริษัทตามข้อมูลโครงการ: {project.source.company_name_rem || "ยังไม่มีข้อมูลชื่อบริษัท"} · รหัส {project.source.rem_company_id || "ไม่ระบุ"}</span></li>)}</ul>}</div></section>

    </div></div> : <section className="panel brand-workspace-content" id="brand-versions-panel" role="tabpanel" aria-labelledby="brand-versions-tab"><div className="panel-heading"><h2>ประวัติการเผยแพร่แบรนด์</h2></div><div className="panel-body">{versionsError ? <LoadError error={versionsError} retry={loadVersions} /> : !versions.length ? <p className="muted">ยังไม่มีเวอร์ชันแบรนด์ที่เผยแพร่</p> : <ol className="version-list">{versions.map(version => <li key={version.version_id}><div className="version-marker">{version.version_no}</div><div className="version-content"><h3>เวอร์ชันแบรนด์ {version.version_no}</h3><p>{version.change_reason}</p><p className="small-text muted source-code">{date(version.published_at)} · <ActorName id={version.publisher} /></p>{version.version_id === brand.published_version_id && <span className="status-badge published">เวอร์ชันที่เลือก</span>}{version.payload && <details><summary>ดูข้อมูลแบรนด์ในเวอร์ชัน</summary><dl className="snapshot-list"><div><dt>ชื่อแบรนด์</dt><dd>{version.payload.public_name?.th || "—"}</dd></div><div><dt>คำอธิบาย</dt><dd>{version.payload.description?.th || "—"}</dd></div></dl><PublicationComparison targetMedia={<ComparisonLogos value={version.payload} />} target={version.payload.publication_preview} redacted={version.payload.publication_preview_redacted} label={workflowText.preview} /></details>}</div></li>)}</ol>}{history}</div></section>}
    <aside className="readiness-column brand-readiness" aria-label="ความพร้อมแบรนด์ก่อนเผยแพร่"><section className="panel readiness-panel"><div className="panel-body"><div className="publish-block" data-assistant-clearance="overlap"><a className="button primary full-width" href={`/publish?source=brand&id=${encodeURIComponent(brand.public_brand_id)}`} aria-disabled={dirty || saving || workflowBusy || mediaEditing} onClick={event => { if (dirty || saving || workflowBusy || mediaEditing) event.preventDefault(); }}>{workflowText.queue}</a><details className="brand-publish-help"><summary>ผลต่อโครงการที่ใช้แบรนด์นี้</summary><p className="small-text muted">การเผยแพร่แบรนด์ใหม่ไม่เปลี่ยนข้อมูลแบรนด์ที่บันทึกไว้ในเวอร์ชันโครงการเดิม</p></details></div><div className="brand-readiness-heading"><h2>ความพร้อมของแบรนด์</h2><div className="readiness-number">{readiness.percent}<span>%</span></div></div><div className="progress-track" role="progressbar" aria-label="ความพร้อมของแบรนด์" aria-valuenow={readiness.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${readiness.percent}%` }} /></div>{dirty && <p className="inline-warning">ความพร้อมอ้างอิงข้อมูลที่บันทึกแล้ว</p>}<ul className="readiness-list">{readiness.ready ? <li className="complete">ข้อมูลแบรนด์พร้อมเผยแพร่</li> : readiness.missing.map((item, index) => <li key={`${item.field}-${index}`}><span className="missing-mark" aria-hidden="true" />{item.message}</li>)}</ul></div></section></aside>
    </div>
    {canEdit && dirty && tab === "content" && <div className="save-bar project-save-bar brand-save-bar" data-assistant-clearance role="region" aria-label="บันทึกการแก้ไขแบรนด์"><span>มีข้อมูลแบรนด์ที่ยังไม่ได้บันทึก</span><button type="submit" form="brand-content-form" className="button primary" aria-busy={saving} disabled={saving || workflowBusy || mediaEditing}>{saving ? "กำลังบันทึก…" : "บันทึกข้อมูลแบรนด์"}</button></div>}
  </div>;
}

function BrandWebsitePreview({ brand }: { brand: BrandSnapshot }) {
  const logo = brand.assets?.find(asset => asset.asset_role === "logo_primary" && asset.is_primary) ?? brand.assets?.find(asset => asset.asset_role === "logo_primary");
  return <section className="brand-website-preview" aria-label="ตัวอย่างแบรนด์บนเว็บไซต์"><p className="eyebrow">ตัวอย่างบนเว็บไซต์ · ฉบับร่าง</p>{logo ? <Preview asset={logo} alt={logo.alt_text?.th} /> : <div className="brand-logo-placeholder">ยังไม่มีโลโก้หลัก</div>}<h3>{brand.public_name.th || "ยังไม่ได้ระบุชื่อแบรนด์"}</h3><p>{brand.description.th || "ยังไม่ได้ระบุคำอธิบายแบรนด์"}</p><p className="field-help">ตัวอย่างสำหรับตรวจเนื้อหา ยังไม่ใช่ข้อมูลที่เผยแพร่</p></section>;
}

function ComparisonLogos({ value }: { value?: BrandSnapshot }) {
  return <div className="brand-comparison-logos">{value?.assets.map((asset, index) => <div key={`${asset.id}-${index}`}><Preview asset={asset} alt={asset.alt_text?.th} /></div>)}</div>;
}

export function ProjectBrandCard({ project, role, disabled, onChanged }: { project: Project; role: LocalRole; disabled: boolean; onChanged: (project: Project) => void }) {
  const permissions = useHubPermissions();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setBrands(permissions.can("brands") ? await request<Brand[]>("v1/admin/brands") : []); } catch (error) { setError(message(error)); } finally { setLoading(false); } }, [permissions.capabilities]);
  useEffect(() => { void load(); }, [load]);
  const matching = brands.filter(brand => project.source?.rem_brand_id && brand.rem_brand_id === project.source.rem_brand_id && !brand.source?.is_deleted);
  const summary = project.brand_summary;
  if (!permissions.can("brands")) return <section className="panel"><div className="panel-body"><h2>แบรนด์</h2><p>{summary?.public_name.th || project.source?.brand_name_rem || "ยังไม่ระบุ"}</p></div></section>;
  return <section className="panel" id="project-brand"><div className="panel-heading"><div><h2>แบรนด์และบริษัทตามต้นทาง</h2><p>เลือกเฉพาะแบรนด์ที่ตรงกับรหัสต้นทาง บริษัทอ้างอิงจากโครงการโดยตรง</p></div></div><div className="panel-body">
    <dl className="model-source"><div><dt>รหัสแบรนด์ REM (อ่านอย่างเดียว)</dt><dd>{project.source?.rem_brand_id || "ยังไม่มีรหัสแบรนด์ต้นทาง"}</dd></div><div><dt>ชื่อแบรนด์ต้นทาง</dt><dd>{project.source?.brand_name_rem || "ยังไม่มีข้อมูลชื่อแบรนด์"}</dd></div><div><dt>บริษัทตามโครงการ (อ่านอย่างเดียว)</dt><dd>{project.source?.company_name_rem || "ยังไม่มีข้อมูลชื่อบริษัท"}</dd></div><div><dt>รหัสบริษัท REM</dt><dd>{project.source?.rem_company_id || "ไม่ได้ระบุ"}</dd></div></dl>
    {project.source?.source_review?.brand_binding_allowed === false && <p className="field-error">ต้นทางไม่มีแบรนด์ที่ใช้งานได้ จึงยังผูกแบรนด์ไม่ได้</p>}
    <div className="brand-association"><h3>แบรนด์ที่เลือกให้โครงการ</h3>{summary ? <><a className="asset-file-link" href={brandHref(summary.public_brand_id)}>{summary.public_name.th || summary.rem_brand_id}</a><BrandStatus brand={summary} />{summary.rem_brand_id !== project.source?.rem_brand_id && <p className="field-error">แบรนด์ที่เลือกไม่ตรงกับต้นทางปัจจุบัน กรุณาตรวจสอบใหม่</p>}</> : <p className="muted">ยังไม่ได้เลือกแบรนด์ ต้องเลือกแบรนด์ที่เผยแพร่และตรงกับต้นทางก่อนเผยแพร่โครงการ</p>}</div>
    {notice && <p className="notice success" role="status">{notice}</p>}{error && <LoadError error={error} retry={load} />}
    {permissions.can("projects", "edit") && <>{disabled && <p className="field-help">บันทึกข้อมูลโครงการก่อนเปลี่ยนแบรนด์หรือส่งคำขอ</p>}<div className="model-actions"><button className="button secondary" disabled={disabled || loading || !matching.length || project.source?.source_review?.brand_binding_allowed === false} onClick={() => setChoosing(true)}>เลือกแบรนด์ที่ตรงกับต้นทาง</button><button className="button secondary" disabled={disabled || !permissions.can("brands", "edit")} onClick={() => setRequesting(true)}>ขอเพิ่มแบรนด์สำหรับโครงการ</button></div>{!loading && !error && !matching.length && <p className="field-help">ยังไม่มีแบรนด์ในระบบที่ตรงกับต้นทาง ส่งคำขอให้ผู้ดูแลตรวจสอบได้</p>}</>}
    {choosing && <AssignBrandDialog project={project} brands={matching} onCancel={() => setChoosing(false)} onSaved={data => { onChanged(data); setChoosing(false); setNotice("บันทึกแบรนด์ของโครงการแล้ว ต้องเผยแพร่โครงการอีกครั้งเพื่อส่งข้อมูลเวอร์ชันใหม่"); }} onReload={async () => { const data = await request<Project>(`v1/admin/projects/${project.public_project_id}`); onChanged(data); await load(); setChoosing(false); }} />}
    {requesting && <BrandRequestDialog sourceId={project.source?.rem_brand_id} initialName={project.source?.brand_name_rem || ""} onCancel={() => setRequesting(false)} onCreated={() => { setRequesting(false); setNotice("ส่งคำขอเพิ่มแบรนด์สำหรับโครงการแล้ว"); }} />}
  </div></section>;
}

function AssignBrandDialog({ project, brands, onCancel, onSaved, onReload }: { project: Project; brands: Brand[]; onCancel: () => void; onSaved: (project: Project) => void; onReload: () => Promise<void> }) {
  const [brandId, setBrandId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setConflict(false);
    if (!brands.some(brand => brand.id === brandId)) { setError("เลือกแบรนด์ที่ตรงกับต้นทางก่อนยืนยัน"); return; } setPending(true);
    try { onSaved(await request<Project>(`v1/admin/projects/${project.public_project_id}/brand`, "POST", { brand_id: brandId, updated_at: project.updated_at })); }
    catch (error) { setError(message(error)); setConflict((error as { status?: number }).status === 409); setPending(false); }
  }
  return <AssetDialog title="เลือกแบรนด์ให้โครงการ" dirty={Boolean(brandId)} pending={pending} error={error} conflict={conflict} onReload={onReload} onCancel={onCancel} onSubmit={submit} submitLabel="บันทึกแบรนด์ของโครงการ"><p>รหัสแบรนด์ต้นทาง {project.source?.rem_brand_id}</p><div className="form-field"><label htmlFor="project-brand-selection">แบรนด์ของโครงการ</label><select id="project-brand-selection" value={brandId} disabled={pending} onChange={event => setBrandId(event.target.value)}><option value="">เลือกแบรนด์</option>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.public_name.th || brand.rem_brand_id} · {brand.publication_available ? "เผยแพร่แล้ว" : "ยังไม่พร้อมเผยแพร่"}</option>)}</select></div><p className="read-only-note">เลือกแบรนด์ร่างได้ แต่ต้องเผยแพร่แบรนด์ให้พร้อมก่อนเผยแพร่โครงการ การเลือกนี้ไม่เปลี่ยนบริษัทตามต้นทาง</p></AssetDialog>;
}
