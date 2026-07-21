import { scanFiles, readFileContents } from "./fileTracker.js";

export function createSnapshot(folderPath) {
  const files = scanFiles(folderPath);
  const snapshot = {};

  for (const file of files) {
    snapshot[file] = readFileContents(file);
  }

  return snapshot;
}
