import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stateDirectory } from "./state.js";
import { readFileContents } from "./fileTracker.js";

export function createCacheKey(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class AnswerCache {
  constructor(root, { enabled = true, ttlMs = 24 * 60 * 60 * 1000, maxEntries = 100, maxBytes = 10 * 1024 * 1024, now = Date.now } = {}) {
    Object.assign(this, { root, enabled, ttlMs, maxEntries, maxBytes, now });
  }

  filename(folder, key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid cache key.");
    return path.join(folder, key + ".json");
  }

  get(key) {
    if (!this.enabled) return null;
    const folder = stateDirectory(this.root, "cache");
    if (!folder) return null;
    const file = this.filename(folder, key);
    try {
      const value = JSON.parse(readFileContents(file, 2 * 1024 * 1024));
      if (value.version !== 2 || !Number.isFinite(value.expiresAt) || value.expiresAt <= this.now() || typeof value.text !== "string" || !value.text.trim()) return null;
      return { text: value.text, usage: null, cached: true };
    } catch (error) {
      if (["EACCES", "EPERM", "ELOOP"].includes(error.code)) throw error;
      return null;
    }
  }

  set(key, result) {
    if (!this.enabled || !result.text?.trim()) return;
    const body = JSON.stringify({ version: 2, createdAt: this.now(), expiresAt: this.now() + this.ttlMs, text: result.text });
    if (Buffer.byteLength(body) > Math.min(this.maxBytes, 2 * 1024 * 1024)) return;
    const folder = stateDirectory(this.root, "cache", true);
    const file = this.filename(folder, key);
    const temporary = path.join(folder, randomUUID() + ".tmp");
    try {
      fs.writeFileSync(temporary, body, { flag: "wx", mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    const entries = this.entries().sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
    let bytes = 0;
    entries.forEach((entry, index) => {
      bytes += entry.size;
      if (index >= this.maxEntries || bytes > this.maxBytes) fs.rmSync(path.join(folder, entry.name), { force: true });
    });
  }

  entries() {
    const folder = stateDirectory(this.root, "cache");
    if (!folder) return [];
    return fs.readdirSync(folder).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).flatMap(name => {
      try {
        const stat = fs.lstatSync(path.join(folder, name));
        return stat.isFile() ? [{ name, size: stat.size, mtimeMs: stat.mtimeMs }] : [];
      } catch { return []; }
    });
  }

  clear() {
    const folder = stateDirectory(this.root, "cache");
    if (folder) for (const entry of this.entries()) fs.rmSync(path.join(folder, entry.name), { force: true });
  }

  info() {
    const entries = this.entries();
    return { entries: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.size, 0), ttlHours: this.ttlMs / 3600000 };
  }
}
