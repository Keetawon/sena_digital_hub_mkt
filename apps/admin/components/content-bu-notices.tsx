"use client";
import { useEffect, useRef, useState } from "react";
import { capabilityKey } from "@/lib/hub-permissions";
import { contentScopeText as text } from "@/lib/content-scope-text";
import { workspaceHref } from "@/lib/unified-workspace";
import { useHubPermissions } from "./accounts";
import "./content-bu-notices.css";

// Canonical copy is inserted from docs/47, never translated here.
export const buNoticeText = {"heading": "การแจ้งเตือน BUD", "empty": "ไม่มีการแจ้งเตือน BUD", "partial": "แสดงการแจ้งเตือน 100 รายการแรก"} as const;
const labels = {
  sync_missing: text.scope_sync_missing, sync_failed: text.scope_sync_failed,
  stale_data: text.scope_stale_data, stale_warning: text.scope_stale_warning,
  stale_expired: text.scope_stale_expired, handover: text.scope_handover,
} as const;
type NoticeKind = keyof typeof labels;
type Notice = {
  id: string; kind: NoticeKind; manager: boolean; href?: string | null;
  project_ref?: string | null; tab?: "overview" | "faq" | null;
  observed_at?: string | null; source_snapshot_at?: string | null; started_at?: string | null;
  deadline?: string | null; membership_deadline?: string | null; expired?: boolean;
};
type NoticePage = { items: Notice[]; has_more: boolean };
const dates = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
function NoticeDate({ label, value }: { label: string; value?: string | null }) {
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/i.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return <div><dt>{label}</dt><dd><time dateTime={value}>{dates.format(new Date(value))}</time></dd></div>;
}
function visibleNotice(value: Notice, manager: boolean, project?: string) {
  if (!value || typeof value.id !== "string" || !value.id || !Object.hasOwn(labels, value.kind)) return false;
  if ((value.manager === true || ["sync_missing", "sync_failed", "stale_data"].includes(value.kind)) && !manager) return false;
  if (project && value.project_ref != null && value.project_ref !== project) return false;
  return true;
}

/** Caller-only projection; never enters home task data or assistant context. */
export function ContentBuNotices({ project, quiet = false }: { project?: string; quiet?: boolean }) {
  const permissions = useHubPermissions(), role = permissions.account?.hub_role ?? permissions.account?.role ?? "";
  const authority = JSON.stringify([capabilityKey(permissions.account), permissions.account?.updated_at, role]);
  const enabled = permissions.ready && permissions.account?.status === "ACTIVE" && ["viewer", "editor", "publisher", "admin", "online_staff"].includes(role);
  const manager = permissions.admin;
  const [limit, setLimit] = useState(20), [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; page: NoticePage } | null>(null), [failure, setFailure] = useState<string | null>(null);
  const query = new URLSearchParams({ limit: String(limit) }); if (project) query.set("project", project);
  const path = `/api/hub/v1/admin/content/bu-notices?${query}`, key = JSON.stringify([path, authority, retry]);
  const active = useRef(key); active.current = key;
  const data = loaded?.key === key ? loaded.page : null, failed = failure === key;
  useEffect(() => {
    const controller = new AbortController(); setLoaded(null); setFailure(null);
    if (enabled) (async () => {
      try {
        const response = await fetch(path, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted || active.current !== key) return;
        if (body?.error?.invalidate_access === true) window.dispatchEvent(new Event("hub-content-access-invalidated"));
        if (!response.ok) throw new Error("notice_read_failed");
        const page = body?.data;
        if (!page || !Array.isArray(page.items) || page.items.length > limit || typeof page.has_more !== "boolean") throw new Error("invalid_notice_page");
        if (!controller.signal.aborted && active.current === key) setLoaded({ key, page });
      } catch { if (!controller.signal.aborted && active.current === key) setFailure(key); }
    })();
    return () => controller.abort();
  }, [path, key, enabled, limit]);
  if (!enabled) return null;
  const items = data?.items.filter(item => visibleNotice(item, manager, project)) ?? [];
  return <section className={`content-bu-notices${project ? " content-bu-project-notices" : " content-bu-home-notices"}`} aria-label={buNoticeText.heading} data-notice-project={project ?? ""}>
    <header><h2>{buNoticeText.heading}</h2><button type="button" className="button secondary" disabled={!data && !failed} onClick={() => setRetry(value => value + 1)}>{text.refresh}</button></header>
    {failed ? (quiet
      ? <p className="bu-notice-quiet" role="status">{text.load_error}<button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>
      : <p className="notice error" role="alert">{text.load_error}<button type="button" className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>)
      : !data ? <p role="status">{text.loading}</p> : <>
        {!items.length ? <p role="status">{buNoticeText.empty}</p> : <ul>{items.map(item => <li key={item.id} data-bu-notice={item.kind}>
          <strong>{item.kind === "handover" && item.expired === true ? text.scope_reason_handover_end : labels[item.kind]}</strong>
          <dl>
            <NoticeDate label={text.scope_handover_end} value={item.kind === "handover" ? item.deadline : null} />
            <NoticeDate label={text.scope_cutoff} value={item.kind === "handover" ? item.membership_deadline : item.deadline} />
            <NoticeDate label={text.scope_source_at} value={item.source_snapshot_at} />
            <NoticeDate label={text.scope_observed_at} value={item.observed_at} />
          </dl>
          <div className="bu-notice-actions">
            {!project && typeof item.project_ref === "string" && item.project_ref.length > 0 && item.project_ref.length <= 200 && (item.tab === "overview" || item.tab === "faq") && <a href={workspaceHref({ level: "project", id: item.project_ref, tab: item.tab })}>{text.project} · {item.project_ref}</a>}
            {manager && item.manager === true && item.href === "/admin/accounts" && <a href="/admin/accounts">{text.scope_temporary_grant}</a>}
          </div>
        </li>)}</ul>}
        {data.has_more && (limit < 100 ? <button type="button" className="button secondary" onClick={() => setLimit(value => Math.min(100, value + 20))}>{text.scope_load_more}</button> : <p role="status">{buNoticeText.partial}</p>)}
      </>}
  </section>;
}
