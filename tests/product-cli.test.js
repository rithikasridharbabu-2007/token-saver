import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture, fakeCodex } from "./helpers.js";

const cli = fileURLToPath(new URL("../index.js", import.meta.url));
const demo = fileURLToPath(new URL("../examples/demo-project", import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], {
  env: { ...process.env, ...env }, encoding: "utf8", timeout: 15000
});

test("evaluation command saves a reproducible report without Codex", t => {
  const output = path.join(fixture(t), "report.json");
  const result = run(["evaluate", "--output", output, "--json"], { PATH: "" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.recommendedBudget, 700);
  assert.equal(report.kind, "offline-evidence-evaluation");
  assert.equal(run(["evaluate", "--output", output]).status, 1);
});

test("standalone demo export works without a model account or server", t => {
  const output = path.join(fixture(t), "demo.html");
  const result = run(["demo", "--output", output], { PATH: "" });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, "utf8");
  assert(html.includes('"mode":"replay"'));
  assert(!html.includes("__TOKEN_SAVER_DATA__"));
  assert(html.includes("No model call is made"));
});

test("comparison command makes two uncached requests and writes actual provider data", { skip: process.platform === "win32" }, t => {
  const fake = fakeCodex(t);
  const output = path.join(fixture(t), "compare.json");
  const result = run(["compare", "How does checkout work?", demo, "--model", "gpt-5.6-sol", "--output", output],
    { PATH: fake.root, CODEX_HOME: fixture(t) });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.complete, true);
  assert.equal(report.model, "gpt-5.6-sol");
  assert.equal(report.runs.baseline.usage.input_tokens, 123);
  assert.equal(report.reportedInputTokensReduced, 0);
  assert.equal(fs.readFileSync(fake.log, "utf8").trim().split("\n").length, 2);
});

test("failed comparisons still save an honest partial report", { skip: process.platform === "win32" }, t => {
  const fake = fakeCodex(t, "fail");
  const output = path.join(fixture(t), "partial.json");
  const result = run(["compare", "Explain checkout", demo, "--model", "gpt-5.6-sol", "--output", output], { PATH: fake.root });
  assert.equal(result.status, 1);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.complete, false);
  assert.match(report.runs.baseline.error, /Synthetic provider failure/);
  assert.equal(report.reportedInputTokensReduced, null);
});
