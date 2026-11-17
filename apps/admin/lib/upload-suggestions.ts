import { uploadText } from "./upload-text";
import type { Metadata, MediaTag } from "../components/media-common";
import type { UploadEvidence } from "./upload-context";
export type FileSuggestionField = "caption" | "credit" | "taken_at" | "image_kind" | "tags" | "stock";
export function useFileSuggestion(current: Metadata, evidence: UploadEvidence, field: FileSuggestionField, tags: readonly MediaTag[]): Metadata {
  if (evidence.suggestions.source !== "file_metadata" || evidence.suggestions.confirmed !== false) return current;
  const values = evidence.suggestions.values;
  let patch: Partial<Metadata> | null = null;
  if (field === "caption" && typeof values.caption === "string") patch = { caption: { ...current.caption, th: values.caption } };
  if (field === "credit" && typeof values.credit === "string" && values.credit.length <= 500) patch = { credit: { ...current.credit, th: values.credit } };
  if (field === "taken_at" && values.taken_at) patch = { taken_at: values.taken_at.value.slice(0, 10) };
  if (field === "image_kind" && values.image_kind) patch = { image_kind: values.image_kind };
  if (field === "stock" && values.stock === "present") patch = { image_kind: "stock" };
  if (field === "tags" && values.tags) patch = { tags: values.tags.filter(code => tags.some(tag => tag.code === code && tag.status === "active" && (!tag.allowed_categories.length || tag.allowed_categories.includes(current.media_category)))) };
  return patch ? { ...current, ...patch, metadata_state: "needs_review" } : current;
}

export function stockEvidenceLabels(codes: readonly string[]): string[] {
  const labels: Record<string, string> = { stock_1: uploadText.stock_1, stock_2: uploadText.stock_2, stock_3: uploadText.stock_3, stock_4: uploadText.stock_4 };
  return [...new Set(codes)].flatMap(code => Object.hasOwn(labels, code) ? [labels[code]] : []);
}
