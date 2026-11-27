"use client";
import { useEffect, useState } from "react";
import { contentScopeText } from "@/lib/content-scope-text";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { workspaceName, workspaceText as text } from "@/lib/unified-workspace";
import { ContentLabel, FieldInfo, TranslationReviewPanel, errorMessage, useFieldCatalog, type Locales, type Translation } from "./content-common";
import { promotionAudiences as audiences, promotionTiers, promotionWindows as windows, tierOf, type BenefitItem, type PromotionReference, type PromotionReferences, type PromotionTier } from "./promotion-types";

export type PromotionScope = { type: "project" | "brand" | "project_group" | "commercial_type"; id: string };
export type CommercialPromotion = { promotion_tier?: PromotionTier; owning_project_group_id?: string | null; programme_key?: string | null; all_active_projects?: boolean; campaign_name?: Locales; campaign_slug?: string | null; ads_campaign_code?: string | null; highlight_badge?: Locales; unit_scope_note?: Locales; benefit_items?: BenefitItem[]; banners?: { asset_id: string; caption?: Locales }[]; id: string; project_id?: string | null; owning_brand_id?: string | null; public_project_id: string | null; applicability_complete?: boolean; excluded_project_ids?: string[]; applies_via?: { scope_level: string }; scope?: { applicability_complete?: boolean; scope_hash: string; count: number; items: { id: string; public_id: string; label: Locales }[] }; synthetic?: boolean; draft_revision: number; audience?: string; targets?: PromotionScope[]; booking_from?: string | null; booking_to?: string | null; transfer_from?: string | null; transfer_to?: string | null; translations?: Translation[] };

