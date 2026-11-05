import path from "node:path";
import { estimateTokens, TOKEN_ENCODING } from "./tokenizer.js";
import { buildPrompt } from "./prompt.js";

const stopWords = new Set("a an the and or for with this that from what when where which how does can could would should into about your have explain works work project code please show me is are to of in it do".split(" "));
const aliases = {
  login: ["auth", "authenticate", "authentication"],
  authentication: ["auth", "login", "authenticate"],
  caching: ["cache"], dependencies: ["dependency", "package"],
  tests: ["test"], settings: ["config"], configuration: ["config"]
};

export function searchTerms(text) {
  const full = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const parts = text.replace(/([a-z\d])([A-Z])/g, "$1 $2").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set([...full, ...parts])].filter(word => word.length > 1 && !stopWords.has(word));
}

function counts(words) {
  const result = new Map();
  for (const word of words) result.set(word, (result.get(word) ?? 0) + 1);
  return result;
}

function makeChunks(file, content) {
  const lines = content.split("\n");
  const pieces = [];
  let current = [];
  let start = 1;
  let length = 0;
  const flush = end => {
    if (current.length) pieces.push({ file, startLine: start, endLine: end, text: current.join("\n") });
    current = [];
    length = 0;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.length > 1800) {
      flush(index);
      for (let offset = 0; offset < line.length; offset += 1800) {
        pieces.push({ file, startLine: index + 1, endLine: index + 1, text: line.slice(offset, offset + 1800), partialLine: true });
      }
      start = index + 2;
      continue;
    }
    const declarationStart = /^(?:export\s+)?(?:async\s+)?(?:function|class|def|fn|interface)\s|^export\s+(?:const|let)\s/.test(line);
    if (current.length >= 45 || length + line.length > 6000 || (current.length >= 12 && declarationStart)) {
      flush(index);
      start = index + 1;
    }
    if (!current.length) start = index + 1;
    current.push(line);
    length += line.length + 1;
  }
  flush(lines.length);
  return pieces;
}

function dependencies(file, content, available) {
  const specs = [];
  for (const match of content.matchAll(/(?:from\s*|import\s*|require\s*\(\s*)["'](\.[^"']+)["']/g)) specs.push(match[1]);
  for (const match of content.matchAll(/^\s*from\s+(\.[\w.]*)\s+import/gm)) {
    const spec = match[1];
    const dots = spec.match(/^\.+/)[0].length;
    specs.push("./" + "../".repeat(dots - 1) + spec.slice(dots).replaceAll(".", "/"));
  }
  const resolved = new Set();
  for (const spec of specs) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    if (base.startsWith("../")) continue;
    const stem = base.replace(/\.(?:m?js|cjs)$/, "");
    const candidates = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".py"].map(ext => base + ext),
      stem + ".ts", stem + ".tsx", ...["index.ts", "index.js", "__init__.py"].map(name => base + "/" + name)];
    const found = candidates.find(candidate => available.has(candidate));
    if (found) resolved.add(found);
  }
  return [...resolved];
}

function excerpt(chunk, text = chunk.text) {
  const endLine = Math.min(chunk.endLine, chunk.startLine + text.split("\n").length - 1);
  return {
    file: chunk.file,
    startLine: chunk.startLine,
    endLine,
    ...(chunk.partialLine ? { partialLine: true } : {}),
    ...(text.length < chunk.text.length ? { truncated: true } : {}),
    content: text
  };
}

