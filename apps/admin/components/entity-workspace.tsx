"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useHubPermissions } from "./accounts";
import { WorkspaceBack } from "./workspace-navigation";
import { capabilityKey } from "@/lib/hub-permissions";
import type { LocalRole } from "@/lib/local-session";
import { request } from "./hub-request";
import { contentDate, errorMessage, sectionLabel } from "./content-common";
import { useContentLocation } from "./content-operations-shared";
import { ProjectDetail, type ProjectTab } from "./hub-admin";
import { BrandDetail } from "./brand-admin";
import { ProjectContentWorkspace } from "./project-content-workspace";
import { ProjectMediaWorkspace } from "./project-media-workspace";
import { WebsiteContentSources } from "./website-content-sources";
import { FaqWorkspace } from "./faq-workspace";
import type { QuestionBank } from "./faq-bank";
import { BusinessWorkspace } from "./business-workspace";
import { ScopeKmWorkspace } from "./km-hubs";
import { ContentBuNotices } from "./content-bu-notices";
import { ExposureChip } from "./content-exposure";
import { SavedContentSubmission } from "./content-workflow";
import type { SubmissionOutcome } from "@/lib/content-workflow";
import { ContentSource } from "./content-source";
import { ContentHistory, ContentTimeline } from "./content-history";
import { ContextualPromotions, PromotionOverview } from "./contextual-promotions";
import { legacyWorkspaceHref, workspaceApi, workspaceHref, workspaceName, workspaceQuestionLabel, workspaceText as text, workspaceTabs, tabLabels, type WorkspaceEntity, type WorkspaceItem, type WorkspaceLevel, type WorkspaceTab } from "@/lib/unified-workspace";
import "./unified-workspace.css";
type OverviewItem = WorkspaceItem & { priority?: "required" | "recommended"; questionPending?: boolean };
const levelHubMeta: Record<WorkspaceLevel, { badge: string; hubLabel: string; hubHref: string; hubCap: "knowledge" | "brands" | "projects" | "groups" }> = {
  corporate: { badge: "องค์กรหลัก SENA", hubLabel: "KM องค์กรและธุรกิจอื่น", hubHref: "/website?view=businesses", hubCap: "knowledge" },
  programme: { badge: "โปรแกรมโซลูชัน", hubLabel: "KM องค์กรและธุรกิจอื่น", hubHref: "/website?view=businesses", hubCap: "knowledge" },
  business: { badge: "หน่วยธุรกิจ", hubLabel: "KM องค์กรและธุรกิจอื่น", hubHref: "/website?view=businesses", hubCap: "knowledge" },
  brand: { badge: "แบรนด์ที่อยู่อาศัย", hubLabel: "KM แบรนด์", hubHref: "/website?view=brands", hubCap: "brands" },
  project_group: { badge: "กลุ่มโครงการ", hubLabel: "KM กลุ่มโครงการ", hubHref: "/website?view=groups", hubCap: "groups" },
  project: { badge: "โครงการ", hubLabel: "KM โครงการ", hubHref: "/website?view=projects", hubCap: "projects" },
  unit_type: { badge: "แบบที่อยู่อาศัย", hubLabel: "KM โครงการ", hubHref: "/website?view=projects", hubCap: "projects" },
};
const tabFlowDescriptions: Record<WorkspaceTab, string> = {
  overview: "สรุปความครบ งานค้าง และการแก้ไขล่าสุดก่อนเผยแพร่",
  data: "กรอกเนื้อหาหลัก จุดขาย ข้อเท็จจริง ช่องทางติดต่อ และคำแปล",
  "unit-types": "จัดการแบบที่อยู่อาศัย แปลนห้อง และราคาเริ่มต้น",
  promotions: "ผูกแคมเปญและโปรโมชันที่ใช้กับขอบเขตนี้",
  media: "ตรวจสิทธิ์ภาพบังคับขึ้นเว็บ คลังรูปส่วนกลาง และคลิป 360°",
  faq: "ตอบคำถามมาตรฐานและตรวจคำตอบที่สืบทอดจากระดับบน",
  history: "ตรวจสอบประวัติการอนุมัติ เปรียบเทียบเวอร์ชัน และส่งคิวเผยแพร่",
};
function ItemLinks({ items }: { items: OverviewItem[] }) {
  return <ul className="workspace-items">{items.map((item, index) => <li key={item.code + index}>
    <Link prefetch={false} href={workspaceHref(item.target)}>{item.context && <>{text[`context_${item.context.kind}`]} {workspaceName(item.context.label)} · </>}{workspaceName(item.label)}</Link>
    {item.priority && <span>{text[item.priority]}</span>}{item.state && text[item.state.toUpperCase() as keyof typeof text] && <span>{text[item.state.toUpperCase() as keyof typeof text]}</span>}
    {item.questionPending && <span>{text.faq_question_pending}</span>}
    {item.due && <time dateTime={item.due}>{contentDate(item.due)}</time>}
  </li>)}</ul>;
}
function ItemGroup({ name, items }: { name: string; items: OverviewItem[] }) {
  const [all, setAll] = useState(false);
  return <details className="workspace-gap-group"><summary>{name} <span>({items.length})</span>{items.some(item => item.priority) && <span className="workspace-gap-counts">{text.required} {items.filter(item => item.priority === "required").length} · {text.recommended} {items.filter(item => item.priority === "recommended").length}</span>}</summary>
    <ItemLinks items={all ? items : items.slice(0, 5)} />
    {items.length > 5 && <button type="button" className="button secondary" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? text.show_less : text.view_all} ({items.length})</button>}
  </details>;
}
function Items({ title, items, emptyLabel, hint }: { title: string; items: OverviewItem[]; emptyLabel: string; hint?: string }) {
  const groups = new Map<string, { name: string; items: OverviewItem[] }>();
  for (const item of items) {
    const section = item.target.section, key = item.target.tab + ":" + (section ?? "");
    const group = groups.get(key) ?? { name: tabLabels[item.target.tab] + (section ? " · " + (section === "commercial" ? text.section_commercial : section === "investor" ? text.section_investor : sectionLabel(section)) : ""), items: [] };
    group.items.push(item); groups.set(key, group);
  }
  return <section className="workspace-panel" aria-label={title}><h2>{title} <span className="workspace-count">{items.length} {text.item_count}</span></h2>
    {hint && <p className="workspace-task-hint">{hint}</p>}
    {items.length ? Array.from(groups, ([key, group]) => <ItemGroup key={key} {...group} />) : <p>{emptyLabel}</p>}
  </section>;
}
function PagePreview({ endpoint }: { endpoint: string }) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const [html, setHtml] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let live = true; setHtml(null); setError("");
    request<{ html: string }>(endpoint).then(value => { if (live) setHtml(value.html); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [endpoint, authority]);
  return <section><h2>{text.preview}</h2>{error && <p className="notice error" role="alert">{error}</p>}{html == null ? !error && <p role="status">{text.loading}</p> : <iframe className="workspace-preview" title={text.preview} sandbox="" srcDoc={html} />}</section>;
}
export function EntityWorkspace({ level, id, role }: { level: WorkspaceLevel; id: string; role: LocalRole }) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const [data, setData] = useState<WorkspaceEntity | null>(null), [error, setError] = useState(""), [editing, setEditing] = useState(false), [primaryDirty, setPrimaryDirty] = useState(false), [primaryBusy, setPrimaryBusy] = useState(false), [primaryPending, setPrimaryPending] = useState(false), [retry, setRetry] = useState(0);
  const [suggestionEditing, setSuggestionEditing] = useState(false);
  const [dataIdentity, setDataIdentity] = useState("");
  const [pendingQuestions, setPendingQuestions] = useState<{ key: string; questions: string[] } | null>(null);
  const [headerBusy, setHeaderBusy] = useState(false), [inventoryRevision, setInventoryRevision] = useState(0), [editorRevision, setEditorRevision] = useState(0);
  const businessEditing = useCallback((value: boolean) => { setEditing(value); setPrimaryBusy(value); setPrimaryPending(value); }, []);
  const location = useContentLocation(primaryDirty || editing || suggestionEditing || headerBusy), root = useRef<HTMLDivElement>(null);
  const [legacyHistoryOpen, setLegacyHistoryOpen] = useState(false);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const phase = location.params.get("phase"), section = location.params.get("section"), queryTab = location.params.get("tab");
  const path = workspaceApi(level, id) + (phase ? "?phase=" + encodeURIComponent(phase) : "");
  const activeIdentity = path + authority, active = useRef(activeIdentity); active.current = activeIdentity;
  const refreshSummary = useCallback(async () => {
    try { const value = await request<WorkspaceEntity>(path); if (active.current === activeIdentity) { setData(value); setDataIdentity(activeIdentity); setError(""); } }
    catch (error) { if (active.current === activeIdentity) setError(errorMessage(error)); }
  }, [path, activeIdentity]);
  const onWorkflowChanged = useCallback(() => { setInventoryRevision(value => value + 1); void refreshSummary(); }, [refreshSummary]);
  const submitted = useCallback((outcomes: SubmissionOutcome[]) => {
    if (outcomes.some(item => item.status === "submitted")) { setEditorRevision(value => value + 1); void refreshSummary(); }
    // Failed items retain their original inventory hashes until explicit refresh.
  }, [refreshSummary]);
  const sourceVersion = location.params.get("version"), sourceDraft = location.params.get("draft_at"), webPage = location.params.get("web_page");
  useEffect(() => {
    const url = new URL(window.location.href), anchor = url.hash.slice(1);
    const legacy: Record<string, [WorkspaceTab, string | null]> = { assets: ["media", "canonical"], models: ["unit-types", null], "commercial-types": ["unit-types", null], "model-media": ["unit-types", null], "versions-panel": ["history", null], "brand-versions-panel": ["history", null] };
    const target = legacy[anchor]; if (!target) return;
    url.searchParams.set("tab", target[0]); if (target[1]) url.searchParams.set("section", target[1]); else url.searchParams.delete("section");
    url.hash = ""; window.history.replaceState(null, "", url);
  }, [level, id]);
  useEffect(() => {
    let live = true; setData(null); setDataIdentity(""); setError(""); setEditing(false); setPrimaryDirty(false); setPrimaryBusy(false); setPrimaryPending(false); setSuggestionEditing(false); setHeaderBusy(false);
    request<WorkspaceEntity>(path).then(value => { if (live) { setData(value); setDataIdentity(activeIdentity); } }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [path, activeIdentity, retry]);
  const scopeKmEnabled = (level === "project_group" || level === "programme") && permissions.can("knowledge");
  const canViewContextualPromotions = permissions.can("promotions") && permissions.can("projects")
    && (level !== "brand" || permissions.can("brands"))
    && ((level !== "project_group" && level !== "corporate") || permissions.can("knowledge"));
  const tabs = workspaceTabs.filter(tab => (data?.tabs.includes(tab) || (tab === "data" && scopeKmEnabled)) && (tab !== "promotions" || canViewContextualPromotions));
  const tab = tabs.includes(queryTab as WorkspaceTab) ? queryTab as WorkspaceTab : tabs[0] ?? "overview";
  const heldQuestionKeys = JSON.stringify([...new Set(data?.overview.tasks.filter(item => item.state === "hold" && item.target.tab === "faq" && item.target.question_key).map(item => item.target.question_key) ?? [])].sort());
  const pendingQuestionKey = tab === "overview" && section !== "preview" && dataIdentity === activeIdentity && permissions.can("knowledge") && heldQuestionKeys !== "[]"
    ? JSON.stringify([activeIdentity, heldQuestionKeys, inventoryRevision, retry]) : "";
  useEffect(() => {
    let live = true; setPendingQuestions(null);
    if (pendingQuestionKey) request<QuestionBank>("v1/admin/faq/questions").then(bank => {
      if (live) setPendingQuestions({ key: pendingQuestionKey, questions: bank.items.filter(item => item.status === "proposed").map(item => item.question_key) });
    }).catch(() => {});
    return () => { live = false; };
  }, [pendingQuestionKey]);
  const targetField = location.params.get("field"), targetQuestion = location.params.get("question"), targetItem = location.params.get("binding") ?? location.params.get("item") ?? location.params.get("asset") ?? location.params.get("building") ?? location.params.get("unit_type") ?? location.params.get("facility"), targetCluster = location.params.get("cluster"), targetMediaRole = location.params.get("media_role");
  useEffect(() => {
    if (!data || !root.current) return;
    const container = root.current; let done = false;
    const focus = () => {
      if (done) return;
      const selectors = [
        targetField ? `[data-workspace-field="${CSS.escape(targetField)}"]` : "",
        targetField ? "#" + CSS.escape(targetField.replace(/^(project|brand)\./, "")) : "",
        targetQuestion ? `[data-workspace-question="${CSS.escape(targetQuestion)}"]` : "",
        targetItem ? `[data-workspace-item="${CSS.escape(targetItem)}"]` : "",
        targetItem ? `[data-workspace-asset="${CSS.escape(targetItem)}"]` : "",
        targetMediaRole ? `[data-workspace-media-role="${CSS.escape(targetMediaRole)}"]` : "",
        targetCluster ? "#website-suggestion-" + CSS.escape(targetCluster) : "",
      ].filter(Boolean);
      const scope = targetItem ? container.querySelector<HTMLElement>(`[data-workspace-item="${CSS.escape(targetItem)}"]`) ?? container : container;
      const candidates = selectors.flatMap(selector => Array.from(scope.querySelectorAll<HTMLElement>(selector)));
      for (const candidate of candidates) { let details = candidate.closest("details"); while (details) { details.open = true; details = details.parentElement?.closest("details") ?? null; } }
      const element = candidates.find(element => element.getClientRects().length > 0) ?? (scope !== container && scope.getClientRects().length ? scope as HTMLElement : null);
      if (!element) return;
      done = true; element.closest("details")?.setAttribute("open", ""); element.scrollIntoView({ block: "center" }); element.focus({ preventScroll: true });
    };
    const observer = new MutationObserver(() => { focus(); if (done) observer.disconnect(); }); observer.observe(container, { childList: true, subtree: true }); focus();
    return () => observer.disconnect();
  }, [data, tab, section, targetField, targetQuestion, targetItem, targetCluster, targetMediaRole]);
  function chooseTab(next: WorkspaceTab) {
    if (suggestionEditing || primaryPending || headerBusy) return false;
    setLegacyHistoryOpen(false);
    return location.navigate({ tab: next, section: next === "media" && primaryBusy ? "canonical" : null, field: null, item: null, question: null, faq: null, cluster: null, faq_section: null, version: null, draft_at: null, web_page: null }, !editing);
  }
  if (!data) return <section className="unified-workspace"><Link prefetch={false} href="/website">{text.website}</Link>{error ? <p className="notice error" role="alert">{error}<button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p> : <p role="status">{text.loading}</p>}</section>;
  const selected = data.phases.find(item => item.rem_project_id === data.selected_phase);
  const publicProject = level === "project" || level === "unit_type" ? (selected?.public_project_id ?? (level === "project" ? id : null)) : null;
  const hasSourceTabs = data.tabs.some(value => value === "data" || value === "unit-types" || value === "media");
  const projectSource = Boolean(publicProject && hasSourceTabs && permissions.can("projects"));
  const projectFaq = level === "project" && data.selected_phase;
  const scope = { type: projectFaq ? "project" : data.entity.scope_type, id: projectFaq || data.entity.scope_id, name: workspaceName(projectFaq ? selected?.name ?? data.entity.name : data.entity.name) };
  const projectName = selected?.name ?? (level === "project" ? data.entity.name : undefined);
  const context = { level, id, phase: data.selected_phase, projectName: level === "project" || level === "unit_type" ? projectName : undefined };
  const tasks = data.overview.tasks.map(item => ({ ...item,
    label: item.target.tab === "faq" && item.target.question_key && item.target.level === "project"
      ? workspaceQuestionLabel(item.label, data.phases.find(phase => phase.rem_project_id === item.target.phase)?.name ?? projectName) : item.label,
    questionPending: Boolean(item.state === "hold" && item.target.tab === "faq" && item.target.question_key && pendingQuestions?.key === pendingQuestionKey && pendingQuestions.questions.includes(item.target.question_key)),
  }));
  const primaryTab = tab === "unit-types" ? "models" : tab === "media" ? "media" : tab === "history" ? "versions" : section === "supplementary" ? "extra" : "content";
  const showPrimary = tab === "unit-types" || tab === "history" || tab === "data" && (!section || ["identity", "supplementary"].includes(section)) || tab === "media" && (section === "canonical" || level === "brand");
  const primary = <></>;
  function editorTab(next: ProjectTab) {
    const target: Record<ProjectTab, { tab: WorkspaceTab; section: string | null }> = { content: { tab: "data", section: "identity" }, extra: { tab: "data", section: "supplementary" }, media: { tab: "media", section: "canonical" }, models: { tab: "unit-types", section: null }, versions: { tab: "history", section: null } };
    if (next === "versions") setLegacyHistoryOpen(true);
    location.navigate(target[next], true);
  }
  function editorField(field: string) {
    if (!publicProject) return;
    const href = legacyWorkspaceHref("/", new URLSearchParams({ project: publicProject, field }))!;
    const target = new URL(href, window.location.origin).searchParams;
    location.navigate({ tab: target.get("tab"), section: target.get("section"), field }, true);
  }
  const hubMeta = levelHubMeta[level];
  const canOpenHub = hubMeta.hubCap === "groups"
    ? permissions.can("projects") || permissions.can("knowledge")
    : permissions.can(hubMeta.hubCap);
  const requiredMissingCount = data.overview.readiness.required.length;
  const activeTabIndex = tabs.indexOf(tab);
  const prevTab = activeTabIndex > 0 ? tabs[activeTabIndex - 1] : null;
  const nextTab = activeTabIndex >= 0 && activeTabIndex < tabs.length - 1 ? tabs[activeTabIndex + 1] : null;
  const navLocked = primaryDirty || primaryBusy || editing || suggestionEditing || headerBusy;
  const visibleMembers = showAllMembers ? data.phases : data.phases.slice(0, 8);
  return <div className="unified-workspace" ref={root}>
    <header className="workspace-heading">
      <div className="workspace-heading-main">
        <div className="workspace-breadcrumbs">
          <WorkspaceBack fallback="/website" label={text.website} />
          {canOpenHub && (
            <>
              <span className="workspace-crumb-sep" aria-hidden="true">/</span>
              <Link prefetch={false} className="workspace-hub-crumb" href={hubMeta.hubHref}>{hubMeta.hubLabel}</Link>
            </>
          )}
        </div>
        <h1>{workspaceName(data.entity.name)}</h1>
        <div className="workspace-meta-strip">
          <span className="km-status-badge">{hubMeta.badge}</span>
          <span className="km-code-badge">{data.selected_phase ? `REM: ${data.selected_phase}` : data.entity.scope_id}</span>
          {tabs.includes("overview") && (
            <span className={`km-status-badge ${requiredMissingCount === 0 ? "is-ready" : "is-warning"}`}>
              {requiredMissingCount === 0 ? "ข้อมูลจำเป็นครบ ✓" : `ยังขาดข้อมูลจำเป็น ${requiredMissingCount} รายการ`}
            </span>
          )}
          {tasks.length > 0 && (
            <span className="km-stat-chip">งานรอจัดการ <strong>{tasks.length}</strong></span>
          )}
        </div>
      </div>
      <div className="workspace-heading-controls">
        {data.phases.length > 1 && <label className="content-input workspace-phase-picker">{text.phase}<select disabled={primaryBusy || suggestionEditing || headerBusy} value={data.selected_phase ?? ""} onChange={event => location.navigate({ phase: event.target.value, field: null, item: null, faq: null, cluster: null, unit_type: null })}>{data.phases.map(item => <option key={item.rem_project_id} value={item.rem_project_id}>{workspaceName(item.name)} · {item.rem_project_id}</option>)}</select></label>}
        <SavedContentSubmission scope={{ level, id, phase: level === "project" || level === "unit_type" ? data.selected_phase : null }} revision={inventoryRevision}
          disabled={primaryDirty || primaryBusy || editing || suggestionEditing} onBusyChange={setHeaderBusy} onChanged={submitted}
          onExposureChanged={() => { setEditorRevision(value => value + 1); onWorkflowChanged(); }} />
      </div>
    </header>
    {publicProject && <ContentBuNotices key={publicProject} project={publicProject} quiet />}
    {error && <p className="notice error" role="alert">{error}</p>}
    {level === "project" && data.entity.grouping?.group_ref ? (
      <section className="km-inheritance-banner" aria-label="การสืบทอดข้อมูลกลุ่มโครงการ">
        <div>
          <strong>กลุ่มโครงการ: {data.entity.grouping.group_ref}</strong>
          <p>โครงการนี้สืบทอด KM และ FAQ มาตรฐานจากระดับกลุ่มโครงการโดยอัตโนมัติ หากต้องการเนื้อหาเฉพาะเฟสนี้สามารถเขียนเฉพาะโครงการนี้เพื่อแทนที่ได้</p>
        </div>
        <div className="km-card-actions">
          <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project_group", id: data.entity.grouping.group_ref, tab: "data" })}>แก้ไข KM กลุ่ม</Link>
          <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project_group", id: data.entity.grouping.group_ref, tab: "faq" })}>จัดการ FAQ กลุ่ม</Link>
        </div>
      </section>
    ) : data.entity.grouping?.review_href && level !== "project" ? (
      <p><Link prefetch={false} href={data.entity.grouping.review_href}>{text.groups} · {text.settings}</Link></p>
    ) : null}
    {(level === "project_group" || level === "programme") && data.phases.length > 0 && (
      <section className="km-member-box" aria-label="โครงการสมาชิกในขอบเขตนี้" style={{ marginBottom: "0.75rem" }}>
        <div className="km-card-top">
          <div>
            <p className="km-member-title">
              {level === "project_group" ? `โครงการสมาชิกและเฟสในกลุ่มนี้ (${data.phases.length} เฟส REM)` : `โครงการที่เข้าร่วมโปรแกรมนี้ (${data.phases.length} โครงการ)`}
            </p>
            <p className="workspace-member-note">
              {level === "project_group"
                ? "ข้อมูล KM, FAQ และโปรโมชันที่อนุมัติในหน้านี้จะส่งต่อไปยังทุกเฟสด้านล่างโดยอัตโนมัติ"
                : "เนื้อหาโปรแกรมและ FAQ ในหน้านี้ใช้ร่วมกับโครงการที่เข้าร่วมด้านล่าง"}
            </p>
          </div>
          <span className="km-phase-badge">{data.phases.length} {level === "project_group" ? "เฟส" : "โครงการ"}</span>
        </div>
        <ul className="km-member-list">
          {visibleMembers.map(member => (
            <li key={member.rem_project_id}>
              <Link prefetch={false} className="km-member-link" href={workspaceHref({ level: "project", id: member.public_project_id, tab: "data" })}>
                {workspaceName(member.name)} · {member.rem_project_id}
              </Link>
            </li>
          ))}
        </ul>
        {data.phases.length > 8 && (
          <div>
            <button type="button" className="button secondary" aria-expanded={showAllMembers} onClick={() => setShowAllMembers(prev => !prev)}>
              {showAllMembers ? `${text.show_less} (${data.phases.length})` : `${text.view_all} (${data.phases.length})`}
            </button>
          </div>
        )}
      </section>
    )}
    <nav className="workspace-tabs" role="tablist" aria-label={text.website}>{tabs.map((value, index) => <button type="button" role="tab" id={`workspace-tab-${value}`} aria-controls={`workspace-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} key={value} disabled={(primaryPending || suggestionEditing || headerBusy) && tab !== value} onClick={() => chooseTab(value)} onKeyDown={event => {
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (primaryPending || suggestionEditing || headerBusy || !direction && !["Home", "End"].includes(event.key)) return; event.preventDefault();
      const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length];
      if (chooseTab(next)) document.getElementById("workspace-tab-" + next)?.focus();
    }}><span className="workspace-tab-step" aria-hidden="true">{index + 1}</span><span>{tabLabels[value]}</span></button>)}</nav>
    <div key={editorRevision} inert={headerBusy} id={`workspace-panel-${tab}`} role="tabpanel" aria-labelledby={`workspace-tab-${tab}`} tabIndex={-1}>
      {tab === "overview" && (section === "preview" ? <><div className="workspace-preview-toolbar"><button type="button" className="button secondary" onClick={() => location.navigate({ section: null })}>← กลับหน้าภาพรวม</button></div><PagePreview endpoint={webPage && sourceVersion ? `v1/admin/web/pages/${encodeURIComponent(webPage)}/versions/${encodeURIComponent(sourceVersion)}?locale=th` : `${workspaceApi(level, id)}/preview?locale=th${data.selected_phase ? "&phase=" + encodeURIComponent(data.selected_phase) : ""}`} /></> : <>
        <div className="workspace-overview-bar">
          <p className="workspace-overview-lead">{tabFlowDescriptions.overview}</p>
          <div className="workspace-overview-actions">
            {tabs.includes("data") && (
              <button type="button" className="button primary" disabled={navLocked} onClick={() => chooseTab("data")}>
                เริ่มจัดการข้อมูล →
              </button>
            )}
            {data.overview.preview_target && <Link prefetch={false} className="button secondary" href={workspaceHref(data.overview.preview_target)}>{text.preview}</Link>}
          </div>
        </div>
        {(level === "project" || level === "brand" || level === "project_group" || level === "corporate") && canViewContextualPromotions && <PromotionOverview summary={data.overview.promotions} level={level} id={id} phase={level === "project" ? data.selected_phase : null} />}
        <div className="workspace-overview"><Items title={text.readiness} emptyLabel={text.readiness_empty} items={[...data.overview.readiness.required.map(item => ({ ...item, priority: "required" as const })), ...data.overview.readiness.recommended.map(item => ({ ...item, priority: "recommended" as const }))]} /><Items title={text.tasks} emptyLabel={text.tasks_empty} items={tasks} hint={level === "project" ? text.project_tasks_hint : undefined} /><section className="workspace-panel" aria-label={text.since_publication}><h2>{text.since_publication}</h2>{data.overview.changes_since_publication.length ? <ContentTimeline compact items={data.overview.changes_since_publication.slice(0, 5)} /> : <p>{text.since_publication_empty}</p>}<Link prefetch={false} className="workspace-history-link" href={workspaceHref({ level, id, tab: "history" })}>{text.view_history}</Link></section></div>
      </>)}
      {tab === "data" && <>{data.sections.some(item => item.tab === "data") && <nav className="workspace-section-states" aria-label={text.data}>{data.sections.filter(item => item.tab === "data").map(item => <Link prefetch={false} key={item.key} className={section === item.target.section || (!section && item.key === "identity") ? "is-current" : undefined} href={workspaceHref(item.target)}>{workspaceName(item.label ?? sectionLabel(item.key))} <ExposureChip exposure={item.ai_exposure} /> · {text[item.state as keyof typeof text] ?? item.state}{item.suggestion_count > 0 && <> · {text.suggestions} {item.suggestion_count}</>}</Link>)}</nav>}
        {publicProject ? <ProjectContentWorkspace projectId={publicProject} embedded primary={primary} supplementary={primary} navigationBlocked={primaryBusy} navigationPending={primaryPending} onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />
          : level === "brand" ? <ProjectContentWorkspace brandId={id} embedded primary={primary} onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />
          : level === "business" && permissions.can("knowledge") ? <BusinessWorkspace code={id} onEditingChange={businessEditing} onWorkflowChanged={onWorkflowChanged} />
          : (level === "corporate" || level === "project_group" || level === "programme") && permissions.can("knowledge") ? <ScopeKmWorkspace scopeType={level} scopeId={id} onEditingChange={businessEditing} onWorkflowChanged={onWorkflowChanged} /> : null}
      </>}
      {tab === "media" && projectSource && <div inert={suggestionEditing}>
        <div className="workspace-media-modes">
          <div className="workspace-media-modes-copy">
            <strong>ขั้นตอนจัดการรูปและสื่อของโครงการ</strong>
            <p>เริ่มจากตรวจสิทธิ์ภาพหลักและภาพย่อที่บังคับก่อนเผยแพร่ แล้วจึงเติมคลังภาพส่วนกลาง อาคาร และคลิปทัวร์ 360°</p>
          </div>
          <nav className="content-tabs" aria-label="หมวดหลักของรูปและสื่อ">
            <button type="button" className="button secondary" aria-current={section === "canonical" ? "page" : undefined} disabled={primaryPending} onClick={() => location.navigate({ section: "canonical" }, !editing && !primaryPending)}>{text.canonicalMedia}</button>
            <button type="button" className="button secondary" aria-current={section !== "canonical" ? "page" : undefined} disabled={primaryBusy} onClick={() => location.navigate({ section: "library" }, !editing && !primaryBusy)}>{text.media}</button>
          </nav>
        </div>
        {section !== "canonical" && <ProjectMediaWorkspace projectId={publicProject!} embedded onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />}
      </div>}
      {projectSource && (tab === "unit-types" || tab === "media") && <WebsiteContentSources key={publicProject + ":" + tab} projectId={publicProject!} section={tab} disabled={primaryDirty || primaryBusy || editing} onEditingChange={setSuggestionEditing} onChanged={async () => { onWorkflowChanged(); }} />}
      {tab === "faq" && permissions.can("knowledge") && <FaqWorkspace embedded scope={scope} entity={context} onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />}
      {tab === "promotions" && (level === "project" || level === "brand" || level === "project_group" || level === "corporate") && <ContextualPromotions level={level} id={id} phase={level === "project" ? data.selected_phase : null} filter={location.params.get("filter") ?? "all"} />}
      {hasSourceTabs && !sourceVersion && !sourceDraft && (publicProject && permissions.can("projects") || level === "brand" && permissions.can("brands")) && <details className="workspace-persistent-editor" key={publicProject ?? id} hidden={!showPrimary} inert={suggestionEditing} open={tab !== "history" || level === "brand" || legacyHistoryOpen}><summary hidden={tab !== "history" || level === "brand"}>{text.PUBLISHED} · {text.history}</summary>
        {publicProject ? <ProjectDetail projectId={publicProject} role={role} onDirtyChange={setPrimaryDirty} onRelatedEditingChange={setPrimaryBusy} onPendingChange={setPrimaryPending} onEmbeddedTabChange={editorTab} onRevealField={editorField} onWorkflowChanged={onWorkflowChanged} embeddedTab={primaryTab} /> : <BrandDetail brandId={id} role={role} onDirtyChange={setPrimaryDirty} onWorkflowChanged={onWorkflowChanged} onPendingChange={setPrimaryPending} history={tab === "history" ? <ContentHistory level={level} id={id} /> : undefined} embedded={tab === "history" ? "history" : tab === "media" ? "media" : "data"} />}
      </details>}
      {tab === "history" && <>{hasSourceTabs && (sourceVersion || sourceDraft) && (publicProject || level === "brand") && <ContentSource kind={level === "brand" ? "brand" : "project"} publicId={publicProject ?? id} version={sourceVersion} draftAt={sourceDraft} allowed={permissions.can(level === "brand" ? "brands" : "projects")} />}
        {(level !== "brand" || sourceVersion || sourceDraft) && <ContentHistory level={level} id={id} />}
      </>}
      {tab !== "overview" && tabs.length > 1 && (
        <nav className="workspace-flow-footer" aria-label="นำทางขั้นตอนถัดไป" data-assistant-clearance="overlap">
          <div className="workspace-flow-current">
            <span className="workspace-flow-eyebrow">ขั้นตอนหลักที่ {activeTabIndex + 1} จาก {tabs.length} · {tabLabels[tab]}</span>
            <p>{tabFlowDescriptions[tab]}</p>
          </div>
          <div className="workspace-flow-buttons">
            {prevTab && (
              <button type="button" className="button secondary" disabled={navLocked} onClick={() => { if (chooseTab(prevTab)) window.scrollTo({ top: 0, behavior: "instant" }); }}>
                ← {tabLabels[prevTab]}
              </button>
            )}
            {nextTab && (
              <button type="button" className="button primary" disabled={navLocked} onClick={() => { if (chooseTab(nextTab)) window.scrollTo({ top: 0, behavior: "instant" }); }}>
                ขั้นตอนถัดไป: {tabLabels[nextTab]} →
              </button>
            )}
          </div>
        </nav>
      )}
    </div>
  </div>;
}

