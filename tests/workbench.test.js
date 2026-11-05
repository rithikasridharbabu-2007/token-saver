import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fixture } from "./helpers.js";
import { renderWorkbench, makeWorkbenchData, startWorkbench, DEMO_ROOT } from "../lib/workbench.js";

test("standalone demo includes real recorded contexts for all preset budgets", () => {
  const data = makeWorkbenchData();
  assert.equal(data.mode, "replay");
  assert.equal(data.frames.length, 18);
  assert(data.frames.every(frame => frame.promptTokens <= frame.budget));
  assert.equal(data.evaluation.recommendedBudget, 700);
  assert.match(renderWorkbench(data), /Standalone demo/);
});

test("embedded source cannot break out of the JSON script element", () => {
  const rendered = renderWorkbench({ source: '</script><script>alert("bad")</script>' });
  assert(!rendered.includes('<script>alert("bad")'));
  assert(rendered.includes("\\u003c/script\\u003e"));
});

test("custom-project questions have no fabricated evidence scores", t => {
  const root = fixture(t, { "index.js": "export const app = 'hello';" });
  const data = makeWorkbenchData(root, "live");
  assert.equal(data.evaluation, null);
  assert.equal(data.initial.evidence.status, "unscored");
});

test("local server serves the UI and builds fresh contexts only inside its fixed root", async t => {
  const root = fixture(t, { "cache.js": "export const cache = 1;" });
  const { server, url } = await startWorkbench(root);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await page.text(), /Context workbench/);
  const post = body => fetch(url + "/api/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await (await post({ question: "Explain cache", budget: 300, root: "/ignored-path" })).json();
  assert.deepEqual(result.selectedFiles, ["cache.js"]);
  const firstHash = result.sourceFingerprint;
  fs.writeFileSync(path.join(root, "cache.js"), "export const cache = 222;");
  const changed = await (await post({ question: "Explain cache", budget: 300 })).json();
  assert.notEqual(changed.sourceFingerprint, firstHash);
  assert(changed.excerpts.some(excerpt => excerpt.content.includes("222")));
});

test("server rejects cross-origin and forged-host requests", async t => {
  const { server, url } = await startWorkbench(DEMO_ROOT);
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await fetch(url, { headers: { Origin: "https://untrusted.example" } })).status, 403);
  const forgedStatus = await new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: "untrusted.example" } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(forgedStatus, 403);
});

test("server bounds and validates requests instead of accepting arbitrary files or commands", async t => {
  const { server, url } = await startWorkbench(DEMO_ROOT);
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await fetch(url + "/api/file?path=/etc/passwd")).status, 404);
  const post = (body, type = "application/json") => fetch(url + "/api/context", { method: "POST", headers: { "Content-Type": type }, body });
  assert.equal((await post("bad json")).status, 400);
  assert.equal((await post("{}", "text/plain")).status, 415);
  assert.equal((await post(JSON.stringify({ question: "x", budget: 0 }))).status, 400);
  assert.equal((await post("x".repeat(17000))).status, 413);
});
