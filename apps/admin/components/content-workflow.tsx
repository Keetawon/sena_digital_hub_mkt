"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ActorName, useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import { request } from "./hub-request";
import { DetailDialog } from "./registry-motion";
import { ErrorSummary, dateTime } from "./content-operations-shared";
import { publicationValue } from "./publication-comparison";
import { ExposureChip, InternalExposureNotice } from "./content-exposure";
import { workflowAllowed, workflowCommand, workflowFailure, workflowKey, workflowReadPath, workflowRequiresReason, workflowMatchesSource,
  workflowText as text, submitWorkflowItems, loadWorkflowInventory, workflowSubmissionAllowed, workflowSubmitCommand, publicationHref,
  type SubmissionItem, type SubmissionOutcome, type WorkflowAction, type WorkflowInventory, type WorkflowInventoryPage, type WorkflowInventoryScope,
  type WorkflowInput, type WorkflowSnapshot, type WorkflowSourceStamp, type WorkflowSubmissionSnapshot, type WorkflowTarget } from "@/lib/content-workflow";
import "./content-workflow.css";

/** Read one saved object. A failed command never changes the caller's draft. */
export function useContentWorkflow(target: WorkflowTarget | null, revision: string | number = 0) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const path = target ? workflowReadPath(target) : "", scope = path + authority;
  const activeScope = useRef(scope); activeScope.current = scope;
  const [record, setRecord] = useState<{ scope: string; value: WorkflowSnapshot } | null>(null);
  const [loading, setLoading] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState<unknown>(null), [stale, setStale] = useState(false), [refreshKey, setRefreshKey] = useState(0);
  const busy = useRef(false), enabled = permissions.ready && permissions.account?.status === "ACTIVE" && ["projects", "brands", "knowledge", "promotions"].some(tab => permissions.can(tab));
  const snapshot = record?.scope === scope ? record.value : null;
  useEffect(() => {
    let live = true; setRecord(null); setError(null); setStale(false);
    if (!path || !enabled) { setLoading(false); return; }
    setLoading(true);
    request<WorkflowSnapshot>(path).then(value => { if (live) setRecord({ scope, value }); }).catch(error => { if (live) setError(error); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, scope, enabled, revision, refreshKey]);
  const refresh = useCallback(() => { if (!busy.current) setRefreshKey(value => value + 1); }, []);
  async function execute(action: WorkflowAction, input: WorkflowInput = {}) {
    if (busy.current || activeScope.current !== scope || !snapshot || stale || !workflowAllowed(permissions.capabilities, snapshot, action)) return null;
    busy.current = true; setPending(true); setError(null);
    try {
      const command = workflowCommand(snapshot, action, input);
      const value = await request<WorkflowSnapshot>(command.path, "POST", command.body);
      if (activeScope.current !== scope) return null;
      setRecord({ scope, value }); return value;
    } catch (error) {
      if (activeScope.current === scope) { setError(error); setStale((error as { status?: number })?.status === 409); }
      return null;
    } finally { busy.current = false; setPending(false); }
  }
  return { snapshot, loading, pending, error, stale, refresh, execute };
}

/** Dirty normal forms block fresh hashes. No incomplete page is submittable. */
export function useContentWorkflowItems(scope: WorkflowInventoryScope | null, { revision = 0, blocked = false }: { revision?: string | number; blocked?: boolean } = {}) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const key = scope ? JSON.stringify([scope.level, scope.id, scope.phase ?? null, authority, revision]) : "";
  const active = useRef(""); active.current = key + ":" + blocked;
  const [record, setRecord] = useState<{ key: string; value: WorkflowInventory } | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null), [refreshKey, setRefreshKey] = useState(0);
  const enabled = permissions.ready && permissions.account?.status === "ACTIVE" && ["projects", "brands", "knowledge"].some(tab => permissions.can(tab));
  useEffect(() => {
    let live = true; const expected = key + ":" + blocked; setRecord(null); setError(null);
    if (!scope || !enabled || blocked) { setLoading(false); return; }
    setLoading(true);
    loadWorkflowInventory(scope, path => request<WorkflowInventoryPage>(path), () => live && active.current === expected)
      .then(value => { if (live && active.current === expected) setRecord({ key, value }); })
      .catch(error => { if (live && active.current === expected) setError(error); })
      .finally(() => { if (live && active.current === expected) setLoading(false); });
    return () => { live = false; };
  }, [key, enabled, blocked, revision, refreshKey]);
  const value = !blocked && record?.key === key ? record.value : null;
  const refresh = () => { if (enabled && !blocked) { setRecord(null); setLoading(true); setRefreshKey(value => value + 1); } };
  return { scope: value?.scope ?? null, items: value?.items ?? [], complete: value !== null, loading, error, refresh };
}

