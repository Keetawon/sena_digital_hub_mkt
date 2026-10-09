"use client";
import { useHubPermissions } from "./accounts";
import { useState } from "react";
import { request } from "./hub-request";

export type FollowupQuestion = { id: string; question: string; expected_answer: string; candidate_ids: string[]; split: string; holds: string[];
  review?: { revision: number; decision: string; expected_answer: string } | null };
export type PromotionAnnotation = { candidate_id: string; cluster_id: string; cluster_size: number; category: string; likely_expired: boolean; date_unknown: boolean; ocr_end_date: string | null };
export type Followup = { questions?: FollowupQuestion[]; promotions?: PromotionAnnotation[]; preview_releases?: { id: string; created_at: string }[] };
type Candidate = { id: string; kind: string; evidence: Record<string, unknown>; rights_approved?: boolean; review: { revision: number; decision: string; asset_role: string; applies_to_project_ids: string[] } | null };

export function KnowledgeFollowup({ project, items, data, role, onChanged, onKind, onCandidate }: {
  project: string; items: Candidate[]; data?: Followup; role: string; onChanged: () => Promise<void>; onKind: (kind: string) => void; onCandidate: (id: string) => void;
}) {
  const permissions = useHubPermissions();
  const questions = data?.questions ?? [], releases = data?.preview_releases ?? [];
  const [editing,setEditing] = useState<FollowupQuestion | null>(null),[answer,setAnswer] = useState(""),[reason,setReason] = useState("");
  const [decision,setDecision] = useState("verified"),[error,setError] = useState(""),[busy,setBusy] = useState(false);
  const [releaseOpen,setReleaseOpen] = useState(false),[releaseReason,setReleaseReason] = useState(""),[confirmed,setConfirmed] = useState(false);
  const [results,setResults] = useState<{ id: string; route: string; supported: boolean; answer: string }[]>([]);
  const accepted = items.filter(i => i.review?.decision === "accepted" && i.review.applies_to_project_ids.includes(project));
  const heroes = accepted.filter(i => i.kind === "asset" && i.review?.asset_role === "hero");
  const assets = accepted.filter(i => i.kind === "asset");
  const canReview = permissions.can("knowledge", "edit");
  const checklist = [
    ["เนื้อหา","section"], ["คำถามพบบ่อย","faq"], ["ข้อเท็จจริง","fact"], ["ภาพหลัก","hero"], ["แกลเลอรี","gallery"], ["แปลน","plans"], ["โปรโมชั่น","promotion"], ["อนุมัติสิทธิ์เป็นชุด","rights"], ["เผยแพร่สู่พรีวิวส่วนตัว","preview"],
  ];
  function count(key: string) {
    if(key === "hero") return `${heroes.length}/1 ภาพ`;
    if(key === "rights") return `${assets.filter(i=>i.rights_approved).length}/${assets.length} ไฟล์`;
    if(key === "preview") return releases.length ? "มีชุดพรีวิวแล้ว" : "ยังไม่มีชุดพรีวิว";
    const rows=items.filter(i=> key === "gallery" || key === "plans" ? i.kind === "asset" && (key === "gallery" ? (i.review?.asset_role || (["hero","gallery"].includes(String((i.evidence.classification as Record<string,unknown>)?.role)) ? "gallery" : "")) === "gallery" : ["master_plan","floor_plan","unit_plan"].includes(i.review?.asset_role || String((i.evidence.classification as Record<string,unknown>)?.role))) : i.kind === key);
    return `${rows.filter(i=>i.review).length}/${rows.length} ตรวจแล้ว`;
  }
  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault(); if(!editing) return; setBusy(true);setError("");
    try { await request(`v1/admin/knowledge/questions/${encodeURIComponent(editing.id)}/review`,"POST",{expected_revision:editing.review?.revision ?? 0,decision,expected_answer:answer,reason});await onChanged();setEditing(null); }
    catch(e) { setError(e instanceof Error ? e.message : "บันทึกผลตรวจคำถามไม่สำเร็จ"); } finally { setBusy(false); }
  }
  async function createPreview(event: React.FormEvent) {
    event.preventDefault();setBusy(true);setError("");
    try { await request(`v1/admin/knowledge/projects/${encodeURIComponent(project)}/preview-release`,"POST",{expected_reviews:Object.fromEntries(accepted.map(i=>[i.id,i.review!.revision])),reason:releaseReason,confirmed});await onChanged();setReleaseOpen(false);setConfirmed(false); }
    catch(e) {setError(e instanceof Error ? e.message : "สร้างพรีวิวไม่สำเร็จ");} finally {setBusy(false);}
  }
  async function evaluate() {
    if(!releases[0]) return; setBusy(true);setError("");setResults([]);
    try { for(const q of questions.filter(q=>!q.holds.length && q.review?.decision !== "rejected")) {
      const r=await request<{route:string;answer:string;citations?:{candidate_id?:string}[]}>("v1/admin/knowledge/preview","POST",{project_id:project,release_id:releases[0].id,question:q.question});
      setResults(previous=>[...previous,{id:q.id,route:r.route,answer:r.answer,supported:Boolean(r.citations?.some(c=>c.candidate_id && q.candidate_ids.includes(c.candidate_id)))}]);
    }} catch(e) {setError(e instanceof Error ? e.message : "ทดสอบคำตอบไม่สำเร็จ");} finally {setBusy(false);}
  }
  if (!["EKAMI","RAMK","BNA7","TPRAK","SK2TR","BPHGH","HYABC"].includes(project)) return null;
  return <section className="knowledge-followup" aria-label="ตรวจครบวงจรและชุดคำถามทดสอบ">
    {project === "BNA7" && <><h2>รายการตรวจ BNA7 ก่อนส่งพรีวิว</h2><ul className="knowledge-checklist">{checklist.map(([label,key])=><li key={key}><strong>{label}</strong><span>{count(key)}</span>{key !== "preview" && <button onClick={()=>onKind(["hero","gallery","plans","rights"].includes(key)?"asset":key)}>เปิดตรวจ</button>}</li>)}</ul></>}
    <p>ภาพหลักต้องเลือกหนึ่งภาพต่อโครงการหรือระยะ · ภาพที่ต้นทางเสนอเป็นภาพหลักอื่น ๆ เริ่มเป็นข้อเสนอแกลเลอรี</p>
    {permissions.can("knowledge", "approve") && project !== "TPRAK" && <button onClick={()=>{setReleaseOpen(true);setReleaseReason("");setConfirmed(false);}}>ตรวจและยืนยันชุดพรีวิวส่วนตัว</button>}
    {releases.length > 0 && <p>ชุดพรีวิวล่าสุด: <code>{releases[0].id}</code> · ใช้เฉพาะทีมงานในเครื่อง</p>}
    {error && <p role="alert">{error}</p>}
    {releaseOpen && <form onSubmit={createPreview} className="knowledge-item"><h3>ยืนยันพรีวิวส่วนตัวของ {project}</h3><p>เฉพาะเนื้อหาที่ตรวจรับและไฟล์ที่มีสิทธิ์ปัจจุบัน · ภาพหลัก {heroes.length}/1 · {accepted.length} รายการ · ไม่มีการเผยแพร่สู่ผู้บริโภค</p>
      <label>เหตุผลสร้างชุดพรีวิว<textarea value={releaseReason} onChange={e=>setReleaseReason(e.target.value)} required /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} /> ยืนยันชุดและขอบเขตโครงการนี้</label>
      <button disabled={busy || !confirmed || !releaseReason.trim()}>ยืนยันพรีวิวส่วนตัว</button><button type="button" disabled={busy} onClick={()=>setReleaseOpen(false)}>ยกเลิก</button>
    </form>}
    <details><summary>คำถามทดสอบ {questions.length} ข้อ · ฉบับร่าง MKT ต้องตรวจยืนยัน</summary><p>ชุดปรับเกณฑ์: {questions.filter(q=>q.split==='tuning').length} · ชุดทดสอบแยก: {questions.filter(q=>q.split==='held_out').length} · ห้ามใช้ชุดทดสอบแยกปรับเกณฑ์</p>
      {questions.map(q=><article className="knowledge-item" key={q.id}><h3>{q.question}</h3><p>{q.review?.expected_answer || q.expected_answer}</p><p>{q.split==='tuning' ? "ชุดปรับเกณฑ์" : "ชุดทดสอบแยก"} · {q.review?.decision==='verified' ? "MKT ยืนยันแล้ว" : q.review?.decision==='rejected' ? "MKT ระบุว่าต้องแก้" : "ฉบับร่าง · MKT ต้องตรวจยืนยัน"}</p>
        {q.holds.length > 0 && <p className="knowledge-warning">ยังใช้วัดคำตอบไม่ได้ · รอยืนยันขอบเขตระยะหรือเป็นโครงการปิด</p>}
        <ul>{q.candidate_ids.map(id=><li key={id}><button onClick={()=>onCandidate(id)}>เปิดหลักฐาน <code>{id}</code></button></li>)}</ul>
        {canReview && <button disabled={busy} onClick={()=>{setEditing(q);setAnswer(q.review?.expected_answer || q.expected_answer);setReason("");setDecision(q.holds.length?'rejected':'verified');}}>ตรวจคำตอบที่คาดหวัง</button>}
        {editing?.id===q.id && <form onSubmit={saveQuestion}><label>คำตอบที่ MKT ตรวจแล้ว<textarea value={answer} onChange={e=>setAnswer(e.target.value)} required /></label><label>ผลตรวจ<select value={decision} onChange={e=>setDecision(e.target.value)}><option value="verified" disabled={q.holds.length>0}>ยืนยันว่าถูก</option><option value="rejected">ต้องแก้ไข</option></select></label><label>เหตุผลตรวจคำถาม<textarea value={reason} onChange={e=>setReason(e.target.value)} required /></label><button disabled={busy}>บันทึกผลตรวจคำถาม</button><button type="button" onClick={()=>setEditing(null)}>ยกเลิก</button></form>}
      </article>)}
    </details>
    {project==='BNA7' && <><button disabled={busy || !releases.length} onClick={()=>void evaluate()}>ทดสอบคำตอบ BNA7 จากชุดพรีวิวล่าสุด</button><p>ต้องยืนยันชุดพรีวิวก่อน · เทียบแหล่งอ้างอิงกับคำตอบร่าง ผลนี้ยังไม่ใช่คะแนนที่มนุษย์รับรอง</p>{results.length>0 && <div role="status"><p>พบหลักฐานที่คาดหวัง {results.filter(r=>r.supported).length}/{results.length} คำถาม</p>{results.map(r=><details key={r.id}><summary>{r.id} · {r.supported ? "พบหลักฐาน" : "ต้องตรวจคำตอบ"}</summary><p>{r.answer}</p></details>)}</div>}</>}
  </section>;
}
