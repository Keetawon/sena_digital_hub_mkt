import { expect, test } from "@playwright/test";
import { contentScopeAllowsApi, contentScopeAllowsQuery } from "../../apps/admin/lib/content-scope-routes";

const scopes = "v1/admin/accounts/content-scopes", runs = "v1/admin/accounts/bu-sync-runs";
const settings = "v1/admin/accounts/content-scope-settings", notices = "v1/admin/content/bu-notices";
const account = "88abcdef-0123-4abc-8def-000000000081";
const routes = [[scopes, "GET"], [runs, "GET"], [settings, "GET"], [settings + "/preview", "POST"], [settings + "/apply", "POST"], [notices, "GET"]] as const;
const allowed = (path: string, values: Record<string, string>, method = "GET") => contentScopeAllowsQuery(path, method, new URLSearchParams(values));

for (const [path, method] of routes) test(`exact transport entry ${method} ${path}`, () => {
  expect(contentScopeAllowsApi(path, method)).toBe(true);
  expect(contentScopeAllowsQuery(path, method, new URLSearchParams())).toBe(true);
  for (const wrong of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "get", "post", "", "toString", "constructor", "__proto__", method + "\n"]) {
    if (wrong === method) continue;
    expect(contentScopeAllowsApi(path, wrong), wrong).toBe(false);
    expect(contentScopeAllowsQuery(path, wrong, new URLSearchParams()), wrong).toBe(false);
  }
});

test("all route paths reject traversal, encoded aliases, controls, query suffixes and near matches", () => {
  for (const [path, method] of routes) for (const wrong of [
    "/" + path, "https://example.test/" + path, " " + path, path + " ", path + "/", path + "/extra", path + "/../content-scopes",
    path.replace("/admin/", "/admin/../admin/"), path.replace("/admin/", "/admin/%2e%2e/admin/"), path.replaceAll("/", "\\"),
    path.replace("accounts", "account"), path.replace("content/", "contents/"), path + "?limit=1", path + "#part",
    path + "\n", path + "\r\n", path + "\0", path + "\u007f", path + "\u2028", path + "%0A", path.replace("v1/", "v1%2F"),
  ]) {
    if (wrong === path) continue;
    expect(contentScopeAllowsApi(wrong, method), wrong).toBe(false);
    expect(contentScopeAllowsQuery(wrong, method, new URLSearchParams()), wrong).toBe(false);
  }
  for (const path of ["v1/admin/accounts", "v1/admin/permissions/preview", "v1/admin/content/bu-notices/refresh", "v1/admin/accounts/content-scopes/apply", settings + "/preview/confirm"]) {
    expect(contentScopeAllowsApi(path, "GET"), path).toBe(false);
    expect(contentScopeAllowsApi(path, "POST"), path).toBe(false);
  }
});

test("scope references accept only the two API reference kinds and canonical UUID account IDs", () => {
  for (const id of [account, account.toUpperCase(), "00000000-0000-0000-0000-000000000000"]) {
    for (const kind of ["projects", "bus"]) expect(allowed(scopes, { account_id: id, reference_kind: kind })).toBe(true);
  }
  for (const id of ["", account.replaceAll("-", ""), "{" + account + "}", "urn:uuid:" + account, "-".repeat(36), "g" + account.slice(1), account + "x", account.slice(1), account + "\n", " " + account]) {
    expect(allowed(scopes, { account_id: id }), id).toBe(false);
  }
  for (const kind of ["", "bu", "project", "BU", "BUS", "brands", " bus", "bus ", "bus\n", "projects/.."]) {
    expect(allowed(scopes, { reference_kind: kind }), kind).toBe(false);
  }
});

test("BUD and project query identities remain raw, including case, prefixes, punctuation and spaces", () => {
  for (const ref of ["001", "REM-001", "prj_public_001", " BU / C1 ", "BusinessUnit-C1", "BUD_A", " a\\b ", "A%2FB", "a".repeat(200)]) {
    const query = new URLSearchParams({ reference_kind: "bus", bu_id: ref, after: ref, q: " BUD " }), before = query.toString();
    expect(contentScopeAllowsQuery(scopes, "GET", query), ref).toBe(true);
    expect(query.get("bu_id")).toBe(ref); expect(query.get("after")).toBe(ref); expect(query.toString()).toBe(before);
    const project = new URLSearchParams({ project: ref });
    expect(contentScopeAllowsQuery(notices, "GET", project), ref).toBe(true); expect(project.get("project")).toBe(ref);
  }
});

test("scope search, BU identities and reference cursor lengths match their API ceilings", () => {
  for (const [key, min, max] of [["q", 0, 120], ["bu_id", 1, 200], ["after", 0, 200]] as const) {
    expect(allowed(scopes, { [key]: "a".repeat(min) }), key).toBe(true);
    expect(allowed(scopes, { [key]: "a".repeat(max) }), key).toBe(true);
    expect(allowed(scopes, { [key]: "a".repeat(max + 1) }), key).toBe(false);
    if (min) expect(allowed(scopes, { [key]: "" }), key).toBe(false);
  }
  // Pydantic measures Unicode code points, not UTF-16 code units.
  expect(allowed(scopes, { q: "\u{1f3e0}".repeat(120) })).toBe(true);
  expect(allowed(scopes, { q: "\u{1f3e0}".repeat(121) })).toBe(false);
});

