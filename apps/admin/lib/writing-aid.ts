// Thai copy is copied verbatim from docs/47 sections 8.3 and 8.5.
export const writingText = {
  "writing_enabled": "เปิดใช้ผู้ช่วยร่างข้อความ",
  "loading": "กำลังโหลดข้อมูล…",
  "before": "ก่อนเปลี่ยนแปลง",
  "after": "หลังเปลี่ยนแปลง",
  "thai": "ภาษาไทย",
  "english": "ภาษาอังกฤษ",
  "refresh": "โหลดข้อมูลล่าสุด",
  "stale_item": "รายการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุด",
  "permission_required": "ไม่มีสิทธิ์ดำเนินการนี้",
  "draft_preserved": "เก็บข้อมูลที่คุณแก้ไขไว้แล้ว",
  "load_error": "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่",
  "writing_unavailable": "ช่องนี้ยังไม่เปิดให้ผู้ช่วยร่างข้อความ",
  "writing_unsaved": "บันทึกหรือโหลดข้อมูลล่าสุดก่อนขอให้ช่วยร่างข้อความ",
  "writing_ambiguous": "ยังยืนยันผลไม่ได้ ระบบจะไม่ลองซ้ำอัตโนมัติ กรุณาตรวจสถานะ",
  "writing_processing": "กำลังเตรียมข้อเสนอข้อความ",
  "writing_accept": "ยอมรับและบันทึกฉบับร่าง",
  "writing_reject": "ไม่ใช้ข้อเสนอนี้",
  "writing_saved": "บันทึกข้อเสนอเป็นฉบับร่างแล้ว",
  "writing_save_failed": "บันทึกไม่สำเร็จ ข้อเสนอยังอยู่ กรุณาตรวจข้อมูลก่อนลองอีกครั้ง",
  "writing_protected_invalid": "ข้อเสนอเปลี่ยนข้อความที่ต้องคงไว้ จึงไม่สามารถใช้ข้อเสนอนี้ได้",
  "draft": "ร่างจากข้อมูล",
  "proofread": "ตรวจคำและไวยากรณ์",
  "shorten": "ปรับให้กระชับ"
} as const;

// Match the server's finite marketing-only veto. A flag cannot enable other fields.
export const writingTopics = new Set(["identity", "brand", "design", "location", "transport", "nearby", "facilities",
  "parking_security", "unit_types", "sustainability", "technology", "construction_progress"]);
