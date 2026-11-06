"use client";
import { useEffect, useRef, useState } from "react";
import { ActorName, useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { workflowFailure, workflowText as text } from "@/lib/content-workflow";
import { dateTime, ErrorSummary, Ready } from "./content-operations-shared";
import { DetailDialog } from "./registry-motion";
import { PublicationComparison } from "./publication-comparison";
import { request } from "./hub-request";

type Kind = "project" | "brand" | "promotion";
type Preview = { publication_preview?: Record<string, unknown>; publication_preview_redacted?: boolean };
type Version = { version_id: string; version_no: number; published_at: string; publisher?: string; change_reason?: string; payload?: Preview };
type Source = Preview & {
  id: string; public_name?: { th?: string }; title?: { th?: string }; published_version_id: string | null;
  draft_revision?: number; published?: { id: string; version_no: number; published_at: string; payload: Record<string, unknown> } | null;
  versions?: { id: string; version_no: number; published_at: string }[];
  readiness?: { ready: boolean; missing: { field: string; message: string }[]; excluded_models?: { rem_model_id: string; name: string; reason: string }[] };
};
const promotionFields = ["code", "title", "summary", "conditions_public", "legal_terms", "disclaimer", "benefit_type", "benefit_value", "benefit_unit", "stackable", "priority", "starts_at", "ends_at"];
function promotionPreview(value: Record<string, unknown> | null | undefined) {
  return value ? Object.fromEntries(promotionFields.filter(key => key in value).map(key => [key, value[key]])) : undefined;
}

export function PublicationSourceHistory({ kind, id, disabled, onBusy, onEditingChange, onChanged }: {
  kind: Kind; id: string; disabled: boolean; onBusy: (value: boolean) => void;
  onEditingChange: (value: boolean) => void; onChanged: () => void;
}) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const allowed = permissions.account?.status === "ACTIVE" && permissions.can(kind + "s");
  const publisher = allowed && permissions.special("knowledge.publish_web");
  const base = `v1/admin/${kind}s/${encodeURIComponent(id)}`;
  const [source, setSource] = useState<Source | null>(null), [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState<unknown>(null), [historyError, setHistoryError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  const [command, setCommand] = useState<"withdraw" | "rollback" | null>(null), [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false), [commandError, setCommandError] = useState<unknown>(null);
  const busy = useRef(false), scope = useRef(authority + ":" + base); scope.current = authority + ":" + base;
  const identity = scope.current;
  useEffect(() => { onEditingChange(Boolean(reason || confirmed) || pending); }, [reason, confirmed, pending, onEditingChange]);
  useEffect(() => () => { onBusy(false); onEditingChange(false); }, [onBusy, onEditingChange]);
  useEffect(() => {
    let live = true;
    setSource(null); setVersions([]); setSelected(null); setError(null); setHistoryError(null);
    setCommand(null); setReason(""); setConfirmed(false);
    if (!allowed) { setLoading(false); return; }
    setLoading(true);
    // A missing previous preview must not hide the independently authorized
    // current source. Each read retains its own error and retry state.
    const current = request<Source>(base).then(value => { if (live) setSource(value); }).catch(error => { if (live) setError(error); });
    const history = kind === "promotion" ? Promise.resolve() : request<Version[]>(base + "/versions")
      .then(value => { if (live) setVersions(value); }).catch(error => { if (live) setHistoryError(error); });
    Promise.all([current, history]).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [allowed, authority, base, kind, refresh]);
  const current = versions.find(version => version.version_id === source?.published_version_id);
  const target = selected ? versions.find(version => version.version_id === selected) : null;
  const before = kind === "promotion" ? promotionPreview(source?.published?.payload) : current?.payload?.publication_preview;
  const after = kind === "promotion" ? promotionPreview(source as unknown as Record<string, unknown> | null)
    : (target?.payload ?? source)?.publication_preview;
  const beforeRedacted = current?.payload?.publication_preview_redacted === true;
  const afterRedacted = (target?.payload ?? source)?.publication_preview_redacted === true;
  function start(next: "withdraw" | "rollback") {
    if (disabled || busy.current || !publisher || !source || next === "rollback" && (!target?.payload?.publication_preview || afterRedacted)) return;
    setCommand(next); setReason(""); setConfirmed(false); setCommandError(null);
  }
  function close() { if (!pending) { setCommand(null); setReason(""); setConfirmed(false); } }
  async function execute() {
    if (disabled || busy.current || !publisher || !source || !command || !reason.trim() || !confirmed) return;
    if (command === "rollback" && (kind === "promotion" || !target?.payload?.publication_preview || afterRedacted)) return;
    busy.current = true; setPending(true); onBusy(true); setCommandError(null);
    try {
      const body = kind === "promotion" ? { expected_revision: source.draft_revision, expected_published_version_id: source.published_version_id, change_reason: reason.trim() }
        : { change_reason: reason.trim(), ...(command === "rollback" ? { version_id: target!.version_id } : {}) };
      await request(base + "/" + command, "POST", body);
      if (scope.current !== identity) return;
      setCommand(null); setReason(""); setConfirmed(false); setRefresh(value => value + 1); onChanged();
    } catch (error) { if (scope.current === identity) setCommandError(error); }
    finally { busy.current = false; setPending(false); onBusy(false); }
  }
  const title = source?.public_name?.th || source?.title?.th || id;
  const comparison = <PublicationComparison current={before} target={after} currentRedacted={beforeRedacted}
    targetRedacted={afterRedacted} label={text.before + " / " + text.after} rollback={Boolean(target)} />;
  return <section className="publication-source-history" data-publication-source={`${kind}:${id}`} aria-label={text.release_history}>
    <h2>{title}</h2>{!allowed ? <p>{text.permission_required}</p> : <>
      {loading && <p role="status">{text.loading}</p>}
      <ErrorSummary message={error ? workflowFailure(error) : ""} />
      <ErrorSummary message={historyError ? workflowFailure(historyError) : ""} />
      {(error || historyError) ? <button className="button secondary" disabled={disabled || pending} onClick={() => setRefresh(value => value + 1)}>{text.retry}</button> : null}
      {source && <><Ready value={source.readiness} />
        {source.readiness?.excluded_models?.length ? <ul className="publication-source-exclusions" aria-label={text.not_approved_or_available}>
          {source.readiness.excluded_models.map(model => <li key={model.rem_model_id}>{model.name} · {model.rem_model_id} · {model.reason}</li>)}
        </ul> : null}
        {comparison}
        {selected && <button className="button secondary" disabled={disabled || pending} onClick={() => setSelected(null)}>{text.clear_selection}</button>}
        <ul className="version-list">{versions.map(version => <li key={version.version_id}>
          <div><button className="button secondary" data-source-version={version.version_id} disabled={disabled || pending || !version.payload}
            aria-pressed={selected === version.version_id} onClick={() => setSelected(version.version_id)}>{text.version} {version.version_no}</button>
            <p>{dateTime(version.published_at)}{version.publisher && <> · <ActorName id={version.publisher} /></>}</p>
            {version.change_reason && <p>{version.change_reason}</p>}
            {version.version_id === source.published_version_id && <p>{text.current_version}</p>}
          </div>
        </li>)}</ul>
        {kind === "promotion" && <ul>{source.versions?.map(version => <li key={version.id}>{text.version} {version.version_no} · {dateTime(version.published_at)}</li>)}</ul>}
        {publisher && <div className="workflow-actions">
          {source.published_version_id && <button className="button secondary" disabled={disabled || pending} onClick={() => start("withdraw")}>{text.withdraw_page}</button>}
          {kind !== "promotion" && target?.payload?.publication_preview && !afterRedacted && target.version_id !== source.published_version_id &&
            <button className="button secondary" disabled={disabled || pending} onClick={() => start("rollback")}>{text.restore_version}</button>}
        </div>}
      </>}
      {command && <DetailDialog dialogId="publication-source-command" title={command === "withdraw" ? text.withdraw_page : text.restore_version} onClose={close}>
        <ErrorSummary message={commandError ? workflowFailure(commandError) : ""} />
        {command === "rollback" && comparison}
        <form onSubmit={event => { event.preventDefault(); void execute(); }}>
          <label className="workflow-reason">{text.reason}<textarea required maxLength={1000} rows={3} disabled={pending} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></label>
          <label className="publication-selection"><input type="checkbox" disabled={pending} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{text.confirm_pointer_change}</label>
          <div className="workflow-actions"><button className="button primary" disabled={pending || disabled || !confirmed || !reason.trim()}>{text.confirm}</button>
            <button type="button" className="button secondary" disabled={pending} onClick={close}>{text.cancel}</button></div>
        </form>
      </DetailDialog>}
    </>}
  </section>;
}
