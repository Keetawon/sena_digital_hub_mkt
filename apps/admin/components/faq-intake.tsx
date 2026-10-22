"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { request } from "./hub-request";
import { useHubPermissions } from "./accounts";
import { contentDate, errorMessage, type Locales } from "./content-common";
import { kindLabels, scopeLabels, type QuestionBank } from "./faq-bank";
import "./faq-intake.css";

type Reference = { id: string; name: string; project_id?: string };
export type IntakeReferences = { projects: Reference[]; brands: Reference[]; groups: Reference[]; unit_types: Reference[] };
type Status = { state: "open" | "held" | "question_proposed" | "decided"; decision?: string; hold_code?: string | null; faq_id?: string | null; question_key?: string | null; decided_at?: string };
type Summary = { id: string; sort_key: number; revision: number; template: string; question: string; variant_count: number; answer_group_count: number; project_ids: string[]; brand_ids: string[]; holds: string[]; suggested_question_key: string | null; suggested_level: string; suggested_kind: string; suggestion_basis: string; status: Status };
type Listing = { items: Summary[]; next_after: number | null; filtered_total: number; counts: Record<"total" | "decided" | "held" | "question_proposed" | "open", number>; brands: { id: string; name: string; count: number }[]; generation: { generation_sha256: string; generated_at: string } | null };
type Variant = { candidate_id: string; question: string; alt_questions: string[]; source_url: string | null; source_ref: string; source_kind: string; project_ids: string[]; programme_ids: string[]; holds: string[] };
type AnswerGroup = { group_key: string; answer: string; candidate_ids: string[]; project_ids: string[]; brand_ids: string[] };
type Detail = { id: string; revision: number; template: string; holds: string[]; variants: Variant[]; answer_groups: AnswerGroup[]; project_ids: string[]; status: Status;
  suggestion: { question_key: string | null; level: string; kind: string; score: number | null; basis: string; question: { question_template: Locales; status: string } | null };
  projects: { id: string; name: string; closed: boolean }[]; brands: { rem_brand_id: string; public_brand_id: string | null; name: string }[];
  existing_faqs: { id: string; scope_type: string; scope_id: string; revision: number; state: string }[];
  decisions: { id: string; decision: string; hold_code: string | null; note: string | null; faq_id: string | null; faq_version_no: number | null; question_key: string | null; candidate_ids: string[]; decided_at: string }[] };
type Choice = "create" | "hold" | "reject" | "propose_question";
type Answer = { question_key: string; scope_type: string; scope_id: string; question: string; short_answer: string; detail: string; applies_to_project_ids: string[]; append: boolean };

