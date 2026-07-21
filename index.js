import path from "node:path";
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { createSnapshot } from "./lib/snapshot.js";
import { selectRelevantFiles } from "./lib/relevanceSelector.js";
import {
  saveToCache,
  getFromCache,
  isCached,
  clearCache
} from "./lib/cache.js";
import { askModel } from "./lib/openaiClient.js";

const projectFolder = path.resolve(process.argv[2] ?? ".");

if (!fs.existsSync(projectFolder)) {
  console.error(`Folder does not exist: ${projectFolder}`);
  process.exit(1);
}

if (!fs.statSync(projectFolder).isDirectory()) {
  console.error(`Path is not a folder: ${projectFolder}`);
  process.exit(1);
}

const terminal = readline.createInterface({
  input,
  output
});

const stats = {
  questions: 0,
  apiCalls: 0,
  cacheHits: 0,
  fullTokens: 0,
  selectedTokens: 0,
  savedTokens: 0
};

function showStats() {
  console.log("\n--- Token Saver Statistics ---");
  console.log(`Questions: ${stats.questions}`);
  console.log(`API calls: ${stats.apiCalls}`);
  console.log(`Cache hits: ${stats.cacheHits}`);
  console.log(`Full-context tokens: ${stats.fullTokens}`);
  console.log(`Selected-context tokens: ${stats.selectedTokens}`);
  console.log(`Estimated tokens saved: ${stats.savedTokens}`);
  console.log("------------------------------\n");
}

console.log("\nToken Saver CLI");
console.log(`Project: ${projectFolder}`);
console.log("");
console.log("Commands:");
console.log("  /stats  Show token statistics");
console.log("  /clear  Clear the prompt cache");
console.log("  /exit   Close the program");
console.log("");

while (true) {
  const prompt = (await terminal.question("You: ")).trim();

  if (!prompt) {
    continue;
  }

  if (prompt === "/exit") {
    break;
  }

  if (prompt === "/stats") {
    showStats();
    continue;
  }

  if (prompt === "/clear") {
    clearCache();
    console.log("Cache cleared.\n");
    continue;
  }

  try {
    const snapshot = createSnapshot(projectFolder);
    const selection = selectRelevantFiles(snapshot, prompt);

    if (selection.selectedFiles.length === 0) {
      console.log("No project files could be selected.\n");
      continue;
    }

    stats.questions++;
    stats.fullTokens += selection.fullTokens;
    stats.selectedTokens += selection.selectedTokens;
    stats.savedTokens += selection.savedTokens;

    const cacheKey = [
      prompt,
      selection.content
    ].join("\n\n");

    console.log(
      `\nSelected files: ${selection.selectedFiles.join(", ")}`
    );

    console.log(
      `Context: ${selection.fullTokens} → ${selection.selectedTokens} estimated tokens`
    );

    console.log(
      `Estimated saving: ${selection.savedTokens} tokens`
    );

    if (isCached(cacheKey)) {
      stats.cacheHits++;

      console.log("\nAssistant [cached]:");
      console.log(getFromCache(cacheKey));
      console.log("");

      continue;
    }

    const result = await askModel({
      prompt,
      context: selection.content
    });

    stats.apiCalls++;
    saveToCache(cacheKey, result.text);

    console.log("\nAssistant:");
    console.log(result.text || "The model returned no text.");
    console.log("");

    if (result.usage) {
      console.log(
        `API usage — input: ${result.usage.input_tokens ?? "unknown"}, output: ${result.usage.output_tokens ?? "unknown"}`
      );
      console.log("");
    }
  } catch (error) {
    console.error(
      `\nError: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

showStats();
terminal.close();

console.log("Goodbye!");
