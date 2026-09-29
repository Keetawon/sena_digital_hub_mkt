"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { LocalRole } from "@/lib/local-session";
import type { Project } from "./hub-admin";
import { AssetDialog, ProjectAssets, type AssetBinding } from "./project-assets";
import { request } from "./hub-request";

type Localized = { th?: string; [locale: string]: string | undefined };
export type BrandSource = { rem_brand_id: string; brand_name_rem: string; brand_name_en_rem: string | null; is_deleted: boolean; source_updated_at: string | null; source_snapshot_at: string; source_fingerprint: string; source_record: Record<string, unknown> | null; intake_manifest_sha256: string | null; public_brand_id?: string | null };
export type BrandSummary = { id: string; public_brand_id: string; rem_brand_id: string; public_name: Localized; status: "active" | "inactive"; publication_available: boolean };
export type Brand = BrandSummary & {
  description: Localized; slug: string; updated_at: string; published_version_id: string | null;
  readiness: { ready: boolean; percent: number; missing: { field: string; message: string }[] };
  source: BrandSource; assets: AssetBinding[];
  projects: { id: string; public_project_id: string; public_name: Localized; source: { rem_project_id: string; rem_company_id: string | null; company_name_rem: string | null } }[];
};
type BrandVersion = { version_id: string; version_no: number; published_at: string; publisher: string; change_reason: string; payload?: { public_name?: Localized; description?: Localized; slug?: string } };
type BrandRequest = { id: string; requested_name: string; rem_brand_id: string | null; reason: string; status: "open" | "resolved" | "rejected"; brand_id: string | null; resolution_reason: string | null; created_at: string; created_by: string; updated_at: string };
const mayEdit = (role: LocalRole) => role === "editor" || role === "admin";
const message = (error: unknown) => error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง";
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "ไม่ได้ระบุ";
const sourceDate = (value?: string | null) => value ? date(value) : "ยังยืนยันเวลา/เขตเวลาต้นทางไม่ได้";
const sourceProvenance = (source: BrandSource) => source.intake_manifest_sha256 != null ? "สำเนา REM ที่ตรวจสอบหลักฐานแล้ว · ต้องตรวจเนื้อหาและการจับคู่ก่อนเผยแพร่ · ยังไม่ใช่ DW สด" : "ข้อมูลจำลองสำหรับเครื่องพัฒนา";
const brandHref = (id: string) => `/?brand=${encodeURIComponent(id)}`;

function Loading() { return <div className="loading-state" role="status"><span className="spinner" />กำลังโหลดข้อมูลแบรนด์…</div>; }
function LoadError({ error, retry }: { error: string; retry: () => void }) { return <div className="notice error" role="alert"><span>{error}</span><button className="button secondary" onClick={retry}>โหลดข้อมูลใหม่</button></div>; }
function BrandStatus({ brand }: { brand: BrandSummary & { published_version_id?: string | null } }) {
  return <span className={`status-badge ${brand.publication_available ? "published" : "draft"}`}>{brand.publication_available ? "เผยแพร่แล้ว" : brand.published_version_id ? "หยุดแสดงผ่าน API" : "ฉบับร่าง"}</span>;
}

export function BrandWorkspace({ brandId, role, onDirtyChange }: { brandId: string | null; role: LocalRole; onDirtyChange: (dirty: boolean) => void }) {
  return brandId ? <BrandDetail key={`${brandId}-${role}`} brandId={brandId} role={role} onDirtyChange={onDirtyChange} /> : <BrandOverview role={role} />;
}

