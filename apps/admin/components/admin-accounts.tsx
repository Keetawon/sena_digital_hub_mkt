"use client";
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { accountApi, ActorName, companyLabel, companyLabels, label, methodLabel, RequestSummary, statuses, submittedPending, suggestedRole, type Account, type AccountApiError, type AccountEvent, type Invite } from "./accounts";

type Agency = {code:string;label_th:string};
type Directory = {items:Account[];events:AccountEvent[];agencies:Agency[];actor_id:string};
const roles = ["viewer","editor","publisher","online_staff","agency","admin"];
const descriptions: Record<string,string> = {viewer:"อ่านข้อมูลโครงการและเนื้อหาภายใน",editor:"แก้ไขข้อมูลและตรวจเนื้อหาก่อนเผยแพร่",publisher:"อนุมัติและเผยแพร่ข้อมูล",online_staff:"ดูแลงานโฆษณาและงบของทีมออนไลน์",agency:"ทำงานเฉพาะข้อมูลของเอเจนซีที่กำหนด",admin:"อนุมัติบัญชี จัดการสิทธิ์ และดูแลระบบ"};
const actions: Record<string,string> = {approve:"อนุมัติ",role:"เปลี่ยนบทบาท",suspend:"ระงับบัญชี",reactivate:"เปิดใช้งานอีกครั้ง",reject:"ปฏิเสธ",reopen:"เปิดรับคำขออีกครั้ง",REQUEST:"ส่ง / แก้ไขคำขอ",BOOTSTRAP:"ตั้งผู้ดูแลคนแรก",INVITE_ACCEPT:"ตอบรับคำเชิญ"};
const day = (date:string) => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok"}).format(new Date(date));
const dateLabel = (date:string) => new Date(date).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"medium",timeStyle:"short"});
const display = (a:Account) => a.display_name_th || a.email || "บัญชีที่ลบข้อมูลส่วนบุคคลแล้ว";
function Status({status}:{status:string}) { return <span className={`account-pill account-pill-${status.toLowerCase()}`}>{statuses[status] || ({INVITED:"รอตอบรับ",EXPIRED:"หมดอายุ",ACCEPTED:"ตอบรับแล้ว",CANCELLED:"ยกเลิกแล้ว"} as Record<string,string>)[status] || status}</span>; }

