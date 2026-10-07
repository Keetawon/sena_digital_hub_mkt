"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { LocalRole } from "@/lib/local-session";
import { ActorName } from "./accounts";
import { EntityThumbnail, type Thumbnail } from "./entity-thumbnail";
import { DashboardTiles } from "./dashboard-tiles";
import { request } from "./hub-request";
import { AssetDialog } from "./project-assets";
import { useHostedSession } from "./hosted-session";
import { BrandProjectGroups } from "./project-groups";
import { pageNumber, pageSizeNumber, useListQuery } from "./workspace-navigation";

type Readiness = { ready: boolean; percent: number; missing: { field: string; message: string }[] };
export type CompletenessRow = { thumbnail?: Thumbnail | null; id?: string; public_brand_id: string | null; rem_brand_id: string; name_th: string | null; name_en: string | null; residential_project_count: number; status: string; reason_codes: string[]; readiness: Readiness; checks: Record<string, boolean>; optional_logos: string[]; unconfirmed_source_names?: string[]; updated_at: string | null; updated_by: string | null; published_version_id?: string | null; publication_available?: boolean; has_unpublished_changes?: boolean };
type Dashboard = { rows: CompletenessRow[]; counts: Record<string, number> };
type PreviewRow = { rem_brand_id: string; eligible: boolean; public_name: { th?: string; en?: string }; suggested_slug: string; reason_codes: string[]; residential_project_count: number };
type BulkPreview = { preview_sha256: string; create_count: number; rows: PreviewRow[] };
const tiles = [{ value: "all", key: "total", label: "ทั้งหมด" }, { value: "missing_data", key: "missing_data", label: "ยังขาดข้อมูล" }, { value: "ready", key: "ready", label: "พร้อมเผยแพร่" }, { value: "published", key: "published", label: "เผยแพร่แล้ว" }, { value: "published_changes", key: "published_changes", label: "เผยแพร่แล้วมีการแก้ไข" }, { value: "not_created", key: "not_created", label: "ยังไม่สร้าง" }];
const checkLabels: Record<string, string> = { name_th_confirmed: "ชื่อไทยยืนยันแล้ว", description: "คำอธิบาย", slug: "ชื่ออ้างอิง", primary_logo: "โลโก้หลัก", logo_rights: "สิทธิ์โลโก้" };
export const brandReasonLabels: Record<string, string> = { deleted: "ต้นทางถูกลบ", unknown_status: "ยังไม่ทราบสถานะต้นทาง", blank_name: "ไม่มีชื่อภาษาไทย", duplicate: "ชื่อซ้ำ ต้องตรวจตามรหัส", no_residential_project: "ไม่มีโครงการที่อยู่อาศัย", already_created: "มีแบรนด์แล้ว เก็บงานเดิม", archived: "เคยสร้างและเก็บถาวรแล้ว" };
const logoLabels: Record<string, string> = { logo_white: "สีขาว", logo_mono: "ขาวดำ", favicon: "ไอคอนเว็บไซต์" };
const dates = (value: string | null) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
const statusText = (row: CompletenessRow) => row.status === "not_created" ? "ยังไม่สร้าง" : row.status === "published_changes" ? "เผยแพร่แล้ว · มีการแก้ไขรอเผยแพร่" : row.status === "published" ? "เผยแพร่แล้ว" : row.status === "ready" ? "ฉบับร่าง · พร้อมเผยแพร่" : "ฉบับร่าง · ยังขาดข้อมูล";
const errorText = (error: unknown) => error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง";
const matches = (row: CompletenessRow, status: string) => status === "all" || status === "published" && row.publication_available || status === "ready" && row.readiness.ready && (!row.publication_available || row.has_unpublished_changes) || status === "missing_data" && row.status !== "not_created" && !row.readiness.ready || status === row.status;

