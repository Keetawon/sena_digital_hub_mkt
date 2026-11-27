"use client";
import { useHubPermissions } from "./accounts";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { LocalRole } from "@/lib/local-session";
import { canOpenPage } from "@/lib/hub-permissions";
import { workspaceHref } from "@/lib/unified-workspace";
import { projectGroupReviewText as review } from "@/lib/project-group-review-copy";
import { request } from "./hub-request";
import { EntityThumbnail, type Thumbnail } from "./entity-thumbnail";
import { KmCoverPlate } from "./km-hubs";
import { CompletenessBar } from "./completeness-bar";
import { PublicWebsiteSource, type WebsiteSource } from "./public-website-source";
import { DashboardTiles } from "./dashboard-tiles";
import { ProjectSourceReview, ProjectGroupSummary, SourceStatusFilter, type SourceReview, type ProjectGroupInfo } from "./project-source-review";
import { ProjectGroups, groupLabel, type GroupStatus } from "./project-groups";
import { WorkspaceBack, WorkspacePagination, pageNumber, pageSizeNumber, projectHref, useListQuery } from "./workspace-navigation";
import "./brand-admin.css";
import "./project-groups.css";
import "./project-dashboard.css";
import "./km-hubs.css";

type Check = { field: string; message: string; passed: boolean; group?: "core" | "media" | "models" | "brand" | "extra" };
type Gap = { field: string; message: string };
export type ProgressRow = ProjectGroupInfo & {
  public_project_id: string | null;
  rem_project_id: string;
  name: string;
  brand_name: string | null;
  rem_brand_id?: string | null;
  rem_project_group_id?: string | null;
  marketing_project_group_id?: string | null;
  group_status?: GroupStatus;
  new_from_rem: boolean;
  filling: boolean;
  awaiting_publisher: boolean;
  published: boolean;
  needs_attention: boolean;
  has_unpublished_changes: boolean;
  withdrawn: boolean;
  attention: Gap[];
  gaps: Record<"core" | "media" | "models" | "brand", Gap[]>;
  confirmed_models: number;
  total_models: number;
  amenities: { collected: number; total: number } | null;
  waiting_on: string[];
  updated_at: string | null;
  first_seen_at: string | null;
  age_days: number | null;
  age_basis: "first_import" | "first_seen" | "mirror_import" | "unknown";
  source_review?: SourceReview;
  thumbnail?: Thumbnail | null;
  cover_image?: Thumbnail | null;
  brand_logo?: Thumbnail | null;
  unit_type_count?: number;
  product_form?: string | null;
  starting_price_text?: string | null;
  km_section_count?: number;
  faq_count?: number;
  promotion_count?: number;
  pillars?: { km?: boolean; units?: boolean; media?: boolean; faq?: boolean };
  checklist?: { required: Check[]; recommended: Check[]; passed: number; total: number; percent: number; ready: boolean };
  required_missing?: number;
  website_sources?: WebsiteSource[];
  knowledge?: { reviewed: number; staged: number };
  thumbnail_asset_id?: string | null;
};
export type Progress = { rows: ProgressRow[]; total: number; page: number; size: number; pages: number };
type Facets = { counts: Record<string, number>; statuses: Record<string, { label: string; count: number }>; status_total: number; brands: [string, string][]; groups: [string, string | null][] };

const tiles = [
  { value: "all", key: "all", label: "ทั้งหมด" },
  { value: "new_from_rem", key: "new_from_rem", label: "ใหม่จาก REM" },
  { value: "filling", key: "filling", label: "กำลังกรอก" },
  { value: "awaiting_publisher", key: "awaiting_publisher", label: "รอผู้เผยแพร่" },
  { value: "published", key: "published", label: "เผยแพร่แล้ว" },
  { value: "needs_attention", key: "needs_attention", label: "ต้องดูแล" },
];
const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";
const groupLabels = { core: "ข้อมูลหลัก", media: "รูปภาพ", models: "แบบบ้าน", brand: "แบรนด์", extra: "ข้อมูลเสริม" };

