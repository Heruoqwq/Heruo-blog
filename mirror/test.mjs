import { test } from "node:test";
import assert from "node:assert/strict";
import proxy from "./netlify/edge-functions/api.js";
const site = "https://heruo-test.netlify.app";
const upstream = "https://tony-journal-heruo.prime-gleam-7947.chatgpt.site";
test("forwards path, query and upstream error without granting access", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.href, upstream + "/api/oj/problems/20?editorial=1");
    assert.equal(init.headers.get("authorization"), null);
    assert.equal(init.headers.get("origin"), upstream);
    assert.equal(init.redirect, "manual");
    return Response.json({ error: "题目不存在" }, { status: 404, headers: { "Cache-Control": "public,max-age=3600" } });
  });
  const res = await proxy(new Request(site + "/api/oj/problems/20?editorial=1"));
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "题目不存在" });
  assert.equal(res.headers.get("Cache-Control"), "private, no-store");
  assert.equal(res.headers.get("Netlify-CDN-Cache-Control"), "no-store");
});
test("forwards caller bearer token and exact submission bytes", async (t) => {
  const body = JSON.stringify({ code: "int main(){}", problem_id: 1 });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.href, upstream + "/api/oj/submissions");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("authorization"), "Bearer test-session");
    assert.equal(init.headers.get("cookie"), null);
    assert.equal(await new Response(init.body).text(), body);
    return Response.json({ id: 7 }, { status: 201 });
  });
  const req = new Request(site + "/api/oj/submissions", { method: "POST", headers: {
    Origin: site, Authorization: "Bearer test-session", "Content-Type": "application/json", Cookie: "unrelated=1",
  }, body });
  const res = await proxy(req);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { id: 7 });
});
test("rejects foreign origins, unsupported methods and non-API routes before fetch", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", () => assert.fail("unexpected fetch"));
  assert.equal((await proxy(new Request(site + "/api/auth/login", { method: "POST", headers: { Origin: "https://other.example" } }))).status, 403);
  assert.equal((await proxy(new Request(site + "/api/posts", { method: "PUT" }))).status, 405);
  assert.equal((await proxy(new Request(site + "/elsewhere"))).status, 404);
  assert.equal((await proxy(new Request(site + "/api/posts", { method: "OPTIONS", headers: { Origin: site } }))).status, 204);
  assert.equal(mock.mock.callCount(), 0);
});
test("preserves binary upload and download bytes", async (t) => {
  const data = new Uint8Array([0, 10, 128, 255]);
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.deepEqual(new Uint8Array(await new Response(init.body).arrayBuffer()), data);
    return new Response(data, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=test.in" } });
  });
  const res = await proxy(new Request(site + "/api/oj/files", { method: "POST", body: data }));
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), data);
  assert.equal(res.headers.get("Content-Disposition"), "attachment; filename=test.in");
});
test("does not follow redirects or leak connection diagnostics", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 302, headers: { Location: "https://unexpected.example" } }));
  assert.equal((await proxy(new Request(site + "/api/posts"))).status, 502);
  globalThis.fetch = async () => { throw new Error("internal connection details"); };
  const res = await proxy(new Request(site + "/api/posts"));
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes("internal connection details"));
});
