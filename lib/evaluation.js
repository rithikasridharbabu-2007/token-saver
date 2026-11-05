import { selectRelevantFiles } from "./relevanceSelector.js";
import { buildPrompt } from "./prompt.js";
import { estimateTokens } from "./tokenizer.js";

export const DEMO_CASES = [
  { id: "sessions", question: "How does signIn create a session?", expectedFiles: ["src/auth.js", "src/sessions.js"],
    evidence: [{ file: "src/auth.js", contains: "verifyPassword" }, { file: "src/sessions.js", contains: "SESSION_TTL_MS" }] },
  { id: "expiry", question: "Where are expired cached answers removed?", expectedFiles: ["src/cache.js"],
    evidence: [{ file: "src/cache.js", contains: "answers.delete(key)" }] },
  { id: "checkout", question: "How does checkout calculate the total?", expectedFiles: ["src/checkout.js", "src/pricing.js"],
    evidence: [{ file: "src/checkout.js", contains: "payments.charge" }, { file: "src/pricing.js", contains: "Math.max(0, subtotal - discountCents)" }] },
  { id: "start", question: "Which command starts the app in package.json?", expectedFiles: ["package.json"],
    evidence: [{ file: "package.json", contains: "node src/server.js" }] },
  { id: "settings", question: "How does load_settings read the port?", expectedFiles: ["python/settings.py"],
    evidence: [{ file: "python/settings.py", contains: 'os.getenv("PORT", "5000")' }] },
  { id: "permissions", question: "How is an invalid API token rejected?", expectedFiles: ["python/auth.py", "python/permissions.py"],
    evidence: [{ file: "python/auth.py", contains: "Invalid API token" }, { file: "python/permissions.py", contains: "account.permissions" }] }
];

function validPath(value) {
  return typeof value === "string" && value.length <= 1000 && value.length > 0 &&
    !value.startsWith("/") && !value.includes("\\") && !/^[A-Za-z]:/.test(value) &&
    !value.split("/").includes("..");
}

export function validateCases(value) {
  const cases = Array.isArray(value) ? value : value?.cases;
  if (!Array.isArray(cases) || !cases.length || cases.length > 100) throw new Error("Provide 1–100 labeled cases.");
  const ids = new Set();
  for (const item of cases) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id)) throw new Error("Each case needs a unique id.");
    ids.add(item.id);
    if (typeof item.question !== "string" || !item.question.trim() || item.question.length > 4000) throw new Error("Each case needs a question of 1–4000 characters.");
    if (!Array.isArray(item.expectedFiles) || !item.expectedFiles.length || item.expectedFiles.length > 20 ||
        !item.expectedFiles.every(validPath) || new Set(item.expectedFiles).size !== item.expectedFiles.length) throw new Error("expectedFiles must contain 1–20 unique project-relative paths.");
    if (!Array.isArray(item.evidence) || !item.evidence.length || item.evidence.length > 20 ||
        !item.evidence.every(rule => rule && validPath(rule.file) && item.expectedFiles.includes(rule.file) &&
          typeof rule.contains === "string" && rule.contains.length > 0 && rule.contains.length <= 4000)) {
      throw new Error("Evidence needs a file from expectedFiles and a non-empty contains string.");
    }
  }
  return cases;
}

export function scoreEvidence(selection, item) {
  if (!item) return { status: "unscored", note: "No labeled evidence for this question. Answer accuracy has not been evaluated." };
  const files = item.expectedFiles.map(file => ({ file, retained: selection.selectedFiles.includes(file) }));
  const evidence = item.evidence.map(rule => ({
    ...rule, retained: selection.excerpts.some(excerpt => excerpt.file === rule.file && excerpt.content.includes(rule.contains))
  }));
  const fileHits = files.filter(item => item.retained).length;
  const evidenceHits = evidence.filter(item => item.retained).length;
  return {
    status: fileHits === files.length && evidenceHits === evidence.length ? "retained" : "missing",
    fileHits, fileTotal: files.length, evidenceHits, evidenceTotal: evidence.length, files, evidence,
    note: "Checks known source evidence, not correctness of an AI answer."
  };
}

export function inspectContext(report, question, options = {}, cases = []) {
  const selection = selectRelevantFiles(report.snapshot, question, options);
  const labeled = cases.find(item => item.question.trim() === question.trim());
  return {
    question, budget: selection.budget, encoding: selection.encoding, promptTokens: selection.selectedTokens,
    baselineTokens: selection.fullTokens, reductionPercent: selection.reductionPercent,
    selectedFiles: selection.selectedFiles, selections: selection.selections, excerpts: selection.excerpts,
    sourceFingerprint: report.fingerprint, scannedFiles: report.fileCount, skipped: report.skipped,
    warnings: [...report.warnings, ...selection.warnings],
    lowConfidence: selection.lowConfidence,
    evidence: scoreEvidence(selection, labeled),
    prompt: buildPrompt(question, selection.content),
    measurement: "Local o200k_base prompt counts; excludes Codex system messages and output. Baseline is all eligible source."
  };
}

export function evaluateBudgets(report, rawCases, budgets = [300, 700, 1200], options = {}) {
  const cases = validateCases(rawCases);
  if (!Array.isArray(budgets) || !budgets.length || budgets.length > 10 ||
      budgets.some(number => !Number.isInteger(number) || number < 128 || number > 100000)) throw new Error("Provide 1–10 budgets between 128 and 100000.");
  const unique = [...new Set(budgets)].sort((a, b) => a - b);
  // Reject impossible labels so a miss cannot be confused with a corrupt benchmark.
  for (const item of cases) {
    for (const file of item.expectedFiles) {
      if (!Object.hasOwn(report.snapshot, file)) throw new Error("Expected file is absent from scanned source for case " + item.id + ": " + file);
    }
    for (const rule of item.evidence) {
      if (!Object.hasOwn(report.snapshot, rule.file) || !report.snapshot[rule.file].includes(rule.contains)) {
        throw new Error("Evidence is absent from scanned source for case " + item.id + ": " + rule.file);
      }
    }
  }
  const runs = unique.map(budget => {
    const results = cases.map(item => {
      try {
        const selection = selectRelevantFiles(report.snapshot, item.question, { ...options, budget });
        const evidence = scoreEvidence(selection, item);
        return { id: item.id, question: item.question, budget, promptTokens: selection.selectedTokens,
          baselineTokens: selection.fullTokens, reductionPercent: selection.reductionPercent,
          selectedFiles: selection.selectedFiles, evidence, withinBudget: selection.selectedTokens <= budget };
      } catch (error) {
        return { id: item.id, question: item.question, budget, withinBudget: false,
          evidence: { status: "missing" }, error: error.message };
      }
    });
    return {
      budget, passedCases: results.filter(item => item.withinBudget && item.evidence.status === "retained").length,
      totalCases: results.length, results
    };
  });
  return {
    schemaVersion: 1, kind: "offline-evidence-evaluation",
    sourceFingerprint: report.fingerprint, encoding: "o200k_base",
    recommendedBudget: runs.find(run => run.passedCases === run.totalCases)?.budget ?? null,
    scope: "Small authored labels measure evidence retention, not answer accuracy, billing savings or performance on unseen projects.",
    runs
  };
}

export function fullContext(snapshot) {
  return JSON.stringify(Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b))
    .map(([file, content]) => ({ file, startLine: 1, endLine: content.split("\n").length, content })));
}

export function promptSize(question, context) {
  return estimateTokens(buildPrompt(question, context));
}
