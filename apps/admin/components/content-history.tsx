"use client";
import { useEffect, useRef, useState } from "react";
import { useHubPermissions, ActorName } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { request } from "./hub-request";
import { errorMessage, useFieldCatalog, sectionLabel } from "./content-common";
import { dateTime } from "./content-operations-shared";
import { publicationChanges, publicationValue } from "./publication-comparison";
import { workspaceApi, workspaceHref, workspaceName, workspaceText as text, type WorkspaceLevel, type WorkspaceTarget } from "@/lib/unified-workspace";
export type ContentEvent = { audit_id: string; occurred_at: string; actor: { id: string; name: string } | null; action: string;
  entity: { kind: WorkspaceLevel; ref: string; name: { th?: string; en?: string } }; source_tab: string; section_key: string; reason: string | null;
  version: { id: string | null; number: number | null; state: string | null } | null; target: WorkspaceTarget; diff_available: boolean };
export type ContentEvents = { items: ContentEvent[]; next_cursor: string | null };
type EventDetail = ContentEvent & { before: Record<string, unknown> | null; after: Record<string, unknown> | null; changed_field_keys: string[] };
const actions: Record<string, string> = {needs_reapproval:text.needs_reapproval,"edit":"ข้อมูล","submit":"ส่งอนุมัติ","approve":"อนุมัติ","self_approve":"อนุมัติงานที่แก้เอง","return":"ส่งกลับ","publish":"เผยแพร่ขึ้นเว็บ","withdraw":"ถอนการเผยแพร่","rollback":"คืนค่าเวอร์ชัน"};
function EventDiff({ event }: { event: ContentEvent }) {
  const [open, setOpen] = useState(false), [detail, setDetail] = useState<EventDetail | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  const { catalog } = useFieldCatalog();
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const path = workspaceApi(event.entity.kind, event.entity.ref) + "/history/" + encodeURIComponent(event.audit_id);
  useEffect(() => {
    let live = true; setDetail(null); setError(""); if (!open) return;
    request<EventDetail>(path).then(value => { if (live) setDetail(value); }).catch(e => { if (live) setError(errorMessage(e)); });
    return () => { live = false; };
  }, [open, path, authority, retry]);
  const fields = detail ? publicationChanges(detail.after ?? {}, detail.before ?? {}).filter(field => detail.changed_field_keys.includes(field.key)) : [];
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>{text.before} / {text.after}</summary>
    {error && <p className="notice error" role="alert">{error}<button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>}
    {!detail && !error && <p role="status">{text.loading}</p>}
    {fields.map(field => <section key={field.key}><h4>{catalog?.items.find(item => item.field_key === field.key || item.field_key.endsWith("." + field.key))?.label.th ?? (field.label === field.key ? text.data : field.label)}</h4><div className="workspace-history-diff">
      <div><strong>{text.before}</strong><p className="content-preserve">{publicationValue(field.before, field.key)}</p></div>
      <div><strong>{text.after}</strong><p className="content-preserve">{publicationValue(field.after, field.key)}</p></div>
    </div></section>)}
  </details>;
}
export function ContentTimeline({ items, compact = false }: { items: ContentEvent[]; compact?: boolean }) {
  return <ol className={compact ? "workspace-timeline workspace-timeline-compact" : "workspace-timeline"}>{items.map(event => <li key={event.audit_id} id={`content-event-${event.audit_id}`} tabIndex={-1}>
    <strong>{actions[event.action] ?? text.history} · {sectionLabel(event.section_key)}</strong>
    <p><time dateTime={event.occurred_at}>{dateTime(event.occurred_at)}</time> · {event.actor?.name ?? <ActorName id={event.actor?.id} />}{compact && event.version?.number != null && <> · {text.version} {event.version.number}</>}</p>
    <a href={workspaceHref(event.target)}>{workspaceName(event.entity.name)}</a>
    {event.reason && <p className="content-preserve">{event.reason}</p>}
    {!compact && event.version && (event.version.number != null || event.version.state) && <p>{[event.version.number == null ? null : `${text.version} ${event.version.number}`, event.version.state ? text[event.version.state.toUpperCase() as keyof typeof text] ?? text.history : null].filter(value => value != null).join(" · ")}</p>}
    {!compact && event.diff_available && <EventDiff event={event} />}
  </li>)}</ol>;
}
export function ContentHistory({ level, id }: { level: WorkspaceLevel; id: string }) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const [data, setData] = useState<ContentEvents | null>(null), [error, setError] = useState(""), [pending, setPending] = useState(false), [retry, setRetry] = useState(0);
  const path = workspaceApi(level, id) + "/history?limit=50";
  const pageGeneration = useRef(0);
  useEffect(() => {
    pageGeneration.current += 1;
    let live = true; setData(null); setError(""); setPending(true);
    request<ContentEvents>(path).then(value => { if (live) setData(value); }).catch(e => { if (live) setError(errorMessage(e)); }).finally(() => { if (live) setPending(false); });
    return () => { live = false; };
  }, [path, authority, retry]);
  async function more() {
    if (!data?.next_cursor || pending) return; setPending(true);
    const generation = pageGeneration.current;
    try { const value = await request<ContentEvents>(path + "&before=" + encodeURIComponent(data.next_cursor)); if (generation !== pageGeneration.current) return; setData(current => current && ({ ...value, items: [...current.items, ...value.items] })); }
    catch (e) { if (generation === pageGeneration.current) setError(errorMessage(e)); } finally { if (generation === pageGeneration.current) setPending(false); }
  }
  return <section aria-label={text.history}><h2>{text.history}</h2>
    {error && <p className="notice error" role="alert">{error}<button className="button secondary" onClick={() => setRetry(value => value + 1)}>{text.retry}</button></p>}
    {!data && pending && <p role="status">{text.loading}</p>}{data && <ContentTimeline items={data.items} />}{data && !data.items.length && <p>{text.content_history_empty}</p>}
    {data?.next_cursor && <button className="button secondary" disabled={pending} onClick={() => void more()}>{text.next}</button>}
  </section>;
}

