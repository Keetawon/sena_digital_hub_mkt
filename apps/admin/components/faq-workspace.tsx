"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActorName, useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { workspaceApi, workspaceHref, workspaceName, workspaceText, type WorkspaceLevel, type WorkspaceTarget } from "@/lib/unified-workspace";
import { ContentWorkflow } from "./content-workflow";
import { ExposureChip } from "./content-exposure";
import { request } from "./hub-request";
import { useContentLocation } from "./content-operations-shared";
import { ContentContacts, type Contact } from "./content-contacts";
import { FaqBank, FaqGlossary, kindLabels, scopeLabels, type QuestionBank } from "./faq-bank";
import { FaqIntake, holdLabels, stateLabels as intakeStateLabels } from "./faq-intake";
import { FaqCoverage } from "./faq-coverage";
import { WebPublication } from "./web-publication";
import { FaqApplicability, type FaqRule } from "./faq-applicability";
import { stateLabel } from "./content-narrative";
import { BilingualInput, ExposureInput, TranslationReviewPanel, useFieldCatalog, contentDate, errorMessage, type Exposure, type Locales, type Translation } from "./content-common";

type Reference = { id: string; name: string; project_id?: string };
type References = { projects: Reference[]; brands: Reference[]; groups: Reference[]; unit_types: Reference[] };
type FaqVersion = { version_no: number; question: Locales; alt_questions: Locales; short_answer: Locales; detail: Locales; answer_kind: string; fact_keys: string[]; applies_to_project_ids: string[]; applicability_rule: FaqRule; review_due: string | null; effective_to: string | null; state: string; ai_exposure: Exposure; created_at: string; editors?: string[]; approved_by?: string | null };
type Faq = { id: string; question_key: string | null; scope_type: string; scope_id: string; revision: number; state: string; question?: Locales; short_answer?: Locales; version: FaqVersion; history: FaqVersion[]; sources: { id: string; source_ref: string; source_url: string | null; decided_at: string }[]; translations: Translation[] };
type Draft = { question_key: string; scope_type: string; scope_id: string; question: Locales; alt_questions: Locales; short_answer: Locales; detail: Locales; answer_kind: string; fact_keys: string[]; applies_to_project_ids: string[]; applicability_rule: FaqRule; review_due: string; effective_to: string; ai_exposure: Exposure; source_ref: string; source_url: string };
const emptyDraft: Draft = { question_key: "", scope_type: "corporate", scope_id: "sena", question: {}, alt_questions: {}, short_answer: {}, detail: {}, answer_kind: "text", fact_keys: [], applies_to_project_ids: [], applicability_rule: {}, review_due: "", effective_to: "", ai_exposure: "open", source_ref: "", source_url: "" };
const tabs = { coverage: "ความครบ", drafts: "คำตอบ FAQ", intake: "คัดจากของเดิม", bank: "คำถามมาตรฐาน", glossary: "คำแปลมาตรฐาน", contacts: "ติดต่อองค์กร", publication: "เผยแพร่เว็บไซต์" };
const editTabs = { answer: "คำตอบและขอบเขต", english: "ภาษาอังกฤษ", sources: "แหล่งข้อมูล", preview: "ตัวอย่างบนเว็บไซต์", history: "ประวัติ" };
function locales(value: Locales | unknown): Locales {
  if (Array.isArray(value)) return { th: value.map(item => typeof item === "string" ? item : item.th ?? "").join("\n") };
  return value && typeof value === "object" ? value as Locales : {};
}
export type FixedFaqScope = { type: string; id: string; name?: string };
export type FaqEntityContext = { level: WorkspaceLevel; id: string; phase?: string | null };
export function FaqWorkspace({ embedded = false, scope, entity, initialSection, onEditingChange, onWorkflowChanged }: { embedded?: boolean; scope?: FixedFaqScope; entity?: FaqEntityContext; initialSection?: "contacts" | "bank" | "glossary"; onEditingChange?: (value: boolean) => void; onWorkflowChanged?: () => void } = {}) {
  const permissions = useHubPermissions(), canEdit = permissions.can("knowledge", "edit");
  const { catalog, error: catalogError } = useFieldCatalog();
  const [bank, setBank] = useState<QuestionBank | null>(null), [references, setReferences] = useState<References | null>(null);
  const [items, setItems] = useState<Faq[]>([]), [contacts, setContacts] = useState<Contact[]>([]);
  const [current, setCurrent] = useState<Faq | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [search, setSearch] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [workflowOwners, setWorkflowOwners] = useState<Set<string>>(() => new Set()), [draftRevision, setDraftRevision] = useState(0);
  const workflowBusy = workflowOwners.size > 0;
  const frozen = current?.state.toUpperCase() === "IN_REVIEW";
  const workflowEditing = (key: string, value: boolean) => setWorkflowOwners(owners => { if (owners.has(key) === value) return owners; const next = new Set(owners); if (value) next.add(key); else next.delete(key); return next; });
  const [editTab, setEditTab] = useState<keyof typeof editTabs>("answer"), [previewLocale, setPreviewLocale] = useState<"th" | "en">("th");
  const location = useContentLocation(editing || dirty || pending || workflowBusy, !embedded);
  const tabKeyQuery = embedded ? "faq_section" : "tab";
  const questionKey = location.params.get("question");
  const clusterId = embedded ? location.params.get("cluster") : null;
  useEffect(() => { onEditingChange?.(editing || dirty || pending || workflowBusy); return () => onEditingChange?.(false); }, [editing, dirty, pending, workflowBusy, onEditingChange]);
  const queryTab = location.params.get(tabKeyQuery) as keyof typeof tabs, tab = initialSection ?? (clusterId ? "intake" : queryTab in tabs ? queryTab : "drafts");
  const selected = location.params.get("faq");
  const draftBank = selected === "new" ? bank : null;
  const reload = useCallback(async () => {
    const [faqs, questions, refs, channels] = await Promise.all([embedded ? Promise.resolve({ items: [] as Faq[] }) : request<{ items: Faq[] }>("v1/admin/faq"), request<QuestionBank>("v1/admin/faq/questions"), request<References>("v1/admin/faq/references"), request<Contact[]>("v1/admin/faq/corporate-contacts")]);
    setItems(faqs.items); setBank(questions); setReferences(refs); setContacts(channels);
  }, [embedded]);
  const changed = useCallback(async () => { await reload(); onWorkflowChanged?.(); }, [reload, onWorkflowChanged]);
  const reloadCurrent = useCallback(async () => {
    if (selected && selected !== "new") setCurrent(await request<Faq>(`v1/admin/faq/${selected}`));
    await changed();
  }, [selected, changed]);
  useEffect(() => { let active = true; reload().catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [reload]);
  useEffect(() => {
    let active = true; setCurrent(null); setDraft(null); setDirty(false); setEditTab("answer"); setError("");
    if (selected === "new" && canEdit && draftBank) { const question = draftBank.items.find(item => item.question_key === questionKey && item.status === "approved"); setDraft({ ...emptyDraft, ...(scope ? { scope_type: scope.type, scope_id: scope.id, applies_to_project_ids: scope.type === "project" ? [scope.id] : [] } : {}), ...(question ? { question_key: question.question_key, question: { ...question.question_template }, alt_questions: { ...question.alt_questions }, answer_kind: question.answer_kind, fact_keys: question.fact_keys } : {}) }); setDirty(true); }
    else if (selected) request<Faq>(`v1/admin/faq/${selected}`).then(value => { if (active) { if (scope && (value.scope_type !== scope.type || value.scope_id !== scope.id)) window.location.replace("/website?legacy_faq=" + encodeURIComponent(value.id)); else setCurrent(value); } }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [selected, canEdit, scope?.type, scope?.id, questionKey, draftBank]);
  function edit() {
    if (!current || !canEdit || frozen || pending || workflowBusy || editing) return;
    setDraftRevision(current.revision);
    const value = current.version;
    setDraft({ question_key: current.question_key ?? "", scope_type: current.scope_type, scope_id: current.scope_id, question: locales(value.question), alt_questions: locales(value.alt_questions), short_answer: locales(value.short_answer), detail: locales(value.detail), answer_kind: value.answer_kind, fact_keys: value.fact_keys, applies_to_project_ids: value.applies_to_project_ids, applicability_rule: value.applicability_rule ?? {}, review_due: value.review_due ?? "", effective_to: value.effective_to ?? "", ai_exposure: value.ai_exposure, source_ref: "", source_url: "" });
    setDirty(true); setEditTab("answer"); setError(""); setNotice("");
  }
  async function save() {
    if (!draft || !canEdit || frozen || pending || workflowBusy || scope && (draft.scope_type !== scope.type || draft.scope_id !== scope.id)) return;
    setPending(true); setError(""); setNotice("");
    try {
      const value = await request<Faq>(current ? `v1/admin/faq/${current.id}` : "v1/admin/faq", current ? "PUT" : "POST", { expected_revision: current ? draftRevision : 0, changes: { ...draft, review_due: draft.review_due || null, effective_to: draft.effective_to || null, source_url: draft.source_url || null } });
      await changed(); setCurrent(await request<Faq>(`v1/admin/faq/${value.id}`)); setDraft(null); setDirty(false); location.navigate({ faq: value.id }, true); setNotice("บันทึกฉบับร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  function scopeOptions(kind: string): Reference[] {
    if (!references) return [];
    return kind === "corporate" ? [{ id: "sena", name: "SENA" }] : kind === "brand" ? references.brands : kind === "project" ? references.projects : kind === "project_group" ? references.groups : kind === "unit_type" ? references.unit_types : ["LIVNEX", "LIVNEX_GOLD", "RENTNEX", "RENTNEX_BENEFIT", "RENTNEX_INVEST"].map(id => ({ id, name: id }));
  }
  const preview = draft ?? current?.version;
  return <div className={`content-workspace${embedded ? " entity-embedded-faq" : ""}`}><header className="content-header"><h1>คลัง FAQ เว็บไซต์</h1><p>เตรียมคำตอบจากคำถามมาตรฐาน พร้อมที่มาและขอบเขตโครงการ</p><p className="content-state">{tab === "publication" ? "ตรวจหน้าเว็บก่อนเผยแพร่ โดยผู้อนุมัติคนละคน" : "ฉบับร่างภายใน Hub · ยังไม่เผยแพร่บนเว็บไซต์"}</p>{!canEdit && tab !== "publication" && <p>สิทธิ์ดูข้อมูลเท่านั้น</p>}</header>
    {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}{draft ? " ข้อความที่กรอกยังอยู่" : ""}</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {loading || !catalog || !bank || !references ? !error && !catalogError && <p role="status">กำลังโหลดคลัง FAQ…</p> : <>
      {!embedded && tab !== "publication" && <nav className="content-tabs" aria-label="ส่วนคลัง FAQ">{Object.entries(tabs).map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} disabled={pending || workflowBusy || (editing || dirty) && tab !== key} onClick={() => location.navigate({ [tabKeyQuery]: key, faq: null })}>{label}</button>)}</nav>}
      {tab === "coverage" && <FaqCoverage onOpenFaq={id => location.navigate({ [tabKeyQuery]: "drafts", faq: id })} />}
      {tab === "publication" && <WebPublication onEditingChange={setEditing} />}
      {tab === "intake" && <>{embedded && <button className="button secondary" disabled={editing} onClick={() => location.navigate({ cluster: null, faq_section: null })}>{workspaceText.backFaq}</button>}<FaqIntake fixedScope={scope} initialCluster={clusterId ?? undefined} bank={bank} references={references} onChanged={changed} onEditingChange={setEditing} onOpenFaq={id => location.navigate({ [tabKeyQuery]: "drafts", faq: id, cluster: null })} /></>}
      {tab === "bank" && <FaqBank bank={bank} fields={catalog.items} onChanged={changed} onEditingChange={setEditing} />}
      {tab === "glossary" && <FaqGlossary onChanged={changed} onEditingChange={setEditing} />}
      {tab === "contacts" && <ContentContacts items={contacts} catalog={catalog} apiBase="v1/admin/faq/corporate-contacts" canEdit={canEdit} onChanged={changed} onEditingChange={setEditing} />}
      {tab === "drafts" && <section className="content-section"><div className="content-toolbar"><h2>{selected ? "รายละเอียดคำตอบ" : "คำตอบ FAQ"}</h2>{!selected && canEdit && <button className="button primary" onClick={() => location.navigate({ faq: "new" })}>เพิ่มคำตอบ FAQ</button>}{selected && <button className="button secondary" disabled={pending || workflowBusy || editing} onClick={() => location.navigate({ faq: null })}>กลับรายการคำตอบ</button>}</div>
        {!selected ? embedded && scope && entity ? <EntityFaqQuestions scope={scope} entity={entity} questionKey={questionKey} onOpen={id => location.navigate({ faq: id })} onCreate={question => location.navigate({ faq: "new", question })} /> : <><label className="content-input">ค้นหาคำตอบ<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="content-card-list">{items.filter(item => `${item.question?.th} ${item.scope_id}`.includes(search)).map(item => <article className="content-card" key={item.id}><h3>{item.question?.th || "คำตอบจากข้อมูลเดิม"}</h3><p className="content-state">{stateLabel(item.state)} · {scopeLabels[item.scope_type]} {scopeOptions(item.scope_type).find(ref => ref.id === item.scope_id)?.name ?? item.scope_id}</p><p>{item.short_answer?.th}</p><button className="button secondary" onClick={() => location.navigate({ faq: item.id })}>เปิดคำตอบ {item.question?.th}</button></article>)}</div>{!items.length && <p className="content-empty">ยังไม่มีคำตอบ เริ่มจากอนุมัติคำถามมาตรฐานแล้วสร้างร่างคำตอบ</p>}</> : <>
          {current && <p className="content-state">{stateLabel(current.state)} · ฉบับ {current.version.version_no}</p>}
          <nav className="content-tabs" aria-label="ส่วนคำตอบ">{Object.entries(editTabs).map(([key, label]) => <button key={key} aria-current={editTab === key ? "page" : undefined} disabled={pending || workflowBusy || editing || dirty && ["english", "history", "sources"].includes(key)} onClick={() => setEditTab(key as keyof typeof editTabs)}>{label}</button>)}</nav>
          {editTab === "answer" && (draft ? <form ref={form} inert={workflowBusy} onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || !canEdit || frozen}>
            <label className="content-input">คำถามมาตรฐานที่อนุมัติแล้ว<select required value={draft.question_key} onChange={event => { const question = bank.items.find(item => item.question_key === event.target.value); if (question) setDraft({ ...draft, question_key: question.question_key, question: { ...question.question_template }, alt_questions: { ...question.alt_questions }, answer_kind: question.answer_kind, fact_keys: question.fact_keys }); }}><option value="">เลือกคำถาม</option>{bank.items.filter(item => item.status === "approved").map(item => <option key={item.question_key} value={item.question_key}>{item.question_template.th}</option>)}</select></label>
            {!bank.items.some(item => item.status === "approved") && <p className="inline-warning">ยังไม่มีคำถามที่อนุมัติ ให้ Manager ตรวจคำถามมาตรฐานก่อน</p>}
            {scope ? <p className="content-state">{scopeLabels[scope.type]} · {scope.name ?? scope.id}{scope.type === "project" && scope.name && <> · {scope.id}</>}</p> : <div className="content-two-columns"><label className="content-input">ระดับคำตอบ<select value={draft.scope_type} disabled={Boolean(current)} onChange={event => { const kind = event.target.value; setDraft({ ...draft, scope_type: kind, scope_id: kind === "corporate" ? "sena" : "", applies_to_project_ids: [], applicability_rule: {} }); }}>{Object.entries(scopeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="content-input">ขอบเขตคำตอบ<select required value={draft.scope_id} disabled={Boolean(current)} onChange={event => setDraft({ ...draft, scope_id: event.target.value, applies_to_project_ids: draft.scope_type === "project" ? [event.target.value] : draft.applies_to_project_ids })}><option value="">เลือกขอบเขต</option>{scopeOptions(draft.scope_type).map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label></div>}
            {([['question', 'คำถาม', 1000], ['alt_questions', 'คำถามอื่น (หนึ่งคำถามต่อบรรทัด)', 4000], ['short_answer', 'คำตอบสั้น', 300], ['detail', 'รายละเอียดคำตอบ', 12000]] as const).map(([key, label, maxLength]) => <BilingualInput key={key} id={`faq-${key}`} label={label} field={catalog.items.find(field => field.field_key === `faq.${key}`)} value={draft[key]} onChange={value => setDraft({ ...draft, [key]: value })} maxLength={maxLength} rows={key === "detail" ? 5 : 3} />)}
            <p className="field-help">คำตอบสั้นไม่เกิน 300 ตัวอักษร เริ่มตอบตรงคำถามและระบุชื่อโครงการหรือแบรนด์</p><p>ประเภทคำตอบ: {kindLabels[draft.answer_kind]} (ตามคำถามมาตรฐาน)</p>
            <fieldset className="content-checks"><legend>ช่องข้อเท็จจริงที่ใช้</legend>{catalog.items.filter(field => field.status === "active" && (field.section === "facts" || field.field_key === "price.amount")).map(field => <label key={field.field_key}><input type="checkbox" checked={draft.fact_keys.includes(field.field_key)} onChange={event => setDraft({ ...draft, fact_keys: event.target.checked ? [...draft.fact_keys, field.field_key] : draft.fact_keys.filter(key => key !== field.field_key) })} /><span>{field.label.th} <code>{`{${field.field_key.split('.').at(-1)}}`}</code></span></label>)}</fieldset>
            {["corporate", "business", "brand", "programme", "project_group"].includes(draft.scope_type) && <FaqApplicability rule={draft.applicability_rule} scope={draft.scope_type} reference={draft.scope_id} brands={references.brands} groups={references.groups} disabled={!permissions.can("projects", "view")} onChange={applicability_rule => setDraft({ ...draft, applicability_rule, applies_to_project_ids: [] })} onResolve={applies_to_project_ids => setDraft(value => value ? { ...value, applies_to_project_ids } : value)} />}
            <label className="content-input">เฟส REM ที่คำตอบนี้ใช้<select multiple size={6} disabled={draft.scope_type === "project" || Object.keys(draft.applicability_rule).length > 0} value={draft.applies_to_project_ids} onChange={event => setDraft({ ...draft, applies_to_project_ids: Array.from(event.target.selectedOptions, option => option.value) })}>{references.projects.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select><span className="field-help">เลือกเฟสที่เกี่ยวข้องโดยตรง สำหรับคำตอบระดับองค์กรสามารถเว้นว่างได้ เมื่อใช้เงื่อนไข รายการนี้มาจากผลตรวจเงื่อนไข</span></label>
            <div className="content-two-columns"><label className="content-input">กำหนดตรวจคำตอบ<input type="date" value={draft.review_due} onChange={event => setDraft({ ...draft, review_due: event.target.value })} /></label><label className="content-input">วันที่สิ้นสุดคำตอบ<input type="date" value={draft.effective_to} onChange={event => setDraft({ ...draft, effective_to: event.target.value })} /></label></div>
            <label className="content-input">แหล่งอ้างอิงใหม่<input maxLength={1000} value={draft.source_ref} onChange={event => setDraft({ ...draft, source_ref: event.target.value })} /></label><label className="content-input">ลิงก์แหล่งอ้างอิง<input type="url" placeholder="https://" maxLength={2000} value={draft.source_url} onChange={event => setDraft({ ...draft, source_url: event.target.value })} /></label><ExposureInput value={draft.ai_exposure} onChange={ai_exposure => setDraft({ ...draft, ai_exposure })} />
          </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => { setDraft(null); setDirty(false); if (!current) location.navigate({ faq: null }, true); }}>ยกเลิก</button><button className="button primary" disabled={pending || !canEdit || frozen || !draft.question_key || !draft.question.th?.trim() || !draft.short_answer.th?.trim()}>บันทึกคำตอบ</button></div></form> : current ? <><h3>{current.version.question.th}</h3><p className="content-preserve">{current.version.short_answer.th}</p><p className="content-preserve">{current.version.detail.th}</p><p>{kindLabels[current.version.answer_kind]} · {scopeLabels[current.scope_type]} {scopeOptions(current.scope_type).find(ref => ref.id === current.scope_id)?.name ?? current.scope_id}</p><p>เฟสที่ใช้: {current.version.applies_to_project_ids.join(", ") || "ระดับองค์กร"}</p>{canEdit && <div className="content-actions"><button className="button secondary" disabled={pending || workflowBusy || frozen} onClick={edit}>แก้ไขเป็นฉบับใหม่</button></div>}</> : <p role="status">กำลังโหลดคำตอบ…</p>)}
          {current && editTab === "answer" && <ContentWorkflow target={{ kind: "faq", identity: { id: current.id } }} label={current.version.question.th || current.question_key || current.id} revision={draft ? draftRevision : current.revision} disabled={pending || editing || workflowOwners.size > 0 && !workflowOwners.has("faq:" + current.id)} draft={draft ? { dirty: true, valid: canEdit && Boolean(draft.question_key && draft.question.th?.trim() && draft.short_answer.th?.trim()) && (!scope || draft.scope_type === scope.type && draft.scope_id === scope.id), sourceStamp: { revision: draftRevision }, getChanges: () => form.current?.reportValidity() ? { ...draft, review_due: draft.review_due || null, effective_to: draft.effective_to || null, source_url: draft.source_url || null } : null } : undefined} onEditingChange={value => workflowEditing("faq:" + current.id, value)} onChanged={async () => { await reloadCurrent(); setDraft(null); setDirty(false); }} onReload={async () => { await reloadCurrent(); setDraft(null); setDirty(false); }} />}
          {editTab === "english" && current && <TranslationReviewPanel items={current.translations} fields={catalog.items} canEdit={canEdit && !frozen && !pending && !workflowBusy} onChanged={reloadCurrent} onEditingChange={setEditing} />}
          {editTab === "sources" && current && <div><h3>แหล่งข้อมูลประกอบคำตอบ</h3>{current.sources.length ? current.sources.map(source => <article className="content-card" key={source.id}><p>{source.source_ref}</p><p>{source.source_url}</p><p>{contentDate(source.decided_at)}</p></article>) : <p>ยังไม่มีแหล่งอ้างอิงแนบกับคำตอบนี้</p>}</div>}
          {editTab === "preview" && preview && <section aria-label="ตัวอย่าง FAQ บนเว็บไซต์"><label className="content-input">ภาษาตัวอย่าง<select value={previewLocale} onChange={event => setPreviewLocale(event.target.value as "th" | "en")}><option value="th">ไทย</option><option value="en">อังกฤษ</option></select></label><p className="field-help">ตัวอย่างข้อความสำหรับตรวจร่าง ช่องข้อเท็จจริงจะแสดงเป็นเครื่องหมายแทนค่าจนกว่าจะเชื่อมการเผยแพร่</p><article className="content-card" lang={previewLocale}><h3>{preview.question[previewLocale] || "ยังไม่มีคำถามในภาษานี้"}</h3><p className="content-preserve">{preview.short_answer[previewLocale] || "ยังไม่มีคำตอบในภาษานี้"}</p><p className="content-preserve">{preview.detail[previewLocale]}</p></article></section>}
          {editTab === "history" && current && <div><h3>ประวัติคำตอบ</h3>{current.history.map(version => <details className="content-card" key={version.version_no}><summary>ฉบับ {version.version_no} · {stateLabel(version.state)} · {contentDate(version.created_at)}</summary><p>{version.editors?.map(id => <span key={id}><ActorName id={id} /> </span>)}{version.approved_by && <> · <ActorName id={version.approved_by} /></>}</p><h3>{version.question.th}</h3><p className="content-preserve">{version.short_answer.th}</p><p className="content-preserve">{version.detail.th}</p><p lang="en">{version.question.en}</p><p lang="en">{version.short_answer.en}</p><p>เฟสที่ใช้: {version.applies_to_project_ids.join(", ") || "ระดับองค์กร"}</p></details>)}</div>}
        </>}
      </section>}
    </>}
  </div>;
}


type ScopeQuestion = {
  question_key: string; label: Locales; is_core: boolean; answer_kind: string; display_state: string; content_state?: string;
  own_answer: null | { id: string; revision: number; version_id: string; state: string };
  effective_answer: null | { ai_exposure?: Exposure | null; id: string; revision: number; version_id: string; question: Locales | string; short_answer: Locales | string; detail: Locales | string;
    source: { scope_type: string; scope_id: string; name: Locales; target?: WorkspaceTarget; affected_project_count: number; affected_count_complete: boolean };
    author: { id: string; name: string } | null; approver: { id: string; name: string } | null };
  facts: { field_key: string; available: boolean; value: unknown; text: string; unit: string | null; as_of: string | null; target?: WorkspaceTarget }[];
  legacy_clusters: { id: string; state: string; holds: string[]; question_key: string; suggested_level: string; target: WorkspaceTarget }[];
  applicability: { state: string; reason?: string }; targets: { create_override?: WorkspaceTarget; edit_source?: WorkspaceTarget };
};
type UnmatchedCluster = { id: string; label: Locales; question_key: string | null; state: string; holds: string[]; target: WorkspaceTarget };
type ScopeQuestions = { page_scope: { type: string; id: string }; selected_phase: string | null; items: ScopeQuestion[]; next_cursor: string | null; unmatched_clusters?: UnmatchedCluster[]; unmatched_next_cursor?: string | null };
const scopeQuestionStates: Record<string, string> = {"missing":"ยังไม่มีคำตอบ","waiting_for_fact":"รอข้อเท็จจริง","legacy_suggestion":"ข้อเสนอจากเว็บเดิม","not_applicable":"ไม่ใช้กับโครงการนี้","hold":"พักไว้ตรวจ"};
function EntityFaqQuestions({ scope, entity, questionKey, onOpen, onCreate }: { scope: FixedFaqScope; entity: FaqEntityContext; questionKey: string | null; onOpen: (id: string) => void; onCreate: (question: string) => void }) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const { catalog } = useFieldCatalog();
  const [data, setData] = useState<ScopeQuestions | null>(null), [search, setSearch] = useState(""), [term, setTerm] = useState("");
  const [error, setError] = useState(""), [pending, setPending] = useState(false), [retry, setRetry] = useState(0);
  const [selectedQuestion, setSelectedQuestion] = useState<ScopeQuestion | null>(null), [selectedPending, setSelectedPending] = useState(false), [selectedError, setSelectedError] = useState("");
  const params = new URLSearchParams({ q: term, limit: "50", locale: "th" }); if (entity.phase) params.set("phase", entity.phase);
  const path = workspaceApi(entity.level, entity.id) + "/faq?" + params;
  const exact = new URLSearchParams({ question_key: questionKey ?? "", locale: "th" }); if (entity.phase) exact.set("phase", entity.phase);
  const selectedPath = questionKey ? workspaceApi(entity.level, entity.id) + "/faq?" + exact : "";
  useEffect(() => {
    let live = true; setSelectedQuestion(null); setSelectedError(""); setSelectedPending(Boolean(selectedPath));
    if (selectedPath) request<ScopeQuestions>(selectedPath).then(value => { if (live) setSelectedQuestion(value.items.find(item => item.question_key === questionKey) ?? null); }).catch(error => { if (live) setSelectedError(errorMessage(error)); }).finally(() => { if (live) setSelectedPending(false); });
    return () => { live = false; };
  }, [selectedPath, questionKey, authority, retry]);
  const pageGeneration = useRef(0);
  useEffect(() => {
    pageGeneration.current += 1;
    let live = true; setData(null); setError(""); setPending(true);
    request<ScopeQuestions>(path).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [path, authority, retry]);
  async function more(unmatched = false) {
    const cursor = unmatched ? data?.unmatched_next_cursor : data?.next_cursor;
    if (!cursor || pending) return; setPending(true);
    const generation = pageGeneration.current;
    try {
      const value = await request<ScopeQuestions>(path + "&after=" + encodeURIComponent(cursor));
      if (generation !== pageGeneration.current) return;
      setData(current => current && ({
        ...current,
        items: unmatched ? current.items : [...current.items, ...value.items],
        next_cursor: unmatched ? current.next_cursor : value.next_cursor,
        unmatched_clusters: [...new Map([...(current.unmatched_clusters ?? []), ...(value.unmatched_clusters ?? [])].map(cluster => [cluster.id, cluster])).values()],
        unmatched_next_cursor: unmatched ? value.unmatched_next_cursor : current.unmatched_next_cursor,
      }));
    }
    catch (e) { if (generation === pageGeneration.current) setError(errorMessage(e)); } finally { if (generation === pageGeneration.current) setPending(false); }
  }
  const shownItems = [...(data?.items ?? []), ...(selectedQuestion && !data?.items.some(item => item.question_key === selectedQuestion.question_key) ? [selectedQuestion] : [])];
  return <div className="workspace-faq">
    <p className="content-state">{scopeLabels[scope.type]} · {scope.name ?? scope.id}{scope.type === "project" && scope.name && <> · {scope.id}</>}</p>
    <form className="workspace-search" onSubmit={event => { event.preventDefault(); setTerm(search.trim()); }}><label>{workspaceText.searchFaq}<input type="search" value={search} maxLength={200} onChange={event => setSearch(event.target.value)} /></label><button className="button secondary">{workspaceText.search}</button></form>
    {error && <p className="notice error" role="alert">{error} <button className="button secondary" onClick={() => setRetry(value => value + 1)}>{workspaceText.retry}</button></p>}
    {selectedError && <p className="notice error" role="alert">{selectedError} <button className="button secondary" onClick={() => setRetry(value => value + 1)}>{workspaceText.retry}</button></p>}
    {selectedPending && <p role="status">{workspaceText.loading}</p>}
    {pending && !data && <p role="status">{workspaceText.loading}</p>}
    {shownItems.map(item => <article className="workspace-faq-card" id={`question-${item.question_key}`} data-workspace-question={item.question_key} tabIndex={-1} key={item.question_key}>
      <h3>{workspaceName(item.label)}</h3><p className="workspace-faq-states">{item.is_core && <span>{workspaceText.required}</span>}<span>{item.display_state === "handoff" ? kindLabels.handoff : scopeQuestionStates[item.display_state] ?? stateLabel(item.content_state ?? item.own_answer?.state ?? "DRAFT")}</span></p>
      {item.effective_answer && <><ExposureChip exposure={item.effective_answer.ai_exposure} /><p className="content-preserve">{workspaceName(item.effective_answer.short_answer)}</p>
        {item.display_state === "inherited" && <p className="content-state">{workspaceText.inheritedFrom}{scopeLabels[item.effective_answer.source.scope_type]} · {workspaceName(item.effective_answer.source.name)}</p>}
        <p>{item.effective_answer.author?.name}{item.effective_answer.approver?.name && <> · {item.effective_answer.approver.name}</>}</p></>}
      <div className="workspace-faq-facts">{item.facts.map(fact => <p key={fact.field_key}>{fact.available ? fact.text || String(fact.value ?? "") : fact.target ? <a href={workspaceHref(fact.target)}>{catalog?.items.find(field => field.field_key === fact.field_key)?.label.th ?? workspaceText.data}</a> : workspaceText.empty}{fact.unit && <> {fact.unit}</>}{fact.as_of && <> · {contentDate(fact.as_of)}</>}</p>)}</div>
      <div className="content-actions">
        {item.own_answer && <button className="button secondary" onClick={() => onOpen(item.own_answer!.id)}>{workspaceText.faq} · {workspaceName(item.label)}</button>}
        {!item.own_answer && item.targets.create_override && item.display_state !== "not_applicable" && permissions.can("knowledge", "edit") && <button className="button secondary" onClick={() => onCreate(item.question_key)}>{item.display_state === "inherited" && scope.type === "project" ? workspaceText.override : workspaceText.newFaq}</button>}
        {item.targets.edit_source && item.effective_answer && <a className="button secondary" href={workspaceHref(item.targets.edit_source, { faq: item.effective_answer.id })}>{workspaceText.editSource} · {workspaceText.affected_projects} {item.effective_answer.source.affected_project_count}</a>}
        {item.legacy_clusters.map(cluster => <div key={cluster.id}><ul className="intake-holds">{cluster.holds.map(hold => <li key={hold}>{holdLabels[hold] ?? hold}</li>)}</ul><a className="button secondary" href={workspaceHref(cluster.target, { cluster: cluster.id })}>{workspaceText.suggestions}</a></div>)}
      </div>
    </article>)}
    {data && !shownItems.length && !selectedPending && <p>{workspaceText.empty}</p>}
    {data?.next_cursor && <button className="button secondary" disabled={pending} onClick={() => void more()}>{workspaceText.more}</button>}
    {Boolean(data?.unmatched_clusters?.length) && <section aria-label={workspaceText.suggestions} className="workspace-unmatched-clusters"><h2>{workspaceText.suggestions}</h2>
      {data!.unmatched_clusters!.map(cluster => <article className="content-card" key={cluster.id} data-workspace-cluster={cluster.id}>
        <h3>{workspaceName(cluster.label)}</h3><p className="content-state">{intakeStateLabels[cluster.state as keyof typeof intakeStateLabels] ?? cluster.state}</p>
        <ul className="intake-holds">{cluster.holds.map(hold => <li key={hold}>{holdLabels[hold] ?? hold}</li>)}</ul>
        <a className="button secondary" href={workspaceHref(cluster.target, { cluster: cluster.id })}>{workspaceText.suggestions}</a>
      </article>)}
      {data?.unmatched_next_cursor && <button className="button secondary" disabled={pending} onClick={() => void more(true)}>{workspaceText.more}</button>}
    </section>}
  </div>;
}
