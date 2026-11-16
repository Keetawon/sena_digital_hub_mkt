import { contentAllowsApi, contentAllowsQuery } from "../../apps/admin/lib/content-routes";
import { h1AllowsApi } from "../../apps/admin/lib/hosted-config";
import { expect, test } from "@playwright/test";
import { writingAllowsApi, writingAllowsQuery } from "../../apps/admin/lib/writing-aid-routes";

const base = "v1/admin/content/writing-aid";
const id = "a1234567-89ab-4cde-8abc-1234567890ab";
const routes = [[`${base}/${id}`, "GET"], [`${base}/${id}/proposals`, "POST"]] as const;
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE", "CONNECT", "get", "post", "Get", "Post", "GET\n", "POST ", "constructor", "toString", "__proto__", ""];

for (const [path, method] of routes) test(`writing transport allows only ${method} ${path}`, () => {
  for (const verb of methods) {
    expect(writingAllowsApi(path, verb), verb).toBe(verb === method);
    expect(writingAllowsQuery(path, verb, new URLSearchParams()), verb).toBe(verb === method);
  }
});

test("writing source UUIDs accept canonical upper and lower case without adding UUID-version restrictions", () => {
  for (const value of [id, id.toUpperCase(), "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"]) {
    expect(writingAllowsApi(`${base}/${value}`, "GET"), value).toBe(true);
    expect(writingAllowsApi(`${base}/${value}/proposals`, "POST"), value).toBe(true);
    expect(writingAllowsQuery(`${base}/${value}`, "GET", new URLSearchParams()), value).toBe(true);
    expect(writingAllowsQuery(`${base}/${value}/proposals`, "POST", new URLSearchParams()), value).toBe(true);
  }
  for (const value of ["", "new", id.replaceAll("-", ""), "g" + id.slice(1), id.slice(1), id + "0", "-".repeat(36), id.replace("-", "a"), `{${id}}`, "urn:uuid:" + id, "%61" + id.slice(1)]) {
    expect(writingAllowsApi(`${base}/${value}`, "GET"), value).toBe(false);
    expect(writingAllowsApi(`${base}/${value}/proposals`, "POST"), value).toBe(false);
  }
});

test("writing transport has no accept, save, retry, history, provider or unclassified route", () => {
  for (const path of [base, base + "/", base + "/proposals", `${base}/${id}/`, `${base}/${id}/proposals/`, `${base}/${id}/proposals/${id}`,
    ...["accept", "save", "retry", "history", "provider", "approve", "publish", "state"].map(action => `${base}/${id}/${action}`),
    `${base}/${id}/proposals/accept`, `${base}/${id}/proposals/save`, `${base}/${id}/proposals/extra`, `${base}-extra/${id}`,
    `v1/admin/content/writing/${id}`, `v1/admin/content/writing-aid-extra/${id}`, "/" + routes[0][0], "api/hub/" + routes[0][0],
    "https://example.invalid/" + routes[0][0], `V1/admin/content/writing-aid/${id}`, `${base}/${id}/Proposals`]) {
    for (const method of methods) {
      expect(writingAllowsApi(path, method), `${method} ${path}`).toBe(false);
      expect(writingAllowsQuery(path, method, new URLSearchParams()), `${method} ${path}`).toBe(false);
    }
  }
});

test("writing paths reject traversal, separators, fragments and encoded suffixes", () => {
  for (const value of [`../${id}`, `${id}/..`, `./${id}`, `${id}/.`, `${id}//`, `${id}\\`, `${id}%2fproposals`, `${id}%2F..`, `${id}%5c`, `%2e%2e/${id}`, `${id};save`, `${id}?`, `${id}?locale=th`, `${id}#fragment`]) {
    expect(writingAllowsApi(`${base}/${value}`, "GET"), value).toBe(false);
    expect(writingAllowsApi(`${base}/${value}/proposals`, "POST"), value).toBe(false);
  }
  for (const [path, method] of routes) {
    for (const suffix of ["/..", "/../proposals", "%2f", "%0a", "?", "?locale=th", "#fragment"]) {
      expect(writingAllowsApi(path + suffix, method), path + suffix).toBe(false);
    }
  }
});

test("writing full matches reject control characters including a final newline", () => {
  const controls = [...Array.from({ length: 33 }, (_, index) => String.fromCharCode(index)), "\u007f", "\u0085", "\u2028", "\u2029", "\r\n"];
  for (const [path, method] of routes) {
    for (const control of controls) {
      for (const candidate of [control + path, path + control, path.replace(id, id.slice(0, 8) + control + id.slice(8))]) {
        expect(writingAllowsApi(candidate, method), JSON.stringify(candidate)).toBe(false);
        expect(writingAllowsQuery(candidate, method, new URLSearchParams()), JSON.stringify(candidate)).toBe(false);
      }
    }
    expect(writingAllowsApi(path, method), path).toBe(true);
  }
});

test("both writing endpoints reject every named, unnamed or duplicate query parameter", () => {
  const queries = ["q=x", "locale=th", "language=en", "expected_revision=1", "request_id=" + id, "translation_id=" + id,
    "actor_id=forged", "scope=all", "provider=live", "accept=true", "q=", "q=x&q=y", "locale=th&locale=en", "=", "=value",
    "constructor=x", "toString=x", "__proto__=x", "q=%00", "%00=x", "q=%0a", "q=x&%71=y"];
  for (const [path, method] of routes) {
    for (const query of queries) {
      expect(writingAllowsQuery(path, method, new URLSearchParams(query)), query).toBe(false);
      expect(writingAllowsApi(path + "?" + query, method), query).toBe(false);
    }
    expect(writingAllowsQuery(path, method, new URLSearchParams()), path).toBe(true);
  }
});

test("local and H1 dispatch preserve the exact writing transport contract", () => {
  for (const [path, method] of routes) {
    expect(contentAllowsApi(path, method)).toBe(true);
    expect(h1AllowsApi(path, method)).toBe(true);
    expect(contentAllowsQuery(path, method, new URLSearchParams())).toBe(true);
    expect(contentAllowsQuery(path, method, new URLSearchParams("scope=all"))).toBe(false);
    for (const suffix of ["\n", "\r\n", "\u2028", "\u2029", "/", "/accept", "?provider=live"]) {
      expect(contentAllowsApi(path + suffix, method)).toBe(false);
      expect(h1AllowsApi(path + suffix, method)).toBe(false);
      expect(contentAllowsQuery(path + suffix, method, new URLSearchParams())).toBe(false);
    }
    for (const other of ["PUT", "PATCH", "DELETE", "HEAD", "get", "POST\n"]) {
      expect(contentAllowsApi(path, other)).toBe(false);
      expect(h1AllowsApi(path, other)).toBe(false);
    }
  }
});
