"use client";

import { useEffect, useState } from "react";
import { request } from "./hub-request";
import type { ProgressRow } from "./project-dashboard";
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

type GroupRow = { state: GroupStatus; id: string | null; count: number; published: number; filling: number; awaiting_publisher: number; names: string[]; brand_count: number };
type GroupPage = { rows: GroupRow[]; page: number; pages: number; total: number };
export function ProjectGroups({ brandId = null, returnTo, otherOverride }: { brandId?: string | null; returnTo: string; otherOverride?: boolean }) {
  const { query, update } = useListQuery();
  const page = pageNumber(query.get("gp")), size = pageSizeNumber(query.get("gs"));
  const [data, setData] = useState<GroupPage | null>(null), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const parameters = new URLSearchParams({ view: "groups", page: String(page), size: String(size),
    status: query.get("pstatus") || "all", rem_status: query.get("prem_status") || "all", q: query.get("pq") || "",
    other: String(otherOverride ?? query.get("pother") === "1"), ...(brandId ? { brand: brandId } : {}) }).toString();
  useEffect(() => {
    let active = true; setError(""); setData(null);
    void request<GroupPage>(`v1/admin/projects/progress?${parameters}`).then(value => { if (active) setData(value); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "โหลดกลุ่มโครงการไม่สำเร็จ"); });
    return () => { active = false; };
  }, [parameters, attempt]);
  if (error) return <p role="alert">{error}<button className="button secondary" onClick={() => setAttempt(v => v + 1)}>ลองโหลดกลุ่มใหม่</button></p>;
  if (!data) return <p role="status">กำลังโหลดกลุ่มโครงการ…</p>;
  return <div className="project-groups">
    <p className="field-help">จัดตามรหัสกลุ่ม REM ในสำเนาต้นทาง · ยังไม่ใช่การรับรองสมาชิกกลุ่มการตลาด</p>
    {!data.rows.length ? <p>ไม่มีโครงการในขอบเขตที่เลือก</p> : <>
      <ul className="project-group-list">{data.rows.map(group => <li key={JSON.stringify([group.state, group.id])}>
        <div><strong className="source-code">{groupLabel(group.state, group.id)}</strong><p>{group.count} โครงการ · เผยแพร่แล้ว {group.published} · กำลังกรอก {group.filling} · รอผู้เผยแพร่ {group.awaiting_publisher}</p>
          {group.id && group.id !== group.id.trim() && <p className="field-help">รหัสมีช่องว่าง: <code>{JSON.stringify(group.id)}</code> · เก็บรหัสต้นทางตามเดิม</p>}
          <p className="small-text muted">{group.names.join(" · ")}{group.count > 2 ? ` และอีก ${group.count - 2} โครงการ` : ""}</p>
          {group.brand_count > 1 && <p className="field-help">กลุ่มนี้มีสมาชิกต่างแบรนด์{brandId ? " · แสดงเฉพาะแบรนด์ที่เลือก" : ""}</p>}
          {group.state === "conflict" && <p className="field-help">ต้นทางมีข้อขัดแย้ง แสดงแต่ละโครงการเพื่อตรวจสอบ</p>}
        </div><a className="button secondary" href={groupHref(brandId, group.state, group.id, returnTo)}>เปิดกลุ่ม<span className="visually-hidden"> {groupLabel(group.state, group.id)}</span></a>
      </li>)}</ul>
      {data.pages > 1 && <WorkspacePagination id={`groups-${encodeURIComponent(brandId ?? "all")}`} page={data.page} pages={data.pages} size={size} onChange={(next, count) => { update({ gp: next, gs: count }); }} />}
    </>}
  </div>;
}

export function BrandProjectGroups({ brandId, returnTo }: { brandId: string; returnTo: string }) {
  const { query, update } = useListQuery(); const other = query.get("bother") === "1";
  return <section aria-label="กลุ่มโครงการของแบรนด์">
    <label className="brand-confirm-check"><input type="checkbox" checked={other} onChange={event => update({ bother: event.target.checked ? "1" : null, gp: null })} />แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ</label>
    <ProjectGroups brandId={brandId} returnTo={returnTo} otherOverride={other} />
  </section>;
}
