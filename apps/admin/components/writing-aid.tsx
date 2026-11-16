"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { request } from "./hub-request";
import { mediaAiText } from "./media-ai-text";
import { acceptWritingReview, WritingAidError, writingBlock, writingDiff, writingIdentity, writingPath,
  writingModeAvailable, writingRequest, writingReview, writingReviewBlock, writingText as text,
  type WritingAcceptance, type WritingBinding, type WritingBlock, type WritingContext, type WritingDraftStamp,
  type WritingLanguage, type WritingMode, type WritingResult, type WritingReview, type WritingSnapshot, type WritingState } from "../lib/writing-aid";
import "./writing-aid.css";

/** Mount inside an existing client editor, beside one persisted locale field.
 * onAccept must use the ordinary writer and expectedDraft; it must not submit,
 * approve, publish, or merely patch local form text. No provider request is retried.
 */
export type WritingAidProps = {
  field: { field_key: string; label: { th?: string; en?: string }; ai_writing_enabled?: boolean };
  binding: WritingBinding | null; language: WritingLanguage; value: string; savedValue: string;
  draftStamp: WritingDraftStamp; formDirty: boolean; canEdit: boolean; authorityKey: string;
  maxLength?: number; context?: readonly WritingContext[]; disabled?: boolean;
  onActivityChange?: (active: boolean) => void;
  onAccept: (acceptance: WritingAcceptance) => Promise<void>;
};
function message(code: WritingBlock): string {
  return { permission: text.permission_required, unavailable: text.writing_unavailable, dirty: text.writing_unsaved,
    stale: text.stale_item, budget: mediaAiText.state_budget, ambiguous: text.writing_ambiguous, protected: text.writing_protected_invalid }[code];
}
function failure(error: unknown, fallback: WritingBlock): WritingBlock {
  if (error instanceof WritingAidError) return error.code;
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403 || status === 404 ? "permission" : status === 409 ? "stale" : fallback;
}
export function WritingAid(props: WritingAidProps) {
  const id = useId(), region = useRef<HTMLElement>(null), panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null), restoreFocus = useRef(false);
  const snapshot: WritingSnapshot | null = props.binding ? { binding: props.binding, fieldKey: props.field.field_key,
    enabled: props.field.ai_writing_enabled === true, canEdit: props.canEdit, language: props.language,
    value: props.value, savedValue: props.savedValue, draftStamp: props.draftStamp, formDirty: props.formDirty,
    authorityKey: props.authorityKey, maxLength: props.maxLength, context: props.context } : null;
  const latest = useRef(snapshot); latest.current = snapshot;
  const identity = snapshot ? writingIdentity(snapshot) : "", enabled = props.field.ai_writing_enabled === true && props.canEdit && !!snapshot;
  const epoch = useRef(0), readSequence = useRef(0), mutation = useRef<number | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; value: WritingState } | null>(null);
  const [review, setReview] = useState<WritingReview | null>(null), [busy, setBusy] = useState<"read" | "request" | "save" | null>(null);
  const [issue, setIssue] = useState<WritingBlock | null>(null), [readError, setReadError] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false), [notice, setNotice] = useState("");
  const readState = useCallback(async (translationId?: string) => {
    const current = latest.current;
    if (!current || !enabled || writingIdentity(current) !== identity) throw new WritingAidError("permission");
    return request<WritingState>(writingPath(translationId ?? current.binding.translation_id));
  }, [identity, enabled]);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const version = epoch.current, sequence = ++readSequence.current;
    setReadError(false); setBusy(current => current ?? "read");
    try {
      const value = await readState();
      if (epoch.current !== version || readSequence.current !== sequence) return;
      setLoaded({ key: identity, value }); setIssue(null); setSaveFailed(false);
      if (!value.eligible || !value.editable) setReview(null);
    } catch (error) {
      if (epoch.current !== version || readSequence.current !== sequence) return;
      setLoaded(null);
      const code = failure(error, "unavailable");
      if (code === "permission") { setReview(null); setIssue(code); } else setReadError(true);
    } finally {
      if (epoch.current === version && readSequence.current === sequence) setBusy(current => current === "read" ? null : current);
    }
  }, [enabled, identity, readState]);
  useEffect(() => {
    epoch.current++; mutation.current = null; setLoaded(null); setReview(null); setIssue(null);
    setReadError(false); setNotice(""); setSaveFailed(false); setBusy(null);
    if (enabled) void refresh();
    const recheck = () => { if (document.visibilityState !== "hidden") void refresh(); };
    window.addEventListener("focus", recheck); window.addEventListener("hub-accounts-changed", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => { epoch.current++; readSequence.current++;
      window.removeEventListener("focus", recheck); window.removeEventListener("hub-accounts-changed", recheck);
      document.removeEventListener("visibilitychange", recheck); };
  }, [enabled, refresh]);
  const state = loaded?.key === identity ? loaded.value : null;
  const visibleReview = review && writingIdentity(review.snapshot) === identity && issue !== "permission" && issue !== "unavailable"
    && state?.eligible !== false && state?.editable !== false ? review : null;
  useEffect(() => { if (visibleReview) panel.current?.focus(); }, [visibleReview]);
  useEffect(() => {
    if (!visibleReview && busy === null && restoreFocus.current) {
      restoreFocus.current = false;
      if (opener.current && !opener.current.disabled) opener.current.focus(); else region.current?.focus();
    }
  }, [visibleReview, busy]);
  const recent = state?.requests?.filter(item => item.source_revision === snapshot?.binding.revision);
  const running = recent?.some(item => item.status === "running");
  const unresolved = recent?.[0]?.status === "ambiguous";
  const activity = busy === "request" || busy === "save" || !!visibleReview || issue === "ambiguous" || !!running;
  const activityCallback = useRef(props.onActivityChange); activityCallback.current = props.onActivityChange;
  useEffect(() => { activityCallback.current?.(activity); }, [activity]);
  useEffect(() => () => activityCallback.current?.(false), []);
  if (!enabled || !snapshot) return null;
  const block = writingBlock(snapshot, state), reviewBlock = visibleReview ? writingReviewBlock(visibleReview, snapshot, state) : null;
  const denied = issue === "permission", blocked = issue ?? (readError ? null : block);
  const pending = busy !== null || mutation.current !== null;
  const description = readError ? text.load_error : blocked ? message(blocked)
    : unresolved && !pending && !visibleReview ? text.writing_ambiguous : "";
  const language = props.language === "th" ? text.thai : text.english;
  const label = props.field.label.th || props.field.label.en || props.field.field_key;
  const diff = visibleReview ? writingDiff(visibleReview.before, visibleReview.after) : null;
  function currentSnapshot(): WritingSnapshot {
    const value = latest.current;
    if (!value || !value.enabled || !value.canEdit || writingIdentity(value) !== identity) throw new WritingAidError("permission");
    return value;
  }
  async function propose(mode: WritingMode, button: HTMLButtonElement) {
    if (props.disabled || mutation.current !== null || busy || running || visibleReview || denied || !writingModeAvailable(currentSnapshot(), mode)) return;
    const current = currentSnapshot(), reason = writingBlock(current, state);
    if (reason) { setIssue(reason); return; }
    const version = epoch.current; mutation.current = version; opener.current = button;
    setBusy("request"); setIssue(null); setNotice(""); setSaveFailed(false);
    try {
      const body = writingRequest(current, mode, crypto.randomUUID());
      // A single explicit POST; refresh/focus/error handling never repeats it.
      const result = await request<WritingResult>(`${writingPath(current.binding.translation_id)}/proposals`, "POST", body);
      if (epoch.current !== version) return;
      const next = writingReview(result, body, current);
      if (writingIdentity(currentSnapshot()) !== writingIdentity(next.snapshot)) throw new WritingAidError("stale");
      setReview(next); void refresh();
    } catch (error) {
      if (epoch.current === version) { const code = failure(error, "ambiguous"); setIssue(code); if (code === "permission") { setReview(null); setLoaded(null); } }
    } finally {
      if (epoch.current === version) { mutation.current = null; setBusy(null); }
    }
  }
  function reject() {
    if (mutation.current !== null) return;
    restoreFocus.current = true; setReview(null); setIssue(null); setSaveFailed(false); setNotice("");
  }
  async function accept() {
    if (props.disabled || !visibleReview || mutation.current !== null || busy || saveFailed || reviewBlock) return;
    const version = epoch.current; mutation.current = version; setBusy("save"); setIssue(null); setNotice("");
    try {
      await acceptWritingReview(visibleReview, () => {
        if (epoch.current !== version) throw new WritingAidError("permission");
        return currentSnapshot();
      }, readState, props.onAccept);
      if (epoch.current !== version) return;
      restoreFocus.current = true; setReview(null); setNotice(text.writing_saved); setLoaded(null);
    } catch (error) {
      if (epoch.current !== version) return;
      const code = failure(error, "unavailable");
      if (code === "permission" || code === "unavailable" && error instanceof WritingAidError) { setReview(null); setLoaded(null); setIssue(code); }
      else if (code === "stale" || error instanceof WritingAidError) setIssue(code);
      else setSaveFailed(true);
    } finally {
      if (epoch.current === version) { mutation.current = null; setBusy(null); }
    }
  }
  return <section className="writing-aid" ref={region} tabIndex={-1} aria-label={`${label}: ${language}`} aria-busy={pending} data-writing-field={props.field.field_key} data-writing-language={props.language}>
    <div className="writing-aid-actions" aria-describedby={description ? `${id}-status` : undefined}>
      <span className="writing-aid-language">{language}</span>
      {(["draft", "proofread", "shorten"] as const).map(mode => <button key={mode} type="button" className="writing-aid-button"
        disabled={props.disabled || pending || !!block || !!issue || !!visibleReview || !!running || !writingModeAvailable(snapshot, mode)}
        onClick={event => void propose(mode, event.currentTarget)}>{text[mode]}</button>)}
    </div>
    {busy && <p role="status">{busy === "request" ? text.writing_processing : text.loading}</p>}
    {running && !busy && <p role="status">{text.writing_processing}</p>}
    {description && <p id={`${id}-status`} className="writing-aid-message" role={denied || readError ? "alert" : "status"}>{description}</p>}
    {(readError || issue || saveFailed || running || unresolved || block === "stale") && <div className="writing-aid-actions">
      <button type="button" className="writing-aid-button" disabled={pending} onClick={() => void refresh()}>{text.refresh}</button>
      {issue === "ambiguous" && <button type="button" className="writing-aid-button" disabled={pending} onClick={reject}>{text.writing_reject}</button>}
    </div>}
    {visibleReview && diff && <div className="writing-aid-review" ref={panel} tabIndex={-1} aria-labelledby={`${id}-review`}>
      <h4 id={`${id}-review`}>{text[visibleReview.request.mode]} ({language})</h4>
      <div className="writing-aid-diff" lang={props.language}>
        <section aria-labelledby={`${id}-before`}><h5 id={`${id}-before`}>{text.before}</h5><p>{diff.prefix}<del>{diff.before}</del>{diff.suffix}</p></section>
        <section aria-labelledby={`${id}-after`}><h5 id={`${id}-after`}>{text.after}</h5><p>{diff.prefix}<ins>{diff.after}</ins>{diff.suffix}</p></section>
      </div>
      {reviewBlock && <p role="alert">{message(reviewBlock)} {text.draft_preserved}</p>}
      {saveFailed && <p role="alert">{text.writing_save_failed}</p>}
      <div className="writing-aid-actions"><button type="button" className="writing-aid-button" disabled={pending} onClick={reject}>{text.writing_reject}</button>
        <button type="button" className="writing-aid-button writing-aid-accept" disabled={props.disabled || pending || !!reviewBlock || saveFailed || !!issue} onClick={() => void accept()}>{text.writing_accept}</button></div>
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
