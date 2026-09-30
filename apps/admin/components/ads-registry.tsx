"use client";

import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { LocalRole } from "@/lib/local-session";
import { request } from "./hub-request";
import { HubShell } from "./hub-shell";
import { RegistrationMonthlyLines } from "./finance-actions";
import { DropdownPop, RegistryRowSummary, RowToCard } from "./registry-motion";
import "./ads-registry.css";

const api = "v1/admin/ads";
const roleLabels: Record<LocalRole, string> = { editor: "ผู้แก้ไขข้อมูล", publisher: "ผู้เผยแพร่", viewer: "ผู้อ่านข้อมูล", admin: "ผู้ดูแลระบบ", online_staff: "ทีมออนไลน์", agency_kin: "เอเจนซี KIN", agency_combay: "เอเจนซี COMBAY" };
type Settings = { sena_h_approved: boolean; can_issue: boolean; test_mode: boolean };
type Vocab = { vocab_type: string; code: string; label_th: string; status: string; can_use: boolean };
type Scope = { scope_id: string; scope_kind: string; kind: string; scope_code: string; label_en: string; label_th: string; status: string; can_use: boolean; member_ids: string[] };
type Member = { member_type: string; member_id: string; parent_group_id?: string };
type IssuedName = { name_id: string; variant: string | null; frozen_name: string; utm_campaign: string; utm_id_note: string; utm_google: string; launch_pack: string; issued_at: string };
type Binding = { name_id: string; platform: string; account_id: string; campaign_id: string };
type Detail = { registration: { code: string; objective: string; agency: string; label: string; status: string; created_at: string }; scope: Scope; members: Member[]; names: IssuedName[]; bindings: Binding[] };
type Selection = { scope_kind: string; scope_id: string | null; parent_group_id: string | null; member_ids: string[]; objective: string; agency: string; variant: string | null; content_label: string | null; content_label_approved: boolean };
type Preview = { preview_name: string; code_note: string; scope: Scope; members: Member[] };
const emptySelection: Selection = { scope_kind: "A", scope_id: null, parent_group_id: null, member_ids: [], objective: "", agency: "", variant: null, content_label: null, content_label_approved: false };
const scopeLabels: Record<string, string> = { A: "A · ทั้งกลุ่มโครงการ", B: "B · เฟสเดียว", C: "C · หลายเฟสในกลุ่มเดียวกัน", D: "D · หลายกลุ่มโครงการ", E: "E · แบรนด์", F: "F · องค์กรหรือหน่วยธุรกิจ" };
const tabs = [{ key: "details", label: "รายละเอียด" }, { key: "names", label: "ชื่อและลิงก์ติดตาม" }, { key: "bindings", label: "รหัสบนแพลตฟอร์ม" }];
function message(error: unknown) { return error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง"; }
function date(value?: string) { return value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "ยังไม่มีข้อมูล"; }
function canWrite(role: LocalRole | null) { return role === "online_staff" || role === "admin"; }
function canRead(role: LocalRole | null) { return canWrite(role) || role === "agency_kin" || role === "agency_combay"; }
function options(vocab: Vocab[], kind: string) { return vocab.filter(item => item.vocab_type === kind).map(item => ({ value: item.code, label: `${item.code} · ${item.label_th}${!item.can_use ? " (ยังไม่เปิดใช้)" : ""}`, disabled: !item.can_use })); }
function stateLabel(detail: Detail) { return detail.registration.status === "CANCELLED" ? "ยกเลิกแล้ว" : detail.bindings.length ? "ผูกรหัสแล้ว" : "รอรับรหัส"; }

export function AdsRegistry({ initialRole, localMode, screen }: { initialRole: LocalRole | null; localMode: boolean; screen: "list" | "new" | "inbox" }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [vocab, setVocab] = useState<Vocab[]>([]);
  const [error, setError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const load = useCallback(async () => {
    setError("");
    if (!localMode || !canRead(initialRole)) { setSettings(null); setVocab([]); setLoading(false); return; }
    setLoading(true);
    try { const [current, values] = await Promise.all([request<Settings>(`${api}/settings`), request<Vocab[]>(`${api}/vocab`)]); setSettings(current); setVocab(values); }
    catch (err) { setError(message(err)); }
    finally { setLoading(false); }
  }, [initialRole, localMode]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  async function changeRole(value: string) {
    if (dirty && !window.confirm("มีข้อมูลที่ยังไม่ได้บันทึก ต้องการเปลี่ยนบัญชีและละทิ้งข้อมูลหรือไม่")) return;
    setSwitching(true);
    try {
      const response = await fetch("/api/local-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: value }) });
      if (!response.ok) throw new Error("เปลี่ยนบัญชีทดสอบไม่สำเร็จ");
      setDirty(false); window.location.assign(screen === "new" ? "/ads/registry" : window.location.pathname);
    } catch (err) { setError(message(err)); setSwitching(false); }
  }
  return <HubShell section="registry" registry finance={canWrite(initialRole)} roleLabel={initialRole ? roleLabels[initialRole] : "ยังไม่ได้เลือกบัญชี"} toolbar={localMode && <div className="local-banner" role="note"><p className="local-note"><strong>พื้นที่ทดสอบในเครื่อง</strong></p><label className="role-picker">บัญชีทดสอบ<select aria-label="เลือกบัญชีทดสอบ" value={initialRole ?? ""} disabled={switching} onChange={event => void changeRole(event.target.value)}><option value="" disabled>เลือกบัญชี</option>{Object.entries(roleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>}>
    <nav className="registry-subnav" aria-label="เมนูทะเบียนแคมเปญ"><a href="/ads/registry" aria-current={screen === "list" ? "page" : undefined}>รายการชื่อแคมเปญ</a><a href="/ads/registry/inbox" aria-current={screen === "inbox" ? "page" : undefined}>ส่งคืนรหัสแคมเปญ</a>{canWrite(initialRole) && <a href="/ads/registry/new" aria-current={screen === "new" ? "page" : undefined}>ลงทะเบียนแคมเปญ</a>}</nav>
    <h1 id="registry-title" tabIndex={-1}>{screen === "new" ? "ลงทะเบียนแคมเปญ" : screen === "inbox" ? "ส่งคืนรหัสแคมเปญ" : "ทะเบียนแคมเปญ"}</h1>
    <p className="text-muted">{screen === "inbox" ? "ส่งรหัสบัญชีและแคมเปญจากแพลตฟอร์มให้ตรงกับชื่อที่ได้รับ" : "ชื่อกลางสำหรับเปิดแคมเปญและเชื่อมรหัสบนแพลตฟอร์ม"}</p>
    {!settings?.sena_h_approved && <aside className="registry-banner" aria-label="สถานะการอนุมัติรูปแบบชื่อ"><strong>รออนุมัติรูปแบบชื่อ</strong><p>{settings?.test_mode ? "ข้อมูลทดสอบ ห้ามใช้เปิดแคมเปญจริง" : "ยังไม่เปิดการออกชื่อสำหรับใช้งานจริง"}</p></aside>}
    {error && <div className="registry-error" role="alert">{error}<button className="registry-button ml-3" onClick={() => void load()}>ลองอีกครั้ง</button></div>}
    {!localMode ? <p>กรุณาตั้งค่าการเข้าสู่ระบบก่อนใช้งาน</p> : !initialRole || !canRead(initialRole) ? <section className="registry-panel" aria-labelledby="registry-access-title">
      <h2 id="registry-access-title">เลือกบัญชีสำหรับทะเบียนแคมเปญ</h2>
      <p className="mt-3">{initialRole ? `ขณะนี้ใช้บัญชี “${roleLabels[initialRole]}” สำหรับงานข้อมูลโครงการ ซึ่งไม่มีสิทธิ์เข้าทะเบียนแคมเปญ` : "กรุณาเลือกบัญชีทดสอบให้ตรงกับงานที่ต้องการ"}</p>
      <p className="text-muted mt-3">ทีมออนไลน์ลงทะเบียนและออกชื่อได้ ส่วนเอเจนซีอ่านเฉพาะชื่อของตนเองและส่งคืนรหัสแคมเปญ</p>
      <div className="flex flex-wrap gap-3 mt-5">{(["online_staff", "agency_kin", "agency_combay"] as const).map(role => <button key={role} type="button" className={`registry-button${role === "online_staff" ? " primary" : ""}`} disabled={switching} onClick={() => void changeRole(role)}>ใช้บัญชีทดสอบ{roleLabels[role]}</button>)}<a className="registry-button" href="/">กลับไปงานข้อมูลโครงการ</a></div>
    </section> : loading ? <p role="status">กำลังโหลดข้อมูล…</p> : settings && (screen === "new" ? canWrite(initialRole) ? <RegistrationWizard settings={settings} vocab={vocab} onDirty={setDirty} /> : <p role="alert">บัญชีนี้ส่งคืนรหัสและอ่านชื่อของตนเองได้เท่านั้น</p> : <RegistryList role={initialRole} settings={settings} vocab={vocab} inbox={screen === "inbox"} onDirty={setDirty} />)}
  </HubShell>;
}

function RegistryList({ role, settings, vocab, inbox, onDirty }: { role: LocalRole; settings: Settings; vocab: Vocab[]; inbox: boolean; onDirty: (dirty: boolean) => void }) {
  const [rows, setRows] = useState<Detail[]>([]);
  const [q, setQ] = useState("");
  const [agency, setAgency] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [morphCode, setMorphCode] = useState("");
  const [tab, setTab] = useState(inbox ? "bindings" : "details");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const restoringHistory = useRef(false);
  const internalOpen = useRef(false);
  const listRequest = useRef(0);
  const view = inbox ? "inbox" : "registry";
  const load = useCallback(async () => {
    const requestId = ++listRequest.current;
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ q, limit: "25", offset: String(offset) });
      if (agency) query.set("agency", agency);
      if (status) query.set("binding_status", status);
      const response = await fetch(`/api/hub/${api}/registrations?${query}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message || "โหลดรายการไม่สำเร็จ");
      if (requestId === listRequest.current) { setRows(json.data); setTotal(json.meta?.total ?? json.data.length); }
    } catch (err) { if (requestId === listRequest.current) setError(message(err)); }
    finally { if (requestId === listRequest.current) setLoading(false); }
  }, [q, agency, status, offset]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 200); return () => clearTimeout(timer); }, [load]);
  const readUrl = useCallback(() => { const params = new URLSearchParams(window.location.search); setSelected(params.get("registration") ?? ""); const current = params.get("tab"); setTab(tabs.some(item => item.key === current) ? current! : inbox ? "bindings" : "details"); }, [inbox]);
  useEffect(() => {
    readUrl();
    const popped = () => {
      if (restoringHistory.current) { restoringHistory.current = false; return; }
      if (dirtyRef.current && !window.confirm("มีรหัสที่ยังไม่ได้บันทึก ต้องการละทิ้งข้อมูลหรือไม่")) { restoringHistory.current = true; window.history.forward(); return; }
      dirtyRef.current = false; setDirty(false); onDirty(false); setMorphCode(""); readUrl();
    };
    window.addEventListener("popstate", popped);
    return () => window.removeEventListener("popstate", popped);
  }, [readUrl, onDirty]);
  useEffect(() => {
    setDetail(null); setDetailError("");
    if (!selected) return;
    let active = true;
    request<Detail>(`${api}/registrations/${encodeURIComponent(selected)}`).then(value => { if (active) setDetail(value); }).catch(() => { if (active) setDetailError("ไม่พบรายการที่มีสิทธิ์เข้าถึง"); });
    return () => { active = false; };
  }, [selected]);
  function open(code: string) {
    setMorphCode(code);
    const url = new URL(window.location.href); url.searchParams.set("registration", code); url.searchParams.set("tab", inbox ? "bindings" : "details");
    window.history.pushState({}, "", url); internalOpen.current = true; readUrl();
  }
  function close() {
    if (dirty && !window.confirm("มีรหัสที่ยังไม่ได้บันทึก ต้องการละทิ้งข้อมูลหรือไม่")) return;
    dirtyRef.current = false; setDirty(false); onDirty(false);
    if (internalOpen.current) { internalOpen.current = false; window.history.back(); }
    else { const url = new URL(window.location.href); url.searchParams.delete("registration"); url.searchParams.delete("tab"); window.history.replaceState({}, "", url); readUrl(); }
  }
  function selectTab(next: string) { if (dirty && next !== "bindings") return; const url = new URL(window.location.href); url.searchParams.set("tab", next); window.history.replaceState({}, "", url); setTab(next); }
  return <LayoutGroup id={view}>
    <div className="registry-panel"><div className="grid gap-4 md:grid-cols-3"><label>ค้นหารหัสหรือชื่อ<input className="registry-input" value={q} onChange={event => { setQ(event.target.value); setOffset(0); }} /></label>{canWrite(role) ? <DropdownPop label="เอเจนซี" value={agency} options={[{ value: "", label: "ทุกเอเจนซี" }, ...options(vocab, "AGENCY")]} onChange={value => { setAgency(value); setOffset(0); }} /> : <p className="self-center">{roleLabels[role]} · แสดงเฉพาะชื่อของคุณ</p>}<DropdownPop label="สถานะรหัส" value={status} options={[{ value: "", label: "ทุกสถานะ" }, { value: "pending", label: "รอรับรหัส" }, { value: "bound", label: "ผูกรหัสแล้ว" }]} onChange={value => { setStatus(value); setOffset(0); }} /></div></div>
    {error && <div role="alert" className="registry-error">{error}<button className="registry-button ml-3" onClick={() => void load()}>ลองอีกครั้ง</button></div>}
    <div className="registry-panel"><div className="flex flex-wrap items-center justify-between gap-3 mb-4"><h2>รายการลงทะเบียน</h2><p role="status">{loading ? "กำลังโหลดข้อมูล…" : `พบ ${total} รายการ`}</p></div>
      {!loading && !rows.length ? <p className="py-8 text-muted">{q || agency || status ? "ไม่พบรายการตามตัวกรอง" : "ยังไม่มีรายการลงทะเบียน"}</p> : <table className="registry-table"><thead><tr><th scope="col">รหัสและชื่อ</th><th scope="col">ขอบเขต</th><th scope="col">วัตถุประสงค์ / เอเจนซี</th><th scope="col">สถานะ</th></tr></thead><tbody>{rows.map(row => <tr key={row.registration.code} data-registration={row.registration.code}><td data-label=""><RegistryRowSummary id={`${view}-${row.registration.code}`}><button type="button" onClick={() => open(row.registration.code)} aria-label={`${inbox ? "กรอกรหัสสำหรับ" : "ดูรายละเอียด"} ${row.registration.code}`}>{row.registration.code}</button><p>{row.registration.label}</p></RegistryRowSummary></td><td data-label="ขอบเขต">{row.scope.scope_code}<p className="text-muted">{row.scope.label_th}</p></td><td data-label="วัตถุประสงค์ / เอเจนซี">{row.registration.objective}<p>{row.registration.agency}</p></td><td data-label="สถานะ">{stateLabel(row)}</td></tr>)}</tbody></table>}
      <div className="flex flex-wrap justify-end gap-3 mt-5"><button className="registry-button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - 25))}>หน้าก่อนหน้า</button><button className="registry-button" disabled={offset + 25 >= total || loading} onClick={() => setOffset(offset + 25)}>หน้าถัดไป</button></div>
    </div>
    <AnimatePresence>{selected && <RowToCard key={selected} layoutId={`${view}-${selected}`} morph={morphCode === selected} title={selected} onClose={close}>{detailError ? <p role="alert" className="registry-error">{detailError}</p> : detail ? <RegistrationDetail detail={detail} tab={tab} setTab={selectTab} role={role} vocab={vocab} settings={settings} dirty={dirty} onDirty={value => { dirtyRef.current = value; setDirty(value); onDirty(value); }} onUpdated={value => { setDetail(value); void load(); }} /> : <p role="status">กำลังโหลดข้อมูล…</p>}</RowToCard>}</AnimatePresence>
  </LayoutGroup>;
}

function RegistrationDetail({ detail, tab, setTab, role, vocab, settings, dirty, onDirty, onUpdated }: { detail: Detail; tab: string; setTab: (tab: string) => void; role: LocalRole; vocab: Vocab[]; settings: Settings; dirty: boolean; onDirty: (dirty: boolean) => void; onUpdated: (value: Detail) => void }) {
  const reduce = useReducedMotion();
  return <><p className="mt-3 text-muted">{detail.registration.label} · {stateLabel(detail)}</p><div className="registry-tabs" role="tablist" aria-label="รายละเอียดทะเบียน">{tabs.map((item, index) => <button key={item.key} id={`tab-${item.key}`} role="tab" aria-selected={tab === item.key} aria-controls={`panel-${item.key}`} disabled={dirty && item.key !== "bindings"} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)} onKeyDown={event => {
    if (dirty || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault();
    const next = tabs[event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3].key;
    setTab(next); document.getElementById(`tab-${next}`)?.focus();
  }}>{item.label}{tab === item.key && <motion.span className="registry-tab-indicator" layoutId="registry-tab" transition={{ duration: reduce ? 0 : .22 }} />}</button>)}</div>
    <motion.div layout={!reduce} id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === "details" ? <><dl className="registry-detail-list"><dt>ขอบเขต</dt><dd>{detail.scope.scope_code} · {detail.scope.label_th}</dd><dt>สมาชิกขอบเขต</dt><dd>{detail.members.map(member => member.member_id).join(", ") || "ยังไม่มีสมาชิก"}</dd><dt>วัตถุประสงค์</dt><dd>{detail.registration.objective}</dd><dt>เอเจนซี</dt><dd>{detail.registration.agency}</dd><dt>ออกชื่อเมื่อ</dt><dd>{date(detail.names[0]?.issued_at)} (เวลาประเทศไทย)</dd></dl><p className="mt-5 text-muted">การออกชื่อไม่ได้อนุมัติงบประมาณ ขอบเขตร่วมไม่ได้หมายถึงการแบ่งยอดตามสมาชิก</p>{canWrite(role) && <RegistrationMonthlyLines code={detail.registration.code} />}</> : tab === "names" ? <><LaunchPacks names={detail.names} />{canWrite(role) && <VariantForm detail={detail} vocab={vocab} settings={settings} onUpdated={onUpdated} />}</> : <BindingForm detail={detail} vocab={vocab} onDirty={onDirty} onUpdated={onUpdated} />}
    </motion.div>
  </>;
}

function LaunchPacks({ names }: { names: IssuedName[] }) {
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState("");
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("คัดลอกแล้ว"); setFailed(""); }
    catch { setNotice("คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอก"); setFailed(value); }
  }
  return <div className="grid gap-5">{names.map(name => <section key={name.name_id}><h3>{name.variant || "ชื่อหลัก"}</h3><pre className="registry-name">{name.frozen_name}</pre><div className="flex flex-wrap gap-3"><button className="registry-button" onClick={() => void copy(name.frozen_name)}>คัดลอกชื่อ</button><button className="registry-button" onClick={() => void copy(name.utm_campaign)}>คัดลอก utm_campaign</button></div><p className="mt-4">utm_id: {name.utm_id_note}</p><p>GOOGLE: utm_id={"{campaignid}"}</p><div className="flex flex-wrap gap-3 mt-4"><button className="registry-button" onClick={() => void copy(name.utm_google)}>คัดลอก UTM สำหรับ GOOGLE</button><button className="registry-button primary" onClick={() => void copy(name.launch_pack)}>คัดลอกชุดข้อมูลสำหรับเปิดแคมเปญ</button></div></section>)}<p role="status" className="text-success">{notice}</p>{failed && <label>ข้อความสำหรับคัดลอก<textarea readOnly className="registry-input" value={failed} rows={5} onFocus={event => event.currentTarget.select()} /></label>}</div>;
}

function VariantForm({ detail, vocab, settings, onUpdated }: { detail: Detail; vocab: Vocab[]; settings: Settings; onUpdated: (detail: Detail) => void }) {
  const [variant, setVariant] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { onUpdated(await request<Detail>(`${api}/registrations/${detail.registration.code}/names`, "POST", { variant: variant || null })); setVariant(""); }
    catch (err) { setError(message(err)); }
    finally { setSaving(false); }
  }
  return <form className="registry-panel" onSubmit={save}><h3>เพิ่มรูปแบบย่อยภายใต้รหัสเดิม</h3><p className="text-muted mb-4">ชื่อแต่ละรูปแบบคงเดิมหลังออกชื่อ ใช้ SN เดียวกันสำหรับทะเบียนนี้</p><DropdownPop label="รูปแบบย่อยเพิ่มเติม" value={variant} options={[{ value: "", label: "ไม่มีรูปแบบย่อย", disabled: false }, ...options(vocab, "VARIANT")].map(option => ({ ...option, disabled: option.disabled || detail.names.some(name => (name.variant || "") === option.value) }))} onChange={setVariant} disabled={saving || !settings.can_issue} />{error && <p role="alert" className="registry-error">{error}</p>}<button className="registry-button primary mt-4" disabled={saving || !settings.can_issue || detail.names.some(name => (name.variant || "") === variant)}>ออกชื่อรูปแบบย่อย</button></form>;
}

function BindingForm({ detail, vocab, onDirty, onUpdated }: { detail: Detail; vocab: Vocab[]; onDirty: (dirty: boolean) => void; onUpdated: (value: Detail) => void }) {
  const [nameId, setNameId] = useState(detail.names[0]?.name_id ?? "");
  const [platform, setPlatform] = useState("GOOGLE");
  const [account, setAccount] = useState("");
  const [campaign, setCampaign] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => { document.getElementById("binding-account")?.focus(); }, []);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  async function save(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (!account.trim() || !campaign.trim()) { setError("กรุณากรอกรหัสบัญชีโฆษณาและรหัสแคมเปญ"); return; }
    setSaving(true);
    try {
      const replay = detail.bindings.some(binding => binding.name_id === nameId && binding.platform === platform && binding.account_id === account && binding.campaign_id === campaign);
      await request<Binding>(`${api}/registrations/${detail.registration.code}/bindings`, "POST", { name_id: nameId, platform, account_id: account, campaign_id: campaign });
      onUpdated(await request<Detail>(`${api}/registrations/${detail.registration.code}`));
      setNotice(replay ? "รหัสนี้บันทึกไว้แล้ว" : "บันทึกรหัสแล้ว"); setAccount(""); setCampaign(""); onDirty(false);
    } catch (err) { setError(message(err)); }
    finally { setSaving(false); }
  }
  return <><form onSubmit={save} noValidate><div className="grid gap-5 md:grid-cols-2"><DropdownPop label="ชื่อที่ออกแล้ว" value={nameId} options={detail.names.map(name => ({ value: name.name_id, label: name.variant || "ชื่อหลัก" }))} onChange={setNameId} disabled={saving} /><DropdownPop label="แพลตฟอร์ม" value={platform} options={options(vocab, "PLATFORM")} onChange={setPlatform} disabled={saving} /><label>รหัสบัญชีโฆษณา<input id="binding-account" className="registry-input" type="text" value={account} disabled={saving} onChange={event => { setAccount(event.target.value); onDirty(true); }} required maxLength={128} autoComplete="off" /></label><label>รหัสแคมเปญ<input id="binding-campaign" className="registry-input" type="text" value={campaign} disabled={saving} onChange={event => { setCampaign(event.target.value); onDirty(true); }} required maxLength={128} autoComplete="off" /></label></div><p className="text-muted mt-4">เก็บรหัสตามต้นทาง รวมเลขศูนย์นำหน้า ส่งรหัสได้หลายแคมเปญต่อหนึ่งชื่อ</p>{error && <div ref={summary} tabIndex={-1} className="registry-error" role="alert">{error}<p><a href="#binding-account">ตรวจรหัสบัญชีโฆษณา</a> · <a href="#binding-campaign">ตรวจรหัสแคมเปญ</a></p></div>}<p role="status" className="text-success mt-3">{notice}</p><button className="registry-button primary mt-4" disabled={saving || !nameId || detail.registration.status === "CANCELLED"}>{saving ? "กำลังบันทึก…" : "บันทึกรหัส"}</button></form><h3 className="mt-7">รหัสที่ส่งแล้ว</h3>{detail.bindings.length ? <ul className="pl-5">{detail.bindings.map((binding, i) => <li key={`${binding.platform}-${binding.account_id}-${binding.campaign_id}-${i}`}>{binding.platform} · {binding.account_id} · {binding.campaign_id}</li>)}</ul> : <p className="text-muted">ยังไม่มีรหัสบนแพลตฟอร์ม</p>}</>;
}

function RegistrationWizard({ settings, vocab, onDirty }: { settings: Settings; vocab: Vocab[]; onDirty: (dirty: boolean) => void }) {
  const [step, setStep] = useState(1);
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [phases, setPhases] = useState<Scope[]>([]);
  const [pickerGroup, setPickerGroup] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [scopeError, setScopeError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Detail | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const selectedScope = (selection.scope_kind === "B" ? phases : scopes).find(scope => scope.scope_id === selection.scope_id);
  const corporate = selectedScope?.kind === "CORP";
  const patch = useCallback((values: Partial<Selection>) => { setSelection(current => ({ ...current, ...values })); setError(""); onDirty(true); }, [onDirty]);
  useEffect(() => {
    let active = true; setScopeError(""); setScopes([]);
    const kind = ["B", "C", "D"].includes(selection.scope_kind) ? "A" : selection.scope_kind;
    request<Scope[]>(`${api}/scopes?kind=${kind}`).then(rows => { if (active) setScopes(rows); }).catch(err => { if (active) setScopeError(message(err)); });
    return () => { active = false; };
  }, [selection.scope_kind]);
  useEffect(() => {
    let active = true; setPhases([]);
    if (!["B", "C"].includes(selection.scope_kind) || !pickerGroup) return;
    request<Scope[]>(`${api}/scopes?kind=B&parent_group_id=${encodeURIComponent(pickerGroup)}`).then(rows => { if (active) setPhases(rows); }).catch(err => { if (active) setScopeError(message(err)); });
    return () => { active = false; };
  }, [selection.scope_kind, pickerGroup]);
  useEffect(() => {
    let active = true; setPreview(null); setPreviewError("");
    if (!selection.objective || !selection.agency || saved) return;
    const timer = setTimeout(() => { request<Preview>(`${api}/registrations/preview`, "POST", selection).then(value => { if (active) setPreview(value); }).catch(err => { if (active) setPreviewError(message(err)); }); }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [selection, saved]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { if (error) summary.current?.focus(); }, [error]);
  function next() {
    if (step === 1) {
      if (["C", "D"].includes(selection.scope_kind) ? new Set(selection.member_ids).size < 2 || (selection.scope_kind === "C" && !selection.parent_group_id) : !selection.scope_id) { setError(["C", "D"].includes(selection.scope_kind) ? "เลือกสมาชิกอย่างน้อย 2 รายการที่ไม่ซ้ำกัน" : "กรุณาเลือกขอบเขตโฆษณา"); return; }
    } else if (!preview) { setError(previewError || "กรุณากรอกรายละเอียดและรอตัวอย่างชื่อจากระบบ"); return; }
    setError(""); setStep(step + 1);
  }
  async function save() {
    if (!preview || !settings.can_issue || saving) return;
    setSaving(true); setError("");
    try { const result = await request<Detail>(`${api}/registrations`, "POST", selection); setSaved(result); onDirty(false); }
    catch (err) { const status = (err as Error & { status?: number }).status; setError(status && status < 500 ? message(err) : "ยังยืนยันการบันทึกไม่ได้ กรุณาตรวจรายการล่าสุดก่อนลองอีกครั้ง"); }
    finally { setSaving(false); }
  }
  const memberRows = selection.scope_kind === "C" ? phases : scopes.filter(scope => scope.member_ids[0] !== pickerGroup);
  return <><ol className="registry-steps" aria-label="ขั้นตอนลงทะเบียน">{["ขอบเขตโฆษณา", "รายละเอียดแคมเปญ", "ตรวจสอบและออกชื่อ"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}>{index + 1} · {label}</li>)}</ol><section className="registry-panel"><h2 ref={heading} tabIndex={-1}>{saved ? `ออกชื่อเรียบร้อยแล้ว: ${saved.registration.code}` : `${step} · ${["ขอบเขตโฆษณา", "รายละเอียดแคมเปญ", "ตรวจสอบและออกชื่อ"][step - 1]}`}</h2>
    {error && <div ref={summary} tabIndex={-1} className="registry-error" role="alert">{error}<p><a href="#wizard-fields">กลับไปตรวจข้อมูล</a> · <a href="/ads/registry">ตรวจรายการล่าสุด</a></p></div>}
    {saved ? <div className="mt-5"><LaunchPacks names={saved.names} /><a className="registry-button mt-5" href={`/ads/registry?registration=${saved.registration.code}&tab=names`}>เปิดรายละเอียด</a></div> : <><div id="wizard-fields" className="mt-5 grid gap-5">
      {step === 1 && <><DropdownPop label="ประเภทขอบเขต" value={selection.scope_kind} options={Object.entries(scopeLabels).map(([value, label]) => ({ value, label }))} onChange={value => { setPickerGroup(""); patch({ scope_kind: value, scope_id: null, parent_group_id: null, member_ids: [], content_label: null, content_label_approved: false }); }} />
        {scopeError && <p role="alert" className="registry-error">{scopeError}</p>}
        {["B", "C", "D"].includes(selection.scope_kind) ? <DropdownPop label={selection.scope_kind === "D" ? "กลุ่มโครงการแรก" : "กลุ่มโครงการ"} value={pickerGroup} options={scopes.map(scope => ({ value: scope.member_ids[0], label: `${scope.scope_code} · ${scope.label_th}${!scope.can_use ? " (ยังไม่เปิดใช้)" : ""}`, disabled: !scope.can_use }))} onChange={value => { setPickerGroup(value); patch({ scope_id: null, parent_group_id: selection.scope_kind === "C" ? value : null, member_ids: selection.scope_kind === "D" ? [value] : [] }); }} /> : <DropdownPop label="ขอบเขตที่เลือก" value={selection.scope_id || ""} options={scopes.map(scope => ({ value: scope.scope_id, label: `${scope.scope_code} · ${scope.label_th}${!scope.can_use ? " (ยังไม่เปิดใช้)" : ""}`, disabled: !scope.can_use }))} onChange={value => patch({ scope_id: value, content_label: null, content_label_approved: false })} />}
        {selection.scope_kind === "B" && pickerGroup && <DropdownPop label="เฟสที่เลือก" value={selection.scope_id || ""} options={phases.map(scope => ({ value: scope.scope_id, label: `${scope.member_ids[0]} · ${scope.label_th}${!scope.can_use ? " (ยังไม่เปิดใช้)" : ""}`, disabled: !scope.can_use }))} onChange={value => patch({ scope_id: value })} />}
        {["C", "D"].includes(selection.scope_kind) && pickerGroup && <fieldset className="border border-line-strong rounded-lg p-4"><legend>{selection.scope_kind === "C" ? "เฟสที่เลือก" : "กลุ่มโครงการเพิ่มเติม"}</legend><p className="text-muted">เลือกอย่างน้อย 2 รายการที่ไม่ซ้ำกัน{selection.scope_kind === "D" ? ` รวมกลุ่มแรก ${pickerGroup}` : ""}</p>{memberRows.map(scope => <label key={scope.scope_id} className="registry-check"><input type="checkbox" disabled={!scope.can_use} checked={selection.member_ids.includes(scope.member_ids[0])} onChange={event => patch({ member_ids: event.target.checked ? [...selection.member_ids, scope.member_ids[0]] : selection.member_ids.filter(id => id !== scope.member_ids[0]) })} />{scope.member_ids[0]} · {scope.label_th}{!scope.can_use ? " (ยังไม่เปิดใช้)" : ""}</label>)}{!memberRows.length && <p>ยังไม่มีสมาชิกให้เลือก</p>}</fieldset>}
      </>}
      {step === 2 && <><div className="grid gap-5 md:grid-cols-2"><DropdownPop label="วัตถุประสงค์" value={selection.objective} options={options(vocab, "OBJECTIVE")} onChange={value => patch({ objective: value })} /><DropdownPop label="เอเจนซีที่รับชื่อ" value={selection.agency} options={options(vocab, "AGENCY")} onChange={value => patch({ agency: value })} /><DropdownPop label="รูปแบบย่อย" value={selection.variant || ""} options={[{ value: "", label: "ไม่มีรูปแบบย่อย" }, ...options(vocab, "VARIANT")]} onChange={value => patch({ variant: value || null })} /></div>{corporate ? <><label>ชื่อเนื้อหาต่อบูสต์ที่อนุมัติ (ภาษาอังกฤษ)<input className="registry-input" value={selection.content_label || ""} maxLength={40} onChange={event => patch({ content_label: event.target.value, content_label_approved: false })} /></label><label className="registry-check"><input type="checkbox" checked={selection.content_label_approved} onChange={event => patch({ content_label_approved: event.target.checked })} />ทีมออนไลน์ยืนยันว่าชื่อเนื้อหานี้ได้รับอนุมัติแล้ว</label></> : <p>ชื่อแสดงภาษาอังกฤษ: {selectedScope?.label_en || "ระบบกำหนดจากขอบเขตที่เลือก"}</p>}</>}
      {step === 3 && <><dl className="registry-detail-list"><dt>ประเภทขอบเขต</dt><dd>{scopeLabels[selection.scope_kind]}</dd><dt>ขอบเขต</dt><dd>{preview?.scope.scope_code}</dd><dt>สมาชิกขอบเขต</dt><dd>{preview?.members.map(member => member.member_id).join(", ")}</dd><dt>วัตถุประสงค์</dt><dd>{selection.objective}</dd><dt>เอเจนซี</dt><dd>{selection.agency}</dd><dt>รูปแบบย่อย</dt><dd>{selection.variant || "ไม่มีรูปแบบย่อย"}</dd></dl><p>ชื่อที่ออกแล้วแก้ไขไม่ได้ การออกชื่อไม่ได้อนุมัติงบประมาณ</p></>}
      {step >= 2 && <section className="registry-banner" aria-label="ตัวอย่างชื่อ"><h3>ตัวอย่างชื่อจากระบบ</h3><div aria-live="polite">{preview ? <><pre className="registry-name">{preview.preview_name}</pre><p>{preview.code_note}</p></> : <p>{previewError || (selection.objective && selection.agency ? "กำลังตรวจสอบตัวอย่างชื่อ…" : "เลือกวัตถุประสงค์และเอเจนซีเพื่อดูตัวอย่าง")}</p>}</div><p className="text-muted">ตัวอย่างนี้ยังใช้เปิดแคมเปญไม่ได้</p></section>}
    </div><div className="flex flex-wrap justify-end gap-3 mt-6"><a className="registry-button" href="/ads/registry">ยกเลิก</a>{step > 1 && <button className="registry-button" disabled={saving} onClick={() => setStep(step - 1)}>ย้อนกลับ</button>}{step < 3 ? <button className="registry-button primary" onClick={next}>ถัดไป</button> : <button className="registry-button primary" disabled={saving || !preview || !settings.can_issue} onClick={() => void save()}>{saving ? "กำลังบันทึก…" : "บันทึกและออกชื่อ"}</button>}</div></>}
  </section></>;
}
