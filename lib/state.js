import fs from "node:fs";
import path from "node:path";

export function stateDirectory(root, child, create = false) {
  let current = root;
  for (const segment of [".token-saver", ...(child ? [child] : [])]) {
    current = path.join(current, segment);
    if (create) {
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Token Saver state paths must be directories, not symlinks.");
    } catch (error) {
      if (!create && error.code === "ENOENT") return null;
      throw error;
    }
  }
  return current;
}
