"use client";
import { useCallback, useEffect, useState } from "react";
import { useHubPermissions } from "./accounts";
import { request } from "./hub-request";
import { contentDate, errorMessage, type Locales } from "./content-common";
import "./faq-coverage.css";

const states: Record<string, string> = { published: "เผยแพร่แล้ว", inherited: "ใช้คำตอบจากระดับอื่น", draft: "ฉบับร่าง", waiting_for_fact: "รอข้อเท็จจริง", legacy_candidate: "มีคำตอบเดิมให้คัด", hold: "พักไว้ตรวจ", missing: "ยังไม่มีคำตอบ", not_applicable: "ไม่ใช้กับโครงการนี้" };
const reasons: Record<string, string> = { unknown_property_form: "ยังไม่ทราบประเภทที่อยู่อาศัย", property_type: "ประเภทที่อยู่อาศัยไม่ตรง", question_not_approved: "คำถามยังไม่อนุมัติ", same_level_conflict: "มีคำตอบซ้ำในระดับเดียวกัน", internal: "ข้อมูลใช้ภายใน", answer_expired: "คำตอบหมดอายุ", review_due: "ถึงกำหนดตรวจคำตอบ", missing_fact: "ข้อเท็จจริงยังไม่พร้อม", short_answer_length: "คำตอบสั้นต้องมีข้อความและไม่เกิน 300 ตัวอักษร", name_required: "ระบุชื่อโครงการหรือแบรนด์ในคำตอบ", direct_answer_required: "เริ่มด้วยคำตอบตรงคำถาม", use_fact_slots_for_numbers: "ใช้ช่องข้อเท็จจริงแทนการพิมพ์ตัวเลข", fact_keys_required: "เลือกช่องข้อเท็จจริง", sales_handoff_required: "ส่งต่อฝ่ายขายสำหรับห้องว่างหรือค่างวด", unknown_fact_slot: "มีช่องแทนค่าที่ยังไม่เชื่อม", resolved_answer_too_long: "คำตอบหลังเติมข้อมูลเกิน 300 ตัวอักษร", applicability_changed: "รายชื่อเฟสเปลี่ยน กรุณาบันทึกและตรวจใหม่" };
function reason(value: string) { return reasons[value] ?? (value.startsWith("unused_fact_slot:") ? `ยังไม่ใส่ช่อง ${value.slice(17)} ในข้อความ` : value); }
type Project = { public_id: string; rem_project_id: string; name: Locales };
type Cell = { question_key: string; question_label: string; state: string; faq_id?: string; reason?: string; lint?: string[]; missing_fact_keys?: string[]; inherited?: boolean; legacy?: { cluster_id: string } };
type Coverage = { questions: { question_key: string; label: Locales }[]; rows: { project: Project; cells: Cell[]; ready: boolean }[]; total: number; offset: number; next_offset: number | null };
type Fact = { field_key: string; text: string; as_of: string; basis?: Locales | string; condition_text?: Locales; valid_to?: string; disclaimer?: string };
function basisText(value: Fact["basis"], locale: string) { return typeof value === "string" ? value : value?.[locale as "th" | "en"] || value?.th; }
function ownerName(value: string) { return value === "Marketing" ? "การตลาด" : value; }
type Preview = { project: Project; ready: boolean; items: (Cell & { question: string; short_answer: string; detail: string; as_of_label: string | null; facts: Fact[]; is_fallback_locale: boolean })[]; hidden: Cell[]; conflicts: { question_key: string }[] };
type Gap = { id: string; revision: number; state: "open" | "in_progress" | "resolved"; assignee: string | null; suggested_owner: string; occurrences: number; last_seen: string; missing_fact_keys: string[]; question_label: Locales; project_name: Locales; public_project_id: string };
type Unit = { public_commercial_type_id: string; public_name: Locales };

