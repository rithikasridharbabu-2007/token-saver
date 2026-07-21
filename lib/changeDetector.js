export function getChangedFiles(previousSnapshot, currentSnapshot) {
  const changes = [];
  const allFiles = new Set([
    ...Object.keys(previousSnapshot),
    ...Object.keys(currentSnapshot)
  ]);

  for (const file of allFiles) {
    const existedBefore = Object.hasOwn(previousSnapshot, file);
    const existsNow = Object.hasOwn(currentSnapshot, file);

    if (!existedBefore && existsNow) {
      changes.push({
        file,
        type: "added",
        oldContent: "",
        newContent: currentSnapshot[file]
      });
    } else if (existedBefore && !existsNow) {
      changes.push({
        file,
        type: "deleted",
        oldContent: previousSnapshot[file],
        newContent: ""
      });
    } else if (previousSnapshot[file] !== currentSnapshot[file]) {
      changes.push({
        file,
        type: "modified",
        oldContent: previousSnapshot[file],
        newContent: currentSnapshot[file]
      });
    }
  }

  return changes;
}
