import { can, type CapabilityProjection } from "./hub-permissions";

// Copied verbatim from docs/47 sections 4.2, 5 and 8.5.
export const workflowText = {
  "website_publication": "เผยแพร่เว็บไซต์",
  "data_publication": "ชุดเผยแพร่ข้อมูล",
  "publication_results": "ผลการเผยแพร่แต่ละรายการ",
  "preview": "ดูตัวอย่างหน้าเว็บ",
  "current_version": "เวอร์ชันที่เผยแพร่อยู่",
  "detail": "ดูรายละเอียด",
  "internal_edited_count": "รายการที่แก้ไข {n} จาก {m} รายการตั้งค่าให้ใช้ภายใน Hub เท่านั้น จึงไม่ปรากฏบนเว็บไซต์หรือในคำตอบของ AI",
  "publication_queue_empty": "ยังไม่มีรายการรอเผยแพร่",
  "publication_history_empty": "ยังไม่มีประวัติการเผยแพร่",
  "prepared": "เตรียมรายการแล้ว",
  "withdrawn": "ถอนแล้ว",
  "rolled_back": "ย้อนกลับแล้ว",
  "next": "ถัดไป",
  "loading": "กำลังโหลดข้อมูล…",
  "retry": "ลองใหม่",
  "empty": "ไม่พบรายการตามตัวกรอง",
  "before": "ก่อนเปลี่ยนแปลง",
  "after": "หลังเปลี่ยนแปลง",
  "needs_reapproval": "ต้องอนุมัติใหม่",
  "date": "วันที่",
  "person": "ผู้ดำเนินการ",
  "load_error": "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่",
  "reason": "เหตุผล",
  "confirm": "ยืนยัน",
  "cancel": "ยกเลิก",
  "save": "บันทึก",
  "refresh": "โหลดข้อมูลล่าสุด",
  "select_item": "เลือกรายการ",
  "clear_selection": "ล้างรายการที่เลือก",
  "prepare_review": "เตรียมตรวจรายการเผยแพร่",
  "review_publication": "ตรวจรายการก่อนเผยแพร่",
  "confirm_publication": "ยืนยันเผยแพร่",
  "partial_publication": "เผยแพร่บางรายการแล้ว โปรดตรวจรายการที่ยังไม่ผ่าน",
  "rejected": "ไม่ผ่าน",
  "stale_item": "รายการเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลล่าสุด",
  "publisher_conflict": "ผู้เผยแพร่ต้องเป็นคนละคนกับผู้แก้ไข ผู้ตรวจภาษาอังกฤษ และผู้อนุมัติฉบับนี้",
  "not_approved_or_available": "ยังไม่อนุมัติหรือไม่พร้อมเผยแพร่",
  "pointer_changed": "เวอร์ชันที่เผยแพร่เปลี่ยนแปลงแล้ว",
  "retained_source_unavailable": "เนื้อหาจากเวอร์ชันเดิมไม่พร้อมใช้งาน",
  "page_config_changed_or_unapproved": "การตั้งค่าหน้าเว็บเปลี่ยนแปลงหรือยังไม่อนุมัติ",
  "web_history": "ประวัติเผยแพร่เว็บไซต์",
  "release_history": "ประวัติชุดเผยแพร่ข้อมูล",
  "withdraw_page": "ถอนหน้าเว็บ",
  "rollback_release": "ย้อนกลับชุดเผยแพร่",
  "restore_version": "คืนเวอร์ชันนี้",
  "confirm_pointer_change": "ยืนยันเปลี่ยนเวอร์ชันที่เผยแพร่",
  "confirm_release_rollback": "ยืนยันย้อนกลับชุดเผยแพร่",
  "own_approval_reason": "ระบุเหตุผลที่อนุมัติงานที่แก้เอง",
  "submit_results": "ผลการส่งอนุมัติ",
  "version": "เวอร์ชัน",
  "thai": "ภาษาไทย",
  "english": "ภาษาอังกฤษ",
  "permission_required": "ไม่มีสิทธิ์ดำเนินการนี้",
  "draft_preserved": "เก็บข้อมูลที่คุณแก้ไขไว้แล้ว",
  "normal_review_required": "โปรโมชั่นต้องผ่านการตรวจข้อมูลและกฎหมายตามขั้นตอนเดิม",
  "DRAFT": "ร่าง",
  "IN_REVIEW": "รออนุมัติ",
  "APPROVED": "อนุมัติแล้ว",
  "PUBLISHED": "บนเว็บ",
  "RETURNED": "ถูกส่งกลับ",
  "submit_all": "ส่งอนุมัติทั้งหมดที่แก้",
  "submit": "ส่งอนุมัติ",
  "approve": "อนุมัติ",
  "publish": "เผยแพร่ขึ้นเว็บ",
  "return": "ส่งกลับ",
  "save_approve": "แก้และอนุมัติ",
  "self_approval": "อนุมัติงานที่แก้เอง",
  "withdraw": "ถอนคำตอบนี้",
  "queue": "เผยแพร่"
} as const;

