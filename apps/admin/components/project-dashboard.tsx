"use client";

import { useCallback, useEffect, useState } from "react";
import type { LocalRole } from "@/lib/local-session";
import { request } from "./hub-request";
import { DashboardTiles } from "./dashboard-tiles";
import "./brand-admin.css";

type Gap = { field: string; message: string };
type Row = {
  public_project_id: string | null; rem_project_id: string; name: string; brand_name: string | null;
  new_from_rem: boolean; filling: boolean; awaiting_publisher: boolean; published: boolean; needs_attention: boolean;
  has_unpublished_changes: boolean; withdrawn: boolean; attention: Gap[];
  gaps: Record<"core" | "media" | "models" | "brand", Gap[]>; confirmed_models: number; total_models: number;
  amenities: { collected: number; total: number } | null; waiting_on: string[]; updated_at: string | null;
  first_seen_at: string | null; age_days: number | null; age_basis: "first_seen" | "mirror_import" | "unknown";
};
type Progress = { rows: Row[]; counts: Record<string, number> };
const tiles = [{ value: "all", key: "all", label: "ทั้งหมด" }, { value: "new_from_rem", key: "new_from_rem", label: "ใหม่จาก REM" },
  { value: "filling", key: "filling", label: "กำลังกรอก" }, { value: "awaiting_publisher", key: "awaiting_publisher", label: "รอผู้เผยแพร่" },
  { value: "published", key: "published", label: "เผยแพร่แล้ว" }, { value: "needs_attention", key: "needs_attention", label: "ต้องดูแล" }];
