import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fixture } from "./helpers.js";
import { ProjectIndex, createSnapshot } from "../lib/snapshot.js";
import { scanProject, readFileContents } from "../lib/fileTracker.js";

test("excludes secret filenames, keys, dependencies, builds, and locks", t => {
  const root = fixture(t, {
    ".env": "hidden", ".env.local": "hidden", ".env.production": "hidden",
    "nested/credentials.json": "hidden", "nested/secrets.yaml": "hidden",
    "private.key": "hidden", ".npmrc": "hidden", ".aws/config": "hidden",
    "dist/bundle.js": "generated", "node_modules/a/index.js": "generated",
    "package-lock.json": "{}", "main.js": "export const visible = true;"
  });
  assert.deepEqual(Object.keys(createSnapshot(root)), ["main.js"]);
});

test("honors root and nested ignores, negation, and custom ignore rules", t => {
  const root = fixture(t, {
    ".gitignore": "private/*\n!private/public.js\n*.log\n",
    ".tokensaverignore": "notes.md\n",
    "private/public.js": "visible", "private/hidden.js": "hidden",
    "src/.gitignore": "*.js\n!keep.js\n",
    "src/keep.js": "visible", "src/hide.js": "hidden", "notes.md": "hidden", "server.log": "hidden"
  });
  const files = Object.keys(createSnapshot(root));
  assert(files.includes("private/public.js"));
  assert(files.includes("src/keep.js"));
  for (const excluded of ["private/hidden.js", "src/hide.js", "notes.md", "server.log"]) assert(!files.includes(excluded));
});

test("ignore negation cannot re-enable sensitive files", t => {
  const root = fixture(t, { ".tokensaverignore": "!.env.local\n", ".env.local": "hidden", "index.js": "visible" });
  assert(!Object.keys(createSnapshot(root)).includes(".env.local"));
});

test("skips file symlinks, directory symlinks and loops", { skip: process.platform === "win32" }, t => {
  const root = fixture(t, { "index.js": "visible" });
  const outside = fixture(t, { "outside.js": "private outside source" });
  fs.symlinkSync(path.join(outside, "outside.js"), path.join(root, "linked.js"));
  fs.symlinkSync(outside, path.join(root, "linked-folder"));
  fs.symlinkSync(root, path.join(root, "loop"));
  assert.deepEqual(Object.keys(createSnapshot(root)), ["index.js"]);
  assert.throws(() => readFileContents(path.join(root, "linked.js")));
});

test("rejects symlinked ignore files instead of silently missing exclusions", { skip: process.platform === "win32" }, t => {
  const root = fixture(t, { "index.js": "visible" });
  const outside = fixture(t, { "ignore": "index.js\n" });
  fs.symlinkSync(path.join(outside, "ignore"), path.join(root, ".gitignore"));
  assert.throws(() => scanProject(root), /ignore file/);
});

test("skips binary, invalid UTF-8 and known credential patterns", t => {
  const root = fixture(t, {
    "binary.js": Buffer.from([1, 0, 2]),
    "invalid.py": Buffer.from([0xff, 0xfe]),
    "embedded.js": "const key = 'sk-" + "a".repeat(32) + "';",
    "private.txt": "-----BEGIN PRIVATE KEY-----\nexample",
    "normal.js": "const key = process.env.API_KEY;"
  });
  const report = new ProjectIndex().scan(root);
  assert.deepEqual(Object.keys(report.snapshot), ["normal.js"]);
  assert.equal(report.skipped["credential-pattern"], 2);
  assert.equal(report.skipped["binary-or-unreadable"], 2);
});

test("enforces file, project, entry and depth scan limits", t => {
  const root = fixture(t, { "a.js": "a".repeat(101), "b.js": "b".repeat(80), "c.js": "c".repeat(80) });
  const report = scanProject(root, { maxFileBytes: 100, maxTotalBytes: 100 });
  assert.equal(report.files.length, 1);
  assert.equal(report.skipped["large-file"], 1);
  assert.equal(report.skipped["project-limit"], 1);
  assert(report.warnings.length);
  assert(scanProject(root, { maxEntries: 1 }).skipped["entry-limit"]);
});

test("incremental index rereads changes and notices additions, deletions and ignore edits", t => {
  const root = fixture(t, { "a.js": "const a=1;" });
  const index = new ProjectIndex();
  const first = index.scan(root);
  assert.equal(first.reread, 1);
  assert.equal(index.scan(root).reread, 0);
  fs.writeFileSync(path.join(root, "a.js"), "const a=22;");
  const changed = index.scan(root);
  assert.equal(changed.reread, 1);
  assert.notEqual(changed.fingerprint, first.fingerprint);
  fs.writeFileSync(path.join(root, "b.js"), "const b=3;");
  assert.equal(index.scan(root).fileCount, 2);
  fs.rmSync(path.join(root, "a.js"));
  assert(!Object.hasOwn(index.scan(root).snapshot, "a.js"));
  fs.writeFileSync(path.join(root, ".tokensaverignore"), "b.js");
  assert(!Object.hasOwn(index.scan(root).snapshot, "b.js"));
});

test("rejects missing folders and ordinary files", t => {
  const root = fixture(t, { "a.js": "visible" });
  assert.throws(() => scanProject(path.join(root, "missing")));
  assert.throws(() => scanProject(path.join(root, "a.js")), /directory/);
});