export type WorkflowKind = "project" | "model" | "brand" | "faq" | "section" | "selling_point" | "contact"
  | "fact" | "building" | "facility" | "feature" | "place" | "asset" | "project_asset" | "brand_asset"
  | "type_asset" | "asset_context" | "media_link" | "media_target" | "unit_type" | "price" | "disclosure"
  | "sales_term" | "programme" | "progress" | "solar" | "article" | "question" | "glossary" | "promotion" | "page_config";
export type WorkflowTarget =
  | { kind: "question"; identity: { question_key: string } }
  | { kind: "glossary"; identity: { term_key: string } }
  | { kind: "building"; identity: { project_id: string; building_key: string } }
  | { kind: "facility"; identity: { project_id: string; facility_code: string } }
  | { kind: "selling_point"; identity: { project_id: string; point_key: string } }
  | { kind: Exclude<WorkflowKind, "question" | "glossary" | "building" | "facility" | "selling_point">; identity: { id: string } };
export type WorkflowAction = "submit" | "approve" | "return" | "withdraw" | "save_approve";
export type ExposureEditorTarget = { kind: "asset" | "asset_context" | "media_link"; identity: { id: string } };
export type WorkflowSubmissionSnapshot = WorkflowTarget & {
  ai_exposure?: "open" | "web_only" | "internal" | null; exposure_policy?: "stored" | "source"; exposure_href?: string | null; exposure_editor?: ExposureEditorTarget | null;
  source_tab: string; source_tabs: string[]; expected_hash: string; state: string;
  source_revision: number | null; source_updated_at: string | null;
  can_edit: boolean; can_submit: boolean;
};
export type WorkflowSnapshot = WorkflowSubmissionSnapshot & {
  version_id: string | null; version_no: number | null; approved_by: string | null; approved_at: string | null;
  decision_reason: string | null; self_approval: boolean; needs_reapproval: boolean;
  staged_evidence?: { approved: Record<string, unknown>; current: Record<string, unknown> } | null;
  can_approve: boolean; can_return: boolean; can_withdraw: boolean; can_save_approve: boolean; approval_requires_reason: boolean;
  history: { operation: string; actor: string | null; occurred_at: string; state: string | null; reason: string | null; self_approval: boolean | null }[];
};
export type WorkflowSourceStamp = { revision: number; updated_at?: string } | { revision?: number; updated_at: string };
export type WorkflowInput = { reason?: string; changes?: Record<string, unknown>; sourceStamp?: WorkflowSourceStamp };
export const workflowBase = "v1/admin/content-workflow";
export const publicationBase = "v1/admin/publication-queue";
export type WorkflowInventoryScope = { level: "corporate" | "business" | "brand" | "project" | "programme" | "project_group" | "unit_type"; id: string; phase?: string | null };
export type WorkflowInventoryItem = WorkflowSubmissionSnapshot & { label: PublicationLabel; target: Record<string, unknown> | null; href: string | null };
export type WorkflowInventory = { scope: WorkflowInventoryScope & { phase: string | null }; items: WorkflowInventoryItem[] };
export type WorkflowInventoryPage = WorkflowInventory & { next_cursor: string | null };
export function workflowInventoryPath(scope: WorkflowInventoryScope, after?: string | null) {
  const query = new URLSearchParams({ level: scope.level, id: scope.id, limit: "100" });
  if (scope.phase) query.set("phase", scope.phase); if (after) query.set("after", after);
  return workflowBase + "/items?" + query;
}
// Complete the bounded inventory before exposing any submit action. The server
// owns eligibility and identities; each first displayed hash is retained.
export async function loadWorkflowInventory(scope: WorkflowInventoryScope, read: (path: string) => Promise<WorkflowInventoryPage>, current: () => boolean = () => true): Promise<WorkflowInventory> {
  let resolved: WorkflowInventory["scope"] | null = null, after: string | null = null;
  const cursors = new Set<string>(), items = new Map<string, WorkflowInventoryItem>();
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    if (!current()) throw Object.assign(new Error("inventory_cancelled"), { code: "inventory_cancelled" });
    const page = await read(workflowInventoryPath(resolved ?? scope, after));
    if (!current()) throw Object.assign(new Error("inventory_cancelled"), { code: "inventory_cancelled" });
    const phaseScope = scope.level === "project" || scope.level === "unit_type";
    if (page.scope.level !== scope.level || page.scope.id !== scope.id || scope.phase != null && page.scope.phase !== scope.phase
      || resolved && page.scope.phase !== resolved.phase || (phaseScope ? typeof page.scope.phase !== "string" || !page.scope.phase : page.scope.phase !== null)
      || !Array.isArray(page.items) || page.items.length > 100) throw new Error("invalid_inventory_scope");
    resolved = page.scope;
    for (const item of page.items) {
      const key = workflowKey(item), prior = items.get(key);
      if (prior && prior.expected_hash !== item.expected_hash) throw Object.assign(new Error("source_changed"), { code: "source_changed" });
      if (!prior) items.set(key, item);
    }
    if (page.next_cursor === null) return { scope: resolved, items: [...items.values()] };
    if (typeof page.next_cursor !== "string" || !page.next_cursor || cursors.has(page.next_cursor)) throw new Error("invalid_inventory_cursor");
    cursors.add(page.next_cursor); after = page.next_cursor;
  }
  throw new Error("inventory_limit");
}
export function workflowKey(target: WorkflowTarget) {
  return target.kind + ":" + JSON.stringify(Object.fromEntries(Object.entries(target.identity).sort(([a], [b]) => a.localeCompare(b))));
}
export function workflowReadPath(target: WorkflowTarget) {
  return workflowBase + "?" + new URLSearchParams({ kind: target.kind, identity: JSON.stringify(target.identity) });
}
export function workflowSubmissionAllowed(caps: CapabilityProjection, item: WorkflowSubmissionSnapshot) {
  const tabs = item.source_tabs.length ? item.source_tabs : [item.source_tab];
  return item.kind !== "promotion" && /^[a-f0-9]{64}$/.test(item.expected_hash) && item.can_edit === true && item.can_submit === true
    && tabs.every(tab => can(caps, tab, "edit"));
}
export function workflowAllowed(caps: CapabilityProjection, item: WorkflowSnapshot | null, action: WorkflowAction) {
  if (!item || item.kind === "promotion" || !/^[a-f0-9]{64}$/.test(item.expected_hash)) return false;
  const tabs = item.source_tabs.length ? item.source_tabs : [item.source_tab];
  if (!tabs.every(tab => can(caps, tab))) return false;
  const edit = item.can_edit && tabs.every(tab => can(caps, tab, "edit"));
  const approve = tabs.every(tab => can(caps, tab, "approve"));
  if (action === "submit") return workflowSubmissionAllowed(caps, item);
  if (action === "approve") return approve && item.can_approve === true;
  if (action === "return") return approve && item.can_return === true;
  if (action === "save_approve") return edit && approve && item.can_save_approve === true;
  return item.kind === "faq" && item.can_withdraw === true && (item.state.toUpperCase() === "DRAFT" ? edit : approve);
}
export function workflowRequiresReason(item: WorkflowSnapshot, action: WorkflowAction) {
  return action === "return" || action === "withdraw" || action === "save_approve" || action === "approve" && item.approval_requires_reason !== false;
}
export function workflowMatchesSource(item: WorkflowSnapshot | null, stamp: WorkflowSourceStamp | undefined) {
  if (!item || !stamp || stamp.revision === undefined && stamp.updated_at === undefined) return false;
  return (stamp.revision === undefined || stamp.revision === item.source_revision)
    && (stamp.updated_at === undefined || stamp.updated_at === item.source_updated_at);
}
export function workflowCommand(item: WorkflowSnapshot, action: WorkflowAction, input: WorkflowInput = {}) {
  const reason = input.reason?.trim();
  if (workflowRequiresReason(item, action) && !reason) throw Object.assign(new Error("reason_required"), { code: "reason_required" });
  if (action === "save_approve" && !input.changes) throw Object.assign(new Error("draft_required"), { code: "draft_required" });
  if (action === "save_approve" && !workflowMatchesSource(item, input.sourceStamp)) throw Object.assign(new Error("source_changed"), { code: "source_changed" });
  const body = { kind: item.kind, identity: item.identity, expected_hash: item.expected_hash };
  return action === "submit" ? workflowSubmitCommand(item)
    : action === "save_approve" ? { path: workflowBase + "/save-approve", body: { ...body, changes: input.changes, reason } }
    : { path: workflowBase + "/review", body: { ...body, decision: action, ...(reason ? { reason } : {}) } };
}
export function workflowSubmitCommand(item: WorkflowSubmissionSnapshot) {
  return { path: workflowBase + "/submit", body: { kind: item.kind, identity: item.identity, expected_hash: item.expected_hash } };
}
export type SubmissionItem = { label: string; href?: string | null; snapshot: WorkflowSubmissionSnapshot };
export type SubmissionOutcome = SubmissionItem & ({ status: "submitted"; result: WorkflowSubmissionSnapshot } | { status: "failed"; error: unknown });
// Each saved item keeps its displayed hash; a conflict never cancels its neighbours.
export async function submitWorkflowItems(items: SubmissionItem[], submit: (item: WorkflowSubmissionSnapshot) => Promise<WorkflowSubmissionSnapshot>) {
  const outcomes: SubmissionOutcome[] = [], seen = new Set<string>();
  for (const item of items) {
    const key = workflowKey(item.snapshot); if (seen.has(key)) continue; seen.add(key);
    try { outcomes.push({ ...item, status: "submitted", result: await submit(item.snapshot) }); }
    catch (error) { outcomes.push({ ...item, status: "failed", error }); }
  }
  return outcomes;
}

