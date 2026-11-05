import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { ProjectIndex } from "./snapshot.js";
import { selectRelevantFiles } from "./relevanceSelector.js";
import { AnswerCache, createCacheKey } from "./cache.js";
import { askModel, checkCodex, runtimeIdentity } from "./openaiClient.js";
import { buildPrompt, PROMPT_VERSION } from "./prompt.js";
import { DEMO_CASES, evaluateBudgets } from "./evaluation.js";
import { compareContexts } from "./comparison.js";
import { DEMO_ROOT, makeWorkbenchData, renderWorkbench, startWorkbench } from "./workbench.js";

const HELP = [
  "Token Saver — smaller, inspectable context for coding questions",
  "",
  "Usage:",
  "  token-saver demo [project]                          Open the local browser workbench",
  "  token-saver demo --output preview.html           Export a standalone offline demo",
  "  token-saver evaluate [project] --cases cases.json    Check evidence across budgets",
  '  token-saver compare "question" [project] --model M   Two live Codex runs',
  '  token-saver context "How does login work?" [project]  Preview offline',
  '  token-saver ask "How does login work?" [project]      Ask Codex',
  "  token-saver [project]                                Interactive questions",
  "  token-saver doctor [project]                         Check setup",
  "  token-saver cache info|clear [project]               Manage local answers",
  "",
  "Options:",
  "  --budget N       Maximum assembled prompt tokens in o200k_base (default: 4000)",
  "  --max-files N    Maximum selected files (default: 8)",
  "  --model NAME     Override your configured Codex model",
  "  --timeout N      Request timeout in seconds (default: 120)",
  "  --no-cache       Disable reading and writing saved answers",
  "  --dry-run        Preview an ask without running Codex",
  "  --json           Machine-readable output",
  "  --output FILE    Save a new prompt, report, or standalone demo file",
  "  --cases FILE     Labeled evidence dataset for evaluate",
  "  --budgets LIST   Comma-separated evaluation budgets (default: 300,700,1200)",
  "  --baseline-limit N  Maximum baseline tokens for compare (default: 32000)",
  "  --port N         Local demo port; 0 chooses a free port (default: 0)",
  "  --help           Show this help",
  "  --version        Show version",
  "",
  "Context preview requires no account or API key. Ask requires Codex CLI and login.",
  "Saved answers stay in the project's .token-saver/cache for up to 24 hours."
].join("\n");

function integer(value, name, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(name + " must be an integer from " + min + " to " + max + ".");
  return number;
}