export function FaqCoverage({ onOpenFaq }: { onOpenFaq: (id: string) => void }) {
  const permissions = useHubPermissions(), canView = permissions.can("knowledge", "view") && permissions.can("projects", "view"), canEdit = permissions.can("knowledge", "edit");
  const [data, setData] = useState<Coverage | null>(null), [gaps, setGaps] = useState<Gap[]>([]), [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState(""), [locale, setLocale] = useState("th"), [unit, setUnit] = useState(""), [units, setUnits] = useState<Unit[]>([]);
  const [offset, setOffset] = useState(0), [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const reload = useCallback(async () => {
    if (!canView) return;
    // Composition refreshes deduplicated gaps, so read their revisions afterwards.
    const coverage = await request<Coverage>(`v1/admin/faq-coverage?offset=${offset}&limit=10`);
    const value = selected ? await request<Preview>(`v1/admin/faq-composition/${selected}?locale=${locale}${unit ? `&unit_type=${unit}` : ""}`) : null;
    const tasks = await request<Gap[]>(`v1/admin/faq-gaps${selected ? `?project=${selected}` : ""}`);
    return { coverage, value, tasks };
  }, [canView, offset, selected, locale, unit]);
  useEffect(() => {
    let active = true; setData(null); setPreview(null); setGaps([]); setError("");
    if (!canView) { setPending(false); return; }
    setPending(true);
    reload().then(result => { if (active && result) { setData(result.coverage); setPreview(result.value); setGaps(result.tasks); } }).catch(error => { if (active) setError(errorMessage(error)); }).finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [reload, canView]);
  useEffect(() => {
    let active = true; setUnits([]);
    if (selected && canView) request<{ types: Unit[] }>(`v1/admin/projects/${selected}/unit-types`).then(data => { if (active) setUnits(data.types); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [selected, canView]);
  async function refresh() {
    setPending(true); setError("");
    try { const result = await reload(); if (result) { setData(result.coverage); setPreview(result.value); setGaps(result.tasks); } } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  async function claim(gap: Gap, assign: boolean) {
    setPending(true); setError(""); setNotice("");
    try { await request(`v1/admin/faq-gaps/${gap.id}`, "PATCH", { expected_revision: gap.revision, state: assign ? "in_progress" : "open", assign_self: assign }); const result = await reload(); if (result) { setData(result.coverage); setPreview(result.value); setGaps(result.tasks); } setNotice(assign ? "รับงานแล้ว" : "คืนงานแล้ว"); }
    catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  if (!canView) return <section className="content-section"><h2>ความครบของ FAQ</h2><p>ต้องมีสิทธิ์ดูคลังความรู้และโครงการเพื่อดูข้อเท็จจริงประกอบคำตอบ</p></section>;
  function cellContent(cell: Cell) { return <><span className="content-state">{states[cell.state]}</span>{cell.reason && <p>{reason(cell.reason)}</p>}{cell.lint?.map(item => <p key={item}>{reason(item)}</p>)}{cell.faq_id && <button className="button secondary" disabled={pending} onClick={() => onOpenFaq(cell.faq_id!)}>เปิดคำตอบ</button>}{cell.legacy && <a className="button secondary" href="/faq?tab=intake">คัดคำตอบเดิม</a>}</>; }
  return <div className="content-card-list">
    <section className="content-section" aria-label="ความครบของ FAQ"><div className="content-toolbar"><h2>ความครบของ FAQ</h2><button className="button secondary" disabled={pending} onClick={() => void refresh()}>ตรวจข้อมูลล่าสุด</button></div>
      <p>โครงการ × คำถามหลัก · รวมฉบับร่างภายใน Hub ตัวอย่างนี้ยังไม่เผยแพร่เว็บไซต์ ข้อมูลที่ขาดหรือหมดอายุจะซ่อนคำตอบและเปิดงานให้เจ้าของข้อมูล</p>
      {error && <p className="notice error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{pending && <p role="status">กำลังตรวจความครบ…</p>}
      {data && <><div className="faq-coverage-scroll" tabIndex={0} role="region" aria-label="ตารางความครบตามโครงการ"><table className="faq-coverage-table"><caption>สถานะคำถามหลัก {data.questions.length} ข้อ · {data.total} โครงการ</caption><thead><tr><th scope="col">โครงการ</th>{data.questions.map(question => <th scope="col" key={question.question_key}>{question.label.th}</th>)}</tr></thead><tbody>{data.rows.map(row => <tr key={row.project.public_id}><th scope="row"><button className="button secondary" disabled={pending} onClick={() => { setSelected(row.project.public_id); setUnit(""); }}>{row.project.name.th}</button></th>{data.questions.map(question => { const cell = row.cells.find(cell => cell.question_key === question.question_key); return <td key={question.question_key} data-label={question.label.th}>{cell && cellContent(cell)}</td>; })}</tr>)}</tbody></table></div>{!data.rows.length && <p className="content-empty">ยังไม่มีโครงการให้ตรวจ</p>}<div className="content-actions"><button className="button secondary" disabled={pending || offset === 0} onClick={() => setOffset(Math.max(0, offset - 10))}>หน้าก่อน</button><button className="button secondary" disabled={pending || data.next_offset === null} onClick={() => setOffset(data.next_offset!)}>หน้าถัดไป</button></div></>}
    </section>
    {selected && <section className="content-section" aria-label="ตัวอย่าง FAQ ของโครงการ"><div className="content-toolbar"><h2>ตัวอย่าง FAQ ของโครงการ</h2><button className="button secondary" disabled={pending} onClick={() => { setSelected(""); setUnit(""); }}>ปิดตัวอย่าง</button></div><div className="content-two-columns"><label className="content-input">ภาษาของคำตอบ<select disabled={pending} value={locale} onChange={event => setLocale(event.target.value)}><option value="th">ไทย</option><option value="en">อังกฤษ</option></select></label><label className="content-input">แบบห้องหรือแบบบ้านในตัวอย่าง<select disabled={pending} value={unit} onChange={event => setUnit(event.target.value)}><option value="">ทั้งโครงการ</option>{units.map(item => <option key={item.public_commercial_type_id} value={item.public_commercial_type_id}>{item.public_name.th || item.public_commercial_type_id}</option>)}</select></label></div>
      {preview && <><h3>{preview.project.name.th}</h3>{!preview.ready && <p className="inline-warning">ต้องแก้รายการพักไว้ก่อนส่งเผยแพร่</p>}<div className="content-card-list">{preview.items.map(item => <article className="content-card" key={item.question_key} lang={locale}><h3>{item.question}</h3>{cellContent(item)}<p className="content-preserve">{item.short_answer}</p><p className="content-preserve">{item.detail}</p>{item.as_of_label && <p>{item.as_of_label}</p>}{item.is_fallback_locale && <p className="inline-warning">บางข้อความใช้ภาษาไทยแทนคำแปลที่ยังไม่มี</p>}{item.facts.map(fact => <div key={fact.field_key}><p>{fact.text} · {contentDate(fact.as_of)}</p>{basisText(fact.basis, locale) && <p>{basisText(fact.basis, locale)}</p>}{fact.condition_text && <p>{fact.condition_text[locale as "th" | "en"] || fact.condition_text.th}</p>}{fact.valid_to && <p>ใช้ได้ถึง {contentDate(fact.valid_to)}</p>}{fact.disclaimer && <p>{fact.disclaimer}</p>}</div>)}</article>)}</div>{!preview.items.length && <p>ยังไม่มีคำตอบที่พร้อมแสดงในตัวอย่าง</p>}{preview.hidden.length > 0 && <div><h3>คำตอบที่ซ่อนจากตัวอย่าง</h3>{preview.hidden.map(item => <p key={item.question_key}>{item.question_label} · {reason(item.reason ?? "missing_fact")} {item.missing_fact_keys?.join(", ")}</p>)}</div>}</>}
    </section>}
    <section className="content-section" aria-label="งานข้อเท็จจริงที่ขาด"><h2>งานข้อเท็จจริงที่ขาด</h2><p>ระบบรวมงานตามโครงการและคำถาม ตรวจข้อมูลล่าสุดอีกครั้งหลังเติมข้อเท็จจริงเพื่อปิดงานที่แก้แล้ว</p><div className="content-card-list">{gaps.map(gap => <article className="content-card" key={gap.id}><h3>{gap.question_label.th}</h3><p>{gap.project_name.th} · ผู้รับผิดชอบ: {ownerName(gap.suggested_owner)}</p><p>{gap.state === "resolved" ? "แก้ครบแล้ว" : gap.state === "in_progress" ? "กำลังดำเนินการ" : "รอดำเนินการ"} · พบ {gap.occurrences} ครั้ง · ล่าสุด {contentDate(gap.last_seen)}</p><p>{gap.missing_fact_keys.join(", ")}</p><div className="content-actions"><a className="button secondary" href={`/content?project=${gap.public_project_id}&tab=facts`}>เปิดข้อเท็จจริงของโครงการ</a>{canEdit && gap.state !== "resolved" && (!gap.assignee || gap.assignee === permissions.account?.id) && <button className="button secondary" disabled={pending} onClick={() => void claim(gap, !gap.assignee)}>{gap.assignee ? "คืนงาน" : "รับงานนี้"}</button>}{gap.assignee && gap.assignee !== permissions.account?.id && <p>มีผู้รับงานแล้ว</p>}</div></article>)}</div>{!gaps.length && !pending && <p className="content-empty">ยังไม่พบงานข้อเท็จจริงที่ขาด</p>}</section>
  </div>;
}
