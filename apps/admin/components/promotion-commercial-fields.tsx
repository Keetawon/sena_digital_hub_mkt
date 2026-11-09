"use client";
import { useEffect, useState } from "react";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { workspaceName, workspaceText as text } from "@/lib/unified-workspace";
import { ContentLabel, FieldInfo, TranslationReviewPanel, errorMessage, useFieldCatalog, type Locales, type Translation } from "./content-common";

export type PromotionScope = { type: "project" | "brand" | "commercial_type"; id: string };
export type CommercialPromotion = { id: string; project_id?: string | null; owning_brand_id?: string | null; public_project_id: string; excluded_project_ids?: string[]; scope?: { scope_hash: string; count: number; items: { id: string; public_id: string; label: Locales }[] }; synthetic?: boolean; draft_revision: number; audience?: string; targets?: PromotionScope[]; booking_from?: string | null; booking_to?: string | null; transfer_from?: string | null; transfer_to?: string | null; translations?: Translation[] };
type Reference = { id: string; public_id: string; label: Locales; project_id?: string };
const audiences: Record<string, string> = { general: "ลูกค้าทั่วไป", investor: "ผู้ลงทุน", livnex: "LivNex" };
const windows = { booking_from: "เริ่มจอง", booking_to: "สิ้นสุดจอง", transfer_from: "เริ่มโอน", transfer_to: "สิ้นสุดโอน" };

