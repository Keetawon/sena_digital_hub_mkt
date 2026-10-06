"use client";
import { useState } from "react";
import { staffActorLabel } from "@/lib/staff";
import { EntityThumbnail, type Thumbnail } from "./entity-thumbnail";
import { CompletenessBar } from "./completeness-bar";
import "./knowledge-dashboard.css";

export type KnowledgeProject = { project_id: string; thumbnail?: Thumbnail | null; brand_logo?: Thumbnail | null; card: { name: { th: string }; status: { raw: number | null; label: string }; mode: string }; candidates: number;
  progress?: { state: string; staged: number; reviewed: number; pending: Record<string, number>; pending_other: number; conflicts: number; gaps: number; has_legacy_km: boolean; last_reviewed_at: string | null; last_reviewed_by: string | null } };
const states: Record<string, string> = { not_started: "ยังไม่เริ่ม", reviewing: "กำลังตรวจ", complete: "ตรวจครบ", published: "เผยแพร่แล้ว" };
const kinds: Record<string, string> = { section: "เนื้อหา", faq: "คำถามพบบ่อย", fact: "ข้อเท็จจริง", asset: "สื่อ", promotion: "โปรโมชั่น" };
export function KnowledgeDashboard({ projects, onSelect }: { projects: KnowledgeProject[]; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const rows = projects.filter(p => p.progress && (filter === "all" || filter === "pending" && p.progress.reviewed < p.progress.staged || filter === "conflict" && p.progress.conflicts > 0));
  return <section className="knowledge-dashboard" aria-labelledby="knowledge-progress-title"><h2 id="knowledge-progress-title">ความคืบหน้าคลังความรู้</h2>
    <div className="knowledge-dashboard-filters" role="group" aria-label="กรองความคืบหน้าคลังความรู้">{[["all","ทั้งหมด"],["pending","มีรายการรอตรวจ"],["conflict","มีข้อขัดแย้ง"]].map(([key,label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>
    <div className="knowledge-dashboard-scroll" role="region" aria-label="ตารางความคืบหน้าคลังความรู้" tabIndex={0}><table><thead><tr>{["โครงการ","สถานะตรวจ","ความคืบหน้า","รอตรวจตามประเภท","ข้อขัดแย้ง / ข้อมูลขาด","ตรวจล่าสุด"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(p => {
      const s = p.progress!;
      return <tr key={p.project_id}><th scope="row"><div className="entity-list-identity"><EntityThumbnail name={p.card.name.th} image={p.thumbnail} fallback={p.brand_logo} /><div><a href={`/knowledge?project=${encodeURIComponent(p.project_id)}#knowledge-queue`} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); onSelect(p.project_id); } }}>{p.card.name.th}</a><p>{p.project_id}</p></div></div></th>
        <td>{states[s.state] || states.not_started}</td><td>{s.has_legacy_km ? <CompletenessBar label="ตรวจแล้ว" passed={s.reviewed} total={s.staged} /> : <><strong>ไม่มี KM เดิม · ต้องเขียนใหม่</strong><p>ตรวจแล้ว {s.reviewed}/{s.staged} รายการจากแหล่งอื่น</p></>}</td>
        <td><ul>{Object.entries(kinds).map(([kind,label]) => <li key={kind}>{label}: {s.pending[kind] || 0}</li>)}</ul>{s.pending_other > 0 && <small>อื่น ๆ: {s.pending_other}</small>}</td>
        <td>ข้อขัดแย้ง {s.conflicts}<br />ข้อมูลขาด {s.gaps}</td>
        <td>{s.last_reviewed_at ? <><time dateTime={s.last_reviewed_at}>{new Intl.DateTimeFormat("th-TH", { dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Bangkok" }).format(new Date(s.last_reviewed_at))}</time><p>{staffActorLabel(s.last_reviewed_by || "",true)}</p></> : "ยังไม่มีการตรวจ"}</td>
      </tr>;
    })}</tbody></table></div>{!rows.length && <p>ไม่มีโครงการตรงกับตัวกรอง</p>}
    <p className="field-help">นับทุกผลตรวจ รวมรายการที่ผิดหรือขาด · ตรวจครบยังไม่ใช่การเผยแพร่</p>
  </section>;
}
