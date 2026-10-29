"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { request } from "./hub-request";
import { errorMessage } from "./content-common";
import { categoryLabels, type MediaAsset } from "./media-common";
import { mediaAiText as text } from "./media-ai-text";

export type MediaAiBudget = { cap_usd: number; spent_usd: number; remaining_usd: number; ceiling_usd: number; provider_configured: boolean; budget_exhausted: boolean };
export type MediaAiJob = { id: string; kind: string; subject_id: string; source_revision: number; status: string; error_code: string | null };
export const MediaAiContext = createContext<{ base: string; budget: MediaAiBudget | null; jobs: MediaAiJob[]; refresh: () => Promise<void> } | null>(null);

export function MediaAiButton({ asset, canEdit, showSuggestion = false }: { asset: MediaAsset; canEdit: boolean; showSuggestion?: boolean }) {
  const context = useContext(MediaAiContext), [posted, setPosted] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { setPosted(""); setError(""); }, [asset.id, asset.media_revision]);
  if (!canEdit || !asset.marketing_publication || asset.ai_exposure === "internal" || !asset.mime_type.startsWith("image/") || !asset.media_category || ["legal_document", "brochure"].includes(asset.media_category)) return null;
  const budget = context?.budget, job = context?.jobs.find(j => j.kind === "image_suggestion" && j.subject_id === asset.id && j.source_revision === asset.media_revision);
  const state = job?.status || posted || "", done = asset.ai_suggestion?.source_revision === asset.media_revision;
  const exhausted = budget?.budget_exhausted || budget && Number(budget.remaining_usd) < Number(budget.ceiling_usd);
  const waiting = busy || state === "queued" || state === "running";
  const label = done ? text.button_label : !budget?.provider_configured ? text.state_not_configured : exhausted ? text.state_budget : waiting ? text.state_waiting : text.button_label;
  const disabled = !context || !budget?.provider_configured || !!exhausted || waiting || done;
  async function ask() {
    if (!context || disabled) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ status: string }>(`${context.base}/jobs`, "POST", { kind: "image_suggestion", subject_id: asset.id, expected_revision: asset.media_revision });
      setPosted(result.status); await context.refresh();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <div className="media-ai-footer" data-ai-state={done ? "done" : !budget?.provider_configured ? "not_configured" : exhausted ? "budget_exhausted" : waiting ? "waiting" : state || "ready"}>
    {showSuggestion && asset.ai_suggestion && <div className="media-suggestion"><h4>คำแนะนำ AI · ยังไม่ยืนยัน</h4><p>{categoryLabels[asset.ai_suggestion.media_category]} · {asset.ai_suggestion.caption.th}</p><p>{asset.ai_suggestion.alt_text.th}</p><p>{asset.ai_suggestion.tags.join(" · ")}</p></div>}
    <button type="button" className="media-ai-action" disabled={disabled} onClick={() => void ask()}>{done && <span aria-hidden="true">✓ </span>}{label}</button>
    <p className="field-help">{text.hint}</p>
    {budget && <p className="field-help media-ai-budget">{text.budget_spent_label} US${Number(budget.spent_usd).toFixed(2)} · {text.budget_remaining_label} US${Number(budget.remaining_usd).toFixed(2)}</p>}
    {waiting && budget?.provider_configured && !exhausted && <span className="sr-only" role="status">{text.state_waiting}</span>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </div>;
}
