"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { workspaceCopy as copy } from "@/lib/workspace-copy";
import { capabilityKey, canWorkspace, contentScopeExpired } from "@/lib/hub-permissions";
import { useHubPermissions } from "./accounts";
import { openWorkspaceAssistant } from "./hub-assistant";
import "./workspace-home.css";

type SearchItem = { kind: string; ref: string; label: { th?: string; en?: string }; code?: string; href: string };
export const workspaceLabel = (value: { th?: string; en?: string } | string | undefined) => typeof value === "string" ? value : value?.th || value?.en || "";

export function WorkspaceSearch({ hosted = false, home = false }: { hosted?: boolean; home?: boolean }) {
  const permissions = useHubPermissions();
  const authority = capabilityKey(permissions.account);
  const allowed = permissions.ready && permissions.account?.status === "ACTIVE" && canWorkspace(permissions.capabilities) && !contentScopeExpired(permissions.account);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [resultFor, setResultFor] = useState("");
  const resultKey = JSON.stringify([authority, query]);
  const latest = useRef({ resultKey, allowed, account: permissions.account });
  latest.current = { resultKey, allowed, account: permissions.account };
  const visibleItems = allowed && resultFor === resultKey ? items : [];
  useEffect(() => {
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && latest.current.resultKey === resultKey && latest.current.allowed && !contentScopeExpired(latest.current.account);
    setItems([]); setActive(-1); setError(false);
    if (!allowed || !query.trim()) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/hub/v1/admin/content/search?${new URLSearchParams({ q: query, limit: "12" })}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (current() && body.error?.invalidate_access === true) window.dispatchEvent(new Event("hub-content-access-invalidated"));
        if (!response.ok) throw new Error();
        if (current()) { setItems(body.data.items); setResultFor(resultKey); }
      } catch { if (current()) setError(true); }
      finally { if (current()) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, retry, authority, allowed, resultKey]);
  const expanded = allowed && open && Boolean(query.trim());
  return <div className={`workspace-search${home ? " workspace-search-home" : ""}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label className="workspace-search-label" htmlFor={id}>{copy.search}</label>
    <input ref={input} id={id} type="search" role="combobox" autoComplete="off" maxLength={120} placeholder={copy.search_placeholder} disabled={!allowed}
      aria-expanded={expanded} aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      value={query} onChange={event => { setQuery(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { setOpen(false); return; }
        if (["ArrowDown", "ArrowUp"].includes(event.key) && query.trim()) {
          event.preventDefault(); setOpen(true);
          setActive(current => { const next = event.key === "ArrowDown" ? (current + 1) % (visibleItems.length + 1) : (current <= 0 ? visibleItems.length : current - 1); results.current?.children[next]?.scrollIntoView({ block: "nearest" }); return next; });
        } else if (event.key === "Enter" && expanded && active >= 0) {
          event.preventDefault(); results.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.click();
        }
      }} />
    {expanded && <div className="workspace-search-popup">
      {loading && <p role="status">{copy.loading}</p>}
      {error && <p role="alert">{copy.load_error} <button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>{copy.retry}</button></p>}
      {!loading && !error && !visibleItems.length && <p role="status">{copy.empty}</p>}
      <ul ref={results} role="listbox" id={`${id}-results`} aria-label={copy.search}>
        {visibleItems.map((item, index) => <li key={`${item.kind}:${item.ref}`} role="presentation"><Link prefetch={false} id={`${id}-option-${index}`} role="option" aria-selected={active === index} data-index={index} href={item.href} onMouseEnter={() => setActive(index)} onClick={() => setOpen(false)}><span>{workspaceLabel(item.label)}</span>{item.code && <small>{item.code}</small>}</Link></li>)}
        <li role="presentation"><button id={`${id}-option-${visibleItems.length}`} role="option" aria-selected={active === visibleItems.length} aria-disabled={hosted} data-index={visibleItems.length} type="button" onMouseEnter={() => setActive(visibleItems.length)} onClick={() => {
          if (hosted) return;
          setOpen(false); openWorkspaceAssistant(query, undefined, input.current ?? undefined);
        }}><span>{copy.ask_prefix}{query}</span>{hosted && <small>{copy.assistant_disabled}</small>}</button></li>
      </ul>
    </div>}
  </div>;
}
