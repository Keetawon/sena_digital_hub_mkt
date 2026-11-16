"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { contentScopeText as T } from "@/lib/content-scope-text";
import { capabilityKey, type HubAccount } from "@/lib/hub-permissions";
import { useHubPermissions } from "./accounts";
import { levelLabels, type Catalog, type Tabs } from "./account-permissions";
import "./content-scope.css";

export type ScopeTab = "projects" | "brands" | "knowledge" | "promotions" | "releases";
export type ScopeLevel = "view" | "edit" | "approve";
export type ScopeSelection = { mode: "all" | "selected"; bu_ids: string[]; project_ids: string[] };
type SavedScope = ScopeSelection & { revision: number };
type ScopeRow = { tab: ScopeTab; level: ScopeLevel; scope: SavedScope };
type ScopeReference = { id: string; name?: string; rem_bu_id?: string | null; rem_bu_code?: string | null; rem_bu_name?: string | null };
export type ScopeEffect = { id: string; account_id: string; tab: ScopeTab; level: ScopeLevel; project_id: string; project_name?: string | null; direction: "gain" | "loss"; reason: string; effective_at: string; observed_at: string };
type ScopeRead = { account_id: string; scopes: ScopeRow[]; items: ScopeReference[]; next_cursor: string | null; effective_history: { items: ScopeEffect[]; next_cursor: string | null } };
type Effects = Record<ScopeLevel, { gained: string[]; lost: string[] }>;
type ScopePreview = { kind: "content_scope"; tab: ScopeTab; level: ScopeLevel; digest: string; change_count: number; targets: { account_id: string; before: SavedScope; after: ScopeSelection; gained: string[]; lost: string[]; effects: Effects; future_bu_members: boolean }[]; excluded: { account_id: string; reason: string }[]; scope_state: { expires_at: string | null } };
export type ScopeAuthority = { id: string; key: string; manager: boolean; admin: boolean };
const contentTabs = new Set<ScopeTab>(["projects", "brands", "knowledge", "promotions", "releases"]);
const levels: ScopeLevel[] = ["view", "edit", "approve"];
const emptySelection = (): ScopeSelection => ({ mode: "all", bu_ids: [], project_ids: [] });
function validSelection(value: unknown): value is ScopeSelection {
  if (!value || typeof value !== "object") return false;
  const item = value as ScopeSelection;
  return ["all", "selected"].includes(item.mode) && [item.bu_ids, item.project_ids].every(values => Array.isArray(values) && values.every(id => typeof id === "string") && new Set(values).size === values.length) && (item.mode !== "all" || !item.bu_ids.length && !item.project_ids.length);
}
function validEffects(value: unknown): value is Effects {
  if (!value || typeof value !== "object") return false;
  return levels.every(level => { const item = (value as Effects)[level]; return item && [item.gained, item.lost].every(ids => Array.isArray(ids) && ids.every(id => typeof id === "string")); });
}
const selection = (value: ScopeSelection): ScopeSelection => ({ mode: value.mode, bu_ids: [...value.bu_ids].sort(), project_ids: [...value.project_ids].sort() });
const selectionKey = (value: ScopeSelection) => JSON.stringify(selection(value));
const toggle = (values: string[], value: string, checked: boolean) => checked ? [...new Set([...values, value])] : values.filter(item => item !== value);
export const scopeDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
export function scopeReason(value: string) { return T[`scope_reason_${value}` as keyof typeof T] ?? value; }
export class ScopeFault extends Error { constructor(public status: number, public code = "") { super(code); } }
export const scopeError = (error: unknown) => error instanceof ScopeFault && [401, 403].includes(error.status) ? T.permission_required : error instanceof ScopeFault && error.status === 409 ? T.scope_stale : T.load_error;
const aborted = (error: unknown) => error instanceof Error && error.name === "AbortError";

