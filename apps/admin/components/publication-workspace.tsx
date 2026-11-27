"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ActorName, useHubPermissions } from "./accounts";
import { canSpecial, capabilityKey } from "@/lib/hub-permissions";
import { request } from "./hub-request";
import { ErrorSummary, dateTime, useContentLocation } from "./content-operations-shared";
import { DetailDialog } from "./registry-motion";
import { publicationChanges, publicationValue } from "./publication-comparison";
import { workflowStateLabel } from "./content-workflow";
import { ExposureChip, InternalExposureNotice } from "./content-exposure";
import { PublicationSourceHistory } from "./publication-source-history";
import { WebPublication } from "./web-publication";
import { workspaceText } from "@/lib/unified-workspace";
import { publicationBase, publicationHref, publicationIssue, publicationLabel, publicationSelection, publicationSelectionKey,
  workflowFailure, workflowText as text, type PublicationCandidate, type PublicationDescriptor, type PublicationItem,
  type PublicationQueue, type PublicationReview, type PublishedResult, type ReleaseHistory, type WebPage,
  type WebVersion, type WebWorkspace } from "@/lib/content-workflow";
import "./content-workflow.css";

const selectionLimit = 100;
function ItemLink({ item, fallback, linkText }: { item: PublicationDescriptor; fallback: string; linkText?: string }) {
  const href = publicationHref(item), label = publicationLabel(item, fallback);
  return href ? <Link prefetch={false} href={href}>{linkText ?? label}</Link> : <span>{label}</span>;
}
function ItemResults({ items, mayReturn, pending, onReturn, onExposureChanged, onExposureEditing }: { onExposureChanged: () => void; onExposureEditing: (value: boolean) => void; items: PublicationItem[]; mayReturn: boolean; pending: boolean; onReturn: (item: PublicationItem) => void }) {
  return <ul className="workflow-results">{items.map(item => <li key={item.item_key} data-publication-item={item.item_key}>
    <strong><ItemLink item={item} fallback={item.item_key} /></strong> · {item.status === "REJECTED" ? text.rejected : workflowStateLabel(item.status)}
    <ExposureChip exposure={item.ai_exposure} /><InternalExposureNotice exposure={item.ai_exposure} href={item.exposure_href} editor={item.exposure_editor} disabled={pending} onChanged={onExposureChanged} onEditingChange={onExposureEditing} />
    {item.code && <p>{publicationIssue(item.code)}</p>}
    {mayReturn && item.can_return && item.workflow && <button className="button secondary" disabled={pending} onClick={() => onReturn(item)}>{text.return}</button>}
  </li>)}</ul>;
}
function Comparison({ before, after, beforeRedacted = false, afterRedacted = false, expanded = false }: {
  before: Record<string, unknown> | null; after: Record<string, unknown>; beforeRedacted?: boolean; afterRedacted?: boolean; expanded?: boolean;
}) {
  const fields = publicationChanges(afterRedacted ? {} : after, beforeRedacted ? undefined : before ?? undefined);
  return <details open={expanded}><summary>{text.before} / {text.after}</summary>
    {beforeRedacted && <p role="status">{text.before} · {text.permission_required}</p>}
    {afterRedacted && <p role="status">{text.after} · {text.permission_required}</p>}
    {fields.map(field => <section key={field.key} data-field={field.key}>
      <h4>{field.label}</h4><div className="publication-comparison" style={beforeRedacted || afterRedacted ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
        {!beforeRedacted && <div><strong>{text.before}</strong><p>{publicationValue(field.before, field.key)}</p></div>}
        {!afterRedacted && <div><strong>{text.after}</strong><p>{publicationValue(field.after, field.key)}</p></div>}
      </div>
    </section>)}
  </details>;
}
function Preview({ html, label }: { html: string; label: string }) {
  return <iframe className="publication-preview" title={`${text.preview} · ${label}`} sandbox="" srcDoc={html} />;
}
type Command = { kind: "return"; item: PublicationDescriptor; label: string }
  | { kind: "pointer"; page: WebPage; version: WebVersion | null }
  | { kind: "rollback"; release: ReleaseHistory };

export function PublicationWorkspace() {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const webAllowed = permissions.account?.status === "ACTIVE" && permissions.can("knowledge");
  const allowed = permissions.account?.status === "ACTIVE" && (webAllowed || permissions.can("releases"));
  const publisher = allowed && canSpecial(permissions.capabilities, "knowledge.publish_web");
  const [queue, setQueue] = useState<PublicationQueue | null>(null), [web, setWeb] = useState<WebWorkspace | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [reason, setReason] = useState("");
  const [review, setReview] = useState<PublicationReview | null>(null), [locale, setLocale] = useState("th"), [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<PublishedResult | null>(null), [command, setCommand] = useState<Command | null>(null), [commandReason, setCommandReason] = useState(""), [commandConfirmed, setCommandConfirmed] = useState(false);
  const [error, setError] = useState<unknown>(null), [reviewError, setReviewError] = useState<unknown>(null), [commandError, setCommandError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false), [reviewLoading, setReviewLoading] = useState(false), [commandPending, setPending] = useState(false), [refresh, setRefresh] = useState(0);
  const busy = useRef(false), scope = useRef(authority); scope.current = authority;
  const [configurationDirty, setConfigurationDirty] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false), [sourceDirty, setSourceDirty] = useState(false);
  const [exposureEditing, setExposureEditing] = useState(false);
  const pending = commandPending || sourceBusy || exposureEditing;
  const location = useContentLocation(Boolean(selected.length || reason || commandReason) || pending || configurationDirty || sourceDirty);
  const configuration = location.params.get("tab") === "configuration";
  const sourceKind = location.params.get("source"), sourceId = location.params.get("id");
  const brandHandoff = JSON.stringify(location.params.getAll("brand"));
  const appliedHandoff = useRef<string | null>(null);
  const [missingBrands, setMissingBrands] = useState<string[]>([]);
  const publicationId = location.params.get("publication"), pageKey = location.params.get("page"), releaseId = location.params.get("release");
  const view = configuration + ":" + pageKey + ":" + locale, activeView = useRef(view); activeView.current = view;
  const [versions, setVersions] = useState<WebVersion[] | null>(null), [version, setVersion] = useState<WebVersion | null>(null), [versionHtml, setVersionHtml] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null), [release, setRelease] = useState<ReleaseHistory | null>(null);
  const selectedPage = web?.pages.find(page => page.page_key === pageKey) ?? null;
  useEffect(() => { setSelected([]); setReason(""); setCommand(null); setCommandReason(""); setResult(null); setConfirmed(false); }, [authority]);
  useEffect(() => {
    let live = true; setQueue(null); setWeb(null); setError(null);
    if (!allowed || configuration) { setLoading(false); return; } setLoading(true);
    const load: Promise<[PublicationQueue, WebWorkspace]> = webAllowed
      ? Promise.all([request<PublicationQueue>(publicationBase), request<WebWorkspace>("v1/admin/web")])
      : request<{ items: ReleaseHistory[] }>("v1/admin/releases").then(value => [
        { items: [], web_history: [], release_history: value.items, can_publish: false },
        { pages: [], can_publish: false },
      ]);
    load.then(([next, pages]) => { if (live) {
      setQueue(next); setWeb(pages); setSelected(current => current.filter(key => next.items.some(item => publicationSelectionKey(item) === key)));
    } }).catch(error => { if (live) setError(error); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [authority, allowed, webAllowed, configuration, refresh]);
  useEffect(() => {
    let live = true; setReview(null); setReviewError(null); setConfirmed(false);
    if (!webAllowed || configuration || !publicationId) { setReviewLoading(false); return; } setReviewLoading(true);
    request<PublicationReview>(`v1/admin/web/publications/${encodeURIComponent(publicationId)}?locale=${locale}`).then(value => { if (live) setReview(value); }).catch(error => { if (live) setReviewError(error); }).finally(() => { if (live) setReviewLoading(false); });
    return () => { live = false; };
  }, [authority, webAllowed, configuration, publicationId, locale, refresh]);
  useEffect(() => {
    let live = true; setVersions(null); setVersion(null); setVersionHtml(null); setRelease(null); setHistoryError(null);
    if (!allowed || configuration) return;
    if (webAllowed && pageKey) request<WebVersion[]>(`v1/admin/web/pages/${encodeURIComponent(pageKey)}/history`).then(value => { if (live) setVersions(value); }).catch(error => { if (live) setHistoryError(error); });
    if (releaseId) request<ReleaseHistory>(`v1/admin/releases/${encodeURIComponent(releaseId)}`).then(value => { if (live) setRelease(value); }).catch(error => { if (live) setHistoryError(error); });
    return () => { live = false; };
  }, [authority, allowed, webAllowed, configuration, pageKey, releaseId, refresh]);
  useEffect(() => { setVersion(null); setVersionHtml(null); }, [locale]);
  useEffect(() => {
    const key = authority + ":" + brandHandoff;
    if (!queue) return;
    const first = appliedHandoff.current !== key;
    appliedHandoff.current = key;
    const raw = JSON.parse(brandHandoff) as string[], requested = [...new Set(raw)];
    if (!raw.length) { setMissingBrands([]); return; }
    const matches = raw.length <= selectionLimit && publisher && queue.can_publish
      ? queue.items.filter(item => item.system === "release" && item.entity_type === "brand" && requested.includes(item.public_id)) : [];
    if (first) { setSelected(matches.map(publicationSelectionKey)); setConfirmed(false); }
    setMissingBrands(requested.filter(id => !matches.some(item => item.system === "release" && item.public_id === id)));
  }, [authority, brandHandoff, publisher, queue]);
  function open(values: { publication?: string | null; page?: string | null; release?: string | null }, force = false) {
    if (location.navigate({ publication: null, page: null, release: null, ...values }, force)) { setSelected([]); setReason(""); setConfirmed(false); setCommand(null); setCommandReason(""); setResult(null); return true; }
    return false;
  }
  function choose(item: PublicationCandidate, checked: boolean) {
    const key = publicationSelectionKey(item);
    setSelected(current => checked ? current.includes(key) || current.length >= selectionLimit ? current : [...current, key] : current.filter(value => value !== key)); setConfirmed(false);
  }
  async function prepare() {
    if (busy.current || sourceBusy || exposureEditing || !publisher || !queue?.can_publish || !reason.trim()) return;
    const items = queue.items.filter(item => selected.includes(publicationSelectionKey(item))); if (!items.length || items.length > selectionLimit) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const value = await request<{ id: string }>(publicationBase + "/prepare", "POST", { selections: items.map(publicationSelection), reason: reason.trim() });
      if (scope.current !== authority) return; setResult(null); open({ publication: value.id }, true); setRefresh(value => value + 1);
    } catch (error) { if (scope.current === authority) setError(error); }
    finally { busy.current = false; setPending(false); }
  }
  async function publish() {
    if (busy.current || sourceBusy || exposureEditing || !publisher || !review?.can_publish || review.state !== "IN_REVIEW" || !confirmed) return;
    busy.current = true; setPending(true); setReviewError(null);
    try {
      const value = await request<PublishedResult>(publicationBase + "/publish", "POST", { publication_id: review.id, expected_digest: review.digest });
      if (scope.current !== authority) return; setResult(value); setConfirmed(false); setRefresh(value => value + 1);
    } catch (error) { if (scope.current === authority) setReviewError(error); }
    finally { busy.current = false; setPending(false); }
  }
  function startCommand(next: Command) { setCommand(next); setCommandReason(""); setCommandConfirmed(false); setCommandError(null); }
  function closeCommand() { if (!pending) { setCommand(null); setCommandReason(""); } }
  const canRollback = (value: ReleaseHistory) => publisher && value.status === "PUBLISHED" && value.members.every(member => permissions.can(member.entity_type + "s"));
  async function runCommand() {
    if (busy.current || sourceBusy || exposureEditing || !publisher || !command || !commandReason.trim() || !commandConfirmed) return;
    if (command.kind === "return" && (!command.item.can_return || !command.item.workflow)) return;
    if (command.kind === "pointer" && !web?.can_publish) return;
    if (command.kind === "rollback" && !canRollback(command.release)) return;
    busy.current = true; setPending(true); setCommandError(null);
    try {
      if (command.kind === "return") await request(publicationBase + "/return", "POST", { ...command.item.workflow, reason: commandReason.trim() });
      if (command.kind === "pointer") await request(`v1/admin/web/pages/${encodeURIComponent(command.page.page_key)}/pointer`, "POST", { expected_version_id: command.page.published_version_id, target_version_id: command.version?.id ?? null, reason: commandReason.trim() });
      if (command.kind === "rollback") await request(`v1/admin/releases/${encodeURIComponent(command.release.id)}/rollback`, "POST", { change_reason: commandReason.trim() });
      if (scope.current !== authority) return; setCommand(null); setCommandReason(""); setCommandConfirmed(false); setConfirmed(false);
      setQueue(null); setWeb(null); setReview(null); setRelease(null); setVersions(null); setRefresh(value => value + 1);
    } catch (error) { if (scope.current === authority) setCommandError(error); }
    finally { busy.current = false; setPending(false); }
  }
  async function inspectVersion(next: WebVersion) {
    if (!pageKey || busy.current) return; busy.current = true; setPending(true); setHistoryError(null); setVersion(null); setVersionHtml(null);
    try {
      const value = await request<{ html: string }>(`v1/admin/web/pages/${encodeURIComponent(pageKey)}/versions/${encodeURIComponent(next.id)}?locale=${locale}`);
      if (scope.current !== authority || activeView.current !== view) return; setVersion(next); setVersionHtml(value.html);
    } catch (error) { if (scope.current === authority && activeView.current === view) setHistoryError(error); }
    finally { busy.current = false; setPending(false); }
  }
  const returnItem = (item: PublicationItem) => startCommand({ kind: "return", item, label: publicationLabel(item, item.item_key) });
  const commandTitle = command?.kind === "return" ? text.return + " · " + command.label : command?.kind === "rollback" ? text.rollback_release : command?.kind === "pointer" && command.version ? text.restore_version : text.withdraw_page;
  if (configuration) return <section className="publication-workspace"><h1 id="registry-title" tabIndex={-1}>{text.queue}</h1>
    <nav className="publication-toolbar"><button type="button" className="button secondary" disabled={configurationDirty}
      onClick={() => location.navigate({ tab: null, page: null, item: null, field: null, publication: null, release: null })}>{text.queue}</button></nav>
    {webAllowed ? <WebPublication configurationOnly onEditingChange={setConfigurationDirty} /> : <p>{text.permission_required}</p>}
  </section>;
  return <section className="publication-workspace"><h1 id="registry-title" tabIndex={-1}>{text.queue}</h1>
    <ErrorSummary message={error ? workflowFailure(error) : ""} />
    {!allowed ? <p>{text.permission_required}</p> : <>
      {loading && <p role="status">{text.loading}</p>}
      <div className="publication-toolbar"><button className="button secondary" disabled={pending} onClick={() => setRefresh(value => value + 1)}>{text.refresh}</button>
        {webAllowed && <button type="button" className="button secondary" disabled={pending}
          onClick={() => location.navigate({ tab: "configuration", publication: null, page: null, release: null })}>{workspaceText.settings}</button>}
        <label className="publication-locale">{text.preview}<select value={locale} disabled={pending} onChange={event => setLocale(event.target.value)}><option value="th">{text.thai}</option><option value="en">{text.english}</option></select></label>
      </div>
      {sourceId && (sourceKind === "project" || sourceKind === "brand" || sourceKind === "promotion") &&
        <PublicationSourceHistory key={`${authority}:${sourceKind}:${sourceId}`} kind={sourceKind} id={sourceId}
          disabled={commandPending} onBusy={setSourceBusy} onEditingChange={setSourceDirty} onChanged={() => setRefresh(value => value + 1)} />}
      {missingBrands.length > 0 && <div className="publication-handoff-errors" role="alert"><p>{text.not_approved_or_available}</p>
        <ul>{missingBrands.map(id => <li key={id}>{id}</li>)}</ul></div>}
      {queue && (["web", "release"] as const).map(system => <section key={system} aria-label={system === "web" ? text.website_publication : text.data_publication}>
        <h2>{system === "web" ? text.website_publication : text.data_publication}</h2>
        <ul className="publication-targets">{queue.items.filter(item => item.system === system).map(item => {
          const key = publicationSelectionKey(item), label = publicationLabel(item, item.system === "web" ? item.page_key : item.public_id);
          return <li key={key} data-publication-target={key}><label className="publication-selection"><input type="checkbox" aria-label={`${text.select_item} · ${label}`} checked={selected.includes(key)} disabled={!publisher || !queue.can_publish || pending || !selected.includes(key) && selected.length >= selectionLimit} onChange={event => choose(item, event.target.checked)} /><span>{label}</span></label>
            {publicationHref(item) && <p><ItemLink item={item} fallback={label} linkText={text.detail} /></p>}
            <ExposureChip exposure={item.ai_exposure} /><InternalExposureNotice exposure={item.ai_exposure} href={item.exposure_href} editor={item.exposure_editor} disabled={pending} onChanged={() => setRefresh(value => value + 1)} onEditingChange={setExposureEditing} />
            {item.items && <ItemResults items={item.items} mayReturn={publisher} pending={pending} onReturn={returnItem} onExposureChanged={() => setRefresh(value => value + 1)} onExposureEditing={setExposureEditing} />}
            {publisher && item.can_return && item.workflow && <button className="button secondary" disabled={pending} onClick={() => startCommand({ kind: "return", item, label })}>{text.return}</button>}
          </li>;
        })}</ul>{!queue.items.some(item => item.system === system) && <p>{text.publication_queue_empty}</p>}
      </section>)}
      {publisher && queue?.can_publish && <form onSubmit={event => { event.preventDefault(); void prepare(); }}>
        <p>{text.select_item} · {selected.length} / {selectionLimit}</p>
        <label className="workflow-reason">{text.reason}<textarea value={reason} rows={3} maxLength={2000} required disabled={pending} onChange={event => setReason(event.target.value)} /></label>
        <div className="workflow-actions"><button className="button primary" disabled={pending || !selected.length || !reason.trim()}>{text.prepare_review} ({selected.length})</button>
          <button type="button" className="button secondary" disabled={pending || !selected.length} onClick={() => setSelected([])}>{text.clear_selection}</button></div>
      </form>}
      {(publicationId || result) && <section className="publication-review" aria-label={text.review_publication}><h2>{text.review_publication}</h2>
        <ErrorSummary message={reviewError ? workflowFailure(reviewError) : ""} />{reviewLoading && <p role="status">{text.loading}</p>}
        {review && <><p>{review.reason} · {review.state === "IN_REVIEW" ? text.prepared : workflowStateLabel(review.state)}</p>{review.pages.map((page, index) => {
          const label = publicationLabel(page, page.page_key ?? page.member?.public_id ?? page.member?.entity_id ?? String(index + 1));
          return <article key={page.page_key ?? page.member?.entity_id ?? index} className="publication-reviewed-page"><h3><ItemLink item={page} fallback={label} /></h3>
            {page.status === "REJECTED" && <p>{text.rejected} · {publicationIssue(page.code)}</p>}
            {page.issues?.length ? <ul>{page.issues.map((issue, index) => <li key={index}>{publicationIssue(issue.code)}{issue.label?.th && <> · {issue.label.th}</>}</li>)}</ul> : null}
            <Comparison before={page.previous ?? null} after={page.preview} beforeRedacted={page.previous_redacted} afterRedacted={page.preview_redacted} expanded={page.system === "release" || page.previous_redacted || page.preview_redacted} />{page.html && !page.preview_redacted && page.system !== "release" && <Preview html={page.html} label={label} />}
            <ItemResults items={page.items} mayReturn={publisher} pending={pending} onReturn={returnItem} onExposureChanged={() => setRefresh(value => value + 1)} onExposureEditing={setExposureEditing} />
          </article>;
        })}{review.state === "IN_REVIEW" && publisher && <><label className="publication-selection"><input type="checkbox" checked={confirmed} disabled={pending || !review.can_publish} onChange={event => setConfirmed(event.target.checked)} /><span>{text.confirm_publication}</span></label><button className="button primary" disabled={pending || !review.can_publish || !confirmed} onClick={() => void publish()}>{text.publish}</button></>}</>}
        {result && <section aria-live="polite"><h3>{text.publication_results}</h3><p>{workflowStateLabel(result.state)}</p>{result.outcomes.map((outcome, index) => <article key={outcome.page_key ?? outcome.member?.entity_id ?? index}>
          <h4><ItemLink item={outcome} fallback={outcome.page_key ?? outcome.member?.public_id ?? outcome.member?.entity_id ?? String(index + 1)} /></h4>
          {outcome.status && <p>{outcome.status === "REJECTED" ? text.rejected : workflowStateLabel(outcome.status)}</p>}{outcome.code && <p>{publicationIssue(outcome.code)}</p>}
          {outcome.items && <ItemResults items={outcome.items} mayReturn={publisher} pending={pending} onReturn={returnItem} onExposureChanged={() => setRefresh(value => value + 1)} onExposureEditing={setExposureEditing} />}
          {outcome.rejected?.map(item => <p key={item.entity_type + item.entity_id}>{item.public_id ?? item.entity_id} · {publicationIssue(item.code)}</p>)}
        </article>)}</section>}
      </section>}
      {webAllowed && <section className="publication-history-panel"><h2>{text.web_history}</h2><ul className="publication-history">{queue?.web_history.map(item => <li key={item.id}>
        <button className="button secondary" disabled={pending} onClick={() => open({ publication: item.id })}>{text.detail} · {item.reason}</button><p>{workflowStateLabel(item.state)} · {dateTime(item.created_at)}</p>
      </li>)}</ul>{queue && !queue.web_history.length && <p>{text.publication_history_empty}</p>}
        <ul className="publication-history">{web?.pages.map(page => <li key={page.page_key}><button className="button secondary" disabled={pending} onClick={() => open({ page: page.page_key })}>{text.web_history} · {page.page_key}</button></li>)}</ul>
      </section>}
      <section className="publication-history-panel"><h2>{text.release_history}</h2><ul className="publication-history">{queue?.release_history.map(item => <li key={item.id}>
        <button className="button secondary" disabled={pending} onClick={() => open({ release: item.id })}>{text.detail} · {item.change_reason}</button><p>{workflowStateLabel(item.status)} · {dateTime(item.published_at)}</p>
      </li>)}</ul>{queue && !queue.release_history.length && <p>{text.publication_history_empty}</p>}</section>
      {(pageKey || releaseId) && <section className="publication-history-panel"><ErrorSummary message={historyError ? workflowFailure(historyError) : ""} />
        {pageKey && <><h2>{text.web_history} · {pageKey}</h2>{!versions && !historyError && <p role="status">{text.loading}</p>}{versions && !versions.length && <p>{text.publication_history_empty}</p>}
          <ul className="publication-history">{versions?.map(item => <li key={item.id}><button className="button secondary" disabled={pending} onClick={() => void inspectVersion(item)}>{text.version} {item.version_no}</button> · {item.change_reason} · {dateTime(item.published_at)}{item.id === selectedPage?.published_version_id && <p>{text.current_version}</p>}</li>)}</ul>
          {version && versionHtml && <><h3>{text.version} {version.version_no}</h3><Preview html={versionHtml} label={`${pageKey} · ${version.version_no}`} /></>}
          {publisher && web?.can_publish && selectedPage && <div className="workflow-actions">{selectedPage.published_version_id && <button className="button secondary" disabled={pending} onClick={() => startCommand({ kind: "pointer", page: selectedPage, version: null })}>{text.withdraw_page}</button>}
            {version && versionHtml && selectedPage.published_version_id !== version.id && <button className="button secondary" disabled={pending} onClick={() => startCommand({ kind: "pointer", page: selectedPage, version })}>{text.restore_version}</button>}</div>}
        </>}
        {releaseId && !release && !historyError && <p role="status">{text.loading}</p>}
        {release && <><h2>{text.release_history} · {release.change_reason}</h2><p>{workflowStateLabel(release.status)} · {dateTime(release.published_at)} · <ActorName id={release.published_by} /></p>
          {release.rolled_back_at && <p>{release.rollback_reason} · {dateTime(release.rolled_back_at)} · <ActorName id={release.rolled_back_by} /></p>}
          <ul className="publication-history">{release.members.map(member => <li key={member.entity_type + member.entity_id}><strong>{member.public_id ?? member.entity_id}</strong><p>{text.before} · {member.before_version_id ?? "—"}</p><p>{text.after} · {member.after_version_id}</p></li>)}</ul>
          {canRollback(release) && <button className="button secondary" disabled={pending} onClick={() => startCommand({ kind: "rollback", release })}>{text.rollback_release}</button>}
        </>}
      </section>}
    </>}
    {command && <DetailDialog dialogId="publication-command" title={commandTitle} onClose={closeCommand}>
      <form className="workflow-form" onSubmit={event => { event.preventDefault(); void runCommand(); }}><ErrorSummary message={commandError ? workflowFailure(commandError) : ""} />
        <label className="workflow-reason">{text.reason}<textarea value={commandReason} rows={3} maxLength={2000} required disabled={pending} onChange={event => { setCommandReason(event.target.value); setCommandConfirmed(false); }} /></label>
        <label className="publication-selection"><input type="checkbox" checked={commandConfirmed} disabled={pending} onChange={event => setCommandConfirmed(event.target.checked)} /><span>{command.kind === "pointer" ? text.confirm_pointer_change : command.kind === "rollback" ? text.confirm_release_rollback : text.confirm}</span></label>
        <div className="workflow-actions"><button type="button" className="button secondary" disabled={pending} onClick={closeCommand}>{text.cancel}</button><button className="button primary" disabled={pending || !commandReason.trim() || !commandConfirmed}>{commandTitle}</button></div>
      </form>
    </DetailDialog>}
  </section>;
}
