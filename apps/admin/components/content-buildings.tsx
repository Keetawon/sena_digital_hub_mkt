"use client";
import { useEffect, useRef, useState } from "react";
import { request } from "./hub-request";
import { ContentWorkflow } from "./content-workflow";
import { BilingualInput, ContentLabel, ExposureInput, contentDate, errorMessage, type ContentField, type Exposure, type Locales } from "./content-common";

export type Building = { building_key: string; revision: number; name: Locales; floors_above: number | null; has_rooftop: boolean | null; skip_floors: number[]; unit_count: number | null; ai_exposure: Exposure; source?: string; source_as_of?: string | null };
export function ContentBuildings({ projectId, projectRowId, items, remBuildings, remAsOf, fields, canEdit, onChanged, onEditingChange }: {
  projectId: string; projectRowId?: string; items: Building[]; remBuildings: Building[]; remAsOf?: string; fields: ContentField[];
  canEdit: boolean; onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState<Building | null>(null);
  const [skips, setSkips] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [workflowOwners, setWorkflowOwners] = useState<string[]>([]), [workflowRevision, setWorkflowRevision] = useState(0);
  const workflowActive = workflowOwners.length > 0;
  function workflowEditing(owner: string, active: boolean) {
    setWorkflowOwners(owners => owners.includes(owner) === active ? owners : active ? [...owners, owner] : owners.filter(value => value !== owner));
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { onEditingChange(Boolean(editing || pending || workflowActive)); return () => onEditingChange(false); }, [editing, pending, workflowActive, onEditingChange]);
  const field = (key: string) => fields.find(field => field.field_key === `building.${key}`);
  function edit(item?: Building) {
    setEditing(item ? { ...item, name: { ...item.name } } : { building_key: `mkt_${crypto.randomUUID().slice(0, 8)}`, revision: 0, name: {}, floors_above: null, has_rooftop: null, skip_floors: [], unit_count: null, ai_exposure: "open" });
    setSkips(item?.skip_floors.join(", ") ?? ""); setError(""); setNotice("");
  }
  function draftChanges(draft: Building) {
    const skipFloors = skips.trim() ? skips.split(",").map(value => Number(value.trim())) : [];
    return { name: draft.name, floors_above: draft.floors_above, has_rooftop: draft.has_rooftop, skip_floors: skipFloors, unit_count: draft.unit_count, ai_exposure: draft.ai_exposure };
  }
  async function reloadWorkflow() { await onChanged(); setEditing(null); setError(""); setWorkflowRevision(value => value + 1); }
  async function save(useRem?: Building) {
    const draft = useRem ?? editing;
    if (!draft || pending || workflowActive || !canEdit) return;
    setPending(true); setError(""); setNotice("");
    try {
      const skipFloors = skips.trim() ? skips.split(",").map(value => Number(value.trim())) : [];
      if (!useRem && skipFloors.some(value => !Number.isInteger(value) || value < 1)) throw new Error("ระบุเลขชั้นที่ข้ามโดยคั่นด้วยจุลภาค");
      const changes = useRem ? { use_rem: true } : draftChanges(draft);
      await request(`v1/admin/projects/${encodeURIComponent(projectId)}/buildings/${encodeURIComponent(draft.building_key)}`, "PUT", { expected_revision: useRem ? items.find(item => item.building_key === draft.building_key)?.revision ?? 0 : draft.revision, changes });
      await onChanged(); setEditing(null); setNotice(useRem ? "เติมข้อมูลอาคารจากสำเนา REM แล้ว" : "บันทึกข้อมูลอาคารแล้ว");
    } catch (error) { setError(errorMessage(error)); } finally { setPending(false); }
  }
  return <section className="content-section"><div className="content-toolbar"><h2>อาคาร</h2>{canEdit && !editing && <button className="button secondary" disabled={pending || Boolean(workflowActive)} onClick={() => edit()}>เพิ่มอาคาร</button>}</div>
    <p className="field-help">จำนวนอาคารและจำนวนชั้นสูงสุดคำนวณจากรายการนี้ ช่องที่เว้นว่างหมายถึงยังไม่ทราบ</p>
    {error && <p className="notice error" role="alert">{error} ข้อมูลที่กรอกยังอยู่</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {!remBuildings.length ? <p className="read-only-note">สำเนา DW ยังไม่มีข้อมูลอาคาร Marketing สามารถกรอกข้อมูลที่ตรวจยืนยันแล้ว</p> : <details><summary>อาคารจาก REM ณ {contentDate(remAsOf)}</summary><div className="content-card-list">{remBuildings.map(item => <article className="content-card" key={item.building_key} data-workspace-item={item.building_key} tabIndex={-1}><h3>{item.name?.th || item.building_key}</h3><p>{item.floors_above ?? "ยังไม่ทราบ"} ชั้น · {item.unit_count ?? "ยังไม่ทราบ"} ยูนิต</p>{canEdit && <button className="button secondary" disabled={pending || Boolean(editing || workflowActive)} onClick={() => void save(item)}>ใช้ข้อมูลอาคารจาก REM</button>}</article>)}</div></details>}
    {editing && <form ref={form} inert={Boolean(workflowActive)} onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={pending || !canEdit}>
      <BilingualInput id="building-name" field={field("name")} rows={2} maxLength={300} value={editing.name} onChange={name => setEditing({ ...editing, name })} />
      <div className="content-two-columns"><div className="content-input"><ContentLabel htmlFor="building-floors" field={field("floors_above")} /><input id="building-floors" type="number" min="1" step="1" value={editing.floors_above ?? ""} onChange={event => setEditing({ ...editing, floors_above: event.target.value ? Number(event.target.value) : null })} /></div>
        <div className="content-input"><ContentLabel htmlFor="building-units" field={field("unit_count")} /><input id="building-units" type="number" min="0" step="1" value={editing.unit_count ?? ""} onChange={event => setEditing({ ...editing, unit_count: event.target.value ? Number(event.target.value) : null })} /></div></div>
      <div className="content-two-columns"><div className="content-input"><ContentLabel htmlFor="building-rooftop" field={field("has_rooftop")} /><select id="building-rooftop" value={editing.has_rooftop == null ? "unknown" : editing.has_rooftop ? "yes" : "no"} onChange={event => setEditing({ ...editing, has_rooftop: event.target.value === "unknown" ? null : event.target.value === "yes" })}><option value="unknown">ยังไม่ทราบ</option><option value="yes">มี</option><option value="no">ไม่มี</option></select></div>
        <div className="content-input"><ContentLabel htmlFor="building-skips" field={field("skip_floors")} /><input id="building-skips" value={skips} placeholder="เช่น 13, 14" onChange={event => setSkips(event.target.value)} /></div></div>
      <ExposureInput value={editing.ai_exposure} onChange={value => setEditing({ ...editing, ai_exposure: value })} />
    </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending || Boolean(workflowActive)} onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary" disabled={pending || Boolean(workflowActive) || !canEdit || !editing.name.th?.trim()}>บันทึกอาคาร</button></div></form>}
    <div className="content-card-list">{items.map(item => <article className="content-card" key={item.building_key} data-workspace-item={item.building_key} tabIndex={-1}><h3>{item.name.th}</h3>{item.name.en && <p lang="en">{item.name.en}</p>}<dl><div><dt>จำนวนชั้น</dt><dd>{item.floors_above ?? "ยังไม่ทราบ"}</dd></div><div><dt>จำนวนยูนิต</dt><dd>{item.unit_count ?? "ยังไม่ทราบ"}</dd></div><div><dt>ดาดฟ้า</dt><dd>{item.has_rooftop == null ? "ยังไม่ทราบ" : item.has_rooftop ? "มี" : "ไม่มี"}</dd></div><div><dt>ชั้นที่ข้าม</dt><dd>{item.skip_floors.join(", ") || "ไม่ได้ระบุ"}</dd></div></dl>{item.source === "rem" && <p className="field-help">จาก REM ณ {contentDate(item.source_as_of)}</p>}{canEdit && <button className="button secondary" disabled={Boolean(editing || pending || workflowActive)} onClick={() => edit(item)}>แก้ไขอาคาร {item.name.th}</button>}<ContentWorkflow key={`${item.building_key}:${workflowRevision}`} target={projectRowId ? { kind: "building", identity: { project_id: projectRowId, building_key: item.building_key } } : null} label={item.name.th || item.building_key}
      revision={editing?.building_key === item.building_key ? editing.revision : item.revision} disabled={pending || Boolean(editing && editing.building_key !== item.building_key) || workflowOwners.some(owner => owner !== item.building_key)}
      draft={editing?.building_key === item.building_key ? { dirty: true, valid: canEdit && Boolean(editing.name.th?.trim()) && draftChanges(editing).skip_floors.every(value => Number.isInteger(value) && value > 0), sourceStamp: { revision: editing.revision }, getChanges: () => form.current?.reportValidity() ? draftChanges(editing) : null } : undefined}
      onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing(item.building_key, value)} /></article>)}</div>
  </section>;
}
