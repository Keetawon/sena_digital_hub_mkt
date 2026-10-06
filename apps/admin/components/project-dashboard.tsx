"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRole } from "@/lib/local-session";
import { request } from "./hub-request";
import { DashboardTiles } from "./dashboard-tiles";
import { ProjectSourceReview, SourceStatusFilter, type SourceReview } from "./project-source-review";
import { ProjectGroups, groupLabel, groupStatus, type GroupStatus } from "./project-groups";
import { WorkspaceBack, WorkspacePagination, pageNumber, pageSizeNumber, projectHref, useListQuery } from "./workspace-navigation";
import "./brand-admin.css";
import "./project-groups.css";
import "./project-dashboard.css";

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
};
export type Progress = { rows: ProgressRow[]; counts: Record<string, number> };
const tiles = [{ value: "all", key: "all", label: "ทั้งหมด" }, { value: "new_from_rem", key: "new_from_rem", label: "ใหม่จาก REM" },
  { value: "filling", key: "filling", label: "กำลังกรอก" }, { value: "awaiting_publisher", key: "awaiting_publisher", label: "รอผู้เผยแพร่" },
  { value: "published", key: "published", label: "เผยแพร่แล้ว" }, { value: "needs_attention", key: "needs_attention", label: "ต้องดูแล" }];
const date = (value: string | null) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
function Gaps({ row, group, returnTo }: { row: ProgressRow; group: keyof ProgressRow["gaps"]; returnTo: string }) {
  if (row.new_from_rem) return <span>ยังไม่เริ่ม</span>;
  const items = row.gaps[group];
  if (!items.length) return <span aria-label="ครบแล้ว">✓</span>;
  const summaries = new Map<string, number>();
  for (const item of items) summaries.set(item.message, (summaries.get(item.message) ?? 0) + 1);
  return <><a href={projectHref(row.public_project_id!, returnTo, items[0].field)} aria-label={`ยังขาด ${items.length} รายการ`}>{items.length} รายการ</a>
    <ul className="project-gap-list project-gap-previews">{[...summaries].slice(0, 2).map(([message, count]) => <li key={message}><span className="project-gap-preview">{message}</span>{count > 1 && <span className="project-gap-count">({count})</span>}</li>)}</ul>
    <details className="project-gap-summary"><summary>ดูรายการที่ยังขาด</summary><ul>{items.map((item, index) => <li key={`${item.field}-${index}`}><a href={projectHref(row.public_project_id!, returnTo, item.field)}>{item.message}{group === "models" ? ` · รายการ ${index + 1}` : ""}</a></li>)}</ul></details></>;
}
function status(row: ProgressRow) {
  return row.new_from_rem ? "ใหม่จาก REM" : row.needs_attention ? "ต้องดูแล" : row.published && row.has_unpublished_changes ? "มีการแก้ไขที่ยังไม่เผยแพร่" : row.published ? "เผยแพร่แล้ว" : row.withdrawn ? "ถอนการเผยแพร่แล้ว" : row.filling ? "กำลังกรอก" : "รอผู้เผยแพร่";
}

