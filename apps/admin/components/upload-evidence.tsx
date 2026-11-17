"use client";
import { useEffect, useRef, useState } from "react";
import { uploadContextHeader, type UploadContext, type UploadEvidence } from "../lib/upload-context";
import { uploadText as text } from "../lib/upload-text";
import { stockEvidenceLabels, useFileSuggestion, type FileSuggestionField } from "../lib/upload-suggestions";
import type { MediaTag, Metadata } from "./media-common";

function fileFacts(value: UploadEvidence["original"]) {
  const size = value.size < 1024 ? value.size + " B" : value.size < 1024 * 1024 ? (value.size / 1024).toFixed(1) + " KB" : (value.size / (1024 * 1024)).toFixed(2) + " MB";
  return size + (value.width && value.height ? " · " + value.width + " × " + value.height : "");
}
export function UploadResult({ value }: { value?: UploadEvidence | null }) {
  if (!value) return null;
  return <p className="field-help upload-result">{text.original} {fileFacts(value.original)} → {text.stored} {fileFacts(value.stored)}
    {value.processing.kept_unchanged_legal ? " · " + text.unchanged : value.processing.metadata_stripped ? " · " + text.metadata_removed : ""}</p>;
}
export function FileMetadataSuggestions({ evidence, value, tags = [], onChange }: { evidence?: UploadEvidence | null; value?: Metadata; tags?: readonly MediaTag[]; onChange?: (value: Metadata) => void }) {
  if (!evidence || evidence.suggestions.source !== "file_metadata" || evidence.suggestions.confirmed !== false) return null;
  const suggested = evidence.suggestions.values;
  const stockSources = stockEvidenceLabels(suggested.stock_evidence ?? []);
  const use = (field: FileSuggestionField) => value && onChange?.(useFileSuggestion(value, evidence, field, tags));
  const button = (field: FileSuggestionField, disabled = false) => value && onChange && <button type="button" className="button secondary" disabled={disabled} onClick={() => use(field)}>{text.use}</button>;
  return <section className="media-suggestion file-metadata-suggestions" aria-label={text.file_suggestions}><h4>{text.file_suggestions}</h4>
    {suggested.caption && <div><p>{text.caption}: {suggested.caption}</p>{button("caption")}</div>}
    {suggested.credit && <div><p>{text.credit}: {suggested.credit}</p>{button("credit", suggested.credit.length > 500)}{suggested.credit.length > 500 && <p className="field-help">{text.credit_too_long}</p>}</div>}
    {suggested.taken_at && <div><p>{text.taken_at}: {suggested.taken_at.value}{!suggested.taken_at.offset_known && " · " + text.offset_unknown}</p>{button("taken_at")}</div>}
    {suggested.image_kind && <div><p>{text.image_kind}: {suggested.image_kind === "photo" ? text.photo : text.render}</p>{button("image_kind")}</div>}
    {!!suggested.tags?.length && <div><p>{text.tags}: {suggested.tags.map(code => tags.find(tag => tag.code === code)?.label.th ?? code).join(" · ")}</p>{button("tags")}</div>}
    {!!suggested.unmapped_keywords?.length && <p>{text.keywords}: {suggested.unmapped_keywords.join(" · ")}</p>}
    {suggested.proximity && <p>{text.proximity}: {text[suggested.proximity]}</p>}
    {suggested.stock === "present" && <div><p>{text.stock}</p>{button("stock")}{!!stockSources.length && <p>{text.stock_evidence}: {stockSources.join(" · ")}</p>}</div>}
    {!!suggested.credit_evidence?.length && <div><p>{text.credit_evidence}</p><ul>{suggested.credit_evidence.map((item, index) => <li key={index}>{item.text}</li>)}</ul></div>}
    {onChange && <p className="field-help">{text.unconfirmed}</p>}
  </section>;
}
export async function readUploadEvidence(assetId: string, context: UploadContext): Promise<UploadEvidence | null> {
  const response = await fetch("/api/hub/v1/admin/assets/" + encodeURIComponent(assetId), { cache: "no-store", headers: { "X-Upload-Context": uploadContextHeader(context) } });
  const result = await response.json().catch(() => null);
  if (!response.ok && result?.error?.invalidate_access === true) window.dispatchEvent(new Event("hub-content-access-invalidated"));
  if (!response.ok) throw new Error(text.evidence_error);
  return result?.meta?.upload ?? null;
}
export function UploadEvidencePanel({ assetId, context, value, tags, onChange }: { assetId: string; context: UploadContext; value?: Metadata; tags?: readonly MediaTag[]; onChange?: (value: Metadata) => void }) {
  const key = JSON.stringify([assetId, context]), latest = useRef(key); latest.current = key;
  const [loaded, setLoaded] = useState<{ key: string; value: UploadEvidence | null } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => { sequence.current++; setLoaded(null); setBusy(false); setError(""); return () => { sequence.current++; }; }, [key]);
  async function load() {
    if (busy) return;
    const read = ++sequence.current; setBusy(true); setError("");
    try {
      const upload = await readUploadEvidence(assetId, context);
      if (latest.current === key && sequence.current === read) setLoaded({ key, value: upload });
    } catch { if (latest.current === key && sequence.current === read) { setLoaded(null); setError(text.evidence_error); } }
    finally { if (latest.current === key && sequence.current === read) setBusy(false); }
  }
  const evidence = loaded?.key === key ? loaded : null;
  return <div className="upload-evidence"><button type="button" className="button secondary" disabled={busy} onClick={() => void load()}>{text.evidence_load}</button>
    {error && <p role="alert">{error}</p>}
    {evidence && (evidence.value ? <><UploadResult value={evidence.value} /><FileMetadataSuggestions evidence={evidence.value} value={value} tags={tags} onChange={onChange} /></> : <p>{text.evidence_none}</p>)}
  </div>;
}