export function useScopeAuthority(): ScopeAuthority {
  const permissions = useHubPermissions();
  const account = permissions.account as (HubAccount & { content_scope?: { fingerprint?: string; expires_at?: string | null } }) | null;
  const [expired, setExpired] = useState(false), deadline = account?.content_scope?.expires_at;
  const [denial, setDenial] = useState<"all" | "admin" | null>(null);
  const identity = JSON.stringify([capabilityKey(account), account?.updated_at, account?.content_scope]);
  useEffect(() => { setDenial(null); }, [identity]);
  useEffect(() => {
    const denied = (event: Event) => { const detail = (event as CustomEvent<{ actor: string; adminOnly: boolean }>).detail; if (detail?.actor === account?.id) setDenial(old => old === "all" || !detail.adminOnly ? "all" : "admin"); };
    window.addEventListener("hub-content-scope-denied", denied); return () => window.removeEventListener("hub-content-scope-denied", denied);
  }, [account?.id]);
  useEffect(() => {
    const end = deadline ? Date.parse(deadline) : NaN;
    setExpired(Number.isFinite(end) && end <= Date.now());
    if (!Number.isFinite(end) || end <= Date.now()) return;
    const timer = window.setTimeout(() => { setExpired(true); window.dispatchEvent(new Event("hub-accounts-changed")); }, Math.min(end - Date.now() + 1, 2147483647));
    return () => clearTimeout(timer);
  }, [deadline]);
  const manager = denial !== "all" && permissions.ready && !permissions.signedOut && !permissions.error && account?.status === "ACTIVE" && permissions.capabilities.can_manage_users === true;
  const key = JSON.stringify([capabilityKey(account), account?.updated_at, account?.content_scope, expired, manager, denial]);
  return useMemo(() => ({ id: account?.id ?? "", key, manager, admin: manager && denial !== "admin" && account?.hub_role === "admin" }), [account?.id, account?.hub_role, key, manager, denial]);
}

// A delayed management response is displayed only after a fresh same-actor check.
// This verifies authority, never supplies an actor or substitutes a new digest.
export async function scopeRequest<T>(path: string, authority: ScopeAuthority, options: { body?: unknown; signal?: AbortSignal; admin?: boolean } = {}): Promise<T> {
  const response = await fetch(`/api/hub/${path}`, { cache: "no-store", signal: options.signal, ...(options.body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.body) }) });
  const result = await response.json();
  if (!response.ok) { if ([401, 403].includes(response.status)) { window.dispatchEvent(new CustomEvent("hub-content-scope-denied", { detail: { actor: authority.id, adminOnly: options.admin === true } })); window.dispatchEvent(new Event("hub-accounts-changed")); } throw new ScopeFault(response.status, result.error?.code); }
  const current = await fetch("/api/hub/v1/me", { cache: "no-store", signal: options.signal });
  const envelope = await current.json(); const actor = envelope.data;
  if (!current.ok || actor?.id !== authority.id || actor?.status !== "ACTIVE" || actor?.capabilities?.can_manage_users !== true || options.admin && actor?.hub_role !== "admin") {
    window.dispatchEvent(new CustomEvent("hub-content-scope-denied", { detail: { actor: authority.id, adminOnly: current.ok && actor?.id === authority.id && actor?.status === "ACTIVE" && actor?.capabilities?.can_manage_users === true && options.admin === true } })); window.dispatchEvent(new Event("hub-accounts-changed")); throw new ScopeFault(403);
  }
  return result.data as T;
}

