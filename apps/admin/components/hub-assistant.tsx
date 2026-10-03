"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
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
  return <section className="assistant-proposal"><h3>เสนอแก้ข้อความฉบับร่าง</h3><p>แก้ได้เฉพาะช่องข้อความตัวอย่างที่ระบบอนุญาต การส่งแชตไม่ใช่คำสั่งบันทึก และไม่เปลี่ยนฉบับเผยแพร่</p><button className="button secondary" type="button" onClick={() => void load()} disabled={busy}>{target ? "โหลดฉบับร่างล่าสุดเพื่อทบทวนใหม่" : "โหลดข้อความฉบับร่างที่มีสิทธิ์แก้"}</button>{error && <p role="alert" className="notice error">{error}</p>}{target && <form onSubmit={propose}><div className="form-field"><label htmlFor="assistant-draft-field">ช่องข้อความ</label><select id="assistant-draft-field" value={field} onChange={event => { setField(event.target.value); setProposal(null); setSaved(false); }} disabled={busy}>{fields.map(path => <option key={path} value={path}>{fieldLabels[path] ?? "ข้อความที่ระบบอนุญาต"}</option>)}</select></div><p>ข้อความปัจจุบัน: {typeof oldValue === "string" && oldValue ? oldValue : "ยังไม่มีข้อความ"}</p><button className="button secondary" type="button" disabled={busy || stale} aria-busy={busy} onClick={() => void suggest()}>ให้ผู้ช่วยเสนอข้อความ</button><p className="assistant-meta">ผู้ช่วยจำลองในเครื่องเสนอจากข้อความเดิม ไม่ได้เรียกโมเดลจริง หรือกรอกข้อความที่คุณเขียนเองด้านล่างเพื่อสร้างข้อเสนอ</p><div className="form-field"><label htmlFor="assistant-draft-new">ข้อความที่เสนอ</label><textarea id="assistant-draft-new" rows={4} maxLength={4000} value={text} disabled={busy} onChange={event => { setText(event.target.value); setProposal(null); setSaved(false); }} required /></div><div className="form-field"><label htmlFor="assistant-draft-reason">เหตุผลที่เสนอ</label><textarea id="assistant-draft-reason" rows={2} maxLength={1000} value={rationale} disabled={busy} onChange={event => { setRationale(event.target.value); setProposal(null); setSaved(false); }} /></div><button className="button secondary" type="submit" disabled={busy || !text.trim() || stale} aria-busy={busy}>สร้างข้อเสนอเพื่อดูความแตกต่าง</button></form>}{proposal && <section aria-label="ความแตกต่างของข้อความที่เสนอ"><dl className="assistant-diff"><div><dt>ก่อนแก้ไข</dt><dd>{proposal.old_text || "ยังไม่มีข้อความ"}</dd></div><div><dt>หลังแก้ไข</dt><dd>{proposal.new_text}</dd></div></dl><p className="assistant-meta">รุ่นข้อมูลอ้างอิง <code>{proposal.expected_updated_at}</code></p>{saved ? <p role="status" className="notice success">บันทึกฉบับร่างแล้ว · ฉบับเผยแพร่ยังไม่เปลี่ยน</p> : <button className="button primary" type="button" disabled={busy || stale} aria-busy={busy} onClick={() => void confirm()}>ยืนยันบันทึกเป็นฉบับร่าง</button>}</section>}</section>;
}

