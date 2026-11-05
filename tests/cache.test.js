import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers.js";
import { AnswerCache, createCacheKey } from "../lib/cache.js";

test("saved answers survive a fresh cache instance and have no replayed usage", t => {
  const root = fixture(t);
  const key = createCacheKey({ prompt: "question", context: "code" });
  new AnswerCache(root).set(key, { text: "answer", usage: { input_tokens: 10 } });
  const result = new AnswerCache(root).get(key);
  assert.equal(result.text, "answer");
  assert.equal(result.usage, null);
  assert.equal(result.cached, true);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(path.join(root, ".token-saver/cache", key + ".json")).mode & 0o777, 0o600);
  }
});

test("cache identity changes with code, question, model and prompt version", () => {
  const base = { code: "one", question: "what", model: "configured-model", version: 2 };
  const key = createCacheKey(base);
  for (const property of Object.keys(base)) assert.notEqual(createCacheKey({ ...base, [property]: "changed" }), key);
});

test("expired answers are missed", t => {
  const root = fixture(t);
  let now = 1000;
  const cache = new AnswerCache(root, { now: () => now, ttlMs: 100 });
  const key = createCacheKey("question");
  cache.set(key, { text: "answer" });
  assert(cache.get(key));
  now = 1100;
  assert.equal(cache.get(key), null);
});

test("bounded cache evicts old entries and clear removes saved answers", t => {
  const root = fixture(t);
  const cache = new AnswerCache(root, { maxEntries: 2 });
  for (let i = 0; i < 5; i++) cache.set(createCacheKey(i), { text: "answer " + i });
  assert.equal(cache.info().entries, 2);
  cache.clear();
  assert.equal(cache.info().entries, 0);
});

test("disabled cache and empty answers do not write project state", t => {
  const root = fixture(t);
  const cache = new AnswerCache(root, { enabled: false });
  const key = createCacheKey("q");
  cache.set(key, { text: "answer" });
  assert.equal(cache.get(key), null);
  new AnswerCache(root).set(key, { text: "" });
  assert(!fs.existsSync(path.join(root, ".token-saver")));
});

test("corrupt entries are misses and oversized answers are not stored", t => {
  const root = fixture(t);
  const key = createCacheKey("q");
  const cache = new AnswerCache(root, { maxBytes: 200 });
  cache.set(key, { text: "x".repeat(1000) });
  assert.equal(cache.info().entries, 0);
  const folder = path.join(root, ".token-saver/cache");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, key + ".json"), "{invalid");
  assert.equal(cache.get(key), null);
  assert.throws(() => cache.get("../escape"), /Invalid cache key/);
});

test("state directory symlinks are rejected", { skip: process.platform === "win32" }, t => {
  const root = fixture(t);
  const outside = fixture(t);
  fs.symlinkSync(outside, path.join(root, ".token-saver"));
  assert.throws(() => new AnswerCache(root).set(createCacheKey("q"), { text: "answer" }), /symlinks/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
