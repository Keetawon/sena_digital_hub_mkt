"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { ContentWorkflow } from "./content-workflow";
import { workflowText, type WorkflowTarget } from "@/lib/content-workflow";
import { DetailDialog } from "./registry-motion";
import { request } from "./hub-request";
import { errorMessage, ExposureInput, TranslationReviewPanel, type ContentField, type Exposure, type Locales, type Translation } from "./content-common";
import { AmenityDate, AmenityField, AmenityNumber, AmenitySelect, AmenityText, FeatureMetrics, localized, placeCategories, placeStatus, presence, stringValue, type AmenityRow, type References } from "./amenity-fields";
import { FacilityPhotos, type AmenityMedia } from "./facility-photos";
import { PlaceReferences } from "./place-references";
import { FacilityIcon, facilityGroups } from "./facility-taxonomy";
import "./project-amenities.css";

type Kind = "facilities" | "features" | "solar" | "places";
type Workspace = { project: { id: string; name: Locales }; facilities: AmenityRow[]; features: AmenityRow[]; solar: AmenityRow[]; places: AmenityRow[]; references: References;
  unit_types: { id: string; name: Locales }[]; phases: { id: string; name: string }[]; translations: Translation[]; nearest_stations: AmenityRow[]; media: AmenityMedia };
const entityFor: Record<Kind, string> = { facilities: "facility", features: "feature", solar: "solar_estimate", places: "place" };
const titles: Record<Kind, string> = { facilities: "สิ่งอำนวยความสะดวก", features: "คุณสมบัติโครงการ", solar: "สถานการณ์ประมาณการโซลาร์", places: "สถานที่ใกล้เคียง" };
const keys: Record<Kind, string[]> = {
  facilities: ["status", "description", "display_name", "location_label", "size_sqm", "opening_hours", "applies_to_project_ids", "expected_open_date", "ai_exposure"],
  features: ["feature_code", "status", "detail", "metrics", "commercial_type_id", "source_note", "ai_exposure"],
  solar: ["system_kw", "battery_kwh", "usage_profile", "bill_before", "bill_after", "saving_pct", "assumptions", "source_note", "as_of", "ai_exposure"],
  places: ["category", "ref_id", "name", "distance_m", "distance_method", "travel_minutes", "travel_mode", "status", "expected_open", "as_of", "show_on_web", "sort", "ai_exposure"],
};
function emptyRow(kind: Kind): AmenityRow {
  const common = { id: crypto.randomUUID(), revision: 0, ai_exposure: kind === "solar" ? "web_only" : "open" };
  if (kind === "features") return { ...common, feature_code: "", status: "unknown", detail: {}, metrics: {}, source_note: {}, commercial_type_id: null };
  if (kind === "places") return { ...common, category: "", status: "", name: {}, ref_id: null, distance_m: null, distance_method: null, travel_minutes: null, travel_mode: null, expected_open: null, as_of: "", show_on_web: false, sort: 0 };
  return { ...common, system_kw: null, battery_kwh: null, usage_profile: {}, bill_before: null, bill_after: null, saving_pct: null, assumptions: {}, source_note: {}, as_of: "" };
}

