import { expect, test } from "@playwright/test";
import { acceptWritingReview, WritingAidError, writingBlock, writingDiff, writingPath, writingRequest,
  writingReview, writingReviewBlock, type WritingAcceptance, type WritingResult, type WritingSnapshot, type WritingState } from "../../apps/admin/lib/writing-aid";

const id = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222";
const contextId = "33333333-3333-4333-8333-333333333333";
const source = { translation_id: id, revision: 3, th_version: 2, owner_type: "project", owner_key: "prj_synthetic", field_key: "project.meta_description" };
const before = "  Green 20.5 homes {project} 20.5  ", after = "Green 20.5 homes {project} 20.5";
function snapshot(extra: Partial<WritingSnapshot> = {}): WritingSnapshot {
  return { binding: { ...source }, fieldKey: source.field_key, enabled: true, canEdit: true,
    language: "th", value: before, savedValue: before, formDirty: false, draftStamp: { revision: 7 }, authorityKey: "synthetic-account-scope-1", ...extra };
}
function state(extra: Partial<WritingState> = {}): WritingState {
  return { translation_id: id, revision: 3, eligible: true, editable: true, requests: [],
    budget: { status: "available", synthetic: true, month: "2026-11-01", model: "stub-writing-v1", cap_usd: 0, spent_usd: 0, remaining_usd: 0, ceiling_usd: 0 }, ...extra };
}
function response(extra: Partial<WritingResult> = {}): WritingResult {
  return { id: requestId, translation_id: id, source_revision: 3, language: "th", mode: "shorten", context: [],
    status: "done", error_code: null, synthetic: true, model: "stub-writing-v1", input_tokens: 0, output_tokens: 0,
    elapsed_ms: 1, completed_at: "2026-11-04T08:00:00Z", proposal: { before, after, source: { ...source, row_ref: { id: source.owner_key } }, acceptance: "ordinary_draft_save" }, ...extra };
}
const review = () => writingReview(response(), writingRequest(snapshot(), "shorten", requestId), snapshot());

test("writing is default-off and source/registry/workflow gates never infer permission", () => {
  expect(writingBlock(snapshot(), state())).toBeNull();
  expect(writingBlock(snapshot({ enabled: false }), state())).toBe("unavailable");
  expect(writingBlock(snapshot({ canEdit: false }), state())).toBe("permission");
  expect(writingBlock(snapshot({ authorityKey: "" }), state())).toBe("permission");
  expect(writingBlock(snapshot(), state({ eligible: false }))).toBe("unavailable");
  expect(writingBlock(snapshot(), state({ editable: false }))).toBe("unavailable");
  expect(writingBlock(snapshot({ fieldKey: "project.address" }), state())).toBe("unavailable");
  expect(writingBlock(snapshot(), state({ revision: 4 }))).toBe("stale");
  expect(writingBlock(snapshot(), state({ translation_id: contextId }))).toBe("stale");
  expect(writingBlock(snapshot(), state({ budget: { ...state().budget, synthetic: false } }))).toBe("unavailable");
});

test("dirty form text and unknown normal-writer stamps block requests", () => {
  expect(writingBlock(snapshot({ value: "Unsaved text" }), state())).toBe("dirty");
  expect(writingBlock(snapshot({ formDirty: true }), state())).toBe("dirty");
  expect(writingBlock(snapshot({ draftStamp: {} }), state())).toBe("unavailable");
  expect(writingBlock(snapshot({ draftStamp: { updated_at: "unknown" } }), state())).toBe("unavailable");
});

for (const language of ["th", "en"] as const) for (const mode of ["draft", "proofread", "shorten"] as const) {
  test(`typed ${language}/${mode} request carries exact revision and references only`, () => {
    const value = snapshot({ language, context: [{ translation_id: contextId, expected_revision: 5 }] });
    expect(writingPath(id)).toBe(`v1/admin/content/writing-aid/${id}`);
    const body = writingRequest(value, mode, requestId);
    expect(body).toEqual({ request_id: requestId, expected_revision: 3, language, mode,
      context: mode === "draft" ? [{ translation_id: contextId, expected_revision: 5 }] : [] });
    expect(JSON.stringify(body)).not.toContain(before);
    expect(Object.keys(body).sort()).toEqual(["context", "expected_revision", "language", "mode", "request_id"]);
  });
}

test("context and paths cannot smuggle arbitrary text, duplicates or another route", () => {
  expect(() => writingPath("../../accounts")).toThrow(WritingAidError);
  expect(() => writingRequest(snapshot(), "draft", "not-a-uuid")).toThrow(WritingAidError);
  expect(() => writingRequest(snapshot({ context: [{ translation_id: id, expected_revision: 3 }] }), "draft", requestId)).toThrow(WritingAidError);
  expect(() => writingRequest(snapshot({ context: [{ translation_id: contextId, expected_revision: 5 }, { translation_id: contextId, expected_revision: 5 }] }), "draft", requestId)).toThrow(WritingAidError);
  expect(() => writingRequest(snapshot({ context: [{ translation_id: contextId, expected_revision: 0 }] }), "draft", requestId)).toThrow(WritingAidError);
});