// disabled describes other forms' dirty/busy state, not this header's own
// onBusyChange. revision advances only after an ordinary form save/reload.
export function SavedContentSubmission({ scope, revision, disabled = false, onChanged, onBusyChange, onExposureChanged }: {
  scope: WorkflowInventoryScope | null; revision?: string | number; disabled?: boolean;
  onChanged?: (outcomes: SubmissionOutcome[]) => void | Promise<void>; onBusyChange?: (pending: boolean) => void;
  onExposureChanged?: () => void | Promise<void>;
}) {
  const inventory = useContentWorkflowItems(scope, { revision, blocked: disabled }), [pending, setPending] = useState(false);
  if (!scope) return null;
  return <div>
    <ErrorSummary message={inventory.error ? workflowFailure(inventory.error) : ""} />
    {inventory.loading && <p role="status">{text.loading}</p>}
    <button type="button" className="button secondary" disabled={disabled || pending || inventory.loading} onClick={inventory.refresh}>{text.refresh}</button>
    <SubmitAllContent key={JSON.stringify([scope.level, scope.id, scope.phase ?? null])}
      items={inventory.items.map(item => ({ label: item.label.th || item.label.en || text.submit, href: publicationHref(item), snapshot: item }))}
      disabled={disabled || inventory.loading || !inventory.complete} onChanged={onChanged}
      onExposureChanged={async () => { await onExposureChanged?.(); inventory.refresh(); }}
      onBusyChange={value => { setPending(value); onBusyChange?.(value); }} />
  </div>;
}

