import { expect, test } from "@playwright/test";
import { businessAllowsApi, businessAllowsQuery } from "../../apps/admin/lib/business-api-routes";
import { contentAllowsApi, contentAllowsQuery } from "../../apps/admin/lib/content-routes";
import { workspaceAllowsApi, workspaceAllowsQuery } from "../../apps/admin/lib/workspace-api-routes";
import { canOpenPage, emptyCapabilities, type HubAccount } from "../../apps/admin/lib/hub-permissions";

const base = "v1/admin/content/businesses", workspace = "v1/admin/content/workspace";
const contact = "a1234567-89ab-4cde-8abc-1234567890ab";
const routes = [
  [base, "GET"],
  [`${base}/residential/content`, "GET"],
  [`${base}/residential/sections/section.concept_detail`, "PUT"],
  [`${base}/residential/contacts`, "POST"],
  [`${base}/residential/contacts/${contact}`, "PUT"],
] as const;
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "get", "constructor", "toString", "__proto__", ""];

test("business workflow inventory and intake retain finite level filters", () => {
  const paths = ["v1/admin/content-workflow/items", "v1/admin/faq-intake/clusters"];
  for (const path of paths) {
    const query = new URLSearchParams({ level: "business", limit: "100", ...(path.endsWith("/items") ? { id: "residential" } : {}) });
    expect(contentAllowsApi(path, "GET")).toBe(true);
    expect(contentAllowsQuery(path, "GET", query)).toBe(true);
    for (const key of ["constructor", "toString", "__proto__"]) {
      const invalid = new URLSearchParams(query); invalid.set(key, "unexpected");
      expect(contentAllowsQuery(path, "GET", invalid)).toBe(false);
    }
    for (const level of ["unknown", "Business", "business\n", "business/extra"]) {
      const invalid = new URLSearchParams(query); invalid.set("level", level);
      expect(contentAllowsQuery(path, "GET", invalid), `${path} ${JSON.stringify(level)}`).toBe(false);
    }
    query.append("level", "brand"); expect(contentAllowsQuery(path, "GET", query)).toBe(false);
  }
});

for (const [path, method] of routes) test(`business transport admits only ${method} ${path}`, () => {
  for (const verb of methods) {
    expect(businessAllowsApi(path, verb), verb).toBe(verb === method);
    expect(businessAllowsQuery(path, verb, new URLSearchParams()), verb).toBe(verb === method);
  }
});

test("business mutations cannot create, rename, remove or add an unclassified endpoint", () => {
  for (const path of [base + "/", base + "/residential", base + "/residential/rename", base + "/residential/sections", base + "/residential/content/extra",
    base + "/residential/contacts/", base + "/residential/contacts/new", base + "/residential/contacts/" + contact + "/approve",
    base + "/residential/sections/section.concept_detail/approve", base + "/residential/sections/section.concept_detail/extra",
    base + "-extra", base + "/residential/versions", "v1/admin/content/business", "/" + base]) {
    for (const method of methods) expect(businessAllowsApi(path, method), `${method} ${path}`).toBe(false);
  }
});

test("business code bounds exactly match the real draft and content API", () => {
  for (const code of ["ab", "residential", "a_1", "a".repeat(64)]) {
    for (const suffix of ["/content", "/sections/section.concept_detail", "/contacts", "/contacts/" + contact]) {
      const method = suffix === "/content" ? "GET" : suffix === "/contacts" ? "POST" : "PUT";
      expect(businessAllowsApi(`${base}/${code}${suffix}`, method), code).toBe(true);
    }
  }
  for (const code of ["", "a", "a".repeat(65), "Residential", "1residential", "residential-x", "a b", "../residential", "a/b", "a\\b", "a%2fb", "%72esidential", "a\0b", "a\nb", "a\u007fb"]) {
    expect(businessAllowsApi(`${base}/${code}/content`, "GET"), code).toBe(false);
    expect(businessAllowsApi(`${base}/${code}/contacts`, "POST"), code).toBe(false);
  }
});

test("section keys and contact UUIDs are finite validated path segments", () => {
  for (const key of ["ab", "section.project_intro", "a_1.b", "a".repeat(101)]) expect(businessAllowsApi(`${base}/residential/sections/${key}`, "PUT"), key).toBe(true);
  for (const key of ["", "a", "a".repeat(102), "Section.name", "_field", "1field", "field-name", "a/b", "a\\b", "a%2Fb", "a?x=1", "a#b", "a\nb"]) expect(businessAllowsApi(`${base}/residential/sections/${key}`, "PUT"), key).toBe(false);
  expect(businessAllowsApi(`${base}/residential/contacts/${contact.toUpperCase()}`, "PUT")).toBe(true);
  for (const id of ["", contact.replaceAll("-", ""), "g" + contact.slice(1), contact + "x", contact.slice(1), "-".repeat(36), contact + "/extra", contact + "%2fextra"]) expect(businessAllowsApi(`${base}/residential/contacts/${id}`, "PUT"), id).toBe(false);
});