test("effective history query keys always require an exact account, even with default or empty values", () => {
  for (const values of [{ history_after: "" }, { history_after: "[]" }, { history_limit: "50" }, { history_after: "[]", history_limit: "1" }] as Record<string, string>[]) {
    expect(allowed(scopes, values)).toBe(false);
    expect(allowed(scopes, { account_id: account, ...values })).toBe(true);
    expect(allowed(scopes, { account_id: "", ...values })).toBe(false);
  }
  expect(allowed(scopes, { limit: "100", reference_kind: "projects" })).toBe(true);
});

test("run and effective-history cursors keep their separate opaque API bounds", () => {
  const runCursor = JSON.stringify(["2030-01-01T00:00:00+00:00", account]);
  const historyCursor = JSON.stringify(["2030-01-01T00:00:00+00:00", "2030-01-02T00:00:00+00:00", account]);
  expect(allowed(runs, { after: runCursor })).toBe(true);
  expect(allowed(scopes, { account_id: account, history_after: historyCursor })).toBe(true);
  // Cursor contents are parsed by existing guarded SQL; this layer bounds transport.
  for (const length of [0, 1, 500]) expect(allowed(runs, { after: "a".repeat(length) })).toBe(true);
  expect(allowed(runs, { after: "a".repeat(501) })).toBe(false);
  for (const length of [0, 1, 1024]) expect(allowed(scopes, { account_id: account, history_after: "a".repeat(length) })).toBe(true);
  expect(allowed(scopes, { account_id: account, history_after: "a".repeat(1025) })).toBe(false);
});

test("notice project is optional, exact and bounded to 1 through 200 code points", () => {
  expect(allowed(notices, {})).toBe(true);
  for (const project of ["a", "prj_exact", "REM-001", "a".repeat(200), "\u{1f3e0}".repeat(200)]) expect(allowed(notices, { project }), project).toBe(true);
  for (const project of ["", "a".repeat(201), "\u{1f3e0}".repeat(201)]) expect(allowed(notices, { project }), project).toBe(false);
  for (const values of [{ account_id: account }, { bu_id: "001" }, { reference_kind: "projects" }, { q: "x" }, { after: "x" }, { history_limit: "1" }] as Record<string, string>[]) expect(allowed(notices, values)).toBe(false);
});

test("all supported count keys accept canonical integers from 1 through 100 only", () => {
  const fields = [[scopes, "limit"], [scopes, "history_limit"], [runs, "limit"], [notices, "limit"]] as const;
  for (const [path, key] of fields) {
    const common: Record<string, string> = key === "history_limit" ? { account_id: account } : {};
    for (const count of ["1", "9", "10", "99", "100"]) expect(allowed(path, { ...common, [key]: count }), key + count).toBe(true);
    for (const count of ["", "0", "101", "1000", "-1", "+1", "01", "1.0", "1e2", " 1", "1 ", "100\n", "NaN", "Infinity"]) expect(allowed(path, { ...common, [key]: count }), key + count).toBe(false);
  }
});

test("settings reads and both confirmation commands accept no query parameters", () => {
  for (const [path, method] of routes.filter(([path]) => path.startsWith(settings))) {
    for (const query of ["q=x", "limit=1", "account_id=" + account, "grace_days=7", "expected_revision=1", "digest=a", "confirmed=true", "=", "q="]) {
      expect(contentScopeAllowsQuery(path, method, new URLSearchParams(query)), path + query).toBe(false);
    }
  }
});

test("unknown, cross-route and prototype query keys are denied without exceptions", () => {
  for (const [path, method] of routes) for (const key of ["unknown", "__proto__", "constructor", "toString", "hasOwnProperty", "", "limit\n", "project/../account_id"]) {
    expect(contentScopeAllowsQuery(path, method, new URLSearchParams([[key, "1"]])), path + key).toBe(false);
  }
  for (const values of [{ account_id: account }, { reference_kind: "bus" }, { bu_id: "001" }, { project: "prj_exact" }, { q: "x" }, { history_after: "[]" }] as Record<string, string>[]) expect(allowed(runs, values)).toBe(false);
  expect(allowed(scopes, { project: "prj_exact" })).toBe(false);
});

test("duplicates are rejected for every recognized query key", () => {
  const cases = [
    [scopes, { account_id: account, reference_kind: "projects", bu_id: " BU ", q: "", after: "", limit: "1", history_after: "[]", history_limit: "50" }],
    [runs, { after: "[]", limit: "1" }], [notices, { project: "REM-001", limit: "1" }],
  ] as const;
  for (const [path, values] of cases) for (const [key, value] of Object.entries(values)) {
    const query = new URLSearchParams(values); query.append(key, value);
    expect(contentScopeAllowsQuery(path, "GET", query), path + key).toBe(false);
    query.delete(key); query.append(key, value);
    expect(contentScopeAllowsQuery(path, "GET", query), path + key).toBe(true);
  }
});

test("control characters and terminal newlines are rejected in every textual query position", () => {
  for (const [path, key] of [[scopes, "q"], [scopes, "bu_id"], [scopes, "after"], [scopes, "history_after"], [runs, "after"], [notices, "project"]]) {
    for (const control of ["\0", "\t", "\n", "\r", "\u001f", "\u007f", "\u0085", "\u009f"]) {
      const common: Record<string, string> = key === "history_after" ? { account_id: account } : {};
      for (const value of [control + "A", "A" + control, "A" + control + "B"]) expect(allowed(path, { ...common, [key]: value }), path + key).toBe(false);
    }
  }
});
