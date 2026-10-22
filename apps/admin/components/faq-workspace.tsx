"use client";
import { useCallback, useEffect, useState } from "react";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { useContentLocation } from "./content-operations-shared";
import { ContentContacts, type Contact } from "./content-contacts";
import { FaqBank, FaqGlossary, kindLabels, scopeLabels, type QuestionBank } from "./faq-bank";
import { FaqIntake } from "./faq-intake";
import { FaqCoverage } from "./faq-coverage";
import { FaqApplicability, type FaqRule } from "./faq-applicability";
import { stateLabel } from "./content-narrative";
import { BilingualInput, ExposureInput, TranslationReviewPanel, useFieldCatalog, contentDate, errorMessage, type Exposure, type Locales, type Translation } from "./content-common";

type Reference = { id: string; name: string; project_id?: string };
type References = { projects: Reference[]; brands: Reference[]; groups: Reference[]; unit_types: Reference[] };
type FaqVersion = { version_no: number; question: Locales; alt_questions: Locales; short_answer: Locales; detail: Locales; answer_kind: string; fact_keys: string[]; applies_to_project_ids: string[]; applicability_rule: FaqRule; review_due: string | null; effective_to: string | null; state: string; ai_exposure: Exposure; created_at: string };
type Faq = { id: string; question_key: string | null; scope_type: string; scope_id: string; revision: number; state: string; question?: Locales; short_answer?: Locales; version: FaqVersion; history: FaqVersion[]; sources: { id: string; source_ref: string; source_url: string | null; decided_at: string }[]; translations: Translation[] };
type Draft = { question_key: string; scope_type: string; scope_id: string; question: Locales; alt_questions: Locales; short_answer: Locales; detail: Locales; answer_kind: string; fact_keys: string[]; applies_to_project_ids: string[]; applicability_rule: FaqRule; review_due: string; effective_to: string; ai_exposure: Exposure; source_ref: string; source_url: string };
const emptyDraft: Draft = { question_key: "", scope_type: "corporate", scope_id: "sena", question: {}, alt_questions: {}, short_answer: {}, detail: {}, answer_kind: "text", fact_keys: [], applies_to_project_ids: [], applicability_rule: {}, review_due: "", effective_to: "", ai_exposure: "open", source_ref: "", source_url: "" };
const tabs = { coverage: "ความครบ", drafts: "คำตอบ FAQ", intake: "คัดจากของเดิม", bank: "คำถามมาตรฐาน", glossary: "คำแปลมาตรฐาน", contacts: "ติดต่อองค์กร" };
const editTabs = { answer: "คำตอบและขอบเขต", english: "ภาษาอังกฤษ", sources: "แหล่งข้อมูล", preview: "ตัวอย่างบนเว็บไซต์", history: "ประวัติ" };
function locales(value: Locales | unknown): Locales {
  if (Array.isArray(value)) return { th: value.map(item => typeof item === "string" ? item : item.th ?? "").join("\n") };
  return value && typeof value === "object" ? value as Locales : {};
}
export function FaqWorkspace() {
  const permissions = useHubPermissions(), canEdit = permissions.can("knowledge", "edit");
  const { catalog, error: catalogError } = useFieldCatalog();
  const [bank, setBank] = useState<QuestionBank | null>(null), [references, setReferences] = useState<References | null>(null);
  const [items, setItems] = useState<Faq[]>([]), [contacts, setContacts] = useState<Contact[]>([]);
  const [current, setCurrent] = useState<Faq | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(false), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [search, setSearch] = useState("");
  const [editTab, setEditTab] = useState<keyof typeof editTabs>("answer"), [previewLocale, setPreviewLocale] = useState<"th" | "en">("th");
  const location = useContentLocation(editing || dirty);
  const queryTab = location.params.get("tab") as keyof typeof tabs, tab = queryTab in tabs ? queryTab : "drafts";
  const selected = location.params.get("faq");
  const reload = useCallback(async () => {
    const [faqs, questions, refs, channels] = await Promise.all([request<{ items: Faq[] }>("v1/admin/faq"), request<QuestionBank>("v1/admin/faq/questions"), request<References>("v1/admin/faq/references"), request<Contact[]>("v1/admin/faq/corporate-contacts")]);
    setItems(faqs.items); setBank(questions); setReferences(refs); setContacts(channels);
  }, []);
  const reloadCurrent = useCallback(async () => {
    if (selected && selected !== "new") setCurrent(await request<Faq>(`v1/admin/faq/${selected}`));
    await reload();
  }, [selected, reload]);
  useEffect(() => { let active = true; reload().catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [reload]);
  useEffect(() => {
    let active = true; setCurrent(null); setDraft(null); setDirty(false); setEditTab("answer"); setError("");
    if (selected === "new" && canEdit) { setDraft({ ...emptyDraft }); setDirty(true); }
    else if (selected) request<Faq>(`v1/admin/faq/${selected}`).then(value => { if (active) setCurrent(value); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [selected, canEdit]);
  function edit() {
    if (!current || !canEdit) return;
    const value = current.version;
    setDraft({ question_key: current.question_key ?? "", scope_type: current.scope_type, scope_id: current.scope_id, question: locales(value.question), alt_questions: locales(value.alt_questions), short_answer: locales(value.short_answer), detail: locales(value.detail), answer_kind: value.answer_kind, fact_keys: value.fact_keys, applies_to_project_ids: value.applies_to_project_ids, applicability_rule: value.applicability_rule ?? {}, review_due: value.review_due ?? "", effective_to: value.effective_to ?? "", ai_exposure: value.ai_exposure, source_ref: "", source_url: "" });
    setDirty(true); setEditTab("answer"); setError(""); setNotice("");
  }
  async function save() {
    if (!draft || !canEdit || pending) return;
    setPending(true); setError(""); setNotice("");
    try {
      const value = await request<Faq>(current ? `v1/admin/faq/${current.id}` : "v1/admin/faq", current ? "PUT" : "POST", { expected_revision: current?.revision ?? 0, changes: { ...draft, review_due: draft.review_due || null, effective_to: draft.effective_to || null, source_url: draft.source_url || null } });
      await reload(); setCurrent(await request<Faq>(`v1/admin/faq/${value.id}`)); setDraft(null); setDirty(false); location.navigate({ faq: value.id }, true); setNotice("บันทึกฉบับร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  async function submit() {
    if (!current || !canEdit || pending) return;
    setPending(true); setError("");
    try { await request(`v1/admin/faq/${current.id}/submit`, "POST", { expected_revision: current.revision }); await reloadCurrent(); setNotice("ส่งตรวจแล้ว ฉบับนี้เก็บไว้ในประวัติ ยังไม่เผยแพร่เว็บไซต์"); }
    catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  function scopeOptions(kind: string): Reference[] {
    if (!references) return [];
    return kind === "corporate" ? [{ id: "sena", name: "SENA" }] : kind === "brand" ? references.brands : kind === "project" ? references.projects : kind === "project_group" ? references.groups : kind === "unit_type" ? references.unit_types : ["LIVNEX", "LIVNEX_GOLD", "RENTNEX", "RENTNEX_BENEFIT", "RENTNEX_INVEST"].map(id => ({ id, name: id }));
  }
  const preview = draft ?? current?.version;
  return <div className="content-workspace"><header className="content-header"><h1>คลัง FAQ เว็บไซต์</h1><p>เตรียมคำตอบจากคำถามมาตรฐาน พร้อมที่มาและขอบเขตโครงการ</p><p className="content-state">ฉบับร่างภายใน Hub · ยังไม่เผยแพร่บนเว็บไซต์</p>{!canEdit && <p>สิทธิ์ดูข้อมูลเท่านั้น</p>}</header>
    {(error || catalogError) && <p className="notice error" role="alert">{error || catalogError}{draft ? " ข้อความที่กรอกยังอยู่" : ""}</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {loading || !catalog || !bank || !references ? !error && !catalogError && <p role="status">กำลังโหลดคลัง FAQ…</p> : <>
      <nav className="content-tabs" aria-label="ส่วนคลัง FAQ">{Object.entries(tabs).map(([key, label]) => <button key={key} aria-current={tab === key ? "page" : undefined} disabled={(editing || dirty) && tab !== key} onClick={() => location.navigate({ tab: key, faq: null })}>{label}</button>)}</nav>
      {tab === "coverage" && <FaqCoverage onOpenFaq={id => location.navigate({ tab: "drafts", faq: id })} />}
      {tab === "intake" && <FaqIntake bank={bank} references={references} onChanged={reload} onEditingChange={setEditing} onOpenFaq={id => location.navigate({ tab: "drafts", faq: id })} />}
      {tab === "bank" && <FaqBank bank={bank} fields={catalog.items} onChanged={reload} onEditingChange={setEditing} />}
      {tab === "glossary" && <FaqGlossary onEditingChange={setEditing} />}
      {tab === "contacts" && <ContentContacts items={contacts} catalog={catalog} apiBase="v1/admin/faq/corporate-contacts" canEdit={canEdit} onChanged={reload} onEditingChange={setEditing} />}
      {tab === "drafts" && <section className="content-section"><div className="content-toolbar"><h2>{selected ? "รายละเอียดคำตอบ" : "คำตอบ FAQ"}</h2>{!selected && canEdit && <button className="button primary" onClick={() => location.navigate({ faq: "new" })}>เพิ่มคำตอบ FAQ</button>}{selected && <button className="button secondary" disabled={pending || editing} onClick={() => location.navigate({ faq: null })}>กลับรายการคำตอบ</button>}</div>
        {!selected ? <><label className="content-input">ค้นหาคำตอบ<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><div className="content-card-list">{items.filter(item => `${item.question?.th} ${item.scope_id}`.includes(search)).map(item => <article className="content-card" key={item.id}><h3>{item.question?.th || "คำตอบจากข้อมูลเดิม"}</h3><p className="content-state">{stateLabel(item.state)} · {scopeLabels[item.scope_type]} {scopeOptions(item.scope_type).find(ref => ref.id === item.scope_id)?.name ?? item.scope_id}</p><p>{item.short_answer?.th}</p><button className="button secondary" onClick={() => location.navigate({ faq: item.id })}>เปิดคำตอบ {item.question?.th}</button></article>)}</div>{!items.length && <p className="content-empty">ยังไม่มีคำตอบ เริ่มจากอนุมัติคำถามมาตรฐานแล้วสร้างร่างคำตอบ</p>}</> : <>
          {current && <p className="content-state">{stateLabel(current.state)} · ฉบับ {current.version.version_no}</p>}
          <nav className="content-tabs" aria-label="ส่วนคำตอบ">{Object.entries(editTabs).map(([key, label]) => <button key={key} aria-current={editTab === key ? "page" : undefined} disabled={editing || dirty && ["english", "history", "sources"].includes(key)} onClick={() => setEditTab(key as keyof typeof editTabs)}>{label}</button>)}</nav>
          {editTab === "answer" && (draft ? <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || !canEdit}>
            <label className="content-input">คำถามมาตรฐานที่อนุมัติแล้ว<select required value={draft.question_key} onChange={event => { const question = bank.items.find(item => item.question_key === event.target.value); if (question) setDraft({ ...draft, question_key: question.question_key, question: { ...question.question_template }, alt_questions: { ...question.alt_questions }, answer_kind: question.answer_kind, fact_keys: question.fact_keys }); }}><option value="">เลือกคำถาม</option>{bank.items.filter(item => item.status === "approved").map(item => <option key={item.question_key} value={item.question_key}>{item.question_template.th}</option>)}</select></label>
            {!bank.items.some(item => item.status === "approved") && <p className="inline-warning">ยังไม่มีคำถามที่อนุมัติ ให้ Manager ตรวจคำถามมาตรฐานก่อน</p>}
            <div className="content-two-columns"><label className="content-input">ระดับคำตอบ<select value={draft.scope_type} disabled={Boolean(current)} onChange={event => { const kind = event.target.value; setDraft({ ...draft, scope_type: kind, scope_id: kind === "corporate" ? "sena" : "", applies_to_project_ids: [], applicability_rule: {} }); }}>{Object.entries(scopeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="content-input">ขอบเขตคำตอบ<select required value={draft.scope_id} disabled={Boolean(current)} onChange={event => setDraft({ ...draft, scope_id: event.target.value, applies_to_project_ids: draft.scope_type === "project" ? [event.target.value] : draft.applies_to_project_ids })}><option value="">เลือกขอบเขต</option>{scopeOptions(draft.scope_type).map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label></div>
            {([['question', 'คำถาม', 1000], ['alt_questions', 'คำถามอื่น (หนึ่งคำถามต่อบรรทัด)', 4000], ['short_answer', 'คำตอบสั้น', 300], ['detail', 'รายละเอียดคำตอบ', 12000]] as const).map(([key, label, maxLength]) => <BilingualInput key={key} id={`faq-${key}`} label={label} field={catalog.items.find(field => field.field_key === `faq.${key}`)} value={draft[key]} onChange={value => setDraft({ ...draft, [key]: value })} maxLength={maxLength} rows={key === "detail" ? 5 : 3} />)}
            <p className="field-help">คำตอบสั้นไม่เกิน 300 ตัวอักษร เริ่มตอบตรงคำถามและระบุชื่อโครงการหรือแบรนด์</p><p>ประเภทคำตอบ: {kindLabels[draft.answer_kind]} (ตามคำถามมาตรฐาน)</p>
            <fieldset className="content-checks"><legend>ช่องข้อเท็จจริงที่ใช้</legend>{catalog.items.filter(field => field.status === "active" && (field.section === "facts" || field.field_key === "price.amount")).map(field => <label key={field.field_key}><input type="checkbox" checked={draft.fact_keys.includes(field.field_key)} onChange={event => setDraft({ ...draft, fact_keys: event.target.checked ? [...draft.fact_keys, field.field_key] : draft.fact_keys.filter(key => key !== field.field_key) })} /><span>{field.label.th} <code>{`{${field.field_key.split('.').at(-1)}}`}</code></span></label>)}</fieldset>
            {["corporate", "brand", "programme", "project_group"].includes(draft.scope_type) && <FaqApplicability rule={draft.applicability_rule} scope={draft.scope_type} reference={draft.scope_id} brands={references.brands} groups={references.groups} disabled={!permissions.can("projects", "view")} onChange={applicability_rule => setDraft({ ...draft, applicability_rule, applies_to_project_ids: [] })} onResolve={applies_to_project_ids => setDraft(value => value ? { ...value, applies_to_project_ids } : value)} />}
            <label className="content-input">เฟส REM ที่คำตอบนี้ใช้<select multiple size={6} disabled={draft.scope_type === "project" || Object.keys(draft.applicability_rule).length > 0} value={draft.applies_to_project_ids} onChange={event => setDraft({ ...draft, applies_to_project_ids: Array.from(event.target.selectedOptions, option => option.value) })}>{references.projects.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select><span className="field-help">เลือกเฟสที่เกี่ยวข้องโดยตรง สำหรับคำตอบระดับองค์กรสามารถเว้นว่างได้ เมื่อใช้เงื่อนไข รายการนี้มาจากผลตรวจเงื่อนไข</span></label>
            <div className="content-two-columns"><label className="content-input">กำหนดตรวจคำตอบ<input type="date" value={draft.review_due} onChange={event => setDraft({ ...draft, review_due: event.target.value })} /></label><label className="content-input">วันที่สิ้นสุดคำตอบ<input type="date" value={draft.effective_to} onChange={event => setDraft({ ...draft, effective_to: event.target.value })} /></label></div>
            <label className="content-input">แหล่งอ้างอิงใหม่<input maxLength={1000} value={draft.source_ref} onChange={event => setDraft({ ...draft, source_ref: event.target.value })} /></label><label className="content-input">ลิงก์แหล่งอ้างอิง<input type="url" placeholder="https://" maxLength={2000} value={draft.source_url} onChange={event => setDraft({ ...draft, source_url: event.target.value })} /></label><ExposureInput value={draft.ai_exposure} onChange={ai_exposure => setDraft({ ...draft, ai_exposure })} />
          </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => { setDraft(null); setDirty(false); if (!current) location.navigate({ faq: null }, true); }}>ยกเลิก</button><button className="button primary" disabled={pending || !canEdit || !draft.question_key || !draft.question.th?.trim() || !draft.short_answer.th?.trim()}>บันทึกคำตอบ</button></div></form> : current ? <><h3>{current.version.question.th}</h3><p className="content-preserve">{current.version.short_answer.th}</p><p className="content-preserve">{current.version.detail.th}</p><p>{kindLabels[current.version.answer_kind]} · {scopeLabels[current.scope_type]} {scopeOptions(current.scope_type).find(ref => ref.id === current.scope_id)?.name ?? current.scope_id}</p><p>เฟสที่ใช้: {current.version.applies_to_project_ids.join(", ") || "ระดับองค์กร"}</p>{canEdit && <div className="content-actions"><button className="button secondary" disabled={pending} onClick={edit}>แก้ไขเป็นฉบับใหม่</button>{current.state === "DRAFT" && <button className="button primary" disabled={pending} onClick={() => void submit()}>ส่งตรวจคำตอบ</button>}</div>}</> : <p role="status">กำลังโหลดคำตอบ…</p>)}
          {editTab === "english" && current && <TranslationReviewPanel items={current.translations} fields={catalog.items} canEdit={canEdit} onChanged={reloadCurrent} onEditingChange={setEditing} />}
          {editTab === "sources" && current && <div><h3>แหล่งข้อมูลประกอบคำตอบ</h3>{current.sources.length ? current.sources.map(source => <article className="content-card" key={source.id}><p>{source.source_ref}</p><p>{source.source_url}</p><p>{contentDate(source.decided_at)}</p></article>) : <p>ยังไม่มีแหล่งอ้างอิงแนบกับคำตอบนี้</p>}</div>}
          {editTab === "preview" && preview && <section aria-label="ตัวอย่าง FAQ บนเว็บไซต์"><label className="content-input">ภาษาตัวอย่าง<select value={previewLocale} onChange={event => setPreviewLocale(event.target.value as "th" | "en")}><option value="th">ไทย</option><option value="en">อังกฤษ</option></select></label><p className="field-help">ตัวอย่างข้อความสำหรับตรวจร่าง ช่องข้อเท็จจริงจะแสดงเป็นเครื่องหมายแทนค่าจนกว่าจะเชื่อมการเผยแพร่</p><article className="content-card" lang={previewLocale}><h3>{preview.question[previewLocale] || "ยังไม่มีคำถามในภาษานี้"}</h3><p className="content-preserve">{preview.short_answer[previewLocale] || "ยังไม่มีคำตอบในภาษานี้"}</p><p className="content-preserve">{preview.detail[previewLocale]}</p></article></section>}
          {editTab === "history" && current && <div><h3>ประวัติคำตอบ</h3>{current.history.map(version => <details className="content-card" key={version.version_no}><summary>ฉบับ {version.version_no} · {stateLabel(version.state)} · {contentDate(version.created_at)}</summary><h3>{version.question.th}</h3><p className="content-preserve">{version.short_answer.th}</p><p className="content-preserve">{version.detail.th}</p><p lang="en">{version.question.en}</p><p lang="en">{version.short_answer.en}</p><p>เฟสที่ใช้: {version.applies_to_project_ids.join(", ") || "ระดับองค์กร"}</p></details>)}</div>}
        </>}
      </section>}
    </>}
  </div>;
}
