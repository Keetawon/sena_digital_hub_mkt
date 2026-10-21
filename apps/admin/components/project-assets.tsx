"use client";
import { useHubPermissions } from "./accounts";
import { ActorName } from "./accounts";

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { LocalRole } from "@/lib/local-session";
import { request } from "./hub-request";
import "./project-assets.css";
import { assetFetch, useHostedSession } from "./hosted-session";
import { AssetImage, AssetFileLink, localAssetUrl, privateAssetBlob } from "./private-assets";

type Rights = "pending" | "approved" | "revoked";
type AssetRole = "hero" | "thumbnail" | "master_plan" | "floor_plan" | "brochure" | "model_image" | "structural_plan" | "logo_primary" | "logo_white" | "logo_mono" | "favicon";
type ModelOwner = { public_model_id: string; name: string };
export type Asset = {
  id: string; original_filename: string; mime_type: string; public_url: string | null;
  checksum: string | null; file_size: number | null; width: number | null; height: number | null;
  rights_status: Rights; rights_notes: string | null; updated_at: string;
  effective_from: string | null; effective_to: string | null;
  reviewed_by: string | null; reviewed_at: string | null; review_reason: string | null;
  storage_path: string | null;
};
export type AssetBinding = Pick<Asset, "id" | "original_filename" | "mime_type" | "rights_status" | "public_url"> & {
  binding_id: string; asset_role: AssetRole; alt_text: { th?: string }; display_order: number;
  effective_from?: string | null; effective_to?: string | null;
  asset_effective_from?: string | null; asset_effective_to?: string | null;
  public_model_id?: string | null;
  is_primary?: boolean;
};
const roleLabels: Record<AssetRole, string> = { hero: "ภาพหลักโครงการ", thumbnail: "ภาพย่อโครงการ", master_plan: "ผังโครงการ (Master plan)", floor_plan: "ผังชั้น / แปลน", brochure: "โบรชัวร์", model_image: "ภาพแบบที่อยู่อาศัย", structural_plan: "แบบโครงสร้าง", logo_primary: "โลโก้หลัก", logo_white: "โลโก้สีขาว", logo_mono: "โลโก้ขาวดำ", favicon: "ไอคอนเว็บไซต์ (favicon)" };
const brandLogoRoles = ["logo_primary", "logo_white", "logo_mono", "favicon"] as const;
const projectPurposes: { role: AssetRole; label: string; description: string }[] = [
  { role: "hero", label: "ภาพหลักโครงการ", description: "ภาพปกขนาดใหญ่ เพิ่มได้หลายภาพ" },
  { role: "thumbnail", label: "ภาพย่อโครงการ", description: "ภาพสำหรับรายการโครงการ เพิ่มได้หลายภาพ" },
  { role: "master_plan", label: "ผังโครงการ", description: "ผังรวมของพื้นที่ เพิ่มได้หลายไฟล์" },
  { role: "floor_plan", label: "ผังอาคาร / ชั้น", description: "ระบุอาคารและชั้นในคำอธิบาย เพิ่มได้หลายไฟล์" },
  { role: "brochure", label: "โบรชัวร์", description: "เอกสารแนะนำโครงการ PDF เพิ่มได้หลายไฟล์" },
];
function supportsPurpose(asset: Pick<Asset, "mime_type">, purpose: AssetRole) {
  return purpose === "brochure" ? asset.mime_type === "application/pdf" : ["hero", "thumbnail"].includes(purpose) ? asset.mime_type.startsWith("image/") : acceptedTypes.includes(asset.mime_type);
}
type AssetOwner = { updated_at: string; assets?: AssetBinding[]; public_project_id?: string; public_brand_id?: string; public_name?: { th?: string } };
const acceptedTypes = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const maxFileSize = 10 * 1024 * 1024;
const isSample = (asset: { public_url: string | null }) => Boolean(asset.public_url?.startsWith("/demo-assets/"));
const fileUrl = localAssetUrl;

