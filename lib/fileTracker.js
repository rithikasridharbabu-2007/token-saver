import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";

const excludedDirectories = new Set([
  ".git", ".svn", ".hg", ".token-saver", "node_modules", "vendor",
  "dist", "build", "coverage", ".next", ".nuxt", ".venv", "venv",
  "__pycache__", ".cache", ".idea", ".vscode", ".aws", ".ssh", ".codex"
]);
const extensions = new Set((
  ".js .jsx .ts .tsx .mjs .cjs .mts .cts .py .pyi .go .rs .java .kt .kts " +
  ".c .h .cc .cpp .hpp .cs .rb .php .swift .scala .sh .bash .zsh .ps1 " +
  ".html .css .scss .sass .less .vue .svelte .astro .json .jsonc .yaml .yml " +
  ".toml .xml .sql .graphql .gql .proto .prisma .md .mdx .txt .rst .ini .cfg"
).split(" "));
const specialFiles = new Set(["dockerfile", "makefile", "cmakelists.txt", "license", "procfile", ".gitignore", ".tokensaverignore"]);
const lockFiles = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "cargo.lock", "poetry.lock", "uv.lock", "composer.lock", "gemfile.lock"]);
export const posixPath = value => value.split(path.sep).join("/");

function sensitive(name) {
  return /^\.env(?:$|[._-])/i.test(name) ||
    /^(?:\.npmrc|\.pypirc|\.netrc|id_rsa|id_dsa|id_ed25519|credentials?|secrets?)(?:$|[._-])/i.test(name) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(name);
}

// O_NOFOLLOW also protects against a file changing to a symlink between scan and read.
export function readFileContents(file, maxBytes = 512 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("File exceeds read limits.");
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, stat.size + 1));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytes > maxBytes) throw new Error("File exceeds read limits.");
    const data = buffer.subarray(0, bytes);
    if (data.includes(0)) throw new Error("Binary file.");
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } finally {
    fs.closeSync(fd);
  }
}

export function containsKnownSecret(content) {
  return /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/.test(content) ||
    /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16})\b/.test(content);
}

export function scanProject(folderPath, options = {}) {
  const root = fs.realpathSync(path.resolve(folderPath));
  if (!fs.statSync(root).isDirectory()) throw new Error("Project path must be a directory.");
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 20 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 10000;
  const maxEntries = options.maxEntries ?? 50000;
  const files = [];
  const skipped = {};
  const warnings = [];
  let totalBytes = 0;
  let visited = 0;
  let limited = false;
  const skip = reason => { skipped[reason] = (skipped[reason] ?? 0) + 1; };

  function visit(folder, inherited, depth = 0) {
    if (depth > 64) { skip("depth-limit"); return; }
    if (limited) return;
    const layers = [...inherited];
    for (const filename of [".gitignore", ".tokensaverignore"]) {
      const filenamePath = path.join(folder, filename);
      try {
        const ignoreStat = fs.lstatSync(filenamePath);
        if (ignoreStat.isSymbolicLink()) throw new Error("Symlinked ignore file.");
        if (!ignoreStat.isFile()) continue;
        layers.push({ folder, matcher: ignore({ ignorecase: false }).add(readFileContents(filenamePath, 128 * 1024)) });
      } catch (error) {
        if (error.code !== "ENOENT") throw new Error("Could not read an ignore file; scan stopped to avoid including excluded files.");
      }
    }
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch { skip("unreadable-directory"); return; }
    for (const entry of entries) {
      if (++visited > maxEntries) { skip("entry-limit"); limited = true; return; }
      const absolute = path.join(folder, entry.name);
      const relative = posixPath(path.relative(root, absolute));
      if (entry.isSymbolicLink()) { skip("symlink"); continue; }
      if (sensitive(entry.name)) { skip("sensitive-name"); continue; }
      if (entry.isDirectory() && excludedDirectories.has(entry.name.toLowerCase())) { skip("generated-directory"); continue; }
      let ignored = false;
      for (const layer of layers) {
        const local = posixPath(path.relative(layer.folder, absolute)) + (entry.isDirectory() ? "/" : "");
        const match = layer.matcher.test(local);
        if (match.ignored) ignored = true;
        else if (match.unignored) ignored = false;
      }
      if (ignored) { skip("ignore-rule"); continue; }
      if (entry.isDirectory()) { visit(absolute, layers, depth + 1); continue; }
      if (!entry.isFile()) { skip("special-file"); continue; }
      const name = entry.name.toLowerCase();
      if (lockFiles.has(name) || /\.min\.(?:js|css)$/.test(name)) { skip("generated-file"); continue; }
      if (!extensions.has(path.extname(name)) && !specialFiles.has(name)) { skip("unsupported-type"); continue; }
      try {
        const stat = fs.lstatSync(absolute);
        if (!stat.isFile()) { skip("changed-during-scan"); continue; }
        if (stat.size > maxFileBytes) { skip("large-file"); continue; }
        if (files.length >= maxFiles || totalBytes + stat.size > maxTotalBytes) { skip("project-limit"); continue; }
        totalBytes += stat.size;
        files.push({ file: relative, absolute, signature: [stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":") });
      } catch { skip("unreadable-file"); }
    }
  }
  visit(root, []);
  if (skipped["project-limit"] || skipped["entry-limit"] || skipped["depth-limit"]) warnings.push("Scan limits reached; some project files were excluded.");
  return { root, files, skipped, warnings, totalBytes };
}

export function scanFiles(folderPath) {
  return scanProject(folderPath).files.map(file => file.absolute);
}