export function workflowFailure(error: unknown) {
  const value = error as { status?: number; code?: string; message?: string } | null;
  if (value?.status === 409) return workflowText.stale_item;
  if (value?.code === "source_changed") return workflowText.stale_item;
  if (value?.status === 403) return workflowText.permission_required;
  if (value?.code === "reason_required") return workflowText.reason;
  if (value?.code === "draft_required") return workflowText.draft_preserved;
  return value?.message && /[\u0e00-\u0e7f]/.test(value.message) ? value.message : workflowText.load_error;
}

export type PublicationLabel = { th?: string; en?: string };
export type PublicationDescriptor = {
  ai_exposure?: "open" | "web_only" | "internal" | null; exposure_policy?: "stored" | "source"; exposure_href?: string | null; exposure_editor?: ExposureEditorTarget | null;
  label?: PublicationLabel | null; href?: string | null; target?: Record<string, unknown> | null;
  workflow: (WorkflowTarget & { expected_hash: string }) | null; can_return: boolean;
};
export type PublicationItem = PublicationDescriptor & { item_key: string; status: string; code?: string | null };
export type ReleaseMember = { entity_type: "project" | "brand" | "promotion"; entity_id: string; public_id?: string };
export type PublicationSelection = { system: "web"; page_key: string } | ({ system: "release" } & Pick<ReleaseMember, "entity_type" | "entity_id">);
export type PublicationCandidate = PublicationDescriptor & (
  { system: "web"; page_key: string; previous_version_id: string | null; hash: string; items: PublicationItem[] }
  | { system: "release"; entity_type: ReleaseMember["entity_type"]; entity_id: string; public_id: string; items?: PublicationItem[] }
);
export type PublicationSummary = { id: string; state: string; reason: string; digest: string; created_at: string; page_count: number };
export type ReleaseHistory = { id: string; status: "PUBLISHED" | "ROLLED_BACK"; change_reason: string; published_at: string; published_by: string;
  rolled_back_at: string | null; rolled_back_by: string | null; rollback_reason: string | null;
  members: (ReleaseMember & { before_version_id: string | null; after_version_id: string })[] };
