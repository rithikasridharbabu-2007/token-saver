export function createCompactDiff(oldContent, newContent) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  let start = 0;

  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;

  while (
    oldEnd >= start &&
    newEnd >= start &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }

  const removedLines = oldLines.slice(start, oldEnd + 1);
  const addedLines = newLines.slice(start, newEnd + 1);

  const diff = [
    `@@ starting at line ${start + 1} @@`,
    ...removedLines.map((line) => `- ${line}`),
    ...addedLines.map((line) => `+ ${line}`)
  ].join("\n");

  if (diff.length >= newContent.length) {
    return {
      mode: "full",
      content: newContent
    };
  }

  return {
    mode: "diff",
    content: diff
  };
}
