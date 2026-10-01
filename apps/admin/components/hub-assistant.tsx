"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { request } from "./hub-request";
import { PendingQuestion } from "./pending-question";
import { dateTime } from "./content-operations-shared";
import "./hub-assistant.css";

const base = "v1/admin/assistant";
type Context = { project_id?: string; brand_id?: string; rem_project_id?: string; line_id?: string; month?: string; code?: string; visibility?: "draft" | "published" };
type Config = { session_key: string; mode: "fake"; live_available: boolean; allowed_tools: string[]; message_th: string; live_questions: { id: string; label_th: string }[]; proposal_fields: { project?: string[]; brand?: string[] } };
type Metadata = { visibility?: string; version?: string | number | null; environment?: string; synthetic?: boolean; contains_synthetic?: boolean; as_of?: string | null; freshness?: Record<string, unknown> };
type Block = { id: string; text: string; metadata: Metadata; citation_ids: string[] };
type Citation = { id: string; label_th: string };
type Turn = { key: string; question: string; mode: "fake" | "live"; run_id: string | null; blocks: Block[]; citations: Citation[]; status: string; error: string };
type Proposal = { id: string; entity_type: "project" | "brand"; entity_id: string; field_path: string; old_text: string | null; new_text: string; expected_updated_at: string; status: string; digest: string };
const contextLabels = { project_id: "โครงการ", brand_id: "แบรนด์", rem_project_id: "รหัสโครงการ REM", code: "รหัสแคมเปญ SN", line_id: "รายการสื่อ" } as const;
type ContextKind = keyof typeof contextLabels;
const fieldLabels: Record<string, string> = { "meta_title.th": "ชื่อเรื่องสำหรับผู้ใช้งานข้อมูล", "meta_description.th": "คำอธิบายย่อโครงการ", "description.th": "คำอธิบายแบรนด์" };
const messageOf = (error: unknown) => error instanceof TypeError ? "เชื่อมต่อผู้ช่วยไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง" : error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง";
const sourceLink = (href: unknown): href is string => typeof href === "string" && /^\/(?!\/)[^\\\u0000-\u001f\u007f]*$/.test(href);
function pageContext(): Context {
  const query = new URLSearchParams(window.location.search);
  if (query.get("project")) return { project_id: query.get("project")! };
  if (query.get("brand")) return { brand_id: query.get("brand")! };
  if (query.get("registration")) return { code: query.get("registration")! };
  return {};
}
function cleanContext(value: unknown): Context {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const key of [...Object.keys(contextLabels), "month", "visibility"]) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === "string" && entry.length <= 200) result[key] = entry;
  }
  return result as Context;
}
function MetadataView({ value }: { value: Metadata }) {
  const visibility = ({ DRAFT: "ฉบับร่าง", PUBLISHED: "เผยแพร่แล้ว", HISTORICAL: "ข้อมูลย้อนหลัง", TEST: "ข้อมูลทดสอบ", CONFIRMED: "ยืนยันข้อมูลแล้ว", ISSUED: "ชื่อที่ออกแล้ว", REFERENCE: "กติกาอ้างอิง" } as Record<string, string>)[value.visibility?.toUpperCase() ?? ""] ?? "ข้อมูลภายในตามสิทธิ์";
  const freshness = value.freshness;
  const sources = freshness?.source_watermarks && typeof freshness.source_watermarks === "object" ? freshness.source_watermarks as Record<string, unknown> : freshness;
  const watermarks: [string, unknown][] = freshness ? [["รอบข้อมูล DW", freshness.snapshot_at ?? freshness.source_snapshot_at], ["ข้อมูลแพลตฟอร์ม ณ", sources?.platform_source_snapshot_at ?? freshness.platform_data_through], ["ข้อมูล Hub ณ", sources?.hub_source_snapshot_at], ["ข้อมูล REM ณ", sources?.rem_source_snapshot_at]] : [];
  return <div className="assistant-meta"><p>{visibility}{value.version != null && <> · รุ่น <code>{value.version}</code></>} · {value.synthetic ? "ข้อมูลตัวอย่าง" : value.contains_synthetic ? "มีข้อมูลตัวอย่างบางส่วน" : "ข้อมูลภายใน"}{value.environment && <> · <code>{value.environment}</code></>}</p><p>ข้อมูล ณ {value.as_of ? dateTime(value.as_of) : "ยังไม่ยืนยันเวลาต้นทาง"}</p>{freshness && <><p>{freshness.stale === true || String(freshness.status).toUpperCase() === "STALE" ? "ข้อมูลยังไม่เป็นปัจจุบัน กรุณาตรวจรอบข้อมูลก่อนใช้" : "ความสดของข้อมูลต้องพิจารณาจากเวลาต้นทาง"}</p><dl>{watermarks.filter(([, date]) => typeof date === "string").map(([label, date]) => <div key={label}><dt>{label}</dt><dd>{dateTime(String(date))}</dd></div>)}</dl></>}</div>;
}
function CitationButton({ citation, run }: { citation: Citation; run: string }) {
  const [source, setSource] = useState<{ source_href: string; metadata: Metadata; source?: { version?: string; page?: number } } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true); setError(""); setSource(null);
    try { const result = await request<NonNullable<typeof source>>(`${base}/runs/${run}/citations/${citation.id}`); if (!sourceLink(result.source_href)) throw new Error("ไม่พบลิงก์ต้นทางที่มีสิทธิ์เข้าถึง"); setSource(result); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  return <div><button type="button" className="button secondary" disabled={busy} aria-busy={busy} onClick={() => void check()}>{citation.label_th}</button>{error && <p role="alert" className="notice error">{error}</p>}{source && <><a className="assistant-citation-link" href={source.source_href} target="_blank" rel="noopener noreferrer">เปิดต้นทางที่ตรวจสิทธิ์แล้ว{source.source?.page != null && ` · หน้า ${source.source.page}`}</a><MetadataView value={source.metadata ?? {}} /></>}</div>;
}
function DraftProposal({ context, config }: { context: Context; config: Config }) {
  const entityType = context.project_id ? "project" : context.brand_id ? "brand" : null;
  const publicId = context.project_id ?? context.brand_id;
  const fields = entityType ? config.proposal_fields?.[entityType] ?? [] : [];
  const [target, setTarget] = useState<Record<string, unknown> | null>(null); const [field, setField] = useState(fields[0] ?? "");
  const [text, setText] = useState(""); const [rationale, setRationale] = useState(""); const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(false); const [stale, setStale] = useState(false);
  if (!entityType || !publicId || !fields.length) return null;
  async function load() {
    setBusy(true); setError(""); setProposal(null); setSaved(false); setStale(false);
    try { setTarget(await request<Record<string, unknown>>(`v1/admin/${entityType === "project" ? "projects" : "brands"}/${encodeURIComponent(publicId!)}`)); }
    catch (error) { setError(messageOf(error)); } finally { setBusy(false); }
  }
  async function propose(event: FormEvent) {
    event.preventDefault(); if (!target) return; setBusy(true); setError(""); setProposal(null); setSaved(false); setStale(false);
    try { setProposal(await request<Proposal>(`${base}/proposals`, "POST", { entity_type: entityType, entity_id: target.id, field_path: field, new_text: text, expected_updated_at: target.updated_at, rationale })); }
    catch (error) { setError(messageOf(error)); if ((error as { status?: number }).status === 409) setStale(true); } finally { setBusy(false); }
  }
  async function suggest() {
    if (!target) return; setBusy(true); setError(""); setProposal(null); setSaved(false); setStale(false);
    try { setProposal(await request<Proposal>(`${base}/proposals/suggest`, "POST", { entity_type: entityType, entity_id: target.id, field_path: field, expected_updated_at: target.updated_at })); }
    catch (error) { setError(messageOf(error)); if ((error as { status?: number }).status === 409) setStale(true); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!proposal || stale) return; setBusy(true); setError("");
    try { const result = await request<{ proposal: Proposal }>(`${base}/proposals/${proposal.id}/confirm`, "POST", { digest: proposal.digest, confirmed: true }); setProposal(result.proposal); setSaved(true); }
    catch (error) { setError(messageOf(error)); if ((error as { status?: number }).status === 409) setStale(true); } finally { setBusy(false); }
  }
  const oldValue = target ? (target[field.split(".")[0]] as Record<string, unknown> | undefined)?.th : null;
  return <details className="assistant-proposal"><summary>เสนอแก้ข้อความฉบับร่าง</summary><p>แก้ได้เฉพาะช่องข้อความตัวอย่างที่ระบบอนุญาต การส่งแชตไม่ใช่คำสั่งบันทึก และไม่เปลี่ยนฉบับเผยแพร่</p><button className="button secondary" type="button" onClick={() => void load()} disabled={busy}>{target ? "โหลดฉบับร่างล่าสุดเพื่อทบทวนใหม่" : "โหลดข้อความฉบับร่างที่มีสิทธิ์แก้"}</button>{error && <p role="alert" className="notice error">{error}</p>}{target && <form onSubmit={propose}><div className="form-field"><label htmlFor="assistant-draft-field">ช่องข้อความ</label><select id="assistant-draft-field" value={field} onChange={event => { setField(event.target.value); setProposal(null); setSaved(false); }} disabled={busy}>{fields.map(path => <option key={path} value={path}>{fieldLabels[path] ?? "ข้อความที่ระบบอนุญาต"}</option>)}</select></div><p>ข้อความปัจจุบัน: {typeof oldValue === "string" && oldValue ? oldValue : "ยังไม่มีข้อความ"}</p><button className="button secondary" type="button" disabled={busy || stale} aria-busy={busy} onClick={() => void suggest()}>ให้ผู้ช่วยเสนอข้อความ</button><p className="assistant-meta">ผู้ช่วยจำลองในเครื่องเสนอจากข้อความเดิม ไม่ได้เรียกโมเดลจริง หรือกรอกข้อความที่คุณเขียนเองด้านล่างเพื่อสร้างข้อเสนอ</p><div className="form-field"><label htmlFor="assistant-draft-new">ข้อความที่เสนอ</label><textarea id="assistant-draft-new" rows={4} maxLength={4000} value={text} disabled={busy} onChange={event => { setText(event.target.value); setProposal(null); setSaved(false); }} required /></div><div className="form-field"><label htmlFor="assistant-draft-reason">เหตุผลที่เสนอ</label><textarea id="assistant-draft-reason" rows={2} maxLength={1000} value={rationale} disabled={busy} onChange={event => { setRationale(event.target.value); setProposal(null); setSaved(false); }} /></div><button className="button secondary" type="submit" disabled={busy || !text.trim() || stale} aria-busy={busy}>สร้างข้อเสนอเพื่อดูความแตกต่าง</button></form>}{proposal && <section aria-label="ความแตกต่างของข้อความที่เสนอ"><dl className="assistant-diff"><div><dt>ก่อนแก้ไข</dt><dd>{proposal.old_text || "ยังไม่มีข้อความ"}</dd></div><div><dt>หลังแก้ไข</dt><dd>{proposal.new_text}</dd></div></dl><p className="assistant-meta">รุ่นข้อมูลอ้างอิง <code>{proposal.expected_updated_at}</code></p>{saved ? <p role="status" className="notice success">บันทึกฉบับร่างแล้ว · ฉบับเผยแพร่ยังไม่เปลี่ยน</p> : <button className="button primary" type="button" disabled={busy || stale} aria-busy={busy} onClick={() => void confirm()}>ยืนยันบันทึกเป็นฉบับร่าง</button>}</section>}</details>;
}

