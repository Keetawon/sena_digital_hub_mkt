"use client";
import { useEffect, useState } from "react";
import { request } from "./hub-request";
import { BilingualInput, errorMessage, type ContentField, type Locales } from "./content-common";
import { AmenityDate, AmenityField, AmenityNumber, AmenitySelect, AmenityText, localized, placeStatus, stringValue, type AmenityRow, type MetricDef, type References } from "./amenity-fields";
import { facilityGroups, facilityIcons } from "./facility-taxonomy";

type Kind = keyof References;
const labels: Record<Kind, string> = { rail_lines: "สายรถไฟฟ้า", rail_stations: "สถานีรถไฟฟ้า", expressways: "ทางด่วน", expressway_ramps: "ทางขึ้นลงทางด่วน", features: "นิยามคุณสมบัติ", facilities: "ประเภทสิ่งอำนวยความสะดวก" };
const entities: Record<Kind, string> = { rail_lines: "ref_rail_line", rail_stations: "ref_rail_station", expressways: "ref_expressway", expressway_ramps: "ref_expressway_ramp", features: "feature", facilities: "facility_taxonomy" };
const columns: Record<Kind, string[]> = {
  rail_lines: ["name", "status", "source_ref", "as_of"], rail_stations: ["name", "line_code", "latitude", "longitude", "status", "expected_open", "source_ref", "as_of"],
  expressways: ["name", "status", "source_ref", "as_of"], expressway_ramps: ["name", "expressway_code", "latitude", "longitude", "status", "source_ref", "as_of"],
  features: ["label", "explanation", "category", "metric_defs", "active", "ai_exposure"], facilities: ["name_th", "name_en", "group_code", "icon_code", "sort_order", "active", "required_in_intake"],
};
type ImportPreview = { count: number; rows: { kind: Kind; code: string; expected_revision: number; changes: { name: Locales } }[] };

function DefinitionEditor({ value, onChange }: { value: Record<string, MetricDef>; onChange: (value: Record<string, MetricDef>) => void }) {
  const [newKey, setNewKey] = useState("");
  function update(key: string, changes: Partial<MetricDef>) { onChange({ ...value, [key]: { ...value[key], ...changes } }); }
  return <fieldset><legend>นิยามตัวชี้วัด</legend>{Object.entries(value).map(([key, def]) => <article className="content-card" key={key}><h4>{key}</h4>
    <BilingualInput id={`definition-${key}`} label="ชื่อตัวชี้วัด" value={def.label} onChange={label => update(key, { label })} rows={1} translationHint={false} />
    <label className="content-input">ชนิดค่า<select value={def.type} onChange={e => { const type = e.target.value as MetricDef['type'];const next: MetricDef = { type, label: def.label, required: def.required ?? false };if (type === "enum") next.options = [];onChange({ ...value, [key]: next }); }}><option value="number">จำนวน</option><option value="integer">จำนวนเต็ม</option><option value="text">ข้อความสองภาษา</option><option value="enum">รายการให้เลือก</option></select></label>
    {(def.type === "number" || def.type === "integer") && <><label className="content-input">หน่วย<input value={def.unit ?? ""} maxLength={50} onChange={e => update(key, { unit: e.target.value })} /></label><div className="content-two-columns">{(["min", "max"] as const).map(bound => <label className="content-input" key={bound}>{bound === "min" ? "ค่าต่ำสุด" : "ค่าสูงสุด"}<input type="number" step="any" value={def[bound] ?? ""} onChange={e => { const next = { ...def };if (e.target.value === "") delete next[bound];else next[bound] = Number(e.target.value);onChange({ ...value, [key]: next }); }} /></label>)}</div></>}
    {def.type === "enum" && <label className="content-input">ตัวเลือก (หนึ่งค่าต่อบรรทัด)<textarea value={(def.options ?? []).join("\n")} onChange={e => update(key, { options: e.target.value.split("\n") })} /></label>}
    <label><input type="checkbox" checked={def.required ?? false} onChange={e => update(key, { required: e.target.checked })} />จำเป็นเมื่อมีคุณสมบัตินี้</label>
    <button type="button" className="button secondary" onClick={() => { const next = { ...value };delete next[key];onChange(next); }}>นำตัวชี้วัด {key} ออก</button>
  </article>)}<label className="content-input">รหัสตัวชี้วัดใหม่<input value={newKey} onChange={e => setNewKey(e.target.value)} maxLength={50} placeholder="เช่น system_kw" /></label><button type="button" className="button secondary" disabled={!/^[a-z][a-z0-9_]{0,49}$/.test(newKey) || newKey in value} onClick={() => { onChange({ ...value, [newKey]: { type: "number", label: { th: "", en: "" } } });setNewKey(""); }}>เพิ่มตัวชี้วัด</button></fieldset>;
}

