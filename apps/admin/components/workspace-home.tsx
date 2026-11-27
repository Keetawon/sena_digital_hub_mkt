"use client";
import { ContentBuNotices } from "./content-bu-notices";
import { EventChangeBanner } from "./event-change-banner";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { canWorkspace, capabilityKey } from "@/lib/hub-permissions";
import { roleLabels, type LocalRole } from "@/lib/roles";
import { workspaceCopy as copy } from "@/lib/workspace-copy";
import { LocalPersonaPicker, useHubPermissions } from "./accounts";
import { HubShell } from "./hub-shell";
import { useHostedSession } from "./hosted-session";
import { openWorkspaceAssistant } from "./hub-assistant";
import { WorkspaceSearch, workspaceLabel } from "./workspace-search";
import { FaqCoverage } from "./faq-coverage";
import { AssetImage } from "./private-assets";
import type { Thumbnail } from "./entity-thumbnail";
import { workspaceText, workspaceHref, workspaceQuestionLabel, type WorkspaceTarget } from "@/lib/unified-workspace";
import { request } from "./hub-request";
import "./workspace-home.css";

type Label = { th?: string; en?: string };
type Task = {
  id: string;
  category: keyof typeof taskLabels;
  label: Label;
  project?: string;
  project_name?: Label;
  href: string;
  due?: string;
  overdue?: boolean;
  question_text_available?: boolean;
  occurrences?: number;
  last_seen?: string;
  context: { project?: string; brand?: string };
};
type Readiness = {
  required_missing: number;
  items?: { field_key: string; label: Label; complete: boolean; required: boolean; href: string }[];
};
type HomeProject = {
  ref: string;
  name: Label;
  rem_project_id?: string | null;
  published?: boolean;
  cover_image?: Thumbnail | null;
  brand_logo?: Thumbnail | null;
  unit_type_count?: number | null;
  faq_count?: number | null;
  promotion_count?: number | null;
  brand?: { ref: string; name: Label } | null;
  bud?: { id: string; code: string | null; name: string | null } | null;
  href: string;
  readiness: Readiness;
};
type TaskCounts = {
  all?: number;
  returned?: number;
  approval?: number;
  publish?: number;
  expiring?: number;
  review_due?: number;
  fact_missing?: number;
  unanswered?: number;
};
type ScopeSummary = {
  unrestricted_projects?: boolean;
  visible_projects?: number;
  missing_projects?: number;
};
type Home = {
  projects: HomeProject[];
  project_total: number;
  brands: { ref: string; name: Label; projects: number; required_missing: number; project_required_missing: number; readiness: Readiness }[];
  buds: { id: string; code: string | null; name: string | null; projects: number; required_missing: number }[];
  tasks: Task[];
  task_total: number;
  task_counts?: TaskCounts;
  scope_summary?: ScopeSummary;
  selected_gap: Task | null;
  offset: number;
  limit: number;
};

const taskLabels = {
  returned: copy.returned_task,
  approval: copy.approval_task,
  publish: copy.publish_task,
  expiring: copy.expiring_task,
  fact_missing: copy.missing_fact_task,
  review_due: copy.review_task,
  unanswered: copy.unanswered_task,
};
const taskTone: Record<keyof typeof taskLabels, "danger" | "action" | "warning" | "info"> = {
  returned: "danger",
  approval: "action",
  publish: "action",
  expiring: "warning",
  review_due: "warning",
  fact_missing: "info",
  unanswered: "info",
};
const taskLabel = (task: Task) =>
  task.category === "fact_missing" ? workspaceQuestionLabel(workspaceLabel(task.label), task.project_name) : workspaceLabel(task.label);
const date = (value: string) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(value));

