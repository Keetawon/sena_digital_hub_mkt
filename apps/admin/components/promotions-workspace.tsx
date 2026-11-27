"use client";
import { PromotionEditor as PromotionDraft } from "./promotion-editor";
import { benefitText, promotionTextFields, promotionTiers, tierOf, type PromotionTier, type PromotionReferences } from "./promotion-types";
import { PromotionCommercialFields, type CommercialPromotion } from "./promotion-commercial-fields";
import { useHubPermissions, ActorName } from "./accounts";
import { workspaceApi, workspaceHref, workspaceName, workspaceText as text } from "@/lib/unified-workspace";
import type { PromotionSuggestion } from "./contextual-promotions";
import { capabilityKey } from "@/lib/hub-permissions";
import { workflowText } from "@/lib/content-workflow";

import { useEffect, useMemo, useState } from "react";
import type { LocalRole } from "@/lib/local-session";
import { request } from "./hub-request";
import { DemoFields } from "./demo-fields";
import { LoadingRows, RegistryRowSummary, DetailDialog, StatusText } from "./registry-motion";
import { dateTime, ErrorSummary, Field, Ready, thai, useContentLocation, type Localized, type Readiness } from "./content-operations-shared";
import "./promotions-workspace.css";

type Review = { review_type: "DATA" | "LEGAL"; review_revision: number; decision: "APPROVED" | "REVOKED"; evidence: string; reviewed_at: string; reviewed_by: string; resolved_project_ids?: string[] | null };
export type Promotion = CommercialPromotion & {
  can_edit?: boolean;
  scope_target_types?: string[];
  status_group?: "live" | "draft" | "paused";
  id: string; project_id: string | null; public_project_id: string | null; owning_brand_id?: string | null; public_owning_brand_id?: string | null; code: string;
  title: Localized; summary: Localized; conditions_public: Localized; legal_terms: Localized; disclaimer: Localized;
  benefit_type: string; benefit_value: string | null; benefit_unit: string | null; stackable: boolean; priority: number;
  starts_at: string; ends_at: string; source_offer_key: string | null; draft_revision: number; updated_at: string;
  published_version_id: string | null; publication_available?: boolean; demo_fields?: string[]; reviews: Review[]; readiness?: Readiness;
  published: { id: string; version_no: number; payload: Promotion; published_at: string } | null;
  versions: { id: string; version_no: number; published_at: string }[];
};
export type Brand = { id: string; public_id?: string; label: Localized };
export type SuggestionInput = { kind: "project" | "brand"; ref: string; phase: string | null; candidate_id: string; source: "website" | "km"; text: PromotionSuggestion["text"] };
export type Project = { id: string; public_project_id: string; public_name?: Localized; source_name?: string };
type StatusFilter = "all" | "live" | "draft" | "paused";

const base = "v1/admin/promotions";
const typeLabel = (value: string) => value === "DATA" ? "ข้อมูล" : "ข้อกฎหมาย";
const publicationLabel = (row: Promotion) => !row.published_version_id ? "ร่างยังไม่เผยแพร่" : row.publication_available === true ? "เผยแพร่และแสดงได้" : row.publication_available === false ? "มีฉบับเผยแพร่ · งดแสดงขณะนี้" : "มีฉบับเผยแพร่ · ยังไม่ได้ตรวจสิทธิ์แสดง";

function statusTone(row: Promotion): "live" | "draft" | "paused" {
  if (row.status_group) return row.status_group;
  if (!row.published_version_id) return row.versions?.length || new Date(row.ends_at).getTime() <= Date.now() ? "paused" : "draft";
  if (row.publication_available === false) return "paused";
  return "live";
}

function projectLabel(item: Project) {
  return thai(item.public_name) === "ยังไม่ระบุ" ? item.source_name || "ยังไม่ระบุชื่อโครงการ" : thai(item.public_name);
}

