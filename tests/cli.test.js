import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fixture, fakeCodex } from "./helpers.js";
import { parseOptions } from "../lib/cli.js";
import { estimateTokens } from "../lib/tokenizer.js";

const cli = fileURLToPath(new URL("../index.js", import.meta.url));
function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    env: { ...process.env, ...env }, encoding: "utf8", timeout: 15000
  });
}

test("help, version and invalid options behave predictably", () => {
  assert.match(run(["--help"]).stdout, /Preview offline/);
  assert.match(run(["ask", "--help"]).stdout, /Preview offline/);
  assert.equal(run(["--version"]).stdout.trim(), "1.2.0");
  assert.equal(run(["--budget", "-1"]).status, 1);
  assert.equal(run(["--unknown"]).status, 1);
  assert.throws(() => parseOptions(["ask"]), /question/);
  assert.throws(() => parseOptions(["ask", "one", "two", "three"]), /Quote/);
  assert.throws(() => parseOptions(["--dry-run", "."]), /requires ask/);
  assert.throws(() => parseOptions(["ask", "question", "--model", ""]), /must not be empty/);
});

test("offline context works without Codex, produces JSON and never writes state", t => {
  const root = fixture(t, { "cache.js": "export function cache() { return 1; }" });
  const result = run(["context", "Explain cache", root, "--budget", "300", "--json"], { PATH: "" });
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.files, ["cache.js"]);
  assert(parsed.promptTokens <= 300);
  assert(!fs.existsSync(path.join(root, ".token-saver")));
});

test("dry run exports the exact budgeted prompt and refuses to overwrite files", t => {
  const root = fixture(t, { "cache.js": "export const cache = new Map();" });
  const out = path.join(fixture(t), "context.txt");
  const args = ["ask", "Explain cache", root, "--dry-run", "--output", out, "--budget", "300"];
  assert.equal(run(args, { PATH: "" }).status, 0);
  assert(estimateTokens(fs.readFileSync(out, "utf8").trimEnd()) <= 300);
  assert.equal(run(args, { PATH: "" }).status, 1);
});

test("missing project and script-style interactive input get clear errors", t => {
  const missing = path.join(fixture(t), "missing");
  assert.match(run(["context", "question", missing]).stderr, /Project folder/);
  assert.match(run([fixture(t)]).stderr, /For scripts/);
});

test("persistent CLI cache avoids repeated calls and invalidates after any eligible source change", { skip: process.platform === "win32" }, t => {
  const fake = fakeCodex(t);
  const root = fixture(t, { "cache.js": "export const cache = new Map();", "other.js": "export const x=1;" });
  const configHome = fixture(t, { "config.toml": "" });
  const env = { PATH: fake.root, CODEX_HOME: configHome };
  const args = ["ask", "Explain cache", root, "--json", "--model", "test-model"];
  const first = run(args, env);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).cacheHit, false);
  assert.equal(JSON.parse(first.stdout).usage.input_tokens, 123);
  const second = run(args, env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).cacheHit, true);
  assert.equal(JSON.parse(second.stdout).usage, null);
  assert.equal(fs.readFileSync(fake.log, "utf8").trim().split("\n").length, 1);
  fs.writeFileSync(path.join(root, "other.js"), "export const x=22;");
  assert.equal(JSON.parse(run(args, env).stdout).cacheHit, false);
  const otherModel = [...args.slice(0, -1), "different-model"];
  assert.equal(JSON.parse(run(otherModel, env).stdout).cacheHit, false);
  fs.writeFileSync(path.join(configHome, "config.toml"), "# changed config");
  assert.equal(JSON.parse(run(args, env).stdout).cacheHit, false);
  assert.equal(run(["cache", "clear", root], env).status, 0);
  assert.equal(JSON.parse(run(["cache", "info", root, "--json"], env).stdout).entries, 0);
});

test("no-cache asks do not create cache files", { skip: process.platform === "win32" }, t => {
  const fake = fakeCodex(t);
  const root = fixture(t, { "cache.js": "const cache=1;" });
  const env = { PATH: fake.root, CODEX_HOME: fixture(t) };
  const result = run(["ask", "cache", root, "--no-cache", "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  assert(!fs.existsSync(path.join(root, ".token-saver")));
});

test("provider failures are not cached", { skip: process.platform === "win32" }, t => {
  const fake = fakeCodex(t, "fail");
  const root = fixture(t, { "index.js": "export const ready=true;" });
  const env = { PATH: fake.root, CODEX_HOME: fixture(t) };
  const result = run(["ask", "Explain ready", root, "--json"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Synthetic provider failure/);
  assert(!fs.existsSync(path.join(root, ".token-saver/cache")));
});

test("doctor reports missing Codex without pretending to check login", t => {
  const root = fixture(t, { "index.js": "export const x=1;" });
  const result = run(["doctor", root, "--json"], { PATH: "" });
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.loginChecked, false);
  assert.equal(parsed.codex, null);
  assert.equal(parsed.readableFiles, 1);
});
