import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fixture } from "./helpers.js";
import { createSnapshot } from "../lib/snapshot.js";
import { selectRelevantFiles } from "../lib/relevanceSelector.js";
import { estimateTokens } from "../lib/tokenizer.js";
import { buildPrompt } from "../lib/prompt.js";
import { runBenchmark } from "../scripts/benchmark.js";

test("oversized first file stays within the entire prompt budget", () => {
  const snapshot = { "cache.js": "cache answer ".repeat(12000) };
  const result = selectRelevantFiles(snapshot, "Explain cache", { budget: 250 });
  assert(result.excerpts.length > 0);
  assert(result.excerpts[0].truncated || result.excerpts[0].partialLine);
  assert(estimateTokens(buildPrompt("Explain cache", result.content)) <= 250);
});

test("counts wrappers, Unicode and the question in every accepted budget", () => {
  const snapshot = { "cache.js": "const cache = '你好 🌎';\n".repeat(300) };
  for (const budget of [160, 250, 511, 1000]) {
    const result = selectRelevantFiles(snapshot, "Explain cache and 你好", { budget });
    assert(result.selectedTokens <= budget);
    assert.equal(result.selectedTokens, estimateTokens(buildPrompt("Explain cache and 你好", result.content)));
    assert.doesNotThrow(() => JSON.parse(result.content));
  }
});

test("rejects unreasonable options and questions larger than the budget", () => {
  assert.throws(() => selectRelevantFiles({}, "test", { budget: 0 }), /Budget/);
  assert.throws(() => selectRelevantFiles({}, "test", { maxFiles: 0 }), /Max files/);
  assert.throws(() => selectRelevantFiles({}, "hello ".repeat(300), { budget: 128 }), /question and instructions/);
  assert.throws(() => selectRelevantFiles({}, ""), /non-empty/);
  assert.throws(() => selectRelevantFiles({ "/absolute/cache.js": "cache" }, "cache"), /relative/);
});

test("retrieval is independent of parent folder names", t => {
  const firstRoot = fixture(t, { "a.js": "const a=1;", "cache.js": "const b=2;" });
  const secondRoot = path.join(fixture(t), "cache-project");
  // Create the second tree explicitly so its name includes the query term.
  fs.mkdirSync(secondRoot);
  fs.cpSync(firstRoot, secondRoot, { recursive: true });
  const first = selectRelevantFiles(createSnapshot(firstRoot), "cache", { maxFiles: 1 });
  const second = selectRelevantFiles(createSnapshot(secondRoot), "cache", { maxFiles: 1 });
  assert.deepEqual(first.selectedFiles, ["cache.js"]);
  assert.deepEqual(second.selectedFiles, first.selectedFiles);
});
import fs from "node:fs";

test("includes a local import needed to explain the selected entry point", () => {
  const snapshot = {
    "src/checkout.ts": 'import { calculateTotal } from "./pricing.js";\nexport function checkout() { return calculateTotal(); }',
    "src/pricing.ts": "export function calculateTotal() { return 123; }",
    "src/noise.js": "export const color = 'red';"
  };
  const result = selectRelevantFiles(snapshot, "Explain checkout.ts", { budget: 700, maxFiles: 3 });
  assert(result.selectedFiles.includes("src/checkout.ts"));
  assert(result.selectedFiles.includes("src/pricing.ts"));
  assert(result.selections.some(item => item.reasons.includes("imported by src/checkout.ts")));
  assert(!result.selectedFiles.includes("src/noise.js"));
});

test("retrieves a matching declaration late in a large file with correct lines", () => {
  const lines = [...Array.from({ length: 150 }, (_, i) => "// unrelated line " + i),
    "export function refreshSession() {", "  return 'rotated';", "}"];
  const result = selectRelevantFiles({ "auth.js": lines.join("\n") }, "Explain refreshSession", { budget: 300 });
  const excerpt = result.excerpts.find(item => item.content.includes("function refreshSession"));
  assert(excerpt);
  assert(excerpt.startLine <= 151 && excerpt.endLine >= 151);
  assert.equal(excerpt.content, lines.slice(excerpt.startLine - 1, excerpt.endLine).join("\n"));
});

test("marks low confidence instead of claiming an unrelated fallback is relevant", () => {
  const result = selectRelevantFiles({ "README.md": "A tiny demo", "index.js": "export const x=1;" }, "quasar neutrino");
  assert(result.lowConfidence);
  assert(result.warnings.length);
});

test("enforces selected file count and preserves special-token-looking source", () => {
  const result = selectRelevantFiles({
    "a.js": "const cache = '<|endoftext|>';",
    "b.js": "const cache = 2;",
    "c.js": "const cache = 3;"
  }, "Explain cache in a.js", { maxFiles: 1 });
  assert.equal(result.selectedFiles.length, 1);
  assert(result.content.includes("<|endoftext|>"));
});

test("authored retrieval benchmark retains expected files and evidence", () => {
  assert.equal(runBenchmark().passed, true);
});

test("small projects never grow just from repeated excerpt labels", () => {
  const result = selectRelevantFiles({ "cache.js": "cache();\n".repeat(90) }, "Explain cache", { budget: 4000 });
  assert(result.selectedTokens <= result.fullTokens);
});