type PageState<T> = { key: string; items: T[]; next_cursor: string | null; busy: boolean; error: string; denied: boolean };
export function useScopePage<T extends { id: string }>(path: string, authority: ScopeAuthority, enabled = true, inner?: string, cursorName = "after") {
  const [revision, setRevision] = useState(0), key = `${authority.key}:${path}:${revision}:${enabled}`;
  const [state, setState] = useState<PageState<T>>({ key: "", items: [], next_cursor: null, busy: false, error: "", denied: false });
  const current = useRef(key); current.current = key;
  const request = useRef<AbortController | null>(null), sequence = useRef(0), seen = useRef(new Set<string>());
  const load = useCallback(async (cursor: string | null) => {
    if (!authority.manager || !enabled) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller; const serial = ++sequence.current;
    setState(old => ({ ...(old.key === key && cursor ? old : { items: [], next_cursor: null, error: "", denied: false }), key, busy: true, error: "" }));
    try {
      const raw = await scopeRequest<Record<string, unknown>>(path + (cursor === null ? "" : `${path.includes("?") ? "&" : "?"}${cursorName}=${encodeURIComponent(cursor)}`), authority, { signal: controller.signal });
      const page = (inner ? raw[inner] : raw) as { items: T[]; next_cursor: string | null };
      if (current.current !== key || serial !== sequence.current || controller.signal.aborted) return;
      if (!Array.isArray(page?.items) || page.items.length > 100 || page.items.some(row => typeof row?.id !== "string") || page.next_cursor !== null && (typeof page.next_cursor !== "string" || page.next_cursor === cursor || !page.items.length || seen.current.has(page.next_cursor))) throw new ScopeFault(502);
      if (cursor === null) seen.current.clear(); else seen.current.add(cursor);
      setState(old => {
        const rows = cursor && old.key === key ? old.items : [], indexed = new Map(rows.map(row => [row.id, row]));
        for (const row of page.items) {
          if (indexed.has(row.id) && JSON.stringify(indexed.get(row.id)) !== JSON.stringify(row)) return { key, items: [], next_cursor: null, busy: false, error: T.scope_stale, denied: false };
          indexed.set(row.id, row);
        }
        return { key, items: [...indexed.values()], next_cursor: page.next_cursor, busy: false, error: "", denied: false };
      });
    } catch (error) {
      if (aborted(error) || current.current !== key || serial !== sequence.current) return;
      const denied = error instanceof ScopeFault && [401, 403].includes(error.status);
      setState(old => ({ key, items: denied ? [] : old.key === key ? old.items : [], next_cursor: denied ? null : old.next_cursor, busy: false, error: scopeError(error), denied }));
    }
  }, [authority, enabled, inner, key, path, cursorName]);
  useEffect(() => { seen.current.clear(); void load(null); return () => { request.current?.abort(); sequence.current++; }; }, [load]);
  const value = state.key === key ? state : { key, items: [], next_cursor: null, busy: authority.manager && enabled, error: "", denied: false };
  return { ...value, more: () => value.next_cursor && !value.busy && void load(value.next_cursor), refresh: () => setRevision(value => value + 1) };
}

export function ScopePageFeedback({ page }: { page: { busy: boolean; error: string; next_cursor: string | null; more: () => unknown; refresh: () => void } }) {
  return <>{page.busy && <p role="status">{T.loading}</p>}{page.error && <p role="alert">{page.error} <button type="button" className="button secondary" onClick={page.refresh}>{T.retry}</button></p>}{page.next_cursor && <button type="button" className="button secondary" disabled={page.busy} onClick={page.more}>{T.scope_load_more}</button>}</>;
}
function ReferenceLabel({ item }: { item: ScopeReference }) {
  return <span className="scope-reference"><strong>{item.name ?? item.rem_bu_code ?? item.id}</strong>{item.rem_bu_name !== null && item.rem_bu_name !== undefined && <span>{item.rem_bu_name}</span>}<code>{item.id}</code></span>;
}
function ProjectChoices({ authority, value, change, bu, query = "", disabled }: { authority: ScopeAuthority; value: ScopeSelection; change: (value: ScopeSelection) => void; bu?: ScopeReference; query?: string; disabled: boolean }) {
  const params = new URLSearchParams({ reference_kind: "projects", limit: "100", q: query }); if (bu) params.set("bu_id", bu.id);
  const page = useScopePage<ScopeReference>(`v1/admin/accounts/content-scopes?${params}`, authority);
  return <div><ul className="scope-projects">{page.items.map(item => <li key={item.id}><label className="scope-choice"><input type="checkbox" disabled={disabled} checked={value.project_ids.includes(item.id)} onChange={event => change({ ...value, project_ids: toggle(value.project_ids, item.id, event.target.checked) })} aria-label={`${T.scope_project_exception} ${item.name ?? item.id} ${item.id}`} /><ReferenceLabel item={item} /></label>{item.rem_bu_id && value.bu_ids.includes(item.rem_bu_id) && <small>{T.scope_bu_included}</small>}{!bu && <small className="scope-reference">{item.rem_bu_id ? [item.rem_bu_code, item.rem_bu_name, item.rem_bu_id].filter(part => part !== null && part !== undefined).join(" · ") : T.scope_no_bu}</small>}</li>)}</ul>{!page.busy && !page.error && !page.items.length && <p>{bu ? T.scope_bu_projects_empty : query.trim() ? T.empty : T.scope_projects_empty}</p>}<ScopePageFeedback page={page} /></div>;
}
function BuChoice({ item, authority, value, change, disabled, futureId }: { item: ScopeReference; authority: ScopeAuthority; value: ScopeSelection; change: (value: ScopeSelection) => void; disabled: boolean; futureId: string }) {
  const [open, setOpen] = useState(false);
  return <li className="scope-bu"><label className="scope-choice"><input type="checkbox" checked={value.bu_ids.includes(item.id)} disabled={disabled} onChange={event => change({ ...value, bu_ids: toggle(value.bu_ids, item.id, event.target.checked) })} aria-label={`BUD ${item.rem_bu_code ?? item.id} ${item.id}`} aria-describedby={futureId} /><ReferenceLabel item={item} /></label><details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{T.project}</summary>{open && <ProjectChoices authority={authority} value={value} change={change} bu={item} disabled={disabled} />}</details></li>;
}
function ScopeTree({ authority, value, change, disabled }: { authority: ScopeAuthority; value: ScopeSelection; change: (value: ScopeSelection) => void; disabled: boolean }) {
  const [query, setQuery] = useState("");
  const futureId = useId();
  const page = useScopePage<ScopeReference>(`v1/admin/accounts/content-scopes?${new URLSearchParams({ reference_kind: "bus", limit: "100", q: query })}`, authority);
  return <div className="scope-tree"><label className="form-field">{T.scope_search}<input type="search" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} /></label><p id={futureId}>{T.scope_future_members}</p><ul className="scope-bus">{page.items.map(item => <BuChoice key={item.id} item={item} authority={authority} value={value} change={change} disabled={disabled} futureId={futureId} />)}</ul><ScopePageFeedback page={page} /><h5>{T.scope_project_exception}</h5><ProjectChoices authority={authority} value={value} change={change} query={query} disabled={disabled} /><p>{T.scope_base_required}</p></div>;
}