export const writingFieldKeys = new Set([
  "project.meta_title", "project.meta_description", "brand.description",
  "section.project_intro", "section.selling_summary", "section.concept_name", "section.concept_detail",
  "section.location_summary", "section.corporate_intro", "section.corporate_services",
  "section.business_overview", "section.business_services", "section.business_packages",
  "section.business_process", "section.business_warranty",
  "section.business_overview", "section.business_services", "section.business_packages", "section.business_process", "section.business_warranty",
  "selling_point.title", "selling_point.detail", "faq.question", "faq.alt_questions", "faq.short_answer", "faq.detail",
  "facility.description", "commercial_type.description", "commercial_type.highlights",
  "article.title", "article.excerpt", "article.seo_title", "article.seo_description",
]);
export function writingFieldSafe(field: { field_key: string; source_policy: string; value_kind: string }) {
  return writingFieldKeys.has(field.field_key) && field.source_policy === "mkt" && ["text", "rich", "list"].includes(field.value_kind);
}
export type WritingMode = "draft" | "proofread" | "shorten";
export type WritingLanguage = "th" | "en";
export type WritingBinding = {
  translation_id: string; revision: number; th_version: number;
  owner_type: string; owner_key: string; field_key: string;
};
export type WritingContext = { translation_id: string; expected_revision: number };
export type WritingDraftStamp = { revision?: number; updated_at?: string };
export type WritingSnapshot = {
  binding: WritingBinding; fieldKey: string; enabled: boolean; canEdit: boolean;
  language: WritingLanguage; value: string; savedValue: string; formDirty: boolean;
  draftStamp: WritingDraftStamp; authorityKey: string; maxLength?: number;
  context?: readonly WritingContext[];
};
export type WritingRequest = {
  request_id: string; expected_revision: number; language: WritingLanguage;
  mode: WritingMode; context: WritingContext[];
};
export type WritingRequestStatus = {
  id: string; translation_id: string; source_revision: number; language: WritingLanguage;
  mode: WritingMode; context: WritingContext[]; status: "running" | "ambiguous" | "done" | "failed" | "budget_exhausted";
  error_code?: "provider_error" | "invalid_output" | "source_changed" | "permission_revoked" | "budget_exhausted" | null;
  synthetic: boolean; model: string; input_tokens: number; output_tokens: number;
  elapsed_ms: number | null; completed_at: string | null; replayed?: boolean; message?: string;
};
export type WritingState = {
  translation_id: string; revision: number; eligible: boolean; editable: boolean;
  budget: { status: "available" | "budget_exhausted"; synthetic: boolean; message?: string;
    month: string; cap_usd: number | string; spent_usd: number | string; remaining_usd: number | string;
    ceiling_usd: number | string; model: string };
  requests: WritingRequestStatus[];
};
export type WritingResult = WritingRequestStatus & {
  proposal?: { before: string; after: string; source: WritingBinding & { row_ref: Record<string, unknown> }; acceptance: "ordinary_draft_save" };
};
export type WritingReview = { request: WritingRequest; snapshot: WritingSnapshot; result: WritingResult; before: string; after: string };
export type WritingAcceptance = {
  requestId: string; source: WritingBinding; language: WritingLanguage;
  before: string; after: string; expectedDraft: WritingDraftStamp;
};
export type WritingBlock = "permission" | "unavailable" | "dirty" | "stale" | "budget" | "ambiguous" | "protected";
export class WritingAidError extends Error {
  constructor(public readonly code: WritingBlock) { super(code); this.name = "WritingAidError"; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUuid = (value: unknown): value is string => typeof value === "string" && uuid.exec(value)?.[0] === value;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export function writingPath(translationId: string): string {
  if (!validUuid(translationId)) throw new WritingAidError("unavailable");
  return `v1/admin/content/writing-aid/${translationId}`;
}
function validStamp(value: WritingDraftStamp): boolean {
  return (value.revision !== undefined || value.updated_at !== undefined)
    && (value.revision === undefined || positive(value.revision))
    && (value.updated_at === undefined || typeof value.updated_at === "string" && Number.isFinite(Date.parse(value.updated_at)));
}
function sameStamp(a: WritingDraftStamp, b: WritingDraftStamp): boolean {
  return validStamp(a) && validStamp(b) && a.revision === b.revision && a.updated_at === b.updated_at;
}
export function writingIdentity(value: WritingSnapshot): string {
  const b = value.binding;
  return JSON.stringify([value.authorityKey, b.translation_id, b.revision, b.th_version, b.owner_type, b.owner_key, b.field_key, value.language]);
}
export function writingBlock(value: WritingSnapshot, state: WritingState | null): WritingBlock | null {
  const b = value.binding;
  if (value.canEdit !== true || !value.authorityKey) return "permission";
  if (value.enabled !== true || !validUuid(b.translation_id) || !positive(b.revision) || !positive(b.th_version)
      || b.field_key !== value.fieldKey || !b.owner_type || !b.owner_key || !validStamp(value.draftStamp)) return "unavailable";
  if (value.formDirty || value.value !== value.savedValue) return "dirty";
  if (!state || state.eligible !== true || state.editable !== true || state.budget?.synthetic !== true) return "unavailable";
  if (state.translation_id !== b.translation_id || state.revision !== b.revision) return "stale";
  if (state.budget.status === "budget_exhausted") return "budget";
  if (state.budget.status !== "available") return "unavailable";
  return null;
}
export function writingModeAvailable(value: WritingSnapshot, mode: WritingMode): boolean {
  return mode === "draft" ? Boolean(value.context?.length) : Boolean(value.value.trim());
}
export function writingRequest(value: WritingSnapshot, mode: WritingMode, requestId: string): WritingRequest {
  if (!writingModeAvailable(value, mode) || !validUuid(requestId) || !["draft", "proofread", "shorten"].includes(mode)
      || !["th", "en"].includes(value.language) || !positive(value.binding.revision)) throw new WritingAidError("unavailable");
  const context = mode === "draft" ? (value.context ?? []).map(item => ({ translation_id: item.translation_id, expected_revision: item.expected_revision })) : [];
  if (context.length > 8 || context.some(item => !validUuid(item.translation_id) || !positive(item.expected_revision)
      || item.translation_id === value.binding.translation_id) || new Set(context.map(item => item.translation_id)).size !== context.length) throw new WritingAidError("unavailable");
  return { request_id: requestId, expected_revision: value.binding.revision, language: value.language, mode, context };
}
export function writingReview(result: WritingResult, request: WritingRequest, snapshot: WritingSnapshot): WritingReview {
  if (result.status === "budget_exhausted") throw new WritingAidError("budget");
  if (result.error_code === "permission_revoked") throw new WritingAidError("permission");
  if (result.error_code === "source_changed") throw new WritingAidError("stale");
  if (result.error_code === "invalid_output") throw new WritingAidError("protected");
  const p = result.proposal, b = snapshot.binding;
  if (result.status !== "done" || result.replayed || !p || result.error_code || result.synthetic !== true) throw new WritingAidError("ambiguous");
  if (result.id !== request.request_id || result.translation_id !== b.translation_id || result.source_revision !== b.revision
      || result.language !== request.language || result.mode !== request.mode || JSON.stringify(result.context) !== JSON.stringify(request.context)
      || p.acceptance !== "ordinary_draft_save" || !p.source || Object.entries(b).some(([key, value]) => p.source[key as keyof WritingBinding] !== value)) throw new WritingAidError("stale");
  const maximum = snapshot.maxLength ?? 12000;
  if (typeof p.before !== "string" || typeof p.after !== "string" || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 12000
      || Array.from(p.after).length > maximum || p.before !== snapshot.savedValue || p.before !== snapshot.value) throw new WritingAidError("stale");
  // The server validates protected numbers/placeholders against source and context.
  // Retain the exact validated strings; never normalize, render HTML or store them.
  return { request: { ...request, context: request.context.map(item => ({ ...item })) },
    snapshot: { ...snapshot, binding: { ...b }, draftStamp: { ...snapshot.draftStamp }, context: snapshot.context?.map(item => ({ ...item })) },
    result, before: p.before, after: p.after };
}
export function writingReviewBlock(review: WritingReview, current: WritingSnapshot, state: WritingState | null): WritingBlock | null {
  const block = writingBlock(current, state);
  // A later budget refusal does not invalidate an already reviewed proposal.
  if (block && block !== "budget") return block;
  if (writingIdentity(current) !== writingIdentity(review.snapshot) || !sameStamp(current.draftStamp, review.snapshot.draftStamp)
      || current.value !== review.before || current.savedValue !== review.before
      || review.request.mode === "draft" && JSON.stringify(current.context ?? []) !== JSON.stringify(review.snapshot.context ?? [])) return "stale";
  return null;
}
export async function acceptWritingReview(review: WritingReview, current: () => WritingSnapshot,
  readState: (translationId: string) => Promise<WritingState>, saveDraft: (value: WritingAcceptance) => Promise<void>): Promise<void> {
  const state = await readState(review.snapshot.binding.translation_id);
  // The retained diff keeps its original context; revalidate those references
  // before saving. Context needs current View access and eligibility, not Edit.
  for (const reference of review.request.mode === "draft" ? review.request.context : []) {
    const context = await readState(reference.translation_id);
    if (context.translation_id !== reference.translation_id || context.revision !== reference.expected_revision) throw new WritingAidError("stale");
    if (context.eligible !== true) throw new WritingAidError("unavailable");
  }
  const block = writingReviewBlock(review, current(), state);
  if (block) throw new WritingAidError(block);
  // The caller must make its ordinary revision-checked draft save, with this
  // original form stamp. A newly fetched workflow hash cannot replace that stamp.
  await saveDraft({ requestId: review.request.request_id, source: { ...review.snapshot.binding },
    language: review.request.language, before: review.before, after: review.after, expectedDraft: { ...review.snapshot.draftStamp } });
}
export function writingDiff(before: string, after: string) {
  const a = Array.from(before), b = Array.from(after); let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { prefix: a.slice(0, start).join(""), before: a.slice(start, a.length - end).join(""),
    after: b.slice(start, b.length - end).join(""), suffix: end ? a.slice(a.length - end).join("") : "" };
}
