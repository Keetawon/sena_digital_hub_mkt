"use client";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHubPermissions } from "./accounts";
import { ContentWorkflow } from "./content-workflow";
import { request } from "./hub-request";
import { uploadAsset } from "./project-assets";
import { newMetadata, type MediaAsset } from "./media-common";
import { BilingualInput, ContentLabel, ExposureInput, TranslationReviewPanel, errorMessage, type ContentField, type Exposure, type Locales, type Translation } from "./content-common";

type Kind = "disclosures" | "sales-terms" | "programmes" | "construction";
type Values = Record<string, unknown>;
type Item = Values & { id: string; revision: number; state: string; readiness: { ready: boolean; items: { field_key: string; label: Locales; complete: boolean; mismatch?: boolean }[] }; history: { id: string; revision: number; state: string; payload: Values }[] };
type Workspace = { project: { public_name: Locales; updated_at: string }; records: Record<Kind, Item[]>; comparison: Values; translations: Translation[]; legal_documents: { id: string; filename: string }[] };
type InputType = "locale" | "number" | "integer" | "date" | "text" | "list" | "bool" | "asset";
type FieldSpec = { key: string; type: InputType; options?: Record<string, string> };
const groups: Record<Kind, { title: string; entity: string; fields: FieldSpec[] }> = {
  disclosures: { title: "ข้อมูลตามกฎหมาย", entity: "disclosure", fields: [
    ...["owner_company", "owner_address", "managing_director", "legal_project_name", "location_text"].map(key => ({ key, type: "locale" as const })),
    ...["registered_capital", "paid_capital", "land_area_sqwah"].map(key => ({ key, type: "number" as const })),
    { key: "title_deeds", type: "list" }, { key: "land_numbers", type: "list" },
    { key: "encumbrance", type: "text", options: { none: "ไม่มีภาระผูกพัน", mortgage: "จำนอง" } }, { key: "bank", type: "locale" },
    { key: "building_description", type: "locale" }, { key: "building_count", type: "integer" }, { key: "unit_total", type: "integer" },
    { key: "eia_status", type: "text", options: { not_required: "ไม่ต้องจัดทำ EIA", pending: "อยู่ระหว่างพิจารณา", approved: "ได้รับอนุมัติ" } },
    { key: "eia_approval_date", type: "date" }, { key: "construction_start_year", type: "integer" }, { key: "construction_completion_year", type: "integer" },
    { key: "notes", type: "locale" }, { key: "basis", type: "text", options: { mkt_entered: "Marketing กรอก", legal_document: "อ้างอิงเอกสาร Legal", legal_approved: "Legal ตรวจแล้ว มีหลักฐาน", website_import: "ดึงจากเว็บไซต์สาธารณะ SENA · รอตรวจ" } },
    { key: "legal_document_asset_id", type: "asset" }, { key: "legal_doc_ref", type: "text" }, { key: "legal_doc_date", type: "date" },
    { key: "legal_reviewed_by", type: "text" }, { key: "legal_reviewed_at", type: "date" }, { key: "override_reason", type: "text" },
  ] },
  "sales-terms": { title: "เงื่อนไขขาย", entity: "sales_term", fields: [
    ...["booking_fee", "contract_fee", "down_payment", "installment_from", "interest_rate"].map(key => ({ key, type: "number" as const })),
    ...["installment_basis", "rate_period", "lender", "conditions"].map(key => ({ key, type: "locale" as const })),
    { key: "valid_from", type: "date" }, { key: "valid_to", type: "date" },
  ] },
  programmes: { title: "โครงการบริการ", entity: "programme", fields: [
    { key: "programme_key", type: "text" }, { key: "participating", type: "bool" }, { key: "monthly_from", type: "number" },
    { key: "basis", type: "locale" }, { key: "as_of", type: "date" },
  ] },
  construction: { title: "ความคืบหน้าก่อสร้าง", entity: "construction_progress", fields: [
    { key: "component", type: "text", options: { overall: "ภาพรวม", structure: "โครงสร้าง", architecture: "สถาปัตยกรรม", systems: "ระบบประกอบอาคาร", landscape: "ภูมิทัศน์", other: "อื่น ๆ" } },
    { key: "percent", type: "number" }, { key: "as_of", type: "date" }, { key: "source", type: "text", options: { construction: "ฝ่ายก่อสร้าง", mkt: "Marketing", website_import: "ดึงจากเว็บไซต์สาธารณะ SENA · รอตรวจ" } },
  ] },
};
const stateLabels: Record<string, string> = { draft: "ร่าง", in_review: "ส่งตรวจแล้ว", approved: "อนุมัติแล้ว", returned: "ส่งกลับแก้ไข", withdrawn: "ถอนแล้ว" };
const privateFields = new Set(["legal_document_asset_id", "legal_doc_ref", "legal_doc_date", "legal_reviewed_by", "legal_reviewed_at", "override_reason"]);
const valueText = (value: unknown, spec: FieldSpec) => value == null || value === "" ? "ยังไม่ทราบ" : spec.type === "locale" ? [(value as Locales).th, (value as Locales).en].filter(Boolean).join(" · ") || "ยังไม่ทราบ" : Array.isArray(value) ? value.join(", ") || "ยังไม่ทราบ" : spec.type === "bool" ? value ? "เข้าร่วม" : "ไม่เข้าร่วม" : spec.options?.[String(value)] ?? String(value);

