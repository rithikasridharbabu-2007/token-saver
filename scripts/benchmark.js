import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectIndex } from "../lib/snapshot.js";
import { selectRelevantFiles } from "../lib/relevanceSelector.js";

export const cases = [
  { question: "How does signIn create a session?", expected: ["src/auth.js", "src/sessions.js"], evidence: ["verifyPassword", "SESSION_TTL_MS"] },
  { question: "Where are expired cached answers removed?", expected: ["src/cache.js"], evidence: ["answers.delete(key)"] },
  { question: "How does checkout calculate the total?", expected: ["src/checkout.js", "src/pricing.js"], evidence: ["payments.charge", "Math.max(0, subtotal - discountCents)"] },
  { question: "Which command starts the app in package.json?", expected: ["package.json"], evidence: ["node src/server.js"] },
  { question: "How does load_settings read the port?", expected: ["python/settings.py"], evidence: ['os.getenv("PORT", "5000")'] },
  { question: "How is an invalid API token rejected?", expected: ["python/auth.py", "python/permissions.py"], evidence: ["Invalid API token", "account.permissions"] }
];

export function runBenchmark(root = fileURLToPath(new URL("../examples/demo-project", import.meta.url))) {
  const snapshot = new ProjectIndex().scan(root).snapshot;
  const results = cases.map(item => {
    const selection = selectRelevantFiles(snapshot, item.question, { budget: 700, maxFiles: 4 });
    const evidenceText = selection.excerpts.map(excerpt => excerpt.content).join("\n");
    return {
      question: item.question,
      filesFound: item.expected.filter(file => selection.selectedFiles.includes(file)).length,
      filesExpected: item.expected.length,
      evidenceFound: item.evidence.filter(value => evidenceText.includes(value)).length,
      evidenceExpected: item.evidence.length,
      promptTokens: selection.selectedTokens,
      baselineTokens: selection.fullTokens,
      reductionPercent: selection.reductionPercent,
      withinBudget: selection.selectedTokens <= 700
    };
  });
  return {
    scope: "Offline retrieval on a small authored fixture; does not measure answer quality, billing, or performance on unseen repositories.",
    budget: 700,
    results,
    passed: results.every(item => item.withinBudget && item.filesFound === item.filesExpected && item.evidenceFound === item.evidenceExpected)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runBenchmark();
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
