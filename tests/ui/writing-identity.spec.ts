import { expect, test } from "@playwright/test";
import { WritingAidError, writingBlock, writingPath, writingRequest, type WritingSnapshot, type WritingState } from "../../apps/admin/lib/writing-aid";

const id = "11111111-1111-4111-8111-111111111111", requestId = "22222222-2222-4222-8222-222222222222", contextId = "33333333-3333-4333-8333-333333333333";
const snapshot: WritingSnapshot = { binding: { translation_id: id, revision: 3, th_version: 2, owner_type: "project", owner_key: "prj_synthetic", field_key: "project.meta_description" },
  fieldKey: "project.meta_description", enabled: true, canEdit: true, language: "th", value: "Saved text", savedValue: "Saved text", formDirty: false,
  draftStamp: { revision: 7 }, authorityKey: "synthetic-account", context: [{ translation_id: contextId, expected_revision: 5 }] };
const state: WritingState = { translation_id: id, revision: 3, eligible: true, editable: true, requests: [],
  budget: { status: "available", synthetic: true, month: "2026-11-01", model: "stub-writing-v1", cap_usd: 0, spent_usd: 0, remaining_usd: 0, ceiling_usd: 0 } };

test("UUID validation matches the whole path, binding, request and context identity", () => {
  expect(writingPath(id)).toBe("v1/admin/content/writing-aid/" + id);
  expect(writingBlock(snapshot, state)).toBeNull();
  expect(writingRequest(snapshot, "draft", requestId)).toEqual({ request_id: requestId, expected_revision: 3, language: "th", mode: "draft", context: snapshot.context });
  for (const suffix of ["\n", "\r\n", "\u2028", "\u2029", " "]) {
    expect(() => writingPath(id + suffix)).toThrow(WritingAidError);
    expect(writingBlock({ ...snapshot, binding: { ...snapshot.binding, translation_id: id + suffix } }, state)).toBe("unavailable");
    expect(() => writingRequest(snapshot, "draft", requestId + suffix)).toThrow(WritingAidError);
    expect(() => writingRequest({ ...snapshot, context: [{ translation_id: contextId + suffix, expected_revision: 5 }] }, "draft", requestId)).toThrow(WritingAidError);
  }
});