function resolveOwnerDisplay(row: Promotion, projects: Project[], brands: Brand[], references: PromotionReferences = {}): { title: string; subtitle: string } {
  const tier = tierOf(row);
  if (tier === "campaign") return { title: row.campaign_name?.th || "แคมเปญกลาง", subtitle: `ร่วมรายการ ${row.scope?.count ?? 0} โครงการ` };
  if (tier === "corporate") return { title: row.programme_key ? workspaceName(references.programmes?.find(p => (p.id ?? p.key)?.toLowerCase() === row.programme_key?.toLowerCase())?.label) : "เสนาดีเวลลอปเม้นท์", subtitle: `ร่วมรายการ ${row.scope?.count ?? 0} โครงการ` };
  if (tier === "project_group") return { title: workspaceName(references.project_groups?.find(g => g.id === row.owning_project_group_id)?.label) || "กลุ่มโครงการ", subtitle: `ร่วมรายการ ${row.scope?.count ?? 0} โครงการ` };
  const matchedProject = projects.find(p => (row.project_id && p.id === row.project_id) || (row.public_project_id && p.public_project_id === row.public_project_id));
  if (matchedProject) {
    return { title: projectLabel(matchedProject), subtitle: `เฉพาะโครงการ · ร่างรุ่น ${row.draft_revision}` };
  }
  const matchedBrand = brands.find(b => (row.owning_brand_id && b.id === row.owning_brand_id) || (row.public_owning_brand_id && b.public_id === row.public_owning_brand_id));
  if (matchedBrand) {
    return { title: `${text.brand}: ${workspaceName(matchedBrand.label)}`, subtitle: `โปรโมชันระดับแบรนด์ · ร่างรุ่น ${row.draft_revision}` };
  }
  if (row.public_project_id) return { title: "โครงการเจ้าของโปรโมชัน", subtitle: `เฉพาะโครงการ · ร่างรุ่น ${row.draft_revision}` };
  if (row.public_owning_brand_id) return { title: text.brand, subtitle: `โปรโมชันระดับแบรนด์ · ร่างรุ่น ${row.draft_revision}` };
  const isBrand = row.applies_via?.scope_level === "brand" || Boolean(row.owning_brand_id);
  return { title: isBrand ? text.brand : text.project, subtitle: `ร่างรุ่น ${row.draft_revision}` };
}

function currentLaneApproved(row: Promotion, lane: "DATA" | "LEGAL") {
  const matching = (row.reviews ?? []).filter(r => r.review_type === lane && r.review_revision === row.draft_revision);
  return matching.at(-1)?.decision === "APPROVED";
}

function PromotionText({ promotion, projects, brands, references }: { promotion: Promotion; projects: Project[]; brands: Brand[]; references: PromotionReferences }) {
  const owner = resolveOwnerDisplay(promotion, projects, brands, references);
  return <><DemoFields fields={promotion.demo_fields} /><span className="promo-badge">{promotionTiers[tierOf(promotion)]}</span>{promotion.highlight_badge?.th && <strong className="promo-highlight">{promotion.highlight_badge.th}</strong>}<dl className="registry-detail-list"><div><dt>รหัสโปรโมชัน</dt><dd><code>{promotion.code}</code></dd></div><div><dt>{text.promotion_owner}</dt><dd>{owner.title}</dd></div><div><dt>ช่วงเวลาใช้สิทธิ์</dt><dd>{dateTime(promotion.starts_at)} ถึงก่อน {dateTime(promotion.ends_at)}</dd></div><div><dt>สิทธิประโยชน์</dt><dd>{promotion.benefit_items?.length ? <ul>{promotion.benefit_items.map((item, index) => <li key={index}>{benefitText(item)}</li>)}</ul> : benefitText(promotion)}</dd></div><div><dt>ใช้ร่วมกับโปรโมชันอื่น</dt><dd>{promotion.stackable ? "ใช้ร่วมกันได้ตามเงื่อนไข" : "ใช้ร่วมกันไม่ได้"}</dd></div><div><dt>ลำดับการแสดงผล</dt><dd>{promotion.priority}</dd></div></dl>{Object.entries(promotionTextFields).map(([key, label]) => <section key={key}><h4>{label}</h4><p className="content-copy">{thai(promotion[key as keyof typeof promotionTextFields])}</p></section>)}</>;
}


