"use client";
import { useEffect, useId, useRef, useState, type ReactNode, type FormEvent } from "react";
import type { AccountAccess, TemplateRef } from "@/lib/hub-permissions";
import { PermissionGrid, PermissionDiff, PermissionChips, TemplateSelect, accessChanged, copyTabs, emptyAccess, latestTemplates, normalTabs, templateKey, templateLabel, templateRef, type Catalog, type Tabs } from "./account-permissions";
import { accountApi, ActorName, companyLabel, companyLabels, label, methodLabel, RequestSummary, statuses, submittedPending, suggestedRole, type Account, type AccountApiError, type AccountEvent, type Invite } from "./accounts";

type Agency = {code:string;label_th:string};
type HistoricalAccess = Partial<Omit<AccountAccess,"template">> & {template?:TemplateRef|string|null;version?:number;note?:string;agency_code?:string|null};
type PermissionEvent = {id:string;account_id:string;actor_id:string;action:string;created_at:string;before_value:HistoricalAccess;after_value:HistoricalAccess};
type Directory = {items:Account[];events:AccountEvent[];permission_events?:PermissionEvent[];agencies:Agency[];actor_id:string};
const accessOf=(a:Account):AccountAccess=>a.access||emptyAccess();
const manages=(a:Account)=>a.access?.can_manage_users===true||a.can_manage_users===true;
function historyAccess(value:HistoricalAccess):AccountAccess {return {...emptyAccess(),...value,template:typeof value.template==="string"?{code:value.template,version:value.version||1}:value.template||null};}
const actions: Record<string,string> = {approve:"อนุมัติ",role:"เปลี่ยนบทบาท",suspend:"ระงับบัญชี",reactivate:"เปิดใช้งานอีกครั้ง",reject:"ปฏิเสธ",reopen:"เปิดรับคำขออีกครั้ง",REQUEST:"ส่ง / แก้ไขคำขอ",BOOTSTRAP:"ตั้งผู้ดูแลคนแรก",INVITE_ACCEPT:"ตอบรับคำเชิญ"};
const day = (date:string) => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok"}).format(new Date(date));
const dateLabel = (date:string) => new Date(date).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",dateStyle:"medium",timeStyle:"short"});
const display = (a:Account) => a.display_name_th || a.email || "บัญชีที่ลบข้อมูลส่วนบุคคลแล้ว";
function Status({status}:{status:string}) { return <span className={`account-pill account-pill-${status.toLowerCase()}`}>{statuses[status] || ({INVITED:"รอตอบรับ",EXPIRED:"หมดอายุ",ACCEPTED:"ตอบรับแล้ว",CANCELLED:"ยกเลิกแล้ว"} as Record<string,string>)[status] || status}</span>; }

