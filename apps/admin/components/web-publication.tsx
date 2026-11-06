"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHubPermissions } from "./accounts";
import { ContentWorkflow } from "./content-workflow";
import { workspaceText } from "@/lib/unified-workspace";
import { workflowText } from "@/lib/content-workflow";
import { request } from "./hub-request";
import { errorMessage } from "./content-common";
import { useContentLocation, dateTime } from "./content-operations-shared";
import "./web-publication.css";

type Config = { url: string; locales: string[]; ai_policy: string; max_faq_items: number; project_ids: string[] };
type Page = Config & { id: string; page_key: string; revision: number; published_version_id: string | null };
type Publication = { id: string; state: string; reason: string; digest: string; created_at: string; page_count: number };
type Workspace = { pages: Page[]; publications: Publication[]; can_publish: boolean };
type Preview = { page_key: string; content: unknown; faq: unknown[]; hidden: unknown[]; is_fallback_locale: boolean };
type ReviewedPage = { previous_redacted?: boolean; preview_redacted?: boolean; page_key: string; html: string; preview: Preview; previous: Preview | null; issues: { code: string; field_key?: string; label?: { th?: string } }[]; resolved_phases: string[]; resolved_applicability: { question_key: string; rem_project_ids: string[] }[] };
type Review = Publication & { can_publish: boolean; pages: ReviewedPage[] };
type Version = { id: string; version_no: number; published_at: string; change_reason: string };
const empty: Config = { url: "/", locales: ["th", "en"], ai_policy: "no_ai", max_faq_items: 20, project_ids: [] };
const states: Record<string, string> = { IN_REVIEW: "รอเผยแพร่", PUBLISHED: "เผยแพร่แล้ว", RETURNED: "ส่งกลับ" };
const issueLabels: Record<string, string> = { required_field: "ข้อมูลที่จำเป็นยังไม่ครบ", faq_conflict_or_lint: "คำตอบ FAQ ซ้ำหรือไม่ผ่านการตรวจ", faq_not_submitted: "FAQ ยังไม่ส่งตรวจ", section_not_submitted: "เนื้อหายังไม่ส่งตรวจ", article_not_approved: "บทความยังไม่อนุมัติ", article_reference_unavailable: "เนื้อหาที่บทความอ้างอิงไม่พร้อม", faq_applicability_changed: "รายชื่อเฟสที่ใช้คำตอบเปลี่ยนแล้ว" };

function changes(before: unknown, after: unknown, path = ""): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [path || "เนื้อหาทั้งหน้า"];
  const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => changes(left[key], right[key], path ? `${path}.${key}` : key));
}

