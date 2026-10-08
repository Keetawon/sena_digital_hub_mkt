"use client";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { SignOut, useHostedSession } from "./hosted-session";
import { roleLabels } from "@/lib/roles";

export const taskLabels: Record<string, string> = { read: "อ่านข้อมูลโครงการ", edit: "แก้ไขข้อมูลและสื่อ", publish: "อนุมัติและเผยแพร่ข้อมูล", online: "ดูแลงานโฆษณาและงบ", agency: "ทำงานในนามเอเจนซี" };
export const statuses: Record<string, string> = { PENDING: "รออนุมัติ", ACTIVE: "ใช้งานอยู่", SUSPENDED: "ระงับ", REJECTED: "ปฏิเสธ" };
export type Account = { id: string; email: string; sign_in_method: string; display_name_th: string; phone: string; team: string; requested_tasks: string[]; reason: string; privacy_acknowledged_at: string | null; status: string; hub_role: string | null; decision_note: string; agency_code: string | null; updated_at: string; anonymised_at: string | null; company_type: string | null; company_name: string | null; position: string | null; invite?: Invite | null };
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
  if (!response.ok) throw Object.assign(new Error(result.error?.message || "ไม่สามารถโหลดข้อมูลได้"), { ...result.error, status: response.status });
  return result.data;
}

