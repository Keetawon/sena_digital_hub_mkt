"use client";
import { useHubPermissions } from "./accounts";
import { PublicWebsiteSource, type WebsiteSource } from "./public-website-source";
import { canOpenPage } from "@/lib/hub-permissions";
import { workspaceLanding } from "./hub-navigation-data";
import { ActorName, accountApi } from "./accounts";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { roleLabels as roles, localPersonas, type LocalRole } from "@/lib/roles";
import { isHubStaff, isContentStaff } from "@/lib/staff";
import { request } from "./hub-request";
import { useHostedSession } from "./hosted-session";
import { HubShell } from "./hub-shell";
import { ProjectSourceReview, ProjectGroupSummary, SourceStatusFilter, type SourceReview, type ProjectGroupInfo } from "./project-source-review";
import { ContentLabel, useFieldCatalog } from "./content-common";
import { ProjectDashboard } from "./project-dashboard";
import { useListQuery, WorkspaceBack, projectHref } from "./workspace-navigation";
import { ProjectComparison, projectChanges } from "./project-review";
import "./project-editor.css";
import { ContentSource } from "./content-source";
import { DemoFields } from "./demo-fields";
import { ContentWorkflow } from "./content-workflow";
import { workflowText } from "@/lib/content-workflow";
import { ProjectAssets, type AssetBinding } from "./project-assets";
import { ProjectFacilities, type Facilities } from "./project-facilities";
import { CommercialTypes, type CommercialType } from "./commercial-types";
import { BrandWorkspace, BrandRequestDialog, ProjectBrandCard, type Brand, type BrandSummary } from "./brand-admin";

type Localized = { th?: string; [locale: string]: string | undefined };
type Readiness = { ready: boolean; percent: number; missing: { field: string; message: string }[]; recommended?: { field: string; message: string; passed: boolean }[]; excluded_models?: { rem_model_id: string; name: string; reason: string }[]; model_catalogue_complete?: boolean };
type SourceEvidence = { source_review?: SourceReview; first_seen_at?: string | null; source_record: Record<string, unknown> | null; intake_manifest_sha256: string | null };
type GoldModelGroup = { model_ids?: string[]; model_name?: string; model_name_eng?: string | null; model_type_ids?: string[]; minimum_model_area?: number | null; maximum_model_area?: number | null; model_attribute_variant?: boolean; technical_model_count?: number };
type GoldSource = { model_groups?: GoldModelGroup[]; record: Record<string, string | number | null>; source_relation: string; source_snapshot_at: string; source_fingerprint: string; provenance: Record<string, unknown> };
type Model = {
  demo_fields?: unknown;
  id: string; public_model_id: string; rem_model_id: string; model_name_rem: string;
  public_name: Localized; bedrooms: number | null; bathrooms: number | null;
  usable_area_sqm: number | null; parking_spaces: number | null;
  match_status: "SUGGESTED" | "CONFIRMED" | "REJECTED";
  match_method: string; match_confidence: number; verified_by: string | null; verified_at: string | null;
  source_updated_at: string | null; source_snapshot_at: string;
} & SourceEvidence;
type SourceProject = SourceEvidence & ProjectGroupInfo & { rem_project_id: string; project_name_rem: string; source_updated_at: string | null; source_snapshot_at: string; source_fingerprint: string; model_count: number; public_project_id: string | null; rem_brand_id: string | null; rem_company_id: string | null; brand_name_rem: string | null; company_name_rem: string | null };
type SourceModel = SourceEvidence & { rem_model_id: string; model_name_rem: string; source_updated_at: string | null; public_model_id: string | null };
type ModelAction = { type: "edit" | "review"; model: Model } | { type: "add" };
export type Project = {
  id?: string;
  demo_fields?: unknown;
  public_project_id: string; public_name: Localized; slug: string; updated_at: string;
  published_version_id: string | null; publication_available: boolean; readiness: Readiness;
  address?: Localized; latitude?: number | null; longitude?: number | null;
  ad_disclaimer?: Localized; meta_title?: Localized; meta_description?: Localized;
  publication_preview?: Record<string, unknown>; publication_preview_redacted?: boolean; website_content?: Localized; website_sources?: WebsiteSource[];
  brand_version_id?: string | null; version_count?: number; has_unpublished_changes?: boolean;
  brand_id?: string | null; brand_summary?: BrandSummary | null;
  gold_source?: GoldSource | null;
  gold_prefill_changes?: { public_name?: Localized; address?: Localized; latitude?: number; longitude?: number };
  source?: SourceEvidence & { rem_project_id: string; project_name_rem: string; source_updated_at: string | null; source_snapshot_at?: string; rem_brand_id?: string | null; rem_company_id?: string | null; brand_name_rem?: string | null; company_name_rem?: string | null };
  models?: Model[]; assets?: AssetBinding[]; facilities?: Facilities; commercial_types?: CommercialType[];
};
type Version = { version_id: string; version_no: number; published_at: string; publisher: string; change_reason: string; payload: Project };
type Draft = { public_name: string; public_name_en: string; slug: string; address: string; address_en: string; latitude: string; longitude: string; ad_disclaimer: string; ad_disclaimer_en: string; meta_title: string; meta_title_en: string; meta_description: string; meta_description_en: string; website_content: string };
export type ProjectTab = "content" | "media" | "models" | "extra" | "versions";
const matchLabels = { SUGGESTED: "รอตรวจสอบ", CONFIRMED: "ยืนยันแล้ว", REJECTED: "ปฏิเสธการจับคู่" };
const labels: Record<string, string> = { public_name: "ชื่อคอมเมอเชียลที่ใช้สื่อสาร (ไทย)", public_name_en: "ชื่อคอมเมอเชียลที่ใช้สื่อสาร (English)", slug: "รหัส URL (slug)", address: "ที่อยู่โครงการ (ไทย)", address_en: "Project address (English)", latitude: "ละติจูด", longitude: "ลองจิจูด", ad_disclaimer: "ข้อความกำกับโฆษณา", ad_disclaimer_en: "ข้อความกำกับโฆษณา (ภาษาอังกฤษ)", meta_title: "ชื่อเรื่องสำหรับผู้ใช้งานข้อมูล", meta_title_en: "ชื่อเรื่องสำหรับผู้ใช้งานข้อมูล (ภาษาอังกฤษ)", meta_description: "คำอธิบายย่อ", meta_description_en: "คำอธิบายย่อ (ภาษาอังกฤษ)", website_content: "เนื้อหาจากเว็บไซต์ (อ้างอิงภายใน)" };

