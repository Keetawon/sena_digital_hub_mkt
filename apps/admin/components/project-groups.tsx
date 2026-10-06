"use client";

import { useEffect, useState } from "react";
import { request } from "./hub-request";
import type { Progress, ProgressRow } from "./project-dashboard";
import { pageNumber, pageSizeNumber, useListQuery, WorkspacePagination } from "./workspace-navigation";
import "./project-groups.css";

export type GroupStatus = "rem_reference" | "conflict" | "missing";
export function groupStatus(row: ProgressRow): GroupStatus { return row.group_status ?? (row.rem_project_group_id ? "rem_reference" : "missing"); }
export function groupLabel(status: GroupStatus, id?: string | null) {
  return status === "conflict" ? "กลุ่มที่ต้องตรวจสอบ" : status === "missing" ? "ยังไม่มีกลุ่มยืนยัน" : id || "ยังไม่มีกลุ่มยืนยัน";
}
export function groupHref(brandId: string | null, state: GroupStatus, id: string | null, returnTo: string) {
  const query = new URLSearchParams({ view: "groups", group_state: state, return_to: returnTo });
  const previous = new URLSearchParams(returnTo.split("?")[1]);
  for (const key of ["pstatus", "prem_status", "pq", "pother"]) if (previous.has(key)) query.set(key, previous.get(key)!);
  if (previous.get("bother") === "1") query.set("pother", "1");
  if (id !== null && state === "rem_reference") query.set("group", id);
  if (brandId !== null) query.set("rem_brand", brandId);
  return `/?${query}`;
}

export function ProjectGroups({ rows, allRows = rows, brandId = null, returnTo }: {
  rows: ProgressRow[]; allRows?: ProgressRow[]; brandId?: string | null; returnTo: string;
}) {
  const { query, update } = useListQuery();
  const page = pageNumber(query.get("gp")), size = pageSizeNumber(query.get("gs"));
  const groups = new Map<string, { state: GroupStatus; id: string | null; rows: ProgressRow[] }>();
  for (const row of rows) {
    const state = groupStatus(row), id = state === "rem_reference" ? row.rem_project_group_id ?? null : null;
    const key = JSON.stringify([state, id]);
    if (!groups.has(key)) groups.set(key, { state, id, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  const items = [...groups.values()].sort((a, b) => groupLabel(a.state, a.id).localeCompare(groupLabel(b.state, b.id), "th"));
  const pages = Math.max(1, Math.ceil(items.length / size)), current = Math.min(pageNumber(String(page)), pages);
  return <div className="project-groups">
    <p className="field-help">จัดตามรหัสกลุ่ม REM ในสำเนาต้นทาง · ยังไม่ใช่การรับรองสมาชิกกลุ่มการตลาด</p>
    {!items.length ? <p>ไม่มีโครงการในขอบเขตที่เลือก</p> : <>
      <ul className="project-group-list">{items.slice((current - 1) * size, current * size).map(group => {
        const brands = new Set(allRows.filter(row => group.state === "rem_reference" && groupStatus(row) === group.state && row.rem_project_group_id === group.id).map(row => row.rem_brand_id));
        return <li key={JSON.stringify([group.state, group.id])}>
          <div><strong className="source-code">{groupLabel(group.state, group.id)}</strong><p>{group.rows.length} โครงการ · เผยแพร่แล้ว {group.rows.filter(row => row.published).length} · กำลังกรอก {group.rows.filter(row => row.filling).length} · รอผู้เผยแพร่ {group.rows.filter(row => row.awaiting_publisher).length}</p>
            {group.id && group.id !== group.id.trim() && <p className="field-help">รหัสมีช่องว่าง: <code>{JSON.stringify(group.id)}</code> · เก็บรหัสต้นทางตามเดิม</p>}
            <p className="small-text muted">{group.rows.slice(0, 2).map(row => row.name).join(" · ")}{group.rows.length > 2 ? ` และอีก ${group.rows.length - 2} โครงการ` : ""}</p>
            {brands.size > 1 && <p className="field-help">กลุ่มนี้มีสมาชิกต่างแบรนด์{brandId ? " · แสดงเฉพาะแบรนด์ที่เลือก" : ""}</p>}
            {group.state === "conflict" && <p className="field-help">ต้นทางมีข้อขัดแย้ง แสดงแต่ละโครงการเพื่อตรวจสอบ</p>}
          </div><a className="button secondary" href={groupHref(brandId, group.state, group.id, returnTo)}>เปิดกลุ่ม<span className="visually-hidden"> {groupLabel(group.state, group.id)}</span></a>
        </li>;
      })}</ul>
      {pages > 1 && <WorkspacePagination id={`groups-${encodeURIComponent(brandId ?? "all")}`} page={current} pages={pages} size={size} onChange={(next, count) => { update({ gp: next, gs: count }); }} />}
    </>}
  </div>;
}

export function BrandProjectGroups({ brandId, returnTo }: { brandId: string; returnTo: string }) {
  const [data, setData] = useState<Progress | null>(null), [error, setError] = useState("");
  const { query, update } = useListQuery();
  const other = query.get("bother") === "1";
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setError(""); setData(null);
    void request<Progress>("v1/admin/projects/progress").then(value => { if (active) setData(value); }).catch(error => { if (active) setError(error instanceof Error ? error.message : "โหลดกลุ่มโครงการไม่สำเร็จ"); });
    return () => { active = false; };
  }, [attempt]);
  if (error) return <div role="alert">{error}<button className="button secondary" onClick={() => setAttempt(value => value + 1)}>ลองโหลดกลุ่มใหม่</button></div>;
  if (!data) return <p role="status">กำลังโหลดกลุ่มโครงการ…</p>;
  const rows = data.rows.filter(row => row.rem_brand_id === brandId && (other || row.source_review?.default_scope !== false));
  return <section aria-label="กลุ่มโครงการของแบรนด์">
    <label className="brand-confirm-check"><input type="checkbox" checked={other} onChange={event => update({ bother: event.target.checked ? "1" : null, gp: null })} />แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ</label>
    <ProjectGroups rows={rows} allRows={data.rows} brandId={brandId} returnTo={returnTo} />
  </section>;
}
