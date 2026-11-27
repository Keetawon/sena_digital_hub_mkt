"use client";
import { workspaceText } from "@/lib/unified-workspace";
import { useEffect, useRef, useState } from "react";
import { request } from "./hub-request";
import { WritingAidError, type WritingAcceptance } from "@/lib/writing-aid";
import { ContentWorkflow } from "./content-workflow";
import { BilingualInput, ContentLabel, ExposureInput, exposureLabels, FieldInfo, WritingFields, contentDate, errorMessage, useWritingTranslations, type ContentField, type Exposure, type Locales } from "./content-common";

type SectionVersion = { version_no: number; body: Locales; state: string; source_ref: string | null; ai_exposure: Exposure; created_at: string };
export type NarrativeSection = { id: string; section_key: string | null; revision: number; state: string; version: SectionVersion; history: SectionVersion[] };
export type SellingPoint = { point_key: string; revision: number; title: Locales; detail: Locales; icon_code: string; linked_feature_code: string | null; linked_fact_keys: string[]; sort: number; state: string; ai_exposure: Exposure; created_at?: string; history?: SellingPoint[] };
type SectionDraft = { id?: string; key: string; revision: number; body: Locales; source: string; exposure: Exposure };
const features: Record<string, string> = { vmove: "VMOVE", joint_venture: "พันธมิตร", fresh_air: "อากาศบริสุทธิ์", pm25_filter: "กรอง PM2.5", universal_design: "การออกแบบเพื่อทุกคน", low_carbon: "ลดคาร์บอน", non_dee: "นอนดี", smart_camera: "กล้องอัจฉริยะ", smart_app: "แอปอัจฉริยะ", smart_home: "บ้านอัจฉริยะ", smart_parking: "ที่จอดรถอัจฉริยะ", bms: "ระบบจัดการอาคาร", solar_rooftop: "โซลาร์รูฟท็อป", ev_charger: "ชาร์จรถไฟฟ้า", cctv: "กล้องวงจรปิด", key_card: "คีย์การ์ด", guard_24h: "เจ้าหน้าที่รักษาความปลอดภัย", easy_pass: "ทางเข้าอัตโนมัติ", lift_lock: "ลิฟต์ล็อกชั้น" };
export const stateLabel = (state: string) => ({ DRAFT: workspaceText.DRAFT, IN_REVIEW: workspaceText.IN_REVIEW, APPROVED: workspaceText.APPROVED, PUBLISHED: workspaceText.PUBLISHED, RETURNED: workspaceText.RETURNED, WITHDRAWN: "ถอนฉบับแล้ว" }[state] ?? workspaceText.DRAFT);

function initialSectionDraft(item: ContentField, current?: NarrativeSection): SectionDraft {
  return {
    id: current?.id,
    key: item.field_key,
    revision: current?.revision ?? 0,
    body: { ...(current?.version.body ?? {}) },
    source: current?.version.source_ref ?? "",
    exposure: current?.version.ai_exposure ?? item.default_ai_exposure,
  };
}

function isSectionDraftDirty(draft: SectionDraft, item: ContentField, current?: NarrativeSection): boolean {
  const savedTh = current?.version.body.th ?? "";
  const savedEn = current?.version.body.en ?? "";
  const savedSource = current?.version.source_ref ?? "";
  const savedExposure = current?.version.ai_exposure ?? item.default_ai_exposure;
  return (
    (draft.body.th ?? "") !== savedTh ||
    (draft.body.en ?? "") !== savedEn ||
    draft.source !== savedSource ||
    draft.exposure !== savedExposure
  );
}

