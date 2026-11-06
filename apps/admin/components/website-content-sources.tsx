"use client";
import { useCallback, useEffect, useState } from "react";
import { request } from "./hub-request";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { workspaceText as text } from "@/lib/unified-workspace";
import { ExposureChip } from "./content-exposure";
import { errorMessage, type Exposure } from "./content-common";
import type { NarrativeSection } from "./content-narrative";
type Item = { id: string; kind: string; value: unknown; source: { page_url: string; fetched_at: string };
  wiring: { project_id: string; outcome: string; reason?: string }[]; holds: string[];
  section_key?: string | null; decision_id?: string | null; decision?: "use" | "edit_use" | "reject" | null;
  default_ai_exposure?: Exposure | null; can_use?: boolean; requires_manual_entry?: boolean };
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

const matching: Record<string, string[]> = {
  narrative: ["concept", "concept_name", "description"], facts: ["project_information", "construction"],
  buildings: ["project_information", "floor_plans"], facilities: ["facilities"], features: ["facilities"],
  places: ["nearby"], contacts: ["contacts", "call_centres"], commercial: ["disclosures", "promotion_terms"],
  investor: [], "unit-types": ["unit_types", "unit_plans", "floor_plans"], media: ["videos", "tours"],
};
export function WebsiteContentSources({ projectId, section, sections = [], disabled = false, onChanged, onEditingChange }: {
  projectId: string; section?: string; sections?: NarrativeSection[]; disabled?: boolean;
  onChanged?: () => Promise<void>; onEditingChange?: (value: boolean) => void;
}) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account), canEdit = permissions.can("projects", "edit");
  const [items, setItems] = useState<Item[] | null>(null), [error, setError] = useState(""), [kind, setKind] = useState("");
  const [choice, setChoice] = useState<{ item: Item; decision: "edit_use" | "reject" } | null>(null);
  const [body, setBody] = useState(""), [reason, setReason] = useState(""), [pending, setPending] = useState(false);
  const base = `v1/admin/projects/${encodeURIComponent(projectId)}/content/website`;
  const load = useCallback(() => request<Item[]>(base), [base]);
  useEffect(() => { let live = true; setItems(null); setChoice(null); setError("");
    load().then(value => { if (live) setItems(value); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [load, authority]);
  useEffect(() => { onEditingChange?.(Boolean(choice)); return () => onEditingChange?.(false); }, [choice, onEditingChange]);
  const visible = items?.filter(item => section ? (matching[section] ?? []).includes(item.kind) : !kind || item.kind === kind) ?? [];
  async function decide(item: Item, decision: "use" | "edit_use" | "reject") {
    if (!canEdit || pending || (disabled && !choice) || decision !== "reject" && (!item.can_use || item.requires_manual_entry)) return;
    setPending(true); setError("");
    const current = sections.find(row => row.section_key === item.section_key);
    try {
      await request(`${base}/${encodeURIComponent(item.id)}/decision`, "POST", {
        expected_decision_id: item.decision_id ?? null, decision,
        ...(decision === "reject" ? { reason: reason.trim() } : { expected_revision: current?.revision ?? 0 }),
        ...(decision === "edit_use" ? { changes: { body: { th: body, ...(current?.version.body.en ? { en: current.version.body.en } : {}) } } } : {}),
      });
      await onChanged?.(); setItems(await load()); setChoice(null); setBody(""); setReason("");
    } catch (e) { setError(errorMessage(e)); } finally { setPending(false); }
  }
  if (section && items && !visible.length) return null;
  return <section className={section ? "workspace-suggestion" : "content-section"} aria-label={text.suggestions}>
    <h2>{text.suggestions}{items && <> · {visible.length}</>}</h2>
    <p>ข้อมูลต้นทางเป็นคำแนะนำและฉบับร่าง ยังไม่ใช่ข้อมูลที่ยืนยันหรือเผยแพร่ ราคาในหลักฐานไม่ใช่ราคาขายที่อนุมัติ</p><p>ข้อมูลที่มีอยู่เดิมยังคงเดิม หากขัดกัน ให้ตรวจหลักฐานก่อนแก้ไขในส่วนเนื้อหาที่เกี่ยวข้อง</p>
    {error && <p role="alert" className="notice error">{error}</p>}{!items && !error && <p role="status">{text.loading}</p>}
    {items && <>{!section && <label className="content-input">{text.scope}<select value={kind} onChange={event => setKind(event.target.value)}><option value="">{text.suggestions}</option>
      {Object.entries(labels).filter(([key]) => items.some(item => item.kind === key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
      {visible.map(item => <article className="content-card" key={item.id} id={`website-suggestion-${item.id}`} tabIndex={-1}>
        <h3>{labels[item.kind] ?? text.data}</h3>{item.default_ai_exposure && <p>{text.exposure_default} <ExposureChip exposure={item.default_ai_exposure} /></p>}
        <a href={item.source.page_url} target="_blank" rel="noreferrer noopener">{text.source}</a> · <time dateTime={item.source.fetched_at}>{new Date(item.source.fetched_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</time>
        <p className="content-preserve">{sourceText(item.value)}</p>
        <p>{item.wiring.some(row => row.outcome === "conflict") ? "มีข้อมูลเดิมอยู่แล้ว · เก็บข้อความนี้ไว้เป็นหลักฐานเพื่อเปรียบเทียบ" : item.wiring.some(row => row.outcome === "draft") ? "สร้างฉบับร่างภายในแล้ว · ต้องตรวจข้อมูลก่อนใช้" : "รอตรวจและจับคู่กับข้อมูลโครงการ"}</p>
        {item.holds.includes("needs_phase_decision") && <p className="inline-warning">หน้าเว็บใช้ร่วมหลายระยะ ต้องยืนยันว่าข้อมูลนี้ใช้กับระยะใด</p>}
        {item.kind === "construction" && <p>ยังไม่ทราบวันที่ข้อมูลก่อสร้าง วันที่ดึงข้อมูลไม่ใช่วันที่ความคืบหน้า</p>}
        {item.kind === "nearby" && <p>ระยะทางจากหน้าเว็บยังไม่ยืนยัน และยังไม่ได้ระบุวิธีวัด</p>}
        {item.decision && <p className="content-state">{item.decision === "reject" ? text.reject : item.decision === "edit_use" ? text.editUse : text.use}{item.decision !== "reject" && <> · {text.DRAFT}</>}</p>}
        {choice?.item.id === item.id ? <form onSubmit={event => { event.preventDefault(); void decide(item, choice.decision); }}>
          <label className="content-input">{choice.decision === "reject" ? text.reject : text.editUse}<textarea required rows={5} maxLength={choice.decision === "reject" ? 2000 : 12000} disabled={pending} value={choice.decision === "reject" ? reason : body} onChange={event => choice.decision === "reject" ? setReason(event.target.value) : setBody(event.target.value)} /></label>
          {choice.decision === "edit_use" && <p>{text.exposure_default} <ExposureChip exposure={item.default_ai_exposure} /></p>}
          <div className="content-actions"><button className="button secondary" type="button" disabled={pending} onClick={() => setChoice(null)}>{text.cancel}</button><button className="button primary" disabled={pending || (choice.decision === "reject" ? !reason.trim() : !body.trim())}>{choice.decision === "reject" ? text.reject : text.editUse}</button></div>
        </form> : canEdit && <div className="content-actions">
          {item.can_use && !item.requires_manual_entry && <><button className="button secondary" disabled={disabled || pending || Boolean(choice)} onClick={() => void decide(item, "use")}>{text.use}</button>
            <button className="button secondary" disabled={disabled || pending || Boolean(choice)} onClick={() => { setChoice({ item, decision: "edit_use" }); setBody(sourceText(item.value)); setReason(""); }}>{text.editUse}</button></>}
          <button className="button secondary" disabled={disabled || pending || Boolean(choice)} onClick={() => { setChoice({ item, decision: "reject" }); setReason(""); }}>{text.reject}</button>
        </div>}
      </article>)}</>}
  </section>;
}