const Directory = createContext<{ names: Record<string, string>; admin: boolean; pending: number | null }>({ names: {}, admin: false, pending: null });
export function AccountDirectory({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [value, setValue] = useState({ names: {} as Record<string, string>, admin: false, pending: null as number | null });
  useEffect(() => {
    // Login/request pages don't query the staff directory or the admin queue.
    if (/^\/(login|signup|auth|account)(\/|$)/.test(location.pathname)) return;
    let alive = true;
    async function refresh() {
      try {
        const me = await accountApi("v1/me"); if (me.status !== "ACTIVE") return;
        if (alive) setValue(previous => ({ ...previous, admin: me.role === "admin", pending: null }));
        const staff = ["editor", "publisher", "viewer", "admin", "online_staff"].includes(me.role);
        const names = staff ? await accountApi("v1/accounts/display-names") : [];
        const accounts = me.role === "admin" ? await accountApi("v1/admin/accounts") : null;
        if (alive) setValue({ names: Object.fromEntries(names.map((r: Account) => [r.id, r.display_name_th])), admin: me.role === "admin", pending: accounts ? accounts.items.filter(submittedPending).length : null });
      } catch { /* Existing page error handling owns a failed session. */ }
    }
    if (enabled) void refresh(); window.addEventListener("hub-accounts-changed", refresh);
    return () => { alive = false; window.removeEventListener("hub-accounts-changed", refresh); };
  }, [enabled]);
  return <Directory value={value}>{children}</Directory>;
}
export function useAccountDirectory() { return useContext(Directory); }
export function ActorName({ id }: { id?: string | null }) { const { names } = useAccountDirectory(); return <span title={id || undefined}>{id ? names[id] || (/^[0-9a-f-]{36}$/i.test(id) ? "ผู้ใช้เดิม" : id) : "ยังไม่มีผู้ดำเนินการ"}</span>; }

export type Invite = { id: string; email: string; display_hint: string; company_type: string; company_name: string | null; team: string; hub_role: string; agency_code: string | null; status: string; expires_at: string; invited_by_name: string; message?: string };
export const companyLabels: Record<string,string> = { SENA: "เสนาดีเวลลอปเมนท์", SENA_SUBSIDIARY: "บริษัทในเครือเสนา", AGENCY: "เอเจนซี", CONTRACTOR: "ผู้รับจ้างภายนอก" };
export const companyLabel = (a: {company_type: string | null; company_name: string | null}) => a.company_type ? [companyLabels[a.company_type],a.company_name].filter(Boolean).join(" · ") : "ยังไม่ระบุ";

export function AccessRequestPage() {
  const config = useHostedSession();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let alive = true, first = true, loading = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || loading) return;
      loading = true;
      try {
        const a = await accountApi("v1/me");
        if (!alive) return;
        // An older in-flight poll must not undo a just-saved decision/acceptance.
        setAccount(current => current && new Date(current.updated_at) > new Date(a.updated_at) ? current : a); setError("");
        if (first) { setEditing(!a.privacy_acknowledged_at && a.status === "PENDING"); first = false; }
      } catch (e) { if (alive) setError((e as Error).message); }
      finally { loading = false; }
    };
    void refresh(); const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const workspace = account?.hub_role === "agency" || account?.hub_role === "online_staff" ? "/ads/registry" : "/";
  return <main className="account-page"><section className="registry-panel"><p className="eyebrow">SENA Digital Hub</p><h1>{editing && account?.status === "PENDING" ? account.invite?.id ? "ตอบรับคำเชิญ" : "ขอสิทธิ์ใช้งาน" : account ? statuses[account.status] : "กำลังโหลดคำขอ…"}</h1><SignOut />
    {error && <p role="alert">{error}</p>}
    {account && <><p>อีเมล: {account.email}</p>
      <p role="status">สถานะ: {statuses[account.status]}{editing && account.status !== "PENDING" && " · ข้อความที่ยังไม่บันทึกยังอยู่ในหน้านี้"}</p>
      {["REJECTED", "SUSPENDED"].includes(account.status) && account.decision_note && <p>เหตุผลจากผู้ดูแล: {account.decision_note}</p>}
      {account.invite?.message && <p>{account.invite.message}</p>}
      {editing ? <RequestForm account={account} onSaved={a => { setAccount(a); setEditing(false); }} /> : <><RequestSummary account={account} />{account.status === "PENDING" && <button className="button secondary" onClick={() => setEditing(true)}>แก้ไขคำขอ</button>}</>}
      {account.status === "ACTIVE" && <a className="button primary" href={workspace}>เข้าสู่พื้นที่ทำงาน</a>}
      {config?.adminContact && <p>ติดต่อผู้ดูแล: {config.adminContact}</p>}
    </>}</section></main>;
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
  return <form onSubmit={save} noValidate>
    {error && <div role="alert" tabIndex={-1} ref={summary}><p>{error}</p><ul>{Object.entries(fields).map(([key,text]) => <li key={key}><a href={`#${key}`}>{text}</a></li>)}</ul></div>}
    {invite && <p>สิทธิ์ที่ได้รับ: {label(invite.hub_role)} {invite.agency_code}</p>}
    <div className="form-field"><label htmlFor="display_name_th">ชื่อและนามสกุลภาษาไทย</label><input id="display_name_th" name="display_name_th" autoComplete="name" required maxLength={200} {...invalid("display_name_th")} aria-describedby="name-help display_name_th-error" defaultValue={/[ก-๙]/.test(account.display_name_th) ? account.display_name_th : ""} placeholder={/[ก-๙]/.test(account.display_name_th) ? undefined : account.display_name_th} /><p id="name-help">กรอกชื่อและนามสกุลภาษาไทย</p>{fieldError("display_name_th")}</div>
    <div className="form-field"><label htmlFor="phone">เบอร์โทรศัพท์ที่ทำงาน</label><input id="phone" name="phone" type="tel" autoComplete="tel" required pattern={phonePattern} {...invalid("phone")} defaultValue={account.phone} />{fieldError("phone")}</div>
    <div className="form-field"><label htmlFor="company_type">บริษัท</label><select id="company_type" required value={locked ? "AGENCY" : company} onChange={e => setCompany(e.target.value)} disabled={locked} {...invalid("company_type")}><option value="">เลือกประเภทบริษัท</option>{Object.entries(companyLabels).map(([key,text]) => <option key={key} value={key}>{text}</option>)}</select>{fieldError("company_type")}</div>
    {(company && company !== "SENA" || locked) && <div className="form-field"><label htmlFor="company_name">ชื่อบริษัท</label><input id="company_name" name="company_name" required maxLength={200} readOnly={locked} defaultValue={locked ? invite?.agency_code || "" : invite?.company_name || account.company_name || ""} {...invalid("company_name")} />{locked && <p>บริษัทผูกกับรหัสเอเจนซีในคำเชิญ</p>}{fieldError("company_name")}</div>}
    <div className="form-field"><label htmlFor="team">ทีม / ฝ่าย</label><input id="team" name="team" required maxLength={200} {...invalid("team")} defaultValue={invite?.team || account.team} />{fieldError("team")}</div>
    <div className="form-field"><label htmlFor="position">ตำแหน่ง</label><input id="position" name="position" required maxLength={100} {...invalid("position")} defaultValue={account.position || ""} />{fieldError("position")}</div>
    {!invite && <><fieldset id="requested_tasks" tabIndex={-1} {...invalid("requested_tasks")}><legend>งานที่ต้องการทำ (เลือกอย่างน้อยหนึ่งข้อ)</legend>{Object.entries(taskLabels).map(([key,text]) => <label className="account-choice" key={key}><input type="checkbox" name="tasks" value={key} defaultChecked={account.requested_tasks.includes(key)} />{text}</label>)}{fieldError("requested_tasks")}</fieldset>
      <div className="form-field"><label htmlFor="reason">เหตุผล / โครงการที่รับผิดชอบ</label><textarea id="reason" name="reason" required maxLength={2000} {...invalid("reason")} defaultValue={account.reason} />{fieldError("reason")}</div></>}
    <p>ข้อมูลนี้ใช้พิจารณาสิทธิ์และติดต่อเรื่องบัญชี ผู้ดูแลระบบเท่านั้นที่อ่านคำขอได้ ชื่อจะแสดงต่อทีมงานในประวัติการทำงาน ไม่ส่งคำขอให้ผู้ช่วยหรือคลัง RAG ลบข้อมูลส่วนบุคคลของคำขอที่ถูกปฏิเสธหลัง 90 วัน</p>
    <label className="account-choice"><input id="privacy_acknowledged" type="checkbox" name="privacy" required {...invalid("privacy_acknowledged")} defaultChecked={!!account.privacy_acknowledged_at} />รับทราบประกาศความเป็นส่วนตัว</label>{fieldError("privacy_acknowledged")}
    <button className="button primary" disabled={busy || account.status !== "PENDING"}>{busy ? "กำลังบันทึก…" : invite ? "ตอบรับคำเชิญ" : "ส่งคำขอ"}</button>
  </form>;
}

export function RequestSummary({account:a}: {account:Account}) {
  return <dl className="account-summary"><dt>ชื่อ</dt><dd>{a.display_name_th || "ยังไม่ระบุ"}</dd><dt>วิธีเข้าสู่ระบบ</dt><dd>{methodLabel(a.sign_in_method)}</dd><dt>บริษัท</dt><dd>{companyLabel(a)}</dd><dt>ตำแหน่ง</dt><dd>{a.position || "ยังไม่ระบุ"}</dd><dt>ทีม / ฝ่าย</dt><dd>{a.team || "ยังไม่ระบุ"}</dd><dt>โทรศัพท์</dt><dd><a href={`tel:${a.phone.replace(/[^+0-9]/g, "")}`}>{a.phone || "ยังไม่ระบุ"}</a></dd><dt>งานที่ขอ</dt><dd>{a.requested_tasks.map(t => taskLabels[t]).join(" · ") || "ยังไม่ระบุ"}</dd><dt>เหตุผล / โครงการ</dt><dd>{a.reason || "ยังไม่ระบุ"}</dd></dl>;
}