export function WebPublication({ onEditingChange, configurationOnly = false }: { onEditingChange: (value: boolean) => void; configurationOnly?: boolean }) {
  const permissions = useHubPermissions(), canEdit = permissions.can("knowledge", "edit");
  const authority = JSON.stringify(permissions.capabilities);
  const [workspace, setWorkspace] = useState<Workspace | null>(null), [review, setReview] = useState<Review | null>(null);
  const [draft, setDraft] = useState<Config | null>(null), [key, setKey] = useState(""), [revision, setRevision] = useState(0);
  const form = useRef<HTMLFormElement>(null), opened = useRef("");
  const [draftId, setDraftId] = useState<string | null>(null), [workflowOwners, setWorkflowOwners] = useState<Set<string>>(() => new Set());
  const workflowBusy = workflowOwners.size > 0;
  const workflowEditing = (key: string, value: boolean) => setWorkflowOwners(owners => { if (owners.has(key) === value) return owners; const next = new Set(owners); if (value) next.add(key); else next.delete(key); return next; });
  const [reason, setReason] = useState(""), [locale, setLocale] = useState("th"), [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [historyPage, setHistoryPage] = useState<Page | null>(null), [history, setHistory] = useState<Version[]>([]), [target, setTarget] = useState<Version | null>(null);
  const [versionHtml, setVersionHtml] = useState("");
  const location = useContentLocation(!!draft || pending || workflowBusy), selected = location.params.get("publication");
  const reload = useCallback(async () => setWorkspace(await request<Workspace>("v1/admin/web")), []);
  useEffect(() => { onEditingChange(!!draft || pending || workflowBusy); return () => onEditingChange(false); }, [draft, pending, workflowBusy, onEditingChange]);
  useEffect(() => { let active = true; setReview(null); setHistory([]); setVersionHtml("");
    request<Workspace>("v1/admin/web").then(value => { if (active) setWorkspace(value); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [authority]);
  useEffect(() => { let active = true; setReview(null); setConfirmed(false);
    if (selected && !configurationOnly) request<Review>(`v1/admin/web/publications/${selected}?locale=${locale}`).then(value => { if (active) setReview(value); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [selected, locale, authority, configurationOnly]);
  async function action(work: () => Promise<void>) { if (pending || workflowBusy) return; setPending(true); setError(""); setNotice(""); try { await work(); } catch (error) { setError(errorMessage(error)); } finally { setPending(false); } }
  function edit(page?: Page) { if (!canEdit || pending || workflowBusy) return; setDraftId(page?.id ?? null); setKey(page?.page_key ?? ""); setRevision(page?.revision ?? 0); setDraft(page ? { url: page.url, locales: page.locales, ai_policy: page.ai_policy, max_faq_items: page.max_faq_items, project_ids: page.project_ids } : structuredClone(empty)); }
  const requestedPage = location.params.get("page"), requestedItem = location.params.get("item"), requestedField = location.params.get("field");
  useEffect(() => {
    if (!workspace || draft || !canEdit || !(requestedPage || requestedItem)) return;
    const token = `${requestedPage ?? ""}:${requestedItem ?? ""}`;
    if (opened.current === token) return;
    const page = workspace.pages.find(page => (!requestedPage || page.page_key === requestedPage) && (!requestedItem || page.id === requestedItem));
    if (page) { opened.current = token; edit(page); }
  }, [workspace, requestedPage, requestedItem, draft, canEdit]);
  useEffect(() => { if (draft && requestedField === "page.url") form.current?.querySelector<HTMLInputElement>('[data-workspace-field="page.url"]')?.focus(); }, [Boolean(draft), requestedField]);
  const missing = review?.pages.reduce((sum, page) => sum + page.issues.length, 0) ?? 0;
  return <section className="content-section web-publication" aria-label="เผยแพร่เว็บไซต์">
    <header className="content-toolbar"><div><h2>{configurationOnly ? workspaceText.settings : "เผยแพร่เว็บไซต์"}</h2>{!configurationOnly && <p>เตรียมทุกหน้าที่เปลี่ยน แล้วให้ผู้มีสิทธิ์อีกคนตรวจและเผยแพร่พร้อมกัน</p>}</div>{canEdit && !draft && <button className="button secondary" disabled={pending || workflowBusy} onClick={() => edit()}>ลงทะเบียนหน้าเว็บ</button>}</header>
    {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {!workspace && !error && <p role="status">กำลังโหลดรายการหน้าเว็บ…</p>}
    {draft && <form ref={form} inert={workflowBusy} className="content-card" onSubmit={event => { event.preventDefault(); void action(async () => { await request(`v1/admin/web/pages/${key}`, "PUT", { expected_revision: revision, config: draft }); setDraft(null); await reload(); setNotice("บันทึกหน้าเว็บแล้ว ยังไม่เผยแพร่"); }); }}>
      <h3>{revision ? "ตั้งค่าหน้าเว็บ" : "หน้าเว็บใหม่"}</h3>
      <label className="content-input">รหัสหน้าเว็บ<input value={key} disabled={revision > 0 || !canEdit || pending} required pattern="(project|brand|programme|corporate|article|location):[A-Za-z0-9][A-Za-z0-9_\-]{0,127}" onChange={e => setKey(e.target.value)} /><small>เช่น project:รหัสสาธารณะ หรือ article:ชื่อบทความในที่อยู่เว็บ</small></label>
      <label className="content-input">ที่อยู่หน้าเว็บ<input data-workspace-field="page.url" value={draft.url} required maxLength={500} disabled={!canEdit || pending} onChange={e => setDraft({ ...draft, url: e.target.value })} /></label>
      {key.startsWith("project:") && <label className="content-input">รหัสสาธารณะของแต่ละเฟส<textarea value={draft.project_ids.join("\n")} disabled={!canEdit || pending} onChange={e => setDraft({ ...draft, project_ids: e.target.value.split(/\s+/).filter(Boolean) })} /><small>หนึ่งรหัสต่อบรรทัด แต่ละเฟสแสดงข้อเท็จจริงและข้อกำหนดแยกกัน</small></label>}
      <label className="content-input">การใช้เนื้อหาโดย AI<select value={draft.ai_policy} disabled={!canEdit || pending} onChange={e => setDraft({ ...draft, ai_policy: e.target.value })}><option value="no_ai">ไม่อนุญาต AI</option><option value="search_only">อนุญาตค้นหาเท่านั้น</option><option value="open">อนุญาตเนื้อหาที่เปิดเผย</option></select></label>
      <label className="content-input">จำนวน FAQ สูงสุด<input type="number" min={0} max={100} value={draft.max_faq_items} disabled={!canEdit || pending} onChange={e => setDraft({ ...draft, max_faq_items: Number(e.target.value) })} /></label>
      <label><input type="checkbox" checked={draft.locales.includes("en")} disabled={!canEdit || pending} onChange={e => setDraft({ ...draft, locales: e.target.checked ? ["th", "en"] : ["th"] })} />มีภาษาอังกฤษ</label>
      <div className="content-actions"><button className="button primary" disabled={!canEdit || pending}>บันทึกหน้าเว็บ</button><button className="button secondary" type="button" disabled={pending} onClick={() => { if (window.confirm("ละทิ้งการตั้งค่าที่ยังไม่บันทึกหรือไม่")) setDraft(null); }}>ยกเลิก</button></div>
    </form>}
    {draft && draftId && <ContentWorkflow target={{ kind: "page_config", identity: { id: draftId } }} label={key} revision={revision} disabled={pending || workflowOwners.size > 0 && !workflowOwners.has("page:" + draftId)} draft={{ dirty: true, valid: canEdit && Boolean(draft.url), sourceStamp: { revision }, getChanges: () => form.current?.reportValidity() ? { ...draft } : null }} onEditingChange={value => workflowEditing("page:" + draftId, value)} onChanged={async () => { await reload(); setDraft(null); }} onReload={async () => { await reload(); setDraft(null); }} />}
    {workspace && !draft && <><div className="content-card-list">{workspace.pages.map(page => <article className="content-card" key={page.page_key} data-workspace-item={page.id} tabIndex={-1}><h3>{page.page_key}</h3><p>{page.url} · {page.published_version_id ? "มีฉบับเผยแพร่" : "ยังไม่เผยแพร่"}</p><div className="content-actions">{canEdit && <button className="button secondary" disabled={pending || workflowBusy} onClick={() => edit(page)}>ตั้งค่า {page.page_key}</button>}{!configurationOnly && <button className="button secondary" disabled={pending} onClick={() => void action(async () => { location.navigate({ publication: null }); setReview(null); setHistoryPage(page); setTarget(null); setVersionHtml(""); setConfirmed(false); setHistory(await request<Version[]>(`v1/admin/web/pages/${page.page_key}/history`)); })}>ประวัติ {page.page_key}</button>}</div><ContentWorkflow target={page.id ? { kind: "page_config", identity: { id: page.id } } : null} label={page.page_key} revision={page.revision} disabled={pending || workflowOwners.size > 0 && !workflowOwners.has("page:" + page.id)} onEditingChange={value => workflowEditing("page:" + page.id, value)} onChanged={reload} onReload={reload} /></article>)}</div>
      {!workspace.pages.length && <p className="content-empty">ยังไม่มีหน้าเว็บ ลงทะเบียนหน้าโดยใช้ข้อมูลที่เตรียมไว้ใน Hub</p>}
      {!configurationOnly && <>
      <label className="content-input">เหตุผลการเผยแพร่หรือเปลี่ยนฉบับ<textarea value={reason} maxLength={2000} disabled={pending} onChange={e => { setReason(e.target.value); setConfirmed(false); }} /></label>
      {canEdit && <button className="button primary" disabled={pending || !reason.trim() || !workspace.pages.length} onClick={() => void action(async () => { const result = await request<{ id: string }>("v1/admin/web/publications", "POST", { reason }); await reload(); location.navigate({ publication: result.id }, true); setNotice("เตรียมชุดตรวจแล้ว ยังไม่เผยแพร่"); })}>เตรียมชุดตรวจทุกหน้าที่เปลี่ยน</button>}
      <div className="content-card-list">{workspace.publications.map(item => <article className="content-card" key={item.id}><h3>{item.reason}</h3><p>{states[item.state]} · {item.page_count} หน้า · {dateTime(item.created_at)}</p><button className="button secondary" disabled={pending} onClick={() => { setHistoryPage(null); location.navigate({ publication: item.id }); }}>ตรวจชุดเผยแพร่ {item.reason}</button></article>)}</div>
      </>}
    </>}
    {!configurationOnly && review && !draft && <section aria-label="ตรวจชุดเผยแพร่" className="content-card"><h3>{review.reason}</h3><p>{states[review.state]} · {review.pages.length} หน้า{missing > 0 && ` · มีรายการต้องแก้ ${missing} รายการ`}</p>
      <label className="content-input">ภาษาตัวอย่าง<select value={locale} onChange={e => setLocale(e.target.value)}><option value="th">ไทย</option><option value="en">อังกฤษ</option></select></label>
      {review.pages.map(page => <article className="web-reviewed-page" key={page.page_key}><h4>{page.page_key}</h4>{page.resolved_phases.length > 0 && <p>เฟสที่ตรวจ: {page.resolved_phases.join(", ")}</p>}{page.preview.is_fallback_locale && <p className="notice warning">บางเนื้อหาใช้ภาษาไทยทดแทน</p>}
        {page.resolved_applicability.length > 0 && <details><summary>รายชื่อเฟส REM ที่ใช้ FAQ</summary><ul>{page.resolved_applicability.map(item => <li key={item.question_key}>{item.question_key}: {item.rem_project_ids.join(", ")}</li>)}</ul></details>}
        {page.issues.length > 0 && <ul>{page.issues.map((issue, i) => <li key={i}>{issueLabels[issue.code] ?? "เนื้อหาไม่พร้อมเผยแพร่"}{issue.label?.th ? ` · ${issue.label.th}` : issue.field_key ? ` · ${issue.field_key}` : ""}</li>)}</ul>}
        {page.previous_redacted && <p role="status">{workflowText.before} / {workflowText.permission_required}</p>}
        {page.preview_redacted ? <p role="status">{workflowText.after} / {workflowText.permission_required}</p> : <>
          <details><summary>{workflowText.before} / {workflowText.after}</summary>
            {!page.previous_redacted && <ul>{changes(page.previous?.content, page.preview.content).map(path => <li key={path}>{path}</li>)}</ul>}
            <div className="web-diff">{!page.previous_redacted && <pre aria-label={workflowText.before}>{JSON.stringify(page.previous?.content ?? null, null, 2)}</pre>}<pre aria-label={workflowText.after}>{JSON.stringify(page.preview.content, null, 2)}</pre></div>
          </details><div className="web-html-preview" dangerouslySetInnerHTML={{ __html: page.html }} />
        </>}</article>)}
      {review.state === "IN_REVIEW" && <><label><input type="checkbox" checked={confirmed} disabled={pending || !review.can_publish || missing > 0} onChange={e => setConfirmed(e.target.checked)} />ตรวจทุกหน้าและรายชื่อเฟสแล้ว ยืนยันเผยแพร่ชุดนี้</label><p>ผู้จัดทำเนื้อหาและผู้เตรียมชุดตรวจเผยแพร่ชุดของตนเองไม่ได้ ต้องมีสิทธิ์อนุมัติข้อมูลต้นทางและสิทธิ์เผยแพร่ขึ้นเว็บ</p><button className="button primary" disabled={pending || !review.can_publish || missing > 0 || !confirmed} onClick={() => void action(async () => { await request(`v1/admin/web/publications/${review.id}/publish`, "POST", { expected_digest: review.digest }); setReview(await request<Review>(`v1/admin/web/publications/${review.id}?locale=${locale}`)); setConfirmed(false); await reload(); setNotice("เผยแพร่ทุกหน้าในชุดแล้ว"); })}>เผยแพร่ขึ้นเว็บ</button></>}
    </section>}
    {!configurationOnly && historyPage && !draft && <section className="content-card" aria-label="ประวัติหน้าเว็บ"><h3>ประวัติ {historyPage.page_key}</h3>{!history.length && <p>ยังไม่มีฉบับเผยแพร่</p>}{history.map(version => <p key={version.id}><button className="button secondary" disabled={pending} onClick={() => void action(async () => { const result = await request<{ html: string }>(`v1/admin/web/pages/${historyPage.page_key}/versions/${version.id}?locale=${locale}`); setTarget(version); setVersionHtml(result.html); setConfirmed(false); })}>ตรวจฉบับ {version.version_no}</button> {version.change_reason} · {dateTime(version.published_at)}</p>)}
      {versionHtml && <div className="web-html-preview" dangerouslySetInnerHTML={{ __html: versionHtml }} />}
      {workspace?.can_publish && <><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />ตรวจฉบับและเหตุผลก่อนเปลี่ยนการเผยแพร่แล้ว</label><div className="content-actions">{historyPage.published_version_id && <button className="button secondary" disabled={pending || !confirmed || !reason.trim()} onClick={() => void action(async () => { await request(`v1/admin/web/pages/${historyPage.page_key}/pointer`, "POST", { expected_version_id: historyPage.published_version_id, target_version_id: null, reason }); setHistoryPage(null); await reload(); setNotice("ถอนหน้าเว็บแล้ว"); })}>ถอนหน้าเว็บ</button>}{target && <button className="button primary" disabled={pending || !confirmed || !reason.trim()} onClick={() => void action(async () => { await request(`v1/admin/web/pages/${historyPage.page_key}/pointer`, "POST", { expected_version_id: historyPage.published_version_id, target_version_id: target.id, reason }); setHistoryPage(null); await reload(); setNotice("เปลี่ยนเป็นฉบับที่ตรวจแล้ว"); })}>ใช้ฉบับ {target.version_no}</button>}</div></>}
    </section>}
  </section>;
}
