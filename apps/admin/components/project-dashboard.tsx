"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { LocalRole } from "@/lib/local-session";
import { request } from "./hub-request";
import { CompletenessBar } from "./completeness-bar";
import { DashboardTiles } from "./dashboard-tiles";
import { ProjectSourceReview, SourceStatusFilter, type SourceReview } from "./project-source-review";
import { ProjectGroups, groupLabel, groupStatus, type GroupStatus } from "./project-groups";
import { WorkspaceBack, WorkspacePagination, pageNumber, pageSizeNumber, projectHref, useListQuery } from "./workspace-navigation";
import "./brand-admin.css";
import "./project-groups.css";
import "./project-dashboard.css";

type Check = { field: string; message: string; passed: boolean; group?: "core" | "media" | "models" | "brand" | "extra" };
type Gap = { field: string; message: string };
export type ProgressRow = {
  public_project_id: string | null; rem_project_id: string; name: string; brand_name: string | null;
  rem_brand_id?: string | null; rem_project_group_id?: string | null; marketing_project_group_id?: string | null; group_status?: GroupStatus;
  new_from_rem: boolean; filling: boolean; awaiting_publisher: boolean; published: boolean; needs_attention: boolean;
  has_unpublished_changes: boolean; withdrawn: boolean; attention: Gap[];
  gaps: Record<"core" | "media" | "models" | "brand", Gap[]>; confirmed_models: number; total_models: number;
  amenities: { collected: number; total: number } | null; waiting_on: string[]; updated_at: string | null;
  first_seen_at: string | null; age_days: number | null; age_basis: "first_import" | "first_seen" | "mirror_import" | "unknown";
  source_review?: SourceReview;
  checklist?: { required: Check[]; recommended: Check[]; passed: number; total: number; percent: number; ready: boolean };
  knowledge?: { reviewed: number; staged: number }; thumbnail_asset_id?: string | null;
};
export type Progress = { rows: ProgressRow[]; counts: Record<string, number> };
const tiles = [{ value: "all", key: "all", label: "ทั้งหมด" }, { value: "new_from_rem", key: "new_from_rem", label: "ใหม่จาก REM" },
  { value: "filling", key: "filling", label: "กำลังกรอก" }, { value: "awaiting_publisher", key: "awaiting_publisher", label: "รอผู้เผยแพร่" },
  { value: "published", key: "published", label: "เผยแพร่แล้ว" }, { value: "needs_attention", key: "needs_attention", label: "ต้องดูแล" }];
const date = (value: string | null) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
const groupLabels = { core: "ข้อมูลหลัก", media: "รูปภาพ", models: "แบบบ้าน", brand: "แบรนด์", extra: "ข้อมูลเสริม" };
function Checks({ row, returnTo, onStart }: { row: ProgressRow; returnTo: string; onStart: (id: string) => void }) {
  return <div className="project-check-groups">{(["required", "recommended"] as const).map(level => <section key={level} aria-label={level === "required" ? "ต้องมีก่อนเผยแพร่" : "ควรเติมภายหลัง"}>
    <h3>{level === "required" ? "ต้องมีก่อนเผยแพร่" : "ควรเติมภายหลัง"}</h3>
    {Object.entries(groupLabels).map(([group, label]) => <div key={group}><h4>{label}</h4><ul>{(row.checklist?.[level] ?? []).filter(item => (item.group ?? "core") === group).map((item, index) => <li key={`${item.field}-${index}`}>
      <span aria-label={item.passed ? "ครบแล้ว" : "ยังขาด"}>{item.passed ? "✓" : "○"}</span><span>{item.message}</span>
      {item.field === "knowledge" || item.field === "nearby" ? <a href={`/knowledge?project=${encodeURIComponent(row.rem_project_id)}${item.field === "nearby" ? "&kind=nearby" : ""}`}>ไปแก้<span className="sr-only"> {item.message}</span></a> : row.public_project_id ? <a href={projectHref(row.public_project_id, returnTo, item.field)}>ไปแก้<span className="sr-only"> {item.message}</span></a> : <button className="button text-button" onClick={() => onStart(row.rem_project_id)}>ไปแก้<span className="sr-only"> {item.message}</span></button>}
    </li>)}</ul>{!(row.checklist?.[level] ?? []).some(item => (item.group ?? "core") === group) && <p className="muted small-text">ไม่มีรายการ</p>}</div>)}
  </section>)}</div>;
}
function status(row: ProgressRow) {
  return row.new_from_rem ? "ใหม่จาก REM" : row.needs_attention ? "ต้องดูแล" : row.published && row.has_unpublished_changes ? "มีการแก้ไขที่ยังไม่เผยแพร่" : row.published ? "เผยแพร่แล้ว" : row.withdrawn ? "ถอนการเผยแพร่แล้ว" : row.filling ? "กำลังกรอก" : "รอผู้เผยแพร่";
}

