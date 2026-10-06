"use client";
import { useEffect, useRef, useState } from "react";
import "./knowledge-review.css";
type Json = Record<string, unknown>;
type Card = { name: { th: string }; status: { raw: number | null; label: string }; mode: string };
type Review = { revision: number; decision: string; applies_to_project_ids: string[]; sena_owned: boolean; asset_role: string; alt_th: string };
type Item = { id: string; kind: string; source_url: string | null; source_ref: string; project_ids: string[]; holds: string[]; evidence: Json; review: Review | null; bulk_rights_eligible: boolean };
type Pack = { card: Card; items: Item[] };
const kinds: Record<string, string> = { section: "เนื้อหา", faq: "คำถามพบบ่อย", fact: "ข้อเท็จจริง", facility: "สิ่งอำนวยความสะดวก", nearby: "สถานที่ใกล้เคียง", alias: "ชื่อเรียก", asset: "รูปและเอกสาร", promotion: "โปรโมชั่น", gap: "ข้อมูลที่ยังขาด", programme: "กติกาโปรแกรม" };
const roles: Record<string, string> = { hero: "ภาพหลัก", gallery: "แกลเลอรี", master_plan: "ผังโครงการ", floor_plan: "แปลนชั้น", unit_plan: "แปลนห้อง", brochure: "โบรชัวร์", promotion_banner: "ภาพโปรโมชั่น", unclassified: "ยังไม่ระบุประเภท" };
const holds: Record<string, string> = { needs_phase_decision: "รอ MKT ระบุระยะโครงการ", numeric_claim: "ตัวเลขรอตรวจในข้อมูลโครงสร้าง", commercial_text: "เงื่อนไขการขายรอเจ้าของข้อมูล", mapping_conflict: "การจับคู่ข้อมูลขัดแย้ง", prompt_injection: "ข้อความคำสั่งแปลกปลอมถูกแยกไว้", undated_promotion: "ยังไม่มีช่วงวันที่โปรโมชั่น", invalid_promotion: "กักไว้: ตัวเลขหรือเงื่อนไขยังไม่ชัดเจน" };
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/hub/v1/admin/knowledge/${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json(); if (!response.ok) throw new Error(json.error?.message || "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่"); return json.data;
}
function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "th" in value) return String((value as { th: unknown }).th);
  return value == null ? "ยังไม่มีข้อมูล" : JSON.stringify(value, null, 2);
}
export function KnowledgeReview({ role }: { role: string }) {
  const [projects, setProjects] = useState<{ project_id: string; card: Card; candidates: number }[]>([]);
  const [project, setProject] = useState(""); const [pack, setPack] = useState<Pack | null>(null);
  const [kind, setKind] = useState("section"); const [page, setPage] = useState(1);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Item | null>(null); const [choice, setChoice] = useState("accepted");
  const [scope, setScope] = useState<string[]>([]); const [reason, setReason] = useState(""); const [owned, setOwned] = useState(false);
  const [assetRole, setAssetRole] = useState("gallery"); const [alt, setAlt] = useState("");
  const [rights, setRights] = useState(false); const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState<Json | null>(null);
  const dialog = useRef<HTMLDialogElement>(null); const opener = useRef<HTMLElement | null>(null);
  const canEdit = role === "editor" || role === "admin";
  useEffect(() => { let current = true; api<typeof projects>("projects").then(rows => { if (current) { setProjects(rows); setProject(rows[0]?.project_id || ""); } }).catch(e => setError(e.message)); return () => { current = false; }; }, []);
  useEffect(() => {
    if (!project) return; let current = true; setPack(null); setPage(1); setSelected(new Set()); setAnswer(null);
    api<Pack>(`projects/${encodeURIComponent(project)}`).then(value => { if (current) setPack(value); }).catch(e => { if (current) setError(e.message); }); return () => { current = false; };
  }, [project]);
  useEffect(() => { if (editing || rights) dialog.current?.showModal(); else dialog.current?.close(); }, [editing, rights]);
  async function reload() { setPack(await api<Pack>(`projects/${encodeURIComponent(project)}`)); }
  function close() { setEditing(null); setRights(false); opener.current?.focus(); }
  function start(item: Item, decision: string, trigger: HTMLElement) {
    opener.current = trigger; setEditing(item); setChoice(decision); setReason(""); setOwned(item.review?.sena_owned || false);
    setScope(item.review?.applies_to_project_ids || (item.holds.includes("needs_phase_decision") ? [] : item.project_ids.filter(p => p !== "TPRAK")));
    const classification = item.evidence.classification as Json | undefined;
    setAssetRole(item.review?.asset_role || String(classification?.role || "gallery")); setAlt(item.review?.alt_th || String(classification?.alt_th || ""));
  }
  async function saveReview() {
    setBusy(true); setError("");
    try {
      if (rights) { await api("rights/approve", { items: pack!.items.filter(i => selected.has(i.id)).map(i => ({ candidate_id: i.id, expected_revision: i.review!.revision })), reason, confirmed: true }); setNotice("อนุมัติสิทธิ์ไฟล์แล้ว ยังไม่มีการเผยแพร่เนื้อหา"); setSelected(new Set()); }
      else if (editing) { await api(`candidates/${editing.id}/review`, { expected_revision: editing.review?.revision || 0, decision: choice, applies_to_project_ids: scope, reason, sena_owned: owned, asset_role: editing.kind === "asset" ? assetRole : null, alt_th: editing.kind === "asset" ? alt : null }); setNotice("บันทึกผลตรวจแล้ว รายการที่ถูกต้องเป็นฉบับร่างเท่านั้น"); }
      await reload(); close();
    } catch (e) { setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ"); } finally { setBusy(false); }
  }
  const filtered = (pack?.items || []).filter(item => item.kind === kind);
  return <section className="knowledge-page">
    <header><p>คลังความรู้โครงการ · พื้นที่ส่วนตัวในเครื่อง</p><h1>ตรวจข้อมูลก่อนนำเข้า</h1><p>ตรวจเนื้อหา ระบุระยะโครงการ และยืนยันแหล่งที่มา ข้อมูลทั้งหมดเป็นหลักฐานหรือฉบับร่าง ยังไม่มีการเผยแพร่</p></header>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="knowledge-controls"><label>โครงการหรือระยะ<select value={project} onChange={e => setProject(e.target.value)}>{projects.map(p => <option key={p.project_id} value={p.project_id}>{p.card.name.th} · {p.project_id}</option>)}</select></label><label>ประเภทข้อมูล<select value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label} ({pack?.items.filter(i => i.kind === key).length || 0})</option>)}</select></label></div>
    {!project && !error && <p>ยังไม่มีชุดข้อมูลนำร่องที่นำเข้าแล้ว</p>}{project && !pack && <p role="status">กำลังโหลดชุดตรวจข้อมูล…</p>}
    {pack && <><div className="knowledge-status"><strong>{pack.card.name.th}</strong><span>สถานะ REM: {pack.card.status.label} ({pack.card.status.raw ?? "ไม่ทราบค่า"})</span></div>
      {project === "TPRAK" && <p className="knowledge-warning">ระยะนี้ปิดโครงการแล้ว ห้ามผูกเนื้อหาการขาย โปรโมชั่น หรือข้อเท็จจริงปัจจุบันจากหน้าร่วมกับ SK2TR</p>}
      <div className="knowledge-controls"><p>พบ {filtered.length} รายการ · หน้า {page} จาก {Math.max(1, Math.ceil(filtered.length / 10))}</p><button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>หน้าก่อนหน้า</button><button disabled={page * 10 >= filtered.length} onClick={() => setPage(p => p + 1)}>หน้าถัดไป</button>{role === "publisher" && kind === "asset" && <button disabled={!selected.size || busy} onClick={e => { opener.current = e.currentTarget; setRights(true); setReason(""); }}>อนุมัติสิทธิ์ที่เลือก ({selected.size})</button>}</div>
      {!filtered.length && <p>ยังไม่มีรายการประเภทนี้ในชุดข้อมูล</p>}
      <div className={kind === "asset" ? "knowledge-assets" : "knowledge-items"}>{filtered.slice((page - 1) * 10, page * 10).map(item => {
        const e = item.evidence; const classification = e.classification as Json | undefined; const blocked = item.holds.some(h => h !== "needs_phase_decision");
        return <article className="knowledge-item" key={item.id}><h2>{item.kind === "asset" ? roles[String(classification?.role)] || "ไฟล์รอตรวจ" : text(e.title || e.canonical_question || e.alias || e.fact_key || e.gap_code || kinds[item.kind])}</h2>
          {item.kind === "asset" ? <><a href={`/api/hub/v1/admin/knowledge/candidates/${item.id}/file`} target="_blank" rel="noreferrer">{String(e.mime).startsWith("image/") && e.mime !== "image/svg+xml" ? <img loading="lazy" src={`/api/hub/v1/admin/knowledge/candidates/${item.id}/file`} alt={String(classification?.alt_th || "ภาพรอตรวจสอบ")} /> : "ดาวน์โหลดต้นฉบับเพื่อตรวจ"}</a><p>{String(classification?.alt_th || "")}</p><p>บุคคล: {classification?.people === "absent" ? "ไม่พบ" : "ต้องตรวจ"} · เครื่องหมายบุคคลอื่น: {classification?.third_party_marks === "absent" ? "ไม่พบ" : "ต้องตรวจ"} · ภาพสต็อก: {classification?.stock_imagery === "absent" ? "ไม่พบ" : "ต้องตรวจ"}</p>{!!e.file_validation_error && <p>{String(e.file_validation_error)}</p>}</> : <div className="knowledge-copy">{text(e.body || e.short_answer || e.source_value || e.detail || e.benefit || e.alias)}</div>}
          {item.kind === "promotion" && <><p>เงื่อนไข: {text(e.conditions)}</p><p>วันที่เริ่ม: {text(e.valid_from)} · วันที่สิ้นสุด: {text(e.valid_to)}</p><p>ตัวเลขที่อ่านจากภาพ (ยังไม่ยืนยัน): {text(e.verbatim_numeric_text)}</p><p>จุดที่ต้องตรวจ: {text(e.uncertainty)}</p><a href="/promotions">เปิดโมดูลโปรโมชั่นเพื่อตรวจและกรอกข้อมูลที่ยืนยันแล้ว</a></>}
          {item.holds.length > 0 && <ul className="knowledge-warning">{item.holds.map(h => <li key={h}>{holds[h] || "รอตรวจสอบข้อมูลต้นทาง"}</li>)}</ul>}
          <p>ระยะที่อ้างถึง: {item.project_ids.join(", ") || "ยังไม่ระบุโครงการ"}</p><p className="knowledge-source">{item.source_url && /^https:\/\//.test(item.source_url) ? <a href={item.source_url} target="_blank" rel="noreferrer">เปิดแหล่งข้อมูล</a> : "หลักฐานจากชุดนำเข้า"} · <code>{item.source_ref}</code></p>
          <p>ผลตรวจ: {item.review ? ({ accepted: "ถูก · ฉบับร่าง", rejected: "ผิด · เก็บหลักฐานเดิม", missing: "ขาด · รอผู้รับผิดชอบ" }[item.review.decision] || "รอตรวจ") : "รอตรวจ"}</p>
          {canEdit && <div className="knowledge-actions"><button disabled={busy || blocked || project === "TPRAK"} onClick={ev => start(item, "accepted", ev.currentTarget)}>ถูก</button><button disabled={busy} onClick={ev => start(item, "rejected", ev.currentTarget)}>ผิด</button><button disabled={busy} onClick={ev => start(item, "missing", ev.currentTarget)}>ขาด</button></div>}
          {role === "publisher" && item.kind === "asset" && <label><input type="checkbox" disabled={!item.bulk_rights_eligible || busy} checked={selected.has(item.id)} onChange={ev => setSelected(previous => { const next = new Set(previous); if (ev.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /> เลือกอนุมัติสิทธิ์{!item.bulk_rights_eligible && <small> · ต้องให้ MKT ยืนยันว่าเป็นไฟล์ของ SENA และไม่มีธงรอตรวจ</small>}</label>}
        </article>;
      })}</div>
      <section className="knowledge-preview"><h2>ทดลองคำตอบจากคลังความรู้ฉบับร่าง</h2><p>ใช้ตรวจคุณภาพภายในเท่านั้น ราคา ห้องว่าง และเงื่อนไขที่ยังไม่ยืนยันจะส่งต่อเจ้าหน้าที่</p><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { setAnswer(await api<Json>("preview", { question, project_id: project })); } catch (e) { setError(e instanceof Error ? e.message : "ทดลองคำตอบไม่สำเร็จ"); } finally { setBusy(false); } }}><label>คำถามทดลอง<textarea value={question} onChange={e => setQuestion(e.target.value)} required maxLength={1500} /></label><button disabled={busy || !question.trim()}>{busy ? "กำลังตรวจข้อมูล…" : "ทดลองคำตอบ"}</button></form>{answer && <div role="status" className="knowledge-answer"><p><strong>ตัวอย่างฉบับร่าง · ยังไม่เผยแพร่</strong></p><p>{String(answer.answer)}</p>{Array.isArray(answer.citations) && answer.citations.map((c: Json, i: number) => <p key={i}>อ้างอิง: {String(c.source_ref)}</p>)}</div>}</section>
    </>}
    <dialog ref={dialog} className="knowledge-dialog" onCancel={close} onClose={close}><form onSubmit={e => { e.preventDefault(); void saveReview(); }}><h2>{rights ? `ยืนยันอนุมัติสิทธิ์ ${selected.size} ไฟล์` : "ยืนยันผลตรวจข้อมูล"}</h2>{error && <p role="alert">{error}</p>}
      {rights ? <><p>อนุมัติเฉพาะไฟล์ที่ MKT ยืนยันว่า SENA เป็นเจ้าของและไม่มีธงรอตรวจ การอนุมัติสิทธิ์ไม่เผยแพร่เนื้อหา</p><ul>{pack?.items.filter(i => selected.has(i.id)).map(i => <li key={i.id}>{text((i.evidence.classification as Json)?.alt_th)} · {i.review?.applies_to_project_ids.join(", ")}</li>)}</ul></> : editing && <><p>ผลตรวจ: {choice === "accepted" ? "ถูก — สร้างหรือปรับฉบับร่าง" : choice === "rejected" ? "ผิด — เก็บหลักฐานเดิม" : "ขาด — บันทึกรายการที่ต้องเติม"}</p><fieldset><legend>เลือกโครงการที่ใช้ข้อมูลนี้ได้อย่างชัดเจน</legend>{editing.project_ids.map(pid => <label key={pid}><input type="checkbox" checked={scope.includes(pid)} disabled={pid === "TPRAK" && choice === "accepted"} onChange={e => setScope(p => e.target.checked ? [...p, pid] : p.filter(id => id !== pid))} /> {pid}{pid === "TPRAK" && " · ปิดโครงการแล้ว"}</label>)}</fieldset>{editing.kind === "asset" && <><label>ประเภทไฟล์<select value={assetRole} onChange={e => setAssetRole(e.target.value)}>{Object.entries(roles).filter(([k]) => k !== "unclassified").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>คำอธิบายภาพภาษาไทย<textarea value={alt} onChange={e => setAlt(e.target.value)} required /></label><label><input type="checkbox" checked={owned} onChange={e => setOwned(e.target.checked)} /> MKT ยืนยันว่าเป็นไฟล์เว็บไซต์ที่ SENA เป็นเจ้าของ</label></>}</>}
      <label>เหตุผลและสิ่งที่ตรวจแล้ว<textarea value={reason} onChange={e => setReason(e.target.value)} required maxLength={2000} /></label><div className="knowledge-actions"><button type="button" onClick={close} disabled={busy}>ยกเลิก</button><button disabled={busy || !reason.trim()}>{busy ? "กำลังบันทึก…" : rights ? "ยืนยันอนุมัติสิทธิ์" : "ยืนยันผลตรวจ"}</button></div></form></dialog>
  </section>;
}
