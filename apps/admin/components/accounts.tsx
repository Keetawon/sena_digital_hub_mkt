"use client";
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SignOut, useHostedSession } from "./hosted-session";
import { roleLabels } from "@/lib/roles";

export const taskLabels: Record<string, string> = { read: "อ่านข้อมูลโครงการ", edit: "แก้ไขข้อมูลและสื่อ", publish: "อนุมัติและเผยแพร่ข้อมูล", online: "ดูแลงานโฆษณาและงบ", agency: "ทำงานในนามเอเจนซี" };
const statuses: Record<string, string> = { PENDING: "รออนุมัติ", ACTIVE: "ใช้งานอยู่", SUSPENDED: "ระงับ", REJECTED: "ปฏิเสธ" };
type Account = { id: string; email: string; sign_in_method: string; display_name_th: string; phone: string; team: string; requested_tasks: string[]; reason: string; privacy_acknowledged_at: string | null; status: string; hub_role: string | null; decision_note: string; agency_code: string | null; updated_at: string };
type AccountEvent = { id: string; account_id: string; actor_id: string; action: string; new_status: string; new_role: string; created_at: string };
export function suggestedRole(tasks: string[]) { return tasks.includes("agency") ? "agency" : tasks.includes("publish") ? "publisher" : tasks.includes("online") ? "online_staff" : tasks.includes("edit") ? "editor" : "viewer"; }
const label = (role: string | null) => roleLabels[role as keyof typeof roleLabels] || "ยังไม่กำหนด";
export async function accountApi(path: string, body?: unknown, method = "POST") {
  const response = await fetch(`/api/hub/${path}`, body === undefined ? { cache: "no-store" } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "ไม่สามารถโหลดข้อมูลได้");
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
        if (alive) setValue({ names: Object.fromEntries(names.map((r: Account) => [r.id, r.display_name_th])), admin: me.role === "admin", pending: accounts ? accounts.items.filter((r: Account) => r.status === "PENDING" && r.privacy_acknowledged_at).length : null });
      } catch { /* Existing page error handling owns a failed session. */ }
    }
    if (enabled) void refresh(); window.addEventListener("hub-accounts-changed", refresh);
    return () => { alive = false; window.removeEventListener("hub-accounts-changed", refresh); };
  }, [enabled]);
  return <Directory value={value}>{children}</Directory>;
}
export function useAccountDirectory() { return useContext(Directory); }
export function ActorName({ id }: { id?: string | null }) { const { names } = useAccountDirectory(); return <span title={id || undefined}>{id ? names[id] || (/^[0-9a-f-]{36}$/i.test(id) ? "ผู้ใช้เดิม" : id) : "ยังไม่มีผู้ดำเนินการ"}</span>; }

