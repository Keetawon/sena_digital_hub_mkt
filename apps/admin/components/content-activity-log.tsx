"use client";
import { useEffect, useRef, useState } from "react";
import { useHubPermissions } from "./accounts";
import { capabilityKey, isContentAdmin } from "@/lib/hub-permissions";
import { request } from "./hub-request";
import { errorMessage } from "./content-common";
import { ContentTimeline, type ContentEvents } from "./content-history";
import { workspaceText as text } from "@/lib/unified-workspace";
import "./unified-workspace.css";
const emptyFilters = { actor_id: "", project: "", rem_bu_id: "", date_from: "", date_to: "" };
export function ContentActivityLog() {
  const permissions = useHubPermissions(), account = permissions.account;
  const allowed = isContentAdmin(account);
  const authority = capabilityKey(account);
  const [filters, setFilters] = useState(emptyFilters), [applied, setApplied] = useState(emptyFilters);
  const [data, setData] = useState<ContentEvents | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false), [retry, setRetry] = useState(0);
  const query = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(applied)) if (value) {
    query.set(key, key === "date_from" ? `${value}T00:00:00+07:00` : key === "date_to" ? `${value}T23:59:59.999+07:00` : value);
  }
  const path = "v1/admin/content/activity?" + query;
  const pageGeneration = useRef(0);
  useEffect(() => {
    pageGeneration.current += 1;
    let live = true; setData(null); setError(""); if (!allowed) return; setPending(true);
    request<ContentEvents>(path).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [path, authority, allowed, retry]);
  async function more() {
    if (!allowed || !data?.next_cursor || pending) return; setPending(true);
    const generation = pageGeneration.current;
    try { const value = await request<ContentEvents>(path + "&before=" + encodeURIComponent(data.next_cursor)); if (generation !== pageGeneration.current) return; setData(current => current && ({ ...value, items: [...current.items, ...value.items] })); }
    catch (e) { if (generation === pageGeneration.current) setError(errorMessage(e)); } finally { if (generation === pageGeneration.current) setPending(false); }
  }
  return <section className="unified-workspace"><h1>{text.activity}</h1>{allowed && <>
    <form className="workspace-filters" onSubmit={event => { event.preventDefault(); setApplied(filters); }}>
      <label>{text.person}<select value={filters.actor_id} onChange={event => setFilters({ ...filters, actor_id: event.target.value })}><option value="">{text.all}</option>{Object.entries(permissions.names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>{text.project}<input value={filters.project} maxLength={200} onChange={event => setFilters({ ...filters, project: event.target.value })} /></label>
      <label>BUD<input value={filters.rem_bu_id} maxLength={200} onChange={event => setFilters({ ...filters, rem_bu_id: event.target.value })} /></label>
      <label>{text.date_from}<input type="date" value={filters.date_from} onChange={event => setFilters({ ...filters, date_from: event.target.value })} /></label>
      <label>{text.date_to}<input type="date" min={filters.date_from || undefined} value={filters.date_to} onChange={event => setFilters({ ...filters, date_to: event.target.value })} /></label>
      <button className="button secondary">{text.search}</button>
    </form>
    {error && <p className="notice error" role="alert">{error}<button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>}
    {!data && pending && <p role="status">{text.loading}</p>}{data && <ContentTimeline items={data.items} />}{data && !data.items.length && <p>{Object.values(applied).some(Boolean) ? text.empty : text.activity_log_empty}</p>}
    {data?.next_cursor && <button className="button secondary" disabled={pending} onClick={() => void more()}>{text.next}</button>}
  </>}</section>;
}

