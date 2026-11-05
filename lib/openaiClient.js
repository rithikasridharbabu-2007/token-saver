import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPrompt } from "./prompt.js";

export function checkCodex(command = "codex") {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error("Codex CLI was not found or could not start. Install Codex and run 'codex login', then try again.");
  return result.stdout.trim();
}

// Model/settings changes must not silently reuse an old answer.
export function runtimeIdentity(command = "codex") {
  const config = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
  let bytes = "";
  try { bytes = fs.readFileSync(config); } catch (error) { if (error.code !== "ENOENT") throw error; }
  return createHash("sha256").update(checkCodex(command)).update(bytes).digest("hex");
}

export async function askModel({ prompt, context, model, timeoutMs = 120000, signal, command = "codex" }) {
  if (signal?.aborted) throw new Error("Request cancelled.");
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "token-saver-"));
  fs.chmodSync(runDirectory, 0o700);
  const instructions = buildPrompt(prompt, context);
  try {
    return await new Promise((resolve, reject) => {
      const args = [
        "exec", "--json", "--ephemeral", "--sandbox", "read-only",
        "--skip-git-repo-check", "--cd", runDirectory,
        "--disable", "shell_tool", "--disable", "multi_agent",
        "-c", 'web_search="disabled"', ...(model ? ["--model", model] : []), "-"
      ];
      const child = spawn(command, args, { cwd: runDirectory, env: process.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let buffer = "";
      let errors = "";
      let text = "";
      let usage = null;
      let threadId = null;
      let failure = "";
      let stopped = false;
      let settled = false;
      let killTimer;
      const timeout = setTimeout(() => stop("Codex timed out. Increase --timeout or try a smaller question."), timeoutMs);
      const abort = () => stop("Request cancelled.");

      function clean() {
        clearTimeout(timeout);
        clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
      }
      function finish(error, result) {
        if (settled) return;
        settled = true;
        clean();
        if (error) reject(error);
        else resolve(result);
      }
      function stop(reason) {
        if (stopped) return;
        stopped = true;
        failure ||= reason;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      }
      function eventLine(line) {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch { stop("Codex returned invalid JSON events. Update Codex CLI and try again."); return; }
        if (event.type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          if (typeof event.item.text === "string") text = event.item.text;
        }
        if (event.type === "turn.completed") usage = event.usage ?? null;
        if (event.type === "turn.failed" || event.type === "error") {
          failure ||= event.error?.message || event.message || "Codex request failed.";
        }
        // Refuse to cache answers that used additional context or external tools.
        if (event.type === "item.started" || event.type === "item.completed") {
          if (event.item?.type && !["agent_message", "reasoning", "plan"].includes(event.item.type)) {
            stop("Codex attempted to use a tool. Token Saver accepts answers from selected context only.");
          }
        }
      }
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        buffer += chunk;
        if (buffer.length > 2 * 1024 * 1024) { stop("Codex event exceeded the output limit."); buffer = ""; return; }
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          eventLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-16000); });
      child.stdin.on("error", error => {
        if (error.code !== "EPIPE") stop("Could not send the question to Codex.");
      });
      child.on("error", error => finish(new Error(error.code === "ENOENT" ? "Codex CLI is missing. Install Codex and run 'codex login'." : "Could not start Codex: " + error.message)));
      child.on("close", code => {
        if (buffer.trim()) eventLine(buffer);
        if (failure || code !== 0) return finish(new Error(failure || errors.trim() || "Codex exited before answering."));
        if (!text.trim()) return finish(new Error("Codex returned no answer. Nothing was cached."));
        finish(null, { text: text.trim(), usage, threadId, cached: false });
      });
      child.stdin.end(instructions);
    });
  } finally {
    fs.rmSync(runDirectory, { recursive: true, force: true });
  }
}
