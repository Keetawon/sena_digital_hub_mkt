"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import type { LocalRole } from "@/lib/local-session";
import { ProjectOverview } from "./hub-admin";
import { BrandWorkspace } from "./brand-admin";
import { useContentLocation } from "./content-operations-shared";
import { scopeLabels } from "./faq-bank";
import { request } from "./hub-request";
import { errorMessage } from "./content-common";
import { workspaceHref, workspaceName, workspaceText as text, type WorkspaceLevel, type WorkspaceTarget } from "@/lib/unified-workspace";
import "./unified-workspace.css";
type TreeItem = { key: string; kind: WorkspaceLevel; ref: string; name: { th?: string; en?: string }; target: WorkspaceTarget; parent: { kind: WorkspaceLevel; ref: string } | null; has_children: boolean; visible_phase_count: number; grouping: { state: "confirmed" | "unconfirmed" | "conflict"; group_ref: string | null; review_href?: string | null } };
type TreePage = { items: TreeItem[]; programmes?: TreeItem[]; next_cursor: string | null };
function TreeBranch({ parent, query, intent, authority }: { parent?: TreeItem; query: string; intent: string | null; authority: string }) {
  const [data, setData] = useState<TreePage | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [retry, setRetry] = useState(0);
  const parameters = new URLSearchParams({ q: query, limit: "50" });
  if (parent) { parameters.set("parent_kind", parent.kind); parameters.set("parent_ref", parent.ref); }
  const path = `v1/admin/content/workspace/tree?${parameters}`;
  const pageGeneration = useRef(0);
  useEffect(() => {
    pageGeneration.current += 1;
    let live = true; setData(null); setError(""); setPending(true);
    request<TreePage>(path).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [path, authority, retry]);
  async function more() {
    if (!data?.next_cursor || pending) return; setPending(true); setError("");
    const generation = pageGeneration.current;
    try { const value = await request<TreePage>(path + "&after=" + encodeURIComponent(data.next_cursor)); if (generation !== pageGeneration.current) return; setData(current => current && ({ ...value, programmes: current.programmes ?? value.programmes, items: [...current.items, ...value.items], next_cursor: value.next_cursor })); }
    catch (e) { if (generation === pageGeneration.current) setError(errorMessage(e)); } finally { if (generation === pageGeneration.current) setPending(false); }
  }
  return <>{error && <p className="notice error" role="alert">{error} <button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>}
    {!data && pending && <p role="status">{text.loading}</p>}
    {data && <><ul className="workspace-tree">{data.items.map(item => <li key={item.key}>
      <div className="workspace-tree-row"><a href={workspaceHref({ ...item.target, ...(intent === "faq" || intent === "media" ? { tab: intent } : {}) })}>{workspaceName(item.name)}</a>
        {item.grouping.review_href && <a href={item.grouping.review_href}>{text.groups} · {text.settings}</a>}
        {item.visible_phase_count > 1 && <span>{item.visible_phase_count} {text.phase}</span>}
      </div>
      {item.has_children && <details open={opened[item.key] ?? false} onToggle={event => { const open = event.currentTarget.open; setOpened(current => current[item.key] === open ? current : { ...current, [item.key]: open }); }}>
        <summary>{text.scope} · {workspaceName(item.name)}</summary>{opened[item.key] && <TreeBranch parent={item} query={query} intent={intent} authority={authority} />}
      </details>}
    </li>)}</ul>{!parent && Boolean(data.programmes?.length) && <section className="workspace-programmes"><h2>{scopeLabels.programme}</h2><ul className="workspace-items">{data.programmes!.map(item => <li key={item.key}><a href={workspaceHref({ ...item.target, ...(intent === "faq" || intent === "media" ? { tab: intent } : {}) })}>{workspaceName(item.name)}</a></li>)}</ul></section>}{!data.items.length && !data.programmes?.length && <p>{text.empty}</p>}{data.next_cursor && <button className="button secondary" disabled={pending} onClick={() => void more()}>{text.more}</button>}</>}
  </>;
}
export function WebsiteTree({ role }: { role: LocalRole }) {
  const permissions = useHubPermissions(), query = useSearchParams();
  const authority = capabilityKey(permissions.account);
  const [dirty, setDirty] = useState(false); useContentLocation(dirty);
  const view = query.get("view");
  const [search, setSearch] = useState(query.get("q") ?? ""), [term, setTerm] = useState(query.get("q") ?? "");
  const [error, setError] = useState("");
  const legacyFaq = query.get("legacy_faq"), legacyCluster = query.get("legacy_cluster"), phase = query.get("phase");
  useEffect(() => {
    let live = true; setError("");
    if (!legacyFaq && !legacyCluster) return;
    const values = new URLSearchParams(legacyFaq ? { faq: legacyFaq } : { cluster: legacyCluster! });
    if (phase) values.set("phase", phase);
    request<WorkspaceTarget>(`v1/admin/content/workspace/resolve?${values}`).then(target => { if (live) window.location.replace(workspaceHref(target)); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [legacyFaq, legacyCluster, phase, authority]);
  return <section className="unified-workspace"><header className="workspace-heading">{view ? <a href="/website">{text.website}</a> : <h1>{text.website}</h1>}</header>
    <nav className="content-tabs" aria-label={text.website}>{permissions.can("projects") && <a className="button secondary" href="/website?view=projects">{text.projects}</a>}{permissions.can("brands") && <a className="button secondary" href="/website?view=brands">{text.brands}</a>}</nav>
    {["projects", "groups"].includes(view ?? "") && permissions.can("projects") ? <ProjectOverview role={role} /> : view === "brands" && permissions.can("brands") ? <BrandWorkspace brandId={null} role={role} onDirtyChange={setDirty} /> : <>
    <form className="workspace-tree-search" onSubmit={event => { event.preventDefault(); setTerm(search.trim()); }}><label>{text.search}<input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button secondary">{text.search}</button></form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {legacyFaq || legacyCluster ? !error && <p role="status">{text.loading}</p> : <TreeBranch query={term} intent={query.get("intent")} authority={authority} />}
    </>}
  </section>;
}