export function ScopeSelectionSummary({ value, change, disabled = false }: { value: ScopeSelection; change?: (value: ScopeSelection) => void; disabled?: boolean }) {
  return <div className="scope-selection"><strong>{value.mode === "all" ? T.scope_all : T.scope_selected}</strong>{value.mode === "selected" && <>{!value.bu_ids.length && !value.project_ids.length && <p>{T.scope_empty_selected}</p>}{!!value.bu_ids.length && <p>BUD: {value.bu_ids.map(id => <span key={id}><code>{id}</code>{change && <button type="button" className="button secondary" disabled={disabled} aria-label={`${T.clear_selection} BUD ${id}`} onClick={() => change({ ...value, bu_ids: value.bu_ids.filter(item => item !== id) })}>{T.clear_selection}</button>}</span>)}</p>}{!!value.project_ids.length && <p>{T.project}: {value.project_ids.map(id => <span key={id}><code>{id}</code>{change && <button type="button" className="button secondary" disabled={disabled} aria-label={`${T.clear_selection} ${T.project} ${id}`} onClick={() => change({ ...value, project_ids: value.project_ids.filter(item => item !== id) })}>{T.clear_selection}</button>}</span>)}</p>}</>}</div>;
}
export function ScopeAssignmentHistory({ before, after, catalog }: { before: Partial<ScopeSelection>; after: Partial<ScopeSelection> & { tab?: string; level?: string }; catalog: Catalog }) {
  const valid = (value: Partial<ScopeSelection>): value is ScopeSelection => ["all", "selected"].includes(value.mode ?? "") && Array.isArray(value.bu_ids) && Array.isArray(value.project_ids);
  return <div className="content-scope"><p>{T.scope_title} · {catalog.tabs.find(tab => tab.tab === after.tab)?.label_th ?? after.tab} · {levelLabels[after.level ?? ""] ?? after.level}</p><div className="scope-diff"><div><h5>{T.before}</h5>{valid(before) ? <ScopeSelectionSummary value={before} /> : <p>—</p>}</div><div><h5>{T.after}</h5>{valid(after) ? <ScopeSelectionSummary value={after} /> : <p>—</p>}</div></div></div>;
}
function ProjectEffectList({ title, projects }: { title: string; projects: string[] }) {
  const [count, setCount] = useState(100);
  return <div><h6>{title} ({projects.length})</h6>{projects.length ? <><ul className="scope-id-list">{projects.slice(0, count).map(id => <li key={id}><code>{id}</code></li>)}</ul>{count < projects.length && <button type="button" className="button secondary" onClick={() => setCount(value => value + 100)}>{T.scope_load_more}</button>}</> : <p>—</p>}</div>;
}
export function ScopeEffectiveHistory({ accountId, authority, catalog }: { accountId: string; authority: ScopeAuthority; catalog: Catalog }) {
  const page = useScopePage<ScopeEffect>(`v1/admin/accounts/content-scopes?account_id=${encodeURIComponent(accountId)}&limit=1&history_limit=50`, authority, true, "effective_history", "history_after");
  return <section className="scope-history" aria-label={T.scope_history}><header><h3>{T.scope_history}</h3><button type="button" className="button secondary" disabled={page.busy} onClick={page.refresh}>{T.refresh}</button></header><ol>{page.items.map(item => <li key={item.id}><strong>{item.direction === "gain" ? T.scope_gain : T.scope_loss}</strong> · {catalog.tabs.find(tab => tab.tab === item.tab)?.label_th ?? item.tab} · {levelLabels[item.level]}<p>{item.project_name} <code>{item.project_id}</code></p><p>{scopeReason(item.reason)}</p><dl><div><dt>{T.scope_effective_at}</dt><dd>{scopeDate(item.effective_at)}</dd></div><div><dt>{T.scope_observed_at}</dt><dd>{scopeDate(item.observed_at)}</dd></div></dl></li>)}</ol>{!page.items.length && !page.busy && !page.error && <p>{T.scope_history_empty}</p>}<ScopePageFeedback page={page} /></section>;
}