function AssetIcon({ pdf = false }: { pdf?: boolean }) {
  return <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{pdf ? <><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5" /></> : <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>}</svg>;
}

function dateLabel(value?: string | null) {
  return value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "ไม่ได้ระบุ";
}

function sizeLabel(bytes: number | null) {
  if (bytes == null) return "ไม่มีข้อมูลขนาดไฟล์";
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function RightsBadge({ status, from, to }: { status: Rights; from?: string | null; to?: string | null }) {
  const expired = status === "approved" && Boolean(to && Date.parse(to) <= Date.now());
  const future = status === "approved" && Boolean(from && Date.parse(from) > Date.now());
  const label = status === "pending" ? "รอตรวจสิทธิ์" : status === "revoked" ? "ถอนสิทธิ์แล้ว" : expired ? "สิทธิ์หมดอายุ" : future ? "ยังไม่ถึงช่วงใช้สิทธิ์" : "อนุมัติสิทธิ์แล้ว";
  return <span className={`asset-rights ${status === "approved" && !expired && !future ? "approved" : status === "revoked" || expired ? "revoked" : "pending"}`}>{label}</span>;
}

export function Preview({ asset, alt }: { asset: { id: string; mime_type: string; public_url: string | null; original_filename: string }; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const pdf = asset.mime_type === "application/pdf";
  return <div className="asset-preview">{pdf || failed ? <span><AssetIcon pdf={pdf} />{pdf ? "เอกสาร PDF" : "โหลดภาพไม่ได้"}</span> : <AssetImage asset={asset} alt={alt || asset.original_filename} width={480} height={280} onError={() => setFailed(true)} />}</div>;
}

export function ProjectAssets<T extends AssetOwner>({ project, role, disabled, onProjectChanged, model, unsavedProjectDetails = false }: {
  project: T; role: LocalRole; disabled: boolean; onProjectChanged: (project: T) => void; model?: ModelOwner; unsavedProjectDetails?: boolean;
}) {
  const permissions = useHubPermissions();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [purpose, setPurpose] = useState<AssetRole>("hero");
  const [dialog, setDialog] = useState<{ type: "upload" } | { type: "bind" | "review" | "approve"; asset: Asset } | { type: "remove"; binding: AssetBinding } | null>(null);
  const canEdit = permissions.can(project.public_brand_id ? "brands" : "projects", "edit");
  const canReview = permissions.can(project.public_brand_id ? "brands" : "projects", "approve");
  const [preparingReview, setPreparingReview] = useState(false);
  const isBrand = Boolean(project.public_brand_id);
  const isProject = !isBrand && !model;
  const subject = model ? "แบบที่อยู่อาศัย" : isBrand ? "แบรนด์" : "โครงการ";
  const bindings = project.assets?.filter(binding => model ? binding.public_model_id === model.public_model_id : !binding.public_model_id) ?? [];
  const sectionId = model ? `model-assets-${model.public_model_id}` : "assets";
  const base = `v1/admin/${isBrand ? "brands" : "projects"}/${encodeURIComponent(project.public_brand_id || project.public_project_id || "")}${model ? `/models/${encodeURIComponent(model.public_model_id)}` : ""}`;
  const loadLibrary = useCallback(async () => {
    setLoading(true); setError("");
    try { setAssets(await request<Asset[]>("v1/admin/assets")); }
    catch (error) { setError(error instanceof Error ? error.message : "โหลดคลังสื่อไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (libraryOpen) void loadLibrary(); }, [libraryOpen, loadLibrary]);

  async function refreshAfterReview() {
    const data = await request<T>(base);
    onProjectChanged(data);
    await loadLibrary();
  }

  function projectSaved(data: T, message: string) {
    onProjectChanged(data); setDialog(null); setNotice(message);
  }

  async function reviewBinding(binding: AssetBinding) {
    setPreparingReview(true); setError("");
    try {
      const asset = await request<Asset>(`v1/admin/assets/${encodeURIComponent(binding.id)}`);
      setDialog({ type: asset.rights_status === "approved" ? "review" : "approve", asset });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลสิทธิ์ไฟล์ไม่สำเร็จ"); }
    finally { setPreparingReview(false); }
  }

  function boundAsset(binding: AssetBinding) {
    return <article className="asset-card" key={binding.binding_id} aria-label={`${roleLabels[binding.asset_role]}: ${binding.original_filename}`}>
      {isBrand && binding.asset_role === "favicon" ? <div className="brand-favicon-preview">{[16, 32].map(size => <span key={size}><AssetImage asset={binding} alt={`${binding.alt_text?.th || "favicon"} ${size} พิกเซล`} width={size} height={size} /><small>{size} px</small></span>)}</div> : <Preview asset={binding} alt={binding.alt_text?.th} />}<div className="asset-caption"><strong>{roleLabels[binding.asset_role]}</strong>{isProject && binding.is_primary && <span className="project-media-primary">ไฟล์หลักของหมวด</span>}<span className="small-text muted">{binding.original_filename}</span><RightsBadge status={binding.rights_status} from={binding.asset_effective_from} to={binding.asset_effective_to} />{binding.alt_text?.th && <p className="small-text">{binding.alt_text.th}</p>}{isSample(binding) && <span className="sample-label">ไฟล์ตัวอย่างที่มากับระบบ</span>}<AssetFileLink asset={binding}>{binding.mime_type === "application/pdf" ? "ดาวน์โหลด PDF" : "เปิดภาพขนาดเต็ม"}<span className="visually-hidden"> {binding.original_filename} (เปิดในแท็บใหม่)</span></AssetFileLink>{canReview && !isBrand && <button className="button secondary" disabled={disabled || preparingReview} onClick={() => void reviewBinding(binding)}>{binding.rights_status === "approved" ? "ตรวจสอบสิทธิ์" : "อนุมัติใช้ไฟล์"}</button>}{canEdit && <button className="button secondary" disabled={disabled} onClick={() => setDialog({ type: "remove", binding })}>นำออกจาก{subject}</button>}</div>
    </article>;
  }

  const filtered = assets.filter(asset => (!isBrand || asset.mime_type.startsWith("image/")) && (!isProject || !canEdit || supportsPurpose(asset, purpose)) && asset.original_filename.toLocaleLowerCase("th").includes(search.trim().toLocaleLowerCase("th")));
  return <section className={`panel ${isBrand ? "brand-assets" : ""}`} id={sectionId} tabIndex={-1} aria-labelledby={`${sectionId}-title`}>
    <div className="panel-heading"><div><h2 id={`${sectionId}-title`}>{model ? `รูปภาพและแปลน · ${model.name}` : isBrand ? "โลโก้แบรนด์" : "รูปภาพและไฟล์ประกอบโครงการ"}</h2><p>{isBrand ? "ใช้ภาพจากคลังสื่อร่วมกัน ต้องมีโลโก้หลักที่ตรวจสิทธิ์แล้วก่อนเผยแพร่" : model ? "ภาพแบบ แปลนห้อง และแบบโครงสร้าง ผูกกับแบบที่เลือกเท่านั้น" : "ภาพหลัก ภาพย่อ ผังโครงการ และผังชั้นหรืออาคาร เก็บไฟล์ต้นฉบับและตรวจสิทธิ์ก่อนเผยแพร่"}</p></div><AssetIcon /></div>
    <div className="panel-body">
      {isProject && <div className="project-media-intro"><ol aria-label="ขั้นตอนเพิ่มไฟล์โครงการ"><li><span>1</span>เลือกประเภทไฟล์</li><li><span>2</span>อัปโหลดหรือใช้ไฟล์เดิม</li><li><span>3</span>ใส่คำอธิบายและบันทึก</li></ol><p>ไฟล์ที่บันทึกจะอยู่ในข้อมูลร่าง ผู้เผยแพร่ต้องตรวจสิทธิ์ก่อนเผยแพร่</p></div>}
      {isProject && canEdit && <fieldset className="project-media-purposes" disabled={disabled}><legend>ต้องการเพิ่มไฟล์ประเภทใด?</legend><div>{projectPurposes.map(item => {
        const count = bindings.filter(binding => binding.asset_role === item.role).length;
        return <label className={purpose === item.role ? "selected" : ""} key={item.role}><input type="radio" name={`${sectionId}-purpose`} value={item.role} checked={purpose === item.role} onChange={() => { setPurpose(item.role); setSearch(""); }} /><span><strong>{item.label}</strong><span>{item.description}</span><small>{count ? `มีแล้ว ${count} ไฟล์` : "ยังไม่มีไฟล์"}</small></span></label>;
      })}</div></fieldset>}
      <div className="asset-toolbar">{canEdit && <button className="button primary" disabled={disabled} onClick={() => setDialog({ type: "upload" })}>อัปโหลดไฟล์</button>}<button className="button secondary" aria-expanded={libraryOpen} aria-controls={`${sectionId}-library`} onClick={() => setLibraryOpen(value => !value)}>{libraryOpen ? "ปิดคลังสื่อ" : "เปิดคลังสื่อ"}</button>{isProject && canEdit && <span className="project-media-selected">เพิ่มเป็น: <strong>{projectPurposes.find(item => item.role === purpose)?.label}</strong></span>}</div>
      {isProject && <p className="field-help project-media-scope">แปลนห้องหรือบ้านแต่ละแบบ ให้เพิ่มในขั้นตอน “แบบที่อยู่อาศัย” เพื่อให้ไฟล์อยู่กับแบบที่ถูกต้อง</p>}
      {disabled && <p className="field-help">บันทึกหรือยกเลิกรายการที่กำลังแก้ไขก่อนจัดการไฟล์ หรือรอให้การบันทึกเสร็จสิ้น</p>}
      {unsavedProjectDetails && <p className="field-help">จัดการไฟล์ได้ทันที ข้อความโครงการที่แก้ไขยังอยู่ในฟอร์มและจะบันทึกเมื่อกด “บันทึกข้อมูลร่าง”</p>}
      {notice && <div className="notice success asset-notice" role="status">{notice}</div>}
      {libraryOpen && isProject && canEdit && <p className="project-media-library-purpose">เลือกไฟล์สำหรับ <strong>{projectPurposes.find(item => item.role === purpose)?.label}</strong> · แสดงเฉพาะชนิดไฟล์ที่ใช้ได้</p>}
      {!libraryOpen && error && <div className="notice error" role="alert">{error}</div>}
      {libraryOpen && <section className="asset-library" id={`${sectionId}-library`} data-asset-library aria-labelledby={`${sectionId}-library-title`}><div className="section-heading"><h3 id={`${sectionId}-library-title`}>คลังสื่อร่วมกัน</h3><button className="button secondary" disabled={loading} onClick={() => void loadLibrary()}>โหลดคลังสื่อใหม่</button></div><p className="muted small-text">ไฟล์หนึ่งใช้กับแบรนด์และโครงการหลายรายการได้ การอนุมัติหรือถอนสิทธิ์มีผลต่อทุกรายการที่ใช้ไฟล์นั้น</p><div className="form-field asset-search"><label htmlFor={`${sectionId}-search`}>ค้นหาชื่อไฟล์ในคลัง</label><input id={`${sectionId}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} /></div>{error && <div className="notice error" role="alert">{error}</div>}
        {loading ? <div className="loading-state asset-loading" role="status"><span className="spinner" />กำลังโหลดคลังสื่อ…</div> : error ? <p className="muted small-text">กดโหลดคลังสื่อใหม่เพื่อตรวจสอบรายการล่าสุด</p> : !filtered.length ? <p className="asset-empty muted">{search ? "ไม่พบไฟล์ที่ตรงกับคำค้น" : "ยังไม่มีไฟล์ในคลัง"}</p> : <><p className="small-text muted asset-result-count" role="status">พบ {filtered.length} ไฟล์</p><div className="library-grid">{filtered.map(asset => <article className="library-asset" key={asset.id} aria-label={asset.original_filename}><Preview asset={asset} /><div className="library-asset-body"><h4>{asset.original_filename}</h4><RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} /><p className="small-text muted">{asset.mime_type === "application/pdf" ? "PDF" : asset.mime_type.replace("image/", "").toUpperCase()} · {sizeLabel(asset.file_size)}{asset.width && asset.height ? ` · ${asset.width} × ${asset.height} พิกเซล` : ""}</p>{isSample(asset) && <p className="sample-label">ไฟล์ตัวอย่างที่มากับระบบ</p>}<details className="asset-metadata"><summary>ข้อมูลไฟล์และสิทธิ์</summary><dl><div><dt>หลักฐานและเงื่อนไขสิทธิ์</dt><dd>{asset.rights_notes || "ยังไม่ได้ระบุ"}</dd></div><div><dt>เริ่มใช้สิทธิ์</dt><dd>{dateLabel(asset.effective_from)}</dd></div><div><dt>สิ้นสุดสิทธิ์</dt><dd>{asset.effective_to ? dateLabel(asset.effective_to) : "ไม่ได้ระบุวันสิ้นสุด ไม่ใช่การรับรองสิทธิ์ตลอดไป"}</dd></div><div><dt>ตรวจสิทธิ์ล่าสุด</dt><dd>{dateLabel(asset.reviewed_at)}{asset.reviewed_by && <><br /><ActorName id={asset.reviewed_by} /></>}</dd></div>{asset.review_reason && <div><dt>เหตุผลในการตรวจสิทธิ์</dt><dd>{asset.review_reason}</dd></div>}<div><dt>รหัสตรวจสอบไฟล์</dt><dd className="checksum">{asset.checksum || "ไม่มีข้อมูล"}</dd></div></dl></details><AssetFileLink asset={asset}>{asset.mime_type === "application/pdf" ? "ดาวน์โหลด PDF" : "เปิดภาพขนาดเต็ม"}<span className="visually-hidden"> {asset.original_filename} (เปิดในแท็บใหม่)</span></AssetFileLink><div className="library-asset-actions">{canEdit && <button className="button secondary" disabled={disabled} onClick={() => setDialog({ type: "bind", asset })}>เลือกใช้กับ{subject}</button>}{canReview && <button className="button secondary" disabled={disabled} onClick={() => setDialog({ type: "review", asset })}>ตรวจสอบสิทธิ์</button>}</div></div></article>)}</div></>}
      </section>}
      <h3 className="asset-section-title">ไฟล์ของ{subject} <span className="count">{bindings.length}</span></h3>
      {isBrand ? <BrandLogoManager project={project} disabled={disabled} canEdit={canEdit} canReview={canReview} onChanged={onProjectChanged} renderBinding={boundAsset} /> : !bindings.length ? <p className="asset-empty muted">ยังไม่มีไฟล์ประกอบ{subject} {isProject ? "เลือกประเภทด้านบน แล้วอัปโหลดไฟล์ใหม่หรือเปิดคลังสื่อเพื่อใช้ไฟล์เดิม" : "เลือกไฟล์จากคลังแล้วกำหนดบทบาท"}</p> : <div className="asset-grid bound-assets">{bindings.map(boundAsset)}</div>}
    </div>
    {dialog?.type === "upload" && isProject && <ProjectUploadDialog project={project} purpose={purpose} onProjectChanged={onProjectChanged} onCancel={saved => { setDialog(null); if (saved) setNotice(`เพิ่มไฟล์ในข้อมูลร่างแล้ว ${saved} ไฟล์ ผู้เผยแพร่ต้องตรวจสิทธิ์ก่อนเผยแพร่`); if (libraryOpen) void loadLibrary(); }} />}
    {dialog?.type === "upload" && !isProject && <UploadDialog subject={subject} onCancel={() => setDialog(null)} onUploaded={async (asset, reused) => {
      setDialog(isProject ? { type: "bind", asset } : null); setLibraryOpen(!isProject); setSearch(asset.original_filename);
      setNotice(reused ? `พบไฟล์เดิมในคลัง: ${asset.original_filename} — ใช้รายการเดิมและคงสถานะสิทธิ์เดิม ยังไม่ได้ผูกกับ${subject}` : `อัปโหลด ${asset.original_filename} แล้ว — รอตรวจสิทธิ์และยังไม่ได้ผูกกับ${subject}`);
      await loadLibrary();
    }} />}
    {dialog?.type === "bind" && <BindDialog project={project} model={model} asset={dialog.asset} initialRole={isProject ? purpose : undefined} onCancel={() => { setDialog(null); if (isProject) setLibraryOpen(true); }} onSaved={data => projectSaved(data, "เพิ่มไฟล์ในข้อมูลร่างแล้ว ผู้เผยแพร่ต้องตรวจสิทธิ์และเผยแพร่ก่อนนำไปใช้งาน") } onReload={async () => { await refreshAfterReview(); setDialog(null); }} />}
    {dialog?.type === "approve" && <BatchLogoRights assets={[dialog.asset]} noun="ไฟล์" onChanged={refreshAfterReview} onCancel={() => setDialog(null)} />}
    {dialog?.type === "review" && <RightsDialog asset={dialog.asset} onCancel={() => setDialog(null)} onSaved={async asset => { setDialog(null); setNotice(asset.rights_status === "revoked" ? "ถอนสิทธิ์ไฟล์แล้ว แบรนด์และโครงการที่ใช้ไฟล์นี้อาจหยุดแสดงผ่าน API" : "บันทึกผลตรวจสิทธิ์แล้ว การเผยแพร่ยังขึ้นกับช่วงสิทธิ์และความพร้อมของข้อมูล"); try { await refreshAfterReview(); } catch (error) { setError(error instanceof Error ? error.message : "โหลดสถานะโครงการล่าสุดไม่สำเร็จ"); } }} onReload={async () => { await loadLibrary(); setDialog(null); }} />}
    {dialog?.type === "remove" && <RemoveDialog binding={dialog.binding} project={project} model={model} onCancel={() => setDialog(null)} onSaved={data => projectSaved(data, "นำไฟล์ออกจากข้อมูลร่างแล้ว ไฟล์ยังอยู่ในคลังสื่อ และข้อมูลที่เผยแพร่ยังไม่เปลี่ยนจนกว่าจะเผยแพร่อีกครั้ง")} onReload={async () => { await refreshAfterReview(); setDialog(null); }} />}
  </section>;
}

type LogoRole = typeof brandLogoRoles[number];
type LogoFacts = { width?: number; height?: number; opaque?: boolean };
type LogoItem = { key: number; file?: File; asset?: Asset; role: LogoRole; alt: string; facts: LogoFacts; status: "ready" | "uploading" | "binding" | "saved" | "failed"; error: string; reconcile?: boolean; previousBindingId?: string };
const logoTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const logoAlt = (brand: AssetOwner, role: LogoRole) => `โลโก้ ${brand.public_name?.th || brand.public_brand_id || "แบรนด์"} ${roleLabels[role]}`;
function logoWarnings(role: LogoRole, facts: LogoFacts) {
  const warnings: string[] = [];
  if (role === "favicon" && facts.width && facts.height && (facts.width !== facts.height || Math.min(facts.width, facts.height) < 512)) warnings.push("แนะนำ favicon สี่เหลี่ยมจัตุรัส ขนาดอย่างน้อย 512 × 512 พิกเซล");
  if (role === "favicon" && (!facts.width || !facts.height)) warnings.push("ยังตรวจขนาด favicon ไม่ได้ กรุณาตรวจตัวอย่างหลังอัปโหลด");
  if (role !== "favicon" && facts.opaque) warnings.push("ภาพอาจมีพื้นหลังทึบ แนะนำตรวจพื้นหลังหรือใช้ไฟล์โปร่งใส");
  if (role !== "favicon" && facts.opaque === undefined) warnings.push("ยังตรวจพื้นหลังไม่ได้ กรุณาตรวจตัวอย่างไฟล์ด้วยตนเอง");
  return warnings;
}
async function inspectLogo(file: File): Promise<LogoFacts> {
  // Untrusted SVG is never rendered locally. Only the server-sanitized asset gets a preview.
  if (!file.size || file.size > maxFileSize || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return {};
  const url = URL.createObjectURL(file);
  try { return await inspectLogoImage(url); } finally { URL.revokeObjectURL(url); }
}
async function inspectLogoImage(url: string): Promise<LogoFacts> {
  try {
    const image = new Image(); image.src = url; await image.decode();
    const facts: LogoFacts = { width: image.naturalWidth, height: image.naturalHeight };
    if (image.naturalWidth * image.naturalHeight > 40_000_000) return facts;
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) { context.drawImage(image, 0, 0, 64, 64); const pixels = context.getImageData(0, 0, 64, 64).data; facts.opaque = pixels.every((value, index) => index % 4 !== 3 || value === 255); }
    return facts;
  } catch { return {}; }
}
function suggestLogoRole(filename: string, facts: LogoFacts): LogoRole {
  if (/favicon|fav[-_ ]?icon|ไอคอน/i.test(filename)) return "favicon";
  if (/white|สีขาว/i.test(filename)) return "logo_white";
  if (/mono|black|b[&_ -]?w|ขาวดำ/i.test(filename)) return "logo_mono";
  return facts.width && facts.width === facts.height && facts.width <= 512 ? "favicon" : "logo_primary";
}

function BrandLogoManager<T extends AssetOwner>({ project, disabled, canEdit, canReview, onChanged, renderBinding }: {
  project: T; disabled: boolean; canEdit: boolean; canReview: boolean; onChanged: (data: T) => void; renderBinding: (binding: AssetBinding) => ReactNode;
}) {
  const hosted = Boolean(useHostedSession());
  async function inspectStoredLogo(asset: Asset) {
    if (!hosted) return inspectLogoImage(fileUrl(asset));
    const url = URL.createObjectURL(await privateAssetBlob(asset));
    try { return await inspectLogoImage(url); } finally { URL.revokeObjectURL(url); }
  }
  const [alts, setAlts] = useState<Record<LogoRole, string>>(() => Object.fromEntries(brandLogoRoles.map(role => [role, logoAlt(project, role)])) as Record<LogoRole, string>);
  const [items, setItems] = useState<LogoItem[]>([]);
  const itemRef = useRef<LogoItem[]>([]);
  const nextKey = useRef(0);
  const locked = useRef(false);
  const preparingRef = useRef(false);
  const latest = useRef(project);
  const inputs = useRef<Partial<Record<LogoRole, HTMLInputElement | null>>>({});
  const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const [bulk, setBulk] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [libraryRole, setLibraryRole] = useState<LogoRole | null>(null);
  const [library, setLibrary] = useState<Asset[]>([]);
  const [libraryError, setLibraryError] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [rights, setRights] = useState<Asset[] | null>(null);
  useEffect(() => { if (!locked.current) latest.current = project; }, [project]);
  const base = `v1/admin/brands/${encodeURIComponent(project.public_brand_id || "")}`;
  const bindings = project.assets ?? [];
  const remaining = items.filter(item => item.status !== "saved");
  const savedCount = items.length - remaining.length;
  const blocked = disabled || pending || preparing || bulk || Boolean(remaining.length);
  useEffect(() => {
    if (bulk || (!pending && !remaining.length)) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [bulk, pending, remaining.length]);
  const replaceItems = (rows: LogoItem[]) => { itemRef.current = rows; setItems(rows); };
  const patch = (key: number, values: Partial<LogoItem>) => replaceItems(itemRef.current.map(item => item.key === key ? { ...item, ...values } : item));
  const matches = (data: T, item: LogoItem) => data.assets?.some(binding => binding.asset_role === item.role && binding.id === item.asset?.id && binding.alt_text?.th === item.alt.trim());
  const duplicates = remaining.some((item, index) => remaining.findIndex(other => other.role === item.role) !== index);

  async function process(rows: LogoItem[]) {
    if (locked.current || disabled || !canEdit) return;
    const invalid = rows.find(item => !item.alt.trim() || (item.file && (!logoTypes.includes(item.file.type) || !item.file.size || item.file.size > (item.file.type === "image/svg+xml" ? 2 * 1024 * 1024 : maxFileSize))));
    if (invalid) { patch(invalid.key, { error: !invalid.alt.trim() ? "กรอกคำอธิบายภาษาไทยก่อนเพิ่มโลโก้" : "ใช้ PNG, JPEG หรือ WebP ไม่เกิน 10 MiB หรือ SVG ไม่เกิน 2 MiB และไฟล์ต้องมีข้อมูล", status: "failed" }); setError("ตรวจสอบไฟล์และคำอธิบายด้านล่าง"); return; }
    locked.current = true; setPending(true); setAttempted(true); setError("");
    try {
      for (const original of rows) {
        let item = itemRef.current.find(row => row.key === original.key)!;
        if (item.status === "saved") continue;
        try {
          if (item.reconcile) {
            const current = await request<T>(base); latest.current = current; onChanged(current);
            if (matches(current, item)) { patch(item.key, { status: "saved", error: "", reconcile: false }); continue; }
            // Keep the original expected revision if another person changed this slot.
            if (current.assets?.find(binding => binding.asset_role === item.role)?.binding_id !== item.previousBindingId) throw new Error("ช่องโลโก้นี้ถูกแก้ไขแล้ว กรุณาปิดรายการและตรวจสอบข้อมูลล่าสุดก่อนแทนที่");
            patch(item.key, { reconcile: false });
          }
          if (!item.asset && item.file) {
            patch(item.key, { status: "uploading", error: "" });
            const result = await uploadAsset(item.file); item = { ...item, asset: result.asset, facts: { ...item.facts, width: result.asset.width ?? item.facts.width, height: result.asset.height ?? item.facts.height } }; patch(item.key, { asset: result.asset, facts: item.facts });
            if (result.asset.mime_type === "image/svg+xml") { item.facts = { ...item.facts, ...await inspectStoredLogo(result.asset) }; patch(item.key, { facts: item.facts }); }
          }
          if (!item.asset) throw new Error("ไม่พบไฟล์ที่จะผูกกับแบรนด์");
          if (!matches(latest.current, item)) {
            patch(item.key, { status: "binding", error: "", reconcile: true, previousBindingId: latest.current.assets?.find(binding => binding.asset_role === item.role)?.binding_id });
            const data = await request<T>(`${base}/assets`, "POST", { asset_id: item.asset.id, asset_role: item.role, alt_text: { th: item.alt.trim() }, updated_at: latest.current.updated_at });
            latest.current = data; onChanged(data);
          }
          patch(item.key, { status: "saved", error: "", reconcile: false });
        } catch (cause) {
          patch(item.key, { status: "failed", error: cause instanceof Error ? cause.message : "เพิ่มโลโก้ไม่สำเร็จ" });
          setError("บางไฟล์ยังไม่สำเร็จ ลองใหม่เฉพาะไฟล์นั้นได้ ไฟล์ที่ได้รับรหัสจากคลังแล้วจะไม่อัปโหลดซ้ำ");
          if (itemRef.current.find(row => row.key === item.key)?.reconcile) break;
        }
      }
    } finally { locked.current = false; setPending(false); }
  }

  async function chooseFiles(files: File[], role?: LogoRole) {
    if (blocked || locked.current || preparingRef.current || !canEdit || !files.length) return;
    if (role && !alts[role].trim()) { setError(`กรอกคำอธิบายภาษาไทยสำหรับ${roleLabels[role]}ก่อนเพิ่มไฟล์`); return; }
    preparingRef.current = true;
    setPreparing(true); setError(""); setAttempted(false);
    try {
      const rows = await Promise.all(files.map(async file => { const facts = await inspectLogo(file); const selectedRole = role ?? suggestLogoRole(file.name, facts); return { key: nextKey.current++, file, role: selectedRole, alt: role ? alts[role] : logoAlt(project, selectedRole), facts, status: "ready" as const, error: "" }; }));
      replaceItems(rows);
      if (files.length > 1 || !role) setBulk(true); else await process(rows);
    } finally { preparingRef.current = false; setPreparing(false); }
  }
  async function openLibrary(role: LogoRole) {
    if (blocked || locked.current || preparingRef.current) return;
    setLibraryRole(role); setLibrarySearch(""); setLibraryError(""); setLibraryLoading(true);
    try { setLibrary((await request<Asset[]>("v1/admin/assets")).filter(asset => logoTypes.includes(asset.mime_type))); }
    catch (cause) { setLibraryError(cause instanceof Error ? cause.message : "โหลดคลังสื่อไม่สำเร็จ"); }
    finally { setLibraryLoading(false); }
  }
  async function chooseAsset(asset: Asset) {
    if (!libraryRole || pending || disabled || locked.current || preparingRef.current) return;
    preparingRef.current = true; setPreparing(true);
    try {
      const inspected = await inspectStoredLogo(asset);
      const rows: LogoItem[] = [{ key: nextKey.current++, asset, role: libraryRole, alt: alts[libraryRole], facts: { ...inspected, width: asset.width ?? inspected.width, height: asset.height ?? inspected.height }, status: "ready", error: "" }];
      setLibraryRole(null); setAttempted(false); replaceItems(rows); await process(rows);
    } finally { preparingRef.current = false; setPreparing(false); }
  }
  async function openRights() {
    setError(""); setPreparing(true);
    try { setRights(await Promise.all([...new Set(selected)].map(id => request<Asset>(`v1/admin/assets/${encodeURIComponent(id)}`)))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลสิทธิ์ไม่สำเร็จ"); }
    finally { setPreparing(false); }
  }
  async function rightsChanged() { const data = await request<T>(base); latest.current = data; onChanged(data); }
  function closeBatch() { setBulk(false); replaceItems([]); setError(""); }
  function rowsView() {
    return <div className="project-upload-queue brand-logo-confirm-table" role="list" aria-label="รายการโลโก้ที่ตรวจสอบ">{items.map(item => <article className={`project-upload-item ${item.status === "saved" ? "saved" : ""}`} key={item.key} aria-label={item.file?.name || item.asset?.original_filename} role="listitem">
      {item.asset ? <Preview asset={item.asset} /> : item.file ? <UploadPreview file={item.file} /> : null}<div className="project-upload-details"><strong>{item.file?.name || item.asset?.original_filename}</strong>{item.file?.type === "image/svg+xml" && !item.asset && <p className="field-help">SVG จะแสดงตัวอย่างหลังตรวจความปลอดภัยบนเซิร์ฟเวอร์แล้ว ยังไม่ยืนยันขนาดหรือความโปร่งใส การตรวจความปลอดภัยอาจทำให้ภาพเรียบง่ายลง หากภาพเปลี่ยนให้ใช้ PNG, JPEG หรือ WebP</p>}
        {bulk ? <><div className="form-field"><label htmlFor={`logo-role-${item.key}`}>บทบาท · {item.file?.name}</label><select id={`logo-role-${item.key}`} value={item.role} disabled={pending || attempted} onChange={event => { const role = event.target.value as LogoRole; patch(item.key, { role, alt: logoAlt(project, role), error: "" }); }}>{brandLogoRoles.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></div><div className="form-field"><label htmlFor={`logo-alt-${item.key}`}>คำอธิบายภาพ (ภาษาไทย) · {item.file?.name}</label><textarea id={`logo-alt-${item.key}`} rows={2} maxLength={1000} value={item.alt} disabled={pending || attempted} onChange={event => patch(item.key, { alt: event.target.value, error: "" })} /></div></> : <p>{roleLabels[item.role]} · {item.alt}</p>}
        {logoWarnings(item.role, item.facts).map(warning => <p className="inline-warning" key={warning}>คำแนะนำ: {warning} · ยังบันทึกได้</p>)}{item.error && <p className="field-error">{item.error}</p>}<p className="project-upload-status" role="status">{item.status === "saved" ? "ผูกโลโก้ในข้อมูลร่างแล้ว" : item.status === "uploading" ? "กำลังอัปโหลดและตรวจสอบไฟล์…" : item.status === "binding" ? "กำลังผูกโลโก้…" : item.asset ? "อัปโหลดแล้ว รอผูกโลโก้" : "รอยืนยันอัปโหลด"}</p>{item.status === "failed" && <button type="button" className="button secondary" disabled={pending || duplicates} onClick={() => void process([item])}>ลองอีกครั้ง · {item.file?.name || item.asset?.original_filename}</button>}{bulk && !attempted && <button type="button" className="button secondary" disabled={pending} onClick={() => replaceItems(itemRef.current.filter(row => row.key !== item.key))}>นำออกจากรายการ · {item.file?.name}</button>}
      </div></article>)}</div>;
  }
  return <>
    {canEdit && <div className={`brand-logo-dropzone ${dragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); if (!blocked) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void chooseFiles(Array.from(event.dataTransfer.files)); }}><strong>วางโลโก้หลายไฟล์ที่นี่ แล้วตรวจบทบาทก่อนอัปโหลด</strong><label className="button secondary">เลือกโลโก้หลายไฟล์<input type="file" multiple accept={logoTypes.join(",")} className="visually-hidden" aria-label="เลือกโลโก้หลายไฟล์" disabled={blocked} onChange={event => { void chooseFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label><p className="field-help">PNG, JPEG, WebP ไม่เกิน 10 MiB · SVG ไม่เกิน 2 MiB · การแทนที่เก็บประวัติการผูกเดิมไว้</p></div>}
    {canReview && <div className="brand-logo-batch-toolbar"><span>เลือกโลโก้ที่ตรวจแล้วเพื่ออนุมัติใช้งาน ระบบบันทึกผู้อนุมัติและเวลาของแต่ละไฟล์</span><button className="button primary" disabled={disabled || preparing || !selected.length} onClick={() => void openRights()}>อนุมัติใช้โลโก้ที่เลือก ({selected.length})</button></div>}
    {!bulk && error && <div className="notice error" role="alert">{error}</div>}{preparing && <p role="status">กำลังตรวจสอบไฟล์…</p>}
    <div className="brand-logo-slots" onDragOver={event => { if (canEdit) event.preventDefault(); }} onDrop={event => { if (!canEdit) return; event.preventDefault(); void chooseFiles(Array.from(event.dataTransfer.files)); }}>{brandLogoRoles.map(role => {
      const logos = bindings.filter(binding => binding.asset_role === role);
      return <section className="brand-logo-slot" data-logo-role={role} key={role} aria-label={roleLabels[role]} onDragOver={event => { if (canEdit) event.preventDefault(); }} onDrop={event => { if (!canEdit) return; event.preventDefault(); event.stopPropagation(); const files = Array.from(event.dataTransfer.files); void chooseFiles(files, files.length === 1 ? role : undefined); }}><div className="brand-logo-slot-heading"><h4>{roleLabels[role]}</h4><span className="small-text">{role === "logo_primary" ? "จำเป็น" : "ไม่บังคับ"}</span></div>{logos.length ? logos.map(binding => <div key={binding.binding_id}>{canReview && <label className="brand-logo-select"><input type="checkbox" checked={selected.includes(binding.id)} disabled={disabled || preparing} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, binding.id])] : previous.filter(id => id !== binding.id))} />เลือกอนุมัติ {binding.original_filename}</label>}{renderBinding(binding)}</div>) : <div className="asset-empty"><AssetIcon /><p>ยังไม่มี{roleLabels[role]}</p><p className="small-text muted">สิทธิ์: ยังไม่มีไฟล์ให้ตรวจสอบ</p></div>}{canEdit && <div className="brand-logo-slot-actions"><div className="form-field"><label htmlFor={`slot-alt-${role}`}>คำอธิบายภาพ (ภาษาไทย) · {roleLabels[role]}</label><textarea id={`slot-alt-${role}`} rows={2} maxLength={1000} value={alts[role]} disabled={blocked} onChange={event => setAlts(previous => ({ ...previous, [role]: event.target.value }))} /></div><div className="asset-toolbar"><button type="button" className="button primary" disabled={blocked || !alts[role].trim()} onClick={() => inputs.current[role]?.click()}>{logos.length ? "เปลี่ยนไฟล์" : "อัปโหลด"}</button><input type="file" ref={element => { inputs.current[role] = element; }} hidden aria-label={`เลือกไฟล์ · ${roleLabels[role]}`} accept={logoTypes.join(",")} disabled={blocked} onChange={event => { void chooseFiles(Array.from(event.target.files ?? []), role); event.target.value = ""; }} /><button type="button" className="button secondary" disabled={blocked || !alts[role].trim()} onClick={() => void openLibrary(role)}>เลือกจากคลัง</button></div><p className="field-help">วางไฟล์ในช่องนี้เพื่ออัปโหลดและผูกเป็น{roleLabels[role]}{logos.length ? " · ไฟล์เดิมคงอยู่ในประวัติและคลัง" : ""}</p></div>}</section>;
    })}</div>
    {!bulk && items.length > 0 && <div aria-live="polite">{rowsView()}{!pending && remaining.length > 0 && <button className="button secondary" onClick={() => { if (window.confirm("ไฟล์ที่อัปโหลดแล้วจะยังอยู่ในคลัง ต้องการยกเลิกรายการที่ยังไม่เสร็จหรือไม่?")) { replaceItems([]); setError(""); } }}>ยกเลิกรายการที่ยังไม่เสร็จ</button>}</div>}
    {bulk && <AssetDialog title="ตรวจสอบโลโก้ก่อนอัปโหลด" dirty={remaining.length > 0} pending={pending} error={error} onCancel={closeBatch} onSubmit={event => { event.preventDefault(); if (!duplicates) void process(remaining); }} submitLabel={remaining.length ? attempted ? "ลองอีกครั้งเฉพาะไฟล์ที่ยังไม่สำเร็จ" : "ยืนยันอัปโหลดและผูกโลโก้" : "ผูกโลโก้ครบแล้ว"} submitDisabled={!remaining.length || duplicates} cancelLabel="ปิด" discardMessage="ไฟล์ที่บันทึกแล้วจะยังอยู่ในข้อมูลร่างและคลัง ต้องการปิดรายการที่ยังไม่เสร็จหรือไม่?"><p>{attempted ? "บทบาทและคำอธิบายชุดนี้คงเดิมระหว่างลองใหม่ ตรวจผลแยกแต่ละไฟล์ด้านล่าง" : "บทบาทเป็นเพียงคำแนะนำ ตรวจแต่ละไฟล์และคำอธิบายก่อนยืนยัน ยังไม่มีไฟล์ถูกอัปโหลด"}</p><p className="project-upload-summary" role="status">ผูกแล้ว {savedCount} จาก {items.length} ไฟล์</p>{duplicates && <p className="inline-warning" role="alert">เลือกหนึ่งไฟล์ต่อบทบาท เพื่อไม่ให้ไฟล์ในชุดนี้แทนที่กัน</p>}{rowsView()}<p className="field-help">การแทนที่เก็บการผูกเดิมในประวัติ ข้อมูลที่เผยแพร่อยู่ยังไม่เปลี่ยน</p></AssetDialog>}
    {libraryRole && <AssetDialog title={`เลือกจากคลัง · ${roleLabels[libraryRole]}`} dirty={false} pending={preparing} error={libraryError} onCancel={() => setLibraryRole(null)} onSubmit={event => event.preventDefault()} submitLabel="เลือกไฟล์จากรายการ" submitDisabled><p>{roleLabels[libraryRole]} · {alts[libraryRole]}</p><p className="field-help">กดเลือกแล้วผูกกับช่องนี้ทันที สถานะสิทธิ์เดิมไม่เปลี่ยน</p><div className="form-field"><label htmlFor="logo-library-search">ค้นหาชื่อโลโก้ในคลัง</label><input id="logo-library-search" type="search" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} /></div>{libraryLoading ? <p role="status">กำลังโหลดคลังสื่อ…</p> : libraryError ? <button type="button" className="button secondary" onClick={() => void openLibrary(libraryRole)}>ลองโหลดคลังสื่ออีกครั้ง</button> : <div className="library-grid">{library.filter(asset => asset.original_filename.toLocaleLowerCase("th").includes(librarySearch.toLocaleLowerCase("th"))).map(asset => <article className="library-asset" key={asset.id} aria-label={asset.original_filename}><Preview asset={asset} /><div className="library-asset-body"><strong>{asset.original_filename}</strong><RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} />{logoWarnings(libraryRole, { width: asset.width ?? undefined, height: asset.height ?? undefined }).map(warning => <p className="field-help" key={warning}>คำแนะนำ: {warning}</p>)}<button type="button" className="button primary" disabled={preparing} onClick={() => void chooseAsset(asset)}>เลือกใช้เป็น{roleLabels[libraryRole]}</button></div></article>)}</div>}</AssetDialog>}
    {rights && <BatchLogoRights assets={rights} onChanged={rightsChanged} onCancel={() => { setRights(null); setSelected([]); }} />}
  </>;
}

function BatchLogoRights({ assets, onChanged, onCancel, noun = "โลโก้" }: { assets: Asset[]; noun?: string; onChanged: () => Promise<void>; onCancel: () => void }) {
  const [notes, setNotes] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [pending, setPending] = useState(false); const [attempted, setAttempted] = useState(false); const [error, setError] = useState("");
  const [done, setDone] = useState<string[]>([]); const [failed, setFailed] = useState<Record<string, string>>({});
  const [reconciled, setReconciled] = useState<string[]>([]);
  const doneRef = useRef(new Set<string>()); const uncertain = useRef(new Set<string>());
  const snapshots = useRef(new Map(assets.map(asset => [asset.id, asset])));
  const remaining = assets.filter(asset => !done.includes(asset.id));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    const start = from ? new Date(`${from}:00+07:00`) : null; const end = to ? new Date(`${to}:00+07:00`) : null;
    if (start && !Number.isFinite(start.getTime()) || end && !Number.isFinite(end.getTime()) || start && end && end <= start) { setError("ตรวจวันเริ่มและสิ้นสุดสิทธิ์ให้ถูกต้อง"); return; }
    const reason = `อนุมัติใช้${noun}โดยผู้เผยแพร่${notes.trim() ? ` · ${notes.trim()}` : ""}`;
    setPending(true); setAttempted(true); setError("");
    for (const asset of remaining) {
      if (doneRef.current.has(asset.id)) continue;
      try {
        const expected = snapshots.current.get(asset.id)!;
        const fields = { decision: "approved", rights_notes: expected.rights_notes?.trim() ? expected.rights_notes : `ผู้เผยแพร่อนุมัติใช้${noun}ผ่านระบบ Hub`,
          change_reason: reason, effective_from: start?.toISOString() ?? expected.effective_from ?? null, effective_to: end?.toISOString() ?? expected.effective_to ?? null };
        if (uncertain.current.has(asset.id)) {
          const current = await request<Asset>(`v1/admin/assets/${encodeURIComponent(asset.id)}`);
          const sameDate = (left: string | null, right: string | null) => left === null || right === null ? left === right : Date.parse(left) === Date.parse(right);
          if (current.updated_at !== expected.updated_at && current.rights_status === "approved" && current.rights_notes === fields.rights_notes && current.review_reason === fields.change_reason && sameDate(current.effective_from, fields.effective_from) && sameDate(current.effective_to, fields.effective_to)) { doneRef.current.add(asset.id); setDone([...doneRef.current]); setReconciled(previous => [...previous, asset.id]); setFailed(previous => ({ ...previous, [asset.id]: "" })); continue; }
          if (current.updated_at !== expected.updated_at) throw new Error("สิทธิ์ไฟล์นี้เปลี่ยนแล้ว กรุณาปิดและเลือกตรวจสิทธิ์ใหม่โดยใช้ข้อมูลล่าสุด");
        }
        uncertain.current.add(asset.id);
        await request<Asset>(`v1/admin/assets/${encodeURIComponent(asset.id)}/review`, "POST", { ...fields, updated_at: expected.updated_at });
        doneRef.current.add(asset.id); uncertain.current.delete(asset.id); setDone([...doneRef.current]); setFailed(previous => ({ ...previous, [asset.id]: "" }));
      } catch (cause) { setFailed(previous => ({ ...previous, [asset.id]: cause instanceof Error ? cause.message : "อนุมัติสิทธิ์ไม่สำเร็จ" })); }
    }
    try { await onChanged(); } catch { setError("บันทึกผลที่สำเร็จแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาโหลดหน้าใหม่"); }
    setPending(false);
  }
  return <AssetDialog title={`อนุมัติใช้${noun}`} dirty={!attempted && Boolean(notes || from || to)} pending={pending} error={error} onCancel={onCancel} onSubmit={submit} submitLabel={attempted ? remaining.length ? "ลองอนุมัติเฉพาะไฟล์ที่ยังไม่สำเร็จ" : "อนุมัติครบแล้ว" : `ยืนยันอนุมัติ ${assets.length} ไฟล์`} submitDisabled={!remaining.length} cancelLabel="ปิด">
    <p>การกดยืนยันถือเป็นการอนุมัติใช้{noun}ของผู้เผยแพร่ ระบบบันทึกผู้อนุมัติ เวลา และผลอนุมัติแยกทุกไฟล์</p>
    <p className="field-help">มีผลกับทุกแบรนด์หรือโครงการที่ใช้ไฟล์เดียวกัน การเผยแพร่ข้อมูลยังเป็นอีกขั้นตอนหนึ่ง</p>
    <ul className="brand-logo-rights-results">{assets.map(asset => <li key={asset.id} className="brand-logo-approval-file"><Preview asset={asset} /><div><strong>{asset.original_filename}</strong><p role="status">{done.includes(asset.id) ? reconciled.includes(asset.id) ? "พบผลอนุมัติที่ตรงกันแล้ว ไม่บันทึกซ้ำ" : `อนุมัติใช้${noun}แล้ว` : failed[asset.id] || "รออนุมัติ"}</p>{asset.effective_from || asset.effective_to ? <p className="small-text muted">ช่วงเวลาเดิม: {dateLabel(asset.effective_from)} – {dateLabel(asset.effective_to)}</p> : null}</div></li>)}</ul>
    <div className="form-field"><label htmlFor="logo-approval-note">หมายเหตุเพิ่มเติม (ไม่บังคับ)</label><textarea id="logo-approval-note" rows={2} maxLength={900} value={notes} disabled={pending || attempted} onChange={event => setNotes(event.target.value)} /></div>
    <details className="brand-logo-approval-dates"><summary>กำหนดช่วงเวลาใช้งาน (ไม่บังคับ)</summary><div className="field-grid"><div className="form-field"><label htmlFor="logo-rights-from">เริ่มใช้สิทธิ์ (เวลาไทย)</label><input id="logo-rights-from" type="datetime-local" value={from} disabled={pending || attempted} onChange={event => setFrom(event.target.value)} /></div><div className="form-field"><label htmlFor="logo-rights-to">สิ้นสุดสิทธิ์ (เวลาไทย)</label><input id="logo-rights-to" type="datetime-local" value={to} disabled={pending || attempted} onChange={event => setTo(event.target.value)} /></div></div><p className="field-help">เวลา Asia/Bangkok · ช่องที่เว้นว่างจะคงช่วงเวลาเดิมของแต่ละไฟล์ หลังเริ่มอนุมัติจะเก็บค่าเดิมระหว่างลองใหม่</p></details>
  </AssetDialog>;
}

export function AssetDialog({ title, dirty, pending, error, conflict, onCancel, onSubmit, onReload, submitLabel, submitDisabled, cancelLabel = "ยกเลิก", discardMessage = "มีข้อมูลที่ยังไม่ได้บันทึก ต้องการทิ้งการแก้ไขหรือไม่?", danger, focusTitle = false, children }: {
  title: string; dirty: boolean; pending: boolean; error: string; conflict?: boolean;
  onCancel: () => void; onSubmit: (event: FormEvent) => void; onReload?: () => Promise<void>;
  submitLabel: string; submitDisabled?: boolean; cancelLabel?: string; discardMessage?: string; danger?: boolean; focusTitle?: boolean; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const [reloadError, setReloadError] = useState("");
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    if (focusTitle) element?.querySelector<HTMLElement>("#asset-dialog-title")?.focus();
    return () => {
      element?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [focusTitle]);
  useEffect(() => { if (error || reloadError) summary.current?.focus(); }, [error, reloadError]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, pending]);
  const discard = () => !dirty || window.confirm(discardMessage);
  function cancel() { if (!pending && !reloading && discard()) onCancel(); }
  async function reload() {
    if (!onReload || !discard()) return;
    setReloading(true); setReloadError("");
    try { await onReload(); } catch (error) { setReloadError(error instanceof Error ? error.message : "โหลดข้อมูลล่าสุดไม่สำเร็จ"); }
    finally { setReloading(false); }
  }
  return <dialog ref={dialog} className="action-dialog asset-dialog" aria-labelledby="asset-dialog-title" onCancel={event => { event.preventDefault(); cancel(); }}><form onSubmit={onSubmit} noValidate><h2 id="asset-dialog-title" tabIndex={focusTitle ? -1 : undefined}>{title}</h2>{(error || reloadError) && <div className="notice error model-error-summary" ref={summary} role="alert" tabIndex={-1}><strong>{reloadError || error}</strong>{conflict && <><p>ข้อมูลที่กรอกยังอยู่ กรุณาคัดลอกสิ่งที่ต้องการเก็บก่อนโหลดข้อมูลล่าสุด</p><button type="button" className="button secondary" disabled={pending || reloading} onClick={() => void reload()}>{reloading ? "กำลังโหลด…" : "โหลดข้อมูลล่าสุด"}</button></>}</div>}{children}<div className="dialog-actions"><button type="button" className="button secondary" disabled={pending || reloading} onClick={cancel}>{cancelLabel}</button><button type="submit" className={`button ${danger ? "danger" : "primary"}`} aria-busy={pending} disabled={pending || reloading || submitDisabled}>{pending ? "กำลังดำเนินการ…" : submitLabel}</button></div></form></dialog>;
}

async function uploadAsset(file: File): Promise<{ asset: Asset; reused: boolean }> {
  const response = await assetFetch("v1/admin/assets", { method: "POST", headers: { "Content-Type": file.type, "X-Filename": encodeURIComponent(file.name) }, body: file, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data?.id) throw new Error(body?.error?.message ?? "อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง");
  return { asset: body.data, reused: Boolean(body.meta?.reused) };
}

type UploadItem = { key: number; file: File; alt: string; asset?: Asset; status: "ready" | "uploading" | "binding" | "saved" | "failed"; error: string; note?: string };

function UploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.size || file.size > maxFileSize || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <div className="project-upload-preview">{url ? <img src={url} alt={`ตัวอย่าง ${file.name}`} /> : <AssetIcon pdf={file.type === "application/pdf"} />}</div>;
}

function ProjectUploadDialog<T extends AssetOwner>({ project, purpose, onProjectChanged, onCancel }: {
  project: T; purpose: AssetRole; onProjectChanged: (project: T) => void; onCancel: (saved: number) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const nextKey = useRef(0);
  // Keep the batch revision independent: the parent may preserve an older text draft on conflict.
  const latest = useRef(project);
  const base = `v1/admin/projects/${encodeURIComponent(project.public_project_id || "")}`;
  const savedCount = items.filter(item => item.status === "saved").length;
  const remaining = items.filter(item => item.status !== "saved");
  const patchItem = (key: number, patch: Partial<UploadItem>) => setItems(previous => previous.map(item => item.key === key ? { ...item, ...patch } : item));
  const attached = (data: T, asset: Asset) => data.assets?.find(binding => binding.id === asset.id && binding.asset_role === purpose && !binding.public_model_id);

  function validate(item: UploadItem) {
    if (!acceptedTypes.includes(item.file.type)) return "รองรับเฉพาะไฟล์ PNG, JPEG, WebP และ PDF";
    if (!supportsPurpose({ mime_type: item.file.type }, purpose)) return purpose === "brochure" ? "โบรชัวร์รองรับไฟล์ PDF" : "ภาพหลักและภาพย่อรองรับไฟล์ PNG, JPEG หรือ WebP";
    if (!item.file.size || item.file.size > maxFileSize) return "ไฟล์ต้องมีข้อมูลและมีขนาดไม่เกิน 10 MiB";
    if (!item.alt.trim()) return "กรอกคำอธิบายภาษาไทยสำหรับไฟล์นี้";
    return "";
  }

  async function reload() {
    setPending(true); setError("");
    try {
      const data = await request<T>(base);
      latest.current = data;
      onProjectChanged(data);
      setItems(previous => previous.map(item => {
        const binding = item.asset && attached(data, item.asset);
        return item.status !== "saved" && binding ? { ...item, alt: binding.alt_text?.th ?? "", status: "saved", error: "", note: "พบไฟล์ในโครงการแล้ว ใช้รายการและคำอธิบายที่บันทึกไว้" } : item;
      }));
      setNeedsReload(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "โหลดข้อมูลล่าสุดไม่สำเร็จ"); }
    finally { setPending(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || needsReload || !remaining.length) return;
    setError("");
    const checked = items.map(item => item.status === "saved" ? item : { ...item, error: validate(item) });
    setItems(checked);
    if (checked.some(item => item.error)) { setError("ตรวจสอบไฟล์และคำอธิบายที่ระบุด้านล่างก่อนอัปโหลด"); return; }
    setPending(true); setAttempted(true);
    let failures = 0;
    for (const item of remaining) {
      let asset = item.asset;
      if (!asset) {
        patchItem(item.key, { status: "uploading", error: "" });
        try {
          const result = await uploadAsset(item.file);
          asset = result.asset;
          patchItem(item.key, { asset, note: result.reused ? "ใช้ไฟล์เดิมในคลังและคงสถานะสิทธิ์เดิม" : undefined });
        } catch (cause) {
          failures += 1;
          patchItem(item.key, { status: "failed", error: cause instanceof Error ? cause.message : "อัปโหลดไม่สำเร็จ" });
          continue;
        }
      }
      const existing = attached(latest.current, asset);
      if (existing) {
        patchItem(item.key, { status: "saved", alt: existing.alt_text?.th ?? "", error: "", note: "มีไฟล์นี้ในประเภทนี้แล้ว คงรายการและคำอธิบายเดิมโดยไม่เพิ่มซ้ำ" });
        continue;
      }
      patchItem(item.key, { status: "binding", error: "" });
      try {
        const data = await request<T>(`${base}/assets`, "POST", { asset_id: asset.id, asset_role: purpose, alt_text: { th: item.alt.trim() }, updated_at: latest.current.updated_at });
        latest.current = data;
        onProjectChanged(data);
        patchItem(item.key, { status: "saved", error: "" });
      } catch (cause) {
        // A lost response can still mean the bind committed. Reconcile before retrying any write.
        patchItem(item.key, { status: "failed", error: cause instanceof Error ? cause.message : "เพิ่มไฟล์ในโครงการไม่สำเร็จ" });
        setNeedsReload(true);
        setError("หยุดรายการที่เหลือไว้ก่อน โหลดข้อมูลล่าสุดเพื่อยืนยันไฟล์ที่บันทึกแล้ว จากนั้นทำรายการที่เหลือต่อได้");
        setPending(false);
        return;
      }
    }
    if (failures) setError("บางไฟล์ยังไม่สำเร็จ ไฟล์ที่เพิ่มแล้วจะไม่ถูกอัปโหลดซ้ำ กดลองอีกครั้งเพื่อทำเฉพาะรายการที่เหลือ");
    setPending(false);
  }

  return <AssetDialog title={`เพิ่มไฟล์โครงการ · ${roleLabels[purpose]}`} dirty={remaining.length > 0} pending={pending} error={error} onCancel={() => onCancel(savedCount)} onSubmit={submit} cancelLabel="ปิด" discardMessage="ไฟล์ที่บันทึกแล้วจะยังอยู่ในโครงการ ไฟล์ที่อัปโหลดแล้วจะยังอยู่ในคลัง แต่รายการที่ยังไม่เสร็จในหน้าต่างนี้จะถูกทิ้ง ต้องการปิดหรือไม่?" submitLabel={remaining.length ? attempted ? "ลองอีกครั้งเฉพาะไฟล์ที่ยังไม่สำเร็จ" : "อัปโหลดและเพิ่มไฟล์" : items.length ? "เพิ่มไฟล์ครบแล้ว" : "อัปโหลดและเพิ่มไฟล์"} submitDisabled={!remaining.length || needsReload}>
    <p className="project-media-dialog-context"><strong>{roleLabels[purpose]} · เลือกได้หลายไฟล์</strong><span>ใส่คำอธิบายแยกแต่ละไฟล์ แล้วบันทึกทั้งหมดเข้าโครงการ ไฟล์เดิมจะยังอยู่</span></p>
    <div className="upload-dropzone"><div className="form-field"><label htmlFor="upload-file">เลือกไฟล์ภาพหรือ PDF</label><input id="upload-file" type="file" multiple accept={purpose === "brochure" ? "application/pdf" : ["hero", "thumbnail"].includes(purpose) ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,application/pdf"} disabled={pending || needsReload} onChange={event => {
      const files = Array.from(event.target.files ?? []);
      setItems(previous => [...previous, ...files.map(file => ({ key: nextKey.current++, file, alt: "", status: "ready" as const, error: "" }))]);
      event.target.value = "";
      setError("");
    }} /><p className="field-help">{purpose === "brochure" ? "PDF" : ["hero", "thumbnail"].includes(purpose) ? "PNG, JPEG หรือ WebP" : "PNG, JPEG, WebP หรือ PDF"} · ไม่เกิน 10 MiB ต่อไฟล์ · เลือกเพิ่มได้โดยไม่ล้างรายการเดิม<br />ภาพไม่เกิน 40 ล้านพิกเซล ไม่มีภาพเคลื่อนไหว · PDF ไม่เกิน 200 หน้า</p></div></div>
    {items.length > 0 && <p className="project-upload-summary" role="status" aria-live="polite">เพิ่มแล้ว {savedCount} จาก {items.length} ไฟล์{pending ? " · กำลังดำเนินการทีละไฟล์…" : ""}</p>}
    <div className="project-upload-queue">{items.map(item => <article key={item.key} className={`project-upload-item ${item.status === "saved" ? "saved" : ""}`} aria-label={item.file.name}>
      <UploadPreview file={item.file} /><div className="project-upload-details"><strong>{item.file.name}</strong><span className="small-text muted">{sizeLabel(item.file.size)}</span><div className="form-field"><label htmlFor={`upload-alt-${item.key}`}>คำอธิบายภาพ (ภาษาไทย) · {item.file.name}</label><textarea id={`upload-alt-${item.key}`} rows={2} maxLength={1000} value={item.alt} disabled={pending || item.status === "saved"} aria-invalid={Boolean(item.error)} aria-describedby={item.error ? `upload-error-${item.key}` : undefined} onChange={event => patchItem(item.key, { alt: event.target.value, error: "" })} /></div>{item.error && <p id={`upload-error-${item.key}`} className="field-error">{item.error}</p>}{item.note && <p className="field-help">{item.note}</p>}<p className="project-upload-status" role="status">{item.status === "saved" ? "เพิ่มในโครงการแล้ว" : item.status === "uploading" ? "กำลังอัปโหลดและตรวจสอบไฟล์…" : item.status === "binding" ? "กำลังบันทึกในโครงการ…" : item.asset ? "อัปโหลดแล้ว รอเพิ่มในโครงการ" : "รออัปโหลด"}</p>{item.status !== "saved" && <button type="button" className="button secondary" disabled={pending || needsReload} onClick={() => setItems(previous => previous.filter(row => row.key !== item.key))}>นำออกจากรายการ</button>}</div>
    </article>)}</div>
    {needsReload && <button type="button" className="button secondary" disabled={pending} onClick={() => void reload()}>โหลดข้อมูลล่าสุดเพื่อทำต่อ</button>}
    <p className="field-help">ไฟล์ใหม่จะรอตรวจสิทธิ์ก่อนเผยแพร่ ถ้าพบไฟล์ซ้ำจะใช้รายการและสถานะสิทธิ์เดิม ไฟล์ที่บันทึกสำเร็จแล้วจะยังอยู่แม้ปิดหน้าต่างนี้</p>
  </AssetDialog>;
}

function UploadDialog({ subject = "โครงการ", purpose, onCancel, onUploaded }: { subject?: string; purpose?: AssetRole; onCancel: () => void; onUploaded: (asset: Asset, reused: boolean) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function upload(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!file) { setError("เลือกไฟล์ภาพหรือ PDF ก่อนอัปโหลด"); return; }
    if (!acceptedTypes.includes(file.type)) { setError("รองรับเฉพาะไฟล์ PNG, JPEG, WebP และ PDF"); return; }
    if (purpose && !supportsPurpose({ mime_type: file.type }, purpose)) { setError(purpose === "brochure" ? "โบรชัวร์รองรับไฟล์ PDF" : "ภาพหลักและภาพย่อรองรับไฟล์ PNG, JPEG หรือ WebP"); return; }
    if (!file.size || file.size > maxFileSize) { setError("ไฟล์ต้องมีข้อมูลและมีขนาดไม่เกิน 10 MiB"); return; }
    setPending(true);
    try {
      const result = await uploadAsset(file);
      await onUploaded(result.asset, result.reused);
    } catch (error) { setError(error instanceof Error ? error.message : "อัปโหลดไฟล์ไม่สำเร็จ"); setPending(false); }
  }
  return <AssetDialog title="อัปโหลดไฟล์เข้าคลังสื่อ" dirty={Boolean(file)} pending={pending} error={error} onCancel={onCancel} onSubmit={upload} submitLabel="อัปโหลดเข้าคลัง" submitDisabled={!file}>
    {purpose && <p className="project-media-dialog-context"><strong>ขั้นตอน 2 · {roleLabels[purpose]}</strong><span>เมื่ออัปโหลดแล้ว จะไปใส่คำอธิบายและบันทึกกับโครงการต่อ</span></p>}<p className="muted small-text">ใช้เฉพาะไฟล์สำหรับทดสอบในสภาพแวดล้อมนี้ ไฟล์ใหม่จะรอตรวจสิทธิ์และยังไม่ผูกกับ{subject}</p><div className="upload-dropzone"><AssetIcon /><div className="form-field"><label htmlFor="upload-file">เลือกไฟล์ภาพหรือ PDF</label><input id="upload-file" type="file" accept={purpose === "brochure" ? "application/pdf" : purpose && ["hero", "thumbnail"].includes(purpose) ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,application/pdf"} disabled={pending} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(""); }} /><p className="field-help">{purpose === "brochure" ? "PDF" : purpose && ["hero", "thumbnail"].includes(purpose) ? "PNG, JPEG หรือ WebP" : "PNG, JPEG, WebP หรือ PDF"} · ไม่เกิน 10 MiB ต่อไฟล์<br />ภาพไม่เกิน 40 ล้านพิกเซล ไม่มีภาพเคลื่อนไหว · PDF ไม่เกิน 200 หน้า</p></div></div>{file && <p className="upload-selection">{file.name} · {sizeLabel(file.size)}</p>}{pending && <p className="upload-progress" role="status"><span className="spinner" />กำลังอัปโหลดและตรวจสอบไฟล์…</p>}<p className="field-help">ถ้าพบไฟล์ซ้ำ ระบบจะใช้รายการและสถานะสิทธิ์เดิม ไม่อนุมัติสิทธิ์ให้อัตโนมัติ</p>
  </AssetDialog>;
}

function BindDialog<T extends AssetOwner>({ asset, project, model, initialRole, onCancel, onSaved, onReload }: { asset: Asset; project: T; model?: ModelOwner; initialRole?: AssetRole; onCancel: () => void; onSaved: (project: T) => void; onReload: () => Promise<void> }) {
  const [assetRole, setAssetRole] = useState<AssetRole | "">(initialRole ?? "");
  const [alt, setAlt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const isBrand = Boolean(project.public_brand_id);
  const subject = model ? "แบบที่อยู่อาศัย" : isBrand ? "แบรนด์" : "โครงการ";
  const options: AssetRole[] = model ? (asset.mime_type === "application/pdf" ? ["floor_plan", "structural_plan"] : ["model_image", "floor_plan", "structural_plan"]) : isBrand ? ["logo_primary", "logo_white", "logo_mono", "favicon"] : asset.mime_type === "application/pdf" ? ["master_plan", "floor_plan", "brochure"] : ["hero", "thumbnail", "master_plan", "floor_plan"];
  const replacing = Boolean(isBrand && assetRole && project.assets?.some(binding => !binding.public_model_id && binding.asset_role === assetRole));
  async function bind(event: FormEvent) {
    event.preventDefault(); setError(""); setConflict(false);
    if (!assetRole || !options.includes(assetRole)) { setError("เลือกบทบาทที่ตรงกับชนิดไฟล์"); return; }
    if (!alt.trim()) { setError("กรอกคำอธิบายภาษาไทยก่อนผูกไฟล์"); return; }
    setPending(true);
    try { onSaved(await request<T>(`v1/admin/${isBrand ? "brands" : "projects"}/${project.public_brand_id || project.public_project_id}${model ? `/models/${encodeURIComponent(model.public_model_id)}` : ""}/assets`, "POST", { asset_id: asset.id, asset_role: assetRole, alt_text: { th: alt.trim() }, updated_at: project.updated_at })); }
    catch (error) { setError(error instanceof Error ? error.message : "ผูกไฟล์ไม่สำเร็จ"); setConflict((error as { status?: number }).status === 409); setPending(false); }
  }
  return <AssetDialog title={`เลือกใช้ไฟล์กับ${subject}`} dirty={Boolean(assetRole !== (initialRole ?? "") || alt)} pending={pending} error={error} conflict={conflict} onCancel={onCancel} onSubmit={bind} onReload={onReload} submitLabel={initialRole ? `บันทึกไฟล์กับ${subject}` : `ผูกไฟล์กับ${subject}`}>
    {initialRole && <p className="project-media-dialog-context"><strong>ขั้นตอน 3 · ใส่คำอธิบายและบันทึก</strong><span>ตรวจประเภทไฟล์ แล้วอธิบายว่าภาพหรือเอกสารนี้แสดงอะไร</span></p>}
    <p className="asset-dialog-filename">{asset.original_filename}</p><RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} /><p className="field-help">ผูกไฟล์กับข้อมูลร่างได้ก่อนอนุมัติสิทธิ์ แต่ยังเผยแพร่ไม่ได้จนกว่าสิทธิ์พร้อมใช้งาน</p><div className="form-field"><label htmlFor="asset-role">บทบาทของไฟล์</label><select id="asset-role" value={assetRole} disabled={pending} onChange={event => setAssetRole(event.target.value as AssetRole)}><option value="">เลือกบทบาท</option>{options.map(value => <option key={value} value={value}>{roleLabels[value]}</option>)}</select></div>{replacing && <p className="inline-warning">ไฟล์นี้จะแทนที่{roleLabels[assetRole as AssetRole]}เดิมในข้อมูลร่าง ไฟล์เดิมยังอยู่ในคลังสื่อ และข้อมูลที่เผยแพร่ยังไม่เปลี่ยนจนกว่าจะเผยแพร่อีกครั้ง</p>}<div className="form-field"><label htmlFor="asset-alt">คำอธิบายภาพ (ภาษาไทย)</label><textarea id="asset-alt" rows={3} value={alt} disabled={pending} maxLength={1000} onChange={event => setAlt(event.target.value)} /><p className="field-help">อธิบายสิ่งที่ภาพหรือเอกสารแสดง เพื่อให้เข้าใจเนื้อหาได้โดยไม่ต้องเห็นภาพ</p></div>
  </AssetDialog>;
}

function bangkokInput(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function RightsDialog({ asset, onCancel, onSaved, onReload }: { asset: Asset; onCancel: () => void; onSaved: (asset: Asset) => Promise<void>; onReload: () => Promise<void> }) {
  const [decision, setDecision] = useState<"approved" | "revoked">(asset.rights_status === "revoked" ? "revoked" : "approved");
  const [notes, setNotes] = useState(asset.rights_notes ?? "");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState(bangkokInput(asset.effective_from));
  const [to, setTo] = useState(bangkokInput(asset.effective_to));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const dirty = Boolean(reason || notes !== (asset.rights_notes ?? "") || from !== bangkokInput(asset.effective_from) || to !== bangkokInput(asset.effective_to) || decision !== (asset.rights_status === "revoked" ? "revoked" : "approved"));
  async function review(event: FormEvent) {
    event.preventDefault(); setError(""); setConflict(false);
    if (!notes.trim() || !reason.trim()) { setError("ระบุหลักฐานหรือเงื่อนไขสิทธิ์ และเหตุผลในการตรวจสิทธิ์ให้ครบ"); return; }
    const fromDate = from ? new Date(`${from}:00+07:00`) : null;
    const toDate = to ? new Date(`${to}:00+07:00`) : null;
    if (fromDate && !Number.isFinite(fromDate.getTime()) || toDate && !Number.isFinite(toDate.getTime())) { setError("ระบุวันที่และเวลาให้ถูกต้อง"); return; }
    if (fromDate && toDate && toDate <= fromDate) { setError("วันสิ้นสุดสิทธิ์ต้องอยู่หลังวันเริ่มใช้สิทธิ์"); return; }
    setPending(true);
    try {
      const updated = await request<Asset>(`v1/admin/assets/${asset.id}/review`, "POST", { updated_at: asset.updated_at, decision, rights_notes: notes.trim(), change_reason: reason.trim(), effective_from: from === bangkokInput(asset.effective_from) ? asset.effective_from : fromDate?.toISOString() ?? null, effective_to: to === bangkokInput(asset.effective_to) ? asset.effective_to : toDate?.toISOString() ?? null });
      await onSaved(updated);
    } catch (error) { setError(error instanceof Error ? error.message : "บันทึกสิทธิ์ไม่สำเร็จ"); setConflict((error as { status?: number }).status === 409); setPending(false); }
  }
  return <AssetDialog title="ตรวจสอบสิทธิ์ไฟล์" dirty={dirty} pending={pending} error={error} conflict={conflict} onCancel={onCancel} onSubmit={review} onReload={onReload} submitLabel={decision === "revoked" ? "ยืนยันถอนสิทธิ์" : "ยืนยันอนุมัติสิทธิ์"} danger={decision === "revoked"}>
    <p className="asset-dialog-filename">{asset.original_filename}</p><RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} /><fieldset className="review-options" disabled={pending}><legend>ผลการตรวจสิทธิ์</legend><label><input type="radio" name="rights-decision" checked={decision === "approved"} onChange={() => setDecision("approved")} />อนุมัติสิทธิ์ใช้งาน</label><label><input type="radio" name="rights-decision" checked={decision === "revoked"} onChange={() => setDecision("revoked")} />ถอนสิทธิ์ใช้งาน</label></fieldset>{decision === "revoked" && <p className="inline-warning" role="status">การถอนสิทธิ์มีผลกับทุกแบรนด์และโครงการที่ใช้ไฟล์นี้ ข้อมูลที่เผยแพร่อยู่อาจหยุดแสดงผ่าน API ทันที หากต้องการแก้เฉพาะรายการเดียวให้นำไฟล์ออกจากข้อมูลร่างของรายการนั้น</p>}<div className="form-field"><label htmlFor="rights-notes">หลักฐานและเงื่อนไขสิทธิ์</label><textarea id="rights-notes" value={notes} disabled={pending} onChange={event => setNotes(event.target.value)} rows={3} maxLength={4000} /><p className="field-help">ระบุเจ้าของสิทธิ์ การอนุญาต หรือเหตุผลที่ไม่มีสิทธิ์ใช้ไฟล์นี้</p></div><div className="field-grid"><div className="form-field"><label htmlFor="rights-from">เริ่มใช้สิทธิ์ (เวลาไทย)</label><input id="rights-from" type="datetime-local" value={from} disabled={pending} onChange={event => setFrom(event.target.value)} /></div><div className="form-field"><label htmlFor="rights-to">สิ้นสุดสิทธิ์ (เวลาไทย)</label><input id="rights-to" type="datetime-local" value={to} disabled={pending} onChange={event => setTo(event.target.value)} /></div></div><p className="field-help">วันที่ใช้ปี ค.ศ. และเวลา Asia/Bangkok · เว้นว่างได้เมื่อไม่มีข้อมูลช่วงสิทธิ์ การไม่ระบุวันสิ้นสุดไม่รับรองสิทธิ์ตลอดไป</p><div className="form-field"><label htmlFor="rights-reason">เหตุผลในการตรวจสิทธิ์</label><textarea id="rights-reason" value={reason} disabled={pending} onChange={event => setReason(event.target.value)} rows={2} maxLength={1000} /></div>
  </AssetDialog>;
}

function RemoveDialog<T extends AssetOwner>({ binding, project, model, onCancel, onSaved, onReload }: { binding: AssetBinding; project: T; model?: ModelOwner; onCancel: () => void; onSaved: (project: T) => void; onReload: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  async function remove(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(""); setConflict(false);
    try { onSaved(await request<T>(`v1/admin/${project.public_brand_id ? "brands" : "projects"}/${project.public_brand_id || project.public_project_id}${model ? `/models/${encodeURIComponent(model.public_model_id)}` : ""}/assets/${binding.binding_id}/remove`, "POST", { updated_at: project.updated_at })); }
    catch (error) { setError(error instanceof Error ? error.message : "นำไฟล์ออกไม่สำเร็จ"); setConflict((error as { status?: number }).status === 409); setPending(false); }
  }
  const subject = model ? "แบบที่อยู่อาศัย" : project.public_brand_id ? "แบรนด์" : "โครงการ";
  return <AssetDialog title={`นำไฟล์ออกจาก${subject}`} dirty={false} pending={pending} error={error} conflict={conflict} onCancel={onCancel} onSubmit={remove} onReload={onReload} submitLabel={`ยืนยันนำออกจาก${subject}`} danger><p className="asset-dialog-filename">{binding.original_filename}</p><p>นำ{roleLabels[binding.asset_role]}ออกจากข้อมูลร่างของ{subject}นี้เท่านั้น ไฟล์ยังอยู่ในคลังสื่อและยังใช้กับรายการอื่นได้</p><p className="inline-warning">การเปลี่ยนข้อมูลร่างไม่เปลี่ยนเวอร์ชันที่เผยแพร่อยู่ ต้องเลือกไฟล์ที่จำเป็นให้ครบก่อนเผยแพร่ครั้งใหม่</p></AssetDialog>;
}
