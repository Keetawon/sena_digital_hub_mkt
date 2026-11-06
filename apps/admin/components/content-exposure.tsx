"use client";
import { useEffect, useId, useRef, useState } from "react";
import { workspaceText as text } from "@/lib/unified-workspace";
import { workflowBase, workflowReadPath, workflowFailure, workflowText, type ExposureEditorTarget, type WorkflowSnapshot } from "@/lib/content-workflow";
import { ExposureInput, type Exposure } from "./content-common";
import { request } from "./hub-request";
import { DetailDialog } from "./registry-motion";
import { useHubPermissions } from "./accounts";
import { capabilityKey } from "@/lib/hub-permissions";
import "./content-exposure.css";

export function ExposureChip({ exposure }: { exposure?: Exposure | null }) {
  return <span className="content-exposure-chip" data-exposure={exposure ?? "source"}>{text[`exposure_${exposure ?? "source"}`]}</span>;
}

function ExposureDialog({ editor, onClose, onSaved }: { editor: ExposureEditorTarget; onClose: () => void; onSaved: (value: WorkflowSnapshot) => Promise<void> }) {
  const id = useId(), permissions = useHubPermissions(), authority = capabilityKey(permissions.account);
  const [snapshot, setSnapshot] = useState<WorkflowSnapshot | null>(null), [value, setValue] = useState<Exposure>("internal"), [error, setError] = useState<unknown>(null), [pending, setPending] = useState(false);
  const busy = useRef(false), path = workflowReadPath(editor), currentScope = path + authority, scope = useRef(currentScope); scope.current = currentScope;
  useEffect(() => { let live = true; setSnapshot(null); setError(null);
    request<WorkflowSnapshot>(path).then(item => { if (live) { setSnapshot(item); setValue(item.ai_exposure ?? "internal"); } }).catch(error => { if (live) setError(error); });
    return () => { live = false; };
  }, [path, authority]);
  const canEdit = snapshot?.can_edit && (editor.kind !== "asset" || permissions.can("projects", "edit"));
  async function save() {
    if (!snapshot || !canEdit || busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const result = await request<WorkflowSnapshot>(workflowBase + "/exposure", "POST", { ...editor, expected_hash: snapshot.expected_hash, exposure: value });
      if (scope.current === currentScope) await onSaved(result);
    } catch (error) { if (scope.current === currentScope) setError(error); }
    finally { busy.current = false; setPending(false); }
  }
  return <DetailDialog dialogId={id} title={text.change_exposure} onClose={() => { if (!busy.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>{text.exposure_draft_notice}</p>
      {error ? <p role="alert">{workflowFailure(error)}</p> : !snapshot && <p role="status">{workflowText.loading}</p>}
      {snapshot && !canEdit && <p>{workflowText.permission_required}</p>}
      <fieldset disabled={!canEdit || pending}><ExposureInput value={value} onChange={setValue} /></fieldset>
      <div className="workflow-actions"><button type="button" className="button secondary" disabled={pending} onClick={onClose}>{workflowText.cancel}</button><button className="button primary" disabled={!canEdit || pending || snapshot?.ai_exposure === value}>{workflowText.save}</button></div>
    </form>
  </DetailDialog>;
}

export function InternalExposureNotice({ exposure, href, editor, disabled = false, onChanged, onEditingChange }: {
  exposure?: Exposure | null; href?: string | null; editor?: ExposureEditorTarget | null; disabled?: boolean;
  onChanged?: (value: WorkflowSnapshot) => Promise<void> | void; onEditingChange?: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false), callback = useRef(onEditingChange), returnFocus = useRef<HTMLElement | null>(null), opener = useRef<HTMLButtonElement>(null); callback.current = onEditingChange;
  useEffect(() => { callback.current?.(open); return () => callback.current?.(false); }, [open]);
  useEffect(() => { setOpen(false); }, [exposure, editor?.kind, editor?.identity.id]);
  if (exposure !== "internal") return null;
  return <><p className="content-exposure-notice" role="note">{text.internal_notice}{editor ? <> <button ref={opener} type="button" className="content-exposure-edit" disabled={disabled && !open} onClick={event => { returnFocus.current = event.currentTarget.closest<HTMLElement>(".content-workflow, [data-publication-item], article"); setOpen(true); }}>{text.change_exposure}</button></> : href?.startsWith("/") && !href.startsWith("//") && <> <a href={href}>{text.change_exposure}</a></>}</p>
    {open && editor && <ExposureDialog editor={editor} onClose={() => { setOpen(false); requestAnimationFrame(() => opener.current?.focus()); }} onSaved={async value => {
      await onChanged?.(value); setOpen(false);
      requestAnimationFrame(() => { const destination = returnFocus.current; if (destination?.isConnected) { destination.tabIndex = -1; destination.focus(); } });
    }} />}</>;
}