test("proposal review preserves exact protected text and makes no save or form mutation", () => {
  const current = snapshot(), original = JSON.stringify(current);
  const proposed = writingReview(response(), writingRequest(current, "shorten", requestId), current);
  expect(proposed.before).toBe(before); expect(proposed.after).toBe(after);
  expect(proposed.after.match(/20\.5/g)).toHaveLength(2);
  expect(proposed.after).toContain("{project}");
  expect(JSON.stringify(current)).toBe(original);
  expect(current.value).toBe(before);
  const diff = writingDiff("<script>20.5</script> old", "<script>20.5</script> new");
  expect(diff.prefix + diff.before + diff.suffix).toBe("<script>20.5</script> old");
  expect(diff.prefix + diff.after + diff.suffix).toBe("<script>20.5</script> new");
  const emoji = writingDiff("Home \u{1f600}", "Home \u{1f603}");
  expect(emoji.before).toBe("\u{1f600}"); expect(emoji.after).toBe("\u{1f603}");
});

test("ambiguous/replayed/error output cannot become an actionable diff", () => {
  const body = writingRequest(snapshot(), "shorten", requestId);
  for (const result of [response({ status: "running", proposal: undefined }), response({ status: "ambiguous", proposal: undefined }), response({ replayed: true, proposal: undefined }),
    response({ status: "failed", error_code: "provider_error", proposal: undefined }), response({ synthetic: false })]) {
    expect(() => writingReview(result, body, snapshot())).toThrow("ambiguous");
  }
  expect(() => writingReview(response({ status: "failed", error_code: "invalid_output", proposal: undefined }), body, snapshot())).toThrow("protected");
  expect(() => writingReview(response({ status: "failed", error_code: "permission_revoked", proposal: undefined }), body, snapshot())).toThrow("permission");
  expect(() => writingReview(response({ status: "failed", error_code: "source_changed", proposal: undefined }), body, snapshot())).toThrow("stale");
});

test("a proposal is bound to request, field, source revision and reviewed text", () => {
  const body = writingRequest(snapshot(), "shorten", requestId), original = response();
  for (const result of [response({ id: contextId }), response({ source_revision: 4 }), response({ language: "en" }),
    response({ proposal: { ...original.proposal!, before: "Different persisted text" } }),
    response({ proposal: { ...original.proposal!, source: { ...original.proposal!.source, field_key: "brand.description" } } })]) {
    expect(() => writingReview(result, body, snapshot())).toThrow("stale");
  }
});

test("budget stops a new request while an already reviewed proposal can still be saved", () => {
  const exhausted = state({ budget: { ...state().budget, status: "budget_exhausted" } });
  expect(writingBlock(snapshot(), exhausted)).toBe("budget");
  expect(writingReviewBlock(review(), snapshot(), exhausted)).toBeNull();
  expect(() => writingReview(response({ status: "budget_exhausted", proposal: undefined }), writingRequest(snapshot(), "shorten", requestId), snapshot())).toThrow("budget");
});

test("explicit acceptance rechecks state and calls only the ordinary draft callback with the original stamp", async () => {
  const proposed = review(), calls: WritingAcceptance[] = []; let reads = 0;
  await acceptWritingReview(proposed, () => snapshot(), async () => { reads++; return state(); }, async value => { calls.push(value); });
  expect(reads).toBe(1);
  expect(calls).toEqual([{ requestId, source, language: "th", before, after, expectedDraft: { revision: 7 } }]);
  expect(proposed.snapshot.value).toBe(before);
});

for (const [name, next, result] of [
  ["edited text", snapshot({ value: "Keep my typed text" }), "dirty"],
  ["normal form stamp", snapshot({ draftStamp: { revision: 8 } }), "stale"],
  ["authority", snapshot({ authorityKey: "revoked-scope" }), "stale"],
  ["permission", snapshot({ canEdit: false }), "permission"],
] as const) test(`acceptance refuses changed ${name} without calling the writer`, async () => {
  let saves = 0;
  await expect(acceptWritingReview(review(), () => next, async () => state(), async () => { saves++; })).rejects.toThrow(result);
  expect(saves).toBe(0);
});

