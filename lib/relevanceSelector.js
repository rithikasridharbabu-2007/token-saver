import { estimateTokens } from "./tokenizer.js";

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "what",
  "when",
  "where",
  "which",
  "how",
  "does",
  "can",
  "could",
  "would",
  "should",
  "into",
  "about",
  "your",
  "have"
]);

function getSearchTerms(prompt) {
  const words = prompt.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];

  return [...new Set(words)].filter(
    (word) => word.length >= 3 && !stopWords.has(word)
  );
}

function countOccurrences(text, searchTerm) {
  return text.split(searchTerm).length - 1;
}

function makeContext(entries) {
  return entries
    .map(([file, content]) => `FILE: ${file}\n${content}`)
    .join("\n\n");
}

export function selectRelevantFiles(
  snapshot,
  prompt,
  options = {}
) {
  const maxFiles = options.maxFiles ?? 4;
  const maxCharacters = options.maxCharacters ?? 16000;

  if (typeof prompt !== "string") {
    throw new TypeError("Prompt must be a string.");
  }

  const terms = getSearchTerms(prompt);
  const lowerPrompt = prompt.toLowerCase();

  const rankedFiles = Object.entries(snapshot).map(
    ([file, content]) => {
      const lowerFile = file.toLowerCase();
      const lowerContent = content.toLowerCase();
      let score = 0;

      for (const term of terms) {
        if (lowerFile.includes(term)) {
          score += 10;
        }

        const matches = countOccurrences(lowerContent, term);
        score += Math.min(matches, 5);
      }

      if (
        /(package|dependency|dependencies|install|npm)/.test(
          lowerPrompt
        ) &&
        lowerFile.endsWith("package.json")
      ) {
        score += 20;
      }

      if (
        /(start|run|entry|cli|terminal|command)/.test(lowerPrompt) &&
        /(^|\/)index\.(js|mjs|cjs|ts)$/.test(lowerFile)
      ) {
        score += 20;
      }

      if (
        /(readme|setup|documentation|instructions)/.test(
          lowerPrompt
        ) &&
        lowerFile.includes("readme")
      ) {
        score += 20;
      }

      return {
        file,
        content,
        score
      };
    }
  );

  rankedFiles.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.file.localeCompare(b.file);
  });

  let candidates = rankedFiles.filter((item) => item.score > 0);

  if (candidates.length === 0) {
    candidates = rankedFiles.sort((a, b) => {
      const aPriority =
        /(^|\/)index\.(js|mjs|cjs|ts)$/.test(a.file) ? 0 : 1;
      const bPriority =
        /(^|\/)index\.(js|mjs|cjs|ts)$/.test(b.file) ? 0 : 1;

      return aPriority - bPriority;
    });
  }

  const selectedEntries = [];
  let usedCharacters = 0;

  for (const candidate of candidates) {
    if (selectedEntries.length >= maxFiles) {
      break;
    }

    const estimatedSize =
      candidate.file.length + candidate.content.length;

    if (
      selectedEntries.length > 0 &&
      usedCharacters + estimatedSize > maxCharacters
    ) {
      continue;
    }

    selectedEntries.push([
      candidate.file,
      candidate.content
    ]);

    usedCharacters += estimatedSize;
  }

  const fullContext = makeContext(Object.entries(snapshot));
  const selectedContext = makeContext(selectedEntries);

  const fullTokens = estimateTokens(fullContext);
  const selectedTokens = estimateTokens(selectedContext);

  return {
    content: selectedContext,
    selectedFiles: selectedEntries.map(([file]) => file),
    fullTokens,
    selectedTokens,
    savedTokens: Math.max(0, fullTokens - selectedTokens)
  };
}
