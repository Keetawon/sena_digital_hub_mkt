"use client";
import { ContentBuNotices } from "./content-bu-notices";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { canWorkspace, capabilityKey } from "@/lib/hub-permissions";
import { roleLabels, type LocalRole } from "@/lib/roles";
import { workspaceCopy as copy } from "@/lib/workspace-copy";
import { LocalPersonaPicker, useHubPermissions } from "./accounts";
import { HubShell } from "./hub-shell";
import { useHostedSession } from "./hosted-session";
import { openWorkspaceAssistant } from "./hub-assistant";
import { WorkspaceSearch, workspaceLabel } from "./workspace-search";
import { FaqCoverage } from "./faq-coverage";
import { workspaceText, workspaceHref } from "@/lib/unified-workspace";
import { request } from "./hub-request";
import type { WorkspaceTarget } from "@/lib/unified-workspace";
import "./workspace-home.css";

type Label = { th?: string; en?: string };
type Task = { id: string; category: keyof typeof taskLabels; label: Label; project?: string; project_name?: Label; href: string; due?: string; question_text_available?: boolean; occurrences?: number; last_seen?: string; context: { project?: string; brand?: string } };
type Readiness = { required_missing: number; items: { field_key: string; label: Label; complete: boolean; required: boolean; href: string }[] };
type Home = {
  projects: { ref: string; name: Label; href: string; readiness: Readiness }[]; project_total: number;
  brands: { ref: string; name: Label; projects: number; required_missing: number; project_required_missing: number; readiness: Readiness }[];
  buds: { id: string; code: string | null; name: string | null; projects: number; required_missing: number }[];
  tasks: Task[]; task_total: number; selected_gap: Task | null; offset: number; limit: number;
};
const taskLabels = { returned: copy.returned_task, approval: copy.approval_task, publish: copy.publish_task, expiring: copy.expiring_task, fact_missing: copy.missing_fact_task, review_due: copy.review_task, unanswered: copy.unanswered_task };
const date = (value: string) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));