const date = (value: string | null) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
const url = (row: Row, field?: string) => `/?project=${encodeURIComponent(row.public_project_id!)}${field ? `&field=${encodeURIComponent(field)}` : ""}`;
function Gaps({ row, group }: { row: Row; group: keyof Row["gaps"] }) {
  if (row.new_from_rem) return <span>ยังไม่เริ่ม</span>;
  const items = row.gaps[group];
  return items.length ? <><a href={url(row, items[0].field)} aria-label={`ยังขาด ${items.length} รายการ: ${items.map(item => item.message).join(" · ")}`}>{items.length} รายการ</a><ul className="project-gap-list">{items.map((item, index) => <li key={`${item.field}-${index}`}><a href={url(row, item.field)}>{item.message}</a></li>)}</ul></> : <span aria-label="ครบแล้ว">✓</span>;
}
function status(row: Row) {
  return row.new_from_rem ? "ใหม่จาก REM" : row.needs_attention ? "ต้องดูแล" : row.published && row.has_unpublished_changes ? "มีการแก้ไขที่ยังไม่เผยแพร่" : row.published ? "เผยแพร่แล้ว" : row.withdrawn ? "ถอนการเผยแพร่แล้ว" : row.filling ? "กำลังกรอก" : "รอผู้เผยแพร่";
}
export function ProjectDashboard({ role, onStart }: { role: LocalRole; onStart: (sourceId: string) => void }) {
  const [data, setData] = useState<Progress | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [filter, setFilter] = useState("all"), [search, setSearch] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await request<Progress>("v1/admin/projects/progress")); }
    catch (error) { setError(error instanceof Error ? error.message : "โหลดความคืบหน้าไม่สำเร็จ"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const query = search.trim().toLocaleLowerCase("th");
  const rows = (data?.rows ?? []).filter(row => (filter === "all" || row[filter as keyof Row] === true) && `${row.name} ${row.rem_project_id} ${row.brand_name ?? ""}`.toLocaleLowerCase("th").includes(query));
  return <section className="brand-dashboard project-dashboard" aria-labelledby="project-progress-title"><h2 id="project-progress-title">ความคืบหน้าโครงการ</h2>
    <DashboardTiles tiles={tiles} counts={data?.counts} selected={filter} onSelect={setFilter} loading={loading || Boolean(error)} label="ภาพรวมโครงการ" />
    <p className="field-help">จำนวนอาจซ้อนกันได้ เช่น โครงการที่เผยแพร่แล้วยังมีงานรอผู้เผยแพร่หรือสิทธิ์ภาพที่ต้องดูแล</p>
    <div className="brand-dashboard-toolbar"><div className="form-field"><label htmlFor="project-progress-search">ค้นหาโครงการ แบรนด์ หรือรหัส REM</label><input id="project-progress-search" type="search" value={search} onChange={event => setSearch(event.target.value)} /></div><button className="button secondary" disabled={loading} onClick={() => void load()}>โหลดความคืบหน้าใหม่</button></div>
    {loading ? <p role="status">กำลังตรวจความคืบหน้าโครงการ…</p> : error ? <p role="alert" className="notice error">{error}</p> : <><p role="status" className="small-text muted">พบ {rows.length} โครงการ · เรียงรายการที่ยังขาดมากที่สุดก่อน</p><div className="brand-table-scroll"><table className="brand-completeness-table project-progress-table"><caption className="sr-only">ความคืบหน้าและรายการที่ยังขาดของแต่ละโครงการ</caption><thead><tr><th>โครงการ</th><th>แบรนด์</th><th>ข้อมูลหลัก</th><th>รูปภาพ</th><th>แบบบ้าน</th><th>การผูกแบรนด์</th><th>สถานะ</th><th>รอใคร</th><th>ปรับปรุงล่าสุด</th><th>วันนับจากพบใน REM</th><th>สิ่งอำนวยความสะดวก (เสริม)</th></tr></thead><tbody>{rows.map(row => <tr className="brand-table-row" key={row.rem_project_id}>
      <td data-label="โครงการ">{row.public_project_id ? <a href={url(row)}>{row.name}</a> : <><strong>{row.name}</strong><button className="button secondary" onClick={() => onStart(row.rem_project_id)}>{role === "editor" || role === "admin" ? "เริ่มกรอก" : "ดูต้นทาง"}</button></>}<p className="source-code">{row.rem_project_id}</p></td>
      <td data-label="แบรนด์">{row.brand_name || "ยังไม่ระบุแบรนด์"}</td><td data-label="ข้อมูลหลัก"><Gaps row={row} group="core" /></td><td data-label="รูปภาพ"><Gaps row={row} group="media" /></td>
      <td data-label="แบบบ้าน"><p>ยืนยัน {row.confirmed_models}/{row.total_models}</p><Gaps row={row} group="models" /></td><td data-label="การผูกแบรนด์"><Gaps row={row} group="brand" /></td>
      <td data-label="สถานะ">{status(row)}{row.attention.length > 0 && <ul className="project-gap-list">{row.attention.map((item, index) => <li key={index}><a href={url(row, item.field)}>{item.message}</a></li>)}</ul>}</td>
      <td data-label="รอใคร">{row.waiting_on.map(role => role === "editor" ? "ผู้แก้ไข" : "ผู้เผยแพร่").join(" / ") || "—"}</td><td data-label="ปรับปรุงล่าสุด">{date(row.updated_at)}</td>
      <td data-label="วันนับจากพบใน REM">{row.age_days == null ? "ไม่ทราบวันนำเข้า" : <>{row.age_days} วัน<p className="small-text muted">{row.age_basis === "mirror_import" ? "ใช้เวลานำเข้าสำเนาครั้งแรก" : "พบใน REM ครั้งแรก"} · {date(row.first_seen_at)}</p></>}</td>
      <td data-label="สิ่งอำนวยความสะดวก (เสริม)">{row.amenities ? `${row.amenities.collected}/${row.amenities.total} รายการ` : "ยังไม่เริ่ม"}<p className="small-text muted">ไม่กีดกันการเผยแพร่</p></td>
    </tr>)}</tbody></table></div>{!rows.length && <p className="empty-state compact">ไม่มีโครงการตรงกับตัวกรอง</p>}</>}
  </section>;
}
