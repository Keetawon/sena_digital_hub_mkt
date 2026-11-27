"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import type { LocalRole } from "@/lib/local-session";
import { ProjectOverview } from "./hub-admin";
import { BrandWorkspace } from "./brand-admin";
import { KmBusinessesView, KmProjectGroupsView } from "./km-hubs";
import { useContentLocation } from "./content-operations-shared";
import { scopeLabels } from "./faq-bank";
import { request } from "./hub-request";
import { errorMessage } from "./content-common";
import { workspaceHref, workspaceName, workspaceText as text, type WorkspaceLevel, type WorkspaceTarget } from "@/lib/unified-workspace";
import "./unified-workspace.css";
type TreeItem = { key: string; kind: WorkspaceLevel; ref: string; name: { th?: string; en?: string }; target: WorkspaceTarget; parent: { kind: WorkspaceLevel; ref: string } | null; has_children: boolean; visible_phase_count: number; grouping: { state: "confirmed" | "unconfirmed" | "conflict"; group_ref: string | null; review_href?: string | null } };
type TreePage = { items: TreeItem[]; programmes?: TreeItem[]; next_cursor: string | null };

const treePageCache = new Map<string, { value: TreePage; expiresAt: number }>();
const treeInFlight = new Map<string, Promise<TreePage>>();
if (typeof window !== "undefined") {
  const clear = () => { treePageCache.clear(); treeInFlight.clear(); };
  window.addEventListener("hub-accounts-changed", clear);
  window.addEventListener("hub-content-access-invalidated", clear);
}

function buildTreePath(query: string, parent?: TreeItem) {
  const parameters = new URLSearchParams({ q: query, limit: "50" });
  if (parent) { parameters.set("parent_kind", parent.kind); parameters.set("parent_ref", parent.ref); }
  return `v1/admin/content/workspace/tree?${parameters}`;
}

function fetchTreePage(authority: string, path: string, force = false): Promise<TreePage> {
  const cacheKey = `${authority}::${path}`;
  if (!force) {
    const hit = treePageCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
    const pending = treeInFlight.get(cacheKey);
    if (pending) return pending;
  } else {
    treePageCache.delete(cacheKey);
  }
  const promise = request<TreePage>(path).then(value => {
    if (treePageCache.size >= 100) {
      const oldest = treePageCache.keys().next().value;
      if (oldest) treePageCache.delete(oldest);
    }
    treePageCache.set(cacheKey, { value, expiresAt: Date.now() + 20_000 });
    return value;
  }).finally(() => {
    treeInFlight.delete(cacheKey);
  });
  treeInFlight.set(cacheKey, promise);
  return promise;
}