export function AdminAccounts() {
  const [data,setData] = useState<Directory | null>(null);
  const [invitations,setInvitations] = useState<{items:Invite[];login_url:string}>({items:[],login_url:""});
  const [tab,setTab] = useState("queue"), [search,setSearch] = useState(""), [status,setStatus] = useState(""), [role,setRole] = useState("");
  const [error,setError] = useState(""), [message,setMessage] = useState("");
  const [retained,setRetained] = useState<string[]>([]);
  const [selected,setSelected] = useState<string | null>(null), [inviting,setInviting] = useState(false);
  async function refresh() {
    const [accounts,invites] = await Promise.all([accountApi("v1/admin/accounts"),accountApi("v1/admin/account-invites")]);
    setData(accounts); setInvitations(invites); setError("");
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  function saved(a:Account,action:string) {
    setRetained(ids => ids.filter(id => id !== a.id));
    setMessage(`${actions[action]} ${display(a)}${["approve","role"].includes(action) ? ` เป็น ${label(a.hub_role)}` : ""} แล้ว`);
    void refresh().catch(e => setError(`บันทึกแล้ว แต่โหลดรายการไม่สำเร็จ: ${e.message}`));
    window.dispatchEvent(new Event("hub-accounts-changed"));
  }
  const matches = (a:Account) => `${a.display_name_th} ${a.email} ${companyLabel(a)} ${a.team}`.toLowerCase().includes(search.trim().toLowerCase());
  const queue = data?.items.filter(a => (submittedPending(a) || retained.includes(a.id)) && matches(a)) || [];
  const unsubmitted = data?.items.filter(a => a.status === "PENDING" && !(submittedPending(a) || retained.includes(a.id)) && matches(a)) || [];
  const today = data?.events.filter(e => ["approve","role","suspend","reactivate","reject","reopen","INVITE_ACCEPT"].includes(e.action) && day(e.created_at) === day(new Date().toISOString())) || [];
  const account = data?.items.find(a => a.id === selected);
  return <section className="accounts-admin">
    <header className="accounts-heading"><div><p className="eyebrow">จัดการการเข้าถึง</p><h1>ผู้ใช้และสิทธิ์</h1><p>พิจารณาคำขอ ดูแลบัญชี และเชิญผู้ร่วมงานด้วยอีเมล</p></div><button className="button primary" onClick={() => setInviting(true)}>+ เพิ่มผู้ใช้</button></header>
    <div role="status" className={message ? "accounts-feedback" : ""}>{message}</div>
    {error && <div role="alert">{error} <button className="button secondary" onClick={() => void refresh().catch(e => setError(e.message))}>โหลดอีกครั้ง</button></div>}
    <div className="account-tabs" role="tablist" aria-label="รายการบัญชี">{[["queue",`คำขอรออนุมัติ (${data?.items.filter(submittedPending).length ?? "…"})`],["users","ผู้ใช้ทั้งหมด"],["invites",`คำเชิญ (${invitations.items.filter(i => i.status === "INVITED").length})`]].map(([key,text]) => <button key={key} id={`tab-${key}`} role="tab" aria-selected={tab===key} aria-controls="accounts-tab-panel" className={`button ${tab===key ? "primary" : "secondary"}`} onClick={() => setTab(key)}>{text}</button>)}</div>
    {!data && !error && <p role="status">กำลังโหลดบัญชี…</p>}
    {data && <div role="tabpanel" id="accounts-tab-panel" aria-labelledby={`tab-${tab}`}>
      {tab !== "invites" && <div className="account-filters"><label className="form-field">ค้นหาชื่อ อีเมล บริษัท หรือทีม<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>{tab === "users" && <><label className="form-field">สถานะ<select value={status} onChange={e => setStatus(e.target.value)}><option value="">ทุกสถานะ</option>{Object.entries(statuses).map(([key,text]) => <option key={key} value={key}>{text}</option>)}</select></label><label className="form-field">กรองบทบาท<select value={role} onChange={e => setRole(e.target.value)}><option value="">ทุกบทบาท</option>{roles.map(r => <option key={r} value={r}>{label(r)}</option>)}</select></label></>}</div>}
      {tab === "queue" && <>
        <div className="account-queue">{queue.map(a => <QueueCard key={a.id} account={a} agencies={data.agencies} self={a.id===data.actor_id} onSaved={saved} reload={async () => {setRetained(ids => ids.includes(a.id) ? ids : [...ids,a.id]);await refresh();}} />)}</div>
        {!queue.length && <p className="registry-panel">ไม่มีคำขอรออนุมัติในรายการนี้</p>}
        {!!unsubmitted.length && <section className="account-unsubmitted" aria-label="ยังไม่ส่งคำขอ"><h2>ยังไม่ส่งคำขอ ({unsubmitted.length})</h2><p>บัญชีเหล่านี้เข้าสู่ระบบแล้ว แต่ยังไม่มีคำขอให้พิจารณา</p>{unsubmitted.map(a => <div className="account-recent" key={a.id}><span>{display(a)} · {a.email} · {methodLabel(a.sign_in_method)}</span><button className="button secondary" onClick={() => setSelected(a.id)}>เปิดบัญชี</button></div>)}</section>}
        <section className="registry-panel account-today" aria-label="ตัดสินใจแล้ววันนี้"><h2>ตัดสินใจแล้ววันนี้</h2><p>รวมการตัดสินใจของผู้ดูแลทุกคน · เวลาไทย</p>{!today.length && <p>ยังไม่มีการตัดสินใจวันนี้</p>}{today.map(e => { const a=data.items.find(a => a.id===e.account_id); return a && <div className="account-recent" key={e.id}><div><strong>{display(a)}</strong><p>{actions[e.action]} · {label(e.new_role)} · <ActorName id={e.actor_id} /> · {dateLabel(e.created_at)}</p></div><button className="button secondary" onClick={() => setSelected(a.id)}>เปิดบัญชี</button></div>; })}</section>
      </>}
      {tab === "users" && <div className="account-table-scroll" tabIndex={0} role="region" aria-label="ตารางผู้ใช้"><table className="account-table"><thead><tr><th>ผู้ใช้</th><th>บริษัท · ตำแหน่ง · ทีม</th><th>บทบาท</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th>จัดการ</th></tr></thead><tbody>{data.items.filter(a => matches(a) && (!status || a.status===status) && (!role || a.hub_role===role)).map(a => <tr key={a.id}><td><strong>{display(a)}</strong> {a.id===data.actor_id && <span className="account-pill">คุณ</span>} {today.some(e => e.account_id===a.id) && <span className="account-pill">ใหม่</span>}<small>{a.email}</small></td><td>{companyLabel(a)}<small>{a.position || "ยังไม่ระบุ"} · {a.team || "ยังไม่ระบุ"}</small></td><td>{label(a.hub_role)}<small>{a.agency_code}</small></td><td><Status status={a.status} /></td><td>{dateLabel(a.updated_at)}</td><td><button className="button secondary" onClick={() => setSelected(a.id)}>จัดการ</button></td></tr>)}</tbody></table></div>}
      {tab === "invites" && <section aria-label="คำเชิญ"><p>คำเชิญมีอายุ 14 วัน ไม่มีการส่งอีเมลจาก Hub</p><p>สิทธิ์ผูกกับอีเมล ไม่ได้ผูกกับลิงก์</p>{!invitations.items.length && <p className="registry-panel">ยังไม่มีคำเชิญ</p>}{invitations.items.map(i => <InviteRow key={i.id} invite={i} loginUrl={invitations.login_url} reload={refresh} onMessage={setMessage} />)}</section>}
    </div>}
    {account && data && <ManagePanel key={account.id} account={account} data={data} onClose={() => setSelected(null)} onSaved={saved} reload={refresh} />}
    {inviting && data && <InviteForm agencies={data.agencies} loginUrl={invitations.login_url} onClose={() => setInviting(false)} onExists={id => {setInviting(false);setSelected(id);}} onSaved={() => {setInviting(false);setTab("invites");setMessage("สร้างคำเชิญแล้ว คัดลอกลิงก์เข้าสู่ระบบเพื่อส่งให้ผู้รับได้");void refresh().catch(e => setError(e.message));}} />}
  </section>;
}

function AgencySelect({value,onChange,agencies,disabled=false}:{value:string;onChange:(v:string)=>void;agencies:Agency[];disabled?:boolean}) { return <label className="form-field">รหัสเอเจนซี<select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}><option value="">เลือกรหัสเอเจนซี</option>{agencies.map(a => <option key={a.code} value={a.code}>{a.code} · {a.label_th}</option>)}</select></label>; }
function ActionError({error,reload}:{error:AccountApiError | null;reload:()=>Promise<void>}) {
  const [retryError,setRetryError] = useState("");
  return error && <div role="alert" className="account-action-error">{error.status===409 && error.code==="conflict" ? <><strong>ข้อมูลเปลี่ยนแล้ว</strong><p>{error.message} ข้อความที่กรอกยังอยู่</p><button className="button secondary" onClick={() => void reload().catch(e => setRetryError(e.message))}>โหลดข้อมูลล่าสุด</button>{retryError}</> : error.message}</div>;
}
function useDecision(a:Account,onSaved:(a:Account,action:string)=>void) {
  const [busy,setBusy]=useState(false), [error,setError]=useState<AccountApiError | null>(null), [failedAction,setFailedAction]=useState("");
  const [message,setMessage]=useState("");
  async function decide(action:string,role:string,agency:string,note:string) {
    if (busy) return false; setBusy(true);setError(null);setFailedAction(action);
    try { const result=await accountApi(`v1/admin/accounts/${a.id}/decision`,{action,hub_role:role||null,agency_code:role==="agency" ? agency||null : null,note,updated_at:a.updated_at});setMessage(`${actions[action]} ${display(result)}${action==="role" ? ` เป็น ${label(result.hub_role)}` : ""} แล้ว`);onSaved(result,action);return true; }
    catch(e) {setError(e as AccountApiError);return false;} finally {setBusy(false);}
  }
  return {busy,error,failedAction,decide,message};
}
function QueueCard({account:a,agencies,self,onSaved,reload}:{account:Account;agencies:Agency[];self:boolean;onSaved:(a:Account,action:string)=>void;reload:()=>Promise<void>}) {
  const [role,setRole]=useState(suggestedRole(a.requested_tasks)),[agency,setAgency]=useState(a.agency_code||""),[rejecting,setRejecting]=useState(false),[reason,setReason]=useState("");
  const {busy,error,failedAction,decide}=useDecision(a,onSaved);
  const changedStatus=!submittedPending(a);
  return <article className="registry-panel account-request-card" aria-label={`คำขอ ${a.email}`}><header><h2>{display(a)}</h2><p>{a.email} · {methodLabel(a.sign_in_method)}</p><Status status={a.status} /></header><RequestSummary account={a} />
    {changedStatus && <p role="status">สถานะเปลี่ยนแล้ว ข้อความที่กรอกยังอยู่ในบัตรนี้ ตรวจบัญชีล่าสุดได้ในผู้ใช้ทั้งหมด</p>}{self ? <p>นี่คือบัญชีของคุณ</p> : <><label className="form-field">บทบาท<select value={role} onChange={e=>setRole(e.target.value)}>{roles.filter(r=>r!=="admin").map(r=><option key={r} value={r}>{label(r)}</option>)}</select></label>{role==="agency" && <AgencySelect value={agency} onChange={setAgency} agencies={agencies} />}
      <div className="content-actions"><button className="button primary" disabled={busy || changedStatus || role==="agency"&&!agency} onClick={()=>void decide("approve",role,agency,"")}>อนุมัติเป็น {label(role)}</button><button className="button danger" disabled={busy||changedStatus} onClick={()=>setRejecting(true)}>ปฏิเสธ</button></div>
      {failedAction==="approve" && <ActionError error={error} reload={reload} />}
      {rejecting && <form className="account-danger-zone" onSubmit={e=>{e.preventDefault();void decide("reject",role,agency,reason);}}><label className="form-field">เหตุผลที่ปฏิเสธ<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} /></label><p>ผู้ขอจะเห็นข้อความนี้</p><button className="button danger" disabled={busy || changedStatus || !reason.trim()}>ยืนยันปฏิเสธ</button>{failedAction==="reject" && <ActionError error={error} reload={reload} />}</form>}
    </>}
  </article>;
}