export function ProjectDashboard({ role, onStart }: { role: LocalRole; onStart: (sourceId: string) => void }) {
  const { query, update, href } = useListQuery();
  const [data, setData] = useState<Progress | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const table = useRef<HTMLDivElement>(null);
  const filter = query.get("pstatus") || "all", search = query.get("pq") || "", sourceStatus = query.get("prem_status") || "all";
  const includeOther = query.get("pother") === "1", brandId = query.get("rem_brand"), selectedGroup = query.get("group");
  const selectedGroupState = query.get("group_state"), groupsView = query.get("view") === "groups";
  const page = pageNumber(query.get("pp")), size = pageSizeNumber(query.get("ps"));
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await request<Progress>("v1/admin/projects/progress")); }
    catch (error) { setError(error instanceof Error ? error.message : "โหลดความคืบหน้าไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { table.current?.scrollTo({ top: 0, behavior: "instant" }); }, [page, size, filter, search, sourceStatus, includeOther, brandId]);
  const all = data?.rows ?? [];
  const members = all.filter(row => (brandId === null || row.rem_brand_id === brandId) &&
    (!selectedGroupState || groupStatus(row) === selectedGroupState && (selectedGroupState !== "rem_reference" || row.rem_project_group_id === selectedGroup)));
  const scoped = members.filter(row => includeOther || row.source_review?.default_scope !== false || (filter === "needs_attention" && row.needs_attention));
  const counts = Object.fromEntries(tiles.map(tile => [tile.key, members.filter(row =>
    (includeOther && tile.key !== "new_from_rem" || row.source_review?.default_scope !== false || tile.key === "needs_attention") &&
    (tile.key === "all" || row[tile.key as keyof ProgressRow] === true)).length]));
  const text = search.trim().toLocaleLowerCase("th");
  const rows = scoped.filter(row => (sourceStatus === "all" || (row.source_review?.status_raw ?? "null") === sourceStatus) &&
    (filter === "all" || row[filter as keyof ProgressRow] === true) && (filter !== "new_from_rem" || row.source_review?.default_scope !== false) &&
    `${row.name} ${row.rem_project_id} ${row.brand_name ?? ""} ${row.rem_project_group_id ?? ""}`.toLocaleLowerCase("th").includes(text));
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages), start = (current - 1) * size;
  const brandOptions = [...new Map(all.filter(row => row.rem_brand_id).map(row => [row.rem_brand_id!, row.brand_name || row.rem_brand_id!])).entries()];
  const canEdit = role === "editor" || role === "admin";
  function filterBy(values: Record<string, string | number | null>) { update({ ...values, pp: null, gp: null }); }
  function pagination(position: string) { return <WorkspacePagination id={`projects-${position}`} page={current} pages={pages} size={size} onChange={(next, count) => {
    update({ pp: next, ps: count }); if (position === "bottom") { table.current?.focus({ preventScroll: true }); table.current?.scrollIntoView({ block: "start" }); }
  }} />; }
  return <section className="brand-dashboard project-dashboard" aria-labelledby="project-progress-title">
    <nav className="project-workspace-nav" aria-label="มุมมองโครงการ"><a className="button secondary" href="/" aria-current={!groupsView ? "page" : undefined}>ทุกโครงการ</a><a className="button secondary" href="/?view=groups" aria-current={groupsView ? "page" : undefined}>ตามกลุ่มโครงการ</a><a className="button secondary" href="/?view=brands">เริ่มจากแบรนด์</a></nav>
    {groupsView && <WorkspaceBack fallback="/?view=groups" label="กลุ่มโครงการทั้งหมด" />}
    {selectedGroupState && <div className="project-group-context"><h2 className="source-code">{groupLabel(selectedGroupState as GroupStatus, selectedGroup)}</h2><p>{selectedGroupState === "rem_reference" ? "สมาชิกตามสำเนา REM · ยังไม่รับรองกลุ่มการตลาด" : selectedGroupState === "conflict" ? "ตัวตนหรือกลุ่มต้นทางขัดแย้ง ตรวจทีละโครงการก่อนยืนยันสมาชิก" : "ยังไม่มีรหัสกลุ่มจาก REM โครงการยังเปิดตรวจและจัดเตรียมข้อมูลได้"}</p>{brandId && <p>แบรนด์: {brandOptions.find(([id]) => id === brandId)?.[1] || brandId} · แสดงเฉพาะสมาชิกของแบรนด์นี้</p>}</div>}
    <h2 id="project-progress-title">ความคืบหน้าโครงการ</h2>
    <DashboardTiles tiles={tiles} counts={counts} selected={filter} onSelect={value => filterBy({ pstatus: value })} loading={loading || Boolean(error)} label="ภาพรวมโครงการ" />
    <label className="brand-confirm-check"><input type="checkbox" checked={includeOther} onChange={event => filterBy({ pother: event.target.checked ? "1" : null })} />แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ</label>
    <p className="field-help">จำนวนอาจซ้อนกันได้ เช่น กำลังกรอกและรออนุมัติภาพ · รอผู้เผยแพร่ไม่ได้หมายความว่าพร้อมเผยแพร่ทุกโครงการ</p>
    <div className="brand-dashboard-toolbar project-progress-toolbar">
      <div className="form-field"><label htmlFor="project-progress-search">ค้นหาโครงการ แบรนด์ หรือรหัส REM</label><input id="project-progress-search" type="search" value={search} onChange={event => filterBy({ pq: event.target.value })} /></div>
      <SourceStatusFilter id="progress-rem-status" rows={members} value={sourceStatus} onChange={value => filterBy({ prem_status: value, ...(!["all", "0", "1", "2"].includes(value) ? { pother: "1" } : {}) })} />
      <div className="form-field"><label htmlFor="project-brand-filter">กรองโครงการตามแบรนด์</label><select id="project-brand-filter" value={brandId ?? ""} onChange={event => filterBy({ rem_brand: event.target.value || null })}><option value="">ทุกแบรนด์</option>{brandOptions.map(([id, name]) => <option key={id} value={id}>{name} · {id}</option>)}</select></div>
    </div>
    <div className="brand-dashboard-actions"><button className="button secondary" disabled={loading} onClick={() => void load()}>โหลดความคืบหน้าใหม่</button></div>
    {loading ? <p role="status">กำลังตรวจความคืบหน้าโครงการ…</p> : error ? <p role="alert" className="notice error">{error}</p> : <>
      {groupsView && !selectedGroupState ? <ProjectGroups key={`${brandId}-${filter}-${sourceStatus}-${search}-${includeOther}`} rows={rows} allRows={all} brandId={brandId} returnTo={href} /> : <>
        <p role="status" className="small-text muted">แสดง {rows.length ? start + 1 : 0}–{Math.min(start + size, rows.length)} จาก {rows.length} โครงการ · เรียงตามความพร้อมเผยแพร่ แล้วตามความครบถ้วน</p>
        {pagination("top")}
        <p className="field-help project-progress-scroll-help">หัวตารางและชื่อโครงการตรึงไว้ · กดลูกศรเพื่อดูรายการตรวจ</p>
        <div className="brand-table-scroll brand-dashboard-table-scroll project-progress-scroll" ref={table} role="region" tabIndex={0} aria-label="ตารางความคืบหน้าโครงการ"><table className="brand-completeness-table project-progress-table"><caption className="sr-only">ความพร้อมเผยแพร่และความครบถ้วนของแต่ละโครงการ</caption><colgroup>{Array.from({ length: 6 }, (_, index) => <col key={index} />)}</colgroup><thead><tr>{["โครงการ", "ความพร้อมเผยแพร่", "ความครบถ้วน", "รอใคร", "ปรับปรุงล่าสุด", "ความรู้"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.slice(start, start + size).map(row => {
          const open = expanded.has(row.rem_project_id), id = `project-checks-${encodeURIComponent(row.rem_project_id)}`;
          const checklist = row.checklist, ready = checklist?.ready ?? (!row.filling && !row.new_from_rem);
          const missing = checklist?.required.filter(item => !item.passed).length ?? Object.values(row.gaps).flat().length;
          return <Fragment key={row.rem_project_id}><tr className="brand-table-row project-summary-row">
          <td data-label="โครงการ"><div className="project-row-identity">
            <button className="project-expand" aria-label={`รายการตรวจ ${row.name}`} aria-expanded={open} aria-controls={id} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(row.rem_project_id)) next.delete(row.rem_project_id); else next.add(row.rem_project_id); return next; })}>{open ? "▾" : "▸"}</button>
            {row.thumbnail_asset_id ? <img className="project-row-thumbnail" src={`/api/hub/v1/admin/assets/${encodeURIComponent(row.thumbnail_asset_id)}/file`} alt={row.name} width={48} height={48} loading="lazy" /> : <span className="project-row-thumbnail" aria-hidden="true">{Array.from(row.name).slice(0, 2).join("")}</span>}
            <div>{row.public_project_id ? <a href={projectHref(row.public_project_id, href)}>{row.name}</a> : <strong>{row.name}</strong>}<p className="source-code">{row.rem_project_id} · {row.brand_name || "ยังไม่ระบุแบรนด์"}</p><p className="small-text">{row.source_review?.status_label || "ไม่ทราบสถานะ"} ({row.source_review?.status_raw ?? "null"})</p>
            {row.public_project_id ? <a className="project-row-action" href={projectHref(row.public_project_id, href)}>{canEdit ? "เปิดแก้ไข" : role === "publisher" ? "เปิดตรวจโครงการ" : "ดูโครงการ"}</a> : <button className="button text-button project-row-action" onClick={() => onStart(row.rem_project_id)}>{canEdit ? "เริ่มกรอก" : "ดูต้นทาง"}</button>}</div></div>
          </td>
          <td data-label="ความพร้อมเผยแพร่"><strong className={`project-ready-badge ${ready ? "ready" : ""}`}>{ready ? "เผยแพร่ได้ ✓" : `ขาดข้อบังคับ ${missing}`}</strong><p className="small-text">{status(row)}</p></td>
          <td data-label="ความครบถ้วน"><CompletenessBar passed={checklist?.passed ?? 0} total={checklist?.total ?? 0} /></td>
          <td data-label="รอใคร">{row.waiting_on.map(role => role === "editor" ? "ผู้แก้ไข" : "ผู้เผยแพร่").join(" / ") || "—"}</td>
          <td data-label="ปรับปรุงล่าสุด">{date(row.updated_at)}</td>
          <td data-label="ความรู้"><a href={`/knowledge?project=${encodeURIComponent(row.rem_project_id)}`}>ตรวจแล้ว {row.knowledge?.reviewed ?? 0}/{row.knowledge?.staged ?? 0}</a></td>
          </tr>{open && <tr className="project-detail-row" id={id}><td colSpan={6}><Checks row={row} returnTo={href} onStart={onStart} /><p>แบบบ้านยืนยัน {row.confirmed_models}/{row.total_models} · สิ่งอำนวยความสะดวก {row.amenities ? `${row.amenities.collected}/${row.amenities.total}` : "ยังไม่เริ่ม"}</p>
            <ProjectSourceReview value={row.source_review} />{row.attention.length > 0 && <ul>{row.attention.map((item, index) => <li key={index}><a href={projectHref(row.public_project_id!, href, item.field)}>{item.message}</a></li>)}</ul>}
            <p className="small-text muted">{row.age_days == null ? "ไม่ทราบวันนำเข้า" : `${row.age_basis === "first_import" ? "นำเข้าครั้งแรก" : row.age_basis === "mirror_import" ? "ใช้เวลานำเข้าสำเนาครั้งแรก" : "พบใน REM ครั้งแรก"} · ${date(row.first_seen_at)} · ${row.age_days} วัน`}</p>
            {selectedGroupState === "conflict" && <p>กลุ่ม REM: <code>{JSON.stringify(row.rem_project_group_id ?? null)}</code> · กลุ่มการตลาด: <code>{JSON.stringify(row.marketing_project_group_id ?? null)}</code></p>}
          </td></tr>}</Fragment>;
        })}</tbody></table></div>{pagination("bottom")}
        {!rows.length && <p className="empty-state compact">ไม่มีโครงการตรงกับตัวกรอง</p>}
      </>}
    </>}
  </section>;
}