export function ProjectAmenities({ projectId, tab, fields, onChanged, onEditingChange }: { projectId: string; tab: "facilities" | "features" | "places"; fields: ContentField[]; onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void }) {
  const permissions = useHubPermissions(), permissionKey = capabilityKey(permissions.account), identity = permissions.account?.id;
  const canView = permissions.can("projects"), canEdit = permissions.can("projects", "edit"), canApprove = permissions.can("projects", "approve");
  const [data, setData] = useState<Workspace | null>(null), [editing, setEditing] = useState<{ kind: Kind; row: AmenityRow } | null>(null), [photos, setPhotos] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [childDirty, setChildDirty] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const withdrawalId = useId();
  const [withdrawal, setWithdrawal] = useState<AmenityRow | null>(null), [withdrawalReason, setWithdrawalReason] = useState("");
  const [workflowOwners, setWorkflowOwners] = useState<Set<string>>(() => new Set());
  const workflowBusy = workflowOwners.size > 0;
  const workflowEditing = (key: string, value: boolean) => setWorkflowOwners(owners => { if (owners.has(key) === value) return owners; const next = new Set(owners); if (value) next.add(key); else next.delete(key); return next; });
  const previousIdentity = useRef(identity), base = `v1/admin/projects/${encodeURIComponent(projectId)}/amenities`;
  const reload = useCallback(async () => { setData(await request<Workspace>(base)); await onChanged(); }, [base, onChanged]);
  useEffect(() => { let active = true;setData(null);setError("");
    if (previousIdentity.current !== identity) { setEditing(null);setPhotos(null);setWithdrawal(null);setWithdrawalReason("");previousIdentity.current = identity; }
    if (canView) request<Workspace>(base).then(value => { if (active) setData(value); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, [base, permissionKey, identity, canView]);
  useEffect(() => { onEditingChange(Boolean(editing || withdrawal) || busy || childDirty || workflowBusy);return () => onEditingChange(false); }, [editing, withdrawal, busy, childDirty, workflowBusy, onEditingChange]);
  function edit(kind: Kind, row?: AmenityRow) { if (!canEdit || busy || workflowBusy || childDirty) return; setEditing({ kind, row: structuredClone(row ?? emptyRow(kind)) });setPhotos(null);setError("");setNotice(""); }
  function change(key: string, value: unknown) { setEditing(current => {
    if (!current) return current;
    const next = { ...current.row, [key]: value };
    if (key === "status" && current.kind === "facilities" && value !== "planned") next.expected_open_date = null;
    if (key === "status" && current.kind === "places" && value === "operating") next.expected_open = null;
    if (key === "category" && current.kind === "places") next.ref_id = null;
    return { ...current, row: next };
  }); }
  async function save() {
    if (!editing || !canEdit || busy || workflowBusy || childDirty) return;setBusy(true);setError("");setNotice("");
    const { kind, row } = editing;
    try { await request(`${base}/${kind}/${encodeURIComponent(kind === "facilities" ? row.code! : row.id!)}`, "PUT", { expected_revision: row.revision,
      changes: Object.fromEntries(keys[kind].filter(k => row[k] !== undefined).map(k => [k, row[k]])) });
      await reload();setEditing(null);setNotice(`บันทึก${titles[kind]}แล้ว`);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function withdraw() {
    if (!withdrawal || !withdrawalReason.trim() || !canApprove || busy || workflowBusy || editing || childDirty) return;setBusy(true);setError("");
    try { await request(`${base}/solar/${withdrawal.id}/review`, "POST", { expected_revision: withdrawal.revision, decision: "withdraw", reason: withdrawalReason.trim() });await reload();setWithdrawal(null);setWithdrawalReason("");setNotice("ถอนสถานการณ์ประมาณการแล้ว"); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  function workflowTarget(kind: Kind, item: AmenityRow): WorkflowTarget | null {
    if (!data || !item.revision) return null;
    return kind === "facilities" ? { kind: "facility", identity: { project_id: data.project.id, facility_code: item.code! } } : { kind: ({ features: "feature", solar: "solar", places: "place" } as const)[kind], identity: { id: item.id! } };
  }
  const entity = editing ? entityFor[editing.kind] : "", row = editing?.row;
  const props = row ? { row, entity, fields, change } : null;
  const disabled = busy || workflowBusy || Boolean(editing || withdrawal) || childDirty;
  function name(item: AmenityRow, kind: Kind) { return kind === "facilities" ? localized(item, "display_name").th || String(item.name_th)
    : kind === "features" ? data?.references.features.find(f => f.code === item.feature_code)?.label.th || "คุณสมบัติ" : kind === "solar" ? `ข้อมูล ณ ${item.as_of}` : localized(item, "name").th || "สถานที่"; }
  return <div className="c4-workspace">
    {withdrawal && <DetailDialog dialogId={withdrawalId} title={`${workflowText.confirm} · ${titles.solar}`} onClose={() => { if (!busy) setWithdrawal(null); }}>
      <form onSubmit={event => { event.preventDefault(); void withdraw(); }}>
        {error && <p className="notice error" role="alert">{error}</p>}
        <label className="content-input">{workflowText.reason}<textarea required maxLength={2000} rows={3} value={withdrawalReason} disabled={busy} onChange={event => setWithdrawalReason(event.target.value)} /></label>
        <div className="content-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setWithdrawal(null)}>{workflowText.cancel}</button><button className="button primary" disabled={busy || !canApprove || !withdrawalReason.trim()}>{workflowText.confirm}</button></div>
      </form>
    </DetailDialog>}
    {error && <p className="notice error" role="alert">{error}{editing && " ข้อมูลที่กรอกยังอยู่ กรุณาตรวจข้อมูลล่าสุดก่อนบันทึกอีกครั้ง"}</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    {!canView ? <p>ไม่มีสิทธิ์ดูข้อมูลส่วนนี้</p> : !data ? !error && <p role="status">กำลังโหลดข้อมูล…</p> : <>
      {editing && props && row && <section className="content-section"><h2>แก้ไข{titles[editing.kind]}</h2>{!canEdit && <p role="status">สิทธิ์แก้ไขเปลี่ยนแล้ว ข้อมูลที่กรอกยังอยู่ แต่บันทึกไม่ได้</p>}
        <form ref={form} inert={workflowBusy} onSubmit={e => { e.preventDefault();void save(); }}><fieldset disabled={busy || !canEdit}>
          {editing.kind === "facilities" && <>
            <h3>{String(row.name_th)}</h3><AmenitySelect {...props} name="status" choices={presence} required />
            <AmenityText {...props} name="display_name" /><AmenityText {...props} name="description" />
            <AmenityText {...props} name="location_label" /><AmenityNumber {...props} name="size_sqm" min={0.01} max={10000000} /><AmenityText {...props} name="opening_hours" />
            <AmenityField entity={entity} name="applies_to_project_ids" fields={fields}><select id="c4-facility-applies_to_project_ids" multiple value={(row.applies_to_project_ids ?? []) as string[]} onChange={e => change("applies_to_project_ids", Array.from(e.target.selectedOptions, option => option.value))}>{data.phases.map(p => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</select></AmenityField>
            {row.status === "planned" && <AmenityDate {...props} name="expected_open_date" />}
          </>}
          {editing.kind === "features" && <>
            <AmenityField entity={entity} name="code" fields={fields} label="คุณสมบัติ"><select id="c4-feature-code" value={stringValue(row, "feature_code")} required onChange={e => { change("feature_code", e.target.value);change("metrics", {}); }}>{data.references.features.filter(f => f.active || f.code === row.feature_code).map(f => <option key={f.code} value={f.code}>{f.label.th}{!f.active && " · เลิกให้เลือกใหม่"}</option>)}<option value="">เลือกคุณสมบัติ</option></select></AmenityField>
            <p className="field-help">{data.references.features.find(f => f.code === row.feature_code)?.explanation.th}</p>
            <AmenitySelect {...props} name="status" choices={presence} required /><AmenityText {...props} name="detail" />
            <FeatureMetrics row={row} definition={data.references.features.find(f => f.code === row.feature_code)} change={change} />
            <AmenitySelect {...props} name="commercial_type_id" choices={Object.fromEntries(data.unit_types.map(t => [t.id, t.name.th ?? t.id]))} />
            <AmenityText {...props} name="source_note" manual />
          </>}
          {editing.kind === "solar" && <><p className="read-only-note">กรอกสถานการณ์ที่มีแหล่งอ้างอิง ระบบไม่คำนวณค่าไฟหรือผลประหยัด ข้อมูลนี้ไม่ส่งไป AI</p>
            <div className="content-two-columns"><AmenityNumber {...props} name="system_kw" min={0.001} required /><AmenityNumber {...props} name="battery_kwh" /></div>
            <AmenityText {...props} name="usage_profile" manual /><div className="content-two-columns"><AmenityNumber {...props} name="bill_before" required /><AmenityNumber {...props} name="bill_after" required /></div>
            <AmenityNumber {...props} name="saving_pct" max={100} required /><AmenityText {...props} name="assumptions" manual /><AmenityText {...props} name="source_note" manual /><AmenityDate {...props} name="as_of" required />
          </>}
          {editing.kind === "places" && <>
            <AmenitySelect {...props} name="category" choices={placeCategories} required />
            {['rail', 'expressway'].includes(String(row.category)) && <AmenityField entity={entity} name="ref_id" fields={fields}><select id="c4-place-ref_id" value={stringValue(row, "ref_id")} onChange={e => {
              change("ref_id", e.target.value || null);const ref = (row.category === "rail" ? data.references.rail_stations : data.references.expressway_ramps).find(r => r.code === e.target.value);
              if (ref) { change("name", ref.name);change("status", ref.status);change("expected_open", ref.expected_open ?? null);change("as_of", ref.as_of); }
            }}><option value="">ไม่มีรายการอ้างอิง · ระบุข้อมูลที่ตรวจสอบเอง</option>{(row.category === "rail" ? data.references.rail_stations : data.references.expressway_ramps).map(ref => <option key={ref.code} value={ref.code}>{localized(ref, "name").th}</option>)}</select></AmenityField>}
            <AmenityText {...props} name="name" /><div className="content-two-columns"><AmenityNumber {...props} name="distance_m" /><AmenitySelect {...props} name="distance_method" choices={{ road: "ตามเส้นทางถนน", straight_line: "เส้นตรง" }} /></div>
            <div className="content-two-columns"><AmenityNumber {...props} name="travel_minutes" max={1440} /><AmenitySelect {...props} name="travel_mode" choices={{ walk: "เดิน", car: "รถยนต์", rail: "รถไฟฟ้า", bus: "รถโดยสาร", bicycle: "จักรยาน", boat: "เรือ" }} /></div>
            <AmenitySelect {...props} name="status" choices={placeStatus} required />{row.status !== "operating" && <AmenityDate {...props} name="expected_open" />}<AmenityDate {...props} name="as_of" required />
            <AmenityNumber {...props} name="sort" step="1" required /><AmenityField entity={entity} name="show_on_web" fields={fields}><input id="c4-place-show_on_web" type="checkbox" checked={row.show_on_web === true} onChange={e => change("show_on_web", e.target.checked)} /></AmenityField>
          </>}
          {editing.kind === "solar" ? <AmenitySelect {...props} name="ai_exposure" choices={{ web_only: "เว็บไซต์เท่านั้น", internal: "ภายใน Hub" }} required />
            : <ExposureInput value={(row.ai_exposure ?? "open") as Exposure} onChange={value => change("ai_exposure", value)} />}
        </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary" disabled={busy || workflowBusy || !canEdit}>{busy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}</button></div></form>
        <ContentWorkflow target={workflowTarget(editing.kind, row)} label={name(row, editing.kind)} revision={row.revision} disabled={busy || childDirty || workflowOwners.size > 0 && !workflowOwners.has(editing.kind + ":" + (row.code ?? row.id))} draft={{ dirty: true, valid: canEdit, sourceStamp: { revision: row.revision }, getChanges: () => form.current?.reportValidity() ? Object.fromEntries(keys[editing.kind].filter(key => row[key] !== undefined).map(key => [key, row[key]])) : null }} onEditingChange={value => workflowEditing(editing.kind + ":" + (row.code ?? row.id), value)} onChanged={async () => { await reload(); setEditing(null); }} onReload={async () => { await reload(); setEditing(null); }} />
      </section>}
      {(tab === "features" ? ["features", "solar"] as Kind[] : [tab]).map(kind => <section className="content-section" key={kind}><div className="content-toolbar"><h2>{titles[kind]}</h2>{kind !== "facilities" && canEdit && <button className="button secondary" disabled={disabled} onClick={() => edit(kind)}>เพิ่ม{titles[kind]}</button>}</div>
        {kind === "facilities" && <p>ค่าว่างหรือยังไม่ตอบคือ “ยังไม่ทราบ” ส่วนกลางที่อยู่ในแผนยังไม่ถือว่าเปิดใช้งาน</p>}
        {!data[kind].length && <p>ยังไม่มีรายการ</p>}<div className="content-card-list">{data[kind].map(item => <article className="content-card" key={item.id ?? item.code} data-workspace-item={String(item.id ?? item.code)} tabIndex={-1}><h3 className="content-label">{kind === "facilities" && <FacilityIcon code={String(item.icon_code)} />}{name(item, kind)}</h3>
          {kind === "facilities" && <p className="field-help">{facilityGroups[String(item.group_code)] ?? String(item.group_code)}</p>}
          <p>{kind === "solar" ? ({ draft: "ร่าง · ยังไม่อนุมัติ", approved: "อนุมัติสถานการณ์แล้ว", withdrawn: "ถอนแล้ว" }[String(item.state)] ?? "ร่าง") : ((kind === "places" ? placeStatus : presence) as Record<string, string>)[String(item.status)] ?? String(item.status ?? "ยังไม่ทราบ")}</p>
          {kind === "facilities" && <><p>{localized(item, "location_label").th || "ยังไม่ระบุตำแหน่ง"} · {item.size_sqm == null ? "ยังไม่ระบุขนาด" : `${item.size_sqm} ตร.ม.`}</p><p>{localized(item, "opening_hours").th || "ยังไม่ระบุเวลาเปิดใช้"}</p><p>{localized(item, "description").th}</p></>}
          {kind === "features" && <><p className="field-help">{item.commercial_type_id ? `ใช้กับ ${data.unit_types.find(t => t.id === item.commercial_type_id)?.name.th ?? "แบบที่อยู่อาศัยที่เลือก"}` : "ใช้ทั้งโครงการ"}</p><p>{localized(item, "detail").th}</p><dl className="c4-summary">{Object.entries((item.metrics ?? {}) as Record<string, unknown>).map(([key, value]) => {
            const metric = data.references.features.find(f => f.code === item.feature_code)?.metric_defs[key];
            return <div key={key}><dt>{metric?.label.th ?? key}{metric?.unit && ` (${metric.unit})`}</dt><dd>{typeof value === "object" && value ? (value as Locales).th : String(value)}</dd></div>;
          })}</dl></>}
          {kind === "solar" && <><dl className="c4-summary"><div><dt>กำลังระบบ</dt><dd>{String(item.system_kw)} kW</dd></div><div><dt>ค่าไฟก่อน / หลัง</dt><dd>{String(item.bill_before)} / {String(item.bill_after)} บาท</dd></div><div><dt>สัดส่วนประหยัดที่กรอก</dt><dd>{String(item.saving_pct)}%</dd></div></dl><p>{localized(item, "usage_profile").th}</p><p>{localized(item, "assumptions").th}</p><p>แหล่งข้อมูล: {localized(item, "source_note").th}</p></>}
          {kind === "places" && <><p>{item.distance_m == null ? "ยังไม่ทราบระยะทาง" : `${item.distance_m} เมตร · ${item.distance_method === "road" ? "ตามถนน" : "เส้นตรง"}`}</p><p>ข้อมูล ณ {String(item.as_of)} · {item.show_on_web ? "เลือกให้แสดงบนเว็บเมื่อเผยแพร่" : "ไม่แสดงบนเว็บ"}</p></>}
          <div className="content-actions">{canEdit && (kind !== "solar" || item.state === "draft") && <button className="button secondary" disabled={disabled} onClick={() => edit(kind, item)}>แก้ไข {name(item, kind)}</button>}
            {kind === "facilities" && ['present', 'planned'].includes(String(item.status)) && <button className="button secondary" disabled={disabled} aria-expanded={photos === item.code} onClick={() => setPhotos(photos === item.code ? null : item.code!)}>ภาพ {name(item, kind)}</button>}
            {kind === "solar" && canApprove && item.state === "approved" && <button className="button secondary" disabled={disabled} onClick={() => { setWithdrawal(item); setWithdrawalReason(""); setError(""); }}>ถอนสถานการณ์</button>}
          </div>{!editing && <ContentWorkflow target={workflowTarget(kind, item)} label={name(item, kind)} revision={item.revision} disabled={busy || childDirty || workflowOwners.size > 0 && !workflowOwners.has(kind + ":" + (item.code ?? item.id))} onEditingChange={value => workflowEditing(kind + ":" + (item.code ?? item.id), value)} onChanged={reload} onReload={reload} />}{kind === "facilities" && photos === item.code && <FacilityPhotos projectId={projectId} code={item.code!} media={data.media} fields={fields} canEdit={canEdit && !busy && !workflowBusy} onChanged={reload} onEditingChange={setChildDirty} />}
        </article>)}</div>
      </section>)}
      {tab === "places" && <section className="content-section"><h2>สถานีใกล้เคียงที่แนะนำ</h2><p className="field-help">ระยะเส้นตรงจากพิกัดอ้างอิง ไม่ใช่ระยะถนนหรือเวลาเดินทาง ต้องตรวจสถานะและวันที่ข้อมูลก่อนบันทึก</p>
        {!data.nearest_stations.length && <p>ยังไม่มีพิกัดโครงการหรือพิกัดสถานีอ้างอิง จึงยังแนะนำสถานีไม่ได้</p>}{data.nearest_stations.map(station => <article key={station.code}><p>{localized(station, "name").th} · {String(station.distance_m)} เมตร · {placeStatus[String(station.status) as keyof typeof placeStatus]}</p>{canEdit && <button className="button secondary" disabled={disabled} onClick={() => edit("places", { ...emptyRow("places"), category: "rail", ref_id: station.code, name: station.name, distance_m: station.distance_m, distance_method: "straight_line", status: station.status, expected_open: station.expected_open, as_of: station.as_of })}>เลือกสถานี {localized(station, "name").th}</button>}</article>)}
      </section>}
      {!editing && !photos && <details><summary>ตรวจภาษาอังกฤษของข้อมูลส่วนนี้</summary><TranslationReviewPanel items={data.translations.filter(t => tab === "facilities" ? t.owner_type === "facility" : tab === "features" ? ['feature', 'solar_estimate'].includes(t.owner_type) : t.owner_type === "place")} fields={fields} canEdit={canEdit && !busy && !workflowBusy} onChanged={reload} onEditingChange={setChildDirty} /></details>}
      {!editing && !photos && <PlaceReferences references={data.references} group={tab} fields={fields} canApprove={canApprove} onChanged={reload} onEditingChange={setChildDirty} />}
    </>}
  </div>;
}
