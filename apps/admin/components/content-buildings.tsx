"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { uploadFileError, type UploadContext } from "../lib/upload-context";
import { AssetFileLink } from "./private-assets";
import { Preview, RightsBadge, uploadAsset } from "./project-assets";
import { newContext, newMetadata, type MediaAsset, type MediaLink } from "./media-common";
import { request } from "./hub-request";
import { ContentWorkflow } from "./content-workflow";
import { BilingualInput, ContentLabel, ExposureInput, contentDate, errorMessage, type ContentField, type Exposure, type Locales } from "./content-common";
import "./km-hubs.css";

export type Building = { building_key: string; revision: number; name: Locales; floors_above: number | null; has_rooftop: boolean | null; skip_floors: number[]; unit_count: number | null; ai_exposure: Exposure; source?: string; source_as_of?: string | null };
type BuildingMediaPayload = { assets: MediaAsset[]; links: MediaLink[] };

function floorBadgeLabel(link: MediaLink) {
  if (link.floor_from == null && link.floor_to == null) return "ผังรวมอาคาร / Master Plan";
  if (link.floor_from != null && (link.floor_to == null || link.floor_to === link.floor_from)) return `ชั้น ${link.floor_from}`;
  if (link.floor_from == null && link.floor_to != null) return `ชั้น ${link.floor_to}`;
  return `ชั้น ${link.floor_from}–${link.floor_to} (Typical Floor)`;
}

