import { getChangedFiles } from "./changeDetector.js";
import { createCompactDiff } from "./diff.js";
import { estimateTokens } from "./tokenizer.js";

function createFullContext(snapshot) {
  return Object.entries(snapshot)
    .map(([file, content]) => `FILE: ${file}\n${content}`)
    .join("\n\n");
}

export function buildContext(previousSnapshot, currentSnapshot) {
  const fullContext = createFullContext(currentSnapshot);
  const originalTokens = estimateTokens(fullContext);

  if (Object.keys(previousSnapshot).length === 0) {
    return {
      content: fullContext,
      originalTokens,
      optimizedTokens: originalTokens,
      savedTokens: 0,
      changedFiles: Object.keys(currentSnapshot).length,
      firstScan: true
    };
  }

  const changes = getChangedFiles(previousSnapshot, currentSnapshot);

  if (changes.length === 0) {
    const content = "No project files changed since the previous request.";
    const optimizedTokens = estimateTokens(content);

    return {
      content,
      originalTokens,
      optimizedTokens,
      savedTokens: Math.max(0, originalTokens - optimizedTokens),
      changedFiles: 0,
      firstScan: false
    };
  }

  const sections = changes.map((change) => {
    if (change.type === "added") {
      return `FILE ADDED: ${change.file}\n${change.newContent}`;
    }

    if (change.type === "deleted") {
      return `FILE DELETED: ${change.file}`;
    }

    const result = createCompactDiff(
      change.oldContent,
      change.newContent
    );

    if (result.mode === "full") {
      return `FILE MODIFIED — FULL CONTENT: ${change.file}\n${result.content}`;
    }

    return `FILE MODIFIED — DIFF: ${change.file}\n${result.content}`;
  });

  const content = sections.join("\n\n");
  const optimizedTokens = estimateTokens(content);

  return {
    content,
    originalTokens,
    optimizedTokens,
    savedTokens: Math.max(0, originalTokens - optimizedTokens),
    changedFiles: changes.length,
    firstScan: false
  };
}