export function HubAssistant({ navigationTarget, onNavigationOpen }: { navigationTarget: HTMLElement | null; onNavigationOpen: () => HTMLElement | null }) {
  const [open, setOpen] = useState(false); const [config, setConfig] = useState<Config | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [context, setContext] = useState<Context>({}); const [contextKind, setContextKind] = useState<ContextKind>("project_id"); const [contextId, setContextId] = useState(""); const [month, setMonth] = useState(""); const [visibility, setVisibility] = useState<"draft" | "published">("draft");
  const [mode, setMode] = useState<"fake" | "live">("fake"); const [question, setQuestion] = useState(""); const [golden, setGolden] = useState(""); const [turns, setTurns] = useState<Turn[]>([]); const [busy, setBusy] = useState(false); const [status, setStatus] = useState("");
  const [tab, setTab] = useState<"chat" | "draft">("chat"); const [saveBarClearance, setSaveBarClearance] = useState(0);
  const [editorSlot, setEditorSlot] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null); const floatingTrigger = useRef<HTMLButtonElement>(null); const opener = useRef<HTMLElement | null>(null); const dialog = useRef<HTMLDialogElement>(null); const latest = useRef<HTMLDivElement>(null); const controller = useRef<AbortController | null>(null); const runId = useRef<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null); const goldenInput = useRef<HTMLSelectElement>(null); const shown = useRef(false);
  const contextButton = useRef<HTMLButtonElement>(null); const contextPopover = useRef<HTMLDivElement>(null); const contextHeading = useRef<HTMLHeadingElement>(null); const contextPopoverId = useId();
  useEffect(() => { const update = () => { const next = new URLSearchParams(window.location.search).get("assistant") === "open"; if (next) setTab("chat"); setOpen(next); }; update(); window.addEventListener("popstate", update); return () => { window.removeEventListener("popstate", update); controller.current?.abort(); }; }, []);
  useEffect(() => {
    const main = document.getElementById("main-content"); if (!main) return;
    let bar: HTMLElement | null = null; let action: HTMLElement | null = null;
    const measure = () => {
      const rect = bar?.getBoundingClientRect();
      let clearance = rect && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0 ? Math.ceil(window.innerHeight - rect.top) : 0;
      const floating = floatingTrigger.current; const actionRect = action?.getBoundingClientRect();
      if (floating && actionRect && actionRect.height > 0) {
        const fab = floating.getBoundingClientRect(); const style = getComputedStyle(floating);
        // Recover the unshifted 20px + safe-area gap from the committed styles.
        // Using the already-shifted box would alternate between clear and overlap.
        const gap = parseFloat(style.bottom) - parseFloat(style.getPropertyValue("--assistant-clearance"));
        const bottom = window.innerHeight - gap - clearance;
        if (fab.height > 0 && fab.left < actionRect.right && fab.right > actionRect.left && bottom > actionRect.top && bottom - fab.height < actionRect.bottom) clearance = Math.max(clearance, Math.ceil(window.innerHeight - actionRect.top));
      }
      setSaveBarClearance(clearance);
    };
    const resize = new ResizeObserver(measure);
    if (floatingTrigger.current) resize.observe(floatingTrigger.current);
    const bind = () => {
      setEditorSlot(main.querySelector<HTMLElement>("[data-project-assistant]"));
      const next = main.querySelector<HTMLElement>(".project-save-bar, [data-assistant-clearance]:not([data-assistant-clearance='overlap'])");
      const nextAction = main.querySelector<HTMLElement>("[data-assistant-clearance='overlap']");
      if (next === bar && nextAction === action) return;
      resize.disconnect(); bar = next; action = nextAction;
      if (bar) resize.observe(bar); if (action) resize.observe(action); if (floatingTrigger.current) resize.observe(floatingTrigger.current); measure();
    };
    const changes = new MutationObserver(bind); changes.observe(main, { childList: true, subtree: true }); bind();
    window.addEventListener("scroll", measure, { passive: true, capture: true }); window.addEventListener("resize", measure, { passive: true });
    return () => { changes.disconnect(); resize.disconnect(); window.removeEventListener("scroll", measure, true); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => { if (open) { shown.current = true; dialog.current?.showModal(); } else { contextPopover.current?.hidePopover(); dialog.current?.close(); if (shown.current) (opener.current?.isConnected && opener.current.getClientRects().length ? opener.current : trigger.current?.getClientRects().length ? trigger.current : floatingTrigger.current)?.focus(); } }, [open]);
  useEffect(() => { if (open && !config && !loading) void loadConfig(); }, [open]);
  useEffect(() => { if (open && config && tab === "chat") (mode === "fake" ? composer.current : goldenInput.current)?.focus({ preventScroll: true }); }, [open, config, mode]);
  function contextSaved(next: Context, value = config) {
    setContext(next); const key = (Object.keys(contextLabels) as ContextKind[]).find(key => next[key]); setContextKind(key ?? "project_id"); setContextId(key ? next[key]! : ""); setMonth(next.month?.slice(0, 7) ?? ""); setVisibility(next.visibility ?? "draft");
    if (value) try { sessionStorage.setItem(`hub-assistant-context:${value.session_key}`, JSON.stringify(next)); } catch { /* Context still remains available in this mounted session. */ }
  }
  async function loadConfig() {
    setLoading(true); setError("");
    try { const value = await request<Config>(`${base}/config`); setConfig(value); setGolden(value.live_questions[0]?.id ?? ""); let next = pageContext(); try { const stored = sessionStorage.getItem(`hub-assistant-context:${value.session_key}`); if (stored != null) next = cleanContext(JSON.parse(stored)); } catch { /* Invalid storage never becomes a request context. */ } contextSaved(next, value); }
    catch (error) { setError(messageOf(error)); } finally { setLoading(false); }
  }
  function toggle(next: boolean, source?: HTMLElement) {
    if (next && source) { opener.current = source; setTab("chat"); }
    if (!next) stop(); setOpen(next); const url = new URL(window.location.href); if (next) url.searchParams.set("assistant", "open"); else url.searchParams.delete("assistant"); window.history.replaceState(window.history.state, "", url);
  }
  function closeContext() { contextPopover.current?.hidePopover(); contextButton.current?.focus(); }
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
  const quickQuestions = ["โครงการนี้พร้อมเผยแพร่หรือยัง", "งบโฆษณาของโครงการนี้เดือนนี้", "อธิบายชื่อแคมเปญนี้", "โครงการนี้มีโปรโมชันอะไร"];
  const draftAllowed = Boolean(config && (config.proposal_fields.project?.length || config.proposal_fields.brand?.length));
  const draftContextAllowed = Boolean(config && (context.project_id ? config.proposal_fields.project?.length : context.brand_id ? config.proposal_fields.brand?.length : false));
  const icon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" aria-hidden="true"><path d="M4 4h16v13H9l-5 4V4zM8 8h8M8 12h5" /></svg>;
  return <>
    {navigationTarget && createPortal(<button ref={trigger} className="nav-link assistant-trigger" type="button" aria-haspopup="dialog" onClick={event => toggle(true, onNavigationOpen() ?? event.currentTarget)}>{icon}<span>ผู้ช่วย Hub</span></button>, navigationTarget)}
    {editorSlot ? createPortal(<button ref={floatingTrigger} className="button secondary assistant-editor-trigger" type="button" aria-haspopup="dialog" onClick={event => toggle(true, event.currentTarget)}>{icon}<span>ถามผู้ช่วย</span></button>, editorSlot) : <button ref={floatingTrigger} className="button primary assistant-floating" style={{ "--assistant-clearance": `${saveBarClearance}px`, bottom: "calc(20px + var(--assistant-clearance) + env(safe-area-inset-bottom))" } as CSSProperties} type="button" aria-haspopup="dialog" hidden={open} onClick={event => toggle(true, event.currentTarget)}>{icon}<span>ถามผู้ช่วย</span></button>}
    <dialog ref={dialog} className="action-dialog assistant-panel" aria-labelledby="assistant-title" onCancel={event => { event.preventDefault(); toggle(false); }}>
      <header className="assistant-header">
        <div className="assistant-heading"><h2 id="assistant-title">ผู้ช่วย Hub</h2><button className="button secondary assistant-close" type="button" onClick={() => toggle(false)}>ปิดผู้ช่วย</button></div>
        <div className="assistant-header-controls">
          {config && <div className="assistant-mode-field"><label htmlFor="assistant-mode">วิธีตอบคำถาม</label><select id="assistant-mode" value={mode} disabled={busy} onChange={event => setMode(event.target.value as typeof mode)}><option value="fake">จำลองในเครื่อง</option><option value="live" disabled={!config.live_available}>โมเดลจริง · ข้อมูลสมมติ</option></select></div>}
          <button ref={contextButton} type="button" className="button secondary assistant-context-trigger" popoverTarget={contextPopoverId} aria-haspopup="dialog" aria-label="เปลี่ยนบริบทอย่างชัดเจน" disabled={!config} title={contextText || "ยังไม่เลือกบริบท"}><span>{contextText || "เลือกบริบท"}</span><span aria-hidden="true">⌄</span></button>
        </div>
        <div className="assistant-tabs" role="tablist" aria-label="งานผู้ช่วย" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); const next = event.key === "Home" ? "chat" : event.key === "End" ? "draft" : tab === "chat" ? "draft" : "chat";
          setTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`#assistant-tab-${next}`)?.focus();
        }}>
          <button id="assistant-tab-chat" type="button" role="tab" aria-selected={tab === "chat"} aria-controls="assistant-chat" tabIndex={tab === "chat" ? 0 : -1} onClick={() => setTab("chat")}>แชท</button>
          <button id="assistant-tab-draft" type="button" role="tab" aria-selected={tab === "draft"} aria-controls="assistant-draft" tabIndex={tab === "draft" ? 0 : -1} onClick={() => setTab("draft")}>เสนอแก้ร่าง</button>
        </div>
      </header>
      <div className="assistant-scroll">
        <details className="assistant-about"><summary>เกี่ยวกับผู้ช่วยนี้</summary><div className="assistant-note"><p>ผู้ช่วยภายในสำหรับทีมงาน · อ่านข้อมูลตามสิทธิ์ของบัญชีนี้</p><p><strong>{mode === "fake" ? "โหมดจำลองในเครื่อง · ไม่ได้เรียกโมเดลจริง" : "โมเดลจริง · ใช้เฉพาะคำถามและข้อมูลสมมติที่ระบบกำหนด"}</strong></p>{config && <p>{config.message_th}</p>}<p>คำตอบตัวเลขใช้ข้อมูลจากเครื่องมือ ข้อมูลที่ยังยืนยันไม่ได้จะไม่แทนด้วยศูนย์</p><div className="assistant-questions">{["Q36", "Q38", "Q42", "Q43", "Q44"].map(id => <PendingQuestion key={id} id={id} />)}</div></div></details>
        {loading && <p role="status" className="hub-loading">กำลังตรวจการตั้งค่าผู้ช่วย…</p>}
        {error && <div role="alert" className="notice error"><p>{error}</p><button className="button secondary" onClick={() => void loadConfig()}>ลองโหลดผู้ช่วยอีกครั้ง</button></div>}
        <section id="assistant-chat" role="tabpanel" aria-labelledby="assistant-tab-chat" hidden={tab !== "chat"}>
          {config && !turns.length && <div className="assistant-empty"><h3>วันนี้ให้ช่วยเรื่องอะไร</h3><p>ถามจากบริบทที่เลือก พร้อมตรวจแหล่งข้อมูลตามสิทธิ์</p>{mode === "fake" ? <div className="assistant-quick-questions" aria-label="ตัวอย่างคำถาม">{quickQuestions.map(text => <button key={text} className="button secondary" type="button" onClick={() => { setQuestion(text); composer.current?.focus({ preventScroll: true }); }}>{text}</button>)}</div> : <p>เลือกคำถามข้อมูลสมมติที่อนุญาตด้านล่างเพื่อเริ่มต้น</p>}</div>}
          <div aria-label="บทสนทนาผู้ช่วย">{turns.map(turn => <article key={turn.key} className="assistant-turn"><h3>คุณ: {turn.question}</h3><p className="assistant-meta">{turn.mode === "fake" ? "คำตอบจากโหมดจำลองในเครื่อง" : "คำตอบจากโมเดลจริงด้วยข้อมูลสมมติ"}</p>{turn.blocks.map(block => <section key={block.id} className="assistant-answer-block"><p className="assistant-answer">{block.text}</p><MetadataView value={block.metadata} />{turn.run_id && <div className="assistant-citations">{turn.citations.filter(citation => block.citation_ids.includes(citation.id)).map(citation => <CitationButton key={citation.id} citation={citation} run={turn.run_id!} />)}</div>}</section>)}{turn.error && <p role="alert" className="notice error">{turn.error}</p>}{!turn.blocks.length && turn.status !== "RUNNING" && !turn.error && <p>ยังไม่มีข้อมูลที่ยืนยันได้สำหรับคำถามนี้</p>}</article>)}</div>
          <div ref={latest} tabIndex={-1} />
        </section>
        <section id="assistant-draft" role="tabpanel" aria-labelledby="assistant-tab-draft" hidden={tab !== "draft"}>
          {config && (draftContextAllowed ? <DraftProposal key={JSON.stringify(context)} context={context} config={config} /> : <div className="assistant-empty"><h3>เสนอแก้ข้อความฉบับร่าง</h3><p>{draftAllowed ? "เลือกบริบทโครงการหรือแบรนด์ที่มีสิทธิ์แก้ไข เพื่อดูข้อเสนอและตรวจความแตกต่างก่อนยืนยัน" : "บัญชีนี้ไม่มีสิทธิ์เสนอแก้ข้อความฉบับร่าง อ่านข้อมูลผ่านแชทได้ตามสิทธิ์เดิม"}</p>{draftAllowed && <button className="button secondary" type="button" onClick={() => contextPopover.current?.showPopover()}>เลือกบริบทสำหรับร่าง</button>}</div>)}
        </section>
      </div>
      <footer className="assistant-footer" hidden={tab !== "chat"}>
        <div className="assistant-run-status"><p role="status" aria-live="polite">{status}</p>{turns.length > 0 && <button className="assistant-latest" type="button" onClick={() => { latest.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); latest.current?.focus({ preventScroll: true }); }}>ไปยังคำตอบล่าสุด</button>}</div>
        {config && <form className="assistant-composer" onSubmit={ask}>
          {mode === "fake" ? <div className="form-field"><label htmlFor="assistant-question">คำถามสำหรับโหมดจำลองในเครื่อง</label><textarea ref={composer} id="assistant-question" rows={2} value={question} maxLength={2000} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={busy} required aria-describedby="assistant-composer-help" /><p id="assistant-composer-help" className="field-help">Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่ · ข้อความอยู่ในเครื่อง</p></div> : <div className="form-field"><label htmlFor="assistant-golden">คำถามข้อมูลสมมติที่อนุญาต</label><select ref={goldenInput} id="assistant-golden" value={golden} disabled={busy} onChange={event => setGolden(event.target.value)} aria-describedby="assistant-composer-help">{config.live_questions.map(item => <option key={item.id} value={item.id}>{item.label_th}</option>)}</select><p id="assistant-composer-help" className="field-help">ใช้คำถามสมมติที่กำหนดเท่านั้น ไม่ส่งข้อความหรือบริบทที่เลือก</p></div>}
          <div className="assistant-actions"><button className="button primary" type="submit" disabled={busy || mode === "fake" && !question.trim() || mode === "live" && (!golden || !config.live_available)} aria-busy={busy}>ส่งคำถาม</button>{busy && <button className="button secondary" type="button" onClick={stop}>หยุดการตอบ</button>}</div>
        </form>}
      </footer>
      <div ref={contextPopover} id={contextPopoverId} className="question-popover assistant-context-popover" popover="auto" role="dialog" aria-labelledby="assistant-context-title" onToggle={event => { if (event.newState === "open") contextHeading.current?.focus(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeContext(); } }}>
        <div className="assistant-heading"><h2 ref={contextHeading} tabIndex={-1} id="assistant-context-title">บริบทผู้ช่วย</h2><button className="button secondary" type="button" onClick={closeContext}>ปิดบริบท</button></div>
        <p><strong>บริบทที่เลือก:</strong> {contextText || "ยังไม่เลือกบริบท"}{context.month && ` · เดือน ${context.month}`}</p><p>คงบริบทนี้ไว้จนกว่าจะเปลี่ยนเอง การเปลี่ยนหน้าไม่เปลี่ยนโครงการในบทสนทนา</p>
        <form onSubmit={event => { event.preventDefault(); contextSaved(contextId.trim() ? { [contextKind]: contextId.trim(), ...(month ? { month: `${month}-01` } : {}), visibility } : {}); closeContext(); }}>
          <div className="assistant-fields"><div className="form-field"><label htmlFor="assistant-context-kind">ประเภทบริบท</label><select id="assistant-context-kind" value={contextKind} onChange={event => setContextKind(event.target.value as ContextKind)} disabled={busy}>{availableKinds.map(kind => <option key={kind} value={kind}>{contextLabels[kind]}</option>)}</select></div><div className="form-field"><label htmlFor="assistant-context-id">รหัสบริบทตามต้นทาง</label><input id="assistant-context-id" value={contextId} maxLength={128} disabled={busy} onChange={event => setContextId(event.target.value)} /></div><div className="form-field"><label htmlFor="assistant-context-month">เดือนตามเวลาประเทศไทย</label><input id="assistant-context-month" type="month" value={month} disabled={busy} onChange={event => setMonth(event.target.value)} /></div><div className="form-field"><label htmlFor="assistant-context-version">ฉบับข้อมูลที่ต้องการ</label><select id="assistant-context-version" value={visibility} disabled={busy} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="draft">ฉบับร่าง</option><option value="published">ฉบับเผยแพร่</option></select></div></div>
          <div className="assistant-actions"><button className="button secondary" disabled={busy} type="submit">ใช้บริบทนี้</button><button className="button secondary" type="button" disabled={busy} onClick={() => { contextSaved(pageContext()); closeContext(); }}>ใช้บริบทของหน้าปัจจุบัน</button><button className="button secondary" type="button" disabled={busy} onClick={() => { contextSaved({}); closeContext(); }}>ล้างบริบท</button></div>
        </form>
      </div>
    </dialog>
  </>;
}