function Checks({ row, returnTo, onStart, knowledgeTarget }: { row: ProgressRow; returnTo: string; onStart: (id: string) => void; knowledgeTarget: string | null }) {
  return (
    <div className="project-check-groups">
      {(["required", "recommended"] as const).map(level => (
        <section key={level} aria-label={level === "required" ? "ต้องมีก่อนเผยแพร่" : "ควรเติมภายหลัง"}>
          <h3>{level === "required" ? "ต้องมีก่อนเผยแพร่" : "ควรเติมภายหลัง"}</h3>
          {Object.entries(groupLabels).map(([group, label]) => (
            <div key={group}>
              <h4>{label}</h4>
              <ul>
                {(row.checklist?.[level] ?? [])
                  .filter(item => (item.group ?? "core") === group)
                  .map((item, index) => (
                    <li key={`${item.field}-${index}`}>
                      <span aria-label={item.passed ? "ครบแล้ว" : "ยังขาด"}>{item.passed ? "✓" : "○"}</span>
                      <span>{item.message}</span>
                      {item.field === "knowledge" || item.field === "nearby" ? (
                        knowledgeTarget && (
                          <a href={knowledgeTarget + (item.field === "nearby" && knowledgeTarget.startsWith("/knowledge?") ? "&kind=nearby" : "")}>
                            {review.open_review}
                            <span className="sr-only"> {item.message}</span>
                          </a>
                        )
                      ) : row.public_project_id ? (
                        <a href={projectHref(row.public_project_id, returnTo, item.field)}>
                          ไปแก้<span className="sr-only"> {item.message}</span>
                        </a>
                      ) : (
                        <button className="button text-button" onClick={() => onStart(row.rem_project_id)}>
                          ไปแก้<span className="sr-only"> {item.message}</span>
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
              {!(row.checklist?.[level] ?? []).some(item => (item.group ?? "core") === group) && <p className="muted small-text">ไม่มีรายการ</p>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function status(row: ProgressRow) {
  return row.new_from_rem
    ? "ใหม่จาก REM"
    : row.needs_attention
      ? "ต้องดูแล"
      : row.published && row.has_unpublished_changes
        ? "มีการแก้ไขที่ยังไม่เผยแพร่"
        : row.published
          ? "เผยแพร่แล้ว"
          : row.withdrawn
            ? "ถอนการเผยแพร่แล้ว"
            : row.filling
              ? "กำลังกรอก"
              : "รอผู้เผยแพร่";
}

function PhaseReviewLinks({ row, canProject, canKnowledge }: { row: ProgressRow; canProject: boolean; canKnowledge: boolean }) {
  if (!row.public_project_id) return null;
  const target = { level: "project" as const, id: row.public_project_id, phase: row.rem_project_id };
  return (
    <>
      <p className="field-help">{review.phase_review_hint}</p>
      <nav className="content-actions" aria-label={review.phase_review}>
        {canProject && (
          <>
            <a className="button secondary" href={workspaceHref({ ...target, tab: "data", section: "identity" })}>
              {review.identity}
            </a>
            <a className="button secondary" href={workspaceHref({ ...target, tab: "data", section: "facts" })}>
              {review.facts}
            </a>
            <a className="button secondary" href={workspaceHref({ ...target, tab: "data", section: "buildings" })}>
              {review.buildings}
            </a>
          </>
        )}
        {canKnowledge && (
          <a className="button secondary" href={workspaceHref({ ...target, tab: "faq" })}>
            {review.faq}
          </a>
        )}
        {canProject && (
          <a className="button secondary" href={workspaceHref({ ...target, tab: "media", section: "library" })}>
            {review.media}
          </a>
        )}
      </nav>
    </>
  );
}

export function ProjectDashboard({ role, onStart }: { role: LocalRole; onStart: (sourceId: string) => void }) {
  const permissions = useHubPermissions();
  const { query, update, href } = useListQuery();
  const [data, setData] = useState<Progress | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [facets, setFacets] = useState<Facets | null>(null);
  const [details, setDetails] = useState<Record<string, ProgressRow>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const table = useRef<HTMLDivElement>(null);
  const cardGrid = useRef<HTMLDivElement>(null);
  const filter = query.get("pstatus") || "all",
    search = query.get("pq") || "",
    sourceStatus = query.get("prem_status") || "all";
  const includeOther = query.get("pother") === "1",
    brandId = query.get("rem_brand"),
    selectedGroup = query.get("group");
  const selectedGroupState = query.get("group_state"),
    groupsView = query.get("view") === "groups";
  const layout = query.get("playout") === "table" || (Boolean(selectedGroupState) && query.get("playout") !== "cards") ? "table" : "cards";
  const page = pageNumber(query.get("pp")),
    size = pageSizeNumber(query.get("ps"));
  const parameters = new URLSearchParams({
    page: String(page),
    size: String(size),
    q: search,
    status: filter,
    rem_status: sourceStatus,
    other: String(includeOther),
    ...(brandId ? { brand: brandId } : {}),
    ...(selectedGroup ? { group: selectedGroup } : {}),
    ...(selectedGroupState ? { group_state: selectedGroupState } : {}),
  }).toString();
  const load = useCallback(async () => {
    const attempt = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await request<Progress & { facets: Facets }>(`v1/admin/projects/progress?${parameters}&view=dashboard`);
      if (attempt === sequence.current) {
        setData(result);
        setFacets(result.facets);
        setDetails({});
        setExpanded(new Set());
      }
    } catch (error) {
      if (attempt === sequence.current) setError(error instanceof Error ? error.message : "โหลดความคืบหน้าไม่สำเร็จ");
    } finally {
      if (attempt === sequence.current) setLoading(false);
    }
  }, [parameters]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  useEffect(() => {
    table.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [page, size, filter, search, sourceStatus, includeOther, brandId]);
  const rows = data?.rows ?? [],
    counts = facets?.counts ?? {};
  const total = data?.total ?? 0,
    pages = data?.pages ?? 1,
    current = data?.page ?? page,
    start = (current - 1) * size;
  const brandOptions = facets?.brands ?? [];
  async function toggleRow(row: ProgressRow) {
    const id = row.rem_project_id;
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!expanded.has(id) && !details[id]) {
      setDetailErrors(previous => ({ ...previous, [id]: "" }));
      try {
        const value = await request<ProgressRow>(`v1/admin/projects/progress?detail=${encodeURIComponent(id)}`);
        setDetails(previous => ({ ...previous, [id]: value }));
      } catch {
        setDetailErrors(previous => ({ ...previous, [id]: "โหลดรายการตรวจไม่ได้ กรุณาปิดแล้วเปิดใหม่" }));
      }
    }
  }
  const canEdit = permissions.can("projects", "edit");
  const canKnowledge = permissions.can("knowledge");
  const canRawIntake = Boolean(permissions.account && canOpenPage(permissions.account, "/knowledge", new URLSearchParams()));
  function knowledgeHref(row: ProgressRow) {
    if (!canKnowledge) return null;
    return canRawIntake
      ? `/knowledge?project=${encodeURIComponent(row.rem_project_id)}`
      : row.public_project_id
        ? workspaceHref({ level: "project", id: row.public_project_id, phase: row.rem_project_id, tab: "faq" })
        : null;
  }
  function filterBy(values: Record<string, string | number | null>) {
    update({ ...values, pp: null, gp: null });
  }
  function pagination(position: string) {
    return (
      <WorkspacePagination
        id={`projects-${position}`}
        page={current}
        pages={pages}
        size={size}
        onChange={(next, count) => {
          update({ pp: next, ps: count });
          if (position === "bottom") {
            const region = layout === "table" ? table.current : cardGrid.current;
            region?.focus({ preventScroll: true });
            region?.scrollIntoView({ block: "start" });
          }
        }}
      />
    );
  }
  return (
    <section className="brand-dashboard project-dashboard" aria-labelledby="project-progress-title">
      {groupsView && <WorkspaceBack fallback="/website?view=groups" label="กลุ่มโครงการทั้งหมด" />}
      {selectedGroupState && (
        <div className="project-group-context">
          <h2 className="source-code">{groupLabel(selectedGroupState as GroupStatus, selectedGroup, facets?.groups?.find(([id]) => id === selectedGroup)?.[1])}</h2>
          <p>
            {selectedGroupState === "marketing_reference"
              ? "สมาชิกตามกลุ่มการตลาดจาก DW"
              : selectedGroupState === "conflict"
                ? "ตัวตนหรือกลุ่มต้นทางขัดแย้ง ตรวจทีละโครงการก่อนยืนยันสมาชิก"
                : "ยังไม่มีกลุ่มการตลาด โครงการยังเปิดตรวจและจัดเตรียมข้อมูลได้"}
          </p>
          <p className="field-help">{review.count_hint}</p>
          {brandId && (
            <p>
              แบรนด์: {brandOptions.find(([id]) => id === brandId)?.[1] || brandId} · แสดงเฉพาะสมาชิกของแบรนด์นี้
            </p>
          )}
        </div>
      )}
      <h2 id="project-progress-title">ความคืบหน้าโครงการ</h2>
      <DashboardTiles tiles={tiles} counts={counts} selected={filter} onSelect={value => filterBy({ pstatus: value })} loading={loading || Boolean(error)} label="ภาพรวมโครงการ" />
      <label className="brand-confirm-check">
        <input type="checkbox" checked={includeOther} onChange={event => filterBy({ pother: event.target.checked ? "1" : null })} />
        แสดงโครงการปิด ถูกลบ และไม่ทราบสถานะ
      </label>
      <p className="field-help">จำนวนอาจซ้อนกันได้ เช่น กำลังกรอกและรออนุมัติภาพ · รอผู้เผยแพร่ไม่ได้หมายความว่าพร้อมเผยแพร่ทุกโครงการ</p>
      <div className="brand-dashboard-toolbar project-progress-toolbar">
        <div className="form-field">
          <label htmlFor="project-progress-search">ค้นหาโครงการ แบรนด์ หรือรหัส REM</label>
          <input id="project-progress-search" type="search" value={search} onChange={event => filterBy({ pq: event.target.value })} />
        </div>
        <SourceStatusFilter
          id="progress-rem-status"
          counts={facets?.statuses}
          total={facets?.status_total}
          value={sourceStatus}
          onChange={value => filterBy({ prem_status: value, ...(!["all", "0", "1", "2"].includes(value) ? { pother: "1" } : {}) })}
        />
        <div className="form-field">
          <label htmlFor="project-brand-filter">กรองโครงการตามแบรนด์</label>
          <select id="project-brand-filter" value={brandId ?? ""} onChange={event => filterBy({ rem_brand: event.target.value || null })}>
            <option value="">ทุกแบรนด์</option>
            {brandOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name} · {id}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="project-group-filter">กลุ่มการตลาด</label>
          <select id="project-group-filter" value={selectedGroup ?? ""} onChange={event => filterBy({ group: event.target.value || null, group_state: null, view: "projects" })}>
            <option value="">ทุกกลุ่ม</option>
            {(facets?.groups ?? []).map(([id, name]) => (
              <option key={id} value={id}>
                {groupLabel("marketing_reference", id, name)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="km-layout-bar">
        <div className="brand-dashboard-actions" style={{ margin: 0 }}>
          <button className="button secondary" disabled={loading} onClick={() => void load()}>
            โหลดความคืบหน้าใหม่
          </button>
        </div>
        {!(groupsView && !selectedGroupState) && (
          <div className="km-view-switcher" role="group" aria-label="รูปแบบการแสดงผลโครงการ">
            <button type="button" className="button secondary" aria-pressed={layout === "cards"} onClick={() => update({ playout: null })}>
              มุมมองการ์ด
            </button>
            <button type="button" className="button secondary" aria-pressed={layout === "table"} onClick={() => update({ playout: "table" })}>
              ตารางจัดการ
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div role="status" aria-label="กำลังโหลดโครงการ" className="hub-skeleton-list">
          กำลังโหลดโครงการ…
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="hub-skeleton-row" aria-hidden="true">
              <span className="hub-skeleton tall" />
              <span className="hub-skeleton" />
              <span className="hub-skeleton" />
              <span className="hub-skeleton short" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : (
        <>
          {groupsView && !selectedGroupState ? (
            <ProjectGroups key={`${brandId}-${filter}-${sourceStatus}-${search}-${includeOther}`} brandId={brandId} returnTo={href} />
          ) : (
            <>
              <p role="status" className="small-text muted">
                แสดง {rows.length ? start + 1 : 0}–{Math.min(start + size, total)} จาก {total} {review.filtered_projects} · เรียงตามความพร้อมเผยแพร่ แล้วตามความครบถ้วน
              </p>
              {canKnowledge && <p className="field-help">{review.intake_hint}</p>}
              {pagination("top")}

              {layout === "cards" ? (
                <div ref={cardGrid} tabIndex={-1} role="region" aria-label="การ์ดความคืบหน้าโครงการ" className="km-project-grid">
                  {rows.map(row => {
                    const open = expanded.has(row.rem_project_id),
                      id = `project-checks-${encodeURIComponent(row.rem_project_id)}`;
                    const checklist = row.checklist,
                      ready = checklist?.ready ?? (!row.filling && !row.new_from_rem);
                    const missing = row.required_missing ?? checklist?.required?.filter(item => !item.passed).length ?? Object.values(row.gaps).flat().length;
                    const intakeHref = knowledgeHref(row);
                    const intakeCount = row.knowledge ? (
                      <>
                        {review.intake_reviewed} {row.knowledge.reviewed} · {review.intake_staged} {row.knowledge.staged}
                      </>
                    ) : null;
                    const coverAsset = row.cover_image ?? row.thumbnail;
                    const saleLabel = row.source_review
                      ? `${row.source_review.status_label || "ไม่ทราบสถานะ"} (${row.source_review.status_raw ?? "null"})`
                      : status(row);
                    const unitCount = row.unit_type_count ?? row.confirmed_models;

                    return (
                      <article className="km-card km-visual-card km-project-card project-summary-row" key={row.rem_project_id}>
                        <KmCoverPlate
                          mode="photo"
                          name={row.name}
                          image={coverAsset}
                          brandLogo={row.brand_logo}
                          missingLabel={!coverAsset ? "ยังไม่มีรูปหลัก" : null}
                          topLeft={<span className="km-overlay-chip">{saleLabel}</span>}
                          topRight={
                            <span className={`km-status-badge ${ready ? "is-ready" : "is-warning"}`}>
                              {ready ? "เผยแพร่ได้ ✓" : `ขาดข้อบังคับ ${missing}`}
                            </span>
                          }
                        />
                        <div className="km-visual-body">
                          <div>
                            <div className="km-card-top">
                              <div>
                                <div className="km-meta-row" style={{ marginBottom: "4px" }}>
                                  <span className="km-stat-chip">{row.brand_name || "ยังไม่ระบุแบรนด์"}</span>
                                  <span className="km-code-badge">REM: {row.rem_project_id}</span>
                                </div>
                                <h3>
                                  {row.public_project_id ? <a href={projectHref(row.public_project_id, href)}>{row.name}</a> : <strong>{row.name}</strong>}
                                </h3>
                              </div>
                            </div>
                            <ProjectGroupSummary value={row} />
                          </div>

                          <div className="km-stat-chips" aria-label="ข้อมูลสำคัญโครงการ">
                            {row.starting_price_text && (
                              <span className="km-stat-chip">
                                เริ่ม <strong>{row.starting_price_text}</strong>
                              </span>
                            )}
                            <span className="km-stat-chip">
                              แบบบ้าน <strong>{unitCount}/{row.total_models}</strong>
                            </span>
                            {canKnowledge && (
                              <span className="km-stat-chip">
                                FAQ <strong>{row.faq_count ?? 0}</strong>
                              </span>
                            )}
                            {row.promotion_count != null && row.promotion_count > 0 && (
                              <span className="km-stat-chip">
                                โปรโมชัน <strong>{row.promotion_count}</strong>
                              </span>
                            )}
                          </div>

                          <div className="km-pillar-strip" aria-label="เสาหลักความพร้อมโครงการ">
                            <span className={`km-pillar-pill ${row.pillars?.km ? "is-done" : "is-missing"}`}>
                              {row.pillars?.km ? "✓" : "○"} KM
                            </span>
                            <span className={`km-pillar-pill ${row.pillars?.units ? "is-done" : "is-missing"}`}>
                              {row.pillars?.units ? "✓" : "○"} แบบบ้าน
                            </span>
                            <span className={`km-pillar-pill ${row.pillars?.media ? "is-done" : "is-missing"}`}>
                              {row.pillars?.media ? "✓" : "○"} รูปภาพ
                            </span>
                            <span className={`km-pillar-pill ${row.pillars?.faq ? "is-done" : "is-missing"}`}>
                              {row.pillars?.faq ? "✓" : "○"} FAQ
                            </span>
                          </div>

                          <div>
                            <CompletenessBar passed={checklist?.passed ?? 0} total={checklist?.total ?? 0} />
                            <div className="km-meta-row" style={{ marginTop: "6px" }}>
                              <span>สถานะ: {status(row)}</span>
                              <span>อัปเดต: {date(row.updated_at)}</span>
                              {canKnowledge && intakeCount && (
                                <span>{intakeHref ? <a href={intakeHref}>{intakeCount}</a> : intakeCount}</span>
                              )}
                            </div>
                          </div>

                          <div className="km-card-actions">
                            {row.public_project_id ? (
                              <>
                                <a
                                  className="button primary project-row-action"
                                  href={projectHref(row.public_project_id, href)}
                                >
                                  {canEdit ? "แก้ไข KM โครงการ" : permissions.can("projects", "approve") ? "เปิดตรวจโครงการ" : "ดูโครงการ"}
                                </a>
                                <Link
                                  prefetch={false}
                                  className="button secondary"
                                  href={workspaceHref({ level: "project", id: row.public_project_id, phase: row.rem_project_id, tab: "unit-types" })}
                                >
                                  แบบบ้าน
                                </Link>
                                <Link
                                  prefetch={false}
                                  className="button secondary"
                                  href={workspaceHref({ level: "project", id: row.public_project_id, phase: row.rem_project_id, tab: "media" })}
                                >
                                  รูปภาพ
                                </Link>
                                {canKnowledge && (
                                  <Link
                                    prefetch={false}
                                    className="button secondary"
                                    href={workspaceHref({ level: "project", id: row.public_project_id, phase: row.rem_project_id, tab: "faq" })}
                                  >
                                    FAQ
                                  </Link>
                                )}
                              </>
                            ) : (
                              <button className="button primary project-row-action" onClick={() => onStart(row.rem_project_id)}>
                                {canEdit ? "เริ่มกรอก" : "ดูต้นทาง"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="button secondary"
                              aria-label={`รายการตรวจ ${row.name}`}
                              aria-expanded={open}
                              aria-controls={id}
                              onClick={() => void toggleRow(row)}
                            >
                              {open ? "ซ่อนรายการตรวจ" : "รายการตรวจ"}
                            </button>
                          </div>

                          {open && (
                            <div className="km-card-drawer project-detail-row" id={id}>
                              <PhaseReviewLinks row={row} canProject={permissions.can("projects")} canKnowledge={canKnowledge} />
                              {details[row.rem_project_id] ? (
                                <Checks row={details[row.rem_project_id]} returnTo={href} onStart={onStart} knowledgeTarget={intakeHref} />
                              ) : (
                                <p role={detailErrors[row.rem_project_id] ? "alert" : "status"}>
                                  {detailErrors[row.rem_project_id] || "กำลังโหลดรายการตรวจ…"}
                                </p>
                              )}
                              <p className="small-text">
                                แบบบ้านยืนยัน {row.confirmed_models}/{row.total_models} · สิ่งอำนวยความสะดวก{" "}
                                {row.amenities ? `${row.amenities.collected}/${row.amenities.total}` : "ยังไม่เริ่ม"}
                              </p>
                              <ProjectSourceReview value={row.source_review} />
                              {row.attention.length > 0 && row.public_project_id && (
                                <ul>
                                  {row.attention.map((item, index) => (
                                    <li key={index}>
                                      <a href={projectHref(row.public_project_id!, href, item.field)}>{item.message}</a>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <p className="small-text muted">
                                {row.age_days == null
                                  ? "ไม่ทราบวันนำเข้า"
                                  : `${row.age_basis === "first_import" ? "นำเข้าครั้งแรก" : row.age_basis === "mirror_import" ? "ใช้เวลานำเข้าสำเนาครั้งแรก" : "พบใน REM ครั้งแรก"} · ${date(row.first_seen_at)} · ${row.age_days} วัน`}
                              </p>
                              <ProjectGroupSummary value={row} details />
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <>
                  <p className="field-help project-progress-scroll-help">หัวตารางและชื่อโครงการตรึงไว้ · กดลูกศรเพื่อดูรายการตรวจ</p>
                  <div
                    className="brand-table-scroll brand-dashboard-table-scroll project-progress-scroll"
                    ref={table}
                    role="region"
                    tabIndex={0}
                    aria-label="ตารางความคืบหน้าโครงการ"
                  >
                    <table className="brand-completeness-table project-progress-table">
                      <caption className="sr-only">ความพร้อมเผยแพร่และความครบถ้วนของแต่ละโครงการ</caption>
                      <colgroup>
                        {Array.from({ length: 7 }, (_, index) => (
                          <col key={index} />
                        ))}
                      </colgroup>
                      <thead>
                        <tr>
                          {["โครงการ", "ความพร้อมเผยแพร่", "ความครบถ้วน", "รอใคร", "ปรับปรุงล่าสุด", "อนุมัติโดย / แหล่งข้อมูล", review.intake].map(label => (
                            <th scope="col" key={label}>
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(row => {
                          const open = expanded.has(row.rem_project_id),
                            id = `project-checks-${encodeURIComponent(row.rem_project_id)}`;
                          const checklist = row.checklist,
                            ready = checklist?.ready ?? (!row.filling && !row.new_from_rem);
                          const missing = row.required_missing ?? checklist?.required?.filter(item => !item.passed).length ?? Object.values(row.gaps).flat().length;
                          const intakeHref = knowledgeHref(row);
                          const intakeCount = row.knowledge ? (
                            <>
                              {review.intake_reviewed} {row.knowledge.reviewed} · {review.intake_staged} {row.knowledge.staged}
                            </>
                          ) : (
                            review.counts_missing
                          );
                          return (
                            <Fragment key={row.rem_project_id}>
                              <tr className="brand-table-row project-summary-row">
                                <td data-label="โครงการ">
                                  <div className="project-row-identity">
                                    <button className="project-expand" aria-label={`รายการตรวจ ${row.name}`} aria-expanded={open} aria-controls={id} onClick={() => void toggleRow(row)}>
                                      {open ? "▾" : "▸"}
                                    </button>
                                    <EntityThumbnail name={row.name} image={row.thumbnail} fallback={row.brand_logo} brandKey={row.rem_brand_id} />
                                    <div>
                                      {row.public_project_id ? <a href={projectHref(row.public_project_id, href)}>{row.name}</a> : <strong>{row.name}</strong>}
                                      <p className="source-code">
                                        {review.phase_id} <code>{JSON.stringify(row.rem_project_id)}</code> · {row.brand_name || "ยังไม่ระบุแบรนด์"}
                                      </p>
                                      <p className="source-code">
                                        {row.public_project_id ? (
                                          <>
                                            {review.hub_project} <code>{row.public_project_id}</code>
                                          </>
                                        ) : (
                                          review.hub_unmapped
                                        )}
                                      </p>
                                      <p className="small-text">
                                        {row.source_review?.status_label || "ไม่ทราบสถานะ"} ({row.source_review?.status_raw ?? "null"})
                                      </p>
                                      <ProjectGroupSummary value={row} />
                                      {row.public_project_id ? (
                                        <a className="project-row-action" href={projectHref(row.public_project_id, href)}>
                                          {canEdit ? "เปิดแก้ไข" : permissions.can("projects", "approve") ? "เปิดตรวจโครงการ" : "ดูโครงการ"}
                                        </a>
                                      ) : (
                                        <button className="button text-button project-row-action" onClick={() => onStart(row.rem_project_id)}>
                                          {canEdit ? "เริ่มกรอก" : "ดูต้นทาง"}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td data-label="ความพร้อมเผยแพร่">
                                  <strong className={`project-ready-badge ${ready ? "ready" : ""}`}>{ready ? "เผยแพร่ได้ ✓" : `ขาดข้อบังคับ ${missing}`}</strong>
                                  <p className="small-text">{status(row)}</p>
                                </td>
                                <td data-label="ความครบถ้วน">
                                  <CompletenessBar passed={checklist?.passed ?? 0} total={checklist?.total ?? 0} />
                                </td>
                                <td data-label="รอใคร">{row.waiting_on.map(role => (role === "editor" ? "ผู้แก้ไข" : "ผู้เผยแพร่")).join(" / ") || "—"}</td>
                                <td data-label="ปรับปรุงล่าสุด">{date(row.updated_at)}</td>
                                <td data-label="อนุมัติโดย / แหล่งข้อมูล">{row.website_sources?.length ? <PublicWebsiteSource sources={row.website_sources} /> : "—"}</td>
                                <td data-label={review.intake}>{canKnowledge ? intakeHref ? <a href={intakeHref}>{intakeCount}</a> : intakeCount : "—"}</td>
                              </tr>
                              {open && (
                                <tr className="project-detail-row" id={id}>
                                  <td colSpan={7}>
                                    <PhaseReviewLinks row={row} canProject={permissions.can("projects")} canKnowledge={canKnowledge} />
                                    {details[row.rem_project_id] ? (
                                      <Checks row={details[row.rem_project_id]} returnTo={href} onStart={onStart} knowledgeTarget={intakeHref} />
                                    ) : (
                                      <p role={detailErrors[row.rem_project_id] ? "alert" : "status"}>{detailErrors[row.rem_project_id] || "กำลังโหลดรายการตรวจ…"}</p>
                                    )}
                                    <p>
                                      แบบบ้านยืนยัน {row.confirmed_models}/{row.total_models} · สิ่งอำนวยความสะดวก{" "}
                                      {row.amenities ? `${row.amenities.collected}/${row.amenities.total}` : "ยังไม่เริ่ม"}
                                    </p>
                                    <ProjectSourceReview value={row.source_review} />
                                    {row.attention.length > 0 && (
                                      <ul>
                                        {row.attention.map((item, index) => (
                                          <li key={index}>
                                            <a href={projectHref(row.public_project_id!, href, item.field)}>{item.message}</a>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                    <p className="small-text muted">
                                      {row.age_days == null
                                        ? "ไม่ทราบวันนำเข้า"
                                        : `${row.age_basis === "first_import" ? "นำเข้าครั้งแรก" : row.age_basis === "mirror_import" ? "ใช้เวลานำเข้าสำเนาครั้งแรก" : "พบใน REM ครั้งแรก"} · ${date(row.first_seen_at)} · ${row.age_days} วัน`}
                                    </p>
                                    <ProjectGroupSummary value={row} details />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {pagination("bottom")}
              {!rows.length && (
                <div className="empty-state compact">
                  <p>ไม่มีโครงการตรงกับตัวกรอง</p>
                  {!includeOther && Boolean(facets?.status_total) && (
                    <>
                      <p>อาจมีโครงการที่ปิด ถูกลบ หรือยังไม่ทราบสถานะต้นทาง</p>
                      <button className="button secondary" onClick={() => filterBy({ pother: "1" })}>
                        รวมโครงการสถานะอื่น
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