test("typing while the final authorization read is in flight cannot be overwritten", async () => {
  let current = snapshot(), release!: (value: WritingState) => void, saves = 0;
  const check = new Promise<WritingState>(resolve => { release = resolve; });
  const accepted = acceptWritingReview(review(), () => current, () => check, async () => { saves++; });
  current = snapshot({ value: "New unsaved text", formDirty: true }); release(state());
  await expect(accepted).rejects.toThrow("dirty"); expect(saves).toBe(0);
  expect(current.value).toBe("New unsaved text");
});

test("ordinary-save failure propagates and does not alter the reviewed source or retry", async () => {
  const proposed = review(); let saves = 0;
  await expect(acceptWritingReview(proposed, () => snapshot(), async () => state(), async () => { saves++; throw new Error("synthetic save refusal"); })).rejects.toThrow("synthetic save refusal");
  expect(saves).toBe(1); expect(proposed.before).toBe(before); expect(proposed.after).toBe(after);
});


test("revoked final read and changed draft context never reach the ordinary writer", async () => {
  let saves = 0;
  await expect(acceptWritingReview(review(), () => snapshot(), async () => { throw Object.assign(new Error("revoked"), { status: 403 }); }, async () => { saves++; })).rejects.toThrow("revoked");
  expect(saves).toBe(0);
  const original = snapshot({ context: [{ translation_id: contextId, expected_revision: 5 }] });
  const body = writingRequest(original, "draft", requestId);
  const proposed = writingReview(response({ mode: "draft", context: body.context }), body, original);
  expect(writingReviewBlock(proposed, snapshot({ context: [{ translation_id: contextId, expected_revision: 6 }] }), state())).toBe("stale");
});


function draftReview() {
  const original = snapshot({ context: [{ translation_id: contextId, expected_revision: 5 }] });
  const body = writingRequest(original, "draft", requestId);
  return writingReview(response({ mode: "draft", context: body.context }), body, original);
}

for (const [name, extra, reason] of [
  ["identity", { translation_id: requestId }, "stale"],
  ["revision", { revision: 6 }, "stale"],
  ["eligibility", { eligible: false }, "unavailable"],
] as const) test(`draft acceptance rechecks context ${name} before ordinary save`, async () => {
  const proposed = draftReview(), reads: string[] = []; let saves = 0;
  await expect(acceptWritingReview(proposed, () => proposed.snapshot, async translationId => {
    reads.push(translationId);
    return translationId === id ? state() : state({ translation_id: contextId, revision: 5, ...extra });
  }, async () => { saves++; })).rejects.toThrow(reason);
  expect(reads).toEqual([id, contextId]); expect(saves).toBe(0);
  expect(proposed.snapshot.value).toBe(before);
});

for (const status of [403, 404]) test(`draft acceptance refuses context visibility loss (${status})`, async () => {
  const proposed = draftReview(), reads: string[] = []; let saves = 0;
  await expect(acceptWritingReview(proposed, () => proposed.snapshot, async translationId => {
    reads.push(translationId);
    if (translationId === contextId) throw Object.assign(new Error("Context unavailable"), { status });
    return state();
  }, async () => { saves++; })).rejects.toMatchObject({ status });
  expect(reads).toEqual([id, contextId]); expect(saves).toBe(0);
});

test("eligible View-only context permits ordinary acceptance with the original target stamp", async () => {
  const proposed = draftReview(), reads: string[] = [], saves: WritingAcceptance[] = [];
  await acceptWritingReview(proposed, () => proposed.snapshot, async translationId => {
    reads.push(translationId);
    return translationId === id ? state() : state({ translation_id: contextId, revision: 5, editable: false });
  }, async value => { saves.push(value); });
  expect(reads).toEqual([id, contextId]);
  expect(saves).toEqual([{ requestId, source, language: "th", before, after, expectedDraft: { revision: 7 } }]);
  expect(proposed.snapshot.value).toBe(before);
});

for (const change of ["edit", "unmount"] as const) test(`target ${change} during a context read cannot reach ordinary save`, async () => {
  const proposed = draftReview(); let current = proposed.snapshot, mounted = true, saves = 0;
  let release!: (value: WritingState) => void, entered!: () => void;
  const contextRead = new Promise<WritingState>(resolve => { release = resolve; });
  const contextStarted = new Promise<void>(resolve => { entered = resolve; });
  const accepted = acceptWritingReview(proposed, () => {
    if (!mounted) throw new WritingAidError("permission");
    return current;
  }, async translationId => {
    if (translationId === contextId) { entered(); return contextRead; }
    return state();
  }, async () => { saves++; });
  await contextStarted;
  if (change === "edit") current = { ...current, value: "Keep new unsaved text", formDirty: true };
  else mounted = false;
  release(state({ translation_id: contextId, revision: 5 }));
  await expect(accepted).rejects.toThrow(change === "edit" ? "dirty" : "permission");
  expect(saves).toBe(0);
  if (change === "edit") expect(current.value).toBe("Keep new unsaved text");
});
