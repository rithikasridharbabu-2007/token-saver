import fs from "node:fs";
import path from "node:path";

const ignoredFolders = new Set([
  "node_modules",
  ".git",
  ".token-saver"
]);

const ignoredFiles = new Set([
  ".env",
  ".DS_Store",
  "package-lock.json"
]);

export function scanFiles(folderPath) {
  const results = [];

  function scan(currentFolder) {
    const items = fs.readdirSync(currentFolder);

    for (const item of items) {
      const fullPath = path.join(currentFolder, item);
      const information = fs.statSync(fullPath);

      if (information.isDirectory()) {
        if (!ignoredFolders.has(item)) {
          scan(fullPath);
        }
      } else if (
        information.isFile() &&
        !ignoredFiles.has(item)
      ) {
        results.push(fullPath);
      }
    }
  }

  scan(folderPath);
  return results;
}

export function readFileContents(filePath) {
  if (typeof filePath !== "string") {
    throw new TypeError("File path must be a string.");
  }

  return fs.readFileSync(filePath, "utf8");
}