export function parseOptions(args) {
  const { values, positionals } = parseArgs({
    args, allowPositionals: true, strict: true,
    options: {
      budget: { type: "string", default: "4000" },
      "max-files": { type: "string", default: "8" },
      timeout: { type: "string", default: "120" },
      model: { type: "string" }, "no-cache": { type: "boolean" },
      json: { type: "boolean" }, "dry-run": { type: "boolean" },
      output: { type: "string" }, help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      cases: { type: "string" }, budgets: { type: "string" },
      "baseline-limit": { type: "string" }, port: { type: "string" }
    }
  });
  const options = {
    budget: integer(values.budget, "--budget", 128, 100000),
    maxFiles: integer(values["max-files"], "--max-files", 1, 50),
    timeoutMs: integer(values.timeout, "--timeout", 1, 3600) * 1000,
    model: values.model, cache: !values["no-cache"], json: values.json,
    output: values.output, help: values.help, version: values.version,
    cases: values.cases, budgets: (values.budgets ?? "300,700,1200").split(",").map(item => integer(item, "--budgets", 128, 100000)),
    baselineLimit: integer(values["baseline-limit"] ?? "32000", "--baseline-limit", 128, 100000),
    port: integer(values.port ?? "0", "--port", 0, 65535)
  };
  if (options.help || options.version) return options;
  if (values["dry-run"] && !["ask", "context"].includes(positionals[0])) throw new Error("--dry-run requires ask or context and a quoted question.");
  if (options.model !== undefined && !options.model.trim()) throw new Error("--model must not be empty.");
  let [command, ...rest] = positionals;
  let question;
  let project;
  let cacheAction;
  if (["ask", "context", "compare"].includes(command)) {
    [question, project] = rest;
    if (!question?.trim()) throw new Error("Provide a question in quotes. Example: token-saver context \"How does caching work?\" .");
    if (rest.length > 2) throw new Error("Quote your question and provide only one project folder.");
    if (values["dry-run"]) command = "context";
  } else if (["doctor", "demo", "evaluate"].includes(command)) {
    if (rest.length > 1) throw new Error(command + " accepts one project folder.");
    [project] = rest;
  } else if (command === "cache") {
    [cacheAction, project] = rest;
    if (!["info", "clear"].includes(cacheAction) || rest.length > 2) throw new Error("Use token-saver cache info|clear [project].");
  } else {
    if (positionals.length > 1) throw new Error("Use --help for command examples.");
    project = command;
    command = "interactive";
  }
  if (options.output && !["context", "demo", "evaluate", "compare"].includes(command)) throw new Error("--output is available with context, demo, evaluate, compare, or --dry-run.");
  if (options.cases && command !== "evaluate") throw new Error("--cases is only available with evaluate.");
  if (values.budgets && command !== "evaluate") throw new Error("--budgets is only available with evaluate.");
  if (values.port && command !== "demo") throw new Error("--port is only available with demo.");
  if (values["baseline-limit"] && command !== "compare") throw new Error("--baseline-limit is only available with compare.");
  if (command === "compare" && !options.model) throw new Error("compare requires an explicit --model.");
  if (options.json && command === "interactive") {
    if (!options.help && !options.version) throw new Error("--json requires ask, context, doctor, or cache.");
  }
  return { ...options, command, question, project: path.resolve(project ?? (["demo", "evaluate"].includes(command) ? DEMO_ROOT : ".")), cacheAction };
}

function summary(selection, report) {
  return {
    files: selection.selectedFiles,
    selections: selection.selections,
    scannedFiles: report.fileCount,
    rereadFiles: report.reread,
    skipped: report.skipped,
    warnings: [...report.warnings, ...selection.warnings],
    promptTokens: selection.selectedTokens,
    fullContextPromptTokens: selection.fullTokens,
    contextTokensAvoided: selection.savedTokens,
    reductionPercent: selection.reductionPercent,
    budget: selection.budget,
    encoding: selection.encoding,
    lowConfidence: selection.lowConfidence,
    baseline: "all eligible scanned text files, with the same question and instructions"
  };
}

function describe(data) {
  return [
    "Context: " + data.fullContextPromptTokens.toLocaleString() + " → " + data.promptTokens.toLocaleString() +
      " local tokens (" + data.reductionPercent + "% smaller; budget " + data.budget + ").",
    "Counting: " + data.encoding + "; actual Codex usage may differ.",
    ...data.selections.map(item => "  " + item.file + ":" + item.startLine + "-" + item.endLine +
      (item.truncated ? " [excerpt]" : "") + " — " + item.reasons.join("; ")),
    ...data.warnings.map(warning => "Note: " + warning)
  ].join("\n");
}

