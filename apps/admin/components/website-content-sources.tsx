"use client";
import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { errorMessage } from "./content-common";

type Item = { id: string; kind: string; value: unknown; source: { page_url: string; fetched_at: string };
  wiring: { project_id: string; outcome: string; reason?: string }[]; holds: string[] };
const labels: Record<string, string> = { concept: "แนวคิด", concept_name: "ชื่อแนวคิด", description: "แนะนำโครงการ",
  project_information: "ข้อมูลโครงการ", facilities: "ส่วนกลาง", nearby: "ทำเลและการเดินทาง", contacts: "ช่องทางติดต่อ",
  call_centres: "คอลเซ็นเตอร์", unit_types: "แบบที่อยู่อาศัย", floor_plans: "ผังชั้น", unit_plans: "แปลนแบบที่อยู่อาศัย",
  construction: "ความคืบหน้าก่อสร้าง", disclosures: "รายละเอียดและเงื่อนไขโครงการ", promotion_terms: "เงื่อนไขโปรโมชัน",
  tours: "ทัวร์ 360", videos: "วิดีโอ" };
function sourceText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(sourceText).filter(Boolean).join(" · ");
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return ["label", "name", "heading", "text", "value", "detail", "size_text", "rooms", "count_text", "location_label", "component_label", "percent_text", "url"]
      .filter(key => row[key] !== undefined).map(key => sourceText(row[key])).filter(Boolean).join(" · ");
  }
  return "";
}
export function WebsiteContentSources({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Item[] | null>(null), [error, setError] = useState(""), [kind, setKind] = useState("");
  useEffect(() => { let live = true;
    request<Item[]>(`v1/admin/projects/${encodeURIComponent(projectId)}/content/website`).then(value => { if (live) setItems(value); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [projectId]);
  const visible = items?.filter(item => !kind || item.kind === kind) ?? [];
  return <section className="content-section"><h2>ข้อมูลจากเว็บไซต์ที่รอตรวจ</h2>
    <p>ข้อมูลต้นทางเป็นคำแนะนำและฉบับร่าง ยังไม่ใช่ข้อมูลที่ยืนยันหรือเผยแพร่ ราคาในหลักฐานไม่ใช่ราคาขายที่อนุมัติ</p>
    <p>ข้อมูลที่มีอยู่เดิมยังคงเดิม หากขัดกัน ให้ตรวจหลักฐานก่อนแก้ไขในส่วนเนื้อหาที่เกี่ยวข้อง</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {!items && !error && <p role="status">กำลังโหลดหลักฐาน…</p>}
    {items && <><label className="content-input">ประเภทข้อมูล<select value={kind} onChange={e => setKind(e.target.value)}><option value="">ทั้งหมด</option>
      {Object.entries(labels).filter(([key]) => items.some(item => item.kind === key)).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select></label><p>{visible.length} รายการ</p>
      {visible.map(item => <details className="content-section" key={item.id}><summary>{labels[item.kind] ?? "ข้อมูลโครงการ"} · {sourceText(item.value).slice(0, 100)}</summary>
        <p>ดึงจากเว็บไซต์สาธารณะ SENA · <a href={item.source.page_url} target="_blank" rel="noreferrer">ดูหน้าอ้างอิง</a></p>
        <p>ดึงข้อมูลเมื่อ {new Date(item.source.fetched_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{sourceText(item.value)}</p>
        <p>{item.wiring.some(row => row.outcome === "conflict") ? "มีข้อมูลเดิมอยู่แล้ว · เก็บข้อความนี้ไว้เป็นหลักฐานเพื่อเปรียบเทียบ" : item.wiring.some(row => row.outcome === "draft") ? "สร้างฉบับร่างภายในแล้ว · ต้องตรวจข้อมูลก่อนใช้" : "รอตรวจและจับคู่กับข้อมูลโครงการ"}</p>
        {item.holds.includes("needs_phase_decision") && <p className="inline-warning">หน้าเว็บใช้ร่วมหลายระยะ ต้องยืนยันว่าข้อมูลนี้ใช้กับระยะใด</p>}
        {item.kind === "construction" && <p>ยังไม่ทราบวันที่ข้อมูลก่อสร้าง วันที่ดึงข้อมูลไม่ใช่วันที่ความคืบหน้า</p>}
        {item.kind === "nearby" && <p>ระยะทางจากหน้าเว็บยังไม่ยืนยัน และยังไม่ได้ระบุวิธีวัด</p>}
      </details>)}
      {!visible.length && <p>ยังไม่มีข้อมูลเว็บไซต์ในรายการนี้</p>}
    </>}
  </section>;
}
