"use client";
import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { errorMessage, type Locales } from "./content-common";

export type FaqRule = { brand_ids?: string[]; product_forms?: string[]; group_ids?: string[] };
type Reference = { id: string; name: string };
type Resolution = { project_ids: string[]; projects: { id: string; name: Locales }[]; unresolved_forms: { id: string; name: Locales }[] };
export function FaqApplicability({ rule, scope, reference, brands, groups, disabled, onChange, onResolve }: {
  rule: FaqRule; scope: string; reference: string; brands: Reference[]; groups: Reference[]; disabled: boolean;
  onChange: (value: FaqRule) => void; onResolve: (ids: string[]) => void;
}) {
  const [result, setResult] = useState<{ fingerprint: string; data: Resolution } | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const fingerprint = JSON.stringify([rule, scope, reference]);
  const active = Object.keys(rule).length > 0, visible = !disabled && result?.fingerprint === fingerprint ? result.data : null;
  useEffect(() => { if (disabled) setResult(null); }, [disabled]);
  function change(key: keyof FaqRule, values: string[]) {
    const next = { ...rule }; if (values.length) next[key] = values; else delete next[key];
    setResult(null); setError(""); onChange(next);
  }
  async function preview() {
    setPending(true); setError("");
    try { const data = await request<Resolution>("v1/admin/faq-applicability", "POST", { rule, scope_type: scope, scope_id: reference }); setResult({ fingerprint, data }); onResolve(data.project_ids); }
    catch (error) { setResult(null); setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <details className="content-card" open={active || undefined}><summary>เลือกโครงการด้วยเงื่อนไข</summary>
    <p className="field-help">เลือกได้หลายค่าในแต่ละเงื่อนไข โครงการต้องตรงทุกเงื่อนไขที่เลือก เว้นว่างทั้งหมดเพื่อเลือกเฟสเอง รายชื่อจะยืนยันอีกครั้งก่อนเผยแพร่</p>
    <fieldset disabled={disabled || pending}>
      {([["brand_ids", "แบรนด์ในเงื่อนไข", brands], ["group_ids", "กลุ่มโครงการในเงื่อนไข", groups], ["product_forms", "ประเภทที่อยู่อาศัยในเงื่อนไข", [{ id: "condominium", name: "คอนโดมิเนียม" }, { id: "house", name: "บ้าน" }, { id: "townhome", name: "ทาวน์โฮม" }, { id: "other", name: "อื่น ๆ" }]]] as const).map(([key, label, options]) =>
        <label className="content-input" key={key}>{label}<select multiple size={Math.min(4, Math.max(2, options.length))} value={rule[key] ?? []} onChange={event => change(key, Array.from(event.target.selectedOptions, option => option.value))}>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>)}
      <div className="content-actions"><button type="button" className="button secondary" disabled={!active} onClick={() => { onChange({}); setResult(null); }}>ล้างเงื่อนไข</button><button type="button" className="button secondary" disabled={!active || !reference} onClick={() => void preview()}>{pending ? "กำลังตรวจรายชื่อ…" : "ดูรายชื่อเฟสที่ตรงเงื่อนไข"}</button></div>
    </fieldset>
    {error && <p role="alert" className="notice error">{error}</p>}
    {visible && <div aria-live="polite"><p>ตรงเงื่อนไข {visible.projects.length} เฟส · ยังไม่ตรึงเพื่อเผยแพร่</p><ul>{visible.projects.map(project => <li key={project.id}>{project.name.th} · {project.id}</li>)}</ul>{visible.unresolved_forms.length > 0 && <p className="inline-warning">ยังไม่นับโครงการที่ไม่ทราบประเภท: {visible.unresolved_forms.map(project => project.name.th || project.id).join(", ")}</p>}</div>}
    {active && !visible && <p className="field-help">ตรวจรายชื่อหลังเปลี่ยนเงื่อนไข ระบบจะคำนวณรายชื่อปัจจุบันเมื่อบันทึกฉบับ</p>}
  </details>;
}
