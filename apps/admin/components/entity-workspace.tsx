"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { ExposureChip } from "./content-exposure";
import { SavedContentSubmission } from "./content-workflow";
import type { SubmissionOutcome } from "@/lib/content-workflow";
import { ContentSource } from "./content-source";
import { ContentHistory, ContentTimeline } from "./content-history";
import { legacyWorkspaceHref, workspaceApi, workspaceHref, workspaceName, workspaceText as text, workspaceTabs, tabLabels, type WorkspaceEntity, type WorkspaceItem, type WorkspaceLevel, type WorkspaceTab } from "@/lib/unified-workspace";
import "./unified-workspace.css";
type OverviewItem = WorkspaceItem & { priority?: "required" | "recommended" };
function ItemLinks({ items }: { items: OverviewItem[] }) {
  return <ul className="workspace-items">{items.map((item, index) => <li key={item.code + index}>
    <a href={workspaceHref(item.target)}>{item.context && <>{text[`context_${item.context.kind}`]} {workspaceName(item.context.label)} · </>}{workspaceName(item.label)}</a>
    {item.priority && <span>{text[item.priority]}</span>}{item.state && text[item.state.toUpperCase() as keyof typeof text] && <span>{text[item.state.toUpperCase() as keyof typeof text]}</span>}
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
function Items({ title, items }: { title: string; items: OverviewItem[] }) {
  const groups = new Map<string, { name: string; items: OverviewItem[] }>();
  for (const item of items) {
    const section = item.target.section, key = item.target.tab + ":" + (section ?? "");
    const group = groups.get(key) ?? { name: tabLabels[item.target.tab] + (section ? " · " + (section === "commercial" ? text.section_commercial : section === "investor" ? text.section_investor : sectionLabel(section)) : ""), items: [] };
    group.items.push(item); groups.set(key, group);
  }
  return <section className="workspace-panel" aria-label={title}><h2>{title} <span className="workspace-count">{items.length} {text.item_count}</span></h2>
    {items.length ? Array.from(groups, ([key, group]) => <ItemGroup key={key} {...group} />) : <p>{text.empty}</p>}
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
  const [headerBusy, setHeaderBusy] = useState(false), [inventoryRevision, setInventoryRevision] = useState(0), [editorRevision, setEditorRevision] = useState(0);
  const location = useContentLocation(primaryDirty || editing || suggestionEditing || headerBusy), root = useRef<HTMLDivElement>(null);
  const [legacyHistoryOpen, setLegacyHistoryOpen] = useState(false);
  const phase = location.params.get("phase"), section = location.params.get("section"), queryTab = location.params.get("tab");
  const path = workspaceApi(level, id) + (phase ? "?phase=" + encodeURIComponent(phase) : "");
  const activeIdentity = path + authority, active = useRef(activeIdentity); active.current = activeIdentity;
  const refreshSummary = useCallback(async () => {
    try { const value = await request<WorkspaceEntity>(path); if (active.current === activeIdentity) { setData(value); setError(""); } }
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
    let live = true; setData(null); setError(""); setEditing(false); setPrimaryDirty(false); setPrimaryBusy(false); setPrimaryPending(false); setSuggestionEditing(false); setHeaderBusy(false);
    request<WorkspaceEntity>(path).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [path, authority, retry]);
  const tabs = workspaceTabs.filter(tab => data?.tabs.includes(tab));
  const tab = tabs.includes(queryTab as WorkspaceTab) ? queryTab as WorkspaceTab : tabs[0] ?? "overview";
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
  if (!data) return <section className="unified-workspace"><a href="/website">{text.website}</a>{error ? <p className="notice error" role="alert">{error}<button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p> : <p role="status">{text.loading}</p>}</section>;
  const selected = data.phases.find(item => item.rem_project_id === data.selected_phase);
  const publicProject = selected?.public_project_id ?? (level === "project" ? id : null);
  const hasSourceTabs = data.tabs.some(value => value === "data" || value === "unit-types" || value === "media");
  const projectSource = Boolean(publicProject && hasSourceTabs && permissions.can("projects"));
  const projectFaq = level === "project" && data.selected_phase;
  const scope = { type: projectFaq ? "project" : data.entity.scope_type, id: projectFaq || data.entity.scope_id, name: workspaceName(projectFaq ? selected?.name ?? data.entity.name : data.entity.name) };
  const context = { level, id, phase: data.selected_phase };
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
  return <div className="unified-workspace" ref={root}>
    <header className="workspace-heading"><div><WorkspaceBack fallback="/website" label={text.website} /><h1>{workspaceName(data.entity.name)}</h1></div>
      {data.phases.length > 1 && <label className="content-input">{text.phase}<select disabled={primaryBusy || suggestionEditing || headerBusy} value={data.selected_phase ?? ""} onChange={event => location.navigate({ phase: event.target.value, field: null, item: null, faq: null, cluster: null, unit_type: null })}>{data.phases.map(item => <option key={item.rem_project_id} value={item.rem_project_id}>{workspaceName(item.name)} · {item.rem_project_id}</option>)}</select></label>}
      <SavedContentSubmission scope={level === "business" ? null : { level, id, phase: level === "project" || level === "unit_type" ? data.selected_phase : null }} revision={inventoryRevision}
        disabled={primaryDirty || primaryBusy || editing || suggestionEditing} onBusyChange={setHeaderBusy} onChanged={submitted}
        onExposureChanged={() => { setEditorRevision(value => value + 1); onWorkflowChanged(); }} />
    </header>
    {error && <p className="notice error" role="alert">{error}</p>}
    {data.entity.grouping?.review_href && <p><a href={data.entity.grouping.review_href}>{text.groups} · {text.settings}</a></p>}
    <nav className="workspace-tabs" role="tablist" aria-label={text.website}>{tabs.map((value, index) => <button type="button" role="tab" id={`workspace-tab-${value}`} aria-controls={`workspace-panel-${value}`} aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} key={value} disabled={(primaryPending || suggestionEditing || headerBusy) && tab !== value} onClick={() => chooseTab(value)} onKeyDown={event => {
      const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (primaryPending || suggestionEditing || headerBusy || !direction && !["Home", "End"].includes(event.key)) return; event.preventDefault();
      const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + direction + tabs.length) % tabs.length];
      if (chooseTab(next)) document.getElementById("workspace-tab-" + next)?.focus();
    }}>{tabLabels[value]}</button>)}</nav>
    <div key={editorRevision} inert={headerBusy} id={`workspace-panel-${tab}`} role="tabpanel" aria-labelledby={`workspace-tab-${tab}`} tabIndex={-1}>
      {tab === "overview" && (section === "preview" ? <PagePreview endpoint={webPage && sourceVersion ? `v1/admin/web/pages/${encodeURIComponent(webPage)}/versions/${encodeURIComponent(sourceVersion)}?locale=th` : `${workspaceApi(level, id)}/preview?locale=th${data.selected_phase ? "&phase=" + encodeURIComponent(data.selected_phase) : ""}`} /> : <>
        {data.overview.preview_target && <p><a className="button secondary" href={workspaceHref(data.overview.preview_target)}>{text.preview}</a></p>}
        <div className="workspace-overview"><Items title={text.readiness} items={[...data.overview.readiness.required.map(item => ({ ...item, priority: "required" as const })), ...data.overview.readiness.recommended.map(item => ({ ...item, priority: "recommended" as const }))]} /><Items title={text.tasks} items={data.overview.tasks} /><section className="workspace-panel" aria-label={text.since_publication}><h2>{text.since_publication}</h2>{data.overview.changes_since_publication.length ? <ContentTimeline compact items={data.overview.changes_since_publication.slice(0, 5)} /> : <p>{text.empty}</p>}<a className="workspace-history-link" href={workspaceHref({ level, id, tab: "history" })}>{text.view_history}</a></section></div>
      </>)}
      {tab === "data" && <><nav className="workspace-section-states" aria-label={text.data}>{data.sections.filter(item => item.tab === "data").map(item => <a key={item.key} href={workspaceHref(item.target)}>{workspaceName(item.label ?? sectionLabel(item.key))} <ExposureChip exposure={item.ai_exposure} /> · {text[item.state as keyof typeof text] ?? item.state}{item.suggestion_count > 0 && <> · {text.suggestions} {item.suggestion_count}</>}</a>)}</nav>
        {publicProject ? <ProjectContentWorkspace projectId={publicProject} embedded primary={primary} supplementary={primary} navigationBlocked={primaryBusy} navigationPending={primaryPending} onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />
          : level === "brand" ? <ProjectContentWorkspace brandId={id} embedded primary={primary} onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />
          : level === "corporate" ? <FaqWorkspace embedded initialSection="contacts" scope={scope} onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} /> : null}
      </>}
      {tab === "media" && projectSource && <div inert={suggestionEditing}><nav className="content-tabs"><button className="button secondary" disabled={primaryPending} onClick={() => location.navigate({ section: "canonical" }, !editing && !primaryPending)}>{text.canonicalMedia}</button><button className="button secondary" disabled={primaryBusy} onClick={() => location.navigate({ section: "library" }, !editing && !primaryBusy)}>{text.media}</button></nav>{section !== "canonical" && <ProjectMediaWorkspace projectId={publicProject!} embedded onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />}</div>}
      {projectSource && (tab === "unit-types" || tab === "media") && <WebsiteContentSources key={publicProject + ":" + tab} projectId={publicProject!} section={tab} disabled={primaryDirty || primaryBusy || editing} onEditingChange={setSuggestionEditing} onChanged={async () => { onWorkflowChanged(); }} />}
      {tab === "faq" && permissions.can("knowledge") && <FaqWorkspace embedded scope={scope} entity={context} onEditingChange={setEditing} onWorkflowChanged={onWorkflowChanged} />}
      {hasSourceTabs && !sourceVersion && !sourceDraft && (publicProject && permissions.can("projects") || level === "brand" && permissions.can("brands")) && <details className="workspace-persistent-editor" key={publicProject ?? id} hidden={!showPrimary} inert={suggestionEditing} open={tab !== "history" || level === "brand" || legacyHistoryOpen}><summary hidden={tab !== "history" || level === "brand"}>{text.PUBLISHED} · {text.history}</summary>
        {publicProject ? <ProjectDetail projectId={publicProject} role={role} onDirtyChange={setPrimaryDirty} onRelatedEditingChange={setPrimaryBusy} onPendingChange={setPrimaryPending} onEmbeddedTabChange={editorTab} onRevealField={editorField} onWorkflowChanged={onWorkflowChanged} embeddedTab={primaryTab} /> : <BrandDetail brandId={id} role={role} onDirtyChange={setPrimaryDirty} onWorkflowChanged={onWorkflowChanged} onPendingChange={setPrimaryPending} history={tab === "history" ? <ContentHistory level={level} id={id} /> : undefined} embedded={tab === "history" ? "history" : tab === "media" ? "media" : "data"} />}
      </details>}
      {tab === "history" && <>{hasSourceTabs && (sourceVersion || sourceDraft) && (publicProject || level === "brand") && <ContentSource kind={level === "brand" ? "brand" : "project"} publicId={publicProject ?? id} version={sourceVersion} draftAt={sourceDraft} allowed={permissions.can(level === "brand" ? "brands" : "projects")} />}
        {(level !== "brand" || sourceVersion || sourceDraft) && <ContentHistory level={level} id={id} />}
      </>}
    </div>
  </div>;
}

