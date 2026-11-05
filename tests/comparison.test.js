import test from "node:test";
import assert from "node:assert/strict";
import { compareContexts } from "../lib/comparison.js";
import { ProjectIndex } from "../lib/snapshot.js";
import { DEMO_ROOT } from "../lib/workbench.js";

test("live comparison uses the exact same model/question twice and keeps real usage separate", async () => {
  const calls = [];
  const result = await compareContexts(new ProjectIndex().scan(DEMO_ROOT), "How does checkout work?",
    { model: "gpt-5.6-sol", budget: 700 }, async options => {
      calls.push(options);
      return { text: "Answer " + calls.length, usage: { input_tokens: calls.length === 1 ? 1100 : 500, output_tokens: 40, cached_input_tokens: 0 } };
    });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "gpt-5.6-sol");
  assert.equal(calls[0].prompt, calls[1].prompt);
  assert.notEqual(calls[0].context, calls[1].context);
  assert.equal(result.reportedInputTokensReduced, 600);
  assert.equal(result.answerReview, "unreviewed");
  assert.equal(result.complete, true);
});

test("missing usage is unknown, never substituted with local estimates", async () => {
  const result = await compareContexts(new ProjectIndex().scan(DEMO_ROOT), "Explain checkout", { model: "test" },
    async () => ({ text: "answer", usage: null }));
  assert.equal(result.reportedInputTokensReduced, null);
  assert.equal(result.runs.baseline.usage, null);
});

test("requires a model and refuses oversized baselines before making calls", async () => {
  const report = new ProjectIndex().scan(DEMO_ROOT);
  let calls = 0;
  const fake = async () => { calls++; return { text: "answer" }; };
  await assert.rejects(compareContexts(report, "question", {}, fake), /--model/);
  await assert.rejects(compareContexts(report, "question", { model: "test", baselineLimit: 128 }, fake), /baseline/);
  assert.equal(calls, 0);
});

test("partial provider failures preserve a completed baseline and its usage", async () => {
  let calls = 0;
  const result = await compareContexts(new ProjectIndex().scan(DEMO_ROOT), "checkout", { model: "test" }, async () => {
    if (++calls === 2) throw new Error("Provider unavailable");
    return { text: "Baseline answer", usage: { input_tokens: 1200 } };
  });
  assert.equal(result.complete, false);
  assert.equal(result.runs.baseline.usage.input_tokens, 1200);
  assert.match(result.runs.optimized.error, /Provider unavailable/);
});

test("pre-cancelled comparisons make no model calls", async () => {
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  const result = await compareContexts(new ProjectIndex().scan(DEMO_ROOT), "checkout",
    { model: "test", signal: controller.signal }, async () => { calls++; });
  assert.equal(calls, 0);
  assert.equal(result.complete, false);
});