function PublisherActions({ row, onSaved, onDirty }: { row: Promotion; onSaved: (value: Promotion) => void; onDirty: (value: boolean) => void }) {
  const [reviewType, setReviewType] = useState<"DATA" | "LEGAL">("DATA"); const [decision, setDecision] = useState("APPROVED");
  const [revision, setRevision] = useState(String(row.draft_revision)); const [evidence, setEvidence] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function act() {
    if (!reason.trim() || !evidence.trim()) { setError("กรุณาระบุหลักฐานและเหตุผลให้ครบก่อนดำเนินการ"); return; }
    setBusy(true); setError("");
    try { const result = await request<Promotion>(`${base}/${row.id}/review`, "POST", { expected_revision: row.draft_revision, review_type: reviewType, decision, evidence, change_reason: reason, ...(decision === "APPROVED" ? { expected_scope_hash: row.scope?.scope_hash } : {}), ...(decision === "REVOKED" ? { review_revision: Number(revision) } : {}) }); onSaved(result); setEvidence(""); setReason(""); }
    catch (err) { setError(err instanceof Error ? err.message : "ดำเนินการไม่สำเร็จ"); } finally { setBusy(false); }
  }
  return <section className="registry-panel promo-section-card"><h3>การตรวจและอนุมัติโดยผู้เผยแพร่</h3><p className="content-muted">{row.synthetic === false ? "ยืนยันหลักฐานข้อมูลและข้อกฎหมายของรุ่นนี้ (ผู้แก้ไขฉบับนี้อนุมัติเองไม่ได้)" : "หลักฐานตัวอย่างใช้สาธิตเท่านั้น ไม่ใช่การอนุมัติจากฝ่ายกฎหมายจริง"}</p><ErrorSummary message={error} /><fieldset className="content-form" disabled={busy} onChange={() => onDirty(true)}><div className="content-grid">
    <Field id="review-type" label="หัวข้อการตรวจ"><select id="review-type" className="registry-input" value={reviewType} onChange={event => setReviewType(event.target.value as "DATA" | "LEGAL")}><option value="DATA">ข้อมูล</option><option value="LEGAL">ข้อกฎหมาย</option></select></Field>
    <Field id="review-decision" label="ผลการตรวจ"><select id="review-decision" className="registry-input" value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVED">ตรวจผ่านสำหรับรุ่นปัจจุบัน</option><option value="REVOKED">ถอนผลการตรวจ</option></select></Field>
    {decision === "REVOKED" && <Field id="review-revision" label="รุ่นร่างที่จะถอนผลการตรวจ"><input id="review-revision" className="registry-input" inputMode="numeric" value={revision} onChange={event => setRevision(event.target.value)} /></Field>}
    <Field id="review-evidence" label="หลักฐานการตรวจ"><textarea id="review-evidence" className="registry-input" value={evidence} onChange={event => setEvidence(event.target.value)} /></Field>
    <Field id="promotion-reason" label="เหตุผลการดำเนินการ"><textarea id="promotion-reason" className="registry-input" value={reason} onChange={event => setReason(event.target.value)} /></Field>
  </div><div className="content-actions"><button type="button" className="registry-button primary" onClick={() => void act()} disabled={busy}>{decision === "REVOKED" ? "ถอนผลการตรวจ" : "บันทึกผลการตรวจ"}</button></div>
</fieldset></section>;
}