export function ContentNarrative({ projectId = "", projectRowId, apiBase, heading, corporate = false, standaloneBusiness = false, sections, points, fields, canEdit, onChanged, onEditingChange, showPoints = true }: {
  showPoints?: boolean; corporate?: boolean; standaloneBusiness?: boolean; projectId?: string; projectRowId?: string; apiBase?: string; heading?: string; sections: NarrativeSection[]; points: SellingPoint[]; fields: ContentField[]; canEdit: boolean;
  onChanged: () => Promise<void>; onEditingChange: (value: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, SectionDraft>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const sectionForms = useRef<Record<string, HTMLFormElement | null>>({}), pointForm = useRef<HTMLFormElement>(null);
  const [workflowOwners, setWorkflowOwners] = useState<string[]>([]), [workflowRevision, setWorkflowRevision] = useState(0);
  const workflowActive = workflowOwners.length > 0;
  function workflowEditing(owner: string, active: boolean) {
    setWorkflowOwners(owners => owners.includes(owner) === active ? owners : active ? [...owners, owner] : owners.filter(value => value !== owner));
  }
  const [point, setPoint] = useState<SellingPoint | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const activeSections = fields.filter(item => item.entity === "section" && item.status === "active" && (corporate ? item.field_key.startsWith("section.corporate_") : standaloneBusiness ? item.field_key.startsWith("section.business_") : !item.field_key.startsWith("section.corporate_") && !item.field_key.startsWith("section.business_")));
  const dirtyKeys = Object.keys(drafts);
  const anySectionDirty = dirtyKeys.length > 0;
  useEffect(() => { onEditingChange(Boolean(anySectionDirty || point || pending || workflowActive)); return () => onEditingChange(false); }, [anySectionDirty, point, pending, workflowActive, onEditingChange]);
  const base = apiBase ?? `v1/admin/projects/${encodeURIComponent(projectId)}`;
  const field = (key: string) => fields.find(item => item.field_key === key);
  const writing = useWritingTranslations(`${base}/content`, JSON.stringify([sections.map(item => [item.id, item.revision]), points.map(item => [item.point_key, item.revision])]), canEdit && fields.some(item => item.ai_writing_enabled));

  function updateSectionDraft(item: ContentField, current: NarrativeSection | undefined, patch: Partial<SectionDraft>) {
    setError("");
    setNotice("");
    setDrafts(prev => {
      const existing = prev[item.field_key] ?? initialSectionDraft(item, current);
      const next: SectionDraft = { ...existing, ...patch };
      if (!isSectionDraftDirty(next, item, current)) {
        if (!(item.field_key in prev)) return prev;
        const copy = { ...prev };
        delete copy[item.field_key];
        return copy;
      }
      return { ...prev, [item.field_key]: next };
    });
  }

  function clearSectionDraft(fieldKey: string) {
    setError("");
    setDrafts(prev => {
      if (!(fieldKey in prev)) return prev;
      const copy = { ...prev };
      delete copy[fieldKey];
      return copy;
    });
  }

  async function acceptSection(current: NarrativeSection, acceptance: WritingAcceptance) {
    const activeDraft = current.section_key ? drafts[current.section_key] : undefined;
    if (!canEdit || current.state.toUpperCase() === "IN_REVIEW" || acceptance.expectedDraft.revision !== current.revision || activeDraft && JSON.stringify(activeDraft.body) !== JSON.stringify(current.version.body)) throw new WritingAidError("stale");
    setPending(true);
    try {
      await request(`${base}/sections/${current.section_key}`, "PUT", { expected_revision: acceptance.expectedDraft.revision,
        changes: { body: { ...current.version.body, [acceptance.language]: acceptance.after }, source_ref: current.version.source_ref, ai_exposure: current.version.ai_exposure } });
      await writing.reload(); await reloadWorkflow();
    } finally { setPending(false); }
  }
  async function acceptPoint(current: SellingPoint, key: "title" | "detail", acceptance: WritingAcceptance) {
    if (!canEdit || current.state.toUpperCase() === "IN_REVIEW" || acceptance.expectedDraft.revision !== current.revision || point && JSON.stringify(point) !== JSON.stringify(current)) throw new WritingAidError("stale");
    setPending(true);
    try {
      const { title, detail, icon_code, linked_feature_code, linked_fact_keys, sort, state, ai_exposure } = current;
      await request(`${base}/selling-points/${current.point_key}`, "PUT", { expected_revision: acceptance.expectedDraft.revision,
        changes: { title, detail, icon_code, linked_feature_code, linked_fact_keys, sort, state, ai_exposure, [key]: { ...current[key], [acceptance.language]: acceptance.after } } });
      await writing.reload(); await reloadWorkflow();
    } finally { setPending(false); }
  }
  const draftPayload = (draft: SectionDraft) => ({ body: draft.body, source_ref: draft.source || null, ai_exposure: draft.exposure });
  const pointChanges = () => point ? { title: point.title, detail: point.detail, icon_code: point.icon_code, linked_feature_code: point.linked_feature_code, linked_fact_keys: point.linked_fact_keys, sort: point.sort, state: point.state, ai_exposure: point.ai_exposure } : null;
  async function reloadWorkflow() { await onChanged(); setDrafts({}); setPoint(null); setError(""); setWorkflowRevision(value => value + 1); }
  async function saveSection(fieldKey: string, draft: SectionDraft) {
    if (pending || workflowActive || !canEdit || sections.some(item => item.section_key === fieldKey && item.state.toUpperCase() === "IN_REVIEW")) return;
    setPending(true); setError(""); setNotice("");
    try {
      await request(`${base}/sections/${fieldKey}`, "PUT", { expected_revision: draft.revision, changes: draftPayload(draft) });
      await onChanged();
      clearSectionDraft(fieldKey);
      setNotice("บันทึกฉบับแล้ว ยังไม่มีการเผยแพร่ขึ้นเว็บไซต์");
    } catch (err) { setError(errorMessage(err)); } finally { setPending(false); }
  }
  async function mutatePoint(path: string, method: string, body: unknown) {
    if (pending || workflowActive || !canEdit || point && points.some(item => item.point_key === point.point_key && item.state.toUpperCase() === "IN_REVIEW")) return;
    setPending(true); setError(""); setNotice("");
    try { await request(path, method, body); await onChanged(); setPoint(null); setNotice("บันทึกฉบับแล้ว ยังไม่มีการเผยแพร่ขึ้นเว็บไซต์"); }
    catch (err) { setError(errorMessage(err)); } finally { setPending(false); }
  }
  const editing = Boolean(anySectionDirty || point);
  const pointFrozen = Boolean(point && points.some(item => item.point_key === point.point_key && item.state.toUpperCase() === "IN_REVIEW"));
  const allCollapsed = activeSections.length > 0 && activeSections.every(item => collapsed[item.field_key]);
  const allExpanded = activeSections.every(item => !collapsed[item.field_key]);
  return <section className="content-section">
    <div className="content-toolbar content-section-header-bar">
      <h2>{heading ?? "เนื้อหาและจุดขาย"}</h2>
      {activeSections.length > 1 && (
        <div className="content-collapse-all-group" role="group" aria-label="ย่อหรือขยายหมวดเนื้อหาทั้งหมด">
          <button
            type="button"
            className="button secondary content-collapse-btn"
            disabled={allExpanded}
            onClick={() => setCollapsed({})}
          >
            ขยายทั้งหมด
          </button>
          <button
            type="button"
            className="button secondary content-collapse-btn"
            disabled={allCollapsed}
            onClick={() => setCollapsed(Object.fromEntries(activeSections.map(s => [s.field_key, true])))}
          >
            ย่อทั้งหมด
          </button>
        </div>
      )}
    </div>
    <p className="field-help">พิมพ์เพิ่มหรือแก้ไขรายละเอียดในแต่ละหมวดได้ทันที ทุกครั้งที่บันทึกจะสร้างฉบับใหม่และเก็บประวัติเดิมไว้</p>
    {error && <p className="notice error" role="alert">{error} ข้อความที่กรอกยังอยู่</p>}{notice && <p className="notice success" role="status">{notice}</p>}
    <div className="content-card-list">{activeSections.map(item => {
      const current = sections.find(value => value.section_key === item.field_key);
      const frozen = current?.state.toUpperCase() === "IN_REVIEW";
      const draft = drafts[item.field_key] ?? initialSectionDraft(item, current);
      const isDirty = Boolean(drafts[item.field_key]);
      const isCollapsed = Boolean(collapsed[item.field_key]);
      const previewText = (draft.body.th || current?.version.body.th || "").trim();
      return <article className="content-card content-section-card" key={item.field_key} data-workspace-field={item.field_key} data-collapsed={isCollapsed} tabIndex={-1}>
        <div className="content-card-head">
          <div className="content-card-title-wrap">
            <div className="content-label"><h3>{item.label.th}</h3><FieldInfo field={item} /></div>
            <div className="content-card-badges">
              <span className="content-state">{current ? `${stateLabel(current.state)} · ฉบับ ${current.version.version_no}` : "ยังไม่มีเนื้อหา"}</span>
              {current && <span className="content-state">{exposureLabels[current.version.ai_exposure]}</span>}
              {isDirty && <span className="content-state is-dirty">กำลังแก้ไข · ยังไม่บันทึก</span>}
            </div>
          </div>
          <button
            type="button"
            className="button secondary content-collapse-btn"
            aria-expanded={!isCollapsed}
            aria-controls={`section-panel-${item.field_key}`}
            onClick={() => setCollapsed(prev => ({ ...prev, [item.field_key]: !isCollapsed }))}
          >
            {isCollapsed ? `ขยาย ${item.label.th}` : `ย่อ ${item.label.th}`}
          </button>
        </div>
        {isCollapsed ? (
          <p className="content-collapsed-preview">
            {previewText || "ยังไม่มีเนื้อหา — กดปุ่มขยายเพื่อพิมพ์รายละเอียด"}
          </p>
        ) : (
          <div id={`section-panel-${item.field_key}`} className="content-section-body">
            {canEdit && !frozen ? (
              <form
                ref={el => { sectionForms.current[item.field_key] = el; }}
                inert={Boolean(workflowActive)}
                onSubmit={event => { event.preventDefault(); void saveSection(item.field_key, draft); }}
              >
                <fieldset disabled={pending || !canEdit || frozen}>
                  <BilingualInput id={`section-body-${item.field_key}`} field={item} value={draft.body} onChange={body => updateSectionDraft(item, current, { body })} rows={4} />
                  <div className="content-two-columns">
                    <label className="content-input">แหล่งอ้างอิง<textarea rows={1} maxLength={1000} value={draft.source} onChange={event => updateSectionDraft(item, current, { source: event.target.value.replace(/[\r\n]+/g, " ") })} /></label>
                    <ExposureInput value={draft.exposure} onChange={exposure => updateSectionDraft(item, current, { exposure })} />
                  </div>
                </fieldset>
                {isDirty ? (
                  <div className="content-actions">
                    <button type="button" className="button secondary" disabled={pending || Boolean(workflowActive)} onClick={() => clearSectionDraft(item.field_key)}>คืนค่าเดิม</button>
                    <button type="submit" className="button primary" disabled={pending || Boolean(workflowActive) || !canEdit || frozen || !draft.body.th?.trim()}>บันทึกเนื้อหา</button>
                  </div>
                ) : (
                  <p className="field-help content-inline-ready-hint">
                    {current ? "พิมพ์แก้ไขในช่องด้านบนได้ทันที ปุ่มบันทึกจะแสดงเมื่อมีการเปลี่ยนแปลง" : "พิมพ์รายละเอียดในช่องภาษาไทยด้านบนได้ทันที ปุ่มบันทึกจะแสดงอัตโนมัติ"}
                  </p>
                )}
              </form>
            ) : (
              <>
                <p className="content-preserve">{current?.version.body.th || "ยังไม่มีเนื้อหา"}</p>
                {current?.version.body.en && <p className="content-preserve" lang="en">{current.version.body.en}</p>}
                {frozen && canEdit && <p className="field-help">ฉบับนี้อยู่ระหว่างรอตรวจอนุมัติ จึงล็อกการแก้ไขชั่วคราว</p>}
              </>
            )}
            {current && <WritingFields field={item} fields={fields} translations={writing.items} contextTranslations={writing.items.filter(source => source.owner_type === "section" && sections.some(sec => sec.id === source.owner_key))} ownerType="section" ownerKey={current.id}
              value={draft.body} savedValue={current.version.body} stamp={{ revision: isDirty ? draft.revision : current.revision }}
              dirty={Boolean(anySectionDirty || point)}
              canEdit={canEdit} disabled={pending || frozen || workflowOwners.some(owner => owner !== "writing:" + current.id)}
              onSaveDraft={isDirty ? () => sectionForms.current[item.field_key]?.requestSubmit() : undefined}
              onActivityChange={active => workflowEditing("writing:" + current.id, active)} onAccept={value => acceptSection(current, value)} />}
            {current && <ContentWorkflow key={`${current.id}:${workflowRevision}`} target={{ kind: "section", identity: { id: isDirty && draft.id ? draft.id : current.id } }} label={item.label.th || item.field_key}
              revision={isDirty ? draft.revision : current.revision} disabled={pending || Boolean(point || dirtyKeys.some(key => key !== item.field_key)) || workflowOwners.some(owner => owner !== current.id)}
              draft={isDirty && draft.id ? { dirty: true, valid: canEdit && Boolean(draft.body.th?.trim()), sourceStamp: { revision: draft.revision }, getChanges: () => sectionForms.current[item.field_key]?.reportValidity() ? draftPayload(draft) : null } : undefined}
              onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing(current.id, value)} />}
            {current && <details><summary>ประวัติ {item.label.th}</summary>{current.history.map(version => <div className="content-card" key={version.version_no}><strong>ฉบับ {version.version_no} · {stateLabel(version.state)} · {contentDate(version.created_at)}</strong><p className="content-preserve">{version.body.th}</p><p className="content-preserve" lang="en">{version.body.en}</p></div>)}</details>}
          </div>
        )}
      </article>;
    })}</div>
    {showPoints && <><div className="content-toolbar"><h2>จุดขาย {points.length}/6 ข้อ</h2>{canEdit && !editing && <button className="button secondary" disabled={points.length >= 6 || pending || Boolean(workflowActive)} onClick={() => { setPoint({ point_key: "", revision: 0, title: {}, detail: {}, icon_code: "check", linked_feature_code: null, linked_fact_keys: [], sort: points.length + 1, state: "DRAFT", ai_exposure: "open" }); setError(""); }}>เพิ่มจุดขาย</button>}</div><p className="field-help">ต้องมี 3–6 ข้อ ชื่อจุดขายไม่เกิน 60 ตัวอักษร เชื่อมข้อเท็จจริงแทนการพิมพ์ตัวเลขในข้อความ</p>
    {point && <form ref={pointForm} inert={Boolean(workflowActive)} onSubmit={event => { event.preventDefault(); void mutatePoint(point.point_key ? `${base}/selling-points/${point.point_key}` : `${base}/selling-points`, point.point_key ? "PUT" : "POST", { expected_revision: point.revision, changes: pointChanges() }); }}><fieldset disabled={pending || !canEdit || pointFrozen}>
      <BilingualInput id="point-title" field={field("selling_point.title")} value={point.title} onChange={title => setPoint({ ...point, title })} maxLength={60} rows={2} />
      <BilingualInput id="point-detail" field={field("selling_point.detail")} value={point.detail} onChange={detail => setPoint({ ...point, detail })} maxLength={4000} />
      <div className="content-two-columns"><label className="content-input">สัญลักษณ์<select value={point.icon_code} onChange={event => setPoint({ ...point, icon_code: event.target.value })}>{["check", "home", "leaf", "shield", "location", "sun"].map(icon => <option key={icon} value={icon}>{{ check: "เครื่องหมายถูก", home: "บ้าน", leaf: "ใบไม้", shield: "ความปลอดภัย", location: "ทำเล", sun: "พลังงาน" }[icon]}</option>)}</select></label>
        <div className="content-input"><ContentLabel htmlFor="point-feature" field={field("selling_point.linked_feature_code")}>คุณสมบัติที่เกี่ยวข้อง</ContentLabel><select id="point-feature" value={point.linked_feature_code ?? ""} onChange={event => setPoint({ ...point, linked_feature_code: event.target.value || null })}><option value="">ไม่ระบุ</option>{Object.entries(features).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></div></div>
      <fieldset className="content-checks"><legend>ข้อเท็จจริงที่เกี่ยวข้อง</legend>{fields.filter(item => item.entity === "project" && item.section === "facts" && item.status === "active").map(item => <label key={item.field_key}><input type="checkbox" checked={point.linked_fact_keys.includes(item.field_key)} onChange={event => setPoint({ ...point, linked_fact_keys: event.target.checked ? [...point.linked_fact_keys, item.field_key] : point.linked_fact_keys.filter(key => key !== item.field_key) })} />{item.label.th}</label>)}</fieldset>
      <div className="content-two-columns"><label className="content-input">ลำดับ<input type="number" min="0" max="1000" value={point.sort} onChange={event => setPoint({ ...point, sort: Number(event.target.value) })} /></label><ExposureInput value={point.ai_exposure} onChange={ai_exposure => setPoint({ ...point, ai_exposure })} /></div>
    </fieldset><div className="content-actions"><button type="button" className="button secondary" disabled={pending || Boolean(workflowActive)} onClick={() => setPoint(null)}>ยกเลิก</button><button className="button primary" disabled={pending || Boolean(workflowActive) || !canEdit || pointFrozen || !point.title.th?.trim()}>บันทึกจุดขาย</button></div></form>}
    <div className="content-card-list">{points.map(item => <article className="content-card" key={item.point_key} data-workspace-item={item.point_key} tabIndex={-1}><h3>{item.title.th}</h3><p className="content-preserve">{item.detail.th}</p><p lang="en">{item.title.en}</p>{canEdit && <button className="button secondary" disabled={editing || pending || Boolean(workflowActive) || item.state.toUpperCase() === "IN_REVIEW"} onClick={() => { if (item.state.toUpperCase() === "IN_REVIEW") return; setPoint({ ...item, title: { ...item.title }, detail: { ...item.detail } }); setError(""); }}>แก้ไขจุดขาย {item.title.th}</button>}
      {(["title", "detail"] as const).map(key => <WritingFields key={key} field={field(`selling_point.${key}`)} fields={fields} translations={writing.items}
        ownerType="selling_point" ownerKey={item.point_key} value={point?.point_key === item.point_key ? point[key] : item[key]} savedValue={item[key]}
        stamp={{ revision: point?.point_key === item.point_key ? point.revision : item.revision }} dirty={Boolean(anySectionDirty || point && JSON.stringify(point) !== JSON.stringify(item))}
        canEdit={canEdit} disabled={pending || item.state.toUpperCase() === "IN_REVIEW" || workflowOwners.some(owner => owner !== "writing:" + item.point_key + key)} maxLength={key === "title" ? 60 : 4000}
        onSaveDraft={point?.point_key === item.point_key ? () => pointForm.current?.requestSubmit() : undefined}
        onActivityChange={active => workflowEditing("writing:" + item.point_key + key, active)} onAccept={value => acceptPoint(item, key, value)} />)}
      <ContentWorkflow key={`${item.point_key}:${workflowRevision}`} target={projectRowId ? { kind: "selling_point", identity: { project_id: projectRowId, point_key: item.point_key } } : null} label={item.title.th || item.point_key}
        revision={point?.point_key === item.point_key ? point.revision : item.revision} disabled={pending || Boolean(anySectionDirty || point && point.point_key !== item.point_key) || workflowOwners.some(owner => owner !== item.point_key)}
        draft={point?.point_key === item.point_key ? { dirty: true, valid: canEdit && Boolean(point.title.th?.trim()), sourceStamp: { revision: point.revision }, getChanges: () => pointForm.current?.reportValidity() ? pointChanges() : null } : undefined}
        onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing(item.point_key, value)} />
      <details><summary>ประวัติจุดขาย</summary>{item.history?.map(version => <div className="content-card" key={version.revision}><strong>ฉบับ {version.revision} · {contentDate(version.created_at)}</strong><p>{version.title.th}</p><p>{version.detail.th}</p><p lang="en">{version.title.en}</p><p lang="en">{version.detail.en}</p></div>)}</details></article>)}</div>
    </>}
  </section>;
}