test("no business content API route accepts query parameters", () => {
  for (const [path, method] of routes) for (const query of ["q=x", "locale=th", "phase=001", "limit=1", "expected_revision=1", "code=residential", "scope=all", "q=", "q=x&q=y", "=", "q=%00"]) {
    expect(businessAllowsQuery(path, method, new URLSearchParams(query)), `${path}?${query}`).toBe(false);
    expect(businessAllowsApi(path + "?" + query, method), `${path}?${query}`).toBe(false);
  }
  expect(businessAllowsQuery(base + "/unknown", "GET", new URLSearchParams())).toBe(false);
});

test("business workspace reads and tree parents use the existing finite query contracts", () => {
  for (const suffix of ["", "/faq", "/preview", "/history", "/history/1"]) {
    const path = workspace + "/business/residential" + suffix;
    expect(workspaceAllowsApi(path, "GET"), path).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(workspaceAllowsApi(path, method), method).toBe(false);
  }
  const tree = workspace + "/tree";
  expect(workspaceAllowsQuery(tree, "GET", new URLSearchParams("parent_kind=business&parent_ref=residential&q=home&limit=100"))).toBe(true);
  for (const query of ["parent_kind=business", "parent_ref=residential", "parent_kind=business&parent_ref=a%2Fb", "parent_kind=business&parent_ref=", "parent_kind=business&parent_ref=residential&limit=101", "parent_kind=business&parent_ref=residential&parent_kind=brand"]) expect(workspaceAllowsQuery(tree, "GET", new URLSearchParams(query)), query).toBe(false);
  expect(workspaceAllowsQuery(workspace + "/business/residential/faq", "GET", new URLSearchParams("question_key=design_intro&locale=en"))).toBe(true);
  expect(workspaceAllowsQuery(workspace + "/business/residential/faq", "GET", new URLSearchParams("question_key=design_intro&q=x"))).toBe(false);
  expect(workspaceAllowsQuery(workspace + "/business/residential/history", "GET", new URLSearchParams("before=9223372036854775808"))).toBe(false);
  for (const path of [workspace + "/business/residential/write", workspace + "/business/residential/history/0", workspace + "/business/a/b", workspace + "/business/a\\b"]) expect(workspaceAllowsApi(path, "GET"), path).toBe(false);
  for (const kind of ["corporate", "brand", "project", "programme", "project_group", "unit_type"]) {
    expect(workspaceAllowsApi(`${workspace}/${kind}/exact_ref`, "GET"), kind).toBe(true);
    expect(workspaceAllowsQuery(tree, "GET", new URLSearchParams({ parent_kind: kind, parent_ref: "exact_ref" })), kind).toBe(true);
  }
});

function account(tab: string, extra: Partial<HubAccount> = {}): HubAccount {
  return { id: "synthetic-business-caller", status: "ACTIVE", hub_role: "viewer", capabilities: { ...emptyCapabilities, published_consumer: true, tabs: { [tab]: { view: true } } }, ...extra };
}
const open = (who: HubAccount, path = "/website/business/residential", query = "") => canOpenPage(who, path, new URLSearchParams(query));

test("business pages require Knowledge View rather than Projects, Brands or account management", () => {
  expect(open(account("knowledge"))).toBe(true);
  expect(open(account("knowledge", { capabilities: { ...emptyCapabilities, tabs: { knowledge: { view: true } } } }))).toBe(true);
  for (const tab of ["projects", "brands", "releases", "accounts"]) {
    const caller = account(tab, { hub_role: "admin" });
    expect(open(caller), tab).toBe(false);
    expect(open({ ...caller, capabilities: { ...caller.capabilities!, can_manage_users: true } }), tab).toBe(false);
    // Reference routing is permission-neutral; its API retains the existing
    // Projects/Brands/Knowledge staff guard and returns no business content.
    expect(businessAllowsApi(base, "GET"), tab).toBe(true);
  }
  expect(open(account("knowledge", { capabilities: { ...emptyCapabilities, tabs: { knowledge: { edit: true, approve: true } } } }))).toBe(false);
});