export type PublicationQueue = { items: PublicationCandidate[]; web_history: PublicationSummary[]; release_history: ReleaseHistory[]; can_publish: boolean };
export type WebPage = { page_key: string; published_version_id: string | null };
export type WebWorkspace = { pages: WebPage[]; can_publish: boolean };
export type WebVersion = { id: string; version_no: number; published_at: string; change_reason: string };
export type ReviewedPublicationPage = PublicationDescriptor & { system?: "web" | "release"; page_key?: string; member?: ReleaseMember; hash?: string;
  html?: string; previous_html?: string; previous_redacted?: boolean; preview_redacted?: boolean; preview: Record<string, unknown>; previous?: Record<string, unknown> | null; items: PublicationItem[]; status?: string; code?: string | null;
  issues?: { code: string; field_key?: string; label?: PublicationLabel }[] };
export type PublicationReview = PublicationSummary & { can_publish: boolean; pages: ReviewedPublicationPage[] };
export type PublicationOutcome = PublicationDescriptor & { system: "web" | "release"; page_key?: string; member?: ReleaseMember; status?: string;
  code?: string; items?: PublicationItem[]; rejected?: (ReleaseMember & { code: string })[]; release_id?: string };
export type PublishedResult = { id: string; state: string; page_count: number; outcomes: PublicationOutcome[] };
export function publicationSelection(item: PublicationCandidate): PublicationSelection {
  return item.system === "web" ? { system: "web", page_key: item.page_key } : { system: "release", entity_type: item.entity_type, entity_id: item.entity_id };
}
export function publicationSelectionKey(item: PublicationSelection) {
  return item.system === "web" ? "web:" + item.page_key : "release:" + item.entity_type + ":" + item.entity_id;
}
export function publicationLabel(item: PublicationDescriptor, fallback: string) {
  return item.label?.th || item.label?.en || fallback;
}
export function publicationIssue(code: string | undefined | null) {
  if (code === "stale") return workflowText.stale_item;
  return code && code in workflowText ? workflowText[code as keyof typeof workflowText] : workflowText.not_approved_or_available;
}
// The API owns routing and identities. Never derive an editing target from item_key.
export function publicationHref(item: Pick<PublicationDescriptor, "href">) {
  return item.href?.startsWith("/") && !item.href.startsWith("//") && !item.href.includes("\\") ? item.href : null;
}