export function ContentScopeEditor({ accountId, tabs, catalog, readOnly = false, blocked = false, onSaved }: { accountId: string; tabs: Tabs; catalog: Catalog; readOnly?: boolean; blocked?: boolean; onSaved: () => void }) {
  const authority = useScopeAuthority(), id = useId();
  const [loaded, setLoaded] = useState<{ key: string; rows: ScopeRow[] } | null>(null), [revision, setRevision] = useState(0);
  const [active, setActive] = useState<string | null>(null), [drafts, setDrafts] = useState<Record<string, ScopeSelection>>({});
  const [preview, setPreview] = useState<{ value: ScopePreview; fingerprint: string; authority: string } | null>(null), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [denied, setDenied] = useState(false);
  const key = `${accountId}:${authority.key}:${revision}`, current = useRef(key); current.current = key;
  const command = useRef<AbortController | null>(null), commandId = useRef(0);
  useEffect(() => { setActive(null); setDrafts({}); setPreview(null); setConfirmed(false); setMessage(""); }, [accountId]);
  useEffect(() => {
    setPreview(null); setConfirmed(false); setDenied(false); setError(""); command.current?.abort(); commandId.current++; setBusy(false);
    if (!authority.manager) return;
    const controller = new AbortController();
    void scopeRequest<ScopeRead>(`v1/admin/accounts/content-scopes?account_id=${encodeURIComponent(accountId)}&limit=1`, authority, { signal: controller.signal }).then(data => {
      if (current.current !== key || controller.signal.aborted) return;
      if (data.account_id !== accountId || !Array.isArray(data.scopes) || data.scopes.length !== 15 || data.scopes.some(row => !contentTabs.has(row.tab) || !levels.includes(row.level) || !validSelection(row.scope) || !Number.isInteger(row.scope.revision) || row.scope.revision < 0) || new Set(data.scopes.map(row => `${row.tab}:${row.level}`)).size !== 15) throw new ScopeFault(502);
      setLoaded({ key, rows: data.scopes });
    }).catch(cause => { if (!aborted(cause) && current.current === key) { setError(scopeError(cause)); setDenied(cause instanceof ScopeFault && [401, 403].includes(cause.status)); } });
    return () => { controller.abort(); command.current?.abort(); commandId.current++; };
  }, [accountId, authority, key]);
  const rows = loaded?.key === key ? loaded.rows : [], row = rows.find(item => `${item.tab}:${item.level}` === active);
  const draft = row ? drafts[active!] ?? selection(row.scope) : emptySelection();
  const payload = row ? { selection: { kind: "accounts", account_ids: [accountId] }, change: { kind: "content_scope", tab: row.tab, level: row.level, scope: selection(draft) }, note: "" } : null;
  const fingerprint = JSON.stringify(payload), latest = useRef(fingerprint); latest.current = fingerprint;
  const validPreview = preview?.fingerprint === fingerprint && preview.authority === authority.key && (!preview.value.scope_state.expires_at || Date.parse(preview.value.scope_state.expires_at) > Date.now()) ? preview.value : null;
  const disabled = readOnly || blocked || busy, changed = !!row && selectionKey(draft) !== selectionKey(row.scope);
  useEffect(() => {
    const until = preview?.value.scope_state.expires_at; if (!until) return;
    const timeout = window.setTimeout(() => { setPreview(null); setConfirmed(false); setError(T.scope_stale); }, Math.max(0, Math.min(Date.parse(until) - Date.now(), 2147483647)));
    return () => clearTimeout(timeout);
  }, [preview]);
  function change(value: ScopeSelection) { if (!active || disabled) return; setDrafts(old => ({ ...old, [active]: value })); setPreview(null); setConfirmed(false); setMessage(""); }
  async function review() {
    if (!payload || disabled || !changed) return;
    const captured = fingerprint, requestKey = key, sequence = ++commandId.current, controller = new AbortController(); command.current = controller;
    setBusy(true); setError(""); setMessage(""); setPreview(null); setConfirmed(false);
    try {
      const value = await scopeRequest<ScopePreview>("v1/admin/permissions/preview", authority, { body: payload, signal: controller.signal });
      if (current.current !== requestKey || latest.current !== captured || commandId.current !== sequence) return;
      if (value.kind !== "content_scope" || value.tab !== row!.tab || value.level !== row!.level || !/^[a-f0-9]{64}$/.test(value.digest) || !Array.isArray(value.targets) || value.targets.length > 1 || value.targets.some(target => target.account_id !== accountId || !validSelection(target.before) || !validSelection(target.after) || selectionKey(target.after) !== selectionKey(payload.change.scope) || !validEffects(target.effects)) || !Array.isArray(value.excluded) || value.excluded.some(target => target.account_id !== accountId)) throw new ScopeFault(502);
      setPreview({ value, fingerprint: captured, authority: authority.key });
    } catch (cause) { if (!aborted(cause) && current.current === requestKey && commandId.current === sequence) { setError(scopeError(cause)); setDenied(cause instanceof ScopeFault && [401, 403].includes(cause.status)); } }
    finally { if (current.current === requestKey && commandId.current === sequence) setBusy(false); }
  }
  async function apply() {
    if (!payload || !validPreview || !confirmed || disabled) return;
    const captured = fingerprint, requestKey = key, sequence = ++commandId.current, controller = new AbortController(), selectedKey = active!; command.current = controller;
    setBusy(true); setError("");
    try {
      await scopeRequest("v1/admin/permissions/apply", authority, { body: { ...payload, digest: validPreview.digest, confirmed: true }, signal: controller.signal });
      if (current.current !== requestKey || latest.current !== captured || commandId.current !== sequence) return;
      setDrafts(old => { const next = { ...old }; delete next[selectedKey]; return next; }); setPreview(null); setConfirmed(false); setMessage(T.scope_saved); setRevision(value => value + 1); onSaved(); window.dispatchEvent(new Event("hub-accounts-changed"));
    } catch (cause) { if (!aborted(cause) && current.current === requestKey && commandId.current === sequence) { setPreview(null); setConfirmed(false); setError(scopeError(cause)); setDenied(cause instanceof ScopeFault && [401, 403].includes(cause.status)); } }
    finally { if (current.current === requestKey && commandId.current === sequence) setBusy(false); }
  }
  if (!authority.manager || denied) return <section className="content-scope"><p role="alert">{T.permission_required}</p></section>;
  return <section className="content-scope" aria-label={T.scope_title}><header><h3>{T.scope_title}</h3><button type="button" className="button secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>{T.refresh}</button></header><p>{T.scope_base_required}</p>{blocked && <p role="status">{T.scope_save_base_first}</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{!rows.length && !error && <p role="status">{T.loading}</p>}
    <div className="scope-grants">{catalog.tabs.filter(tab => contentTabs.has(tab.tab as ScopeTab)).map(tab => <section key={tab.tab}><h4>{tab.label_th}</h4><div className="scope-levels">{levels.map(level => { const stored = rows.find(item => item.tab === tab.tab && item.level === level), name = `${tab.tab}:${level}`, hasBase = tabs[tab.tab]?.includes("view") && tabs[tab.tab]?.includes(level); return <div key={level}><strong>{levelLabels[level]}</strong>{stored && <><span>{stored.scope.mode === "all" ? T.scope_all : T.scope_selected}</span>{!hasBase && <small>{T.scope_base_required}</small>}<button type="button" className="button secondary" aria-expanded={active === name} disabled={busy || blocked} onClick={() => { setActive(name); setPreview(null); setConfirmed(false); setError(""); }}>{readOnly ? T.scope_read_only : T.scope_edit}</button></>}</div>; })}</div></section>)}</div>
    {row && <section className="scope-editor" aria-label={`${T.scope_edit} ${catalog.tabs.find(tab => tab.tab === row.tab)?.label_th} ${levelLabels[row.level]}`}><h4>{catalog.tabs.find(tab => tab.tab === row.tab)?.label_th} · {levelLabels[row.level]}</h4><fieldset disabled={disabled}><legend>{T.scope_title}</legend><div className="scope-modes">{(["all", "selected"] as const).map(mode => <label key={mode}><input type="radio" name={`${id}-scope-mode`} checked={draft.mode === mode} onChange={() => change(mode === "all" ? emptySelection() : { ...draft, mode })} />{mode === "all" ? T.scope_all : T.scope_selected}</label>)}</div></fieldset><ScopeSelectionSummary value={draft} change={readOnly ? undefined : change} disabled={disabled} />{draft.mode === "selected" && <ScopeTree key={`${accountId}:${active}`} authority={authority} value={draft} change={change} disabled={disabled} />}{!readOnly && <div className="scope-actions"><button type="button" className="button secondary" disabled={disabled || !changed} onClick={() => void review()}>{T.scope_preview}</button><button type="button" className="button secondary" disabled={busy || !changed} onClick={() => { setDrafts(old => { const next = { ...old }; delete next[active!]; return next; }); setPreview(null); setConfirmed(false); setError(""); }}>{T.scope_discard}</button></div>}
      {validPreview && <section className="scope-preview" aria-label={T.scope_preview}><h4>{T.scope_preview}</h4>{validPreview.targets.map(target => <div key={target.account_id}><div className="scope-diff"><div><h5>{T.before}</h5><ScopeSelectionSummary value={target.before} /></div><div><h5>{T.after}</h5><ScopeSelectionSummary value={target.after} /></div></div>{target.future_bu_members && <p>{T.scope_future_members}</p>}{levels.map(level => <section key={level}><h5>{levelLabels[level]}</h5><div className="scope-diff"><ProjectEffectList title={T.scope_gained} projects={target.effects[level].gained} /><ProjectEffectList title={T.scope_lost} projects={target.effects[level].lost} /></div></section>)}</div>)}{!validPreview.change_count && <p>{T.scope_unchanged}</p>}{validPreview.excluded.length > 0 && <p>{T.scope_read_only}</p>}<label className="scope-choice"><input type="checkbox" checked={confirmed} disabled={disabled || !validPreview.change_count || !!validPreview.excluded.length} onChange={event => setConfirmed(event.target.checked)} />{T.scope_confirm}</label><button type="button" className="button primary" disabled={disabled || !confirmed || !validPreview.change_count || !!validPreview.excluded.length} onClick={() => void apply()}>{T.scope_confirm}</button></section>}{busy && <p role="status">{T.loading}</p>}</section>}
    <ScopeEffectiveHistory key={`${accountId}:${revision}`} accountId={accountId} authority={authority} catalog={catalog} />
  </section>;
}