export const holdLabels: Record<string, string> = { numeric: "มีตัวเลข", commercial: "มีเนื้อหาการขาย", programme_terms: "เงื่อนไขโครงการบริการ (รอ Q70)", phase_decision: "ต้องเลือกเฟส", mapping_conflict: "รหัสโครงการไม่ตรง", prompt_injection: "ข้อความไม่ปลอดภัย", closed_project: "มีโครงการที่ปิดแล้ว", other: "อื่น ๆ" };
const stateLabels: Record<Status["state"], string> = { open: "ยังไม่ตัดสินใจ", held: "พักไว้", question_proposed: "รออนุมัติคำถามใหม่", decided: "ตัดสินใจแล้ว" };
const decisionLabels: Record<string, string> = { answer_created: "สร้างร่างคำตอบ", rejected: "ไม่ใช้", held: "พักไว้", question_proposed: "เสนอคำถามมาตรฐาน" };
const choiceLabels: Record<Choice, string> = { create: "สร้างร่างคำตอบ", hold: "พักไว้ก่อน", reject: "ไม่ใช้กลุ่มนี้", propose_question: "เสนอคำถามมาตรฐานใหม่" };
const sourceLabels: Record<string, string> = { public_website: "เว็บไซต์ SENA", legacy_website_km: "KM เดิม" };
const filterKeys = ["state", "level", "kind", "hold", "brand"] as const;
type Filters = Partial<Record<(typeof filterKeys)[number], string>>;
const blocking = ["prompt_injection", "programme_terms"];
const same = (a: string, b: string) => a.normalize("NFC").toLowerCase().replace(/^[^—\n]{1,200}\s—\s/, "").replace(/\s+/g, " ").trim() === b.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export function FaqIntake({ bank, references, onChanged, onEditingChange, onOpenFaq }: { bank: QuestionBank; references: IntakeReferences; onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void; onOpenFaq: (id: string) => void }) {
  const permissions = useHubPermissions(), canEdit = permissions.can("knowledge", "edit");
  const [filters, setFilters] = useState<Filters>({ state: "open" }), [cursor, setCursor] = useState<number[]>([0]);
  const [listing, setListing] = useState<Listing | null>(null), [detail, setDetail] = useState<Detail | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null), [answer, setAnswer] = useState<Answer | null>(null), [candidates, setCandidates] = useState<string[]>([]);
  const [note, setNote] = useState(""), [holdCode, setHoldCode] = useState("other");
  const [proposal, setProposal] = useState({ question_key: "", topic: "identity", default_level: "project", template: "", answer_kind: "text" });
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [pending, setPending] = useState(false);
  const projectName = useMemo(() => new Map(references.projects.map(p => [p.id, p.name])), [references]);
  const approved = bank.items.filter(item => item.status === "approved");
  const after = cursor[cursor.length - 1];

  const load = useCallback(async () => {
    const query = new URLSearchParams(Object.entries({ ...filters, after: String(after), limit: "25" }).filter(([, value]) => value) as [string, string][]);
    setListing(await request<Listing>(`v1/admin/faq-intake/clusters?${query}`));
  }, [filters, after]);
  useEffect(() => { let active = true; load().catch(e => { if (active) setError(errorMessage(e)); }); return () => { active = false; }; }, [load]);
  useEffect(() => { onEditingChange(Boolean(choice)); return () => onEditingChange(false); }, [choice, onEditingChange]);
  useEffect(() => {
    let active = true; setDetail(null); setChoice(null); setError("");
    if (selected) request<Detail>(`v1/admin/faq-intake/clusters/${selected}`).then(value => { if (active) setDetail(value); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [selected]);

  function start(next: Choice, group?: AnswerGroup) {
    if (!detail) return;
    const suggested = approved.find(item => item.question_key === detail.suggestion.question_key);
    const target = group ?? detail.answer_groups[0];
    const level = suggested?.default_level ?? detail.suggestion.level;
    const phases = target?.project_ids ?? [];
    const scope = level === "corporate" ? "sena" : level === "project" ? phases[0] ?? "" : "";
    setAnswer({ question_key: suggested?.question_key ?? "", scope_type: level, scope_id: scope, question: detail.variants[0]?.question ?? "", short_answer: target?.answer ?? "", detail: "",
      applies_to_project_ids: level === "project" ? (scope ? [scope] : []) : phases, append: false });
    setCandidates(group ? group.candidate_ids : detail.variants.map(v => v.candidate_id));
    setNote(""); setHoldCode(detail.holds.find(h => h !== "closed_project") ?? "other"); setChoice(next); setError(""); setNotice("");
    setProposal({ question_key: "", topic: "identity", default_level: detail.suggestion.level, template: detail.template, answer_kind: detail.suggestion.kind });
  }
  const existing = detail && answer ? detail.existing_faqs.find(f => f.scope_type === answer.scope_type && f.scope_id === answer.scope_id) : undefined;
  const sourceAnswers = detail ? detail.variants.filter(v => candidates.includes(v.candidate_id)).map(v => detail.answer_groups.find(g => g.candidate_ids.includes(v.candidate_id))?.answer ?? "") : [];
  const unchanged = Boolean(detail && answer && detail.holds.some(h => h === "numeric" || h === "commercial") && sourceAnswers.some(source => source && (same(source, answer.short_answer) || same(source, answer.detail))));
  const closedSelected = Boolean(detail && answer && detail.projects.some(p => p.closed && answer.applies_to_project_ids.includes(p.id)));

  async function decide() {
    if (!detail || !choice || pending) return;
    const changes: Record<string, unknown> = { candidate_ids: candidates, note: note.trim() || undefined };
    if (choice === "hold") changes.hold_code = holdCode;
    if (choice === "propose_question") Object.assign(changes, { question_key: proposal.question_key, question: { topic: proposal.topic, default_level: proposal.default_level, question_template: { th: proposal.template }, answer_kind: proposal.answer_kind } });
    if (choice === "create" && answer) {
      const question = bank.items.find(item => item.question_key === answer.question_key);
      Object.assign(changes, { faq_id: answer.append ? existing?.id : undefined, answer: { question_key: answer.question_key, scope_type: answer.scope_type, scope_id: answer.scope_id, answer_kind: question?.answer_kind ?? "text",
        question: { th: answer.question }, short_answer: { th: answer.short_answer }, detail: answer.detail.trim() ? { th: answer.detail } : {}, applies_to_project_ids: answer.applies_to_project_ids } });
    }
    setPending(true); setError(""); setNotice("");
    try {
      const value = await request<Detail>(`v1/admin/faq-intake/clusters/${detail.id}/decision`, "POST", { expected_revision: detail.revision, decision: choice, changes });
      setDetail(value); setChoice(null); await load();
      if (choice === "propose_question") await onChanged();
      setNotice(choice === "create" ? "สร้างร่างคำตอบแล้ว ยังไม่เผยแพร่บนเว็บไซต์ ตรวจภาษาอังกฤษในคำตอบก่อนส่งตรวจ" : choice === "propose_question" ? "เสนอคำถามแล้ว รอ Manager อนุมัติในแท็บคำถามมาตรฐาน" : "บันทึกการตัดสินใจแล้ว หลักฐานเดิมยังเก็บไว้");
    } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
  }
  function scopeOptions(kind: string): Reference[] {
    return kind === "corporate" ? [{ id: "sena", name: "SENA" }] : kind === "brand" ? references.brands : kind === "project" ? references.projects : kind === "project_group" ? references.groups : kind === "unit_type" ? references.unit_types : ["LIVNEX", "LIVNEX_GOLD", "RENTNEX", "RENTNEX_BENEFIT", "RENTNEX_INVEST"].map(id => ({ id, name: id }));
  }
  const counts = listing?.counts;
  const canSubmit = choice === "create" ? Boolean(answer?.question_key && answer.scope_id && answer.question.trim() && answer.short_answer.trim() && answer.short_answer.length <= 300 && (answer.scope_type === "corporate" || answer.applies_to_project_ids.length) && !unchanged && (!existing || answer.append))
    : choice === "propose_question" ? /^[a-z][a-z0-9_]{1,100}$/.test(proposal.question_key) && Boolean(proposal.template.trim())
    : Boolean(note.trim());

  return <section className="content-section faq-intake" aria-labelledby="intake-heading">
    <div className="content-toolbar"><h2 id="intake-heading">คัดจากของเดิม</h2>{selected && <button className="button secondary" disabled={pending || Boolean(choice)} onClick={() => { setSelected(null); setNotice(""); }}>กลับรายการกลุ่ม</button>}</div>
    <p className="field-help">ระบบจัดกลุ่มคำถามจากเว็บไซต์ SENA และ KM เดิมที่ถามเรื่องเดียวกัน ตัดสินใจทีละกลุ่ม การตัดสินใจทุกครั้งบันทึกประวัติและไม่เผยแพร่ขึ้นเว็บไซต์</p>
    {counts && <div className="intake-progress"><p role="status">ตัดสินใจแล้ว {counts.decided.toLocaleString("th-TH")} จาก {counts.total.toLocaleString("th-TH")} กลุ่ม · พักไว้ {counts.held.toLocaleString("th-TH")} · รออนุมัติคำถาม {counts.question_proposed.toLocaleString("th-TH")} · ยังไม่ตัดสินใจ {counts.open.toLocaleString("th-TH")}</p><progress max={Math.max(counts.total, 1)} value={counts.decided} aria-label="ความคืบหน้าการคัด" /></div>}
    {error && <p className="notice error" role="alert">{error}{choice ? " ข้อความที่กรอกยังอยู่" : ""}</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {!selected ? <>
      <form className="intake-filters" aria-label="ตัวกรองกลุ่มคำถาม" onSubmit={event => event.preventDefault()}>
        <label className="content-input">สถานะ<select value={filters.state ?? ""} onChange={e => { setFilters({ ...filters, state: e.target.value || undefined }); setCursor([0]); }}><option value="">ทั้งหมด</option>{Object.entries(stateLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="content-input">ระดับที่แนะนำ<select value={filters.level ?? ""} onChange={e => { setFilters({ ...filters, level: e.target.value || undefined }); setCursor([0]); }}><option value="">ทั้งหมด</option>{Object.entries(scopeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="content-input">ประเภทคำตอบ<select value={filters.kind ?? ""} onChange={e => { setFilters({ ...filters, kind: e.target.value || undefined }); setCursor([0]); }}><option value="">ทั้งหมด</option>{Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="content-input">เงื่อนไขที่ต้องตรวจ<select value={filters.hold ?? ""} onChange={e => { setFilters({ ...filters, hold: e.target.value || undefined }); setCursor([0]); }}><option value="">ทั้งหมด</option><option value="none">ไม่มีเงื่อนไข</option>{Object.entries(holdLabels).filter(([k]) => k !== "other").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="content-input">แบรนด์<select value={filters.brand ?? ""} onChange={e => { setFilters({ ...filters, brand: e.target.value || undefined }); setCursor([0]); }}><option value="">ทั้งหมด</option>{listing?.brands.map(b => <option key={b.id} value={b.id}>{b.name} ({b.count})</option>)}</select></label>
      </form>
      {!listing ? !error && <p role="status">กำลังโหลดกลุ่มคำถาม…</p> : <>
        <p className="content-state">พบ {listing.filtered_total.toLocaleString("th-TH")} กลุ่ม{listing.generation ? ` · จัดกลุ่มเมื่อ ${contentDate(listing.generation.generated_at)}` : ""}</p>
        {!counts?.total && <p className="content-empty">ยังไม่มีกลุ่มคำถาม ผู้ดูแลระบบต้องรันการจัดกลุ่มจากข้อมูลเดิมก่อน</p>}
        <div className="content-card-list">{listing.items.map(item => <article className="content-card" key={item.id}>
          <h3>{item.question || item.template}</h3>
          <p className="content-state">{stateLabels[item.status.state]}{item.status.decision ? ` · ${decisionLabels[item.status.decision]}` : ""} · {item.variant_count} คำถาม · {item.answer_group_count} กลุ่มคำตอบ</p>
          <p>แนะนำ: {scopeLabels[item.suggested_level]} · {kindLabels[item.suggested_kind]}{item.suggested_question_key ? ` · ${bank.items.find(q => q.question_key === item.suggested_question_key)?.question_template.th ?? item.suggested_question_key}` : " · ยังไม่ตรงคำถามมาตรฐาน"}</p>
          <p>โครงการ: {item.project_ids.slice(0, 6).map(id => projectName.get(id) ?? id).join(", ") || "ระดับองค์กรหรือโครงการบริการ"}{item.project_ids.length > 6 ? ` และอีก ${item.project_ids.length - 6}` : ""}</p>
          {item.holds.length > 0 && <ul className="intake-holds" aria-label="เงื่อนไขของกลุ่มนี้">{item.holds.map(h => <li key={h}>{holdLabels[h] ?? h}</li>)}</ul>}
          <button className="button secondary" onClick={() => { setSelected(item.id); setNotice(""); }}>เปิดกลุ่ม {item.sort_key}</button>
        </article>)}</div>
        <div className="content-actions"><button className="button secondary" disabled={cursor.length < 2} onClick={() => setCursor(cursor.slice(0, -1))}>หน้าก่อนหน้า</button><button className="button secondary" disabled={!listing.next_after} onClick={() => listing.next_after && setCursor([...cursor, listing.next_after])}>หน้าถัดไป</button></div>
      </>}
    </> : !detail ? !error && <p role="status">กำลังโหลดกลุ่มคำถาม…</p> : <div className="intake-detail">
      <p className="content-state">{stateLabels[detail.status.state]}{detail.status.decision ? ` · ${decisionLabels[detail.status.decision]}` : ""}</p>
      {detail.holds.length > 0 && <ul className="intake-holds" aria-label="เงื่อนไขของกลุ่มนี้">{detail.holds.map(h => <li key={h}>{holdLabels[h] ?? h}</li>)}</ul>}
      {detail.status.faq_id && <p><button className="button secondary" onClick={() => onOpenFaq(detail.status.faq_id!)}>เปิดร่างคำตอบที่สร้าง</button></p>}
      <h3>ข้อเสนอของระบบ</h3>
      <p>{detail.suggestion.question ? `คำถามมาตรฐาน: ${detail.suggestion.question.question_template.th}${detail.suggestion.question.status === "approved" ? "" : " (ยังไม่อนุมัติ)"}` : "ยังไม่ตรงคำถามมาตรฐาน พิจารณาเสนอคำถามใหม่"} · ระดับ {scopeLabels[detail.suggestion.level]} · {kindLabels[detail.suggestion.kind]}</p>
      <h3>คำถามในกลุ่ม ({detail.variants.length})</h3>
      <ul className="intake-variants">{detail.variants.map(v => <li key={v.candidate_id}><p>{v.question}</p><p className="field-help">{sourceLabels[v.source_kind] ?? v.source_kind} · {v.project_ids.map(id => projectName.get(id) ?? id).join(", ") || v.programme_ids.join(", ") || "ไม่ระบุโครงการ"} · {v.source_url ? <a href={v.source_url} target="_blank" rel="noreferrer noopener">หน้าต้นทาง</a> : v.source_ref}</p></li>)}</ul>
      <h3>กลุ่มคำตอบ ({detail.answer_groups.length})</h3>
      <div className="content-card-list">{detail.answer_groups.map((g, n) => <article className="content-card" key={g.group_key}>
        <p className="content-preserve">{g.answer || "ไม่มีคำตอบเดิม"}</p>
        <p className="field-help">ใช้กับ: {g.project_ids.map(id => { const p = detail.projects.find(x => x.id === id); return `${p?.name ?? id} (${id})${p?.closed ? " · ปิดโครงการ" : ""}`; }).join(", ") || "ไม่ระบุโครงการ"} · {g.candidate_ids.length} รายการ</p>
        {canEdit && detail.status.state !== "decided" && !choice && !detail.holds.some(h => blocking.includes(h)) && <button className="button secondary" onClick={() => start("create", g)}>ใช้คำตอบกลุ่ม {n + 1} เป็นต้นร่าง</button>}
      </article>)}</div>
      {canEdit && detail.status.state !== "decided" && !choice && <div className="content-actions">{(Object.keys(choiceLabels) as Choice[]).filter(c => c !== "create" || !detail.holds.some(h => blocking.includes(h))).map(c => <button key={c} className={c === "create" ? "button primary" : "button secondary"} onClick={() => start(c)}>{choiceLabels[c]}</button>)}</div>}
      {detail.holds.some(h => blocking.includes(h)) && detail.status.state !== "decided" && <p className="inline-warning">กลุ่มนี้มีเงื่อนไขที่ต้องแก้ก่อน ใช้ได้เพียงพักไว้หรือไม่ใช้</p>}
      {choice && <form className="intake-decision" onSubmit={event => { event.preventDefault(); void decide(); }}><h3>{choiceLabels[choice]}</h3><fieldset disabled={pending}>
        <fieldset className="content-checks"><legend>คำถามเดิมที่ใช้ในการตัดสินใจ</legend>{detail.variants.map(v => <label key={v.candidate_id}><input type="checkbox" checked={candidates.includes(v.candidate_id)} onChange={e => setCandidates(e.target.checked ? [...candidates, v.candidate_id] : candidates.filter(id => id !== v.candidate_id))} />{v.question}</label>)}</fieldset>
        {choice === "create" && answer && <>
          <label className="content-input">คำถามมาตรฐานที่อนุมัติแล้ว<select required value={answer.question_key} onChange={e => setAnswer({ ...answer, question_key: e.target.value, append: false })}><option value="">เลือกคำถาม</option>{approved.map(q => <option key={q.question_key} value={q.question_key}>{q.question_template.th}</option>)}</select></label>
          {!approved.length && <p className="inline-warning">ยังไม่มีคำถามที่อนุมัติ เสนอคำถามใหม่หรือให้ Manager อนุมัติก่อน</p>}
          <div className="content-two-columns"><label className="content-input">ระดับคำตอบ<select value={answer.scope_type} onChange={e => { const kind = e.target.value; setAnswer({ ...answer, scope_type: kind, scope_id: kind === "corporate" ? "sena" : "", applies_to_project_ids: kind === "project" ? [] : answer.applies_to_project_ids, append: false }); }}>{Object.entries(scopeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="content-input">ขอบเขตคำตอบ<select required value={answer.scope_id} onChange={e => setAnswer({ ...answer, scope_id: e.target.value, applies_to_project_ids: answer.scope_type === "project" ? [e.target.value] : answer.applies_to_project_ids, append: false })}><option value="">เลือกขอบเขต</option>{scopeOptions(answer.scope_type).map(r => <option key={r.id} value={r.id}>{r.name} · {r.id}</option>)}</select></label></div>
          <label className="content-input">เฟส REM ที่คำตอบนี้ใช้<select multiple size={6} disabled={answer.scope_type === "project"} value={answer.applies_to_project_ids} onChange={e => setAnswer({ ...answer, applies_to_project_ids: Array.from(e.target.selectedOptions, o => o.value) })}>{references.projects.map(p => <option key={p.id} value={p.id}>{p.name} · {p.id}{detail.projects.find(x => x.id === p.id)?.closed ? " · ปิดโครงการ" : ""}</option>)}</select><span className="field-help">ระบุเฟสให้ชัดเจน ระดับองค์กรเว้นว่างได้ กฎเลือกเฟสอัตโนมัติจะมาในขั้นถัดไป</span></label>
          {closedSelected && <p className="inline-warning">มีเฟสที่ปิดโครงการแล้ว ห้ามใส่ราคา โปรโมชัน ห้องว่าง หรือเงื่อนไขการขาย</p>}
          {existing && <label className="content-checks"><input type="checkbox" checked={answer.append} onChange={e => setAnswer({ ...answer, append: e.target.checked })} />มีคำตอบสำหรับคำถามและขอบเขตนี้แล้ว ({existing.state}) เพิ่มเป็นฉบับใหม่ของคำตอบเดิม</label>}
          <label className="content-input">คำถามบนเว็บไซต์<textarea rows={2} maxLength={1000} required value={answer.question} onChange={e => setAnswer({ ...answer, question: e.target.value })} /></label>
          <label className="content-input">คำตอบสั้น (ไม่เกิน 300 ตัวอักษร)<textarea rows={3} maxLength={300} required value={answer.short_answer} onChange={e => setAnswer({ ...answer, short_answer: e.target.value })} /><span className="field-help">{answer.short_answer.length}/300 · เริ่มด้วยคำตอบตรงคำถาม ระบุชื่อโครงการหรือแบรนด์ ไม่พิมพ์ตัวเลขที่มีช่องข้อเท็จจริงอยู่แล้ว</span></label>
          <label className="content-input">รายละเอียดคำตอบ<textarea rows={4} maxLength={12000} value={answer.detail} onChange={e => setAnswer({ ...answer, detail: e.target.value })} /></label>
          {unchanged && <p className="inline-warning" role="status">ข้อความเดิมมีราคา ตัวเลข หรือเงื่อนไขการขาย ต้องแก้ไขก่อนบันทึก</p>}
          <p className="field-help">ภาษาอังกฤษร่างและตรวจในหน้าคำตอบหลังสร้าง</p>
        </>}
        {choice === "hold" && <label className="content-input">เหตุผลที่พักไว้<select value={holdCode} onChange={e => setHoldCode(e.target.value)}>{Object.entries(holdLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
        {choice === "propose_question" && <>
          <div className="content-input"><label htmlFor="intake-question-key">รหัสคำถามใหม่</label><input id="intake-question-key" aria-describedby="intake-question-key-help" required pattern="[a-z][a-z0-9_]{1,100}" maxLength={101} value={proposal.question_key} onChange={e => setProposal({ ...proposal, question_key: e.target.value })} /><p id="intake-question-key-help" className="field-help">ตัวอักษรอังกฤษเล็ก ตัวเลข และขีดล่าง เช่น project_garden</p></div>
          <div className="content-two-columns"><label className="content-input">หัวข้อ<select value={proposal.topic} onChange={e => setProposal({ ...proposal, topic: e.target.value })}>{bank.topics.map(t => <option key={t.code} value={t.code}>{t.label.th}</option>)}</select></label>
            <label className="content-input">ระดับคำตอบเริ่มต้น<select value={proposal.default_level} onChange={e => setProposal({ ...proposal, default_level: e.target.value })}>{Object.entries(scopeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>
          <label className="content-input">แม่แบบคำถาม<textarea rows={2} maxLength={1000} required value={proposal.template} onChange={e => setProposal({ ...proposal, template: e.target.value })} /><span className="field-help">ใช้ {"{project}"} แทนชื่อโครงการ และ {"{brand}"} แทนชื่อแบรนด์</span></label>
          <label className="content-input">ประเภทคำตอบ<select value={proposal.answer_kind} onChange={e => setProposal({ ...proposal, answer_kind: e.target.value })}>{Object.entries(kindLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </>}
        <label className="content-input">{choice === "reject" ? "เหตุผลที่ไม่ใช้" : choice === "hold" ? "รายละเอียดที่รอ" : "หมายเหตุ (ถ้ามี)"}<textarea rows={2} maxLength={2000} required={choice === "reject" || choice === "hold"} value={note} onChange={e => setNote(e.target.value)} /></label>
      </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending} onClick={() => setChoice(null)}>ยกเลิก</button><button className="button primary" disabled={pending || !candidates.length || !canSubmit}>บันทึกการตัดสินใจ</button></div></form>}
      {detail.decisions.length > 0 && <><h3>ประวัติการตัดสินใจ</h3><ul className="intake-variants">{detail.decisions.map(d => <li key={d.id}><p>{decisionLabels[d.decision]}{d.hold_code ? ` · ${holdLabels[d.hold_code]}` : ""}{d.faq_version_no ? ` · ฉบับ ${d.faq_version_no}` : ""} · {contentDate(d.decided_at)}</p>{d.note && <p className="content-preserve">{d.note}</p>}</li>)}</ul></>}
    </div>}
  </section>;
}