export function AdminAccounts() {
  const [data,setData] = useState<Directory | null>(null);
  const [catalog,setCatalog]=useState<Catalog|null>(null),[editFilter,setEditFilter]=useState("");
  const [batch,setBatch]=useState<string|null>(null),[approvalTemplate,setApprovalTemplate]=useState<TemplateRef|null>(null);
  const [invitations,setInvitations] = useState<{items:Invite[];login_url:string}>({items:[],login_url:""});
  const [tab,setTab] = useState("queue"), [search,setSearch] = useState(""), [status,setStatus] = useState(""), [role,setRole] = useState("");
  const [error,setError] = useState(""), [message,setMessage] = useState("");
  const [retained,setRetained] = useState<string[]>([]);
  const [selected,setSelected] = useState<string | null>(null), [inviting,setInviting] = useState(false);
  async function refresh() {
    const [accounts,invites,permissions] = await Promise.all([accountApi("v1/admin/accounts"),accountApi("v1/admin/account-invites"),accountApi("v1/admin/permissions/catalog")]);
    setData(accounts); setInvitations(invites); setCatalog(permissions); setError("");
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  function saved(a:Account,action:string) {
    setRetained(ids => ids.filter(id => id !== a.id));
    setMessage(`${action==="permissions"?"ปรับสิทธิ์":actions[action]} ${display(a)}${action==="approve" ? ` เป็น ${a.access&&catalog?templateLabel(a.access,catalog):label(a.hub_role)}` : ""} แล้ว`);
    void refresh().catch(e => setError(`บันทึกแล้ว แต่โหลดรายการไม่สำเร็จ: ${e.message}`));
    window.dispatchEvent(new Event("hub-accounts-changed"));
  }
  const matches = (a:Account) => `${a.display_name_th} ${a.email} ${companyLabel(a)} ${a.team}`.toLowerCase().includes(search.trim().toLowerCase());
  const queue = data?.items.filter(a => (submittedPending(a) || retained.includes(a.id)) && matches(a)) || [];
  const unsubmitted = data?.items.filter(a => a.status === "PENDING" && !(submittedPending(a) || retained.includes(a.id)) && matches(a)) || [];
  const today = data?.events.filter(e => ["approve","role","suspend","reactivate","reject","reopen","INVITE_ACCEPT"].includes(e.action) && day(e.created_at) === day(new Date().toISOString())) || [];
  const account = data?.items.find(a => a.id === selected);
  return <section className="accounts-admin">
    <header className="accounts-heading"><div><p className="eyebrow">จัดการการเข้าถึง</p><h1>ผู้ใช้และสิทธิ์</h1><p>พิจารณาคำขอ กำหนดสิทธิ์รายแท็บ และเชิญผู้ร่วมงานด้วยอีเมล</p></div><div className="content-actions"><button className="button secondary" disabled={!catalog} onClick={()=>setBatch("")}>ปรับสิทธิ์หลายบัญชี</button><button className="button primary" disabled={!catalog} onClick={() => setInviting(true)}>+ เพิ่มผู้ใช้</button></div></header>
    <div role="status" className={message ? "accounts-feedback" : ""}>{message}</div>
    {error && <div role="alert">{error} <button className="button secondary" onClick={() => void refresh().catch(e => setError(e.message))}>โหลดอีกครั้ง</button></div>}
    <div className="account-tabs" role="tablist" aria-label="รายการบัญชี">{[["queue",`คำขอรออนุมัติ (${data?.items.filter(submittedPending).length ?? "…"})`],["users","ผู้ใช้ทั้งหมด"],["invites",`คำเชิญ (${invitations.items.filter(i => i.status === "INVITED").length})`]].map(([key,text]) => <button key={key} id={`tab-${key}`} role="tab" aria-selected={tab===key} aria-controls="accounts-tab-panel" className={`button ${tab===key ? "primary" : "secondary"}`} onClick={() => setTab(key)}>{text}</button>)}</div>
    {catalog?.tabs.filter(t=>t.new_for_actor).map(t=><NewTabNotice key={t.tab} tab={t.tab} title={t.label_th} catalog={catalog} reload={refresh} assign={()=>setBatch(t.tab)}/>)}
    {(!data||!catalog) && !error && <p role="status">กำลังโหลดบัญชี…</p>}
    {data && catalog && <div role="tabpanel" id="accounts-tab-panel" aria-labelledby={`tab-${tab}`}>
      {tab !== "invites" && <div className="account-filters"><label className="form-field">ค้นหาชื่อ อีเมล บริษัท หรือทีม<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>{tab === "users" && <><label className="form-field">สถานะ<select value={status} onChange={e => setStatus(e.target.value)}><option value="">ทุกสถานะ</option>{Object.entries(statuses).map(([key,text]) => <option key={key} value={key}>{text}</option>)}</select></label><label className="form-field">กรองแม่แบบ<select value={role} onChange={e => setRole(e.target.value)}><option value="">ทุกแม่แบบ</option>{latestTemplates(catalog).map(t => <option key={t.code} value={t.code}>{t.label_th}</option>)}</select></label><label className="form-field">แก้ไขแท็บได้<select value={editFilter} onChange={e=>setEditFilter(e.target.value)}><option value="">ทุกแท็บ</option>{catalog.tabs.filter(t=>t.levels.includes("edit")).map(t=><option key={t.tab} value={t.tab}>แก้ไข {t.label_th} ได้</option>)}</select></label></>}</div>}
      {tab === "queue" && <>
        <div className="account-queue">{queue.map(a => <QueueCard key={a.id} account={a} catalog={catalog} agencies={data.agencies} self={a.id===data.actor_id} onSaved={saved} onAdjust={template=>{setApprovalTemplate(template);setSelected(a.id);}} reload={async () => {setRetained(ids => ids.includes(a.id) ? ids : [...ids,a.id]);await refresh();}} />)}</div>
        {!queue.length && <p className="registry-panel">ไม่มีคำขอรออนุมัติในรายการนี้</p>}
        {!!unsubmitted.length && <section className="account-unsubmitted" aria-label="ยังไม่ส่งคำขอ"><h2>ยังไม่ส่งคำขอ ({unsubmitted.length})</h2><p>บัญชีเหล่านี้เข้าสู่ระบบแล้ว แต่ยังไม่มีคำขอให้พิจารณา</p>{unsubmitted.map(a => <div className="account-recent" key={a.id}><span>{display(a)} · {a.email} · {methodLabel(a.sign_in_method)}</span><button className="button secondary" onClick={() => setSelected(a.id)}>เปิดบัญชี</button></div>)}</section>}
        <section className="registry-panel account-today" aria-label="ตัดสินใจแล้ววันนี้"><h2>ตัดสินใจแล้ววันนี้</h2><p>รวมการตัดสินใจของผู้ดูแลทุกคน · เวลาไทย</p>{!today.length && <p>ยังไม่มีการตัดสินใจวันนี้</p>}{today.map(e => { const a=data.items.find(a => a.id===e.account_id); return a && <div className="account-recent" key={e.id}><div><strong>{display(a)}</strong><p>{actions[e.action]} · {label(e.new_role)} · <ActorName id={e.actor_id} /> · {dateLabel(e.created_at)}</p></div><button className="button secondary" onClick={() => setSelected(a.id)}>เปิดบัญชี</button></div>; })}</section>
      </>}
      {tab === "users" && <div className="account-table-scroll" tabIndex={0} role="region" aria-label="ตารางผู้ใช้"><table className="account-table"><thead><tr><th>ผู้ใช้</th><th>บริษัท · ตำแหน่ง · ทีม</th><th>แม่แบบและสิทธิ์</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th>จัดการ</th></tr></thead><tbody>{data.items.filter(a => matches(a) && (!status || a.status===status) && (!role || a.access?.template?.code===role) && (!editFilter||a.status==="ACTIVE"&&a.access?.tabs[editFilter]?.includes("edit"))).map(a => <tr key={a.id}><td><strong>{display(a)}</strong> {a.id===data.actor_id && <span className="account-pill">คุณ</span>} {today.some(e => e.account_id===a.id) && <span className="account-pill">ใหม่</span>}<small>{a.email}</small></td><td>{companyLabel(a)}<small>{a.position || "ยังไม่ระบุ"} · {a.team || "ยังไม่ระบุ"}</small></td><td>{templateLabel(accessOf(a),catalog)}<small>{a.agency_code}</small><PermissionChips access={accessOf(a)} catalog={catalog}/></td><td><Status status={a.status} /></td><td>{dateLabel(a.updated_at)}</td><td><button className="button secondary" onClick={() => setSelected(a.id)}>จัดการ</button></td></tr>)}</tbody></table></div>}
      {tab === "invites" && <section aria-label="คำเชิญ"><p>คำเชิญมีอายุ 14 วัน ไม่มีการส่งอีเมลจาก Hub</p><p>สิทธิ์ผูกกับอีเมล ไม่ได้ผูกกับลิงก์</p>{!invitations.items.length && <p className="registry-panel">ยังไม่มีคำเชิญ</p>}{invitations.items.map(i => <InviteRow key={i.id} invite={i} loginUrl={invitations.login_url} reload={refresh} onMessage={setMessage} />)}</section>}
    </div>}
    {account && data && catalog && <ManagePanel key={account.id} account={account} data={data} catalog={catalog} approvalTemplate={approvalTemplate} onClose={() => {setSelected(null);setApprovalTemplate(null);}} onSaved={saved} reload={refresh} />}
    {inviting && data && catalog && <InviteForm catalog={catalog} agencies={data.agencies} loginUrl={invitations.login_url} onClose={() => setInviting(false)} onExists={id => {setInviting(false);setSelected(id);}} onSaved={() => {setInviting(false);setTab("invites");setMessage("สร้างคำเชิญแล้ว คัดลอกลิงก์เข้าสู่ระบบเพื่อส่งให้ผู้รับได้");void refresh().catch(e => setError(e.message));}} />}
    {batch!==null&&data&&catalog&&<BatchPanel data={data} catalog={catalog} initialTab={batch} onClose={()=>setBatch(null)} onSaved={count=>{setBatch(null);setMessage(`ปรับสิทธิ์ ${count} คนแล้ว`);void refresh().catch(e=>setError(e.message));window.dispatchEvent(new Event("hub-accounts-changed"));}}/>}
  </section>;
}

function AgencySelect({value,onChange,agencies,disabled=false}:{value:string;onChange:(v:string)=>void;agencies:Agency[];disabled?:boolean}) { return <label className="form-field">รหัสเอเจนซี<select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}><option value="">เลือกรหัสเอเจนซี</option>{agencies.map(a => <option key={a.code} value={a.code}>{a.code} · {a.label_th}</option>)}</select></label>; }
function ActionError({error,reload}:{error:AccountApiError | null;reload:()=>Promise<void>}) {
  const [retryError,setRetryError] = useState("");
  return error && <div role="alert" className="account-action-error">{error.status===409 && ["conflict","permission_preview_stale","template_version_stale"].includes(error.code||"") ? <><strong>ข้อมูลเปลี่ยนแล้ว</strong><p>{error.message} ข้อความที่กรอกยังอยู่</p><button type="button" className="button secondary" onClick={() => void reload().catch(e => setRetryError(e.message))}>โหลดข้อมูลล่าสุด</button>{retryError}</> : error.message}</div>;
}
function useDecision(a:Account,onSaved:(a:Account,action:string)=>void) {
  const [busy,setBusy]=useState(false), [error,setError]=useState<AccountApiError | null>(null), [failedAction,setFailedAction]=useState("");
  const [message,setMessage]=useState("");
  async function decide(action:string,role:string,agency:string,note:string,options:Record<string,unknown>={}) {
    if (busy) return false; setBusy(true);setError(null);setFailedAction(action);
    try { const result=await accountApi(`v1/admin/accounts/${a.id}/decision`,{action,...(options.template?{}:{hub_role:role||null}),agency_code:role==="agency" ? agency||null : null,note,updated_at:a.updated_at,...options});setMessage(`${actions[action]} ${display(result)}${action==="role" ? ` เป็น ${label(result.hub_role)}` : ""} แล้ว`);onSaved(result,action);return true; }
    catch(e) {setError(e as AccountApiError);return false;} finally {setBusy(false);}
  }
  return {busy,error,failedAction,decide,message};
}
function QueueCard({account:a,catalog,agencies,self,onSaved,onAdjust,reload}:{account:Account;catalog:Catalog;agencies:Agency[];self:boolean;onSaved:(a:Account,action:string)=>void;onAdjust:(template:TemplateRef)=>void;reload:()=>Promise<void>}) {
  const [role,setRole]=useState(suggestedRole(a.requested_tasks)),[agency,setAgency]=useState(a.agency_code||""),[rejecting,setRejecting]=useState(false),[reason,setReason]=useState("");
  const {busy,error,failedAction,decide}=useDecision(a,onSaved);
  const changedStatus=!submittedPending(a);
  const template=latestTemplates(catalog).find(t=>t.code===role);
  return <article className="registry-panel account-request-card" aria-label={`คำขอ ${a.email}`}><header><h2>{display(a)}</h2><p>{a.email} · {methodLabel(a.sign_in_method)}</p><Status status={a.status} /></header><RequestSummary account={a} />
    {changedStatus && <p role="status">สถานะเปลี่ยนแล้ว ข้อความที่กรอกยังอยู่ในบัตรนี้ ตรวจบัญชีล่าสุดได้ในผู้ใช้ทั้งหมด</p>}{self ? <p>นี่คือบัญชีของคุณ</p> : <><TemplateSelect catalog={catalog} value={templateKey(template||null)} onChange={key=>setRole(key.split(":")[0])} agency admin={false} disabled={busy||changedStatus}/>{role==="agency" && <AgencySelect value={agency} onChange={setAgency} agencies={agencies} />}
      <div className="content-actions"><button className="button primary" disabled={busy || changedStatus || !template || role==="agency"&&!agency} onClick={()=>template&&void decide("approve",role,agency,"",{template:templateRef(template)})}>อนุมัติเป็น {template?.label_th||"แม่แบบที่เลือก"}</button><button className="button secondary" disabled={busy||changedStatus||!template} onClick={()=>template&&onAdjust(templateRef(template))}>อนุมัติและปรับสิทธิ์</button><button className="button danger" disabled={busy||changedStatus} onClick={()=>setRejecting(true)}>ปฏิเสธ</button></div>
      {failedAction==="approve" && <ActionError error={error} reload={reload} />}
      {rejecting && <form className="account-danger-zone" onSubmit={e=>{e.preventDefault();void decide("reject",role,agency,reason);}}><label className="form-field">เหตุผลที่ปฏิเสธ<textarea id={`account-reject-${a.id}`} data-permission-recovery required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} /></label><p>ผู้ขอจะเห็นข้อความนี้</p><button className="button danger" disabled={busy || changedStatus || !reason.trim()}>ยืนยันปฏิเสธ</button>{failedAction==="reject" && <ActionError error={error} reload={reload} />}</form>}
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
function ManagePanel({account:a,data,catalog,approvalTemplate,onClose,onSaved,reload}:{account:Account;data:Directory;catalog:Catalog;approvalTemplate:TemplateRef|null;onClose:()=>void;onSaved:(a:Account,action:string)=>void;reload:()=>Promise<void>}) {
  const pending=submittedPending(a);
  const initialTemplate=catalog.templates.find(t=>templateKey(t)===templateKey(approvalTemplate))||latestTemplates(catalog).find(t=>t.code===(a.access?.template?.code||suggestedRole(a.requested_tasks)));
  const initialAccess=pending&&initialTemplate?{tabs:copyTabs(initialTemplate.tabs),template:templateRef(initialTemplate),can_manage_users:false,customised:false}:accessOf(a);
  const [draft,setDraft]=useState<AccountAccess>(initialAccess),[chosen,setChosen]=useState(templateKey(initialTemplate||null)),[agency,setAgency]=useState(a.agency_code||""),[note,setNote]=useState(""),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState<AccountApiError|null>(null),[savedMessage,setSavedMessage]=useState("");
  const decision=useDecision(a,onSaved),busy=saving||decision.busy,message=savedMessage||decision.message;
  const feedback=useRef<HTMLParagraphElement>(null);useEffect(()=>{if(message)feedback.current?.focus();},[message]);
  const self=a.id===data.actor_id,last=a.status==="ACTIVE"&&manages(a)&&data.items.filter(a=>a.status==="ACTIVE"&&manages(a)).length===1;
  const external=a.hub_role==="agency"||pending&&draft.template?.code==="agency",editable=pending||a.status==="ACTIVE";
  const changed=external?agency!==a.agency_code:accessChanged(accessOf(a),draft),needsConfirmation=draft.can_manage_users&&!manages(a);
  function setTabs(tabs:Tabs){const template=catalog.templates.find(t=>templateKey(t)===templateKey(draft.template));setDraft({...draft,tabs,customised:!template||normalTabs(tabs)!==normalTabs(template.tabs)});}
  function applyTemplate(){const template=catalog.templates.find(t=>templateKey(t)===chosen);if(template)setDraft({...draft,tabs:copyTabs(template.tabs),template:templateRef(template),customised:false});}
  async function save(){
    if(busy)return;setSaving(true);setSaveError(null);setSavedMessage("");
    const body=external?{agency_code:agency,note,updated_at:a.updated_at}:{tabs:draft.tabs,template:draft.template||undefined,can_manage_users:draft.can_manage_users,confirm_manage_users:confirmed,note,updated_at:a.updated_at};
    try {if(pending){const result=await accountApi(`v1/admin/accounts/${a.id}/decision`,{...body,action:"approve",...(external?{template:draft.template}:{})});setDraft(result.access);setSavedMessage(`อนุมัติ ${display(result)} แล้ว`);onSaved(result,"approve");}
      else {const result=await accountApi(`v1/admin/accounts/${a.id}/permissions`,body);const fresh={...a,updated_at:result.updated_at,access:result.access,can_manage_users:result.access.can_manage_users,agency_code:result.agency_code===undefined?a.agency_code:result.agency_code};setDraft(result.access);setSavedMessage(`ปรับสิทธิ์ ${display(a)} แล้ว`);onSaved(fresh,"permissions");}
      setNote("");setConfirmed(false);
    }catch(e){setSaveError(e as AccountApiError);}finally{setSaving(false);}
  }
  return <Panel title={`${pending?"อนุมัติและปรับสิทธิ์":"จัดการ"} · ${display(a)}`} onClose={onClose}><p role="status" ref={feedback} tabIndex={-1} className={message?"accounts-feedback":""}>{message}</p><p>{a.email} · {methodLabel(a.sign_in_method)}</p><Status status={a.status}/>{self&&<p className="accounts-feedback">นี่คือบัญชีของคุณ</p>}{last&&<p>ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน</p>}<RequestSummary account={a}/>
    {editable&&<><fieldset disabled={self||busy}><legend>สิทธิ์ของบัญชี</legend>{(!external||pending)&&<div className="permission-template-actions"><TemplateSelect catalog={catalog} value={chosen} onChange={setChosen} agency={pending} admin={!pending}/><button type="button" className="button secondary" onClick={applyTemplate} disabled={!chosen}>ใช้แม่แบบนี้</button></div>}<p>ใช้แม่แบบจะคัดลอกสิทธิ์ลงตาราง ยังไม่บันทึกจนกดปุ่มบันทึก และไม่เปลี่ยนสิทธิ์จัดการผู้ใช้</p>
      {external?<><p className="accounts-feedback">บัญชีเอเจนซีใช้สิทธิ์คงที่ ดูทะเบียนและผูกตัวตนโฆษณาเฉพาะเอเจนซีของตน ไม่สามารถปรับตารางสิทธิ์ได้</p><AgencySelect value={agency} onChange={setAgency} agencies={data.agencies}/><PermissionGrid catalog={catalog} tabs={draft.tabs} onChange={()=>{}} disabled/></>:<><PermissionGrid catalog={catalog} tabs={draft.tabs} onChange={setTabs}/><label className="account-choice"><input type="checkbox" checked={draft.can_manage_users} disabled={last} onChange={e=>{setDraft({...draft,can_manage_users:e.target.checked});setConfirmed(false);}}/>จัดการผู้ใช้และสิทธิ์</label><p>สิทธิ์นี้ใช้อนุมัติบัญชีและปรับสิทธิ์ของผู้อื่น แยกจากสิทธิ์ข้อมูลในตาราง</p>{needsConfirmation&&<label className="account-choice"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>ยืนยันให้สิทธิ์ผู้ดูแลระบบ อนุมัติบัญชีและเปลี่ยนสิทธิ์ผู้อื่นได้</label>}</>}
    </fieldset>{!self&&<>{external?<p className="account-diff">รหัสเอเจนซี: {a.agency_code||"ยังไม่กำหนด"} → {agency||"ยังไม่กำหนด"}</p>:<PermissionDiff before={accessOf(a)} after={draft} catalog={catalog}/>}<label className="form-field">บันทึกสำหรับผู้ดูแล (ไม่บังคับ)<textarea id={`account-note-${a.id}`} data-permission-recovery maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label><p>เฉพาะผู้ดูแลเห็นข้อความนี้ในประวัติ</p><button className="button primary" disabled={busy||!pending&&!changed||external&&!agency||needsConfirmation&&!confirmed} onClick={()=>void save()}>{pending?"อนุมัติและบันทึกสิทธิ์":"บันทึก"}</button><ActionError error={saveError} reload={reload}/></>}</>}
    {!self&&a.status==="ACTIVE"&&<form className="account-danger-zone" onSubmit={e=>{e.preventDefault();void decision.decide("suspend",a.hub_role||"",a.agency_code||"",reason);}}><h3>ระงับบัญชี</h3><label className="form-field">เหตุผลที่ระงับบัญชี<textarea id={`account-suspend-${a.id}`} data-permission-recovery required maxLength={2000} value={reason} disabled={last} onChange={e=>setReason(e.target.value)}/></label><p>ผู้ขอจะเห็นข้อความนี้ สิทธิ์จะหยุดในการเรียกใช้งานครั้งถัดไป</p><button className="button danger" disabled={busy||last||!reason.trim()}>ระงับบัญชี</button>{decision.failedAction==="suspend"&&<ActionError error={decision.error} reload={reload}/>}</form>}
    {!self&&["SUSPENDED","REJECTED"].includes(a.status)&&<div className="account-danger-zone"><p>เหตุผลจากผู้ดูแล: {a.decision_note}</p>{a.anonymised_at?<p>ลบข้อมูลส่วนบุคคลแล้ว ไม่สามารถเปิดคำขออีกครั้ง</p>:<><label className="form-field">บันทึกสำหรับผู้ดูแล (ไม่บังคับ)<textarea id={`account-note-${a.id}`} data-permission-recovery maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label><p>เฉพาะผู้ดูแลเห็นข้อความนี้ในประวัติ</p><button className="button primary" disabled={busy} onClick={()=>void decision.decide(a.status==="SUSPENDED"?"reactivate":"reopen",a.hub_role||"",a.agency_code||"",note)}>{a.status==="SUSPENDED"?"เปิดใช้งานอีกครั้ง":"เปิดรับคำขออีกครั้ง"}</button><ActionError error={decision.error} reload={reload}/></>}</div>}
    <section className="account-history"><h3>ประวัติ</h3><ol>{data.events.filter(e=>e.account_id===a.id).map(e=><li key={e.id}><strong>{actions[e.action]||e.action}</strong> · {dateLabel(e.created_at)}<p><ActorName id={e.actor_id}/> · {label(e.new_role)}</p>{e.decision_note&&<p>บันทึก: {e.decision_note}</p>}{e.previous_decision_note&&<p>เหตุผลที่ปฏิเสธก่อนหน้า: {e.previous_decision_note}</p>}</li>)}</ol><h4>ประวัติการปรับสิทธิ์</h4><ol>{data.permission_events?.filter(e=>e.account_id===a.id).map(e=><li key={e.id}><strong>{({PERMISSIONS:"ปรับสิทธิ์",TEMPLATE_APPLY:"ใช้แม่แบบ",TEMPLATE_COPY:"คัดลอกแม่แบบ",BULK_TAB:"ปรับสิทธิ์แท็บ",CONVERT:"แปลงสิทธิ์เดิม",AGENCY_CODE:"เปลี่ยนรหัสเอเจนซี"} as Record<string,string>)[e.action]||e.action}</strong> · {dateLabel(e.created_at)} · <ActorName id={e.actor_id}/>{e.after_value.note&&<p className="permission-history-note">บันทึก: {e.after_value.note}</p>}{e.action==="AGENCY_CODE"?<p className="account-diff">รหัสเอเจนซี: {e.before_value.agency_code||"ยังไม่กำหนด"} → {e.after_value.agency_code||"ยังไม่กำหนด"}</p>:<PermissionDiff before={historyAccess(e.before_value)} after={historyAccess(e.after_value)} catalog={catalog}/>}</li>)}</ol></section>
  </Panel>;
}

function CopyLogin({url}:{url:string}) {
  const [message,setMessage]=useState("");
  return <div className="account-login-link"><label className="form-field">ลิงก์เข้าสู่ระบบ<input readOnly value={url} /></label><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(url);setMessage("คัดลอกลิงก์แล้ว");}catch{setMessage("คัดลอกอัตโนมัติไม่ได้ เลือกลิงก์ในช่องแล้วคัดลอกได้");}}}>คัดลอกลิงก์</button><span role="status">{message}</span></div>;
}
function InviteForm({catalog,agencies,loginUrl,onClose,onExists,onSaved}:{catalog:Catalog;agencies:Agency[];loginUrl:string;onClose:()=>void;onExists:(id:string)=>void;onSaved:()=>void}) {
  const [role,setRole]=useState("viewer"),[agency,setAgency]=useState(""),[company,setCompany]=useState("SENA"),[error,setError]=useState<AccountApiError|null>(null),[busy,setBusy]=useState(false);
  const template=latestTemplates(catalog).find(t=>t.code===role);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(busy||!template)return;setBusy(true);setError(null);const f=new FormData(e.currentTarget);
    try {await accountApi("v1/admin/account-invites",{email:f.get("email"),display_hint:f.get("display_hint"),company_type:role==="agency"?"AGENCY":company,company_name:role==="agency"?agency:f.get("company_name"),team:f.get("team"),template:templateRef(template),agency_code:role==="agency"?agency:null});onSaved();}
    catch(e){setError(e as AccountApiError);}finally{setBusy(false);}
  }
  return <Panel title="เพิ่มผู้ใช้ด้วยคำเชิญ" onClose={onClose}><p>กำหนดอีเมลและแม่แบบล่วงหน้า ผู้รับกรอกข้อมูลและยืนยันอีเมลก่อนเริ่มใช้งาน คำเชิญมีอายุ 14 วัน</p><form onSubmit={submit}><label className="form-field">อีเมล<input type="email" name="email" required maxLength={254} /></label><label className="form-field">ชื่อสำหรับอ้างอิง (ไม่บังคับ)<input name="display_hint" maxLength={200} /></label><TemplateSelect catalog={catalog} value={templateKey(template||null)} onChange={key=>setRole(key.split(":")[0])} agency admin={false}/><p>คำเชิญตรึงแม่แบบรุ่นที่เลือกไว้ และไม่ให้สิทธิ์จัดการผู้ใช้ เปลี่ยนสิทธิ์ได้หลังผู้รับเข้าสู่ระบบ</p>{role==="agency"?<AgencySelect value={agency} onChange={setAgency} agencies={agencies}/>:<><label className="form-field">บริษัท<select value={company} onChange={e=>setCompany(e.target.value)}>{Object.entries(companyLabels).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>{company!=="SENA"&&<label className="form-field">ชื่อบริษัท<input name="company_name" required maxLength={200}/></label>}</>}<label className="form-field">ทีม / ฝ่าย<input name="team" maxLength={200}/></label><button className="button primary" disabled={busy||!template||role==="agency"&&!agency}>{busy?"กำลังสร้างคำเชิญ…":"สร้างคำเชิญ"}</button>{error&&<div role="alert">{error.message}{error.account_id&&<button type="button" className="button secondary" onClick={()=>onExists(error.account_id!)}>เปิดบัญชีเดิม</button>}</div>}</form><p>ไม่มีการส่งอีเมลจาก Hub · สิทธิ์ผูกกับอีเมล ไม่ได้ผูกกับลิงก์</p><CopyLogin url={loginUrl}/></Panel>;
}
function InviteRow({invite:i,loginUrl,reload,onMessage}:{invite:Invite;loginUrl:string;reload:()=>Promise<void>;onMessage:(s:string)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<AccountApiError|null>(null);
  async function change(action:string){setBusy(true);setError(null);try{await accountApi(`v1/admin/account-invites/${i.id}/decision`,{action,expires_at:i.expires_at});onMessage(`${action==="extend"?"ต่ออายุ":"ยกเลิก"}คำเชิญ ${i.email} แล้ว`);await reload();}catch(e){setError(e as AccountApiError);}finally{setBusy(false);}}
  return <article className="registry-panel account-invite"><header><h2>{i.email}</h2><Status status={i.status}/></header><p>{i.display_hint||"ยังไม่ระบุชื่อ"} · {companyLabel(i)} · {i.team||"ยังไม่ระบุทีม"}</p><p>{i.template_label||label(i.permission_template||i.hub_role)} · รุ่น {i.permission_template_version||1} {i.agency_code} · หมดอายุ {dateLabel(i.expires_at)}</p><p>เชิญโดย {i.invited_by_name||"ผู้ดูแลระบบ"}</p>{["INVITED","EXPIRED"].includes(i.status)&&<><CopyLogin url={loginUrl}/><div className="content-actions"><button className="button secondary" disabled={busy} onClick={()=>void change("extend")}>ต่ออายุ 14 วัน</button><button className="button danger" disabled={busy} onClick={()=>void change("cancel")}>ยกเลิกคำเชิญ</button></div><ActionError error={error} reload={reload}/></>}</article>;
}

function NewTabNotice({tab,title,catalog,assign,reload}:{tab:string;title:string;catalog:Catalog;assign:()=>void;reload:()=>Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState<AccountApiError|null>(null);
  return <section className="permission-notice" aria-label={`แท็บใหม่ ${title}`}><p><strong>มี Tab ใหม่: {title}</strong></p><p>การเพิ่มแท็บไม่ให้สิทธิ์ใครโดยอัตโนมัติ ตรวจและกำหนดสิทธิ์ก่อนใช้งาน</p><div className="content-actions"><button className="button primary" onClick={assign}>กำหนดสิทธิ์แท็บนี้</button><button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);setError(null);try{await accountApi(`v1/admin/permissions/notices/${tab}/ack`,{catalog_digest:catalog.catalog_digest});await reload();}catch(e){setError(e as AccountApiError);}finally{setBusy(false);}}}>รับทราบโดยไม่ให้สิทธิ์</button></div><ActionError error={error} reload={reload}/></section>;
}
type Preview={digest:string;targets:{account_id:string;display_name_th:string;email:string;before:AccountAccess;after:AccountAccess;changed:boolean}[];excluded:{account_id:string;reason:string}[];change_count:number};
function BatchPanel({data,catalog,initialTab,onClose,onSaved}:{data:Directory;catalog:Catalog;initialTab:string;onClose:()=>void;onSaved:(count:number)=>void}) {
  const sourceTemplateId=useId();
  const [kind,setKind]=useState("accounts"),[ids,setIds]=useState<string[]>([]),[team,setTeam]=useState(""),[sourceTemplate,setSourceTemplate]=useState("editor");
  const [changeKind,setChangeKind]=useState(initialTab?"tab":"template"),[tab,setTab]=useState(initialTab||catalog.tabs[0]?.tab||""),[tabs,setTabs]=useState<Tabs>({}),[chosen,setChosen]=useState(templateKey(latestTemplates(catalog).find(t=>t.code==="viewer")||null));
  const [note,setNote]=useState(""),[preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<AccountApiError|null>(null);
  const template=catalog.templates.find(t=>templateKey(t)===chosen),teams=[...new Set(data.items.map(a=>a.team).filter(Boolean))].sort();
  const selection=kind==="accounts"?{kind,account_ids:ids}:kind==="team"?{kind,team}:{kind,code:sourceTemplate};
  const change=changeKind==="template"?{kind:"template",template:template&&templateRef(template)}:{kind:"tab",tab,levels:tabs[tab]||[]};
  const payload={selection,change,note},fingerprint=JSON.stringify(payload);
  useEffect(()=>{setPreview(null);setConfirmed(false);},[fingerprint]);
  const valid=(kind==="accounts"?ids.length>0&&ids.length<=100:kind==="team"?!!team:!!sourceTemplate)&&(changeKind==="template"?!!template:catalog.tabs.some(t=>t.tab===tab&&t.rollout_state==="MIGRATED"));
  async function review(){setBusy(true);setError(null);setConfirmed(false);try{setPreview(await accountApi("v1/admin/permissions/preview",payload));}catch(e){setPreview(null);setError(e as AccountApiError);}finally{setBusy(false);}}
  return <Panel title="ปรับสิทธิ์หลายบัญชี" onClose={onClose}><div className="permission-batch"><p>ตรวจความแตกต่างของทุกบัญชีก่อนยืนยัน สิทธิ์จัดการผู้ใช้ไม่เปลี่ยนจากการปรับแบบกลุ่ม</p><fieldset disabled={busy}><legend>เลือกผู้ใช้</legend><label className="form-field">เลือกกลุ่มด้วย<select value={kind} onChange={e=>setKind(e.target.value)}><option value="accounts">เลือกผู้ใช้รายคน</option><option value="template">แม่แบบเดิม</option><option value="team">ทีม / ฝ่าย</option></select></label>
    {kind==="accounts"?<div className="permission-batch-list">{data.items.map(a=><label key={a.id}><input type="checkbox" checked={ids.includes(a.id)} disabled={!ids.includes(a.id)&&ids.length>=100} onChange={e=>setIds(previous=>e.target.checked?[...previous,a.id]:previous.filter(id=>id!==a.id))}/>{display(a)} · {a.email}{a.id===data.actor_id&&" · บัญชีของคุณ (ไม่เปลี่ยน)"}</label>)}</div>:kind==="team"?<label className="form-field">ทีมที่ต้องการ<select value={team} onChange={e=>setTeam(e.target.value)}><option value="">เลือกทีม</option>{teams.map(t=><option key={t}>{t}</option>)}</select></label>:<div className="form-field"><label htmlFor={sourceTemplateId}>แม่แบบเดิม</label><select id={sourceTemplateId} value={sourceTemplate} onChange={e=>setSourceTemplate(e.target.value)}>{latestTemplates(catalog).map(t=><option key={t.code} value={t.code}>{t.label_th}</option>)}</select></div>}
    <label className="form-field">สิ่งที่ต้องการเปลี่ยน<select value={changeKind} onChange={e=>setChangeKind(e.target.value)}><option value="template">คัดลอกแม่แบบทั้งหมด</option><option value="tab">ปรับเฉพาะแท็บ</option></select></label>
    {changeKind==="template"?<TemplateSelect catalog={catalog} value={chosen} onChange={setChosen}/>:<><label className="form-field">แท็บที่ต้องการ<select value={tab} onChange={e=>setTab(e.target.value)}>{catalog.tabs.map(t=><option key={t.tab} value={t.tab}>{t.label_th}</option>)}</select></label><PermissionGrid catalog={{...catalog,tabs:catalog.tabs.filter(t=>t.tab===tab)}} tabs={tabs} onChange={setTabs}/><p>เปลี่ยนเฉพาะแท็บนี้ สิทธิ์แท็บอื่นและแม่แบบอ้างอิงยังอยู่</p></>}
    <label className="form-field">บันทึกสำหรับผู้ดูแล (ไม่บังคับ)<textarea id="account-batch-note" data-permission-recovery value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label></fieldset>
    <button className="button secondary" disabled={busy||!valid} onClick={()=>void review()}>ดูความแตกต่างก่อนยืนยัน</button><ActionError error={error} reload={review}/>
    {preview&&<section aria-label="ตัวอย่างการปรับสิทธิ์"><h3>ใช้กับ {preview.change_count} คน</h3>{preview.targets.map(target=><article className="permission-batch-target" key={target.account_id}><h4>{target.display_name_th||target.email}</h4><p>{target.email}</p><PermissionDiff before={target.before} after={target.after} catalog={catalog}/></article>)}{!!preview.excluded.length&&<><h4>บัญชีที่ไม่เปลี่ยน</h4><ul>{preview.excluded.map(item=><li key={item.account_id}>{data.items.find(a=>a.id===item.account_id)?.email||"บัญชีที่ไม่มีในรายการ"} · {({self:"บัญชีของคุณ",inactive:"บัญชีไม่ได้ใช้งานอยู่",external:"บัญชีภายนอกใช้สิทธิ์คงที่"} as Record<string,string>)[item.reason]||"ไม่เข้าเงื่อนไข"}</li>)}</ul></>}<label className="account-choice"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy||!preview.change_count}/>ยืนยันความแตกต่างของทุกบัญชีที่แสดง</label><button className="button primary" disabled={busy||!confirmed||!preview.change_count} onClick={async()=>{setBusy(true);setError(null);try{const result=await accountApi("v1/admin/permissions/apply",{...payload,digest:preview.digest,confirmed:true});onSaved(result.changed_count);}catch(e){setError(e as AccountApiError);setConfirmed(false);}finally{setBusy(false);}}}>ใช้กับ {preview.change_count} คน</button></section>}
    </div></Panel>;
}
