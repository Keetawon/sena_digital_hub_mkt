"use client";
import { Fragment, createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { hubPages, workspaceLanding } from "./hub-navigation-data";
import { SignOut, useHostedSession } from "./hosted-session";
import { AuthLayout } from "./auth-layout";
import { roleLabels, localPersonas, type LocalRole } from "@/lib/roles";
import { can, canOpenPage, canSpecial, capabilityKey, contentScopeExpired, emptyCapabilities, type AccountAccess, type CapabilityProjection, type HubAccount, type TemplateRef } from "@/lib/hub-permissions";
import { contentScopeText } from "@/lib/content-scope-text";
import { unavailableMessage } from "@/lib/hub-account";
import { workspaceText } from "@/lib/unified-workspace";

export const taskLabels: Record<string, string> = { read: "อ่านข้อมูลโครงการ", edit: "แก้ไขข้อมูลและสื่อ", publish: "อนุมัติและเผยแพร่ข้อมูล", online: "ดูแลงานโฆษณาและงบ", agency: "ทำงานในนามเอเจนซี" };
export const statuses: Record<string, string> = { PENDING: "รออนุมัติ", ACTIVE: "ใช้งานอยู่", SUSPENDED: "ระงับ", REJECTED: "ปฏิเสธ" };
export type Account = { id: string; email: string; sign_in_method: string; display_name_th: string; phone: string; team: string; requested_tasks: string[]; reason: string; privacy_acknowledged_at: string | null; status: string; hub_role: string | null; decision_note: string; agency_code: string | null; updated_at: string; anonymised_at: string | null; company_type: string | null; company_name: string | null; position: string | null; invite?: Invite | null; access?: AccountAccess; can_manage_users?: boolean; capabilities?: CapabilityProjection };
export type AccountEvent = { id: string; account_id: string; actor_id: string; action: string; new_status: string; new_role: string; created_at: string; decision_note: string; previous_decision_note: string };
export function suggestedRole(tasks: string[]) { return tasks.includes("agency") ? "agency" : tasks.includes("publish") ? "publisher" : tasks.includes("online") ? "online_staff" : tasks.includes("edit") ? "editor" : "viewer"; }
export const label = (role: string | null) => roleLabels[role as keyof typeof roleLabels] || "ยังไม่กำหนด";
export const methodLabel = (method: string) => method === "google" ? "Google" : "อีเมลและรหัสผ่าน";
export const submittedPending = (a: Account) => a.status === "PENDING" && !!a.privacy_acknowledged_at;
export type AccountApiError = Error & { status?: number; code?: string; account_id?: string; details?: { field: string; message: string }[] };
// HTML pattern uses Unicode v mode: escaped parentheses/hyphen are the same set as the API regex.
export const phonePattern = String.raw`^\+?[0-9 \(\)\-]{8,30}$`;
export async function accountApi(path: string, body?: unknown, method = "POST") {
  const response = await fetch(`/api/hub/${path}`, body === undefined ? { cache: "no-store" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (result.error?.invalidate_access === true && typeof window !== "undefined") window.dispatchEvent(new Event("hub-content-access-invalidated"));
  if (!response.ok) throw Object.assign(new Error(result.error?.message || "ไม่สามารถโหลดข้อมูลได้"), { ...result.error, status: response.status });
  return result.data;
}

const emptyDirectory = { names: {} as Record<string, string>, admin: false, pending: null as number | null, account: null as HubAccount | null, capabilities: emptyCapabilities, ready: false, signedOut: false, error: "" };
const Directory = createContext(emptyDirectory);
export function AccountDirectory({ children, enabled, initialAccount = null }: { children: ReactNode; enabled: boolean; initialAccount?: HubAccount | null }) {
  const [value, setValue] = useState(emptyDirectory);
  const current = useRef<HubAccount | null>(null);
  const edits = useRef(new Map<string, { label: string; value: string }>());
  const [recovery, setRecovery] = useState<{ label: string; value: string }[]>([]);
  useEffect(() => {
    // Login/request pages don't query the staff directory or the admin queue.
    if (/^\/(login|signup|auth|account)(\/|$)/.test(location.pathname)) return;
    let alive = true, loading = false, activated = enabled, refreshQueued = false;
    let generation = 0, expiryTimer: ReturnType<typeof setTimeout> | undefined;
    // The server just verified this projection for this page. Consume it once
    // after hydration; every later poll/focus/change still reads fresh /me.
    let firstAccount = initialAccount;
    function preserveTyped() { setRecovery(Array.from(edits.current.values())); }
    function closeContent(account: HubAccount) {
      if (!alive) return;
      generation++; firstAccount = null; clearTimeout(expiryTimer); preserveTyped();
      // This is a temporary UI restriction, never a grant or a BUD calculation.
      // A fresh /me projection is the only way to reopen protected content.
      const original = account.capabilities ?? emptyCapabilities;
      const tabs = { ...original.tabs };
      for (const tab of ["projects", "brands", "knowledge", "promotions", "releases"]) tabs[tab] = { view: false, edit: false, approve: false };
      const caps = { ...original, tabs };
      setValue(previous => ({ ...previous, names: {}, account: { ...account, capabilities: caps }, capabilities: caps,
        admin: caps.can_manage_users === true, ready: true, signedOut: false, error: contentScopeText.scope_loss }));
    }
    function scheduleExpiry(account: HubAccount) {
      clearTimeout(expiryTimer);
      const deadline = account.content_scope?.expires_at;
      if (deadline == null) return;
      const expire = () => {
        if (!alive || current.current !== account) return;
        if (contentScopeExpired(account)) { closeContent(account); void refresh(true); }
        else expiryTimer = setTimeout(expire, Math.min(Date.parse(deadline) - Date.now(), 2_147_483_647));
      };
      expire();
    }
    function failed(error: unknown, stamp: number) {
      if (!alive || stamp !== generation) return;
      if ([401, 403].includes((error as AccountApiError).status ?? 0)) {
        generation++; clearTimeout(expiryTimer); preserveTyped();
        setValue({ ...emptyDirectory, ready: true, signedOut: true });
      } else {
        if (contentScopeExpired(current.current) && current.current) closeContent(current.current);
        setValue(previous => ({ ...previous, ready: true, error: unavailableMessage }));
      }
    }
    async function refreshNames(account: HubAccount, stamp: number) {
      try {
        const names = await accountApi("v1/accounts/display-names");
        if (alive && stamp === generation && current.current === account && !contentScopeExpired(account)) {
          setValue(previous => ({ ...previous, names: Object.fromEntries(names.map((r: Account) => [r.id, r.display_name_th])) }));
        }
      } catch (error) { failed(error, stamp); }
    }
    async function refresh(force = false) {
      if (!activated || !alive || !force && document.visibilityState === "hidden") return;
      if (current.current && contentScopeExpired(current.current)) closeContent(current.current);
      const stamp = ++generation;
      if (loading) { refreshQueued = true; return; }
      loading = true;
      try {
        const initial = firstAccount; firstAccount = null;
        const me: HubAccount = initial ?? await accountApi("v1/me");
        if (!alive || stamp !== generation) return;
        const prior = current.current;
        if (prior?.id && prior.id !== me.id) { edits.current.clear(); setRecovery([]); }
        else if (prior && (location.pathname === "/admin/accounts" ? accountManagementKey(prior) !== accountManagementKey(me) : capabilityKey(prior) !== capabilityKey(me))) preserveTyped();
        current.current = me;
        if (contentScopeExpired(me)) { closeContent(me); return; }
        const caps = me.status === "ACTIVE" ? me.capabilities ?? emptyCapabilities : emptyCapabilities;
        const admin = caps.can_manage_users === true;
        setValue(previous => ({ ...previous, names: prior && capabilityKey(prior) === capabilityKey(me) ? previous.names : {}, account: me, capabilities: caps, admin, pending: admin ? me.pending_count ?? null : null, ready: true, signedOut: false, error: "" }));
        scheduleExpiry(me);
        const staff = me.status === "ACTIVE" && caps.published_consumer;
        if (staff) void refreshNames(me, stamp);
        else setValue(previous => ({ ...previous, names: {} }));
      } catch (error) { failed(error, stamp); } finally {
        loading = false;
        // A focus/identity event during /me must not be dropped. Names load
        // independently, so a slow old directory cannot delay newer authority.
        if (refreshQueued && alive) { refreshQueued = false; void refresh(true); }
      }
    }
    const capture = (event: Event) => {
      const input = event.target;
      // Authored rich text opts in explicitly. Source previews never opt in.
      if (input instanceof HTMLElement && input.matches('[contenteditable="true"][data-permission-recovery]')) {
        const label = input.getAttribute("aria-label") || "ข้อความที่กรอก";
        edits.current.set(input.id || label, { label, value: input.innerText });
        return;
      }
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) return;
      if (/^\/(account|login|signup|auth)(\/|$)/.test(location.pathname)) return;
      // Account source/search/invite fields never enter recovery. Only authored
      // administrative notes opt in, scoped to this identity and this document.
      if (/^\/admin\/accounts(\/|$)/.test(location.pathname) && !input.matches("textarea[data-permission-recovery]")) return;
      if (input instanceof HTMLInputElement && ["password", "file", "hidden", "checkbox", "radio", "submit", "button", "reset"].includes(input.type)) return;
      if (input.disabled || "readOnly" in input && input.readOnly) return;
      const labelNode = input.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
      labelNode?.querySelectorAll("input, textarea, select").forEach(node => node.remove());
      const label = input.getAttribute("aria-label") || labelNode?.textContent?.trim() || input.name || "ข้อความที่กรอก";
      edits.current.set(input.id || `${input.name}:${label}`, { label, value: input.value });
    };
    if (enabled) void refresh(); else setValue({ ...emptyDirectory, ready: true });
    const changed = () => { activated = true; void refresh(); };
    const invalidated = () => { activated = true; if (current.current) closeContent(current.current); void refresh(true); };
    const visibleRefresh = () => { void refresh(); };
    const timer = window.setInterval(visibleRefresh, 30000);
    window.addEventListener("hub-accounts-changed", changed); window.addEventListener("focus", visibleRefresh); document.addEventListener("visibilitychange", visibleRefresh);
    window.addEventListener("hub-content-access-invalidated", invalidated);
    document.addEventListener("input", capture); document.addEventListener("change", capture);
    return () => { alive = false; generation++; clearTimeout(expiryTimer); clearInterval(timer); window.removeEventListener("hub-accounts-changed", changed); window.removeEventListener("hub-content-access-invalidated", invalidated); window.removeEventListener("focus", visibleRefresh); document.removeEventListener("visibilitychange", visibleRefresh); document.removeEventListener("input", capture); document.removeEventListener("change", capture); };
  }, [enabled]);
  return <Directory value={value}>{value.error && value.account && <p role="alert">{value.error}</p>}{children}{recovery.length > 0 && <aside className="registry-panel" aria-label="ข้อความที่คุณกรอก"><h2>สิทธิ์เปลี่ยนแล้ว ข้อความที่คุณกรอกยังอยู่</h2><p>ข้อมูลต้นทางที่ไม่มีสิทธิ์ดูถูกปิดแล้ว คัดลอกข้อความที่ต้องการเก็บก่อนเปลี่ยนหน้า</p>{recovery.map((item, index) => <div className="form-field" key={index}><label htmlFor={`hub-recovered-${index}`}>{item.label}</label><textarea id={`hub-recovered-${index}`} readOnly value={item.value} /></div>)}<button type="button" className="button secondary" onClick={() => { setRecovery([]); edits.current.clear(); }}>เก็บข้อความแล้ว ปิดรายการนี้</button></aside>}</Directory>;
}
export function useAccountDirectory() { return useContext(Directory); }
export function useHubPermissions() {
  const directory = useAccountDirectory();
  return { ...directory, can: (tab: string, level: "view" | "edit" | "approve" = "view") => can(directory.capabilities, tab, level),
    special: (action: string) => canSpecial(directory.capabilities, action) };
}

// Account management follows its own manager/Admin authority. A temporary
// content-read restriction must not discard its open manager dialog or input.
export function accountManagementKey(account: HubAccount | null) {
  return JSON.stringify([account?.id, account?.status, account?.hub_role ?? account?.role,
    account?.agency_code ?? account?.agency, account?.capabilities?.can_manage_users === true]);
}

// Mount the owning workspace only while its source tab remains readable. This is
// outside components that own caches; revocation discards their server data.
export function PermissionBoundary({ tab, children, localMode = false, initialRole = null }: { tab: string; children: ReactNode; localMode?: boolean; initialRole?: LocalRole | null }) {
  const permissions = useHubPermissions();
  if (!permissions.ready) return <p role="status">กำลังตรวจสิทธิ์การใช้งาน…</p>;
  if (permissions.error && !permissions.account) return <p role="alert">{permissions.error}</p>;
  if (!permissions.signedOut && !permissions.account || permissions.account?.status === "ACTIVE" && (tab === "accounts" ? permissions.admin : permissions.can(tab))) return <Fragment key={tab === "accounts" ? accountManagementKey(permissions.account) : capabilityKey(permissions.account)}>{children}</Fragment>;
  return <main className="account-page"><section className="registry-panel"><h1>ไม่มีสิทธิ์เข้าถึงหน้านี้</h1>{localMode && <LocalPersonaPicker initialRole={initialRole} />}<p>ข้อมูลต้นทางถูกปิดแล้ว ข้อความที่คุณกรอกเก็บไว้ด้านล่าง</p>{permissions.signedOut ? <a href={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>เข้าสู่ระบบอีกครั้ง</a> : permissions.account?.status !== "ACTIVE" ? <a href="/account/request">ตรวจสถานะบัญชี</a> : <nav aria-label="หน้าที่คุณมีสิทธิ์">{hubPages.filter(page => page.id === "accounts" ? permissions.admin : permissions.can(page.id)).map(page => <p key={page.id}><a href={page.href}>{permissions.capabilities.catalog?.find(tab => tab.tab === page.id)?.label_th ?? page.label}</a></p>)}</nav>}</section></main>;
}

// Available only when a server page explicitly enables local demo mode. The
// selected label chooses a synthetic identity; /me remains the authority.
export function LocalPersonaPicker({ initialRole = null }: { initialRole?: LocalRole | null }) {
  const [selected, setSelected] = useState(initialRole ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function select(next: string) {
    const unsaved = new CustomEvent("hub-check-unsaved", { detail: { dirty: false } });
    window.dispatchEvent(unsaved);
    if (unsaved.detail.dirty && !window.confirm(workspaceText.local_persona_discard)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/local-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: next }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "เปลี่ยนบัญชีทดสอบไม่สำเร็จ");
      setSelected(next); window.dispatchEvent(new Event("hub-accounts-changed"));
      const account: HubAccount = await accountApi("v1/me");
      location.assign(account.status !== "ACTIVE" ? "/account/request" : location.pathname !== "/account/request" && canOpenPage(account, location.pathname, new URLSearchParams(location.search)) ? location.pathname + location.search + location.hash : workspaceLanding(account.capabilities));
    } catch (failure) { setError((failure as AccountApiError).status === 503 || failure instanceof TypeError ? "ระบบขัดข้องชั่วคราว กรุณาลองใหม่" : failure instanceof Error ? failure.message : "เปลี่ยนบัญชีทดสอบไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <div className="registry-panel local-persona-picker"><p className="local-note" role="note"><span><strong>{workspaceText.local_testing}</strong>{workspaceText.local_testing_note}</span></p><label>บัญชีทดสอบ<select aria-label="เลือกบัญชีทดสอบ" value={selected} disabled={busy} onChange={event => void select(event.target.value)}><option value="" disabled>เลือกบัญชี</option>{localPersonas.map(role => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>{error && <p role="alert">{error}</p>}</div>;
}

export function ActorName({ id }: { id?: string | null }) { const { names } = useAccountDirectory(); return <span title={id || undefined}>{id ? names[id] || (/^[0-9a-f-]{36}$/i.test(id) ? "ผู้ใช้เดิม" : id) : "ยังไม่มีผู้ดำเนินการ"}</span>; }

export type Invite = { id: string; email: string; display_hint: string; company_type: string; company_name: string | null; team: string; hub_role: string; agency_code: string | null; status: string; expires_at: string; invited_by_name: string; message?: string; permission_template?: string; permission_template_version?: number; template?: TemplateRef; template_label?: string };
export const companyLabels: Record<string,string> = { SENA: "เสนาดีเวลลอปเมนท์", SENA_SUBSIDIARY: "บริษัทในเครือเสนา", AGENCY: "เอเจนซี", CONTRACTOR: "ผู้รับจ้างภายนอก" };
export const companyLabel = (a: {company_type: string | null; company_name: string | null}) => a.company_type ? [companyLabels[a.company_type],a.company_name].filter(Boolean).join(" · ") : "ยังไม่ระบุ";

export function AccessRequestPage({ localMode = false, initialRole = null }: { localMode?: boolean; initialRole?: LocalRole | null }) {
  const config = useHostedSession();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);
  async function checkAcceptedAccess() {
    setCheckingAccess(true); setError("");
    try { const fresh: Account = await accountApi("v1/me"); setAccount(current => current && current.id === fresh.id && new Date(current.updated_at) > new Date(fresh.updated_at) ? current : fresh); }
    catch { setError("บัญชีเปิดใช้งานแล้ว แต่ยังตรวจสิทธิ์พื้นที่ทำงานไม่สำเร็จ กรุณาลองตรวจสถานะอีกครั้ง"); }
    finally { setCheckingAccess(false); }
  }
  function savedRequest(saved: Account) {
    // The mutation result proves the completed outcome, but has no capability
    // projection. Never re-submit acceptance if its separate /me read fails.
    setAccount(saved); setEditing(false); setError("");
    if (saved.status === "ACTIVE") void checkAcceptedAccess();
  }
  useEffect(() => {
    let alive = true, first = true, loading = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || loading) return;
      loading = true;
      try {
        const a = await accountApi("v1/me");
        if (!alive) return;
        // An older in-flight poll must not undo a just-saved decision/acceptance.
        setAccount(current => current && current.id === a.id && new Date(current.updated_at) > new Date(a.updated_at) ? current : a); setError("");
        if (first) { setEditing(!a.privacy_acknowledged_at && a.status === "PENDING"); first = false; }
      } catch (e) { if (alive) setError((e as Error).message); }
      finally { loading = false; }
    };
    void refresh(); const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const workspace = workspaceLanding(account?.capabilities);
  const title = editing && account?.status === "PENDING" ? account.invite?.id ? "ตอบรับคำเชิญ" : "ขอสิทธิ์ใช้งาน" : account ? statuses[account.status] : "กำลังโหลดคำขอ…";
  return <AuthLayout title={title} label={config?.label} step={editing && account?.status === "PENDING" ? 3 : undefined} wide description={editing ? "บอกเราเกี่ยวกับคุณและงานที่รับผิดชอบ เพื่อจัดสิทธิ์ให้เหมาะกับการใช้งาน" : "ติดตามสถานะบัญชีและคำขอเข้าใช้งานของคุณได้ที่นี่"}><div className="account-page auth-request">{localMode && <LocalPersonaPicker initialRole={initialRole} />}
    <div className="auth-request-session"><span>{account?.email}</span><SignOut /></div>
    {error && <p role="alert">{error}</p>}
    {account && <>
      <p className="auth-request-status" role="status">สถานะ: {statuses[account.status]}{editing && account.status !== "PENDING" && " · ข้อความที่คุณกรอกยังอยู่ในหน้านี้"}</p>
      {["REJECTED", "SUSPENDED"].includes(account.status) && account.decision_note && <p>เหตุผลจากผู้ดูแล: {account.decision_note}</p>}
      {account.invite?.message && <p>{account.invite.message}</p>}
      {editing ? <RequestForm key={account.id} account={account} onSaved={savedRequest} /> : <><RequestSummary account={account} />{account.status === "PENDING" && <button className="button secondary" onClick={() => setEditing(true)}>แก้ไขคำขอ</button>}</>}
      {account.status === "ACTIVE" && (account.capabilities ? <a className="button primary" href={workspace}>เข้าสู่พื้นที่ทำงาน</a> : <button type="button" className="button secondary" disabled={checkingAccess} onClick={() => void checkAcceptedAccess()}>{checkingAccess ? "กำลังตรวจสิทธิ์พื้นที่ทำงาน…" : "ตรวจสถานะพื้นที่ทำงานอีกครั้ง"}</button>)}
      {config?.adminContact && <p>ติดต่อผู้ดูแล: {config.adminContact}</p>}
    </>}</div></AuthLayout>;
}

function RequestForm({account, onSaved}: {account: Account; onSaved: (a: Account) => void}) {
  const [error, setError] = useState(""); const [fields, setFields] = useState<Record<string,string>>({});
  const [busy, setBusy] = useState(false); const summary = useRef<HTMLDivElement>(null);
  const invite = account.invite?.id ? account.invite : null;
  const [company, setCompany] = useState(invite?.company_type || account.company_type || "");
  const locked = invite?.hub_role === "agency";
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  const fieldError = (field: string) => fields[field] && <p id={`${field}-error`} className="field-error">{fields[field]}</p>;
  const invalid = (field: string) => ({ "aria-invalid": !!fields[field], "aria-describedby": `${field}-error` });
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || account.status !== "PENDING") return;
    const f = new FormData(event.currentTarget); setBusy(true); setError(""); setFields({});
    const profile = {display_name_th:f.get("display_name_th"),phone:f.get("phone"),team:f.get("team"),company_type:locked ? "AGENCY" : company,
      company_name:locked ? invite?.agency_code : f.get("company_name"),position:f.get("position"),privacy_acknowledged:f.get("privacy") === "on"};
    try { onSaved(await accountApi(invite ? "v1/me/invite-accept" : "v1/me/access-request", invite ? {...profile,invite_id:invite.id} : {...profile,requested_tasks:f.getAll("tasks"),reason:f.get("reason")}, invite || !account.privacy_acknowledged_at ? "POST" : "PATCH")); }
    catch (e) { const failure = e as AccountApiError; setError(failure.message); setFields(Object.fromEntries((failure.details || []).map(d => [d.field.split(".")[0], d.message]))); }
    finally { setBusy(false); }
  }
  return <form className="auth-request-form" onSubmit={save} noValidate>
    {error && <div role="alert" tabIndex={-1} ref={summary}><p>{error}</p><ul>{Object.entries(fields).map(([key,text]) => <li key={key}><a href={`#${key}`}>{text}</a></li>)}</ul></div>}
    {invite && <p>สิทธิ์ที่ได้รับ: {label(invite.hub_role)} {invite.agency_code}</p>}
    <div className="auth-request-fields">
    <div className="form-field"><label htmlFor="display_name_th">ชื่อและนามสกุลภาษาไทย</label><input id="display_name_th" name="display_name_th" autoComplete="name" required maxLength={200} {...invalid("display_name_th")} aria-describedby="name-help display_name_th-error" defaultValue={/[ก-๙]/.test(account.display_name_th) ? account.display_name_th : ""} placeholder={/[ก-๙]/.test(account.display_name_th) ? undefined : account.display_name_th} /><p className="auth-hint" id="name-help">กรอกชื่อและนามสกุลภาษาไทย</p>{fieldError("display_name_th")}</div>
    <div className="form-field"><label htmlFor="phone">เบอร์โทรศัพท์ที่ทำงาน</label><input id="phone" name="phone" type="tel" autoComplete="tel" required pattern={phonePattern} {...invalid("phone")} defaultValue={account.phone} />{fieldError("phone")}</div>
    <div className="form-field"><label htmlFor="company_type">บริษัท</label><select id="company_type" required value={locked ? "AGENCY" : company} onChange={e => setCompany(e.target.value)} disabled={locked} {...invalid("company_type")}><option value="">เลือกประเภทบริษัท</option>{Object.entries(companyLabels).map(([key,text]) => <option key={key} value={key}>{text}</option>)}</select>{fieldError("company_type")}</div>
    {(company && company !== "SENA" || locked) && <div className="form-field"><label htmlFor="company_name">ชื่อบริษัท</label><input id="company_name" name="company_name" required maxLength={200} readOnly={locked} defaultValue={locked ? invite?.agency_code || "" : invite?.company_name || account.company_name || ""} {...invalid("company_name")} />{locked && <p>บริษัทผูกกับรหัสเอเจนซีในคำเชิญ</p>}{fieldError("company_name")}</div>}
    <div className="form-field"><label htmlFor="team">ทีม / ฝ่าย</label><input id="team" name="team" required maxLength={200} {...invalid("team")} defaultValue={invite?.team || account.team} />{fieldError("team")}</div>
    <div className="form-field"><label htmlFor="position">ตำแหน่ง</label><input id="position" name="position" required maxLength={100} {...invalid("position")} defaultValue={account.position || ""} />{fieldError("position")}</div>
    </div>
    {!invite && <><fieldset id="requested_tasks" tabIndex={-1} {...invalid("requested_tasks")}><legend>งานที่ต้องการทำ (เลือกอย่างน้อยหนึ่งข้อ)</legend>{Object.entries(taskLabels).map(([key,text]) => <label className="account-choice" key={key}><input type="checkbox" name="tasks" value={key} defaultChecked={account.requested_tasks.includes(key)} />{text}</label>)}{fieldError("requested_tasks")}</fieldset>
      <div className="form-field"><label htmlFor="reason">เหตุผล / โครงการที่รับผิดชอบ</label><textarea id="reason" name="reason" required maxLength={2000} {...invalid("reason")} defaultValue={account.reason} />{fieldError("reason")}</div></>}
    <p className="auth-help">ข้อมูลนี้ใช้พิจารณาสิทธิ์และติดต่อเรื่องบัญชี ผู้ดูแลระบบเท่านั้นที่อ่านคำขอได้ ชื่อจะแสดงต่อทีมงานในประวัติการทำงาน ไม่ส่งคำขอให้ผู้ช่วยหรือคลัง RAG ลบข้อมูลส่วนบุคคลของคำขอที่ถูกปฏิเสธหลัง 90 วัน</p>
    <label className="account-choice"><input id="privacy_acknowledged" type="checkbox" name="privacy" required {...invalid("privacy_acknowledged")} defaultChecked={!!account.privacy_acknowledged_at} />รับทราบประกาศความเป็นส่วนตัว</label>{fieldError("privacy_acknowledged")}
    <button className="button primary" disabled={busy || account.status !== "PENDING"}>{busy ? "กำลังบันทึก…" : invite ? "ตอบรับคำเชิญ" : "ส่งคำขอ"}</button>
  </form>;
}

export function RequestSummary({account:a}: {account:Account}) {
  return <dl className="account-summary"><dt>ชื่อ</dt><dd>{a.display_name_th || "ยังไม่ระบุ"}</dd><dt>วิธีเข้าสู่ระบบ</dt><dd>{methodLabel(a.sign_in_method)}</dd><dt>บริษัท</dt><dd>{companyLabel(a)}</dd><dt>ตำแหน่ง</dt><dd>{a.position || "ยังไม่ระบุ"}</dd><dt>ทีม / ฝ่าย</dt><dd>{a.team || "ยังไม่ระบุ"}</dd><dt>โทรศัพท์</dt><dd><a href={`tel:${a.phone.replace(/[^+0-9]/g, "")}`}>{a.phone || "ยังไม่ระบุ"}</a></dd><dt>งานที่ขอ</dt><dd>{a.requested_tasks.map(t => taskLabels[t]).join(" · ") || "ยังไม่ระบุ"}</dd><dt>เหตุผล / โครงการ</dt><dd>{a.reason || "ยังไม่ระบุ"}</dd></dl>;
}