export function ProjectDashboard({ role, onStart }: { role: LocalRole; onStart: (sourceId: string) => void }) {
  const { query, update, href } = useListQuery();
  const [data, setData] = useState<Progress | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
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
  const ageLabel = all.some(row => row.age_basis === "first_import") ? "นำเข้าครั้งแรก" : "วันนับจากพบใน REM";
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
        <p role="status" className="small-text muted">แสดง {rows.length ? start + 1 : 0}–{Math.min(start + size, rows.length)} จาก {rows.length} โครงการ · เรียงรายการที่ยังขาดมากที่สุดก่อน</p>
        {pagination("top")}
        <p className="field-help project-progress-scroll-help">เลื่อนแนวนอนเพื่อดูคอลัมน์เพิ่มเติม · ตรึง<span className="project-pin-desktop">โครงการและแบรนด์</span><span className="project-pin-tablet">ชื่อโครงการ</span>ไว้ด้านซ้าย และหัวตารางไว้ด้านบน</p>
        <div className="brand-table-scroll brand-dashboard-table-scroll project-progress-scroll" ref={table} role="region" tabIndex={0} aria-label="ตารางความคืบหน้าโครงการ"><table className="brand-completeness-table project-progress-table"><caption className="sr-only">ความคืบหน้าและรายการที่ยังขาดของแต่ละโครงการ</caption><colgroup>{Array.from({ length: 11 }, (_, index) => <col key={index} />)}</colgroup><thead><tr>{["โครงการ", "แบรนด์", "ข้อมูลหลัก", "รูปภาพ", "แบบที่อยู่อาศัย", "การผูกแบรนด์", "สถานะ", "รอใคร", "ปรับปรุงล่าสุด", ageLabel, "สิ่งอำนวยความสะดวก (เสริม)"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.slice(start, start + size).map(row => <tr className="brand-table-row" key={row.rem_project_id}>
          <td data-label="โครงการ">{row.public_project_id ? <a href={projectHref(row.public_project_id, href)}>{row.name}</a> : <strong>{row.name}</strong>}<p className="source-code">{row.rem_project_id}</p>
            {row.public_project_id ? <a className="button secondary project-row-action" href={projectHref(row.public_project_id, href)}>{canEdit ? "เปิดแก้ไข" : role === "publisher" ? "เปิดตรวจโครงการ" : "ดูโครงการ"}</a> : <button className="button secondary project-row-action" onClick={() => onStart(row.rem_project_id)}>{canEdit ? "เริ่มกรอก" : "ดูต้นทาง"}</button>}
            {selectedGroupState === "conflict" && <p className="small-text">กลุ่ม REM: <code>{JSON.stringify(row.rem_project_group_id ?? null)}</code><br />กลุ่มการตลาด: <code>{JSON.stringify(row.marketing_project_group_id ?? null)}</code></p>}
          </td>
          <td data-label="แบรนด์">{row.brand_name || "ยังไม่ระบุแบรนด์"}</td><td data-label="ข้อมูลหลัก"><Gaps row={row} group="core" returnTo={href} /></td><td data-label="รูปภาพ"><Gaps row={row} group="media" returnTo={href} /></td>
          <td data-label="แบบที่อยู่อาศัย"><p>ยืนยัน {row.confirmed_models}/{row.total_models}</p><Gaps row={row} group="models" returnTo={href} /></td><td data-label="การผูกแบรนด์"><Gaps row={row} group="brand" returnTo={href} /></td>
          <td data-label="สถานะ">{status(row)}<ProjectSourceReview value={row.source_review} />{row.attention.length > 0 && <ul className="project-gap-list">{row.attention.map((item, index) => <li key={index}><a href={projectHref(row.public_project_id!, href, item.field)}>{item.message}</a></li>)}</ul>}</td>
          <td data-label="รอใคร">{row.waiting_on.map(role => role === "editor" ? "ผู้แก้ไข" : "ผู้เผยแพร่").join(" / ") || "—"}</td><td data-label="ปรับปรุงล่าสุด">{date(row.updated_at)}</td>
          <td data-label={ageLabel}>{row.age_days == null ? "ไม่ทราบวันนำเข้า" : <>{row.age_days} วัน<p className="small-text muted">{row.age_basis === "first_import" ? "นำเข้าครั้งแรก" : row.age_basis === "mirror_import" ? "ใช้เวลานำเข้าสำเนาครั้งแรก" : "พบใน REM ครั้งแรก"} · {date(row.first_seen_at)}</p></>}</td>
          <td data-label="สิ่งอำนวยความสะดวก (เสริม)">{row.amenities ? `${row.amenities.collected}/${row.amenities.total} รายการ` : "ยังไม่เริ่ม"}<p className="small-text muted">ไม่กีดกันการเผยแพร่</p></td>
        </tr>)}</tbody></table></div>{pagination("bottom")}
        {!rows.length && <p className="empty-state compact">ไม่มีโครงการตรงกับตัวกรอง</p>}
      </>}
    </>}
  </section>;
}