function BulkDialog({ preview, onCancel, onSaved }: { preview: BulkPreview; onCancel: () => void; onSaved: (message: string) => Promise<void> }) {
  const [confirmed, setConfirmed] = useState(false), [reason, setReason] = useState("");
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!confirmed || !reason.trim()) return; setPending(true); setError("");
    try { const result = await request<{ created_count: number }>("v1/admin/brands/bulk-create", "POST", { preview_sha256: preview.preview_sha256, confirmed: true, change_reason: reason.trim() }); await onSaved(`สร้างฉบับร่าง ${result.created_count} แบรนด์แล้ว`); }
    catch (error) { setError(errorText(error)); setPending(false); }
  }
  return <AssetDialog title="ตรวจรายการก่อนสร้างฉบับร่างแบรนด์" dirty={confirmed || Boolean(reason)} pending={pending} error={error} onCancel={onCancel} onSubmit={submit} submitLabel="ยืนยันสร้างฉบับร่างแบรนด์" submitDisabled={!confirmed || !reason.trim() || preview.create_count === 0}>
    <p>จะสร้าง {preview.create_count} ฉบับร่างในเครื่องนี้ ชื่อไทยและอังกฤษที่มีเป็น <strong>ค่าจากต้นทาง ยังไม่ยืนยัน</strong> แก้ไขได้ ชื่ออ้างอิงเป็นข้อเสนอจากภาษาอังกฤษ คำอธิบายและโลโก้ว่าง</p><p>เก็บงานเดิมทุกแบรนด์ ไม่เผยแพร่ และไม่ส่งไป TEST H1</p>
    <div className="brand-table-scroll"><table className="brand-completeness-table brand-bulk-table"><thead><tr><th>รหัส REM</th><th>ชื่อไทย / อังกฤษ</th><th>ชื่ออ้างอิงที่เสนอ</th><th>โครงการที่อยู่อาศัย</th><th>ผลตรวจ</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.rem_brand_id}><td data-label="รหัส REM">{row.rem_brand_id}</td><td data-label="ชื่อไทย / อังกฤษ">{row.public_name.th || "ไม่มีชื่อไทย"}<br />{row.public_name.en || "ไม่มีชื่ออังกฤษ"}</td><td data-label="ชื่ออ้างอิงที่เสนอ">{row.suggested_slug || "ต้องจัดเตรียมใน Hub"}</td><td data-label="โครงการที่อยู่อาศัย">{row.residential_project_count}</td><td data-label="ผลตรวจ">{row.eligible ? "จะสร้างฉบับร่าง" : row.reason_codes.map(code => brandReasonLabels[code] || code).join(" · ")}</td></tr>)}</tbody></table></div>
    <div className="form-field"><label htmlFor="brand-bulk-reason">เหตุผลในการสร้างฉบับร่าง</label><textarea id="brand-bulk-reason" required maxLength={1000} value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></div><label className="brand-confirm-check"><input type="checkbox" checked={confirmed} disabled={pending || preview.create_count === 0} onChange={event => setConfirmed(event.target.checked)} />ยืนยันสร้างเฉพาะรายการที่ผ่านในพรีวิวนี้</label>
  </AssetDialog>;
}

