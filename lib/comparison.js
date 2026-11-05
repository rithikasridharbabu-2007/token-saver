import { askModel } from "./openaiClient.js";
import { selectRelevantFiles } from "./relevanceSelector.js";
import { fullContext, promptSize } from "./evaluation.js";

export async function compareContexts(report, question, options = {}, runModel = askModel) {
  if (!options.model?.trim()) throw new Error("compare requires --model so both runs use the same explicit model.");
  const selection = selectRelevantFiles(report.snapshot, question, options);
  if (!selection.excerpts.length) throw new Error("No source fits the selected budget.");
  const baseline = fullContext(report.snapshot);
  const baselineTokens = promptSize(question, baseline);
  if (baselineTokens > (options.baselineLimit ?? 32000)) {
    throw new Error("Full-source baseline exceeds --baseline-limit. Choose a smaller project or explicitly increase the limit.");
  }
  const result = {
    schemaVersion: 1, kind: "live-codex-comparison", model: options.model, question,
    sourceFingerprint: report.fingerprint, answerReview: "unreviewed",
    scope: "Two uncached Codex runs with the same model and question. Compare answers manually; this does not prove equal accuracy or dollar savings.",
    runs: {}, complete: false
  };
  for (const [name, context, localTokens] of [
    ["baseline", baseline, baselineTokens],
    ["optimized", selection.content, selection.selectedTokens]
  ]) {
    if (options.signal?.aborted) { result.runs[name] = { error: "Request cancelled." }; break; }
    const start = performance.now();
    try {
      const answer = await runModel({ prompt: question, context, model: options.model,
        timeoutMs: options.timeoutMs, signal: options.signal });
      result.runs[name] = { answer: answer.text, usage: answer.usage, threadId: answer.threadId ?? null,
        elapsedMs: Math.round(performance.now() - start), localPromptTokens: localTokens };
    } catch (error) {
      result.runs[name] = { error: error.message, elapsedMs: Math.round(performance.now() - start), localPromptTokens: localTokens };
      break;
    }
  }
  const a = result.runs.baseline;
  const b = result.runs.optimized;
  result.complete = Boolean(a?.answer && b?.answer);
  result.localPromptTokensReduced = result.complete ? a.localPromptTokens - b.localPromptTokens : null;
  result.reportedInputTokensReduced = result.complete && Number.isFinite(a.usage?.input_tokens) && Number.isFinite(b.usage?.input_tokens)
    ? a.usage.input_tokens - b.usage.input_tokens : null;
  result.note = "Provider cached-input tokens, output lengths and run order can affect cost and latency. Missing usage stays unknown.";
  return result;
}
