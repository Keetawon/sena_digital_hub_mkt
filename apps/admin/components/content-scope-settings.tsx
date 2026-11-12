"use client";
import { useEffect, useRef, useState } from "react";
import { contentScopeText as T } from "@/lib/content-scope-text";
import { levelLabels, type Catalog } from "./account-permissions";
import { ContentBuNotices } from "./content-bu-notices";
import { ScopeFault, ScopePageFeedback, scopeDate, scopeError, scopeRequest, useScopeAuthority, useScopePage } from "./content-scope-editor";
import "./content-scope.css";

type SyncRun = { id: string; status: "ACCEPTED" | "REJECTED" | "FAILED"; source_watermark: string | null; accepted_at: string | null; recorded_at: string; row_count: number; failure_code: string | null; current: boolean; deadline: string | null };
type Settings = { grace_days: number; revision: number };
type SettingsPreview = Settings & { digest: string; change_count: number; changes: { account_id: string; tab: string; level: string; project_id: string; direction: "gain" | "loss" }[]; complete: boolean; scope_state: { expires_at: string | null } };

export function ContentScopeSettings({ catalog, accountNames }: { catalog: Catalog; accountNames: Record<string, string> }) {
  const authority = useScopeAuthority();
  const runs = useScopePage<SyncRun>("v1/admin/accounts/bu-sync-runs?limit=50", authority);
  const [reload, setReload] = useState(0), [loaded, setLoaded] = useState<{ key: string; value: Settings } | null>(null);
  const [days, setDays] = useState(7), [dirty, setDirty] = useState(false), [preview, setPreview] = useState<{ key: string; value: SettingsPreview } | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [denied, setDenied] = useState(false);
  const key = `${authority.key}:${reload}`, current = useRef(key); current.current = key;
  const edited = useRef(dirty); edited.current = dirty;
  const command = useRef<AbortController | null>(null), serial = useRef(0);
  useEffect(() => {
    setPreview(null); setConfirmed(false); setDenied(false); command.current?.abort(); serial.current++; setBusy(false);
    if (!authority.admin) return;
    const controller = new AbortController();
    void scopeRequest<Settings>("v1/admin/accounts/content-scope-settings", authority, { signal: controller.signal, admin: true }).then(value => {
      if (current.current !== key || controller.signal.aborted) return;
      if (!Number.isInteger(value.grace_days) || value.grace_days < 1 || value.grace_days > 7 || !Number.isInteger(value.revision) || value.revision < 1) throw new ScopeFault(502);
      setLoaded({ key, value }); if (!edited.current) setDays(value.grace_days);
    }).catch(cause => { if (!(cause instanceof Error && cause.name === "AbortError") && current.current === key) { setError(scopeError(cause)); setDenied(cause instanceof ScopeFault && [401, 403].includes(cause.status)); } });
    return () => { controller.abort(); command.current?.abort(); serial.current++; };
  }, [authority, key]);
  const settings = loaded?.key === key ? loaded.value : null;
  const value = preview?.key === key && preview.value.grace_days === days && (!preview.value.scope_state.expires_at || Date.parse(preview.value.scope_state.expires_at) > Date.now()) ? preview.value : null;
  useEffect(() => {
    const expires = preview?.value.scope_state.expires_at; if (!expires) return;
    const timer = window.setTimeout(() => { setPreview(null); setConfirmed(false); setError(T.scope_stale); }, Math.max(0, Math.min(Date.parse(expires) - Date.now(), 2147483647)));
    return () => clearTimeout(timer);
  }, [preview]);
  async function review() {
    if (!settings || !authority.admin || busy || days === settings.grace_days) return;
    const requestKey = key, requestId = ++serial.current, controller = new AbortController(); command.current = controller;
    setBusy(true); setError(""); setMessage(""); setPreview(null); setConfirmed(false);
    try {
      const result = await scopeRequest<SettingsPreview>("v1/admin/accounts/content-scope-settings/preview", authority, { body: { grace_days: days, expected_revision: settings.revision }, signal: controller.signal, admin: true });
      if (current.current !== requestKey || requestId !== serial.current) return;
      if (!/^[a-f0-9]{64}$/.test(result.digest) || result.grace_days !== days || result.revision !== settings.revision || !Array.isArray(result.changes) || result.changes.length > 100) throw new ScopeFault(502);
      setPreview({ key: requestKey, value: result });
    } catch (cause) { if (!(cause instanceof Error && cause.name === "AbortError") && current.current === requestKey && requestId === serial.current) { setError(scopeError(cause)); setDenied(cause instanceof ScopeFault && [401, 403].includes(cause.status)); if (cause instanceof ScopeFault && cause.status === 409) setReload(value => value + 1); } }
    finally { if (current.current === requestKey && requestId === serial.current) setBusy(false); }
  }
  async function apply() {
    if (!value || !settings || !confirmed || !authority.admin || busy) return;
    const requestKey = key, requestId = ++serial.current, controller = new AbortController(); command.current = controller;
    setBusy(true); setError("");
    try {
      await scopeRequest("v1/admin/accounts/content-scope-settings/apply", authority, { body: { grace_days: value.grace_days, expected_revision: value.revision, digest: value.digest, confirmed: true }, signal: controller.signal, admin: true });
      if (current.current !== requestKey || requestId !== serial.current) return;
      setDirty(false); setPreview(null); setConfirmed(false); setMessage(T.scope_settings_saved); setReload(value => value + 1); runs.refresh(); window.dispatchEvent(new Event("hub-accounts-changed"));
    } catch (cause) { if (!(cause instanceof Error && cause.name === "AbortError") && current.current === requestKey && requestId === serial.current) { setPreview(null); setConfirmed(false); setError(scopeError(cause)); setDenied(cause instanceof ScopeFault && [401, 403].includes(cause.status)); if (cause instanceof ScopeFault && cause.status === 409) setReload(value => value + 1); } }
    finally { if (current.current === requestKey && requestId === serial.current) setBusy(false); }
  }
  if (!authority.manager) return null;
  return <section className="content-scope scope-management" aria-label={T.scope_sync_runs}><ContentBuNotices /><details><summary>{T.scope_sync_runs}</summary><header><h2>{T.scope_sync_runs}</h2><button type="button" className="button secondary" disabled={runs.busy} onClick={runs.refresh}>{T.refresh}</button></header><ol className="scope-runs">{runs.items.map(run => <li key={run.id}><strong>{run.status === "ACCEPTED" ? T.scope_sync_accepted : run.status === "REJECTED" ? T.scope_sync_rejected : T.scope_sync_failed}</strong><dl><div><dt>{T.scope_observed_at}</dt><dd>{scopeDate(run.recorded_at)}</dd></div><div><dt>{T.scope_source_at}</dt><dd>{scopeDate(run.source_watermark)}</dd></div><div><dt>{T.scope_cutoff}</dt><dd>{scopeDate(run.deadline)}</dd></div></dl>{run.failure_code && <p>{T.reason}: <code>{run.failure_code}</code></p>}</li>)}</ol>{!runs.items.length && !runs.busy && !runs.error && <p>{T.scope_sync_missing}</p>}<ScopePageFeedback page={runs} /></details>
    {authority.admin && !denied ? <details className="scope-settings"><summary>{T.scope_grace}</summary><header><h2>{T.scope_grace}</h2><button type="button" className="button secondary" disabled={busy} onClick={() => setReload(value => value + 1)}>{T.refresh}</button></header><p>{T.scope_grace_help}</p>{!settings && !error && <p role="status">{T.loading}</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{settings && <><label className="form-field">{T.scope_grace}<select value={days} disabled={busy} onChange={event => { setDays(Number(event.target.value)); setDirty(true); setPreview(null); setConfirmed(false); setMessage(""); }}>{[1, 2, 3, 4, 5, 6, 7].map(day => <option value={day} key={day}>{day} {T.scope_days}</option>)}</select></label><div className="scope-actions"><button type="button" className="button secondary" disabled={busy || days === settings.grace_days} onClick={() => void review()}>{T.scope_settings_preview}</button><button type="button" className="button secondary" disabled={busy || !dirty} onClick={() => { setDays(settings.grace_days); setDirty(false); setPreview(null); setConfirmed(false); }}>{T.scope_discard}</button></div>{value && <section className="scope-preview" aria-label={T.scope_settings_preview}><h3>{T.scope_settings_preview}</h3><p>{T.before}: {settings.grace_days} {T.scope_days} · {T.after}: {value.grace_days} {T.scope_days}</p><p>{T.scope_history}: {value.change_count}</p>{!value.complete && <p>{T.scope_preview_partial}</p>}<ul>{value.changes.map((change, index) => <li key={`${change.account_id}:${change.tab}:${change.level}:${change.project_id}:${index}`}><strong>{change.direction === "gain" ? T.scope_gain : T.scope_loss}</strong> · {accountNames[change.account_id] ?? change.account_id} · {catalog.tabs.find(tab => tab.tab === change.tab)?.label_th ?? change.tab} · {levelLabels[change.level] ?? change.level} · <code>{change.project_id}</code></li>)}</ul><label className="scope-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{T.scope_settings_confirm}</label><button type="button" className="button primary" disabled={busy || !confirmed} onClick={() => void apply()}>{T.scope_settings_confirm}</button></section>}{busy && <p role="status">{T.loading}</p>}</>}</details> : <p>{denied ? T.permission_required : T.scope_admin_only}</p>}
  </section>;
}