export function HubAssistant() {
  const [open, setOpen] = useState(false); const [config, setConfig] = useState<Config | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [context, setContext] = useState<Context>({}); const [contextKind, setContextKind] = useState<ContextKind>("project_id"); const [contextId, setContextId] = useState(""); const [month, setMonth] = useState(""); const [visibility, setVisibility] = useState<"draft" | "published">("draft");
  const [mode, setMode] = useState<"fake" | "live">("fake"); const [question, setQuestion] = useState(""); const [golden, setGolden] = useState(""); const [turns, setTurns] = useState<Turn[]>([]); const [busy, setBusy] = useState(false); const [status, setStatus] = useState("");
  const trigger = useRef<HTMLButtonElement>(null); const dialog = useRef<HTMLDialogElement>(null); const heading = useRef<HTMLHeadingElement>(null); const latest = useRef<HTMLDivElement>(null); const controller = useRef<AbortController | null>(null); const runId = useRef<string | null>(null);
  useEffect(() => { const update = () => setOpen(new URLSearchParams(window.location.search).get("assistant") === "open"); update(); window.addEventListener("popstate", update); return () => { window.removeEventListener("popstate", update); controller.current?.abort(); }; }, []);
  useEffect(() => { if (open) { dialog.current?.showModal(); heading.current?.focus(); } else { dialog.current?.close(); } }, [open]);
  useEffect(() => { if (open && !config && !loading) void loadConfig(); }, [open]);
  function contextSaved(next: Context, value = config) {
    setContext(next); const key = (Object.keys(contextLabels) as ContextKind[]).find(key => next[key]); setContextKind(key ?? "project_id"); setContextId(key ? next[key]! : ""); setMonth(next.month?.slice(0, 7) ?? ""); setVisibility(next.visibility ?? "draft");
    if (value) try { sessionStorage.setItem(`hub-assistant-context:${value.session_key}`, JSON.stringify(next)); } catch { /* Context still remains available in this mounted session. */ }
  }
  async function loadConfig() {
    setLoading(true); setError("");
    try { const value = await request<Config>(`${base}/config`); setConfig(value); setGolden(value.live_questions[0]?.id ?? ""); let next = pageContext(); try { const stored = sessionStorage.getItem(`hub-assistant-context:${value.session_key}`); if (stored != null) next = cleanContext(JSON.parse(stored)); } catch { /* Invalid storage never becomes a request context. */ } contextSaved(next, value); }
    catch (error) { setError(messageOf(error)); } finally { setLoading(false); }
  }
  function toggle(next: boolean) {
    if (!next) stop(); setOpen(next); const url = new URL(window.location.href); if (next) url.searchParams.set("assistant", "open"); else url.searchParams.delete("assistant"); window.history.replaceState(window.history.state, "", url); if (!next) trigger.current?.focus();
  }
  function stop() {
    if (!controller.current) return; controller.current.abort(); controller.current = null; setBusy(false); setStatus("หยุดการตอบแล้ว");
    if (runId.current) void request(`${base}/runs/${runId.current}/cancel`, "POST", {}).catch(() => {});
  }
  function updateTurn(key: string, update: (turn: Turn) => Turn) { setTurns(items => items.map(turn => turn.key === key ? update(turn) : turn)); }
  async function ask(event: FormEvent) {
    event.preventDefault(); if (!config || busy || mode === "fake" && !question.trim() || mode === "live" && (!config.live_available || !golden)) return;
    const abort = new AbortController(); controller.current = abort; runId.current = null; setBusy(true); setError(""); setStatus("กำลังตรวจสิทธิ์และค้นข้อมูลที่อนุญาต");
    const key = crypto.randomUUID(); const sentQuestion = mode === "fake" ? question : config.live_questions.find(item => item.id === golden)?.label_th ?? "คำถามสาธิต";
    setTurns(items => [...items, { key, question: sentQuestion, mode, run_id: null, blocks: [], citations: [], status: "RUNNING", error: "" }]);
    let finished = false;
    try {
      const response = await fetch(`/api/hub/${base}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "fake" ? { mode, message: question, context } : { mode, golden_id: golden }), signal: abort.signal, cache: "no-store" });
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error?.message ?? "เริ่มการตอบไม่สำเร็จ กรุณาลองอีกครั้ง"); }
      if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("ไม่ได้รับข้อมูลคำตอบในรูปแบบที่รองรับ");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let received = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break; received += chunk.value.length; if (received > 1_000_000) throw new Error("คำตอบยาวเกินกำหนด กรุณาถามให้เฉพาะเจาะจงขึ้น");
          buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, "\n"); let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const lines = frame.split("\n"); const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim(); const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n"); if (!data) continue;
            let value; try { value = JSON.parse(data); } catch { throw new Error("ข้อมูลคำตอบไม่สมบูรณ์ กรุณาลองเป็นคำถามใหม่"); }
            if (typeof value.run_id === "string") { runId.current = value.run_id; updateTurn(key, turn => ({ ...turn, run_id: value.run_id })); }
            if (event === "status") setStatus(value.message_th || "กำลังประมวลผลคำถาม");
            if (event === "tool_start" || event === "tool_end") setStatus(value.label_th || "กำลังตรวจข้อมูลตามสิทธิ์");
            if (event === "answer_delta" && typeof value.text === "string") updateTurn(key, turn => ({ ...turn, blocks: [...turn.blocks, { id: String(value.block_id ?? turn.blocks.length), text: value.text, metadata: value.metadata ?? {}, citation_ids: Array.isArray(value.citation_ids) ? value.citation_ids : [] }] }));
            if (event === "citation" && typeof value.id === "string") updateTurn(key, turn => ({ ...turn, citations: [...turn.citations.filter(item => item.id !== value.id), { id: value.id, label_th: value.label_th || "ตรวจแหล่งข้อมูล" }] }));
            if (event === "error") throw new Error(value.message_th || "ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้");
            if (event === "done") { finished = true; updateTurn(key, turn => ({ ...turn, status: value.status ?? "COMPLETED" })); setStatus(value.status === "NO_ANSWER" ? "ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้" : "ตอบเรียบร้อยแล้ว"); if (mode === "fake") setQuestion(current => current === sentQuestion ? "" : current); }
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (!finished) throw new Error("การเชื่อมต่อสิ้นสุดก่อนยืนยันคำตอบ กรุณาลองเป็นคำถามใหม่");
    } catch (error) {
      const cancelled = abort.signal.aborted; const message = cancelled ? "หยุดการตอบแล้ว" : messageOf(error); updateTurn(key, turn => ({ ...turn, status: cancelled ? "CANCELLED" : "ERROR", error: message })); if (controller.current === abort || !controller.current) setStatus(message);
    } finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  }
  const contextText = (Object.keys(contextLabels) as ContextKind[]).filter(key => context[key]).map(key => `${contextLabels[key]}: ${context[key]}`).join(" · ");
  const availableKinds = (Object.keys(contextLabels) as ContextKind[]).filter(key => key === "project_id" ? config?.allowed_tools.includes("get_project") : key === "brand_id" ? config?.allowed_tools.includes("get_brand") : key === "rem_project_id" ? config?.allowed_tools.includes("get_project_marketing") : key === "line_id" ? config?.allowed_tools.includes("get_line_actuals") : config?.allowed_tools.includes("get_campaign"));
  return <><button ref={trigger} className="nav-link assistant-trigger" type="button" aria-haspopup="dialog" onClick={() => toggle(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true"><path d="M4 4h16v13H9l-5 4V4zM8 8h8M8 12h5" /></svg><span>ผู้ช่วย Hub</span></button><dialog ref={dialog} className="action-dialog assistant-panel" aria-labelledby="assistant-title" onCancel={event => { event.preventDefault(); toggle(false); }}><header className="assistant-heading"><h2 ref={heading} tabIndex={-1} id="assistant-title">ผู้ช่วย Hub</h2><button className="button secondary" type="button" onClick={() => toggle(false)}>ปิดผู้ช่วย</button></header><p>ผู้ช่วยภายในสำหรับทีมงาน · อ่านข้อมูลตามสิทธิ์ของบัญชีนี้</p><div className="assistant-questions">{["Q36", "Q38", "Q42", "Q43", "Q44"].map(id => <PendingQuestion key={id} id={id} />)}</div>{loading && <p role="status" className="hub-loading">กำลังตรวจการตั้งค่าผู้ช่วย…</p>}{error && <div role="alert" className="notice error"><p>{error}</p><button className="button secondary" onClick={() => void loadConfig()}>ลองโหลดผู้ช่วยอีกครั้ง</button></div>}{config && <><div className="assistant-note"><p><strong>{mode === "fake" ? "โหมดจำลองในเครื่อง · ไม่ได้เรียกโมเดลจริง" : "โมเดลจริง · ใช้เฉพาะคำถามและข้อมูลสมมติที่ระบบกำหนด"}</strong></p><p>{config.message_th}</p><p>คำตอบตัวเลขใช้ข้อมูลจากเครื่องมือ ข้อมูลที่ยังยืนยันไม่ได้จะไม่แทนด้วยศูนย์</p></div><div className="assistant-context"><p><strong>บริบทที่เลือก:</strong> {contextText || "ยังไม่เลือกบริบท"}{context.month && ` · เดือน ${context.month}`}</p><p>คงบริบทนี้ไว้จนกว่าจะเปลี่ยนเอง การเปลี่ยนหน้าไม่เปลี่ยนโครงการในบทสนทนา</p><details><summary>เปลี่ยนบริบทอย่างชัดเจน</summary><form onSubmit={event => { event.preventDefault(); contextSaved(contextId.trim() ? { [contextKind]: contextId.trim(), ...(month ? { month: `${month}-01` } : {}), visibility } : {}); }}><div className="assistant-fields"><div className="form-field"><label htmlFor="assistant-context-kind">ประเภทบริบท</label><select id="assistant-context-kind" value={contextKind} onChange={event => setContextKind(event.target.value as ContextKind)} disabled={busy}>{availableKinds.map(kind => <option key={kind} value={kind}>{contextLabels[kind]}</option>)}</select></div><div className="form-field"><label htmlFor="assistant-context-id">รหัสบริบทตามต้นทาง</label><input id="assistant-context-id" value={contextId} maxLength={128} disabled={busy} onChange={event => setContextId(event.target.value)} /></div><div className="form-field"><label htmlFor="assistant-context-month">เดือนตามเวลาประเทศไทย</label><input id="assistant-context-month" type="month" value={month} disabled={busy} onChange={event => setMonth(event.target.value)} /></div><div className="form-field"><label htmlFor="assistant-context-version">ฉบับข้อมูลที่ต้องการ</label><select id="assistant-context-version" value={visibility} disabled={busy} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="draft">ฉบับร่าง</option><option value="published">ฉบับเผยแพร่</option></select></div></div><div className="assistant-actions"><button className="button secondary" disabled={busy} type="submit">ใช้บริบทนี้</button><button className="button secondary" type="button" disabled={busy} onClick={() => contextSaved(pageContext())}>ใช้บริบทของหน้าปัจจุบัน</button><button className="button secondary" type="button" disabled={busy} onClick={() => contextSaved({})}>ล้างบริบท</button></div></form></details></div><div className="form-field"><label htmlFor="assistant-mode">วิธีตอบคำถาม</label><select id="assistant-mode" value={mode} disabled={busy} onChange={event => setMode(event.target.value as typeof mode)}><option value="fake">จำลองในเครื่อง</option><option value="live" disabled={!config.live_available}>โมเดลจริงสำหรับข้อมูลสมมติ</option></select>{!config.live_available && <p className="field-help">ใช้โหมดจำลองระหว่างที่โหมดจริงยังไม่พร้อมสำหรับบัญชีนี้</p>}</div><div aria-label="บทสนทนาผู้ช่วย">{turns.map(turn => <article key={turn.key} className="assistant-turn"><h3>คุณ: {turn.question}</h3><p className="assistant-meta">{turn.mode === "fake" ? "คำตอบจากโหมดจำลองในเครื่อง" : "คำตอบจากโมเดลจริงด้วยข้อมูลสมมติ"}</p>{turn.blocks.map(block => <section key={block.id} className="assistant-answer-block"><p className="assistant-answer">{block.text}</p><MetadataView value={block.metadata} />{turn.run_id && <div className="assistant-citations">{turn.citations.filter(citation => block.citation_ids.includes(citation.id)).map(citation => <CitationButton key={citation.id} citation={citation} run={turn.run_id!} />)}</div>}</section>)}{turn.error && <p role="alert" className="notice error">{turn.error}</p>}{!turn.blocks.length && turn.status !== "RUNNING" && !turn.error && <p>ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้</p>}</article>)}</div><div ref={latest} tabIndex={-1} /><div className="assistant-actions"><p role="status" aria-live="polite">{status}</p>{turns.length > 0 && <button className="button secondary" type="button" onClick={() => { latest.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); latest.current?.focus({ preventScroll: true }); }}>ไปยังคำตอบล่าสุด</button>}</div><form className="assistant-composer" onSubmit={ask}>{mode === "fake" ? <div className="form-field"><label htmlFor="assistant-question">คำถามสำหรับโหมดจำลองในเครื่อง</label><textarea id="assistant-question" rows={3} value={question} maxLength={2000} onChange={event => setQuestion(event.target.value)} disabled={busy} required /><p className="field-help">พิมพ์คำถามได้อย่างอิสระในโหมดจำลอง ข้อความนี้ไม่ส่งไปยังผู้ให้บริการภายนอก</p></div> : <div className="form-field"><label htmlFor="assistant-golden">คำถามข้อมูลสมมติที่อนุญาต</label><select id="assistant-golden" value={golden} disabled={busy} onChange={event => setGolden(event.target.value)}>{config.live_questions.map(item => <option key={item.id} value={item.id}>{item.label_th}</option>)}</select><p className="field-help">ใช้บริบทสมมติที่ระบบกำหนดสำหรับคำถามนี้ ไม่ส่งข้อความที่พิมพ์หรือบริบทที่เลือกด้านบน</p></div>}<div className="assistant-actions"><button className="button primary" type="submit" disabled={busy || mode === "fake" && !question.trim() || mode === "live" && (!golden || !config.live_available)} aria-busy={busy}>ส่งคำถาม</button>{busy && <button className="button secondary" type="button" onClick={stop}>หยุดการตอบ</button>}</div></form><DraftProposal key={JSON.stringify(context)} context={context} config={config} /></>}</dialog></>;
}
