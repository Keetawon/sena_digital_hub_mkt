import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const requireAdmin = createRequire(new URL("../apps/admin/package.json", import.meta.url));
const { unstable_doesMiddlewareMatch } = requireAdmin("next/experimental/testing/server");
const source = await readFile(new URL("../apps/admin/proxy.ts", import.meta.url), "utf8");
const matcher = JSON.parse(source.match(/matcher:\s*(\[[^\n]+\])/)?.[1] ?? "null");
assert.ok(Array.isArray(matcher));
const matches = url => unstable_doesMiddlewareMatch({config:{matcher},nextConfig:{},url});

test("Hub API routes avoid page-proxy body cloning", () => {
  for (const url of ["/api/hub/", "/api/hub/v1/admin/assets", "/api/hub/v1/me", "/api/hub/missing?x=1"]) {
    assert.equal(matches(url), false, url);
  }
});

test("nearby namespaces, normal pages and auth pages retain page-proxy handling", () => {
  for (const url of ["/api/hub", "/api/hubbub", "/api/hub-v2", "/api/local-session", "/home", "/publish", "/login", "/account/request", "/auth/callback"]) {
    assert.equal(matches(url), true, url);
  }
});