export function selectRelevantFiles(snapshot, question, options = {}) {
  if (typeof question !== "string" || !question.trim()) throw new TypeError("Question must be a non-empty string.");
  const budget = options.budget ?? 4000;
  const maxFiles = options.maxFiles ?? 8;
  if (!Number.isSafeInteger(budget) || budget < 128 || budget > 100000) throw new Error("Budget must be an integer from 128 to 100000.");
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 50) throw new Error("Max files must be an integer from 1 to 50.");
  if (estimateTokens(buildPrompt(question, "[]")) >= budget) throw new Error("The question and instructions exceed the budget. Increase --budget or shorten the question.");

  const entries = Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([file]) => path.posix.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file))) {
    throw new Error("Selection expects project-relative paths.");
  }
  const originalTerms = searchTerms(question);
  const terms = [...new Set(originalTerms.flatMap(term => [term, ...(aliases[term] ?? [])]))];
  const chunks = entries.flatMap(([file, content]) => makeChunks(file, content));
  const tokenized = chunks.map(chunk => ({ ...chunk, words: searchTerms(chunk.text), pathWords: searchTerms(chunk.file) }));
  const frequency = new Map();
  for (const chunk of tokenized) for (const word of new Set(chunk.words)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  const averageLength = tokenized.reduce((sum, chunk) => sum + chunk.words.length, 0) / (tokenized.length || 1);
  const lowerQuestion = question.toLowerCase();

  const ranked = tokenized.map(chunk => {
    const tf = counts(chunk.words);
    let score = 0;
    const matched = [];
    for (const term of terms) {
      const count = tf.get(term) ?? 0;
      const pathMatch = chunk.pathWords.includes(term);
      if (count || pathMatch) matched.push(term);
      const idf = Math.log(1 + (tokenized.length - (frequency.get(term) ?? 0) + 0.5) / ((frequency.get(term) ?? 0) + 0.5));
      if (count) score += idf * (count * 2.2) / (count + 1.2 * (0.25 + 0.75 * chunk.words.length / (averageLength || 1)));
      if (pathMatch) score += 4;
    }
    const basename = path.posix.basename(chunk.file).toLowerCase();
    const explicit = lowerQuestion.includes(chunk.file.toLowerCase()) || (basename.includes(".") && lowerQuestion.includes(basename));
    if (explicit) score += 25;
    const declaration = /(?:function|class|def|fn|const|let|interface|type)\s+([\p{L}\p{N}_$]+)/gu;
    for (const match of chunk.text.matchAll(declaration)) {
      if (searchTerms(match[1]).some(term => terms.includes(term))) score += 3;
    }
    const reasons = [];
    if (explicit) reasons.push("explicit file reference");
    if (matched.length) reasons.push("matches: " + matched.slice(0, 6).join(", "));
    return { ...chunk, score, reasons };
  });
  ranked.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.startLine - b.startLine);
  const matched = ranked.filter(chunk => chunk.score > 0);
  const lowConfidence = matched.length === 0;
  let candidates = matched;
  if (lowConfidence) {
    candidates = ranked.filter(chunk => /(^|\/)(?:readme\.md|package\.json|index\.[cm]?[jt]s|main\.py|app\.py|pyproject\.toml|cargo\.toml)$/i.test(chunk.file));
    if (!candidates.length) candidates = ranked.slice(0, 3);
    candidates = candidates.map(chunk => ({ ...chunk, reasons: ["overview fallback; no query match"] }));
  } else {
    const available = new Set(entries.map(([file]) => file));
    const contentByFile = new Map(entries);
    const seedFiles = [...new Set(matched.map(chunk => chunk.file))].slice(0, 1);
    const imports = new Map();
    for (const file of seedFiles) {
      for (const dependency of dependencies(file, contentByFile.get(file), available)) {
        if (!seedFiles.includes(dependency)) imports.set(dependency, file);
      }
    }
    const related = [];
    for (const [file, parent] of imports) {
      const best = ranked.find(chunk => chunk.file === file);
      if (best) related.push({ ...best, score: best.score + matched[0].score * 0.65, reasons: [...best.reasons, "imported by " + parent] });
    }
    const relatedFiles = new Set(related.map(chunk => chunk.file));
    candidates = [...matched.filter(chunk => !relatedFiles.has(chunk.file)), ...related];
    candidates.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.startLine - b.startLine);
  }

  // First consider one excerpt per file, then additional excerpts. This preserves coverage.
  const seen = new Set();
  const first = [];
  const rest = [];
  for (const chunk of candidates) {
    if (seen.has(chunk.file)) rest.push(chunk);
    else { first.push(chunk); seen.add(chunk.file); }
  }
  const selected = [];
  const details = [];
  const perFile = new Map();
  for (const chunk of [...first, ...rest]) {
    if (!perFile.has(chunk.file) && perFile.size >= maxFiles) continue;
    if ((perFile.get(chunk.file) ?? 0) >= 3) continue;
    const fits = text => estimateTokens(buildPrompt(question, JSON.stringify([...selected, excerpt(chunk, text)]))) <= budget;
    let text = chunk.text;
    if (!fits(text)) {
      // Find a useful prefix within the remaining budget. Every accepted prefix is rechecked.
      let low = 0;
      let high = text.length;
      let best = "";
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const prefix = text.slice(0, middle);
        if (fits(prefix)) { best = prefix; low = middle + 1; }
        else high = middle - 1;
      }
      const newline = best.lastIndexOf("\n");
      if (newline >= 80) best = best.slice(0, newline);
      if (best.length < 40 || !fits(best)) continue;
      text = best;
    }
    const selectedExcerpt = excerpt(chunk, text);
    selected.push(selectedExcerpt);
    details.push({ file: chunk.file, startLine: selectedExcerpt.startLine, endLine: selectedExcerpt.endLine,
      reasons: chunk.reasons, score: Number(chunk.score.toFixed(3)), truncated: Boolean(selectedExcerpt.truncated || selectedExcerpt.partialLine) });
    perFile.set(chunk.file, (perFile.get(chunk.file) ?? 0) + 1);
  }

  let content = JSON.stringify(selected);
  const fullExcerpts = entries.map(([file, text]) => ({ file, startLine: 1, endLine: text.split("\n").length, content: text }));
  const fullContent = JSON.stringify(fullExcerpts);
  const fullTokens = estimateTokens(buildPrompt(question, fullContent));
  let selectedTokens = estimateTokens(buildPrompt(question, content));
  // Repeated excerpt labels can cost more than complete files on tiny projects.
  if (fullTokens < selectedTokens && fullTokens <= budget && entries.length <= maxFiles) {
    selected.splice(0, selected.length, ...fullExcerpts);
    details.splice(0, details.length, ...fullExcerpts.map(item => ({
      file: item.file, startLine: item.startLine, endLine: item.endLine,
      reasons: ["whole files use fewer tokens than separate excerpts"], score: 0, truncated: false
    })));
    perFile.clear();
    for (const [file] of entries) perFile.set(file, 1);
    content = fullContent;
    selectedTokens = fullTokens;
  }
  if (selectedTokens > budget) throw new Error("Internal budget check failed.");
  const savedTokens = Math.max(0, fullTokens - selectedTokens);
  return {
    content, excerpts: selected, selections: details, selectedFiles: [...perFile.keys()],
    fullTokens, selectedTokens, savedTokens,
    reductionPercent: fullTokens ? Number((savedTokens / fullTokens * 100).toFixed(1)) : 0,
    budget, encoding: TOKEN_ENCODING, lowConfidence,
    warnings: lowConfidence ? ["No strong keyword match. Overview excerpts may not answer this question."] : []
  };
}