function ProjectCardCover({ project }: { project: HomeProject }) {
  const [failed, setFailed] = useState<string[]>([]);
  const title = workspaceLabel(project.name);
  const cover = project.cover_image && !failed.includes(project.cover_image.id) ? project.cover_image : null;
  const logo = !cover && project.brand_logo && !failed.includes(project.brand_logo.id) ? project.brand_logo : null;
  const initials = Array.from(title.trim()).slice(0, 2).join("") || "SN";

  return (
    <div className={`workspace-project-cover ${cover ? "has-photo" : logo ? "has-logo" : "is-fallback"}`}>
      {cover ? (
        <AssetImage
          key={cover.id}
          asset={cover}
          alt={title}
          width={320}
          height={180}
          onError={() => setFailed(prev => (prev.includes(cover.id) ? prev : [...prev, cover.id]))}
        />
      ) : logo ? (
        <div className="workspace-project-logo-plate">
          <AssetImage
            key={logo.id}
            asset={logo}
            alt={title}
            width={140}
            height={72}
            onError={() => setFailed(prev => (prev.includes(logo.id) ? prev : [...prev, logo.id]))}
          />
        </div>
      ) : (
        <span className="workspace-project-monogram" aria-hidden="true">{initials}</span>
      )}
      <div className="workspace-project-badges">
        <span className={`workspace-status-pill ${project.published ? "is-published" : "is-draft"}`}>
          {project.published ? "เผยแพร่แล้ว" : "กำลังเตรียมข้อมูล"}
        </span>
        <span className={`workspace-status-pill ${project.readiness.required_missing === 0 ? "is-ready" : "is-missing"}`}>
          {project.readiness.required_missing === 0 ? "ข้อมูลบังคับครบ" : `ขาดข้อมูลบังคับ ${project.readiness.required_missing}`}
        </span>
      </div>
    </div>
  );
}