function Panel({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const opener=document.activeElement as HTMLElement;const el=dialog.current!;el.showModal();return()=>{el.close();opener?.focus();};},[]);
  return <dialog ref={dialog} className="account-dialog" aria-modal="true" aria-labelledby="account-dialog-title" onCancel={e=>{e.preventDefault();onClose();}} onKeyDown={e=>{
    if(e.key!=="Tab")return;
    const controls=Array.from(dialog.current!.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }}><header className="accounts-heading"><h2 id="account-dialog-title">{title}</h2><button className="button secondary" autoFocus onClick={onClose}>ปิด</button></header>{children}</dialog>;
}
function ManagePanel({account:a,data,onClose,onSaved,reload}:{account:Account;data:Directory;onClose:()=>void;onSaved:(a:Account,action:string)=>void;reload:()=>Promise<void>}) {
  const [role,setRole]=useState(a.hub_role||suggestedRole(a.requested_tasks)),[agency,setAgency]=useState(a.agency_code||""),[note,setNote]=useState(""),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
  const {busy,error,failedAction,decide,message}=useDecision(a,onSaved);
  const feedback=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(message)feedback.current?.focus();},[message]);
  const self=a.id===data.actor_id, last=a.status==="ACTIVE"&&a.hub_role==="admin"&&data.items.filter(a=>a.status==="ACTIVE"&&a.hub_role==="admin").length===1;
  const changed=role!==a.hub_role || (role==="agency" ? agency : null)!==a.agency_code;
  const assigning=a.status==="ACTIVE";
  const errorFor=(action:string)=>failedAction===action && <ActionError error={error} reload={reload} />;
  return <Panel title={`จัดการ · ${display(a)}`} onClose={onClose}><p role="status" ref={feedback} tabIndex={-1} className={message ? "accounts-feedback" : ""}>{message}</p><p>{a.email} · {methodLabel(a.sign_in_method)}</p><Status status={a.status} />{self && <p className="accounts-feedback">นี่คือบัญชีของคุณ</p>}{last && <p>ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน</p>}<RequestSummary account={a} />
    <fieldset disabled={self || !assigning || busy}><legend>บทบาท</legend><div className="account-role-cards">{roles.map(r=><label className="account-role-card" key={r}><input type="radio" name="manage-role" value={r} checked={role===r} disabled={last&&r!=="admin"} onChange={()=>{setRole(r);setConfirmed(false);}} /><span><strong>{label(r)}</strong><small>{descriptions[r]}</small></span></label>)}</div>{role==="agency" && <AgencySelect value={agency} onChange={setAgency} agencies={data.agencies} />}</fieldset>
    {!self && assigning && <><p className="account-diff">{changed ? `${label(a.hub_role)} ${a.agency_code||""} → ${label(role)} ${role==="agency" ? agency : ""}` : "ยังไม่มีการเปลี่ยนแปลง"}</p>{role==="admin"&&a.hub_role!=="admin" && <label className="account-choice"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} />ยืนยันให้สิทธิ์ผู้ดูแลระบบ อนุมัติบัญชีและเปลี่ยนสิทธิ์ผู้อื่นได้</label>}
      <label className="form-field">บันทึกสำหรับผู้ดูแล (ไม่บังคับ)<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} /></label><p>เฉพาะผู้ดูแลเห็นข้อความนี้ในประวัติ</p><button className="button primary" disabled={busy||!changed||role==="agency"&&!agency||role==="admin"&&a.hub_role!=="admin"&&!confirmed||last&&role!=="admin"} onClick={async()=>{if(await decide("role",role,agency,note))setNote("");}}>บันทึก</button>{errorFor("role")}
      <form className="account-danger-zone" onSubmit={e=>{e.preventDefault();void decide("suspend",role,agency,reason);}}><h3>ระงับบัญชี</h3><label className="form-field">เหตุผลที่ระงับบัญชี<textarea required maxLength={2000} value={reason} disabled={last} onChange={e=>setReason(e.target.value)} /></label><p>ผู้ขอจะเห็นข้อความนี้ สิทธิ์จะหยุดในการเรียกใช้งานครั้งถัดไป</p><button className="button danger" disabled={busy||last||!reason.trim()}>ระงับบัญชี</button>{errorFor("suspend")}</form>
    </>}
    {!self && ["SUSPENDED","REJECTED"].includes(a.status) && <div className="account-danger-zone"><p>เหตุผลจากผู้ดูแล: {a.decision_note}</p>{a.anonymised_at ? <p>ลบข้อมูลส่วนบุคคลแล้ว ไม่สามารถเปิดคำขออีกครั้ง</p> : <><label className="form-field">บันทึกสำหรับผู้ดูแล (ไม่บังคับ)<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} /></label><p>เฉพาะผู้ดูแลเห็นข้อความนี้ในประวัติ</p><button className="button primary" disabled={busy} onClick={()=>void decide(a.status==="SUSPENDED" ? "reactivate" : "reopen",role,agency,note)}>{a.status==="SUSPENDED" ? "เปิดใช้งานอีกครั้ง" : "เปิดรับคำขออีกครั้ง"}</button>{errorFor(a.status==="SUSPENDED" ? "reactivate" : "reopen")}</>}</div>}
    <section className="account-history"><h3>ประวัติ</h3><ol>{data.events.filter(e=>e.account_id===a.id).map(e=><li key={e.id}><strong>{actions[e.action]||e.action}</strong> · {dateLabel(e.created_at)}<p><ActorName id={e.actor_id} /> · {label(e.new_role)}</p>{e.decision_note&&<p>บันทึก: {e.decision_note}</p>}{e.previous_decision_note&&<p>เหตุผลที่ปฏิเสธก่อนหน้า: {e.previous_decision_note}</p>}</li>)}</ol></section>
  </Panel>;
}