export type ContentWorkflowProps = {
  target: WorkflowTarget | null; label: string; revision?: string | number; disabled?: boolean; submitDisabled?: boolean;
  draft?: { dirty: boolean; valid: boolean; sourceStamp: WorkflowSourceStamp; getChanges: () => Record<string, unknown> | null | Promise<Record<string, unknown> | null> };
  onChanged?: (snapshot: WorkflowSnapshot) => void | Promise<void>;
  onStateChange?: (snapshot: WorkflowSnapshot | null) => void;
  onEditingChange?: (editing: boolean) => void;
  onReload?: () => void | Promise<void>;
};
export function ContentWorkflow({ target, label, revision, disabled = false, submitDisabled = false, draft, onChanged, onStateChange, onEditingChange, onReload }: ContentWorkflowProps) {
  const permissions = useHubPermissions(), workflow = useContentWorkflow(target, revision), id = useId();
  const [choice, setChoice] = useState<Exclude<WorkflowAction, "submit"> | null>(null), [reason, setReason] = useState(""), [localError, setLocalError] = useState<unknown>(null);
  const acting = useRef(false), [preparing, setPreparing] = useState(false);
  const [exposureEditing, setExposureEditing] = useState(false);
  const draftKey = (target ? workflowKey(target) : "") + ":" + String(revision ?? ""), [conflictedDraft, setConflictedDraft] = useState<string | null>(null);
  const callbacks = useRef({ onStateChange, onEditingChange }); callbacks.current = { onStateChange, onEditingChange };
  useEffect(() => { callbacks.current.onStateChange?.(workflow.snapshot); }, [workflow.snapshot]);
  useEffect(() => { callbacks.current.onEditingChange?.(Boolean(choice || workflow.pending || preparing || exposureEditing)); return () => callbacks.current.onEditingChange?.(false); }, [choice, workflow.pending, preparing, exposureEditing]);
  useEffect(() => { setChoice(null); setReason(""); setLocalError(null); }, [target ? workflowKey(target) : "", permissions.account?.id]);
  useEffect(() => { if (workflow.stale && draft?.dirty) setConflictedDraft(draftKey); }, [workflow.stale, draft?.dirty, draftKey]);
  const item = workflow.snapshot;
  async function perform(action: WorkflowAction) {
    if (acting.current || disabled || action === "submit" && submitDisabled || workflow.pending || workflow.stale || needsReload || action !== "save_approve" && draft?.dirty
      || action === "save_approve" && (!draft?.dirty || !draft.valid || revision === undefined || !sourceMatches)) return;
    acting.current = true; setPreparing(true); setLocalError(null);
    try {
      const changes = action === "save_approve" ? await draft?.getChanges() : undefined;
      if (action === "save_approve" && !changes) return;
      const result = await workflow.execute(action, { reason, ...(changes ? { changes, sourceStamp: draft?.sourceStamp } : {}) });
      if (!result) return;
      setChoice(null); setReason("");
      try { await onChanged?.(result); } catch (error) { setLocalError(error); }
    } catch (error) { setLocalError(error); }
    finally { acting.current = false; setPreparing(false); }
  }
  if (!target) return null;
  const actions = (["submit", "approve", "return", "withdraw", "save_approve"] as const).filter(action =>
    workflowAllowed(permissions.capabilities, item, action) && (action !== "save_approve" || draft?.dirty));
  const needsReload = Boolean(draft?.dirty && conflictedDraft === draftKey);
  const sourceMatches = workflowMatchesSource(item, draft?.sourceStamp);
  const locked = disabled || workflow.pending || preparing || workflow.stale || needsReload || exposureEditing;
  async function reload() {
    if (!onReload) { if (!draft?.dirty) workflow.refresh(); return; }
    setPreparing(true); setLocalError(null);
    try { await onReload(); setConflictedDraft(null); workflow.refresh(); } catch (error) { setLocalError(error); } finally { setPreparing(false); }
  }
  return <section className="content-workflow" aria-label={label} data-workflow-kind={target.kind} data-workflow-key={workflowKey(target)}>
    <div className="workflow-status"><strong>{label}</strong>{item && <><ExposureChip exposure={item.ai_exposure} /><span className="workflow-state">{workflowStateLabel(item.state)}{item.version_no != null && <> · {text.version} {item.version_no}</>}</span></>}</div>
    {item && <InternalExposureNotice exposure={item.ai_exposure} href={item.exposure_href} editor={item.exposure_editor} disabled={locked || Boolean(draft?.dirty)} onEditingChange={setExposureEditing} onChanged={async () => { await onReload?.(); workflow.refresh(); }} />}
    <ErrorSummary message={workflow.error || localError ? workflowFailure(workflow.error || localError) : ""} />
    {Boolean(workflow.error || localError) && draft?.dirty && <p role="status">{text.draft_preserved}</p>}
    {needsReload && !workflow.error && <p role="status">{text.stale_item} · {text.draft_preserved}</p>}
    {draft?.dirty && item && !sourceMatches && !needsReload && <p role="status">{text.stale_item} · {text.draft_preserved}</p>}
    {workflow.loading && <p role="status">{text.loading}</p>}
    {item?.needs_reapproval && <p role="status">{text.needs_reapproval}</p>}
    {item?.self_approval && <p>{text.self_approval} · {item.decision_reason}</p>}
    {item?.approved_by && <p><ActorName id={item.approved_by} /> · {dateTime(item.approved_at)}</p>}
    {item?.needs_reapproval && item.staged_evidence && <details><summary>{text.before} / {text.after}</summary><div className="publication-comparison"><div><strong>{text.before}</strong><p>{publicationValue(item.staged_evidence.approved)}</p></div><div><strong>{text.after}</strong><p>{publicationValue(item.staged_evidence.current)}</p></div></div></details>}
    {target.kind === "promotion" && <p>{text.normal_review_required}</p>}
    <div className="workflow-actions">{actions.map(action => <button type="button" className={action === "submit" || action === "save_approve" ? "button primary" : "button secondary"} key={action}
      disabled={locked || action === "submit" && submitDisabled || action === "save_approve" && (!draft?.valid || !sourceMatches || revision === undefined) || action !== "save_approve" && Boolean(draft?.dirty)}
      onClick={() => action === "submit" ? void perform(action) : (setChoice(action), setReason(""), setLocalError(null))}>{text[action]}</button>)}
      <button type="button" className="button secondary" disabled={workflow.pending || preparing || disabled || Boolean(draft?.dirty && !onReload)} onClick={() => void reload()}>{text.refresh}</button>
    </div>
    {choice && item && <DetailDialog dialogId={id} title={`${text[choice]} · ${label}`} onClose={() => { if (!workflow.pending && !preparing) setChoice(null); }}>
      <form className="workflow-form" onSubmit={event => { event.preventDefault(); void perform(choice); }}>
        <ErrorSummary message={workflow.error || localError ? workflowFailure(workflow.error || localError) : ""} />
        <InternalExposureNotice exposure={item.ai_exposure} href={item.exposure_href} editor={item.exposure_editor} disabled={locked || Boolean(draft?.dirty)} onEditingChange={setExposureEditing} onChanged={async () => { setChoice(null); await onReload?.(); workflow.refresh(); }} />
        {choice === "approve" && workflowRequiresReason(item, choice) || choice === "save_approve" ? <p>{text.own_approval_reason}</p> : null}
        <label className="workflow-reason" htmlFor={`${id}-reason`}>{text.reason}<textarea id={`${id}-reason`} value={reason} rows={3} maxLength={2000} required={workflowRequiresReason(item, choice)} disabled={workflow.pending} onChange={event => setReason(event.target.value)} /></label>
        {workflow.stale && <p role="status">{text.draft_preserved}</p>}
        <div className="workflow-actions"><button type="button" className="button secondary" disabled={workflow.pending || preparing} onClick={() => setChoice(null)}>{text.cancel}</button><button className="button primary" disabled={locked || workflowRequiresReason(item, choice) && !reason.trim() || choice !== "save_approve" && Boolean(draft?.dirty) || choice === "save_approve" && (!draft?.valid || !sourceMatches)}>{text[choice]}</button></div>
      </form>
    </DetailDialog>}
  </section>;
}