function preview(selection, data, question) {
  return [
    describe(data),
    "",
    "Question: " + question,
    ...selection.excerpts.flatMap(excerpt => [
      "",
      "FILE " + JSON.stringify(excerpt.file) + " — lines " + excerpt.startLine + "-" + excerpt.endLine,
      ...excerpt.content.split("\n").map((line, index) => String(excerpt.startLine + index).padStart(5) + " | " + line)
    ])
  ].join("\n");
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) { console.log(HELP); return; }
  if (options.version) { console.log("1.2.0"); return; }
  let root;
  try {
    root = fs.realpathSync(options.project);
    if (!fs.statSync(root).isDirectory()) throw new Error("not a directory");
  } catch { throw new Error("Project folder does not exist or is not a directory: " + options.project); }
  if (options.output && fs.existsSync(path.resolve(options.output))) throw new Error("Output already exists; choose a new file.");
  if (options.command === "demo") {
    if (options.output) {
      fs.writeFileSync(path.resolve(options.output), renderWorkbench(makeWorkbenchData(root)), { flag: "wx", mode: 0o600 });
      console.log("Standalone offline demo saved to " + path.resolve(options.output));
      return;
    }
    const { server, url } = await startWorkbench(root, { port: options.port });
    console.log("Token Saver workbench: " + url + "\nLocal preview only; no model calls. Press Ctrl+C to close.");
    const stop = () => server.close();
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    try { await new Promise(resolve => server.once("close", resolve)); }
    finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    return;
  }
  if (options.command === "evaluate") {
    const cases = options.cases ? JSON.parse(fs.readFileSync(path.resolve(options.cases), "utf8")) :
      root === fs.realpathSync(DEMO_ROOT) ? DEMO_CASES : null;
    if (!cases) throw new Error("For your own project, provide --cases with expected files and evidence.");
    const result = evaluateBudgets(new ProjectIndex().scan(root), cases, options.budgets, { maxFiles: options.maxFiles });
    const serialized = JSON.stringify(result, null, 2);
    if (options.output) fs.writeFileSync(path.resolve(options.output), serialized + "\n", { flag: "wx", mode: 0o600 });
    console.log(options.json ? serialized : result.runs.map(run => run.budget + " tokens: " + run.passedCases + "/" + run.totalCases +
      " cases retain all labeled evidence").join("\n") + "\nSmallest passing tested budget: " +
      (result.recommendedBudget ?? "none") + "\n" + result.scope);
    if (!result.recommendedBudget) process.exitCode = 1;
    return;
  }
  if (options.command === "compare") {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.on("SIGINT", cancel);
    try {
      console.error("Running two uncached Codex requests with " + options.model + ". Reported usage and both answers will be recorded.");
      const result = await compareContexts(new ProjectIndex().scan(root), options.question, { ...options, signal: controller.signal });
      const serialized = JSON.stringify(result, null, 2);
      if (options.output) fs.writeFileSync(path.resolve(options.output), serialized + "\n", { flag: "wx", mode: 0o600 });
      console.log(serialized);
      if (!result.complete) process.exitCode = 1;
    } finally { process.removeListener("SIGINT", cancel); }
    return;
  }
  const cache = new AnswerCache(root, { enabled: options.cache });
  if (options.command === "cache") {
    if (options.cacheAction === "clear") cache.clear();
    const info = { ...cache.info(), cleared: options.cacheAction === "clear" };
    console.log(options.json ? JSON.stringify(info, null, 2) :
      (info.cleared ? "Saved answers cleared." : info.entries + " saved answers; " + info.bytes + " bytes; 24-hour expiry."));
    return;
  }

  const index = new ProjectIndex();
  function prepare(question) {
    const report = index.scan(root);
    if (!report.fileCount) throw new Error("No readable project files found. Check the folder and your ignore rules.");
    const selection = selectRelevantFiles(report.snapshot, question, options);
    if (!selection.excerpts.length) throw new Error("No source excerpt fits. Increase --budget or ask a shorter question.");
    return { report, selection, data: summary(selection, report) };
  }
  if (options.command === "doctor") {
    const report = index.scan(root);
    let codex;
    let error;
    try { codex = checkCodex(); } catch (problem) { error = problem.message; }
    const info = { node: process.version, codex: codex ?? null, error: error ?? null, readableFiles: report.fileCount,
      skipped: report.skipped, warnings: report.warnings, loginChecked: false };
    console.log(options.json ? JSON.stringify(info, null, 2) :
      ["Node: " + info.node, "Codex: " + (codex || error), "Readable files: " + report.fileCount,
        "Login was not tested. Run 'codex login' before asking a question.", ...report.warnings].join("\n"));
    if (error || !report.fileCount) process.exitCode = 1;
    return;
  }
  if (options.command === "context") {
    const { selection, data } = prepare(options.question);
    if (options.output) {
      fs.writeFileSync(path.resolve(options.output), buildPrompt(options.question, selection.content) + "\n", { flag: "wx", mode: 0o600 });
      console.error("Prompt exported to " + path.resolve(options.output));
    }
    console.log(options.json ? JSON.stringify({ ...data, question: options.question, excerpts: selection.excerpts }, null, 2) : preview(selection, data, options.question));
    return;
  }

  let runtime;
  const stats = { questions: 0, modelRuns: 0, cacheHits: 0, failures: 0, estimatedBaselineTokens: 0,
    estimatedSentPromptTokens: 0, estimatedAvoidedBySelection: 0, estimatedAvoidedByCache: 0,
    actualInputTokens: 0, actualCachedInputTokens: 0, actualOutputTokens: 0, runsWithUsage: 0 };
  let active;
  const interrupt = () => {
    if (active) active.abort();
  };
  process.on("SIGINT", interrupt);
  async function answer(question) {
    stats.questions++;
    const started = performance.now();
    try {
      const { selection, data, report } = prepare(question);
      runtime = runtimeIdentity();
      const key = createCacheKey({ version: PROMPT_VERSION, project: root, fingerprint: report.fingerprint,
        question, context: selection.content, model: options.model ?? "codex-configured-default", runtime });
      let result;
      try { result = cache.get(key); } catch (error) { console.error("Cache unavailable: " + error.message); }
      if (result) {
        stats.cacheHits++;
        stats.estimatedAvoidedByCache += selection.selectedTokens;
      } else {
        stats.modelRuns++;
        active = new AbortController();
        if (!options.json) console.error(describe(data) + "\nAsking Codex… (Ctrl+C cancels)");
        result = await askModel({ prompt: question, context: selection.content, model: options.model,
          timeoutMs: options.timeoutMs, signal: active.signal });
        active = null;
        stats.estimatedSentPromptTokens += selection.selectedTokens;
        if (result.usage) {
          stats.runsWithUsage++;
          stats.actualInputTokens += result.usage.input_tokens ?? 0;
          stats.actualCachedInputTokens += result.usage.cached_input_tokens ?? 0;
          stats.actualOutputTokens += result.usage.output_tokens ?? 0;
        }
        try { cache.set(key, result); } catch (error) { console.error("Answer received; could not save cache: " + error.message); }
      }
      stats.estimatedBaselineTokens += selection.fullTokens;
      stats.estimatedAvoidedBySelection += selection.savedTokens;
      const resultData = { answer: result.text, cacheHit: Boolean(result.cached), usage: result.usage, threadId: result.threadId ?? null,
        elapsedMs: Math.round(performance.now() - started), context: data };
      if (options.json) console.log(JSON.stringify(resultData, null, 2));
      else {
        if (result.cached) console.error(describe(data) + "\nSaved answer reused; no model call.");
        console.log("\n" + result.text + "\n");
        if (result.usage) console.error("Reported usage: input " + (result.usage.input_tokens ?? "?") +
          ", cached input " + (result.usage.cached_input_tokens ?? "?") + ", output " + (result.usage.output_tokens ?? "?") + ".");
      }
    } catch (error) {
      stats.failures++;
      throw error;
    } finally {
      active = null;
    }
  }
  try {
    if (options.command === "ask") { await answer(options.question); return; }
    if (!process.stdin.isTTY) throw new Error("For scripts, use: token-saver ask \"your question\" [project].");
    console.log("Token Saver · " + root + "\nQuestions are independent. /context QUESTION previews, /stats, /clear, /exit.\n");
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    terminal.on("SIGINT", () => terminal.close());
    try {
      while (!terminal.closed) {
        let question;
        try { question = (await terminal.question("You: ")).trim(); }
        catch (error) { if (error.code === "ABORT_ERR" || error.code === "ERR_USE_AFTER_CLOSE") break; throw error; }
        if (!question) continue;
        if (question === "/exit") break;
        if (question === "/stats") { console.log(JSON.stringify(stats, null, 2)); continue; }
        if (question === "/clear") { cache.clear(); console.log("Saved answers cleared."); continue; }
        try {
          if (question.startsWith("/context ")) {
            const query = question.slice(9).trim();
            const { selection, data } = prepare(query);
            console.log(preview(selection, data, query));
          } else await answer(question);
        } catch (error) { console.error("Error: " + error.message); }
      }
    } finally { terminal.close(); }
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}
