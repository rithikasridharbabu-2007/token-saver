import { createHash } from "node:crypto";
import { scanProject, readFileContents, containsKnownSecret } from "./fileTracker.js";

export class ProjectIndex {
  #files = new Map();

  scan(folderPath, options = {}) {
    const report = scanProject(folderPath, options);
    const next = new Map();
    const snapshot = Object.create(null);
    let reread = 0;
    for (const entry of report.files) {
      try {
        let cached = this.#files.get(entry.absolute);
        if (!cached || cached.signature !== entry.signature) {
          const content = readFileContents(entry.absolute, options.maxFileBytes);
          reread++;
          cached = { signature: entry.signature, content, secret: containsKnownSecret(content) };
        }
        next.set(entry.absolute, cached);
        if (cached.secret) {
          report.skipped["credential-pattern"] = (report.skipped["credential-pattern"] ?? 0) + 1;
          continue;
        }
        snapshot[entry.file] = cached.content;
      } catch {
        report.skipped["binary-or-unreadable"] = (report.skipped["binary-or-unreadable"] ?? 0) + 1;
      }
    }
    this.#files = next;
    const fingerprint = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    return { ...report, snapshot, fingerprint, reread, fileCount: Object.keys(snapshot).length };
  }
}

export function createSnapshot(folderPath) {
  return new ProjectIndex().scan(folderPath).snapshot;
}