export function PromotionCommercialFields<T extends CommercialPromotion>({ row, initialReferences, onSaved, onDirty, disabled = false, excludeProject, integrated = false }: { integrated?: boolean; disabled?: boolean; excludeProject?: string | null; row: T; initialReferences?: PromotionReferences; onSaved: (row: T) => void; onDirty: (dirty: boolean) => void }) {
  const permissions = useHubPermissions(), canEdit = permissions.can("promotions", "edit") && !disabled, { catalog } = useFieldCatalog();
  const pendingExclusion = Boolean(canEdit && excludeProject && !row.excluded_project_ids?.includes(excludeProject));
  const [fetchedReferences, setFetchedReferences] = useState<PromotionReferences>({});
  const references = initialReferences ?? fetchedReferences;
  const [editing, setEditing] = useState(pendingExclusion);
  const [excluded, setExcluded] = useState([...new Set([...(row.excluded_project_ids ?? []), ...(excludeProject ? [excludeProject] : [])])]);
  const [resolved, setResolved] = useState(row.scope), [scopeError, setScopeError] = useState("");
  const [bannerProject, setBannerProject] = useState(row.public_project_id ?? "");
  const [translationEditing, setTranslationEditing] = useState(false);
  const [targets, setTargets] = useState(row.targets ?? []), [audience, setAudience] = useState(row.audience ?? "general");
  const [dates, setDates] = useState(Object.fromEntries(Object.keys(windows).map(key => [key, row[key as keyof typeof windows] ?? ""])));
  const [scopeQuery, setScopeQuery] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const permissionKey = JSON.stringify(permissions.capabilities.tabs);
  useEffect(() => {
    if (!editing) { setResolved(row.scope); return; }
    let active = true; setResolved(undefined); setScopeError("");
    request<NonNullable<CommercialPromotion["scope"]>>("v1/admin/promotions/resolve", "POST", { promotion_id: row.id, expected_revision: row.draft_revision, targets, excluded_project_ids: excluded })
      .then(value => { if (active) setResolved(value); }).catch(error => { if (active) setScopeError(errorMessage(error)); });
    return () => { active = false; };
  }, [editing, targets, excluded, row.scope, row.id, row.draft_revision, permissionKey]);
  useEffect(() => { onDirty(editing || translationEditing); return () => onDirty(false); }, [editing, translationEditing, onDirty]);
  useEffect(() => {
    if (integrated || initialReferences) return;
    let active = true;
    setFetchedReferences({});
    request<PromotionReferences>("v1/admin/promotions/references")
      .then(value => { if (active) setFetchedReferences(value); })
      .catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [integrated, initialReferences, permissionKey]);
  async function reload() { onSaved(await request<T>(`v1/admin/promotions/${row.id}`)); }
  async function save() {
    if (busy || !canEdit) return; setBusy(true); setError("");
    try { const value = await request<T>(`v1/admin/promotions/${row.id}`, "PATCH", { expected_revision: row.draft_revision, audience, targets, excluded_project_ids: excluded, ...Object.fromEntries(Object.entries(dates).map(([key, value]) => [key, value || null])) }); setEditing(false); onSaved(value); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const normalizedQuery = scopeQuery.trim().toLocaleLowerCase("th");
  const filterItems = (items: PromotionReference[] | undefined, checkedIds: string[]) => (items ?? []).filter(item => {
    if (!normalizedQuery || checkedIds.includes(item.id)) return true;
    return `${item.label.th ?? ""} ${item.label.en ?? ""} ${item.public_id ?? ""} ${item.project_id ?? ""}`.toLocaleLowerCase("th").includes(normalizedQuery);
  });

  return <section className="registry-panel promo-section-card">
    {!integrated && <><div className="promo-section-head">
      <h3>กลุ่มเป้าหมาย ขอบเขตโครงการ และแบนเนอร์</h3>
      {canEdit && !editing && <button type="button" className="button secondary" onClick={() => { setTargets(row.targets ?? []); setExcluded(row.excluded_project_ids ?? []); setAudience(row.audience ?? "general"); setDates(Object.fromEntries(Object.keys(windows).map(key => [key, row[key as keyof typeof windows] ?? ""]))); setScopeQuery(""); setEditing(true); }}>แก้ไขขอบเขตและช่วงเวลา</button>}
    </div>
    <p className="content-muted">{row.synthetic === false ? "โปรโมชันจริง · ตรวจ DATA และ LEGAL ของรุ่นนี้ก่อนเผยแพร่" : "ข้อมูลสังเคราะห์สำหรับทดสอบ"}</p>
    {disabled && <p className="promo-lock-hint" role="note">มีข้อความร่างด้านบนที่ยังไม่ได้บันทึก กรุณากดบันทึกร่างด้านบนก่อนแก้ไขขอบเขตและช่วงเวลา</p>}
    {error && <p role="alert" className="notice error">{error} ข้อมูลที่กรอกยังอยู่</p>}
    <section className="promo-resolved-box" aria-label={text.promotion_resolved_projects}>
      <h4>{text.promotion_resolved_projects} ({resolved?.count ?? 0})</h4>
      {scopeError && <p role="alert">{scopeError}</p>}
      <ul className="promo-resolved-pills">{resolved?.items.map(project => <li key={project.id}>{workspaceName(project.label)}</li>)}</ul>
    </section>
    {(row.applicability_complete === false || resolved?.applicability_complete === false) && <p className="notice">{contentScopeText.scope_references_partial}</p>}
    {editing && <p className="notice">{text.promotion_scope_pending}</p>}
    {editing ? <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy || !canEdit}>
      <div className="content-grid" style={{ marginTop: 12 }}>
        <div className="content-input"><ContentLabel htmlFor="promotion-audience" field={catalog?.items.find(field => field.field_key === "promotion.audience")}>กลุ่มเป้าหมาย</ContentLabel><select id="promotion-audience" className="registry-input" value={audience} onChange={event => setAudience(event.target.value)}>{Object.entries(audiences).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        <div className="content-input promo-checks-filter"><label htmlFor="promotion-scope-search">ค้นหารายชื่อโครงการ / แบรนด์ / แบบห้อง</label><input id="promotion-scope-search" type="search" className="registry-input" placeholder="พิมพ์ชื่อโครงการหรือแบรนด์เพื่อกรองตัวเลือก" value={scopeQuery} onChange={event => setScopeQuery(event.target.value)} /></div>
      </div>
      <p className="content-muted">{text.promotion_draft_scope}</p>
      <fieldset className="content-checks promo-checks-scroll"><legend>{text.promotion_excluded_projects}</legend>{filterItems(references.projects, excluded).map(project => <label key={project.id}><input type="checkbox" checked={excluded.includes(project.id)} onChange={event => setExcluded(value => event.target.checked ? [...value, project.id] : value.filter(id => id !== project.id))} />{workspaceName(project.label)}</label>)}</fieldset>
      <div style={{ margin: "12px 0 6px", display: "flex", alignItems: "center", gap: 6 }}><strong>ขอบเขตที่ต้องการแสดงเพิ่มเติม</strong><FieldInfo field={catalog?.items.find(field => field.field_key === "promotion.targets")} /></div>
      {([['project', 'projects', 'โครงการเพิ่มเติม'], ['brand', 'brands', 'แบรนด์'], ['commercial_type', 'commercial_types', 'แบบที่อยู่อาศัย']] as const).map(([type, source, title]) => {
        const checkedIds = targets.filter(t => t.type === type).map(t => t.id);
        const shown = filterItems(references[source], checkedIds);
        return <fieldset className="content-checks promo-checks-scroll" key={type} style={{ marginTop: 10 }}><legend>{title}</legend>{!references[source]?.length && <p className="content-muted">ไม่มีรายการที่มีสิทธิ์ดู</p>}{shown.map(ref => <label key={ref.id}><input type="checkbox" checked={targets.some(t => t.type === type && t.id === ref.id)} onChange={event => setTargets(prior => event.target.checked ? [...prior, { type, id: ref.id }] : prior.filter(t => t.type !== type || t.id !== ref.id))} />{ref.label.th ?? ref.public_id ?? ref.id}{ref.project_id ? ` · ${ref.project_id}` : ""}</label>)}</fieldset>;
      })}
      <div className="content-two-columns" style={{ marginTop: 14 }}>{Object.entries(windows).map(([key, label]) => <div className="content-input" key={key}><ContentLabel htmlFor={`promotion-${key}`} field={catalog?.items.find(field => field.field_key === `promotion.${key}`)}>{label}</ContentLabel><input id={`promotion-${key}`} className="registry-input" type="date" value={dates[key]} onChange={event => setDates(previous => ({ ...previous, [key]: event.target.value }))} /></div>)}</div>
      <p className="field-help">ระบุวันเริ่มและสิ้นสุดเป็นคู่ ค่าว่างหมายถึงยังไม่ระบุช่วงเวลานี้</p>
      <div className="content-actions"><button type="button" className="button secondary" onClick={() => { setEditing(false); }}>ยกเลิก</button><button type="submit" className="button primary">บันทึกขอบเขตและช่วงเวลา</button></div>
    </fieldset></form> : <>
      <p style={{ marginTop: 12 }}><strong>กลุ่มเป้าหมาย:</strong> {audiences[row.audience ?? "general"]} · <strong>{text.promotion_owner}:</strong> {promotionTiers[tierOf(row)]} · <strong>{text.promotion_resolved_projects}:</strong> {row.scope?.count ?? 0}</p>
      {Boolean(row.excluded_project_ids?.length) && <p>{text.promotion_excluded_projects}: {row.excluded_project_ids?.map(id => workspaceName(references.projects?.find(project => project.id === id)?.label)).join(", ")}</p>}
      {Boolean(row.targets?.length) && <ul className="promo-resolved-pills">{row.targets?.map(target => { const ref = Object.values(references).flat().find(item => item?.id === target.id); return <li key={`${target.type}-${target.id}`}>{ref?.label.th ?? "รายการในขอบเขตที่บันทึกไว้"}</li>; })}</ul>}
      <dl className="registry-detail-list" style={{ marginTop: 12 }}>{Object.entries(windows).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{row[key as keyof typeof windows] || "ยังไม่ระบุ"}</dd></div>)}</dl>
    </>}
    </>}
    {permissions.can("projects", "edit") && canEdit && !editing && <div className="promo-banner-box">
      <strong>ภาพแบนเนอร์โปรโมชัน</strong>
      {!row.public_project_id && <label className="content-input" style={{ marginTop: 8 }}>{text.project}<select className="registry-input" value={bannerProject} onChange={event => setBannerProject(event.target.value)}><option value="">{text.project}</option>{row.scope?.items.map(project => <option key={project.id} value={project.public_id}>{workspaceName(project.label)}</option>)}</select></label>}
      {bannerProject && <p style={{ margin: "10px 0 0" }}><a className="button secondary" href={`/media?project=${encodeURIComponent(bannerProject)}&tab=upload&target_type=promotion&target_key=${row.id}&category=promotion_ad&usage=banner`}>อัปโหลดหรือเลือกแบนเนอร์โปรโมชัน</a></p>}
      <p className="field-help" style={{ marginBottom: 0 }}>แบนเนอร์ต้องผ่านสิทธิ์ภาพและยืนยันข้อมูลภาพ การเปลี่ยนแบนเนอร์ทำให้ต้องตรวจ DATA และ LEGAL ของรุ่นใหม่ ช่วงแสดงภาพไม่เกินวันสิ้นสุดโปรโมชัน</p>
    </div>}
    {!editing && catalog && <TranslationReviewPanel items={row.translations ?? []} fields={catalog.items} canEdit={canEdit} onChanged={reload} onEditingChange={setTranslationEditing} />}
  </section>;
}