function Icon({ name, size = 20 }: { name: "grid" | "arrow" | "check" | "clock" | "document" | "image" | "shield" | "chevron" | "alert" | "building" | "save"; size?: number }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    arrow: <><path d="M4 12h16M14 6l6 6-6 6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    document: <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
    alert: <><path d="M12 3 2 21h20zM12 9v5M12 17h.01" /></>,
    building: <><path d="M4 21V6l8-3v18M12 9h8v12M2 21h20M7 8v2M7 13v2M16 12v2M16 17v2" /></>,
    save: <><path d="M4 3h13l4 4v14H3V3zM7 3v6h9V3M7 21v-8h10v8" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatDate(value?: string | null) {
  if (!value) return "ยังไม่มีข้อมูล";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(date);
}

function sourceProvenance(source: SourceEvidence) {
  if (source.source_record?.source_kind === "sena_public_website") return "ดึงจากเว็บไซต์สาธารณะ SENA · รอตรวจสอบเนื้อหา · ยังไม่ยืนยันสถานะ REM";
  return source.intake_manifest_sha256 != null ? "สำเนา REM ที่ตรวจสอบหลักฐานแล้ว · ต้องตรวจเนื้อหาและการจับคู่ก่อนเผยแพร่ · ยังไม่ใช่ DW สด" : "ข้อมูลจำลองสำหรับเครื่องพัฒนา";
}

function sourceDate(value?: string | null) {
  return value ? formatDate(value) : "ยังยืนยันเวลา/เขตเวลาต้นทางไม่ได้";
}

function RawModelEvidence({ source }: { source: SourceEvidence }) {
  if (!source.source_record || source.intake_manifest_sha256 == null) return null;
  return <><div><dt>ModelTypeID ต้นทาง (อ่านอย่างเดียว)</dt><dd>{String(source.source_record.ModelTypeID ?? source.source_record.model_type_id ?? "—")}</dd></div><div><dt>ModelArea ต้นทาง (อ่านอย่างเดียว)</dt><dd>{String(source.source_record.ModelArea ?? source.source_record.model_area ?? "—")} · ยังไม่ยืนยันหน่วยและความหมาย ห้ามใช้แทนพื้นที่ใช้สอยที่ตรวจสอบแล้ว</dd></div></>;
}

function draftFrom(project: Project): Draft {
  return { public_name: project.public_name?.th ?? "", public_name_en: project.public_name?.en ?? "", slug: project.slug ?? "", address: project.address?.th ?? "", address_en: project.address?.en ?? "", latitude: project.latitude?.toString() ?? "", longitude: project.longitude?.toString() ?? "", ad_disclaimer: project.ad_disclaimer?.th ?? "", ad_disclaimer_en: project.ad_disclaimer?.en ?? "", meta_title_en: project.meta_title?.en ?? "", meta_description_en: project.meta_description?.en ?? "", meta_title: project.meta_title?.th ?? "", meta_description: project.meta_description?.th ?? "", website_content: project.website_content?.th ?? "" };
}

function coordinateError(name: "latitude" | "longitude", value: string) {
  if (!value.trim()) return undefined;
  const number = Number(value);
  const [min, max] = name === "latitude" ? [5, 21] : [97, 106];
  return !Number.isFinite(number) || number < min || number > max
    ? "พิกัดอยู่นอกประเทศไทย ตรวจละติจูดและลองจิจูด" : undefined;
}

export function HubAdmin({ localMode, initialRole, projectId, brandId = null, view = null, sourceVersion = null, sourceDraftAt = null }: { localMode: boolean; initialRole: LocalRole | null; projectId: string | null; brandId?: string | null; view?: string | null; sourceVersion?: string | null; sourceDraftAt?: string | null }) {
  const permissions = useHubPermissions();
  const enabled = localMode || Boolean(useHostedSession());
  const [role, setRole] = useState<LocalRole | null>(initialRole);
  const [switching, setSwitching] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);
  const brandsView = Boolean(brandId || view === "brands");

  async function selectRole(nextRole: LocalRole) {
    if (hasUnsavedDraft && !window.confirm("มีข้อมูลร่างที่ยังไม่ได้บันทึก ต้องการทิ้งการแก้ไขและเปลี่ยนบัญชีทดสอบหรือไม่?")) return;
    setSwitching(true); setSessionError("");
    try {
      const response = await fetch("/api/local-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "เปลี่ยนบัญชีทดสอบไม่สำเร็จ");
      setHasUnsavedDraft(false); setRole(nextRole);
      window.dispatchEvent(new Event("hub-accounts-changed"));
      const me = await accountApi("v1/me");
      window.location.assign(me.status !== "ACTIVE" ? "/account/request" : canOpenPage(me, location.pathname, new URLSearchParams(location.search)) ? location.pathname + location.search : workspaceLanding(me.capabilities));
    } catch (error) { setSessionError(error instanceof Error ? error.message : "เปลี่ยนบัญชีทดสอบไม่สำเร็จ"); }
    finally { setSwitching(false); }
  }

  return <HubShell publisher={enabled && role === "publisher"} section={brandsView ? "brands" : "projects"} staff={enabled && isHubStaff(role)} residential={enabled && isContentStaff(role)} finance={role === "admin" || role === "online_staff"} roleLabel={role ? roles[role] : "ยังไม่ได้เลือกบัญชี"} toolbar={localMode && <div className="local-banner" role="note"><div className="local-note"><Icon name="shield" size={18} /><span><strong>พื้นที่ทดสอบในเครื่อง</strong> · แยกป้ายข้อมูลจำลองและสำเนา REM · ยังไม่เชื่อม DW สด</span></div><label className="role-picker">บัญชีทดสอบ<select aria-label="เลือกบัญชีทดสอบ" value={role ?? ""} disabled={switching} onChange={event => void selectRole(event.target.value as LocalRole)}><option value="" disabled>เลือกบัญชี</option>{localPersonas.map(value => <option key={value} value={value}>{roles[value]}</option>)}</select></label></div>}>
        {sessionError && <div className="notice error" role="alert">{sessionError}</div>}
        {!enabled ? <SetupNotice /> : !role ? <section className="welcome-panel"><div className="section-icon"><Icon name="shield" size={28} /></div><p className="eyebrow">ยินดีต้อนรับสู่พื้นที่ทดสอบ</p><h1>เริ่มจากบทบาทของคุณ</h1><p className="muted">ทดลองจัดเตรียมข้อมูลและตรวจสอบความพร้อมก่อนเผยแพร่<br className="desktop-only" /> เลือกบัญชีทดสอบเพื่อเริ่มใช้งาน บัญชีเหล่านี้ไม่ใช่ระบบเข้าสู่ระบบจริง</p><div className="role-cards">{localPersonas.map(value => <button key={value} className="role-card" disabled={switching} onClick={() => void selectRole(value)}><Icon name={value === "editor" ? "document" : value === "publisher" ? "shield" : "grid"} /><strong>{roles[value]}</strong><span>{value === "editor" ? "แก้ไขและบันทึกข้อมูลร่าง" : value === "publisher" ? "ตรวจสอบ เผยแพร่ และคืนค่า" : value === "admin" ? "จัดการแบรนด์ คำขอ และข้อมูลร่าง" : "อ่านข้อมูลและตรวจสอบสถานะ"}</span><Icon name="arrow" /></button>)}</div></section> : (sourceVersion || sourceDraftAt) && (projectId || brandId) ? <ContentSource key={`${role}-${sourceVersion ?? sourceDraftAt}`} kind={brandId ? "brand" : "project"} publicId={(brandId ?? projectId)!} version={sourceVersion} draftAt={sourceDraftAt} allowed={permissions.can(brandId ? "brands" : "projects")} /> : brandsView ? <BrandWorkspace key={`${role}-${brandId || "overview"}`} brandId={brandId} role={role} onDirtyChange={setHasUnsavedDraft} /> : projectId ? <ProjectDetail key={`${projectId}-${role}`} projectId={projectId} role={role} onDirtyChange={setHasUnsavedDraft} /> : <ProjectOverview key={role} role={role} />}
  </HubShell>;
}

function SetupNotice() {
  return <section className="welcome-panel"><div className="section-icon"><Icon name="shield" size={28} /></div><p className="eyebrow">ยังไม่เปิดใช้งาน</p><h1>กรุณาตั้งค่าการเข้าสู่ระบบ</h1><p className="muted">ระบบนี้ยังไม่พร้อมให้บุคลากรเข้าสู่ระบบจริง<br />ผู้ดูแลต้องตั้งค่าการยืนยันตัวตนก่อนใช้งาน ขณะนี้ยังไม่มีการเข้าถึงข้อมูล</p></section>;
}

export function ProjectOverview({ role }: { role: LocalRole }) {
  const [showSources, setShowSources] = useState(false);
  const [sourceSearch, setSourceSearch] = useState("");
  const { href } = useListQuery();
  return <>
    <div className="page-heading"><div><p className="eyebrow">ข้อมูลสำหรับเผยแพร่</p><h1>โครงการที่อยู่อาศัย</h1><p className="muted">ดูภาพรวมตามแบรนด์และกลุ่ม แล้วเปิดโครงการเพื่อจัดเตรียมหรือตรวจข้อมูล</p></div><span className="scope-pill"><span />SENA Residential</span></div>
    <div className="section-heading"><h2>พื้นที่ทำงานโครงการ</h2><button className="button secondary" aria-expanded={showSources} aria-controls="source-picker" onClick={() => setShowSources(value => !value)}>{showSources ? "ปิดรายการต้นทาง" : "เลือกโครงการจากต้นทาง"}</button></div>
    {showSources && <SourceProjects role={role} initialSearch={sourceSearch} returnTo={href} />}
    <ProjectDashboard role={role} onStart={sourceId => { setSourceSearch(sourceId); setShowSources(true); requestAnimationFrame(() => document.getElementById("source-picker")?.scrollIntoView({ block: "start" })); }} />
  </>;
}

function SourceProjects({ role, initialSearch = "", returnTo = "/" }: { role: LocalRole; initialSearch?: string; returnTo?: string }) {
  const permissions = useHubPermissions();
  const [sources, setSources] = useState<SourceProject[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<Record<string, string>>({});
  const [requestSource, setRequestSource] = useState<SourceProject | null>(null);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [sourceStatus, setSourceStatus] = useState("all");
  useEffect(() => setSearch(initialSearch), [initialSearch]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const [sourceRows, brandRows] = await Promise.all([request<SourceProject[]>("v1/admin/sources/projects"), permissions.can("brands") ? request<Brand[]>("v1/admin/brands") : Promise.resolve([])]); setSources(sourceRows); setBrands(brandRows); }
    catch (error) { setError(error instanceof Error ? error.message : "โหลดรายการต้นทางไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, [permissions.capabilities]);
  useEffect(() => { void load(); }, [load]);
  async function select(source: SourceProject) {
    setPending(source.rem_project_id); setError("");
    try {
      const created = await request<Project>("v1/admin/projects", "POST", { rem_project_id: source.rem_project_id, ...(selectedBrands[source.rem_project_id] ? { brand_id: selectedBrands[source.rem_project_id] } : {}) });
      window.location.assign(projectHref(created.public_project_id, returnTo));
    } catch (error) { setError(error instanceof Error ? error.message : "สร้างข้อมูลร่างไม่สำเร็จ"); setPending(null); }
  }
  const query = search.trim().toLocaleLowerCase("th");
  const filtered = sources.filter(source => (sourceStatus === "all" || (source.source_review?.status_raw ?? "null") === sourceStatus) && `${source.rem_project_id} ${source.project_name_rem}`.toLocaleLowerCase("th").includes(query));
  return <section className="panel" id="source-picker" aria-labelledby="source-picker-title">
    <div className="panel-heading"><div><h2 id="source-picker-title">เลือกจากข้อมูลต้นทาง</h2><p>ตรวจแหล่งข้อมูลของแต่ละรายการ · ยังไม่ได้เชื่อม DW สด</p></div><Icon name="document" /></div>
    <div className="panel-body">
      <p className="read-only-note">การเลือกจะสร้างข้อมูลร่างพร้อมแบบที่อยู่อาศัยจากต้นทาง ทุกแบบต้องได้รับการตรวจสอบก่อนเผยแพร่ ชื่อและรหัสต้นทางแก้ไขไม่ได้</p>
      <div className="form-field"><label htmlFor="source-search">ค้นหาชื่อหรือรหัสโครงการต้นทาง</label><input id="source-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <SourceStatusFilter id="picker-rem-status" rows={sources} value={sourceStatus} onChange={setSourceStatus} />
      {notice && <p className="notice success" role="status">{notice}</p>}
      {error && <div className="notice error" role="alert">{error}<button className="button secondary" onClick={() => void load()}>โหลดรายการใหม่</button></div>}
      {loading ? <LoadingState /> : <><p className="small-text muted" role="status">พบ {filtered.length} โครงการ</p><ul className="source-cards">{filtered.map(source => <li key={source.rem_project_id}>
        <div><h3>{source.project_name_rem}</h3><ProjectSourceReview value={source.source_review} /><ProjectGroupSummary value={source} details /><p className="small-text source-code">{source.rem_project_id} · {source.model_count} แบบที่อยู่อาศัย</p><p className="small-text muted">แบรนด์ต้นทาง: {source.brand_name_rem || "ยังไม่มีข้อมูลชื่อ"} · รหัส {source.rem_brand_id || "ไม่ระบุ"}</p><details><summary className="small-text muted">ข้อมูลบริษัทจากต้นทาง</summary><p className="small-text muted">{source.company_name_rem || "ยังไม่มีข้อมูลชื่อ"} · รหัส {source.rem_company_id || "ไม่ระบุ"}</p></details><p className="small-text muted">{sourceProvenance(source)}</p><p className="small-text muted">ปรับปรุงต้นทาง: {sourceDate(source.source_updated_at)}</p><p className="small-text muted">เวลาสกัดสำเนาต้นทาง: {formatDate(source.source_snapshot_at)}</p></div>
        {source.public_project_id ? <a className="button secondary" href={projectHref(source.public_project_id, returnTo)}>เปิดโครงการที่มีอยู่</a> : permissions.can("projects", "edit") ? <div className="source-project-actions"><div className="form-field"><label htmlFor={`source-brand-${source.rem_project_id}`}>แบรนด์สำหรับ {source.project_name_rem}</label><select id={`source-brand-${source.rem_project_id}`} value={selectedBrands[source.rem_project_id] || ""} disabled={Boolean(pending) || source.source_review?.brand_binding_allowed === false} onChange={event => setSelectedBrands(previous => ({ ...previous, [source.rem_project_id]: event.target.value }))}><option value="">เลือกภายหลัง (ยังเผยแพร่ไม่ได้)</option>{brands.filter(brand => source.rem_brand_id && brand.rem_brand_id === source.rem_brand_id && !brand.source?.is_deleted).map(brand => <option key={brand.id} value={brand.id}>{brand.public_name.th || brand.rem_brand_id} · {brand.publication_available ? "เผยแพร่แล้ว" : "ฉบับร่าง"}</option>)}</select></div><button className="button primary" disabled={Boolean(pending)} onClick={() => void select(source)}>{pending === source.rem_project_id ? "กำลังสร้างข้อมูลร่าง…" : "เลือกโครงการนี้"}</button><button className="button secondary" disabled={Boolean(pending) || !permissions.can("brands", "edit")} onClick={() => setRequestSource(source)}>ขอเพิ่มแบรนด์สำหรับโครงการ</button></div> : <span className="small-text muted">บัญชีนี้ดูต้นทางได้เท่านั้น</span>}
      </li>)}</ul>{!filtered.length && <p className="muted">ไม่พบโครงการที่ตรงกับการค้นหา</p>}</>}
      {requestSource && <BrandRequestDialog sourceId={requestSource.rem_brand_id} initialName={requestSource.brand_name_rem || ""} onCancel={() => setRequestSource(null)} onCreated={() => { setRequestSource(null); setNotice("ส่งคำขอเพิ่มแบรนด์แล้ว สร้างโครงการเป็นข้อมูลร่างและเลือกแบรนด์ภายหลังได้"); }} />}
    </div>
  </section>;
}

function StatusBadge({ project }: { project: Project }) {
  const unavailable = Boolean(project.published_version_id) && project.publication_available === false;
  return <span className={`status-badge ${project.publication_available ? "published" : "draft"}`}><span />{unavailable ? "หยุดแสดงผ่าน API" : project.published_version_id && project.has_unpublished_changes ? "มีการแก้ไขที่ยังไม่เผยแพร่" : project.publication_available ? "เผยแพร่แล้ว" : project.version_count ? "ถอนการเผยแพร่แล้ว" : "ฉบับร่าง"}</span>;
}
function LoadingState() { return <div className="loading-state" role="status"><span className="spinner" />กำลังโหลดข้อมูล…</div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="empty-state error-state" role="alert"><Icon name="alert" size={32} /><h2>ยังโหลดข้อมูลไม่ได้</h2><p>{message}</p><button className="button secondary" onClick={retry}>ลองอีกครั้ง</button></div>; }

export function ProjectDetail({ projectId, role, onDirtyChange, embeddedTab, onRelatedEditingChange, onPendingChange, onEmbeddedTabChange, onRevealField, onWorkflowChanged }: { projectId: string; role: LocalRole; onDirtyChange: (dirty: boolean) => void; embeddedTab?: ProjectTab; onRelatedEditingChange?: (busy: boolean) => void; onPendingChange?: (pending: boolean) => void; onEmbeddedTabChange?: (tab: ProjectTab) => void; onRevealField?: (field: string) => void; onWorkflowChanged?: () => void }) {
  const { catalog: contentCatalog } = useFieldCatalog();
  const permissions = useHubPermissions();
  const [project, setProject] = useState<Project | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState("");
  const [workflowOwners, setWorkflowOwners] = useState<string[]>([]), [workflowRevision, setWorkflowRevision] = useState(0);
  const workflowActive = workflowOwners.length > 0;
  function workflowEditing(owner: string, active: boolean) {
    setWorkflowOwners(owners => owners.includes(owner) === active ? owners : active ? [...owners, owner] : owners.filter(value => value !== owner));
  }
  const [projectMediaEditing, setProjectMediaEditing] = useState(false), [modelMediaEditing, setModelMediaEditing] = useState(false);
  const mediaEditing = projectMediaEditing || modelMediaEditing;
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionsError, setVersionsError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [modelAction, setModelAction] = useState<ModelAction | null>(null);
  const [tab, setTab] = useState<ProjectTab>(embeddedTab ?? "content");
  useEffect(() => { if (embeddedTab) setTab(embeddedTab); }, [embeddedTab]);
  const [navigationTarget, setNavigationTarget] = useState<string | null>(null);
  const [mediaModelId, setMediaModelId] = useState("");
  const [commercialDirty, setCommercialDirty] = useState(false);
  const [facilitiesDirty, setFacilitiesDirty] = useState(false);
  const [modelDirty, setModelDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [conflict, setConflict] = useState(false);
  const base = `v1/admin/projects/${encodeURIComponent(projectId)}`;
  const canEdit = permissions.can("projects", "edit");
  const dirty = Boolean(project && draft && JSON.stringify(draft) !== JSON.stringify(draftFrom(project)));
  const relatedDirty = commercialDirty || facilitiesDirty || modelDirty;
  const anyDirty = dirty || relatedDirty || mediaEditing || Boolean(workflowActive);
  useEffect(() => { onDirtyChange(anyDirty); return () => onDirtyChange(false); }, [anyDirty, onDirtyChange]);
  useEffect(() => { onRelatedEditingChange?.(relatedDirty || mediaEditing || saving || Boolean(workflowActive)); return () => onRelatedEditingChange?.(false); }, [relatedDirty, mediaEditing, saving, workflowActive, onRelatedEditingChange]);
  useEffect(() => { onPendingChange?.(saving || mediaEditing || Boolean(workflowActive)); return () => onPendingChange?.(false); }, [saving, mediaEditing, workflowActive, onPendingChange]);

  const load = useCallback(async () => {
    setLoading(true); setError(""); setConflict(false);
    try {
      const data = await request<Project>(base);
      setProject(data); setDraftUpdatedAt(data.updated_at); setDraft(draftFrom(canEdit ? { ...data, ...data.gold_prefill_changes } : data));
      try { setVersions(await request<Version[]>(`${base}/versions`)); setVersionsError(""); }
      catch (error) { setVersionsError(error instanceof Error ? error.message : "โหลดประวัติไม่สำเร็จ"); }
    } catch (error) { setError(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, [base, canEdit]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (loading || !project) return;
    const field = new URLSearchParams(window.location.search).get("field");
    if (field && (!embeddedTab || embeddedTab === "models" && /models?\./.test(field))) revealField(field);
    // The query is consumed once per loaded project; subsequent edits preserve the chosen tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, projectId]);

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);
  useEffect(() => {
    if (!navigationTarget) return;
    const target = document.getElementById(navigationTarget);
    const disclosure = target?.closest("details");
    if (disclosure) disclosure.open = true;
    target?.scrollIntoView({ block: navigationTarget.endsWith("-panel") ? "start" : "center" });
    target?.focus({ preventScroll: true });
    setNavigationTarget(null);
  }, [tab, navigationTarget]);

  function projectChangesForSave() {
    if (!project || !draft) return null;
    return { public_name: { ...project.public_name, th: draft.public_name, en: draft.public_name_en }, slug: draft.slug, address: { ...project.address, th: draft.address, en: draft.address_en }, latitude: draft.latitude.trim() === "" ? null : Number(draft.latitude), longitude: draft.longitude.trim() === "" ? null : Number(draft.longitude), ad_disclaimer: { ...project.ad_disclaimer, th: draft.ad_disclaimer, en: draft.ad_disclaimer_en }, meta_title: { ...project.meta_title, th: draft.meta_title, en: draft.meta_title_en }, meta_description: { ...project.meta_description, th: draft.meta_description, en: draft.meta_description_en }, website_content: { ...project.website_content, th: draft.website_content } };
  }
  async function reloadWorkflow() {
    const data = await request<Project>(base);
    setProject(data); setDraft(draftFrom(data)); setDraftUpdatedAt(data.updated_at); setError(""); setConflict(false);
    setWorkflowRevision(value => value + 1); onWorkflowChanged?.();
  }
  async function save(event?: FormEvent, nextTab?: ProjectTab) {
    event?.preventDefault();
    if (!draft || !project || !canEdit || relatedDirty || mediaEditing || workflowActive || saving) return;
    const errors: Partial<Record<keyof Draft, string>> = {};
    if (draft.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) errors.slug = "ใช้ตัวอักษรอังกฤษตัวเล็ก ตัวเลข และขีดกลาง เช่น sena-example";
    for (const name of ["latitude", "longitude"] as const) {
      const message = coordinateError(name, draft[name]);
      if (message) errors[name] = message;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) { revealField(Object.keys(errors)[0]); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = { updated_at: draftUpdatedAt, ...projectChangesForSave() };
      const data = await request<Project>(base, "PATCH", payload);
      setProject(data); setDraft(draftFrom(data)); setDraftUpdatedAt(data.updated_at); onWorkflowChanged?.(); setNotice("บันทึกข้อมูลร่างแล้ว ข้อมูลที่เผยแพร่ยังคงเป็นเวอร์ชันเดิม"); setConflict(false);
      if (nextTab) goToTab(nextTab);
    } catch (error) {
      setError(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
      if ((error as { status?: number }).status === 409) setConflict(true);
    } finally { setSaving(false); }
  }

  function goToTab(next: ProjectTab) {
    if (workflowActive || mediaEditing) return;
    setTab(next);
    onEmbeddedTabChange?.(next);
    setNavigationTarget(`${next}-panel`);
  }

  function acceptMediaUpdate(data: Project) {
    // Media saves change the revision, not the project form. A conflict reload
    // may contain somebody else's text: keep the old revision so it cannot be overwritten.
    if (dirty && project && JSON.stringify(draftFrom(data)) !== JSON.stringify(draftFrom(project))) {
      setError("ข้อมูลโครงการถูกแก้ไขจากที่อื่น ข้อความที่คุณกำลังแก้ไขยังอยู่ กรุณาตรวจข้อมูลล่าสุดก่อนบันทึก");
      setConflict(true);
      return;
    }
    setProject(data);
    // A verified media-only write advances the ordinary writer's guard while
    // preserving typed text. Workflow metadata never enters this callback.
    setDraftUpdatedAt(data.updated_at);
    if (!dirty) setDraft(draftFrom(data));
    onWorkflowChanged?.();
  }


  function revealField(name: string) {
    onRevealField?.(name);
    const anchor = missingAnchor(name);
    const asset = project?.assets?.find(item => name.split(".").includes(item.id));
    const linkedModel = project?.models?.find(model => name.split(".").some(part => part === model.id || part === model.public_model_id));
    if (linkedModel || asset?.public_model_id) setMediaModelId(linkedModel?.public_model_id ?? asset!.public_model_id!);
    setTab(anchor.startsWith("facilities") ? "extra" : anchor === "models" || asset?.public_model_id ? "models" : anchor === "assets" ? "media" : "content");
    setNavigationTarget(asset?.public_model_id ? "model-media" : anchor === "source" ? "gold-project_id" : anchor);
    const modelField = name.split(".").at(-1);
    if (linkedModel && canEdit && !anyDirty && modelField && ["specifications", "public_name", "bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces"].includes(modelField)) {
      setModelAction({ type: "edit", model: linkedModel });
      setNavigationTarget(`model-${modelField === "specifications" ? "public_name" : modelField}`);
    }
  }

  if (loading) return <LoadingState />;
  if (!project || !draft) return <>{!embeddedTab && <WorkspaceBack />}<ErrorState message={error} retry={load} /></>;
  const readiness = project.readiness ?? { ready: false, percent: 0, missing: [] };

  function field(name: keyof Draft, multiline = false, help?: string) {
    const coordinate = name === "latitude" || name === "longitude";
    const common = { id: name, name, "data-workspace-field": `project.${name}`, form: "project-details-form", value: draft![name], disabled: !canEdit || saving || relatedDirty, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setDraft(previous => previous ? { ...previous, [name]: event.target.value } : previous); setFieldErrors(previous => ({ ...previous, [name]: undefined })); setNotice(""); },
      onBlur: () => { if (coordinate) setFieldErrors(previous => ({ ...previous, [name]: coordinateError(name, draft![name]) })); },
      onPaste: (event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (!coordinate) return;
        const pair = event.clipboardData.getData("text").split(",").map(value => value.trim());
        if (pair.length !== 2 || pair.some(value => !value || !Number.isFinite(Number(value)))) return;
        event.preventDefault();
        setDraft(previous => previous ? { ...previous, latitude: pair[0], longitude: pair[1] } : previous);
        setFieldErrors(previous => ({ ...previous, latitude: coordinateError("latitude", pair[0]), longitude: coordinateError("longitude", pair[1]) }));
        setNotice("");
      },
      "aria-invalid": Boolean(fieldErrors[name]), "aria-describedby": [help ? `${name}-help` : "", fieldErrors[name] ? `${name}-error` : ""].filter(Boolean).join(" ") || undefined };
    return <div className="form-field"><ContentLabel htmlFor={name} field={contentCatalog?.items.find(field => field.field_key === `project.${name.replace(/_en$/, "")}`)}>{labels[name]}</ContentLabel>{multiline ? <textarea {...common} rows={name === "website_content" ? 16 : name === "ad_disclaimer" ? 4 : 3} maxLength={name === "website_content" ? 200000 : name.startsWith("meta_description") ? 1000 : 5000} /> : <input {...common} type="text" inputMode={name === "latitude" || name === "longitude" ? "decimal" : undefined} maxLength={name.startsWith("public_name") ? 250 : 300} />}{help && <p className="field-help" id={`${name}-help`}>{help}</p>}{fieldErrors[name] && <p className="field-error" id={`${name}-error`}>{fieldErrors[name]}</p>}</div>;
  }

  function sourceField(name: string, label: string) {
    const gold = project?.gold_source?.record[name];
    const mirror: Record<string, unknown> = { commercial_brand: project?.source?.brand_name_rem,
      project_id: project?.source?.rem_project_id, project_name: project?.source?.project_name_rem,
      project_name_eng: project?.source?.source_record?.ProjectNameEng ?? project?.source?.source_record?.project_name_en,
      rem_project_group_id: project?.source?.source_record?.ProjectGroupID ?? project?.source?.source_record?.rem_project_group_id };
    const fromRem = gold == null || gold === "";
    const value = fromRem ? mirror[name] : gold;
    return <div className="form-field source-field"><span>{label}<span className="field-chip">อ่านอย่างเดียว</span></span><p id={`gold-${name}`} tabIndex={-1}>{value == null || value === "" ? "ยังไม่มีข้อมูลต้นทาง" : String(value)}{value != null && value !== "" && <small className="source-origin">{fromRem ? "จาก REM" : "จาก DW"}</small>}</p></div>;
  }
  const tabs: { id: ProjectTab; label: string }[] = [{ id: "content", label: "ข้อมูลหลัก" }, { id: "media", label: "รูปภาพ" }, { id: "models", label: "แบบที่อยู่อาศัย" }, { id: "extra", label: "ข้อมูลเสริม" }, { id: "versions", label: "เผยแพร่และประวัติ" }];
  const live = versions.find(version => version.version_id === project.published_version_id)?.payload;
  const gapsFor = (id: ProjectTab) => [...readiness.missing, ...(id === "models" ? (readiness.recommended ?? []).filter(item => !item.passed && item.field.startsWith("models.")) : [])].filter(item => {
    const anchor = missingAnchor(item.field);
    const modelAsset = project.assets?.some(asset => asset.public_model_id && item.field.split(".").includes(asset.id));
    return id === "versions" || (anchor === "models" || modelAsset ? id === "models" : anchor === "assets" ? id === "media" : id === "content");
  });
  const confirmed = project.models?.filter(model => model.match_status === "CONFIRMED").length ?? 0;
  const sortedModels = [...(project.models ?? [])].sort((a, b) => a.rem_model_id.localeCompare(b.rem_model_id, "en", { numeric: true }));
  const mediaModel = sortedModels.find(model => model.public_model_id === mediaModelId) ?? sortedModels[0];
  const goldModelGroups = mediaModel ? project.gold_source?.model_groups?.filter(group => group.model_ids?.includes(mediaModel.rem_model_id)) ?? [] : [];
  const sourceWarnings = project.gold_source?.provenance.quality_warnings;
  const goldQualityWarnings = Array.isArray(sourceWarnings) ? sourceWarnings.filter((warning): warning is string => typeof warning === "string" && warning.trim().length > 0) : [];
  const missingGroups = [
    { label: "ข้อมูลโครงการ", items: readiness.missing.filter(item => !/model|brand|hero|thumbnail|asset/i.test(item.field)) },
    { label: "แบรนด์และสื่อ", items: readiness.missing.filter(item => !/model/i.test(item.field) && /brand|hero|thumbnail|asset/i.test(item.field)) },
    { label: "แบบที่อยู่อาศัย", items: readiness.missing.filter(item => /model/i.test(item.field)) },
  ];

  return <div className={embeddedTab ? "entity-embedded-editor" : undefined}>
    {!embeddedTab && <WorkspaceBack />}
    <p className="project-legacy-content-link"><a className="button secondary" href={`/content?project=${encodeURIComponent(projectId)}`} onClick={event => { if (anyDirty && !window.confirm("มีข้อมูลที่ยังไม่บันทึก ต้องการออกและละทิ้งการแก้ไขหรือไม่")) event.preventDefault(); }}>เนื้อหาเว็บไซต์โครงการ</a></p>
    <div className="page-heading detail-heading"><div><div className="eyebrow">ข้อมูลโครงการ <span className="heading-separator">/</span> {project.public_project_id}</div><h1>{project.public_name.th || "โครงการที่ยังไม่ระบุชื่อ"}</h1><DemoFields fields={project.demo_fields} /><p className="muted">ปรับปรุงล่าสุด {formatDate(project.updated_at)}</p></div><StatusBadge project={{ ...project, version_count: versions.length, has_unpublished_changes: Boolean(live && projectChanges(project, live).length) }} /></div>
    {notice && <div className="notice success" role="status"><Icon name="check" />{notice}</div>}
    {error && <div className="notice error" role="alert"><div><strong>{error}</strong>{conflict && <p>ข้อมูลร่างของคุณยังอยู่ กรุณาคัดลอกข้อความที่ต้องการเก็บ ก่อนโหลดข้อมูลล่าสุด</p>}</div>{conflict && <button className="button secondary" onClick={() => void load()}>โหลดข้อมูลล่าสุด</button>}</div>}
    <div className="project-readiness-strip" aria-label="สรุปความพร้อม"><div><strong>{readiness.ready ? "พร้อมเผยแพร่ · ไม่มีรายการค้าง" : "ยังมีเงื่อนไขก่อนเผยแพร่"}</strong><span>{readiness.ready ? "ข้อมูลที่บันทึกผ่านรายการตรวจสอบแล้ว" : `เหลือ ${readiness.missing.length} รายการที่ต้องตรวจสอบ`}</span></div><button className="button text-button" onClick={() => { setTab("versions"); requestAnimationFrame(() => document.getElementById("versions-tab")?.focus()); }}>ตรวจความพร้อม<Icon name="arrow" size={17} /></button></div>
    <p className="project-flow-hint">เริ่มจากข้อมูลและสื่อโครงการ → จัดเตรียมแบบที่อยู่อาศัย → ตรวจความพร้อมก่อนส่งต่อ</p>
    <div className="detail-tabs project-tabs" role="tablist" aria-label="ส่วนงานโครงการ">{tabs.map((item, index) => <button key={item.id} id={`${item.id}-tab`} role="tab" aria-selected={tab === item.id} aria-controls={`${item.id}-panel`} tabIndex={tab === item.id ? 0 : -1} onClick={() => goToTab(item.id)} onKeyDown={event => { const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0; if (!offset && event.key !== "Home" && event.key !== "End") return; event.preventDefault(); const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length].id; setTab(next); document.getElementById(`${next}-tab`)?.focus(); }}><span>{item.label}</span><span className="tab-count" aria-label={item.id === "extra" ? "ข้อมูลเสริม ไม่กีดกันการเผยแพร่" : item.id === "models" ? `ยืนยัน ${confirmed} จาก ${project.models?.length ?? 0} แบบ; ยังขาด ${gapsFor(item.id).length}` : gapsFor(item.id).length ? `ยังขาด ${gapsFor(item.id).length}` : "ครบแล้ว"}>{item.id === "models" ? `${confirmed}/${project.models?.length ?? 0} · ` : ""}{item.id === "extra" ? "เสริม" : gapsFor(item.id).length || "✓"}</span></button>)}</div>
    <div data-project-assistant />
    <div className="project-workspace">
      <div id="content-panel" role="tabpanel" tabIndex={-1} aria-labelledby="content-tab" hidden={tab !== "content"}>
        <form id="project-details-form" inert={Boolean(workflowActive) || mediaEditing} onSubmit={save} noValidate>
          <section className="panel project-details" aria-labelledby="project-details-title"><div className="panel-heading"><div><span className="section-chip">รายละเอียดโครงการ</span><h2 id="project-details-title">ชื่อและที่ตั้งโครงการ</h2><p>ตรวจข้อมูลอ้างอิงจาก DW แล้วปรับชื่อและที่อยู่สำหรับการสื่อสาร</p></div><span className="language-chip">ไทย · English</span></div><div className="panel-body">
            {!canEdit && <p className="read-only-note"><Icon name="shield" size={16} />บัญชีนี้อ่านข้อมูลได้ การแก้ไขเป็นหน้าที่ของผู้แก้ไขข้อมูล</p>}
            <ProjectSourceReview value={project.source?.source_review} />
            {!project.gold_source && <p className="read-only-note">ข้อมูลอ้างอิงที่ DW ยังไม่มีจะแสดงสำเนา REM พร้อมป้าย “จาก REM” กรุณาตรวจสอบก่อนกรอกข้อมูลสื่อสาร</p>}
            {canEdit && project.gold_prefill_changes && Object.keys(project.gold_prefill_changes).length > 0 && dirty && <p className="read-only-note" role="note">เติมค่าเริ่มต้นจาก DW ในช่องที่ยังไม่ได้กรอกให้แล้ว กรุณาตรวจสอบและกดบันทึกข้อมูลร่าง ค่าเหล่านี้ยังไม่ได้บันทึกหรือเผยแพร่</p>}

            {goldQualityWarnings.length > 0 && <div className="inline-warning" role="note" aria-label="ข้อควรตรวจสอบจาก DW"><strong>ข้อควรตรวจสอบจาก DW</strong><ul>{goldQualityWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
            <p className="field-help source-provenance">{project.source ? sourceProvenance(project.source) : "ยังไม่มีข้อมูลต้นทาง"}{project.source?.source_snapshot_at && ` · ${formatDate(project.source.source_snapshot_at)}`}</p>
            <div className="project-fields">
              {sourceField("commercial_brand", "แบรนด์")}
              {sourceField("project_id", "รหัสโครงการ")}
              {sourceField("rem_project_group_id", "รหัสกลุ่มโครงการ")}
              {sourceField("project_name", "ชื่อโครงการไทยจาก REM")}
              {field("public_name", false, "ชื่อที่ใช้สื่อสารกับลูกค้า แก้ไขได้โดยไม่เปลี่ยนชื่อทางการจาก REM")}
              {sourceField("project_name_eng", "ชื่อโครงการ (Eng) จาก REM")}
              {field("public_name_en")}
              {field("address", true)}
              {field("address_en", true)}
              {field("latitude", false, project.gold_source?.record.latitude == null ? "ต้นทาง DW ยังไม่มีละติจูด กรุณาระบุพิกัดที่ตรวจสอบแล้ว" : undefined)}
              {field("longitude", false, project.gold_source?.record.longitude == null ? "ต้นทาง DW ยังไม่มีลองจิจูด กรุณาระบุพิกัดที่ตรวจสอบแล้ว" : undefined)}
              <div className="coordinate-tools"><p className="field-help">วางพิกัดแบบ lat, lng ในช่องใดก็ได้ เช่น 13.7563, 100.5018</p>{draft.latitude.trim() && draft.longitude.trim() && !coordinateError("latitude", draft.latitude) && !coordinateError("longitude", draft.longitude)
                ? <a className="button text-button" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${Number(draft.latitude)},${Number(draft.longitude)}`)}`} target="_blank" rel="noopener noreferrer">เปิดใน Google Maps ↗</a>
                : <span className="field-help">ระบุพิกัดในประเทศไทยเพื่อเปิดใน Google Maps</span>}</div>
              {field("slug", false, "ใช้อักษรอังกฤษตัวเล็ก ตัวเลข และขีดกลาง")}{field("ad_disclaimer", true, "กรอกข้อความที่ได้รับการตรวจสอบแล้ว")}{field("ad_disclaimer_en", true)}
            </div>
          </div></section>
        </form>
        <ProjectBrandCard project={project} role={role} disabled={anyDirty || saving} onChanged={data => { setProject(data); setDraft(draftFrom(data)); setDraftUpdatedAt(data.updated_at); onWorkflowChanged?.(); }} />
      </div>
      <div id="media-panel" role="tabpanel" tabIndex={-1} aria-labelledby="media-tab" hidden={tab !== "media"}>
        <ProjectAssets project={project} role={role} disabled={relatedDirty || saving || workflowActive || modelMediaEditing} unsavedProjectDetails={dirty} onProjectChanged={acceptMediaUpdate} {...{ onEditingChange: setProjectMediaEditing }} />


      </div>
      <div id="models-panel" role="tabpanel" tabIndex={-1} aria-labelledby="models-tab" hidden={tab !== "models"}>
        <section className="panel model-project-context"><div className="panel-body"><div><span className="section-chip">โครงการที่เลือก</span><h2>{project.public_name.th || project.source?.project_name_rem || "โครงการนี้"}</h2><p className="muted small-text">{project.source?.rem_project_id} · แบบทั้งหมดอยู่ภายใต้โครงการนี้</p></div><a className="button secondary" href="/" onClick={event => { if (anyDirty && !window.confirm("มีข้อมูลโครงการที่ยังไม่ได้บันทึก ต้องการทิ้งการแก้ไขและเปลี่ยนโครงการหรือไม่?")) event.preventDefault(); }}>เปลี่ยนโครงการ</a></div></section>


    <section className="panel" id="models" tabIndex={-1}><div className="panel-heading"><div><span className="section-chip">ข้อมูลอ้างอิง</span><h2>รายละเอียดรหัสแบบ REM</h2><p>{canEdit ? "คลิกแถวเพื่อแก้ไขรายละเอียด ตรวจการจับคู่ และเตรียมแปลนก่อนเผยแพร่" : "คลิกแถวเพื่อตรวจรายละเอียดและแปลน"}</p></div><span className="count">{project.models?.length ?? 0}</span></div><div className="panel-body">
      {canEdit && <><button className="button secondary" disabled={anyDirty || saving} onClick={() => setModelAction({ type: "add" })}>เลือกแบบเพิ่มเติมจากต้นทาง</button>{dirty && <p className="field-help">บันทึกข้อมูลโครงการก่อนจัดการแบบที่อยู่อาศัย</p>}</>}
      {Boolean(sortedModels.length) && <div className="table-scroll"><table className="rem-model-table"><caption className="sr-only">แบบบ้านจาก REM</caption><thead><tr><th>ชื่อแบบ</th><th>ModelID</th><th>ยืนยัน</th><th>ข้อมูลครบ</th><th>แปลน</th></tr></thead><tbody>{sortedModels.map(model => <tr key={model.public_model_id} data-model-id={model.public_model_id} aria-selected={mediaModel?.public_model_id === model.public_model_id} onClick={() => { if (modelDirty || saving || workflowActive || mediaEditing) return; setMediaModelId(model.public_model_id); setModelAction(canEdit && !anyDirty ? { type: "edit", model } : null); }}><td><button className="button text-button" disabled={modelDirty || saving || Boolean(workflowActive) || mediaEditing}>{model.public_name.th || model.model_name_rem}</button></td><td>{model.rem_model_id}</td><td>{matchLabels[model.match_status]}</td><td>{model.public_name.th?.trim() && model.bedrooms != null && model.bathrooms != null && (model.usable_area_sqm ?? 0) > 0 ? "✓" : "ยังขาด"}</td><td>{project.assets?.filter(asset => asset.public_model_id === model.public_model_id && ["floor_plan", "structural_plan"].includes(asset.asset_role)).length ?? 0}</td></tr>)}</tbody></table></div>}

      {!project.models?.length ? <p className="muted">ยังไม่มีข้อมูลแบบที่อยู่อาศัย</p> : project.models.filter(model => model.public_model_id === mediaModel?.public_model_id).map(model => <article className={`model-card ${mediaModel?.public_model_id === model.public_model_id ? "selected-model" : ""}`} key={model.public_model_id} aria-label={model.public_name.th || model.rem_model_id}>
        <DemoFields fields={model.demo_fields} /><div className="model-card-heading"><h3>{model.public_name.th || "แบบที่ยังไม่ระบุชื่อ"}</h3><span className={`match-status ${model.match_status.toLowerCase()}`}>{matchLabels[model.match_status]}</span></div>
        <p className="small-text muted source-code">{model.public_model_id}</p>
        <dl className="model-source"><div><dt>ชื่อแบบต้นทาง (อ่านอย่างเดียว)</dt><dd>{model.model_name_rem}</dd></div><div><dt>รหัสแบบ REM</dt><dd>{model.rem_model_id}</dd></div></dl>
        <details className="gold-model-evidence"><summary>ข้อมูลแบบจาก DW สำหรับตรวจสอบ</summary>{!goldModelGroups.length ? <p className="field-help">ยังไม่มีข้อมูล gold.dim_project_model ที่จับคู่กับรหัสแบบนี้ ยังคงใช้ข้อมูล REM เดิมเพื่อรอตรวจสอบ</p> : <>{(goldModelGroups.length > 1 || goldModelGroups.some(group => group.model_attribute_variant)) && <p className="inline-warning">ต้นทางมีหลายกลุ่มหรือหลายรูปแบบ ต้องตรวจสอบความแตกต่างก่อนใช้ข้อมูล</p>}{goldModelGroups.map((group, index) => <dl className="snapshot-list" key={index}><div><dt>ชื่อแบบจาก DW</dt><dd>{group.model_name || "—"} · {group.model_name_eng || "—"}</dd></div><div><dt>รหัสแบบในกลุ่ม</dt><dd>{group.model_ids?.join(", ") || "—"}</dd></div><div><dt>ModelTypeID</dt><dd>{group.model_type_ids?.join(", ") || "—"}</dd></div><div><dt>ช่วงพื้นที่ต้นทาง (ยังไม่ยืนยันหน่วยและความหมาย)</dt><dd>{group.minimum_model_area ?? "—"} – {group.maximum_model_area ?? "—"}</dd></div></dl>)}<p className="field-help">กลุ่มจาก DW ใช้ประกอบการตรวจสอบ ไม่เติมพื้นที่ใช้สอยหรือยืนยันการจับคู่อัตโนมัติ</p></>}</details>
        <div className="model-specs"><span>{model.bedrooms ?? "—"} ห้องนอน</span><span>{model.bathrooms ?? "—"} ห้องน้ำ</span><span>{model.usable_area_sqm ?? "—"} ตร.ม.</span><span>{model.parking_spaces ?? "—"} ที่จอดรถ</span></div>
        {model.match_status === "REJECTED" && <p className="field-help">แบบนี้จะไม่รวมในการเผยแพร่ครั้งใหม่ ยืนยันการจับคู่อีกครั้งได้หากตรวจสอบแล้วว่าถูกต้อง</p>}
        {model.verified_at && <p className="small-text muted review-evidence">ยืนยันเมื่อ {formatDate(model.verified_at)}<br />โดย <ActorName id={model.verified_by} /></p>}
        <div className="model-actions"><button className="button secondary" onClick={() => { setMediaModelId(model.public_model_id); requestAnimationFrame(() => document.getElementById("model-media")?.scrollIntoView({ block: "start" })); }}>รูปภาพและแปลนของแบบนี้</button></div>
        {canEdit && <div className="model-actions"><button className="button secondary" disabled={anyDirty || saving} onClick={() => setModelAction({ type: "edit", model })}>แก้ไขรายละเอียดแบบ</button><button className="button secondary" disabled={anyDirty || saving} onClick={() => setModelAction({ type: "review", model })}>ตรวจสอบการจับคู่</button></div>}
        {!(modelAction?.type === "edit" && modelAction.model.id === model.id) && <ContentWorkflow key={`${model.id}:${workflowRevision}`} target={{ kind: "model", identity: { id: model.id } }} label={model.public_name.th || model.rem_model_id} revision={project.updated_at}
          disabled={saving || dirty || relatedDirty || mediaEditing || workflowOwners.some(owner => owner !== model.id)} onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing(model.id, value)} />}
        {modelAction?.type === "edit" && modelAction.model.public_model_id === model.public_model_id && <ModelDialog key={model.public_model_id} inline action={modelAction} project={project} onDirtyChange={setModelDirty} onCancel={() => setModelAction(null)} onSaved={data => { setProject(data); setDraft(draftFrom(data)); setDraftUpdatedAt(data.updated_at); onWorkflowChanged?.(); setModelAction(null); setNotice("บันทึกข้อมูลแบบแล้ว"); }} onReload={() => { setModelAction(null); void load(); }} />}
      </article>)}
    </div></section>

        {mediaModel && <div id="model-media" className="model-media" tabIndex={-1}><div className="model-media-context"><span className="section-chip">สื่อของแบบที่เลือก</span><h2>{mediaModel.public_name.th || mediaModel.rem_model_id} · {project.source?.rem_project_id}</h2><p className="field-help">ไฟล์ผูกกับโครงการและรหัสแบบนี้ หากมีแปลนต่างกันตามอาคารหรือชั้น ให้ระบุอาคารและชั้นในคำอธิบายไฟล์ การกำหนดขอบเขตอาคาร/ชั้นแบบโครงสร้างจะเพิ่มภายหลัง</p></div><ProjectAssets key={mediaModel.public_model_id} project={project} model={{ public_model_id: mediaModel.public_model_id, name: mediaModel.public_name.th || mediaModel.rem_model_id }} role={role} disabled={relatedDirty || saving || workflowActive || projectMediaEditing} unsavedProjectDetails={dirty} onProjectChanged={acceptMediaUpdate} {...{ onEditingChange: setModelMediaEditing }} /></div>}
        <p className="read-only-note">แบบขายของ Marketing · ยังไม่ออก API</p>
        <CommercialTypes project={project} role={role} disabled={dirty || facilitiesDirty || saving || mediaEditing || Boolean(workflowActive)} onDirtyChange={setCommercialDirty} onProjectChanged={data => { setProject(data); setDraft(draftFrom(data)); setDraftUpdatedAt(data.updated_at); onWorkflowChanged?.(); }} />
      </div>
      <div id="extra-panel" role="tabpanel" tabIndex={-1} aria-labelledby="extra-tab" hidden={tab !== "extra"}>
        <p className="read-only-note">ข้อมูลเสริมเป็นทางเลือก ไม่กีดกันการเผยแพร่</p>
        <ProjectFacilities project={project} role={role} disabled={dirty || commercialDirty || saving || mediaEditing || Boolean(workflowActive)} onDirtyChange={setFacilitiesDirty} onProjectChanged={data => { setProject(data); setDraft(draftFrom(data)); setDraftUpdatedAt(data.updated_at); onWorkflowChanged?.(); }} />
        <section className="panel" inert={Boolean(workflowActive) || mediaEditing}><div className="panel-body">{field("meta_title")}{field("meta_title_en")}{field("meta_description", true)}{field("meta_description_en", true)}<PublicWebsiteSource sources={project.website_sources} />{field("website_content", true, "ข้อความอ้างอิงภายใน Hub สำหรับตรวจและเรียบเรียง ไม่ส่งออกเว็บไซต์หรือ AI")}</div></section>
      </div>
      <div id="versions-panel" role="tabpanel" tabIndex={-1} aria-labelledby="versions-tab" hidden={tab !== "versions"}>
        <section className="panel" aria-labelledby="readiness-title"><div className="panel-heading"><div><span className="section-chip">ตรวจสอบก่อนส่งต่อ</span><h2 id="readiness-title">ความพร้อมก่อนเผยแพร่</h2><p>ข้อมูลร่างจะเข้าสู่ API เมื่อผู้เผยแพร่ยืนยันเท่านั้น</p></div><strong className="readiness-compact-number">{readiness.ready ? "พร้อมเผยแพร่ · ไม่มีรายการค้าง" : `${readiness.missing.length} รายการ`}</strong></div><div className="panel-body"><p className="read-only-note">การเผยแพร่ชุดปัจจุบันยังไม่รวมแบบขายของ Marketing และสิ่งอำนวยความสะดวก ซึ่งอยู่ระหว่างจัดเตรียมข้อมูลร่าง</p>{dirty && <p className="inline-warning">รายการนี้อ้างอิงข้อมูลที่บันทึกแล้ว กรุณาบันทึกข้อมูลร่างเพื่อประเมินอีกครั้ง</p>}{readiness.ready ? <p className="read-only-note">ข้อมูลที่จำเป็นครบถ้วน พร้อมให้ผู้เผยแพร่ตรวจสอบ</p> : <div className="readiness-groups">{missingGroups.filter(group => group.items.length).map(group => <details key={group.label}><summary><strong>{group.label}</strong><span className="count">{group.items.length}</span></summary><ul className="readiness-list">{group.items.map((item, index) => <li key={`${item.field}-${index}`}><span className="missing-mark" aria-hidden="true" /><a href={`#${missingAnchor(item.field)}`} onClick={event => { event.preventDefault(); revealField(item.field); }}>{item.message}</a></li>)}</ul></details>)}</div>}<div className="publication-actions"><a className="button primary" href={`/publish?source=project&id=${encodeURIComponent(project.public_project_id)}`} aria-disabled={anyDirty || saving} onClick={event => { if (anyDirty || saving) event.preventDefault(); }}>{workflowText.queue}</a></div></div></section>
<section className="panel" id="publication-history"><div className="panel-heading"><div><h2>ประวัติการเผยแพร่</h2><p>ทุกเวอร์ชันเก็บข้อมูล ณ เวลาที่เผยแพร่ไว้สำหรับตรวจสอบ</p></div></div><div className="panel-body">{versionsError ? <ErrorState message={versionsError} retry={load} /> : !versions.length ? <div className="empty-state compact"><Icon name="clock" size={32} /><h3>ยังไม่มีเวอร์ชันที่เผยแพร่</h3><p>เมื่อเผยแพร่ครั้งแรก ประวัติจะปรากฏที่นี่</p></div> : <ol className="version-list">{versions.map(version => <li key={version.version_id}><div className="version-marker">{version.version_no}</div><div className="version-content"><div className="version-heading"><h3>เวอร์ชัน {version.version_no}</h3>{version.version_id === project.published_version_id && <span className="status-badge published">เวอร์ชันที่เลือก</span>}</div><p>{version.change_reason || "ไม่ได้ระบุเหตุผล"}</p><p className="small-text muted">{formatDate(version.published_at)} · <ActorName id={version.publisher} /></p><details><summary>ดูข้อมูลที่บันทึกในเวอร์ชันนี้</summary><dl className="snapshot-list"><div><dt>ชื่อโครงการ</dt><dd>{version.payload?.public_name?.th ?? "—"}</dd></div><div><dt>ที่อยู่</dt><dd>{version.payload?.address?.th ?? "—"}</dd></div><div><dt>ข้อความกำกับโฆษณา</dt><dd>{version.payload?.ad_disclaimer?.th ?? "—"}</dd></div></dl>{version.payload && <ProjectComparison target={version.payload} />}</details></div></li>)}</ol>}</div></section>
      </div>
      {(tab === "content" || tab === "extra") && <ContentWorkflow key={`project:${workflowRevision}`} target={project.id ? { kind: "project", identity: { id: project.id } } : null} label={project.public_name.th || project.public_project_id} revision={dirty ? draftUpdatedAt : project.updated_at}
        disabled={saving || relatedDirty || mediaEditing || workflowOwners.some(owner => owner !== "project")}
        draft={{ dirty, valid: canEdit && (!draft.slug || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(draft.slug)) && !coordinateError("latitude", draft.latitude) && !coordinateError("longitude", draft.longitude), sourceStamp: { updated_at: draftUpdatedAt }, getChanges: projectChangesForSave }}
        onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing("project", value)} />}
      {tab !== "versions" && <div className="save-bar project-save-bar">
        <div className="workflow-feedback" role="status"><span className={`save-dot ${anyDirty ? "unsaved" : ""}`} /><span>{saving ? "กำลังบันทึก…" : error ? "บันทึกไม่สำเร็จ กรุณาตรวจข้อความแจ้งเตือน" : relatedDirty ? "บันทึกหรือยกเลิกรายการที่กำลังแก้ไขก่อนทำขั้นตอนถัดไป" : dirty ? "มีข้อมูลที่ยังไม่ได้บันทึก" : tab === "content" ? "ข้อมูลร่างโครงการเป็นปัจจุบัน · ถัดไปจัดเตรียมแบบที่อยู่อาศัย" : tab === "models" ? "ถัดไปตรวจความพร้อมของข้อมูลที่บันทึกแล้ว" : "การบันทึกร่างยังไม่ใช่การเผยแพร่"}</span></div>
        <div className="workflow-actions">
          {tab !== "content" && <button className="button secondary" onClick={() => goToTab(tabs[tabs.findIndex(item => item.id === tab) - 1].id)}>ย้อนกลับ</button>}
          {canEdit && <button type="submit" form="project-details-form" className="button secondary" aria-label={saving ? "กำลังบันทึก…" : "บันทึกข้อมูลร่าง"} disabled={!dirty || relatedDirty || saving || mediaEditing || Boolean(workflowActive)}><Icon name="save" /><span className="save-label">{saving ? "กำลังบันทึก…" : "บันทึกข้อมูลร่าง"}</span><span className="save-label-short" aria-hidden="true">บันทึก</span></button>}
          <button className="button primary" disabled={relatedDirty || saving || mediaEditing || Boolean(workflowActive)} onClick={() => { const next = tabs[tabs.findIndex(item => item.id === tab) + 1].id; if (dirty && canEdit) void save(undefined, next); else goToTab(next); }}>{dirty && canEdit ? "บันทึกและไปต่อ" : "ถัดไป"}<Icon name="arrow" size={18} /></button>
        </div>
      </div>}
    </div>
    {modelAction && modelAction.type !== "edit" && <ModelDialog action={modelAction} project={project} onDirtyChange={setModelDirty} onCancel={() => setModelAction(null)} onSaved={data => { setProject(data); setDraft(draftFrom(data)); setDraftUpdatedAt(data.updated_at); onWorkflowChanged?.(); setModelAction(null); setNotice("บันทึกข้อมูลแบบแล้ว กรุณาตรวจความพร้อมก่อนเผยแพร่"); }} onReload={() => { setModelAction(null); void load(); }} />}
  </div>;
}

function ModelDialog({ action, project, onCancel, onSaved, onReload, inline = false, onDirtyChange }: {
  inline?: boolean; onDirtyChange?: (dirty: boolean) => void;
  action: ModelAction; project: Project; onCancel: () => void; onSaved: (data: Project) => void; onReload: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const model = action.type === "add" ? null : action.model;
  const [loadedUpdatedAt] = useState(project.updated_at), [workflowBusy, setWorkflowBusy] = useState(false);
  const initial = { public_name: model?.public_name.th ?? "", bedrooms: model?.bedrooms?.toString() ?? "", bathrooms: model?.bathrooms?.toString() ?? "", usable_area_sqm: model?.usable_area_sqm?.toString() ?? "", parking_spaces: model?.parking_spaces?.toString() ?? "" };
  const [values, setValues] = useState(initial);
  const [sources, setSources] = useState<SourceModel[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [loading, setLoading] = useState(action.type === "add");
  const [decision, setDecision] = useState<"CONFIRMED" | "REJECTED">("CONFIRMED");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(initial) !== JSON.stringify(values) || Boolean(reason || sourceId);
  const base = `v1/admin/projects/${encodeURIComponent(project.public_project_id)}`;
  useEffect(() => { if (!inline) dialog.current?.showModal(); }, [inline]);
  useEffect(() => { onDirtyChange?.(dirty || pending || workflowBusy); return () => onDirtyChange?.(false); }, [dirty, pending, workflowBusy, onDirtyChange]);
  useEffect(() => {
    if (action.type !== "add") return;
    let active = true;
    request<SourceModel[]>(`${base}/source-models`).then(data => { if (active) setSources(data.filter(source => !source.public_model_id)); }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [action.type, base]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { summary.current?.focus(); }, [error, validationAttempt]);
  const canDiscard = () => !dirty || window.confirm("มีข้อมูลแบบที่ยังไม่ได้บันทึก ต้องการทิ้งการแก้ไขหรือไม่?");
  function cancel() { if (!pending && canDiscard()) onCancel(); }
  const fieldLabels = { public_name: "ชื่อแบบที่ใช้เผยแพร่ (ภาษาไทย)", bedrooms: "จำนวนห้องนอน", bathrooms: "จำนวนห้องน้ำ", usable_area_sqm: "พื้นที่ใช้สอย (ตร.ม.)", parking_spaces: "จำนวนที่จอดรถ" };
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending || workflowBusy) return; setError(""); setConflict(false);
    const errors: Record<string, string> = {};
    if (action.type === "edit") {
      for (const name of ["bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces"] as const) {
        const raw = values[name].trim(); const value = Number(raw);
        if (raw && (!Number.isFinite(value) || value < 0 || (name === "usable_area_sqm" && value <= 0) || (name === "parking_spaces" && !Number.isInteger(value)))) {
          errors[name] = name === "usable_area_sqm" ? "ระบุพื้นที่มากกว่า 0 หรือเว้นว่างไว้ในฉบับร่าง" : name === "parking_spaces" ? "ระบุจำนวนเต็มตั้งแต่ 0 ขึ้นไป" : "ระบุตัวเลขตั้งแต่ 0 ขึ้นไป รองรับทศนิยม";
        }
      }
    } else if (action.type === "review" && !reason.trim()) errors.reason = "ระบุเหตุผลจากการตรวจสอบ";
    else if (action.type === "add" && !sourceId) errors.source = "เลือกแบบจากต้นทางก่อน";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setValidationAttempt(value => value + 1); return; }
    setPending(true);
    try {
      let data: Project;
      if (action.type === "edit" && model) {
        const numbers = Object.fromEntries((["bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces"] as const).map(key => [key, values[key].trim() ? Number(values[key]) : null]));
        data = await request<Project>(`${base}/models/${model.public_model_id}`, "PATCH", { updated_at: loadedUpdatedAt, public_name: { ...model.public_name, th: values.public_name }, ...numbers });
      } else if (action.type === "review" && model) {
        data = await request<Project>(`${base}/models/${model.public_model_id}/review`, "POST", { updated_at: loadedUpdatedAt, decision, change_reason: reason.trim() });
      } else {
        data = await request<Project>(`${base}/models`, "POST", { rem_model_id: sourceId, updated_at: loadedUpdatedAt });
      }
      onSaved(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
      setConflict((error as { status?: number }).status === 409);
      setPending(false);
    }
  }
  const title = action.type === "edit" ? "แก้ไขรายละเอียดแบบ" : action.type === "review" ? "ตรวจสอบการจับคู่แบบ" : "เลือกแบบจากต้นทาง";
  const form = <><form inert={workflowBusy} onSubmit={submit} noValidate><h2 id="model-dialog-title">{title}</h2>
      {(error || Object.keys(fieldErrors).length > 0) && <div className="notice error model-error-summary" role="alert" tabIndex={-1} ref={summary}><strong>{error || "กรุณาตรวจข้อมูลที่ระบุ"}</strong>{Object.keys(fieldErrors).length > 0 && <ul>{Object.entries(fieldErrors).map(([field, message]) => <li key={field}><a href={`#model-${field}`}>{message}</a></li>)}</ul>}{conflict && <><p>ข้อมูลที่กรอกยังอยู่ กรุณาคัดลอกสิ่งที่ต้องการเก็บก่อนโหลดข้อมูลล่าสุด</p><button type="button" className="button secondary" onClick={() => { if (canDiscard()) onReload(); }}>โหลดข้อมูลล่าสุด</button></>}</div>}
      {model && <dl className="snapshot-list"><div><dt>โครงการต้นทาง</dt><dd>{project.source?.project_name_rem} · {project.source?.rem_project_id}</dd></div><div><dt>ชื่อแบบต้นทาง (อ่านอย่างเดียว)</dt><dd>{model.model_name_rem}</dd></div><div><dt>รหัสแบบ REM</dt><dd>{model.rem_model_id}</dd></div><div><dt>แหล่งข้อมูล</dt><dd>{sourceProvenance(model)}</dd></div><div><dt>ปรับปรุงต้นทาง</dt><dd>{sourceDate(model.source_updated_at)}</dd></div><div><dt>เวลาสกัดสำเนาต้นทาง</dt><dd>{formatDate(model.source_snapshot_at)}</dd></div><RawModelEvidence source={model} />{action.type === "review" && <div><dt>ชื่อแบบที่ใช้เผยแพร่</dt><dd>{model.public_name.th || "ยังไม่ระบุชื่อ"}</dd></div>}</dl>}
      {action.type === "edit" && <><p className="field-help">เว้นข้อมูลที่ยังไม่ทราบไว้ได้ การเผยแพร่ต้องมีชื่อไทย ห้องนอน ห้องน้ำ และพื้นที่ใช้สอยครบถ้วน</p><div className="model-edit-fields">{(Object.keys(fieldLabels) as (keyof typeof values)[]).map(name => <div className="form-field" key={name}>
        <label htmlFor={`model-${name}`}>{fieldLabels[name]}</label><input id={`model-${name}`} value={values[name]} disabled={pending} inputMode={name === "public_name" ? "text" : name === "parking_spaces" ? "numeric" : "decimal"} maxLength={name === "public_name" ? 250 : 20} aria-invalid={Boolean(fieldErrors[name])} aria-describedby={fieldErrors[name] ? `model-${name}-error` : undefined} onChange={event => { setValues(previous => ({ ...previous, [name]: event.target.value })); setFieldErrors(previous => { const next = { ...previous }; delete next[name]; return next; }); }} />{fieldErrors[name] && <p className="field-error" id={`model-${name}-error`}>{fieldErrors[name]}</p>}
      </div>)}</div></>}
      {action.type === "review" && <><p className="field-help">ตรวจสอบว่าแบบนี้ตรงกับชื่อและรหัสต้นทาง การยืนยันนี้รับรองการจับคู่เท่านั้น</p>
        <fieldset className="review-options" disabled={pending}><legend>ผลการตรวจสอบ</legend><label><input type="radio" name="decision" checked={decision === "CONFIRMED"} onChange={() => setDecision("CONFIRMED")} />ยืนยันว่าจับคู่ถูกต้อง</label><label><input type="radio" name="decision" checked={decision === "REJECTED"} onChange={() => setDecision("REJECTED")} />ปฏิเสธการจับคู่</label></fieldset>
        {decision === "REJECTED" && <p className="inline-warning" role="status">แบบนี้จะไม่รวมในการเผยแพร่ครั้งใหม่{project.published_version_id ? " หากเวอร์ชันที่เผยแพร่อยู่ใช้แบบนี้ โครงการจะหยุดแสดงผ่าน API ทันที ต้องแก้ไขการจับคู่หรือเผยแพร่เวอร์ชันที่ถูกต้องเพื่อให้กลับมาแสดง" : " ต้องมีแบบที่ยืนยันและข้อมูลครบอย่างน้อยหนึ่งแบบก่อนเผยแพร่"}</p>}
        <div className="form-field"><label htmlFor="model-reason">เหตุผลในการตรวจสอบ</label><textarea id="model-reason" value={reason} disabled={pending} maxLength={1000} rows={3} aria-invalid={Boolean(fieldErrors.reason)} aria-describedby={fieldErrors.reason ? "model-reason-error" : undefined} onChange={event => setReason(event.target.value)} />{fieldErrors.reason && <p className="field-error" id="model-reason-error">{fieldErrors.reason}</p>}</div>
      </>}
      {action.type === "add" && (loading ? <LoadingState /> : sources.length ? <div className="form-field"><label htmlFor="model-source">แบบที่ยังไม่ได้เลือกในโครงการนี้</label><select id="model-source" disabled={pending} value={sourceId} aria-invalid={Boolean(fieldErrors.source)} aria-describedby={fieldErrors.source ? "model-source-error" : undefined} onChange={event => setSourceId(event.target.value)}><option value="">เลือกแบบ</option>{sources.map(source => <option key={source.rem_model_id} value={source.rem_model_id}>{source.model_name_rem} · {source.rem_model_id}</option>)}</select>{fieldErrors.source && <p id="model-source-error" className="field-error">{fieldErrors.source}</p>}<p className="field-help">แบบที่เลือกจะอยู่ในสถานะรอตรวจสอบ</p>{sources.filter(source => source.rem_model_id === sourceId).map(source => <div key={source.rem_model_id}><p className="field-help">{sourceProvenance(source)}</p><dl className="snapshot-list"><div><dt>ปรับปรุงต้นทาง</dt><dd>{sourceDate(source.source_updated_at)}</dd></div><RawModelEvidence source={source} /></dl></div>)}</div> : !error && <p className="muted">ไม่มีแบบใหม่จากต้นทาง แบบที่เลือกแล้วแสดงอยู่ในรายการโครงการ</p>)}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={pending} onClick={cancel}>ยกเลิก</button><button type="submit" className="button primary" aria-busy={pending} disabled={pending || loading || (action.type === "add" && !sourceId)}>{pending ? "กำลังบันทึก…" : action.type === "edit" ? "บันทึกรายละเอียดแบบ" : action.type === "review" ? "บันทึกผลตรวจสอบ" : "เพิ่มแบบที่เลือก"}</button></div>
    </form>
      {model && action.type === "edit" && <ContentWorkflow target={{ kind: "model", identity: { id: model.id } }} label={model.public_name.th || model.rem_model_id} revision={loadedUpdatedAt} disabled={pending}
        draft={{ dirty, valid: ["bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces"].every(key => { const raw = values[key as keyof typeof values].trim(), value = Number(raw); return !raw || Number.isFinite(value) && value >= 0 && (key !== "usable_area_sqm" || value > 0) && (key !== "parking_spaces" || Number.isInteger(value)); }), sourceStamp: { updated_at: loadedUpdatedAt }, getChanges: () => ({ public_name: { ...model.public_name, th: values.public_name }, ...Object.fromEntries((["bedrooms", "bathrooms", "usable_area_sqm", "parking_spaces"] as const).map(key => [key, values[key].trim() ? Number(values[key]) : null])) }) }}
        onChanged={async () => onSaved(await request<Project>(base))} onReload={async () => onSaved(await request<Project>(base))} onEditingChange={setWorkflowBusy} />}
    </>;
  return inline ? <section className="inline-model-editor" aria-label="แก้ไขรายละเอียดแบบ">{form}</section> : <dialog ref={dialog} className="action-dialog model-dialog" aria-labelledby="model-dialog-title" onCancel={event => { event.preventDefault(); cancel(); }}>{form}</dialog>;
}

function missingAnchor(field: string) {
  const root = field.split(".")[0];
  if (root === "facilities") return field.replace(".", "-");
  if (/brand/i.test(field)) return "project-brand";
  if (/model/i.test(field)) return "models";
  if (/hero|thumbnail|asset/i.test(field)) return "assets";
  if (/rem|source|crosswalk/i.test(field)) return "source";
  return root in labels ? root : "content-panel";
}