export function AccessRequestPage() {
  const config = useHostedSession();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { accountApi("v1/me").then(a => { setAccount(a); setEditing(!a.privacy_acknowledged_at && a.status === "PENDING"); }).catch(e => setError(e.message)); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try { setAccount(await accountApi("v1/me/access-request", { display_name_th: form.get("display_name_th"), phone: form.get("phone"), team: form.get("team"), requested_tasks: form.getAll("tasks"), reason: form.get("reason"), privacy_acknowledged: form.get("privacy") === "on" }, account?.privacy_acknowledged_at ? "PATCH" : "POST")); setEditing(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="account-page"><section className="registry-panel"><p className="eyebrow">SENA Digital Hub</p><h1>{editing ? "ขอสิทธิ์ใช้งาน" : account ? statuses[account.status] : "กำลังโหลดคำขอ…"}</h1><SignOut />{error && <p role="alert">{error}</p>}
    {account && <><p>อีเมล: {account.email}</p>{editing ? <form onSubmit={save}>
      <div className="form-field"><label htmlFor="full-name">ชื่อและนามสกุลภาษาไทย</label><input id="full-name" name="display_name_th" autoComplete="name" required maxLength={200} defaultValue={account.display_name_th} /></div>
      <div className="form-field"><label htmlFor="work-phone">เบอร์โทรศัพท์ที่ทำงาน</label><input id="work-phone" name="phone" type="tel" autoComplete="tel" required pattern="[+0-9 ()\-]{8,30}" defaultValue={account.phone} /></div>
      <div className="form-field"><label htmlFor="team">ทีม / บริษัทเอเจนซี</label><input id="team" name="team" required maxLength={200} defaultValue={account.team} /></div>
      <fieldset><legend>งานที่ต้องการทำ (เลือกอย่างน้อยหนึ่งข้อ)</legend>{Object.entries(taskLabels).map(([key, text]) => <label className="account-choice" key={key}><input type="checkbox" name="tasks" value={key} defaultChecked={account.requested_tasks.includes(key)} />{text}</label>)}</fieldset>
      <div className="form-field"><label htmlFor="reason">เหตุผล / โครงการที่รับผิดชอบ</label><textarea id="reason" name="reason" required maxLength={2000} defaultValue={account.reason} /></div>
      <p>ข้อมูลนี้ใช้พิจารณาสิทธิ์และติดต่อเรื่องบัญชี ผู้ดูแลระบบเท่านั้นที่อ่านคำขอได้ ชื่อจะแสดงต่อทีมงานในประวัติการทำงาน ไม่ส่งคำขอให้ผู้ช่วยหรือคลัง RAG ลบข้อมูลส่วนบุคคลของคำขอที่ถูกปฏิเสธหลัง 90 วัน</p>
      <label className="account-choice"><input type="checkbox" name="privacy" required defaultChecked={!!account.privacy_acknowledged_at} />รับทราบประกาศความเป็นส่วนตัว</label>
      <button className="button primary" disabled={busy}>{busy ? "กำลังบันทึก…" : "ส่งคำขอ"}</button>
    </form> : <><RequestSummary account={account} />{account.decision_note && <p>เหตุผลจากผู้ดูแล: {account.decision_note}</p>}{account.status === "PENDING" && <button className="button secondary" onClick={() => setEditing(true)}>แก้ไขคำขอ</button>}{account.status === "ACTIVE" && <a className="button primary" href={account.hub_role === "agency" || account.hub_role === "online_staff" ? "/ads/registry" : "/"}>เข้าสู่พื้นที่ทำงาน</a>}<p><a href="/account/request">ตรวจสถานะอีกครั้ง</a></p></>}
      {config?.adminContact && <p>ติดต่อผู้ดูแล: {config.adminContact}</p>}
    </>}</section></main>;
}
function RequestSummary({ account: a }: { account: Account }) { return <dl className="account-summary"><dt>ชื่อ</dt><dd>{a.display_name_th}</dd><dt>วิธีเข้าสู่ระบบ</dt><dd>{a.sign_in_method}</dd><dt>โทรศัพท์</dt><dd><a href={`tel:${a.phone.replace(/[^+0-9]/g, "")}`}>{a.phone}</a></dd><dt>ทีม / บริษัท</dt><dd>{a.team}</dd><dt>งานที่ขอ</dt><dd>{a.requested_tasks.map(t => taskLabels[t]).join(" · ")}</dd><dt>บทบาทแนะนำ</dt><dd>{label(suggestedRole(a.requested_tasks))}</dd><dt>เหตุผล / โครงการ</dt><dd>{a.reason}</dd><dt>บทบาทปัจจุบัน</dt><dd>{label(a.hub_role)} {a.agency_code}</dd></dl>; }

export function AdminAccounts() {
  const [data, setData] = useState<{ items: Account[]; events: AccountEvent[]; agencies: { code: string; label_th: string }[] } | null>(null);
  const [status, setStatus] = useState("PENDING"); const [search, setSearch] = useState(""); const [error, setError] = useState("");
  const refresh = () => accountApi("v1/admin/accounts").then(setData).catch(e => setError(e.message));
  useEffect(() => { void refresh(); }, []);
  return <section className="accounts-admin"><h1>ผู้ใช้และสิทธิ์</h1><p>ผู้ดูแลระบบอนุมัติบัญชีและกำหนดสิทธิ์ตามงานที่รับผิดชอบ</p>{error && <p role="alert">{error}</p>}<div className="content-actions" aria-label="สถานะบัญชี">{Object.entries(statuses).map(([key, text]) => <button className={`button ${key === status ? "primary" : "secondary"}`} key={key} aria-pressed={key === status} onClick={() => setStatus(key)}>{text} ({data?.items.filter(a => a.status === key).length ?? "…"})</button>)}</div><div className="form-field"><label htmlFor="account-search">ค้นหาชื่อ อีเมล หรือทีม</label><input id="account-search" type="search" value={search} onChange={e => setSearch(e.target.value)} /></div>
    {!data && !error && <p role="status">กำลังโหลดบัญชี…</p>}{data && data.items.filter(a => a.status === status && `${a.display_name_th} ${a.email} ${a.team}`.toLowerCase().includes(search.toLowerCase())).map(a => <details className="registry-panel" key={a.id}><summary><strong>{a.display_name_th || "ยังไม่ได้ส่งคำขอ"}</strong> · {a.email} · {a.sign_in_method}</summary><RequestSummary account={a} /><AccountDecision account={a} agencies={data.agencies} onSaved={() => { void refresh(); window.dispatchEvent(new Event("hub-accounts-changed")); }} /><details><summary>ประวัติ</summary><ul>{data.events.filter(e => e.account_id === a.id).map(e => <li key={e.id}>{new Date(e.created_at).toLocaleString("th-TH")} · {({ REQUEST: "ส่ง / แก้ไขคำขอ", approve: "อนุมัติ", role: "เปลี่ยนบทบาท", suspend: "ระงับ", reactivate: "เปิดใช้งานอีกครั้ง", reject: "ปฏิเสธ", BOOTSTRAP: "ตั้งผู้ดูแลคนแรก" } as Record<string,string>)[e.action] || e.action} · <ActorName id={e.actor_id} /> · {label(e.new_role)}</li>)}</ul></details></details>)}
    {data && !data.items.some(a => a.status === status && `${a.display_name_th} ${a.email} ${a.team}`.toLowerCase().includes(search.toLowerCase())) && <p>ไม่มีบัญชีในรายการนี้</p>}
  </section>;
}
function AccountDecision({ account: a, agencies, onSaved }: { account: Account; agencies: { code: string; label_th: string }[]; onSaved: () => void }) {
  const [role, setRole] = useState(a.hub_role || suggestedRole(a.requested_tasks)); const [agency, setAgency] = useState(a.agency_code || ""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function decide(action: string) {
    if (busy) return;
    if (action === "reject" && !note.trim()) { setError("กรุณาระบุเหตุผลที่ปฏิเสธ"); return; }
    if ((action === "approve" || action === "role") && role === "admin" && !window.confirm(`ยืนยันให้ ${a.display_name_th} เป็นผู้ดูแลระบบ ซึ่งอนุมัติบัญชีและเปลี่ยนสิทธิ์ผู้อื่นได้?`)) return;
    if (action === "suspend" && !window.confirm(`ยืนยันระงับบัญชี ${a.display_name_th}? สิทธิ์จะถูกปิดในการเรียกใช้งานครั้งถัดไป`)) return;
    setBusy(true); setError("");
    try { await accountApi(`v1/admin/accounts/${a.id}/decision`, { action, hub_role: role, agency_code: role === "agency" ? agency || null : null, note, updated_at: a.updated_at }); onSaved(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (a.status === "REJECTED") return <p>เหตุผลที่ปฏิเสธ: {a.decision_note}</p>;
  return <div><label className="form-field">บทบาท<select value={role} onChange={e => setRole(e.target.value)}>{["viewer", "editor", "publisher", "online_staff", "agency", "admin"].map(r => <option value={r} key={r}>{label(r)}</option>)}</select></label>{role === "agency" && <label className="form-field">รหัสเอเจนซี<select value={agency} onChange={e => setAgency(e.target.value)}><option value="">เลือกรหัสเอเจนซี</option>{agencies.map(r => <option key={r.code} value={r.code}>{r.code} · {r.label_th}</option>)}</select></label>}<label className="form-field">เหตุผลการตัดสินใจ<textarea value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="content-actions">{(a.status === "PENDING" ? [["approve", "อนุมัติ"], ["reject", "ปฏิเสธ"]] : a.status === "ACTIVE" ? [["role", "เปลี่ยนบทบาท"], ["suspend", "ระงับ"]] : [["reactivate", "เปิดใช้งานอีกครั้ง"]]).map(([action, text]) => <button className="button secondary" disabled={busy || action === "approve" && !a.privacy_acknowledged_at} key={action} onClick={() => void decide(action)}>{text}</button>)}</div></div>;
}