export function SubmitAllContent({ items, disabled = false, onChanged, onBusyChange, onExposureChanged }: {
  items: SubmissionItem[]; disabled?: boolean; onChanged?: (outcomes: SubmissionOutcome[]) => void | Promise<void>; onBusyChange?: (pending: boolean) => void;
  onExposureChanged?: () => void | Promise<void>;
}) {
  const permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const [outcomes, setOutcomes] = useState<SubmissionOutcome[]>([]), [pending, setPending] = useState(false), [error, setError] = useState<unknown>(null);
  const [exposureEditing, setExposureEditing] = useState(false);
  const exposureBusy = (value: boolean) => { setExposureEditing(value); onBusyChange?.(value); };
  const busy = useRef(false), scope = useRef(authority), blocked = useRef(disabled); scope.current = authority; blocked.current = disabled;
  const completed = new Set(outcomes.filter(item => item.status === "submitted").map(item => workflowKey(item.snapshot) + item.snapshot.expected_hash));
  const eligible = items.filter(item => workflowSubmissionAllowed(permissions.capabilities, item.snapshot) && !completed.has(workflowKey(item.snapshot) + item.snapshot.expected_hash));
  useEffect(() => { setOutcomes([]); setError(null); }, [authority]);
  async function submit() {
    if (busy.current || disabled || exposureEditing || !eligible.length) return;
    busy.current = true; setPending(true); setError(null); onBusyChange?.(true);
    try {
      const result = await submitWorkflowItems(eligible, item => {
        if (scope.current !== authority) return Promise.reject({ status: 403 });
        if (blocked.current) return Promise.reject({ code: "source_changed" });
        const command = workflowSubmitCommand(item); return request<WorkflowSubmissionSnapshot>(command.path, "POST", command.body);
      });
      if (scope.current !== authority) return;
      setOutcomes(previous => [...previous.filter(item => !result.some(next => workflowKey(next.snapshot) === workflowKey(item.snapshot))), ...result]);
      await onChanged?.(result);
    } catch (error) { if (scope.current === authority) setError(error); }
    finally { busy.current = false; setPending(false); onBusyChange?.(false); }
  }
  return <section className="content-workflow" aria-label={text.submit_all}>
    {eligible.some(item => item.snapshot.ai_exposure === "internal") && <><p className="internal-edited-count">{text.internal_edited_count.replace("{n}", String(eligible.filter(item => item.snapshot.ai_exposure === "internal").length)).replace("{m}", String(eligible.length))}</p><details><summary>{text.submit_all} · <ExposureChip exposure="internal" /></summary>
      <ul>{eligible.filter(item => item.snapshot.ai_exposure === "internal").map(item => <li key={workflowKey(item.snapshot)}>{item.label}<InternalExposureNotice exposure="internal" href={item.snapshot.exposure_href} editor={item.snapshot.exposure_editor} disabled={disabled || pending} onEditingChange={exposureBusy} onChanged={async () => { await onExposureChanged?.(); }} /></li>)}</ul>
    </details></>}
    <button type="button" className="button primary" disabled={disabled || pending || exposureEditing || !eligible.length} onClick={() => void submit()}>{text.submit_all} ({eligible.length})</button>
    {pending && <p role="status">{text.loading}</p>}<ErrorSummary message={error ? workflowFailure(error) : ""} />
    {outcomes.length > 0 && <><h3>{text.submit_results}</h3><ul className="workflow-results" aria-live="polite">{outcomes.map(item => <li key={workflowKey(item.snapshot)}><strong>{publicationHref(item) ? <a href={publicationHref(item)!}>{item.label}</a> : item.label}</strong> · {item.status === "submitted" ? workflowStateLabel(item.result.state) : text.rejected}{item.status === "failed" && <p>{workflowFailure(item.error)}</p>}<InternalExposureNotice exposure={item.snapshot.ai_exposure} href={item.snapshot.exposure_href} editor={item.snapshot.exposure_editor} disabled={disabled || pending} onEditingChange={exposureBusy} onChanged={async () => { await onExposureChanged?.(); }} /></li>)}</ul></>}
  </section>;
}

export function workflowStateLabel(state: string) {
  if (state.toUpperCase() === "WITHDRAWN") return text.withdrawn;
  if (state.toUpperCase() === "ROLLED_BACK") return text.rolled_back;
  if (state.toUpperCase() === "PARTIAL") return text.partial_publication;
  return text[state.toUpperCase() as keyof typeof text] ?? text.not_approved_or_available;
}