function BrandOverview({ role }: { role: LocalRole }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setBrands(await request<Brand[]>("v1/admin/brands")); } catch (error) { setError(message(error)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = brands.filter(brand => `${brand.public_name.th ?? ""} ${brand.rem_brand_id} ${brand.slug}`.toLocaleLowerCase("th").includes(search.trim().toLocaleLowerCase("th")));
  return <>
    <div className="page-heading"><div><p className="eyebrow">ข้อมูลแบรนด์ที่ใช้ร่วมกัน</p><h1>แบรนด์ที่อยู่อาศัย</h1><p className="muted">จัดเตรียมชื่อ รายละเอียด และโลโก้ให้ตรวจสอบก่อนเผยแพร่</p></div><span className="scope-pill"><span />SENA Residential</span></div>
    <div className="section-heading"><h2>แบรนด์ในพื้นที่ทำงาน {!loading && !error && <span className="count">{brands.length}</span>}</h2><button className="button secondary" aria-expanded={sources} aria-controls="brand-source-picker" onClick={() => setSources(!sources)}>{sources ? "ปิดต้นทางแบรนด์" : "ดูแบรนด์จากต้นทาง"}</button></div>
    {sources && <BrandSourcePicker role={role} />}
    <div className="form-field"><label htmlFor="brand-search">ค้นหาชื่อหรือรหัสแบรนด์</label><input id="brand-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {loading ? <Loading /> : error ? <LoadError error={error} retry={load} /> : !filtered.length ? <div className="empty-state compact"><h2>{search ? "ไม่พบแบรนด์ที่ตรงกับการค้นหา" : "ยังไม่มีแบรนด์ในพื้นที่ทำงาน"}</h2><p>ผู้ดูแลระบบเลือกแบรนด์จากต้นทางได้ หรือส่งคำขอให้ตรวจสอบแบรนด์ที่ต้องการ</p></div> : <div className="brand-grid">{filtered.map(brand => <a className="brand-card panel" key={brand.id} href={brandHref(brand.public_brand_id)}><div className="brand-card-heading"><h3>{brand.public_name.th || "แบรนด์ที่ยังไม่ระบุชื่อ"}</h3><BrandStatus brand={brand} /></div><p className="small-text muted source-code">รหัสแบรนด์ REM {brand.rem_brand_id}</p><p>{brand.description?.th || "ยังไม่มีคำอธิบายแบรนด์"}</p><p className="small-text muted">{brand.status === "active" ? "ข้อมูลร่าง: เปิดใช้งาน" : "ข้อมูลร่าง: ปิดใช้งาน"} · พร้อม {brand.readiness?.percent ?? 0}%</p><span className="open-project">จัดการแบรนด์ <span aria-hidden="true">→</span></span></a>)}</div>}
    <BrandRequests role={role} brands={brands} />
  </>;
}

function BrandSourcePicker({ role }: { role: LocalRole }) {
  const [sources, setSources] = useState<BrandSource[]>([]);
  const [search, setSearch] = useState("");
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
  const filtered = sources.filter(source => `${source.rem_brand_id} ${source.brand_name_rem} ${source.brand_name_en_rem || ""}`.toLocaleLowerCase("th").includes(search.trim().toLocaleLowerCase("th")));
  return <section className="panel" id="brand-source-picker"><div className="panel-heading"><div><h2>แบรนด์จากข้อมูลต้นทาง</h2><p>ตรวจแหล่งข้อมูลของแต่ละรายการ · รหัสและชื่อต้นทางอ่านอย่างเดียว</p></div></div><div className="panel-body">
    <div className="form-field"><label htmlFor="source-brand-search">ค้นหาแบรนด์ต้นทาง</label><input id="source-brand-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></div>
    {notice && <p className="notice success" role="status">{notice}</p>}{error && <LoadError error={error} retry={load} />}
    {loading ? <Loading /> : <><p className="small-text muted" role="status">พบ {filtered.length} แบรนด์ต้นทาง</p><ul className="source-cards">{filtered.map(source => <li key={source.rem_brand_id}><div><h3>{source.brand_name_rem}</h3><p className="small-text source-code">รหัส REM {source.rem_brand_id}{source.brand_name_en_rem && ` · ${source.brand_name_en_rem}`}</p><p className="small-text muted">{sourceProvenance(source)}</p><p className="small-text muted">ปรับปรุงต้นทาง: {sourceDate(source.source_updated_at)}</p><p className="small-text muted">เวลาสกัดสำเนาต้นทาง: {date(source.source_snapshot_at)}</p>{source.is_deleted && <p className="field-error">ต้นทางปิดใช้งานหรือลบแบรนด์นี้แล้ว</p>}</div><div className="brand-row-actions">{source.public_brand_id ? <a className="button secondary" href={brandHref(source.public_brand_id)}>เปิดแบรนด์ที่มีอยู่</a> : role === "admin" ? <button className="button primary" disabled={Boolean(pending) || source.is_deleted} onClick={() => void create(source)}>{pending === source.rem_brand_id ? "กำลังสร้างแบรนด์…" : "นำแบรนด์นี้เข้าระบบ"}</button> : role === "editor" ? <button className="button secondary" disabled={source.is_deleted} onClick={() => setRequested(source)}>ขอเพิ่มแบรนด์นี้</button> : <span className="small-text muted">ผู้ดูแลระบบเป็นผู้นำเข้าแบรนด์</span>}</div></li>)}</ul></>}
    {requested && <BrandRequestDialog sourceId={requested.rem_brand_id} initialName={requested.brand_name_rem} onCancel={() => setRequested(null)} onCreated={() => { setRequested(null); setNotice("ส่งคำขอแล้ว ผู้ดูแลระบบจะตรวจสอบก่อนสร้างหรือเชื่อมแบรนด์"); }} />}
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
  const [items, setItems] = useState<BrandRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [resolving, setResolving] = useState<BrandRequest | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setItems(await request<BrandRequest[]>("v1/admin/brand-requests")); } catch (error) { setError(message(error)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="panel brand-requests" id="brand-requests"><div className="panel-heading"><div><h2>คำขอเพิ่มแบรนด์</h2><p>ทีมงานส่งคำขอ ผู้ดูแลระบบตรวจสอบและบันทึกผล</p></div>{mayEdit(role) && <button className="button secondary" onClick={() => setCreating(true)}>ขอเพิ่มแบรนด์</button>}</div><div className="panel-body">
    {notice && <p className="notice success" role="status">{notice}</p>}{loading ? <Loading /> : error ? <LoadError error={error} retry={load} /> : !items.length ? <p className="muted">ยังไม่มีคำขอเพิ่มแบรนด์</p> : <ul className="brand-request-list">{items.map(item => <li key={item.id}><div className="brand-card-heading"><h3>{item.requested_name}</h3><span className="status-badge draft">{item.status === "open" ? "รอตรวจสอบ" : item.status === "resolved" ? "เชื่อมแบรนด์แล้ว" : "ปฏิเสธคำขอ"}</span></div><p className="small-text source-code">รหัสแบรนด์ REM: {item.rem_brand_id || "ไม่ได้ระบุ"}</p><p>{item.reason}</p><p className="small-text muted">ขอเมื่อ {date(item.created_at)} · โดย {item.created_by}</p>{item.resolution_reason && <p className="read-only-note">ผลพิจารณา: {item.resolution_reason}</p>}{item.brand_id && brands.find(brand => brand.id === item.brand_id) && <a className="asset-file-link" href={brandHref(brands.find(brand => brand.id === item.brand_id)!.public_brand_id)}>เปิดแบรนด์ที่เชื่อม</a>}{role === "admin" && item.status === "open" && <button className="button secondary" onClick={() => setResolving(item)}>พิจารณาคำขอ</button>}</li>)}</ul>}
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

type BrandDraft = { name: string; description: string; slug: string; status: "active" | "inactive" };
const draftFrom = (brand: Brand): BrandDraft => ({ name: brand.public_name.th ?? "", description: brand.description?.th ?? "", slug: brand.slug ?? "", status: brand.status });

function BrandDetail({ brandId, role, onDirtyChange }: { brandId: string; role: LocalRole; onDirtyChange: (dirty: boolean) => void }) {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [draft, setDraft] = useState<BrandDraft | null>(null);
  const [versions, setVersions] = useState<BrandVersion[]>([]);
  const [versionsError, setVersionsError] = useState("");
  const [tab, setTab] = useState<"content" | "versions">("content");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<{ type: "publish" | "withdraw" | "rollback"; version?: BrandVersion } | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const base = `v1/admin/brands/${encodeURIComponent(brandId)}`;
  const dirty = Boolean(brand && draft && JSON.stringify(draft) !== JSON.stringify(draftFrom(brand)));
  const canEdit = mayEdit(role);
  const canPublish = role === "publisher";
  const update = (data: Brand) => { setBrand(data); setDraft(draftFrom(data)); };
  const loadVersions = useCallback(async () => { try { setVersions(await request<BrandVersion[]>(`${base}/versions`)); setVersionsError(""); } catch (error) { setVersionsError(message(error)); } }, [base]);
  const load = useCallback(async () => {
    setLoading(true); setError(""); setConflict(false);
    try { const data = await request<Brand>(base); setBrand(data); setDraft(draftFrom(data)); await loadVersions(); } catch (error) { setError(message(error)); }
    finally { setLoading(false); }
  }, [base, loadVersions]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!brand || !draft || !canEdit) return;
    setError(""); setConflict(false); setNotice("");
    if (draft.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) { setError("ชื่ออ้างอิงแบรนด์ใช้ตัวอักษรอังกฤษตัวเล็ก ตัวเลข และขีดกลาง"); document.getElementById("brand-slug")?.focus(); return; }
    setSaving(true);
    try { update(await request<Brand>(base, "PATCH", { updated_at: brand.updated_at, public_name: { ...brand.public_name, th: draft.name }, description: { ...brand.description, th: draft.description }, slug: draft.slug, status: draft.status })); setNotice("บันทึกข้อมูลร่างแบรนด์แล้ว ข้อมูลที่เผยแพร่ยังเป็นเวอร์ชันเดิม"); }
    catch (error) { setError(message(error)); setConflict((error as { status?: number }).status === 409); }
    finally { setSaving(false); }
  }
  if (loading) return <Loading />;
  if (!brand || !draft) return <><a className="back-link" href="/?view=brands">← แบรนด์ทั้งหมด</a><LoadError error={error} retry={load} /></>;
  const readiness = brand.readiness ?? { ready: false, percent: 0, missing: [] };
  return <>
    <a className="back-link" href="/?view=brands">← แบรนด์ทั้งหมด</a>
    <div className="page-heading detail-heading"><div><p className="eyebrow source-code">ข้อมูลแบรนด์ / {brand.public_brand_id}</p><h1>{brand.public_name.th || "แบรนด์ที่ยังไม่ระบุชื่อ"}</h1><p className="muted">ปรับปรุงล่าสุด {date(brand.updated_at)}</p></div><BrandStatus brand={brand} /></div>
    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <div className="notice error model-error-summary" role="alert" tabIndex={-1} ref={errorSummary}><strong>{error}</strong>{conflict && <><p>ข้อความที่กรอกยังอยู่ คัดลอกสิ่งที่ต้องการเก็บก่อนโหลดข้อมูลล่าสุด</p><button className="button secondary" onClick={() => { if (!dirty || window.confirm("ทิ้งการแก้ไขและโหลดข้อมูลแบรนด์ล่าสุดหรือไม่?")) void load(); }}>โหลดข้อมูลแบรนด์ล่าสุด</button></>}</div>}
    <div className="detail-tabs" role="tablist" aria-label="ข้อมูลแบรนด์">{(["content", "versions"] as const).map(value => <button key={value} id={`brand-${value}-tab`} role="tab" aria-selected={tab === value} aria-controls={`brand-${value}-panel`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const next = value === "content" ? "versions" : "content"; setTab(next); document.getElementById(`brand-${next}-tab`)?.focus(); } }}>{value === "content" ? "ข้อมูลและโลโก้แบรนด์" : "ประวัติการเผยแพร่แบรนด์"}</button>)}</div>
    {tab === "content" ? <div className="detail-layout" id="brand-content-panel" role="tabpanel" aria-labelledby="brand-content-tab"><div className="detail-main">
      <form onSubmit={save} noValidate><section className="panel"><div className="panel-heading"><div><h2>ข้อมูลแบรนด์สำหรับเผยแพร่</h2><p>ชื่อการตลาดแยกจากชื่อต้นทาง โดยคงรหัส REM เดิม</p></div><span className="language-chip">ภาษาไทย</span></div><div className="panel-body">
        {!canEdit && <p className="read-only-note">บัญชีนี้อ่านข้อมูลร่างได้ ผู้แก้ไขข้อมูลหรือผู้ดูแลระบบเป็นผู้แก้ไข</p>}
        <div className="form-field"><label htmlFor="brand-name">ชื่อแบรนด์ที่ใช้เผยแพร่</label><input id="brand-name" maxLength={250} disabled={!canEdit || saving} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
        <div className="form-field"><label htmlFor="brand-slug">ชื่ออ้างอิงแบรนด์</label><input id="brand-slug" maxLength={160} disabled={!canEdit || saving} value={draft.slug} onChange={event => setDraft({ ...draft, slug: event.target.value })} /><p className="field-help">ตัวอักษรอังกฤษตัวเล็ก ตัวเลข และขีดกลาง เช่น sena-example</p></div>
        <div className="form-field"><label htmlFor="brand-description">คำอธิบายแบรนด์ (ภาษาไทย)</label><textarea id="brand-description" rows={4} maxLength={20000} disabled={!canEdit || saving} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></div>
        <div className="form-field"><label htmlFor="brand-status">สถานะแบรนด์ในข้อมูลร่าง</label><select id="brand-status" disabled={!canEdit || saving} value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as BrandDraft["status"] })}><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select><p className="field-help">การแก้ไขสถานะร่างยังไม่เปลี่ยนเวอร์ชันที่เผยแพร่ ใช้ถอนการเผยแพร่เมื่อต้องการหยุดส่งข้อมูลผ่าน API</p></div>
      </div></section>{canEdit && <div className="save-bar"><span>{dirty ? "มีข้อมูลแบรนด์ที่ยังไม่ได้บันทึก" : "ข้อมูลร่างแบรนด์เป็นปัจจุบัน"}</span><button className="button primary" disabled={!dirty || saving}>{saving ? "กำลังบันทึก…" : "บันทึกข้อมูลแบรนด์"}</button></div>}</form>
      <ProjectAssets project={brand} role={role} disabled={dirty || saving} onProjectChanged={update} />
      <section className="panel"><div className="panel-heading"><div><h2>โครงการที่เชื่อมแบรนด์</h2><p>บริษัทที่แสดงมาจากต้นทางของแต่ละโครงการ ไม่ได้อนุมานจากแบรนด์</p></div><span className="count">{brand.projects?.length ?? 0}</span></div><div className="panel-body">{!brand.projects?.length ? <p className="muted">ยังไม่มีโครงการเชื่อมแบรนด์นี้</p> : <ul className="brand-project-list">{brand.projects.map(project => <li key={project.public_project_id}><a href={`/?project=${encodeURIComponent(project.public_project_id)}`}>{project.public_name.th || project.source.rem_project_id}</a><span className="small-text muted source-code">บริษัทตามข้อมูลโครงการ: {project.source.company_name_rem || "ยังไม่มีข้อมูลชื่อบริษัท"} · รหัส {project.source.rem_company_id || "ไม่ระบุ"}</span></li>)}</ul>}</div></section>
      <section className="panel" id="brand-source"><div className="panel-heading"><div><h2>ต้นทางแบรนด์ (อ่านอย่างเดียว)</h2><p>{brand.source ? sourceProvenance(brand.source) : "ยังไม่มีข้อมูลต้นทาง"}</p></div></div><dl className="source-list"><div><dt>รหัสแบรนด์ REM</dt><dd>{brand.rem_brand_id}</dd></div><div><dt>ชื่อแบรนด์ต้นทาง</dt><dd>{brand.source?.brand_name_rem || "—"}</dd></div><div><dt>ชื่อต้นทางภาษาอังกฤษ</dt><dd>{brand.source?.brand_name_en_rem || "—"}</dd></div><div><dt>สถานะต้นทาง</dt><dd>{brand.source?.is_deleted ? "ปิดใช้งานหรือลบแล้ว" : "ใช้งานได้"}</dd></div><div><dt>ปรับปรุงต้นทาง</dt><dd>{sourceDate(brand.source?.source_updated_at)}</dd></div><div><dt>เวลาสกัดสำเนาต้นทาง</dt><dd>{date(brand.source?.source_snapshot_at)}</dd></div></dl></section>
    </div><aside className="readiness-column" aria-label="ความพร้อมแบรนด์ก่อนเผยแพร่"><section className="panel readiness-panel"><div className="panel-body"><h2>ความพร้อมของแบรนด์</h2><div className="readiness-number">{readiness.percent}<span>%</span></div><div className="progress-track" role="progressbar" aria-label="ความพร้อมของแบรนด์" aria-valuenow={readiness.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${readiness.percent}%` }} /></div>{dirty && <p className="inline-warning">ความพร้อมอ้างอิงข้อมูลที่บันทึกแล้ว</p>}<ul className="readiness-list">{readiness.ready ? <li className="complete">ข้อมูลแบรนด์พร้อมเผยแพร่</li> : readiness.missing.map((item, index) => <li key={`${item.field}-${index}`}><span className="missing-mark" aria-hidden="true" />{item.message}</li>)}</ul><div className="publish-block"><p className="small-text muted">การเผยแพร่แบรนด์ใหม่ไม่เปลี่ยนข้อมูลแบรนด์ที่บันทึกไว้ในเวอร์ชันโครงการเดิม</p>{canPublish && <><button className="button primary full-width" disabled={dirty || !readiness.ready} onClick={() => setAction({ type: "publish" })}>เผยแพร่แบรนด์</button>{brand.published_version_id && <button className="button text-button full-width" onClick={() => setAction({ type: "withdraw" })}>ถอนการเผยแพร่แบรนด์</button>}</>}</div></div></section></aside></div> : <section className="panel" id="brand-versions-panel" role="tabpanel" aria-labelledby="brand-versions-tab"><div className="panel-heading"><h2>ประวัติการเผยแพร่แบรนด์</h2></div><div className="panel-body">{versionsError ? <LoadError error={versionsError} retry={loadVersions} /> : !versions.length ? <p className="muted">ยังไม่มีเวอร์ชันแบรนด์ที่เผยแพร่</p> : <ol className="version-list">{versions.map(version => <li key={version.version_id}><div className="version-marker">{version.version_no}</div><div className="version-content"><h3>เวอร์ชันแบรนด์ {version.version_no}</h3><p>{version.change_reason}</p><p className="small-text muted source-code">{date(version.published_at)} · {version.publisher}</p>{version.version_id === brand.published_version_id && <span className="status-badge published">เวอร์ชันที่เลือก</span>}{version.payload && <details><summary>ดูข้อมูลแบรนด์ในเวอร์ชัน</summary><dl className="snapshot-list"><div><dt>ชื่อแบรนด์</dt><dd>{version.payload.public_name?.th || "—"}</dd></div><div><dt>คำอธิบาย</dt><dd>{version.payload.description?.th || "—"}</dd></div></dl></details>}{canPublish && version.version_id !== brand.published_version_id && <button className="button secondary" disabled={dirty} onClick={() => setAction({ type: "rollback", version })}>คืนค่าเวอร์ชันแบรนด์นี้</button>}</div></li>)}</ol>}</div></section>}
    {action && <BrandPublishDialog action={action} brand={brand} onCancel={() => setAction(null)} onSaved={async data => { setAction(null); update(data); await loadVersions(); setNotice("บันทึกสถานะการเผยแพร่แบรนด์แล้ว"); }} />}
  </>;
}

function BrandPublishDialog({ action, brand, onCancel, onSaved }: { action: { type: "publish" | "withdraw" | "rollback"; version?: BrandVersion }; brand: Brand; onCancel: () => void; onSaved: (brand: Brand) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const title = action.type === "publish" ? "เผยแพร่แบรนด์" : action.type === "withdraw" ? "ถอนการเผยแพร่แบรนด์" : "คืนค่าเวอร์ชันแบรนด์";
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); if (!reason.trim()) { setError("ระบุเหตุผลในการดำเนินการ"); return; } setPending(true);
    try { const data = await request<Brand>(`v1/admin/brands/${brand.public_brand_id}/${action.type}`, "POST", { change_reason: reason.trim(), ...(action.version ? { version_id: action.version.version_id } : {}) }); await onSaved(data); }
    catch (error) { setError(message(error)); setPending(false); }
  }
  return <AssetDialog title={title} dirty={Boolean(reason)} pending={pending} error={error} onCancel={onCancel} onSubmit={submit} submitLabel={`ยืนยัน${title}`} danger={action.type === "withdraw"}><p>{brand.public_name.th}{action.version ? ` · เวอร์ชัน ${action.version.version_no}` : ""}</p><p className={action.type === "withdraw" ? "inline-warning" : "read-only-note"}>{action.type === "withdraw" ? "การถอนแบรนด์ทำให้โครงการที่อ้างอิงแบรนด์นี้หยุดแสดงผ่าน API ด้วย ต้องตรวจสอบผลกระทบก่อนยืนยัน" : "ข้อมูลแบรนด์ในโครงการที่เผยแพร่แล้วจะคงเวอร์ชันเดิม ต้องเผยแพร่โครงการอีกครั้งเพื่อใช้แบรนด์เวอร์ชันใหม่"}</p><div className="form-field"><label htmlFor="brand-publish-reason">เหตุผลในการเผยแพร่แบรนด์</label><textarea id="brand-publish-reason" rows={3} maxLength={1000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></div></AssetDialog>;
}

export function ProjectBrandCard({ project, role, disabled, onChanged }: { project: Project; role: LocalRole; disabled: boolean; onChanged: (project: Project) => void }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setBrands(await request<Brand[]>("v1/admin/brands")); } catch (error) { setError(message(error)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const matching = brands.filter(brand => project.source?.rem_brand_id && brand.rem_brand_id === project.source.rem_brand_id && !brand.source?.is_deleted);
  const summary = project.brand_summary;
  return <section className="panel" id="project-brand"><div className="panel-heading"><div><h2>แบรนด์และบริษัทตามต้นทาง</h2><p>เลือกเฉพาะแบรนด์ที่ตรงกับรหัสต้นทาง บริษัทอ้างอิงจากโครงการโดยตรง</p></div></div><div className="panel-body">
    <dl className="model-source"><div><dt>รหัสแบรนด์ REM (อ่านอย่างเดียว)</dt><dd>{project.source?.rem_brand_id || "ยังไม่มีรหัสแบรนด์ต้นทาง"}</dd></div><div><dt>ชื่อแบรนด์ต้นทาง</dt><dd>{project.source?.brand_name_rem || "ยังไม่มีข้อมูลชื่อแบรนด์"}</dd></div><div><dt>บริษัทตามโครงการ (อ่านอย่างเดียว)</dt><dd>{project.source?.company_name_rem || "ยังไม่มีข้อมูลชื่อบริษัท"}</dd></div><div><dt>รหัสบริษัท REM</dt><dd>{project.source?.rem_company_id || "ไม่ได้ระบุ"}</dd></div></dl>
    <div className="brand-association"><h3>แบรนด์ที่เลือกให้โครงการ</h3>{summary ? <><a className="asset-file-link" href={brandHref(summary.public_brand_id)}>{summary.public_name.th || summary.rem_brand_id}</a><BrandStatus brand={summary} />{summary.rem_brand_id !== project.source?.rem_brand_id && <p className="field-error">แบรนด์ที่เลือกไม่ตรงกับต้นทางปัจจุบัน กรุณาตรวจสอบใหม่</p>}</> : <p className="muted">ยังไม่ได้เลือกแบรนด์ ต้องเลือกแบรนด์ที่เผยแพร่และตรงกับต้นทางก่อนเผยแพร่โครงการ</p>}</div>
    {notice && <p className="notice success" role="status">{notice}</p>}{error && <LoadError error={error} retry={load} />}
    {mayEdit(role) && <>{disabled && <p className="field-help">บันทึกข้อมูลโครงการก่อนเปลี่ยนแบรนด์หรือส่งคำขอ</p>}<div className="model-actions"><button className="button secondary" disabled={disabled || loading || !matching.length} onClick={() => setChoosing(true)}>เลือกแบรนด์ที่ตรงกับต้นทาง</button><button className="button secondary" disabled={disabled} onClick={() => setRequesting(true)}>ขอเพิ่มแบรนด์สำหรับโครงการ</button></div>{!loading && !error && !matching.length && <p className="field-help">ยังไม่มีแบรนด์ในระบบที่ตรงกับต้นทาง ส่งคำขอให้ผู้ดูแลตรวจสอบได้</p>}</>}
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