export function PlaceReferences({ references, group, fields, canApprove, onChanged, onEditingChange }: { references: References; group: "facilities" | "features" | "places"; fields: ContentField[]; canApprove: boolean; onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void }) {
  const choices: Kind[] = group === "places" ? ['rail_lines', 'rail_stations', 'expressways', 'expressway_ramps'] : [group];
  const [kind, setKind] = useState<Kind>(choices[0]), [draft, setDraft] = useState<AmenityRow | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [csv, setCsv] = useState(""), [preview, setPreview] = useState<ImportPreview | null>(null);
  useEffect(() => { onEditingChange(Boolean(draft) || Boolean(csv) || busy);return () => onEditingChange(false); }, [draft, csv, busy, onEditingChange]);
  const entity = entities[kind];
  function change(key: string, value: unknown) { setDraft(d => d && { ...d, [key]: value, ...(key === "status" && value === "operating" ? { expected_open: null } : {}) }); }
  function edit(row?: AmenityRow) { setDraft(structuredClone(row ?? { code: "", revision: 0, name: {}, label: {}, explanation: {}, metric_defs: {}, category: "", active: true, ai_exposure: "open", group_code: "other", icon_code: "building", sort_order: 0, required_in_intake: false, name_th: "", name_en: "", source_ref: "", as_of: null, status: null, latitude: null, longitude: null, expected_open: null }));setError("");setNotice(""); }
  async function save() {
    if (!draft || !canApprove || busy) return;setBusy(true);setError("");
    try { await request(`v1/admin/place-references/${kind}/${encodeURIComponent(draft.code!)}`, "PUT", { expected_revision: draft.revision, changes: Object.fromEntries(columns[kind].filter(key => draft[key] !== undefined).map(key => [key, draft[key]])) });await onChanged();setDraft(null);setNotice("บันทึกข้อมูลอ้างอิงแล้ว"); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function template() {
    try { const value = await request<{ filename: string; content: string }>('v1/admin/place-references/template');const url = URL.createObjectURL(new Blob(['\ufeff', value.content], { type: 'text/csv;charset=utf-8' }));const link = document.createElement('a');link.href = url;link.download = value.filename;link.click();URL.revokeObjectURL(url); }
    catch (e) { setError(errorMessage(e)); }
  }
  async function importRows(apply: boolean) {
    if (!canApprove || busy || apply && !preview) return;setBusy(true);setError("");
    try { const result = await request<ImportPreview>('v1/admin/place-references/import', 'POST', { csv_text: csv, apply });
      if (apply) { await onChanged();setCsv("");setPreview(null);setNotice(`นำเข้า ${result.count} รายการแล้ว`); } else setPreview(result);
    } catch (e) { setError(errorMessage(e));setPreview(null); } finally { setBusy(false); }
  }
  const props = draft ? { row: draft, entity, fields, change } : null;
  return <details className="content-section"><summary>{canApprove ? "จัดการข้อมูลอ้างอิง" : "ดูข้อมูลอ้างอิง"}</summary><h2>{group === "places" ? "ข้อมูลสถานที่อ้างอิง" : labels[kind]}</h2>
    {group === "places" && <p className="field-help">Q74 ยังรอแหล่งข้อมูลและผู้ดูแลที่ยืนยัน รายการตั้งต้นมีเฉพาะตัวตนสายรถไฟฟ้า กรอกสถานี ทางขึ้นลงและพิกัดจากหลักฐานที่ตรวจสอบแล้วเท่านั้น</p>}
    {group === "features" && <p className="field-help">คำอธิบายนี้ใช้ร่วมกันระดับองค์กร การแก้นิยามตัวชี้วัดต้องไม่ขัดกับค่าที่โครงการบันทึกไว้ ชื่ออังกฤษของนอนดีรอการอนุมัติในอภิธานศัพท์ตาม Q75</p>}
    <label className="content-input">ประเภทข้อมูลอ้างอิง<select value={kind} disabled={Boolean(draft) || Boolean(csv) || busy} onChange={e => setKind(e.target.value as Kind)}>{choices.map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
    {error && <p className="notice error" role="alert">{error} ข้อมูลที่กรอกยังอยู่</p>}{notice && <p role="status">{notice}</p>}
    {canApprove && <button className="button secondary" disabled={Boolean(draft) || Boolean(csv) || busy} onClick={() => edit()}>เพิ่ม{labels[kind]}</button>}
    {draft && props && <form onSubmit={e => { e.preventDefault();void save(); }}><fieldset disabled={busy || !canApprove}>
      <AmenityField entity={entity} name="code" fields={fields} label="รหัสอ้างอิง"><input id={`c4-${entity}-code`} value={draft.code ?? ""} required pattern="[A-Za-z0-9_\-]{1,80}" maxLength={80} readOnly={draft.revision > 0} onChange={e => change("code", e.target.value)} /></AmenityField>
      {kind === "facilities" ? <>
        <BilingualInput id="c4-taxonomy-label" field={fields.find(f => f.field_key === 'facility_taxonomy.label')} value={{ th: stringValue(draft, 'name_th'), en: stringValue(draft, 'name_en') }} rows={1} onChange={v => { change('name_th', v.th ?? '');change('name_en', v.en ?? ''); }} translationHint={false} />
        <AmenitySelect {...props} name="group_code" choices={facilityGroups} required />
        <AmenitySelect {...props} name="icon_code" choices={facilityIcons} required />
        <AmenityNumber {...props} name="sort_order" step="1" required /><label><input type="checkbox" checked={draft.required_in_intake === true} onChange={e => change('required_in_intake', e.target.checked)} />ต้องตอบสถานะในแบบเก็บข้อมูล</label>
      </> : kind === "features" ? <>
        <AmenityText {...props} name="label" manual /><AmenityText {...props} name="explanation" manual />
        <AmenitySelect {...props} name="category" choices={{ health: "สุขภาพ", sustainability: "ความยั่งยืน", smart: "เทคโนโลยีอัจฉริยะ", security: "ความปลอดภัย", service: "บริการ", partnership: "พันธมิตร" }} required />
        <DefinitionEditor value={(draft.metric_defs ?? {}) as Record<string, MetricDef>} onChange={v => change('metric_defs', v)} />
      </> : <>
        <AmenityText {...props} name="name" manual />
        {kind === "rail_stations" && <AmenitySelect {...props} name="line_code" choices={Object.fromEntries(references.rail_lines.map(r => [r.code!, localized(r, 'name').th ?? r.code!]))} required />}
        {kind === "expressway_ramps" && <AmenitySelect {...props} name="expressway_code" choices={Object.fromEntries(references.expressways.map(r => [r.code!, localized(r, 'name').th ?? r.code!]))} required />}
        {['rail_stations', 'expressway_ramps'].includes(kind) && <div className="content-two-columns"><AmenityNumber {...props} name="latitude" min={5} max={21} /><AmenityNumber {...props} name="longitude" min={97} max={106} /></div>}
        <AmenitySelect {...props} name="status" choices={placeStatus} required={['rail_stations', 'expressway_ramps'].includes(kind)} />
        {kind === "rail_stations" && draft.status !== "operating" && <AmenityDate {...props} name="expected_open" />}
        <AmenityField entity={entity} name="source_ref" fields={fields}><textarea id={`c4-${entity}-source_ref`} value={stringValue(draft, 'source_ref')} required maxLength={2000} onChange={e => change('source_ref', e.target.value)} /></AmenityField>
        <AmenityDate {...props} name="as_of" required />
      </>}
      {['features', 'facilities'].includes(kind) && <label><input type="checkbox" checked={draft.active === true} onChange={e => change('active', e.target.checked)} />เปิดให้เลือกใช้</label>}
    </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setDraft(null)}>ยกเลิก</button><button className="button primary" disabled={busy || !canApprove}>บันทึกข้อมูลอ้างอิง</button></div></form>}
    <div className="content-card-list">{references[kind].map(item => <article className="content-card" key={item.code}><h3>{kind === 'facilities' ? String(item.name_th) : localized(item, kind === 'features' ? 'label' : 'name').th}</h3><p>{item.code}</p>
      {group === 'places' && <><p>{placeStatus[String(item.status) as keyof typeof placeStatus] ?? 'ยังไม่ระบุสถานะ'} · ข้อมูล ณ {stringValue(item, 'as_of') || 'ยังไม่ระบุวันที่'}</p><p>แหล่งข้อมูล: {stringValue(item, 'source_ref')}</p>
        {['rail_stations', 'expressway_ramps'].includes(kind) && <p>{item.latitude == null ? 'ยังไม่มีพิกัดอ้างอิง' : `พิกัดอ้างอิง: ${item.latitude}, ${item.longitude}`}</p>}</>}
      {canApprove && <button className="button secondary" disabled={Boolean(draft) || Boolean(csv) || busy} onClick={() => edit(item)}>แก้ไขข้อมูลอ้างอิง {item.code}</button>}</article>)}</div>
    {group === 'places' && <section><h3>นำเข้าข้อมูลอ้างอิง CSV</h3><p>จำกัด 200 แถว ระบุฉบับข้อมูล 0 สำหรับรายการใหม่ เก็บรหัสเป็นข้อความและนำเข้าสายรถไฟฟ้า/ทางด่วนก่อนรายการลูก</p><button type="button" className="button secondary" onClick={() => void template()}>ดาวน์โหลดแม่แบบ CSV</button>
      {canApprove && <><label className="content-input">เลือกไฟล์ CSV<input type="file" accept=".csv,text/csv" disabled={busy || Boolean(draft)} onChange={async e => { const file = e.target.files?.[0];e.target.value = '';if (!file) return;if (file.size > 600000) { setError('ไฟล์ใหญ่เกินขนาดที่กำหนด');return; }setCsv(await file.text());setPreview(null);setError(''); }} /></label>
        {csv && <><p>อ่านไฟล์แล้ว ตรวจรายการก่อนยืนยันนำเข้า</p><button className="button secondary" disabled={busy} onClick={() => void importRows(false)}>ตรวจรายการนำเข้า</button><button className="button secondary" disabled={busy} onClick={() => { setCsv('');setPreview(null); }}>ยกเลิกนำเข้า</button></>}
        {preview && <div><p>ผ่านการตรวจ {preview.count} รายการ · ยังไม่บันทึก</p><ul>{preview.rows.map(r => <li key={`${r.kind}-${r.code}`}>{labels[r.kind]} · {r.code} · {r.changes.name.th} · {r.expected_revision ? `แก้ฉบับ ${r.expected_revision}` : 'รายการใหม่'}</li>)}</ul><button className="button primary" disabled={busy} onClick={() => void importRows(true)}>ยืนยันนำเข้า {preview.count} รายการ</button></div>}
      </>}
    </section>}
  </details>;
}