export function PromotionsWorkspace({ role: _role }: { role: LocalRole }) {
  const permissions = useHubPermissions();
  const canRead = permissions.can("promotions") && permissions.can("projects");
  const canEdit = permissions.can("promotions", "edit"), authority = capabilityKey(permissions.account);
  const [draftDirty, setDraftDirty] = useState(false), [commercialDirty, setCommercialDirty] = useState(false), [reviewDirty, setReviewDirty] = useState(false);
  const dirty = draftDirty || commercialDirty || reviewDirty; const { params, navigate } = useContentLocation(dirty);
  function clearDirty() { setDraftDirty(false); setCommercialDirty(false); setReviewDirty(false); }
  const project = params.get("project_id") ?? ""; const selected = params.get("promotion") ?? ""; const offset = Number(params.get("offset") ?? "0") || 0;
  const defaultBrand = params.get("owning_brand_id") ?? "", suggestionId = params.get("suggestion");
  const contextKind = params.get("context_kind"), contextRef = params.get("context_ref"), contextPhase = params.get("context_phase");
  const suggestionSource = params.get("suggestion_source");
  const [searchText, setSearchText] = useState(params.get("q") ?? "");
  const [debouncedQuery, setDebouncedQuery] = useState(() => (params.get("q") ?? "").trim());
  useEffect(() => {
    const trimmed = searchText.trim();
    if (!trimmed) { setDebouncedQuery(""); return; }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 180);
    return () => clearTimeout(timer);
  }, [searchText]);
  const tier = (params.get("tier") ?? "") as PromotionTier | "";
  const brandFilter = params.get("brand_id") ?? "", groupFilter = params.get("project_group_id") ?? "";
  const [references, setReferences] = useState<PromotionReferences>({});
  const [tierCounts, setTierCounts] = useState<Record<string, number> | null>(null), [statusCounts, setStatusCounts] = useState<Record<string, number> | null>(null);
  const statusFilter = (params.get("status") ?? "all") as StatusFilter;
  const [brands, setBrands] = useState<Brand[]>([]), [suggestion, setSuggestion] = useState<SuggestionInput | null>(null);
  const [suggestionError, setSuggestionError] = useState(""), [referenceError, setReferenceError] = useState("");
  useEffect(() => { let active = true; setBrands([]); setReferenceError(""); if (!canRead) return; request<PromotionReferences>(`${base}/references`).then(result => { if (active) { setReferences(result); setBrands(result.brands ?? []); } }).catch(error => { if (active) setReferenceError(error.message); }); return () => { active = false; }; }, [authority, canRead]);
  useEffect(() => {
    let active = true; setSuggestion(null); setSuggestionError("");
    if (!canRead || !suggestionId || selected !== "new") return;
    if ((contextKind !== "project" && contextKind !== "brand") || !contextRef || (suggestionSource !== "website" && suggestionSource !== "km")) { setSuggestionError(text.load_error); return; }
    const query = new URLSearchParams({ item: suggestionId, source: suggestionSource });
    if (contextPhase && contextKind === "project") query.set("phase", contextPhase);
    request<{ items: PromotionSuggestion[] }>(`${workspaceApi(contextKind, contextRef)}/promotions/suggestions?${query}`)
      .then(result => { if (!active) return; const item = result.items.find(item => item.id === suggestionId && item.source === suggestionSource); if (item) setSuggestion({ kind: contextKind, ref: contextRef, phase: contextPhase, candidate_id: suggestionId, source: suggestionSource, text: item.text }); else setSuggestionError(text.load_error); })
      .catch(error => { if (active) setSuggestionError(error.message); });
    return () => { active = false; };
  }, [suggestionId, selected, contextKind, contextRef, contextPhase, suggestionSource, authority, canRead]);
  const [projects, setProjects] = useState<Project[]>([]); const [rows, setRows] = useState<Promotion[]>([]); const [total, setTotal] = useState(0); const [row, setRow] = useState<Promotion | null>(null);
  const [loading, setLoading] = useState(true); const [initialLoading, setInitialLoading] = useState(true); const [detailLoading, setDetailLoading] = useState(false); const [error, setError] = useState(""); const [detailError, setDetailError] = useState(""); const [message, setMessage] = useState(""); const [refresh, setRefresh] = useState(0);
  useEffect(() => { let active = true; setProjects([]); if (!canRead) return; request<{ items: Project[] } | Project[]>("v1/admin/projects?summary=1").then(result => { if (active) setProjects(Array.isArray(result) ? result : result.items); }).catch(() => { if (active) setError("โหลดรายชื่อโครงการไม่สำเร็จ กรุณาลองใหม่"); }); return () => { active = false; }; }, [refresh, authority, canRead]);
  useEffect(() => { let active = true; setLoading(true); setError(""); if (!canRead) { setLoading(false); setInitialLoading(false); return; } const q = new URLSearchParams({ limit: "50", offset: String(offset) }); if (project) q.set("project_id", project); if (tier) q.set("tier", tier); if (statusFilter !== "all") q.set("status", statusFilter); if (brandFilter) q.set("brand_id", brandFilter); if (groupFilter) q.set("project_group_id", groupFilter); if (debouncedQuery) q.set("q", debouncedQuery); request<{ items: Promotion[]; total: number; tier_counts?: Record<string, number>; status_counts?: Record<string, number> }>(`${base}?${q}`).then(result => { if (active) { setRows(result.items); setTotal(result.total); setTierCounts(result.tier_counts ?? null); setStatusCounts(result.status_counts ?? null); } }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) { setLoading(false); setInitialLoading(false); } }); return () => { active = false; }; }, [project, tier, statusFilter, brandFilter, groupFilter, debouncedQuery, offset, refresh, authority, canRead]);
  useEffect(() => { let active = true; setRow(null); setDetailError(""); clearDirty(); if (!canRead || !selected || selected === "new") return; setDetailLoading(true); request<Promotion>(`${base}/${selected}`).then(result => { if (active) setRow(result); }).catch(err => { if (active) setDetailError(err.message); }).finally(() => { if (active) setDetailLoading(false); }); return () => { active = false; }; }, [selected, authority, canRead]);

  const counts = useMemo(() => {
    const summary = { all: rows.length, live: 0, draft: 0, paused: 0 };
    if (statusCounts) return { ...summary, ...statusCounts };
    for (const item of rows) summary[statusTone(item)] += 1;
    return summary;
  }, [rows, statusCounts]);

  const visibleRows = useMemo(() => {
    const q = searchText.trim().toLocaleLowerCase("th");
    return rows.filter(item => {
      if (tier && tierOf(item) !== tier) return false;
      if (!statusCounts && statusFilter !== "all" && statusTone(item) !== statusFilter) return false;
      if (statusCounts || !q) return true;
      const owner = resolveOwnerDisplay(item, projects, brands, references);
      const haystack = `${thai(item.title)} ${item.code} ${owner.title}`.toLocaleLowerCase("th");
      return haystack.includes(q);
    });
  }, [rows, tier, statusFilter, searchText, projects, brands, references, statusCounts]);

  function saved(value: Promotion) { setRow(value); clearDirty(); setMessage("บันทึกข้อมูลแล้ว"); if (selected === "new") navigate({ promotion: value.id, suggestion: null, suggestion_source: null, exclude_project: null }, true); else if (params.has("exclude_project")) navigate({ exclude_project: null }, true); setRefresh(previous => previous + 1); }
  function close() { if (navigate({ promotion: null })) { clearDirty(); setRow(null); } }
  if (!canRead) return <p className="notice">{text.promotion_access_denied}</p>;
  return <div className="content-workspace promo-workspace">
    {contextRef && (contextKind === "project" || contextKind === "brand" || contextKind === "project_group" || contextKind === "corporate") && <p className="promo-back-row"><a className="button secondary" href={workspaceHref({ level: contextKind, id: contextRef, phase: contextPhase, tab: "promotions" })}>{text.promotion_context_return}</a></p>}
    <header className="promo-hero">
      <div>
        <h1 id="registry-title" tabIndex={-1}>โปรโมชัน</h1>
        <p>จัดการข้อเสนอ สิทธิประโยชน์ ขอบเขตโครงการ และการตรวจข้อกฎหมายก่อนเผยแพร่ขึ้นเว็บไซต์และผู้ช่วย AI</p>
      </div>
      {canEdit && <button type="button" className="registry-button primary" onClick={() => navigate({ promotion: "new", context_kind: null, context_ref: null, context_phase: null, owning_brand_id: null, owning_project_group_id: null, suggestion: null, suggestion_source: null })}>สร้างโปรโมชัน</button>}
    </header>

    <div role="status" aria-live="polite"><StatusText message={message} /></div>
    <ErrorSummary message={error} />

    <nav className="promo-tier-tabs" aria-label="กรองระดับโปรโมชัน">{[["", "ทั้งหมด"], ...Object.entries(promotionTiers)].map(([key, label]) => <button key={key} type="button" className="promo-pill" aria-pressed={tier === key} onClick={() => navigate({ tier: key || null, offset: null, brand_id: null, project_group_id: null, project_id: null })}>{label} ({tierCounts?.[key || "all"] ?? (key ? rows.filter(row => tierOf(row) === key).length : total)})</button>)}</nav>
    <section className="promo-kpis" aria-label="สรุปสถานะโปรโมชัน">
      {([
        ["all", "ทั้งหมด", counts.all],
        ["live", "เผยแพร่และแสดงได้", counts.live],
        ["draft", "ฉบับร่าง / รอตรวจ", counts.draft],
        ["paused", "งดแสดง / หมดอายุ", counts.paused],
      ] as const).map(([key, label, count]) => <button key={key} type="button" className="promo-kpi-btn" aria-pressed={statusFilter === key} onClick={() => navigate({ status: key === "all" ? null : key, offset: null })}>
        <span className="promo-kpi-label">{label}</span>
        <span className="promo-kpi-value">{loading ? "…" : count}</span>
      </button>)}
    </section>

    <div className="promo-toolbar">
      <div className="promo-toolbar-field">
        <label htmlFor="promo-search-input">ค้นหาโปรโมชัน</label>
        <input id="promo-search-input" type="search" className="registry-input" placeholder="ค้นหาจากชื่อโปรโมชันหรือรหัส" value={searchText} onChange={event => { setSearchText(event.target.value); if (offset) navigate({ offset: null }); }} />
      </div>
      <div className="promo-toolbar-field">
        {tier === "brand" ? <><label htmlFor="promo-brand-filter">กรองตามแบรนด์</label><select id="promo-brand-filter" className="registry-input" value={brandFilter} onChange={event => navigate({ brand_id: event.target.value, offset: null })}><option value="">ทุกแบรนด์</option>{brands.map(item => <option key={item.id} value={item.id}>{workspaceName(item.label)}</option>)}</select></> : tier === "project_group" ? <><label htmlFor="promo-group-filter">กรองตามกลุ่มโครงการ</label><select id="promo-group-filter" className="registry-input" value={groupFilter} onChange={event => navigate({ project_group_id: event.target.value, offset: null })}><option value="">ทุกกลุ่มโครงการ</option>{references.project_groups?.map(item => <option key={item.id} value={item.id}>{workspaceName(item.label)}</option>)}</select></> : <><label htmlFor="promo-project-filter">กรองตามโครงการ</label><select id="promo-project-filter" className="registry-input" value={project} onChange={event => navigate({ project_id: event.target.value, offset: null, promotion: null })}><option value="">ทุกโครงการ</option>{projects.map(item => <option key={item.id} value={item.id}>{projectLabel(item)}</option>)}</select></>}

      </div>
      <div className="content-actions" style={{ marginTop: 0 }}>
        {(searchText || statusFilter !== "all" || project || tier || brandFilter || groupFilter) && <button type="button" className="button secondary" onClick={() => { setSearchText(""); navigate({ project_id: null, status: null, tier: null, brand_id: null, project_group_id: null, q: null, offset: null, promotion: null }); }}>ล้างตัวกรอง</button>}
        <button type="button" className="registry-button" onClick={() => setRefresh(value => value + 1)}>โหลดรายการใหม่</button>
      </div>
    </div>

    {initialLoading ? <><p role="status">กำลังโหลดโปรโมชัน…</p><LoadingRows /></> : <section className="registry-panel promo-table-panel">
      <div className="promo-table-meta">
        <span>แสดง {visibleRows.length} จากทั้งหมด {total} รายการ</span>
        {statusFilter !== "all" && <span>กรองเฉพาะสถานะที่เลือก</span>}
      </div>
      {visibleRows.length ? <table className="registry-table promo-table">
        <thead>
          <tr>
            <th>โปรโมชันและสิทธิประโยชน์</th>
            <th>โครงการ / แบรนด์</th>
            <th>ระยะเวลาใช้สิทธิ์</th>
            <th>สถานะเผยแพร่และการตรวจ</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map(item => {
            const owner = resolveOwnerDisplay(item, projects, brands, references);
            const dataOk = currentLaneApproved(item, "DATA");
            const legalOk = currentLaneApproved(item, "LEGAL");
            return <tr key={item.id}>
              <td data-label="โปรโมชันและสิทธิประโยชน์">
                <RegistryRowSummary id={`promotion-${item.id}`}>
                  <button type="button" className="promo-title-btn" onClick={() => navigate({ promotion: item.id })}>{thai(item.title)}</button>
                  <div className="promo-row-sub">
                    <code className="promo-code-chip">{item.code}</code>
                    <span className="promo-badge">{promotionTiers[tierOf(item)]}</span>{item.highlight_badge?.th && <strong className="promo-highlight">{item.highlight_badge.th}</strong>}{item.benefit_items?.length ? item.benefit_items.map((benefit, index) => <span key={index} className="promo-benefit-chip">{benefitText(benefit)}</span>) : <span className="promo-benefit-chip">{benefitText(item)}</span>}
                  </div>
                  <DemoFields fields={item.demo_fields} />
                </RegistryRowSummary>
              </td>
              <td data-label="โครงการ / แบรนด์">
                <div className="promo-owner-name">{owner.title}</div>
                <p className="promo-owner-meta">{owner.subtitle}</p>
              </td>
              <td data-label="ระยะเวลาใช้สิทธิ์" className="promo-window-cell">
                <span>{dateTime(item.starts_at)}</span>
                <span className="promo-window-sub">ถึงก่อน {dateTime(item.ends_at)}</span>
                {item.booking_from && <span className="promo-window-sub">จอง: {dateTime(item.booking_from)} – {item.booking_to && dateTime(item.booking_to)}</span>}
                {item.transfer_from && <span className="promo-window-sub">โอน: {dateTime(item.transfer_from)} – {item.transfer_to && dateTime(item.transfer_to)}</span>}
              </td>
              <td data-label="สถานะเผยแพร่และการตรวจ">
                <span className="promo-badge" data-tone={statusTone(item)}>{publicationLabel(item)}</span>
                <div className="promo-lane-pills">
                  <span className="promo-lane-pill" data-approved={dataOk}>ข้อมูล: {dataOk ? "ผ่านแล้ว" : "รอตรวจ"}</span>
                  <span className="promo-lane-pill" data-approved={legalOk}>ข้อกฎหมาย: {legalOk ? "ผ่านแล้ว" : "รอตรวจ"}</span>
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table> : <p style={{ padding: "24px 20px", margin: 0 }}>ไม่พบโปรโมชันตามตัวกรอง</p>}
      <div className="content-actions promo-pagination">
        <div>
          <button type="button" className="registry-button" disabled={offset === 0} onClick={() => navigate({ offset: String(Math.max(0, offset - 50)), promotion: null })}>หน้าก่อน</button>
          <button type="button" className="registry-button" disabled={offset + 50 >= total} onClick={() => navigate({ offset: String(offset + 50), promotion: null })} style={{ marginLeft: 8 }}>หน้าถัดไป</button>
        </div>
        <span className="content-muted">หน้า {Math.floor(offset / 50) + 1}</span>
      </div>
    </section>}

    {selected && <DetailDialog key={selected} dialogId={`promotion-${selected}`} title={selected === "new" ? "สร้างโปรโมชัน" : row ? thai(row.title) : "รายละเอียดโปรโมชัน"} onClose={close}>
      <div className="promo-modal-body">
        {detailLoading && <p role="status">กำลังโหลดรายละเอียด…</p>}
        <ErrorSummary message={detailError || referenceError || suggestionError} />
        {selected === "new" ? !canEdit ? <p>{text.promotion_read_only}</p> : suggestionId && !suggestion ? suggestionError ? null : <p role="status">{text.loading}</p> : <PromotionDraft key={suggestion?.candidate_id ?? "new"} projects={projects} brands={brands} references={references} defaultProject={project} defaultBrand={defaultBrand} defaultGroup={params.get("owning_project_group_id") ?? ""} defaultTier={contextKind === "corporate" || contextKind === "project_group" ? contextKind : tier || undefined} contextLocked={Boolean(contextKind)} suggestion={suggestion} onSaved={saved} onDirty={setDraftDirty} /> : row && <>
          <div className="promo-Progress-bar">
            <div className="promo-steps">
              <span className="promo-step" data-done="true">1. ร่างรุ่น {row.draft_revision} · แก้ไขล่าสุด {dateTime(row.updated_at)}</span>
              <span className="promo-step" data-done={currentLaneApproved(row, "DATA") && currentLaneApproved(row, "LEGAL")}>
                2. ตรวจข้อมูล ({currentLaneApproved(row, "DATA") ? "ผ่าน" : "รอ"}) · กฎหมาย ({currentLaneApproved(row, "LEGAL") ? "ผ่าน" : "รอ"})
              </span>
              <span className="promo-step" data-done={Boolean(row.published_version_id && row.publication_available)}>
                3. {publicationLabel(row)}
              </span>
            </div>
            <a className="button secondary" href={`/publish?source=promotion&id=${encodeURIComponent(row.id)}`}>{workflowText.queue}</a>
          </div>
          {contextRef && (row.owning_brand_id || (row.scope?.count ?? 0) > 1) && <p className="notice">{text.promotion_shared_edit.replace("{count}", String(row.scope?.count ?? 0))}</p>}
          <DemoFields fields={row.demo_fields} />
          <Ready value={row.readiness} />
          {dirty && <p role="status" className="promo-lock-hint">มีการแก้ไขที่ยังไม่บันทึก</p>}
          {canEdit && row.can_edit === false && <p className="notice">ดูข้อมูลได้บางโครงการเท่านั้น การแก้ไขโปรโมชันนี้ต้องมีสิทธิ์ครบทุกโครงการที่ร่วมรายการ</p>}
          {canEdit && row.can_edit !== false ? <PromotionDraft key={`${row.id}-${row.draft_revision}`} promotion={row} projects={projects} brands={brands} references={references} defaultProject={project} excludeProject={params.get("exclude_project")} disabled={commercialDirty} onSaved={saved} onDirty={setDraftDirty} /> : <section className="registry-panel promo-section-card"><h3>รายละเอียดโปรโมชันฉบับร่าง</h3><PromotionText promotion={row} projects={projects} brands={brands} references={references} /></section>}
          <PromotionCommercialFields key={`commercial-${row.id}-${row.draft_revision}`} row={row} initialReferences={references} integrated={canEdit && row.can_edit !== false} disabled={draftDirty || row.can_edit === false} onSaved={saved} onDirty={setCommercialDirty} />
          <section className="registry-panel promo-section-card content-review" style={{ marginTop: 0 }}>
            <h3>ผลการตรวจแยกตามรุ่นร่าง</h3>
            {row.reviews?.length ? row.reviews.map((review, index) => <details key={index}>
              <summary>{typeLabel(review.review_type)} · รุ่น {review.review_revision} · {review.decision === "APPROVED" ? "ตรวจผ่าน" : "ถอนผลการตรวจ"}{review.review_revision !== row.draft_revision ? " · ไม่ใช่ผลตรวจของร่างปัจจุบัน" : ""}</summary>
              <p className="content-copy">{review.evidence}</p>
              {review.resolved_project_ids && <p>{text.promotion_resolved_projects}: {review.resolved_project_ids.map(id => { const project = projects.find(project => project.public_project_id === id); return project ? projectLabel(project) : workspaceName(row.scope?.items.find(project => project.public_id === id)?.label) || "โครงการในขอบเขตที่ตรวจแล้ว"; }).join(", ")}</p>}
              <p className="content-muted">{dateTime(review.reviewed_at)} · <ActorName id={review.reviewed_by} /></p>
            </details>) : <p className="content-muted">ยังไม่มีผลการตรวจสำหรับโปรโมชันนี้</p>}
          </section>
          {permissions.can("promotions", "approve") && <PublisherActions key={`${row.id}-${row.draft_revision}`} row={row} onSaved={saved} onDirty={setReviewDirty} />}
          <details className="promo-subdrawer" open={Boolean(row.published)}>
            <summary>ฉบับเผยแพร่ปัจจุบันและประวัติ ({row.versions?.length ?? 0} ฉบับ)</summary>
            <div>
              <p><strong>สถานะเผยแพร่:</strong> {publicationLabel(row)}</p>
              {row.published ? <>
                <p>ฉบับ {row.published.version_no} · เผยแพร่เมื่อ {dateTime(row.published.published_at)}</p>
                <p className="content-muted">สถานะตามช่วงเวลา: {Date.now() < new Date(row.published.payload.starts_at).getTime() ? "ยังไม่เริ่มใช้สิทธิ์" : Date.now() >= new Date(row.published.payload.ends_at).getTime() ? "หมดอายุแล้ว" : "อยู่ในช่วงใช้สิทธิ์"} · การให้สิทธิ์จริงตรวจโครงการ ต้นทาง และผลการตรวจจากเซิร์ฟเวอร์ทุกครั้ง</p>
                <PromotionText promotion={row.published.payload} projects={projects} brands={brands} references={references} />
              </> : <p className="content-muted">ยังไม่มีฉบับเผยแพร่</p>}
              <div className="content-history">
                <h4>ประวัติฉบับเผยแพร่</h4>
                {row.versions?.length ? <ul>{row.versions.map(version => <li key={version.id}>ฉบับ {version.version_no} · {dateTime(version.published_at)}</li>)}</ul> : <p className="content-muted">ยังไม่มีประวัติ</p>}
              </div>
            </div>
          </details>
        </>}
      </div>
    </DetailDialog>}
  </div>;
}