function BrandPagination({ position, page, pageCount, pageSize, onPageChange, onPageSizeChange }: {
  position: "top" | "bottom"; page: number; pageCount: number; pageSize: number;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void;
}) {
  return <nav className="brand-pagination" aria-label={`หน้ารายการแบรนด์${position === "top" ? "ด้านบน" : "ด้านล่าง"}`}>
    <div className="brand-page-size"><label htmlFor={`brand-page-size-${position}`}>รายการต่อหน้า</label><select id={`brand-page-size-${position}`} value={pageSize} onChange={event => onPageSizeChange(Number(event.target.value))}>{[10, 25, 50].map(size => <option key={size} value={size}>{size}</option>)}</select></div>
    <div className="brand-page-controls">
      <button className="button secondary" disabled={page === 1} onClick={() => onPageChange(page - 1)}>หน้าก่อนหน้า</button>
      <div className="brand-page-number"><label htmlFor={`brand-page-${position}`}>หน้า</label><select id={`brand-page-${position}`} value={page} onChange={event => onPageChange(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select><span>จาก {pageCount}</span></div>
      <button className="button secondary" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>หน้าถัดไป</button>
    </div>
  </nav>;
}

export function BrandDashboard({ role, onChanged, children }: { role: LocalRole; onChanged: () => Promise<void>; children?: ReactNode }) {
  const hosted = Boolean(useHostedSession());
  const [data, setData] = useState<Dashboard | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const { query: listQuery, update, href: listHref } = useListQuery();
  const status = listQuery.get("bstatus") || "all", missing = listQuery.get("bmissing") || "all", search = listQuery.get("bq") || "";
  const page = pageNumber(listQuery.get("bp")), pageSize = pageSizeNumber(listQuery.get("bs"));
  const setStatus = (value: string) => update({ bstatus: value }), setMissing = (value: string) => update({ bmissing: value });
  const setSearch = (value: string) => update({ bq: value }), setPage = (value: number) => update({ bp: value }), setPageSize = (value: number) => update({ bs: value });
  const expanded = listQuery.get("bopen");
  const detailHref = (id: string) => `/?${new URLSearchParams({ brand: id, return_to: listHref })}`;
  const tableScroll = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<BulkPreview | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<CompletenessRow[]>([]), [releaseOpen, setReleaseOpen] = useState(false), [releaseReason, setReleaseReason] = useState(""), [releaseConfirmed, setReleaseConfirmed] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await request<Dashboard>("v1/admin/brands/completeness")); } catch (error) { setError(errorText(error)); } finally { setLoading(false); } }, []);
  useEffect(() => { setSelected([]); setPreview(null); setReleaseOpen(false); void load(); }, [load, role]);
  const filtered = (data?.rows ?? []).filter(row => matches(row, status) && (missing === "all" || !row.checks[missing]) && `${row.name_th || ""} ${row.name_en || ""} ${row.rem_brand_id}`.toLocaleLowerCase("th").includes(search.toLocaleLowerCase("th").trim()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount), start = (currentPage - 1) * pageSize;
  const visibleRows = filtered.slice(start, start + pageSize);
  const selectedElsewhere = selected.filter(row => !visibleRows.some(visible => visible.rem_brand_id === row.rem_brand_id)).length;
  useEffect(() => { tableScroll.current?.scrollTo({ top: 0, behavior: "instant" }); }, [currentPage, pageSize, status, missing, search]);
  function selectStatus(value: string) { setStatus(value); setPage(1); }
  function pagination(position: "top" | "bottom") {
    function returnToTable() {
      if (position === "bottom") { tableScroll.current?.focus({ preventScroll: true }); tableScroll.current?.scrollIntoView({ block: "start", behavior: "instant" }); }
    }
    return <BrandPagination position={position} page={currentPage} pageCount={pageCount} pageSize={pageSize}
      onPageChange={value => { setPage(value); returnToTable(); }}
      onPageSizeChange={value => { setPageSize(value); setPage(1); returnToTable(); }} />;
  }
  const query = new URLSearchParams({ status, missing, search });
  async function showPreview() { setBusy(true); setError(""); try { setPreview(await request<BulkPreview>("v1/admin/brands/bulk-preview")); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }
  async function saved(message: string) { setPreview(null); setNotice(message); await Promise.all([load(), onChanged()]); }
  async function publish(event: FormEvent) {
    event.preventDefault(); if (!selected.length || !releaseConfirmed || !releaseReason.trim()) return; setBusy(true); setError("");
    try { const release = await request<{ id: string }>("v1/admin/releases/publish", "POST", { demo_mode: false, change_reason: releaseReason.trim(), members: selected.map(row => ({ entity_type: "brand", entity_id: row.id, expected_updated_at: row.updated_at, expected_published_version_id: row.published_version_id })) }); setSelected([]); setReleaseOpen(false); setReleaseReason(""); setReleaseConfirmed(false); await saved(`เผยแพร่แบรนด์เป็นชุดเดียวแล้ว · รหัสชุด ${release.id}`); }
    catch (error) { setError(errorText(error)); } finally { setBusy(false); }
  }
  return <section aria-label="ความครบถ้วนของแบรนด์" className="brand-dashboard">
    <DashboardTiles tiles={tiles} counts={data?.counts} selected={status} onSelect={selectStatus} loading={loading || Boolean(error)} label="ภาพรวมความครบถ้วน" />
    <p className="field-help">จำนวนของทุกแบรนด์ รวมรายการต้นทางที่ยังไม่สร้าง จำนวนเผยแพร่แล้วรวมแบรนด์ที่มีการแก้ไข คะแนนใช้เกณฑ์เผยแพร่เดิม ค่าชื่อจากต้นทางที่ยังไม่ยืนยันแสดงแยกให้ทีมตรวจ</p>
    {children}
    <div className="brand-dashboard-toolbar"><div className="form-field"><label htmlFor="brand-search">ค้นหาชื่อหรือรหัสแบรนด์</label><input id="brand-search" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div><div className="form-field"><label htmlFor="brand-missing-filter">ฟิลด์ที่ยังขาด</label><select id="brand-missing-filter" value={missing} onChange={event => { setMissing(event.target.value); setPage(1); }}><option value="all">ทุกฟิลด์</option>{Object.entries(checkLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="form-field"><label htmlFor="brand-status-filter">สถานะแบรนด์</label><select id="brand-status-filter" value={status} onChange={event => selectStatus(event.target.value)}>{tiles.map(tile => <option key={tile.value} value={tile.value}>{tile.label}</option>)}</select></div></div>
    <div className="brand-dashboard-actions"><a className="button secondary" href={`/api/hub/v1/admin/brands/completeness.csv?${query}`} download>ดาวน์โหลด CSV ตามตัวกรอง</a>{role === "admin" && !hosted && <button className="button primary" disabled={busy || loading} onClick={() => void showPreview()}>พรีวิวสร้างฉบับร่างจาก DW</button>}{role === "publisher" && <button className="button primary" disabled={!selected.length || busy} onClick={() => { setReleaseConfirmed(false); setReleaseOpen(true); }}>เผยแพร่แบรนด์ที่เลือก ({selected.length})</button>}<button className="button secondary" disabled={busy || loading} onClick={() => { setSelected([]); void load(); }}>โหลดสถานะแบรนด์ใหม่</button></div>
    {role === "publisher" && <p className="field-help">กด “เปิดตรวจแบรนด์” เพื่อตรวจข้อมูลและอนุมัติสิทธิ์โลโก้ได้แม้ข้อมูลยังไม่ครบ ช่อง “เลือกเผยแพร่” ใช้เฉพาะแบรนด์ที่พร้อม 100% ส่วนรายการ “ยังไม่สร้าง” ยังไม่มีฉบับร่างให้ตรวจ</p>}
    {notice && <p className="notice success" role="status">{notice}</p>}{error && <div className="notice error" role="alert">{error}<button className="button secondary" onClick={() => void load()}>ลองโหลดความครบถ้วนอีกครั้ง</button></div>}
    {loading ? <p role="status">กำลังตรวจความครบถ้วนของแบรนด์…</p> : !error && <>
      <div className="brand-table-summary"><p id="brand-page-range" role="status">แสดง {filtered.length ? start + 1 : 0}–{Math.min(start + pageSize, filtered.length)} จาก {filtered.length} รายการ · เรียงรายการที่ยังขาดมากที่สุดก่อน</p><p className="small-text muted">CSV รวมทุกหน้าตามตัวกรอง</p></div>
      {role === "publisher" && selected.length > 0 && <div className="brand-selection-summary"><p role="status">เลือกไว้ {selected.length} แบรนด์{selectedElsewhere > 0 && ` · อยู่นอกหน้านี้ ${selectedElsewhere} แบรนด์`}</p><button className="button secondary" disabled={busy} onClick={() => { setSelected([]); setReleaseConfirmed(false); }}>ล้างรายการที่เลือก</button></div>}
      {pagination("top")}
      <p className="field-help brand-table-scroll-help">เลื่อนภายในตารางเพื่อดูรายการและคอลัมน์เพิ่มเติม หัวตารางจะตรึงอยู่ด้านบน</p>
      <div className="brand-table-scroll brand-dashboard-table-scroll" ref={tableScroll} tabIndex={0} role="region" aria-label="ตารางความครบถ้วนของแบรนด์" aria-describedby="brand-page-range"><table className="brand-completeness-table"><caption className="sr-only">ความครบถ้วนของแบรนด์และเหตุผลที่ยังไม่สร้าง</caption><thead><tr>{role === "publisher" && <th scope="col">เลือกเผยแพร่</th>}<th scope="col">ชื่อแบรนด์</th><th scope="col">รหัส REM</th><th scope="col">โครงการที่อยู่อาศัย</th><th scope="col">สถานะ</th>{Object.values(checkLabels).map(label => <th scope="col" key={label}>{label}</th>)}<th scope="col">โลโก้เสริม</th><th scope="col">ความพร้อม</th><th scope="col">ยังขาด</th><th scope="col">ปรับปรุงล่าสุด / โดย</th></tr></thead><tbody>{visibleRows.map(row => <Fragment key={row.rem_brand_id}><tr className="brand-table-row" key={row.rem_brand_id} tabIndex={row.public_brand_id ? 0 : undefined} onClick={event => { if (row.public_brand_id && !(event.target as HTMLElement).closest("a,button,input,label")) window.location.assign(detailHref(row.public_brand_id)); }} onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget && row.public_brand_id) window.location.assign(detailHref(row.public_brand_id)); }}>
      {role === "publisher" && <td data-label="เลือกเผยแพร่"><label className="brand-confirm-check"><input type="checkbox" aria-label={`เลือกเผยแพร่ ${row.name_th || row.rem_brand_id}`} aria-describedby={`brand-publish-help-${encodeURIComponent(row.rem_brand_id)}`} disabled={busy || !row.public_brand_id || !row.readiness.ready || row.readiness.percent !== 100} checked={selected.some(item => item.rem_brand_id === row.rem_brand_id)} onChange={event => { setReleaseConfirmed(false); setSelected(previous => event.target.checked ? [...previous, row] : previous.filter(item => item.rem_brand_id !== row.rem_brand_id)); }} />เลือก</label><p className="small-text muted" id={`brand-publish-help-${encodeURIComponent(row.rem_brand_id)}`}>{!row.public_brand_id ? "ยังไม่มีฉบับร่างให้ตรวจ" : !row.readiness.ready || row.readiness.percent !== 100 ? "ข้อมูลยังไม่ครบสำหรับเผยแพร่" : "พร้อมเลือกเผยแพร่"}</p>{row.public_brand_id && <p><a className="button secondary" href={detailHref(row.public_brand_id)} aria-label={`เปิดตรวจแบรนด์ ${row.name_th || row.rem_brand_id}`}>เปิดตรวจแบรนด์</a></p>}</td>}
      <td data-label="ชื่อแบรนด์"><div className="entity-list-identity"><EntityThumbnail name={row.name_th || row.name_en || row.rem_brand_id} image={row.thumbnail} brandKey={row.rem_brand_id} /><div>{row.public_brand_id ? <a href={detailHref(row.public_brand_id)}>{row.name_th || "แบรนด์ที่ยังไม่ระบุชื่อ"}</a> : <strong>{row.name_th || "ไม่มีชื่อไทยต้นทาง"}</strong>}<p className="small-text muted">{row.name_en || "ไม่มีชื่ออังกฤษ"}</p>{Boolean(row.unconfirmed_source_names?.length) && <p className="small-text brand-source-prefill">ค่าจากต้นทาง ยังไม่ยืนยัน · {row.unconfirmed_source_names?.join(" / ")}</p>}</div></div></td><td data-label="รหัส REM" className="source-code">{row.rem_brand_id}</td><td data-label="โครงการที่อยู่อาศัย">{row.residential_project_count}<button className="button secondary brand-group-toggle" aria-expanded={expanded === row.rem_brand_id} aria-controls={`brand-groups-${encodeURIComponent(row.rem_brand_id)}`} onClick={() => update({ bopen: expanded === row.rem_brand_id ? null : row.rem_brand_id, gp: null })}>{expanded === row.rem_brand_id ? "ซ่อนกลุ่มโครงการ" : "แสดงกลุ่มโครงการ"}</button></td><td data-label="สถานะ">{statusText(row)}</td>{Object.entries(checkLabels).map(([key, label]) => <td data-label={label} key={key}><span aria-label={`${label}: ${row.checks[key] ? "ครบ" : "ยังขาด"}`}>{row.checks[key] ? "✓ ครบ" : "— ยังขาด"}</span></td>)}<td data-label="โลโก้เสริม">{row.optional_logos.map(role => logoLabels[role]).join(" · ") || "ยังไม่มี"}</td><td data-label="ความพร้อม">{row.public_brand_id ? `${row.readiness.percent}%` : "ยังไม่สร้าง"}</td><td data-label="ยังขาด">{row.status === "not_created" ? row.reason_codes.map(code => brandReasonLabels[code] || code).join(" · ") || "ผ่านเกณฑ์สร้าง รอผู้ดูแลยืนยัน" : <>{row.readiness.missing.map(item => item.message).join(" · ") || "พร้อมตามเกณฑ์เผยแพร่"}{row.unconfirmed_source_names?.includes("th") && <p>ชื่อไทยจากต้นทางยังไม่ยืนยัน</p>}</>}</td><td data-label="ปรับปรุงล่าสุด / โดย">{dates(row.updated_at)}<p className="small-text" title={row.updated_by ? `รหัสผู้แก้ไข: ${row.updated_by}` : undefined}>{row.updated_by ? <ActorName id={row.updated_by} /> : row.public_brand_id ? "ยังไม่มีข้อมูลผู้แก้ไข" : "ยังไม่สร้าง"}</p></td>
    </tr>{expanded === row.rem_brand_id && <tr className="brand-group-row"><td colSpan={role === "publisher" ? 14 : 13}><div id={`brand-groups-${encodeURIComponent(row.rem_brand_id)}`}><BrandProjectGroups brandId={row.rem_brand_id} returnTo={listHref} /></div></td></tr>}</Fragment>)}</tbody></table></div>{!filtered.length && <p className="empty-state compact">ไม่พบแบรนด์ที่ตรงกับตัวกรอง</p>}{pagination("bottom")}</>}
    {preview && <BulkDialog preview={preview} onCancel={() => setPreview(null)} onSaved={saved} />}
    {releaseOpen && <AssetDialog title="ตรวจชุดเผยแพร่แบรนด์" dirty={Boolean(releaseReason) || releaseConfirmed} pending={busy} error={error} onCancel={() => setReleaseOpen(false)} onSubmit={publish} submitLabel="ยืนยันเผยแพร่แบรนด์ทั้งชุด" submitDisabled={!releaseConfirmed || !releaseReason.trim() || !selected.length}>
      <p>เผยแพร่ {selected.length} แบรนด์ที่พร้อม 100% เป็นชุดเดียว หากรายการใดเปลี่ยนหรือไม่ผ่านจะหยุดทั้งชุด</p><ul>{selected.map(row => <li key={row.rem_brand_id}>{row.name_th} · REM {row.rem_brand_id} · ร่าง ณ {dates(row.updated_at)}</li>)}</ul><div className="form-field"><label htmlFor="brand-release-reason">เหตุผลเผยแพร่แบรนด์ทั้งชุด</label><textarea id="brand-release-reason" required maxLength={1000} value={releaseReason} disabled={busy} onChange={event => { setReleaseReason(event.target.value); setReleaseConfirmed(false); }} /></div><label className="brand-confirm-check"><input type="checkbox" checked={releaseConfirmed} disabled={busy} onChange={event => setReleaseConfirmed(event.target.checked)} />ยืนยันเผยแพร่แบรนด์ที่เลือกเป็นชุดเดียว</label>
    </AssetDialog>}
  </section>;
}