function HomeContent({ hosted }: { hosted: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const permissions = useHubPermissions();
  const canCoverage = permissions.can("knowledge") && permissions.can("projects");
  const canKnowledge = permissions.can("knowledge");
  const canPromotions = permissions.can("promotions") && permissions.can("projects");
  const coverage = params.get("section") === "coverage";
  const [coverageError, setCoverageError] = useState(false);
  async function openFaq(id: string) {
    setCoverageError(false);
    try {
      router.push(workspaceHref(await request<WorkspaceTarget>(`v1/admin/content/workspace/resolve?faq=${encodeURIComponent(id)}`)));
    } catch {
      setCoverageError(true);
    }
  }
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const filters = new URLSearchParams();
  for (const key of ["bud", "brand", "task", "offset", "gap"]) {
    const value = params.get(key);
    if (value) filters.set(key, value);
  }
  const query = filters.toString();
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(false);
    (async () => {
      try {
        const response = await fetch(`/api/hub/v1/admin/content/home?${query}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok && body.error?.invalidate_access === true && !controller.signal.aborted) window.dispatchEvent(new Event("hub-content-access-invalidated"));
        if (!response.ok) throw new Error();
        if (!controller.signal.aborted) setData(body.data);
      } catch { if (!controller.signal.aborted) setError(true); }
    })();
    return () => controller.abort();
  }, [query, retry]);
  useEffect(() => {
    if (data?.selected_gap) document.getElementById(`selected-${data.selected_gap.id}`)?.focus();
  }, [data, params]);
  const link = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    next.delete("offset");
    next.delete("gap");
    if (value) next.set(key, value);
    else next.delete(key);
    return `/home${next.size ? `?${next}` : ""}`;
  };
  const pageLink = (offset: number) => {
    const next = new URLSearchParams(query);
    next.set("offset", String(offset));
    return `/home?${next}`;
  };

  const activeTask = params.get("task") ?? "";
  const hasActiveFilter = Boolean(params.get("bud") || params.get("brand") || activeTask);
  const countBy = (cat: keyof typeof taskLabels) =>
    data?.task_counts?.[cat] ?? (data?.tasks.filter(t => t.category === cat).length ?? 0);
  const returnedCount = countBy("returned");
  const reviewPublishCount = countBy("approval") + countBy("publish");
  const expiryReviewCount = countBy("expiring") + countBy("review_due");
  const knowledgeGapCount = countBy("fact_missing") + countBy("unanswered");
  const missingProjectsCount =
    data?.scope_summary?.missing_projects ?? (data?.projects.filter(p => p.readiness.required_missing > 0).length ?? 0);
  const visibleProjectsCount = data?.scope_summary?.visible_projects ?? data?.project_total ?? 0;
  const unrestrictedScope = data?.scope_summary?.unrestricted_projects !== false;

  return (
    <div className="workspace-home">
      <EventChangeBanner />
      <section className="workspace-home-hero">
        <div className="workspace-home-hero-top">
          <div>
            <p className="workspace-home-eyebrow">แดชบอร์ดงานของฉัน · SENA Digital Hub</p>
            <h1>{copy.greeting}</h1>
            <p className="workspace-home-subtitle">
              ตรวจงานค้าง แก้รายการถูกตีกลับ และจัดการ KM · แบบบ้าน · รูปภาพ · FAQ เฉพาะขอบเขตที่คุณดูแลได้ในหน้าเดียว
            </p>
          </div>
          {data && (
            <div className="workspace-scope-pill" role="status">
              <span className="workspace-scope-dot" aria-hidden="true" />
              <span>
                {unrestrictedScope
                  ? `ขอบเขตสิทธิ์: ดูแลทุกโครงการ (${visibleProjectsCount} โครงการ)`
                  : `ขอบเขตสิทธิ์เฉพาะคุณ: ${visibleProjectsCount} โครงการที่ได้รับมอบหมาย`}
              </span>
            </div>
          )}
        </div>
        <WorkspaceSearch hosted={hosted} home />
        {data && data.tasks.length > 0 && (
          <div className="workspace-home-examples">
            {data.tasks.slice(0, 3).map(task => (
              <button
                className="button secondary"
                type="button"
                key={task.id}
                disabled={hosted}
                title={hosted ? copy.assistant_disabled : undefined}
                onClick={event =>
                  openWorkspaceAssistant(
                    `${copy.task_question}: ${taskLabel(task)}`,
                    task.context.project ? { project_id: task.context.project } : task.context.brand ? { brand_id: task.context.brand } : {},
                    event.currentTarget
                  )
                }
              >
                {copy.ask_prefix}
                {taskLabel(task)}
              </button>
            ))}
          </div>
        )}
      </section>

      {(canCoverage || coverage) && (
        <section className={coverage ? "workspace-home-card workspace-coverage-banner" : "workspace-coverage-banner"} aria-label={workspaceText.coverage}>
          <div className="workspace-coverage-row">
            <div>
              <strong>ตรวจสอบความครอบคลุมคลังคำถาม (FAQ Matrix)</strong>
              <p className="workspace-home-meta">ดูภาพรวมคำถามมาตรฐานและช่องว่างข้อมูลรายโครงการและแบบบ้าน</p>
            </div>
            {canCoverage && (
              <a className="button secondary" href={coverage ? "/home" : "/home?section=coverage"}>
                {coverage ? "ซ่อนตารางความครอบคลุม" : workspaceText.coverage}
              </a>
            )}
          </div>
          {coverageError && <p role="alert">{copy.load_error}</p>}
          {coverage && <FaqCoverage onOpenFaq={id => void openFaq(id)} />}
        </section>
      )}

      <ContentBuNotices quiet />

      {error ? (
        <p role="alert">
          {copy.load_error}{" "}
          <button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>
            {copy.retry}
          </button>
        </p>
      ) : !data ? (
        <p role="status">{copy.loading}</p>
      ) : (
        <>
          <section className="workspace-home-kpis" aria-label="สรุปงานค้างแยกตามความเร่งด่วน">
            <Link
              prefetch={false}
              href={link("task", activeTask === "returned" ? "" : "returned")}
              className={`workspace-kpi-card tone-danger ${activeTask === "returned" ? "is-active" : ""}`}
            >
              <span className="workspace-kpi-label">งานถูกตีกลับต้องแก้</span>
              <strong className="workspace-kpi-value">{returnedCount}</strong>
              <span className="workspace-kpi-foot">คลิกกรองรายการที่ต้องแก้ไขใหม่</span>
            </Link>
            <Link
              prefetch={false}
              href={
                countBy("approval") >= countBy("publish")
                  ? link("task", activeTask === "approval" ? "" : "approval")
                  : link("task", activeTask === "publish" ? "" : "publish")
              }
              className={`workspace-kpi-card tone-action ${activeTask === "approval" || activeTask === "publish" ? "is-active" : ""}`}
            >
              <span className="workspace-kpi-label">รออนุมัติ / รอเผยแพร่</span>
              <strong className="workspace-kpi-value">{reviewPublishCount}</strong>
              <span className="workspace-kpi-foot">รออนุมัติ {countBy("approval")} · รอเผยแพร่ {countBy("publish")}</span>
            </Link>
            <Link
              prefetch={false}
              href={
                countBy("expiring") >= countBy("review_due")
                  ? link("task", activeTask === "expiring" ? "" : "expiring")
                  : link("task", activeTask === "review_due" ? "" : "review_due")
              }
              className={`workspace-kpi-card tone-warning ${activeTask === "expiring" || activeTask === "review_due" ? "is-active" : ""}`}
            >
              <span className="workspace-kpi-label">ใกล้หมดอายุ / รอบทบทวน</span>
              <strong className="workspace-kpi-value">{expiryReviewCount}</strong>
              <span className="workspace-kpi-foot">ใกล้หมดอายุ {countBy("expiring")} · ทบทวน {countBy("review_due")}</span>
            </Link>
            <Link
              prefetch={false}
              href={
                countBy("fact_missing") >= countBy("unanswered")
                  ? link("task", activeTask === "fact_missing" ? "" : "fact_missing")
                  : link("task", activeTask === "unanswered" ? "" : "unanswered")
              }
              className={`workspace-kpi-card tone-info ${activeTask === "fact_missing" || activeTask === "unanswered" ? "is-active" : ""}`}
            >
              <span className="workspace-kpi-label">FAQ ขาดข้อมูล / AI ตอบไม่ได้</span>
              <strong className="workspace-kpi-value">{knowledgeGapCount}</strong>
              <span className="workspace-kpi-foot">ขาดข้อเท็จจริง {countBy("fact_missing")} · คำถามใหม่ {countBy("unanswered")}</span>
            </Link>
            <a href="#workspace-projects" className="workspace-kpi-card tone-neutral">
              <span className="workspace-kpi-label">โครงการยังขาดข้อมูลบังคับ</span>
              <strong className="workspace-kpi-value">{missingProjectsCount}</strong>
              <span className="workspace-kpi-foot">จากทั้งหมด {visibleProjectsCount} โครงการในขอบเขต</span>
            </a>
          </section>

          {data.selected_gap && (
            <section
              className="workspace-home-card workspace-home-gap"
              id={`selected-${data.selected_gap.id}`}
              tabIndex={-1}
              aria-label={copy.unanswered_task}
            >
              <h2>{copy.unanswered_task}</h2>
              <h3>{workspaceLabel(data.selected_gap.label)}</h3>
              <p>{copy.unanswered_note}</p>
              {data.selected_gap.last_seen && (
                <p className="workspace-home-meta">
                  {copy.date}: {date(data.selected_gap.last_seen)}
                </p>
              )}
              {data.selected_gap.context.project && (
                <a href={`/?project=${encodeURIComponent(data.selected_gap.context.project)}`}>{copy.project}</a>
              )}
            </section>
          )}

          <div className="workspace-home-filters">
            <label>
              BUD
              <select value={params.get("bud") ?? ""} onChange={event => router.push(link("bud", event.target.value))}>
                <option value="">{copy.all}</option>
                {data.buds.map(bud => (
                  <option key={bud.id} value={bud.id}>
                    {[bud.code, bud.name].filter(Boolean).join(" · ") || bud.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.brand}
              <select value={params.get("brand") ?? ""} onChange={event => router.push(link("brand", event.target.value))}>
                <option value="">{copy.all}</option>
                {data.brands.map(brand => (
                  <option key={brand.ref} value={brand.ref}>
                    {workspaceLabel(brand.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.tasks}
              <select value={activeTask} onChange={event => router.push(link("task", event.target.value))}>
                <option value="">{copy.all}</option>
                {Object.entries(taskLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {hasActiveFilter && (
              <Link prefetch={false} className="button secondary workspace-filter-reset" href="/home">
                ล้างตัวกรองทั้งหมด
              </Link>
            )}
          </div>

          <section className="workspace-home-card workspace-task-inbox" aria-labelledby="workspace-tasks">
            <div className="workspace-section-head">
              <div>
                <h2 id="workspace-tasks">
                  {copy.tasks} <small>({data.task_total})</small>
                </h2>
                <p className="content-state workspace-home-meta">{workspaceText.home_tasks_hint}</p>
              </div>
              <div className="workspace-quick-nav">
                <Link prefetch={false} className="button secondary" href="/website?view=businesses">
                  KM องค์กร
                </Link>
                <Link prefetch={false} className="button secondary" href="/website?view=brands">
                  KM แบรนด์
                </Link>
                <Link prefetch={false} className="button secondary" href="/website?view=projects">
                  KM โครงการ
                </Link>
              </div>
            </div>
            {!data.tasks.length ? (
              <div className="workspace-empty-inbox">
                <strong>{hasActiveFilter ? copy.empty : copy.tasks_empty}</strong>
                <p className="workspace-home-meta">
                  {hasActiveFilter
                    ? "ลองเปลี่ยนตัวกรอง BUD แบรนด์ หรือประเภทงานเพื่อดูรายการอื่น"
                    : "ไม่มีงานค้างเร่งด่วนในขณะนี้ คุณสามารถเลือกตรวจความครบถ้วนรายโครงการด้านล่างได้ทันที"}
                </p>
              </div>
            ) : (
              <ul className="workspace-task-list">
                {data.tasks.map(task => (
                  <li
                    key={task.id}
                    id={task.id}
                    className={`workspace-task-row workspace-home-gap tone-${taskTone[task.category]}`}
                    tabIndex={task.question_text_available === false ? -1 : undefined}
                  >
                    <div className="workspace-task-main">
                      <div className="workspace-task-badges">
                        <span className={`workspace-task-badge tone-${taskTone[task.category]}`}>
                          {taskLabels[task.category]}
                        </span>
                        {task.project_name && <span className="workspace-task-project">{workspaceLabel(task.project_name)}</span>}
                        {task.due && (
                          <span className={`workspace-task-due ${task.overdue ? "is-overdue" : ""}`}>
                            {copy.date}: {date(task.due)}
                          </span>
                        )}
                      </div>
                      <Link prefetch={false} className="workspace-task-title" href={task.href}>
                        {taskLabel(task)}
                      </Link>
                      {task.question_text_available === false && (
                        <p className="workspace-home-meta">
                          {copy.unanswered_note}
                          {task.last_seen && ` · ${date(task.last_seen)}`}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="workspace-projects">
            <div className="workspace-section-head">
              <div>
                <h2 id="workspace-projects">
                  {copy.project}ในขอบเขตดูแล <small>({data.project_total})</small>
                </h2>
                <p className="workspace-home-meta">คลิกเข้าแก้ไข KM แบบบ้าน รูปภาพ หรือคลังคำถามของแต่ละโครงการได้โดยตรง</p>
              </div>
              <Link prefetch={false} className="button secondary" href="/website?view=projects">
                ดูโครงการทั้งหมด
              </Link>
            </div>
            <div className="workspace-project-grid">
              {data.projects.map(project => {
                const missingItems = (project.readiness.items ?? []).filter(field => !field.complete);
                return (
                  <article className="workspace-home-card workspace-project-card" key={project.ref}>
                    <ProjectCardCover project={project} />
                    <div className="workspace-project-body">
                      <div className="workspace-project-meta-top">
                        {project.brand && <span className="workspace-chip">{workspaceLabel(project.brand.name)}</span>}
                        {project.bud && (
                          <span className="workspace-chip">{[project.bud.code, project.bud.name].filter(Boolean).join(" · ") || project.bud.id}</span>
                        )}
                        {project.rem_project_id && <span className="workspace-code-chip">{project.rem_project_id}</span>}
                      </div>
                      <h3>
                        <Link prefetch={false} href={project.href}>
                          {workspaceLabel(project.name)}
                        </Link>
                      </h3>
                      {(project.unit_type_count != null || project.faq_count != null || project.promotion_count != null) && (
                        <p className="workspace-project-stats">
                          <span>แบบบ้าน {project.unit_type_count ?? 0}</span>
                          <span>FAQ {project.faq_count ?? 0}</span>
                          <span>โปรโมชัน {project.promotion_count ?? 0}</span>
                        </p>
                      )}
                      <div className="workspace-project-actions">
                        <Link prefetch={false} className="button primary" href={workspaceHref({ level: "project", id: project.ref, tab: "data" })}>
                          แก้ไข KM
                        </Link>
                        <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project", id: project.ref, tab: "unit-types" })}>
                          แบบบ้าน
                        </Link>
                        {canKnowledge && (
                          <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project", id: project.ref, tab: "faq" })}>
                            FAQ
                          </Link>
                        )}
                        {canPromotions && (
                          <Link prefetch={false} className="button secondary" href={workspaceHref({ level: "project", id: project.ref, tab: "promotions" })}>
                            โปรโมชัน
                          </Link>
                        )}
                      </div>
                      <details className="workspace-project-missing">
                        <summary>
                          {copy.readiness} · {copy.required_missing}: {project.readiness.required_missing}
                        </summary>
                        {missingItems.length > 0 ? (
                          <ul>
                            {missingItems.map((field, index) => (
                              <li key={`${field.field_key}:${index}`}>
                                <Link prefetch={false} href={field.href}>
                                  {workspaceLabel(field.label)}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="workspace-home-meta">ข้อมูลบังคับครบถ้วนพร้อมเผยแพร่</p>
                        )}
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="workspace-readiness">
            <h2 id="workspace-readiness">{copy.readiness}แยกตามสายงานและแบรนด์</h2>
            <div className="workspace-home-grid">
              <section className="workspace-home-card">
                <h3>BUD สายงานธุรกิจ</h3>
                {!data.buds.length ? (
                  <p>{params.get("bud") || params.get("brand") ? copy.empty : copy.home_buds_empty}</p>
                ) : (
                  <ul>
                    {data.buds.map(bud => (
                      <li className="workspace-home-group" key={bud.id}>
                        <Link prefetch={false} href={link("bud", bud.id)}>
                          {[bud.code, bud.name].filter(Boolean).join(" · ") || bud.id}
                        </Link>
                        <span>
                          {bud.projects} โครงการ · {copy.required_missing}: {bud.required_missing}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="workspace-home-card">
                <h3>{copy.brand}</h3>
                {!data.brands.length ? (
                  <p>{params.get("bud") || params.get("brand") ? copy.empty : copy.home_brands_empty}</p>
                ) : (
                  <ul>
                    {data.brands.map(brand => (
                      <li key={brand.ref}>
                        <div className="workspace-home-group">
                          <Link prefetch={false} href={link("brand", brand.ref)}>
                            {workspaceLabel(brand.name)}
                          </Link>
                          <span>
                            {brand.projects} โครงการ · {copy.required_missing}: {brand.required_missing}
                          </span>
                        </div>
                        {(brand.readiness.items ?? [])
                          .filter(field => !field.complete)
                          .map(field => (
                            <p key={field.field_key}>
                              <Link prefetch={false} href={field.href}>
                                {workspaceLabel(field.label)}
                              </Link>
                            </p>
                          ))}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </section>

          <nav className="workspace-home-pagination" aria-label={copy.home}>
            {data.offset > 0 && (
              <Link prefetch={false} className="button secondary" href={pageLink(Math.max(0, data.offset - data.limit))}>
                {copy.previous}
              </Link>
            )}
            {data.offset + data.limit < Math.max(data.project_total, data.task_total) && (
              <Link prefetch={false} className="button secondary" href={pageLink(data.offset + data.limit)}>
                {copy.next}
              </Link>
            )}
          </nav>
        </>
      )}
    </div>
  );
}

export function WorkspaceHome({ localMode, initialRole }: { localMode: boolean; initialRole: LocalRole | null }) {
  const permissions = useHubPermissions();
  const hosted = Boolean(useHostedSession());
  const allowed = permissions.account?.status === "ACTIVE" && canWorkspace(permissions.capabilities);
  return (
    <HubShell
      section="projects"
      workspace
      staff={allowed}
      roleLabel={permissions.account?.display_name_th || (initialRole ? roleLabels[initialRole] : copy.home)}
      toolbar={
        localMode && (
          <div className="workspace-home-persona">
            <LocalPersonaPicker initialRole={initialRole} />
          </div>
        )
      }
    >
      {allowed && <HomeContent key={capabilityKey(permissions.account)} hosted={hosted} />}
    </HubShell>
  );
}