export function ProjectCommercialWorkspace({ projectId, fields, onEditingChange, onWorkflowChanged }: { projectId: string; fields: ContentField[]; onEditingChange: (value: boolean) => void; onWorkflowChanged?: () => void }) {
  const permissions = useHubPermissions(), canView = permissions.can("projects"), canEdit = permissions.can("projects", "edit"), canApprove = permissions.can("projects", "approve");
  const query = useSearchParams(), targetField = query.get("field") ?? "";
  const requestedKind = (Object.entries(groups).find(([, group]) => targetField.startsWith(group.entity + "."))?.[0] ?? "disclosures") as Kind;
  const permissionKey = JSON.stringify(permissions.capabilities.tabs);
  const [data, setData] = useState<Workspace | null>(null), [kind, setKind] = useState<Kind>(requestedKind), [editing, setEditing] = useState<{ id?: string; values: Values; stamp: string } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const [workflowOwners, setWorkflowOwners] = useState<Set<string>>(() => new Set());
  const workflowBusy = workflowOwners.size > 0;
  const workflowEditing = (key: string, value: boolean) => setWorkflowOwners(owners => { if (owners.has(key) === value) return owners; const next = new Set(owners); if (value) next.add(key); else next.delete(key); return next; });
  const [translationEditing, setTranslationEditing] = useState(false);
  const base = `v1/admin/projects/${encodeURIComponent(projectId)}/commercial`;
  const reload = useCallback(async () => { setData(await request<Workspace>(base)); onWorkflowChanged?.(); }, [base, onWorkflowChanged]);
  useEffect(() => { let active = true; setData(null);
    if (canView) request<Workspace>(base).then(value => { if (active) setData(value); }).catch(error => { if (active) setError(errorMessage(error)); });
    return () => { active = false; };
  }, [base, permissionKey, canView]);
  useEffect(() => { onEditingChange(Boolean(editing) || translationEditing || busy || workflowBusy); return () => onEditingChange(false); }, [editing, translationEditing, busy, workflowBusy, onEditingChange]);
  const group = groups[kind], label = (spec: FieldSpec) => fields.find(field => field.field_key === `${group.entity}.${spec.key}`);
  const specs = group.fields.filter(spec => !privateFields.has(spec.key) || canEdit || canApprove);
  function edit(item?: Item) {
    if (!data || !canEdit || busy || workflowBusy || translationEditing) return;
    const values: Values = { ai_exposure: item?.ai_exposure ?? "web_only" };
    for (const spec of group.fields) values[spec.key] = item?.[spec.key] ?? (spec.type === "locale" ? {} : spec.type === "list" ? [] : spec.key === "basis" && kind === "disclosures" ? "mkt_entered" : null);
    setEditing({ id: item?.id, values, stamp: data.project.updated_at }); setError(""); setNotice("");
  }
  function change(key: string, value: unknown) { setEditing(prior => prior && ({ ...prior, values: { ...prior.values, [key]: value } })); }
  async function act(work: () => Promise<unknown>, message: string) {
    if (busy || workflowBusy || translationEditing) return; setBusy(true); setError(""); setNotice("");
    try { await work(); await reload(); setNotice(message); return true; }
    catch (error) { setError(errorMessage(error)); return false; } finally { setBusy(false); }
  }
  function draftChanges() {
    if (!editing || !form.current?.reportValidity()) return null;
    const values = { ...editing.values };
    for (const spec of group.fields.filter(field => field.type === "list")) values[spec.key] = (values[spec.key] as string[]).map(value => value.trim()).filter(Boolean);
    return values;
  }
  async function save() {
    if (!editing || !canEdit) return;
    const values = { ...editing.values };
    for (const spec of group.fields.filter(field => field.type === "list")) values[spec.key] = (values[spec.key] as string[]).map(value => value.trim()).filter(Boolean);
    const ok = await act(() => request(editing.id ? `${base}/${kind}/${editing.id}` : `${base}/${kind}`, editing.id ? "PUT" : "POST", { updated_at: editing.stamp, record: { kind, ...values } }), "บันทึกร่างแล้ว ตรวจภาษาอังกฤษก่อนส่งตรวจ");
    if (ok) setEditing(null);
  }
  async function upload(file?: File) {
    if (!file || !canEdit || !editing) return;
    await act(async () => {
      const asset = (await uploadAsset(file)).asset as MediaAsset;
      if (asset.media_category !== "legal_document") await request(`v1/admin/projects/${encodeURIComponent(projectId)}/media/assets/${asset.id}`, "PUT", { expected_revision: asset.media_revision ?? 0, changes: { ...newMetadata(), media_category: "legal_document", ai_exposure: "internal", marketing_publication: false, image_kind: null } });
      change("legal_document_asset_id", asset.id);
    }, "อัปโหลดเอกสารส่วนตัวแล้ว กดบันทึกร่างเพื่อแนบกับฉบับนี้");
  }
  if (!canView) return <p>สิทธิ์ดูข้อมูลส่วนนี้ถูกเปลี่ยน ข้อมูลที่กำลังกรอกยังเก็บไว้ในแบบฟอร์ม</p>;
  return <section className="content-section" aria-label="ข้อมูลขายและกฎหมาย"><h2>ข้อมูลขายและกฎหมายของเฟสนี้</h2><p>ค่าว่างหมายถึงยังไม่ทราบ</p>
    <p><a href={`/content?project=${encodeURIComponent(projectId)}&tab=investor`}>ข้อมูลสำหรับผู้ลงทุนและประมาณการผลตอบแทน</a></p>
    <nav className="content-tabs" aria-label="ประเภทข้อมูลขาย">{(Object.entries(groups) as [Kind, typeof group][]).map(([key, info]) => <button key={key} disabled={busy || workflowBusy || Boolean(editing) || translationEditing} aria-current={kind === key ? "page" : undefined} onClick={() => { setKind(key); setError(""); setNotice(""); }}>{info.title}</button>)}</nav>
    {error && <p role="alert" className="notice error">{error} ข้อมูลที่กรอกยังอยู่ หากข้อมูลเปลี่ยน ให้ยกเลิกแล้วเปิดฉบับล่าสุด</p>}{notice && <p role="status" className="notice success">{notice}</p>}
    {!data ? <p role="status">กำลังโหลดข้อมูล…</p> : <>
      {kind === "disclosures" && <aside className="content-machine"><strong>ข้อมูลสำหรับตรวจเทียบ</strong><p>พื้นที่ {String(data.comparison.land_area_sqwah ?? "ยังไม่ทราบ")} ตร.ว. · อาคาร {String(data.comparison.building_count ?? "ยังไม่ทราบ")} · ยูนิต {String(data.comparison.unit_total ?? "ยังไม่ทราบ")}</p><p>รายละเอียดอาคารและจำนวนต้องตรงกับทะเบียน หากใช้ค่าต่างต้องระบุเหตุผลให้ผู้อนุมัติตรวจ</p><p>เอกสาร Legal เห็นเฉพาะผู้แก้ไข/ผู้อนุมัติโครงการ ไม่ส่งไปเว็บไซต์หรือ AI · ปีใช้ ค.ศ.</p></aside>}
      {kind === "programmes" && <p className="inline-warning">ยูนิตที่เสนอจาก REM: ยังไม่มีข้อมูล · รอ IT ยืนยัน ห้ามกรอกเอง</p>}
      {kind === "construction" && <p className="field-help">รายงานงานก่อสร้าง ไม่เกี่ยวกับคะแนนความพร้อมของเนื้อหา</p>}
      {!editing && canEdit && (!data.records[kind].length || ["programmes", "construction"].includes(kind)) && <button className="button primary" disabled={busy || workflowBusy || translationEditing} onClick={() => edit()}>เพิ่ม{group.title}</button>}
      {!editing && !data.records[kind].length && <p>ยังไม่มี{group.title}ของเฟสนี้</p>}
      {editing && <form ref={form} inert={workflowBusy} onSubmit={event => { event.preventDefault(); void save(); }}><h3>{editing.id ? "แก้ไข" : "เพิ่ม"}{group.title}</h3><fieldset disabled={busy || !canEdit}>
        {specs.map(spec => {
          const field = label(spec), id = `commercial-${spec.key}`, value = editing.values[spec.key];
          if (spec.type === "locale") return <BilingualInput key={spec.key} id={id} field={field} value={(value ?? {}) as Locales} onChange={value => change(spec.key, value)} rows={2} maxLength={4000} />;
          return <div className="content-input" key={spec.key}><ContentLabel htmlFor={id} field={field} />
            {spec.type === "asset" ? <><select id={id} value={String(value ?? "")} onChange={event => change(spec.key, event.target.value || null)}><option value="">ยังไม่แนบเอกสาร</option>{data.legal_documents.map(item => <option key={item.id} value={item.id}>{item.filename}</option>)}</select><label>อัปโหลดเอกสาร Legal ส่วนตัว<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={event => void upload(event.target.files?.[0])} /></label></>
              : spec.options ? <select id={id} value={String(value ?? "")} onChange={event => change(spec.key, event.target.value || null)}><option value="">ยังไม่ทราบ</option>{Object.entries(spec.options).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
              : spec.type === "bool" ? <select id={id} value={value == null ? "" : String(value)} onChange={event => change(spec.key, event.target.value === "" ? null : event.target.value === "true")}><option value="">ยังไม่ทราบ</option><option value="true">เข้าร่วม</option><option value="false">ไม่เข้าร่วม</option></select>
              : spec.type === "list" ? <textarea id={id} rows={2} value={Array.isArray(value) ? value.join("\n") : ""} onChange={event => change(spec.key, event.target.value.split("\n"))} aria-describedby={`${id}-hint`} />
              : <input id={id} type={spec.type === "integer" ? "number" : spec.type} step={spec.type === "integer" ? "1" : "any"} min={spec.key.includes("year") ? 1900 : spec.type === "number" || spec.type === "integer" ? 0 : undefined} max={spec.key.includes("year") ? 2200 : ["percent", "interest_rate"].includes(spec.key) ? 100 : undefined} maxLength={4000} value={String(value ?? "")} onChange={event => change(spec.key, event.target.value === "" ? null : ["number", "integer"].includes(spec.type) ? Number(event.target.value) : event.target.value)} />}
            {spec.type === "list" && <p id={`${id}-hint`} className="field-help">หนึ่งรายการต่อบรรทัด เก็บเลขศูนย์นำหน้าตามเอกสาร</p>}
          </div>;
        })}
        <ExposureInput value={editing.values.ai_exposure as Exposure} onChange={value => change("ai_exposure", value)} />
        <p className="field-help">คำแปลข้อมูลกฎหมายและเงื่อนไขขายต้องกรอกและตรวจเอง ไม่ส่งให้ AI</p>
        <div className="content-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>ยกเลิก</button><button className="button primary">บันทึกร่าง</button></div>
      </fieldset>{!canEdit && <button type="button" className="button secondary" onClick={() => setEditing(null)}>ปิดแบบฟอร์ม</button>}</form>}
      {editing?.id && <ContentWorkflow target={{ kind: ({ disclosures: "disclosure", "sales-terms": "sales_term", programmes: "programme", construction: "progress" } as const)[kind], identity: { id: editing.id } }} label={group.title} revision={editing.stamp} disabled={busy || translationEditing || workflowOwners.size > 0 && !workflowOwners.has("record:" + editing.id)} draft={{ dirty: true, valid: canEdit, sourceStamp: { updated_at: editing.stamp }, getChanges: draftChanges }} onEditingChange={value => workflowEditing("record:" + editing.id, value)} onChanged={async () => { await reload(); setEditing(null); }} onReload={async () => { await reload(); setEditing(null); }} />}
      {!editing && data.records[kind].map(item => <article className="content-card" key={item.id} data-workspace-item={item.id} tabIndex={-1}><h3>{group.title} · ฉบับ {item.revision}</h3><p className="content-state">{stateLabels[item.state]} · การอนุมัติข้อมูลยังไม่ใช่การเผยแพร่หน้าเว็บไซต์</p>
        <dl className="commercial-record-values">{specs.map(spec => <div key={spec.key} data-workspace-field={`${group.entity}.${spec.key}`} tabIndex={-1}><dt>{label(spec)?.label.th}</dt><dd className="content-preserve">{spec.type === "asset" && item[spec.key] ? <a href={`/api/hub/v1/admin/assets/${item[spec.key]}/file`}>เปิดเอกสารส่วนตัว</a> : valueText(item[spec.key], spec)}</dd></div>)}</dl>
        <ul className="content-checklist">{item.readiness.items.map(check => <li key={check.field_key}>{check.complete ? "✓" : "○"} {check.label.th}{check.mismatch ? " · ค่าต่างหรือยังไม่มีข้อเท็จจริงอ้างอิง" : ""}</li>)}</ul>
        <div className="content-actions">{canEdit && item.state !== "in_review" && <button className="button secondary" disabled={busy || workflowBusy || translationEditing} onClick={() => edit(item)}>แก้ไขฉบับ</button>}
          {canApprove && item.state === "approved" && <button className="button secondary" disabled={busy || workflowBusy || translationEditing} onClick={() => void act(() => request(`${base}/${kind}/${item.id}/review`, "POST", { updated_at: data.project.updated_at, decision: "withdraw" }), "ถอนฉบับแล้ว")}>ถอนการอนุมัติ</button>}
        </div><ContentWorkflow target={{ kind: ({ disclosures: "disclosure", "sales-terms": "sales_term", programmes: "programme", construction: "progress" } as const)[kind], identity: { id: item.id } }} label={group.title} revision={`${item.revision}:${data.project.updated_at}`} submitDisabled={!item.readiness.ready} disabled={busy || translationEditing || workflowOwners.size > 0 && !workflowOwners.has("record:" + item.id)} onEditingChange={value => workflowEditing("record:" + item.id, value)} onChanged={reload} onReload={reload} /><details><summary>ประวัติฉบับที่ส่งตรวจ</summary>{!item.history.length ? <p>ยังไม่เคยส่งตรวจ</p> : item.history.map(version => <section key={version.id}><h4>ฉบับ {version.revision} · {stateLabels[version.state]}</h4><dl className="commercial-record-values">{specs.map(spec => <div key={spec.key}><dt>{label(spec)?.label.th}</dt><dd>{spec.type === "asset" ? version.payload[spec.key] ? <a href={`/api/hub/v1/admin/assets/${version.payload[spec.key]}/file`}>{label(spec)?.label.th}</a> : "?" : valueText(version.payload[spec.key], spec)}</dd></div>)}</dl></section>)}</details>
      </article>)}
      {!editing && <TranslationReviewPanel items={data.translations.filter(item => item.owner_type === group.entity)} fields={fields} canEdit={canEdit && !busy && !workflowBusy} onChanged={reload} onEditingChange={setTranslationEditing} />}
    </>}
  </section>;
}