function TreeBranch({ parent, query, intent, authority }: { parent?: TreeItem; query: string; intent: string | null; authority: string }) {
  const path = buildTreePath(query, parent);
  const initialHit = treePageCache.get(`${authority}::${path}`);
  const initialData = initialHit && initialHit.expiresAt > Date.now() ? initialHit.value : null;
  const [data, setData] = useState<TreePage | null>(initialData), [error, setError] = useState(""), [pending, setPending] = useState(!initialData);
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState<Record<string, boolean>>({});
  const [retry, setRetry] = useState(0);
  const pageGeneration = useRef(0);
  useEffect(() => {
    pageGeneration.current += 1;
    let live = true;
    const hit = retry === 0 ? treePageCache.get(`${authority}::${path}`) : undefined;
    if (hit && hit.expiresAt > Date.now()) {
      setData(hit.value); setError(""); setPending(false);
      return;
    }
    setData(null); setError(""); setPending(true);
    fetchTreePage(authority, path, retry > 0).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [path, authority, retry]);
  async function more() {
    if (!data?.next_cursor || pending) return; setPending(true); setError("");
    const generation = pageGeneration.current;
    try {
      const value = await request<TreePage>(path + "&after=" + encodeURIComponent(data.next_cursor));
      if (generation !== pageGeneration.current) return;
      setData(current => {
        if (!current) return current;
        const merged = { ...value, programmes: current.programmes ?? value.programmes, items: [...current.items, ...value.items], next_cursor: value.next_cursor };
        treePageCache.set(`${authority}::${path}`, { value: merged, expiresAt: Date.now() + 20_000 });
        return merged;
      });
    }
    catch (e) { if (generation === pageGeneration.current) setError(errorMessage(e)); } finally { if (generation === pageGeneration.current) setPending(false); }
  }
  function prefetchChild(item: TreeItem) {
    if (!item.has_children) return;
    void fetchTreePage(authority, buildTreePath(query, item)).catch(() => {});
  }
  return <>{error && <p className="notice error" role="alert">{error} <button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>}
    {!data && pending && <p role="status">{text.loading}</p>}
    {data && <><ul className="workspace-tree">{data.items.map(item => <li key={item.key}>
      <div className="workspace-tree-row"><Link prefetch={false} href={workspaceHref({ ...item.target, ...(intent === "faq" || intent === "media" ? { tab: intent } : {}) })}>{workspaceName(item.name)}</Link>
        {item.grouping.review_href && <Link prefetch={false} className="button secondary" href={item.grouping.review_href}>แก้ไขข้อมูล</Link>}
        {item.visible_phase_count > 1 && <span>{item.visible_phase_count} {text.phase}</span>}
      </div>
      {item.has_children && <details open={opened[item.key] ?? false} onToggle={event => {
        const open = event.currentTarget.open;
        setOpened(current => current[item.key] === open ? current : { ...current, [item.key]: open });
        if (open) setMounted(current => current[item.key] ? current : { ...current, [item.key]: true });
      }}>
        <summary onMouseEnter={() => prefetchChild(item)} onFocus={() => prefetchChild(item)}>{text.scope} · {workspaceName(item.name)}</summary>
        {(opened[item.key] || mounted[item.key]) && <div hidden={!opened[item.key]}><TreeBranch parent={item} query={query} intent={intent} authority={authority} /></div>}
      </details>}
    </li>)}</ul>{!parent && Boolean(data.programmes?.length) && <section className="workspace-programmes"><h2>{scopeLabels.programme}</h2><ul className="workspace-items">{data.programmes!.map(item => <li key={item.key}><Link prefetch={false} href={workspaceHref({ ...item.target, ...(intent === "faq" || intent === "media" ? { tab: intent } : {}) })}>{workspaceName(item.name)}</Link></li>)}</ul></section>}{!data.items.length && !data.programmes?.length && <p>{query.trim() ? text.empty : text.tree_empty}</p>}{data.next_cursor && <button className="button secondary" disabled={pending} onClick={() => void more()}>{text.more}</button>}</>}
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
  return <section className="unified-workspace"><header className="workspace-heading">{view ? <Link prefetch={false} href="/website">{text.website}</Link> : <h1>{text.website}</h1>}</header>
    <nav className="content-tabs km-switcher-bar" aria-label={text.website}>
      {permissions.can("knowledge") && <Link prefetch={false} className="button secondary" aria-current={view === "businesses" ? "page" : undefined} href="/website?view=businesses">KM องค์กรและธุรกิจอื่น</Link>}
      {permissions.can("brands") && <Link prefetch={false} className="button secondary" aria-current={view === "brands" ? "page" : undefined} href="/website?view=brands">KM แบรนด์</Link>}
      {(permissions.can("projects") || permissions.can("knowledge")) && <Link prefetch={false} className="button secondary" aria-current={view === "groups" ? "page" : undefined} href="/website?view=groups">KM กลุ่มโครงการ</Link>}
      {permissions.can("projects") && <Link prefetch={false} className="button secondary" aria-current={view === "projects" ? "page" : undefined} href="/website?view=projects">KM โครงการ</Link>}
    </nav>
    {view === "projects" && permissions.can("projects") ? <ProjectOverview role={role} />
      : view === "groups" && ["group_state", "group", "pq", "prem_status", "pstatus", "pother", "rem_brand", "gp", "gs"].some(key => query.has(key)) && permissions.can("projects") ? <ProjectOverview role={role} />
      : view === "groups" && (permissions.can("projects") || permissions.can("knowledge")) ? <KmProjectGroupsView />
      : view === "brands" && permissions.can("brands") ? <BrandWorkspace brandId={null} role={role} onDirtyChange={setDirty} />
      : view === "businesses" && permissions.can("knowledge") ? <KmBusinessesView />
      : <>
    <form className="workspace-tree-search" onSubmit={event => { event.preventDefault(); setTerm(search.trim()); }}><label>{text.search}<input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button secondary">{text.search}</button></form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {legacyFaq || legacyCluster ? !error && <p role="status">{text.loading}</p> : <TreeBranch query={term} intent={query.get("intent")} authority={authority} />}
    </>}
  </section>;
}