export function PromotionCommercialFields<T extends CommercialPromotion>({ row, onSaved, onDirty, disabled = false, excludeProject }: { disabled?: boolean; excludeProject?: string | null; row: T; onSaved: (row: T) => void; onDirty: (dirty: boolean) => void }) {
  const permissions = useHubPermissions(), canEdit = permissions.can("promotions", "edit") && !disabled, { catalog } = useFieldCatalog();
  const pendingExclusion = Boolean(canEdit && excludeProject && !row.excluded_project_ids?.includes(excludeProject));
  const [references, setReferences] = useState<Record<string, Reference[]>>({}), [editing, setEditing] = useState(pendingExclusion);
  const [excluded, setExcluded] = useState([...new Set([...(row.excluded_project_ids ?? []), ...(excludeProject ? [excludeProject] : [])])]);
  const [resolved, setResolved] = useState(row.scope), [scopeError, setScopeError] = useState("");
  const [bannerProject, setBannerProject] = useState(row.public_project_id ?? "");
  const [translationEditing, setTranslationEditing] = useState(false);
  const [targets, setTargets] = useState(row.targets ?? []), [audience, setAudience] = useState(row.audience ?? "general");
  const [dates, setDates] = useState(Object.fromEntries(Object.keys(windows).map(key => [key, row[key as keyof typeof windows] ?? ""])));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const permissionKey = JSON.stringify(permissions.capabilities.tabs);
  useEffect(() => {
    if (!editing) { setResolved(row.scope); return; }
    let active = true; setResolved(undefined); setScopeError("");
    request<NonNullable<CommercialPromotion["scope"]>>("v1/admin/promotions/resolve", "POST", { project_id: row.project_id ?? null, owning_brand_id: row.owning_brand_id ?? null, targets, excluded_project_ids: excluded })
      .then(value => { if (active) setResolved(value); }).catch(error => { if (active) setScopeError(errorMessage(error)); });
    return () => { active = false; };
  }, [editing, targets, excluded, row.scope, row.project_id, row.owning_brand_id, permissionKey]);
  useEffect(() => { onDirty(editing || translationEditing); return () => onDirty(false); }, [editing, translationEditing, onDirty]);
  useEffect(() => { let active = true; setReferences({}); request<Record<string, Reference[]>>("v1/admin/promotions/references").then(value => { if (active) setReferences(value); }).catch(error => { if (active) setError(errorMessage(error)); }); return () => { active = false; }; }, [permissionKey]);
  async function reload() { onSaved(await request<T>(`v1/admin/promotions/${row.id}`)); }
  async function save() {
    if (busy || !canEdit) return; setBusy(true); setError("");
    try { const value = await request<T>(`v1/admin/promotions/${row.id}`, "PATCH", { expected_revision: row.draft_revision, audience, targets, excluded_project_ids: excluded, ...Object.fromEntries(Object.entries(dates).map(([key, value]) => [key, value || null])) }); setEditing(false); onSaved(value); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <section className="registry-panel"><h3>กลุ่มเป้าหมายและขอบเขต</h3><p>{row.synthetic === false ? "โปรโมชันจริง · ตรวจ DATA และ LEGAL ของรุ่นนี้ก่อนเผยแพร่" : "ข้อมูลสังเคราะห์สำหรับทดสอบ"}</p>
    {error && <p role="alert" className="notice error">{error} ข้อมูลที่กรอกยังอยู่</p>}
    <section aria-label={text.promotion_resolved_projects}><h4>{text.promotion_resolved_projects} ({resolved?.count ?? 0})</h4>{scopeError && <p role="alert">{scopeError}</p>}<ul>{resolved?.items.map(project => <li key={project.id}>{workspaceName(project.label)} · {project.public_id}</li>)}</ul></section>
    {editing && <p className="notice">{text.promotion_scope_pending}</p>}
    {editing ? <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || !canEdit}>
      <div className="content-input"><ContentLabel htmlFor="promotion-audience" field={catalog?.items.find(field => field.field_key === "promotion.audience")}>กลุ่มเป้าหมาย</ContentLabel><select id="promotion-audience" value={audience} onChange={event => setAudience(event.target.value)}>{Object.entries(audiences).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <p>{text.promotion_draft_scope}</p>
      <fieldset className="content-checks"><legend>{text.promotion_excluded_projects}</legend>{references.projects?.map(project => <label key={project.id}><input type="checkbox" checked={excluded.includes(project.id)} onChange={event => setExcluded(value => event.target.checked ? [...value, project.id] : value.filter(id => id !== project.id))} />{workspaceName(project.label)}</label>)}</fieldset>
      <FieldInfo field={catalog?.items.find(field => field.field_key === "promotion.targets")} />
      {([['project', 'projects', 'โครงการเพิ่มเติม'], ['brand', 'brands', 'แบรนด์'], ['commercial_type', 'commercial_types', 'แบบที่อยู่อาศัย']] as const).map(([type, source, title]) => <fieldset className="content-checks" key={type}><legend>{title}</legend>{!references[source]?.length && <p>ไม่มีรายการที่มีสิทธิ์ดู</p>}{references[source]?.map(ref => <label key={ref.id}><input type="checkbox" checked={targets.some(t => t.type === type && t.id === ref.id)} onChange={event => setTargets(prior => event.target.checked ? [...prior, { type, id: ref.id }] : prior.filter(t => t.type !== type || t.id !== ref.id))} />{ref.label.th ?? ref.public_id}{ref.project_id ? ` · ${ref.project_id}` : ""}</label>)}</fieldset>)}
      <div className="content-two-columns">{Object.entries(windows).map(([key, label]) => <div className="content-input" key={key}><ContentLabel htmlFor={`promotion-${key}`} field={catalog?.items.find(field => field.field_key === `promotion.${key}`)}>{label}</ContentLabel><input id={`promotion-${key}`} type="date" value={dates[key]} onChange={event => setDates(previous => ({ ...previous, [key]: event.target.value }))} /></div>)}</div>
      <p className="field-help">ระบุวันเริ่มและสิ้นสุดเป็นคู่ ค่าว่างหมายถึงยังไม่ระบุช่วงเวลานี้</p>
      <div className="content-actions"><button type="button" className="button secondary" onClick={() => { setEditing(false); }}>ยกเลิก</button><button className="button primary">บันทึกขอบเขตและช่วงเวลา</button></div>
    </fieldset></form> : <><p>{audiences[row.audience ?? "general"]} · {text.promotion_owner}: {row.owning_brand_id ? text.brand : text.project} · {text.promotion_resolved_projects} {row.scope?.count ?? 0}</p>{Boolean(row.excluded_project_ids?.length) && <p>{text.promotion_excluded_projects}: {row.excluded_project_ids?.map(id => workspaceName(references.projects?.find(project => project.id === id)?.label)).join(", ")}</p>}<ul>{row.targets?.map(target => { const ref = Object.values(references).flat().find(item => item.id === target.id); return <li key={`${target.type}-${target.id}`}>{ref?.label.th ?? "รายการในขอบเขตที่บันทึกไว้"}</li>; })}</ul><dl className="registry-detail-list">{Object.entries(windows).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{row[key as keyof typeof windows] ?? "ยังไม่ระบุ"}</dd></div>)}</dl>{canEdit && <button className="button secondary" onClick={() => { setTargets(row.targets ?? []); setExcluded(row.excluded_project_ids ?? []); setAudience(row.audience ?? "general"); setDates(Object.fromEntries(Object.keys(windows).map(key => [key, row[key as keyof typeof windows] ?? ""]))); setEditing(true); }}>แก้ไขขอบเขตและช่วงเวลา</button>}</>}
    {permissions.can("projects", "edit") && canEdit && !editing && <>{!row.public_project_id && <label className="content-input">{text.project}<select value={bannerProject} onChange={event => setBannerProject(event.target.value)}><option value="">{text.project}</option>{row.scope?.items.map(project => <option key={project.id} value={project.public_id}>{workspaceName(project.label)}</option>)}</select></label>}{bannerProject && <p><a href={`/media?project=${encodeURIComponent(bannerProject)}&tab=upload&target_type=promotion&target_key=${row.id}&category=promotion_ad&usage=banner`}>อัปโหลดหรือเลือกแบนเนอร์โปรโมชัน</a></p>}</>}
    <p className="field-help">แบนเนอร์ต้องผ่านสิทธิ์ภาพและยืนยันข้อมูลภาพ การเปลี่ยนแบนเนอร์ทำให้ต้องตรวจ DATA และ LEGAL ของรุ่นใหม่ ช่วงแสดงภาพไม่เกินวันสิ้นสุดโปรโมชัน</p>
    {!editing && catalog && <TranslationReviewPanel items={row.translations ?? []} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setTranslationEditing} />}
  </section>;
}