test("business pages reject inactive, agency and consumer identities even with forged View", () => {
  for (const status of ["SUSPENDED", "PENDING", "REJECTED", "INVITED", ""]) expect(open(account("knowledge", { status })), status).toBe(false);
  for (const role of ["agency", "agency_kin", "agency_combay", "service_consumer", "unknown", ""]) expect(open(account("knowledge", { hub_role: role })), role).toBe(false);
  expect(open(account("knowledge", { agency_code: "KIN" }))).toBe(false);
  expect(open(account("knowledge", { agency: "KIN" }))).toBe(false);
  expect(open(account("knowledge", { hub_role: "agency", role: "admin" }))).toBe(false);
  for (const role of ["viewer", "editor", "publisher", "admin", "online_staff"]) expect(open(account("knowledge", { hub_role: role })), role).toBe(true);
  expect(open(account("knowledge", { hub_role: null, role: "viewer" }))).toBe(true);
});

test("business page paths reject malformed codes without changing other entity admission", () => {
  for (const path of ["/website/business", "/website/business/", "/website/business/a", "/website/business/" + "a".repeat(65), "/website/business/Residential", "/website/business/a%2Fb", "/website/business/a\\b", "/website/business/residential/extra", "/website/business/a\nb"]) expect(open(account("knowledge"), path), path).toBe(false);
  expect(open(account("projects"), "/website/project/prj_exact")).toBe(true);
  expect(open(account("brands"), "/website/brand/brd_exact")).toBe(true);
  expect(open(account("knowledge"), "/website/project/prj_exact", "tab=faq")).toBe(true);
  expect(open(account("knowledge"), "/website/brand/brd_exact", "tab=faq")).toBe(true);
});

test("W4 Knowledge-or-Releases publication entry remains unchanged", () => {
  for (const tab of ["knowledge", "releases"]) {
    for (const path of ["/publish", "/releases"]) expect(open(account(tab), path), `${tab} ${path}`).toBe(true);
    expect(open(account(tab), "/faq", "tab=publication"), tab).toBe(true);
    expect(open(account(tab, { status: "SUSPENDED" }), "/publish"), tab).toBe(false);
  }
  for (const tab of ["projects", "brands"]) {
    expect(open(account(tab), "/publish"), tab).toBe(false);
    expect(open(account(tab), "/faq", "tab=publication"), tab).toBe(false);
  }
});


test("transport full matches reject final newlines in paths and every bounded query value", () => {
  for (const [path, method] of routes) {
    expect(businessAllowsApi(path + "\n", method), path).toBe(false);
    expect(businessAllowsApi(path + "\r\n", method), path).toBe(false);
    expect(businessAllowsApi(path, method), path).toBe(true);
  }
  const tree = workspace + "/tree";
  for (const key of ["constructor", "toString", "__proto__"]) expect(workspaceAllowsQuery(tree, "GET", new URLSearchParams({ [key]: "unexpected" })), key).toBe(false);
  for (const kind of ["business", "project", "brand"]) {
    expect(workspaceAllowsApi(`${workspace}/${kind}/exact_ref\n`, "GET"), kind).toBe(false);
    expect(workspaceAllowsApi(`${workspace}/${kind}/exact_ref`, "GET"), kind).toBe(true);
    expect(workspaceAllowsQuery(tree, "GET", new URLSearchParams({ parent_kind: kind, parent_ref: "exact_ref\n" })), kind).toBe(false);
    expect(workspaceAllowsQuery(tree, "GET", new URLSearchParams({ parent_kind: kind, parent_ref: "exact_ref" })), kind).toBe(true);
  }
  const treeQueries: Record<string, string>[] = [{ parent_kind: "business\n", parent_ref: "residential" }, { q: "homes\n" }, { after: "cursor\n" }, { limit: "100\n" }];
  const faqQueries: Record<string, string>[] = [{ locale: "en\n" }, { question_key: "design_intro\n" }, { phase: "0001\n" }, { q: "homes\n" }];
  for (const values of treeQueries) expect(workspaceAllowsQuery(tree, "GET", new URLSearchParams(values)), JSON.stringify(values)).toBe(false);
  for (const values of faqQueries) expect(workspaceAllowsQuery(workspace + "/business/residential/faq", "GET", new URLSearchParams(values)), JSON.stringify(values)).toBe(false);
  expect(workspaceAllowsApi(workspace + "/business/residential/history/1\n", "GET")).toBe(false);
  expect(workspaceAllowsQuery(workspace + "/business/residential/history", "GET", new URLSearchParams("before=1%0A"))).toBe(false);
  const decision = "v1/admin/projects/prj_exact/content/website/" + contact + "/decision";
  expect(workspaceAllowsApi(decision, "POST")).toBe(true); expect(workspaceAllowsApi(decision + "\n", "POST")).toBe(false);
  expect(open(account("knowledge"), "/website/business/residential\n")).toBe(false);
  expect(open(account("knowledge"), "/website/business/residential")).toBe(true);
});