function BuildingFloorPlanSlot({
  projectId,
  building,
  media,
  canEdit,
  disabled,
  onUploaded,
  onBusyChange,
}: {
  projectId: string;
  building: Building;
  media: BuildingMediaPayload;
  canEdit: boolean;
  disabled: boolean;
  onUploaded: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const links = media.links
    .filter(link => link.target_type === "building_floor" && link.target_key === building.building_key)
    .sort((a, b) => (a.floor_from ?? 0) - (b.floor_from ?? 0) || a.sort - b.sort || a.id.localeCompare(b.id));
  const [openUpload, setOpenUpload] = useState(false);
  const [floorFrom, setFloorFrom] = useState("");
  const [floorTo, setFloorTo] = useState("");
  const [captionTh, setCaptionTh] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [slotError, setSlotError] = useState("");
  const [slotNotice, setSlotNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onBusyChange(openUpload || busy);
    return () => onBusyChange(false);
  }, [openUpload, busy, onBusyChange]);

  const floorOptions = building.floors_above
    ? Array.from({ length: Math.min(building.floors_above, 200) }, (_, idx) => idx + 1).filter(n => !building.skip_floors.includes(n))
    : [];

  async function submitFloorPlans(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || busy || disabled || !files.length) return;
    const fromNum = floorFrom ? Number(floorFrom) : null;
    const toNum = floorTo ? Number(floorTo) : fromNum;
    if (fromNum != null && toNum != null && toNum < fromNum) {
      setSlotError("ชั้นสิ้นสุดต้องไม่น้อยกว่าชั้นเริ่มต้น");
      return;
    }
    const ctx: UploadContext = {
      v: 1,
      kind: "media_target",
      project_ref: projectId,
      target_type: "building_floor",
      target_key: building.building_key,
      category: "floor_plan",
      usage: "gallery",
    };
    const bad = files.find(file => uploadFileError(file, ctx));
    if (bad) {
      setSlotError(`${bad.name}: ${uploadFileError(bad, ctx)}`);
      return;
    }
    setBusy(true);
    setSlotError("");
    setSlotNotice("");
    const mediaBase = `v1/admin/projects/${encodeURIComponent(projectId)}/media`;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const uploaded = await uploadAsset(file, ctx, setWaiting);
        const asset = uploaded.asset as MediaAsset;
        const autoLabel = captionTh.trim() || (fromNum != null ? (toNum && toNum !== fromNum ? `ผังชั้น ${fromNum}–${toNum} ${building.name.th ?? ""}`.trim() : `ผังชั้น ${fromNum} ${building.name.th ?? ""}`.trim()) : `ผังรวม ${building.name.th ?? file.name}`.trim());
        await request(`${mediaBase}/assets/${asset.id}`, "PUT", {
          expected_revision: asset.media_revision ?? 0,
          changes: {
            ...newMetadata(),
            media_category: "floor_plan",
            image_kind: "drawing",
            caption: { th: autoLabel },
            alt_text: { th: autoLabel },
          },
        });
        await request(`${mediaBase}/links/${crypto.randomUUID()}`, "PUT", {
          expected_revision: 0,
          changes: {
            ...newContext(""),
            target_type: "building_floor",
            target_key: building.building_key,
            building_key: building.building_key,
            floor_from: fromNum,
            floor_to: toNum,
            usage: "gallery",
            is_primary: false,
            sort: links.length + i,
            asset_id: asset.id,
          },
        });
      }
      setFiles([]);
      setCaptionTh("");
      setFloorFrom("");
      setFloorTo("");
      if (fileRef.current) fileRef.current.value = "";
      setOpenUpload(false);
      await onUploaded();
      setSlotNotice(`อัปโหลดและผูกผังชั้นสำเร็จ ${files.length} ไฟล์`);
    } catch (err) {
      setSlotError(errorMessage(err));
    } finally {
      setBusy(false);
      setWaiting(false);
    }
  }

  async function removeFloorLink(link: MediaLink) {
    if (!canEdit || busy || disabled) return;
    setBusy(true);
    setSlotError("");
    setSlotNotice("");
    try {
      await request(`v1/admin/projects/${encodeURIComponent(projectId)}/media/links/${link.id}/remove`, "POST", { expected_revision: link.revision });
      await onUploaded();
      setSlotNotice("นำผังชั้นออกจากอาคารแล้ว (ไฟล์ยังอยู่ในคลังสื่อ)");
    } catch (err) {
      setSlotError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="km-floor-section" aria-label={`ผังชั้นของ ${building.name.th || building.building_key}`}>
      <div className="content-toolbar">
        <strong>ผังชั้นของอาคารนี้ ({links.length} รายการ)</strong>
        {canEdit && !openUpload && (
          <button type="button" className="button secondary" disabled={disabled || busy} onClick={() => { setOpenUpload(true); setSlotError(""); setSlotNotice(""); }}>
            + อัปโหลดรูปผังชั้น
          </button>
        )}
      </div>
      {slotError && <p className="notice error" role="alert">{slotError}</p>}
      {slotNotice && <p className="notice success" role="status">{slotNotice}</p>}
      {links.length === 0 ? (
        <p className="field-help">ยังไม่มีรูปผังชั้นของอาคารนี้ สามารถอัปโหลดแยกตามชั้น (เช่น ชั้น 1, ชั้น 2) หรือช่วงชั้นที่ผังเหมือนกัน (เช่น ชั้น 3–7)</p>
      ) : (
        <div className="km-floor-grid">
          {links.map(link => {
            const asset = media.assets.find(item => item.id === link.asset_id);
            if (!asset) return null;
            return (
              <div className="km-floor-card" key={link.id}>
                <span className="km-floor-badge">{floorBadgeLabel(link)}</span>
                <Preview asset={asset} alt={asset.alt_text?.th || floorBadgeLabel(link)} />
                <strong>{asset.caption?.th || asset.original_filename}</strong>
                <RightsBadge status={asset.rights_status} from={asset.effective_from} to={asset.effective_to} />
                <div className="content-actions">
                  <AssetFileLink asset={asset}>ดูไฟล์เต็ม</AssetFileLink>
                  {canEdit && (
                    <button type="button" className="button text-button" disabled={disabled || busy} onClick={() => void removeFloorLink(link)}>
                      นำผังชั้นออก
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canEdit && openUpload && (
        <form className="km-slot-card" onSubmit={submitFloorPlans}>
          <h4>อัปโหลดรูปผังชั้น · {building.name.th || building.building_key}</h4>
          {waiting && <p role="status">รอคิวอัปโหลดสักครู่…</p>}
          <div className="content-two-columns">
            <label className="content-input">
              ตั้งแต่ชั้น (เว้นว่าง = ผังรวม / Master Plan)
              {floorOptions.length > 0 ? (
                <select value={floorFrom} disabled={busy} onChange={e => { setFloorFrom(e.target.value); if (!floorTo || Number(floorTo) < Number(e.target.value)) setFloorTo(e.target.value); }}>
                  <option value="">ผังรวมอาคาร / Master Plan</option>
                  {floorOptions.map(floor => <option key={floor} value={floor}>ชั้น {floor}</option>)}
                </select>
              ) : (
                <input type="number" min="1" max="200" placeholder="เช่น 1" value={floorFrom} disabled={busy} onChange={e => { setFloorFrom(e.target.value); if (!floorTo) setFloorTo(e.target.value); }} />
              )}
            </label>
            <label className="content-input">
              ถึงชั้น (กรณี Typical Floor หลายชั้น)
              {floorOptions.length > 0 ? (
                <select value={floorTo} disabled={busy || !floorFrom} onChange={e => setFloorTo(e.target.value)}>
                  <option value="">{floorFrom ? `เฉพาะชั้น ${floorFrom}` : "ตามช่องเริ่มต้น"}</option>
                  {floorOptions.filter(f => !floorFrom || f >= Number(floorFrom)).map(floor => <option key={floor} value={floor}>ชั้น {floor}</option>)}
                </select>
              ) : (
                <input type="number" min={floorFrom || "1"} max="200" placeholder="เช่น 7" value={floorTo} disabled={busy || !floorFrom} onChange={e => setFloorTo(e.target.value)} />
              )}
            </label>
          </div>
          <label className="content-input">
            ชื่อผังชั้น / คำบรรยาย (เว้นว่างให้ระบบตั้งตามเลขชั้นอัตโนมัติได้)
            <input maxLength={300} placeholder="เช่น Master Plan ชั้น 1 หรือ ผังชั้นพักอาศัย 3–7" value={captionTh} disabled={busy} onChange={e => setCaptionTh(e.target.value)} />
          </label>
          <label className="content-input">
            เลือกรูปผังชั้น (PNG, JPEG, WebP หรือ PDF)
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy} onChange={e => { setFiles(Array.from(e.target.files ?? [])); setSlotError(""); }} />
          </label>
          <div className="content-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => { setOpenUpload(false); setFiles([]); setSlotError(""); }}>
              ยกเลิก
            </button>
            <button type="submit" className="button primary" disabled={busy || !files.length}>
              {busy ? "กำลังอัปโหลดผังชั้น…" : `อัปโหลดและผูกผังชั้น (${files.length || 0} ไฟล์)`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
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
  const [media, setMedia] = useState<BuildingMediaPayload>({ assets: [], links: [] });
  const [floorPlanOwners, setFloorPlanOwners] = useState<string[]>([]);
  const floorPlanActive = floorPlanOwners.length > 0;
  function setFloorBusy(owner: string, active: boolean) {
    setFloorPlanOwners(owners => owners.includes(owner) === active ? owners : active ? [...owners, owner] : owners.filter(v => v !== owner));
  }
  const loadBuildingMedia = useCallback(async (isLive?: () => boolean) => {
    if (!projectId) return;
    try {
      const result = await request<BuildingMediaPayload>(`v1/admin/projects/${encodeURIComponent(projectId)}/media`);
      if (!isLive || isLive()) setMedia({ assets: result.assets ?? [], links: result.links ?? [] });
    } catch {
      /* Mocked unit-only suites may not serve /media; building facts remain editable. */
    }
  }, [projectId]);
  useEffect(() => {
    if (items.length === 0) return;
    let live = true;
    void loadBuildingMedia(() => live);
    return () => { live = false; };
  }, [items.length, loadBuildingMedia]);
  useEffect(() => { onEditingChange(Boolean(editing || pending || workflowActive || floorPlanActive)); return () => onEditingChange(false); }, [editing, pending, workflowActive, floorPlanActive, onEditingChange]);
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
    <div className="content-card-list">{items.map(item => <article className="content-card" key={item.building_key} data-workspace-item={item.building_key} tabIndex={-1}><h3>{item.name.th}</h3>{item.name.en && <p lang="en">{item.name.en}</p>}<dl><div><dt>จำนวนชั้น</dt><dd>{item.floors_above ?? "ยังไม่ทราบ"}</dd></div><div><dt>จำนวนยูนิต</dt><dd>{item.unit_count ?? "ยังไม่ทราบ"}</dd></div><div><dt>ดาดฟ้า</dt><dd>{item.has_rooftop == null ? "ยังไม่ทราบ" : item.has_rooftop ? "มี" : "ไม่มี"}</dd></div><div><dt>ชั้นที่ข้าม</dt><dd>{item.skip_floors.join(", ") || "ไม่ได้ระบุ"}</dd></div></dl>{item.source === "rem" && <p className="field-help">จาก REM ณ {contentDate(item.source_as_of)}</p>}{canEdit && <button className="button secondary" disabled={Boolean(editing || pending || workflowActive || floorPlanActive)} onClick={() => edit(item)}>แก้ไขอาคาร {item.name.th}</button>}
      <BuildingFloorPlanSlot projectId={projectId} building={item} media={media} canEdit={canEdit} disabled={Boolean(editing || pending || workflowActive || floorPlanOwners.some(owner => owner !== item.building_key))} onUploaded={async () => { await loadBuildingMedia(); await onChanged(); }} onBusyChange={active => setFloorBusy(item.building_key, active)} />
      <ContentWorkflow key={`${item.building_key}:${workflowRevision}`} target={projectRowId ? { kind: "building", identity: { project_id: projectRowId, building_key: item.building_key } } : null} label={item.name.th || item.building_key}
      revision={editing?.building_key === item.building_key ? editing.revision : item.revision} disabled={pending || floorPlanActive || Boolean(editing && editing.building_key !== item.building_key) || workflowOwners.some(owner => owner !== item.building_key)}
      draft={editing?.building_key === item.building_key ? { dirty: true, valid: canEdit && Boolean(editing.name.th?.trim()) && draftChanges(editing).skip_floors.every(value => Number.isInteger(value) && value > 0), sourceStamp: { revision: editing.revision }, getChanges: () => form.current?.reportValidity() ? draftChanges(editing) : null } : undefined}
      onChanged={reloadWorkflow} onReload={reloadWorkflow} onEditingChange={value => workflowEditing(item.building_key, value)} /></article>)}</div>
  </section>;
}