function HomeContent({ hosted }: { hosted: boolean }) {
  const params = useSearchParams(); const router = useRouter();
  const permissions = useHubPermissions();
  const canCoverage = permissions.can("knowledge") && permissions.can("projects");
  const coverage = params.get("section") === "coverage";
  const [coverageError, setCoverageError] = useState(false);
  async function openFaq(id: string) {
    setCoverageError(false);
    try { router.push(workspaceHref(await request<WorkspaceTarget>(`v1/admin/content/workspace/resolve?faq=${encodeURIComponent(id)}`))); }
    catch { setCoverageError(true); }
  }
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState(false); const [retry, setRetry] = useState(0);
  const filters = new URLSearchParams();
  for (const key of ["bud", "brand", "task", "offset", "gap"]) { const value = params.get(key); if (value) filters.set(key, value); }
  const query = filters.toString();
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    (async () => {
      try {
        const response = await fetch(`/api/hub/v1/admin/content/home?${query}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok && body.error?.invalidate_access === true && !controller.signal.aborted) window.dispatchEvent(new Event("hub-content-access-invalidated"));
        if (!response.ok) throw new Error();
        if (!controller.signal.aborted) setData(body.data);
      } catch { if (!controller.signal.aborted) setError(true); }
    })();
    return () => controller.abort();
  }, [query, retry]);
  useEffect(() => {
    if (data?.selected_gap) document.getElementById(`selected-${data.selected_gap.id}`)?.focus();
  }, [data, params]);
  const link = (key: string, value: string) => {
    const next = new URLSearchParams(query); next.delete("offset"); next.delete("gap");
    if (value) next.set(key, value); else next.delete(key);
    return `/home${next.size ? `?${next}` : ""}`;
  };
  const pageLink = (offset: number) => { const next = new URLSearchParams(query); next.set("offset", String(offset)); return `/home?${next}`; };
  return <div className="workspace-home">
    <section className="workspace-home-hero"><h1>{copy.greeting}</h1><WorkspaceSearch hosted={hosted} home />
      {data && data.tasks.length > 0 && <div className="workspace-home-examples">{data.tasks.slice(0, 3).map(task => <button className="button secondary" type="button" key={task.id} disabled={hosted} title={hosted ? copy.assistant_disabled : undefined} onClick={event => openWorkspaceAssistant(`${copy.task_question}: ${workspaceLabel(task.label)}`, task.context.project ? { project_id: task.context.project } : task.context.brand ? { brand_id: task.context.brand } : {}, event.currentTarget)}>{copy.ask_prefix}{workspaceLabel(task.label)}</button>)}</div>}
    </section>
    {(canCoverage || coverage) && <section className="workspace-home-card" aria-label={workspaceText.coverage}>
      {canCoverage && <a href="/home?section=coverage">{workspaceText.coverage}</a>}
      {coverageError && <p role="alert">{copy.load_error}</p>}
      {coverage && <FaqCoverage onOpenFaq={id => void openFaq(id)} />}
    </section>}
    <ContentBuNotices quiet />
    {error ? <p role="alert">{copy.load_error} <button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>{copy.retry}</button></p> : !data ? <p role="status">{copy.loading}</p> : <>
      {data.selected_gap && <section className="workspace-home-card workspace-home-gap" id={`selected-${data.selected_gap.id}`} tabIndex={-1} aria-label={copy.unanswered_task}><h2>{copy.unanswered_task}</h2><h3>{workspaceLabel(data.selected_gap.label)}</h3><p>{copy.unanswered_note}</p>{data.selected_gap.last_seen && <p className="workspace-home-meta">{copy.date}: {date(data.selected_gap.last_seen)}</p>}{data.selected_gap.context.project && <a href={`/?project=${encodeURIComponent(data.selected_gap.context.project)}`}>{copy.project}</a>}</section>}
      <div className="workspace-home-filters">
        <label>BUD<select value={params.get("bud") ?? ""} onChange={event => router.push(link("bud", event.target.value))}><option value="">{copy.all}</option>{data.buds.map(bud => <option key={bud.id} value={bud.id}>{[bud.code, bud.name].filter(Boolean).join(" · ") || bud.id}</option>)}</select></label>
        <label>{copy.brand}<select value={params.get("brand") ?? ""} onChange={event => router.push(link("brand", event.target.value))}><option value="">{copy.all}</option>{data.brands.map(brand => <option key={brand.ref} value={brand.ref}>{workspaceLabel(brand.name)}</option>)}</select></label>
        <label>{copy.tasks}<select value={params.get("task") ?? ""} onChange={event => router.push(link("task", event.target.value))}><option value="">{copy.all}</option>{Object.entries(taskLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <section className="workspace-home-card" aria-labelledby="workspace-tasks"><h2 id="workspace-tasks">{copy.tasks} <small>({data.task_total})</small></h2>
        {!data.tasks.length ? <p>{params.get("bud") || params.get("brand") || params.get("task") ? copy.empty : copy.tasks_empty}</p> : <ul>{data.tasks.map(task => <li key={task.id} id={task.id} className="workspace-home-gap" tabIndex={task.question_text_available === false ? -1 : undefined}>
          <p className="workspace-home-meta">{taskLabels[task.category]}{task.project_name && ` · ${workspaceLabel(task.project_name)}`}{task.due && ` · ${copy.date}: ${date(task.due)}`}</p>
          <a href={task.href}>{workspaceLabel(task.label)}</a>
          {task.question_text_available === false && <p>{copy.unanswered_note}{task.last_seen && ` · ${date(task.last_seen)}`}</p>}
        </li>)}</ul>}
      </section>
      <section aria-labelledby="workspace-readiness"><h2 id="workspace-readiness">{copy.readiness}</h2><div className="workspace-home-grid">
        <section className="workspace-home-card"><h3>BUD</h3>{!data.buds.length ? <p>{params.get("bud") || params.get("brand") ? copy.empty : copy.home_buds_empty}</p> : <ul>{data.buds.map(bud => <li className="workspace-home-group" key={bud.id}><a href={link("bud", bud.id)}>{[bud.code, bud.name].filter(Boolean).join(" · ") || bud.id}</a><span>{copy.required_missing}: {bud.required_missing}</span></li>)}</ul>}</section>
        <section className="workspace-home-card"><h3>{copy.brand}</h3>{!data.brands.length ? <p>{params.get("bud") || params.get("brand") ? copy.empty : copy.home_brands_empty}</p> : <ul>{data.brands.map(brand => <li key={brand.ref}><div className="workspace-home-group"><a href={link("brand", brand.ref)}>{workspaceLabel(brand.name)}</a><span>{copy.required_missing}: {brand.required_missing}</span></div>{brand.readiness.items.filter(field => !field.complete).map(field => <p key={field.field_key}><a href={field.href}>{workspaceLabel(field.label)}</a></p>)}</li>)}</ul>}</section>
      </div></section>
      <section aria-labelledby="workspace-projects"><h2 id="workspace-projects">{copy.project} <small>({data.project_total})</small></h2><div className="workspace-home-grid">{data.projects.map(project => <article className="workspace-home-card" key={project.ref}><h3><a href={project.href}>{workspaceLabel(project.name)}</a></h3><p>{copy.required_missing}: {project.readiness.required_missing}</p><details><summary>{copy.readiness}</summary><ul>{project.readiness.items.filter(field => !field.complete).map((field, index) => <li key={`${field.field_key}:${index}`}><a href={field.href}>{workspaceLabel(field.label)}</a></li>)}</ul></details></article>)}</div></section>
      <nav className="workspace-home-pagination" aria-label={copy.home}>{data.offset > 0 && <a className="button secondary" href={pageLink(Math.max(0, data.offset - data.limit))}>{copy.previous}</a>}{data.offset + data.limit < Math.max(data.project_total, data.task_total) && <a className="button secondary" href={pageLink(data.offset + data.limit)}>{copy.next}</a>}</nav>
    </>}
  </div>;
}

export function WorkspaceHome({ localMode, initialRole }: { localMode: boolean; initialRole: LocalRole | null }) {
  const permissions = useHubPermissions(); const hosted = Boolean(useHostedSession());
  const allowed = permissions.account?.status === "ACTIVE" && canWorkspace(permissions.capabilities);
  return <HubShell section="projects" workspace staff={allowed} roleLabel={permissions.account?.display_name_th || (initialRole ? roleLabels[initialRole] : copy.home)} toolbar={localMode && <div className="workspace-home-persona"><LocalPersonaPicker initialRole={initialRole} /></div>}>
    {allowed && <HomeContent key={capabilityKey(permissions.account)} hosted={hosted} />}
  </HubShell>;
}
