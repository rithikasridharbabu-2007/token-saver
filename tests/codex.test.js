import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fakeCodex } from "./helpers.js";
import { askModel, checkCodex } from "../lib/openaiClient.js";

test("parses split JSON events, final unterminated event, and reported usage", { skip: process.platform === "win32" }, async t => {
  const fake = fakeCodex(t);
  const result = await askModel({ prompt: "Explain cache", context: "[]", command: fake.file, model: "my-model" });
  assert.equal(result.text, "Answer from selected source.");
  assert.equal(result.threadId, "test-thread");
  assert.deepEqual(result.usage, { input_tokens: 123, cached_input_tokens: 40, output_tokens: 17 });
  const call = JSON.parse(fs.readFileSync(fake.log, "utf8").trim());
  assert(call.args.includes("--json"));
  assert(call.args.includes("--ephemeral"));
  assert(call.args.includes("read-only"));
  assert(call.args.includes("shell_tool"));
  assert(call.args.includes("my-model"));
  assert(!fs.existsSync(call.cwd), "temporary directory must be cleaned");
  assert(call.input.includes("untrusted data"));
});

test("missing executable produces an actionable error", async () => {
  await assert.rejects(askModel({ prompt: "hi", context: "[]", command: "/does-not-exist/token-saver-codex" }), /missing/);
  assert.throws(() => checkCodex("/does-not-exist/token-saver-codex"), /Install Codex/);
});

for (const [mode, expected] of [
  ["fail", /Synthetic provider failure/],
  ["invalid", /invalid JSON/],
  ["empty", /no answer/],
  ["tool", /attempted to use a tool/]
]) {
  test("rejects " + mode + " responses", { skip: process.platform === "win32" }, async t => {
    const fake = fakeCodex(t, mode);
    await assert.rejects(askModel({ prompt: "question", context: "[]", command: fake.file }), expected);
    if (fs.existsSync(fake.log)) {
      const call = JSON.parse(fs.readFileSync(fake.log, "utf8").trim());
      assert(!fs.existsSync(call.cwd));
    }
  });
}

test("times out and cleans up a stuck child", { skip: process.platform === "win32" }, async t => {
  const fake = fakeCodex(t, "hang");
  await assert.rejects(askModel({ prompt: "question", context: "[]", command: fake.file, timeoutMs: 750 }), /timed out/);
  if (fs.existsSync(fake.log)) {
    const call = JSON.parse(fs.readFileSync(fake.log, "utf8").trim());
    assert(!fs.existsSync(call.cwd));
  }
});

test("cancels an active request", { skip: process.platform === "win32" }, async t => {
  const fake = fakeCodex(t, "hang");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 200);
  t.after(() => clearTimeout(timer));
  await assert.rejects(askModel({ prompt: "question", context: "[]", command: fake.file, signal: controller.signal }), /cancelled/);
});

test("pre-aborted requests never start a child", async t => {
  const fake = fakeCodex(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(askModel({ prompt: "question", context: "[]", command: fake.file, signal: controller.signal }), /cancelled/);
  assert(!fs.existsSync(fake.log));
});