function CopyLogin({url}:{url:string}) {
  const [message,setMessage]=useState("");
  return <div className="account-login-link"><label className="form-field">ลิงก์เข้าสู่ระบบ<input readOnly value={url} /></label><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage("คัดลอกลิงก์แล้ว");}catch{setMessage("คัดลอกอัตโนมัติไม่ได้ เลือกลิงก์ในช่องแล้วคัดลอกได้");}}}>คัดลอกลิงก์</button><span role="status">{message}</span></div>;
}
function InviteForm({agencies,loginUrl,onClose,onExists,onSaved}:{agencies:Agency[];loginUrl:string;onClose:()=>void;onExists:(id:string)=>void;onSaved:()=>void}) {
  const [role,setRole]=useState("viewer"),[agency,setAgency]=useState(""),[company,setCompany]=useState("SENA"),[error,setError]=useState<AccountApiError|null>(null),[busy,setBusy]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy)return;setBusy(true);setError(null);const f=new FormData(e.currentTarget);
    try {await accountApi("v1/admin/account-invites",{email:f.get("email"),display_hint:f.get("display_hint"),company_type:role==="agency"?"AGENCY":company,company_name:role==="agency"?agency:f.get("company_name"),team:f.get("team"),hub_role:role,agency_code:role==="agency"?agency:null});onSaved();}
    catch(e){setError(e as AccountApiError);}finally{setBusy(false);}
  }
  return <Panel title="เพิ่มผู้ใช้ด้วยคำเชิญ" onClose={onClose}><p>กำหนดอีเมลและบทบาทล่วงหน้า ผู้รับกรอกข้อมูลและยืนยันอีเมลก่อนเริ่มใช้งาน คำเชิญมีอายุ 14 วัน</p><form onSubmit={submit}><label className="form-field">อีเมล<input type="email" name="email" required maxLength={254} /></label><label className="form-field">ชื่อสำหรับอ้างอิง (ไม่บังคับ)<input name="display_hint" maxLength={200} /></label><label className="form-field">บทบาท<select value={role} onChange={e=>setRole(e.target.value)}>{roles.filter(r=>r!=="admin").map(r=><option key={r} value={r}>{label(r)}</option>)}</select></label><p>คำเชิญให้สิทธิ์ผู้ดูแลระบบไม่ได้ เปลี่ยนบทบาทได้หลังผู้รับเข้าสู่ระบบ</p>{role==="agency"?<AgencySelect value={agency} onChange={setAgency} agencies={agencies}/>:<><label className="form-field">บริษัท<select value={company} onChange={e=>setCompany(e.target.value)}>{Object.entries(companyLabels).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>{company!=="SENA"&&<label className="form-field">ชื่อบริษัท<input name="company_name" required maxLength={200}/></label>}</>}<label className="form-field">ทีม / ฝ่าย<input name="team" maxLength={200}/></label><button className="button primary" disabled={busy||role==="agency"&&!agency}>{busy?"กำลังสร้างคำเชิญ…":"สร้างคำเชิญ"}</button>{error&&<div role="alert">{error.message}{error.account_id&&<button type="button" className="button secondary" onClick={()=>onExists(error.account_id!)}>เปิดบัญชีเดิม</button>}</div>}</form><p>ไม่มีการส่งอีเมลจาก Hub · สิทธิ์ผูกกับอีเมล ไม่ได้ผูกกับลิงก์</p><CopyLogin url={loginUrl}/></Panel>;
}
function InviteRow({invite:i,loginUrl,reload,onMessage}:{invite:Invite;loginUrl:string;reload:()=>Promise<void>;onMessage:(s:string)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<AccountApiError|null>(null);
  async function change(action:string){setBusy(true);setError(null);try{await accountApi(`v1/admin/account-invites/${i.id}/decision`,{action,expires_at:i.expires_at});onMessage(`${action==="extend"?"ต่ออายุ":"ยกเลิก"}คำเชิญ ${i.email} แล้ว`);await reload();}catch(e){setError(e as AccountApiError);}finally{setBusy(false);}}
  return <article className="registry-panel account-invite"><header><h2>{i.email}</h2><Status status={i.status}/></header><p>{i.display_hint||"ยังไม่ระบุชื่อ"} · {companyLabel(i)} · {i.team||"ยังไม่ระบุทีม"}</p><p>{label(i.hub_role)} {i.agency_code} · หมดอายุ {dateLabel(i.expires_at)}</p><p>เชิญโดย {i.invited_by_name||"ผู้ดูแลระบบ"}</p>{["INVITED","EXPIRED"].includes(i.status)&&<><CopyLogin url={loginUrl}/><div className="content-actions"><button className="button secondary" disabled={busy} onClick={()=>void change("extend")}>ต่ออายุ 14 วัน</button><button className="button danger" disabled={busy} onClick={()=>void change("cancel")}>ยกเลิกคำเชิญ</button></div><ActionError error={error} reload={reload}/></>}</article>;
}
